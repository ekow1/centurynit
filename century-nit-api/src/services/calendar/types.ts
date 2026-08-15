/**
 * The calendar operations scheduling needs, as an interface.
 *
 * Two implementations exist: `GoogleCalendarClient` (real) and
 * `FakeCalendarClient` (tests, and local development without credentials). The
 * seam matters for more than testing — it is what lets the whole booking flow
 * run and be verified when GOOGLE_* is unset, instead of the feature being
 * undemonstrable until someone configures a Google Cloud project.
 */

export type CalendarAttendee = {
	email: string;
	displayName?: string;
	/** Organiser is the employee; the client is a guest. */
	organizer?: boolean;
};

export type CreateEventInput = {
	calendarId: string;
	summary: string;
	description: string;
	/** UTC instants. The zone is carried separately so Google renders correctly. */
	startsAt: Date;
	endsAt: Date;
	timezone: string;
	attendees: CalendarAttendee[];
	/**
	 * Idempotency (§14). Google treats a repeated event id as a conflict rather
	 * than creating a duplicate, which is exactly the guarantee we want on retry.
	 */
	requestId: string;
	/** Ask Google to mint a Meet link for this event. */
	withMeet: boolean;
};

export type CalendarEvent = {
	eventId: string;
	calendarId: string;
	/** Present when `withMeet` was requested and Google provisioned a conference. */
	meetingUrl: string | null;
	htmlLink: string | null;
};

export type UpdateEventInput = {
	calendarId: string;
	eventId: string;
	startsAt: Date;
	endsAt: Date;
	timezone: string;
	summary?: string;
	description?: string;
};

export type BusyInterval = {
	externalEventId: string;
	startsAt: Date;
	endsAt: Date;
	summary: string | null;
};

/** Credentials for one employee's calendar, already decrypted. */
export type CalendarCredentials = {
	accessToken: string | null;
	refreshToken: string | null;
	accessTokenExpiresAt: Date | null;
};

/**
 * Raised when Google says the credentials are no longer usable.
 *
 * Distinguished from a transient failure because the response differs: a
 * transient error is retried, this one marks the account `needsReconnect` and
 * asks the employee to reconnect (§13).
 */
export class CalendarAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CalendarAuthError";
	}
}

/** Raised for transient failures — the caller should queue a retry. */
export class CalendarUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CalendarUnavailableError";
	}
}

export interface CalendarClient {
	/** Whether the integration is configured at all. */
	readonly enabled: boolean;

	createEvent(creds: CalendarCredentials, input: CreateEventInput): Promise<CalendarEvent>;

	updateEvent(creds: CalendarCredentials, input: UpdateEventInput): Promise<CalendarEvent>;

	cancelEvent(
		creds: CalendarCredentials,
		input: { calendarId: string; eventId: string },
	): Promise<void>;

	/** Events in the window that we did not create — used to subtract availability. */
	listBusy(
		creds: CalendarCredentials,
		input: { calendarId: string; from: Date; to: Date },
	): Promise<BusyInterval[]>;

	/**
	 * Refresh an expired access token.
	 * Returns null when the integration is disabled or no refresh is possible.
	 */
	refreshAccessToken(
		refreshToken: string,
	): Promise<{ accessToken: string; expiresAt: Date } | null>;
}
