import { google } from "googleapis";
import { createOAuthClient } from "../calendar/google.js";
import { loadCompanyCredentials } from "../calendar/index.js";
import {
	createDailyRoom,
	dailyConnected,
	deleteDailyRoom,
	getDailyPresence,
	updateDailyRoomWindow,
} from "./daily.js";
import {
	createLivekitRoom,
	deleteLivekitRoom,
	getLivekitPresence,
	livekitConnected,
} from "./livekit.js";
import {
	MeetAuthError,
	MeetNotConnectedError,
	MeetUnavailableError,
	type MeetingSpace,
	type MeetingStatus,
} from "./types.js";

/**
 * Meeting providers: LiveKit when LIVEKIT_* are set (custom in-app call UI),
 * Daily rooms when DAILY_API_KEY + DAILY_DOMAIN are set, else Google Meet
 * through the company account. Credentials resolve from platform_settings
 * (ops Settings → Video Meetings) with env vars as fallback. The booking's
 * `meetingProvider` column records which created its room so status/end
 * calls dispatch correctly — old bookings keep working after the switch.
 */
export type MeetingProvider = "livekit" | "daily" | "google_meet";

export async function activeProvider(): Promise<MeetingProvider | null> {
	if (await livekitConnected()) return "livekit";
	if (await dailyConnected()) return "daily";
	return null; // Google detection happens at meetClient()/meetConnected()
}

/**
 * Google Meet service.
 *
 * Creates and manages Meet spaces via the Google Meet REST API
 * (`meet({version:'v2'}).spaces.*`). Uses the company Google account's OAuth
 * credentials — the same tokens stored by the `/calendar/company/consent` OAuth flow,
 * just with the `meetings.space.created` scope.
 *
 * The service is intentionally stateless: every call loads fresh credentials
 * from `platform_settings` (with token refresh handled by `loadCompanyCredentials`),
 * so a reconnect takes effect immediately without a restart.
 */

/** Distinguish "your credentials are dead" from "Google is having a moment". */
function classify(err: unknown): never {
	const e = err as { code?: number | string; message?: string; response?: { status?: number } };
	const status = typeof e.code === "number" ? e.code : e.response?.status;
	const message = e.message ?? "Google Meet request failed";

	if (status === 401 || status === 403 || /invalid_grant|invalid_token/i.test(message)) {
		throw new MeetAuthError(message);
	}
	throw new MeetUnavailableError(message);
}

/**
 * The slice of the Meet API this service uses. Narrow on purpose so a test
 * can stand in a fake without reproducing the whole googleapis surface.
 */
type MeetSpaceData = {
	name?: string | null;
	meetingUri?: string | null;
	meetingCode?: string | null;
	activeConference?: unknown;
};
export type MeetSpacesClient = {
	spaces: {
		create(args: { requestBody: Record<string, unknown> }): Promise<{ data: MeetSpaceData }>;
		get(args: { name: string }): Promise<{ data: MeetSpaceData }>;
		endActiveConference(args: { name: string; requestBody: Record<string, unknown> }): Promise<unknown>;
	};
};

let injectedClient: MeetSpacesClient | null = null;

/**
 * Test seam: stand in a fake Meet client (or `null` to restore Google). While
 * a fake is installed the company account counts as connected, so the
 * booking flow can be driven end to end without credentials.
 */
export function setMeetClientForTests(client: MeetSpacesClient | null): void {
	injectedClient = client;
}

/** Build an authorized Meet API client from the company account's credentials. */
async function meetClient(): Promise<MeetSpacesClient> {
	if (injectedClient) return injectedClient;
	const account = await loadCompanyCredentials();
	if (!account) {
		throw new MeetNotConnectedError();
	}

	const auth = await createOAuthClient();
	auth.setCredentials({
		access_token: account.credentials.accessToken ?? undefined,
		refresh_token: account.credentials.refreshToken ?? undefined,
		expiry_date: account.credentials.accessTokenExpiresAt?.getTime(),
	});

	return google.meet({ version: "v2", auth }) as unknown as MeetSpacesClient;
}

/**
 * Create a Google Meet space.
 *
 * The space is created with `accessType: "TRUSTED"`: members of the same
 * Google Workspace org as the company account (i.e. consultants) join
 * directly, while external clients must "knock" and wait in the lobby until
 * the consultant admits them. This makes the consultant the effective host —
 * they control admission, mute, and removal — so staff start the meeting,
 * not the client.
 *
 * Prerequisite: the company Google account must be a Workspace account and
 * consultants must sign in with an account in the same org. If the company
 * account is a consumer @gmail.com account, TRUSTED behaves like RESTRICTED
 * (everyone knocks) — still safe, just less convenient.
 *
 * Caller must ensure no existing space is stored (idempotency is on the caller).
 */
async function googleCreateMeeting(): Promise<MeetingSpace> {
	const client = await meetClient();
	try {
		let space;
		try {
			const res = await client.spaces.create({
				requestBody: {
					config: {
						accessType: "TRUSTED",
					},
				},
			});
			space = res.data;
		} catch (firstErr: unknown) {
			const e = firstErr as { code?: number | string; response?: { status?: number } };
			const status = typeof e.code === "number" ? e.code : e.response?.status;
			if (status === 400) {
				const fallbackRes = await client.spaces.create({
					requestBody: {},
				});
				space = fallbackRes.data;
			} else {
				throw firstErr;
			}
		}
		if (!space?.meetingUri) {
			throw new MeetUnavailableError("Google returned a space with no meeting URI");
		}
		return {
			spaceId: space.name ?? "",
			meetingUri: space.meetingUri,
			meetingCode: space.meetingCode ?? null,
		};
	} catch (err) {
		if (err instanceof MeetNotConnectedError || err instanceof MeetAuthError || err instanceof MeetUnavailableError) {
			throw err;
		}
		classify(err);
	}
}

/**
 * Create a meeting room on whichever provider is active.
 *
 * Daily when configured — a private, self-expiring room. Otherwise Google
 * Meet. `window` is the appointment slot; Daily binds room expiry to it,
 * Google ignores it (spaces die on their own schedule).
 */
export async function createMeeting(window?: { notBefore?: Date; expiresAt?: Date }): Promise<MeetingSpace> {
	if (await livekitConnected()) {
		// Ephemeral — the name is all a token needs to bind to. The window is
		// enforced at join time, so `window` is unused here by design.
		return createLivekitRoom(`cnit-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`);
	}
	if (await dailyConnected()) {
		return createDailyRoom({ expiresAt: window?.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000), notBefore: window?.notBefore });
	}
	return googleCreateMeeting();
}

/** Fetch an existing Meet space by its resource name. */
export async function getMeeting(spaceId: string): Promise<MeetingSpace> {
	const client = await meetClient();
	try {
		const res = await client.spaces.get({ name: spaceId });
		const space = res.data;
		if (!space?.meetingUri) {
			throw new MeetUnavailableError("Google returned a space with no meeting URI");
		}
		return {
			spaceId: space.name ?? spaceId,
			meetingUri: space.meetingUri,
			meetingCode: space.meetingCode ?? null,
		};
	} catch (err) {
		if (err instanceof MeetNotConnectedError || err instanceof MeetAuthError || err instanceof MeetUnavailableError) {
			throw err;
		}
		classify(err);
	}
}

/**
 * End any active conference in the space.
 *
 * The space itself is not deleted — Google expires it on its own. This just
 * kicks out anyone currently in the meeting. Called on cancellation if the
 * product requires it; by default the space is left alone.
 */
export async function endMeeting(spaceId: string, provider?: string | null): Promise<void> {
	if (provider === "livekit") {
		await deleteLivekitRoom(spaceId);
		return;
	}
	if (provider === "daily") {
		await deleteDailyRoom(spaceId);
		return;
	}
	const client = await meetClient();
	try {
		await client.spaces.endActiveConference({ name: spaceId, requestBody: {} });
	} catch (err) {
		if (err instanceof MeetNotConnectedError || err instanceof MeetAuthError || err instanceof MeetUnavailableError) {
			throw err;
		}
		classify(err);
	}
}

/**
 * Re-bind a provider room's join window after a reschedule. Daily rooms get
 * their nbf/exp patched; Google Meet spaces have no window, so it's a no-op.
 */
export async function updateMeetingWindow(
	spaceId: string,
	provider: string | null | undefined,
	window: { notBefore?: Date; expiresAt: Date },
): Promise<void> {
	if (provider === "daily") {
		await updateDailyRoomWindow(spaceId, window);
	}
	// livekit: nothing to patch — the window lives in the token, minted at join.
}

/**
 * Get the live status of a Meet space — whether anyone is in the meeting.
 *
 * Used by the meeting status poller to populate `bookings.meetingActive` /
 * `meetingParticipants` / `meetingCheckedAt` so the ops dashboard can show
 * live meetings without each page view hitting Google.
 *
 * The Meet API's `activeConference` field only tells us *someone* is in the
 * room — it doesn't expose a live participant count or start time. Those come
 * from `conferenceRecords` after the meeting ends. For live display we just
 * report active/inactive; the poller stamps `meetingCheckedAt` so the UI can
 * show "checked N seconds ago".
 *
 * Returns `{ active: false, participantCount: 0, startedAt: null }` when the
 * space exists but no one has joined yet.
 */
export async function getMeetingStatus(spaceId: string, provider?: string | null): Promise<MeetingStatus> {
	if (provider === "livekit") {
		return getLivekitPresence(spaceId);
	}
	if (provider === "daily") {
		return getDailyPresence(spaceId);
	}
	const client = await meetClient();
	try {
		const res = await client.spaces.get({ name: spaceId });
		const space = res.data;
		const active = Boolean(space?.activeConference);
		return {
			active,
			participantCount: active ? 1 : 0,
			startedAt: null,
		};
	} catch (err) {
		if (err instanceof MeetNotConnectedError || err instanceof MeetAuthError || err instanceof MeetUnavailableError) {
			throw err;
		}
		classify(err);
	}
}

/** Whether any meeting provider is configured — LiveKit, then Daily, then Google. */
export async function meetConnected(): Promise<boolean> {
	if (injectedClient || (await livekitConnected()) || (await dailyConnected())) return true;
	const account = await loadCompanyCredentials();
	return Boolean(account);
}

export {
	MeetAuthError,
	MeetNotConnectedError,
	MeetUnavailableError,
	type MeetingSpace,
	type MeetingStatus,
} from "./types.js";
export { createMeetingToken, dailyConnected, setDailyFetchForTests, type DailyFetch } from "./daily.js";
export {
	createLivekitToken,
	livekitConnected,
	livekitWsUrl,
	setLivekitServiceForTests,
	type LivekitService,
} from "./livekit.js";
