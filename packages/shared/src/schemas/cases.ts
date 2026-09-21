import { schoolApplicationSchema } from "./school.js";
import { z } from "zod";
import { STAGE_LABELS } from "../labels.js";
import { entryJourneyStage, normaliseScope, SERVICE_STAGE_LABELS, serviceStageForJourney, serviceStageSchema, type ServiceStage } from "../stages.js";

/**
 * Applicant journey. Consultations (cases), applications, and the applicant
 * profile they hang off. Commands, not CRUD, for every state change.
 */

/**
 * Unified journey stage enum. The single source of truth for the application
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

/** The stored stage, named by its chapter. The vocabulary lives in ../labels.ts. */
export const JOURNEY_STAGE_LABELS: Record<JourneyStage, string> = STAGE_LABELS as Record<JourneyStage, string>;

/**
 * Guard a stage transition. Adjacency is enforced. A case can only move
 * forward one column at a time. A few later stages require sub-step
 * completion, matching the current ops UI buttons, so the server and the
 * Workflow board share the same rule set.
 */
/**
 * The pre-departure service fee milestone: on a full plan the balance, on
 * instalments the second milestone (the deposit is the first). Due after
 * the visa is approved; it holds the travel documents. The admission
 * letter, the visa papers, the e-ticket handover. Never the booking. The
 * post-arrival remainder follows on the client's schedule.
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
		? `${prefix}: the pre-departure instalment of the service fee is not paid.`
		: `${prefix}: the service fee balance is not paid.`;
}

/**
 * What the agency holds until the pre-departure fee milestone: the admission
 * letter, the visa documents it received as the client's agent, and the
 * e-ticket once the flight is booked. The booking itself never waits. A
 * manager may release early with a reason (a transfer finance has not
 * recorded yet); the reason is the record.
 */
export const RELEASE_GATED_DOCUMENT_TYPES: readonly string[] = ["visa_receipt", "visa_grant", "flight_receipt"];

export function documentsReleased(checks: {
	paymentPlanId?: string | null;
	agencyStageIndex?: number;
	agencySettled?: boolean;
	departureDetails?: { releaseOverrideAt?: string | null } | null;
}): boolean {
	if (checks.departureDetails?.releaseOverrideAt) return true;
	return preDepartureFeePaid(checks);
}

/** Why the documents are still held, or null once released. */
export function documentReleaseHoldReason(checks: {
	paymentPlanId?: string | null;
	agencyStageIndex?: number;
	agencySettled?: boolean;
	departureDetails?: { releaseOverrideAt?: string | null } | null;
}): string | null {
	if (documentsReleased(checks)) return null;
	if (!checks.paymentPlanId) return "Released once the pre-departure fee milestone is paid. Choose a payment plan and settle it.";
	return checks.paymentPlanId === "installment"
		? "Released once the pre-departure instalment of the service fee is paid."
		: "Released once the service fee balance is paid.";
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

/**
 * What a case can do next, given its plan. The server's advance handler,
 * the ops case's next-action and the portal all ask this — so nobody
 * offers a button the server refuses.
 *
 *  - `advance`  the next journey stage is on the plan and its gate is open
 *  - `blocked`  it is on the plan but its gate is shut (with the reason)
 *  - `complete` the plan's exit stage is done and the fee settled
 *  - `done`     the case is closed
 *
 * `offer` names the stage the plan stops short of — the thing to sell —
 * whenever the case is sitting at its exit.
 */
export type NextStep =
	| { kind: "done" }
	| { kind: "advance"; to: JourneyStage; offer: ServiceStage | null }
	| { kind: "blocked"; to: JourneyStage; reason: string; offer: ServiceStage | null }
	| { kind: "complete"; offer: ServiceStage | null };

export function nextStepFor(input: {
	scopeStages: readonly string[] | null | undefined;
	stage: JourneyStage;
	checks: NonNullable<Parameters<typeof canAdvanceToStage>[2]> & { visaDone?: boolean; agencySettled?: boolean; hasAdmitted?: boolean; stopRequested?: boolean };
}): NextStep {
	const { stage, checks } = input;
	if (stage === "completed") return { kind: "done" };
	const scope = normaliseScope(input.scopeStages ?? null);
	const idx = JOURNEY_STAGES.indexOf(stage);
	const next = JOURNEY_STAGES[idx + 1];
	if (!next) return { kind: "done" };

	// A client who stopped where they are (a stage opt-out, or ops recorded
	// it) completes the case at the reached stage — provided that stage's
	// own exit fact holds. The server still gates the money side.
	if (checks.stopRequested) {
		const reached: ServiceStage | null =
			stage === "visa_processing"
				? "visa"
				: stage === "travel_assistance" || stage === "payment_execution"
					? "departure"
					: "admissions";
		const exitDone =
			reached === "visa" ? Boolean(checks.visaDone)
			: reached === "departure" ? isTravelResolved(checks.travelAssistanceStatus)
			: Boolean(checks.hasAdmitted);
		if (!exitDone) {
			return { kind: "blocked", to: "completed", reason: `the ${SERVICE_STAGE_LABELS[reached]} stage's work is not done`, offer: null };
		}
		return { kind: "complete", offer: null };
	}

	// A plan that enters after Admissions waits at document_verification for
	// its first milestone; the payment opens the entry stage, not an advance.
	if (stage === "document_verification" && !scope.includes("admissions")) {
		const to = entryJourneyStage(scope);
		return { kind: "blocked", to, reason: `${JOURNEY_STAGE_LABELS[to]} opens when the plan's first milestone is paid.`, offer: null };
	}

	const needed = serviceStageForJourney(next);
	if (needed && !scope.includes(needed)) {
		// The plan stops here. Its exit is done → complete; the next stage is
		// the one to offer either way.
		const exit = scope[scope.length - 1];
		const exitDone = exit === "visa" ? Boolean(checks.visaDone) : exit === "admissions" ? Boolean(checks.hasAdmitted) : false;
		if (!exitDone) {
			return { kind: "blocked", to: "completed", reason: exit === "visa" ? "the visa is not approved yet" : "no offer has been recorded yet", offer: needed };
		}
		if (!checks.agencySettled) {
			return { kind: "blocked", to: "completed", reason: "the service fee is not settled", offer: needed };
		}
		return { kind: "complete", offer: needed };
	}

	const reason = canAdvanceToStage(stage, next, checks);
	return reason ? { kind: "blocked", to: next, reason: reason.replace(/^Cannot (advance to [^:]+|advance|mark complete): /, ""), offer: null } : { kind: "advance", to: next, offer: null };
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
		preDepartureTasks?: { required?: boolean; done: boolean; waivedReason?: string | null }[];
		paymentPlanId?: string | null;
		proceedStatus?: string;
		/**
		 * The travel assistance request's status. The one travel signal.
		 * Travel is resolved when the flight is booked, or the applicant is
		 * booking their own, or has put it on hold. Absent means the applicant
		 * has not decided yet.
		 */
		travelAssistanceStatus?: TravelAssistanceStatus | string | null;
		/**
		 * The record signals the server also checks (a package chosen, schools
		 * selected, an offer admitted). A caller that has them passes them so
		 * the rule reads the same on a card as on the server; `undefined`
		 * means unknown and gates nothing.
		 */
		hasPackage?: boolean;
		hasSelection?: boolean;
		hasAdmitted?: boolean;
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
			if ((checks.agencyStageIndex ?? 0) < 1) return "Cannot advance: Agency Service Fee Deposit must be paid before school submission.";
			if (checks.hasPackage === false) return "Cannot advance to School submission: no service package selected.";
			return null;
		case "offer_letter_review":
			if (!checks.appFeePaid) return "Cannot advance: application fee must be paid before reviewing offers.";
			if (checks.hasSelection === false) return "Cannot advance to Offer letter review: no schools selected.";
			return null;
		case "visa_processing":
			return checks.hasAdmitted === false ? "Cannot advance to Visa processing: no accepted offer (admitted)." : null;
		case "travel_assistance":
			return checks.visaStage === "complete"
				? null
				: "Cannot advance to Departure: the visa must be approved.";
		case "completed": {
			const feeBlock = feeMilestoneBlockReason(checks, "Cannot mark complete");
			if (feeBlock) return feeBlock;
			const travelBlock = travelBlockReason(checks.travelAssistanceStatus, "Cannot mark complete");
			if (travelBlock) return travelBlock;
			if (!preDepartureChecklistDone(checks.preDepartureTasks)) {
				return "Cannot mark complete: the pre-departure checklist still has required items open.";
			}
			return null;
		}
		default:
			return null;
	}
}

/**
 * Canonical portal stage labels. The single source of truth for the
 * fine-grained `ProcessStageId` display text. The ops UI uses
 * `JOURNEY_STAGE_LABELS` (coarse); the portal and the /me/journey route
 * use this (fine). Delete the duplicate label maps that used to live in
 * AppState.tsx (getJourneyPhase) and the /me/journey route.
 */
// PORTAL_STAGE_LABELS now lives in ../labels.ts. The one vocabulary both
// apps read. And is re-exported from the package index.

/** Canonical portal stage order. Matches PROCESS_STAGES[].index. */
// The flight comes before the fee milestone: Departure opens on the visa,
// the flight is booked first, and the milestone unlocks once travel is
// settled (booked or own booking). It releases the papers, not the seat.
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
	"travel_assistance",
	"payment_execution",
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
	/** The authority's reference. GWF, UCI, SEVIS, application number. */
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

/**
 * The facts of the Departure chapter, recorded by the departure officer as
 * they are settled. Every field is optional; `null` clears. The flight
 * itself lives on the travel request.
 */
export const departureDetailsSchema = z.object({
	/** The school's arrive-by / reporting date. */
	reportBy: z.string().datetime().nullable().optional(),
	orientationAt: z.string().datetime().nullable().optional(),
	/** The pre-departure briefing with the consultant. Recording it closes that item. */
	briefingAt: z.string().datetime().nullable().optional(),
	/** Airport pickup — the university's, or one we arrange. */
	pickupBy: z.string().max(120).nullable().optional(),
	pickupNote: z.string().max(500).nullable().optional(),
	accommodationAddress: z.string().max(300).nullable().optional(),
	accommodationMoveInAt: z.string().datetime().nullable().optional(),
	/** Someone to call in the destination country. */
	emergencyContactName: z.string().max(120).nullable().optional(),
	emergencyContactPhone: z.string().max(40).nullable().optional(),
	emergencyContactRelation: z.string().max(60).nullable().optional(),
	/** The day they landed. The Done chapter starts here. */
	arrivedAt: z.string().datetime().nullable().optional(),
	/** A manager released the held documents ahead of the milestone. When, who, and why. */
	releaseOverrideAt: z.string().datetime().nullable().optional(),
	releaseOverrideBy: z.string().max(120).nullable().optional(),
	releaseOverrideReason: z.string().max(500).nullable().optional(),
});
export type DepartureDetails = z.infer<typeof departureDetailsSchema>;
export const releaseOverrideSchema = z.object({
	reason: z.string().min(3).max(500).optional(),
	/** Take the early release back. */
	revoke: z.boolean().optional(),
});
export const updateDepartureDetailsSchema = departureDetailsSchema;
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
	/** The stages the consultant recommends; empty means the full journey. */
	recStages: z.array(serviceStageSchema).max(3).default([]),
	/**
	 * For a visa or departure entry, what the consultation found: the plan
	 * stands as chosen, should be widened, or is not viable. `outcome` still
	 * carries Eligible / Not Eligible for everything that reads it.
	 */
	verdict: z.enum(["proceed", "widen", "not_viable"]).optional(),
	/** A visa entry's findings — facts the verdict can point at, not prose. */
	sponsorLicensed: z.boolean().optional(),
	fundsMeetRule: z.boolean().optional(),
	/** Completing with the entry evidence not yet verified in the vault; goes on the case. */
	overrideReason: z.string().max(500).optional(),
});
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;

/**
 * One study choice. Country, school, programme, field and intake picked
 * together. An applicant lists up to three in order of preference; the
 * scalar `preferredCountries` / `major` / `intake` fields below are the
 * first choice flattened, kept so older readers keep working.
 */
export const studyChoiceSchema = z.object({
	country: z.string().max(80).default(""),
	university: z.string().max(200).default(""),
	program: z.string().max(200).default(""),
	field: z.string().max(120).default(""),
	intake: z.string().max(40).default(""),
});
export type StudyChoice = z.infer<typeof studyChoiceSchema>;
export const MAX_STUDY_CHOICES = 3;

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
	studyChoices: z.array(studyChoiceSchema).max(MAX_STUDY_CHOICES).optional(),
	sponsorName: z.string().optional(),
	sponsorRelationship: z.string().optional(),
	referralSource: z.string().optional(),
	/** Where the client said they were at booking — shapes the intake and the consultation. */
	entryIntent: z.string().optional(),
	/** A visa or departure entry: the offer the client already holds. */
	offerUniversity: z.string().optional(),
	offerProgram: z.string().optional(),
	offerCountry: z.string().optional(),
	offerType: z.string().optional(),
	offerReference: z.string().optional(),
	offerIntake: z.string().optional(),
	offerTuition: z.string().optional(),
	offerDepositPaid: z.string().optional(),
	/** A departure entry: the visa the client already holds. */
	visaGrantReference: z.string().optional(),
	visaGrantDate: z.string().optional(),
	/** A visa entry: prior refusals and travel — the risk inputs the file is built around. */
	visaRefusedBefore: z.string().optional(),
	visaRefusalCountry: z.string().optional(),
	visaRefusalYear: z.string().optional(),
	visaRefusalReason: z.string().optional(),
	priorApplications: z.string().optional(),
	travelHistory: z.string().optional(),
	/** A departure entry: where the client lands and what they need there. */
	arrivalWindow: z.string().optional(),
	arrivalCity: z.string().optional(),
	arrivalAirport: z.string().optional(),
	needsAccommodation: z.string().optional(),
	needsPickup: z.string().optional(),
	dependants: z.string().optional(),
});
export type ApplicantProfile = z.infer<typeof applicantProfileSchema>;

export const checklistItemSchema = z.object({
	id: z.string(),
	label: z.string(),
	checked: z.boolean(),
});

/**
 * One pre-departure item on a case. Seeded from the template when Departure
 * opens; the client ticks their own items in the portal, the departure
 * officer ticks Century's in the case. An item asking for `evidence` is a
 * document type the client uploads to their vault; the officer verifies it.
 */
export const preDepartureOwnerSchema = z.enum(["client", "century"]);
export type PreDepartureOwner = z.infer<typeof preDepartureOwnerSchema>;
export const PRE_DEPARTURE_OWNER_LABELS: Record<PreDepartureOwner, string> = { client: "You", century: "Century NIT" };

export const preDepartureTaskSchema = z.object({
	id: z.string(),
	category: z.enum(["travel", "accommodation", "documents", "health", "finance", "orientation"]).optional(),
	label: z.string(),
	detail: z.string().optional(),
	owner: preDepartureOwnerSchema.default("client"),
	/** A document type the client uploads as proof, or nothing. */
	evidence: z.string().nullable().optional(),
	/** Required items gate completion; the rest are advice. */
	required: z.boolean().default(true),
	done: z.boolean(),
	doneBy: z.string().nullable().optional(),
	doneAt: z.string().datetime().nullable().optional(),
	/** Set by the officer when a required item is waived. The reason is the record. */
	waivedReason: z.string().nullable().optional(),
	/**
	 * For items asking for proof: where the client's upload of that document
	 * stands. The item is done when it is verified. The officer's decision,
	 * made on the Documents tab, not a tick.
	 */
	proofStatus: z.enum(["PENDING_UPLOAD", "UPLOADED", "VERIFIED", "REJECTED"]).nullable().optional(),
	proofDocumentId: z.string().uuid().nullable().optional(),
});
export type PreDepartureTask = z.infer<typeof preDepartureTaskSchema>;

/** One template item. What a case is seeded with. `id` is stable across cases (e.g. "pd-briefing", "uk-brp"). */
export const preDepartureTemplateItemSchema = z.object({
	id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "lower-case letters, digits and dashes"),
	category: z.enum(["travel", "accommodation", "documents", "health", "finance", "orientation"]).optional(),
	label: z.string().min(1).max(160),
	detail: z.string().max(500).optional(),
	owner: preDepartureOwnerSchema.default("client"),
	evidence: z.string().max(64).nullable().optional(),
	required: z.boolean().default(true),
});
export type PreDepartureTemplateItem = z.infer<typeof preDepartureTemplateItemSchema>;
export const preDepartureTemplateSchema = z.object({ items: z.array(preDepartureTemplateItemSchema).max(60) });

export const setPreDepartureTaskSchema = z.object({
	done: z.boolean(),
	waivedReason: z.string().max(500).nullable().optional(),
});

/** The checklist is done when every required item is ticked or waived; an empty list has nothing to do. */
export function preDepartureChecklistDone(tasks: readonly { required?: boolean; done: boolean; waivedReason?: string | null }[] | null | undefined): boolean {
	if (!tasks || tasks.length === 0) return true;
	return tasks.filter((t) => t.required !== false).every((t) => t.done || Boolean(t.waivedReason));
}

/**
 * Ops edits to an application. Payment state (`appFeePaid`, `depositPaid`,
 * `agencyStageIndex`, `agencySettled`, …) is deliberately absent: it is
 * derived from the invoice ledger by a database trigger and cannot be set
 * by hand. Record a payment against the invoice instead.
 */
export const patchApplicationSchema = z.object({
	visaCounselorNote: z.string().optional(),
	paymentPlanId: z.string().optional(),
	notes: z.string().optional(),
	/**
	 * Correction of the school allowance only. The package itself
	 * (`fundingTrack`/`packageId`) is deliberately absent. Changing it
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
	/**
	 * Which stage asks for it: `entry` (the evidence the client brought),
	 * `admissions`, `visa` or `departure`. The vault shows the union; a
	 * stage's invoice gate reads only its own. Optional so older readers parse.
	 */
	stage: z.enum(["entry", "admissions", "visa", "departure"]).optional(),
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
	/**
	 * Coverage chosen at placement. When true the assigned officer carries
	 * the application this consultation opens (it starts with them as
	 * `assignedStaffId` rather than parking on a handoff).
	 */
	handlerCarriesCase: z.boolean().optional(),
	/** The coordinator who manages this case (delegated by manager/owner). */
	coordinatorId: z.string().uuid().nullable(),
	coordinatorName: z.string().nullable(),
	coordinatorEmail: z.string().email().nullable(),
	/** Which scope put the coordinator on the case: an explicit handover, the applicant's journey, or the day's duty. */
	coordinatedVia: z.enum(["case", "applicant", "duty"]).nullable().optional(),
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
	/** Cancellation stamp. Set when the booking behind this case is cancelled. */
	cancelledAt: z.string().datetime().nullable().optional(),
	cancelledBy: z.string().nullable().optional(),
	cancellationReason: z.string().nullable().optional(),
	/** Whether the client holds a free-rebooking credit (set on the applicant). */
	freeRebooking: z.boolean().optional(),
	/** The cancelled consultation this one rebooks from, if any. */
	rebookedFromId: z.string().uuid().nullable().optional(),
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
	/** Stamped once when the handoff ages past the escalation threshold. */
	escalatedAt: z.string().datetime().nullable().optional(),
	createdAt: z.string().datetime(),
});
export type StageHandoffPreview = z.infer<typeof stageHandoffPreviewSchema>;

/* Stage consent */
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

/* Stage continuation — a completed client asks to take the next stage */

export const continuationStatusSchema = z.enum(["pending", "approved", "declined", "withdrawn"]);
export type ContinuationStatus = z.infer<typeof continuationStatusSchema>;

export const continuationRequestSchema = z.object({
	id: z.string().uuid(),
	applicationId: z.string().uuid(),
	/** The service stage requested — always the one beyond the plan's exit. */
	stage: serviceStageSchema,
	note: z.string().nullable(),
	status: continuationStatusSchema,
	decisionNote: z.string().nullable().optional(),
	decidedByName: z.string().nullable().optional(),
	decidedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
});
export type ContinuationRequest = z.infer<typeof continuationRequestSchema>;

export const requestContinuationSchema = z.object({
	note: z.string().max(1000).optional(),
});
export type RequestContinuation = z.infer<typeof requestContinuationSchema>;

export const decideContinuationSchema = z.object({
	decision: z.enum(["approved", "declined"]),
	note: z.string().max(1000).optional(),
});
export type DecideContinuation = z.infer<typeof decideContinuationSchema>;

/** Answers to a stage's intake pack — the assessment fields it would have asked an entrant. */
export const stageIntakeSubmissionSchema = z.object({
	stage: z.enum(["visa", "departure"]),
	answers: z.record(z.string(), z.string().max(2000)),
});
export type StageIntakeSubmission = z.infer<typeof stageIntakeSubmissionSchema>;

/* Travel Assistance (direct-invoice flow) */

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
	/** The applicant's login id. Documents and chat are keyed on it. */
	applicantUserId: z.string().nullable().optional(),
	assignedStaffId: z.string().uuid().nullable(),
	assignedStaffName: z.string().nullable(),
	assignedStaffEmail: z.string().email().nullable(),
	/** The applicant's journey coordinator. Stage-to-finish oversight carried from consultation. */
	journeyCoordinatorName: z.string().nullable().optional(),
	journeyCoordinatorEmail: z.string().email().nullable().optional(),
	stage: journeyStageSchema,
	status: applicationStatusSchema,
	proceedStatus: proceedStatusSchema,
	proceededAt: z.string().datetime().nullable(),
	declinedReason: z.string().nullable(),
	fundingTrack: z.string().nullable(),
	targetSchoolCount: z.number().int().nullable().optional(),
	/**
	 * The stages on the *accepted* plan — the one truth the ledger, the
	 * gates and the checklist read. Null until a plan is accepted (a legacy
	 * case with a package is the full journey).
	 */
	scopeStages: z.array(serviceStageSchema).nullable().optional(),
	/**
	 * Derived, never stored: the plan as it stands — the accepted scope, else
	 * the consultant's recommendation, else what the client said at booking,
	 * else the full journey. What a builder pre-fills from.
	 */
	plannedStages: z.array(serviceStageSchema).optional(),
	/** The admitted school the client accepted. Visa, deposit and departure hang off it. */
	acceptedSchoolId: z.string().uuid().nullable().optional(),
	offerAcceptedAt: z.string().datetime().nullable().optional(),
	notes: z.string().nullable(),
	checklist: z.array(checklistItemSchema),
	visaStage: visaStageSchema,
	visaOutcome: visaOutcomeSchema.nullable().optional(),
	visaInvoicePaid: z.boolean(),
	visaCounselorNote: z.string().nullable(),
	visaDetails: visaDetailsSchema.default({}),
	departureDetails: departureDetailsSchema.default({}),
	/** The visa-stage documents and where the client's upload of each stands. */
	visaDocumentChecklist: z.array(documentChecklistItemSchema).default([]),
	paymentPlanId: z.string().nullable(),
	/** The post-arrival schedule the client chose. Months and frequency; null until chosen. */
	postArrivalMonths: z.number().int().nullable().optional(),
	postArrivalFrequency: z.string().nullable().optional(),
	/** pending → finance/manager approves (or declines) → the dated plan goes live. */
	postArrivalStatus: z.enum(["pending", "approved", "declined"]).nullable().optional(),
	/** The contractual first instalment date, entered by finance/manager at approval. */
	postArrivalStartAt: z.string().datetime().nullable().optional(),
	postArrivalReviewedBy: z.string().nullable().optional(),
	postArrivalReviewedAt: z.string().datetime().nullable().optional(),
	postArrivalDeclineReason: z.string().nullable().optional(),
	/** The flat interest rate frozen into the approved schedule; null = none. */
	postArrivalInterestPct: z.number().nullable().optional(),
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
	preDepartureTasks: z.array(preDepartureTaskSchema),
	comments: z.array(caseCommentSchema),
	/** Open gated assignment (pending handoff) parked on this application, if any. */
	pendingHandoff: stageHandoffPreviewSchema.nullable(),
	/** Parent consultation, if this application was opened from an assessment. */
	consultationId: z.string().uuid().nullable(),
	consultationNumber: z.string().nullable().optional(),
	/** The actual schools the applicant selected, with their per-school statuses. */
	schoolApplications: z.array(schoolApplicationSchema).default([]),
	/** Stage consent status for each major stage. Null when no consent record exists. */
	applicationConsent: stageConsentSchema.nullable(),
	visaConsent: stageConsentSchema.nullable(),
	travelConsent: stageConsentSchema.nullable(),
	/** Where a mid-plan completion stopped — the reached service stage. Null for a full-plan finish. */
	completedAtStage: serviceStageSchema.nullable().optional(),
	/** The note recorded with a mid-plan completion. */
	completionNote: z.string().nullable().optional(),
	/**
	 * Answers a stage asked for when the client continued into it after
	 * completion — the intake a later entrant would have given at booking.
	 * Keyed by stage; a `submittedAt` key marks it done.
	 */
	stageIntake: z.record(z.string(), z.record(z.string(), z.string())).default({}),
	/** The client's pending "continue to the next stage" request, if any. */
	pendingContinuation: continuationRequestSchema.nullable().optional(),
	/** The latest continuation request of any status — a declined one carries the reason. */
	lastContinuation: continuationRequestSchema.nullable().optional(),
	/**
	 * Active per-stage specialists (visa, travel, finance). From
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
	 * The applicant's journey as the portal shows it. The same derivation
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
	/**
	 * Coverage. How far the handler carries the file. `stage` staffs the
	 * current stage only (the seat re-opens when the chapter closes);
	 * `all` makes them the case's handler end-to-end.
	 */
	scope: z.enum(["stage", "all"]).optional(),
	/** Referral. The office that owns the file, when it moves with this placement. */
	branch: z.string().min(1).max(64).optional(),
	/**
	 * Handover note — what the incoming handler needs to know. Required by the
	 * API when this placement replaces an active handler, so the seat change
	 * always carries context forward.
	 */
	reason: z.string().max(500).optional(),
});
/**
 * Refer a case or consultation to another handling branch without placing a
 * handler. The receiving desk's manager staffs it from their own queue.
 */
export const referCaseSchema = z.object({
	branch: z.string().min(1).max(64),
	note: z.string().max(500).optional(),
});
export type ReferCase = z.infer<typeof referCaseSchema>;

/**
 * Return a seat to the staffing queue. `seat` is `"owner"` (the whole-case
 * handler) or a journey stage (the specialist seat). Releasing ends the
 * assignment and opens a `manual_release` handoff so the case resurfaces in
 * the Workspace queue for re-staffing.
 */
export const releaseSeatSchema = z.object({
	/** Why the seat is going back — recorded on the handoff and history. */
	note: z.string().max(500).optional(),
});
export type ReleaseSeat = z.infer<typeof releaseSeatSchema>;

/**
 * One staffed (or formerly staffed) seat on a case. `seat` distinguishes the
 * whole-case owner and the journey coordinator from the per-stage specialist
 * seats. `endedAt`/`endReason`/`endedByName` are set on past seats only.
 */
export const caseSeatSchema = z.object({
	seat: z.enum(["owner", "coordinator", "stage"]),
	/** The stage a specialist seat covers; null on owner/coordinator. */
	stage: z.string().nullable(),
	opsUserId: z.string().uuid().nullable(),
	name: z.string().nullable(),
	email: z.string().email().nullable(),
	role: z.string().nullable(),
	presence: z.enum(["available", "busy", "on_leave", "offline"]).nullable(),
	lastSeenAt: z.string().datetime().nullable(),
	/** When the seat was taken (assignedAt on the assignment row). */
	since: z.string().datetime().nullable(),
	/** The handover note written at placement, if any. */
	note: z.string().nullable(),
	endedAt: z.string().datetime().nullable().optional(),
	endReason: z.string().nullable().optional(),
	endedByName: z.string().nullable().optional(),
});
export type CaseSeat = z.infer<typeof caseSeatSchema>;

/** The case's staffing picture — who holds each seat now and who held it before. */
export const caseTeamSchema = z.object({
	owner: caseSeatSchema.nullable(),
	coordinator: caseSeatSchema.nullable(),
	/** Active stage-specialist seats. */
	seats: z.array(caseSeatSchema),
	/** Ended seats (owner and stage history), most recent first. */
	pastSeats: z.array(caseSeatSchema),
	/** Upcoming stages with nobody seated — the queue ahead. */
	openStages: z.array(z.string()),
	pendingHandoff: stageHandoffPreviewSchema.nullable(),
});
export type CaseTeam = z.infer<typeof caseTeamSchema>;
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
/** What a caller sends. `visibility` may be left out and defaults to staff-only. */
export type AddCommentInput = z.input<typeof addCommentSchema>;
export const requestDocumentsSchema = z.object({
	documents: z.array(z.string().min(1).max(200)).min(1).max(20),
});
export const setStageSchema = z.object({
	stage: journeyStageSchema,
	/** Recorded with a mid-plan completion — why the case ended where it did. */
	note: z.string().max(1000).optional(),
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
	/** Facts recorded with the move. The biometrics date, the decision date, validity. */
	details: visaDetailsSchema.optional(),
});
export const updateVisaDetailsSchema = visaDetailsSchema;

/**
 * Applicant acceptance of the post-consultation "start your application?"
 * gate. Country + at least one school pair are required. The selection is
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
 * the current draft school selection + funding track. Never cached on the
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

/* Coordinator Delegation */

export const delegateConsultationSchema = z.object({
	coordinatorOpsUserId: z.string().uuid(),
	delegationNote: z.string().max(2000).optional(),
	/** "case" coordinates this consultation; "journey" also makes them the applicant's coordinator. Future cases inherit. */
	scope: z.enum(["case", "journey"]).optional(),
});
export type DelegateConsultation = z.infer<typeof delegateConsultationSchema>;

export const setCoordinatorDutySchema = z.object({
	branch: z.string().min(1),
	/** Null ends today's duty. In-flight cases keep their coordinator. */
	coordinatorOpsUserId: z.string().uuid().nullable(),
});
export type SetCoordinatorDuty = z.infer<typeof setCoordinatorDutySchema>;

export const reassignCoordinatorSchema = z.object({
	newCoordinatorOpsUserId: z.string().uuid(),
	reason: z.string().max(2000).optional(),
});
export type ReassignCoordinator = z.infer<typeof reassignCoordinatorSchema>;

/* Workload */

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

/* Activity Timeline */

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

/* Escalation Config */

export const escalationConfigSchema = z.object({
	hoursBeforeEscalation: z.number().int().min(1).max(72).default(4),
	maxCapacityPerCoordinator: z.number().int().min(1).max(50).default(10),
});
export type EscalationConfig = z.infer<typeof escalationConfigSchema>;

/** The flight on the ticket invoice. And, once booked, the flight that was booked. */
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
	/** Ops-facing display fields. Only populated by the ops list endpoint. */
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

/* Application activity */

/**
 * One event on an application's timeline. Assembled from the tables that
 * already record history (comments, ownership, stage assignments, handoffs,
 * consents, invoices and payments, school outcomes, travel requests). There
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
