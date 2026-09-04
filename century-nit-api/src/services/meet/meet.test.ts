import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetAuthError, MeetNotConnectedError, MeetUnavailableError } from "./types.js";

/**
 * Covers the Google Meet service at the boundary, without needing real Google
 * credentials. The `googleapis` Meet client is mocked so tests assert the
 * service's own logic: idempotency, error classification, and space creation.
 */

// Mock the calendar index so `loadCompanyCredentials` returns a controlled
// account without touching the database or settings.
vi.mock("../calendar/index.js", () => ({
	loadCompanyCredentials: vi.fn(),
}));

// Mock the OAuth client — the Meet service only uses it to carry tokens.
vi.mock("../calendar/google.js", () => ({
	createOAuthClient: vi.fn(() => ({
		setCredentials: vi.fn(),
	})),
}));

// Mock googleapis — only the `meet` surface is used.
const spacesMock = {
	create: vi.fn(),
	get: vi.fn(),
	endActiveConference: vi.fn(),
};
vi.mock("googleapis", () => ({
	google: {
		meet: vi.fn(() => ({ spaces: spacesMock })),
	},
}));

import { createMeeting, getMeeting, getMeetingStatus, endMeeting, meetConnected } from "./index.js";
import { loadCompanyCredentials } from "../calendar/index.js";

const account = {
	credentials: {
		accessToken: "test-access",
		refreshToken: "test-refresh",
		accessTokenExpiresAt: new Date(Date.now() + 3600_000),
	},
	calendarId: "primary",
	accountEmail: "meetings@company.com",
};

describe("Google Meet service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(loadCompanyCredentials).mockResolvedValue(account);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("createMeeting", () => {
		it("creates a space and returns the meeting URI", async () => {
			spacesMock.create.mockResolvedValue({
				data: {
					name: "spaces/abc123",
					meetingUri: "https://meet.google.com/xxx-yyyy-zzz",
					meetingCode: "xxx-yyyy-zzz",
				},
			});

			const space = await createMeeting();
			expect(space.spaceId).toBe("spaces/abc123");
			expect(space.meetingUri).toBe("https://meet.google.com/xxx-yyyy-zzz");
			expect(space.meetingCode).toBe("xxx-yyyy-zzz");
			expect(spacesMock.create).toHaveBeenCalledWith({
				requestBody: { config: { accessType: "TRUSTED" } },
			});
		});

		it("falls back to default space creation if accessType TRUSTED is rejected with 400", async () => {
			spacesMock.create
				.mockRejectedValueOnce({ code: 400, message: "Invalid access type for consumer account" })
				.mockResolvedValueOnce({
					data: {
						name: "spaces/fallback123",
						meetingUri: "https://meet.google.com/aaa-bbbb-ccc",
						meetingCode: "aaa-bbbb-ccc",
					},
				});

			const space = await createMeeting();
			expect(space.spaceId).toBe("spaces/fallback123");
			expect(space.meetingUri).toBe("https://meet.google.com/aaa-bbbb-ccc");
			expect(spacesMock.create).toHaveBeenCalledTimes(2);
			expect(spacesMock.create).toHaveBeenLastCalledWith({ requestBody: {} });
		});

		it("throws MeetUnavailableError when Google returns no meeting URI", async () => {
			spacesMock.create.mockResolvedValue({ data: {} });
			await expect(createMeeting()).rejects.toBeInstanceOf(MeetUnavailableError);
		});

		it("throws MeetNotConnectedError when no company account is configured", async () => {
			vi.mocked(loadCompanyCredentials).mockResolvedValue(null);
			await expect(createMeeting()).rejects.toBeInstanceOf(MeetNotConnectedError);
		});

		it("classifies 401 as MeetAuthError", async () => {
			spacesMock.create.mockRejectedValue({ code: 401, message: "invalid_grant" });
			await expect(createMeeting()).rejects.toBeInstanceOf(MeetAuthError);
		});

		it("classifies 500 as MeetUnavailableError", async () => {
			spacesMock.create.mockRejectedValue({ code: 500, message: "server error" });
			await expect(createMeeting()).rejects.toBeInstanceOf(MeetUnavailableError);
		});
	});

	describe("getMeeting", () => {
		it("fetches a space by id", async () => {
			spacesMock.get.mockResolvedValue({
				data: {
					name: "spaces/abc123",
					meetingUri: "https://meet.google.com/xxx-yyyy-zzz",
					meetingCode: "xxx-yyyy-zzz",
				},
			});
			const space = await getMeeting("spaces/abc123");
			expect(space.spaceId).toBe("spaces/abc123");
			expect(spacesMock.get).toHaveBeenCalledWith({ name: "spaces/abc123" });
		});
	});

	describe("getMeetingStatus", () => {
		it("reports inactive when no one has joined", async () => {
			spacesMock.get.mockResolvedValue({
				data: { name: "spaces/abc123", meetingUri: "https://meet.google.com/xxx-yyyy-zzz" },
			});
			const status = await getMeetingStatus("spaces/abc123");
			expect(status.active).toBe(false);
			expect(status.participantCount).toBe(0);
			expect(status.startedAt).toBeNull();
			expect(spacesMock.get).toHaveBeenCalledWith({ name: "spaces/abc123" });
		});

		it("reports active when activeConference is populated", async () => {
			spacesMock.get.mockResolvedValue({
				data: {
					name: "spaces/abc123",
					meetingUri: "https://meet.google.com/xxx-yyyy-zzz",
					activeConference: { conferenceRecord: "conferenceRecords/xyz" },
				},
			});
			const status = await getMeetingStatus("spaces/abc123");
			expect(status.active).toBe(true);
			expect(status.participantCount).toBe(1);
		});

		it("throws MeetNotConnectedError when no company account is configured", async () => {
			vi.mocked(loadCompanyCredentials).mockResolvedValue(null);
			await expect(getMeetingStatus("spaces/abc123")).rejects.toBeInstanceOf(MeetNotConnectedError);
		});
	});

	describe("endMeeting", () => {
		it("ends the active conference", async () => {
			spacesMock.endActiveConference.mockResolvedValue({});
			await endMeeting("spaces/abc123");
			expect(spacesMock.endActiveConference).toHaveBeenCalledWith({
				name: "spaces/abc123",
				requestBody: {},
			});
		});
	});

	describe("meetConnected", () => {
		it("returns true when the company account is configured", async () => {
			expect(await meetConnected()).toBe(true);
		});

		it("returns false when no company account is configured", async () => {
			vi.mocked(loadCompanyCredentials).mockResolvedValue(null);
			expect(await meetConnected()).toBe(false);
		});
	});
});
