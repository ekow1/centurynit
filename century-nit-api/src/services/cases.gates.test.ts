import { describe, expect, it } from "vitest";
import {
	JOURNEY_STAGE_FLOOR,
	PORTAL_STAGE_ORDER,
	canAdvanceToStage,
	isTravelResolved,
	preDepartureFeePaid,
	travelBlockReason,
	type JourneyStage,
} from "century-nit-shared";
import { canAdvanceTo } from "./cases.js";

/**
 * §Departure gate — one server-driven lifecycle: visa_processing →
 * travel_assistance (Departure) → completed. Departure opens once the visa
 * is approved. Inside it, the pre-departure service fee milestone (the 90%
 * balance on a full plan, the 50% second milestone on instalments) is due
 * before the ticket is invoiced; completion needs that milestone, settled
 * travel (booked, booking their own, or on hold) and a finished checklist.
 * The post-arrival remainder is aftercare and never gates. The travel
 * request's status is the one travel signal. Pure guards, pinned here
 * without a database.
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

	it("allows completion once travel is settled, however it settled", () => {
		expect(canAdvanceTo("completed", signals())).toBeNull();
		expect(canAdvanceTo("completed", signals({ travelAssistanceStatus: "declined" }))).toBeNull();
		expect(canAdvanceTo("completed", signals({ travelAssistanceStatus: "on_hold" }))).toBeNull();
	});

	it("blocks completed until travel is settled", () => {
		expect(canAdvanceTo("completed", signals({ travelAssistanceStatus: "invoiced" }))).toMatch(/not paid/);
		expect(canAdvanceTo("completed", signals({ travelAssistanceStatus: "ticket_paid" }))).toMatch(/not booked/);
		expect(canAdvanceTo("completed", signals({ travelAssistanceStatus: null }))).toMatch(/not decided/);
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

	it("opens Departure once the visa is approved", () => {
		expect(canAdvanceToStage("visa_processing", "travel_assistance", cleared)).toBeNull();
		expect(
			canAdvanceToStage("visa_processing", "travel_assistance", {
				...cleared,
				visaStage: "decision",
			}),
		).toMatch(/visa must be approved/);
	});

	it("only allows one step forward at a time", () => {
		expect(canAdvanceToStage("visa_processing", "completed", cleared)).toMatch(/one stage/);
		expect(canAdvanceToStage("travel_assistance", "visa_processing", cleared)).toMatch(/one stage/);
	});

	it("completes a full plan only when the service fee balance is paid", () => {
		expect(canAdvanceToStage("travel_assistance", "completed", cleared)).toBeNull();
		expect(
			canAdvanceToStage("travel_assistance", "completed", { ...cleared, agencySettled: false }),
		).toMatch(/balance is not paid/);
	});

	it("completes an instalment plan once the pre-departure instalment is paid", () => {
		const base = { ...cleared, paymentPlanId: "installment", agencySettled: false };
		expect(canAdvanceToStage("travel_assistance", "completed", { ...base, agencyStageIndex: 2 })).toBeNull();
		expect(canAdvanceToStage("travel_assistance", "completed", { ...base, agencyStageIndex: 1 })).toMatch(
			/pre-departure instalment/,
		);
	});

	it("needs a payment plan before it can complete", () => {
		expect(canAdvanceToStage("travel_assistance", "completed", { ...cleared, paymentPlanId: null })).toMatch(/no payment plan/);
	});

	it("completes only when travel is settled and the checklist holds", () => {
		const base = { ...cleared, agencyStageIndex: 2, paymentPlanId: "installment" };
		expect(
			canAdvanceToStage("travel_assistance", "completed", { ...base, travelAssistanceStatus: "ticket_paid" }),
		).toMatch(/not booked/);
		expect(
			canAdvanceToStage("travel_assistance", "completed", {
				...base,
				preDepartureTasks: [{ done: true }, { done: false }],
			}),
		).toMatch(/checklist/);
	});

	it("the fee milestone is what gates the ticket", () => {
		expect(preDepartureFeePaid({ paymentPlanId: "full", agencySettled: true })).toBe(true);
		expect(preDepartureFeePaid({ paymentPlanId: "full", agencySettled: false })).toBe(false);
		expect(preDepartureFeePaid({ paymentPlanId: "installment", agencyStageIndex: 2 })).toBe(true);
		expect(preDepartureFeePaid({ paymentPlanId: "installment", agencyStageIndex: 1 })).toBe(false);
		expect(preDepartureFeePaid({ paymentPlanId: null })).toBe(false);
	});
});

describe("JOURNEY_STAGE_FLOOR (server journey routing)", () => {
	it("maps the coarse stages onto portal steps", () => {
		expect(JOURNEY_STAGE_FLOOR.visa_processing).toBe("visa_invoice");
		expect(JOURNEY_STAGE_FLOOR.payment_execution).toBe("payment_execution");
		expect(JOURNEY_STAGE_FLOOR.travel_assistance).toBe("payment_execution");
		expect(JOURNEY_STAGE_FLOOR.completed).toBe("completed");
	});

	it("orders the portal stages chronologically — the fee milestone before the flight", () => {
		const order = PORTAL_STAGE_ORDER;
		for (const later of ["travel_assistance", "payment_execution", "completed"] as const) {
			expect(order.indexOf(later), later).toBeGreaterThan(order.indexOf("visa"));
		}
		expect(order.indexOf("travel_assistance")).toBeGreaterThan(
			order.indexOf("payment_execution"),
		);
	});

	it("every mapped value is a known portal stage", () => {
		for (const value of Object.values(JOURNEY_STAGE_FLOOR)) {
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
			expect(JOURNEY_STAGE_FLOOR[stage], stage).toBeTruthy();
		}
	});
});