import { google, type calendar_v3 } from "googleapis";
import { env } from "../../env.js";
import { getSetting } from "../settings.js";
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
 * Google Meet integration.
 *
 * Meet links are created via the dedicated Google Meet REST API
 * (`meet({version:'v2'}).spaces.create`), not through Google Calendar events.
 * The application's internal calendar is the sole source of truth for
 * availability and booking; Google Meet is only the video-conferencing provider.
 */

/** Only what the Meet integration needs. Narrow scope, easy to justify. */
export const GOOGLE_SCOPES = [
	"https://www.googleapis.com/auth/meetings.space.created",
	"https://www.googleapis.com/auth/userinfo.email",
];

export async function googleConfigured(): Promise<boolean> {
	const id = await getSetting("GOOGLE_CLIENT_ID");
	const secret = await getSetting("GOOGLE_CLIENT_SECRET");
	const redirect = await getSetting("GOOGLE_REDIRECT_URI");
	return Boolean(id && secret && redirect);
}

/**
 * Deliberately typed from `googleapis` rather than the standalone
 * `google-auth-library`: googleapis bundles its own nested copy, and mixing the
 * two yields two structurally identical but nominally incompatible
 * `OAuth2Client` types. Taking both from `google.auth` keeps them the same type.
 */
export type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

export async function createOAuthClient(): Promise<OAuthClient> {
	const clientId = await getSetting("GOOGLE_CLIENT_ID");
	const clientSecret = await getSetting("GOOGLE_CLIENT_SECRET");
	const redirectUri = await getSetting("GOOGLE_REDIRECT_URI");
	return new google.auth.OAuth2(
		clientId ?? env.GOOGLE_CLIENT_ID,
		clientSecret ?? env.GOOGLE_CLIENT_SECRET,
		redirectUri ?? env.GOOGLE_REDIRECT_URI,
	);
}

/**
 * Consent URL for an employee connecting their calendar.
 *
 * `access_type: "offline"` plus `prompt: "consent"` is what makes Google return
 * a refresh token. Without them a reconnect yields only a short-lived access
 * token and the integration breaks an hour later.
 */
export async function buildConsentUrl(state: string): Promise<string> {
	const client = await createOAuthClient();
	return client.generateAuthUrl({
		access_type: "offline",
		prompt: "consent",
		scope: GOOGLE_SCOPES,
		state,
		include_granted_scopes: true,
	});
}

/** Distinguish "your credentials are dead" from "Google is having a moment". */
function classify(err: unknown): never {
	const e = err as { code?: number | string; message?: string; response?: { status?: number } };
	const status = typeof e.code === "number" ? e.code : e.response?.status;
	const message = e.message ?? "Google Calendar request failed";

	if (status === 401 || status === 403 || /invalid_grant|invalid_token/i.test(message)) {
		throw new CalendarAuthError(message);
	}
	throw new CalendarUnavailableError(message);
}

export class GoogleCalendarClient implements CalendarClient {
	readonly enabled = true;

	private async client(creds: CalendarCredentials): Promise<calendar_v3.Calendar> {
		const auth = await createOAuthClient();
		auth.setCredentials({
			access_token: creds.accessToken ?? undefined,
			refresh_token: creds.refreshToken ?? undefined,
			expiry_date: creds.accessTokenExpiresAt?.getTime(),
		});
		return google.calendar({ version: "v3", auth });
	}

	async createEvent(
		creds: CalendarCredentials,
		input: CreateEventInput,
	): Promise<CalendarEvent> {
		try {
			const res = await (await this.client(creds)).events.insert({
				calendarId: input.calendarId,
				// Required for conferenceData to be honoured.
				conferenceDataVersion: input.withMeet ? 1 : 0,
				sendUpdates: "all",
				requestBody: {
					summary: input.summary,
					description: input.description,
					start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
					end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone },
					attendees: input.attendees.map((a) => ({
						email: a.email,
						displayName: a.displayName,
						organizer: a.organizer,
					})),
					...(input.withMeet
						? {
								conferenceData: {
									createRequest: {
										// §14: Google dedupes on this, so a retry attaches to the
										// existing conference instead of minting a second one.
										requestId: input.requestId,
										conferenceSolutionKey: { type: "hangoutsMeet" },
									},
								},
							}
						: {}),
				},
			});

			const data = res.data;
			return {
				eventId: data.id ?? "",
				calendarId: input.calendarId,
				meetingUrl: extractMeetUrl(data),
				htmlLink: data.htmlLink ?? null,
			};
		} catch (err) {
			classify(err);
		}
	}

	async updateEvent(
		creds: CalendarCredentials,
		input: UpdateEventInput,
	): Promise<CalendarEvent> {
		try {
			// patch, not update: update replaces the whole resource and would drop
			// the conference, invalidating a Meet link the client already has.
			const res = await (await this.client(creds)).events.patch({
				calendarId: input.calendarId,
				eventId: input.eventId,
				sendUpdates: "all",
				requestBody: {
					start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
					end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone },
					...(input.summary ? { summary: input.summary } : {}),
					...(input.description ? { description: input.description } : {}),
				},
			});
			return {
				eventId: res.data.id ?? input.eventId,
				calendarId: input.calendarId,
				meetingUrl: extractMeetUrl(res.data),
				htmlLink: res.data.htmlLink ?? null,
			};
		} catch (err) {
			classify(err);
		}
	}

	async cancelEvent(
		creds: CalendarCredentials,
		input: { calendarId: string; eventId: string },
	): Promise<void> {
		try {
			await (await this.client(creds)).events.delete({
				calendarId: input.calendarId,
				eventId: input.eventId,
				sendUpdates: "all",
			});
		} catch (err) {
			// Already gone is the desired end state — retries must converge.
			const status = (err as { code?: number }).code;
			if (status === 404 || status === 410) return;
			classify(err);
		}
	}

	async listBusy(
		creds: CalendarCredentials,
		input: { calendarId: string; from: Date; to: Date },
	): Promise<BusyInterval[]> {
		try {
			const res = await (await this.client(creds)).events.list({
				calendarId: input.calendarId,
				timeMin: input.from.toISOString(),
				timeMax: input.to.toISOString(),
				singleEvents: true,
				orderBy: "startTime",
				maxResults: 250,
			});

			return (res.data.items ?? [])
				.filter((e) => e.status !== "cancelled")
				// "transparent" means the organiser marked it Free — not a conflict.
				.filter((e) => e.transparency !== "transparent")
				.flatMap((e) => {
					const start = e.start?.dateTime ?? e.start?.date;
					const end = e.end?.dateTime ?? e.end?.date;
					if (!start || !end || !e.id) return [];
					return [
						{
							externalEventId: e.id,
							startsAt: new Date(start),
							endsAt: new Date(end),
							summary: e.summary ?? null,
						},
					];
				});
		} catch (err) {
			classify(err);
		}
	}

	async refreshAccessToken(refreshToken: string) {
		try {
			const auth = await createOAuthClient();
			auth.setCredentials({ refresh_token: refreshToken });
			const { credentials } = await auth.refreshAccessToken();
			if (!credentials.access_token) return null;
			return {
				accessToken: credentials.access_token,
				expiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600_000),
			};
		} catch (err) {
			classify(err);
		}
	}
}

/**
 * Google reports the Meet link in more than one place depending on how the
 * conference was created, so check both rather than assuming.
 */
function extractMeetUrl(event: calendar_v3.Schema$Event): string | null {
	const fromEntryPoints = event.conferenceData?.entryPoints?.find(
		(p) => p.entryPointType === "video",
	)?.uri;
	return fromEntryPoints ?? event.hangoutLink ?? null;
}
