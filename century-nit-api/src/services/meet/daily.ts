import { getSetting } from "../settings.js";
import {
	MeetNotConnectedError,
	MeetUnavailableError,
	type MeetingSpace,
	type MeetingStatus,
} from "./types.js";

/**
 * Daily.co video rooms — the meeting provider for online consultations.
 *
 * Replaces Google Meet with a provider that takes access control seriously
 * at the room level: every room is `privacy: "private"`, so the room URL
 * alone is useless — entry requires a meeting token minted by us (see
 * `createMeetingToken`), bound to the room, the person, and the slot window.
 * Rooms also carry their own `exp`, so they delete themselves after the
 * appointment instead of lingering the way Meet spaces do.
 *
 * The client is a thin `fetch` wrapper, not the SDK: everything we need is
 * plain REST, and an injectable fetch keeps the test seam identical to the
 * Google Meet module's.
 */

const DAILY_API = "https://api.daily.co/v1";

export type DailyFetch = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

let injectedFetch: DailyFetch | null = null;

/**
 * Test seam: stand in a fake Daily REST call (or `null` to restore real
 * fetch). While a fake is installed Daily counts as configured, so the
 * booking flow can be driven end to end without an API key.
 */
export function setDailyFetchForTests(fetchImpl: DailyFetch | null): void {
	injectedFetch = fetchImpl;
}

async function dailyFetch(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
	if (injectedFetch) return injectedFetch(path, init);
	const apiKey = await getSetting("DAILY_API_KEY");
	if (!apiKey) throw new MeetNotConnectedError("Daily is not configured");
	const res = await fetch(`${DAILY_API}${path}`, {
		method: init?.method ?? "GET",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: init?.body ? JSON.stringify(init.body) : undefined,
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new MeetUnavailableError(`Daily ${res.status}: ${detail || res.statusText}`);
	}
	if (res.status === 204) return null;
	return res.json();
}

/**
 * Whether Daily is configured (or a fake is installed). Credentials come from
 * `platform_settings` via the ops Settings screen, falling back to env vars.
 */
export async function dailyConnected(): Promise<boolean> {
	if (injectedFetch) return true;
	const [apiKey, domain] = await Promise.all([
		getSetting("DAILY_API_KEY"),
		getSetting("DAILY_DOMAIN"),
	]);
	return Boolean(apiKey && domain);
}

/**
 * Create a private room for one appointment.
 *
 * `exp` deletes the room after the slot ends — a rebooked or cancelled
 * meeting can't linger. `nbf` is the earliest join time; the token minted
 * at join also carries it, so this is a second layer, not the only one.
 */
export async function createDailyRoom(input: {
	expiresAt: Date;
	notBefore?: Date;
}): Promise<MeetingSpace> {
	const room = (await dailyFetch("/rooms", {
		method: "POST",
		body: {
			privacy: "private",
			properties: {
				exp: Math.floor(input.expiresAt.getTime() / 1000),
				...(input.notBefore ? { nbf: Math.floor(input.notBefore.getTime() / 1000) } : {}),
				enable_prejoin_ui: false,
				enable_knocking: false,
			},
		},
	})) as { name: string; url: string };
	if (!room?.url) throw new MeetUnavailableError("Daily returned a room with no URL");
	return { spaceId: room.name, meetingUri: room.url, meetingCode: room.name };
}

/** Permanently delete a room — called on cancellation. Unlike Meet, it's gone. */
export async function deleteDailyRoom(roomName: string): Promise<void> {
	await dailyFetch(`/rooms/${encodeURIComponent(roomName)}`, { method: "DELETE" });
}

/**
 * Re-bind a room's join window after a reschedule. The room's own nbf/exp are
 * baked at creation; without this a moved meeting keeps a room that opens (or
 * expires) against the old slot.
 */
export async function updateDailyRoomWindow(
	roomName: string,
	window: { notBefore?: Date; expiresAt: Date },
): Promise<void> {
	await dailyFetch(`/rooms/${encodeURIComponent(roomName)}`, {
		method: "POST",
		body: {
			properties: {
				exp: Math.floor(window.expiresAt.getTime() / 1000),
				...(window.notBefore ? { nbf: Math.floor(window.notBefore.getTime() / 1000) } : {}),
			},
		},
	});
}

/** Live presence for the status poller — a real participant count. */
export async function getDailyPresence(roomName: string): Promise<MeetingStatus> {
	const presence = (await dailyFetch(`/rooms/${encodeURIComponent(roomName)}/presence`)) as {
		total_count?: number;
		data?: { join_time?: string }[];
	};
	const count = presence?.total_count ?? presence?.data?.length ?? 0;
	const earliest = presence?.data
		?.map((p) => (p.join_time ? new Date(p.join_time).getTime() : NaN))
		.filter((t) => Number.isFinite(t))
		.sort((a, b) => a - b)[0];
	return {
		active: count > 0,
		participantCount: count,
		startedAt: earliest ? new Date(earliest) : null,
	};
}

/**
 * Mint a meeting token for one person joining one room.
 *
 * `room_name` is always set — a token without it opens every room in the
 * domain. `is_owner` gives staff host controls in Prebuilt (admit, mute,
 * remove); clients never get it. `exp`/`nbf` bind the token to the slot so a
 * forwarded link dies with the appointment.
 */
export async function createMeetingToken(input: {
	roomName: string;
	isOwner: boolean;
	userName?: string;
	userId?: string;
	expiresAt: Date;
	notBefore?: Date;
}): Promise<string> {
	const res = (await dailyFetch("/meeting-tokens", {
		method: "POST",
		body: {
			properties: {
				room_name: input.roomName,
				is_owner: input.isOwner,
				...(input.userName ? { user_name: input.userName } : {}),
				...(input.userId ? { user_id: input.userId } : {}),
				exp: Math.floor(input.expiresAt.getTime() / 1000),
				...(input.notBefore ? { nbf: Math.floor(input.notBefore.getTime() / 1000) } : {}),
			},
		},
	})) as { token: string };
	if (!res?.token) throw new MeetUnavailableError("Daily returned no meeting token");
	return res.token;
}

/**
 * Live credential probe for the ops settings page — proves the stored API
 * key authenticates against api.daily.co. `GET /rooms?limit=1` is the
 * cheapest authenticated read; a wrong key answers 401.
 */
export async function probeDaily(): Promise<{ ok: boolean; error: string | null }> {
	try {
		await dailyFetch("/rooms?limit=1");
		return { ok: true, error: null };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
