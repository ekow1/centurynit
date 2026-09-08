import { describe, expect, it } from "vitest";
import type { JourneyStage } from "century-nit-shared";
import {
	AWAITING_ASSIGNMENT_STAGES,
	STAGE_OWNER_CLASS,
	isAwaitingAssignmentBoundary,
	isOwnerClassBoundary,
} from "./handoffs.js";

/**
 * §Assignment decisions — handoffs exist so that ownership never silently
 * carries over: when an application crosses from one specialist class to
 * another the manager makes the keep/assign/defer call. The boundary rule is
 * pure logic, so it is pinned here without a database.
 */

const STAGES: JourneyStage[] = [
	"document_verification",
	"school_submission",
	"offer_letter_review",
	"visa_processing",
	"payment_execution",
	"travel_assistance",
	"completed",
];

describe("STAGE_OWNER_CLASS", () => {
	it("covers every journey stage", () => {
		for (const stage of STAGES) {
			expect(STAGE_OWNER_CLASS[stage], stage).toBeTruthy();
		}
	});

	it("groups stages by their owning specialist class", () => {
		expect(STAGE_OWNER_CLASS.document_verification).toBe("consultant");
		expect(STAGE_OWNER_CLASS.school_submission).toBe("consultant");
		expect(STAGE_OWNER_CLASS.offer_letter_review).toBe("consultant");
		expect(STAGE_OWNER_CLASS.visa_processing).toBe("visa_officer");
		expect(STAGE_OWNER_CLASS.payment_execution).toBe("finance_officer");
		expect(STAGE_OWNER_CLASS.travel_assistance).toBe("travel_officer");
		expect(STAGE_OWNER_CLASS.completed).toBe("none");
	});
});

describe("isOwnerClassBoundary", () => {
	it("is false within a consultant-owned stage run", () => {
		expect(isOwnerClassBoundary("document_verification", "school_submission")).toBe(false);
		expect(isOwnerClassBoundary("school_submission", "offer_letter_review")).toBe(false);
		expect(isOwnerClassBoundary("offer_letter_review", "school_submission")).toBe(false);
	});

	it("is true wherever the owning class changes", () => {
		expect(isOwnerClassBoundary("offer_letter_review", "visa_processing")).toBe(true);
		expect(isOwnerClassBoundary("visa_processing", "payment_execution")).toBe(true);
		expect(isOwnerClassBoundary("payment_execution", "travel_assistance")).toBe(true);
		expect(isOwnerClassBoundary("travel_assistance", "completed")).toBe(true);
	});

	it("is symmetric across a boundary", () => {
		expect(isOwnerClassBoundary("visa_processing", "offer_letter_review")).toBe(true);
		expect(isOwnerClassBoundary("completed", "travel_assistance")).toBe(true);
	});

	it("is false when the stage is unchanged", () => {
		for (const stage of STAGES) {
			expect(isOwnerClassBoundary(stage, stage), stage).toBe(false);
		}
	});
});

describe("isAwaitingAssignmentBoundary", () => {
	it("hard-gates the finance and travel boundary stages", () => {
		for (const stage of AWAITING_ASSIGNMENT_STAGES) {
			expect(isAwaitingAssignmentBoundary(stage), stage).toBe(true);
		}
		expect(isAwaitingAssignmentBoundary("payment_execution")).toBe(true);
		expect(isAwaitingAssignmentBoundary("travel_assistance")).toBe(true);
	});

	it("does not gate visa, the consultant run, or the terminal stage", () => {
		expect(isAwaitingAssignmentBoundary("visa_processing")).toBe(false);
		expect(isAwaitingAssignmentBoundary("document_verification")).toBe(false);
		expect(isAwaitingAssignmentBoundary("school_submission")).toBe(false);
		expect(isAwaitingAssignmentBoundary("offer_letter_review")).toBe(false);
		expect(isAwaitingAssignmentBoundary("completed")).toBe(false);
	});

	it("every gated stage sits at an owner-class boundary", () => {
		const predecessor: Record<string, JourneyStage> = {
			payment_execution: "visa_processing",
			travel_assistance: "payment_execution",
		};
		for (const stage of AWAITING_ASSIGNMENT_STAGES) {
			expect(isOwnerClassBoundary(predecessor[stage], stage), stage).toBe(true);
		}
	});
});