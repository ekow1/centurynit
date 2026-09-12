/**
 * The words both apps use — the applicant portal and the operations console
 * read every user-facing name for a stage, a status or a role from here, so
 * they cannot drift apart again.
 *
 * Rules:
 *   - One name per thing. Where a surface is too narrow for the full name,
 *     it uses the `short` form of the *same* entry, never its own wording.
 *   - The applicant has one point of contact: "your consultant". Which
 *     specialist that is at a given stage is a detail ops cares about, so the
 *     portal says the stage, not a new job title.
 *   - Ops calls the person on a case the "handler" and the roster "staff".
 */

/* ── Journey steps as the applicant sees them ─────────────────────────────── */

export type PortalStepId =
	| "new"
	| "consultation"
	| "eligibility"
	| "proceed"
	| "school_package"
	| "awaiting_handler"
	| "school_select"
	| "awaiting_invoice"
	| "application_invoice"
	| "school_tracking"
	| "visa_invoice"
	| "visa"
	| "travel_assistance"
	| "payment_execution"
	| "completed";

export const PORTAL_STEP: Record<PortalStepId, { label: string; short: string }> = {
	new: { label: "New", short: "New" },
	consultation: { label: "Consultation", short: "Consultation" },
	eligibility: { label: "Assessment & recommendation", short: "Assessment" },
	proceed: { label: "Start your application", short: "Start" },
	school_package: { label: "Choose your package", short: "Package" },
	awaiting_handler: { label: "Awaiting handler", short: "Awaiting handler" },
	school_select: { label: "Select schools", short: "Schools" },
	awaiting_invoice: { label: "Awaiting application invoice", short: "Awaiting invoice" },
	application_invoice: { label: "Pay application invoice", short: "Application fee" },
	school_tracking: { label: "Application tracking", short: "Applications" },
	visa_invoice: { label: "Pay visa invoice", short: "Visa fee" },
	visa: { label: "Visa tracking", short: "Visa" },
	travel_assistance: { label: "Travel assistance", short: "Travel" },
	payment_execution: { label: "Payment plan & fees", short: "Plan & fees" },
	completed: { label: "Complete", short: "Complete" },
};

/** Full names, keyed by step — what the spine, the journey band and ops show. */
export const PORTAL_STAGE_LABELS: Record<string, string> = Object.fromEntries(
	Object.entries(PORTAL_STEP).map(([id, v]) => [id, v.label]),
);

/** Short names for chips, app bars and pills. */
export const PORTAL_STAGE_SHORT: Record<PortalStepId, string> = Object.fromEntries(
	Object.entries(PORTAL_STEP).map(([id, v]) => [id, v.short]),
) as Record<PortalStepId, string>;

/* ── Invoice status ───────────────────────────────────────────────────────── */

/**
 * Effective invoice statuses (`overdue` is derived at read time). The same
 * words on an ops table and on the applicant's invoice card.
 */
export const INVOICE_STATUS_LABELS: Record<string, string> = {
	proforma: "Awaiting approval",
	issued: "Issued",
	partial: "Part paid",
	paid: "Paid",
	overdue: "Overdue",
	void: "Void",
};

/** What the applicant is told while an invoice is still a proforma. */
/** What each invoice type is for, as a title ("Visa invoice", "Ticket invoice"). */
export const INVOICE_TYPE_LABELS: Record<string, string> = {
	application: "Application",
	visa: "Visa",
	agency: "Service package",
	travel: "Ticket",
	consultation: "Consultation",
	custom: "Custom",
};

export const INVOICE_PROFORMA_HINT = "Being prepared — you'll be able to pay it here once it's issued.";

/* ── Visa sub-stage ───────────────────────────────────────────────────────── */

export const VISA_STAGE_LABELS: Record<string, string> = {
	locked: "Not started",
	awaiting_handler: "Awaiting visa specialist",
	pending: "Case opened",
	biometrics: "Biometrics",
	decision: "Decision",
	complete: "Complete",
};

/* ── Travel assistance request status ─────────────────────────────────────── */

export const TRAVEL_STATUS_LABELS: Record<string, string> = {
	decision_pending: "Awaiting your decision",
	review: "Request received",
	quote_prepared: "Ticket invoice awaiting approval",
	quote_approved: "Ticket invoice awaiting approval",
	invoiced: "Ticket invoice issued",
	ticket_paid: "Ticket paid",
	booked: "Flight booked",
	cleared: "Cleared to travel",
	declined: "Arranging own travel",
	on_hold: "On hold",
};

/* ── People ───────────────────────────────────────────────────────────────── */

/** Staff roles as shown on the roster and in pickers. */
export const ROLE_LABELS: Record<string, string> = {
	super_admin: "Super admin",
	admin: "Admin",
	manager: "Manager",
	coordinator: "Coordinator",
	customer_service: "Customer service",
	consultant: "Consultant",
	finance: "Finance",
};

/** The applicant's single point of contact, however many specialists are behind it. */
export const CONTACT_TITLE = "consultant";

/** Ops' word for the staff member responsible for a case or a stage. */
export const HANDLER_TITLE = "handler";
