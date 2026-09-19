import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeetNotConnectedError, MeetUnavailableError } from "./types.js";
import {
	createDailyRoom,
	createMeetingToken,
	dailyConnected,
	deleteDailyRoom,
	getDailyPresence,
	setDailyFetchForTests,
	type DailyFetch,
} from "./daily.js";

/**
 * Covers the Daily provider at its REST boundary. `setDailyFetchForTests`
 * swaps in a fake transport so tests assert what we send Daily — private
 * rooms, slot-bound expiry, room-bound tokens — without an API key.
 */

type Call = { path: string; init?: { method?: string; body?: unknown } };

function fakeDaily(handler: (call: Call) => unknown) {
	const calls: Call[] = [];
	const fetchImpl: DailyFetch = async (path, init) => {
		const call = { path, init };
		calls.push(call);
		return handler(call);
	};
	return { calls, fetchImpl };
}

describe("Daily provider", () => {
	afterEach(() => {
		setDailyFetchForTests(null);
	});

	describe("dailyConnected", () => {
		it("is false without an API key or a fake", async () => {
			expect(await dailyConnected()).toBe(false);
		});

		it("is true while a fake transport is installed", async () => {
			setDailyFetchForTests(async () => ({}));
			expect(await dailyConnected()).toBe(true);
		});
	});

	describe("createDailyRoom", () => {
		it("creates a private room bound to the slot window", async () => {
			const { calls, fetchImpl } = fakeDaily(() => ({ name: "cnit-9k2x", url: "https://centurynit.daily.co/cnit-9k2x" }));
			setDailyFetchForTests(fetchImpl);

			const nbf = new Date("2026-09-18T09:45:00Z");
			const exp = new Date("2026-09-18T12:45:00Z");
			const room = await createDailyRoom({ notBefore: nbf, expiresAt: exp });

			expect(room.spaceId).toBe("cnit-9k2x");
			expect(room.meetingUri).toBe("https://centurynit.daily.co/cnit-9k2x");
			expect(calls[0]).toEqual({
				path: "/rooms",
				init: {
					method: "POST",
					body: {
						privacy: "private",
						properties: {
							exp: Math.floor(exp.getTime() / 1000),
							nbf: Math.floor(nbf.getTime() / 1000),
							enable_prejoin_ui: false,
							enable_knocking: false,
						},
					},
				},
			});
		});

		it("throws when Daily returns no URL", async () => {
			setDailyFetchForTests(async () => ({ name: "cnit-x" }));
			await expect(createDailyRoom({ expiresAt: new Date() })).rejects.toBeInstanceOf(MeetUnavailableError);
		});
	});

	describe("getDailyPresence", () => {
		it("maps an empty presence to inactive", async () => {
			setDailyFetchForTests(async () => ({ total_count: 0, data: [] }));
			const status = await getDailyPresence("cnit-9k2x");
			expect(status).toEqual({ active: false, participantCount: 0, startedAt: null });
		});

		it("reports a real participant count and earliest join", async () => {
			setDailyFetchForTests(async () => ({
				total_count: 2,
				data: [{ join_time: "2026-09-18T10:02:00Z" }, { join_time: "2026-09-18T10:00:30Z" }],
			}));
			const status = await getDailyPresence("cnit-9k2x");
			expect(status.active).toBe(true);
			expect(status.participantCount).toBe(2);
			expect(status.startedAt?.toISOString()).toBe("2026-09-18T10:00:30.000Z");
		});
	});

	describe("createMeetingToken", () => {
		it("binds the token to the room, the person, and the slot", async () => {
			const { calls, fetchImpl } = fakeDaily(() => ({ token: "mtok_abc" }));
			setDailyFetchForTests(fetchImpl);

			const nbf = new Date("2026-09-18T09:45:00Z");
			const exp = new Date("2026-09-18T12:45:00Z");
			const token = await createMeetingToken({
				roomName: "cnit-9k2x",
				isOwner: true,
				userName: "Ama Owusu",
				userId: "user_1",
				notBefore: nbf,
				expiresAt: exp,
			});

			expect(token).toBe("mtok_abc");
			expect(calls[0]).toEqual({
				path: "/meeting-tokens",
				init: {
					method: "POST",
					body: {
						properties: {
							room_name: "cnit-9k2x",
							is_owner: true,
							user_name: "Ama Owusu",
							user_id: "user_1",
							exp: Math.floor(exp.getTime() / 1000),
							nbf: Math.floor(nbf.getTime() / 1000),
						},
					},
				},
			});
		});

		it("never mints an owner token for a client join", async () => {
			const { calls, fetchImpl } = fakeDaily(() => ({ token: "mtok_client" }));
			setDailyFetchForTests(fetchImpl);
			await createMeetingToken({ roomName: "cnit-9k2x", isOwner: false, expiresAt: new Date() });
			const body = calls[0].init?.body as { properties: Record<string, unknown> };
			expect(body.properties.is_owner).toBe(false);
			expect(body.properties.room_name).toBe("cnit-9k2x");
		});
	});

	describe("deleteDailyRoom", () => {
		it("deletes the room outright", async () => {
			const { calls, fetchImpl } = fakeDaily(() => null);
			setDailyFetchForTests(fetchImpl);
			await deleteDailyRoom("cnit-9k2x");
			expect(calls[0]).toEqual({ path: "/rooms/cnit-9k2x", init: { method: "DELETE" } });
		});
	});
});

describe("Daily without a key", () => {
	beforeEach(() => {
		setDailyFetchForTests(null);
	});

	it("refuses as not-connected rather than calling out", async () => {
		await expect(createDailyRoom({ expiresAt: new Date() })).rejects.toBeInstanceOf(MeetNotConnectedError);
	});
});
