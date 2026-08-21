import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { useOpsAuth } from "./OpsAuthContext";
import { ConfirmDialog, Toast } from "./OpsDialogs";

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
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "banned">("all");

	// Action modals
	const [banTarget, setBanTarget] = useState<ClientUser | null>(null);
	const [banReason, setBanReason] = useState("");
	const [banSubmitting, setBanSubmitting] = useState(false);

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
		const interval = setInterval(fetchClients, 10000);
		return () => clearInterval(interval);
	}, [fetchClients]);

	// Integrate active browser portal session if present
	const displayedClients = useMemo(() => {
		const list = [...clients];

		return list.filter((c) => {
			const matchesStatus =
				statusFilter === "all" ||
				(statusFilter === "active" && c.status === "active") ||
				(statusFilter === "inactive" && c.status === "inactive") ||
				(statusFilter === "banned" && c.banned);

			const q = search.toLowerCase().trim();
			const matchesSearch =
				!q ||
				c.name.toLowerCase().includes(q) ||
				c.email.toLowerCase().includes(q) ||
				(c.phoneNumber && c.phoneNumber.includes(q));

			return matchesStatus && matchesSearch;
		});
	}, [clients, statusFilter, search]);

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
		confirm(
			"Delete Client Permanently",
			`This will permanently delete ${c.name} (${c.email}) and all their data. This action cannot be undone.`,
			async () => {
				try {
					await apiFetch(`${API_PREFIX}/client-users/${c.id}`, { method: "DELETE" });
					say(`${c.name} has been permanently deleted.`);
					await fetchClients();
				} catch (err) {
					setError(err instanceof Error ? err.message : "Failed to delete client");
				}
			},
			true,
		);
	};

	return (
		<><div className="fade-in">
			{flash ? <div className="inv-flash" style={{ marginBottom: "1rem" }}>✓ {flash}</div> : null}
			{error ? <p className="ops-modal__error" role="alert" style={{ marginBottom: "1rem" }}>{error}</p> : null}

			{/* Metrics Cards */}
			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
				<div className="card">
					<p className="eyebrow">Registered Clients</p>
					<p className="page-title mt-1" style={{ fontSize: "1.75rem" }}>{metrics.total || clients.length}</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>Total client accounts</p>
				</div>
				<div className="card" style={{ borderLeft: "4px solid #10b981" }}>
					<p className="eyebrow" style={{ color: "#10b981" }}>Active Now</p>
					<p className="page-title mt-1" style={{ fontSize: "1.75rem", color: "#10b981" }}>
						{metrics.active || clients.filter((c) => c.status === "active").length}
					</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>Valid active sessions</p>
				</div>
				<div className="card">
					<p className="eyebrow">Inactive / Dormant</p>
					<p className="page-title mt-1" style={{ fontSize: "1.75rem" }}>
						{metrics.inactive || clients.filter((c) => c.status === "inactive").length}
					</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>No activity &gt;30 days</p>
				</div>
				<div className="card" style={metrics.banned > 0 ? { borderLeft: "4px solid #ef4444" } : undefined}>
					<p className="eyebrow" style={{ color: metrics.banned > 0 ? "#ef4444" : undefined }}>Banned / Suspended</p>
					<p className="page-title mt-1" style={{ fontSize: "1.75rem", color: metrics.banned > 0 ? "#ef4444" : undefined }}>
						{metrics.banned || clients.filter((c) => c.banned).length}
					</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>Access revoked</p>
				</div>
			</div>

			{/* Filter Header */}
			<div className="admin-section-head" style={{ marginBottom: "1.25rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "1rem" }}>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: "1 1 300px" }}>
					<input
						type="search"
						placeholder="Search by name, email, or phone..."
						className="input input--sm input--full-border"
						style={{ maxWidth: "320px", width: "100%" }}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					<button
						type="button"
						className="btn btn--sm btn--ghost"
						onClick={fetchClients}
						title="Refresh client records"
					>
						↻ Refresh
					</button>
				</div>

				<div className="admin-env-tabs">
					<button
						type="button"
						onClick={() => setStatusFilter("all")}
						className={`admin-env-tab${statusFilter === "all" ? " admin-env-tab--active" : ""}`}
					>
						All ({clients.length})
					</button>
					<button
						type="button"
						onClick={() => setStatusFilter("active")}
						className={`admin-env-tab${statusFilter === "active" ? " admin-env-tab--active" : ""}`}
					>
						Active ({clients.filter((c) => c.status === "active").length})
					</button>
					<button
						type="button"
						onClick={() => setStatusFilter("inactive")}
						className={`admin-env-tab${statusFilter === "inactive" ? " admin-env-tab--active" : ""}`}
					>
						Inactive ({clients.filter((c) => c.status === "inactive").length})
					</button>
					<button
						type="button"
						onClick={() => setStatusFilter("banned")}
						className={`admin-env-tab${statusFilter === "banned" ? " admin-env-tab--active" : ""}`}
					>
						Banned ({clients.filter((c) => c.banned).length})
					</button>
				</div>
			</div>

			{/* Client Table */}
			<div className="card" style={{ padding: 0, overflow: "hidden" }}>
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Client</th>
								<th>Access Status</th>
								<th>Active Sessions</th>
								<th>Last Active</th>
								<th>Registered</th>
								<th>CRM Stage</th>
								{canManageAccess && <th style={{ textAlign: "right" }}>Access Control</th>}
							</tr>
						</thead>
						<tbody>
							{loading && clients.length === 0 ? (
								<tr>
									<td colSpan={7} style={{ textAlign: "center", padding: "2rem" }} className="muted">
										Loading client directory...
									</td>
								</tr>
							) : displayedClients.length === 0 ? (
								<tr>
									<td colSpan={7} style={{ textAlign: "center", padding: "2.5rem" }} className="muted">
										No clients match your filter criteria.
									</td>
								</tr>
							) : (
								displayedClients.map((c) => {
									const isBanned = c.banned;
									const isActive = c.status === "active";

									return (
										<tr key={c.id} style={isBanned ? { background: "rgba(239, 68, 68, 0.04)" } : undefined}>
											<td>
												<div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
													{c.name}
													{c.emailVerified && (
														<span title="Email verified" style={{ color: "#10b981", fontSize: "0.75rem" }}>✓</span>
													)}
												</div>
												<div className="muted" style={{ fontSize: "var(--text-xs)" }}>
													{c.email} {c.phoneNumber ? `· ${c.phoneNumber}` : ""}
												</div>
											</td>
											<td>
												{isBanned ? (
													<div>
														<span className="portal-pill" style={{ background: "#ef4444", color: "#fff", fontWeight: 600 }}>
															BANNED
														</span>
														{c.banReason && (
															<div className="muted" style={{ fontSize: "0.7rem", marginTop: "0.2rem", maxWidth: "200px" }}>
																Reason: {c.banReason}
															</div>
														)}
													</div>
												) : isActive ? (
													<span className="portal-pill" style={{ background: "#10b981", color: "#fff", fontWeight: 600 }}>
														● ACTIVE
													</span>
												) : c.status === "inactive" ? (
													<span className="portal-pill" style={{ background: "var(--border)", color: "var(--muted-foreground)" }}>
														INACTIVE
													</span>
												) : (
													<span className="portal-pill" style={{ background: "var(--surface-sunken)", color: "var(--foreground)" }}>
														REGISTERED
													</span>
												)}
											</td>
											<td>
												{c.activeSessionsCount > 0 ? (
													<span style={{ fontWeight: 600, color: "#10b981", fontSize: "var(--text-sm)" }}>
														{c.activeSessionsCount} active device{c.activeSessionsCount > 1 ? "s" : ""}
													</span>
												) : (
													<span className="muted" style={{ fontSize: "var(--text-xs)" }}>No active session</span>
												)}
											</td>
											<td className="admin-table__mono" style={{ fontSize: "var(--text-xs)" }}>
												{new Date(c.lastActiveAt).toLocaleString(undefined, {
													month: "short",
													day: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												})}
											</td>
											<td className="admin-table__mono" style={{ fontSize: "var(--text-xs)" }}>
												{new Date(c.createdAt).toLocaleDateString()}
											</td>
											<td>
												<span className="portal-pill" style={{ fontSize: "0.7rem" }}>
													{c.leadStage || c.applicantStatus || "Lead"}
												</span>
											</td>
										{canManageAccess && (
											<td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
												<div style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
													{c.activeSessionsCount > 0 && (
														<button
															type="button"
															className="btn btn--xs btn--ghost"
															onClick={() => setRevokeTarget(c)}
															title="Force logout active devices"
															style={{ color: "#b45309" }}
														>
															Revoke Sessions
														</button>
													)}

													{isBanned ? (
														<button
															type="button"
															className="btn btn--xs btn--primary"
															onClick={() => handleUnbanClient(c)}
															style={{ background: "#166534", borderColor: "#166534" }}
														>
															Unban
														</button>
													) : (
														<button
															type="button"
															className="btn btn--xs btn--danger"
															onClick={() => {
																setBanTarget(c);
																setBanReason("");
															}}
															style={{ color: "#b91c1c", borderColor: "#b91c1c" }}
														>
															Ban
														</button>
													)}

													{canDelete && (
														<button
															type="button"
															className="btn btn--xs btn--danger"
															onClick={() => handleDeleteClient(c)}
															title="Permanently delete this client and all their data"
															style={{ background: "#7f1d1d", borderColor: "#7f1d1d", color: "#ffffff" }}
														>
															Delete
														</button>
													)}
												</div>
											</td>
										)}
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</div>

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
						<h3 className="section-title" style={{ color: "#ef4444" }}>Suspend / Ban Client Account</h3>
						<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>
							Banning will instantly terminate all active sessions for <strong>{banTarget.name}</strong> ({banTarget.email}) and block them from logging in or booking new consultations.
						</p>

						<div style={{ marginTop: "1rem" }}>
							<label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.4rem" }}>
								Reason for Ban <span style={{ color: "#ef4444" }}>*</span>
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
								style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
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