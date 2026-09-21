import { describe, expect, it } from "vitest";
import { milestoneLines, normaliseScope, quoteTotal, scopeLabel, serviceStageForJourney, stageLines } from "century-nit-shared";

const prices = { admissions: 70_000, visa: 70_000, departure: 30_000 };
const split = { depositPercent: 10, preDeparturePercent: 30, admissionsStartPercent: 50 };

describe("scope", () => {
	it("always holds admissions and drops departure without visa", () => {
		expect(normaliseScope([])).toEqual(["admissions"]);
		expect(normaliseScope(null)).toEqual(["admissions", "visa", "departure"]);
		expect(normaliseScope(["departure"])).toEqual(["admissions"]);
		expect(normaliseScope(["visa", "departure"])).toEqual(["admissions", "visa", "departure"]);
		expect(normaliseScope(["bogus", "visa"])).toEqual(["admissions", "visa"]);
		expect(scopeLabel(["admissions", "visa"])).toBe("Admissions + Visa");
	});

	it("maps the journey stages that a plan can leave out", () => {
		expect(serviceStageForJourney("school_submission")).toBeNull();
		expect(serviceStageForJourney("visa_processing")).toBe("visa");
		expect(serviceStageForJourney("completed")).toBe("departure");
	});
});

describe("quoteTotal", () => {
	it("prices a partial scope à la carte", () => {
		const q = quoteTotal({ bundleCents: 150_000, stagePrices: prices, stages: ["admissions"] });
		expect(q.totalCents).toBe(70_000);
		expect(q.bundleDiscountCents).toBe(0);
		expect(q.full).toBe(false);
	});

	it("prices the full journey at the bundle and says what the bundle saved", () => {
		const q = quoteTotal({ bundleCents: 150_000, stagePrices: prices, stages: ["admissions", "visa", "departure"] });
		expect(q.totalCents).toBe(150_000);
		expect(q.alaCarteCents).toBe(170_000);
		expect(q.bundleDiscountCents).toBe(20_000);
	});

	it("falls back to à la carte when the bundle is unpriced or no cheaper", () => {
		expect(quoteTotal({ bundleCents: 0, stagePrices: prices, stages: null }).totalCents).toBe(170_000);
		expect(quoteTotal({ bundleCents: 200_000, stagePrices: prices, stages: null }).totalCents).toBe(170_000);
	});

	it("splits a legacy row with no stage prices so à la carte lands above the bundle", () => {
		const q = quoteTotal({ bundleCents: 150_000, stagePrices: null, stages: null });
		expect(q.alaCarteCents).toBeGreaterThan(150_000);
		expect(q.totalCents).toBe(150_000);
	});
});

describe("milestoneLines", () => {
	it("keeps the deposit / pre-departure / post-arrival split for the full journey", () => {
		const q = quoteTotal({ bundleCents: 150_000, stagePrices: prices, stages: null });
		const lines = milestoneLines(q, split, "installment");
		expect(lines.map((l) => [l.amountCents, l.dueOn])).toEqual([
			[15_000, "acceptance"],
			[45_000, "visa_approved"],
			[90_000, "arrival"],
		]);
		expect(lines.reduce((n, l) => n + l.amountCents, 0)).toBe(150_000);
	});

	it("is deposit + balance on the full plan", () => {
		const q = quoteTotal({ bundleCents: 150_000, stagePrices: prices, stages: null });
		expect(milestoneLines(q, split, "full").map((l) => l.amountCents)).toEqual([15_000, 135_000]);
	});

	it("pays admissions-only in two halves: on acceptance and on the offer", () => {
		const q = quoteTotal({ bundleCents: 150_000, stagePrices: prices, stages: ["admissions"] });
		const lines = milestoneLines(q, split, "installment");
		expect(lines.map((l) => [l.amountCents, l.dueOn, l.stage])).toEqual([
			[35_000, "acceptance", "admissions"],
			[35_000, "offer", "admissions"],
		]);
	});

	it("adds the visa stage as one line due when its file opens", () => {
		const q = quoteTotal({ bundleCents: 150_000, stagePrices: prices, stages: ["admissions", "visa"] });
		const lines = milestoneLines(q, split, null);
		expect(lines.at(-1)).toMatchObject({ amountCents: 70_000, dueOn: "visa_open", stage: "visa" });
		expect(lines.reduce((n, l) => n + l.amountCents, 0)).toBe(140_000);
	});

	it("honours the admissions split setting", () => {
		const q = quoteTotal({ bundleCents: 150_000, stagePrices: prices, stages: ["admissions"] });
		expect(milestoneLines(q, { ...split, admissionsStartPercent: 30 }, null).map((l) => l.amountCents)).toEqual([21_000, 49_000]);
	});
});

describe("stageLines — extending a plan", () => {
	it("appends after the existing lines and takes a completed bundle's discount off the last one", () => {
		const added = [
			{ stage: "visa" as const, amountCents: 70_000 },
			{ stage: "departure" as const, amountCents: 30_000 },
		];
		const lines = stageLines(added, split, 2, 20_000);
		expect(lines.map((l) => [l.position, l.amountCents, l.dueOn])).toEqual([
			[2, 70_000, "visa_open"],
			[3, 10_000, "visa_approved"],
		]);
		expect(lines[1].detail).toContain("bundle discount");
	});

	it("never writes a negative line and drops one the discount consumes", () => {
		const lines = stageLines([{ stage: "departure", amountCents: 30_000 }], split, 3, 30_000);
		expect(lines).toEqual([]);
	});
});
