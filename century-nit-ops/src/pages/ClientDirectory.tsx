import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { API_PREFIX, JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";
import { branchName, OPS_BRANCHES } from "century-nit-core/ops";
import { apiFetch } from "../lib/api";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { useUrlParam } from "../hooks/useUrlParam";
import { fmtBoth, fmtGhs } from "./currency";
import { ConfirmDialog, Toast } from "./OpsDialogs";
import { FilterGroup } from "./FilterGroup";

export interface ClientUser {
	id: string;
	name: string;
	email: string;
	phoneNumber: string | null;
	emailVerified: boolean;
	banned: boolean;
	banReason: string | null;
	bannedAt: string | null;
	bannedBy: string | null;
	activeSessionsCount: number;
	lastActiveAt: string;
	status: "active" | "inactive" | "banned" | "unverified" | "registered";
	leadStage: string | null;
	applicantStatus: string | null;
	createdAt: string;
	updatedAt: string;
}

type DeleteAction = "disconnect" | "archive" | "purge";


interface ClientListResponse {
	clients: ClientUser[];
	metrics: {
		total: number;
		active: number;
		inactive: number;
		banned: number;
	};
}

export function ClientDirectory() {
	const { opsRole } = useOpsAuth();
	const [clients, setClients] = useState<ClientUser[]>([]);
	const [metrics, setMetrics] = useState({ total: 0, active: 0, inactive: 0, banned: 0 });
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<string | null>(null);
	const [search, setSearch] = useUrlParam("q");
	const [statusFilter, setStatusFilter] = useUrlParam<"all" | "active" | "inactive" | "banned" | "unverified" | "withcase">("status", {
		allowed: ["all", "active", "inactive", "banned", "unverified", "withcase"],
		fallback: "all",
	});
	const [branchFilter, setBranchFilter] = useUrlParam("branch");
	// The record pane — a row's actions live on the record, not the row. `?id=`
	// makes a record a shareable link.
	const [selectedId, setSelectedId] = useUrlParam("id");
	const { applications, consultations } = useCases();
	const { invoices } = useInvoiceApi();

	// Action modals
	const [banTarget, setBanTarget] = useState<ClientUser | null>(null);
	const [banReason, setBanReason] = useState("");
	const [banSubmitting, setBanSubmitting] = useState(false);

	const [deleteTarget, setDeleteTarget] = useState<ClientUser | null>(null);
	const [deleteAction, setDeleteAction] = useState<DeleteAction>("archive");
	const [deleteSubmitting, setDeleteSubmitting] = useState(false);

	const [revokeTarget, setRevokeTarget] = useState<ClientUser | null>(null);
	const [revokeSubmitting, setRevokeSubmitting] = useState(false);

	// Confirm dialog state
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmTitle, setConfirmTitle] = useState("");
	const [confirmMessage, setConfirmMessage] = useState("");
	const [confirmDanger, setConfirmDanger] = useState(false);
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

	// Toast state
	const [toast, setToast] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);

	const canManageAccess = opsRole === "super_admin" || opsRole === "admin" || opsRole === "manager";
	const canDelete = opsRole === "super_admin";

	const _showToast = (type: "error" | "success" | "info", message: string) => {
		setToast({ type, message });
	};
	void _showToast;

	const confirm = (title: string, message: string, action: () => void, danger = false) => {
		setConfirmTitle(title);
		setConfirmMessage(message);
		setConfirmDanger(danger);
		setConfirmAction(() => action);
		setConfirmOpen(true);
	};

	const say = (msg: string) => {
		setFlash(msg);
		window.setTimeout(() => setFlash(null), 4000);
	};

	const fetchClients = useCallback(async () => {
		setError(null);
		try {
			const res = await apiFetch<ClientListResponse>(`${API_PREFIX}/client-users`);
			if (res && Array.isArray(res.clients)) {
				setClients(res.clients);
				if (res.metrics) setMetrics(res.metrics);
			}
		} catch (err) {
			console.warn("[CRM/Auth] Failed to load client users:", err);
			// Do not block UI if running offline
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchClients();
		// Refresh on focus instead of polling — the directory doesn't change
		// under you often enough to justify a 10s loop, and every action below
		// re-fetches on completion.
		const onFocus = () => void fetchClients();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [fetchClients]);

	// client id / email → the branch their cases sit in. A client with no case
	// has no branch, which is honest — the branch belongs to the file.
	const clientBranch = useMemo(() => {
		const map = new Map<string, string>();
		for (const a of applications) {
			if (!a.branch) continue;
			if (a.applicantUserId) map.set(a.applicantUserId, a.branch);
			if (a.email) map.set(a.email, a.branch);
		}
		return map;
	}, [applications]);

	// client id / email set — who holds at least one case.
	const linkedClientIds = useMemo(() => {
		const s = new Set<string>();
		for (const a of applications) {
			if (a.applicantUserId) s.add(a.applicantUserId);
			if (a.email) s.add(a.email);
		}
		return s;
	}, [applications]);

	const displayedClients = useMemo(() => {
		const list = [...clients];

		return list.filter((c) => {
			const hasCase = linkedClientIds.has(c.id) || linkedClientIds.has(c.email);
			const matchesStatus =
				statusFilter === "all" ||
				(statusFilter === "active" && c.status === "active") ||
				(statusFilter === "inactive" && c.status === "inactive") ||
				(statusFilter === "banned" && c.banned) ||
				(statusFilter === "unverified" && !c.emailVerified && !c.banned) ||
				(statusFilter === "withcase" && hasCase);

			const matchesBranch =
				!branchFilter || clientBranch.get(c.id) === branchFilter || clientBranch.get(c.email) === branchFilter;

			const q = search.toLowerCase().trim();
			const matchesSearch =
				!q ||
				c.name.toLowerCase().includes(q) ||
				c.email.toLowerCase().includes(q) ||
				(c.phoneNumber && c.phoneNumber.includes(q));

			return matchesStatus && matchesBranch && matchesSearch;
		});
	}, [clients, statusFilter, branchFilter, clientBranch, linkedClientIds, search]);

	const selected = selectedId ? (clients.find((c) => c.id === selectedId) ?? null) : null;
	// The client's cases — matched on the portal user id first, email as the
	// fallback for accounts that predate the link.
	const selectedCases = useMemo(
		() =>
			selected
				? applications.filter((a) => a.applicantUserId === selected.id || a.email === selected.email)
				: [],
		[applications, selected],
	);
	const withCase = useMemo(
		() => clients.filter((c) => linkedClientIds.has(c.id) || linkedClientIds.has(c.email)).length,
		[clients, linkedClientIds],
	);

	// Who steers this client's journey — stamped on every case they open.
	const journeyCoordinator = selectedCases.find((a) => a.journeyCoordinatorName)?.journeyCoordinatorName ?? null;

	// Live context for the open record — next appointment and open thread
	// count, from the directory's own aggregate endpoint.
	const [ctx, setCtx] = useState<{
		nextAppointment: { startsAt: string; serviceName: string; status: string } | null;
		openConversations: number;
	} | null>(null);
	useEffect(() => {
		setCtx(null);
		if (!selected) return;
		let active = true;
		apiFetch<{
			nextAppointment: { startsAt: string; serviceName: string; status: string } | null;
			openConversations: number;
		}>(`${API_PREFIX}/client-users/${selected.id}/context`)
			.then((r) => { if (active) setCtx(r); })
			.catch(() => undefined);
		return () => { active = false; };
	}, [selected]);

	// Their next consultation — the earliest one still in play.
	const nextConsult = useMemo(() => {
		if (!selected) return null;
		const live = ["pending_slot", "confirmed", "reschedule_requested", "under_review", "in_progress"];
		const mine = consultations
			.filter((c) => (c.applicantUserId === selected.id || c.email === selected.email) && live.includes(c.status))
			.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
		return mine[0] ?? null;
	}, [selected, consultations]);

	// The selected client's money position — summed from the real ledger, plus
	// the oldest invoice still carrying a balance.
	const selectedMoney = useMemo(() => {
		if (!selected) return null;
		const mine = invoices.filter(
			(i) => i.applicantId === selected.id || i.applicantId === selected.email,
		);
		if (mine.length === 0) return { count: 0, billed: 0, paid: 0, balance: 0, openInvoice: null };
		const billed = mine.reduce((n, i) => n + i.subtotal, 0);
		const paid = mine.reduce((n, i) => n + (i.payments ?? []).reduce((m, p) => m + p.amount, 0), 0);
		const openInvoice = mine
			.map((i) => ({ id: i.id, number: i.invoiceNumber, due: i.subtotal - (i.payments ?? []).reduce((m, p) => m + p.amount, 0) }))
			.filter((i) => i.due > 0)
			.sort((a, b) => a.number.localeCompare(b.number))[0] ?? null;
		return { count: mine.length, billed, paid, balance: Math.max(0, billed - paid), openInvoice };
	}, [selected, invoices]);

	// Branch chips only for branches that actually hold clients here.
	const branchCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const c of clients) {
			const b = clientBranch.get(c.id) ?? clientBranch.get(c.email);
			if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
		}
		return counts;
	}, [clients, clientBranch]);

	const handleRevokeSessions = async () => {
		if (!revokeTarget) return;
		setRevokeSubmitting(true);
		try {
			await apiFetch<{ success: boolean; revokedCount: number }>(
				`${API_PREFIX}/client-users/${revokeTarget.id}/revoke-sessions`,
				{ method: "POST" },
			);
			say(`Successfully terminated active session(s) for ${revokeTarget.name}.`);
			setRevokeTarget(null);
			await fetchClients();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to revoke sessions");
		} finally {
			setRevokeSubmitting(false);
		}
	};

	const handleBanClient = async () => {
		if (!banTarget || !banReason.trim()) return;
		setBanSubmitting(true);
		try {
			await apiFetch(`${API_PREFIX}/client-users/${banTarget.id}/ban`, {
				method: "POST",
				body: JSON.stringify({ reason: banReason.trim() }),
			});
			say(`Account access for ${banTarget.name} has been suspended/banned.`);
			setBanTarget(null);
			setBanReason("");
			await fetchClients();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to ban client");
		} finally {
			setBanSubmitting(false);
		}
	};

	const handleUnbanClient = async (c: ClientUser) => {
		confirm(
			"Restore Portal Access",
			`Are you sure you want to restore portal access for ${c.name} (${c.email})?`,
			async () => {
				try {
					await apiFetch(`${API_PREFIX}/client-users/${c.id}/unban`, {
						method: "POST",
					});
					say(`Account access restored for ${c.name}.`);
					await fetchClients();
				} catch (err) {
					setError(err instanceof Error ? err.message : "Failed to restore account");
				}
			},
		);
	};

	const handleDeleteClient = (c: ClientUser) => {
		setDeleteTarget(c);
		setDeleteAction("archive"); // Default safe option
	};

	const executeDeleteClient = async () => {
		if (!deleteTarget) return;
		setDeleteSubmitting(true);
		try {
			await apiFetch(`${API_PREFIX}/client-users/${deleteTarget.id}`, { 
				method: "DELETE",
				body: JSON.stringify({ action: deleteAction })
			});
			
			let message = "";
			if (deleteAction === "disconnect") {
				message = `Login for ${deleteTarget.name} removed. Case data retained.`;
			} else if (deleteAction === "archive") {
				message = `${deleteTarget.name} archived. Data hidden from ops views.`;
			} else {
				message = `${deleteTarget.name} permanently purged.`;
			}
			
			say(message);
			await fetchClients();
			setDeleteTarget(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to delete client");
		} finally {
			setDeleteSubmitting(false);
		}
	};

	return (
		<><div className="fade-in">
			{flash ? <div className="inv-flash" style={{ marginBottom: "1rem" }}>✓ {flash}</div> : null}
			{error ? <p className="ops-modal__error" role="alert" style={{ marginBottom: "1rem" }}>{error}</p> : null}

			<div className="hdr-row">
				<div>
					<h1 className="page-title">Clients</h1>
					<p className="lead mt-1">Every portal account — who can sign in, who has a case, who needs access managed.</p>
				</div>
				<button type="button" className="btn btn--sm btn--ghost" onClick={fetchClients} title="Refresh client records">
					↻ Refresh
				</button>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span className="dash-day__cut"><strong>{metrics.total || clients.length}</strong> registered</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{metrics.active || clients.filter((c) => c.status === "active").length}</strong> active now</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{metrics.inactive || clients.filter((c) => c.status === "inactive").length}</strong> dormant 30d+</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{withCase}</strong> with a case</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{metrics.banned || clients.filter((c) => c.banned).length}</strong> suspended</span>
			</div>

			{/* Filters — the chips carry the counts. */}
			<div className="cn-scaffold__filters cn-scaffold__filters--row" style={{ border: "1px solid var(--border-light)", marginBottom: "0" }}>
				<input
					type="search"
					placeholder="Search name, email, phone…"
					className="cn-search"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<FilterGroup
					label="Access status"
					value={statusFilter}
					onChange={setStatusFilter}
					options={[
						{ id: "all", label: "All", count: clients.length },
						{ id: "withcase", label: "With a case", count: withCase },
						{ id: "active", label: "Active", count: clients.filter((c) => c.status === "active").length },
						{ id: "inactive", label: "Dormant", count: clients.filter((c) => c.status === "inactive").length },
						{ id: "unverified", label: "Unverified", count: clients.filter((c) => !c.emailVerified && !c.banned).length },
						{ id: "banned", label: "Suspended", count: clients.filter((c) => c.banned).length },
					]}
				/>
				{branchCounts.size > 1 && (
					<FilterGroup
						label="Branch"
						value={branchFilter || "all"}
						onChange={(id) => setBranchFilter(id === "all" ? null : id)}
						options={[
							{ id: "all", label: "All branches" },
							...OPS_BRANCHES.filter((b) => branchCounts.has(b.id)).map((b) => ({
								id: b.id,
								label: b.name,
								count: branchCounts.get(b.id),
							})),
						]}
					/>
				)}
			</div>

			<div className="cl-split">
				<div className="card" style={{ padding: 0, overflow: "hidden", flex: 1, minWidth: 0 }}>
					<div className="ops-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Client</th>
									<th>Access</th>
									<th>Branch</th>
									<th>Stage</th>
									<th>Last seen</th>
									<th style={{ textAlign: "right" }} />
								</tr>
							</thead>
							<tbody>
								{loading && clients.length === 0 ? (
									<tr>
										<td colSpan={6} style={{ textAlign: "center", padding: "2rem" }} className="muted">
											Loading client directory…
										</td>
									</tr>
								) : displayedClients.length === 0 ? (
									<tr>
										<td colSpan={6} style={{ textAlign: "center", padding: "2.5rem" }} className="muted">
											No clients match the current filters.
										</td>
									</tr>
								) : (
									displayedClients.map((c) => {
										const isBanned = c.banned;
										const isActive = c.status === "active";
										const on = selected?.id === c.id;
										return (
											<tr
												key={c.id}
												className={`cl-tr${on ? " cl-tr--on" : ""}${isBanned ? " cl-tr--susp" : ""}`}
												role="button"
												tabIndex={0}
												onClick={() => setSelectedId(on ? null : c.id)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") setSelectedId(on ? null : c.id);
												}}
											>
												<td>
													<div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
														{c.name}
														{c.emailVerified && (
															<span title="Email verified" className="mono" style={{ fontSize: "0.7rem" }}>✓</span>
														)}
													</div>
													<div className="muted" style={{ fontSize: "var(--text-xs)" }}>
														{c.email} {c.phoneNumber ? `· ${c.phoneNumber}` : ""}
													</div>
												</td>
												<td>
													{isBanned ? (
														<div>
															<span className="portal-pill" style={{ textDecoration: "underline", textDecorationThickness: 2, fontWeight: 700 }}>
																Suspended
															</span>
															{c.banReason && (
																<div className="muted" style={{ fontSize: "0.7rem", marginTop: "0.2rem", maxWidth: "200px" }}>
																	{c.banReason}
																</div>
															)}
														</div>
													) : isActive ? (
														<span className="portal-pill" style={{ background: "var(--foreground)", color: "var(--background)" }}>Active</span>
													) : c.status === "inactive" ? (
														<span className="portal-pill">Dormant</span>
													) : (
														<span className="portal-pill portal-pill--hollow">Registered</span>
													)}
												</td>
												<td className="admin-table__mono muted" style={{ fontSize: "var(--text-xs)" }}>
													{(() => { const b = clientBranch.get(c.id) ?? clientBranch.get(c.email); return b ? branchName(b) : "—"; })()}
												</td>
												<td>
													<span className="portal-pill portal-pill--hollow" style={{ fontSize: "0.7rem" }}>
														{c.leadStage || c.applicantStatus || "Lead"}
													</span>
												</td>
												<td className="admin-table__mono" style={{ fontSize: "var(--text-xs)" }}>
													{new Date(c.lastActiveAt).toLocaleString(undefined, {
														month: "short",
														day: "numeric",
														hour: "2-digit",
														minute: "2-digit",
													})}
												</td>
												<td style={{ textAlign: "right" }}>
													<span className="dash-link">{on ? "close ↑" : "record →"}</span>
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
				</div>

				{/* The record — access facts, the file it belongs to, the danger zone. */}
				{selected && (
					<aside className="cl-record">
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
							<div>
								<p className="eyebrow" style={{ margin: 0 }}>Client record</p>
								<h3 style={{ margin: "0.3rem 0 0", fontSize: "1.05rem", fontWeight: 800 }}>{selected.name}</h3>
								<p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "var(--text-xs)" }}>
									{selected.email}{selected.phoneNumber ? ` · ${selected.phoneNumber}` : ""}
									{" · "}{selected.emailVerified ? "verified" : "unverified"} {new Date(selected.createdAt).toLocaleDateString()}
								</p>
								<div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
									<Link to={`/helpdesk?client=${selected.id}`} className="btn btn--sm">
										Message →{ctx && ctx.openConversations > 0 ? ` (${ctx.openConversations})` : ""}
									</Link>
									{selectedCases[0] && (
										<Link to={`/applications?id=${selectedCases[0].id}`} className="btn btn--sm btn--ghost">
											Case {selectedCases[0].appId} →
										</Link>
									)}
								</div>
							</div>
							<button type="button" className="btn btn--xs btn--ghost" onClick={() => setSelectedId(null)}>✕</button>
						</div>

						<p className="cl-sec">Access</p>
						<div className="cl-kv">
							<span className="cl-kv__k">Status</span>
							<span>
								{selected.banned ? (
									<span className="portal-pill" style={{ textDecoration: "underline", textDecorationThickness: 2, fontWeight: 700 }}>Suspended</span>
								) : selected.status === "active" ? (
									<span className="portal-pill" style={{ background: "var(--foreground)", color: "var(--background)" }}>Active</span>
								) : selected.status === "inactive" ? (
									<span className="portal-pill">Dormant</span>
								) : (
									<span className="portal-pill portal-pill--hollow">Registered</span>
								)}
							</span>
						</div>
						{selected.banReason && (
							<div className="cl-kv"><span className="cl-kv__k">Reason</span><span className="muted" style={{ fontSize: "var(--text-xs)" }}>{selected.banReason}</span></div>
						)}
						<div className="cl-kv"><span className="cl-kv__k">Email verified</span><span>{selected.emailVerified ? "✓" : "not yet"}</span></div>
						<div className="cl-kv">
							<span className="cl-kv__k">Sessions</span>
							<span>
								{selected.activeSessionsCount > 0 ? `${selected.activeSessionsCount} device${selected.activeSessionsCount > 1 ? "s" : ""}` : "none"}
								{canManageAccess && selected.activeSessionsCount > 0 && (
									<>
										{" · "}
										<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setRevokeTarget(selected)}>
											revoke all
										</button>
									</>
								)}
							</span>
						</div>
						<div className="cl-kv"><span className="cl-kv__k">Member since</span><span className="mono" style={{ fontSize: "var(--text-xs)" }}>{new Date(selected.createdAt).toLocaleDateString()}</span></div>

						<p className="cl-sec">Relationship</p>
						{selectedCases.length === 0 ? (
							<div className="cl-kv"><span className="cl-kv__k">Cases</span><span className="muted">none yet — {selected.leadStage || "lead"}</span></div>
						) : (
							selectedCases.map((a) => (
								<div className="cl-kv" key={a.id}>
									<span className="cl-kv__k">{a.appId}</span>
									<span>
										{JOURNEY_STAGE_LABELS[a.stage as JourneyStage] ?? a.stage}
										{a.branch ? ` · ${branchName(a.branch)}` : ""}
										{" · "}
										<Link to={`/applications?id=${a.id}`} className="dash-link">open →</Link>
									</span>
								</div>
							))
						)}
						{selectedCases[0]?.assignedStaff && (
							<div className="cl-kv"><span className="cl-kv__k">Handler</span><span>{selectedCases[0].assignedStaff}</span></div>
						)}
						{journeyCoordinator && (
							<div className="cl-kv">
								<span className="cl-kv__k">Journey</span>
								<span title="Every case this client opens routes to them">→ {journeyCoordinator}</span>
							</div>
						)}
						{nextConsult && (
							<div className="cl-kv">
								<span className="cl-kv__k">Next consult</span>
								<span>
									{new Date(nextConsult.dateTime).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
									{" · "}
									<Link to={`/consultations?id=${nextConsult.id}`} className="dash-link">open →</Link>
								</span>
							</div>
						)}
						{ctx?.nextAppointment && (
							<div className="cl-kv">
								<span className="cl-kv__k">Next appt</span>
								<span>
									{ctx.nextAppointment.serviceName} ·{" "}
									{new Date(ctx.nextAppointment.startsAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
								</span>
							</div>
						)}

						<p className="cl-sec">Activity</p>
						<div className="cl-kv"><span className="cl-kv__k">Portal</span><span className="muted" style={{ fontSize: "var(--text-xs)" }}>last seen {new Date(selected.lastActiveAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
						<div className="cl-kv"><span className="cl-kv__k">Joined</span><span className="mono" style={{ fontSize: "var(--text-xs)" }}>{new Date(selected.createdAt).toLocaleDateString()}</span></div>
						{selectedCases.some((a) => a.updatedAt) && (
							<div className="cl-kv">
								<span className="cl-kv__k">Case work</span>
								<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
									last touched {new Date(Math.max(...selectedCases.map((a) => new Date(a.updatedAt ?? 0).getTime()))).toLocaleString(undefined, { month: "short", day: "numeric" })}
								</span>
							</div>
						)}

						<p className="cl-sec">Money</p>
						{!selectedMoney || selectedMoney.count === 0 ? (
							<div className="cl-kv"><span className="cl-kv__k">Ledger</span><span className="muted">no invoices</span></div>
						) : (
							<>
								{selectedMoney.openInvoice && (
									<div className="cl-kv">
										<span className="cl-kv__k">Open invoice</span>
										<span>
											{selectedMoney.openInvoice.number} · <span className="mono" style={{ fontWeight: 700 }}>{fmtGhs(selectedMoney.openInvoice.due)} due</span>
										</span>
									</div>
								)}
								<div className="cl-kv"><span className="cl-kv__k">Paid to date</span><span className="mono" style={{ fontSize: "var(--text-xs)" }}>{fmtGhs(selectedMoney.paid)}</span></div>
								<div className="cl-kv">
									<span className="cl-kv__k">Balance</span>
									<span>
										<span className="mono" style={{ fontSize: "var(--text-xs)", fontWeight: selectedMoney.balance > 0 ? 700 : 400 }}>
											{fmtBoth(selectedMoney.balance)}
										</span>
										{" · "}
										<Link to="/invoices" className="dash-link">ledger →</Link>
									</span>
								</div>
							</>
						)}
						{canManageAccess && (
							<div className="cl-danger">
								<p className="cl-danger__h">Access control</p>
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.5rem" }}>
									{selected.banned
										? "Restoring lets them sign in again immediately."
										: "Suspending signs them out everywhere and blocks login."}
								</p>
								{selected.banned ? (
									<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => handleUnbanClient(selected)}>
										restore access
									</button>
								) : (
									<button
										type="button"
										className="dash-link"
										style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecorationStyle: "wavy" }}
										onClick={() => { setBanTarget(selected); setBanReason(""); }}
									>
										suspend account
									</button>
								)}
								{canDelete && (
									<>
										{" · "}
										<button
											type="button"
											className="dash-link"
											style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecorationStyle: "wavy" }}
											onClick={() => handleDeleteClient(selected)}
										>
											delete…
										</button>
									</>
								)}
							</div>
						)}
					</aside>
				)}
			</div>

			{/* Modal: Delete Client */}
			{deleteTarget && (
				<div className="ops-modal-backdrop" onClick={() => !deleteSubmitting && setDeleteTarget(null)}>
					<div className="ops-modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "550px" }}>
						<div className="ops-modal__header">
							<h2 className="ops-modal__title">Delete Applicant Data</h2>
							<button type="button" className="btn btn--xs btn--ghost" onClick={() => setDeleteTarget(null)} disabled={deleteSubmitting}>✕</button>
						</div>
						<div className="ops-modal__body">
							<p className="muted" style={{ marginBottom: "1.5rem" }}>
								Choose how to handle the data for <strong>{deleteTarget.name} ({deleteTarget.email})</strong>. 
							</p>

							<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
								<label className="ops-radio-card" style={{ display: "flex", gap: "1rem", padding: "1rem", border: "1px solid var(--border)", cursor: "pointer", background: deleteAction === "disconnect" ? "var(--bg-alt)" : "transparent" }}>
									<input 
										type="radio" 
										name="deleteAction" 
										value="disconnect" 
										checked={deleteAction === "disconnect"} 
										onChange={() => setDeleteAction("disconnect")} 
										style={{ marginTop: "4px" }}
									/>
									<div>
										<p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Disconnect Login Only</p>
										<p className="muted" style={{ fontSize: "0.85rem" }}>
											Deletes their web login account. Retains their Applicant Profile, Cases, and Leads exactly as they are. Best for users who just want to revoke access but you need their data for compliance.
										</p>
									</div>
								</label>

								<label className="ops-radio-card" style={{ display: "flex", gap: "1rem", padding: "1rem", border: "1px solid var(--border)", cursor: "pointer", background: deleteAction === "archive" ? "var(--bg-alt)" : "transparent" }}>
									<input 
										type="radio" 
										name="deleteAction" 
										value="archive" 
										checked={deleteAction === "archive"} 
										onChange={() => setDeleteAction("archive")} 
										style={{ marginTop: "4px" }}
									/>
									<div>
										<p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Archive & Hide (Recommended)</p>
										<p className="muted" style={{ fontSize: "0.85rem" }}>
											Deletes the login account and marks the applicant as archived. Their cases will be hidden from the Ops Workspace and queues, but data is retained for 30 days before permanent deletion.
										</p>
									</div>
								</label>

								<label className="ops-radio-card" style={{ display: "flex", gap: "1rem", padding: "1rem", border: "1px solid var(--border)", cursor: "pointer", background: deleteAction === "purge" ? "var(--bg-alt)" : "transparent", borderColor: "var(--border)" }}>
									<input 
										type="radio" 
										name="deleteAction" 
										value="purge" 
										checked={deleteAction === "purge"} 
										onChange={() => setDeleteAction("purge")} 
										style={{ marginTop: "4px" }}
									/>
									<div>
										<p style={{ fontWeight: 600, marginBottom: "0.25rem", textDecoration: "underline", textDecorationThickness: "2px" }}>Purge Everything</p>
										<p className="muted" style={{ fontSize: "0.85rem" }}>
											Completely and immediately obliterates the User login, Applicant Profile, Applications, Consultations, and Leads. Paid invoices will be orphaned. Irreversible.
										</p>
									</div>
								</label>
							</div>
						</div>
						<div className="ops-modal__footer" style={{ marginTop: "2rem", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setDeleteTarget(null)} disabled={deleteSubmitting}>Cancel</button>
							<button 
								type="button" 
								className="btn btn--sm btn--danger" 
								onClick={executeDeleteClient} 
								disabled={deleteSubmitting}
							>
								{deleteSubmitting ? "Executing..." : "Confirm Deletion"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Modal: Revoke Sessions */}
			{revokeTarget && (
				<div className="ops-modal-backdrop" onClick={() => !revokeSubmitting && setRevokeTarget(null)}>
					<div className="ops-modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "440px" }}>
						<h3 className="section-title">Revoke Active Sessions?</h3>
						<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>
							This will immediately force logout <strong>{revokeTarget.name}</strong> ({revokeTarget.email}) across all active devices and browsers.
						</p>
						<div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
							<button
								type="button"
								className="btn btn--ghost"
								onClick={() => setRevokeTarget(null)}
								disabled={revokeSubmitting}
							>
								Cancel
							</button>
							<button
								type="button"
								className="btn btn--primary"
								onClick={handleRevokeSessions}
								disabled={revokeSubmitting}
							>
								{revokeSubmitting ? "Revoking..." : "Confirm Revoke"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Modal: Ban Client */}
			{banTarget && (
				<div className="ops-modal-backdrop" onClick={() => !banSubmitting && setBanTarget(null)}>
					<div className="ops-modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
						<h3 className="section-title">Suspend account</h3>
						<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>
							Banning will instantly terminate all active sessions for <strong>{banTarget.name}</strong> ({banTarget.email}) and block them from logging in or booking new consultations.
						</p>

						<div style={{ marginTop: "1rem" }}>
							<label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.4rem" }}>
								Reason <span aria-hidden>*</span>
							</label>
							<textarea
								className="input input--full-border"
								rows={3}
								placeholder="e.g. Fraudulent documents submitted, Chargeback abuse, Policy violation..."
								value={banReason}
								onChange={(e) => setBanReason(e.target.value)}
								style={{ width: "100%", resize: "vertical" }}
								required
							/>
						</div>

						<div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
							<button
								type="button"
								className="btn btn--ghost"
								onClick={() => setBanTarget(null)}
								disabled={banSubmitting}
							>
								Cancel
							</button>
							<button
								type="button"
								className="btn btn--danger"
								onClick={handleBanClient}
								disabled={banSubmitting || !banReason.trim()}
								style={{ background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" }}
							>
								{banSubmitting ? "Suspending..." : "Confirm Ban"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>

		<ConfirmDialog
			open={confirmOpen}
			title={confirmTitle}
			message={confirmMessage}
			danger={confirmDanger}
			onConfirm={() => {
				setConfirmOpen(false);
				confirmAction?.();
			}}
			onCancel={() => setConfirmOpen(false)}
		/>

		{toast && (
			<Toast
				type={toast.type}
				message={toast.message}
				onDone={() => setToast(null)}
			/>
		)}
	</>
);
}