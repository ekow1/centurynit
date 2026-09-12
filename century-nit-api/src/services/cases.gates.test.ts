import { describe, expect, it } from "vitest";
import {
	JOURNEY_STAGE_TO_PORTAL,
	PORTAL_STAGE_ORDER,
	canAdvanceToStage,
	isTravelResolved,
	travelBlockReason,
	type JourneyStage,
} from "century-nit-shared";
import { canAdvanceTo } from "./cases.js";

/**
 * §Travel gate — the portal and ops commit to one server-driven lifecycle:
 * visa_processing → travel_assistance → payment_execution → completed.
 * Travel assistance opens once the visa is done; the plan chapter (Payment
 * Execution) opens once travel is settled — the flight is booked, or the
 * applicant is booking their own, or has put it on hold; completion is
 * per-plan — full needs the agency fee settled in full, installment only its
 * first installment — plus settled travel and a finished checklist. The
 * travel request's status is the one travel signal. These are pure guards,
 * so they are pinned here without a database.
 */

function signals(over: Partial<Parameters<typeof canAdvanceTo>[1]> = {}) {
	return {
		hasPackage: true,
		hasSelection: true,
		hasAdmitted: true,
		hasAppInvoice: true,
		hasVisaInvoice: true,
		visaDone: true,
		hasPaymentPlan: true,
		agencySettled: true,
		preDepartureDone: true,
		travelAssistanceStatus: "booked" as const,
		...over,
	};
}

describe("travel signal", () => {
	it("is resolved when booked, booking their own, or on hold", () => {
		expect(isTravelResolved("booked")).toBe(true);
		expect(isTravelResolved("declined")).toBe(true);
		expect(isTravelResolved("on_hold")).toBe(true);
		for (const s of ["review", "invoiced", "ticket_paid", "decision_pending", null, undefined]) {
			expect(isTravelResolved(s)).toBe(false);
		}
	});

	it("says what is still owed", () => {
		expect(travelBlockReason("review", "X")).toMatch(/invoice has not been raised/);
		expect(travelBlockReason("invoiced", "X")).toMatch(/not paid/);
		expect(travelBlockReason("ticket_paid", "X")).toMatch(/not booked/);
		expect(travelBlockReason(null, "X")).toMatch(/not decided/);
		expect(travelBlockReason("booked", "X")).toBeNull();
	});
});

describe("canAdvanceTo (server signal guard)", () => {
	it("allows travel when the visa is done", () => {
		expect(canAdvanceTo("travel_assistance", signals())).toBeNull();
	});

	it("blocks travel without visa completion", () => {
		expect(canAdvanceTo("travel_assistance", signals({ visaDone: false }))).toMatch(/visa/);
	});

	it("allows payment execution once travel is settled", () => {
		expect(canAdvanceTo("payment_execution", signals())).toBeNull();
		expect(canAdvanceTo("payment_execution", signals({ travelAssistanceStatus: "declined" }))).toBeNull();
		expect(canAdvanceTo("payment_execution", signals({ travelAssistanceStatus: "on_hold" }))).toBeNull();
	});

	it("blocks payment execution while the ticket is unpaid or unbooked", () => {
		expect(canAdvanceTo("payment_execution", signals({ travelAssistanceStatus: "invoiced" }))).toMatch(/not paid/);
		expect(canAdvanceTo("payment_execution", signals({ travelAssistanceStatus: "ticket_paid" }))).toMatch(/not booked/);
		expect(canAdvanceTo("payment_execution", signals({ travelAssistanceStatus: null }))).toMatch(/not decided/);
	});

	it("blocks completed until travel is settled", () => {
		expect(canAdvanceTo("completed", signals({ travelAssistanceStatus: "ticket_paid" }))).toMatch(/not booked/);
	});

	it("blocks completed until the pre-departure checklist is finished", () => {
		expect(canAdvanceTo("completed", signals({ preDepartureDone: false }))).toMatch(/checklist/);
	});
});

describe("canAdvanceToStage (shared adjacency + sub-step guard)", () => {
	const cleared = {
		visaStage: "complete",
		agencyStageIndex: 3,
		appFeePaid: true,
		agencySettled: true,
		paymentPlanId: "full",
		travelAssistanceStatus: "booked",
	};

	it("opens travel once the visa is complete", () => {
		expect(canAdvanceToStage("visa_processing", "travel_assistance", cleared)).toBeNull();
		expect(
			canAdvanceToStage("visa_processing", "travel_assistance", {
				...cleared,
				visaStage: "decision",
			}),
		).toMatch(/visa processing must be complete/);
	});

	it("opens the plan chapter once travel is settled", () => {
		expect(canAdvanceToStage("travel_assistance", "payment_execution", cleared)).toBeNull();
		expect(
			canAdvanceToStage("travel_assistance", "payment_execution", { ...cleared, travelAssistanceStatus: "declined" }),
		).toBeNull();
		expect(
			canAdvanceToStage("travel_assistance", "payment_execution", { ...cleared, travelAssistanceStatus: "invoiced" }),
		).toMatch(/not paid/);
		expect(
			canAdvanceToStage("travel_assistance", "payment_execution", { ...cleared, travelAssistanceStatus: "review" }),
		).toMatch(/not been raised/);
	});

	it("only allows one step forward at a time", () => {
		expect(canAdvanceToStage("visa_processing", "payment_execution", cleared)).toMatch(/one stage/);
		expect(canAdvanceToStage("travel_assistance", "visa_processing", cleared)).toMatch(/one stage/);
	});

	it("completes a full plan only when the agency fee is settled in full", () => {
		expect(canAdvanceToStage("payment_execution", "completed", cleared)).toBeNull();
		expect(
			canAdvanceToStage("payment_execution", "completed", { ...cleared, agencySettled: false }),
		).toMatch(/agency settlement is not complete/);
	});

	it("completes an installment plan once the first installment is paid", () => {
		const base = { ...cleared, paymentPlanId: "installment" };
		expect(canAdvanceToStage("payment_execution", "completed", { ...base, agencyStageIndex: 1 })).toBeNull();
		expect(
			canAdvanceToStage("payment_execution", "completed", { ...base, agencyStageIndex: 1, agencySettled: false }),
		).toBeNull();
		expect(canAdvanceToStage("payment_execution", "completed", { ...base, agencyStageIndex: 0 })).toMatch(
			/first installment/,
		);
	});

	it("completes only when travel is settled and the checklist holds", () => {
		const base = { ...cleared, agencyStageIndex: 1, paymentPlanId: "installment" };
		expect(
			canAdvanceToStage("payment_execution", "completed", { ...base, travelAssistanceStatus: "ticket_paid" }),
		).toMatch(/not booked/);
		expect(
			canAdvanceToStage("payment_execution", "completed", {
				...base,
				preDepartureTasks: [{ done: true }, { done: false }],
			}),
		).toMatch(/checklist/);
	});
});

describe("JOURNEY_STAGE_TO_PORTAL (server journey routing)", () => {
	it("maps the coarse stages onto distinct portal steps", () => {
		expect(JOURNEY_STAGE_TO_PORTAL.visa_processing).toBe("visa");
		expect(JOURNEY_STAGE_TO_PORTAL.payment_execution).toBe("payment_execution");
		expect(JOURNEY_STAGE_TO_PORTAL.travel_assistance).toBe("travel_assistance");
		expect(JOURNEY_STAGE_TO_PORTAL.completed).toBe("completed");
	});

	it("orders the portal stages chronologically", () => {
		const order = PORTAL_STAGE_ORDER;
		for (const later of ["travel_assistance", "payment_execution", "completed"] as const) {
			expect(order.indexOf(later), later).toBeGreaterThan(order.indexOf("visa"));
		}
		expect(order.indexOf("payment_execution")).toBeGreaterThan(
			order.indexOf("travel_assistance"),
		);
	});

	it("every mapped value is a known portal stage", () => {
		for (const value of Object.values(JOURNEY_STAGE_TO_PORTAL)) {
			expect(PORTAL_STAGE_ORDER, value).toContain(value);
		}
	});

	it("covers every journey stage", () => {
		const stages: JourneyStage[] = [
			"document_verification",
			"school_submission",
			"offer_letter_review",
			"visa_processing",
			"travel_assistance",
			"payment_execution",
			"completed",
		];
		for (const stage of stages) {
			expect(JOURNEY_STAGE_TO_PORTAL[stage], stage).toBeTruthy();
		}
	});
});