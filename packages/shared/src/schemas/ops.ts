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
	"site",
	"notifications",
	"settings",
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
			{ id: "site", label: "Site & UI", description: "Public website branding and navigation" },
			{ id: "notifications", label: "Notifications", description: "Automated templates and communication channels" },
			{ id: "settings", label: "System Configuration", description: "API keys, fee schedule, and integration credentials" },
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
		"programs", "packages", "reports", "chat",
	],
	coordinator: [
		"dashboard", "applications", "consultations", "applicants", "leads", "crm", "helpdesk", "marketing",
		"workflow", "visa", "travel", "documents", "appointments", "universities",
		"programs", "packages", "reports", "chat",
	],
	consultant: [
		"dashboard", "applications", "consultations", "applicants", "leads", "crm", "helpdesk", "marketing", "workflow",
		"visa", "travel", "documents", "appointments", "universities", "programs", "packages", "reports", "chat",
	],
	finance: [
		"dashboard", "finance", "invoices", "ledger", "payments", "payment-config", "packages", "reports", "helpdesk", "chat",
	],
	admin: [
		"system", "users", "auth", "cms", "site", "notifications", "settings", "helpdesk", "chat",
	],
};

/**
 * Capability lists — viewing a module is not the same as changing it.
 */
export const ASSIGN_WORK_ROLES = ["super_admin", "manager", "coordinator"] as const;
export const EDIT_PACKAGES_ROLES = ["super_admin", "manager", "finance"] as const;
export const EDIT_UNIVERSITIES_ROLES = ["super_admin", "manager"] as const;

/** Whether a role (from an untrusted string) may access a module. */
export function roleCanAccess(
	role: string,
	module: OpsModule,
	customPermissions?: Record<string, OpsModule[]>,
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

