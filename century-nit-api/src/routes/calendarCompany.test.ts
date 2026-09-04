import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../app.js";
import { env } from "../env.js";
import * as settings from "../services/settings.js";
import * as googleService from "../services/calendar/google.js";
import * as calendarIndex from "../services/calendar/index.js";

describe("GET /api/v1/calendar/callback", () => {
	const app = createApp();

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	function makeState(opsUserId = "user-123", ttlMs = 60_000, returnTo = "https://ops.example.com/settings") {
		const expiresAtMs = Date.now() + ttlMs;
		const safeReturn = Buffer.from(returnTo).toString("base64url");
		const payload = `${opsUserId}:${expiresAtMs}:${safeReturn}`;
		const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(payload)
			.digest("base64url");
		return `${Buffer.from(payload).toString("base64url")}.${signature}`;
	}

	it("returns 400 when code or state is missing", async () => {
		const res = await app.request("/api/v1/calendar/callback", {
			headers: { Accept: "application/json" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.title).toContain("Missing Parameters");
	});

	it("returns 400 when Google reports an error", async () => {
		const res = await app.request("/api/v1/calendar/callback?error=access_denied", {
			headers: { Accept: "application/json" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.title).toContain("Google Access Not Granted");
		expect(body.technicalDetails).toContain("access_denied");
	});

	it("returns 400 when state signature is invalid", async () => {
		const validState = makeState();
		const forgedState = `${validState.slice(0, 10)}fake${validState.slice(14)}`;
		const res = await app.request(`/api/v1/calendar/callback?code=test-code&state=${forgedState}`, {
			headers: { Accept: "application/json" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.title).toContain("Security Verification Failed");
	});

	it("returns 400 when state has expired", async () => {
		const expiredState = makeState("user-123", -10_000);
		const res = await app.request(`/api/v1/calendar/callback?code=test-code&state=${expiredState}`, {
			headers: { Accept: "application/json" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.title).toContain("Session Expired");
	});

	it("returns 400 with helpful guidance when Google returns redirect_uri_mismatch (does not throw 500)", async () => {
		const state = makeState();
		vi.spyOn(googleService, "googleConfigured").mockResolvedValue(true);
		// Mock OAuth client throwing redirect_uri_mismatch
		vi.spyOn(googleService, "createOAuthClient").mockResolvedValue({
			getToken: vi.fn().mockRejectedValue({
				response: {
					data: {
						error: "redirect_uri_mismatch",
						error_description: "Bad Request",
					},
				},
			}),
		} as any);

		const res = await app.request(`/api/v1/calendar/callback?code=4/test-code&state=${state}`, {
			headers: { Accept: "application/json" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.message).toContain("Redirect URI mismatch");
		expect(body.technicalDetails).toContain("redirect_uri_mismatch");
	});

	it("returns 400 with guidance when authorization code is invalid or expired (invalid_grant)", async () => {
		const state = makeState();
		vi.spyOn(googleService, "googleConfigured").mockResolvedValue(true);
		vi.spyOn(googleService, "createOAuthClient").mockResolvedValue({
			getToken: vi.fn().mockRejectedValue({
				response: {
					data: {
						error: "invalid_grant",
						error_description: "Malformed auth code.",
					},
				},
			}),
		} as any);

		const res = await app.request(`/api/v1/calendar/callback?code=bad-code&state=${state}`, {
			headers: { Accept: "application/json" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.message).toContain("expired or already used");
	});

	it("returns 200 on successful token exchange and persists company tokens", async () => {
		const state = makeState();
		vi.spyOn(googleService, "googleConfigured").mockResolvedValue(true);
		vi.spyOn(googleService, "createOAuthClient").mockResolvedValue({
			getToken: vi.fn().mockResolvedValue({
				tokens: {
					access_token: "ya29.test-access-token",
					refresh_token: "1//test-refresh-token",
					expiry_date: Date.now() + 3600_000,
				},
			}),
		} as any);

		const writeTokensSpy = vi.spyOn(calendarIndex, "writeCompanyTokens").mockResolvedValue(undefined);
		const writeSettingSpy = vi.spyOn(settings, "writeSettingSystem").mockResolvedValue(undefined);

		const res = await app.request(`/api/v1/calendar/callback?code=valid-code&state=${state}`, {
			headers: { Accept: "application/json" },
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.success).toBe(true);
		expect(body.title).toContain("Google Account Connected");
		expect(writeTokensSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				accessToken: "ya29.test-access-token",
				refreshToken: "1//test-refresh-token",
			}),
		);
		expect(writeSettingSpy).toHaveBeenCalledWith("GOOGLE_COMPANY_CALENDAR_ID", "primary");
	});

	it("reuses existing refresh token if Google omits refresh_token on reconnect", async () => {
		const state = makeState();
		vi.spyOn(googleService, "googleConfigured").mockResolvedValue(true);
		vi.spyOn(googleService, "createOAuthClient").mockResolvedValue({
			getToken: vi.fn().mockResolvedValue({
				tokens: {
					access_token: "ya29.reconnected-access-token",
					// No refresh_token returned by Google
					refresh_token: undefined,
					expiry_date: Date.now() + 3600_000,
				},
			}),
		} as any);

		vi.spyOn(settings, "getSetting").mockImplementation(async (key) => {
			if (key === "GOOGLE_COMPANY_REFRESH_TOKEN") return "existing-stored-refresh-token";
			return undefined;
		});

		const writeTokensSpy = vi.spyOn(calendarIndex, "writeCompanyTokens").mockResolvedValue(undefined);
		vi.spyOn(settings, "writeSettingSystem").mockResolvedValue(undefined);

		const res = await app.request(`/api/v1/calendar/callback?code=reconnect-code&state=${state}`, {
			headers: { Accept: "application/json" },
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.success).toBe(true);
		expect(writeTokensSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				accessToken: "ya29.reconnected-access-token",
				refreshToken: "existing-stored-refresh-token",
			}),
		);
	});

	it("renders styled HTML page when called by a browser (Accept: text/html)", async () => {
		const state = makeState();
		vi.spyOn(googleService, "googleConfigured").mockResolvedValue(true);
		vi.spyOn(googleService, "createOAuthClient").mockResolvedValue({
			getToken: vi.fn().mockResolvedValue({
				tokens: {
					access_token: "ya29.html-test",
					refresh_token: "1//refresh",
				},
			}),
		} as any);

		vi.spyOn(calendarIndex, "writeCompanyTokens").mockResolvedValue(undefined);
		vi.spyOn(settings, "writeSettingSystem").mockResolvedValue(undefined);

		const res = await app.request(`/api/v1/calendar/callback?code=html-code&state=${state}`, {
			headers: { Accept: "text/html,application/xhtml+xml" },
		});

		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("Google Account Connected");
		expect(html).toContain("Return to Operations Console");
	});
});
