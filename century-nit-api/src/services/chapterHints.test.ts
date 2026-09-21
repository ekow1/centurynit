import { describe, expect, it } from "vitest";
import { planChapters, planCompleteHint, stageSkippedByEntry, stageUnlockHint } from "century-nit-shared";

/**
 * The portal rail's per-chapter lines, keyed to the plan — a visa entrant
 * is never told "when you're admitted", and Complete names the plan's own
 * ending, not the whole journey's.
 */

describe("stageUnlockHint", () => {
	it("names the previous on-plan stage's exit", () => {
		expect(stageUnlockHint(null, "visa")).toBe("when you're admitted");
		expect(stageUnlockHint(null, "departure")).toBe("once your visa is approved");
		expect(stageUnlockHint(["admissions", "visa"], "visa")).toBe("when you're admitted");
		expect(stageUnlockHint(["admissions", "visa", "departure"], "departure")).toBe("once your visa is approved");
	});

	it("says after enrolment for the plan's first stage", () => {
		expect(stageUnlockHint(null, "admissions")).toBe("after enrolment");
		expect(stageUnlockHint(["visa"], "visa")).toBe("after enrolment");
		expect(stageUnlockHint(["departure"], "departure")).toBe("after enrolment");
	});

	it("skips over stages the plan does not include", () => {
		expect(stageUnlockHint(["visa", "departure"], "departure")).toBe("once your visa is approved");
		expect(stageUnlockHint(["admissions"], "visa")).toBe("when you're admitted");
	});
});

describe("planCompleteHint", () => {
	it("names the plan's own last stage", () => {
		expect(planCompleteHint(["admissions"])).toBe("when your offer is in hand");
		expect(planCompleteHint(["visa"])).toBe("once your visa is approved");
		expect(planCompleteHint(["admissions", "visa"])).toBe("once your visa is approved");
		expect(planCompleteHint(null)).toBe("once you've landed");
		expect(planCompleteHint(["departure"])).toBe("once you've landed");
	});
});

describe("stageSkippedByEntry", () => {
	it("is true only for stages before the entry stage", () => {
		expect(stageSkippedByEntry(["visa"], "admissions")).toBe(true);
		expect(stageSkippedByEntry(["visa"], "departure")).toBe(false);
		expect(stageSkippedByEntry(["departure"], "admissions")).toBe(true);
		expect(stageSkippedByEntry(["departure"], "visa")).toBe(true);
		expect(stageSkippedByEntry(["admissions"], "visa")).toBe(false);
	});

	it("is false for stages on the plan and for the full journey", () => {
		expect(stageSkippedByEntry(["visa"], "visa")).toBe(false);
		expect(stageSkippedByEntry(null, "admissions")).toBe(false);
	});
});

describe("planChapters", () => {
	it("keeps the six-chapter numbering but drops unbought stages", () => {
		expect(planChapters(["visa"]).map((c) => c.numeral)).toEqual(["I", "II", "IV", "VI"]);
		expect(planChapters(["departure"]).map((c) => c.id)).toEqual(["consultation", "enrolment", "departure", "complete"]);
		expect(planChapters(null)).toHaveLength(6);
	});
});
