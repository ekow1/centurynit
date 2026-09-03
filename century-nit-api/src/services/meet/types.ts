/**
 * Google Meet service types.
 *
 * The Meet service creates video-conferencing spaces via the Google Meet REST
 * API. It is intentionally separate from the Calendar service — the application
 * calendar is the source of truth for scheduling; Meet is only the meeting
 * provider.
 */

/** Normalized meeting space returned by the Meet service. */
export interface MeetingSpace {
	/** Google Meet space name, e.g. `spaces/abc123`. */
	spaceId: string;
	/** The joinable meeting URI, e.g. `https://meet.google.com/xxx-xxxx-xxx`. */
	meetingUri: string;
	/** The meeting code, e.g. `xxx-xxxx-xxx`. */
	meetingCode: string | null;
}

/**
 * Live status of a Meet space, from `spaces.get`.
 *
 * `active` is true when someone is currently in the meeting (Google populates
 * `activeConference`). `participantCount` is the number of people in the call
 * right now. `startedAt` is when the current conference became active.
 */
export interface MeetingStatus {
	/** Whether anyone is currently in the meeting. */
	active: boolean;
	/** Number of participants currently in the call, or 0 if inactive. */
	participantCount: number;
	/** When the current conference started, or null if inactive. */
	startedAt: Date | null;
}

/** Error thrown when the Google Meet integration is not connected. */
export class MeetNotConnectedError extends Error {
	constructor(message = "Google Meet is not connected") {
		super(message);
		this.name = "MeetNotConnectedError";
	}
}

/** Error thrown when the OAuth credentials are dead or revoked. */
export class MeetAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MeetAuthError";
	}
}

/** Error thrown when the Google Meet API is unavailable or returns an error. */
export class MeetUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MeetUnavailableError";
	}
}
