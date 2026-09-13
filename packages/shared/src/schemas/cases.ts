import { schoolApplicationSchema } from "./school.js";
import { z } from "zod";
import { STAGE_LABELS } from "../labels.js";

/**
 * Applicant journey — consultations (cases), applications, and the applicant
 * profile they hang off. Commands, not CRUD, for every state change.
 */

/**
 * Unified journey stage enum — the single source of truth for the application
 * pipeline. Both the ops console and the portal import this; the API validates
 * against it. The portal derives its finer-grained `ProcessStageId` display
 * stages from this value + invoice/payment signals.
 *
 * Stored in `applications.stage`. Ordered chronologically.
 */
export const journeyStageSchema = z.enum([
	"document_verification",
	"school_submission",
	"offer_letter_review",
	"visa_processing",
	"travel_assistance",
	"payment_execution",
	"completed",
]);
export type JourneyStage = z.infer<typeof journeyStageSchema>;

/** Ordered array for pipeline display / "advance to next" logic. */
/**
 * `payment_execution` is no longer a stage a case sits in: the service fee
 * milestone is paid inside Departure, before the ticket. The enum keeps the
 * value so old rows parse; the order does not include it.
 */
export const JOURNEY_STAGES: JourneyStage[] = [
	"document_verification",
	"school_submission",
	"offer_letter_review",
	"visa_processing",
	"travel_assistance",
	"completed",
];

/** The stored stage, named by its chapter — the vocabulary lives in ../labels.ts. */
export const JOURNEY_STAGE_LABELS: Record<JourneyStage, string> = STAGE_LABELS as Record<JourneyStage, string>;

/**
 * Guard a stage transition. Adjacency is enforced — a case can only move
 * forward one column at a time. A few later stages require sub-step
 * completion, matching the current ops UI buttons, so the server and the
 * Workflow board share the same rule set.
 */
/**
 * The pre-departure service fee milestone: on a full plan the 90% balance,
 * on instalments the 50% second milestone (the deposit is the first). Due
 * after the visa is approved and before the ticket is issued — where the
 * agency's leverage is. The post-arrival remainder is aftercare.
 */
export function preDepartureFeePaid(checks: {
	paymentPlanId?: string | null;
	agencyStageIndex?: number;
	agencySettled?: boolean;
}): boolean {
	if (!checks.paymentPlanId) return false;
	if (checks.paymentPlanId === "installment") return (checks.agencyStageIndex ?? 0) >= 2;
	return Boolean(checks.agencySettled);
}

/** Why the fee milestone still holds things up, or null. */
export function feeMilestoneBlockReason(
	checks: { paymentPlanId?: string | null; agencyStageIndex?: number; agencySettled?: boolean },
	prefix: string,
): string | null {
	if (!checks.paymentPlanId) return `${prefix}: no payment plan has been chosen.`;
	if (preDepartureFeePaid(checks)) return null;
	return checks.paymentPlanId === "installment"
		? `${prefix}: the pre-departure instalment (50%) is not paid.`
		: `${prefix}: the service fee balance is not paid.`;
}

/** Travel is settled when the flight is booked, or the applicant is handling it, or has paused it. */
export function isTravelResolved(status: string | null | undefined): boolean {
	return status === "booked" || status === "declined" || status === "on_hold";
}

/** Why travel still holds the case, in words either audience can read. Null when resolved. */
export function travelBlockReason(status: string | null | undefined, prefix: string): string | null {
	if (isTravelResolved(status)) return null;
	switch (status) {
		case "review":
			return `${prefix}: the ticket invoice has not been raised.`;
		case "invoiced":
			return `${prefix}: the ticket invoice is not paid.`;
		case "ticket_paid":
			return `${prefix}: the flight is not booked yet.`;
		default:
			return `${prefix}: the applicant has not decided on travel assistance.`;
	}
}

export function canAdvanceToStage(
	current: JourneyStage,
	target: JourneyStage,
	app?: {
		visaStage?: string;
		agencyStageIndex?: number;
		agencySettled?: boolean;
		depositPaid?: boolean;
		appFeePaid?: boolean;
		preDepartureTasks?: { done: boolean }[];
		paymentPlanId?: string | null;
		proceedStatus?: string;
		/**
		 * The travel assistance request's status — the one travel signal.
		 * Travel is resolved when the flight is booked, or the applicant is
		 * booking their own, or has put it on hold. Absent means the applicant
		 * has not decided yet.
		 */
		travelAssistanceStatus?: TravelAssistanceStatus | string | null;
	},
): string | null {
	const currentIdx = JOURNEY_STAGES.indexOf(current);
	const targetIdx = JOURNEY_STAGES.indexOf(target);

	if (current === target) return "Application is already at this stage.";
	if (current === "completed") return "Completed cases cannot be moved.";
	if (targetIdx < 0 || currentIdx < 0) return "Unknown stage.";
	if (targetIdx !== currentIdx + 1) {
		const next = JOURNEY_STAGES[currentIdx + 1];
		return `Can only advance one stage at a time. Next: ${next ? JOURNEY_STAGE_LABELS[next] : "completed"}.`;
	}

	const checks = app ?? {};

	// Consent gate: the application is locked until the applicant accepts to
	// proceed (or ops overrides on their behalf after a phone confirmation).
	if (current === "document_verification") {
		if (checks.proceedStatus === "declined") {
			return "Stopped: this applicant declined to proceed with the application.";
		}
		if (checks.proceedStatus === "paused") {
			return "Paused: this applicant is on hold and has not yet confirmed they want to proceed.";
		}
		if (checks.proceedStatus !== "accepted") {
			return "Locked: this applicant has not yet confirmed they want to proceed with their application.";
		}
	}

	switch (target) {
		case "school_submission":
			return (checks.agencyStageIndex ?? 0) >= 1
				? null
				: "Cannot advance: Agency Service Fee Deposit must be paid before school submission.";
		case "offer_letter_review":
			return checks.appFeePaid
				? null
				: "Cannot advance: application fee must be paid before reviewing offers.";
		case "travel_assistance":
			return checks.visaStage === "complete"
				? null
				: "Cannot advance to Departure: the visa must be approved.";
		case "completed": {
			const feeBlock = feeMilestoneBlockReason(checks, "Cannot mark complete");
			if (feeBlock) return feeBlock;
			const travelBlock = travelBlockReason(checks.travelAssistanceStatus, "Cannot mark complete");
			if (travelBlock) return travelBlock;
			if (checks.preDepartureTasks && checks.preDepartureTasks.length > 0) {
				const allDone = checks.preDepartureTasks.every((t) => t.done);
				if (!allDone) return "Cannot mark complete: pre-departure checklist is incomplete.";
			}
			return null;
		}
		default:
			return null;
	}
}

/**
 * Canonical portal stage labels — the single source of truth for the
 * fine-grained `ProcessStageId` display text. The ops UI uses
 * `JOURNEY_STAGE_LABELS` (coarse); the portal and the /me/journey route
 * use this (fine). Delete the duplicate label maps that used to live in
 * AppState.tsx (getJourneyPhase) and the /me/journey route.
 */
// PORTAL_STAGE_LABELS now lives in ../labels.ts — the one vocabulary both
// apps read — and is re-exported from the package index.

/** Canonical portal stage order — matches PROCESS_STAGES[].index. */
// The fee milestone comes before the flight: it is due once the visa is
// approved and the ticket is not issued until it is paid.
export const PORTAL_STAGE_ORDER: string[] = [
	"new",
	"consultation",
	"eligibility",
	"proceed",
	"school_package",
	"awaiting_handler",
	"school_select",
	"awaiting_invoice",
	"application_invoice",
	"school_tracking",
	"visa_invoice",
	"visa",
	"payment_execution",
	"travel_assistance",
	"completed",
];

export const consultationWorkflowSchema = z.object({
	status: z.enum(["AWAITING_ASSIGNMENT", "IN_PROGRESS", "COMPLETED", "CLOSED"]),
	stage: z.string(),
	closureReason: z.string().nullable(),
	nextAction: z.string().nullable(),
});
export type ConsultationWorkflow = z.infer<typeof consultationWorkflowSchema>;

export const consultationStatusSchema = z.enum([
	"UNDER_REVIEW",
	"ASSIGNED",
	"CONFIRMED",
	"IN_ASSESSMENT",
	"COMPLETED",
	"CANCELLED",
]);
export type ConsultationStatus = z.infer<typeof consultationStatusSchema>;

export const CONSULTATION_STATUS_TO_OPS: Record<ConsultationStatus, string> = {
	UNDER_REVIEW: "Under Review",
	ASSIGNED: "Assigned",
	CONFIRMED: "Confirmed",
	IN_ASSESSMENT: "In Assessment",
	COMPLETED: "Completed",
	CANCELLED: "Cancelled",
};

export const applicationStatusSchema = z.enum([
	"UNDER_REVIEW",
	"ACCEPTED",
	"ACTION_REQUIRED",
	"REJECTED",
]);
export type CaseApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const APPLICATION_STATUS_TO_OPS: Record<CaseApplicationStatus, string> = {
	UNDER_REVIEW: "Under Review",
	ACCEPTED: "Accepted",
	ACTION_REQUIRED: "Action Required",
	REJECTED: "Rejected",
};

export const visaStageSchema = z.enum(["locked", "awaiting_handler", "pending", "biometrics", "decision", "complete"]);
export type VisaStage = z.infer<typeof visaStageSchema>;

/**
 * The facts of one visa application, filled in as the milestones happen.
 * Every field is optional: the officer records what they know when they
 * know it. Dates are ISO; `appointmentAt` carries the time.
 */
export const visaDetailsSchema = z.object({
	/** "UK Student visa", "Canada study permit", "US F-1"… */
	visaType: z.string().max(120).nullable().optional(),
	/** The authority's reference — GWF, UCI, SEVIS, application number. */
	reference: z.string().max(120).nullable().optional(),
	/** Application lodged online. */
	submittedAt: z.string().datetime().nullable().optional(),
	/** Biometrics / document appointment at the visa centre. */
	appointmentAt: z.string().datetime().nullable().optional(),
	appointmentCentre: z.string().max(200).nullable().optional(),
	/** Biometrics given. */
	biometricsAt: z.string().datetime().nullable().optional(),
	/** The authority's decision reached the client. */
	decidedAt: z.string().datetime().nullable().optional(),
	/** Visa validity, once approved. */
	validFrom: z.string().datetime().nullable().optional(),
	validTo: z.string().datetime().nullable().optional(),
	/** Passport / permit collected. */
	collectedAt: z.string().datetime().nullable().optional(),
});
export type VisaDetails = z.infer<typeof visaDetailsSchema>;
/** How the visa decision went; `complete` implies approved, a refusal stays at `decision`. */
export const visaOutcomeSchema = z.enum(["approved", "refused"]);
export type VisaOutcome = z.infer<typeof visaOutcomeSchema>;

/**
 * The explicit "start your application?" gate that sits in front of
 * `document_verification`. Every eligible applicant gets a consultation
 * outcome; before the application actually opens they must consent.
 *
 *   invited  → application created, locked until the applicant decides
 *   accepted → application unlocked (school selection + quotation)
 *   declined → stopped; reversible (re-invite reopens the gate)
 */
export const proceedStatusSchema = z.enum(["invited", "accepted", "paused", "declined"]);
export type ProceedStatus = z.infer<typeof proceedStatusSchema>;

export const commentKindSchema = z.enum([
	"comment",
	"recommendation",
	"document_request",
	"status",
	"assignment",
]);
export type CommentKind = z.infer<typeof commentKindSchema>;

export const caseCommentSchema = z.object({
	id: z.string().uuid(),
	at: z.string().datetime(),
	author: z.string(),
	kind: commentKindSchema,
	text: z.string(),
});
export type CaseComment = z.infer<typeof caseCommentSchema>;

export const assessmentResultSchema = z.object({
	outcome: z.string().min(1).max(80),
	notes: z.string().max(4000).default(""),
	recCountry: z.string().max(80).default(""),
	recUniversity: z.string().max(200).default(""),
	recProgram: z.string().max(200).default(""),
	recPackage: z.string().max(200).default(""),
});
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;

export const applicantProfileSchema = z.object({
	nationality: z.string().optional(),
	residence: z.string().optional(),
	dob: z.string().optional(),
	gender: z.string().optional(),
	address: z.string().optional(),
	passportNumber: z.string().optional(),
	passportCountry: z.string().optional(),
	passportIssue: z.string().optional(),
	passportExpiry: z.string().optional(),
	previousRefusals: z.string().optional(),
	degree: z.string().optional(),
	institution: z.string().optional(),
	fieldOfStudy: z.string().optional(),
	gpa: z.string().optional(),
	gradYear: z.string().optional(),
	employmentStatus: z.string().optional(),
	currentRole: z.string().optional(),
	company: z.string().optional(),
	experienceYears: z.string().optional(),
	englishTest: z.string().optional(),
	englishScore: z.string().optional(),
	englishDate: z.string().optional(),
	fundingSource: z.string().optional(),
	budget: z.string().optional(),
	degreeLevel: z.string().optional(),
	intake: z.string().optional(),
	major: z.string().optional(),
	preferredCountries: z.string().optional(),
	sponsorName: z.string().optional(),
	sponsorRelationship: z.string().optional(),
	referralSource: z.string().optional(),
});
export type ApplicantProfile = z.infer<typeof applicantProfileSchema>;

export const checklistItemSchema = z.object({
	id: z.string(),
	label: z.string(),
	checked: z.boolean(),
});

export const preDepartureTaskSchema = z.object({
	id: z.string(),
	category: z.enum(["travel", "accommodation", "documents", "health", "finance", "orientation"]).optional(),
	label: z.string(),
	detail: z.string().optional(),
	done: z.boolean(),
});

/**
 * Ops edits to an application. Payment state (`appFeePaid`, `depositPaid`,
 * `agencyStageIndex`, `agencySettled`, …) is deliberately absent: it is
 * derived from the invoice ledger by a database trigger and cannot be set
 * by hand — record a payment against the invoice instead.
 */
export const patchApplicationSchema = z.object({
	visaCounselorNote: z.string().optional(),
	paymentPlanId: z.string().optional(),
	preDepartureTasks: z.array(preDepartureTaskSchema).optional(),
	notes: z.string().optional(),
	/**
	 * Correction of the school allowance only. The package itself
	 * (`fundingTrack`/`packageId`) is deliberately absent — changing it
	 * re-prices and re-links invoices, so it goes through
	 * `POST /{id}/package`, never a bare patch.
	 */
	targetSchoolCount: z.number().int().min(1).max(10).nullable().optional(),
}).partial();

export const applicantSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().nullable(),
	email: z.string().email(),
	name: z.string(),
	phone: z.string().nullable(),
	branch: z.string(),
	targetCountry: z.string().nullable(),
	assignedOfficerId: z.string().uuid().nullable(),
	assignedOfficerName: z.string().nullable(),
	assignedOfficerEmail: z.string().email().nullable(),
	profile: applicantProfileSchema,
	portalState: z.record(z.unknown()).default({}),
	currentStage: z.string(),
	status: z.string(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type ApiApplicant = z.infer<typeof applicantSchema>;

/** One required document and where the client's upload of it stands. */
export const documentChecklistItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	hint: z.string(),
	status: z.enum(["PENDING_UPLOAD", "UPLOADED", "VERIFIED", "REJECTED"]),
	documentId: z.string().uuid().nullable(),
});
export type DocumentChecklistItem = z.infer<typeof documentChecklistItemSchema>;

export const consultationSchema = z.object({
	id: z.string().uuid(),
	reference: z.string(),
	bookingId: z.string().uuid().nullable(),
	applicantId: z.string().uuid(),
	applicantUserId: z.string().nullable(),
	applicantName: z.string(),
	email: z.string().email(),
	phone: z.string().nullable(),
	branch: z.string(),
	type: z.string(),
	targetCountry: z.string().nullable(),
	status: consultationStatusSchema,
	assignedOfficerId: z.string().uuid().nullable(),
	assignedOfficerName: z.string().nullable(),
	assignedOfficerEmail: z.string().email().nullable(),
	/** The coordinator who manages this case (delegated by manager/owner). */
	coordinatorId: z.string().uuid().nullable(),
	coordinatorName: z.string().nullable(),
	coordinatorEmail: z.string().email().nullable(),
	coordinatorAssignedAt: z.string().datetime().nullable(),
	coordinatorAssignedByName: z.string().nullable(),
	delegationNote: z.string().nullable(),
	slotConfirmed: z.boolean(),
	startsAt: z.string().datetime().nullable(),
	timezone: z.string().nullable(),
	meetingUrl: z.string().nullable(),
	rescheduleRequestedAt: z.string().datetime().nullable().optional(),
	rescheduleRequestedStartsAt: z.string().datetime().nullable().optional(),
	rescheduleRequestReason: z.string().nullable().optional(),
	assessmentResult: assessmentResultSchema.nullable(),
	requestedDocuments: z.array(z.string()),
	/** The standard documents for this client, collected at consultation, with their verification state. */
	documentChecklist: z.array(documentChecklistItemSchema).default([]),
	comments: z.array(caseCommentSchema),
	profile: applicantProfileSchema,
	workflow: consultationWorkflowSchema,
	/** Application opened from this consultation, if any. */
	applicationId: z.string().uuid().nullable().optional(),
	applicationNumber: z.string().nullable().optional(),
	applicationStage: z.string().nullable().optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type ApiConsultation = z.infer<typeof consultationSchema>;

/**
 * The gated assignment waiting on this application, surfaced on the journey
 * tracker: the next specialist (owner-class boundary) has not been confirmed,
 * so the case is parked until a manager resolves the handoff.
 */
export const stageHandoffPreviewSchema = z.object({
	id: z.string().uuid(),
	/** The stage waiting on its specialist (e.g. payment_execution). */
	stage: journeyStageSchema,
	source: z.string(),
	fromOpsUserId: z.string().nullable(),
	fromOpsUserName: z.string().nullable(),
	reason: z.string().nullable(),
	deferCount: z.number().int(),
	createdAt: z.string().datetime(),
});
export type StageHandoffPreview = z.infer<typeof stageHandoffPreviewSchema>;

/* ── Stage consent ─────────────────────────────────────────────────────── */
/**
 * The applicant's explicit decision to start, hold, or opt out of a major
 * journey stage (application, visa, travel). The consent card appears on
 * the portal before each stage begins; only "continue" sends the case to
 * Ops for handler assignment.
 */
export const stageConsentStageSchema = z.enum(["application", "visa", "travel"]);
export type StageConsentStage = z.infer<typeof stageConsentStageSchema>;

export const stageConsentDecisionSchema = z.enum(["pending", "continue", "hold", "opt_out"]);
export type StageConsentDecision = z.infer<typeof stageConsentDecisionSchema>;

export const stageConsentSchema = z.object({
	id: z.string().uuid(),
	applicationId: z.string().uuid(),
	stage: stageConsentStageSchema,
	decision: stageConsentDecisionSchema,
	reason: z.string().nullable(),
	decidedAt: z.string().datetime().nullable(),
	decidedByClientUserId: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type StageConsent = z.infer<typeof stageConsentSchema>;

export const stageConsentInputSchema = z.object({
	decision: z.enum(["continue", "hold", "opt_out"]),
	reason: z.string().optional(),
});
export type StageConsentInput = z.infer<typeof stageConsentInputSchema>;

/* ── Travel Assistance (direct-invoice flow) ─────────────────────────────── */

export const travelDecisionSchema = z.enum(["yes", "hold", "no"]);
export type TravelDecision = z.infer<typeof travelDecisionSchema>;

/**
 * One path: decide → review (handler assigned, invoice raised) → invoiced →
 * ticket paid → booked. "declined" (booking their own) and "on_hold" leave
 * the path. Whether an invoice is a proforma or issued is the invoice's own
 * status, not a request status.
 */
export const travelAssistanceStatusSchema = z.enum([
	"decision_pending",
	"review",
	"invoiced",
	"ticket_paid",
	"booked",
	"declined",
	"on_hold",
]);
export type TravelAssistanceStatus = z.infer<typeof travelAssistanceStatusSchema>;

export const applicationSchema = z.object({
	id: z.string().uuid(),
	appNumber: z.string(),
	applicantId: z.string().uuid(),
	applicantName: z.string(),
	email: z.string().email(),
	phone: z.string().nullable(),
	branch: z.string(),
	university: z.string(),
	program: z.string(),
	country: z.string(),
	degreeLevel: z.string(),
	/** The applicant's login id — documents and chat are keyed on it. */
	applicantUserId: z.string().nullable().optional(),
	assignedStaffId: z.string().uuid().nullable(),
	assignedStaffName: z.string().nullable(),
	assignedStaffEmail: z.string().email().nullable(),
	stage: journeyStageSchema,
	status: applicationStatusSchema,
	proceedStatus: proceedStatusSchema,
	proceededAt: z.string().datetime().nullable(),
	declinedReason: z.string().nullable(),
	fundingTrack: z.string().nullable(),
	targetSchoolCount: z.number().int().nullable().optional(),
	/** The admitted school the client accepted — visa, deposit and departure hang off it. */
	acceptedSchoolId: z.string().uuid().nullable().optional(),
	offerAcceptedAt: z.string().datetime().nullable().optional(),
	notes: z.string().nullable(),
	checklist: z.array(checklistItemSchema),
	visaStage: visaStageSchema,
	visaOutcome: visaOutcomeSchema.nullable().optional(),
	visaInvoicePaid: z.boolean(),
	visaCounselorNote: z.string().nullable(),
	visaDetails: visaDetailsSchema.default({}),
	/** The visa-stage documents and where the client's upload of each stands. */
	visaDocumentChecklist: z.array(documentChecklistItemSchema).default([]),
	paymentPlanId: z.string().nullable(),
	packageId: z.string().uuid().nullable(),
	packageSelectedAt: z.string().datetime().nullable(),
	agencyStageIndex: z.number().int(),
	agencySettled: z.boolean(),
	depositPaid: z.boolean(),
	appFeePaid: z.boolean(),
	travelInvoicePaid: z.boolean(),
	travelAssistanceStatus: travelAssistanceStatusSchema.nullable().optional(),
	requestedDocuments: z.array(z.string()),
	/** The standard documents for this client, collected at consultation, with their verification state. */
	documentChecklist: z.array(documentChecklistItemSchema).default([]),
	preDepartureTasks: z.array(
		z.object({
			id: z.string(),
			category: z.enum(["travel", "accommodation", "documents", "health", "finance", "orientation"]).optional(),
			label: z.string(),
			detail: z.string().optional(),
			done: z.boolean(),
		}),
	),
	comments: z.array(caseCommentSchema),
	/** Open gated assignment (pending handoff) parked on this application, if any. */
	pendingHandoff: stageHandoffPreviewSchema.nullable(),
	/** Parent consultation, if this application was opened from an assessment. */
	consultationId: z.string().uuid().nullable(),
	consultationNumber: z.string().nullable().optional(),
	/** The actual schools the applicant selected, with their per-school statuses. */
	schoolApplications: z.array(schoolApplicationSchema).default([]),
	/** Stage consent status for each major stage — null when no consent record exists. */
	applicationConsent: stageConsentSchema.nullable(),
	visaConsent: stageConsentSchema.nullable(),
	travelConsent: stageConsentSchema.nullable(),
	/**
	 * Active per-stage specialists (visa, travel, finance) — from
	 * stage_assignments. The whole-case owner is `assignedStaffId`; a case is
	 * "mine" for staff when either points at them.
	 */
	stageHandlers: z
		.array(
			z.object({
				stage: z.string(),
				opsUserId: z.string().uuid(),
				opsUserName: z.string(),
				opsUserEmail: z.string(),
				assignedAt: z.string().datetime(),
			}),
		)
		.default([]),
	/**
	 * The applicant's journey as the portal shows it — the same derivation
	 * (`deriveJourney`) the portal reads, so ops and the client name the same
	 * step. Optional only so older clients keep parsing.
	 */
	journey: z
		.object({
			portalStage: z.string(),
			label: z.string(),
			nextUnlock: z.string().nullable(),
			stageStatuses: z.record(z.enum(["done", "current", "locked", "skipped"])),
			/**
			 * Which portal chapters are open (`deriveJourney().chapterUnlocks`).
			 * Ops gates its case tabs on this rather than re-deriving the rule.
			 */
			chapterUnlocks: z.record(z.boolean()).optional(),
		})
		.optional(),
	submittedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type ApiApplication = z.infer<typeof applicationSchema>;

export const applicantListSchema = z.object({
	applicants: z.array(applicantSchema),
	total: z.number().int(),
});
export const consultationListSchema = z.object({
	consultations: z.array(consultationSchema),
	total: z.number().int(),
});
export const applicationListSchema = z.object({
	applications: z.array(applicationSchema),
	total: z.number().int(),
});

export const assignCaseSchema = z.object({
	employeeId: z.string().uuid(),
});
export const completeAssessmentSchema = assessmentResultSchema;
export const cancelConsultationSchema = z.object({
	reason: z.string().max(1000).optional(),
});
export type CancelConsultation = z.infer<typeof cancelConsultationSchema>;
export const commentVisibilitySchema = z.enum(["internal", "applicant"]);
export type CommentVisibility = z.infer<typeof commentVisibilitySchema>;
export const addCommentSchema = z.object({
	kind: commentKindSchema.default("comment"),
	text: z.string().min(1).max(4000),
	/** Who may read it: staff only (default) or the applicant too. */
	visibility: commentVisibilitySchema.default("internal"),
});
export type AddComment = z.infer<typeof addCommentSchema>;
/** What a caller sends — `visibility` may be left out and defaults to staff-only. */
export type AddCommentInput = z.input<typeof addCommentSchema>;
export const requestDocumentsSchema = z.object({
	documents: z.array(z.string().min(1).max(200)).min(1).max(20),
});
export const setStageSchema = z.object({
	stage: journeyStageSchema,
});
export const toggleChecklistSchema = z.object({
	itemId: z.string().min(1),
	checked: z.boolean(),
});
export const setVisaStageSchema = z.object({
	stage: visaStageSchema,
	note: z.string().max(2000).optional(),
	/**
	 * Record the authority's decision. `refused` is only valid at the
	 * `decision` stage and keeps the case there; moving to `complete` records
	 * `approved`; moving back to `pending` clears it (reapplication).
	 */
	outcome: visaOutcomeSchema.optional(),
	/** Facts recorded with the move — the biometrics date, the decision date, validity. */
	details: visaDetailsSchema.optional(),
});
export const updateVisaDetailsSchema = visaDetailsSchema;

/**
 * Applicant acceptance of the post-consultation "start your application?"
 * gate. Country + at least one school pair are required — the selection is
 * what drives the quotation. `acceptQuotation` distinguishes a preview
 * (`false`/omitted = draft, nothing is persisted as final) from the actual
 * opt-in (`true`), so the applicant can review pricing before committing.
 */
export const proceedApplicationSchema = z.object({
	/** Explicit opt-in: must be `true`, otherwise the call is a preview. */
	acceptQuotation: z.literal(true),
	country: z.string().min(1).max(80).optional(),
	degreeLevel: z.string().min(1).max(64).optional(),
	fundingTrack: z.string().min(1).max(64).nullable().optional(),
});
export type ProceedApplication = z.infer<typeof proceedApplicationSchema>;

export const declineProceedSchema = z.object({
	reason: z.string().max(1000).optional(),
});
export type DeclineProceed = z.infer<typeof declineProceedSchema>;

export const pauseProceedSchema = z.object({
	reason: z.string().max(1000).optional(),
});
export type PauseProceed = z.infer<typeof pauseProceedSchema>;

/**
 * The pre-commit advisory quotation for this applicant. Computed on read from
 * the current draft school selection + funding track — never cached on the
 * application row. `advisory` reminds the client the amount is an estimate
 * until the consultant issues the proforma.
 */
export const proceedQuotationSchema = z.object({
	schoolCount: z.number().int().min(0),
	appBaseCents: z.number().int().min(0),
	perSchoolCents: z.number().int().min(0),
	appSubtotalCents: z.number().int().min(0),
	agencyFeeCents: z.number().int().min(0),
	visaFeeCents: z.number().int().min(0),
	totalCents: z.number().int().min(0),
	currency: z.literal("USD"),
	advisory: z.string(),
});
export type ProceedQuotation = z.infer<typeof proceedQuotationSchema>;

export const acceptProceedResponseSchema = z.object({
	quotation: proceedQuotationSchema,
	schoolCount: z.number().int().min(0),
});
export type AcceptProceedResponse = z.infer<typeof acceptProceedResponseSchema>;
export const patchApplicantSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	phone: z.string().max(40).optional(),
	branch: z.string().max(64).optional(),
	targetCountry: z.string().max(80).optional(),
	profile: applicantProfileSchema.optional(),
});
export const myApplicationSchema = z.object({
	applicant: applicantSchema.nullable(),
	consultation: consultationSchema.nullable(),
	application: applicationSchema.nullable(),
});

/**
 * Applicant self-service profile update.
 *
 * The applicant may edit their own contact + profile fields, but not their
 * branch (an ops decision) or their assigned officer. The server resolves the
 * applicant from the session, so no id is sent.
 */
export const updateMyProfileSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	phone: z.string().max(40).optional(),
	targetCountry: z.string().max(80).optional(),
	profile: applicantProfileSchema.optional(),
});
export type UpdateMyProfile = z.infer<typeof updateMyProfileSchema>;

export const requestEmailChangeSchema = z.object({
	newEmail: z.string().email().max(200),
});
export type RequestEmailChange = z.infer<typeof requestEmailChangeSchema>;

export const confirmEmailChangeSchema = z.object({
	newEmail: z.string().email().max(200),
	otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
export type ConfirmEmailChange = z.infer<typeof confirmEmailChangeSchema>;

/** Choose the post-admission payment plan (full or installment). */
export const choosePaymentPlanSchema = z.object({
	paymentPlanId: z.enum(["full", "installment"]),
});
export type ChoosePaymentPlan = z.infer<typeof choosePaymentPlanSchema>;

export const CASE_ERROR_CODES = {
	APPLICANT_NOT_FOUND: "APPLICANT_NOT_FOUND",
	CONSULTATION_NOT_FOUND: "CONSULTATION_NOT_FOUND",
	APPLICATION_NOT_FOUND: "APPLICATION_NOT_FOUND",
	CASE_CLOSED: "CASE_CLOSED",
} as const;

/* ── Coordinator Delegation ────────────────────────────────────────────── */

export const delegateConsultationSchema = z.object({
	coordinatorOpsUserId: z.string().uuid(),
	delegationNote: z.string().max(2000).optional(),
});
export type DelegateConsultation = z.infer<typeof delegateConsultationSchema>;

export const reassignCoordinatorSchema = z.object({
	newCoordinatorOpsUserId: z.string().uuid(),
	reason: z.string().max(2000).optional(),
});
export type ReassignCoordinator = z.infer<typeof reassignCoordinatorSchema>;

/* ── Workload ──────────────────────────────────────────────────────────── */

export const workloadEntrySchema = z.object({
	opsUserId: z.string().uuid(),
	name: z.string(),
	email: z.string(),
	role: z.string(),
	activeCases: z.number().int(),
	overdueCases: z.number().int(),
	maxCapacity: z.number().int(),
	capacityPercent: z.number(),
});
export type WorkloadEntry = z.infer<typeof workloadEntrySchema>;

export const workloadSchema = z.object({
	coordinators: z.array(workloadEntrySchema),
	maxCapacityPerCoordinator: z.number().int(),
});
export type Workload = z.infer<typeof workloadSchema>;

/* ── Activity Timeline ─────────────────────────────────────────────────── */

export const consultationActivitySchema = z.object({
	id: z.string().uuid(),
	consultationId: z.string().uuid(),
	type: z.string(),
	actorName: z.string().nullable(),
	payload: z.any().nullable(),
	createdAt: z.string().datetime(),
});
export type ConsultationActivity = z.infer<typeof consultationActivitySchema>;

export const consultationActivityListSchema = z.object({
	activities: z.array(consultationActivitySchema),
	total: z.number().int(),
});
export type ConsultationActivityList = z.infer<typeof consultationActivityListSchema>;

/* ── Escalation Config ─────────────────────────────────────────────────── */

export const escalationConfigSchema = z.object({
	hoursBeforeEscalation: z.number().int().min(1).max(72).default(4),
	maxCapacityPerCoordinator: z.number().int().min(1).max(50).default(10),
});
export type EscalationConfig = z.infer<typeof escalationConfigSchema>;

/** The flight on the ticket invoice — and, once booked, the flight that was booked. */
export const travelFlightSchema = z.object({
	carrier: z.string().max(120).optional(),
	flightNumber: z.string().max(32).optional(),
	from: z.string().max(120).optional(),
	to: z.string().max(120).optional(),
	departAt: z.string().datetime({ offset: true }).optional(),
	arriveAt: z.string().datetime({ offset: true }).optional(),
	notes: z.string().max(2000).optional(),
});
export type TravelFlight = z.infer<typeof travelFlightSchema>;

export const travelBookingSchema = travelFlightSchema.extend({
	/** Airline PNR / confirmation code. */
	confirmationCode: z.string().max(64).optional(),
});
export type TravelBooking = z.infer<typeof travelBookingSchema>;

export const travelAssistanceRequestSchema = z.object({
	id: z.string().uuid(),
	applicantId: z.string().uuid(),
	applicationId: z.string().uuid(),
	decision: travelDecisionSchema.nullable(),
	status: travelAssistanceStatusSchema,
	/** The flight the ticket invoice is for; set when the invoice is raised. */
	flight: travelFlightSchema.nullable(),
	currency: z.string(),
	invoiceId: z.string().uuid().nullable(),
	/** The booked flight and its PNR; set when the handler records the booking. */
	booking: travelBookingSchema.nullable(),
	applicantNote: z.string().nullable(),
	opsNote: z.string().nullable(),
	assignedOpsUserId: z.string().uuid().nullable(),
	assignedOpsUserName: z.string().optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	/** Ops-facing display fields — only populated by the ops list endpoint. */
	applicantName: z.string().optional(),
	applicantEmail: z.string().optional(),
	applicationReference: z.string().optional(),
	university: z.string().optional(),
	program: z.string().optional(),
});
export type TravelAssistanceRequest = z.infer<typeof travelAssistanceRequestSchema>;

export const travelAssistanceDecisionInputSchema = z.object({
	decision: travelDecisionSchema,
});
export type TravelAssistanceDecisionInput = z.infer<typeof travelAssistanceDecisionInputSchema>;

/** Raising the ticket invoice: the airline fare and the flight it buys. */
export const travelAssistanceInvoiceInputSchema = z.object({
	fareCents: z.number().int().positive(),
	flight: travelFlightSchema,
});
export type TravelAssistanceInvoiceInput = z.infer<typeof travelAssistanceInvoiceInputSchema>;

export const travelAssistanceBookingInputSchema = travelBookingSchema;
export type TravelAssistanceBookingInput = z.infer<typeof travelAssistanceBookingInputSchema>;

/* ── Application activity ────────────────────────────────────────────────── */

/**
 * One event on an application's timeline. Assembled from the tables that
 * already record history (comments, ownership, stage assignments, handoffs,
 * consents, invoices and payments, school outcomes, travel requests) — there
 * is no separate activity table for applications.
 */
export const applicationActivityEventSchema = z.object({
	id: z.string(),
	applicationId: z.string().uuid(),
	type: z.enum([
		"comment",
		"document_request",
		"owner_assigned",
		"owner_released",
		"stage_assigned",
		"stage_assignment_ended",
		"handoff_opened",
		"handoff_resolved",
		"consent_decided",
		"invoice_created",
		"invoice_issued",
		"invoice_voided",
		"payment_recorded",
		"school_added",
		"school_admitted",
		"school_rejected",
		"travel_requested",
		"travel_decided",
	]),
	/** Short human line, e.g. "Visa invoice issued". */
	summary: z.string(),
	/** Longer free text when there is one (comment body, reason, note). */
	detail: z.string().nullable(),
	actorName: z.string().nullable(),
	/** Journey stage the event belongs to, when it has one. */
	stage: z.string().nullable(),
	/** For notes: whether the applicant can read it. Null for every other event. */
	visibility: commentVisibilitySchema.nullable().optional(),
	at: z.string().datetime(),
});
export type ApplicationActivityEvent = z.infer<typeof applicationActivityEventSchema>;

export const applicationActivityResponseSchema = z.object({
	events: z.array(applicationActivityEventSchema),
	total: z.number().int(),
});
export type ApplicationActivityResponse = z.infer<typeof applicationActivityResponseSchema>;
