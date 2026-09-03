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
	"IN_ASSESSMENT",
	"COMPLETED",
	"CANCELLED",
]);
export type ConsultationStatus = z.infer<typeof consultationStatusSchema>;

export const CONSULTATION_STATUS_TO_OPS: Record<ConsultationStatus, string> = {
	UNDER_REVIEW: "Under Review",
	ASSIGNED: "Assigned",
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
	passportNumber: z.string().optional(),
	passportExpiry: z.string().optional(),
	previousRefusals: z.string().optional(),
	degree: z.string().optional(),
	institution: z.string().optional(),
	gpa: z.string().optional(),
	gradYear: z.string().optional(),
	currentRole: z.string().optional(),
	company: z.string().optional(),
	experienceYears: z.string().optional(),
	fundingSource: z.string().optional(),
	budget: z.string().optional(),
	degreeLevel: z.string().optional(),
	intake: z.string().optional(),
	major: z.string().optional(),
	referralSource: z.string().optional(),
});
export type ApplicantProfile = z.infer<typeof applicantProfileSchema>;

export const checklistItemSchema = z.object({
	id: z.string(),
	label: z.string(),
	checked: z.boolean(),
});

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
	workflow: consultationWorkflowSchema,
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
	travelClearance: z.enum(["pending", "cleared"]),
	requestedDocuments: z.array(z.string()),
	comments: z.array(caseCommentSchema),
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
