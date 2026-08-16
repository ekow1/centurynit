import { z } from "zod";

/**
 * Operations staff roles.
 *
 * The permission matrix (`ROLE_PERMISSIONS` below) lives here so both halves —
 * the API's `requireModule` middleware and the ops app's `OpsAuthContext` —
 * check the same definition. The React copy only hides UI; the server is the
 * authority.
 */
export const roleSchema = z.enum([
	"super_admin",
	"manager",
	"coordinator",
	"consultant",
	"finance",
	"admin",
]);

/**
 * Modules a staff role can be granted. Mirrors the ops app's navigation; the
 * server checks these on `/api/*` routes via `requireModule`, the React app
 * only uses them to hide UI.
 */
export const opsModuleSchema = z.enum([
	// ── Operations (manager / consultant) ──
	"dashboard",
	"applications",
	"consultations",
	"applicants",
	"leads",
	"crm",
	"helpdesk",
	"marketing",
	"workflow",
	"visa",
	"travel",
	"documents",
	"finance",
	"invoices",
	"ledger",
	"payments",
	"payment-config",
	"appointments",
	"universities",
	"programs",
	"packages",
	"reports",
	// ── Platform administration (admin only) ──
	"system",
	"users",
	"auth",
	"cms",
	"site",
	"notifications",
	"settings",
]);

export type OpsModule = z.infer<typeof opsModuleSchema>;

/**
 * The permission matrix — the single source of truth for both halves.
 *
 * Deliberately disjoint: the admin has no window into applicant data, and
 * operational roles cannot reconfigure the platform. The API enforces this via
 * `requireModule`; the React copy in the ops app imports this same object and
 * only hides UI (docs/API_MIGRATION_PLAN.md §5).
 */
export const ROLE_PERMISSIONS: Record<z.infer<typeof roleSchema>, OpsModule[]> = {
	/**
	 * The only role that spans operations *and* platform administration.
	 *
	 * Every other role is deliberately partial — the admin has no window into
	 * applicant data, operational roles cannot reconfigure the platform. This one
	 * exists to bootstrap and recover the system (it is the role that can invite
	 * the first admin), not for day-to-day work, and should be held by as few
	 * people as possible.
	 */
	super_admin: opsModuleSchema.options as unknown as OpsModule[],
	manager: [
		"dashboard", "applications", "consultations", "applicants", "leads", "helpdesk", "marketing",
		"finance", "invoices", "ledger", "payments", "payment-config",
		"workflow", "visa", "travel", "documents", "appointments", "universities",
		"programs", "packages", "reports",
	],
	coordinator: [
		"dashboard", "applications", "consultations", "applicants", "leads", "helpdesk", "marketing",
		"workflow", "visa", "travel", "documents", "appointments", "universities",
		"programs", "packages", "reports",
	],
	consultant: [
		"dashboard", "applications", "consultations", "applicants", "leads", "helpdesk", "marketing", "workflow",
		"visa", "travel", "documents", "appointments", "universities", "programs", "packages", "reports",
	],
	finance: [
		"dashboard", "finance", "invoices", "ledger", "payments", "payment-config", "packages", "reports", "helpdesk",
	],
	admin: [
		"system", "users", "auth", "cms", "site", "notifications", "settings", "helpdesk",
	],
};

/**
 * Capability lists — viewing a module is not the same as changing it.
 * Finance owns money; manager and coordinator route work to people.
 */
export const ASSIGN_WORK_ROLES = ["manager", "coordinator"] as const;
export const EDIT_PACKAGES_ROLES = ["manager", "finance"] as const;
export const EDIT_UNIVERSITIES_ROLES = ["manager"] as const;

/** Whether a role (from an untrusted string) may access a module. */
export function roleCanAccess(role: string, module: OpsModule): boolean {
	const parsed = roleSchema.safeParse(role);
	if (!parsed.success) return false;
	return ROLE_PERMISSIONS[parsed.data].includes(module);
}

export const opsUserSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	name: z.string().min(1),
	role: roleSchema,
	branch: z.string().optional(),
	active: z.boolean().default(true),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export type OpsUser = z.infer<typeof opsUserSchema>;
export type OpsRole = z.infer<typeof roleSchema>;
