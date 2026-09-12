import { describe, expect, it } from "vitest";
import { deriveJourney, emptyJourney, type JourneySignals } from "century-nit-shared";

/**
 * Table-driven scenarios for the journey ladder. Each scenario is a partial
 * set of facts layered on a blank case; the expectation is the portal stage
 * the applicant should be standing on.
 */

const blank: JourneySignals = {
	hasConsultation: false,
	isEligible: false,
	proceedStatus: null,
	hasPackage: false,
	depositPaid: false,
	hasHandler: false,
	hasSelection: false,
	appInvoiceIssued: false,
	appInvoicePaid: false,
	hasAdmitted: false,
	hasVisaConsent: false,
	visaInvoicePaid: false,
	visaDone: false,
	travelAssistanceStatus: null,
	paymentPlanId: null,
	agencyStageIndex: 0,
	agencySettled: false,
	preDepartureDone: false,
	coarseStage: null,
};

/** Facts accumulated up to and including a given milestone. */
const milestones = {
	consulted: { hasConsultation: true },
	eligible: { hasConsultation: true, isEligible: true, coarseStage: "document_verification" as const },
	proceeded: { proceedStatus: "accepted" },
	packaged: { hasPackage: true },
	deposited: { depositPaid: true },
	handled: { hasHandler: true, coarseStage: "school_submission" as const },
	selected: { hasSelection: true },
	issued: { appInvoiceIssued: true },
	appPaid: { appInvoicePaid: true },
	admitted: { hasAdmitted: true, coarseStage: "offer_letter_review" as const },
	visaConsented: { hasVisaConsent: true, coarseStage: "visa_processing" as const },
	visaPaid: { visaInvoicePaid: true },
	visaDone: { visaDone: true, coarseStage: "travel_assistance" as const },
	// The plan was chosen at enrolment; the pre-departure instalment is the
	// second milestone (the deposit was the first) and comes before the flight.
	feePaid: { paymentPlanId: "installment", agencyStageIndex: 2 },
	booked: { travelAssistanceStatus: "booked" },
	cleared: { preDepartureDone: true },
} satisfies Record<string, Partial<JourneySignals>>;

const order = Object.keys(milestones) as (keyof typeof milestones)[];

/** All facts up to and including `upTo`. */
function upTo(name: keyof typeof milestones): JourneySignals {
	const s = { ...blank };
	for (const m of order) {
		Object.assign(s, milestones[m]);
		if (m === name) break;
	}
	return s;
}

describe("deriveJourney — the happy path, one milestone at a time", () => {
	const expected: [keyof typeof milestones, string][] = [
		["consulted", "eligibility"],
		["eligible", "proceed"],
		["proceeded", "school_package"],
		["packaged", "school_package"],
		["deposited", "awaiting_handler"],
		["handled", "school_select"],
		["selected", "awaiting_invoice"],
		["issued", "application_invoice"],
		["appPaid", "school_tracking"],
		["admitted", "school_tracking"],
		["visaConsented", "visa_invoice"],
		["visaPaid", "visa"],
		["visaDone", "payment_execution"],
		["feePaid", "travel_assistance"],
		["booked", "travel_assistance"],
		["cleared", "completed"],
	];

	for (const [milestone, stage] of expected) {
		it(`after "${milestone}" the applicant is on ${stage}`, () => {
			expect(deriveJourney(upTo(milestone)).portalStage).toBe(stage);
		});
	}

	it("marks every earlier step done and later steps locked, with no skips", () => {
		const j = deriveJourney(upTo("appPaid"));
		expect(j.stageStatuses.school_tracking).toBe("current");
		expect(j.stageStatuses.application_invoice).toBe("done");
		expect(j.stageStatuses.proceed).toBe("done");
		expect(j.stageStatuses.visa_invoice).toBe("locked");
		expect(Object.values(j.stageStatuses)).not.toContain("skipped");
	});
});

describe("deriveJourney — gates", () => {
	it("holds the consent gate even when a package was pre-filled from the recommendation", () => {
		const j = deriveJourney({ ...upTo("eligible"), hasPackage: true });
		expect(j.portalStage).toBe("proceed");
	});

	it("does not treat a handler assigned before the deposit as the handler step being done", () => {
		const j = deriveJourney({ ...upTo("packaged"), hasHandler: true });
		expect(j.portalStage).toBe("school_package");
		expect(j.stageStatuses.awaiting_handler).toBe("locked");
	});

	it("waits for the handler after the deposit even if the coarse stage already says school_submission", () => {
		const j = deriveJourney({ ...upTo("deposited"), coarseStage: "school_submission" });
		expect(j.portalStage).toBe("awaiting_handler");
	});

	it("stays on tracking until the applicant consents to the visa stage", () => {
		const j = deriveJourney(upTo("admitted"));
		expect(j.portalStage).toBe("school_tracking");
		expect(j.chapterUnlocks.visa).toBe(true);
	});

	it("says so when the visa was refused, without moving the ladder", () => {
		const j = deriveJourney({ ...upTo("visaPaid"), visaRefused: true });
		expect(j.portalStage).toBe("visa");
		expect(j.label).toBe("Visa refused");
		expect(j.nextUnlock).toMatch(/reapply/i);
		expect(j.chapterUnlocks.travel_assistance).toBe(false);
		// Reopened for reapplication: the refusal is cleared and the copy reverts.
		const reopened = deriveJourney({ ...upTo("visaPaid"), visaRefused: false });
		expect(reopened.label).not.toBe("Visa refused");
	});

	it("opens both Departure pages with the visa; the fee milestone is a step, not a lock", () => {
		const j = deriveJourney(upTo("visaDone"));
		expect(j.portalStage).toBe("payment_execution");
		expect(j.chapterUnlocks.payment_execution).toBe(true);
		expect(j.chapterUnlocks.travel_assistance).toBe(true);
	});

	it("does not complete on the deposit alone: the pre-departure milestone is what counts", () => {
		const j = deriveJourney({ ...upTo("cleared"), agencyStageIndex: 1 });
		expect(j.portalStage).not.toBe("completed");
		expect(j.stageStatuses.payment_execution).not.toBe("done");
	});

	it("completes a full plan once the balance is settled", () => {
		const j = deriveJourney({ ...upTo("cleared"), paymentPlanId: "full", agencyStageIndex: 0, agencySettled: true });
		expect(j.portalStage).toBe("completed");
	});

	it("does not report completion from the coarse stage alone", () => {
		const j = deriveJourney({ ...upTo("booked"), coarseStage: "completed" });
		expect(j.portalStage).not.toBe("completed");
		expect(j.chapterUnlocks.complete).toBe(false);
	});
});

describe("deriveJourney — the coarse stage is a floor, signals are the truth", () => {
	it("pushes forward to the first step of a coarse stage that signals have not reached", () => {
		const j = deriveJourney({ ...upTo("proceeded"), coarseStage: "offer_letter_review" });
		expect(j.portalStage).toBe("school_tracking");
		expect(j.stageStatuses.awaiting_handler).toBe("skipped");
		expect(j.stageStatuses.application_invoice).toBe("skipped");
	});

	it("never regresses below what the signals prove", () => {
		const j = deriveJourney({ ...upTo("visaPaid"), coarseStage: "document_verification" });
		expect(j.portalStage).toBe("visa");
	});

	it("lets later evidence count without an earlier tick, and calls the earlier step skipped", () => {
		const j = deriveJourney({ ...upTo("visaDone"), appInvoicePaid: false });
		expect(j.portalStage).toBe("payment_execution");
		expect(j.stageStatuses.application_invoice).toBe("skipped");
		expect(j.stageStatuses.visa).toBe("done");
	});

	it("reports the coarse stage as currentStage when known", () => {
		expect(deriveJourney(upTo("handled")).currentStage).toBe("school_submission");
		expect(deriveJourney(upTo("consulted")).currentStage).toBe("eligibility");
	});
});

describe("emptyJourney", () => {
	it("starts a brand-new user at consultation with nothing unlocked", () => {
		const j = emptyJourney();
		expect(j.portalStage).toBe("consultation");
		expect(j.stageStatuses.consultation).toBe("current");
		expect(j.chapterUnlocks.package).toBe(false);
	});
});
