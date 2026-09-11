import {
	JOURNEY_STAGES,
	PORTAL_STAGE_LABELS,
	PORTAL_STAGE_ORDER,
	type JourneyStage,
	type TravelAssistanceStatus,
} from "./schemas/cases.js";

/**
 * The applicant journey, derived from facts.
 *
 * `/me/journey` collects the facts (`JourneySignals`) and this module turns
 * them into the fine-grained portal stage, chapter unlocks and per-stage
 * statuses. It is a pure function so the same rules can be unit-tested with a
 * table of scenarios and reused wherever the journey is rendered.
 *
 * The rule is one ladder, read bottom-up:
 *
 *   1. Each portal stage has one signal that marks it *done*
 *      (`STAGE_DONE`). The applicant stands on the step after the highest
 *      step that is done — later evidence (an admission, a paid visa) counts
 *      even when an earlier step was never formally ticked, because the case
 *      really has moved on. Earlier steps that were passed without their
 *      signal are reported as "skipped", never "done".
 *   2. The coarse `applications.stage` stored by ops is a *floor*: it can
 *      push the applicant forward to the first portal step of that stage,
 *      never back. A stale coarse stage therefore cannot regress someone
 *      past what they have actually completed.
 *   3. The journey is complete only when `isCompleted` holds.
 */

export type JourneyPortalStage =
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

export type JourneyStageStatus = "done" | "current" | "locked" | "skipped";

/** Facts about one applicant's current case, all scoped to that case. */
export type JourneySignals = {
	/** A consultation row exists (booked, held, or completed). */
	hasConsultation: boolean;
	/** Assessment outcome is Eligible or Conditionally Eligible. */
	isEligible: boolean;
	/** `applications.proceedStatus` — the consent gate. */
	proceedStatus: string | null;
	/** A package (funding track) has been chosen. */
	hasPackage: boolean;
	/** The 10% agency deposit is paid. */
	depositPaid: boolean;
	/** Someone owns the school_submission stage. */
	hasHandler: boolean;
	/** School selection has been locked (an application invoice exists, or a track has moved on). */
	hasSelection: boolean;
	/** Application invoice is issued / partially paid / paid (i.e. no longer a proforma). */
	appInvoiceIssued: boolean;
	appInvoicePaid: boolean;
	/** At least one school track has an "Admitted" outcome. */
	hasAdmitted: boolean;
	/** The applicant consented to start the visa stage. */
	hasVisaConsent: boolean;
	visaInvoicePaid: boolean;
	/** `applications.visaStage === "complete"`. */
	visaDone: boolean;
	travelInvoicePaid: boolean;
	/** Latest travel assistance request status, if any. */
	travelAssistanceStatus: TravelAssistanceStatus | string | null;
	/** Chosen payment plan id (`"full"` / `"installment"`), if any. */
	paymentPlanId: string | null;
	/** Number of agency milestones paid. */
	agencyStageIndex: number;
	agencySettled: boolean;
	/** `applications.travelClearance === "cleared"`. */
	travelCleared: boolean;
	/** The pre-departure checklist exists and every item is ticked. */
	preDepartureDone: boolean;
	/** `applications.stage`, when an application exists. */
	coarseStage: JourneyStage | null;
};

export type JourneyChapterUnlocks = {
	journey: boolean;
	consultation: boolean;
	package: boolean;
	application: boolean;
	tracking: boolean;
	visa: boolean;
	payment_execution: boolean;
	travel_assistance: boolean;
	complete: boolean;
};

export type DerivedJourney = {
	/** Coarse stage when known, else the portal stage — what ops calls it. */
	currentStage: string;
	portalStage: JourneyPortalStage;
	chapterUnlocks: JourneyChapterUnlocks;
	stageStatuses: Record<string, JourneyStageStatus>;
	label: string;
	nextUnlock: string | null;
};

/**
 * First portal step of each coarse stage. The coarse stage never pushes the
 * applicant past this step; the signals do the rest.
 *
 * `payment_execution` floors at `travel_assistance` on purpose: the plan
 * chapter opens only once the travel-assistance request is resolved, and that
 * is a signal (`travelAssistanceStatus`), not something the coarse stage can
 * assert on its own.
 */
export const JOURNEY_STAGE_FLOOR: Record<JourneyStage, JourneyPortalStage> = {
	document_verification: "proceed",
	school_submission: "awaiting_handler",
	offer_letter_review: "school_tracking",
	visa_processing: "visa_invoice",
	travel_assistance: "travel_assistance",
	payment_execution: "travel_assistance",
	completed: "completed",
};

/** The ladder, excluding the terminal step. */
const LADDER: JourneyPortalStage[] = [
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
];

type Facts = JourneySignals & {
	hasProceeded: boolean;
	taResolved: boolean;
	planSettled: boolean;
	isCompleted: boolean;
};

/** What "done" means for each step. */
const STAGE_DONE: Record<JourneyPortalStage, (f: Facts) => boolean> = {
	new: () => true,
	consultation: (f) => f.hasConsultation,
	eligibility: (f) => f.isEligible,
	proceed: (f) => f.hasProceeded,
	// Choosing a package is not enough — the step ends with the deposit.
	school_package: (f) => f.hasPackage && f.depositPaid,
	// A handler counts only once the deposit that requested one is paid.
	awaiting_handler: (f) => f.depositPaid && f.hasHandler,
	school_select: (f) => f.hasSelection,
	awaiting_invoice: (f) => f.appInvoiceIssued,
	application_invoice: (f) => f.appInvoicePaid,
	school_tracking: (f) => f.hasAdmitted && f.hasVisaConsent,
	visa_invoice: (f) => f.visaInvoicePaid,
	visa: (f) => f.visaDone,
	travel_assistance: (f) => f.taResolved,
	payment_execution: (f) => f.planSettled && f.taResolved,
	completed: (f) => f.isCompleted,
};

function facts(s: JourneySignals): Facts {
	const ta = s.travelAssistanceStatus;
	const taResolved = ta === "cleared" || ta === "declined" || ta === "on_hold";
	// Per-plan settlement: a full plan needs the agency fee settled in full,
	// an installment plan only its first installment (the deposit).
	const planSettled =
		Boolean(s.paymentPlanId) &&
		(s.paymentPlanId === "installment" ? s.agencyStageIndex >= 1 : s.agencySettled);
	const isCompleted = s.travelCleared && planSettled && s.travelInvoicePaid && s.preDepartureDone;
	return {
		...s,
		hasProceeded: s.proceedStatus === "accepted",
		taResolved,
		planSettled,
		isCompleted,
	};
}

export function deriveJourney(signals: JourneySignals): DerivedJourney {
	const f = facts(signals);
	const idx = (stage: string) => PORTAL_STAGE_ORDER.indexOf(stage);

	let portalStage: JourneyPortalStage;
	if (f.isCompleted) {
		portalStage = "completed";
	} else {
		// The step after the highest step that is done.
		let highestDone = -1;
		LADDER.forEach((stage, i) => {
			if (STAGE_DONE[stage](f)) highestDone = i;
		});
		portalStage = highestDone + 1 < LADDER.length ? LADDER[highestDone + 1] : "payment_execution";

		// The coarse stage may only push forward.
		const coarse =
			f.coarseStage && (JOURNEY_STAGES as string[]).includes(f.coarseStage)
				? JOURNEY_STAGE_FLOOR[f.coarseStage]
				: null;
		if (coarse && coarse !== "completed" && idx(coarse) > idx(portalStage)) {
			portalStage = coarse;
		}
	}

	const chapterUnlocks: JourneyChapterUnlocks = {
		journey: true,
		consultation: true,
		package: f.isEligible,
		// Stays open once a package is chosen — waiting for a handler is part
		// of this chapter, not a locked future one.
		application: f.isEligible && f.hasPackage,
		tracking: f.appInvoicePaid && f.hasSelection,
		visa: f.hasAdmitted,
		travel_assistance: f.hasAdmitted && f.visaInvoicePaid && f.visaDone,
		// Opens once the travel-assistance request is resolved, or — for a case
		// that never raised one — once the ticket is paid.
		payment_execution:
			f.hasAdmitted &&
			f.visaInvoicePaid &&
			f.visaDone &&
			(f.taResolved || (f.travelInvoicePaid && !f.travelAssistanceStatus)),
		complete: f.isCompleted,
	};

	// Per-step status from real signals — a step passed without its signal is
	// "skipped", so "done" never lies.
	const currentIdx = idx(portalStage);
	const stageStatuses: Record<string, JourneyStageStatus> = {};
	for (const stage of PORTAL_STAGE_ORDER) {
		if (stage === portalStage) stageStatuses[stage] = "current";
		else if (STAGE_DONE[stage as JourneyPortalStage]?.(f)) stageStatuses[stage] = "done";
		else if (idx(stage) < currentIdx) stageStatuses[stage] = "skipped";
		else stageStatuses[stage] = "locked";
	}

	const nextUnlock =
		currentIdx >= 0 && currentIdx < PORTAL_STAGE_ORDER.length - 1
			? PORTAL_STAGE_LABELS[PORTAL_STAGE_ORDER[currentIdx + 1]]
			: null;

	return {
		currentStage: f.coarseStage ?? portalStage,
		portalStage,
		chapterUnlocks,
		stageStatuses,
		label: PORTAL_STAGE_LABELS[portalStage],
		nextUnlock,
	};
}

/** The journey of a signed-in user with no case at all. */
export function emptyJourney(): DerivedJourney {
	const stageStatuses: Record<string, JourneyStageStatus> = {};
	for (const stage of PORTAL_STAGE_ORDER) {
		stageStatuses[stage] = stage === "consultation" ? "current" : "locked";
	}
	return {
		currentStage: "consultation",
		portalStage: "consultation",
		chapterUnlocks: {
			journey: true,
			consultation: true,
			package: false,
			application: false,
			tracking: false,
			visa: false,
			payment_execution: false,
			travel_assistance: false,
			complete: false,
		},
		stageStatuses,
		label: PORTAL_STAGE_LABELS.consultation,
		nextUnlock: null,
	};
}
