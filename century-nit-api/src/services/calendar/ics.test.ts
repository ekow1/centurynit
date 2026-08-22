import { describe, expect, it } from "vitest";
import { parseIcsBusyBlocks } from "./ics.js";

/**
 * Unit tests for the iCal/ICS parser that replaced the Google Calendar
 * integration. Pure — no database, no network — so they run everywhere,
 * including CI without a Postgres.
 */

const ICS = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Century NIT//Test//EN",
	"BEGIN:VEVENT",
	"UID:meeting-single@test",
	"SUMMARY:Team sync",
	"DTSTART:20260105T100000Z",
	"DTEND:20260105T103000Z",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:daily-standup@test",
	"SUMMARY:Daily standup",
	"DTSTART:20260101T090000Z",
	"DTEND:20260101T091500Z",
	"RRULE:FREQ=DAILY",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:all-day-leave@test",
	"SUMMARY:On leave",
	"DTSTART;VALUE=DATE:20260120",
	"DTEND;VALUE=DATE:20260121",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

describe("parseIcsBusyBlocks", () => {
	const from = new Date("2026-01-04T00:00:00Z");
	const to = new Date("2026-01-31T00:00:00Z");

	it("expands recurring events and keeps one-off and all-day events", () => {
		const blocks = parseIcsBusyBlocks(ICS, from, to);

		// One-off meeting on Jan 5.
		const meeting = blocks.find((b) => b.uid === "meeting-single@test");
		expect(meeting).toBeDefined();
		expect(meeting!.startsAt.getTime()).toBe(Date.parse("2026-01-05T10:00:00Z"));
		expect(meeting!.endsAt.getTime()).toBe(Date.parse("2026-01-05T10:30:00Z"));
		expect(meeting!.summary).toBe("Team sync");

		// Daily standup expanded across every day it falls in the window:
		// Jan 4 (first in range) through Jan 30 — Jan 31 09:00 is past `to`.
		const standups = blocks.filter((b) => b.uid === "daily-standup@test");
		expect(standups).toHaveLength(27);
		expect(standups[0].startsAt.getTime()).toBe(Date.parse("2026-01-04T09:00:00Z"));
		expect(standups.at(-1)!.startsAt.getTime()).toBe(Date.parse("2026-01-30T09:00:00Z"));

		// All-day leave covers the whole of Jan 20 (UTC midnight range).
		const leave = blocks.find((b) => b.uid === "all-day-leave@test");
		expect(leave).toBeDefined();
		expect(leave!.startsAt.getTime()).toBe(Date.parse("2026-01-20T00:00:00Z"));
		expect(leave!.endsAt.getTime()).toBe(Date.parse("2026-01-21T00:00:00Z"));
	});

	it("keeps recurring events in-range and drops one-off events outside it", () => {
		const blocks = parseIcsBusyBlocks(ICS, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-28T00:00:00Z"));
		// The unbounded daily standup recurs into February (Feb 1–27, since the
		// 28th 09:00 is past `to`).
		expect(blocks.filter((b) => b.uid === "daily-standup@test")).toHaveLength(27);
		// The one-off meeting (Jan 5) and all-day leave (Jan 20) fall outside Feb.
		expect(blocks.find((b) => b.uid === "meeting-single@test")).toBeUndefined();
		expect(blocks.find((b) => b.uid === "all-day-leave@test")).toBeUndefined();
	});
});
