import { z } from "zod";

/**
 * Operations staff roles.
 *
 * The permission matrix (`ROLE_PERMISSIONS` below) lives here so both halves —
 * the API's `requireModule` middleware and the ops app's `OpsAuthContext` —
 * check the same definition. The React copy only hides UI; the server is the
 * authority.
 */
export const SYSTEM_ROLES = [
	"super_admin",
	"manager",
	"coordinator",
	"customer_service",
	"consultant",
	"finance",
	"admin",
] as const;

export const roleSchema = z.string().min(1);
export type SystemRole = (typeof SYSTEM_ROLES)[number];
export type OpsRole = string;

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
	"chat",
	// ── Platform administration (admin only) ──
	"system",
	"users",
	"auth",
	"cms",
	"lookups",
	"site",
	"notifications",
	"settings",
	// ── Branch scheduling configuration (manager + systems) ──
	"scheduling",
]);

export type OpsModule = z.infer<typeof opsModuleSchema>;

/**
 * Module metadata and groupings for the Permissions Matrix UI.
 */
export const MODULE_GROUPS: Array<{
	group: string;
	description: string;
	modules: Array<{ id: OpsModule; label: string; description: string }>;
}> = [
	{
		group: "Core Operations",
		description: "Day-to-day client engagement and case management.",
		modules: [
			{ id: "dashboard", label: "Dashboard", description: "Operational metrics and quick overviews" },
			{ id: "applications", label: "Applications", description: "Client university and program applications" },
			{ id: "consultations", label: "Consultations", description: "Initial and follow-up advisory sessions" },
			{ id: "applicants", label: "Applicants", description: "Client accounts and profile records" },
			{ id: "leads", label: "CRM & Leads", description: "Inbound leads, inquiry pipeline, and CRM" },
			{ id: "appointments", label: "Appointments", description: "Calendar booking and consultant schedules" },
			{ id: "helpdesk", label: "Helpdesk", description: "Support tickets and applicant inquiries" },
			{ id: "chat", label: "Internal Chat", description: "Staff-to-staff messaging and team coordination" },
			{ id: "marketing", label: "Marketing", description: "Campaigns and outreach tools" },
		],
	},
	{
		group: "Financials & Invoicing",
		description: "Revenue, payments, fee schedules, and invoices.",
		modules: [
			{ id: "finance", label: "Financial Overview", description: "Revenue tracking and financial summaries" },
			{ id: "invoices", label: "Invoices", description: "Proforma generation and formal invoice issuance" },
			{ id: "ledger", label: "Accounting Ledger", description: "Immutable transaction and invoice history" },
			{ id: "payments", label: "Payments Log", description: "Gateways, Paystack, Stripe, and bank transfers" },
			{ id: "payment-config", label: "Payment Config", description: "Gateway toggles and currency configurations" },
			{ id: "packages", label: "Service Packages", description: "Package tiers, pricing, and services included" },
			{ id: "reports", label: "Analytics & Reports", description: "Financial and operational reporting" },
		],
	},
	{
		group: "Admissions, Visa & Travel",
		description: "Educational placement, visa handling, and relocation.",
		modules: [
			{ id: "universities", label: "Universities & Programs", description: "Partner universities and course catalogs" },
			{ id: "documents", label: "Document Verification", description: "Applicant document review and verification" },
			{ id: "workflow", label: "Case Workflow", description: "Multi-stage admissions progression" },
			{ id: "visa", label: "Visa Processing", description: "Embassy filings, CAS, and visa outcomes" },
			{ id: "travel", label: "Travel & Relocation", description: "Flights, accommodation, and arrival briefings" },
		],
	},
	{
		group: "Platform Administration",
		description: "Platform settings, user access, and system governance.",
		modules: [
			{ id: "system", label: "System Overview", description: "Platform health and server metrics" },
			{ id: "users", label: "Users & Roles", description: "Staff directory, roles, and permissions matrix" },
			{ id: "auth", label: "Authentication", description: "Sign-in methods, sessions, and MFA policy" },
			{ id: "cms", label: "Content Management", description: "Public website content, destinations, and blog" },
			{ id: "lookups", label: "Form Catalogue", description: "Manage dynamic form dropdowns" },
			{ id: "site", label: "Site & UI", description: "Public website branding and navigation" },
			{ id: "notifications", label: "Notifications", description: "Automated templates and communication channels" },
			{ id: "settings", label: "System Configuration", description: "API keys, fee schedule, and integration credentials" },
			{ id: "scheduling", label: "Scheduling Configuration", description: "Branch consultation slots and operating hours" },
		],
	},
];

/**
 * Built-in default permissions matrix (fallback when not loaded from DB).
 */
export const ROLE_PERMISSIONS: Record<SystemRole, OpsModule[]> = {
	super_admin: opsModuleSchema.options as unknown as OpsModule[],
	manager: [
		"dashboard", "applications", "consultations", "applicants", "leads", "crm", "helpdesk", "marketing",
		"finance", "invoices", "ledger", "payments", "payment-config",
		"workflow", "visa", "travel", "documents", "appointments", "universities",
		"programs", "packages", "reports", "chat", "scheduling",
	],
	coordinator: [
		"dashboard", "applications", "consultations", "applicants", "leads", "crm", "helpdesk", "marketing",
		"workflow", "visa", "travel", "documents", "appointments", "universities",
		"programs", "packages", "reports", "chat",
	],
	customer_service: [
		"dashboard", "applications", "consultations", "applicants", "leads", "crm", "helpdesk",
		"workflow", "documents", "appointments", "chat",
	],
	consultant: [
		"dashboard", "applications", "consultations", "applicants", "leads", "crm", "helpdesk", "marketing", "workflow",
		"visa", "travel", "documents", "appointments", "universities", "programs", "packages", "reports", "chat",
	],
	finance: [
		"dashboard", "finance", "invoices", "ledger", "payments", "payment-config", "packages", "reports", "helpdesk", "chat",
	],
	admin: [
		"system", "users", "auth", "cms", "lookups", "site", "notifications", "settings", "scheduling", "helpdesk", "chat",
	],
};

/* ── Capabilities ─────────────────────────────────────────────────────────
 *
 * A module says what a role can *see*; a capability says what it can *do*.
 * Both are strings in the same `permissions` list on a role, so the role
 * editor governs both and a custom role can be given real work. The
 * server checks capabilities with `requireCapability` and the helpers
 * below; the console reads the same list to show or hide controls.
 */

export const capabilitySchema = z.enum([
	/** Assign and reassign case owners; resolve and defer stage handoffs. */
	"assign_work",
	/** See every case, not only one's own assignments. */
	"see_all_cases",
	/** See every branch, not only one's own. */
	"see_all_branches",
	/** Invite staff and change their role or branch (of lower rank). */
	"invite_staff",
	/** Create, edit and delete roles. */
	"manage_roles",
	/** Platform configuration: company calendar, integrations. */
	"manage_settings",
	/** Ban, unban and sign out client accounts. */
	"manage_clients",
	"edit_packages",
	"edit_universities",
	/** Turn a proforma into a payable invoice; void; credit. */
	"issue_invoices",
	/** May own the work of a chapter — offered in that chapter's assign control. */
	"own:consult",
	"own:apply",
	"own:visa",
	"own:depart",
]);
export type Capability = z.infer<typeof capabilitySchema>;

export const CAPABILITIES: readonly { id: Capability; label: string; hint: string; group: string }[] = [
	{ id: "assign_work", label: "Assign work", hint: "Set and change case owners; resolve handoffs", group: "Cases" },
	{ id: "see_all_cases", label: "See all cases", hint: "Not only cases assigned to them", group: "Cases" },
	{ id: "see_all_branches", label: "See all branches", hint: "Not only their own branch", group: "Cases" },
	{ id: "own:consult", label: "Own consultations", hint: "Can be the consultant on a consultation", group: "Chapter ownership" },
	{ id: "own:apply", label: "Own applications", hint: "Can be the consultant on a case through Enrolment and Applications", group: "Chapter ownership" },
	{ id: "own:visa", label: "Own visa work", hint: "Can be the visa officer", group: "Chapter ownership" },
	{ id: "own:depart", label: "Own departure work", hint: "Can be the travel officer", group: "Chapter ownership" },
	{ id: "issue_invoices", label: "Issue invoices", hint: "Issue, void and credit invoices; raising a proforma needs only the chapter", group: "Money" },
	{ id: "edit_packages", label: "Edit packages", hint: "Service packages and their fees", group: "Catalogue" },
	{ id: "edit_universities", label: "Edit universities & programmes", hint: "", group: "Catalogue" },
	{ id: "invite_staff", label: "Invite & manage staff", hint: "Of lower rank than their own", group: "Administration" },
	{ id: "manage_roles", label: "Manage roles", hint: "Create roles and edit permissions", group: "Administration" },
	{ id: "manage_clients", label: "Manage client accounts", hint: "Ban, unban, sign out", group: "Administration" },
	{ id: "manage_settings", label: "Platform settings", hint: "Integrations and configuration", group: "Administration" },
];

/** A role's permission list holds modules and capabilities side by side. */
export const permissionSchema = z.union([opsModuleSchema, capabilitySchema]);
export type Permission = z.infer<typeof permissionSchema>;

/** What each built-in role can do — the seed and the "reset to defaults". */
export const ROLE_CAPABILITIES: Record<SystemRole, Capability[]> = {
	super_admin: capabilitySchema.options as unknown as Capability[],
	manager: ["assign_work", "see_all_cases", "see_all_branches", "invite_staff", "manage_clients", "edit_packages", "edit_universities", "issue_invoices", "own:consult", "own:apply", "own:visa", "own:depart"],
	coordinator: ["assign_work", "see_all_cases", "see_all_branches", "own:consult", "own:apply", "own:visa", "own:depart"],
	customer_service: ["assign_work", "see_all_branches"],
	consultant: ["own:consult", "own:apply", "own:visa", "own:depart"],
	finance: ["see_all_branches", "edit_packages", "issue_invoices"],
	admin: ["see_all_cases", "see_all_branches", "invite_staff", "manage_roles", "manage_clients", "manage_settings"],
};

/**
 * Rank orders roles for the "may invite / change" rule: an actor may hand
 * out roles of strictly lower rank (the root role may hand out any). A
 * custom role takes the rank its creator gives it, never above their own.
 */
export const ROLE_RANKS: Record<SystemRole, number> = {
	super_admin: 100,
	admin: 90,
	manager: 70,
	coordinator: 50,
	customer_service: 40,
	consultant: 30,
	finance: 30,
};
export const DEFAULT_CUSTOM_ROLE_RANK = 30;

/** The whole default permission list of a built-in role: modules and capabilities. */
export function defaultPermissionsOf(role: SystemRole): Permission[] {
	return [...ROLE_PERMISSIONS[role], ...ROLE_CAPABILITIES[role]];
}

/** Whether a permission list grants a module or a capability. The root role has all. */
export function permissionsGrant(role: string, permissions: readonly string[] | null | undefined, wanted: string): boolean {
	if (role === "super_admin") return true;
	return Boolean(permissions?.includes(wanted));
}

/** Whether a role (from an untrusted string) may access a module. */
export function roleCanAccess(
	role: string,
	module: OpsModule,
	customPermissions?: Record<string, readonly string[]>,
): boolean {
	if (role === "super_admin") return true;
	if (customPermissions && customPermissions[role]) {
		return customPermissions[role].includes(module);
	}
	const fallback = ROLE_PERMISSIONS[role as SystemRole];
	if (fallback) {
		return fallback.includes(module);
	}
	return false;
}

/** Whether a role has a capability, from the live map when there is one, else the built-in defaults. */
export function roleHasCapability(
	role: string,
	capability: Capability,
	customPermissions?: Record<string, readonly string[]>,
): boolean {
	if (role === "super_admin") return true;
	if (customPermissions && customPermissions[role]) {
		return customPermissions[role].includes(capability);
	}
	const fallback = ROLE_CAPABILITIES[role as SystemRole];
	return fallback ? fallback.includes(capability) : false;
}

/** The ownership capability a stored stage (or "consultation") needs. */
export function ownershipCapabilityFor(stage: string): Capability | null {
	switch (stage) {
		case "consultation":
			return "own:consult";
		case "document_verification":
		case "school_submission":
		case "offer_letter_review":
			return "own:apply";
		case "visa_processing":
			return "own:visa";
		case "travel_assistance":
		case "payment_execution":
			return "own:depart";
		default:
			return null;
	}
}

/**
 * Kept for the roster pickers and the client: who may hold what. The
 * live answer is `roleHasCapability(role, ownershipCapabilityFor(stage), map)`.
 */
export const ASSIGN_WORK_ROLES = ["super_admin", "manager", "coordinator", "customer_service"] as const;
export const EDIT_PACKAGES_ROLES = ["super_admin", "manager", "finance"] as const;
export const EDIT_UNIVERSITIES_ROLES = ["super_admin", "manager"] as const;

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

