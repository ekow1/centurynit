import { describe, expect, it } from "vitest";
import {
	JOURNEY_STAGE_TO_PORTAL,
	PORTAL_STAGE_ORDER,
	canAdvanceToStage,
	type JourneyStage,
} from "century-nit-shared";
import { canAdvanceTo } from "./cases.js";

/**
 * §Travel gate — the portal and ops commit to one server-driven lifecycle:
 * visa_processing → travel_assistance → payment_execution → completed.
 * Travel assistance opens once the visa is done; the plan chapter (Payment
 * Execution) opens once the ticketing fee is paid; completion is per-plan —
 * full needs the agency fee settled in full, installment only its first
 * installment — plus ticketing, clearance and a finished checklist. These are
 * pure guards, so they are pinned here without a database.
 */

function signals(over: Partial<Parameters<typeof canAdvanceTo>[1]> = {}) {
	return {
		hasPackage: true,
		hasSelection: true,
		hasAdmitted: true,
		hasAppInvoice: true,
		hasVisaInvoice: true,
		visaDone: true,
		travelClearance: "cleared",
		hasPaymentPlan: true,
		agencySettled: true,
		travelInvoicePaid: true,
		preDepartureDone: true,
		...over,
	};
}

describe("canAdvanceTo (server signal guard)", () => {
	it("allows travel when the visa is done", () => {
		expect(canAdvanceTo("travel_assistance", signals())).toBeNull();
	});

	it("blocks travel without visa completion", () => {
		expect(canAdvanceTo("travel_assistance", signals({ visaDone: false }))).toMatch(/visa/);
	});

	it("allows payment execution when the ticketing fee is paid", () => {
		expect(canAdvanceTo("payment_execution", signals())).toBeNull();
	});

	it("blocks payment execution without the travel invoice paid", () => {
		expect(canAdvanceTo("payment_execution", signals({ travelInvoicePaid: false }))).toMatch(
			/travel invoice|ticketing/,
		);
	});

	it("blocks completed without travel clearance", () => {
		expect(canAdvanceTo("completed", signals({ travelClearance: "pending" }))).toMatch(/clearance/);
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
		travelInvoicePaid: true,
		travelClearance: "cleared",
		paymentPlanId: "full",
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

	it("opens the plan chapter once the ticketing fee is paid", () => {
		expect(
			canAdvanceToStage("travel_assistance", "payment_execution", cleared),
		).toBeNull();
		expect(
			canAdvanceToStage("travel_assistance", "payment_execution", {
				...cleared,
				travelInvoicePaid: false,
			}),
		).toMatch(/travel invoice|ticketing/);
	});

	it("only allows one step forward at a time", () => {
		expect(canAdvanceToStage("visa_processing", "payment_execution", cleared)).toMatch(
			/one stage/,
		);
		expect(canAdvanceToStage("travel_assistance", "visa_processing", cleared)).toMatch(
			/one stage/,
		);
	});

	it("completes a full plan only when the agency fee is settled in full", () => {
		expect(canAdvanceToStage("payment_execution", "completed", cleared)).toBeNull();
		expect(
			canAdvanceToStage("payment_execution", "completed", {
				...cleared,
				agencySettled: false,
			}),
		).toMatch(/agency settlement is not complete/);
	});

	it("completes an installment plan once the first installment is paid", () => {
		const base = { ...cleared, paymentPlanId: "installment" };
		expect(
			canAdvanceToStage("payment_execution", "completed", { ...base, agencyStageIndex: 1 }),
		).toBeNull();
		expect(
			canAdvanceToStage("payment_execution", "completed", { ...base, agencyStageIndex: 1, agencySettled: false }),
		).toBeNull();
		expect(
			canAdvanceToStage("payment_execution", "completed", { ...base, agencyStageIndex: 0 }),
		).toMatch(/first installment/);
	});

	it("completes only when the ticketing fee, clearance and checklist all hold", () => {
		const base = { ...cleared, agencyStageIndex: 1, paymentPlanId: "installment" };
		expect(
			canAdvanceToStage("payment_execution", "completed", { ...base, travelInvoicePaid: false }),
		).toMatch(/travel invoices/);
		expect(
			canAdvanceToStage("payment_execution", "completed", { ...base, travelClearance: "pending" }),
		).toMatch(/clearance/);
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