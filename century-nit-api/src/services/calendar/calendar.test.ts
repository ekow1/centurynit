import { beforeEach, describe, expect, it } from "vitest";
import { FakeCalendarClient, DisabledCalendarClient } from "./fake.js";
import { CalendarAuthError, CalendarUnavailableError, type CalendarCredentials } from "./types.js";

/**
 * Covers §5 (Meet generation), §13 (failure handling) and §14 (idempotency) at
 * the calendar boundary, without needing Google credentials.
 */

const creds: CalendarCredentials = {
	accessToken: "test-access",
	refreshToken: "test-refresh",
	accessTokenExpiresAt: new Date(Date.now() + 3600_000),
};

const baseEvent = {
	calendarId: "primary",
	summary: "Consultation · Kwame Mensah",
	description: "Reference CNS-2026-0001",
	startsAt: new Date("2026-08-20T10:00:00Z"),
	endsAt: new Date("2026-08-20T10:45:00Z"),
	timezone: "Africa/Accra",
	attendees: [
		{ email: "consultant@century-nit.com", organizer: true },
		{ email: "client@example.com" },
	],
	withMeet: true,
};

describe("FakeCalendarClient", () => {
	let client: FakeCalendarClient;
	beforeEach(() => {
		client = new FakeCalendarClient();
	});

	it("creates an event with a Meet link", async () => {
		const event = await client.createEvent(creds, { ...baseEvent, requestId: "req-1" });
		expect(event.eventId).toBeTruthy();
		expect(event.meetingUrl).toMatch(/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
	});

	it("omits the conference when withMeet is false", async () => {
		const event = await client.createEvent(creds, {
			...baseEvent,
			withMeet: false,
			requestId: "req-in-person",
		});
		expect(event.meetingUrl).toBeNull();
	});

	// §14 — the requirement is explicit: a retry must not create 2 events or 2 links.
	it("is idempotent on requestId", async () => {
		const first = await client.createEvent(creds, { ...baseEvent, requestId: "req-same" });
		const second = await client.createEvent(creds, { ...baseEvent, requestId: "req-same" });

		expect(second.eventId).toBe(first.eventId);
		expect(second.meetingUrl).toBe(first.meetingUrl);
		expect(client.events.size).toBe(1);
	});

	it("creates distinct events for distinct requestIds", async () => {
		await client.createEvent(creds, { ...baseEvent, requestId: "req-a" });
		await client.createEvent(creds, { ...baseEvent, requestId: "req-b" });
		expect(client.events.size).toBe(2);
	});

	it("keeps the same Meet link across a reschedule", async () => {
		const created = await client.createEvent(creds, { ...baseEvent, requestId: "req-resched" });
		const moved = await client.updateEvent(creds, {
			calendarId: "primary",
			eventId: created.eventId,
			startsAt: new Date("2026-08-21T14:00:00Z"),
			endsAt: new Date("2026-08-21T14:45:00Z"),
			timezone: "Africa/Accra",
		});
		// The client already has this link; changing it would strand them.
		expect(moved.meetingUrl).toBe(created.meetingUrl);
		expect(moved.eventId).toBe(created.eventId);
	});

	it("marks an event cancelled and tolerates repeat cancels", async () => {
		const created = await client.createEvent(creds, { ...baseEvent, requestId: "req-cancel" });
		await client.cancelEvent(creds, { calendarId: "primary", eventId: created.eventId });
		expect(client.isCancelled(created.eventId)).toBe(true);

		// Retries must converge, not throw.
		await expect(
			client.cancelEvent(creds, { calendarId: "primary", eventId: created.eventId }),
		).resolves.toBeUndefined();
		await expect(
			client.cancelEvent(creds, { calendarId: "primary", eventId: "never-existed" }),
		).resolves.toBeUndefined();
	});

	// §13 — "Google Calendar unavailable: do not lose the booking."
	it("raises a transient error that callers can retry", async () => {
		client.failNextCalls = 1;
		await expect(
			client.createEvent(creds, { ...baseEvent, requestId: "req-fail" }),
		).rejects.toBeInstanceOf(CalendarUnavailableError);

		// The next attempt succeeds — this is what the queued retry relies on.
		const event = await client.createEvent(creds, { ...baseEvent, requestId: "req-fail" });
		expect(event.meetingUrl).toBeTruthy();
	});

	// §13 — "Google OAuth expired: refresh the token or request reconnection."
	it("raises an auth error distinctly from a transient one", async () => {
		client.failWithAuthError = true;
		await expect(
			client.createEvent(creds, { ...baseEvent, requestId: "req-auth" }),
		).rejects.toBeInstanceOf(CalendarAuthError);
		await expect(client.refreshAccessToken("stale")).rejects.toBeInstanceOf(CalendarAuthError);
	});

	it("refreshes an access token", async () => {
		const refreshed = await client.refreshAccessToken("valid-refresh");
		expect(refreshed?.accessToken).toBeTruthy();
		expect(refreshed!.expiresAt.getTime()).toBeGreaterThan(Date.now());
	});

	// §12 — an event added in Google directly must show up as busy.
	it("reports externally added events as busy", async () => {
		client.addExternalBusy("primary", {
			externalEventId: "ext-1",
			startsAt: new Date("2026-08-20T09:00:00Z"),
			endsAt: new Date("2026-08-20T10:00:00Z"),
			summary: "Dentist",
		});

		const inWindow = await client.listBusy(creds, {
			calendarId: "primary",
			from: new Date("2026-08-20T00:00:00Z"),
			to: new Date("2026-08-21T00:00:00Z"),
		});
		expect(inWindow).toHaveLength(1);

		const outsideWindow = await client.listBusy(creds, {
			calendarId: "primary",
			from: new Date("2026-08-25T00:00:00Z"),
			to: new Date("2026-08-26T00:00:00Z"),
		});
		expect(outsideWindow).toHaveLength(0);
	});
});

describe("DisabledCalendarClient", () => {
	const client = new DisabledCalendarClient();

	it("refuses to create rather than inventing a fake link", async () => {
		// The bug this feature replaces was a fabricated meet.google.com URL that
		// 404s. Refusing keeps the booking at PENDING until credentials exist.
		await expect(
			client.createEvent(),
		).rejects.toBeInstanceOf(CalendarUnavailableError);
	});

	it("reports no external conflicts so availability still works", async () => {
		await expect(client.listBusy()).resolves.toEqual([]);
	});

	it("declares itself disabled", () => {
		expect(client.enabled).toBe(false);
	});
});
