/**
 * Shared ops-side record shapes.
 *
 * These live here rather than in the page files so that OpsStateContext and the
 * Enterprise* pages can both import them without a circular reference.
 */

export type ConsultationStatus =
	| "Under Review"
	| "Assigned"
	| "In Assessment"
	| "Completed"
	| "Cancelled";

export type DocStatus = "Verified" | "Pending Review" | "Rejected";

/* ─── Branches ───
 * Records store the canonical branch id; `branchName` is used at render time.
 * Branch-scoped roles (coordinator, consultant) compare against these ids.
 */
export const OPS_BRANCHES = [
	{ id: "accra", name: "Accra" },
	{ id: "kumasi", name: "Kumasi" },
	{ id: "takoradi", name: "Takoradi" },
	{ id: "tamale", name: "Tamale" },
	{ id: "cape-coast", name: "Cape Coast" },
	{ id: "tema", name: "Tema" },
] as const;

export type BranchId = (typeof OPS_BRANCHES)[number]["id"];

/** Canonical id for a branch, matched by id or name (case-insensitive). */
export function branchId(name: string): string {
	const needle = name.trim().toLowerCase();
	const match = OPS_BRANCHES.find((b) => b.id === needle || b.name.toLowerCase() === needle);
	return match?.id ?? needle;
}

/** Display name for a canonical branch id (falls back to the raw id). */
export function branchName(id: string): string {
	const match = OPS_BRANCHES.find((b) => b.id === id);
	return match?.name ?? id;
}

/** Like branchName but resolves the platform's non-branch "Platform" scope. */
export function staffBranchName(id: string): string {
	return id === "platform" ? "Platform" : branchName(id);
}

/** Staff member a case can be assigned to. */
export type Assignee = { name: string; email: string; branch: string };

/** Consultants the manager can assign work to. Branch values are canonical ids. */
export const CONSULTANT_ROSTER: Assignee[] = [
	{ name: "Efua Owusu", email: "e.owusu@century-nit.com", branch: "accra" },
	{ name: "Kwame Agyeman", email: "k.agyeman@century-nit.com", branch: "kumasi" },
	{ name: "Abena Frimpong", email: "a.frimpong@century-nit.com", branch: "takoradi" },
];

/**
 * Everyone a support ticket can be routed to.
 *
 * Wider than CONSULTANT_ROSTER on purpose: a billing question belongs with
 * finance and a scheduling one with the coordinator, so restricting the
 * helpdesk to consultants left those tickets with nowhere correct to go — and
 * a ticket already assigned outside the roster rendered an empty dropdown.
 */
export const SUPPORT_ROSTER: (Assignee & { role: string })[] = [
	{ name: "Kojo Asante", email: "k.asante@century-nit.com", branch: "accra", role: "Coordinator" },
	{ name: "Efua Owusu", email: "e.owusu@century-nit.com", branch: "accra", role: "Consultant" },
	{ name: "Kwame Agyeman", email: "k.agyeman@century-nit.com", branch: "kumasi", role: "Consultant" },
	{ name: "Abena Frimpong", email: "a.frimpong@century-nit.com", branch: "takoradi", role: "Consultant" },
	{ name: "Ama Serwaa Boateng", email: "a.serwaa@century-nit.com", branch: "accra", role: "Finance" },
	{ name: "Adjoa Mensah-Bonsu", email: "a.mensah@century-nit.com", branch: "accra", role: "Manager" },
];

export type CommentKind = "comment" | "recommendation" | "document_request" | "status" | "assignment";

export type CaseComment = {
	id: string;
	at: string;
	author: string;
	kind: CommentKind;
	text: string;
};

export const COMMENT_KIND_LABELS: Record<CommentKind, string> = {
	comment: "Comment",
	recommendation: "Recommendation",
	document_request: "Document request",
	status: "Status update",
	assignment: "Assignment",
};

export interface ServicePackage {
	id: string;
	name: string;
	price: number;
	description: string;
	services: string[];
	exclusions?: string[];
	active: boolean;
}

export type AssessmentResult = {
	outcome: string;
	notes: string;
	recCountry: string;
	recUniversity: string;
	recProgram: string;
	recPackage: string;
};

export interface MockConsultation {
	id: string; // The consultation ID
	ref: string;
	bookingId: string | null;
	applicantName: string;
	email: string;
	phone: string;
	branch: string;
	dateTime: string;
	type: string;
	assignedOfficer: string;
	assignedOfficerEmail: string;
	targetCountry: string;
	status: ConsultationStatus;
	personal: { nationality: string; residence: string; dob: string };
	passport: { number: string; expiry: string; previousRefusals: string };
	education: { degree: string; institution: string; gpa: string; gradYear: string };
	employment: { currentRole: string; company: string; experienceYears: string };
	financial: { source: string; budget: string };
	goals: { degreeLevel: string; intake: string; major: string };
	documents: { name: string; status: string }[];
	assessmentResult?: AssessmentResult;
	/** Consultant has confirmed the assigned slot. */
	slotConfirmed?: boolean;
	/** Empty string means unassigned - it sits in the manager's queue. */
	comments?: CaseComment[];
	/** Set when a consultant moves an assigned consultation. */
	rescheduledTo?: string | null;
	requestedDocuments?: string[];
	/** Set on the record projected from the live applicant portal session */
	isLive?: boolean;
	/**
	 * Machine-readable slot, kept alongside the display-only `dateTime` above.
	 *
	 * `dateTime` holds prose ("Today, 10:00 AM", "Live · portal session") and
	 * must never be parsed. Without these three fields there is no way to ask
	 * whether a slot is already taken, which is how the same slot could be
	 * double-booked. Absent on records created before this existed.
	 */
	slotBranchId?: string;
	/** YYYY-MM-DD */
	slotDate?: string;
	/** HH:MM, 24-hour */
	slotTime?: string;
	/** Generated meeting link for online consultations */
	meetingLink?: string;
	/** Google Maps URL for in-person consultations */
	mapsUrl?: string;
}

export type ApplicationStatus = "Under Review" | "Accepted" | "Action Required" | "Rejected";

export type VisaStage = "locked" | "pending" | "biometrics" | "decision" | "complete";

/**
 * Ops spells this plural and allows "unset"; the portal spells it singular with
 * no empty case (`PaymentPlanId` in content.ts). They are genuinely different
 * types, not a duplicate — `OpsDirectiveBridge.opsPlanToPortal()` translates
 * between them. Reconcile the two in a shared schema when the API lands
 * (API_MIGRATION_PLAN §7 "Risks"), not by making one silently assignable to the
 * other now.
 */
export type PaymentPlanId = "full" | "installments" | "";

export type TravelClearance = "pending" | "cleared";

/**
 * Identical to the portal's definition, so there is only one. It was duplicated
 * here verbatim while both halves lived in one app and nothing caught it.
 */
import type { PreDepartureTask } from "./content.js";
export type { PreDepartureTask };

export interface MockApplication {
	id: string;
	appId: string;
	applicantName: string;
	email: string;
	phone: string;
	branch: string;
	university: string;
	program: string;
	country: string;
	degreeLevel: string;
	assignedStaff: string;
	assignedStaffEmail: string;
	stage: string;
	status: ApplicationStatus;
	submittedDate: string;
	checklist: { id: string; label: string; checked: boolean }[];
	fundingTrack: string;
	notes: string;
	comments?: CaseComment[];
	requestedDocuments?: string[];
	isLive?: boolean;
	/** Post-acceptance: visa processing sub-stage */
	visaStage?: VisaStage;
	/** Visa invoice has been paid */
	visaInvoicePaid?: boolean;
	/** Counselor note shown in visa tracking */
	visaCounselorNote?: string;
	/** Payment plan selection (after visa invoice paid) */
	paymentPlanId?: PaymentPlanId;
	/** Agency settlement milestone index (0=deposit, 1=balance, 2=clearance) */
	agencyStageIndex?: number;
	/** Agency settlement fully completed */
	agencySettled?: boolean;
	/** Pre-departure checklist tasks */
	preDepartureTasks?: PreDepartureTask[];
	/** Travel clearance status */
	travelClearance?: TravelClearance;
}

/**
 * Staff actions taken against the live portal case. The case itself is derived
 * from the portal's storage each tick, so anything ops does to it has to be
 * held separately and merged back in.
 */
export type LiveOverlay = {
	assignedOfficer: string;
	assignedOfficerEmail: string;
	assignedStage: string;
	comments: CaseComment[];
	rescheduledTo: string | null;
	/** Structured form of `rescheduledTo`, so the moved slot is visible to the
	 *  conflict check. Null until the live case has actually been moved. */
	rescheduledSlot: { date: string; time: string } | null;
	requestedDocuments: string[];
	slotConfirmed: boolean;
	assessmentStarted: boolean;
	/** Verification decisions on the live applicant's documents, keyed by name. */
	documentStatuses: Record<string, string>;
};

export const EMPTY_LIVE_OVERLAY: LiveOverlay = {
	assignedOfficer: "",
	assignedOfficerEmail: "",
	assignedStage: "",
	comments: [],
	rescheduledTo: null,
	rescheduledSlot: null,
	requestedDocuments: [],
	slotConfirmed: false,
	assessmentStarted: false,
	documentStatuses: {},
};

export interface MockApplicant {
	id: string;
	applicantId: string;
	name: string;
	email: string;
	phone: string;
	branch: string;
	assignedOfficer: string;
	assignedOfficerEmail: string;
	country: string;
	university: string;
	program: string;
	package: string;
	currentStage: string;
	stageNumber: number;
	totalStages: number;
	status: string;
	enrolledDate: string;
	financials: {
		totalAmount: string;
		paidAmount: string;
		outstanding: string;
		plan: string;
	};
	timeline: { stage: string; status: string; date: string }[];
	documents: { name: string; category: string; date: string; status: string }[];
	messages: { sender: string; time: string; text: string }[];
	auditLog: { action: string; user: string; timestamp: string }[];
	isLive?: boolean;
	/** Post-acceptance: visa processing sub-stage */
	visaStage?: VisaStage;
	/** Visa invoice has been paid */
	visaInvoicePaid?: boolean;
	/** Counselor note shown in visa tracking */
	visaCounselorNote?: string;
	/** Payment plan selection (after visa invoice paid) */
	paymentPlanId?: PaymentPlanId;
	/** Agency settlement milestone index (0=deposit, 1=balance, 2=clearance) */
	agencyStageIndex?: number;
	/** Agency settlement fully completed */
	agencySettled?: boolean;
	/** Pre-departure checklist tasks */
	preDepartureTasks?: PreDepartureTask[];
	/** Travel clearance status */
	travelClearance?: TravelClearance;
}

/* ─── Ops → Portal directives ───
 *
 * The ops side never mutates portal state directly. It writes a directive, and
 * the SimBridge applies it to the applicant's AppState. This keeps the two
 * stores independent and makes every cross-screen effect explicit and
 * inspectable in the demo control panel.
 */

/** Structurally compatible with AppState's InvoiceLine (kept local to avoid a cycle). */
export type OpsInvoiceLine = {
	id: string;
	label: string;
	detail: string;
	amount: number;
};

export type InvoiceType = "Application" | "Visa" | "Consultation" | "Custom";

export type Invoice = {
	id: string;
	invoiceNumber: string;
	applicantId: string;
	applicantName: string;
	type: InvoiceType;
	lines: OpsInvoiceLine[];
	subtotal: number;
	note: string;
	status: InvoiceStatus;
	issuedAt: string;
	issuedBy: string;
	/** When payment is expected — drives overdue and the aging buckets */
	dueAt?: string;
	/** Part-payments, so a balance can be carried rather than all-or-nothing */
	payments?: InvoicePayment[];
	voidedAt?: string;
	voidReason?: string;
	/** Set when a credit note reverses part or all of this invoice */
	creditedAmount?: number;
	/** Audit trail shown on the invoice detail */
	history?: InvoiceEvent[];
};

export type InvoiceStatus = "proforma" | "issued" | "paid" | "partial" | "overdue" | "void";

export type InvoicePayment = {
	id: string;
	amount: number;
	at: string;
	by: string;
	method: string;
	reference: string;
};

export type InvoiceEvent = {
	at: string;
	by: string;
	action: string;
	detail?: string;
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
	proforma: "Pending Review",
	issued: "Issued",
	partial: "Part paid",
	paid: "Paid",
	overdue: "Overdue",
	void: "Void",
};


/** Total settled against an invoice */
export function invoicePaid(inv: Invoice): number {
	return (inv.payments ?? []).reduce((n, p) => n + p.amount, 0);
}

/** What is still owed, after payments and any credit note */
export function invoiceBalance(inv: Invoice): number {
	if (inv.status === "void") return 0;
	return Math.max(0, inv.subtotal - invoicePaid(inv) - (inv.creditedAmount ?? 0));
}

/** Days past due — negative means not yet due */
export function invoiceAgeDays(inv: Invoice, now = Date.now()): number | null {
	if (!inv.dueAt) return null;
	return Math.floor((now - new Date(inv.dueAt).getTime()) / 86_400_000);
}

export type EligibilityDirective = {
	outcome: "eligible" | "conditional" | "needs_info" | "not_eligible";
	note: string;
	at: string;
	by: string;
};

export type InvoiceDirective = {
	amount: number;
	lines: OpsInvoiceLine[];
	note: string;
	at: string;
	by: string;
};

export type SchoolStatusDirective = {
	status: string;
	note: string;
	at: string;
	by: string;
};

export type VisaStageDirective = {
	stage: VisaStage;
	note?: string;
	at: string;
	by: string;
};

export type PaymentPlanDirective = {
	plan: PaymentPlanId;
	at: string;
	by: string;
};

export type AgencyAdvanceDirective = {
	stageIndex: number;
	settled: boolean;
	at: string;
	by: string;
};

export type TravelClearanceDirective = {
	cleared: boolean;
	at: string;
	by: string;
};

export type CustomSchedule = {
	id: string;
	label: string;
	detail: string;
	payments: number;
	intervalDays: number;
	graceDays: number;
};

export type ScheduleConfigDirective = {
	/** IDs of post-arrival schedule options the portal may show */
	enabledScheduleIds: string[];
	/** Custom schedules created by ops that the portal may show */
	customSchedules: CustomSchedule[];
	at: string;
	by: string;
};

export type OpsDirectives = {
	eligibility: EligibilityDirective | null;
	appInvoice: InvoiceDirective | null;
	visaInvoice: InvoiceDirective | null;
	/** Keyed by the portal's school track id */
	schoolStatuses: Record<string, SchoolStatusDirective>;
	visaStage: VisaStageDirective | null;
	paymentPlan: PaymentPlanDirective | null;
	agencyAdvance: AgencyAdvanceDirective | null;
	travelClearance: TravelClearanceDirective | null;
	scheduleConfig: ScheduleConfigDirective | null;
};

export const EMPTY_DIRECTIVES: OpsDirectives = {
	eligibility: null,
	appInvoice: null,
	visaInvoice: null,
	schoolStatuses: {},
	visaStage: null,
	paymentPlan: null,
	agencyAdvance: null,
	travelClearance: null,
	scheduleConfig: null,
};

/**
 * Canonical mapping between the ops 7-stage pipeline and the portal's
 * 11 fine-grained ProcessStageId values.
 *
 * Each ops stage maps to the portal stage that should be active when the
 * application is at that ops stage. Used by the OpsDirectiveBridge to
 * translate ops stage changes into portal state updates.
 */
export const OPS_TO_PORTAL_STAGE: Record<string, string> = {
	"Document Verification": "school_package",
	"School Submission": "school_tracking",
	"Offer Letter Review": "school_tracking",
	"Visa Processing": "visa",
	// "Payment Plan" is no longer a portal stage — money lives on Financial
	"Payment Plan": "visa",
	"Travel Assistance": "pre_departure",
	"Completed": "completed",
};

/** Reverse mapping: portal stage → ops stage. */
export const PORTAL_TO_OPS_STAGE: Record<string, string> = {
	consultation: "Document Verification",
	eligibility: "Document Verification",
	school_package: "Document Verification",
	school_select: "School Submission",
	application_invoice: "School Submission",
	school_tracking: "Offer Letter Review",
	visa_invoice: "Visa Processing",
	visa: "Visa Processing",
	pre_departure: "Travel Assistance",
	completed: "Completed",
};

/**
 * Snapshot the portal pushes into the ops store so staff can see the live
 * applicant alongside the seeded demo records.
 */
export type LiveCaseSnapshot = {
	present: boolean;
	name: string;
	email: string;
	phone: string;
	stage: string;
	stageLabel: string;
	stageIndex: number;
	totalStages: number;
	consultationRef: string | null;
	applicationId: string | null;
	consultationPaid: boolean;
	consultationAmount: number;
	eligibility: string;
	targetCountry: string;
	university: string;
	program: string;
	fundingTrack: string;
	degreeLevel: string;
	schools: { id: string; university: string; program: string; status: string }[];
	appInvoiceStatus: string;
	appInvoiceAmount: number;
	visaInvoiceStatus: string;
	visaInvoiceAmount: number;
	agencyTotal: number;
	agencyPaid: number;
	agencyDepositPaid: boolean;
	paymentPlanId: string | null;
	postArrivalSchedule: string | null;
	postArrivalPaymentIndex: number;
	agencyStageIndex: number;
	agencySettled: boolean;
	documents: { name: string; category: string; status: string }[];
	updatedAt: string;
};

/* ─── Ledger & Payments Log ─── */

export type LedgerEntryType = "invoice_issued" | "payment" | "credit" | "void";

export type LedgerEntry = {
	id: string;
	date: string;
	type: LedgerEntryType;
	description: string;
	reference: string;
	debit: number;
	credit: number;
	balance: number;
};

export type InstallmentStatus = "paid" | "pending" | "overdue";

export type InstallmentRow = {
	index: number;
	dueDate: string;
	amount: number;
	status: InstallmentStatus;
	paidDate: string | null;
};

export type PaymentLogEntry = {
	id: string;
	date: string;
	applicantId: string;
	applicantName: string;
	invoiceNumber: string;
	amount: number;
	method: string;
	gateway: string;
	reference: string;
	recordedBy: string;
};

/** Payment methods that reflect real deduction-from-source systems. */
export const PAYMENT_METHODS = [
	"Visa Card",
	"Mastercard",
	"Bank Transfer",
	"Mobile Money",
	"Direct Debit",
] as const;

/** Maps a payment method to the processor/gateway that handled it. */
export function methodGateway(method: string): string {
	const m = method.toLowerCase();
	if (m.includes("visa")) return "Visa Direct";
	if (m.includes("mastercard")) return "Mastercard Send";
	if (m.includes("bank")) return "SWIFT/IBAN";
	if (m.includes("mobile") || m.includes("momo")) return "MTN MoMo / Telecel Cash";
	if (m.includes("direct debit")) return "SEPA Direct Debit";
	return "Internal";
}

/* ─── Support tickets ───
 *
 * Shared vocabulary: ops triages every ticket, and the applicant portal
 * raises and replies to the `external` ones. Moved here when the two apps
 * were split — previously it lived inside the ops store, which the portal
 * imported directly.
 */

export type TicketSource = "internal" | "external";
export type TicketStatus = "Open" | "In Progress" | "Waiting" | "Resolved";
export type TicketPriority = "Low" | "Medium" | "High" | "Urgent";
export type TicketCategory =
	| "Technical"
	| "Application"
	| "Documents"
	| "Billing"
	| "Visa"
	| "Other";

export type TicketMessage = {
	id: string;
	author: string;
	/** Who is speaking — drives which side of the thread the bubble sits on */
	role: "applicant" | "staff";
	body: string;
	at: string;
};

/**
 * One support ticket.
 *
 * `source` is the important distinction: `external` tickets are raised by an
 * applicant from the client portal and are customer-facing — the applicant sees
 * every staff reply. `internal` tickets are staff-to-staff and never leave ops.
 * Manager and coordinator triage both; only external ones carry applicant
 * identity and a visible thread.
 */
export type InternalTicket = {
	id: string;
	ref: string;
	source: TicketSource;
	title: string;
	description: string;
	category: TicketCategory;
	status: TicketStatus;
	priority: TicketPriority;
	createdBy: string;
	/** External only — the applicant's email and case reference */
	createdByEmail?: string;
	applicantRef?: string;
	createdAt: string;
	updatedAt: string;
	/** Empty string means unassigned and awaiting triage */
	assignedTo: string;
	assignedToEmail: string;
	/** Routed to platform administration rather than an ops colleague */
	escalatedToAdmin: boolean;
	messages: TicketMessage[];
};
