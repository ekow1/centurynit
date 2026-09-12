import {
	JOURNEY_STAGES,
	PORTAL_STAGE_ORDER,
	isTravelResolved,
	preDepartureFeePaid,
	type JourneyStage,
	type TravelAssistanceStatus,
} from "./schemas/cases.js";
import { PORTAL_STAGE_LABELS } from "./labels.js";

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
	/** The authority refused the visa; the case waits at the decision step for a reapplication. */
	visaRefused?: boolean;
	/** Latest travel assistance request status, if any. */
	travelAssistanceStatus: TravelAssistanceStatus | string | null;
	/** Chosen payment plan id (`"full"` / `"installment"`), if any. */
	paymentPlanId: string | null;
	/** Number of agency milestones paid. */
	agencyStageIndex: number;
	agencySettled: boolean;
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
	// Departure opens on the fee milestone; the flight follows it.
	travel_assistance: "payment_execution",
	payment_execution: "payment_execution",
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
	"payment_execution",
	"travel_assistance",
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
	payment_execution: (f) => f.planSettled,
	travel_assistance: (f) => f.taResolved,
	completed: (f) => f.isCompleted,
};

function facts(s: JourneySignals): Facts {
	// Travel is done when the flight is booked, or the applicant is booking
	// their own, or has paused it — the request's status is the one signal.
	const taResolved = isTravelResolved(s.travelAssistanceStatus);
	// The pre-departure milestone: the balance on a full plan, the second
	// milestone on instalments. Post-arrival is aftercare and never gates.
	const planSettled = preDepartureFeePaid(s);
	const isCompleted = taResolved && planSettled && s.preDepartureDone;
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
		// Every step done but not complete (the checklist, say): stand on the last step.
		portalStage = highestDone + 1 < LADDER.length ? LADDER[highestDone + 1] : LADDER[LADDER.length - 1];

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
		// Both Departure pages open with the visa; the fee milestone gates the
		// ticket, not the page.
		payment_execution: f.hasAdmitted && f.visaInvoicePaid && f.visaDone,
		travel_assistance: f.hasAdmitted && f.visaInvoicePaid && f.visaDone,
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

	// A refusal does not move the ladder — the visa chapter stays current —
	// but the applicant must not read "Visa tracking" as if nothing happened.
	const refused = portalStage === "visa" && Boolean(f.visaRefused);

	return {
		currentStage: f.coarseStage ?? portalStage,
		portalStage,
		chapterUnlocks,
		stageStatuses,
		label: refused ? "Visa refused" : PORTAL_STAGE_LABELS[portalStage],
		nextUnlock: refused ? "Your consultant will advise on reapplying" : nextUnlock,
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

/* ── Who may own which stage ─────────────────────────────────────────────── */

/**
 * Roles allowed to be assigned as the handler of each stage. There are no
 * dedicated visa/travel roles yet, so the service stages are open to the
 * consultant tier; the plan chapter belongs to finance. Roles absent from a
 * list (customer_service, admin, super_admin) never own casework — they
 * triage, invite and configure.
 */
export const STAGE_ASSIGNABLE_ROLES: Record<JourneyStage | "consultation", readonly string[]> = {
	consultation: ["consultant", "coordinator", "manager"],
	document_verification: ["consultant", "coordinator", "manager"],
	school_submission: ["consultant", "coordinator", "manager"],
	offer_letter_review: ["consultant", "coordinator", "manager"],
	visa_processing: ["consultant", "coordinator", "manager"],
	travel_assistance: ["consultant", "coordinator", "manager"],
	payment_execution: ["finance", "coordinator", "manager"],
	completed: [],
};

export function canOwnStage(role: string | null | undefined, stage: string): boolean {
	const allowed = STAGE_ASSIGNABLE_ROLES[stage as keyof typeof STAGE_ASSIGNABLE_ROLES];
	return Boolean(role && allowed?.includes(role));
}

/**
 * Which class of specialist owns each journey stage. A handoff crossing from
 * one class to another (consultant → visa officer) must never carry the
 * previous handler over by default.
 */
export const STAGE_OWNER_CLASS: Record<JourneyStage, string> = {
	document_verification: "consultant",
	school_submission: "consultant",
	offer_letter_review: "consultant",
	visa_processing: "visa_officer",
	payment_execution: "finance_officer",
	travel_assistance: "travel_officer",
	completed: "none",
};

export function isOwnerClassBoundary(from: JourneyStage, to: JourneyStage): boolean {
	return STAGE_OWNER_CLASS[from] !== STAGE_OWNER_CLASS[to];
}
