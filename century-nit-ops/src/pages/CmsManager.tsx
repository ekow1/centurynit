import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { API_PREFIX, DEFAULT_BRAND, type Brand, type CmsEntry, type MediaItem, type NavItem, type CopyKey } from "century-nit-shared";
import { apiFetch } from "../lib/api";

/**
 * Content Management — one identity + one content store + one media library.
 *
 * Brand is the flagship tab: the singleton record every surface reads.
 * Entries covers pages/blog/faqs/testimonials/events/stories/services/team/
 * branches as generic draft→review→published records. Media is the library
 * (signed upload → public /media/{key} redirect). Navigation edits the header
 * and footer link lists. Copy is the keyed string table the site, portal,
 * console and emails read.
 */

type Tab = "brand" | "entries" | "media" | "nav" | "copy";

const COLLECTIONS = [
	{ id: "pages", label: "Pages" },
	{ id: "posts", label: "Blog posts" },
	{ id: "faqs", label: "FAQs" },
	{ id: "testimonials", label: "Testimonials" },
	{ id: "events", label: "Events" },
	{ id: "stories", label: "Success stories" },
	{ id: "services", label: "Services" },
	{ id: "team", label: "Team" },
	{ id: "branches", label: "Branches" },
];

const STATUS_STYLE: Record<string, string> = {
	draft: "cms-status cms-status--draft",
	review: "cms-status cms-status--review",
	published: "cms-status cms-status--published",
};

const field: CSSProperties = { width: "100%", padding: "0.45rem 0.6rem", border: "1px solid var(--border,#d8d5cd)", background: "var(--surface,#fff)", color: "inherit", fontSize: "0.85rem" };
const label: CSSProperties = { display: "block", fontSize: "0.68rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted,#6e6a60)", marginBottom: "0.25rem", fontFamily: "ui-monospace,monospace" };
const btn = (primary = false): CSSProperties => ({
	padding: "0.45rem 1rem", border: "1px solid var(--ink,#17161a)", fontSize: "0.78rem", cursor: "pointer",
	background: primary ? "var(--ink,#17161a)" : "transparent",
	color: primary ? "var(--surface,#fff)" : "inherit",
	fontFamily: "ui-monospace,monospace", letterSpacing: "0.04em", textTransform: "uppercase",
});

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

/* ── Entries tab ─────────────────────────────────────────────────────────── */

function EntriesTab() {
	const [collection, setCollection] = useState("pages");
	const [entries, setEntries] = useState<CmsEntry[]>([]);
	const [editing, setEditing] = useState<CmsEntry | null>(null);
	const [json, setJson] = useState("{}");
	const [seoJson, setSeoJson] = useState("{}");
	const [history, setHistory] = useState<{ id: string; version: number; note: string | null; editorEmail: string | null; createdAt: string }[]>([]);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await apiFetch<{ entries: CmsEntry[] }>(`${API_PREFIX}/cms/entries?collection=${collection}`);
		setEntries(res.entries);
	}, [collection]);
	useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

	async function openEditor(entry: CmsEntry) {
		setEditing(entry);
		setJson(JSON.stringify(entry.payload, null, 2));
		setSeoJson(JSON.stringify(entry.seo ?? {}, null, 2));
		const h = await apiFetch<{ versions: typeof history }>(`${API_PREFIX}/cms/entries/${entry.collection}/${entry.slug}/history`);
		setHistory(h.versions);
	}

	function newEntry() {
		setEditing({
			id: "", collection, slug: "", status: "draft", payload: { title: "" }, seo: null,
			scheduledAt: null, publishedAt: null, publishedBy: null, updatedAt: "", updatedBy: null,
		});
		setJson('{\n  "title": ""\n}'); setSeoJson("{}"); setHistory([]);
	}

	async function save() {
		if (!editing) return;
		setError(null);
		let payload: Record<string, unknown>; let seo: Record<string, unknown>;
		try { payload = JSON.parse(json); seo = JSON.parse(seoJson || "{}"); }
		catch { setError("Payload or SEO is not valid JSON"); return; }
		await apiFetch(`${API_PREFIX}/cms/entries`, {
			method: "POST",
			body: JSON.stringify({ id: editing.id || undefined, collection: editing.collection, slug: editing.slug, payload, seo }),
		});
		setEditing(null); void load();
	}

	async function setStatus(id: string, status: string) {
		await apiFetch(`${API_PREFIX}/cms/entries/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
		void load();
	}

	async function revertTo(versionId: string) {
		if (!editing?.id) return;
		await apiFetch(`${API_PREFIX}/cms/entries/${editing.id}/revert`, { method: "POST", body: JSON.stringify({ versionId }) });
		setEditing(null); void load();
	}

	return (
		<div>
			<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				{COLLECTIONS.map((col) => (
					<button key={col.id} style={{ ...btn(collection === col.id), border: "1px solid var(--ink,#17161a)" }} onClick={() => { setCollection(col.id); setEditing(null); }}>
						{col.label}
					</button>
				))}
				<span style={{ flex: 1 }} />
				<button style={btn(true)} onClick={newEntry}>+ New entry</button>
			</div>
			{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{error}</p> : null}

			{editing ? (
				<div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
					<div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
						<div><label style={label}>Collection</label><input style={field} value={editing.collection} disabled /></div>
						<div style={{ flex: 1 }}><label style={label}>Slug</label><input style={{ ...field, fontFamily: "ui-monospace,monospace" }} value={editing.slug} disabled={Boolean(editing.id)} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="home-hero" /></div>
					</div>
					<label style={label}>Payload (JSON)</label>
					<textarea style={{ ...field, fontFamily: "ui-monospace,monospace", minHeight: 200 }} value={json} onChange={(e) => setJson(e.target.value)} />
					<label style={{ ...label, marginTop: "0.75rem" }}>SEO (JSON — title, description, ogImage, canonical, noindex)</label>
					<textarea style={{ ...field, fontFamily: "ui-monospace,monospace", minHeight: 90 }} value={seoJson} onChange={(e) => setSeoJson(e.target.value)} />
					{history.length > 0 ? (
						<div style={{ marginTop: "0.75rem" }}>
							<label style={label}>Version history</label>
							<ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "0.75rem" }}>
								{history.slice(0, 6).map((v) => (
									<li key={v.id} className="mono" style={{ padding: "0.3rem 0", borderBottom: "1px solid var(--border,#eee)", display: "flex", gap: "0.75rem" }}>
										<span>v{v.version} · {v.note ?? "saved"} · {v.editorEmail ?? "—"}</span>
										<span style={{ flex: 1 }} />
										<button style={{ ...btn(false), padding: "0.1rem 0.5rem", fontSize: "0.65rem" }} onClick={() => revertTo(v.id)}>revert</button>
									</li>
								))}
							</ul>
						</div>
					) : null}
					<div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
						<button style={btn(true)} onClick={save}>Save</button>
						<button style={btn(false)} onClick={() => setEditing(null)}>Cancel</button>
					</div>
				</div>
			) : null}

			<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
				<thead>
					<tr style={{ textAlign: "left", borderBottom: "2px solid var(--ink,#17161a)" }}>
						<th style={{ padding: "0.5rem" }}>Slug</th><th>Status</th><th>Updated</th><th>By</th><th></th>
					</tr>
				</thead>
				<tbody>
					{entries.map((e) => (
						<tr key={e.id} style={{ borderBottom: "1px solid var(--border,#eee)", cursor: "pointer" }} onClick={() => openEditor(e)}>
							<td className="mono" style={{ padding: "0.55rem" }}>{e.slug}</td>
							<td><span className={STATUS_STYLE[e.status] ?? "cms-status"}>{e.status}</span></td>
							<td className="muted">{e.updatedAt ? new Date(e.updatedAt).toLocaleDateString() : "—"}</td>
							<td className="muted">{e.updatedBy ?? "—"}</td>
							<td onClick={(ev) => ev.stopPropagation()}>
								{e.status !== "published"
									? <button style={{ ...btn(false), padding: "0.2rem 0.6rem", fontSize: "0.65rem" }} onClick={() => setStatus(e.id, "published")}>publish</button>
									: <button style={{ ...btn(false), padding: "0.2rem 0.6rem", fontSize: "0.65rem" }} onClick={() => setStatus(e.id, "draft")}>unpublish</button>}
							</td>
						</tr>
					))}
					{entries.length === 0 ? <tr><td colSpan={5} className="muted" style={{ padding: "2rem", textAlign: "center" }}>No {collection} entries yet — create the first one.</td></tr> : null}
				</tbody>
			</table>
		</div>
	);
}

/* ── Media tab ───────────────────────────────────────────────────────────── */

function MediaTab() {
	const [items, setItems] = useState<MediaItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		const res = await apiFetch<{ media: MediaItem[] }>(`${API_PREFIX}/cms/media`);
		setItems(res.media);
	}, []);
	useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

	async function upload(file: File) {
		setBusy(true); setError(null);
		try {
			const up = await apiFetch<{ key: string; url: string; headers: Record<string, string> }>(`${API_PREFIX}/cms/media/upload-url`, {
				method: "POST", body: JSON.stringify({ fileName: file.name, mime: file.type || "application/octet-stream" }),
			});
			const put = await fetch(up.url, { method: "PUT", headers: { "Content-Type": file.type, ...up.headers }, body: file });
			if (!put.ok) throw new Error(`upload failed (${put.status})`);
			await apiFetch(`${API_PREFIX}/cms/media`, {
				method: "POST",
				body: JSON.stringify({ key: up.key, fileName: file.name, mime: file.type, sizeBytes: file.size, alt: file.name.replace(/\.[^.]+$/, "") }),
			});
			void load();
		} catch (e) { setError(e instanceof Error ? e.message : "upload failed"); }
		finally { setBusy(false); }
	}

	async function patch(id: string, body: { alt?: string; focalX?: number; focalY?: number }) {
		await apiFetch(`${API_PREFIX}/cms/media/${id}`, { method: "PATCH", body: JSON.stringify(body) });
		void load();
	}

	return (
		<div>
			<div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
				<label style={{ ...btn(true), display: "inline-block" }}>
					{busy ? "Uploading…" : "Upload image"}
					<input type="file" accept="image/*" style={{ display: "none" }} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
				</label>
				<span className="mono muted" style={{ fontSize: "0.7rem" }}>public URL: {API_PREFIX}/media/{"{key}"}</span>
			</div>
			{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{error}</p> : null}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "0.75rem" }}>
				{items.map((m) => (
					<div key={m.id} className="card" style={{ padding: "0.75rem" }}>
						<div style={{ height: 110, background: "var(--surface-alt,#eee)", marginBottom: "0.5rem", overflow: "hidden", position: "relative" }}>
							<img src={`${API_PREFIX}/media/${m.key}`} alt={m.alt} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${m.focalX}% ${m.focalY}%` }} />
						</div>
						<p className="mono" style={{ fontSize: "0.68rem", margin: "0 0 0.3rem", wordBreak: "break-all" }}>{m.key}</p>
						<input style={{ ...field, fontSize: "0.75rem" }} defaultValue={m.alt} placeholder="alt text" onBlur={(e) => { if (e.target.value !== m.alt) void patch(m.id, { alt: e.target.value }); }} />
						<p className="muted" style={{ fontSize: "0.68rem", margin: "0.3rem 0 0" }}>{m.fileName} · {m.sizeBytes ? `${Math.round(m.sizeBytes / 1024)} KB` : "—"}</p>
					</div>
				))}
			</div>
			{items.length === 0 ? <p className="muted" style={{ textAlign: "center", padding: "2rem" }}>No media yet — uploads land under the <code>media/</code> prefix and serve at <code>/media/{"{key}"}</code>.</p> : null}
		</div>
	);
}

/* ── Navigation tab ──────────────────────────────────────────────────────── */

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

	return (
		<div>
			<div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
				{(["header", "footer"] as const).map((s) => (
					<button key={s} style={btn(surface === s)} onClick={() => setSurface(s)}>{s}</button>
				))}
				<span style={{ flex: 1 }} />
				{flash ? <span className="mono" style={{ fontSize: "0.72rem", color: "var(--success,#2e6b34)" }}>saved</span> : null}
				<button style={btn(true)} onClick={save}>Save order</button>
				<button style={btn(false)} onClick={() => setItems([...items, { label: "New link", href: "/", kind: surface === "footer" ? "footer-link" : "secondary", visible: true }])}>+ Add link</button>
			</div>
			{error ? <p style={{ color: "var(--danger,#a33b2e)", fontSize: "0.85rem" }}>{error}</p> : null}
			<div className="card" style={{ padding: "0.5rem" }}>
				{items.map((it, i) => (
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
				))}
				{items.length === 0 ? <p className="muted" style={{ padding: "1.5rem", textAlign: "center", margin: 0 }}>No links — the site falls back to its compiled nav.</p> : null}
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
	const [tab, setTab] = useState<Tab>("brand");
	const tabs = useMemo<{ id: Tab; label: string }[]>(() => [
		{ id: "brand", label: "Brand" },
		{ id: "entries", label: "Pages & Collections" },
		{ id: "media", label: "Media" },
		{ id: "nav", label: "Navigation" },
		{ id: "copy", label: "Copy" },
	], []);

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "1.5rem" }}>
				<h1 className="page-title">Content Management</h1>
				<p className="lead mt-2">
					One identity, one content store, one media library — read by the site, the portal, the console and every email.
				</p>
			</div>
			<div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.5rem", borderBottom: "2px solid var(--ink,#17161a)", paddingBottom: "0.75rem" }}>
				{tabs.map((t) => (
					<button key={t.id} style={btn(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>
				))}
			</div>
			{tab === "brand" ? <BrandTab /> : tab === "entries" ? <EntriesTab /> : tab === "media" ? <MediaTab /> : tab === "nav" ? <NavTab /> : <CopyTab />}
		</div>
	);
}
