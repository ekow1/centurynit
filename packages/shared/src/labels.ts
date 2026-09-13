/**
 * The vocabulary — every user-facing word for a chapter, a step, a status, a
 * decision, a role or a kind of money, for both apps. The client portal and
 * the operations console read from here, so they cannot drift apart.
 *
 * Rules:
 *   - One name per thing. A narrow surface uses the `short` form of the
 *     *same* entry, never its own wording.
 *   - Six chapters, the same six on the portal, in the console's navigation,
 *     on the case tabs and in the stepper. Waiting and paying are lines
 *     inside a chapter, never chapters.
 *   - People: the person is the **client**; their case owner is their
 *     **consultant**; chapter specialists are **officers** (visa, travel,
 *     finance). The console says "owner" when it does not know which.
 *   - One decision triple everywhere a client says yes / not now / no:
 *     Confirmed · On hold · Declined.
 *   - British spelling: enrolment, instalment, programme.
 */

/* ── Chapters ─────────────────────────────────────────────────────────────── */

export type ChapterId = "consult" | "enrol" | "apply" | "visa" | "depart" | "done";

export const CHAPTERS: readonly {
	id: ChapterId;
	numeral: string;
	label: string;
	short: string;
	/** One line under the name — what the chapter is for. */
	blurb: string;
}[] = [
	{ id: "consult", numeral: "I", label: "Consultation", short: "Consult", blurb: "Meet, assess, verify documents" },
	{ id: "enrol", numeral: "II", label: "Enrolment", short: "Enrol", blurb: "Confirm, package, plan, deposit" },
	{ id: "apply", numeral: "III", label: "Applications", short: "Apply", blurb: "Schools, submissions, offers" },
	{ id: "visa", numeral: "IV", label: "Visa", short: "Visa", blurb: "Fee, biometrics, decision" },
	{ id: "depart", numeral: "V", label: "Departure", short: "Depart", blurb: "Fee milestone, flight, checklist" },
	{ id: "done", numeral: "VI", label: "Complete", short: "Done", blurb: "Departed; post-arrival plan" },
];

export const CHAPTER_LABELS: Record<ChapterId, string> = Object.fromEntries(
	CHAPTERS.map((c) => [c.id, c.label]),
) as Record<ChapterId, string>;

/** The steps inside each chapter, in order — lines on a card, never chapters. */
export const CHAPTER_STEPS: Record<ChapterId, readonly string[]> = {
	consult: ["Booked", "Held", "Assessed", "Documents verified"],
	enrol: ["Confirmed", "Package & plan", "Deposit paid", "Consultant assigned"],
	apply: ["Schools chosen", "Fee paid", "Submitted", "Offers in", "Offer accepted"],
	visa: ["Fee paid", "Officer assigned", "Opened", "Biometrics", "Decision"],
	depart: ["Fee milestone paid", "Travel choice", "Ticket paid", "Booked", "Checklist done"],
	done: ["Departed", "Post-arrival plan"],
};

/**
 * The console's stored stage (seven values, until the ids are folded) shown
 * with its chapter's name. Two stages inside one chapter carry the step that
 * tells them apart, so a board column or a filter is never ambiguous.
 */
export const STAGE_CHAPTER: Record<string, ChapterId> = {
	document_verification: "enrol",
	school_submission: "apply",
	offer_letter_review: "apply",
	visa_processing: "visa",
	travel_assistance: "depart",
	payment_execution: "depart",
	completed: "done",
};
export const STAGE_LABELS: Record<string, string> = {
	document_verification: "Enrolment",
	school_submission: "Applications",
	offer_letter_review: "Applications · Offers",
	visa_processing: "Visa",
	travel_assistance: "Departure",
	// Legacy stored value: cases were moved to travel_assistance (0079).
	payment_execution: "Departure",
	completed: "Complete",
};

/* ── Journey steps as the client sees them ────────────────────────────────── */

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

/**
 * Each fine step belongs to a chapter and is named as "what is happening
 * now" in that chapter — the chapter is the heading, this is the line.
 */
export const PORTAL_STEP: Record<PortalStepId, { chapter: ChapterId; label: string; short: string }> = {
	new: { chapter: "consult", label: "Getting started", short: "New" },
	consultation: { chapter: "consult", label: "Consultation", short: "Consultation" },
	eligibility: { chapter: "consult", label: "Assessment & recommendation", short: "Assessment" },
	proceed: { chapter: "enrol", label: "Confirm your enrolment", short: "Confirm" },
	school_package: { chapter: "enrol", label: "Package, plan & deposit", short: "Package" },
	awaiting_handler: { chapter: "enrol", label: "Consultant being assigned", short: "Assigning" },
	school_select: { chapter: "apply", label: "Choose your schools", short: "Schools" },
	awaiting_invoice: { chapter: "apply", label: "Application fee being prepared", short: "Fee pending" },
	application_invoice: { chapter: "apply", label: "Pay the application fee", short: "Application fee" },
	school_tracking: { chapter: "apply", label: "Submissions & offers", short: "Offers" },
	visa_invoice: { chapter: "visa", label: "Pay the visa fee", short: "Visa fee" },
	visa: { chapter: "visa", label: "Visa tracking", short: "Visa" },
	payment_execution: { chapter: "depart", label: "Pay your pre-departure fee milestone", short: "Fee milestone" },
	travel_assistance: { chapter: "depart", label: "Flight & pre-departure", short: "Flight" },
	completed: { chapter: "done", label: "Complete", short: "Complete" },
};

/** Full names, keyed by step — what the spine, the journey band and ops show. */
export const PORTAL_STAGE_LABELS: Record<string, string> = Object.fromEntries(
	Object.entries(PORTAL_STEP).map(([id, v]) => [id, v.label]),
);

/** Short names for chips, app bars and pills. */
export const PORTAL_STAGE_SHORT: Record<PortalStepId, string> = Object.fromEntries(
	Object.entries(PORTAL_STEP).map(([id, v]) => [id, v.short]),
) as Record<PortalStepId, string>;

/** The chapter a fine step belongs to. */
export const PORTAL_STEP_CHAPTER: Record<PortalStepId, ChapterId> = Object.fromEntries(
	Object.entries(PORTAL_STEP).map(([id, v]) => [id, v.chapter]),
) as Record<PortalStepId, ChapterId>;

/* ── Decisions ────────────────────────────────────────────────────────────── */

/**
 * The one triple for a client's answer at a chapter door — enrolment, visa,
 * travel. The stored values differ by history (`accepted / paused /
 * declined`, `continue / hold / opt_out`, `yes / hold / no`); the words do
 * not.
 */
export type DecisionId = "confirmed" | "on_hold" | "declined";
export const DECISION_LABELS: Record<DecisionId, string> = {
	confirmed: "Confirmed",
	on_hold: "On hold",
	declined: "Declined",
};
export function decisionOf(value: string | null | undefined): DecisionId | null {
	switch (value) {
		case "accepted":
		case "continue":
		case "yes":
		case "confirmed":
			return "confirmed";
		case "paused":
		case "hold":
		case "on_hold":
			return "on_hold";
		case "declined":
		case "opt_out":
		case "no":
			return "declined";
		default:
			return null;
	}
}

/* ── Invoice status ───────────────────────────────────────────────────────── */

/**
 * Effective invoice statuses (`overdue` is derived at read time). The same
 * words on an ops table and on the client's invoice card. A proforma is a
 * draft: raised, not yet issued, not yet payable.
 */
export const INVOICE_STATUS_LABELS: Record<string, string> = {
	proforma: "Draft",
	issued: "Issued",
	partial: "Part paid",
	paid: "Paid",
	overdue: "Overdue",
	void: "Void",
};

/** What each invoice is for — the title on its card. */
export const INVOICE_TYPE_LABELS: Record<string, string> = {
	application: "Application fee",
	visa: "Visa fee",
	agency: "Service fee",
	travel: "Ticket",
	consultation: "Consultation fee",
	custom: "Other",
};

/**
 * Invoice types whose money is not the agency's: collected and passed on
 * (the airline fare on a ticket invoice). Reports keep them out of revenue.
 */
export const PASS_THROUGH_INVOICE_TYPES: readonly string[] = ["travel"];
export const isPassThroughInvoice = (type: string): boolean => PASS_THROUGH_INVOICE_TYPES.includes(type);

export const INVOICE_PROFORMA_HINT = "Being prepared — you'll be able to pay it here once it's issued.";

/** Service fee milestones (the agency's own fee), in order. */
export const SERVICE_FEE_MILESTONE_LABELS: Record<string, string> = {
	agency_deposit: "Service fee · deposit",
	agency_predeparture: "Service fee · pre-departure",
	agency_postarrival: "Service fee · post-arrival",
};

export const PAYMENT_PLAN_LABELS: Record<string, string> = {
	full: "Full payment",
	installment: "Instalments",
};

/* ── Visa sub-stage ───────────────────────────────────────────────────────── */

export const VISA_STAGE_LABELS: Record<string, string> = {
	locked: "Not started",
	awaiting_handler: "Awaiting visa officer",
	pending: "Opened",
	biometrics: "Biometrics",
	decision: "Decision",
	complete: "Approved",
};

/** Visa decision, once the authority has answered. */
export const VISA_OUTCOME_LABELS: Record<string, string> = {
	approved: "Visa approved",
	refused: "Visa refused",
};

/* ── School application: see schemas/school.ts (SCHOOL_TRACK_STATUS_LABELS, SCHOOL_OUTCOME_LABELS) ── */

/* ── Travel request status ────────────────────────────────────────────────── */

export const TRAVEL_STATUS_LABELS: Record<string, string> = {
	decision_pending: "Awaiting choice",
	review: "Requested",
	invoiced: "Ticket invoiced",
	ticket_paid: "Ticket paid",
	booked: "Booked",
	declined: "Booking own flight",
	on_hold: "On hold",
};

/* ── Case record ──────────────────────────────────────────────────────────── */

/** The case record's own state (distinct from where it is in the journey). */
export const CASE_STATUS_LABELS: Record<string, string> = {
	UNDER_REVIEW: "New",
	ACCEPTED: "Active",
	ACTION_REQUIRED: "Needs attention",
	REJECTED: "Closed",
	// The console's stored spellings of the same four.
	"Under Review": "New",
	Accepted: "Active",
	"Action Required": "Needs attention",
	Rejected: "Closed",
};

/* ── People ───────────────────────────────────────────────────────────────── */

/** Staff roles as shown on the roster and in pickers. */
export const ROLE_LABELS: Record<string, string> = {
	super_admin: "Super administrator",
	admin: "Administrator",
	manager: "Manager",
	coordinator: "Coordinator",
	customer_service: "Client services",
	consultant: "Consultant",
	finance: "Finance officer",
};

/** Who owns each chapter's work — the title the console shows beside a name. */
export const OWNER_CLASS_LABELS: Record<string, string> = {
	consultant: "Consultant",
	visa_officer: "Visa officer",
	travel_officer: "Travel officer",
	finance_officer: "Finance officer",
	none: "—",
};

/** The same, keyed by the stored stage the owner was assigned for. */
export const STAGE_OWNER_LABELS: Record<string, string> = {
	consultation: "Consultant",
	document_verification: "Consultant",
	school_submission: "Consultant",
	offer_letter_review: "Consultant",
	visa_processing: "Visa officer",
	travel_assistance: "Travel officer",
	payment_execution: "Finance officer",
};

/** The client's single point of contact, however many officers are behind it. */
export const CONTACT_TITLE = "consultant";

/** The console's word for whoever owns a case or a chapter when the class is not known. */
export const HANDLER_TITLE = "owner";

/** The person, in the console. */
export const PERSON_TITLE = "client";

/* ── Tasks ────────────────────────────────────────────────────────────────── */

/** The three groups a console task list is split into. */
export const TASK_GROUP_LABELS = {
	needs_you: "Needs you",
	waiting_client: "Waiting on client",
	waiting_finance: "Waiting on finance",
} as const;

/* ── Workspace ────────────────────────────────────────────────────────────── */

/**
 * The two views inside the Workspace — the queue waiting to be cleared versus
 * the workload each person is carrying.
 */
export const WORKSPACE_TAB_LABELS = {
	worklist: "Worklist",
	caseload: "Caseload",
} as const;

export type WorkspaceTab = keyof typeof WORKSPACE_TAB_LABELS;
