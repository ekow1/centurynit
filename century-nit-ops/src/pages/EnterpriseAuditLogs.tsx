import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { auditApi, type AlertRules, type AuditEvent } from "century-nit-core/api";
import { ApiError } from "../lib/api";

/**
 * The unified audit feed — one stream over every trail the suite writes
 * (admin events, settings diffs, invoice events, bookings, leads, case
 * comments, consultations, school track). Filters live in the URL so a view
 * can be shared or refreshed intact. Rows open a side pane with the device
 * trail, before/after diffs and related events on the same actor/target.
 * Nothing is synthesized: if the API didn't record it, it doesn't render.
 */

const CATEGORIES = [
	"all",
	"Authentication",
	"Roles & Access",
	"Financials",
	"Configuration",
	"Staff",
	"Clients",
	"Notifications",
	"Data",
	"Case",
	"Booking",
	"System",
] as const;

const PAGE_SIZE = 50;

const SEVERITY_DOT: Record<string, string> = {
	info: "var(--muted-foreground)",
	warn: "#b45309",
	bad: "#b91c1c",
	good: "#166534",
};

const SEVERITY_LABEL: Record<string, string> = {
	info: "routine",
	warn: "attention",
	bad: "critical",
	good: "resolution",
};

const ALERT_RULE_META: { key: keyof AlertRules; label: string; desc: string }[] = [
	{ key: "failedSignins", label: "Failed sign-ins", desc: "5+ failures / 10 min flags the feed" },
	{ key: "roleGrants", label: "Role grants", desc: "Manager/admin grants notify on write" },
	{ key: "newIpSignin", label: "New-location session", desc: "Sign-in from an unseen IP" },
	{ key: "moneyMoves", label: "Refund / void", desc: "Every money reversal, always" },
];

function formatTime(iso: string): string {
	try {
		return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	} catch {
		return iso;
	}
}

function formatStamp(iso: string): string {
	try {
		return new Date(iso).toLocaleString(undefined, {
			year: "numeric", month: "short", day: "numeric",
			hour: "2-digit", minute: "2-digit", second: "2-digit",
		});
	} catch {
		return iso;
	}
}

function dayKey(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
	} catch {
		return iso.slice(0, 10);
	}
}

function shortUserAgent(ua: string | null): string {
	if (!ua) return "—";
	if (/edg/i.test(ua)) return "Edge";
	if (/chrome/i.test(ua)) return "Chrome";
	if (/safari/i.test(ua) && !/chrome/i.test(ua)) return "Safari";
	if (/firefox/i.test(ua)) return "Firefox";
	return ua.slice(0, 48);
}

export function EnterpriseAuditLogs() {
	const [params, setParams] = useSearchParams();
	const category = params.get("category") ?? "all";
	const actorFilter = params.get("actor") ?? "";
	const targetFilter = params.get("target") ?? "";
	const q = params.get("q") ?? "";
	const from = params.get("from") ?? "";
	const to = params.get("to") ?? "";
	const openId = params.get("entry") ?? "";

	const [entries, setEntries] = useState<AuditEvent[]>([]);
	const [total, setTotal] = useState(0);
	const [nextBefore, setNextBefore] = useState<string | null>(null);
	const [facets, setFacets] = useState<Record<string, number>>({});
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [searchText, setSearchText] = useState(q);
	const [rules, setRules] = useState<AlertRules | null>(null);
	const [chain, setChain] = useState<{ checked: number; brokenAt: string | null } | null>(null);
	const [openEntry, setOpenEntry] = useState<AuditEvent | null>(null);
	const [related, setRelated] = useState<AuditEvent[]>([]);
	const [savingRule, setSavingRule] = useState(false);

	// Debounce the free-text box into the URL — every keystroke is a query otherwise.
	useEffect(() => {
		const t = window.setTimeout(() => {
			if (searchText.trim() !== q) {
				setParams((p) => {
					const n = new URLSearchParams(p);
					if (searchText.trim()) n.set("q", searchText.trim()); else n.delete("q");
					n.delete("entry");
					return n;
				}, { replace: true });
			}
		}, 350);
		return () => window.clearTimeout(t);
	}, [searchText, q, setParams]);

	const query = useMemo(
		() => ({
			category: category !== "all" ? category : undefined,
			actor: actorFilter || undefined,
			target: targetFilter || undefined,
			q: q || undefined,
			from: from || undefined,
			to: to || undefined,
			limit: PAGE_SIZE,
		}),
		[category, actorFilter, targetFilter, q, from, to],
	);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await auditApi.events(query);
			setEntries(res.entries);
			setTotal(res.total);
			setNextBefore(res.nextBefore);
			setFacets(res.facets ?? {});
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load audit feed");
		} finally {
			setLoading(false);
		}
	}, [query]);

	useEffect(() => { void load(); }, [load]);

	useEffect(() => {
		auditApi.alertRules().then(setRules).catch(() => setRules(null));
		auditApi.verify().then(setChain).catch(() => setChain(null));
	}, []);

	const loadMore = useCallback(async () => {
		if (!nextBefore) return;
		setLoadingMore(true);
		try {
			const res = await auditApi.events({ ...query, before: nextBefore });
			setEntries((prev) => [...prev, ...res.entries]);
			setTotal(res.total);
			setNextBefore(res.nextBefore);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load more entries");
		} finally {
			setLoadingMore(false);
		}
	}, [nextBefore, query]);

	// The pane follows the URL — /audit?entry=… survives refresh and share.
	useEffect(() => {
		if (!openId) { setOpenEntry(null); setRelated([]); return; }
		const found = entries.find((e) => e.id === openId);
		if (found) {
			setOpenEntry(found);
			auditApi
				.related(found.actorLabel, found.targetLabel, found.id)
				.then((r) => setRelated(r.entries))
				.catch(() => setRelated([]));
		} else if (!loading) {
			setOpenEntry(null);
		}
	}, [openId, entries, loading]);

	function setParam(key: string, value: string) {
		setParams((p) => {
			const n = new URLSearchParams(p);
			if (value) n.set(key, value); else n.delete(key);
			n.delete("entry");
			return n;
		}, { replace: true });
	}

	function openPane(e: AuditEvent) {
		setParams((p) => {
			const n = new URLSearchParams(p);
			n.set("entry", e.id);
			return n;
		}, { replace: true });
	}

	function closePane() {
		setParams((p) => {
			const n = new URLSearchParams(p);
			n.delete("entry");
			return n;
		}, { replace: true });
	}

	async function toggleRule(key: keyof AlertRules) {
		if (!rules || savingRule) return;
		setSavingRule(true);
		try {
			const next = await auditApi.setAlertRules({ [key]: !rules[key] });
			setRules(next);
		} catch {
			/* the strip just stays where it was */
		} finally {
			setSavingRule(false);
		}
	}

	const days = useMemo(() => {
		const groups: { day: string; rows: AuditEvent[] }[] = [];
		for (const e of entries) {
			const d = dayKey(e.at);
			const last = groups[groups.length - 1];
			if (last && last.day === d) last.rows.push(e);
			else groups.push({ day: d, rows: [e] });
		}
		return groups;
	}, [entries]);

	const exportHref = useMemo(() => auditApi.exportUrl(query), [query]);

	return (
		<div className="admin-page">
			{/* Head */}
			<div className="admin-section-head" style={{ marginBottom: "1.25rem" }}>
				<div>
					<h2 className="section-title">Audit feed</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						One stream over every recorded event — access, auth, money, settings, case trails. Filters live in the URL; export covers the query, not just this page.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					<a className="btn btn--ghost btn--sm" href={exportHref} download>
						↓ Export query
					</a>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => void load()} disabled={loading}>
						{loading ? "Refreshing…" : "Refresh"}
					</button>
				</div>
			</div>

			{/* Integrity + alert rules */}
			<div className="card" style={{ padding: "0.75rem 1.25rem", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
				<div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
					<span className="mono muted" style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Watch</span>
					{ALERT_RULE_META.map((r) => (
						<label key={r.key} title={r.desc} style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "var(--text-xs)" }}>
							<input
								type="checkbox"
								checked={rules?.[r.key] ?? false}
								disabled={!rules || savingRule}
								onChange={() => void toggleRule(r.key)}
							/>
							{r.label}
						</label>
					))}
				</div>
				{chain && (
					<span
						className="mono"
						style={{ fontSize: "0.62rem", color: chain.brokenAt ? "#b91c1c" : "var(--muted-foreground)" }}
						title={chain.brokenAt ? `Chain broken at ${chain.brokenAt}` : "Hash chain verified over newest rows"}
					>
						{chain.brokenAt ? `⛓ chain broken · ${chain.checked} checked` : `⛓ integrity ok · ${chain.checked} rows`}
					</span>
				)}
			</div>

			{error && (
				<p className="ops-modal__error" role="alert" style={{ marginBottom: "1.25rem" }}>
					{error}
				</p>
			)}

			{/* Filters */}
			<div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
				<div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
					<input
						type="search"
						placeholder="Search action, target, detail, IP…"
						className="input input--sm input--full-border"
						style={{ minWidth: "14rem", flex: "1 1 14rem" }}
						value={searchText}
						onChange={(e) => setSearchText(e.target.value)}
					/>
					<input
						type="text"
						placeholder="Actor — name or email"
						className="input input--sm input--full-border"
						style={{ width: "12rem" }}
						value={actorFilter}
						onChange={(e) => setParam("actor", e.target.value)}
					/>
					<input
						type="text"
						placeholder="Target — case, invoice, client…"
						className="input input--sm input--full-border"
						style={{ width: "12rem" }}
						value={targetFilter}
						onChange={(e) => setParam("target", e.target.value)}
					/>
					<input type="date" className="input input--sm input--full-border" value={from} onChange={(e) => setParam("from", e.target.value)} aria-label="From date" />
					<span className="muted" style={{ fontSize: "var(--text-xs)" }}>→</span>
					<input type="date" className="input input--sm input--full-border" value={to} onChange={(e) => setParam("to", e.target.value)} aria-label="To date" />
				</div>
				<div className="admin-env-tabs" style={{ marginTop: "0.75rem" }}>
					{CATEGORIES.map((c) => {
						const n = c === "all" ? total : facets[c];
						if (c !== "all" && n == null && category !== c) return null;
						return (
							<button
								key={c}
								type="button"
								onClick={() => setParam("category", c === "all" ? "" : c)}
								className={`admin-env-tab${category === c ? " admin-env-tab--active" : ""}`}
							>
								{c === "all" ? "All" : c}
								{n != null && (
									<span className="mono" style={{ marginLeft: "0.35rem", opacity: 0.65, fontSize: "0.62rem" }}>
										{n}
									</span>
								)}
							</button>
						);
					})}
				</div>
			</div>

			{/* Feed — day-grouped, clickable rows */}
			<div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "1.5rem" }}>
				{loading ? (
					<p className="muted" style={{ padding: "3rem", textAlign: "center" }}>Loading the audit feed…</p>
				) : entries.length === 0 ? (
					<p className="muted" style={{ padding: "3rem", textAlign: "center" }}>No events match this view.</p>
				) : (
					days.map((g) => (
						<div key={g.day}>
							<div style={{
								padding: "0.45rem 1.25rem",
								background: "var(--surface-subtle, #f6f6f6)",
								borderTop: "1px solid var(--border-light)",
								borderBottom: "1px solid var(--border-light)",
								fontFamily: "var(--font-mono)",
								fontSize: "0.62rem",
								textTransform: "uppercase",
								letterSpacing: "0.1em",
								color: "var(--muted-foreground)",
							}}>
								{g.day} · {g.rows.length}
							</div>
							<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
								{g.rows.map((e) => (
									<li key={`${e.source}-${e.id}`}>
										<button
											type="button"
											onClick={() => openPane(e)}
											style={{
												display: "grid",
												gridTemplateColumns: "0.6rem 5.2rem 1fr 14rem 11rem",
												gap: "0.75rem",
												alignItems: "center",
												width: "100%",
												padding: "0.55rem 1.25rem",
												background: openId === e.id ? "var(--surface-subtle, #f0f0f0)" : "transparent",
												border: 0,
												borderBottom: "1px solid var(--border-light)",
												cursor: "pointer",
												textAlign: "left",
												font: "inherit",
											}}
										>
											<span
												title={SEVERITY_LABEL[e.severity] ?? e.severity}
												style={{
													width: "0.45rem",
													height: "0.45rem",
													borderRadius: "50%",
													background: SEVERITY_DOT[e.severity] ?? "var(--muted-foreground)",
													display: "inline-block",
												}}
											/>
											<span className="mono muted" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
												{formatTime(e.at)}
											</span>
											<span style={{ fontSize: "var(--text-sm)", minWidth: 0 }}>
												<span style={{ fontWeight: 500 }}>{e.action}</span>
												{e.detail && (
													<span className="muted" style={{ display: "block", fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
														{e.detail}
													</span>
												)}
											</span>
											<span className="mono" style={{ fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
												{e.actorLabel}
											</span>
											<span className="mono muted" style={{ fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
												{e.targetLabel ?? "—"}
											</span>
										</button>
									</li>
								))}
							</ul>
						</div>
					))
				)}
				{!loading && entries.length > 0 && (
					<div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
							{entries.length} of {total} events
						</span>
						{nextBefore && (
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadMore()} disabled={loadingMore}>
								{loadingMore ? "Loading…" : `Load ${PAGE_SIZE} more`}
							</button>
						)}
					</div>
				)}
			</div>

			{/* Side pane */}
			{openEntry && (
				<div className="ops-modal-backdrop" onClick={closePane} role="dialog" aria-modal="true">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "36rem" }}>
						<header className="ops-modal__head">
							<div>
								<p className="invite-card__eyebrow" style={{ margin: 0 }}>
									{openEntry.category} · {openEntry.source}
								</p>
								<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>{openEntry.action}</h2>
								<p className="ops-modal__sub">{formatStamp(openEntry.at)}</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={closePane}>
								✕ Close
							</button>
						</header>

						<div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
								<div className="field">
									<label>Actor</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
										{openEntry.actorLabel}
										<span className="muted" style={{ display: "block" }}>{openEntry.actorType}</span>
									</div>
								</div>
								<div className="field">
									<label>Target</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
										{openEntry.targetLabel ?? "—"}
										<span className="muted" style={{ display: "block" }}>{openEntry.targetType}</span>
									</div>
								</div>
							</div>

							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
								<div className="field">
									<label>Device</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }} title={openEntry.userAgent ?? undefined}>
										{shortUserAgent(openEntry.userAgent)} · {openEntry.ip ?? "no ip"}
									</div>
								</div>
								<div className="field">
									<label>Severity</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
										<span style={{ color: SEVERITY_DOT[openEntry.severity] }}>●</span> {SEVERITY_LABEL[openEntry.severity] ?? openEntry.severity}
									</div>
								</div>
							</div>

							{(openEntry.oldMasked !== null || openEntry.newMasked !== null) && (
								<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
									<div className="field">
										<label>Before</label>
										<div className="mono muted" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)", wordBreak: "break-all" }}>
											{openEntry.oldMasked ?? "— (unset)"}
										</div>
									</div>
									<div className="field">
										<label>After</label>
										<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)", wordBreak: "break-all", fontWeight: 600 }}>
											{openEntry.newMasked ?? "— (cleared)"}
										</div>
									</div>
								</div>
							)}

							{openEntry.detail && (
								<div className="field">
									<label>Detail</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)", wordBreak: "break-all", maxHeight: "8rem", overflow: "auto" }}>
										{openEntry.detail}
									</div>
								</div>
							)}

							{related.length > 0 && (
								<div className="field">
									<label>Related — same actor or target</label>
									<ul style={{ listStyle: "none", padding: 0, margin: 0, border: "var(--thin)" }}>
										{related.map((r) => (
											<li key={`${r.source}-${r.id}`} style={{ borderBottom: "1px solid var(--border-light)" }}>
												<button
													type="button"
													onClick={() => openPane(r)}
													style={{ display: "flex", gap: "0.6rem", width: "100%", padding: "0.45rem 0.6rem", background: "none", border: 0, cursor: "pointer", textAlign: "left", font: "inherit", fontSize: "var(--text-xs)" }}
												>
													<span className="mono muted" style={{ whiteSpace: "nowrap" }}>{formatTime(r.at)}</span>
													<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.action}</span>
												</button>
											</li>
										))}
									</ul>
								</div>
							)}
						</div>

						<div className="cal-actions" style={{ marginTop: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<span className="mono muted" style={{ fontSize: "0.62rem" }}>{openEntry.id}</span>
							<button type="button" className="btn btn--primary" onClick={closePane}>
								Done
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
