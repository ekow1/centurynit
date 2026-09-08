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
 * visa_processing → payment_execution → travel_assistance → completed.
 * Travel assistance must not open until the payment plan is confirmed AND
 * the agency fee + travel invoice are settled; completion needs travel
 * clearance AND a finished checklist. These are pure guards, so they are
 * pinned here without a database.
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
	it("allows travel when visa done + plan + agency + travel invoice all hold", () => {
		expect(canAdvanceTo("travel_assistance", signals())).toBeNull();
	});

	it("blocks travel without visa completion", () => {
		expect(canAdvanceTo("travel_assistance", signals({ visaDone: false }))).toMatch(/visa/);
	});

	it("blocks travel without a chosen payment plan", () => {
		expect(canAdvanceTo("travel_assistance", signals({ hasPaymentPlan: false }))).toMatch(
			/payment plan/,
		);
	});

	it("blocks travel without agency settlement", () => {
		expect(canAdvanceTo("travel_assistance", signals({ agencySettled: false }))).toMatch(
			/agency/,
		);
	});

	it("blocks travel without the travel invoice paid", () => {
		expect(canAdvanceTo("travel_assistance", signals({ travelInvoicePaid: false }))).toMatch(
			/travel invoice/,
		);
	});

	it("blocks payment execution until visa completes", () => {
		expect(canAdvanceTo("payment_execution", signals({ visaDone: false }))).toMatch(/visa/);
		expect(canAdvanceTo("payment_execution", signals())).toBeNull();
	});

	it("blocks completed without travel clearance", () => {
		expect(canAdvanceTo("completed", signals({ travelClearance: "pending" }))).toMatch(/clearance/);
	});

	it("blocks completed until the pre-departure checklist is finished", () => {
		expect(canAdvanceTo("completed", signals({ preDepartureDone: false }))).toMatch(/checklist/);
	});
});

describe("canAdvanceToStage (shared adjacency + sub-step guard)", () => {
	it("requires plan, agency settlement and travel invoice before travel", () => {
		const base = {
			visaStage: "complete",
			agencySettled: true,
			agencyStageIndex: 3,
			appFeePaid: true,
			travelInvoicePaid: true,
			travelClearance: "pending",
			preDepartureTasks: [] as { done: boolean }[],
			paymentPlanId: "installment",
		};
		expect(
			canAdvanceToStage("payment_execution", "travel_assistance", base),
		).toBeNull();

		expect(
			canAdvanceToStage("payment_execution", "travel_assistance", {
				...base,
				paymentPlanId: null,
			}),
		).toMatch(/payment plan/);
		expect(
			canAdvanceToStage("payment_execution", "travel_assistance", {
				...base,
				agencySettled: false,
			}),
		).toMatch(/agency/);
		expect(
			canAdvanceToStage("payment_execution", "travel_assistance", {
				...base,
				travelInvoicePaid: false,
			}),
		).toMatch(/travel invoice/);
	});

	it("only allows one step forward at a time", () => {
		expect(canAdvanceToStage("visa_processing", "travel_assistance", {})).toMatch(
			/one stage/,
		);
		expect(canAdvanceToStage("travel_assistance", "visa_processing", {})).toMatch(
			/one stage/,
		);
	});

	it("requires visa completion before payment execution", () => {
		expect(
			canAdvanceToStage("visa_processing", "payment_execution", {
				visaStage: "decision",
			}),
		).toMatch(/visa processing must be complete/);
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
		for (const later of ["payment_execution", "travel_assistance", "completed"] as const) {
			expect(order.indexOf(later), later).toBeGreaterThan(order.indexOf("visa"));
		}
		expect(order.indexOf("travel_assistance")).toBeGreaterThan(
			order.indexOf("payment_execution"),
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
			"payment_execution",
			"travel_assistance",
			"completed",
		];
		for (const stage of stages) {
			expect(JOURNEY_STAGE_TO_PORTAL[stage], stage).toBeTruthy();
		}
	});
});