import { useCallback, useEffect, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * The unified audit trail. Every row is a recorded event — settings writes
 * (masked values, actor IP) plus admin events (invites, access control, role
 * grants, sign-ins). Nothing on this page is synthesized: if the API didn't
 * record it, it doesn't render.
 */

interface AuditEntry {
	id: string;
	source: "settings" | "admin";
	category: string;
	action: string;
	actorEmail: string | null;
	target: string | null;
	detail: string | null;
	oldValueMasked: string | null;
	newValueMasked: string | null;
	ip: string | null;
	at: string;
}

interface AuditPage {
	entries: AuditEntry[];
	total: number;
}

const CATEGORIES = [
	"all",
	"Configuration",
	"Authentication",
	"Roles & Access",
	"Financials",
	"Staff",
	"Clients",
	"System",
] as const;

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return iso;
	}
}

export function EnterpriseAuditLogs() {
	const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [fromDate, setFromDate] = useState("");
	const [toDate, setToDate] = useState("");
	const [inspectedEntry, setInspectedEntry] = useState<AuditEntry | null>(null);

	// Debounce the search box — the query is server-side now.
	useEffect(() => {
		const t = window.setTimeout(() => setDebouncedQuery(searchQuery.trim()), 350);
		return () => window.clearTimeout(t);
	}, [searchQuery]);

	const buildQuery = useCallback(
		(offset: number) => {
			const qs = new URLSearchParams();
			if (selectedCategory !== "all") qs.set("category", selectedCategory);
			if (debouncedQuery) qs.set("q", debouncedQuery);
			if (fromDate) qs.set("from", fromDate);
			if (toDate) qs.set("to", toDate);
			qs.set("limit", String(PAGE_SIZE));
			qs.set("offset", String(offset));
			return qs.toString();
		},
		[selectedCategory, debouncedQuery, fromDate, toDate],
	);

	const loadAudit = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<AuditPage>(`${API_PREFIX}/settings/admin-audit?${buildQuery(0)}`);
			setAuditEntries(res.entries);
			setTotal(res.total);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load audit logs");
		} finally {
			setLoading(false);
		}
	}, [buildQuery]);

	useEffect(() => {
		void loadAudit();
	}, [loadAudit]);

	const loadMore = useCallback(async () => {
		setLoadingMore(true);
		try {
			const res = await apiFetch<AuditPage>(`${API_PREFIX}/settings/admin-audit?${buildQuery(auditEntries.length)}`);
			setAuditEntries((prev) => [...prev, ...res.entries]);
			setTotal(res.total);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load more entries");
		} finally {
			setLoadingMore(false);
		}
	}, [buildQuery, auditEntries.length]);

	const hasMore = auditEntries.length < total;

	function exportCsv() {
		const headers = ["Timestamp", "Category", "Action", "Target", "Actor", "Old Value", "New Value", "Detail", "IP"];
		const rows = auditEntries.map((e) => [
			`"${e.at}"`,
			`"${e.category}"`,
			`"${e.action.replace(/"/g, '""')}"`,
			`"${(e.target ?? "—").replace(/"/g, '""')}"`,
			`"${e.actorEmail ?? "system"}"`,
			`"${(e.oldValueMasked ?? "—").replace(/"/g, '""')}"`,
			`"${(e.newValueMasked ?? "—").replace(/"/g, '""')}"`,
			`"${(e.detail ?? "—").replace(/"/g, '""')}"`,
			`"${e.ip ?? "—"}"`,
		]);
		const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
		const encodedUri = encodeURI(csvContent);
		const link = document.createElement("a");
		link.setAttribute("href", encodedUri);
		link.setAttribute("download", `century_nit_audit_log_${new Date().toISOString().slice(0, 10)}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}

	return (
		<div className="admin-page">
			{/* Page Head */}
			<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
				<div>
					<h2 className="section-title">Audit Trail &amp; Security Logs</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Every recorded administrative action — settings changes, sign-ins, access control, role grants. If it isn't in the trail, it isn't on this page.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					<button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv} disabled={auditEntries.length === 0}>
						↓ Export CSV
					</button>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadAudit()} disabled={loading}>
						{loading ? "Refreshing…" : "Refresh"}
					</button>
				</div>
			</div>

			{error && (
				<p className="ops-modal__error" role="alert" style={{ marginBottom: "1.5rem" }}>
					{error}
				</p>
			)}

			{/* Filter Toolbar */}
			<div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
					<input
						type="search"
						placeholder="Search actor, action, target, or IP..."
						className="input input--sm input--full-border"
						style={{ minWidth: "16rem" }}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
						<input
							type="date"
							className="input input--sm input--full-border"
							value={fromDate}
							onChange={(e) => setFromDate(e.target.value)}
							aria-label="From date"
						/>
						<span className="muted" style={{ fontSize: "var(--text-xs)" }}>→</span>
						<input
							type="date"
							className="input input--sm input--full-border"
							value={toDate}
							onChange={(e) => setToDate(e.target.value)}
							aria-label="To date"
						/>
					</div>
				</div>
				<div className="admin-env-tabs" style={{ marginTop: "0.75rem" }}>
					{CATEGORIES.map((c) => (
						<button
							key={c}
							type="button"
							onClick={() => setSelectedCategory(c)}
							className={`admin-env-tab${selectedCategory === c ? " admin-env-tab--active" : ""}`}
						>
							{c === "all" ? "All Events" : c}
						</button>
					))}
				</div>
			</div>

			{/* Audit Log Table */}
			<div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "2rem" }}>
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th style={{ width: "170px" }}>Timestamp</th>
								<th style={{ width: "130px" }}>Category</th>
								<th>Action</th>
								<th>Target</th>
								<th>Actor</th>
								<th>IP Address</th>
								<th style={{ textAlign: "right" }}>Detail</th>
							</tr>
						</thead>
						<tbody>
							{loading ? (
								<tr>
									<td colSpan={7} className="muted" style={{ padding: "3rem", textAlign: "center" }}>
										Loading audit log records…
									</td>
								</tr>
							) : auditEntries.length === 0 ? (
								<tr>
									<td colSpan={7} className="muted" style={{ padding: "3rem", textAlign: "center" }}>
										No audit log entries match criteria.
									</td>
								</tr>
							) : (
								auditEntries.map((entry) => (
									<tr key={`${entry.source}-${entry.id}`}>
										<td className="mono muted" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
											{formatDate(entry.at)}
										</td>
										<td>
											<span
												style={{
													fontSize: "0.6rem",
													fontFamily: "var(--font-mono)",
													textTransform: "uppercase",
													padding: "0.15rem 0.4rem",
													border: "var(--thin)",
													background: "var(--foreground)",
													color: "var(--background)",
													borderRadius: "2px",
												}}
											>
												{entry.category}
											</span>
										</td>
										<td style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>
											{entry.action}
										</td>
										<td>
											<code className="mono muted" style={{ fontSize: "0.7rem" }}>
												{entry.target ?? "—"}
											</code>
										</td>
										<td style={{ fontSize: "var(--text-xs)" }}>
											<span className="mono" style={{ fontWeight: 500 }}>
												{entry.actorEmail ?? "system"}
											</span>
										</td>
										<td className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
											{entry.ip ?? "—"}
										</td>
										<td style={{ textAlign: "right" }}>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => setInspectedEntry(entry)}
											>
												Inspect
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
				{!loading && (
					<div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
							{auditEntries.length} of {total} entries
						</span>
						{hasMore && (
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadMore()} disabled={loadingMore}>
								{loadingMore ? "Loading…" : `Load ${Math.min(PAGE_SIZE, total - auditEntries.length)} more`}
							</button>
						)}
					</div>
				)}
			</div>

			{/* Detail Inspector Modal */}
			{inspectedEntry && (
				<div className="ops-modal-backdrop" onClick={() => setInspectedEntry(null)} role="dialog" aria-modal="true">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "34rem" }}>
						<header className="ops-modal__head">
							<div>
								<p className="invite-card__eyebrow" style={{ margin: 0 }}>{inspectedEntry.category} event</p>
								<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>Event Details</h2>
								<p className="ops-modal__sub">{inspectedEntry.id} · {formatDate(inspectedEntry.at)}</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setInspectedEntry(null)}>
								✕ Close
							</button>
						</header>

						<div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
							<div className="field">
								<label>Action Performed</label>
								<div style={{ fontWeight: 600, fontSize: "var(--text-sm)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
									{inspectedEntry.action}
								</div>
							</div>

							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
								<div className="field">
									<label>Actor</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
										{inspectedEntry.actorEmail ?? "system"}
									</div>
								</div>
								<div className="field">
									<label>IP Address</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
										{inspectedEntry.ip ?? "not recorded"}
									</div>
								</div>
							</div>

							{inspectedEntry.target && (
								<div className="field">
									<label>Target</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
										{inspectedEntry.target}
									</div>
								</div>
							)}

							{inspectedEntry.detail && (
								<div className="field">
									<label>Detail</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)", wordBreak: "break-all" }}>
										{inspectedEntry.detail}
									</div>
								</div>
							)}

							{(inspectedEntry.oldValueMasked !== null || inspectedEntry.newValueMasked !== null) && (
								<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
									<div className="field">
										<label>Previous State</label>
										<div className="mono muted" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)", wordBreak: "break-all" }}>
											{inspectedEntry.oldValueMasked ?? "— (unset)"}
										</div>
									</div>
									<div className="field">
										<label>New State</label>
										<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)", wordBreak: "break-all", fontWeight: 600 }}>
											{inspectedEntry.newValueMasked ?? "— (cleared)"}
										</div>
									</div>
								</div>
							)}
						</div>

						<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
							<button type="button" className="btn btn--primary" onClick={() => setInspectedEntry(null)}>
								Done
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
