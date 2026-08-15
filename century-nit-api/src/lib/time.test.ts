import { describe, expect, it } from "vitest";
import {
	dateKeyInZone,
	dayOfWeekInZone,
	formatInZone,
	isValidTimeZone,
	overlaps,
	timeKeyInZone,
	zoneOffsetMinutes,
	zonedTimeToUtc,
} from "./time.js";

/**
 * §15. These exist because timezone bugs are invisible in local testing here:
 * Ghana is UTC+0 with no DST, so an implementation that simply ignores zones
 * passes every Accra-based check and then sends a London applicant to the wrong
 * hour for half the year.
 */

describe("zonedTimeToUtc", () => {
	it("treats a UTC+0 zone as a no-op", () => {
		const utc = zonedTimeToUtc("2026-08-20", "10:00", "Africa/Accra");
		expect(utc.toISOString()).toBe("2026-08-20T10:00:00.000Z");
	});

	it("applies a positive offset", () => {
		// Dubai is UTC+4 year-round: 10:00 local is 06:00 UTC.
		const utc = zonedTimeToUtc("2026-08-20", "10:00", "Asia/Dubai");
		expect(utc.toISOString()).toBe("2026-08-20T06:00:00.000Z");
	});

	it("applies a negative offset", () => {
		// New York in August is UTC-4.
		const utc = zonedTimeToUtc("2026-08-20", "10:00", "America/New_York");
		expect(utc.toISOString()).toBe("2026-08-20T14:00:00.000Z");
	});

	it("uses the offset in force on the date, not today's", () => {
		// London: BST (UTC+1) in August, GMT (UTC+0) in January. A single stored
		// offset would get one of these wrong.
		const summer = zonedTimeToUtc("2026-08-20", "10:00", "Europe/London");
		const winter = zonedTimeToUtc("2026-01-20", "10:00", "Europe/London");
		expect(summer.toISOString()).toBe("2026-08-20T09:00:00.000Z");
		expect(winter.toISOString()).toBe("2026-01-20T10:00:00.000Z");
	});

	it("resolves a spring-forward gap to a real instant", () => {
		// 01:30 on 29 Mar 2026 does not exist in London — the clock jumps 01:00→02:00.
		const utc = zonedTimeToUtc("2026-03-29", "01:30", "Europe/London");
		expect(Number.isNaN(utc.getTime())).toBe(false);
		expect(utc.toISOString()).toBe("2026-03-29T01:30:00.000Z");
	});

	it("round-trips through the zone it came from", () => {
		for (const zone of ["Africa/Accra", "Europe/London", "America/New_York", "Asia/Dubai"]) {
			const utc = zonedTimeToUtc("2026-08-20", "14:30", zone);
			expect(dateKeyInZone(utc, zone)).toBe("2026-08-20");
			expect(timeKeyInZone(utc, zone)).toBe("14:30");
		}
	});
});

describe("zoneOffsetMinutes", () => {
	it("reports DST-aware offsets", () => {
		expect(zoneOffsetMinutes("Europe/London", new Date("2026-08-20T12:00:00Z"))).toBe(60);
		expect(zoneOffsetMinutes("Europe/London", new Date("2026-01-20T12:00:00Z"))).toBe(0);
		expect(zoneOffsetMinutes("Africa/Accra", new Date("2026-08-20T12:00:00Z"))).toBe(0);
	});
});

describe("dayOfWeekInZone", () => {
	it("uses the zone's own calendar day, not the server's", () => {
		// 23:30 UTC on Thursday is already Friday in Dubai (+4).
		const instant = new Date("2026-08-20T23:30:00Z"); // Thursday UTC
		expect(dayOfWeekInZone(instant, "Africa/Accra")).toBe(4); // Thu
		expect(dayOfWeekInZone(instant, "Asia/Dubai")).toBe(5); // Fri
	});
});

describe("overlaps", () => {
	const at = (h: number) => new Date(`2026-08-20T${String(h).padStart(2, "0")}:00:00Z`);

	it("detects a genuine overlap", () => {
		expect(overlaps(at(9), at(11), at(10), at(12))).toBe(true);
	});

	it("treats touching intervals as free", () => {
		// A 09:00–10:00 booking must not block a 10:00 start.
		expect(overlaps(at(9), at(10), at(10), at(11))).toBe(false);
	});

	it("detects full containment", () => {
		expect(overlaps(at(9), at(17), at(10), at(11))).toBe(true);
	});
});

describe("isValidTimeZone", () => {
	it("accepts IANA zones and rejects junk", () => {
		expect(isValidTimeZone("Africa/Accra")).toBe(true);
		expect(isValidTimeZone("Europe/London")).toBe(true);
		expect(isValidTimeZone("UTC")).toBe(true);
		expect(isValidTimeZone("Not/AZone")).toBe(false);
		expect(isValidTimeZone("")).toBe(false);
	});

	// ICU accepts these, but they are not zones: an offset is right only until
	// the next DST change, so storing one guarantees a future off-by-an-hour.
	it("rejects fixed offsets masquerading as zones", () => {
		for (const bad of ["+01:00", "-0500", "+1", "GMT+1", "UTC+2", "gmt-3"]) {
			expect(isValidTimeZone(bad)).toBe(false);
		}
	});
});

describe("formatInZone", () => {
	it("renders the same instant differently per recipient", () => {
		const instant = zonedTimeToUtc("2026-08-20", "10:00", "Africa/Accra");
		const accra = formatInZone(instant, "Africa/Accra");
		const london = formatInZone(instant, "Europe/London");
		expect(accra).toContain("10:00");
		expect(london).toContain("11:00"); // BST
		expect(accra).not.toBe(london);
	});
});
