import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { getSetting } from "../settings.js";
import {
	MeetNotConnectedError,
	MeetUnavailableError,
	type MeetingSpace,
	type MeetingStatus,
} from "./types.js";

/**
 * LiveKit — the meeting provider for consultations joined inside our own UI.
 *
 * Unlike Daily there is no hosted meeting page and no provisioned room:
 * rooms are ephemeral, created when the first participant connects and
 * deleted when the last leaves. Everything that Daily enforced as a room
 * property (privacy, the join window, expiry) lives in the token instead —
 * a JWT signed with the project's API secret at join time, bound to the
 * room name, the person's identity, and the slot window.
 *
 * That makes the access-control story strictly ours: /bookings/:id/join
 * decides who may enter and with what powers (roomAdmin = host controls),
 * and there is no bare room URL that could leak because there is no URL to
 * open — the client connects to the project's WebSocket host.
 *
 * Credentials come from platform_settings (ops Settings → Video Meetings),
 * falling back to env vars — same as every other integration.
 */

/** Narrow slice of RoomServiceClient — keeps the test seam identical to the other providers. */
export type LivekitService = {
	listParticipants(room: string): Promise<Array<{ joinedAt?: number | bigint }>>;
	deleteRoom(room: string): Promise<void>;
};

let injectedService: LivekitService | null = null;
let injectedCredentials: { url?: string; key?: string; secret?: string } | null = null;

/**
 * Test seam: stand in a fake RoomService (or `null` to restore the real
 * client). While installed, LiveKit counts as configured.
 */
export function setLivekitServiceForTests(service: LivekitService | null): void {
	injectedService = service;
}

/**
 * Test seam: fixed credentials (or `null` to restore settings/env lookup).
 * Needed because `env` is parsed once at module load — `vi.stubEnv` can't
 * reach it — and token minting exercises the real JWT path.
 */
export function setLivekitCredentialsForTests(
	creds: { url?: string; key?: string; secret?: string } | null,
): void {
	injectedCredentials = creds;
}

async function credentials(): Promise<{ url?: string; key?: string; secret?: string }> {
	if (injectedCredentials) return injectedCredentials;
	const [url, key, secret] = await Promise.all([
		getSetting("LIVEKIT_URL"),
		getSetting("LIVEKIT_API_KEY"),
		getSetting("LIVEKIT_API_SECRET"),
	]);
	return { url, key, secret };
}

/** Whether LiveKit is configured (or a fake service is installed). */
export async function livekitConnected(): Promise<boolean> {
	if (injectedService) return true;
	const { url, key, secret } = await credentials();
	return Boolean(url && key && secret);
}

/** The WebSocket host clients connect to — what /join returns as `url`. */
export async function livekitWsUrl(): Promise<string> {
	const { url } = await credentials();
	if (!url) throw new MeetNotConnectedError("LiveKit is not configured");
	return url;
}

/** RoomService speaks HTTP — the wss host translates to https. */
function httpHost(wsUrl: string): string {
	return wsUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
}

async function service(): Promise<LivekitService> {
	if (injectedService) return injectedService;
	const { url, key, secret } = await credentials();
	if (!url || !key || !secret) throw new MeetNotConnectedError("LiveKit is not configured");
	return new RoomServiceClient(httpHost(url), key, secret) as unknown as LivekitService;
}

/**
 * "Create" a room — nothing is provisioned. The room name is what the
 * token binds to; LiveKit materializes it on first join and deletes it
 * when the last participant leaves (idle rooms never accumulate).
 */
export async function createLivekitRoom(roomName: string): Promise<MeetingSpace> {
	if (!(await livekitConnected())) throw new MeetNotConnectedError("LiveKit is not configured");
	// Stored as meetingUrl: opaque on purpose — it is not an openable link,
	// joining is only possible through /bookings/:id/join.
	return { spaceId: roomName, meetingUri: `livekit://${roomName}`, meetingCode: roomName };
}

/**
 * Mint a join token for one person in one room.
 *
 * `roomJoin` + `room` scope it to this consultation only. `roomAdmin`
 * gives the host moderation powers (mute/remove participants) — the same
 * role Daily's is_owner token played. Identity/name show up in the call UI
 * roster. `ttl` bounds the token's validity to the slot window.
 */
export async function createLivekitToken(input: {
	roomName: string;
	identity: string;
	name?: string;
	isHost: boolean;
	ttlSeconds: number;
}): Promise<string> {
	const { key, secret } = await credentials();
	if (!key || !secret) throw new MeetNotConnectedError("LiveKit is not configured");
	const at = new AccessToken(key, secret, {
		identity: input.identity,
		name: input.name,
		ttl: input.ttlSeconds,
	});
	at.addGrant({
		roomJoin: true,
		room: input.roomName,
		roomAdmin: input.isHost,
		canPublish: true,
		canSubscribe: true,
		canPublishData: true,
	});
	const jwt = await at.toJwt();
	if (!jwt) throw new MeetUnavailableError("LiveKit token mint produced nothing");
	return jwt;
}

/** Live presence for the status poller — real participant list. */
export async function getLivekitPresence(roomName: string): Promise<MeetingStatus> {
	const svc = await service();
	const participants = await svc.listParticipants(roomName).catch((err) => {
		const message = err instanceof Error ? err.message : "LiveKit presence failed";
		// An empty/deleted room is not an error for our purposes — it's "no one is in".
		if (/not found|does not exist/i.test(message)) return [];
		throw new MeetUnavailableError(message);
	});
	const count = participants.length;
	const earliest = participants
		.map((p) => Number(p.joinedAt ?? NaN))
		.filter((t) => Number.isFinite(t) && t > 0)
		.sort((a, b) => a - b)[0];
	return {
		active: count > 0,
		participantCount: count,
		startedAt: earliest ? new Date(earliest * 1000) : null,
	};
}

/** Remove the room — kicks anyone inside and frees the name. Called on cancellation. */
export async function deleteLivekitRoom(roomName: string): Promise<void> {
	const svc = await service();
	await svc.deleteRoom(roomName);
}
