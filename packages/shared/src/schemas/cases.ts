import { schoolApplicationSchema } from "./school.js";
import { z } from "zod";

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
	"payment_execution",
	"travel_assistance",
	"completed",
]);
export type JourneyStage = z.infer<typeof journeyStageSchema>;

/** Ordered array for pipeline display / "advance to next" logic. */
export const JOURNEY_STAGES: JourneyStage[] = [
	"document_verification",
	"school_submission",
	"offer_letter_review",
	"visa_processing",
	"payment_execution",
	"travel_assistance",
	"completed",
];

/** Human-readable labels for the ops UI. */
export const JOURNEY_STAGE_LABELS: Record<JourneyStage, string> = {
	document_verification: "Document Verification",
	school_submission: "School Submission",
	offer_letter_review: "Offer Letter Review",
	visa_processing: "Visa Processing",
	payment_execution: "Payment Execution",
	travel_assistance: "Travel Assistance",
	completed: "Completed",
};

/**
 * Mapping from the coarse `JourneyStage` (stored in the DB) to the portal's
 * fine-grained `ProcessStageId` (derived for UI display). The portal uses this
 * to decide which chapter to show, but the *authoritative* value is the
 * `JourneyStage` on the application row.
 */
export const JOURNEY_STAGE_TO_PORTAL: Record<JourneyStage, string> = {
	document_verification: "school_package",
	school_submission: "school_tracking",
	offer_letter_review: "school_tracking",
	visa_processing: "visa",
	payment_execution: "visa",
	travel_assistance: "pre_departure",
	completed: "completed",
};

/**
 * Guard a stage transition. Adjacency is enforced — a case can only move
 * forward one column at a time. A few later stages require sub-step
 * completion, matching the current ops UI buttons, so the server and the
 * Workflow board share the same rule set.
 */
export function canAdvanceToStage(
	current: JourneyStage,
	target: JourneyStage,
	app?: {
		visaStage?: string;
		agencyStageIndex?: number;
		agencySettled?: boolean;
		appFeePaid?: boolean;
		travelInvoicePaid?: boolean;
		travelClearance?: string;
		preDepartureTasks?: { done: boolean }[];
		paymentPlanId?: string | null;
		proceedStatus?: string;
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
		if (checks.proceedStatus !== "accepted") {
			return "Cannot advance: the applicant has not yet accepted to start the application.";
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
		case "payment_execution":
			return checks.visaStage === "complete"
				? null
				: "Cannot advance to Payment Execution: visa processing must be complete.";
		case "travel_assistance":
			return checks.paymentPlanId
				? null
				: "Cannot advance to Travel Assistance: applicant has not chosen a payment plan.";
		case "completed": {
			if (!checks.agencySettled) return "Cannot mark complete: agency settlement is not complete.";
			if (!checks.travelInvoicePaid) return "Cannot mark complete: travel invoices are not fully settled.";
			if (checks.travelClearance !== "cleared") return "Cannot mark complete: travel clearance is not granted.";
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
export const PORTAL_STAGE_LABELS: Record<string, string> = {
	new: "New",
	consultation: "Stage I · Consultation first",
	eligibility: "Awaiting eligibility",
	proceed: "Start your application",
	school_package: "Choose school application package",
	school_select: "Select schools & programmes",
	application_invoice: "Pay application invoice",
	school_tracking: "Application process / tracking",
	visa_invoice: "Pay visa invoice",
	visa: "Visa tracking in progress",
	pre_departure: "Travel & pre-departure",
	completed: "Application complete",
};

/** Canonical portal stage order — matches PROCESS_STAGES[].index. */
export const PORTAL_STAGE_ORDER: string[] = [
	"new",
	"consultation",
	"eligibility",
	"proceed",
	"school_package",
	"school_select",
	"application_invoice",
	"school_tracking",
	"visa_invoice",
	"visa",
	"pre_departure",
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

export const visaStageSchema = z.enum(["locked", "pending", "biometrics", "decision", "complete"]);
export type VisaStage = z.infer<typeof visaStageSchema>;

/**
 * The explicit "start your application?" gate that sits in front of
 * `document_verification`. Every eligible applicant gets a consultation
 * outcome; before the application actually opens they must consent.
 *
 *   invited  → application created, locked until the applicant decides
 *   accepted → application unlocked (school selection + quotation)
 *   declined → stopped; reversible (re-invite reopens the gate)
 */
export const proceedStatusSchema = z.enum(["invited", "accepted", "declined"]);
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

export const patchApplicationSchema = z.object({
	visaInvoicePaid: z.boolean().optional(),
	visaCounselorNote: z.string().optional(),
	paymentPlanId: z.string().optional(),
	agencyStageIndex: z.number().int().min(0).max(2).optional(),
	agencySettled: z.boolean().optional(),
	appFeePaid: z.boolean().optional(),
	travelClearance: z.enum(["pending", "cleared"]).optional(),
	preDepartureTasks: z.array(preDepartureTaskSchema).optional(),
	notes: z.string().optional(),
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
	comments: z.array(caseCommentSchema),
	profile: applicantProfileSchema,
	workflow,
	/** Application opened from this consultation, if any. */
	applicationId: z.string().uuid().nullable().optional(),
	applicationNumber: z.string().nullable().optional(),
	applicationStage: z.string().nullable().optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type ApiConsultation = z.infer<typeof consultationSchema>;

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
	assignedStaffId: z.string().uuid().nullable(),
	assignedStaffName: z.string().nullable(),
	assignedStaffEmail: z.string().email().nullable(),
	stage: journeyStageSchema,
	status: applicationStatusSchema,
	proceedStatus: proceedStatusSchema,
	proceededAt: z.string().datetime().nullable(),
	declinedReason: z.string().nullable(),
	fundingTrack: z.string().nullable(),
	notes: z.string().nullable(),
	checklist: z.array(checklistItemSchema),
	visaStage: visaStageSchema,
	visaInvoicePaid: z.boolean(),
	visaCounselorNote: z.string().nullable(),
	paymentPlanId: z.string().nullable(),
	packageId: z.string().uuid().nullable(),
	packageSelectedAt: z.string().datetime().nullable(),
	agencyStageIndex: z.number().int(),
	agencySettled: z.boolean(),
	appFeePaid: z.boolean(),
	travelInvoicePaid: z.boolean(),
	travelClearance: z.enum(["pending", "cleared"]),
	requestedDocuments: z.array(z.string()),
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
	/** Parent consultation, if this application was opened from an assessment. */
	consultationId: z.string().uuid().nullable(),
	consultationNumber: z.string().nullable().optional(),
	/** The actual schools the applicant selected, with their per-school statuses. */
	schoolApplications: z.array(schoolApplicationSchema).default([]),
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
export const addCommentSchema = z.object({
	kind: commentKindSchema.default("comment"),
	text: z.string().min(1).max(4000),
});
export type AddComment = z.infer<typeof addCommentSchema>;
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
});
export const setTravelClearanceSchema = z.object({
	cleared: z.boolean(),
});

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
