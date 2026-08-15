import {
	CalendarAuthError,
	CalendarUnavailableError,
	type BusyInterval,
	type CalendarClient,
	type CalendarCredentials,
	type CalendarEvent,
	type CreateEventInput,
	type UpdateEventInput,
} from "./types.js";

/**
 * In-memory calendar, used by tests and by local development with no Google
 * credentials configured.
 *
 * It is a real implementation of the contract, not a stub: it enforces the same
 * idempotency Google does (a repeated `requestId` returns the original event
 * rather than a second one), generates Meet-shaped URLs, and can be told to
 * fail so the retry and reconnect paths in §13 are actually exercised.
 */

let counter = 0;

/** Google Meet codes look like `abc-defg-hij`. */
function meetCode(): string {
	const letters = "abcdefghijklmnopqrstuvwxyz";
	const pick = (n: number) =>
		Array.from({ length: n }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
	return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

type StoredEvent = {
	eventId: string;
	calendarId: string;
	summary: string;
	description: string;
	startsAt: Date;
	endsAt: Date;
	timezone: string;
	meetingUrl: string | null;
	cancelled: boolean;
};

export class FakeCalendarClient implements CalendarClient {
	readonly enabled = true;

	/** eventId → event */
	readonly events = new Map<string, StoredEvent>();
	/** requestId → eventId, the idempotency ledger Google keeps for us. */
	private readonly byRequestId = new Map<string, string>();
	/** Externally-created busy intervals, per calendar. */
	private readonly busy = new Map<string, BusyInterval[]>();

	/** Set to make the next N calls fail, exercising retry. */
	failNextCalls = 0;
	/** Set to make calls fail as though the token were revoked. */
	failWithAuthError = false;

	private guard() {
		if (this.failWithAuthError) {
			throw new CalendarAuthError("invalid_grant: token has been expired or revoked");
		}
		if (this.failNextCalls > 0) {
			this.failNextCalls -= 1;
			throw new CalendarUnavailableError("calendar backend unavailable");
		}
	}

	async createEvent(
		_creds: CalendarCredentials,
		input: CreateEventInput,
	): Promise<CalendarEvent> {
		this.guard();

		// §14 — a retried create must not produce a second event or Meet link.
		const existingId = this.byRequestId.get(input.requestId);
		if (existingId) {
			const existing = this.events.get(existingId)!;
			return {
				eventId: existing.eventId,
				calendarId: existing.calendarId,
				meetingUrl: existing.meetingUrl,
				htmlLink: `https://calendar.google.com/event?eid=${existing.eventId}`,
			};
		}

		counter += 1;
		const eventId = `fake-evt-${counter}-${Date.now().toString(36)}`;
		const event: StoredEvent = {
			eventId,
			calendarId: input.calendarId,
			summary: input.summary,
			description: input.description,
			startsAt: input.startsAt,
			endsAt: input.endsAt,
			timezone: input.timezone,
			meetingUrl: input.withMeet ? `https://meet.google.com/${meetCode()}` : null,
			cancelled: false,
		};
		this.events.set(eventId, event);
		this.byRequestId.set(input.requestId, eventId);

		return {
			eventId,
			calendarId: event.calendarId,
			meetingUrl: event.meetingUrl,
			htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
		};
	}

	async updateEvent(
		_creds: CalendarCredentials,
		input: UpdateEventInput,
	): Promise<CalendarEvent> {
		this.guard();
		const event = this.events.get(input.eventId);
		if (!event) throw new CalendarUnavailableError(`no such event: ${input.eventId}`);

		event.startsAt = input.startsAt;
		event.endsAt = input.endsAt;
		event.timezone = input.timezone;
		if (input.summary) event.summary = input.summary;
		if (input.description) event.description = input.description;

		// Rescheduling keeps the same conference, so the link the client already
		// has stays valid.
		return {
			eventId: event.eventId,
			calendarId: event.calendarId,
			meetingUrl: event.meetingUrl,
			htmlLink: `https://calendar.google.com/event?eid=${event.eventId}`,
		};
	}

	async cancelEvent(
		_creds: CalendarCredentials,
		input: { calendarId: string; eventId: string },
	): Promise<void> {
		this.guard();
		const event = this.events.get(input.eventId);
		// Cancelling an already-cancelled or missing event is a no-op, not an
		// error — retries must converge.
		if (event) event.cancelled = true;
	}

	async listBusy(
		_creds: CalendarCredentials,
		input: { calendarId: string; from: Date; to: Date },
	): Promise<BusyInterval[]> {
		this.guard();
		const external = this.busy.get(input.calendarId) ?? [];
		return external.filter((b) => b.startsAt < input.to && b.endsAt > input.from);
	}

	async refreshAccessToken(refreshToken: string) {
		if (this.failWithAuthError) {
			throw new CalendarAuthError("invalid_grant");
		}
		if (!refreshToken) return null;
		return {
			accessToken: `fake-access-${Date.now().toString(36)}`,
			expiresAt: new Date(Date.now() + 3600_000),
		};
	}

	/* ── test helpers ── */

	/** Simulate the employee adding an event in Google directly (§12). */
	addExternalBusy(calendarId: string, interval: BusyInterval) {
		const list = this.busy.get(calendarId) ?? [];
		list.push(interval);
		this.busy.set(calendarId, list);
	}

	isCancelled(eventId: string): boolean {
		return this.events.get(eventId)?.cancelled ?? false;
	}

	reset() {
		this.events.clear();
		this.byRequestId.clear();
		this.busy.clear();
		this.failNextCalls = 0;
		this.failWithAuthError = false;
	}
}

/**
 * Used when GOOGLE_* is not configured.
 *
 * Every call refuses rather than pretending to succeed, so a booking is left at
 * calendarSyncStatus=PENDING and recovers automatically once credentials are
 * added — instead of silently getting a fake meeting link, which is the bug
 * this feature exists to remove.
 */
export class DisabledCalendarClient implements CalendarClient {
	readonly enabled = false;

	private refuse(): never {
		throw new CalendarUnavailableError(
			"Google Calendar is not configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)",
		);
	}

	async createEvent(): Promise<CalendarEvent> {
		this.refuse();
	}
	async updateEvent(): Promise<CalendarEvent> {
		this.refuse();
	}
	async cancelEvent(): Promise<void> {
		this.refuse();
	}
	async listBusy(): Promise<BusyInterval[]> {
		// Availability must still work without Google: no external calendar means
		// no external conflicts, which is the correct answer rather than an error.
		return [];
	}
	async refreshAccessToken() {
		return null;
	}
}
