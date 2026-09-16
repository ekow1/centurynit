import { afterEach, describe, expect, it } from "vitest";
import {
	createLivekitRoom,
	createLivekitToken,
	deleteLivekitRoom,
	getLivekitPresence,
	livekitConnected,
	setLivekitCredentialsForTests,
	setLivekitServiceForTests,
} from "./livekit.js";

/**
 * Token minting is pure JWT signing — no network — so it runs for real and
 * gets verified by decoding the payload. The RoomService boundary uses the
 * same injected-service seam as the other providers' fake clients.
 */

function decodeJwt(token: string): Record<string, unknown> {
	const [, payload] = token.split(".");
	return JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
}

describe("LiveKit provider", () => {
	afterEach(() => {
		setLivekitServiceForTests(null);
		setLivekitCredentialsForTests(null);
	});

	describe("livekitConnected", () => {
		it("is false without credentials or a fake", async () => {
			expect(await livekitConnected()).toBe(false);
		});

		it("is true while a fake service is installed", async () => {
			setLivekitServiceForTests({ listParticipants: async () => [], deleteRoom: async () => {} });
			expect(await livekitConnected()).toBe(true);
		});
	});

	describe("createLivekitRoom", () => {
		it("returns the room name with an opaque, non-openable URI", async () => {
			setLivekitServiceForTests({ listParticipants: async () => [], deleteRoom: async () => {} });
			const space = await createLivekitRoom("cnit-abc123");
			expect(space.spaceId).toBe("cnit-abc123");
			expect(space.meetingUri).toBe("livekit://cnit-abc123");
			expect(space.meetingCode).toBe("cnit-abc123");
		});

		it("refuses as not-connected without credentials", async () => {
			await expect(createLivekitRoom("cnit-x")).rejects.toThrow(/not configured/i);
		});
	});

	describe("createLivekitToken", () => {
		// `env` is parsed once at module load, so stubEnv can't reach it —
		// credentials go through the injected seam instead.
		function stubCreds() {
			setLivekitCredentialsForTests({
				url: "wss://test.livekit.cloud",
				key: "APIkeyTEST123",
				secret: "secretTESTsecretTESTsecretTEST",
			});
		}

		it("mints a JWT bound to the room, identity, and window", async () => {
			stubCreds();
			const token = await createLivekitToken({
				roomName: "cnit-room1",
				identity: "user-9",
				name: "Enoch",
				isHost: false,
				ttlSeconds: 3600,
			});
			const claims = decodeJwt(token) as {
				iss?: string; sub?: string; name?: string; exp?: number; iat?: number;
				video?: { room?: string; roomJoin?: boolean; roomAdmin?: boolean };
			};
			expect(claims.iss).toBe("APIkeyTEST123");
			expect(claims.sub).toBe("user-9");
			expect(claims.name).toBe("Enoch");
			expect(claims.video?.room).toBe("cnit-room1");
			expect(claims.video?.roomJoin).toBe(true);
			expect(claims.video?.roomAdmin).toBe(false);
			// The SDK writes only `exp` — tokens are valid from issuance, so
			// the join window is enforced by /join refusing to mint early.
			expect(claims.exp! - Date.now() / 1000).toBeGreaterThanOrEqual(3595);
			expect(claims.exp! - Date.now() / 1000).toBeLessThanOrEqual(3600);
		});

		it("marks the host with roomAdmin", async () => {
			stubCreds();
			const token = await createLivekitToken({
				roomName: "cnit-room1",
				identity: "staff-1",
				isHost: true,
				ttlSeconds: 600,
			});
			const claims = decodeJwt(token) as { video?: { roomAdmin?: boolean } };
			expect(claims.video?.roomAdmin).toBe(true);
		});

		it("produces tokens the project's own verifier accepts", async () => {
			stubCreds();
			const token = await createLivekitToken({
				roomName: "cnit-room1",
				identity: "user-9",
				isHost: false,
				ttlSeconds: 600,
			});
			// Round-trip through LiveKit's own verifier — the same check the
			// server runs on connect.
			const { TokenVerifier } = await import("livekit-server-sdk");
			const verifier = new TokenVerifier("APIkeyTEST123", "secretTESTsecretTESTsecretTEST");
			const grants = await verifier.verify(token);
			expect(grants.video?.room).toBe("cnit-room1");
			expect(grants.sub).toBe("user-9");
		});
	});

	describe("getLivekitPresence", () => {
		it("reports an empty room as inactive", async () => {
			setLivekitServiceForTests({ listParticipants: async () => [], deleteRoom: async () => {} });
			const status = await getLivekitPresence("cnit-x");
			expect(status).toEqual({ active: false, participantCount: 0, startedAt: null });
		});

		it("counts participants and reports the earliest join", async () => {
			setLivekitServiceForTests({
				listParticipants: async () => [{ joinedAt: 1700000100 }, { joinedAt: 1700000000 }],
				deleteRoom: async () => {},
			});
			const status = await getLivekitPresence("cnit-x");
			expect(status.active).toBe(true);
			expect(status.participantCount).toBe(2);
			expect(status.startedAt?.getTime()).toBe(1700000000 * 1000);
		});

		it("treats a deleted room as inactive, not an error", async () => {
			setLivekitServiceForTests({
				listParticipants: async () => { throw new Error("room not found"); },
				deleteRoom: async () => {},
			});
			const status = await getLivekitPresence("cnit-gone");
			expect(status.active).toBe(false);
		});
	});

	describe("deleteLivekitRoom", () => {
		it("deletes through the service", async () => {
			const calls: string[] = [];
			setLivekitServiceForTests({
				listParticipants: async () => [],
				deleteRoom: async (room) => { calls.push(room); },
			});
			await deleteLivekitRoom("cnit-x");
			expect(calls).toEqual(["cnit-x"]);
		});
	});
});
