import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { API_PREFIX, DEFAULT_BRAND, type Brand, type CmsEntry, type MediaItem, type NavItem, type CopyKey } from "century-nit-shared";
import { apiFetch } from "../lib/api";

/**
 * Content Management — the public site, organised the way visitors see it.
 *
 * "Site pages" is the default tab: a site map mirroring the real routes
 * (Top level / Explore / Services / Company — same groups as the footer and
 * mobile menu), each row showing what actually drives the page — a CMS
 * entry, the catalogue DB, or compiled copy — and its publish state.
 * Structured pages edit payload keys as labelled fields; list pages edit
 * their collection's entries; catalogue pages only expose the page chrome
 * (hero + SEO) the CMS owns.
 *
 * Brand, Media, Navigation and Copy tabs carry over — Navigation gains the
 * live header/footer previews, Media gains "used on" badges computed by
 * scanning entry payloads for media keys.
 */

type Tab = "site" | "brand" | "media" | "nav" | "copy";

const STATUS_STYLE: Record<string, string> = {
	draft: "cms-status cms-status--draft",
	review: "cms-status cms-status--review",
	published: "cms-status cms-status--published",
};

/** datetime-local wants local wall-clock, the API stores ISO. */
function toLocalInput(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const field: CSSProperties = { width: "100%", padding: "0.45rem 0.6rem", border: "1px solid var(--border,#d8d5cd)", background: "var(--surface,#fff)", color: "inherit", fontSize: "0.85rem" };
const label: CSSProperties = { display: "block", fontSize: "0.68rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted,#6e6a60)", marginBottom: "0.25rem", fontFamily: "ui-monospace,monospace" };
const btn = (primary = false): CSSProperties => ({
	padding: "0.45rem 1rem", border: "1px solid var(--ink,#17161a)", fontSize: "0.78rem", cursor: "pointer",
	background: primary ? "var(--ink,#17161a)" : "transparent",
	color: primary ? "var(--surface,#fff)" : "inherit",
	fontFamily: "ui-monospace,monospace", letterSpacing: "0.04em", textTransform: "uppercase",
});
const btnSm = (primary = false): CSSProperties => ({ ...btn(primary), padding: "0.2rem 0.55rem", fontSize: "0.65rem" });

function contrastRatio(hex: string): number | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const n = parseInt(m[1], 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return (Math.max(lum, 1) + 0.05) / (Math.min(lum, 1) + 0.05);
}

/* ── Shared: all entries, fetched once ───────────────────────────────────── */

function useCmsEntries() {
	const [entries, setEntries] = useState<CmsEntry[]>([]);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		const res = await apiFetch<{ entries: CmsEntry[] }>(`${API_PREFIX}/cms/entries`);
		setEntries(res.entries);
	}, []);
	useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "load failed")); }, [load]);
	return { entries, error, reload: load };
}

/** Media keys referenced inside entry payloads — media key → pages using it. */
function useMediaUsage(entries: CmsEntry[]) {
	return useMemo(() => {
		const map = new Map<string, string[]>();
		for (const e of entries) {
			const seen = new Set<string>();
			for (const m of JSON.stringify(e.payload).matchAll(/media\/[\w./-]+/g)) seen.add(m[0]);
			for (const key of seen) {
				const list = map.get(key) ?? [];
				list.push(`${e.collection}/${e.slug}`);
				map.set(key, list);
			}
		}
		return map;
	}, [entries]);
}

/** First image-ish string in a payload — used for site-map + row thumbnails. */
function payloadImage(payload: Record<string, unknown>): string | null {
	const keyLike = /image|photo|cover|poster|thumb|hero/i;
	const stack: unknown[] = [payload];
	while (stack.length) {
		const cur = stack.pop();
		if (!cur || typeof cur !== "object") continue;
		if (Array.isArray(cur)) { stack.push(...cur); continue; }
		for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
			if (typeof v === "string" && (v.startsWith("media/") || (keyLike.test(k) && v.length > 0 && !v.includes("\n")))) {
				if (v.startsWith("media/")) return v;
			}
			if (v && typeof v === "object") stack.push(v);
		}
	}
	return null;
}

function mediaSrc(key: string | null): string | null {
	return key && key.startsWith("media/") ? `${API_PREFIX}/media/${key}` : key;
}

/** Presigned-upload pipeline shared by the Media tab and the editor picker. */
async function uploadMediaFile(file: File): Promise<MediaItem> {
	const up = await apiFetch<{ key: string; url: string; headers: Record<string, string> }>(`${API_PREFIX}/cms/media/upload-url`, {
		method: "POST",
		body: JSON.stringify({ fileName: file.name, mime: file.type || "application/octet-stream" }),
	});
	const put = await fetch(up.url, { method: "PUT", headers: { "Content-Type": file.type, ...up.headers }, body: file });
	if (!put.ok) throw new Error(`upload failed (${put.status})`);
	const res = await apiFetch<{ media: MediaItem }>(`${API_PREFIX}/cms/media`, {
		method: "POST",
		body: JSON.stringify({ key: up.key, fileName: file.name, mime: file.type, sizeBytes: file.size, alt: file.name.replace(/\.[^.]+$/, "") }),
	});
	return res.media;
}

function mediaKind(m: MediaItem): "image" | "video" | "doc" {
	if (m.mime.startsWith("image/")) return "image";
	if (m.mime.startsWith("video/")) return "video";
	return "doc";
}

/* ── Media picker — browse the library, upload, and pick for a field ────── */

function MediaPicker({
	open,
	onPick,
	onClose,
	prefer,
}: {
	open: boolean;
	onPick: (key: string) => void;
	onClose: () => void;
	prefer?: "image" | "video";
}) {
	const [items, setItems] = useState<MediaItem[]>([]);
	const [kind, setKind] = useState<"all" | "image" | "video" | "doc">("all");
	const [q, setQ] = useState("");
	const [sel, setSel] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setSel(null); setKind(prefer ?? "all"); setError(null);
		void apiFetch<{ media: MediaItem[] }>(`${API_PREFIX}/cms/media`)
			.then((r) => setItems(r.media))
			.catch((e) => setError(e instanceof Error ? e.message : "failed to load media"));
	}, [open, prefer]);

	if (!open) return null;

	const query = q.trim().toLowerCase();
	const shown = items
		.filter((m) => (kind === "all" ? true : mediaKind(m) === kind))
		.filter((m) => (query ? (m.key + " " + m.alt + " " + m.fileName).toLowerCase().includes(query) : true));

	async function upload(file: File) {
		setBusy(true); setError(null);
		try {
			const m = await uploadMediaFile(file);
			setItems((prev) => [m, ...prev]);
			setSel(m.key);
		} catch (e) { setError(e instanceof Error ? e.message : "upload failed"); }
		finally { setBusy(false); }
	}

	return (
		<div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
			<div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(23,22,26,0.35)" }} />
			<div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 430, maxWidth: "94vw", background: "var(--surface,#fffdf8)", borderLeft: "1px solid var(--border,#ddd8cb)", boxShadow: "-18px 0 40px rgba(23,22,26,.18)", display: "flex", flexDirection: "column" }}>
				<div style={{ padding: "0.8rem 1rem", borderBottom: "1px solid var(--border,#ddd8cb)", display: "flex", alignItems: "center", gap: "0.6rem" }}>
					<h3 style={{ margin: 0, fontFamily: "var(--font-display,Georgia,serif)", fontSize: "1.05rem" }}>Media library</h3>
					<span style={{ flex: 1 }} />
					<button style={btnSm(false)} onClick={onClose}>✕</button>
				</div>
				<label style={{ ...btn(true), display: "block", margin: "0.8rem 1rem 0", textAlign: "center", borderStyle: "dashed", background: "var(--surface-alt,#fbfaf7)", color: "var(--muted,#6e6a60)", borderColor: "var(--border,#ddd8cb)" }}>
					{busy ? "Uploading…" : "Drop-in upload — click to browse (image · video · pdf)"}
					<input type="file" accept="image/*,video/*,.pdf" style={{ display: "none" }} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
				</label>
				<div style={{ display: "flex", gap: "0.35rem", padding: "0.7rem 1rem 0" }}>
					{(["all", "image", "video", "doc"] as const).map((k) => (
						<button key={k} style={{ ...btnSm(kind === k), flex: 1 }} onClick={() => setKind(k)}>{k === "image" ? "Images" : k === "video" ? "Video" : k === "doc" ? "Docs" : "All"}</button>
					))}
				</div>
				<div style={{ padding: "0.6rem 1rem" }}>
					<input style={{ ...field, fontSize: "0.75rem" }} placeholder="filter by key or alt…" value={q} onChange={(e) => setQ(e.target.value)} />
				</div>
				{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.75rem", padding: "0 1rem" }}>{error}</p> : null}
				<div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.6rem", padding: "0 1rem 1rem", overflowY: "auto", flex: 1, alignContent: "start" }}>
					{shown.map((m) => {
						const k = mediaKind(m);
						return (
							<button key={m.id} type="button" onClick={() => setSel(m.key)} style={{ padding: 0, border: sel === m.key ? "2px solid var(--accent,#b97a10)" : "1px solid var(--border,#ddd8cb)", background: "#fff", cursor: "pointer", textAlign: "left", position: "relative" }}>
								{k === "video" ? (
									<div style={{ width: "100%", height: 74, background: "var(--ink,#17161a)", position: "relative", overflow: "hidden" }}>
										<video src={`${API_PREFIX}/media/${m.key}`} preload="metadata" muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
										<span style={{ position: "absolute", top: 4, left: 4, background: "rgba(0,0,0,.65)", color: "#fff", fontFamily: "ui-monospace,monospace", fontSize: "0.5rem", padding: "0.1rem 0.3rem" }}>▶ video</span>
									</div>
								) : k === "image" ? (
									<img src={`${API_PREFIX}/media/${m.key}`} alt={m.alt} loading="lazy" style={{ width: "100%", height: 74, objectFit: "cover", display: "block" }} />
								) : (
									<div style={{ width: "100%", height: 74, display: "grid", placeItems: "center", background: "var(--surface-alt,#fbfaf7)", fontFamily: "ui-monospace,monospace", fontSize: "0.55rem", color: "var(--muted,#6e6a60)" }}>{m.mime.split("/")[1]?.toUpperCase() ?? "FILE"}</div>
								)}
								<span className="mono" style={{ display: "block", fontSize: "0.52rem", padding: "0.28rem 0.35rem", color: "var(--muted,#6e6a60)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.key}</span>
							</button>
						);
					})}
					{shown.length === 0 ? <p className="muted" style={{ gridColumn: "1 / -1", fontSize: "0.75rem", padding: "1rem 0" }}>Nothing here yet — upload above.</p> : null}
				</div>
				<div style={{ padding: "0.7rem 1rem", borderTop: "1px solid var(--border,#ddd8cb)", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
					<button style={btn(false)} onClick={onClose}>Cancel</button>
					<button style={btn(true)} disabled={!sel} onClick={() => { if (sel) { onPick(`media/${sel}`); onClose(); } }}>Use selected</button>
				</div>
			</div>
		</div>
	);
}

function entryTitle(e: CmsEntry): string {
	const p = e.payload as Record<string, unknown>;
	const v = p.title ?? p.name ?? p.question ?? p.headline ?? p.label;
	return typeof v === "string" && v.trim() ? v : e.slug;
}

/* ── Site map registry — the real public routes ─────────────────────────── */

type SitePageDef = {
	id: string;
	name: string;
	route: string;
	/** page → one `pages/{slug}` entry · list → a whole collection · catalogue → DB-driven, CMS owns hero+SEO only */
	kind: "page" | "list" | "catalogue";
	slug?: string;
	collection?: string;
	note?: string;
};

const SITE_GROUPS: { label: string; pages: SitePageDef[] }[] = [
	{
		label: "Top level",
		pages: [
			{ id: "home", name: "Home", route: "/", kind: "page", slug: "home" },
			{ id: "about", name: "About", route: "/about", kind: "page", slug: "about" },
			{ id: "why", name: "Why choose us", route: "/why-choose-us", kind: "page", slug: "why-choose-us" },
		],
	},
	{
		label: "Explore",
		pages: [
			{ id: "dest", name: "Destinations", route: "/destinations", kind: "catalogue", slug: "destinations", note: "List and detail pages read the catalogue DB (ops → Universities/Programmes). CMS owns only this page's hero copy and SEO." },
			{ id: "uni", name: "Universities", route: "/universities", kind: "catalogue", slug: "universities", note: "100+ partner rows live in the catalogue — covers, names and intakes are edited there, not here." },
			{ id: "prog", name: "Programs", route: "/programs", kind: "catalogue", slug: "programs", note: "Catalogue-driven like Universities. CMS owns hero copy and SEO only." },
			{ id: "schol", name: "Scholarships", route: "/scholarships", kind: "catalogue", slug: "scholarships", note: "Scholarship rows are catalogue entries with deadlines — hero copy and SEO live here." },
		],
	},
	{
		label: "Services",
		pages: [
			{ id: "visa", name: "Visa services", route: "/visa-services", kind: "page", slug: "visa-services" },
			{ id: "svc", name: "Student services", route: "/student-services", kind: "list", collection: "services", slug: "student-services" },
		],
	},
	{
		label: "Company",
		pages: [
			{ id: "red", name: "Success stories", route: "/red-seat", kind: "list", collection: "stories", slug: "red-seat" },
			{ id: "films", name: "Films (on camera)", route: "/red-seat", kind: "list", collection: "films", note: "Video testimonials — poster + mp4. Plays in the On camera carousel on Home and Success stories." },
			{ id: "events", name: "Events", route: "/events", kind: "list", collection: "events" },
			{ id: "blog", name: "Blog", route: "/blog", kind: "list", collection: "posts" },
			{ id: "faqs", name: "FAQs", route: "/faqs", kind: "list", collection: "faqs" },
		],
	},
	{
		label: "Shared collections",
		pages: [
			{ id: "testimonials", name: "Testimonials", route: "feeds Home + About", kind: "list", collection: "testimonials" },
			{ id: "team", name: "Team", route: "feeds About", kind: "list", collection: "team" },
			{ id: "branches", name: "Branches", route: "feeds Contact strip", kind: "list", collection: "branches" },
		],
	},
];

const PAGE_INDEX = new Map(SITE_GROUPS.flatMap((g) => g.pages.map((p) => [p.id, p])));

/** Worst-case status for the map dot: none < draft < review < published. */
function groupStatus(def: SitePageDef, entries: CmsEntry[]): "none" | "draft" | "review" | "published" {
	const rows = def.kind === "list"
		? entries.filter((e) => e.collection === def.collection)
		: entries.filter((e) => e.collection === "pages" && e.slug === def.slug);
	if (rows.length === 0) return def.kind === "catalogue" ? "none" : "none";
	if (rows.some((e) => e.status === "draft")) return "draft";
	if (rows.some((e) => e.status === "review")) return "review";
	return "published";
}

const DOT: Record<string, CSSProperties> = {
	published: { background: "var(--success,#2e6b34)" },
	review: { background: "var(--accent,#b97a10)" },
	draft: { background: "var(--muted,#6e6a60)" },
	none: { background: "transparent", border: "1px solid var(--danger,#a33b2e)" },
};

function StatusDot({ s }: { s: keyof typeof DOT }) {
	return <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", ...DOT[s] }} />;
}

function StatusPill({ s }: { s: string }) {
	return <span className={STATUS_STYLE[s] ?? "cms-status"}>{s === "none" ? "no entry" : s}</span>;
}

function SrcBadge({ kind }: { kind: SitePageDef["kind"] }) {
	const map = {
		page: ["CMS", "var(--success,#2e6b34)"],
		list: ["CMS", "var(--success,#2e6b34)"],
		catalogue: ["catalogue", "var(--info,#31577a)"],
	} as const;
	const [txt, col] = map[kind];
	return <span style={{ fontFamily: "ui-monospace,monospace", fontSize: "0.55rem", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0.1rem 0.35rem", border: `1px solid ${col}`, color: col }}>{txt}</span>;
}

/* ── Site-styled hero preview ────────────────────────────────────────────── */

function HeroPreview({ payload }: { payload: Record<string, unknown> }) {
	const slides = Array.isArray(payload.heroSlides) ? (payload.heroSlides as Record<string, unknown>[]) : null;
	const [slide, setSlide] = useState(0);
	const hero = slides?.[Math.min(slide, slides.length - 1)] ?? ((payload.hero ?? payload) as Record<string, unknown>);
	const image = (hero.image as string | undefined) ?? payloadImage(payload);
	const headline = (hero.headline ?? hero.title ?? payload.title) as string | undefined;
	const em = (hero.titleEm ?? hero.emphasis) as string | undefined;
	const sub = (hero.sub ?? hero.subheadline ?? hero.standfirst ?? hero.lead ?? payload.lead ?? payload.description) as string | undefined;
	const cta = (hero.cta ?? hero.ctaLabel) as string | undefined;
	const meta = Array.isArray(hero.meta) ? (hero.meta as { label?: string; value?: string }[]) : [];
	const kicker = (hero.kicker ?? hero.eyebrow ?? payload.eyebrow) as string | undefined;
	const src = mediaSrc(image ?? null);
	if (!headline && !src) return null;
	return (
		<div style={{ borderBottom: "1px solid var(--border,#d8d5cd)" }}>
			<div style={{ margin: "0.5rem 0.9rem 0", position: "relative", minHeight: 150, display: "flex", alignItems: "flex-end", overflow: "hidden", border: "1px solid var(--border,#d8d5cd)", background: "var(--ink,#17161a)" }}>
				{src ? <img src={src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.45 }} /> : null}
				<div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(20,19,26,0.55), rgba(20,19,26,0.85))" }} />
				<div style={{ position: "relative", padding: "1.1rem 1.3rem", color: "#f2efe6" }}>
					{kicker ? <p style={{ fontFamily: "ui-monospace,monospace", fontSize: "0.55rem", letterSpacing: "0.22em", textTransform: "uppercase", color: "#d8b470", margin: 0 }}>{kicker}</p> : null}
					{headline ? (
						<h3 style={{ fontSize: "1.35rem", margin: "0.35rem 0 0.25rem", maxWidth: "24ch", lineHeight: 1.15, fontFamily: "var(--font-display,Georgia,serif)", fontWeight: 500 }}>
							{headline}{em ? <> <em style={{ fontStyle: "normal", color: "#d8b470", borderBottom: "2px solid #d8b470" }}>{em}</em></> : null}
						</h3>
					) : null}
					{sub ? <p style={{ fontSize: "0.72rem", color: "#cfc9bb", maxWidth: "44ch", margin: 0, lineHeight: 1.5 }}>{sub}</p> : null}
					{meta.length ? (
						<div style={{ display: "flex", gap: "0.45rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
							{meta.map((m, i) => (
								<span key={i} style={{ border: "1px solid rgba(255,255,255,0.25)", padding: "0.28rem 0.5rem", fontFamily: "ui-monospace,monospace", fontSize: "0.5rem", letterSpacing: "0.08em", color: "#e5e0d2" }}>
									{m.label}<b style={{ display: "block", fontSize: "0.62rem", color: "#fff" }}>{m.value}</b>
								</span>
							))}
						</div>
					) : null}
					{cta ? <span style={{ display: "inline-block", marginTop: "0.6rem", background: "var(--accent,#b97a10)", color: "#fff", fontFamily: "ui-monospace,monospace", fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", padding: "0.45rem 0.9rem" }}>{cta} →</span> : null}
				</div>
			</div>
			{slides && slides.length > 1 ? (
				<div style={{ display: "flex", justifyContent: "center", gap: "0.35rem", padding: "0.45rem 0 0.2rem" }}>
					{slides.map((_, i) => (
						<button key={i} type="button" onClick={() => setSlide(i)} style={{ width: 18, height: 3, border: "none", padding: 0, cursor: "pointer", background: i === slide ? "var(--accent,#b97a10)" : "var(--border,#d8d5cd)" }} aria-label={`slide ${i + 1}`} />
					))}
				</div>
			) : null}
			<p className="muted" style={{ fontSize: "0.62rem", padding: "0.25rem 0.9rem 0.6rem", margin: 0 }}>
				{slides ? `Slide ${Math.min(slide, slides.length - 1) + 1} of ${slides.length} — ` : ""}unsaved edits preview as they will render
			</p>
		</div>
	);
}

/* ── Field renderer — primitives as inputs, objects one level deep, rest JSON ─ */

const IMG_KEY = /image|photo|cover|poster|thumb/i;

function PayloadFields({ payload, onChange }: { payload: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
	const set = (k: string, v: unknown) => onChange({ ...payload, [k]: v });
	return (
		<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
			{Object.entries(payload).map(([k, v]) => {
				const wide = typeof v === "string" && (v.length > 80 || v.includes("\n"));
				if (typeof v === "string" && (v.startsWith("media/") || IMG_KEY.test(k))) {
					const src = mediaSrc(v);
					return (
						<div key={k} style={{ gridColumn: "1 / -1" }}>
							<label style={label}>{k}</label>
							<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
								{v.startsWith("media/") && src ? <img src={src} alt="" style={{ width: 64, height: 44, objectFit: "cover", border: "1px solid var(--border,#d8d5cd)", flex: "none" }} /> : null}
								<div style={{ flex: 1 }}>
									<input style={{ ...field, fontFamily: "ui-monospace,monospace", fontSize: "0.72rem" }} value={v} onChange={(e) => set(k, e.target.value)} placeholder="media/…" />
									<span className="mono" style={{ fontSize: "0.62rem", color: "var(--info,#31577a)" }}>▸ key from the Media tab</span>
								</div>
							</div>
						</div>
					);
				}
				if (typeof v === "string") {
					return (
						<div key={k} style={wide ? { gridColumn: "1 / -1" } : undefined}>
							<label style={label}>{k}</label>
							{wide
								? <textarea style={{ ...field, minHeight: 60 }} value={v} onChange={(e) => set(k, e.target.value)} />
								: <input style={field} value={v} onChange={(e) => set(k, e.target.value)} />}
						</div>
					);
				}
				if (typeof v === "number" || typeof v === "boolean") {
					return (
						<div key={k}>
							<label style={label}>{k}</label>
							<input style={field} value={String(v)} onChange={(e) => set(k, typeof v === "number" ? Number(e.target.value) : e.target.value === "true")} />
						</div>
					);
				}
				return (
					<div key={k} style={{ gridColumn: "1 / -1" }}>
						<label style={label}>{k} · structured</label>
						<textarea
							style={{ ...field, fontFamily: "ui-monospace,monospace", fontSize: "0.72rem", minHeight: 80 }}
							defaultValue={JSON.stringify(v, null, 2)}
							onBlur={(e) => { try { set(k, JSON.parse(e.target.value)); } catch { /* keep editing */ } }}
						/>
					</div>
				);
			})}
		</div>
	);
}

/* ── Content schemas — what each page/collection actually edits ────────────
 *
 * The CMS manages century-nit-web's real content, so the editor renders the
 * same fields the site consumes instead of a raw JSON dump. Keys absent from
 * a schema are preserved untouched in the payload (still editable in JSON
 * mode). Keep these in sync with the payload shapes in packages/core and the
 * consumers in century-nit-web (usePageCopy / useContentEntries).
 */

type FieldSpec = {
	key: string;
	label: string;
	kind: "text" | "textarea" | "media" | "video" | "list" | "select" | "pairs" | "objects";
	rows?: number;
	options?: string[];
	hint?: string;
	itemFields?: FieldSpec[];
	newItem?: Record<string, unknown>;
};

const PAGE_HEADER_FIELDS: FieldSpec[] = [
	{ key: "eyebrow", label: "Eyebrow", kind: "text", hint: "Small kicker above the title" },
	{ key: "title", label: "Title", kind: "text" },
	{ key: "lead", label: "Lead paragraph", kind: "textarea", rows: 3 },
];

const SLIDE_FIELDS: FieldSpec[] = [
	{ key: "kicker", label: "Kicker", kind: "text", hint: "e.g. United Kingdom" },
	{ key: "title", label: "Title", kind: "text" },
	{ key: "titleEm", label: "Title — emphasised word(s)", kind: "text", hint: "Rendered in the accent style" },
	{ key: "lead", label: "Lead paragraph", kind: "textarea", rows: 3 },
	{ key: "image", label: "Image", kind: "media" },
	{ key: "imageAlt", label: "Image alt text", kind: "text" },
	{ key: "meta", label: "Meta chips", kind: "pairs", hint: "One per line — Label | Value, e.g. Service | Study visa" },
];

const PAGE_SCHEMAS: Record<string, FieldSpec[]> = {
	home: [
		{
			key: "heroSlides",
			label: "Hero slides",
			kind: "objects",
			itemFields: SLIDE_FIELDS,
			newItem: {
				id: "new", kicker: "", title: "", titleEm: "", lead: "",
				image: "", imageAlt: "", meta: [],
			},
		},
		{ key: "servicesEyebrow", label: "Services section — eyebrow", kind: "text" },
		{ key: "servicesTitle", label: "Services section — title", kind: "text" },
		{ key: "destinationsEyebrow", label: "Destinations section — eyebrow", kind: "text" },
		{ key: "destinationsTitle", label: "Destinations section — title", kind: "text" },
	],
};

const COLLECTION_SCHEMAS: Record<string, FieldSpec[]> = {
	posts: [
		{ key: "title", label: "Headline", kind: "text" },
		{ key: "category", label: "Category", kind: "text" },
		{ key: "readTime", label: "Read time", kind: "text", hint: "e.g. 8 min" },
		{ key: "image", label: "Cover image", kind: "media" },
		{ key: "excerpt", label: "Excerpt", kind: "textarea", rows: 3, hint: "Shown on the card and as the article lead-in" },
		{ key: "body", label: "Body", kind: "textarea", rows: 10, hint: "Paragraphs separated by a blank line" },
	],
	faqs: [
		{ key: "question", label: "Question", kind: "text" },
		{ key: "answer", label: "Answer", kind: "textarea", rows: 4 },
	],
	services: [
		{ key: "title", label: "Service name", kind: "text" },
		{ key: "description", label: "Card description", kind: "textarea", rows: 3 },
		{ key: "duration", label: "Typical duration", kind: "text", hint: "e.g. 4–8 weeks" },
		{ key: "image", label: "Image", kind: "media" },
		{ key: "detail", label: "Detail page — intro", kind: "textarea", rows: 5 },
		{ key: "deliverables", label: "What you get", kind: "list", hint: "One item per line" },
		{ key: "process", label: "How it works", kind: "list", hint: "One step per line" },
	],
	stories: [
		{ key: "quote", label: "Quote", kind: "textarea", rows: 4 },
		{ key: "name", label: "Name", kind: "text" },
		{ key: "program", label: "Programme", kind: "text" },
		{ key: "country", label: "Route", kind: "text", hint: "e.g. Ghana → Canada" },
		{ key: "image", label: "Portrait", kind: "media" },
	],
	events: [
		{ key: "title", label: "Event name", kind: "text" },
		{ key: "date", label: "Date", kind: "text", hint: "e.g. 14 Aug 2026 or Rolling" },
		{ key: "time", label: "Time / venue", kind: "text" },
		{ key: "type", label: "Type", kind: "select", options: ["In-person", "Online", "News"] },
		{ key: "description", label: "Description", kind: "textarea", rows: 3 },
	],
	films: [
		{ key: "name", label: "Name", kind: "text" },
		{ key: "program", label: "Programme", kind: "text" },
		{ key: "country", label: "Route", kind: "text", hint: "e.g. Ghana → United Kingdom" },
		{ key: "headline", label: "Headline", kind: "textarea", rows: 2 },
		{ key: "length", label: "Length", kind: "text", hint: "e.g. 2:14" },
		{ key: "poster", label: "Poster image", kind: "media" },
		{ key: "videoUrl", label: "Video file", kind: "video", hint: "mp4 upload — plays in the On camera carousel" },
	],
};

function schemaFor(collection: string, slug: string): FieldSpec[] | null {
	if (collection === "pages") return PAGE_SCHEMAS[slug] ?? PAGE_HEADER_FIELDS;
	return COLLECTION_SCHEMAS[collection] ?? null;
}

/* ── Schema-driven field renderer ────────────────────────────────────────── */

function pairsFromText(text: string): { label: string; value: string }[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => {
			const i = l.indexOf("|");
			return i < 0
				? { label: l, value: "" }
				: { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
		});
}

function pairsToText(list: unknown): string {
	if (!Array.isArray(list)) return "";
	return list
		.map((m) => {
			const o = m as Record<string, unknown>;
			return `${o.label ?? ""} | ${o.value ?? ""}`.trim();
		})
		.join("\n");
}

function listToText(list: unknown): string {
	return Array.isArray(list) ? list.map(String).join("\n") : "";
}

function OneField({
	spec,
	value,
	onChange,
	onBrowse,
}: {
	spec: FieldSpec;
	value: unknown;
	onChange: (v: unknown) => void;
	onBrowse?: (apply: (key: string) => void, prefer?: "image" | "video") => void;
}) {
	switch (spec.kind) {
		case "textarea":
			return <textarea style={{ ...field, minHeight: (spec.rows ?? 3) * 20 }} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
		case "media":
		case "video": {
			const s = typeof value === "string" ? value : "";
			const src = mediaSrc(s);
			const isVideo = spec.kind === "video";
			return (
				<div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
					<div style={{ width: 96, height: 64, border: "1px solid var(--border,#d8d5cd)", background: "var(--ink-2,#26242b)", flex: "none", position: "relative", overflow: "hidden" }}>
						{src ? (
							isVideo ? (
								<video src={src} preload="metadata" muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
							) : (
								<img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
							)
						) : (
							<span className="mono" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--faint,#a09a8b)", fontSize: "0.55rem" }}>{isVideo ? "video" : "image"}</span>
						)}
						{isVideo && src ? <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,.6)" }}>▶</span> : null}
					</div>
					<div style={{ flex: 1 }}>
						<input style={{ ...field, fontFamily: "ui-monospace,monospace", fontSize: "0.68rem" }} value={s} onChange={(e) => onChange(e.target.value)} placeholder={isVideo ? "media/… (mp4) or https://…" : "media/… or https://…"} />
						<div style={{ display: "flex", gap: "0.4rem", marginTop: "0.35rem" }}>
							{onBrowse ? <button type="button" style={btnSm(false)} onClick={() => onBrowse((key) => onChange(key), isVideo ? "video" : "image")}>Library</button> : null}
							{onBrowse ? <button type="button" style={btnSm(false)} onClick={() => onBrowse((key) => onChange(key), isVideo ? "video" : "image")}>Upload</button> : null}
							{s ? <button type="button" style={{ ...btnSm(false), color: "var(--danger,#a33b2e)" }} onClick={() => onChange("")}>Remove</button> : null}
						</div>
					</div>
				</div>
			);
		}
		case "list":
			return (
				<textarea
					style={{ ...field, minHeight: (spec.rows ?? 4) * 20, fontFamily: "ui-monospace,monospace", fontSize: "0.75rem" }}
					value={listToText(value)}
					onChange={(e) => onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean))}
				/>
			);
		case "select":
			return (
				<select style={field} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
					{!spec.options?.includes(String(value)) && value ? <option value={String(value)}>{String(value)}</option> : null}
					{spec.options?.map((o) => <option key={o} value={o}>{o}</option>)}
				</select>
			);
		case "pairs":
			return (
				<textarea
					style={{ ...field, minHeight: (spec.rows ?? 3) * 20, fontFamily: "ui-monospace,monospace", fontSize: "0.75rem" }}
					defaultValue={pairsToText(value)}
					onBlur={(e) => onChange(pairsFromText(e.target.value))}
				/>
			);
		case "objects": {
			const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
			const move = (i: number, dir: -1 | 1) => {
				const next = [...items];
				const j = i + dir;
				if (j < 0 || j >= next.length) return;
				[next[i], next[j]] = [next[j], next[i]];
				onChange(next);
			};
			return (
				<div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
					{items.map((item, i) => (
						<div key={i} style={{ border: "1px solid var(--border,#d8d5cd)", padding: "0.6rem", background: "var(--surface,#fff)" }}>
							<div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
								<span className="mono" style={{ fontSize: "0.65rem", color: "var(--muted,#6e6a60)" }}>
									#{i + 1} — {String(item.kicker ?? item.title ?? item.question ?? item.id ?? "item")}
								</span>
								<span style={{ flex: 1 }} />
								<button type="button" style={btnSm(false)} onClick={() => move(i, -1)}>↑</button>
								<button type="button" style={btnSm(false)} onClick={() => move(i, 1)}>↓</button>
								<button type="button" style={btnSm(false)} onClick={() => onChange(items.filter((_, j) => j !== i))}>remove</button>
							</div>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
								{spec.itemFields?.map((f) => (
									<div key={f.key} style={f.kind === "textarea" || f.kind === "media" || f.kind === "video" || f.kind === "list" || f.kind === "pairs" ? { gridColumn: "1 / -1" } : undefined}>
										<label style={label}>{f.label}</label>
										<OneField spec={f} value={item[f.key]} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)))} onBrowse={onBrowse} />
										{f.hint ? <p className="muted" style={{ fontSize: "0.65rem", margin: "0.2rem 0 0" }}>{f.hint}</p> : null}
									</div>
								))}
							</div>
						</div>
					))}
					<button type="button" style={btn(false)} onClick={() => onChange([...items, { ...(spec.newItem ?? {}) }])}>
						+ Add {spec.label.replace(/s$/, "").toLowerCase()}
					</button>
				</div>
			);
		}
		default:
			return <input style={field} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
	}
}

function SchemaFields({
	schema,
	payload,
	onChange,
	onBrowse,
}: {
	schema: FieldSpec[];
	payload: Record<string, unknown>;
	onChange: (p: Record<string, unknown>) => void;
	onBrowse?: (apply: (key: string) => void, prefer?: "image" | "video") => void;
}) {
	const set = (k: string, v: unknown) => onChange({ ...payload, [k]: v });
	const extra = Object.keys(payload).filter((k) => !schema.some((f) => f.key === k));
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
			{schema.map((f) => (
				<div key={f.key}>
					<label style={label}>{f.label}</label>
					<OneField spec={f} value={payload[f.key]} onChange={(v) => set(f.key, v)} onBrowse={onBrowse} />
					{f.hint ? <p className="muted" style={{ fontSize: "0.65rem", margin: "0.2rem 0 0" }}>{f.hint}</p> : null}
				</div>
			))}
			{extra.length ? (
				<p className="mono" style={{ fontSize: "0.62rem", color: "var(--muted,#6e6a60)", margin: 0 }}>
					{extra.length} other key{extra.length === 1 ? "" : "s"} kept as-is ({extra.join(", ")}) — switch to JSON to edit them.
				</p>
			) : null}
		</div>
	);
}

/* ── Entry editor — shared by page + list kinds ──────────────────────────── */

function EntryEditor({ entry, onSaved, onClose, inline }: { entry: CmsEntry; onSaved: () => void; onClose?: () => void; inline?: boolean }) {
	const [editing, setEditing] = useState(entry);
	const [json, setJson] = useState("{}");
	const [seo, setSeo] = useState<Record<string, unknown>>({});
	const [structured, setStructured] = useState(true);
	const [history, setHistory] = useState<{ id: string; version: number; note: string | null; editorEmail: string | null; createdAt: string }[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<string | null>(null);
	const [picker, setPicker] = useState<{ apply: (key: string) => void; prefer?: "image" | "video" } | null>(null);

	useEffect(() => {
		setJson(JSON.stringify(entry.payload, null, 2));
		setSeo({ ...(entry.seo ?? {}) } as Record<string, unknown>);
		if (entry.id) {
			void apiFetch<{ versions: typeof history }>(`${API_PREFIX}/cms/entries/${entry.collection}/${entry.slug}/history`)
				.then((h) => setHistory(h.versions)).catch(() => {});
		}
	}, [entry]);

	async function save(payloadOverride?: Record<string, unknown>) {
		setError(null);
		let payload: Record<string, unknown>;
		if (payloadOverride) {
			payload = payloadOverride;
		} else {
			try { payload = JSON.parse(json); }
			catch { setError("Payload is not valid JSON"); return; }
		}
		await apiFetch(`${API_PREFIX}/cms/entries`, {
			method: "POST",
			body: JSON.stringify({ id: editing.id || undefined, collection: editing.collection, slug: editing.slug, payload, seo, scheduledAt: editing.scheduledAt }),
		});
		setFlash("Saved"); setTimeout(() => setFlash(null), 2500);
		onSaved();
	}

	async function setStatus(status: string) {
		if (!editing.id) return;
		await apiFetch(`${API_PREFIX}/cms/entries/${editing.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
		setEditing({ ...editing, status: status as CmsEntry["status"] });
		onSaved();
	}

	async function revertTo(versionId: string) {
		if (!editing.id) return;
		await apiFetch(`${API_PREFIX}/cms/entries/${editing.id}/revert`, { method: "POST", body: JSON.stringify({ versionId }) });
		onSaved(); onClose?.();
	}

	const payloadObj = useMemo(() => {
		if (!structured) return null;
		try { return JSON.parse(json) as Record<string, unknown>; } catch { return null; }
	}, [json, structured]);

	const schema = schemaFor(editing.collection, editing.slug);
	const seoDesc = typeof seo.description === "string" ? seo.description : "";
	const openPicker = (apply: (key: string) => void, prefer?: "image" | "video") => setPicker({ apply, prefer });
	const setSeoKey = (k: string, v: unknown) => setSeo((s) => ({ ...s, [k]: v }));

	return (
		<div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 380px", alignItems: "start" }}>
			{/* ── left: content + seo fields ── */}
			<div style={{ padding: "0.9rem", minWidth: 0 }}>
				<div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
					<div><label style={label}>Collection</label><input style={field} value={editing.collection} disabled /></div>
					<div style={{ flex: 1 }}><label style={label}>Slug</label><input style={{ ...field, fontFamily: "ui-monospace,monospace" }} value={editing.slug} disabled={Boolean(editing.id)} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="home-hero" /></div>
					<button style={btnSm(false)} onClick={() => setStructured(!structured)}>{structured ? "JSON" : "Fields"}</button>
				</div>
				{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{error}</p> : null}
				{flash ? <p className="mono" style={{ color: "var(--success,#2e6b34)", fontSize: "0.72rem" }}>{flash}</p> : null}

				<label style={label}>Content</label>
				{structured && payloadObj ? (
					schema ? (
						<SchemaFields schema={schema} payload={payloadObj} onChange={(p) => setJson(JSON.stringify(p, null, 2))} onBrowse={openPicker} />
					) : (
						<PayloadFields payload={payloadObj} onChange={(p) => setJson(JSON.stringify(p, null, 2))} />
					)
				) : (
					<textarea style={{ ...field, fontFamily: "ui-monospace,monospace", minHeight: 200 }} value={json} onChange={(e) => setJson(e.target.value)} />
				)}

				<div className="mono" style={{ fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted,#6e6a60)", margin: "1.1rem 0 0.5rem", borderBottom: "1px solid var(--border,#eae7de)", paddingBottom: "0.3rem" }}>SEO</div>
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
					<div style={{ gridColumn: "1 / -1" }}>
						<label style={label}>Meta title</label>
						<input style={field} value={typeof seo.title === "string" ? seo.title : ""} onChange={(e) => setSeoKey("title", e.target.value)} />
					</div>
					<div>
						<label style={label}>Canonical path</label>
						<input style={{ ...field, fontFamily: "ui-monospace,monospace", fontSize: "0.72rem" }} value={typeof seo.canonical === "string" ? seo.canonical : ""} onChange={(e) => setSeoKey("canonical", e.target.value)} placeholder="/about" />
					</div>
					<div>
						<label style={label}>Indexing</label>
						<select style={field} value={seo.noindex === true ? "noindex" : "index"} onChange={(e) => setSeoKey("noindex", e.target.value === "noindex")}>
							<option value="index">Index (searchable)</option>
							<option value="noindex">Noindex (hidden from search)</option>
						</select>
					</div>
					<div style={{ gridColumn: "1 / -1" }}>
						<label style={label}>Meta description</label>
						<textarea style={{ ...field, minHeight: 52 }} value={seoDesc} onChange={(e) => setSeoKey("description", e.target.value)} />
						<p className="mono" style={{ fontSize: "0.6rem", color: seoDesc.length > 155 ? "var(--warn,#8a5a13)" : "var(--faint,#a09a8b)", margin: "0.2rem 0 0" }}>{seoDesc.length} / 155 characters</p>
					</div>
					<div style={{ gridColumn: "1 / -1" }}>
						<label style={label}>Share image (og:image)</label>
						<OneField spec={{ key: "ogImage", label: "", kind: "media" }} value={seo.ogImage} onChange={(v) => setSeoKey("ogImage", v)} onBrowse={openPicker} />
					</div>
				</div>
			</div>

			{/* ── right: draft preview + publishing rail ── */}
			<div style={{ borderLeft: "1px solid var(--border,#eae7de)", display: "flex", flexDirection: "column" }}>
				<div className="mono" style={{ fontSize: "0.55rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted,#6e6a60)", padding: "0.5rem 0.9rem 0" }}>Draft preview</div>
				<HeroPreview payload={(payloadObj ?? editing.payload) as Record<string, unknown>} />
				<div style={{ padding: "0.4rem 0.9rem 0.9rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
					<div>
						<div className="mono" style={{ fontSize: "0.55rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted,#6e6a60)", marginBottom: "0.35rem" }}>Publishing</div>
						<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem" }}>
							<StatusPill s={editing.id ? editing.status : "none"} />
							<span className="muted" style={{ fontSize: "0.7rem" }}>{editing.publishedAt ? `live since ${new Date(editing.publishedAt).toLocaleDateString()}` : "not published yet"}</span>
						</div>
					</div>
					<div>
						<label style={label}>Publish at</label>
						<input
							type="datetime-local"
							style={{ ...field, width: "auto" }}
							value={editing.scheduledAt ? toLocalInput(editing.scheduledAt) : ""}
							onChange={(e) => setEditing({ ...editing, scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
						/>
						{editing.scheduledAt ? (
							<p className="muted" style={{ fontSize: "0.68rem", margin: "0.3rem 0 0" }}>
								{editing.status === "review"
									? `Goes live ${new Date(editing.scheduledAt).toLocaleString()} — the sweep publishes review entries once the time passes.`
									: `Scheduled — send it to review and it publishes itself at that time.`}
								{" "}<button style={btnSm(false)} onClick={() => setEditing({ ...editing, scheduledAt: null })}>clear</button>
							</p>
						) : null}
					</div>
					{history.length > 0 ? (
						<div>
							<div className="mono" style={{ fontSize: "0.55rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted,#6e6a60)", marginBottom: "0.35rem" }}>History</div>
							<ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "0.72rem", maxHeight: 150, overflowY: "auto" }}>
								{history.slice(0, 8).map((v) => (
									<li key={v.id} className="mono" style={{ padding: "0.28rem 0", borderBottom: "1px solid var(--border,#eee)", display: "flex", gap: "0.5rem", alignItems: "center" }}>
										<span style={{ fontSize: "0.62rem" }}>v{v.version}</span>
										<span className="muted" style={{ fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.note ?? "saved"} · {v.editorEmail ?? "—"}</span>
										<span style={{ flex: 1 }} />
										<button style={btnSm(false)} onClick={() => revertTo(v.id)}>revert</button>
									</li>
								))}
							</ul>
						</div>
					) : null}
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", borderTop: "1px solid var(--border,#eae7de)", paddingTop: "0.7rem" }}>
						<button style={btn(true)} onClick={() => save()}>Save</button>
						{editing.id && editing.status === "draft" ? <button style={btn(false)} onClick={() => setStatus("review")}>Send to review</button> : null}
						{editing.id && editing.status !== "published" ? <button style={btn(false)} onClick={() => setStatus("published")}>Publish</button> : null}
						{editing.id && editing.status === "published" ? <button style={btn(false)} onClick={() => setStatus("draft")}>Unpublish</button> : null}
						{!inline && onClose ? <button style={btn(false)} onClick={onClose}>Close</button> : null}
					</div>
				</div>
			</div>
			<MediaPicker open={Boolean(picker)} prefer={picker?.prefer} onPick={(key) => picker?.apply(key)} onClose={() => setPicker(null)} />
		</div>
	);
}

/* ── Site pages tab ──────────────────────────────────────────────────────── */

function SitePagesTab({ entries, reload }: { entries: CmsEntry[]; reload: () => void }) {
	const [selected, setSelected] = useState("home");
	const [filter, setFilter] = useState("");
	const [editing, setEditing] = useState<CmsEntry | null>(null);

	const def = PAGE_INDEX.get(selected)!;
	const pageEntry = def.slug ? entries.find((e) => e.collection === "pages" && e.slug === def.slug) : undefined;
	const collectionRows = def.collection ? entries.filter((e) => e.collection === def.collection) : [];

	function newEntry(collection: string, slug = "") {
		setEditing({
			id: "", collection, slug, status: "draft", payload: { title: "" }, seo: null,
			scheduledAt: null, publishedAt: null, publishedBy: null, updatedAt: "", updatedBy: null,
		});
	}

	const q = filter.trim().toLowerCase();
	const match = (p: SitePageDef) => !q || (p.name + " " + p.route).toLowerCase().includes(q);
	const [seeding, setSeeding] = useState<string | null>(null);

	async function seed() {
		setSeeding("…");
		try {
			const res = await apiFetch<{ created: number; skipped: number }>(`${API_PREFIX}/cms/seed`, { method: "POST" });
			setSeeding(res.created > 0 ? `+${res.created}` : `${res.skipped} exist`);
			reload();
		} catch (e) {
			setSeeding(e instanceof Error ? e.message : "seed failed");
		} finally {
			setTimeout(() => setSeeding(null), 4000);
		}
	}

	return (
		<div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1rem", alignItems: "start" }}>
			{/* site map */}
			<div className="card" style={{ padding: 0, overflow: "hidden" }}>
				<div style={{ padding: "0.55rem 0.8rem", borderBottom: "1px solid var(--border,#d8d5cd)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
					<span className="mono" style={{ fontSize: "0.62rem", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>Site map</span>
					<button
						style={btnSm(false)}
						disabled={seeding === "…"}
						title="Create published entries for every page still using compiled copy — never overwrites an existing entry"
						onClick={() => void seed()}
					>
						{seeding ?? "Seed missing pages"}
					</button>
					<input style={{ ...field, width: "auto", flex: 1, padding: "0.25rem 0.45rem", fontSize: "0.72rem", fontFamily: "ui-monospace,monospace" }} placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
				</div>
				{SITE_GROUPS.map((g) => {
					const rows = g.pages.filter(match);
					if (!rows.length) return null;
					return (
						<div key={g.label} style={{ borderBottom: "1px solid var(--border,#eae7de)" }}>
							<div className="mono" style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted,#6e6a60)", padding: "0.5rem 0.8rem 0.2rem" }}>{g.label}</div>
							{rows.map((p) => {
								const st = groupStatus(p, entries);
								const thumb = p.kind === "list"
									? payloadImage((collectionThumb(entries, p.collection!)) ?? {})
									: payloadImage((pageEntryThumb(entries, p.slug)) ?? {});
								const thumbSrc = mediaSrc(thumb);
								return (
									<button key={p.id} onClick={() => { setSelected(p.id); setEditing(null); }}
										style={{ display: "flex", alignItems: "center", gap: "0.55rem", width: "100%", textAlign: "left", padding: "0.4rem 0.8rem", border: "none", background: selected === p.id ? "var(--accent-soft,#f3e8d2)" : "none", borderLeft: selected === p.id ? "3px solid var(--accent,#b97a10)" : "3px solid transparent", cursor: "pointer", fontSize: "0.8rem", color: "inherit", fontWeight: selected === p.id ? 700 : 400 }}>
										{thumbSrc ? <img src={thumbSrc} alt="" style={{ width: 30, height: 22, objectFit: "cover", border: "1px solid var(--border,#d8d5cd)", flex: "none" }} /> : <StatusDot s={st} />}
										{p.name}
										<span className="mono" style={{ marginLeft: "auto", fontSize: "0.55rem", color: selected === p.id ? "var(--accent,#b97a10)" : "var(--muted,#6e6a60)" }}>{p.route}</span>
									</button>
								);
							})}
						</div>
					);
				})}
			</div>

			{/* editor pane */}
			<div className="card" style={{ padding: 0, overflow: "hidden", minHeight: 420 }}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.6rem 0.9rem", borderBottom: "1px solid var(--border,#d8d5cd)", flexWrap: "wrap" }}>
					<h2 style={{ margin: 0, fontSize: "0.95rem" }}>{def.name}</h2>
					<span className="mono" style={{ fontSize: "0.62rem", color: "var(--muted,#6e6a60)" }}>{def.route}</span>
					<span style={{ flex: 1 }} />
					<SrcBadge kind={def.kind} />
					<StatusPill s={groupStatus(def, entries)} />
					{def.route.startsWith("/") ? <a href={def.route} target="_blank" rel="noreferrer" style={{ ...btnSm(false), textDecoration: "none" }}>open live page ↗</a> : null}
					{def.kind === "list" ? <button style={btnSm(true)} onClick={() => newEntry(def.collection!)}>+ New</button> : null}
				</div>

				{editing ? (
					<EntryEditor entry={editing} onSaved={reload} onClose={() => setEditing(null)} />
				) : def.kind === "list" ? (
					<div>
						{collectionRows.map((e) => {
							const img = mediaSrc(payloadImage(e.payload as Record<string, unknown>));
							return (
								<button key={e.id} onClick={() => setEditing(e)} style={{ display: "flex", gap: "0.7rem", alignItems: "center", width: "100%", textAlign: "left", padding: "0.45rem 0.9rem", border: "none", borderBottom: "1px solid var(--border,#eae7de)", background: "none", cursor: "pointer", fontSize: "0.82rem", color: "inherit" }}>
									{img ? <img src={img} alt="" style={{ width: 46, height: 32, objectFit: "cover", border: "1px solid var(--border,#d8d5cd)", flex: "none" }} /> : <StatusDot s={e.status} />}
									<span style={{ flex: 1 }}>
										{entryTitle(e)}
										<small className="mono" style={{ display: "block", color: "var(--muted,#6e6a60)", fontSize: "0.62rem" }}>{e.slug}</small>
									</span>
									{e.scheduledAt && e.status !== "published" ? (
										<span className="mono" style={{ fontSize: "0.6rem", color: "var(--accent,#b97a10)" }} title={`Publishes ${new Date(e.scheduledAt).toLocaleString()}`}>→ {new Date(e.scheduledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
									) : null}
									<StatusPill s={e.status} />
								</button>
							);
						})}
						{collectionRows.length === 0 ? (
							<div style={{ padding: "2.5rem 1rem", textAlign: "center" }}>
								<p className="muted" style={{ fontSize: "0.82rem" }}>No <code>{def.collection}</code> entries yet — the live page falls back to its compiled content.</p>
								<button style={{ ...btn(true), marginTop: "0.6rem" }} onClick={() => newEntry(def.collection!)}>Create the first entry</button>
							</div>
						) : null}
					</div>
				) : (
					<div>
						{def.note ? (
							<div className="mono" style={{ fontSize: "0.62rem", color: "var(--info,#31577a)", background: "var(--info-soft,#e8eef4)", borderBottom: "1px dashed var(--info,#31577a)", padding: "0.55rem 0.9rem", lineHeight: 1.6 }}>{def.note}</div>
						) : null}
						{pageEntry ? (
							<EntryEditor entry={pageEntry} onSaved={reload} inline />
						) : (
							<div style={{ padding: "2.5rem 1rem", textAlign: "center" }}>
								<p className="muted" style={{ fontSize: "0.82rem" }}>
									No <code>pages/{def.slug}</code> entry yet — the live page uses its compiled copy.
								</p>
								<button style={{ ...btn(true), marginTop: "0.6rem" }} onClick={() => newEntry("pages", def.slug!)}>Create the entry</button>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/* helpers for map thumbnails — first entry that carries an image */
function collectionThumb(entries: CmsEntry[], collection: string) {
	for (const e of entries) if (e.collection === collection) { const p = payloadImage(e.payload as Record<string, unknown>); if (p) return e.payload as Record<string, unknown>; }
	return null;
}
function pageEntryThumb(entries: CmsEntry[], slug?: string) {
	if (!slug) return null;
	const e = entries.find((x) => x.collection === "pages" && x.slug === slug);
	return e ? (e.payload as Record<string, unknown>) : null;
}

/* ── Brand tab ───────────────────────────────────────────────────────────── */

function BrandTab() {
	const [draft, setDraft] = useState<Brand>(DEFAULT_BRAND);
	const [published, setPublished] = useState<Brand>(DEFAULT_BRAND);
	const [version, setVersion] = useState(0);
	const [history, setHistory] = useState<{ id: string; version: number; note: string | null; editorEmail: string | null; createdAt: string }[]>([]);
	const [dirty, setDirty] = useState(false);
	const [flash, setFlash] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await apiFetch<{ draft: Brand; published: Brand; version: number }>(`${API_PREFIX}/cms/brand`);
		setDraft(res.draft); setPublished(res.published); setVersion(res.version); setDirty(false);
		const h = await apiFetch<{ versions: typeof history }>(`${API_PREFIX}/cms/brand/history`);
		setHistory(h.versions);
	}, []);
	useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

	function set<K extends keyof Brand>(key: K, value: Brand[K]) {
		setDraft((d) => ({ ...d, [key]: value })); setDirty(true);
	}
	function setName(k: keyof Brand["names"], v: string) { set("names", { ...draft.names, [k]: v }); }
	function setContact(k: keyof Brand["contacts"], v: string) { set("contacts", { ...draft.contacts, [k]: v }); }
	function setColor(k: keyof Brand["colors"], v: string) { set("colors", { ...draft.colors, [k]: v }); }
	function setFont(k: keyof Brand["fonts"], v: string) { set("fonts", { ...draft.fonts, [k]: v }); }
	function setLogo(k: keyof Brand["logos"], v: string) { set("logos", { ...draft.logos, [k]: v || null }); }

	async function saveDraft() {
		setError(null);
		await apiFetch(`${API_PREFIX}/cms/brand`, { method: "PUT", body: JSON.stringify(draft) });
		setDirty(false); setFlash("Draft saved"); setTimeout(() => setFlash(null), 2500);
	}
	async function publish() {
		setError(null);
		const res = await apiFetch<{ brand: Brand }>(`${API_PREFIX}/cms/brand/publish`, { method: "POST" });
		setPublished(res.brand); setVersion((v) => v + 1); setDirty(false);
		setFlash(`Published — live on every surface as v${version + 1}`); setTimeout(() => setFlash(null), 3500);
		void load();
	}
	async function revertDraft() {
		await apiFetch(`${API_PREFIX}/cms/brand/revert`, { method: "POST" });
		void load(); setFlash("Draft reset to the published record"); setTimeout(() => setFlash(null), 2500);
	}

	const dirtyDiff = JSON.stringify(draft) !== JSON.stringify(published);

	return (
		<div>
			{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{error}</p> : null}
			<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1.25rem" }}>
				<button style={btn(false)} onClick={saveDraft} disabled={!dirty}>Save draft</button>
				<button style={btn(true)} onClick={publish} disabled={!dirtyDiff}>Publish</button>
				<button style={btn(false)} onClick={revertDraft}>Revert to published</button>
				{flash ? <span className="mono" style={{ fontSize: "0.72rem", color: "var(--success,#2e6b34)" }}>{flash}</span> : null}
				<span style={{ flex: 1 }} />
				<span className="mono muted" style={{ fontSize: "0.7rem" }}>live v{version}{dirty ? " · unsaved changes" : dirtyDiff ? " · draft differs" : ""}</span>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
				<div className="card" style={{ padding: "1.25rem" }}>
					<h3 style={{ margin: "0 0 1rem", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Identity</h3>
					{(["brand", "legal", "short", "console", "tagline"] as const).map((k) => (
						<div key={k} style={{ marginBottom: "0.75rem" }}>
							<label style={label}>{k === "brand" ? "Brand name" : k === "legal" ? "Legal name" : k === "short" ? "Short name (badges, email header)" : k === "console" ? "Console chrome" : "Tagline"}</label>
							<input style={field} value={draft.names[k]} onChange={(e) => setName(k, e.target.value)} />
						</div>
					))}
					<div style={{ marginBottom: "0.75rem" }}>
						<label style={label}>Primary domain</label>
						<input style={field} value={draft.domain} onChange={(e) => set("domain", e.target.value)} />
					</div>
				</div>

				<div className="card" style={{ padding: "1.25rem" }}>
					<h3 style={{ margin: "0 0 1rem", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Contacts</h3>
					{(["info", "support", "admissions", "finance", "phoneAccra", "phoneKumasi", "address", "hours"] as const).map((k) => (
						<div key={k} style={{ marginBottom: "0.6rem" }}>
							<label style={label}>{k.replace(/([A-Z])/g, " $1")}</label>
							<input style={field} value={draft.contacts[k]} onChange={(e) => setContact(k, e.target.value)} />
						</div>
					))}
				</div>

				<div className="card" style={{ padding: "1.25rem" }}>
					<h3 style={{ margin: "0 0 1rem", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Colours</h3>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
						{(Object.keys(draft.colors) as (keyof Brand["colors"])[]).map((k) => {
							const ratio = contrastRatio(draft.colors[k]);
							return (
								<div key={k}>
									<label style={label}>{k}{ratio !== null && ratio < 4.5 ? ` · ${ratio.toFixed(1)}:1 ✕` : ratio !== null ? ` · ${ratio.toFixed(1)}:1` : ""}</label>
									<div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
										<input type="color" value={/^#[0-9a-f]{6}$/i.test(draft.colors[k]) ? draft.colors[k] : "#000000"} onChange={(e) => setColor(k, e.target.value)} style={{ width: 34, height: 34, padding: 0, border: "1px solid var(--border,#d8d5cd)" }} />
										<input style={{ ...field, fontFamily: "ui-monospace,monospace" }} value={draft.colors[k]} onChange={(e) => setColor(k, e.target.value)} />
									</div>
								</div>
							);
						})}
					</div>
					<h3 style={{ margin: "1.25rem 0 0.75rem", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Fonts</h3>
					{(["display", "body", "mono"] as const).map((k) => (
						<div key={k} style={{ marginBottom: "0.6rem" }}>
							<label style={label}>{k} font</label>
							<input style={field} value={draft.fonts[k]} onChange={(e) => setFont(k, e.target.value)} placeholder="Georgia, serif" />
						</div>
					))}
				</div>

				<div className="card" style={{ padding: "1.25rem" }}>
					<h3 style={{ margin: "0 0 1rem", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Logos — media keys</h3>
					<p className="muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>Upload in the Media tab, then paste the key. Empty falls back to the text wordmark.</p>
					{(["primary", "inverse", "mark", "favicon", "email", "appIcon"] as const).map((k) => (
						<div key={k} style={{ marginBottom: "0.6rem" }}>
							<label style={label}>{k}</label>
							<input style={{ ...field, fontFamily: "ui-monospace,monospace" }} value={draft.logos[k] ?? ""} onChange={(e) => setLogo(k, e.target.value)} placeholder="media/…" />
						</div>
					))}
				</div>

				<div className="card" style={{ padding: "1.25rem" }}>
					<h3 style={{ margin: "0 0 1rem", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Preview</h3>
					<div style={{ border: `4px solid ${draft.colors.ink}`, background: draft.colors.surface, padding: "1rem" }}>
						<div style={{ background: draft.colors.primary, color: draft.colors.surface, padding: "0.8rem 1rem", fontFamily: draft.fonts.display }}>
							<span className="mono" style={{ fontSize: "0.6rem", border: `1px solid ${draft.colors.surface}`, padding: "2px 6px", letterSpacing: "0.15em" }}>{draft.names.short.toUpperCase()}</span>
							<div style={{ fontWeight: 700, marginTop: "0.4rem" }}>Email header · {draft.names.brand}</div>
						</div>
						<button style={{ marginTop: "0.8rem", background: draft.colors.accent, color: draft.colors.surface, border: "none", padding: "0.55rem 1.1rem", fontSize: "0.8rem" }}>Accent button</button>
						<p style={{ color: draft.colors.muted, fontSize: "0.8rem", fontFamily: draft.fonts.body }}>{draft.names.tagline}</p>
					</div>
					<h3 style={{ margin: "1.25rem 0 0.5rem", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>History</h3>
					{history.length === 0 ? <p className="muted" style={{ fontSize: "0.8rem" }}>No versions yet.</p> : (
						<ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "0.78rem" }}>
							{history.slice(0, 8).map((v) => (
								<li key={v.id} className="mono" style={{ padding: "0.35rem 0", borderBottom: "1px solid var(--border,#eee)", color: "var(--muted,#6e6a60)" }}>
									v{v.version} · {v.note ?? "saved"} · {v.editorEmail ?? "—"} · {new Date(v.createdAt).toLocaleString()}
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}

/* ── Media tab — grid + "used on" reverse index ──────────────────────────── */

function MediaTab({ usage }: { usage: Map<string, string[]> }) {
	const [items, setItems] = useState<MediaItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [filter, setFilter] = useState("");

	const load = useCallback(async () => {
		const res = await apiFetch<{ media: MediaItem[] }>(`${API_PREFIX}/cms/media`);
		setItems(res.media);
	}, []);
	useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

	async function upload(file: File) {
		setBusy(true); setError(null);
		try {
			await uploadMediaFile(file);
			void load();
		} catch (e) { setError(e instanceof Error ? e.message : "upload failed"); }
		finally { setBusy(false); }
	}

	async function patch(id: string, body: { alt?: string; focalX?: number; focalY?: number }) {
		await apiFetch(`${API_PREFIX}/cms/media/${id}`, { method: "PATCH", body: JSON.stringify(body) });
		void load();
	}

	const q = filter.trim().toLowerCase();
	const shown = q ? items.filter((m) => (m.key + " " + m.alt + " " + m.fileName).toLowerCase().includes(q)) : items;

	return (
		<div>
			<div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
				<label style={{ ...btn(true), display: "inline-block" }}>
					{busy ? "Uploading…" : "Upload media"}
					<input type="file" accept="image/*,video/*,.pdf" style={{ display: "none" }} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
				</label>
				<input style={{ ...field, width: 220 }} placeholder="filter by key or alt…" value={filter} onChange={(e) => setFilter(e.target.value)} />
				<span className="mono muted" style={{ fontSize: "0.7rem", marginLeft: "auto" }}>public URL: {API_PREFIX}/media/{"{key}"}</span>
			</div>
			{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{error}</p> : null}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "0.75rem" }}>
				{shown.map((m) => {
					const used = usage.get(m.key);
					return (
						<div key={m.id} className="card" style={{ padding: "0.75rem" }}>
							<div style={{ height: 110, background: "var(--surface-alt,#eee)", marginBottom: "0.5rem", overflow: "hidden", position: "relative" }}>
								{mediaKind(m) === "video" ? (
									<video src={`${API_PREFIX}/media/${m.key}`} preload="metadata" muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
								) : mediaKind(m) === "image" ? (
									<img src={`${API_PREFIX}/media/${m.key}`} alt={m.alt} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${m.focalX}% ${m.focalY}%` }} />
								) : (
									<div className="mono" style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: "0.6rem", color: "var(--muted,#6e6a60)" }}>{m.mime.split("/")[1]?.toUpperCase() ?? "FILE"}</div>
								)}
								{used?.length ? (
									<span className="mono" title={used.join("\n")} style={{ position: "absolute", top: "0.35rem", right: "0.35rem", fontSize: "0.55rem", letterSpacing: "0.05em", background: "rgba(23,22,26,0.82)", color: "#fff", padding: "0.1rem 0.35rem" }}>
										used on {used.length}
									</span>
								) : null}
							</div>
							<p className="mono" style={{ fontSize: "0.68rem", margin: "0 0 0.3rem", wordBreak: "break-all" }}>{m.key}</p>
							<input style={{ ...field, fontSize: "0.75rem" }} defaultValue={m.alt} placeholder="alt text" onBlur={(e) => { if (e.target.value !== m.alt) void patch(m.id, { alt: e.target.value }); }} />
							<p className="muted" style={{ fontSize: "0.68rem", margin: "0.3rem 0 0" }}>
								{m.fileName} · {m.sizeBytes ? `${Math.round(m.sizeBytes / 1024)} KB` : "—"}
								{used?.length ? <span className="mono" style={{ color: "var(--info,#31577a)" }}> · {used.slice(0, 2).join(", ")}{used.length > 2 ? ` +${used.length - 2}` : ""}</span> : null}
							</p>
						</div>
					);
				})}
			</div>
			{shown.length === 0 ? <p className="muted" style={{ textAlign: "center", padding: "2rem" }}>No media yet — uploads land under the <code>media/</code> prefix and serve at <code>/media/{"{key}"}</code>.</p> : null}
		</div>
	);
}

/* ── Navigation tab — live previews + grouped footer ─────────────────────── */

function NavPreview({ items }: { items: NavItem[] }) {
	const top = items.filter((i) => i.kind === "top");
	const secondary = items.filter((i) => i.kind === "secondary");
	return (
		<div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "0.9rem" }}>
			<div className="mono" style={{ fontSize: "0.55rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted,#6e6a60)", padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--border,#eae7de)", background: "var(--surface-alt,#fbfaf7)" }}>
				Header — live preview
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: "1.1rem", padding: "0.65rem 1rem", flexWrap: "wrap" }}>
				<span className="mono" style={{ fontSize: "0.6rem", letterSpacing: "0.16em", border: "1px solid var(--ink,#17161a)", padding: "0.25rem 0.5rem" }}>CENTURY NIT</span>
				{top.map((l) => (
					<span key={l.href + l.label} style={{ fontSize: "0.78rem", opacity: l.visible === false ? 0.35 : 1, textDecoration: l.visible === false ? "line-through" : "none" }}>{l.label}</span>
				))}
				{secondary.length ? <span className="mono" style={{ fontSize: "0.55rem", color: "var(--muted,#6e6a60)" }}>+{secondary.length} more in mobile sheet</span> : null}
				<span className="mono" style={{ marginLeft: "auto", background: "var(--ink,#17161a)", color: "#fff", fontSize: "0.58rem", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0.4rem 0.8rem" }}>Portal sign-in</span>
			</div>
		</div>
	);
}

function NavTab() {
	const [surface, setSurface] = useState<"header" | "footer">("header");
	const [items, setItems] = useState<NavItem[]>([]);
	const [flash, setFlash] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await apiFetch<{ items: NavItem[] }>(`${API_PREFIX}/cms/nav/${surface}`);
		setItems(res.items);
	}, [surface]);
	useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

	function patchItem(i: number, p: Partial<NavItem>) {
		setItems((list) => list.map((it, ix) => (ix === i ? { ...it, ...p } : it)));
	}
	function patchChild(i: number, ci: number, p: Partial<{ label: string; href: string }>) {
		setItems((list) => list.map((it, ix) => {
			if (ix !== i) return it;
			const children = (it.children ?? []).map((ch, cx) => (cx === ci ? { ...ch, ...p } : ch));
			return { ...it, children };
		}));
	}
	function move(i: number, dir: -1 | 1) {
		setItems((list) => {
			const next = [...list];
			const j = i + dir;
			if (j < 0 || j >= next.length) return list;
			[next[i], next[j]] = [next[j], next[i]];
			return next;
		});
	}

	async function save() {
		setError(null);
		await apiFetch(`${API_PREFIX}/cms/nav/${surface}`, { method: "PUT", body: JSON.stringify({ items }) });
		setFlash(true); setTimeout(() => setFlash(false), 2500);
	}

	const isFooter = surface === "footer";
	const footerCols = items.filter((i) => i.children?.length);
	const footerFlat = items.filter((i) => !i.children?.length);

	return (
		<div>
			<div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
				{(["header", "footer"] as const).map((s) => (
					<button key={s} style={btn(surface === s)} onClick={() => setSurface(s)}>{s}</button>
				))}
				<span style={{ flex: 1 }} />
				{flash ? <span className="mono" style={{ fontSize: "0.72rem", color: "var(--success,#2e6b34)" }}>saved</span> : null}
				<button style={btn(true)} onClick={save}>Save order</button>
				<button style={btn(false)} onClick={() => setItems([...items, isFooter ? { label: "New column", href: "", kind: "footer-col", visible: true, children: [] } : { label: "New link", href: "/", kind: "secondary", visible: true }])}>+ Add {isFooter ? "column" : "link"}</button>
			</div>
			{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{error}</p> : null}

			{!isFooter ? <NavPreview items={items} /> : null}

			{isFooter && footerCols.length ? (
				<div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(footerCols.length, 4)}, 1fr)`, gap: 0, border: "1px solid var(--border,#d8d5cd)", marginBottom: "0.9rem" }}>
					{footerCols.map((col) => {
						const i = items.indexOf(col);
						return (
							<div key={i} style={{ borderRight: "1px solid var(--border,#eae7de)" }}>
								<div style={{ background: "var(--surface-alt,#fbfaf7)", borderBottom: "1px solid var(--border,#d8d5cd)", padding: "0.45rem 0.7rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
									<input style={{ ...field, border: "1px solid transparent", background: "none", fontSize: "0.68rem", fontFamily: "ui-monospace,monospace", letterSpacing: "0.12em", textTransform: "uppercase", padding: "0.15rem 0.25rem" }} value={col.label} onChange={(e) => patchItem(i, { label: e.target.value })} />
									<button style={{ ...btnSm(false), padding: "0 0.35rem" }} onClick={() => setItems(items.filter((_, ix) => ix !== i))}>✕</button>
								</div>
								{(col.children ?? []).map((ch, ci) => (
									<div key={ci} style={{ display: "flex", gap: "0.4rem", alignItems: "center", padding: "0.35rem 0.7rem", borderBottom: "1px solid var(--border,#eae7de)", fontSize: "0.75rem" }}>
										<input style={{ ...field, border: "1px solid transparent", background: "none", fontSize: "0.75rem", padding: "0.15rem 0.25rem" }} value={ch.label} onChange={(e) => patchChild(i, ci, { label: e.target.value })} />
										<input style={{ ...field, border: "1px solid transparent", background: "none", fontSize: "0.68rem", fontFamily: "ui-monospace,monospace", padding: "0.15rem 0.25rem", color: "var(--muted,#6e6a60)" }} value={ch.href} onChange={(e) => patchChild(i, ci, { href: e.target.value })} />
										<button style={{ ...btnSm(false), padding: "0 0.3rem", fontSize: "0.6rem" }} onClick={() => patchItem(i, { children: (col.children ?? []).filter((_, cx) => cx !== ci) })}>✕</button>
									</div>
								))}
								<div style={{ padding: "0.35rem 0.7rem" }}>
									<button style={{ ...btnSm(false), fontSize: "0.58rem" }} onClick={() => patchItem(i, { children: [...(col.children ?? []), { label: "New link", href: "/" }] })}>+ link</button>
								</div>
							</div>
						);
					})}
				</div>
			) : null}

			<div className="card" style={{ padding: "0.5rem" }}>
				{(isFooter ? footerFlat : items).map((it) => {
					const i = items.indexOf(it);
					if (it.children?.length) return null;
					return (
						<div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.45rem", borderBottom: "1px solid var(--border,#eee)", opacity: it.visible === false ? 0.45 : 1 }}>
							<span style={{ display: "flex", flexDirection: "column" }}>
								<button style={{ ...btn(false), padding: "0 0.4rem", fontSize: "0.6rem" }} onClick={() => move(i, -1)}>▲</button>
								<button style={{ ...btn(false), padding: "0 0.4rem", fontSize: "0.6rem" }} onClick={() => move(i, 1)}>▼</button>
							</span>
							<input style={{ ...field, width: 180 }} value={it.label} onChange={(e) => patchItem(i, { label: e.target.value })} />
							<input style={{ ...field, flex: 1, fontFamily: "ui-monospace,monospace" }} value={it.href} onChange={(e) => patchItem(i, { href: e.target.value })} />
							<select style={{ ...field, width: 130 }} value={it.kind} onChange={(e) => patchItem(i, { kind: e.target.value })}>
								<option value="top">top</option>
								<option value="secondary">secondary</option>
								<option value="footer-link">footer-link</option>
								<option value="footer-col">footer-col</option>
							</select>
							<label style={{ fontSize: "0.7rem", display: "flex", gap: "0.3rem", alignItems: "center" }}>
								<input type="checkbox" checked={it.visible !== false} onChange={(e) => patchItem(i, { visible: e.target.checked })} /> visible
							</label>
							<button style={{ ...btn(false), padding: "0.2rem 0.5rem", fontSize: "0.65rem" }} onClick={() => setItems(items.filter((_, ix) => ix !== i))}>✕</button>
						</div>
					);
				})}
				{(isFooter ? footerFlat : items).filter((it) => !it.children?.length).length === 0 ? <p className="muted" style={{ padding: "1.5rem", textAlign: "center", margin: 0 }}>No links — the site falls back to its compiled nav.</p> : null}
			</div>
		</div>
	);
}

/* ── Copy tab ────────────────────────────────────────────────────────────── */

function CopyTab() {
	const [surface, setSurface] = useState<string>("");
	const [rows, setRows] = useState<CopyKey[]>([]);
	const [newKey, setNewKey] = useState("");
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await apiFetch<{ copy: CopyKey[] }>(`${API_PREFIX}/cms/copy${surface ? `?surface=${surface}` : ""}`);
		setRows(res.copy);
	}, [surface]);
	useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

	async function save(key: string, value: string, surf: string) {
		await apiFetch(`${API_PREFIX}/cms/copy`, { method: "PUT", body: JSON.stringify({ key, value, surface: surf, status: "published" }) });
	}

	return (
		<div>
			<div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap" }}>
				{["", "site", "portal", "console", "email"].map((s) => (
					<button key={s || "all"} style={btn(surface === s)} onClick={() => setSurface(s)}>{s || "all"}</button>
				))}
			</div>
			{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{error}</p> : null}
			<div className="card" style={{ padding: "0.5rem" }}>
				{rows.map((r) => (
					<div key={r.key} style={{ padding: "0.6rem", borderBottom: "1px solid var(--border,#eee)" }}>
						<div style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
							<span className="mono" style={{ fontSize: "0.75rem" }}>{r.key}</span>
							<span className="mono muted" style={{ fontSize: "0.65rem" }}>{r.surface}</span>
						</div>
						<textarea
							style={{ ...field, marginTop: "0.35rem", minHeight: 44, fontSize: "0.8rem" }}
							defaultValue={r.value}
							onBlur={(e) => { if (e.target.value !== r.value) void save(r.key, e.target.value, r.surface); }}
						/>
					</div>
				))}
				{rows.length === 0 ? <p className="muted" style={{ padding: "1.5rem", textAlign: "center", margin: 0 }}>No copy keys yet — add the first one below.</p> : null}
				<div style={{ display: "flex", gap: "0.5rem", padding: "0.6rem" }}>
					<input style={{ ...field, fontFamily: "ui-monospace,monospace" }} placeholder="portal.welcome" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
					<button style={btn(false)} onClick={async () => { if (!newKey.trim()) return; await save(newKey.trim(), "", surface || "site"); setNewKey(""); void load(); }}>Add key</button>
				</div>
			</div>
		</div>
	);
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function CmsManager() {
	const [tab, setTab] = useState<Tab>("site");
	const { entries, error: entriesError, reload } = useCmsEntries();
	const mediaUsage = useMediaUsage(entries);
	const tabs = useMemo<{ id: Tab; label: ReactNode }[]>(() => [
		{ id: "site", label: <>Site pages <span style={{ color: "var(--accent,#b97a10)" }}>{SITE_GROUPS.flatMap((g) => g.pages).length}</span></> },
		{ id: "brand", label: "Brand" },
		{ id: "media", label: "Media" },
		{ id: "nav", label: "Navigation" },
		{ id: "copy", label: "Copy" },
	], []);

	return (
		<div className="page-content fade-in">
			{/* No page header here — EnterpriseAdministration renders the section
			    title/blurb above this component; a second one doubled it. */}
			<div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.5rem", borderBottom: "2px solid var(--ink,#17161a)", paddingBottom: "0.75rem", flexWrap: "wrap" }}>
				{tabs.map((t) => (
					<button key={t.id} style={btn(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>
				))}
			</div>
			{tab === "site" && entriesError ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{entriesError}</p> : null}
			{tab === "site" ? <SitePagesTab entries={entries} reload={reload} />
				: tab === "brand" ? <BrandTab />
				: tab === "media" ? <MediaTab usage={mediaUsage} />
				: tab === "nav" ? <NavTab />
				: <CopyTab />}
		</div>
	);
}
