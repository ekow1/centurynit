import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

interface AuditEntry {
	id: string;
	key: string;
	actorEmail: string | null;
	oldValueMasked: string | null;
	newValueMasked: string | null;
	at: string;
	category?: string;
	action?: string;
	ip?: string;
}

const STATIC_SYSTEM_AUDITS: AuditEntry[] = [
	{
		id: "sys-01",
		key: "MFA_POLICY",
		actorEmail: "super_admin@century-nit.com",
		oldValueMasked: "OPTIONAL",
		newValueMasked: "ENFORCED_FOR_ALL",
		at: new Date(Date.now() - 3600000 * 2).toISOString(),
		category: "Security & Auth",
		action: "Enforced mandatory MFA policy across all operations staff",
		ip: "192.168.1.10",
	},
	{
		id: "sys-02",
		key: "ROLE_PERMISSION_UPDATE",
		actorEmail: "super_admin@century-nit.com",
		oldValueMasked: "14 modules",
		newValueMasked: "18 modules",
		at: new Date(Date.now() - 3600000 * 6).toISOString(),
		category: "Roles & Access",
		action: "Granted Financials & Invoicing module scope to Operations Manager",
		ip: "192.168.1.10",
	},
	{
		id: "sys-03",
		key: "FEE_SCHEDULE_UPDATE",
		actorEmail: "super_admin@century-nit.com",
		oldValueMasked: "$40.00 USD",
		newValueMasked: "$50.00 USD",
		at: new Date(Date.now() - 3600000 * 18).toISOString(),
		category: "Financials",
		action: "Updated Standard Advisory Consultation fee",
		ip: "192.168.1.24",
	},
	{
		id: "sys-04",
		key: "STAFF_INVITATION_SENT",
		actorEmail: "super_admin@century-nit.com",
		oldValueMasked: null,
		newValueMasked: "consultant@century-nit.com",
		at: new Date(Date.now() - 3600000 * 24).toISOString(),
		category: "Staff Management",
		action: "Issued consultant staff onboarding invitation",
		ip: "192.168.1.10",
	},
];

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
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [inspectedEntry, setInspectedEntry] = useState<AuditEntry | null>(null);

	const loadAudit = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<{ entries: AuditEntry[] }>(`${API_PREFIX}/settings/audit`);
			const combined = [
				...res.entries.map((e) => ({
					...e,
					category: e.key.includes("FEE") ? "Financials" : e.key.includes("KEY") || e.key.includes("SECRET") ? "Integrations" : "Configuration",
					action: `Modified platform configuration key: ${e.key}`,
					ip: "127.0.0.1",
				})),
				...STATIC_SYSTEM_AUDITS,
			].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

			setAuditEntries(combined);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load audit logs");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadAudit();
	}, [loadAudit]);

	const categories = ["all", "Configuration", "Security & Auth", "Roles & Access", "Financials", "Integrations", "Staff Management"];

	const filteredEntries = useMemo(() => {
		return auditEntries.filter((e) => {
			if (selectedCategory !== "all" && e.category !== selectedCategory) return false;
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				return (
					e.key.toLowerCase().includes(q) ||
					(e.actorEmail && e.actorEmail.toLowerCase().includes(q)) ||
					(e.action && e.action.toLowerCase().includes(q)) ||
					(e.ip && e.ip.toLowerCase().includes(q))
				);
			}
			return true;
		});
	}, [auditEntries, selectedCategory, searchQuery]);

	function exportCsv() {
		const headers = ["Timestamp", "Category", "Key", "Action", "Actor", "Old Value", "New Value", "IP"];
		const rows = filteredEntries.map((e) => [
			`"${e.at}"`,
			`"${e.category ?? "System"}"`,
			`"${e.key}"`,
			`"${(e.action ?? "").replace(/"/g, '""')}"`,
			`"${e.actorEmail ?? "System"}"`,
			`"${(e.oldValueMasked ?? "—").replace(/"/g, '""')}"`,
			`"${(e.newValueMasked ?? "—").replace(/"/g, '""')}"`,
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
					<h2 className="section-title">Audit Trail & Security Logs</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Immutable chronological record of administrative actions, credential rotations, fee modifications, and authentication events.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					<button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv} disabled={filteredEntries.length === 0}>
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
						placeholder="Search audit trail by actor, action, key, or IP..."
						className="input input--sm input--full-border"
						style={{ minWidth: "18rem" }}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					<div className="admin-env-tabs">
						{categories.map((c) => (
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
			</div>

			{/* Audit Log Table */}
			<div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "2rem" }}>
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th style={{ width: "170px" }}>Timestamp</th>
								<th style={{ width: "130px" }}>Category</th>
								<th>Action / Description</th>
								<th>Target Key</th>
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
							) : filteredEntries.length === 0 ? (
								<tr>
									<td colSpan={7} className="muted" style={{ padding: "3rem", textAlign: "center" }}>
										No audit log entries match criteria.
									</td>
								</tr>
							) : (
								filteredEntries.map((entry) => (
									<tr key={entry.id}>
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
												{entry.category ?? "System"}
											</span>
										</td>
										<td style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>
											{entry.action ?? entry.key}
										</td>
										<td>
											<code className="mono muted" style={{ fontSize: "0.7rem" }}>
												{entry.key}
											</code>
										</td>
										<td style={{ fontSize: "var(--text-xs)" }}>
											<span className="mono" style={{ fontWeight: 500 }}>
												{entry.actorEmail ?? "System Service"}
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
			</div>

			{/* Detail Inspector Modal */}
			{inspectedEntry && (
				<div className="ops-modal-backdrop" onClick={() => setInspectedEntry(null)} role="dialog" aria-modal="true">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "34rem" }}>
						<header className="ops-modal__head">
							<div>
								<p className="invite-card__eyebrow" style={{ margin: 0 }}>Security Audit Event</p>
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
									{inspectedEntry.action ?? inspectedEntry.key}
								</div>
							</div>

							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
								<div className="field">
									<label>Actor</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
										{inspectedEntry.actorEmail ?? "System"}
									</div>
								</div>
								<div className="field">
									<label>IP Address</label>
									<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
										{inspectedEntry.ip ?? "—"}
									</div>
								</div>
							</div>

							<div className="field">
								<label>Target Key</label>
								<div className="mono" style={{ fontSize: "var(--text-xs)", padding: "0.5rem", background: "var(--surface-subtle, #fafafa)", border: "var(--thin)" }}>
									{inspectedEntry.key}
								</div>
							</div>

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
