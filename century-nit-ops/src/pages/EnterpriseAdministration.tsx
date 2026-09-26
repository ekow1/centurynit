import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CmsManager } from "./CmsManager";
import { useOpsAuth, ROLE_LABELS, type OpsRole } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import { OPS_BRANCHES, staffBranchName } from "century-nit-core/ops";
import { ApiError, staffApi, notificationsApi, auditApi, type NotificationLogItem, type AuditEvent, type AuthPolicy, type NotificationEventCatalogueItem, type NotificationHealth, type NotificationPreferences } from "century-nit-core/api";
import { MODULE_GROUPS, ALL_OPS_MODULES, API_PREFIX, CAPABILITIES, capabilitySchema, defaultPermissionsOf, type Capability, type OpsModule, type SystemRole } from "century-nit-shared";
import { apiFetch, getAuthSettings, updateAuthSettings as updateAuthSettingsApi, type AuthSettingsResponse } from "../lib/api";
import { PlatformSettings } from "./PlatformSettings";
import { ConfirmDialog, Toast } from "./OpsDialogs";


/**
 * The platform console. Every screen here is about running the software -
 * accounts, access, content, configuration - never applicant case data.
 */
export type AdminSection =
	| "system"
	| "users"
	| "auth"
	| "cms"
	| "notifications"
	| "settings";

const SECTION_META: Record<AdminSection, { title: string; blurb: string }> = {
	system: {
		title: "System Overview",
		blurb: "Platform health, configuration state, and recent administrative activity.",
	},
	users: {
		title: "Users & Roles",
		blurb: "Staff accounts, role assignment, and per-module access.",
	},
	auth: {
		title: "Authentication",
		blurb: "Sign-in methods, session policy, and multi-factor enforcement.",
	},
	cms: {
		title: "Content Management",
		blurb: "Brand identity, pages, collections, media, navigation and copy.",
	},
	notifications: {
		title: "System Notifications",
		blurb: "Templates, triggers, and delivery channels for automated messages.",
	},
	settings: {
		title: "System Configuration",
		blurb: "Regional defaults, integrations, and platform-wide preferences.",
	},
};

export function EnterpriseAdministration({ section = "system" }: { section?: AdminSection }) {
	const meta = SECTION_META[section];

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<p className="eyebrow">Platform administration</p>
				<h1 className="page-title mt-1">{meta.title}</h1>
				<p className="lead mt-2">{meta.blurb}</p>
			</div>

			{section === "system" && <SystemOverview />}
			{section === "users" && <UsersAndRoles />}
			{section === "auth" && <AuthSettings />}
			{section === "cms" && <CmsManager />}
			{section === "notifications" && <SystemNotifications />}
			{section === "settings" && <PlatformSettings />}
		</div>
	);
}

/* ─── System overview ─── */

interface HealthDetail {
	status: string;
	latencyMs: number;
	components: {
		database: { ok: boolean; ms: number | null };
		redis: { ok: boolean; ms: number | null };
		queues: { name: string; waiting: number; failed: number }[];
	};
	uptimeSeconds: number;
	node: string;
	timestamp: string;
}

function SystemOverview() {
	const { activityLog } = useOpsState();
	const [staffCount, setStaffCount] = useState<number | null>(null);
	const [activeStaff, setActiveStaff] = useState<number | null>(null);
	const [rolesCount, setRolesCount] = useState<number | null>(null);
	const [health, setHealth] = useState<HealthDetail | null>(null);
	const [auth, setAuth] = useState<AuthSettingsResponse | null>(null);
	const [deliveryLog, setDeliveryLog] = useState<NotificationLogItem[]>([]);
	const [auditEntries, setAuditEntries] = useState<{ id: string; at: string; actor: string; action: string; detail: string; ip: string }[]>([]);

	useEffect(() => {
		void (async () => {
			try {
				const [staffRes, rolesRes] = await Promise.all([
					staffApi.list().catch(() => ({ staff: [] })),
					apiFetch<{ roles: DynamicRole[] }>(`${API_PREFIX}/roles`).catch(() => ({ roles: [] })),
				]);
				setStaffCount(staffRes.staff.length);
				setActiveStaff(staffRes.staff.filter((s) => s.active).length);
				setRolesCount(rolesRes.roles?.length ?? 0);
			} catch {
				/* non-fatal */
			}
		})();
	}, []);

	// Measured, not declared: component state comes from the API's own
	// readiness checks — Postgres SELECT 1, a Redis ping, BullMQ job counts.
	useEffect(() => {
		const load = async () => {
			try {
				const res = await apiFetch<HealthDetail>(`/api/health/detail`);
				setHealth(res);
			} catch {
				setHealth(null);
			}
		};
		void load();
		const interval = window.setInterval(load, 30000);
		return () => window.clearInterval(interval);
	}, []);

	useEffect(() => {
		getAuthSettings().then(setAuth).catch(() => undefined);
		notificationsApi.log(8).then((r) => setDeliveryLog(r.notifications)).catch(() => undefined);
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const res = await apiFetch<{ entries: { id: string; at: string; actorEmail: string | null; action?: string; key: string; category?: string; ip?: string; newValueMasked?: string | null; target?: string | null }[] }>(`${API_PREFIX}/settings/admin-audit?limit=8`);
				setAuditEntries(
					res.entries.slice(0, 8).map((e) => ({
						id: e.id,
						at: e.at,
						actor: e.actorEmail ?? "system",
						action: e.action ?? e.key,
						detail: e.category ?? e.target ?? e.newValueMasked ?? "",
						ip: e.ip ?? "—",
					})),
				);
			} catch {
				/* non-fatal — audit endpoint may be unavailable */
			}
		})();
	}, []);

	const dbOk = health?.components.database.ok ?? null;
	const redisOk = health?.components.redis.ok ?? null;
	const queues = health?.components.queues ?? [];
	const waitingJobs = health ? queues.reduce((n, q) => n + q.waiting, 0) : null;
	const emailQueue = queues.find((q) => q.name === "email") ?? null;
	const apiOk = health !== null && health.status === "ok";

	const authRows: [string, string][] = auth
		? [
				["Portal sign-in", [auth.portal.email_password && "password", auth.portal.social_google && "Google", auth.portal.email_otp && "email OTP"].filter(Boolean).join(" + ") || "disabled"],
				["Portal MFA", auth.portal.mfa_required ? "required" : "optional"],
				["Ops sign-in", "password only"],
				["Ops MFA", auth.ops.mfa_required ? "enforced" : "optional"],
				["Staff", staffCount === null ? "—" : `${activeStaff ?? "—"} active of ${staffCount} · ${rolesCount ?? "—"} roles`],
			]
		: [];

	return (
		<>
			{/* Measured component cards — every number comes from /health/detail */}
			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "1.25rem", marginBottom: "2rem" }}>
				<HealthCard
					name="API"
					pill={health === null ? "unreachable" : apiOk ? "Up" : "Degraded"}
					pillTone={health === null ? "unknown" : apiOk ? "ok" : "warn"}
					big={health === null ? "no response" : <>{health.latencyMs}<small>ms</small></>}
					sub="/health/detail · measured just now"
					foot={health ? `node ${health.node} · up ${Math.floor(health.uptimeSeconds / 3600)}h${Math.floor((health.uptimeSeconds % 3600) / 60)}m` : "health endpoint did not answer"}
				/>
				<HealthCard
					name="Postgres"
					pill={dbOk === null ? "unknown" : dbOk ? "Connected" : "Down"}
					pillTone={dbOk === null ? "unknown" : dbOk ? "ok" : "warn"}
					big={dbOk === null ? "—" : dbOk ? <>{health?.components.database.ms ?? "?"}<small>ms</small></> : "no connection"}
					sub="readiness probe · SELECT 1"
					foot="Supabase Postgres"
				/>
				<HealthCard
					name="Redis / queues"
					pill={redisOk === null ? "unknown" : redisOk ? "Up" : "Down"}
					pillTone={redisOk === null ? "unknown" : redisOk ? "ok" : "warn"}
					big={redisOk === null ? "—" : <>{waitingJobs ?? 0}<small>&nbsp;waiting · {queues.length} queues</small></>}
					sub={queues.length > 0 ? queues.map((q) => q.name).join(" · ") : "queue depth unmeasured"}
					foot={redisOk === null ? "ping failed" : `BullMQ · ping ${health?.components.redis.ms ?? "?"}ms`}
				/>
				<HealthCard
					name="Email worker"
					pill={emailQueue === null ? "Unmeasured" : emailQueue.failed > 0 ? "Failing" : emailQueue.waiting > 0 ? "Working" : "Idle"}
					pillTone={emailQueue === null ? "unknown" : emailQueue.failed > 0 ? "warn" : "ok"}
					big={emailQueue === null ? "—" : <>{emailQueue.waiting}<small>&nbsp;waiting</small></>}
					sub={emailQueue === null ? "email queue not reporting" : `${emailQueue.failed} failed · via Resend`}
					foot={emailQueue === null ? "queue missing" : `${emailQueue.failed > 0 ? "drain blocked" : "draining normally"}`}
				/>
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "1.25rem", marginBottom: "2rem", alignItems: "start" }}>
				<div className="card" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
					<div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<h2 className="section-title" style={{ margin: 0, fontSize: "0.95rem" }}>Notifications — delivery log</h2>
						<Link to="/notifications" className="dash-link">full log →</Link>
					</div>
					{deliveryLog.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)", padding: "1rem 1.25rem" }}>No deliveries recorded yet.</p>
					) : (
						<div className="ops-table-wrap">
							<table className="admin-table">
								<thead>
									<tr>
										<th>Recipient</th>
										<th>Template</th>
										<th>Status</th>
										<th>Sent</th>
									</tr>
								</thead>
								<tbody>
									{deliveryLog.slice(0, 8).map((n) => (
										<tr key={n.id}>
											<td className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{n.recipient}</td>
											<td className="mono" style={{ fontSize: "var(--text-xs)" }}>{n.template ?? "—"}</td>
											<td>
												{n.status === "sent" ? (
													<span className="portal-pill" style={{ background: "var(--foreground)", color: "var(--background)" }}>Delivered</span>
												) : (
													<>
														<span className="portal-pill portal-pill--hollow" style={{ textDecoration: "underline", textDecorationStyle: "wavy" }}>Failed</span>
														{n.errorMessage && <div className="muted" style={{ fontSize: "0.65rem" }}>{n.errorMessage}</div>}
													</>
												)}
											</td>
											<td className="mono muted" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{new Date(n.sentAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
				<div className="card" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
					<div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<h2 className="section-title" style={{ margin: 0, fontSize: "0.95rem" }}>Configured — from the settings store</h2>
						<Link to="/settings" className="dash-link">edit → /settings</Link>
					</div>
					{authRows.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)", padding: "1rem 1.25rem" }}>Loading settings…</p>
					) : (
						<ul className="config-kv">
							{authRows.map(([label, value]) => (
								<li key={label}>
									<span className="config-kv__k">{label}</span>
									<span className="config-kv__v">{value}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Quick Actions</h2>
					<div className="admin-quick-actions">
						<Link to="/users" className="admin-quick-action">Manage users</Link>
						<Link to="/cms" className="admin-quick-action">Edit site content</Link>
						<Link to="/auth" className="admin-quick-action">Configure auth</Link>
						<Link to="/audit" className="admin-quick-action">View audit log</Link>
						<Link to="/settings" className="admin-quick-action">System config</Link>
						<Link to="/notifications" className="admin-quick-action">Notifications</Link>
					</div>
				</div>
				<div className="card">
					<h2 className="section-title mb-3">Recent Activity</h2>
					{activityLog.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)", padding: "1rem 0" }}>
							No recorded activity yet.
						</p>
					) : (
						<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
							{activityLog.slice(0, 6).map((e) => (
								<li key={e.id} style={{ padding: "0.7rem 0", borderBottom: "1px solid var(--border-light)" }}>
									<p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{e.action}</p>
									<p className="muted" style={{ fontSize: "var(--text-xs)" }}>{e.actor} · {e.detail}</p>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			{/* Audit preview — the unified trail, deepest detail on /audit */}
			<div className="card">
				<div className="admin-section-head" style={{ marginBottom: "1rem" }}>
					<div>
						<h2 className="section-title">Audit trail</h2>
						<p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: "0.25rem" }}>Latest recorded administrative events — <Link to="/audit" className="dash-link">full trail →</Link></p>
					</div>
				</div>
				<div style={{ overflowX: "auto" }}>
					<div className="ops-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Time</th>
									<th>Actor</th>
									<th>Action</th>
									<th>Detail</th>
									<th>IP</th>
								</tr>
							</thead>
							<tbody>
								{auditEntries.length === 0 ? (
									<tr>
										<td colSpan={5} className="muted" style={{ padding: "1rem", textAlign: "center" }}>No audit entries recorded yet.</td>
									</tr>
								) : auditEntries.map((e) => (
									<tr key={e.id}>
										<td className="admin-table__mono">{new Date(e.at).toLocaleString()}</td>
										<td style={{ fontWeight: 500 }}>{e.actor}</td>
										<td>{e.action}</td>
										<td className="muted">{e.detail}</td>
										<td className="admin-table__mono">{e.ip}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</>
	);
}

type StaffRow = {
	id: string;
	email: string;
	name: string;
	role: OpsRole;
	branch: string | null;
	active: boolean;
	hasLogin: boolean;
	mfaEnabled: boolean;
	lastSeenAt: string | null;
	ownedConversations: number;
	ownedCases: number;
	bookingsThisWeek?: number;
	canCoordinate: boolean;
	grantExpiresAt: string | null;
};

interface DynamicRole {
	id: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	/** Modules and capabilities, together. */
	permissions: string[];
	rank: number;
	createdAt: string;
	updatedAt: string;
}

function UsersAndRoles() {
	const { opsUser, opsRole, roleCatalog, refreshPermissions, hasCapability } = useOpsAuth();
	// The sub-tab and the selected role live in the URL so the matrix view is
	// linkable and survives a refresh — ?view=matrix&role=manager.
	const [params, setParams] = useSearchParams();
	const activeSubTab: "staff" | "matrix" | "invites" = params.get("view") === "matrix" || params.get("view") === "invites" ? (params.get("view") as "matrix" | "invites") : "staff";
	const selectedRoleId = params.get("role") ?? "super_admin";
	const setActiveSubTab = (id: "staff" | "matrix" | "invites") =>
		setParams((prev) => {
			const n = new URLSearchParams(prev);
			if (id === "staff") n.delete("view");
			else n.set("view", id);
			return n;
		});
	const setSelectedRoleId = (id: string) =>
		setParams((prev) => {
			const n = new URLSearchParams(prev);
			n.set("view", "matrix");
			n.set("role", id);
			return n;
		});
	const canManageRoles = hasCapability("manage_roles");
	const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
	const [unownedConvs, setUnownedConvs] = useState(0);
	const [revokingSessions, setRevokingSessions] = useState(false);
	const [roleFilter, setRoleFilter] = useState<string>("all");
	const [search, setSearch] = useState("");
	const [roleSearch, setRoleSearch] = useState("");
	const [moduleSearch, setModuleSearch] = useState("");
	const [staff, setStaff] = useState<StaffRow[]>([]);
	// Seeded from the auth context's copy so the matrix is not blank while
	// this page's own fetch is in flight; the fetch is the fresh one.
	const [roles, setRoles] = useState<DynamicRole[]>(roleCatalog);
	const [invitations, setInvitations] = useState<
		{ id: string; email: string; name: string | null; role: string; status: string; expiresAt: string; acceptUrl?: string }[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<string | null>(null);
	const [inviting, setInviting] = useState(false);
	const [createdInvite, setCreatedInvite] = useState<{
		email: string;
		name: string;
		role: string;
		acceptUrl: string;
	} | null>(null);
	const [copiedInvite, setCopiedInvite] = useState(false);
	const [editing, setEditing] = useState<StaffRow | null>(null);
	const [grantInfo, setGrantInfo] = useState<Awaited<ReturnType<typeof staffApi.coordinationGrant>> | null>(null);
	const [grantExpiry, setGrantExpiry] = useState("");
	const [creatingRole, setCreatingRole] = useState(false);
	const [draft, setDraft] = useState({ email: "", role: "consultant" as OpsRole, branch: "accra" });

	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmTitle, setConfirmTitle] = useState("");
	const [confirmMessage, setConfirmMessage] = useState("");
	const [confirmDanger, setConfirmDanger] = useState(false);
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [toast, setToast] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);

	const [newRoleDraft, setNewRoleDraft] = useState<{
		id: string;
		name: string;
		description: string;
		permissions: string[];
	}>({
		id: "",
		name: "",
		description: "",
		permissions: ["dashboard"],
	});

	// The server's rule: hold "invite staff", hand out only lower ranks (the
	// root role hands out anything). Read from the same roles the editor shows.
	const inviteable = useMemo(() => {
		if (!opsRole) return [] as OpsRole[];
		if (opsRole === "super_admin") return roles.map((r) => r.id as OpsRole);
		if (!hasCapability("invite_staff")) return [] as OpsRole[];
		const mine = roles.find((r) => r.id === opsRole)?.rank ?? 0;
		return roles.filter((r) => r.rank < mine).map((r) => r.id as OpsRole);
	}, [opsRole, roles, hasCapability]);

	const roleLabelMap = useMemo(() => {
		const map: Record<string, string> = { ...ROLE_LABELS };
		for (const r of roles) {
			map[r.id] = r.name;
		}
		return map;
	}, [roles]);

	const refresh = useCallback(async () => {
		setError(null);
		try {
			const [staffRes, inviteRes, rolesRes] = await Promise.all([
				staffApi.list(),
				staffApi.listInvitations().catch(() => ({ invitations: [] })),
				apiFetch<{ roles: DynamicRole[] }>(`${API_PREFIX}/roles`).catch(() => ({ roles: [] })),
			]);
			setStaff(
				staffRes.staff.map((s) => ({
					...s,
					role: s.role as OpsRole,
				})),
			);
			setUnownedConvs(staffRes.unownedConversations ?? 0);
			setInvitations(inviteRes.invitations);
			if (rolesRes.roles && rolesRes.roles.length > 0) {
				setRoles(rolesRes.roles);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load staff or roles");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// The grant's detail (who granted, when) is fetched when a staff record opens.
	useEffect(() => {
		if (!editing) { setGrantInfo(null); setGrantExpiry(""); return; }
		staffApi.coordinationGrant(editing.id).then(setGrantInfo).catch(() => setGrantInfo(null));
	}, [editing?.id]);

	const say = (msg: string) => {
		setFlash(msg);
		window.setTimeout(() => setFlash(null), 4000);
	};

	function _showToast(type: "error" | "success" | "info", message: string) {
		setToast({ type, message });
	}
	void _showToast;

	function confirm(title: string, message: string, action: () => void, danger = false) {
		setConfirmTitle(title);
		setConfirmMessage(message);
		setConfirmDanger(danger);
		setConfirmAction(() => action);
		setConfirmOpen(true);
	}

	async function submitInvite(e: React.FormEvent) {
		e.preventDefault();
		if (!draft.email.trim()) return;
		try {
			const created = await staffApi.createInvitation({
				email: draft.email.trim(),
				role: draft.role,
				branch: draft.branch,
			});
			let finalUrl = created.acceptUrl || "";
			if (finalUrl && typeof window !== "undefined") {
				try {
					const u = new URL(finalUrl);
					if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
						finalUrl = `${window.location.origin}${u.pathname}${u.search}`;
					}
				} catch {
					// fallback
				}
			}
			setCreatedInvite({
				email: created.email,
				name: "—",
				role: draft.role,
				acceptUrl: finalUrl,
			});
			if (finalUrl) {
				try {
					await navigator.clipboard.writeText(finalUrl);
					setCopiedInvite(true);
					window.setTimeout(() => setCopiedInvite(false), 2000);
				} catch {
					/* clipboard may be denied */
				}
			}
			setInviting(false);
			setDraft({ email: "", role: "consultant", branch: "accra" });
			await refresh();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not send invitation");
		}
	}

	async function saveEdit(e: React.FormEvent) {
		e.preventDefault();
		if (!editing) return;
		try {
			await staffApi.update(editing.id, {
				role: editing.role,
				branch: editing.branch,
				active: editing.active,
			});
			say(`${editing.name} updated.`);
			setEditing(null);
			await refresh();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not update staff");
		}
	}

	const [resendingId, setResendingId] = useState<string | null>(null);

	async function revoke(id: string) {
		try {
			await staffApi.revokeInvitation(id);
			say("Invitation withdrawn.");
			await refresh();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not revoke invitation");
		}
	}

	async function resend(id: string) {
		setResendingId(id);
		try {
			const created = await staffApi.resendInvitation(id);
			let finalUrl = created.acceptUrl || "";
			if (finalUrl && typeof window !== "undefined") {
				try {
					const u = new URL(finalUrl);
					if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
						finalUrl = `${window.location.origin}${u.pathname}${u.search}`;
					}
				} catch {
					// fallback
				}
			}
			setCreatedInvite({
				email: created.email,
				name: created.name ?? "—",
				role: created.role,
				acceptUrl: finalUrl,
			});
			say(`Invitation re-sent to ${created.email}.`);
			await refresh();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not resend invitation");
		} finally {
			setResendingId(null);
		}
	}

	async function togglePermission(roleId: string, module: OpsModule | Capability, enabled: boolean) {
		if (!canManageRoles) return;
		const target = roles.find((r) => r.id === roleId);
		if (!target || target.id === "super_admin") return;

		const current = target.permissions ?? [];
		const nextPermissions = enabled
			? [...new Set([...current, module])]
			: current.filter((m) => m !== module);

		// Optimistic update
		setRoles((prev) =>
			prev.map((r) => (r.id === roleId ? { ...r, permissions: nextPermissions } : r)),
		);

		try {
			const saved = await apiFetch<DynamicRole>(`${API_PREFIX}/roles/${roleId}`, {
				method: "PUT",
				body: JSON.stringify({ permissions: nextPermissions }),
			});
			setRoles((prev) => prev.map((r) => (r.id === roleId ? saved : r)));
			void refreshPermissions();
			say(`Updated ${target.name} permissions for ${module}.`);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to update permission");
			void refresh();
		}
	}

	async function bulkSetRolePermissions(roleId: string, moduleIds: string[], grant: boolean) {
		if (!canManageRoles) return;
		const target = roles.find((r) => r.id === roleId);
		if (!target || target.id === "super_admin") return;

		const current = new Set(target.permissions ?? []);
		for (const m of moduleIds) {
			if (grant) current.add(m);
			else current.delete(m);
		}
		const nextPermissions = Array.from(current);

		setRoles((prev) =>
			prev.map((r) => (r.id === roleId ? { ...r, permissions: nextPermissions } : r)),
		);

		try {
			const saved = await apiFetch<DynamicRole>(`${API_PREFIX}/roles/${roleId}`, {
				method: "PUT",
				body: JSON.stringify({ permissions: nextPermissions }),
			});
			setRoles((prev) => prev.map((r) => (r.id === roleId ? saved : r)));
			void refreshPermissions();
			say(`Updated ${target.name} permissions.`);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to update permissions");
			void refresh();
		}
	}

	async function saveRank(roleId: string, rank: number) {
		if (!Number.isInteger(rank) || rank < 1 || rank > 99) {
			setError("Rank must be a whole number between 1 and 99.");
			return;
		}
		// The server's rule: below your own rank (the root role exempt).
		if (opsRole !== "super_admin" && rank >= (roles.find((r) => r.id === opsRole)?.rank ?? 0)) {
			setError("A role cannot be ranked at or above your own.");
			return;
		}
		try {
			const saved = await apiFetch<DynamicRole>(`${API_PREFIX}/roles/${roleId}`, { method: "PUT", body: JSON.stringify({ rank }) });
			setRoles((prev) => prev.map((r) => (r.id === roleId ? saved : r)));
			void refreshPermissions();
			say("Rank saved.");
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to save the rank");
		}
	}

	// One write, one audit entry: the built-in list replaces whatever is there.
	async function handleResetRoleDefaults(roleId: string) {
		const def = roles.find((r) => r.id === roleId)?.isSystem ? defaultPermissionsOf(roleId as SystemRole) : null;
		const target = roles.find((r) => r.id === roleId);
		if (!def || !target) return;
		setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, permissions: def } : r)));
		try {
			const saved = await apiFetch<DynamicRole>(`${API_PREFIX}/roles/${roleId}`, {
				method: "PUT",
				body: JSON.stringify({ permissions: def }),
			});
			setRoles((prev) => prev.map((r) => (r.id === roleId ? saved : r)));
			void refreshPermissions();
			say(`${target.name} reset to system defaults.`);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to reset permissions");
			void refresh();
		}
	}

	const ROLE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
	const normalizedRoleId = newRoleDraft.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
	const roleIdTaken = roles.some((r) => r.id === normalizedRoleId);
	const roleIdError = !newRoleDraft.id.trim()
		? null
		: !ROLE_ID_RE.test(normalizedRoleId)
			? "At least 2 characters — lowercase letters, digits, _ and -, starting with a letter or digit."
			: roleIdTaken
				? "That slug is already taken by another role."
				: null;

	async function handleCreateRole(e: React.FormEvent) {
		e.preventDefault();
		if (!newRoleDraft.name.trim() || !newRoleDraft.id.trim() || roleIdError) return;

		try {
			await apiFetch(`${API_PREFIX}/roles`, {
				method: "POST",
				body: JSON.stringify({
					id: normalizedRoleId,
					name: newRoleDraft.name.trim(),
					description: newRoleDraft.description.trim() || undefined,
					// Ceiling: never hand out a permission the creator does not hold.
					permissions: ceilingFilter(newRoleDraft.permissions),
				}),
			});
			say(`Custom role "${newRoleDraft.name}" created successfully.`);
			void refreshPermissions();
			setCreatingRole(false);
			setNewRoleDraft({ id: "", name: "", description: "", permissions: ["dashboard"] });
			await refresh();
			setSelectedRoleId(normalizedRoleId);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to create role");
		}
	}

	async function handleDeleteRole(roleId: string, roleName: string) {
		confirm(
			`Delete role "${roleName}"?`,
			"This action cannot be undone. All staff assigned to this role will need to be reassigned.",
			async () => {
				try {
					await apiFetch(`${API_PREFIX}/roles/${roleId}`, { method: "DELETE" });
					void refreshPermissions();
					say(`Role "${roleName}" deleted.`);
					setSelectedRoleId("super_admin");
					await refresh();
				} catch (err) {
					setError(err instanceof ApiError ? err.message : "Failed to delete role");
				}
			},
			true,
		);
	}

	// The schema is the single source of truth — MODULE_GROUPS is checked
	// against it at load, and counts run off this list, never a hand count.
	const allModuleIds = useMemo(() => [...ALL_OPS_MODULES], []);
	const moduleIdSet = useMemo(() => new Set<string>(ALL_OPS_MODULES), []);
	const capabilityIdSet = useMemo(() => new Set<string>(capabilitySchema.options), []);
	const moduleCountOf = useCallback((perms: readonly string[] | undefined) => (perms ?? []).filter((p) => moduleIdSet.has(p)).length, [moduleIdSet]);
	const capCountOf = useCallback((perms: readonly string[] | undefined) => (perms ?? []).filter((p) => capabilityIdSet.has(p)).length, [capabilityIdSet]);
	// What the signed-in role holds — the ceiling a template copy or a new
	// role may hand out (the server enforces the same subset rule).
	const myPermissions = useMemo(() => {
		if (opsRole === "super_admin") return null; // unlimited
		return new Set(roles.find((r) => r.id === opsRole)?.permissions ?? []);
	}, [opsRole, roles]);
	const ceilingFilter = useCallback(
		(perms: readonly string[]) => (myPermissions === null ? [...perms] : perms.filter((p) => myPermissions.has(p))),
		[myPermissions],
	);

	const filteredModuleGroups = useMemo(() => {
		if (!moduleSearch.trim()) return MODULE_GROUPS;
		const q = moduleSearch.toLowerCase();
		return MODULE_GROUPS.map((g) => ({
			...g,
			modules: g.modules.filter(
				(m) =>
					m.label.toLowerCase().includes(q) ||
					m.id.toLowerCase().includes(q) ||
					m.description.toLowerCase().includes(q) ||
					g.group.toLowerCase().includes(q),
			),
		})).filter((g) => g.modules.length > 0);
	}, [moduleSearch]);

	// The one search field filters both lists — modules and capabilities.
	const filteredCapabilities = useMemo(() => {
		if (!moduleSearch.trim()) return CAPABILITIES;
		const q = moduleSearch.toLowerCase();
		return CAPABILITIES.filter(
			(c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
		);
	}, [moduleSearch]);

	const filteredRoles = useMemo(() => {
		if (!roleSearch.trim()) return roles;
		const q = roleSearch.toLowerCase();
		return roles.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
	}, [roles, roleSearch]);

	const selectedRole = useMemo(() => {
		return roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null;
	}, [roles, selectedRoleId]);

	const selectedRoleStats = useMemo(() => {
		const total = allModuleIds.length;
		// Modules only — counting capabilities against the module total put a
		// manager at "38 / 30 modules (127 %)".
		const count = !selectedRole ? 0 : selectedRole.id === "super_admin" ? total : moduleCountOf(selectedRole.permissions);
		const caps = !selectedRole ? 0 : selectedRole.id === "super_admin" ? CAPABILITIES.length : capCountOf(selectedRole.permissions);
		const pct = total > 0 ? Math.round((count / total) * 100) : 0;
		return { count, total, caps, pct };
	}, [selectedRole, allModuleIds, moduleCountOf, capCountOf]);

	const rows = useMemo(() => {
		return staff.filter(
			(u) =>
				(roleFilter === "all" || u.role === roleFilter) &&
				(search === "" ||
					u.name.toLowerCase().includes(search.toLowerCase()) ||
					u.email.toLowerCase().includes(search.toLowerCase())),
		);
	}, [staff, roleFilter, search]);

	const staffOnRole = useCallback((roleId: string) => staff.filter((u) => u.role === roleId).length, [staff]);

	const pending = useMemo(() => {
		return invitations.filter((i) => i.status === "PENDING");
	}, [invitations]);

	// Pending invites render as table rows too — the directory is everyone who
	// could hold a login, not just everyone who has used one.
	const pendingRows = useMemo(() => {
		const q = search.toLowerCase().trim();
		return pending.filter(
			(i) =>
				(roleFilter === "all" || i.role === roleFilter) &&
				(!q || (i.name ?? "").toLowerCase().includes(q) || i.email.toLowerCase().includes(q)),
		);
	}, [pending, roleFilter, search]);

	const activeThisWeek = useMemo(() => {
		const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
		return staff.filter((s) => s.lastSeenAt && new Date(s.lastSeenAt).getTime() > cutoff).length;
	}, [staff]);

	const branchesCovered = useMemo(
		() => new Set(staff.map((s) => s.branch).filter(Boolean)).size,
		[staff],
	);

	const selectedStaff = useMemo(
		() => (selectedStaffId ? (staff.find((s) => s.id === selectedStaffId) ?? null) : null),
		[staff, selectedStaffId],
	);

	const moduleCountFor = useCallback(
		(roleId: string) => {
			if (roleId === "super_admin") return allModuleIds.length;
			return moduleCountOf(roles.find((r) => r.id === roleId)?.permissions);
		},
		[roles, allModuleIds, moduleCountOf],
	);

	async function revokeAllSessions(u: StaffRow) {
		setRevokingSessions(true);
		try {
			const r = await staffApi.revokeAllSessions(u.id);
			say(`Signed ${u.name} out everywhere — ${r.revokedCount} session(s) revoked.`);
			await refresh();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not revoke sessions");
		} finally {
			setRevokingSessions(false);
		}
	}

	return (
		<>
			{flash ? <div className="admin-flash admin-flash--ok" role="status">✓ {flash}</div> : null}
			{error ? <p className="ops-modal__error" role="alert">{error}</p> : null}

			{/* Statstrip — who can sign in, who holds the work, what's uncovered */}
			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span className="dash-day__cut"><strong>{staff.length}</strong> staff</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{activeThisWeek}</strong> active this week</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{roles.length}</strong> roles</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{branchesCovered}</strong> branches covered</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{unownedConvs}</strong> conversations unowned</span>
				<Link to="/clients" className="dash-link" style={{ marginLeft: "auto" }}>clients → /clients</Link>
			</div>

			{/* Chip sub-tabs */}
			<div className="cn-scaffold__filters cn-scaffold__filters--row" style={{ border: "1px solid var(--border-light)", marginBottom: "1.5rem" }}>
				<div className="cn-scaffold__chips" role="tablist" aria-label="Staff sections">
					{([
						["staff", "Directory", staff.length],
						["matrix", "Roles & permissions", null],
						["invites", `Invites`, pending.length],
					] as const).map(([id, label, n]) => {
						const on = activeSubTab === id;
						return (
							<button
								key={id}
								type="button"
								role="tab"
								aria-selected={on}
								className="ops-pill"
								onClick={() => setActiveSubTab(id)}
								style={{
									cursor: "pointer",
									marginLeft: 0,
									border: "1px solid var(--border)",
									background: on ? "var(--foreground)" : "transparent",
									color: on ? "var(--background)" : "var(--foreground)",
								}}
							>
								{label}
								{n !== null && n !== undefined ? (
									<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
										{id === "invites" ? `${n} pending` : n}
									</span>
								) : null}
							</button>
						);
					})}
					<Link
						to="/clients"
						className="ops-pill"
						style={{
							marginLeft: 0,
							border: "1px dashed var(--border)",
							color: "var(--muted-foreground)",
							textDecoration: "none",
						}}
					>
						Clients → moved to /clients
					</Link>
				</div>
				{activeSubTab === "staff" && (
					<input
						type="search"
						placeholder="Search staff…"
						className="cn-search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						style={{ marginLeft: "auto" }}
					/>
				)}
			</div>

			{/* ── Sub-tab 1: Staff Directory ── */}
			{activeSubTab === "staff" && (
				<>
					<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
						<div className="admin-env-tabs">
							<button
								onClick={() => setRoleFilter("all")}
								className={`admin-env-tab${roleFilter === "all" ? " admin-env-tab--active" : ""}`}
							>
								All roles
							</button>
							{roles.map((r) => (
								<button
									key={r.id}
									onClick={() => setRoleFilter(r.id)}
									className={`admin-env-tab${roleFilter === r.id ? " admin-env-tab--active" : ""}`}
								>
									{r.name}
								</button>
							))}
						</div>
						<div className="admin-section-head__actions">
							{inviteable.length > 0 ? (
								<button className="btn btn--primary btn--sm" onClick={() => setInviting(true)}>+ Invite Staff</button>
							) : null}
						</div>
					</div>

					{inviting && (
						<div className="ops-modal-backdrop" onClick={() => setInviting(false)} role="dialog" aria-modal="true">
							<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "32rem" }}>
								<header className="ops-modal__head">
									<div>
										<p className="invite-card__eyebrow" style={{ margin: 0 }}>Staff Onboarding</p>
										<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>Invite Staff Member</h2>
										<p className="ops-modal__sub">Issue an onboarding invite link with assigned role and branch scope.</p>
									</div>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => setInviting(false)}>
										✕ Close
									</button>
								</header>

							<form onSubmit={submitInvite} className="invite-form" style={{ marginTop: "1rem" }}>
								<div className="field">
									<label htmlFor="inv-email">Work Email <span style={{ color: "#b00020" }}>*</span></label>
									<input
										id="inv-email"
										className="input input--full-border"
										type="email"
										placeholder="k.mensah@century-nit.com"
										value={draft.email}
										onChange={(e) => setDraft({ ...draft, email: e.target.value })}
										required
										autoFocus
									/>
								</div>

									<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
										<div className="field">
											<label htmlFor="inv-role">Assigned Role</label>
											<select
												id="inv-role"
												className="input input--full-border"
												value={(inviteable as string[]).includes(draft.role) ? draft.role : (inviteable[0] ?? draft.role)}
												onChange={(e) => setDraft({ ...draft, role: e.target.value as OpsRole })}
											>
												{roles.filter((r) => (inviteable as string[]).includes(r.id)).map((r) => (
													<option key={r.id} value={r.id}>{r.name}</option>
												))}
											</select>
										</div>

										<div className="field">
											<label htmlFor="inv-branch">Branch Scope</label>
											<select
												id="inv-branch"
												className="input input--full-border"
												value={draft.branch}
												onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
											>
												{OPS_BRANCHES.map((b) => (
													<option key={b.id} value={b.id}>{b.name}</option>
												))}
												<option value="platform">Platform</option>
											</select>
										</div>
									</div>

									<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => setInviting(false)}>
											Cancel
										</button>
										<button type="submit" className="btn btn--primary">
											Send Invitation
										</button>
									</div>
								</form>
							</div>
						</div>
					)}

					{createdInvite && (
						<div className="ops-modal-backdrop" onClick={() => setCreatedInvite(null)} role="dialog" aria-modal="true">
							<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "34rem" }}>
								<header className="ops-modal__head">
									<div>
										<p className="invite-card__eyebrow" style={{ margin: 0 }}>✓ Invitation Created</p>
										<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>Staff Invitation Link</h2>
										<p className="ops-modal__sub">
											Invitation for <strong>{createdInvite.name}</strong> ({createdInvite.email}) as <strong>{roleLabelMap[createdInvite.role] ?? createdInvite.role}</strong>.
										</p>
									</div>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreatedInvite(null)}>
										✕ Close
									</button>
								</header>

								<div style={{ marginTop: "1.25rem" }}>
									<p style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginBottom: "0.5rem" }}>
										An onboarding email has been queued. You can also copy and share this link directly with the staff member:
									</p>
									<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
										<input
											type="text"
											readOnly
											value={createdInvite.acceptUrl}
											className="input input--full-border mono"
											style={{ fontSize: "var(--text-xs)", width: "100%" }}
											onClick={(e) => (e.target as HTMLInputElement).select()}
										/>
										<button
											type="button"
											className="btn btn--primary btn--sm"
											style={{ whiteSpace: "nowrap" }}
											onClick={() => {
												void navigator.clipboard.writeText(createdInvite.acceptUrl);
												setCopiedInvite(true);
												window.setTimeout(() => setCopiedInvite(false), 2000);
											}}
										>
											{copiedInvite ? "Copied!" : "Copy Link"}
										</button>
									</div>
									<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
										<button type="button" className="btn btn--primary" onClick={() => setCreatedInvite(null)}>
											Done
										</button>
									</div>
								</div>
							</div>
						</div>
					)}

					{editing && (
						<div className="ops-modal-backdrop" onClick={() => setEditing(null)} role="dialog" aria-modal="true">
							<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "32rem" }}>
								<header className="ops-modal__head">
									<div>
										<p className="invite-card__eyebrow" style={{ margin: 0 }}>Staff Account</p>
										<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>Edit Staff Member</h2>
										<p className="ops-modal__sub">{editing.name} ({editing.email})</p>
									</div>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
										✕ Close
									</button>
								</header>

								<form onSubmit={saveEdit} className="invite-form" style={{ marginTop: "1rem" }}>
									<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
										<div className="field">
											<label htmlFor="edit-role">Role</label>
											<select
												id="edit-role"
												className="input input--full-border"
												value={editing.role}
												onChange={(e) => setEditing({ ...editing, role: e.target.value as OpsRole })}
												disabled={editing.email === opsUser?.email}
											>
												{roles.map((r) => (
													<option key={r.id} value={r.id}>{r.name}</option>
												))}
											</select>
											{editing.email === opsUser?.email && (
												<p className="field__hint">You cannot modify your own role.</p>
											)}
										</div>

										<div className="field">
											<label htmlFor="edit-branch">Branch</label>
											<select
												id="edit-branch"
												className="input input--full-border"
												value={editing.branch ?? ""}
												onChange={(e) => setEditing({ ...editing, branch: e.target.value || null })}
											>
												{OPS_BRANCHES.map((b) => (
													<option key={b.id} value={b.id}>{b.name}</option>
												))}
												<option value="platform">Platform</option>
											</select>
										</div>
									</div>

									<div className="field" style={{ marginTop: "1rem" }}>
										<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
											<input
												type="checkbox"
												checked={editing.active}
												disabled={editing.email === opsUser?.email}
												onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
											/>
											<strong>Active Staff Account</strong>
										</label>
										<p className="field__hint">Inactive accounts are blocked from logging into the platform.</p>
									</div>

									{/* Standing case-oversight: the authority layer under delegation.
									    Granted staff can hold cases at any scope until retracted. */}
									<div className="field" style={{ marginTop: "1rem", borderTop: "1px solid var(--border-light)", paddingTop: "1rem" }}>
										<label><strong>Case coordination</strong></label>
										{grantInfo?.active ? (
											<>
												<p className="field__hint">
													Granted{grantInfo.grantedByName ? ` by ${grantInfo.grantedByName}` : ""}
													{grantInfo.expiresAt ? ` — expires ${grantInfo.expiresAt.slice(0, 10)}` : " — open-ended"}.
													They can hold delegated cases at any scope.
												</p>
												<button
													type="button"
													className="btn btn--ghost btn--sm"
													style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
													onClick={() => {
														void staffApi.revokeCoordination(editing.id)
															.then((r) => {
																say(`Access retracted${r.reclaimedCases ? ` — ${r.reclaimedCases} case(s) returned to the pool` : ""}.`);
																setGrantInfo({ active: false, grantedAt: null, expiresAt: null, grantedByName: null });
																void refresh();
															})
															.catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not retract access"));
													}}
												>
													Retract access — their cases return to the pool
												</button>
											</>
										) : (
											<>
												<p className="field__hint">
													Grant standing case-oversight so they can be delegated cases — until you retract it{grantExpiry ? " or the date lapses" : ""}.
												</p>
												<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
													<input
														type="date"
														className="input"
														style={{ maxWidth: "11rem" }}
														value={grantExpiry}
														min={new Date().toISOString().slice(0, 10)}
														onChange={(e) => setGrantExpiry(e.target.value)}
														aria-label="Grant expiry (optional)"
													/>
													<button
														type="button"
														className="btn btn--primary btn--sm"
														onClick={() => {
															void staffApi.grantCoordination(editing.id, grantExpiry ? `${grantExpiry}T23:59:59Z` : null)
																.then((g) => {
																	say(`${editing.name} can now coordinate cases${g.expiresAt ? ` until ${g.expiresAt.slice(0, 10)}` : ""}.`);
																	setGrantInfo(g);
																	void refresh();
																})
																.catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not grant access"));
														}}
													>
														Grant access{grantExpiry ? "" : " — open-ended"}
													</button>
												</div>
											</>
										)}
									</div>

									<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
											Cancel
										</button>
										<button type="submit" className="btn btn--primary">
											Save Changes
										</button>
									</div>
								</form>
							</div>
						</div>
					)}

					<div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "2rem" }}>
						<div className="ops-table-wrap">
							<table className="admin-table">
								<thead>
									<tr>
										<th>Staff</th>
										<th>Role</th>
										<th>Branch</th>
										<th>Presence</th>
										<th>MFA</th>
										<th>Owns</th>
										<th>Modules</th>
										<th style={{ textAlign: "right" }}></th>
									</tr>
								</thead>
								<tbody>
									{loading ? (
										<tr><td colSpan={8} className="muted" style={{ padding: "2rem", textAlign: "center" }}>Loading…</td></tr>
									) : rows.length === 0 && pendingRows.length === 0 ? (
										<tr><td colSpan={8} className="muted" style={{ padding: "2rem", textAlign: "center" }}>No staff members match criteria.</td></tr>
									) : (
										<>
											{rows.map((u) => {
												const on = selectedStaffId === u.id;
												return (
													<tr
														key={u.id}
														className={`cl-tr${on ? " cl-tr--on" : ""}`}
														role="button"
														tabIndex={0}
														onClick={() => setSelectedStaffId(on ? null : u.id)}
														onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedStaffId(on ? null : u.id); }}
													>
														<td>
															<div style={{ fontWeight: 600 }}>
																{u.name}
																{u.email === opsUser?.email && (
																	<span className="mono" style={{ fontSize: "0.6rem", marginLeft: "0.4rem", color: "var(--muted-foreground)" }}>YOU</span>
																)}
															</div>
															<div className="muted" style={{ fontSize: "var(--text-xs)" }}>{u.email}</div>
														</td>
														<td>
															<span className={`portal-pill${u.active ? "" : " portal-pill--hollow"}`} style={u.active ? { background: "var(--foreground)", color: "var(--background)" } : undefined}>
																{roleLabelMap[u.role] ?? u.role}
															</span>
														</td>
														<td className="muted" style={{ fontSize: "var(--text-xs)" }}>{staffBranchName(u.branch ?? "")}</td>
														<td className="muted" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
															{u.hasLogin ? formatPresence(u.lastSeenAt) : "no login"}
														</td>
														<td className="muted" style={{ fontSize: "var(--text-xs)" }}>
															{u.mfaEnabled ? "✓" : u.hasLogin ? "—" : "—"}
															{u.canCoordinate && (
																<span
																	className="mono"
																	title={u.grantExpiresAt ? `Case oversight granted until ${u.grantExpiresAt.slice(0, 10)}` : "Standing case-oversight grant"}
																	style={{ fontSize: "0.6rem", marginLeft: "0.4rem", border: "1px solid var(--border)", padding: "0.05rem 0.25rem" }}
																>
																	COORD
																</span>
															)}
														</td>
														<td className="mono muted" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
															{u.ownedConversations + u.ownedCases > 0 ? `${u.ownedConversations} convs · ${u.ownedCases} cases` : "—"}
														</td>
														<td className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
															{moduleCountFor(u.role)}/{allModuleIds.length}
														</td>
														<td style={{ textAlign: "right" }}>
															<span className="dash-link">{on ? "close ↑" : "record →"}</span>
														</td>
													</tr>
												);
											})}
											{pendingRows.map((i) => (
												<tr key={`inv-${i.id}`}>
													<td>
														<div style={{ fontWeight: 600 }}>{i.name ?? "—"}</div>
														<div className="muted" style={{ fontSize: "var(--text-xs)" }}>{i.email}</div>
													</td>
													<td><span className="portal-pill portal-pill--hollow">Invited</span></td>
													<td className="muted" style={{ fontSize: "var(--text-xs)" }}>—</td>
													<td className="muted" style={{ fontSize: "var(--text-xs)" }}>never signed in</td>
													<td className="muted" style={{ fontSize: "var(--text-xs)" }}>—</td>
													<td className="muted" style={{ fontSize: "var(--text-xs)" }}>—</td>
													<td className="muted" style={{ fontSize: "var(--text-xs)" }}>—</td>
													<td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
														<button className="dash-link" style={{ background: "none", border: 0, cursor: "pointer" }} disabled={resendingId === i.id} onClick={() => void resend(i.id)}>
															{resendingId === i.id ? "sending…" : "resend"}
														</button>
														{" · "}
														<button className="dash-link" style={{ background: "none", border: 0, cursor: "pointer", textDecorationStyle: "wavy" }} onClick={() => void revoke(i.id)}>
															revoke
														</button>
													</td>
												</tr>
											))}
										</>
									)}
								</tbody>
							</table>
						</div>
					</div>

					{/* Selected record — matrix on the left, their rail on the right */}
					{selectedStaff && (
						<div className="cl-split" style={{ marginBottom: "2rem" }}>
							<div className="card" style={{ padding: 0, overflow: "hidden", flex: 1, minWidth: 0 }}>
								<div style={{ padding: "0.85rem 1.1rem", borderBottom: "var(--hairline)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
									<h2 className="section-title" style={{ margin: 0, fontSize: "0.95rem" }}>Role matrix — {roleLabelMap[selectedStaff.role] ?? selectedStaff.role}</h2>
									<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{moduleCountFor(selectedStaff.role)}/{allModuleIds.length} modules</span>
								</div>
								<div className="ops-table-wrap" style={{ maxHeight: "26rem", overflowY: "auto" }}>
									<table className="admin-table">
										<thead>
											<tr>
												<th>Module</th>
												{roles.map((r) => (
													<th key={r.id} style={{ textAlign: "center" }}>{r.name}</th>
												))}
											</tr>
										</thead>
										<tbody>
											{MODULE_GROUPS.map((g) => (
												<>
													{g.modules.map((m, mi) => (
														<tr key={m.id}>
															<td style={{ fontWeight: 500, fontSize: "var(--text-xs)" }}>
																{mi === 0 && <span className="mono muted" style={{ fontSize: "0.6rem", display: "block" }}>{g.group}</span>}
																{m.label}
															</td>
															{roles.map((r) => {
																const has = r.id === "super_admin" || (r.permissions ?? []).includes(m.id);
																return (
																	<td key={r.id} style={{ textAlign: "center" }}>
																		<input
																			type="checkbox"
																			checked={has}
																			disabled={r.id === "super_admin" || !hasCapability("manage_roles")}
																			onChange={(e) => void togglePermission(r.id, m.id, e.target.checked)}
																			style={r.id === selectedStaff.role ? { outline: "2px solid var(--foreground)", outlineOffset: 1 } : undefined}
																		/>
																	</td>
																);
															})}
														</tr>
													))}
												</>
											))}
										</tbody>
									</table>
								</div>
							</div>

							<aside className="cl-record">
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
									<div>
										<p className="eyebrow" style={{ margin: 0 }}>Staff record</p>
										<h3 style={{ margin: "0.3rem 0 0", fontSize: "1.05rem", fontWeight: 800 }}>{selectedStaff.name}</h3>
										<p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "var(--text-xs)" }}>{selectedStaff.email}</p>
									</div>
									<button type="button" className="btn btn--xs btn--ghost" onClick={() => setSelectedStaffId(null)}>✕</button>
								</div>

								<p className="cl-sec">Account</p>
								<div className="cl-kv"><span className="cl-kv__k">Role</span><span>{roleLabelMap[selectedStaff.role] ?? selectedStaff.role}{roles.find((r) => r.id === selectedStaff.role)?.rank != null ? ` · rank ${roles.find((r) => r.id === selectedStaff.role)!.rank}` : ""}</span></div>
								<div className="cl-kv"><span className="cl-kv__k">Branch</span><span>{staffBranchName(selectedStaff.branch ?? "")}</span></div>
								<div className="cl-kv"><span className="cl-kv__k">MFA</span><span>{selectedStaff.mfaEnabled ? "enrolled" : selectedStaff.hasLogin ? "not enrolled" : "no login"}</span></div>
								<div className="cl-kv"><span className="cl-kv__k">Last seen</span><span>{selectedStaff.hasLogin ? formatPresence(selectedStaff.lastSeenAt) : "never signed in"}</span></div>

								<p className="cl-sec">Load</p>
								<div className="cl-kv"><span className="cl-kv__k">Owns</span><span>{selectedStaff.ownedConversations} conversations</span></div>
								<div className="cl-kv"><span className="cl-kv__k">Cases</span><span>{selectedStaff.ownedCases} assigned</span></div>
								<div className="cl-kv"><span className="cl-kv__k">Bookings</span><span>{selectedStaff.bookingsThisWeek ?? "—"} this week</span></div>

								<div className="cl-danger">
									<p className="cl-danger__h">Access</p>
									<div className="cl-kv">
										<span className="cl-kv__k">Sessions</span>
										<span>
											<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} disabled={revokingSessions || !selectedStaff.hasLogin} onClick={() => void revokeAllSessions(selectedStaff)}>
												{revokingSessions ? "revoking…" : "revoke all"}
											</button>
										</span>
									</div>
									<div className="cl-kv">
										<span className="cl-kv__k">Account</span>
										<span>
											<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => { setEditing(selectedStaff); }}>
												edit…
											</button>
											{selectedStaff.active && selectedStaff.email !== opsUser?.email && (
												<>
													{" · "}
													<button
														type="button"
														className="dash-link"
														style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecorationStyle: "wavy" }}
														onClick={() =>
															confirm(
																`Deactivate ${selectedStaff.name}?`,
																"They will be blocked from the console until reactivated. Their owned work is not reassigned.",
																async () => {
																	await staffApi.update(selectedStaff.id, { active: false });
																	say(`${selectedStaff.name} deactivated.`);
																	setSelectedStaffId(null);
																	await refresh();
																},
																true,
															)
														}
													>
														deactivate
													</button>
												</>
											)}
											{selectedStaff.email !== opsUser?.email && (
												<>
													{" · "}
													<button
														type="button"
														className="dash-link"
														style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecorationStyle: "wavy" }}
														onClick={() =>
															confirm(
																`Delete ${selectedStaff.name}?`,
																"Their staff record and console login are permanently removed — this cannot be undone. Cases and consultations they touched keep the work, unassigned.",
																async () => {
																	await staffApi.deleteStaff(selectedStaff.id);
																	say(`${selectedStaff.name} deleted.`);
																	setSelectedStaffId(null);
																	await refresh();
																},
																true,
															)
														}
													>
														delete
													</button>
												</>
											)}
										</span>
									</div>
								</div>
							</aside>
						</div>
					)}
				</>
			)}

			{/* ── Sub-tab 2: Pending invitations ── */}
			{activeSubTab === "invites" && pending.length > 0 ? (
						<div className="card" style={{ marginBottom: "2rem" }}>
							<h2 className="section-title mb-3">Pending invitations</h2>
							<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
								{pending.map((i) => (
									<li key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", padding: "0.6rem 0", borderBottom: "1px solid var(--border-light)" }}>
										<div>
											<strong>{i.name ?? i.email}</strong> <span className="muted">{i.email}</span>
											<p className="muted" style={{ margin: 0 }}>
												{roleLabelMap[i.role] ?? i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
											</p>
										</div>
										<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
											<button
												type="button"
												className="btn btn--primary btn--sm"
												disabled={resendingId === i.id}
												onClick={() => resend(i.id)}
											>
												{resendingId === i.id ? "Sending..." : "Resend"}
											</button>
											<button type="button" className="btn btn--ghost btn--sm" onClick={() => revoke(i.id)}>
												Revoke
											</button>
										</div>
									</li>
								))}
							</ul>
						</div>
					) : null}

			{activeSubTab === "invites" && pending.length === 0 && !loading ? (
				<div className="card" style={{ marginBottom: "2rem", padding: "2rem", textAlign: "center" }}>
					<p className="muted" style={{ margin: 0 }}>No pending invitations. Use Invite staff to send one.</p>
				</div>
			) : null}

			{/* ── Sub-tab 3: Master-Detail Roles & Permissions ── */}
			{activeSubTab === "matrix" && (
				<div className="perm-master-detail">
					{/* Left Column: Role Selector Nav */}
					<div>
						<div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
								<h3 className="section-title" style={{ fontSize: "0.95rem", margin: 0 }}>
									Roles ({roles.length})
								</h3>
								<button
									type="button"
									className="btn btn--primary btn--sm"
									style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }}
									disabled={!canManageRoles}
									title={canManageRoles ? undefined : "Your role cannot manage roles"}
									onClick={() => setCreatingRole(true)}
								>
									+ Add Role
								</button>
							</div>

							<input
								type="search"
								placeholder="Filter roles..."
								className="input input--sm input--full-border"
								style={{ width: "100%", marginBottom: "0.75rem" }}
								value={roleSearch}
								onChange={(e) => setRoleSearch(e.target.value)}
							/>

							<div className="perm-role-nav">
								{filteredRoles.map((r) => {
									const isSuper = r.id === "super_admin";
									const isSelected = r.id === selectedRoleId;
									const mods = isSuper ? allModuleIds.length : moduleCountOf(r.permissions);
									const caps = isSuper ? CAPABILITIES.length : capCountOf(r.permissions);
									const stats = { count: mods, total: allModuleIds.length, pct: Math.round((mods / (allModuleIds.length || 1)) * 100) };
									const staffCount = staffOnRole(r.id);

									return (
										<button
											key={r.id}
											type="button"
											className={`perm-role-nav-item${isSelected ? " perm-role-nav-item--active" : ""}`}
											onClick={() => {
												setSelectedRoleId(r.id);
												setModuleSearch("");
											}}
										>
											<div className="perm-role-nav-item__head">
												<strong style={{ fontSize: "var(--text-sm)" }}>
													{isSuper ? "👑 " : ""}{r.name}
												</strong>
												<span
													style={{
														fontSize: "0.6rem",
														fontFamily: "var(--font-mono)",
														textTransform: "uppercase",
														padding: "0.1rem 0.35rem",
														border: "var(--thin)",
														background: isSuper ? "var(--foreground)" : r.isSystem ? "var(--muted, #f0f0f0)" : "var(--foreground)",
														color: isSuper ? "var(--background)" : r.isSystem ? "var(--foreground)" : "var(--background)",
													}}
												>
													{isSuper ? "Root Default" : r.isSystem ? "System" : "Custom"}
												</span>
											</div>

											<div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-xs)", marginTop: "0.35rem" }}>
												<span className="muted">{staffCount} staff</span>
												<span className="mono muted">{stats.count}/{stats.total} modules · {caps} caps</span>
											</div>

											<div className="perm-progress-bar" style={{ marginTop: "0.35rem" }}>
												<div className="perm-progress-fill" style={{ width: `${stats.pct}%` }} />
											</div>
										</button>
									);
								})}
							</div>
						</div>
					</div>

					{/* Right Column: Focused Permissions Panel for Selected Role */}
					{selectedRole && <div>
						{/* Selected Role Header Card */}
						<div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.25rem" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
								<div>
									<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
										{selectedRole.id === "super_admin" && <span style={{ fontSize: "1.2rem" }}>👑</span>}
										<h2 className="section-title" style={{ margin: 0, fontSize: "1.25rem" }}>
											{selectedRole.name}
										</h2>
										<span
											style={{
												fontSize: "0.65rem",
												fontFamily: "var(--font-mono)",
												textTransform: "uppercase",
												padding: "0.15rem 0.45rem",
												border: "var(--thin)",
												background: selectedRole.id === "super_admin" ? "var(--foreground)" : "transparent",
												color: selectedRole.id === "super_admin" ? "var(--background)" : "var(--foreground)",
											}}
										>
											{selectedRole.id === "super_admin" ? "Root System Role" : selectedRole.isSystem ? "Built-in System Role" : "Custom Role"}
										</span>
									</div>
									<p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "var(--text-sm)" }}>
										{selectedRole.description || "Custom operational role."}
									</p>
									<code className="mono muted" style={{ fontSize: "0.75rem", display: "inline-block", marginTop: "0.35rem" }}>
										role_id: {selectedRole.id}
									</code>
								</div>

								{selectedRole.id !== "super_admin" && canManageRoles && (
									<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
										<button
											type="button"
											className="perm-quick-btn"
											onClick={() =>
												confirm(
													`Grant all ${allModuleIds.length} modules to "${selectedRole.name}"?`,
													`Every page becomes visible to this role — capabilities are not granted here. ${staffOnRole(selectedRole.id)} staff member(s) currently hold it.`,
													() => void bulkSetRolePermissions(selectedRole.id, allModuleIds, true),
												)
											}
										>
											Grant all modules ({allModuleIds.length})
										</button>
										<button
											type="button"
											className="perm-quick-btn"
											onClick={() =>
												confirm(
													`Revoke every permission from "${selectedRole.name}"?`,
													`All ${allModuleIds.length} modules and every capability are removed — staff on it see an empty console. ${staffOnRole(selectedRole.id)} staff member(s) currently hold it.`,
													() => void bulkSetRolePermissions(selectedRole.id, [...allModuleIds, ...CAPABILITIES.map((c) => c.id)], false),
													true,
												)
											}
										>
											Revoke everything
										</button>
										{selectedRole.isSystem && (
											<button
												type="button"
												className="perm-quick-btn"
												onClick={() =>
													confirm(
														`Reset "${selectedRole.name}" to system defaults?`,
														`Replaces its current permission list with the factory one. ${staffOnRole(selectedRole.id)} staff member(s) currently hold it.`,
														() => void handleResetRoleDefaults(selectedRole.id),
													)
												}
												title="Reset to factory system defaults"
											>
												Reset Defaults
											</button>
										)}
										{!selectedRole.isSystem && (
											<button
												type="button"
												className="perm-quick-btn"
												style={{ color: "#c0392b", borderColor: "#c0392b" }}
												onClick={() => handleDeleteRole(selectedRole.id, selectedRole.name)}
											>
												Delete Role
											</button>
										)}
									</div>
								)}
							</div>

							{selectedRole.id === "super_admin" ? (
								<div
									style={{
										marginTop: "1rem",
										padding: "0.75rem 1rem",
										background: "var(--surface-subtle, #f6f6f6)",
										borderLeft: "3px solid var(--foreground)",
										fontSize: "var(--text-xs)",
									}}
								>
									<strong>Root Authority:</strong> System Administrator always retains full, un-revocable permissions across all {allModuleIds.length} modules and {CAPABILITIES.length} capabilities, security settings, and data assets.
								</div>
							) : (
								<div style={{ marginTop: "1rem" }}>
									<div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-xs)" }}>
										<span className="muted">Scope Completeness</span>
										<span className="mono"><strong>{selectedRoleStats.count} / {selectedRoleStats.total} modules ({selectedRoleStats.pct}%) · {selectedRoleStats.caps} / {CAPABILITIES.length} capabilities</strong></span>
									</div>
									<div className="perm-progress-bar" style={{ marginTop: "0.35rem" }}>
										<div className="perm-progress-fill" style={{ width: `${selectedRoleStats.pct}%` }} />
									</div>
								</div>
							)}

							<div style={{ marginTop: "1rem" }}>
								<input
									type="search"
									placeholder={`Filter permissions for ${selectedRole.name}...`}
									className="input input--sm input--full-border"
									style={{ width: "100%" }}
									value={moduleSearch}
									onChange={(e) => setModuleSearch(e.target.value)}
								/>
							</div>
						</div>

						{/* Capabilities — what the role may do; modules below say what it sees */}
						<div className="card" style={{ marginBottom: "1rem" }}>
							<div className="cn-docs__head">
								<p className="eyebrow">Capabilities</p>
								<span className="mono muted text-xs">
									{selectedRole.id === "super_admin" ? "all" : `${CAPABILITIES.filter((c) => (selectedRole.permissions ?? []).includes(c.id)).length} / ${CAPABILITIES.length}`}
								</span>
							</div>
							<p className="muted text-xs" style={{ marginBottom: "0.75rem" }}>
								A module lets a role see a page; a capability lets it act. The server checks both from this list.{!canManageRoles && " Read-only for your role — editing needs the manage_roles capability."}
							</p>
							{filteredCapabilities.length === 0 ? (
								<p className="muted text-xs">No capabilities match "{moduleSearch}".</p>
							) : (
								Array.from(new Set(filteredCapabilities.map((c) => c.group))).map((group) => (
									<div key={group} style={{ marginBottom: "0.75rem" }}>
										<p className="text-xs mono muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.35rem" }}>{group}</p>
										<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))", gap: "0.35rem 1rem" }}>
											{filteredCapabilities.filter((c) => c.group === group).map((cap) => {
												const isSuper = selectedRole.id === "super_admin";
												const on = isSuper || (selectedRole.permissions ?? []).includes(cap.id);
												return (
													<label key={cap.id} className="text-sm" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }} title={cap.hint}>
														<input
															type="checkbox"
															checked={on}
															disabled={isSuper || !canManageRoles}
															onChange={(e) => togglePermission(selectedRole.id, cap.id, e.target.checked)}
														/>
														<span>
															{cap.label}
															{cap.hint && <span className="muted text-xs" style={{ display: "block" }}>{cap.hint}</span>}
														</span>
													</label>
												);
											})}
										</div>
									</div>
								))
							)}
							{!selectedRole.isSystem && (
								<div className="mt-3" style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
									<label className="text-sm" htmlFor="role-rank">Rank</label>
									<input
										id="role-rank"
										type="number"
										min={1}
										max={99}
										className="input input--sm"
										style={{ width: "6rem" }}
										defaultValue={selectedRole.rank}
										key={`${selectedRole.id}-${selectedRole.rank}`}
										disabled={!canManageRoles}
										onBlur={(e) => {
											const next = Number(e.target.value);
											if (next !== selectedRole.rank) void saveRank(selectedRole.id, next);
											else e.target.value = String(selectedRole.rank);
										}}
									/>
									<span className="muted text-xs">Who may invite or change this role: anyone holding "invite staff" with a higher rank. Manager is 70, coordinator 50, consultant 30.</span>
								</div>
							)}
						</div>

						{/* Categorized Permissions Cards */}
						{filteredModuleGroups.length === 0 ? (
							<div className="card" style={{ padding: "2rem", textAlign: "center" }}>
								<p className="muted">No modules match "{moduleSearch}".</p>
							</div>
						) : (
							filteredModuleGroups.map((group) => {
								const groupIds = group.modules.map((m) => m.id);
								const grantedInGroup = groupIds.filter((id) =>
									selectedRole.id === "super_admin" || (selectedRole.permissions ?? []).includes(id),
								).length;
								const isSuper = selectedRole.id === "super_admin";

								return (
									<div key={group.group} className="perm-group-card">
										<div className="perm-group-card__head">
											<div>
												<h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>
													{group.group}
												</h4>
												<p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "var(--text-xs)" }}>
													{group.description}
												</p>
											</div>

											<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
												<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
													{grantedInGroup}/{groupIds.length}
												</span>
												{!isSuper && canManageRoles && (
													<div style={{ display: "flex", gap: "0.25rem" }}>
														<button
															type="button"
															className="perm-quick-btn"
															onClick={() =>
																confirm(
																	`Grant all of "${group.group}" to "${selectedRole.name}"?`,
																	`${groupIds.length} modules — ${staffOnRole(selectedRole.id)} staff member(s) hold this role.`,
																	() => void bulkSetRolePermissions(selectedRole.id, groupIds, true),
																)
															}
														>
															+ Group
														</button>
														<button
															type="button"
															className="perm-quick-btn"
															onClick={() =>
																confirm(
																	`Revoke all of "${group.group}" from "${selectedRole.name}"?`,
																	`${groupIds.length} modules — ${staffOnRole(selectedRole.id)} staff member(s) hold this role.`,
																	() => void bulkSetRolePermissions(selectedRole.id, groupIds, false),
																	true,
																)
															}
														>
															- Group
														</button>
													</div>
												)}
											</div>
										</div>

										<div>
											{group.modules.map((mod) => {
												const hasIt = isSuper || (selectedRole.permissions ?? []).includes(mod.id);
												return (
													<div key={mod.id} className="perm-item-row">
														<div>
															<div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
																{mod.label}
															</div>
															<div className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
																{mod.description}
															</div>
															<code className="mono muted" style={{ fontSize: "0.7rem", marginTop: "0.2rem", display: "inline-block" }}>
																{mod.id}
															</code>
														</div>

														<div>
															<label
																className="perm-switch"
																title={isSuper ? "Root access cannot be disabled" : `${hasIt ? "Revoke" : "Grant"} ${mod.label}`}
															>
																<input
																	type="checkbox"
																	checked={hasIt}
																	disabled={isSuper || !canManageRoles}
																	onChange={(e) => togglePermission(selectedRole.id, mod.id, e.target.checked)}
																	aria-label={`Toggle ${mod.label} for ${selectedRole.name}`}
																/>
																<span className="perm-switch__slider" />
															</label>
														</div>
													</div>
												);
											})}
										</div>
									</div>
								);
							})
						)}
					</div>}
				</div>
			)}

			{/* Create Custom Role Modal with Preset Templates */}
			{creatingRole && (
				<div className="ops-modal-backdrop" onClick={() => setCreatingRole(false)} role="dialog" aria-modal="true">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "38rem", maxHeight: "90vh", overflowY: "auto" }}>
						<header className="ops-modal__head">
							<div>
								<p className="invite-card__eyebrow" style={{ margin: 0 }}>Role Management</p>
								<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>Create Custom Role</h2>
								<p className="ops-modal__sub">Define a tailored staff role with granular module permissions.</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreatingRole(false)}>
								✕ Close
							</button>
						</header>

						<form onSubmit={handleCreateRole} className="invite-form" style={{ marginTop: "1rem" }}>
							<div className="field">
								<label htmlFor="role-template-picker">Start from Preset Template</label>
								<select
									id="role-template-picker"
									className="input input--full-border"
									onChange={(e) => {
										const selected = roles.find((r) => r.id === e.target.value);
										if (selected) {
											// Ceiling: a template can only carry what the creator holds —
											// the server enforces the same subset rule.
											setNewRoleDraft((prev) => ({
												...prev,
												permissions: ceilingFilter(selected.permissions),
											}));
										} else if (e.target.value === "all") {
											setNewRoleDraft((prev) => ({
												...prev,
												permissions: ceilingFilter(allModuleIds),
											}));
										} else if (e.target.value === "none") {
											setNewRoleDraft((prev) => ({
												...prev,
												permissions: ["dashboard"],
											}));
										}
									}}
								>
									<option value="none">Custom / Blank (Dashboard only)</option>
									<option value="all">All {allModuleIds.length} modules — no capabilities</option>
									{roles.map((r) => (
										<option key={r.id} value={r.id}>
											Copy from {r.name} ({moduleCountOf(r.permissions)} modules · {capCountOf(r.permissions)} capabilities)
										</option>
									))}
								</select>
							</div>

							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
								<div className="field">
									<label htmlFor="role-name">Role Name <span style={{ color: "#b00020" }}>*</span></label>
									<input
										id="role-name"
										className="input input--full-border"
										placeholder="e.g. Senior Admissions Advisor"
										value={newRoleDraft.name}
										onChange={(e) => {
											const val = e.target.value;
											const autoId = val.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 32);
											setNewRoleDraft((prev) => ({
												...prev,
												name: val,
												id: prev.id === "" || prev.id.startsWith(autoId.slice(0, -1)) ? autoId : prev.id,
											}));
										}}
										required
										autoFocus
									/>
								</div>

								<div className="field">
									<label htmlFor="role-id">Role Slug / Identifier <span style={{ color: "#b00020" }}>*</span></label>
									<input
										id="role-id"
										className="input input--full-border mono"
										placeholder="e.g. senior_advisor"
										value={newRoleDraft.id}
										onChange={(e) => setNewRoleDraft({ ...newRoleDraft, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") })}
										required
										aria-invalid={Boolean(roleIdError)}
									/>
									{roleIdError && <p className="muted text-xs" style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}>{roleIdError}</p>}
								</div>
							</div>

							<div className="field">
								<label htmlFor="role-desc">Description</label>
								<input
									id="role-desc"
									className="input input--full-border"
									placeholder="What responsibilities this role handles"
									value={newRoleDraft.description}
									onChange={(e) => setNewRoleDraft({ ...newRoleDraft, description: e.target.value })}
								/>
							</div>

							{/* Granular Module Checkboxes in Modal */}
							<div className="field" style={{ borderTop: "var(--thin)", paddingTop: "1rem", marginTop: "0.5rem" }}>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
									<label style={{ margin: 0, fontWeight: 700 }}>
										Modules ({moduleCountOf(newRoleDraft.permissions)} selected)
									</label>
									<div style={{ display: "flex", gap: "0.3rem" }}>
										<button
											type="button"
											className="perm-quick-btn"
											onClick={() => setNewRoleDraft((prev) => ({ ...prev, permissions: ceilingFilter(allModuleIds) }))}
										>
											Select All
										</button>
										<button
											type="button"
											className="perm-quick-btn"
											onClick={() => setNewRoleDraft((prev) => ({ ...prev, permissions: [] }))}
										>
											Deselect All
										</button>
									</div>
								</div>

								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", maxHeight: "15rem", overflowY: "auto", border: "var(--thin)", padding: "0.75rem", background: "var(--surface-subtle, #fcfcfc)" }}>
									{MODULE_GROUPS.map((g) => {
										const groupIds = g.modules.map((m) => m.id);
										const allSelected = groupIds.every((id) => newRoleDraft.permissions.includes(id));
										return (
											<div key={g.group} style={{ marginBottom: "0.5rem" }}>
												<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "var(--hairline)", paddingBottom: "0.25rem", marginBottom: "0.4rem" }}>
													<strong style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
														{g.group}
													</strong>
													<button
														type="button"
														className="perm-quick-btn"
														style={{ fontSize: "0.55rem" }}
														onClick={() => {
															setNewRoleDraft((prev) => {
																const current = new Set(prev.permissions);
																if (allSelected) {
																	for (const id of groupIds) current.delete(id);
																} else {
																	for (const id of ceilingFilter(groupIds)) current.add(id);
																}
																return { ...prev, permissions: Array.from(current) };
															});
														}}
													>
														{allSelected ? "None" : "All"}
													</button>
												</div>
												{g.modules.map((m) => {
													const checked = newRoleDraft.permissions.includes(m.id);
													const beyondCeiling = myPermissions !== null && !myPermissions.has(m.id);
													return (
														<label key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "var(--text-xs)", margin: "0.2rem 0", cursor: beyondCeiling ? "not-allowed" : "pointer", opacity: beyondCeiling ? 0.45 : 1 }} title={beyondCeiling ? "Your own role does not hold this" : undefined}>
															<input
																type="checkbox"
																checked={checked}
																disabled={beyondCeiling}
																onChange={(e) => {
																	const c = e.target.checked;
																	setNewRoleDraft((prev) => ({
																		...prev,
																		permissions: c
																			? [...new Set([...prev.permissions, m.id])]
																			: prev.permissions.filter((id) => id !== m.id),
																	}));
																}}
															/>
															<span>{m.label}</span>
														</label>
													);
												})}
											</div>
										);
									})}
								</div>
							</div>

							{/* Capabilities — what the new role may do, capped at the creator's own */}
							<div className="field" style={{ borderTop: "var(--thin)", paddingTop: "1rem", marginTop: "0.5rem" }}>
								<label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 700 }}>
									Capabilities ({capCountOf(newRoleDraft.permissions)} selected)
								</label>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.25rem 1rem", maxHeight: "10rem", overflowY: "auto", border: "var(--thin)", padding: "0.75rem", background: "var(--surface-subtle, #fcfcfc)" }}>
									{CAPABILITIES.map((c) => {
										const checked = newRoleDraft.permissions.includes(c.id);
										const beyondCeiling = myPermissions !== null && !myPermissions.has(c.id);
										return (
											<label key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "var(--text-xs)", cursor: beyondCeiling ? "not-allowed" : "pointer", opacity: beyondCeiling ? 0.45 : 1 }} title={beyondCeiling ? "Your own role does not hold this capability" : c.hint}>
												<input
													type="checkbox"
													checked={checked}
													disabled={beyondCeiling}
													onChange={(e) => {
														const on = e.target.checked;
														setNewRoleDraft((prev) => ({
															...prev,
															permissions: on
																? [...new Set([...prev.permissions, c.id])]
																: prev.permissions.filter((id) => id !== c.id),
														}));
													}}
												/>
												<span>{c.label}</span>
											</label>
										);
									})}
								</div>
							</div>

							<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreatingRole(false)}>
									Cancel
								</button>
								{newRoleDraft.permissions.length > 0 && !newRoleDraft.permissions.some((p) => (CAPABILITIES as readonly { id: string }[]).some((c) => c.id === p)) && (
									<p className="muted text-xs" style={{ marginRight: "auto" }}>
										This role can see pages but can't act on anything yet — add capabilities after creating it, or it stays read-only.
									</p>
								)}
								<button type="submit" className="btn btn--primary" disabled={!newRoleDraft.name.trim() || !newRoleDraft.id.trim() || Boolean(roleIdError)}>
									Create Role
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={confirmOpen}
				title={confirmTitle}
				message={confirmMessage}
				danger={confirmDanger}
				confirmLabel={confirmDanger ? "Delete" : "Confirm"}
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

/* ─── Auth ─── */

function AuthSettings() {
	const [settings, setSettings] = useState<AuthSettingsResponse | null>(null);
	const [stats, setStats] = useState<{
		totalStaff: number;
		mfaEnrolled: number;
		mfaRequired: number;
		mfaNotEnrolled: number;
		activeSessions: number;
		providers: { id: string; label: string; enabled: boolean }[];
		mfaRoster: { id: string; name: string; email: string; role: string; branch: string | null; enrolled: boolean; hasLogin: boolean }[];
	} | null>(null);
	const [sessionRows, setSessionRows] = useState<{
		id: string; email: string; name: string; role: string; ip: string | null;
		userAgent: string | null; createdAt: string; expiresAt: string; current: boolean;
	}[]>([]);
	const [signInEvents, setSignInEvents] = useState<AuditEvent[]>([]);
	const [clientSessionRows, setClientSessionRows] = useState<
		{ id: string; userId: string; name: string; email: string; ip: string | null; userAgent: string | null; createdAt: string; expiresAt: string }[]
	>([]);
	const [tab, setTab] = useState<"policy" | "sessions" | "events">("policy");
	const [authPolicy, setAuthPolicy] = useState<AuthPolicy | null>(null);
	const [policyDraft, setPolicyDraft] = useState<Partial<AuthPolicy>>({});
	const [policySaving, setPolicySaving] = useState(false);
	const [policySaved, setPolicySaved] = useState(false);
	const [unlocking, setUnlocking] = useState<string | null>(null);
	const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		let active = true;
		Promise.all([
			getAuthSettings(),
			staffApi.authStats(),
			staffApi.sessions().catch(() => ({ sessions: [] })),
			auditApi.events({ category: "Authentication", limit: 40 }).catch(() => ({ entries: [], total: 0, nextBefore: null, facets: {} })),
			auditApi.authPolicy().catch(() => null),
			auditApi.clientSessions().catch(() => ({ sessions: [] })),
		])
			.then(([s, st, se, ev, pol, cs]) => {
				if (!active) return;
				setSettings(s);
				setStats(st);
				setSessionRows(se.sessions);
				setSignInEvents(ev.entries);
				setAuthPolicy(pol);
				setClientSessionRows(cs.sessions);
				setError(null);
			})
			.catch((e: unknown) => {
				if (active) setError(e instanceof Error ? e.message : "Could not load auth settings.");
			})
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, []);

	async function revokeSession(id: string) {
		setRevokingSessionId(id);
		try {
			await staffApi.revokeSession(id);
			setSessionRows((prev) => prev.filter((r) => r.id !== id));
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Could not revoke session.");
		} finally {
			setRevokingSessionId(null);
		}
	}

	async function updateSettings(patch: { portal?: Partial<AuthSettingsResponse["portal"]>; ops?: Partial<AuthSettingsResponse["ops"]> }) {
		if (!settings) return;
		setSaving(true);
		setError(null);
		setSaved(false);
		try {
			const updated = await updateAuthSettingsApi(patch);
			setSettings(updated);
			setSaved(true);
			setTimeout(() => setSaved(false), 3000);
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Could not save settings.");
		} finally {
			setSaving(false);
		}
	}

	async function savePolicy() {
		if (!authPolicy || Object.keys(policyDraft).length === 0) return;
		setPolicySaving(true);
		setPolicySaved(false);
		try {
			const next = await auditApi.setAuthPolicy(policyDraft);
			setAuthPolicy(next);
			setPolicyDraft({});
			setPolicySaved(true);
			setTimeout(() => setPolicySaved(false), 3000);
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Could not save the policy.");
		} finally {
			setPolicySaving(false);
		}
	}

	async function unlockAccount(email: string) {
		setUnlocking(email);
		try {
			await auditApi.unlock(email);
			setSignInEvents((prev) => prev.filter((e) => !(e.action.startsWith("Account locked") && e.targetLabel === email)));
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Could not unlock the account.");
		} finally {
			setUnlocking(null);
		}
	}

	if (loading) {
		return (
			<div className="card" style={{ textAlign: "center", padding: "3rem" }}>
				<p className="muted">Loading authentication settings...</p>
			</div>
		);
	}

	if (error && !settings) {
		return (
			<div className="card" style={{ textAlign: "center", padding: "3rem" }}>
				<p className="ops-modal__error" role="alert">{error}</p>
			</div>
		);
	}

	const s = settings!;
	const mfaPct = stats && stats.totalStaff > 0 ? Math.round((stats.mfaEnrolled / stats.totalStaff) * 100) : 0;

	return (
		<>
			{/* Statstrip — who signs in, who's covered, who's live */}
			{stats && (
				<div className="dash-day" style={{ margin: "0 0 1rem" }}>
					<span className="dash-day__cut"><strong>{stats.totalStaff}</strong> staff accounts</span>
					<span className="dash-day__sep">·</span>
					<span className="dash-day__cut"><strong>{stats.mfaEnrolled}/{stats.totalStaff}</strong> MFA enrolled · {mfaPct}%</span>
					<span className="dash-day__sep">·</span>
					<span className="dash-day__cut"><strong>{stats.mfaNotEnrolled}</strong> MFA outstanding</span>
					<span className="dash-day__sep">·</span>
					<span className="dash-day__cut"><strong>{sessionRows.length || stats.activeSessions}</strong> active sessions</span>
				</div>
			)}

			{error && (
				<div className="admin-flash admin-flash--error" role="alert">
					{error}
				</div>
			)}
			{saved && (
				<div className="admin-flash admin-flash--ok" role="status">
					✓ Settings saved. Changes take effect on next login.
				</div>
			)}
			{policySaved && (
				<div className="admin-flash admin-flash--ok" role="status">
					✓ Policy saved. Applies to new sign-ins immediately.
				</div>
			)}

			{/* Policy · Sessions · Events */}
			<div className="admin-env-tabs" style={{ marginBottom: "1.25rem" }}>
				{(["policy", "sessions", "events"] as const).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`admin-env-tab${tab === t ? " admin-env-tab--active" : ""}`}
					>
						{t === "policy" ? "Policy" : t === "sessions" ? `Sessions · ${sessionRows.length + clientSessionRows.length}` : "Events"}
					</button>
				))}
			</div>

			{tab === "policy" && (
			<>
			{/* Sign-in policy at a glance + who still owes MFA */}
			{stats && (
				<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
					<div className="card" style={{ marginBottom: 0 }}>
						<div className="admin-section-head" style={{ marginBottom: "0.75rem" }}>
							<h2 className="section-title" style={{ margin: 0 }}>Sign-in policy</h2>
							<span className="portal-pill" style={{ background: "var(--foreground)", color: "var(--background)" }}>Live</span>
						</div>
						<div className="ops-table-wrap">
							<table className="admin-table">
								<thead>
									<tr>
										<th>Surface</th>
										<th style={{ textAlign: "center" }}>Password</th>
										<th style={{ textAlign: "center" }}>Google</th>
										<th style={{ textAlign: "center" }}>Magic link</th>
										<th style={{ textAlign: "center" }}>MFA</th>
									</tr>
								</thead>
								<tbody>
									<tr>
										<td>Client portal</td>
										<td style={{ textAlign: "center" }}><PolicyBox on={s.portal.email_password} /></td>
										<td style={{ textAlign: "center" }}><PolicyBox on={s.portal.social_google} /></td>
										<td style={{ textAlign: "center" }}><PolicyBox on={s.portal.email_otp} /></td>
										<td style={{ textAlign: "center" }}><PolicyBox on={s.portal.mfa_required} /></td>
									</tr>
									<tr>
										<td>Ops console</td>
										<td style={{ textAlign: "center" }}><PolicyBox on /></td>
										<td style={{ textAlign: "center" }}><PolicyBox on={false} /></td>
										<td style={{ textAlign: "center" }}><PolicyBox on={false} /></td>
										<td style={{ textAlign: "center" }}><PolicyBox on /></td>
									</tr>
								</tbody>
							</table>
						</div>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", borderTop: "1px solid var(--border-light)", paddingTop: "0.6rem" }}>
							<span className="dash-link">edit policy ↓ below</span>
							<span className="mono muted" style={{ fontSize: "0.62rem" }}>changes apply at next login</span>
						</div>
					</div>

					<div className="card" style={{ marginBottom: 0 }}>
						<div className="admin-section-head" style={{ marginBottom: "0.75rem" }}>
							<h2 className="section-title" style={{ margin: 0 }}>MFA outstanding</h2>
							<span className="portal-pill portal-pill--hollow">{stats.mfaNotEnrolled}</span>
						</div>
						{stats.mfaRoster.filter((r) => !r.enrolled).length === 0 ? (
							<p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>Every staff account with a login has MFA enrolled.</p>
						) : (
							<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
								{stats.mfaRoster.filter((r) => !r.enrolled).map((r) => (
									<li key={r.id} className="cl-kv" style={{ borderBottom: "1px solid var(--border-light)" }}>
										<span className="cl-kv__k" style={{ fontWeight: 600 }}>{r.name}</span>
										<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
											{r.hasLogin ? `${staffBranchName(r.branch ?? "")} · ${r.role}` : "invited, never signed in"}
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>
			)}

			{/* Portal Login Methods */}
			<div className="card" style={{ marginBottom: "1.5rem" }}>
				<h2 className="section-title mb-3">Portal Login Methods</h2>
				<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
					Configure which sign-in methods are available to applicants on the client portal.
				</p>
				<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
					<label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border-light)" }}>
						<div>
							<div style={{ fontWeight: 500 }}>Email + Password</div>
							<div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Traditional email and password sign-in. Requires MFA if enabled.</div>
						</div>
						<input
							type="checkbox"
							checked={s.portal.email_password}
							onChange={(e) => updateSettings({ portal: { email_password: e.target.checked } })}
							disabled={saving}
						/>
					</label>
					<label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border-light)" }}>
						<div>
							<div style={{ fontWeight: 500 }}>Social Login (Google)</div>
							<div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>OAuth sign-in via Google. Requires MFA if enabled. Credentials managed in Platform Settings.</div>
						</div>
						<input
							type="checkbox"
							checked={s.portal.social_google}
							onChange={(e) => updateSettings({ portal: { social_google: e.target.checked } })}
							disabled={saving}
						/>
					</label>
					<label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0" }}>
						<div>
							<div style={{ fontWeight: 500 }}>Email OTP (Passwordless)</div>
							<div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>No password needed. User enters email, receives a 6-digit code, enters it to log in.</div>
						</div>
						<input
							type="checkbox"
							checked={s.portal.email_otp}
							onChange={(e) => updateSettings({ portal: { email_otp: e.target.checked } })}
							disabled={saving}
						/>
					</label>
				</div>
			</div>

			{/* Portal MFA */}
			<div className="card" style={{ marginBottom: "1.5rem" }}>
				<h2 className="section-title mb-3">Portal MFA</h2>
				<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
					Multi-factor authentication for portal users after email/password or social login. Email OTP login is already 2FA and does not require additional MFA.
				</p>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border-light)" }}>
					<div>
						<div style={{ fontWeight: 500 }}>Require MFA for portal</div>
						<div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>When enabled, users who sign in with email+password or social login must set up MFA.</div>
					</div>
					<input
						type="checkbox"
						checked={s.portal.mfa_required}
						onChange={(e) => updateSettings({ portal: { mfa_required: e.target.checked } })}
						disabled={saving}
					/>
				</div>
				<div style={{ padding: "0.75rem 0" }}>
					<div style={{ fontWeight: 500, marginBottom: "0.5rem" }}>Available MFA Methods</div>
					<div style={{ display: "flex", gap: "1rem" }}>
						<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
							<input
								type="checkbox"
								checked={s.portal.mfa_methods.includes("totp")}
								onChange={(e) => {
									const methods = e.target.checked
										? [...s.portal.mfa_methods, "totp"]
										: s.portal.mfa_methods.filter((m) => m !== "totp");
									if (methods.length > 0) updateSettings({ portal: { mfa_methods: methods as ("totp" | "email_otp")[] } });
								}}
								disabled={saving}
							/>
							<span style={{ fontSize: "var(--text-sm)" }}>Authenticator App (TOTP)</span>
						</label>
						<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
							<input
								type="checkbox"
								checked={s.portal.mfa_methods.includes("email_otp")}
								onChange={(e) => {
									const methods = e.target.checked
										? [...s.portal.mfa_methods, "email_otp"]
										: s.portal.mfa_methods.filter((m) => m !== "email_otp");
									if (methods.length > 0) updateSettings({ portal: { mfa_methods: methods as ("totp" | "email_otp")[] } });
								}}
								disabled={saving}
							/>
							<span style={{ fontSize: "var(--text-sm)" }}>Email OTP</span>
						</label>
					</div>
				</div>
			</div>

			{/* Ops Console */}
			<div className="card" style={{ marginBottom: "1.5rem" }}>
				<h2 className="section-title mb-3">Ops Console (Staff)</h2>
				<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
					Staff authentication settings. Email + password and MFA are always enforced for staff accounts.
				</p>
				<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border-light)" }}>
						<div>
							<div style={{ fontWeight: 500 }}>Email + Password</div>
							<div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Always enabled for staff. Cannot be disabled.</div>
						</div>
						<input type="checkbox" checked disabled style={{ opacity: 0.5 }} />
					</div>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border-light)" }}>
						<div>
							<div style={{ fontWeight: 500 }}>MFA Required</div>
							<div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Always enforced for all staff roles. Cannot be disabled.</div>
						</div>
						<input type="checkbox" checked disabled style={{ opacity: 0.5 }} />
					</div>
					<div style={{ padding: "0.75rem 0" }}>
						<div style={{ fontWeight: 500, marginBottom: "0.5rem" }}>Available MFA Methods</div>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.5rem" }}>
							Staff choose their preferred method during MFA enrollment. Both methods are available by default.
						</p>
						<div style={{ display: "flex", gap: "1rem" }}>
							<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
								<input
									type="checkbox"
									checked={s.ops.mfa_methods.includes("totp")}
									onChange={(e) => {
										const methods = e.target.checked
											? [...s.ops.mfa_methods, "totp"]
											: s.ops.mfa_methods.filter((m) => m !== "totp");
										if (methods.length > 0) updateSettings({ ops: { mfa_methods: methods as ("totp" | "email_otp")[] } });
									}}
									disabled={saving}
								/>
								<span style={{ fontSize: "var(--text-sm)" }}>Authenticator App (TOTP)</span>
							</label>
							<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
								<input
									type="checkbox"
									checked={s.ops.mfa_methods.includes("email_otp")}
									onChange={(e) => {
										const methods = e.target.checked
											? [...s.ops.mfa_methods, "email_otp"]
											: s.ops.mfa_methods.filter((m) => m !== "email_otp");
										if (methods.length > 0) updateSettings({ ops: { mfa_methods: methods as ("totp" | "email_otp")[] } });
									}}
									disabled={saving}
								/>
								<span style={{ fontSize: "var(--text-sm)" }}>Email OTP</span>
							</label>
						</div>
					</div>
				</div>
			</div>

			{/* Session & password policy — real settings, confirm-on-save */}
			{authPolicy && (
				<div className="card" style={{ marginBottom: "1.5rem" }}>
					<div className="admin-section-head" style={{ marginBottom: "0.75rem" }}>
						<h2 className="section-title" style={{ margin: 0 }}>Session &amp; password policy</h2>
						<span className="mono muted" style={{ fontSize: "0.62rem" }}>idle timeout applies to open sessions too</span>
					</div>
					<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.85rem" }}>
						<PolicyNum label="Session lifetime (days)" hint="How long a sign-in lasts" value={policyDraft.sessionDays ?? authPolicy.sessionDays} min={1} max={90} onChange={(v) => setPolicyDraft((p) => ({ ...p, sessionDays: v }))} />
						<PolicyNum label="Idle timeout (hours)" hint="Warns 5 min before sign-out" value={policyDraft.idleHours ?? authPolicy.idleHours} min={1} max={72} onChange={(v) => setPolicyDraft((p) => ({ ...p, idleHours: v }))} />
						<PolicyNum label="Lockout threshold" hint="Failures before lock" value={policyDraft.lockoutThreshold ?? authPolicy.lockoutThreshold} min={3} max={20} onChange={(v) => setPolicyDraft((p) => ({ ...p, lockoutThreshold: v }))} />
						<PolicyNum label="Lockout window (min)" hint="Failures counted inside" value={policyDraft.lockoutWindowMin ?? authPolicy.lockoutWindowMin} min={5} max={60} onChange={(v) => setPolicyDraft((p) => ({ ...p, lockoutWindowMin: v }))} />
						<PolicyNum label="Lockout duration (min)" hint="How long the lock holds" value={policyDraft.lockoutMinutes ?? authPolicy.lockoutMinutes} min={5} max={1440} onChange={(v) => setPolicyDraft((p) => ({ ...p, lockoutMinutes: v }))} />
						<PolicyNum label="Password min length" hint="New passwords only" value={policyDraft.passwordMinLength ?? authPolicy.passwordMinLength} min={8} max={64} onChange={(v) => setPolicyDraft((p) => ({ ...p, passwordMinLength: v }))} />
						<PolicyNum label="MFA grace (days)" hint="Require-by deadline for staff" value={policyDraft.mfaGraceDays ?? authPolicy.mfaGraceDays} min={0} max={30} onChange={(v) => setPolicyDraft((p) => ({ ...p, mfaGraceDays: v }))} />

						<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "var(--text-sm)", padding: "0.5rem 0" }}>
							<input
								type="checkbox"
								checked={policyDraft.breachedCheck ?? authPolicy.breachedCheck}
								onChange={(e) => setPolicyDraft((p) => ({ ...p, breachedCheck: e.target.checked }))}
								disabled={policySaving}
							/>
							Reject breached passwords
						</label>
						<PolicyNum label="Staff rotation (days)" hint="Password age for staff" value={policyDraft.staffRotationDays ?? authPolicy.staffRotationDays} min={30} max={365} onChange={(v) => setPolicyDraft((p) => ({ ...p, staffRotationDays: v }))} />
					</div>
					{Object.keys(policyDraft).length > 0 && (
						<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem", borderTop: "1px solid var(--border-light)", paddingTop: "0.75rem" }}>
							<button type="button" className="btn btn--primary btn--sm" onClick={() => void savePolicy()} disabled={policySaving}>
								{policySaving ? "Saving…" : `Save policy (${Object.keys(policyDraft).length} change${Object.keys(policyDraft).length === 1 ? "" : "s"})`}
							</button>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setPolicyDraft({})} disabled={policySaving}>
								Discard
							</button>
						</div>
					)}
					<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
						Password hashing stays Scrypt (Better Auth); reset links keep their 1-hour expiry — neither is editable.
					</p>
				</div>
			)}
			</>
			)}

			{tab === "sessions" && (
			<>
			{/* Staff + client sessions — revoke stays per-row / per-user */}
			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "1rem", marginBottom: "1.5rem", alignItems: "start" }}>
				<div className="card" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
					<div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid var(--border-light)" }}>
						<h2 className="section-title" style={{ margin: 0, fontSize: "0.95rem" }}>Active staff sessions</h2>
					</div>
					{sessionRows.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)", padding: "1rem 1.25rem" }}>No active staff sessions.</p>
					) : (
						<div className="ops-table-wrap">
							<table className="admin-table">
								<thead>
									<tr>
										<th>Staff</th>
										<th>Device</th>
										<th>IP</th>
										<th>Signed in</th>
										<th style={{ textAlign: "right" }}></th>
									</tr>
								</thead>
								<tbody>
									{sessionRows.map((r) => (
										<tr key={r.id}>
											<td style={{ fontWeight: 500 }}>
												{r.name}
												{r.current && (
													<span className="mono" style={{ fontSize: "0.6rem", marginLeft: "0.4rem", border: "1px solid var(--border)", padding: "0.05rem 0.25rem" }}>YOU</span>
												)}
												<span className="muted" style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 400 }}>{r.email} · {r.role}</span>
											</td>
											<td className="muted" style={{ fontSize: "var(--text-xs)", maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.userAgent ?? undefined}>
												{shortUserAgent(r.userAgent)}
											</td>
											<td className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{r.ip ?? "—"}</td>
											<td className="mono muted" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString()}</td>
											<td style={{ textAlign: "right" }}>
												{r.current ? (
													<span className="mono muted" style={{ fontSize: "0.62rem" }}>current</span>
												) : (
													<button
														type="button"
														className="dash-link"
														style={{ background: "none", border: 0, cursor: "pointer" }}
														disabled={revokingSessionId === r.id}
														onClick={() => void revokeSession(r.id)}
													>
														{revokingSessionId === r.id ? "revoking…" : "revoke"}
													</button>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>

				<div className="card" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
					<div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<h2 className="section-title" style={{ margin: 0, fontSize: "0.95rem" }}>Active client sessions</h2>
						<span className="portal-pill portal-pill--hollow">{clientSessionRows.length}</span>
					</div>
					{clientSessionRows.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)", padding: "1rem 1.25rem" }}>No client sessions right now.</p>
					) : (
						<ul style={{ listStyle: "none", padding: "0.3rem 0", margin: 0, maxHeight: "26rem", overflow: "auto" }}>
							{clientSessionRows.map((r) => (
								<li key={r.id} className="cl-kv" style={{ borderBottom: "1px solid var(--border-light)", fontSize: "var(--text-xs)" }}>
									<span className="cl-kv__k" style={{ fontWeight: 600 }}>
										{r.name}
										<span className="muted" style={{ display: "block", fontWeight: 400 }}>{r.email}</span>
									</span>
									<span className="muted" style={{ textAlign: "right" }}>
										{shortUserAgent(r.userAgent)} · {r.ip ?? "—"}
										<span className="mono" style={{ display: "block", fontSize: "0.62rem" }}>
											in {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
										</span>
									</span>
								</li>
							))}
						</ul>
					)}
					<div style={{ borderTop: "1px solid var(--border-light)", padding: "0.5rem 1.25rem" }}>
						<Link to="/clients" className="dash-link">revoke per client → /clients</Link>
					</div>
				</div>
			</div>
			</>
			)}

			{tab === "events" && (
			<>
			{/* The auth slice of the audit stream — successes, failures, lockouts */}
			<div className="card" style={{ marginBottom: "1.5rem", padding: 0, overflow: "hidden" }}>
				<div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<h2 className="section-title" style={{ margin: 0, fontSize: "0.95rem" }}>Authentication events</h2>
					<Link to="/audit?category=Authentication" className="dash-link">full feed → /audit</Link>
				</div>
				{signInEvents.length === 0 ? (
					<p className="muted" style={{ fontSize: "var(--text-sm)", padding: "1rem 1.25rem" }}>No auth events yet — sign-ins, failures and lockouts land here.</p>
				) : (
					<ul style={{ listStyle: "none", padding: "0.3rem 0", margin: 0, maxHeight: "30rem", overflow: "auto" }}>
						{signInEvents.map((e) => {
							const locked = e.action.startsWith("Account locked");
							return (
								<li key={`${e.source}-${e.id}`} className="cl-kv" style={{ borderBottom: "1px solid var(--border-light)", fontSize: "var(--text-xs)", alignItems: "center" }}>
									<span className="cl-kv__k">
										<span className="mono muted">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
										<span style={{ display: "block" }}>
											<span style={{ color: e.severity === "bad" ? "#b91c1c" : e.severity === "warn" ? "#b45309" : "inherit" }}>●</span>{" "}
											{e.action}
										</span>
									</span>
									<span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
										<span className="muted">{e.actorLabel} · {e.ip ?? "—"}</span>
										{locked && e.targetLabel && (
											<button
												type="button"
												className="dash-link"
												style={{ background: "none", border: "1px solid var(--border)", padding: "0.15rem 0.5rem", cursor: "pointer" }}
												disabled={unlocking === e.targetLabel}
												onClick={() => void unlockAccount(e.targetLabel!)}
											>
												{unlocking === e.targetLabel ? "unlocking…" : "unlock"}
											</button>
										)}
									</span>
								</li>
							);
						})}
					</ul>
				)}
			</div>
			</>
			)}

			{/* MFA roster — who is and isn't enrolled */}
			{tab === "policy" && stats && stats.mfaRoster.length > 0 && (
				<div className="card" style={{ marginBottom: "1.5rem" }}>
					<h2 className="section-title mb-3">MFA Roster</h2>
					<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
						Per-staff enrollment status. Outstanding staff are the "action required" count above.
					</p>
					<div className="ops-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Staff</th>
									<th>Role</th>
									<th>Branch</th>
									<th>MFA</th>
								</tr>
							</thead>
							<tbody>
								{stats.mfaRoster.map((r) => (
									<tr key={r.id}>
										<td style={{ fontWeight: 500 }}>
											{r.name}
											<span className="muted" style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 400 }}>{r.email}</span>
										</td>
										<td className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{r.role}</td>
										<td className="muted">{staffBranchName(r.branch ?? "")}</td>
										<td>
											<span
												className="portal-pill"
												style={r.enrolled ? { background: "var(--foreground)", color: "var(--background)" } : undefined}
											>
												{r.enrolled ? "Enrolled" : r.hasLogin ? "Outstanding" : "No login"}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

		</>
	);
}

/** A numbered policy row — label, hint, and a bounded number input. */
function PolicyNum({ label, hint, value, min, max, onChange }: {
	label: string;
	hint: string;
	value: number;
	min: number;
	max: number;
	onChange: (v: number) => void;
}) {
	return (
		<label style={{ display: "block" }}>
			<span style={{ fontWeight: 500, fontSize: "var(--text-sm)", display: "block" }}>{label}</span>
			<span className="muted" style={{ fontSize: "var(--text-xs)", display: "block", marginBottom: "0.25rem" }}>{hint}</span>
			<input
				type="number"
				className="input input--sm input--full-border"
				style={{ width: "6rem" }}
				value={value}
				min={min}
				max={max}
				onChange={(e) => {
					const v = Number(e.target.value);
					if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v))));
				}}
			/>
		</label>
	);
}

/* ─── CMS ─── */

/* ─── System notifications ─── */

function SystemNotifications() {
	const [tab, setTab] = useState<"catalogue" | "preferences" | "log" | "health">("catalogue");
	const [catalogue, setCatalogue] = useState<NotificationEventCatalogueItem[]>([]);
	const [health, setHealth] = useState<NotificationHealth | null>(null);
	const [logs, setLogs] = useState<NotificationLogItem[]>([]);
	const [stats, setStats] = useState<{ total: number; sent: number; failed: number }>({ total: 0, sent: 0, failed: 0 });
	const [nextBefore, setNextBefore] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "failed">("all");
	const [channelFilter, setChannelFilter] = useState<"all" | "email" | "in_app" | "push">("all");
	const [logSearch, setLogSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [viewing, setViewing] = useState<{ subject: string; recipient: string; bodyHtml: string | null; bodyText: string | null; errorMessage: string | null } | null>(null);
	const [resending, setResending] = useState<string | null>(null);
	const [resentIds, setResentIds] = useState<Set<string>>(new Set());
	const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
	const [prefsSaving, setPrefsSaving] = useState(false);
	const [prefsSaved, setPrefsSaved] = useState(false);

	useEffect(() => {
		const t = window.setTimeout(() => setDebouncedSearch(logSearch.trim()), 350);
		return () => window.clearTimeout(t);
	}, [logSearch]);

	useEffect(() => {
		notificationsApi.catalogue().then((r) => setCatalogue(r.events)).catch(() => setCatalogue([]));
		notificationsApi.health().then(setHealth).catch(() => setHealth(null));
		notificationsApi.preferences().then(setPrefs).catch(() => setPrefs(null));
	}, []);

	const logQuery = useMemo(
		() => ({
			limit: 50,
			status: statusFilter === "all" ? undefined : statusFilter,
			channel: channelFilter === "all" ? undefined : channelFilter,
			q: debouncedSearch || undefined,
		}),
		[statusFilter, channelFilter, debouncedSearch],
	);

	useEffect(() => {
		let active = true;
		setLoading(true);
		notificationsApi
			.log(logQuery)
			.then((res) => {
				if (!active) return;
				setLogs(res.notifications);
				setStats({ total: res.total, sent: res.sent, failed: res.failed });
				setNextBefore(res.nextBefore);
				setError(null);
			})
			.catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Could not load notifications."); })
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [logQuery]);

	async function loadMoreLogs() {
		if (!nextBefore) return;
		setLoadingMore(true);
		try {
			const res = await notificationsApi.log({ ...logQuery, before: nextBefore });
			setLogs((prev) => [...prev, ...res.notifications]);
			setNextBefore(res.nextBefore);
		} finally {
			setLoadingMore(false);
		}
	}

	async function viewEntry(id: string) {
		try {
			const r = await notificationsApi.logEntry(id);
			setViewing(r);
		} catch {
			setError("Could not load the rendered message.");
		}
	}

	async function resend(id: string) {
		setResending(id);
		try {
			await notificationsApi.resendLog(id);
			setResentIds((prev) => new Set(prev).add(id));
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Resend failed.");
		} finally {
			setResending(null);
		}
	}

	async function savePrefs(patch: Partial<NotificationPreferences>) {
		setPrefsSaving(true);
		setPrefsSaved(false);
		try {
			const next = await notificationsApi.setPreferences(patch);
			setPrefs(next);
			setPrefsSaved(true);
			setTimeout(() => setPrefsSaved(false), 2500);
		} catch {
			setError("Could not save preferences.");
		} finally {
			setPrefsSaving(false);
		}
	}

	function flagFor(type: string, channel: "inApp" | "push" | "email"): boolean {
		return prefs?.channelFlags?.[type]?.[channel] !== false;
	}

	function toggleFlag(type: string, channel: "inApp" | "push" | "email") {
		if (!prefs) return;
		const cur = flagFor(type, channel);
		void savePrefs({ channelFlags: { [type]: { ...(prefs.channelFlags?.[type] ?? {}), [channel]: !cur } } });
	}

	const mailable = useMemo(() => catalogue.filter((e) => e.channels.includes("email")), [catalogue]);

	return (
		<>
			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
				<Stat label="Events" value={String(catalogue.length || "—")} note="In the shared registry" />
				<Stat label="Delivered 24h" value={health ? String(health.sent24h) : "—"} note={health?.deliveryRate24h != null ? `${health.deliveryRate24h}% delivery` : "All deliveries"} />
				<Stat label="Failed 24h" value={health ? String(health.failed24h) : "—"} note="Delivery errors" inverted={!!health && health.failed24h > 0} />
				<Stat label="Queue" value={health ? String(health.queueWaiting) : "—"} note={health ? `${health.queueFailed} failed jobs` : "Waiting emails"} />
			</div>

			<div className="admin-env-tabs" style={{ marginBottom: "1.25rem" }}>
				{(["catalogue", "preferences", "log", "health"] as const).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`admin-env-tab${tab === t ? " admin-env-tab--active" : ""}`}
					>
						{t === "catalogue" ? `Catalogue · ${catalogue.length}` : t === "preferences" ? "Preferences" : t === "log" ? "Delivery log" : "Health"}
					</button>
				))}
			</div>

			{tab === "catalogue" && (
				<div className="card" style={{ padding: 0, overflow: "hidden" }}>
					<div style={{ padding: "1rem 1.25rem 0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<h2 className="section-title" style={{ margin: 0 }}>Event catalogue</h2>
						<span className="mono muted" style={{ fontSize: "0.62rem" }}>generated from the shared registry — it can't drift</span>
					</div>
					<div className="ops-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Event</th>
									<th>Audience</th>
									<th>Channels</th>
									<th>Timing</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{catalogue.length === 0 ? (
									<tr><td colSpan={5} className="muted" style={{ padding: "2rem", textAlign: "center" }}>Loading the registry…</td></tr>
								) : (
									catalogue.map((e) => (
										<tr key={e.type}>
											<td>
												<code className="mono" style={{ fontSize: "0.72rem", fontWeight: 600 }}>{e.type}</code>
												<span className="muted" style={{ display: "block", fontSize: "var(--text-xs)" }}>{e.label}</span>
											</td>
											<td className="muted" style={{ fontSize: "var(--text-xs)" }}>{e.audience}</td>
											<td>
												<span style={{ display: "flex", gap: "0.3rem" }}>
													{e.channels.map((ch) => (
														<span key={ch} className="portal-pill portal-pill--hollow" style={{ fontSize: "0.62rem" }}>{ch}</span>
													))}
												</span>
											</td>
											<td className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{e.timing}</td>
											<td>
												{e.required && (
													<span className="mono" title="Security and receipt events can't be muted" style={{ fontSize: "0.6rem", border: "1px solid var(--border)", padding: "0.1rem 0.3rem" }}>always</span>
												)}
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
					{mailable.length > 0 && (
						<p className="muted" style={{ fontSize: "var(--text-xs)", padding: "0.6rem 1.25rem" }}>
							{mailable.length} of these carry an email — wording is code-defined; a copy change is a deploy.
						</p>
					)}
				</div>
			)}

			{tab === "preferences" && (
				<div className="card" style={{ padding: 0, overflow: "hidden" }}>
					<div style={{ padding: "1rem 1.25rem 0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<div>
							<h2 className="section-title" style={{ margin: 0 }}>My channel matrix</h2>
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
								Your own preferences — clients set theirs in the portal. In-app always lands; security events can't be muted.
							</p>
						</div>
						{prefsSaved && <span className="mono" style={{ fontSize: "0.62rem" }}>✓ saved</span>}
					</div>
					{!prefs ? (
						<p className="muted" style={{ padding: "1.25rem" }}>Loading preferences…</p>
					) : (
						<>
							<div className="ops-table-wrap">
								<table className="admin-table">
									<thead>
										<tr>
											<th>Event</th>
											<th style={{ textAlign: "center", width: "5rem" }}>Push</th>
											<th style={{ textAlign: "center", width: "5rem" }}>Email</th>
										</tr>
									</thead>
									<tbody>
										{catalogue.map((e) => (
											<tr key={e.type}>
												<td>
													<code className="mono" style={{ fontSize: "0.72rem" }}>{e.type}</code>
													{e.required && <span className="mono muted" style={{ fontSize: "0.6rem", marginLeft: "0.4rem" }}>always on</span>}
												</td>
												<td style={{ textAlign: "center" }}>
													<input
														type="checkbox"
														checked={e.channels.includes("push") ? flagFor(e.type, "push") : false}
														disabled={!e.channels.includes("push") || e.required || prefsSaving}
														onChange={() => toggleFlag(e.type, "push")}
													/>
												</td>
												<td style={{ textAlign: "center" }}>
													<input
														type="checkbox"
														checked={e.channels.includes("email") ? flagFor(e.type, "email") : false}
														disabled={!e.channels.includes("email") || e.required || prefsSaving}
														onChange={() => toggleFlag(e.type, "email")}
													/>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<div style={{ padding: "0.85rem 1.25rem", borderTop: "1px solid var(--border-light)", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
								<span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Quiet hours</span>
								<input
									type="time"
									className="input input--sm input--full-border"
									value={prefs.quietHours?.start ?? ""}
									onChange={(e) => void savePrefs({ quietHours: { ...(prefs.quietHours ?? {}), start: e.target.value, timezone: "Africa/Accra" } })}
								/>
								<span className="muted" style={{ fontSize: "var(--text-xs)" }}>→</span>
								<input
									type="time"
									className="input input--sm input--full-border"
									value={prefs.quietHours?.end ?? ""}
									onChange={(e) => void savePrefs({ quietHours: { ...(prefs.quietHours ?? {}), end: e.target.value, timezone: "Africa/Accra" } })}
								/>
								{prefs.quietHours?.start && (
									<button type="button" className="dash-link" style={{ background: "none", border: 0, cursor: "pointer" }} onClick={() => void savePrefs({ quietHours: null })}>
										clear
									</button>
								)}
								<span className="muted" style={{ fontSize: "var(--text-xs)" }}>push is held inside the window — in-app and email still land</span>
							</div>
						</>
					)}
				</div>
			)}

			{tab === "log" && (
				<div className="card" style={{ padding: 0, overflow: "hidden" }}>
					<div style={{ padding: "1.25rem 1.25rem 0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
						<h2 className="section-title" style={{ margin: 0 }}>Delivery log</h2>
						<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
							<input
								type="search"
								placeholder="recipient, subject, ref…"
								className="input input--sm input--full-border"
								style={{ width: "11rem" }}
								value={logSearch}
								onChange={(e) => setLogSearch(e.target.value)}
							/>
							<div style={{ display: "flex", gap: "0.25rem" }}>
								{(["all", "email", "in_app", "push"] as const).map((ch) => (
									<button key={ch} className={`btn btn--sm ${channelFilter === ch ? "btn--primary" : "btn--ghost"}`} onClick={() => setChannelFilter(ch)}>
										{ch === "all" ? "All" : ch === "in_app" ? "in-app" : ch}
									</button>
								))}
							</div>
							<div style={{ display: "flex", gap: "0.25rem" }}>
								{(["all", "sent", "failed"] as const).map((s) => (
									<button key={s} className={`btn btn--sm ${statusFilter === s ? "btn--primary" : "btn--ghost"}`} onClick={() => setStatusFilter(s)}>
										{s === "all" ? "any" : s}
									</button>
								))}
							</div>
						</div>
					</div>
					{loading ? (
						<p className="muted" style={{ padding: "1.25rem" }}>Loading delivery log…</p>
					) : error ? (
						<p className="ops-modal__error" role="alert" style={{ margin: "1.25rem" }}>{error}</p>
					) : logs.length === 0 ? (
						<p className="muted" style={{ padding: "1.25rem" }}>Nothing matches — widen the filters or wait for the next send.</p>
					) : (
						<>
							<div className="ops-table-wrap">
								<table className="admin-table">
									<thead>
										<tr>
											<th>Recipient</th>
											<th>Subject</th>
											<th>Channel</th>
											<th>Status</th>
											<th>Sent</th>
											<th style={{ textAlign: "right" }}></th>
										</tr>
									</thead>
									<tbody>
										{logs.map((n) => (
											<tr key={n.id}>
												<td className="admin-table__mono" style={{ fontSize: "var(--text-xs)" }}>{n.recipient}</td>
												<td style={{ fontWeight: 500 }}>
													{n.subject}
													<span className="muted" style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 400 }}>
														{n.template ?? n.event ?? "—"}
														{n.status !== "sent" && n.errorMessage ? ` · ${n.errorMessage}` : ""}
													</span>
												</td>
												<td><span className="portal-pill portal-pill--hollow" style={{ fontSize: "0.62rem" }}>{n.channel}</span></td>
												<td>
													<span
														className={`portal-pill${n.status === "sent" ? "" : " portal-pill--hollow"}`}
														style={n.status === "sent" ? { background: "var(--foreground)", color: "var(--background)", fontSize: "var(--text-xs)" } : { fontSize: "var(--text-xs)", textDecoration: "underline", textDecorationStyle: "wavy" }}
													>
														{n.status}
														{(n.attempts ?? 1) > 1 ? ` ·${n.attempts}` : ""}
													</span>
												</td>
												<td className="muted" style={{ fontSize: "var(--text-xs)" }}>
													{new Date(n.sentAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
												</td>
												<td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
													<button type="button" className="dash-link" style={{ background: "none", border: 0, cursor: "pointer" }} onClick={() => void viewEntry(n.id)}>
														view
													</button>
													{n.status === "failed" && n.channel === "email" && (
														<button
															type="button"
															className="dash-link"
															style={{ background: "none", border: 0, cursor: "pointer", marginLeft: "0.5rem" }}
															disabled={resending === n.id || resentIds.has(n.id)}
															onClick={() => void resend(n.id)}
														>
															{resentIds.has(n.id) ? "resent ✓" : resending === n.id ? "sending…" : "resend"}
														</button>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
								<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{logs.length} of {stats.total} entries</span>
								{nextBefore && (
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadMoreLogs()} disabled={loadingMore}>
										{loadingMore ? "Loading…" : "Load 50 more"}
									</button>
								)}
							</div>
						</>
					)}
				</div>
			)}

			{tab === "health" && health && (
				<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
					<Stat label="Delivery rate" value={health.deliveryRate24h != null ? `${health.deliveryRate24h}%` : "—"} note={`${health.sent24h} sent · ${health.failed24h} failed · 24h`} inverted={health.deliveryRate24h != null && health.deliveryRate24h < 90} />
					<Stat label="Email queue" value={String(health.queueWaiting)} note={`${health.queueFailed} dead-lettered jobs`} inverted={health.queueFailed > 0} />
					<Stat label="Push subscriptions" value={String(health.pushSubscriptions)} note="Browsers registered for Web Push" />
					<Stat label="Last delivery" value={health.lastDeliveryAt ? new Date(health.lastDeliveryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"} note={health.lastDeliveryAt ? new Date(health.lastDeliveryAt).toLocaleDateString() : "worker heartbeat"} />
				</div>
			)}
			{tab === "health" && !health && (
				<div className="card" style={{ padding: "2rem", textAlign: "center" }}>
					<p className="muted">Health data didn't load — the queue counters need Redis; the rest comes from the delivery log.</p>
				</div>
			)}

			{/* Rendered-message viewer */}
			{viewing && (
				<div className="ops-modal-backdrop" onClick={() => setViewing(null)} role="dialog" aria-modal="true">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "42rem" }}>
						<header className="ops-modal__head">
							<div>
								<p className="invite-card__eyebrow" style={{ margin: 0 }}>to {viewing.recipient}</p>
								<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>{viewing.subject}</h2>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setViewing(null)}>✕ Close</button>
						</header>
						{viewing.bodyHtml ? (
							<div style={{ marginTop: "1rem", border: "var(--thin)", maxHeight: "60vh", overflow: "auto" }}>
								<iframe title="Rendered email" srcDoc={viewing.bodyHtml} style={{ width: "100%", height: "55vh", border: 0 }} sandbox="" />
							</div>
						) : viewing.bodyText ? (
							<pre style={{ marginTop: "1rem", padding: "0.75rem", border: "var(--thin)", fontSize: "var(--text-xs)", whiteSpace: "pre-wrap", maxHeight: "50vh", overflow: "auto" }}>{viewing.bodyText}</pre>
						) : (
							<p className="muted" style={{ marginTop: "1rem" }}>Logged before bodies were stored — only the envelope survives.</p>
						)}
						{viewing.errorMessage && <p className="ops-modal__error" style={{ marginTop: "0.75rem" }}>{viewing.errorMessage}</p>}
					</div>
				</div>
			)}
		</>
	);
}

/* ─── Shared ─── */

function Stat({ label, value, note, inverted }: { label: string; value: string; note: string; inverted?: boolean }) {
	return (
		<div className="card" style={inverted ? { background: "var(--foreground)", color: "var(--background)" } : undefined}>
			<p className="eyebrow" style={inverted ? { color: "var(--muted-foreground)" } : undefined}>{label}</p>
			<p className="page-title mt-1" style={inverted ? { color: "var(--background)" } : undefined}>{value}</p>
			<p className="muted mt-2" style={inverted ? { color: "var(--muted-foreground)" } : undefined}>{note}</p>
		</div>
	);
}

function formatPresence(lastSeenAt: string | null): string {
	if (!lastSeenAt) return "—";
	const ms = Date.now() - new Date(lastSeenAt).getTime();
	if (ms < 2 * 60_000) return "● online";
	if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
	if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / 60 / 60_000)}h ago`;
	return `${Math.floor(ms / 24 / 60 / 60_000)}d ago`;
}

/** A measured health component — ink card, hollow pill, no colour semantics. */
function HealthCard({ name, pill, pillTone, big, sub, foot }: {
	name: string;
	pill: string;
	/** green = healthy, ink = needs attention, hollow = unknown */
	pillTone: "ok" | "warn" | "unknown";
	big: ReactNode;
	sub: string;
	foot: string;
}) {
	return (
		<div className="card health-card">
			<div className="health-card__top">
				<span className="health-card__name">{name}</span>
				<span className={`portal-pill health-card__pill--${pillTone}`}>{pill}</span>
			</div>
			<strong className="health-card__big">{big}</strong>
			<div className="health-card__sub">{sub}</div>
			<div className="health-card__foot">{foot}</div>
		</div>
	);
}

/** Monochrome policy-matrix checkbox — ink square when on, hollow when off. */
function PolicyBox({ on }: { on: boolean }) {
	return (
		<span
			aria-hidden
			style={{
				display: "inline-block",
				width: "0.8rem",
				height: "0.8rem",
				border: "1.5px solid var(--foreground)",
				background: on ? "var(--foreground)" : "transparent",
				verticalAlign: "middle",
			}}
		/>
	);
}

function shortUserAgent(ua: string | null): string {
	if (!ua) return "—";
	if (/edg/i.test(ua)) return "Edge";
	if (/chrome/i.test(ua)) return "Chrome";
	if (/safari/i.test(ua) && !/chrome/i.test(ua)) return "Safari";
	if (/firefox/i.test(ua)) return "Firefox";
	return ua.slice(0, 40);
}
