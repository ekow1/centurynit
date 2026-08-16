import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import {
	ROLE_PERMISSIONS,
	ASSIGN_WORK_ROLES,
	EDIT_PACKAGES_ROLES,
	EDIT_UNIVERSITIES_ROLES,
	roleCanAccess,
	opsModuleSchema,
	API_PREFIX,
	type OpsModule,
	type OpsRole,
} from "century-nit-shared";
import { getSession, signIn as apiSignIn, signOut as apiSignOut, apiFetch, type SessionResponse } from "../lib/api";

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

const EDIT_PACKAGES: readonly OpsRole[] = EDIT_PACKAGES_ROLES;
const EDIT_UNIVERSITIES: readonly OpsRole[] = EDIT_UNIVERSITIES_ROLES;
const ASSIGN_WORK: readonly OpsRole[] = ASSIGN_WORK_ROLES;

/** Where each role lands when they open the console. */
export const ROLE_HOME: Record<OpsRole, string> = {
	// Spans both halves, so the platform console is the sensible landing page.
	super_admin: "/system",
	manager: "/dashboard",
	coordinator: "/dashboard",
	consultant: "/dashboard",
	finance: "/dashboard",
	admin: "/system",
};

/* ─── Mock User Profiles ─── */

export interface OpsUser {
	name: string;
	email: string;
	role: OpsRole;
	branch: string;
	avatar: string;
}

const MOCK_USERS: Record<OpsRole, OpsUser> = {
	super_admin: {
		name: "Super Admin",
		email: "sa@century-nit.com",
		role: "super_admin",
		branch: "platform",
		avatar: "SA",
	},
	manager: {
		name: "Adjoa Mensah-Bonsu",
		email: "a.mensah@century-nit.com",
		role: "manager",
		branch: "accra",
		avatar: "AM",
	},
	coordinator: {
		name: "Kojo Asante",
		email: "k.asante@century-nit.com",
		role: "coordinator",
		branch: "accra",
		avatar: "KA",
	},
	consultant: {
		name: "Efua Owusu",
		email: "e.owusu@century-nit.com",
		role: "consultant",
		branch: "accra",
		avatar: "EO",
	},
	finance: {
		name: "Ama Serwaa Boateng",
		email: "a.serwaa@century-nit.com",
		role: "finance",
		branch: "accra",
		avatar: "AS",
	},
	admin: {
		name: "Kwabena Osei",
		email: "k.osei@century-nit.com",
		role: "admin",
		branch: "platform",
		avatar: "KO",
	},
};

export const ROLE_LABELS: Record<OpsRole, string> = {
	super_admin: "Super Administrator",
	manager: "Manager",
	coordinator: "Coordinator",
	consultant: "Consultant",
	finance: "Finance Officer",
	admin: "System Administrator",
};

export const ROLE_DESCRIPTIONS: Record<OpsRole, string> = {
	super_admin:
		"The only role spanning operations and platform administration. Exists to bootstrap and recover the system - it is the role that can invite the first administrator - rather than for day-to-day work, and should be held by as few people as possible.",
	manager:
		"Coordinates the whole client journey. Sees every lead, booking, application, and visa stage, assigns and reassigns work to consultants, and monitors progress. Does not create consultations - clients book those themselves.",
	coordinator:
		"Manages CRM leads, assigns consultants to bookings, follows up on leads, and tracks all workflows. Can reassign cases between consultants. Handles the day-to-day operational delegation so the manager can focus on high-level decisions.",
	consultant:
		"Works only the cases assigned to them. Reviews documents, adds comments and recommendations, requests further documents, updates progress, and can reschedule an assigned consultation.",
	finance:
		"Owns the money. All invoices, balances, revenue tracking, and financial reporting.",
	admin:
		"Platform administration only. Users and roles, authentication, CMS and site content, system notifications, and configuration. No access to applicant case data.",
};

/* ─── Storage ─── */

const OPS_AUTH_KEY = "century-nit-ops-auth";

/** Roles were reduced from six to three - drop any stale session. */
function isKnownRole(role: unknown): role is OpsRole {
	return (
		role === "super_admin" ||
		role === "manager" ||
		role === "coordinator" ||
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
	/** Sign in with real credentials via Better Auth. */
	opsSignInWithCredentials: (email: string, password: string) => Promise<OpsUser>;
	/** Mock sign-in by role selection (dev only). */
	opsSignIn: (role: OpsRole) => void;
	/** True when the session came from the prototype role picker, not the API. */
	isMockSession: boolean;
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
	/** Only the manager can edit the package catalogue. */
	canEditPackages: boolean;
	/** Only the manager can add or edit universities and programs. */
	canEditUniversities: boolean;
}

const OpsAuthContext = createContext<OpsAuthContextValue | null>(null);

function staffToOpsUser(s: NonNullable<SessionResponse["staff"]>): OpsUser {
	return {
		name: s.name,
		email: s.email,
		role: s.role as OpsRole,
		branch: s.branch ?? "",
		avatar: s.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
	};
}

export function OpsAuthProvider({ children }: { children: ReactNode }) {
	const [opsUser, setOpsUser] = useState<OpsUser | null>(loadSession);
	const [authInitializing, setAuthInitializing] = useState(true);
	const [isMockSession, setIsMockSession] = useState(false);
	const [dynamicPermissions, setDynamicPermissions] = useState<Record<string, OpsModule[]>>({});

	const opsRole = opsUser?.role ?? null;

	const refreshPermissions = useCallback(async () => {
		try {
			const res = await apiFetch<{ roles: Array<{ id: string; permissions: OpsModule[] }> }>(
				`${API_PREFIX}/roles`,
			);
			const map: Record<string, OpsModule[]> = {};
			for (const r of res.roles) {
				map[r.id] = r.permissions;
			}
			setDynamicPermissions(map);
		} catch {
			// API error or unauthenticated, fallback to built-in map
		}
	}, []);

	// On mount, check for an existing API session and load role permissions.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const { staff } = await getSession();
				if (cancelled) return;
				if (staff) {
					const user = staffToOpsUser(staff);
					setOpsUser(user);
					setIsMockSession(false);
					saveSession(user);
					void refreshPermissions();
				}
			} catch {
				// API not reachable — keep a mock session only in development.
			} finally {
				if (!cancelled) setAuthInitializing(false);
			}
		})();
		return () => { cancelled = true; };
	}, [refreshPermissions]);

	const opsSignInWithCredentials = useCallback(async (email: string, password: string) => {
		await apiSignIn(email, password);
		const { staff } = await getSession();
		if (!staff) throw new Error("No staff profile linked to this account.");
		const user = staffToOpsUser(staff);
		setOpsUser(user);
		setIsMockSession(false);
		saveSession(user);
		void refreshPermissions();
		return user;
	}, [refreshPermissions]);

	const opsSignIn = useCallback((role: OpsRole) => {
		if (!import.meta.env.DEV) return;
		const user = MOCK_USERS[role as keyof typeof MOCK_USERS] ?? {
			name: role,
			email: `${role}@century-nit.com`,
			role,
			branch: "platform",
			avatar: role.slice(0, 2).toUpperCase(),
		};
		setOpsUser(user);
		setIsMockSession(true);
		saveSession(user);
	}, []);

	const opsSignOut = useCallback(() => {
		apiSignOut().catch(() => {});
		setOpsUser(null);
		setIsMockSession(false);
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
		if (dynamicPermissions[opsRole]) return dynamicPermissions[opsRole];
		return (ROLE_PERMISSIONS as Record<string, OpsModule[]>)[opsRole] ?? [];
	}, [opsRole, dynamicPermissions]);


	const canSeeAllBranches =
		opsRole === "super_admin" ||
		opsRole === "admin" ||
		opsRole === "manager" ||
		opsRole === "coordinator" ||
		opsRole === "finance";
	const branchScopeId = opsUser?.branch ?? null;
	const requiresAssignmentScope = opsRole === "consultant";
	const inBranchScope = useCallback(
		(branch: string) => canSeeAllBranches || branch === branchScopeId,
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
				opsSignIn,
				opsSignOut,
				isMockSession,
				hasPermission,
				getAllowedModules,
				canSeeAllBranches,
				branchScopeId,
				inBranchScope,
				requiresAssignmentScope,
				scopeRecords,
				canAssignWork: opsRole !== null && ASSIGN_WORK.includes(opsRole),
				canEditPackages: opsRole !== null && EDIT_PACKAGES.includes(opsRole),
				canEditUniversities: opsRole !== null && EDIT_UNIVERSITIES.includes(opsRole),
			}}
		>
			{children}
		</OpsAuthContext.Provider>
	);
}

export function useOpsAuth() {
	const ctx = useContext(OpsAuthContext);
	if (!ctx) throw new Error("useOpsAuth must be used within OpsAuthProvider");
	return ctx;
}
