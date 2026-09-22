import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import {
	ROLE_LABELS as SHARED_ROLE_LABELS,
	ROLE_PERMISSIONS,
	roleCanAccess,
	roleHasCapability,
	opsModuleSchema,
	type Capability,
	API_PREFIX,
	type OpsModule,
	type OpsRole,
} from "century-nit-shared";
import {
	getSession,
	signIn as apiSignIn,
	signOut as apiSignOut,
	verifyTotp as apiVerifyTotp,
	verifyBackupCode as apiVerifyBackupCode,
	apiFetch,
	sendTwoFactorOtp,
	verifyTwoFactorOtp,
	getPendingMfaMethod,
	type SessionResponse,
} from "../lib/api";
import { useOpsSSE } from "../hooks/useChatStream";
import { IdleTimeout } from "../components/IdleTimeout";

/* ─── Role Definitions ─── */

/**
 * Five seats:
 *  - manager     - coordinates the whole journey. Sees everything, assigns work.
 *                  Does not create consultations; clients book those themselves.
 *  - coordinator - manages CRM leads, assigns consultants to bookings, follows up
 *                  on leads, tracks all workflows, and can reassign cases.
 *  - consultant  - works only what the manager or coordinator assigns them.
 *  - finance     - money and service packages.
 *  - admin       - the platform itself, not the business. No case data.
 *
 * The roles, modules and permission matrix live in `century-nit-shared` — the
 * API enforces the same matrix server-side via `requireModule`. This file only
 * re-exports them and uses them to hide UI.
 */
export type { OpsRole, OpsModule };
export { ROLE_PERMISSIONS };


/** Where each role lands when they open the console. */
export const ROLE_HOME: Record<OpsRole, string> = {
	// Oversight roles land on the dashboard — the day's picture first.
	super_admin: "/dashboard",
	manager: "/dashboard",
	finance: "/dashboard",
	admin: "/system",
	// Operational roles land on their personal desk, not the aggregate dashboard.
	coordinator: "/workspace",
	consultant: "/workspace",
	customer_service: "/workspace",
};

export interface OpsUser {
	opsUserId: string;
	name: string;
	email: string;
	role: OpsRole;
	branch: string;
	avatar: string;
}

// The vocabulary's role names; custom roles are added when the roster loads.
export const ROLE_LABELS: Record<OpsRole, string> = { ...SHARED_ROLE_LABELS };

export const ROLE_DESCRIPTIONS: Record<OpsRole, string> = {
	super_admin:
		"Full unrestricted platform control. Access to every operational workspace, staff matrices, system configuration, client records, and financial controls.",
	manager:
		"Covers every branch. Assigns consultants to consultations, creates school applications after assessment, edits package and university catalogues, and sees full revenue reporting.",
	coordinator:
		"Desk for the assigned branch. Reviews incoming consultations, checks uploaded identity and academic documents, and assigns consultations to consultants.",
	customer_service:
		"Owns the support queue and inbound leads. Handles client inquiries, coordinates case assignments, and ensures no message goes unanswered.",
	consultant:
		"Works only the cases assigned to them. Reviews documents, adds comments and recommendations, requests further documents, updates progress, and can reschedule an assigned consultation.",
	finance:
		"Owns the money. All invoices, balances, revenue tracking, and financial reporting.",
	admin:
		"Platform administration plus casework. Users and roles, authentication, CMS and site content, system notifications, and configuration — and like a manager, can take or be assigned a case.",
};

/* ─── Storage ─── */

const OPS_AUTH_KEY = "century-nit-ops-auth";

/** Roles were reduced from six to three - drop any stale session. */
function isKnownRole(role: unknown): role is OpsRole {
	return (
		role === "super_admin" ||
		role === "manager" ||
		role === "coordinator" ||
		role === "customer_service" ||
		role === "consultant" ||
		role === "finance" ||
		role === "admin"
	);
}

function loadSession(): OpsUser | null {
	try {
		const raw = sessionStorage.getItem(OPS_AUTH_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as OpsUser;
		if (!isKnownRole(parsed?.role)) return null;
		return parsed;
	} catch {
		return null;
	}
}

function saveSession(user: OpsUser | null) {
	if (user) {
		sessionStorage.setItem(OPS_AUTH_KEY, JSON.stringify(user));
	} else {
		sessionStorage.removeItem(OPS_AUTH_KEY);
	}
}

/* ─── Context ─── */

interface OpsAuthContextValue {
	opsUser: OpsUser | null;
	opsRole: OpsRole | null;
	/** True until the initial session check completes. */
	authInitializing: boolean;
	/** Sign in with real credentials via Better Auth. Returns MFA method if 2FA is required. */
	opsSignInWithCredentials: (email: string, password: string, rememberMe?: boolean) => Promise<{
		user?: OpsUser;
		twoFactorRequired?: boolean;
		mfaMethod?: string | null;
	}>;
	/** Complete sign in via 2FA TOTP or backup recovery code. */
	opsVerifyTwoFactor: (code: string, isBackupCode?: boolean) => Promise<OpsUser>;
	/** Complete sign in via email OTP MFA. */
	opsVerifyEmailOtp: (code: string) => Promise<OpsUser>;
	/** Send email OTP for MFA verification. */
	opsSendMfaOtp: () => Promise<void>;
	opsSignOut: () => void;
	hasPermission: (module: OpsModule) => boolean;
	getAllowedModules: () => OpsModule[];
	/**
	 * Manager and finance see every branch. Coordinator is scoped to their own
	 * branch, consultant to their own assignments (clamped to their branch).
	 */
	canSeeAllBranches: boolean;
	/** Canonical id of the signed-in user's branch ("platform" for admin). */
	branchScopeId: string | null;
	/** Whether a record in the given branch is visible to the signed-in user. */
	inBranchScope: (branch: string) => boolean;
	/** Consultant - sees only records assigned to them. */
	requiresAssignmentScope: boolean;
	/**
	 * Apply branch + assignment scoping to any record list that carries a
	 * branch field. Manager/finance get everything; coordinator gets their
	 * branch; consultant gets their assignments clamped to their branch.
	 */
	scopeRecords: <T extends { branch: string }>(
		records: T[],
		isAssigned: (r: T) => boolean,
	) => T[];
	/** Only the manager assigns and reassigns cases. */
	canAssignWork: boolean;
	/** Whether the signed-in role holds a capability — the same list the server checks. */
	hasCapability: (capability: Capability) => boolean;
	/** May turn a proforma into a payable invoice, void or credit one. */
	canIssueInvoices: boolean;
	/** Only the manager can edit the package catalogue. */
	canEditPackages: boolean;
	/** Only the manager can add or edit universities and programs. */
	canEditUniversities: boolean;
	/** Every role the server knows, system and custom, as last fetched. */
	roleCatalog: RoleSummary[];
	/** Re-fetch roles and permissions — call after editing a role. */
	refreshPermissions: () => Promise<void>;
}

export type RoleSummary = {
	id: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	/** Modules and capabilities, together. */
	permissions: string[];
	rank: number;
	createdAt: string;
	updatedAt: string;
};

const OpsAuthContext = createContext<OpsAuthContextValue | null>(null);

function staffToOpsUser(s: NonNullable<SessionResponse["staff"]>): OpsUser {
	return {
		opsUserId: s.opsUserId,
		name: s.name,
		email: s.email,
		role: s.role as OpsRole,
		branch: s.branch ?? "",
		avatar: s.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
	};
}

/**
 * Keeps the permission map honest while a session is open: a push when a
 * role is edited anywhere, a refresh when the window regains focus (a
 * laptop woken from sleep), and a slow interval as the safety net. Mounted
 * only while signed in, so the event stream is never opened on the login
 * page.
 */
function PermissionsSync({ refresh }: { refresh: () => Promise<void> }) {
	useOpsSSE((event) => {
		if (event.type === "roles.changed") void refresh();
	});
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") void refresh();
		};
		document.addEventListener("visibilitychange", onVisible);
		const timer = window.setInterval(() => void refresh(), 5 * 60_000);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.clearInterval(timer);
		};
	}, [refresh]);
	return null;
}

const IDLE_LIMIT_KEY = "cn-ops-idle-hours";
const DEFAULT_IDLE_HOURS = 2;

export function OpsAuthProvider({ children }: { children: ReactNode }) {
	const [opsUser, setOpsUser] = useState<OpsUser | null>(loadSession);
	const [authInitializing, setAuthInitializing] = useState(true);
	const [dynamicPermissions, setDynamicPermissions] = useState<Record<string, string[]>>({});
	const [roleCatalog, setRoleCatalog] = useState<RoleSummary[]>([]);
	const [idleHours, setIdleHours] = useState<number>(DEFAULT_IDLE_HOURS);

	// The admin auth policy owns the idle limit; every session probe adopts it.
	// Persisted so the signed-out notice on /login can quote the real number.
	const applyPolicy = useCallback((s: SessionResponse) => {
		if (!s.idleHours) return;
		setIdleHours(s.idleHours);
		try {
			localStorage.setItem(IDLE_LIMIT_KEY, String(s.idleHours));
		} catch {}
	}, []);

	const opsRole = opsUser?.role ?? null;

	/** Drop the sessionStorage copy when the server says there is no session. */
	const dropStaleSession = useCallback(() => {
		setOpsUser(null);
		saveSession(null);
	}, []);

	const refreshPermissions = useCallback(async () => {
		try {
			const res = await apiFetch<{ roles: RoleSummary[] }>(`${API_PREFIX}/roles`);
			const map: Record<string, string[]> = {};
			for (const r of res.roles) {
				map[r.id] = r.permissions;
				// The label maps are static for the built-in roles; custom roles
				// are only known once fetched, so their names are filled in here.
				ROLE_LABELS[r.id] = r.name;
				if (r.description) ROLE_DESCRIPTIONS[r.id] = r.description;
			}
			setDynamicPermissions(map);
			setRoleCatalog(res.roles);
		} catch {
			// API error or unauthenticated, fallback to built-in map
		}
		// Re-probe the session too: a changed idle policy reaches open tabs here
		// rather than only at the next sign-in, and a cookie that died while the
		// tab sat open drops the stale session instead of bouncing to /mfa-setup.
		try {
			const sess = await getSession();
			applyPolicy(sess);
			if (!sess.staff) dropStaleSession();
		} catch {}
	}, [applyPolicy, dropStaleSession]);

	// On mount, check for an existing API session and load role permissions.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const sess = await getSession();
				applyPolicy(sess);
				const { staff } = sess;
				if (cancelled) return;
				if (staff) {
					const user = staffToOpsUser(staff);
					setOpsUser(user);
					saveSession(user);
					void refreshPermissions();
				} else {
					// /me answered but found no staff session — the cookie is
					// dead or belongs to a portal account, so the sessionStorage
					// copy is stale. Without this the guards keep a phantom user
					// and their MFA probes 401 into /mfa-setup instead of /login.
					dropStaleSession();
				}
			} catch {
				// API not reachable — no session.
			} finally {
				if (!cancelled) setAuthInitializing(false);
			}
		})();
		return () => { cancelled = true; };
	}, [refreshPermissions, applyPolicy, dropStaleSession]);

	const opsSignInWithCredentials = useCallback(async (email: string, password: string, rememberMe?: boolean) => {
		const res = await apiSignIn(email, password, rememberMe);
		if (res?.twoFactorRedirect) {
			/*
			 * Resolve which MFA method was enrolled. There is no session yet —
			 * getMfaEnrollment requires one and silently 401s here — so this
			 * reads the pending two-factor cookie via /api/auth/mfa/method.
			 */
			let mfaMethod: string | null = "totp";
			try {
				const pending = await getPendingMfaMethod();
				mfaMethod = pending.method ?? "totp";
			} catch {
				/*
				 * Endpoint unreachable — the sign-in response still advertises
				 * the working verify routes: an email-OTP enrollee gets ["otp"]
				 * only, since their armed TOTP secret was never verified.
				 */
				const routes = res.twoFactorMethods ?? [];
				if (routes.includes("otp") && !routes.includes("totp")) {
					mfaMethod = "email_otp";
				}
			}
			return { twoFactorRequired: true, mfaMethod };
		}

		const sess = await getSession();
		applyPolicy(sess);
		const { staff } = sess;
		if (!staff) throw new Error("No staff profile linked to this account.");

		const user = staffToOpsUser(staff);
		setOpsUser(user);
		saveSession(user);
		void refreshPermissions();
		return { user };
	}, [refreshPermissions, applyPolicy]);

	const opsVerifyTwoFactor = useCallback(async (code: string, isBackupCode?: boolean) => {
		const cleanCode = code.trim().replace(/\s+/g, "");
		if (isBackupCode) {
			await apiVerifyBackupCode(cleanCode);
		} else {
			await apiVerifyTotp(cleanCode.replace(/\D/g, ""));
		}
		const sess = await getSession();
		applyPolicy(sess);
		const { staff } = sess;
		if (!staff) throw new Error("No staff profile linked to this account.");
		const user = staffToOpsUser(staff);
		setOpsUser(user);
		saveSession(user);
		void refreshPermissions();
		return user;
	}, [refreshPermissions, applyPolicy]);

	const opsVerifyEmailOtp = useCallback(async (code: string) => {
		const cleanCode = code.trim().replace(/\s+/g, "");
		// Better Auth's verify-otp — works in the pending window and issues the
		// session on success. The custom /auth-settings/mfa/verify-otp needs a
		// session already, so it could never serve this flow.
		await verifyTwoFactorOtp(cleanCode);
		const sess = await getSession();
		applyPolicy(sess);
		const { staff } = sess;
		if (!staff) throw new Error("No staff profile linked to this account.");
		const user = staffToOpsUser(staff);
		setOpsUser(user);
		saveSession(user);
		void refreshPermissions();
		return user;
	}, [refreshPermissions, applyPolicy]);

	const opsSendMfaOtp = useCallback(async () => {
		await sendTwoFactorOtp();
	}, []);

	const opsSignOut = useCallback(() => {
		apiSignOut().catch(() => {});
		setOpsUser(null);
		saveSession(null);
	}, []);

	const hasPermission = useCallback(
		(module: OpsModule) => {
			if (!opsRole) return false;
			return roleCanAccess(opsRole, module, dynamicPermissions);
		},
		[opsRole, dynamicPermissions],
	);

	const getAllowedModules = useCallback(() => {
		if (!opsRole) return [];
		if (opsRole === "super_admin") return opsModuleSchema.options as unknown as OpsModule[];
		if (dynamicPermissions[opsRole]) {
			return dynamicPermissions[opsRole].filter((p) => (opsModuleSchema.options as string[]).includes(p)) as OpsModule[];
		}
		return (ROLE_PERMISSIONS as Record<string, OpsModule[]>)[opsRole] ?? [];
	}, [opsRole, dynamicPermissions]);

	// Capabilities — what the role may do — from the same fetched list the
	// server enforces, with the built-in defaults until it arrives.
	const hasCapability = useCallback(
		(capability: Capability) => (opsRole ? roleHasCapability(opsRole, capability, dynamicPermissions) : false),
		[opsRole, dynamicPermissions],
	);
	const canSeeAllBranches = hasCapability("see_all_branches");
	const branchScopeId = opsUser?.branch ?? null;
	// Neither every branch nor every case: only what is assigned to them.
	const requiresAssignmentScope = Boolean(opsRole) && !canSeeAllBranches && !hasCapability("see_all_cases");
	const inBranchScope = useCallback(
		(branch: string) => canSeeAllBranches || branch === branchScopeId || branch.startsWith(`${branchScopeId}-`),
		[canSeeAllBranches, branchScopeId],
	);
	const scopeRecords = useCallback(
		<T extends { branch: string }>(records: T[], isAssigned: (r: T) => boolean): T[] => {
			if (canSeeAllBranches) return records;
			const inBranch = records.filter((r) => inBranchScope(r.branch));
			return requiresAssignmentScope ? inBranch.filter(isAssigned) : inBranch;
		},
		[canSeeAllBranches, requiresAssignmentScope, inBranchScope],
	);

	return (
		<OpsAuthContext.Provider
			value={{
				opsUser,
				opsRole,
				authInitializing,
				opsSignInWithCredentials,
				opsVerifyTwoFactor,
				opsVerifyEmailOtp,
				opsSendMfaOtp,
				opsSignOut,
				hasPermission,
				getAllowedModules,
				canSeeAllBranches,
				branchScopeId,
				inBranchScope,
				requiresAssignmentScope,
				scopeRecords,
				canAssignWork: hasCapability("assign_work"),
				hasCapability,
				canIssueInvoices: hasCapability("issue_invoices"),
				canEditPackages: hasCapability("edit_packages"),
				canEditUniversities: hasCapability("edit_universities"),
				roleCatalog,
				refreshPermissions,
			}}
		>
			{opsUser && <PermissionsSync refresh={refreshPermissions} />}
			{opsUser && (
				<IdleTimeout
					idleMs={idleHours * 60 * 60 * 1000}
					warnMs={5 * 60 * 1000}
					storageKey="cn-ops-idle-at"
					name={opsUser.name}
					idleLabel={`${idleHours} ${idleHours === 1 ? "hour" : "hours"}`}
					lead={`No activity for about ${idleHours} ${idleHours === 1 ? "hour" : "hours"}. For client data safety, staff sessions sign out automatically.`}
					keepAlive={async () => {
						try {
							const sess = await getSession();
							applyPolicy(sess);
							return Boolean(sess.staff);
						} catch {
							return false;
						}
					}}
					onExpire={() => {
						void (async () => {
							try {
								await apiSignOut();
							} catch {}
							setOpsUser(null);
							saveSession(null);
							window.location.assign("/login?reason=idle");
						})();
					}}
				/>
			)}
			{children}
		</OpsAuthContext.Provider>
	);
}

export function useOpsAuth() {
	const ctx = useContext(OpsAuthContext);
	if (!ctx) throw new Error("useOpsAuth must be used within OpsAuthProvider");
	return ctx;
}
