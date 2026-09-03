import { google } from "googleapis";
import { createOAuthClient } from "../calendar/google.js";
import { loadCompanyCredentials } from "../calendar/index.js";
import {
	MeetAuthError,
	MeetNotConnectedError,
	MeetUnavailableError,
	type MeetingSpace,
} from "./types.js";

/**
 * Google Meet service.
 *
 * Creates and manages Meet spaces via the Google Meet REST API
 * (`meet({version:'v2'}).spaces.*`). Uses the company Google account's OAuth
 * credentials — the same tokens stored by the `/calendar/company/*` OAuth flow,
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

/** Build an authorized Meet API client from the company account's credentials. */
async function meetClient() {
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

	return google.meet({ version: "v2", auth });
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
export async function createMeeting(): Promise<MeetingSpace> {
	const client = await meetClient();
	try {
		const res = await client.spaces.create({
			requestBody: {
				config: {
					accessType: "TRUSTED",
				},
			},
		});
		const space = res.data;
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
export async function endMeeting(spaceId: string): Promise<void> {
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

/** Whether the company Google account is connected for Meet. */
export async function meetConnected(): Promise<boolean> {
	const account = await loadCompanyCredentials();
	return Boolean(account);
}

export { MeetAuthError, MeetNotConnectedError, MeetUnavailableError, type MeetingSpace } from "./types.js";
