import { describe, expect, it } from "vitest";
import { preDepartureChecklistDone } from "century-nit-shared";
import { PRE_DEPARTURE_TASKS } from "century-nit-core/content";

describe("the pre-departure checklist", () => {
	it("is done when every required item is ticked or waived; advice never gates", () => {
		expect(preDepartureChecklistDone([])).toBe(true);
		expect(preDepartureChecklistDone([{ required: true, done: false }])).toBe(false);
		expect(preDepartureChecklistDone([{ required: true, done: true }, { required: false, done: false }])).toBe(true);
		expect(preDepartureChecklistDone([{ required: true, done: false, waivedReason: "Client already insured through employer" }])).toBe(true);
		// Older rows without `required` count as required.
		expect(preDepartureChecklistDone([{ done: false }])).toBe(false);
	});

	it("has a template where Century's items are the officer's and proof items name a document", () => {
		const century = PRE_DEPARTURE_TASKS.filter((t) => t.owner === "century").map((t) => t.id);
		expect(century).toEqual(expect.arrayContaining(["pd-briefing", "pd-flights", "pd-airport"]));
		const proof = PRE_DEPARTURE_TASKS.filter((t) => t.evidence);
		expect(proof.map((t) => t.evidence)).toEqual(expect.arrayContaining(["insurance", "accommodation_proof"]));
		expect(proof.every((t) => t.owner === "client")).toBe(true);
		expect(PRE_DEPARTURE_TASKS.some((t) => !t.required)).toBe(true);
	});
});
