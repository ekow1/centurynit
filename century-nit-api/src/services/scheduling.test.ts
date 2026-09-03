import { describe, expect, it } from "vitest";
import {
	effectiveDayValues,
	generateSlots,
	validateScheduleConfig,
	type WeeklySlotScheduleGeneral,
	type WeeklySlotScheduleDay,
} from "century-nit-shared";

const general: WeeklySlotScheduleGeneral = {
	openStart: "09:00",
	openEnd: "17:00",
	intervalMinutes: 60,
	maxSlotsPerDay: null,
};

const customDay: WeeklySlotScheduleDay = {
	dayOfWeek: 1,
	customEnabled: true,
	openStart: "10:00",
	openEnd: "12:00",
	intervalMinutes: 30,
	maxSlotsPerDay: null,
};

const inheritedDay: WeeklySlotScheduleDay = {
	dayOfWeek: 2,
	customEnabled: false,
	openStart: "09:00",
	openEnd: "17:00",
	intervalMinutes: 60,
	maxSlotsPerDay: null,
};

describe("generateSlots", () => {
	it("generates slots from start to end by interval", () => {
		expect(generateSlots("09:00", "12:00", 60, null)).toEqual([
			"09:00",
			"10:00",
			"11:00",
		]);
	});

	it("caps at maxSlots", () => {
		expect(generateSlots("09:00", "17:00", 30, 2)).toEqual(["09:00", "09:30"]);
	});

	it("returns empty when end <= start", () => {
		expect(generateSlots("17:00", "09:00", 60, null)).toEqual([]);
		expect(generateSlots("09:00", "09:00", 60, null)).toEqual([]);
	});

	it("returns empty when interval <= 0", () => {
		expect(generateSlots("09:00", "17:00", 0, null)).toEqual([]);
	});

	it("respects a custom interval", () => {
		expect(generateSlots("10:00", "12:00", 30, null)).toEqual([
			"10:00",
			"10:30",
			"11:00",
			"11:30",
		]);
	});

	it("respects zero max slots as no cap", () => {
		expect(generateSlots("09:00", "11:00", 60, 0).length).toBe(2);
	});
});

describe("effectiveDayValues", () => {
	it("uses general values when custom is off", () => {
		expect(effectiveDayValues(inheritedDay, general)).toEqual(general);
	});

	it("uses custom values when custom is on", () => {
		expect(effectiveDayValues(customDay, general)).toEqual({
			openStart: "10:00",
			openEnd: "12:00",
			intervalMinutes: 30,
			maxSlotsPerDay: null,
		});
	});

	it("preserves stored custom values but ignores them when custom is off", () => {
		const stored: WeeklySlotScheduleDay = {
			...customDay,
			customEnabled: false,
		};
		expect(effectiveDayValues(stored, general)).toEqual(general);
	});
});

describe("schedule inheritance", () => {
	it("general setting changes affect inherited days", () => {
		const updatedGeneral = { ...general, openEnd: "18:00" };
		const eff = effectiveDayValues(inheritedDay, updatedGeneral);
		expect(eff.openEnd).toBe("18:00");
		expect(generateSlots(eff.openStart, eff.openEnd, eff.intervalMinutes, eff.maxSlotsPerDay).length).toBe(9);
	});

	it("general setting changes do not affect custom days", () => {
		const updatedGeneral = { ...general, openEnd: "18:00" };
		const eff = effectiveDayValues(customDay, updatedGeneral);
		expect(eff.openEnd).toBe("12:00");
	});

	it("turning custom off makes the day inherit general settings", () => {
		const toggled: WeeklySlotScheduleDay = { ...customDay, customEnabled: false };
		expect(effectiveDayValues(toggled, general)).toEqual(general);
	});
});

describe("validateScheduleConfig", () => {
	it("passes for a valid schedule", () => {
		expect(validateScheduleConfig(general, [inheritedDay, customDay])).toBeNull();
	});

	it("rejects end <= start in general settings", () => {
		const invalid = { ...general, openEnd: "09:00" };
		expect(validateScheduleConfig(invalid, [inheritedDay])).not.toBeNull();
	});

	it("rejects interval outside 5–480 in general settings", () => {
		const invalid = { ...general, intervalMinutes: 3 };
		expect(validateScheduleConfig(invalid, [inheritedDay])).not.toBeNull();
	});

	it("rejects negative max slots", () => {
		const invalid = { ...general, maxSlotsPerDay: -1 };
		expect(validateScheduleConfig(invalid, [inheritedDay])).not.toBeNull();
	});

	it("rejects end <= start in custom day settings", () => {
		const invalidCustom: WeeklySlotScheduleDay = { ...customDay, openEnd: "09:00" };
		expect(validateScheduleConfig(general, [invalidCustom])).not.toBeNull();
	});

	it("ignores invalid stored custom values when custom is off", () => {
		const badStored: WeeklySlotScheduleDay = {
			...customDay,
			customEnabled: false,
			openEnd: "08:00",
		};
		expect(validateScheduleConfig(general, [badStored])).toBeNull();
	});
});
