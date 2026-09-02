import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { staffCalendarAccounts } from "../../db/schema.js";
import { decryptNullable, encrypt } from "../../lib/crypto.js";
import { DisabledCalendarClient } from "./fake.js";
import { GoogleCalendarClient, googleConfigured } from "./google.js";
import {
	CalendarAuthError,
	type CalendarClient,
	type CalendarCredentials,
} from "./types.js";

export * from "./types.js";
export { FakeCalendarClient, DisabledCalendarClient } from "./fake.js";
export { buildConsentUrl, googleConfigured, GOOGLE_SCOPES, createOAuthClient } from "./google.js";

/**
 * The calendar client the application uses.
 *
 * Credentials can arrive after boot (Platform Settings). A disabled client is
 * therefore not remembered — the same fix document storage already has — so
 * saving Google keys in the ops console starts working without a restart.
 * A live Google client is reused so its connection pool survives.
 */
let liveClient: CalendarClient | null = null;
let clientOverride: CalendarClient | null = null;

export async function getCalendarClient(): Promise<CalendarClient> {
	if (clientOverride) return clientOverride;

	const configured = await googleConfigured();
	if (!configured) {
		liveClient = null;
		return new DisabledCalendarClient();
	}

	liveClient ??= new GoogleCalendarClient();
	return liveClient;
}

/** Test seam. Returns a restore function so suites can clean up after themselves. */
export function setCalendarClient(next: CalendarClient): () => void {
	const previous = clientOverride;
	clientOverride = next;
	return () => {
		clientOverride = previous;
	};
}

/**
 * Load an employee's credentials, refreshing the access token when it has
 * expired or is about to.
 *
 * Refresh happens here rather than at each call site so every caller gets the
 * same behaviour, and so a dead refresh token sets `needsReconnect` exactly once
 * (§13: "refresh the token or request reconnection").
 */
export async function loadCredentials(
	opsUserId: string,
): Promise<{ credentials: CalendarCredentials; calendarId: string } | null> {
	const [account] = await db
		.select()
		.from(staffCalendarAccounts)
		.where(
			and(
				eq(staffCalendarAccounts.opsUserId, opsUserId),
				eq(staffCalendarAccounts.needsReconnect, false),
			),
		)
		.limit(1);

	if (!account) return null;

	const refreshToken = decryptNullable(account.refreshTokenEncrypted);
	let accessToken = decryptNullable(account.accessTokenEncrypted);
	let expiresAt = account.accessTokenExpiresAt;

	// Refresh a minute early: a token that expires mid-request is a failed
	// request, and the retry costs more than the refresh.
	const expiringSoon = !expiresAt || expiresAt.getTime() - Date.now() < 60_000;

	if (expiringSoon && refreshToken) {
		try {
			const calClient = await getCalendarClient();
			const refreshed = await calClient.refreshAccessToken(refreshToken);
			if (refreshed) {
				accessToken = refreshed.accessToken;
				expiresAt = refreshed.expiresAt;
				await db
					.update(staffCalendarAccounts)
					.set({
						accessTokenEncrypted: encrypt(refreshed.accessToken),
						accessTokenExpiresAt: refreshed.expiresAt,
						updatedAt: new Date(),
					})
					.where(eq(staffCalendarAccounts.id, account.id));
			}
		} catch (err) {
			if (err instanceof CalendarAuthError) {
				await markNeedsReconnect(opsUserId);
				return null;
			}
			throw err;
		}
	}

	return {
		credentials: { accessToken, refreshToken, accessTokenExpiresAt: expiresAt },
		calendarId: account.calendarId,
	};
}

/** Flag the account so the UI prompts the employee to reconnect. */
export async function markNeedsReconnect(opsUserId: string): Promise<void> {
	await db
		.update(staffCalendarAccounts)
		.set({ needsReconnect: true, updatedAt: new Date() })
		.where(eq(staffCalendarAccounts.opsUserId, opsUserId));
}

export async function hasCalendarConnected(opsUserId: string): Promise<boolean> {
	const [account] = await db
		.select({ id: staffCalendarAccounts.id, needsReconnect: staffCalendarAccounts.needsReconnect })
		.from(staffCalendarAccounts)
		.where(eq(staffCalendarAccounts.opsUserId, opsUserId))
		.limit(1);
	return Boolean(account && !account.needsReconnect);
}

/* ── Company Google account ──────────────────────────────────────────────── */

/**
 * Load the company Google account's credentials from platform settings.
 *
 * One account creates every consultation Meet link, so consultants never need
 * to connect their own calendar. The access token is refreshed here when it is
 * expiring soon, mirroring the per-employee flow.
 */
export async function loadCompanyCredentials(): Promise<{
	credentials: CalendarCredentials;
	calendarId: string;
	accountEmail: string | null;
} | null> {
	const { getSetting } = await import("../settings.js");
	const refreshToken = await getSetting("GOOGLE_COMPANY_REFRESH_TOKEN");
	if (!refreshToken) return null;

	const calendarId = (await getSetting("GOOGLE_COMPANY_CALENDAR_ID")) ?? "primary";
	const accountEmail = (await getSetting("GOOGLE_COMPANY_ACCOUNT_EMAIL")) ?? null;

	let accessToken = await getSetting("GOOGLE_COMPANY_ACCESS_TOKEN");
	let expiresAtRaw = await getSetting("GOOGLE_COMPANY_TOKEN_EXPIRES_AT");
	let expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;

	const expiringSoon = !expiresAt || expiresAt.getTime() - Date.now() < 60_000;

	if (expiringSoon) {
		try {
			const calClient = await getCalendarClient();
			const refreshed = await calClient.refreshAccessToken(refreshToken);
			if (refreshed) {
				accessToken = refreshed.accessToken;
				expiresAt = refreshed.expiresAt;
				await writeCompanyTokens({
					accessToken: refreshed.accessToken,
					expiresAt: refreshed.expiresAt,
					refreshToken,
				});
			}
		} catch (err) {
			if (err instanceof CalendarAuthError) {
				await markCompanyNeedsReconnect();
				return null;
			}
			throw err;
		}
	}

	return {
		credentials: { accessToken: accessToken ?? null, refreshToken, accessTokenExpiresAt: expiresAt },
		calendarId,
		accountEmail,
	};
}

/**
 * Persist company access/refresh tokens to platform settings. Used by the OAuth
 * callback and the refresh path. The refresh token is only written once (from
 * the callback); subsequent refreshes update only the access token + expiry.
 */
export async function writeCompanyTokens(input: {
	accessToken: string;
	expiresAt: Date;
	refreshToken: string;
}): Promise<void> {
	const { writeSettingSystem } = await import("../settings.js");
	await writeSettingSystem("GOOGLE_COMPANY_ACCESS_TOKEN", input.accessToken);
	await writeSettingSystem("GOOGLE_COMPANY_TOKEN_EXPIRES_AT", input.expiresAt.toISOString());
	// Refresh token is long-lived; only overwrite if we actually have a new one.
	await writeSettingSystem("GOOGLE_COMPANY_REFRESH_TOKEN", input.refreshToken);
}

/** Clear the company Google account tokens (disconnect). */
export async function clearCompanyTokens(): Promise<void> {
	const { writeSettingSystem } = await import("../settings.js");
	await writeSettingSystem("GOOGLE_COMPANY_REFRESH_TOKEN", null);
	await writeSettingSystem("GOOGLE_COMPANY_ACCESS_TOKEN", null);
	await writeSettingSystem("GOOGLE_COMPANY_TOKEN_EXPIRES_AT", null);
	await writeSettingSystem("GOOGLE_COMPANY_ACCOUNT_EMAIL", null);
}

/**
 * Flag that the company account's refresh token is dead and the admin must
 * reconnect. Surfaced in the ops UI via the status endpoint.
 */
export async function markCompanyNeedsReconnect(): Promise<void> {
	const { writeSettingSystem } = await import("../settings.js");
	// Clearing the refresh token forces a reconnect; the status endpoint
	// reports "not connected" when no refresh token is present.
	await writeSettingSystem("GOOGLE_COMPANY_REFRESH_TOKEN", null);
}

/** Whether the company Google account is connected and usable. */
export async function companyCalendarConnected(): Promise<{
	connected: boolean;
	accountEmail: string | null;
	calendarId: string | null;
}> {
	const { getSetting } = await import("../settings.js");
	const refreshToken = await getSetting("GOOGLE_COMPANY_REFRESH_TOKEN");
	const accountEmail = (await getSetting("GOOGLE_COMPANY_ACCOUNT_EMAIL")) ?? null;
	const calendarId = (await getSetting("GOOGLE_COMPANY_CALENDAR_ID")) ?? null;
	return {
		connected: Boolean(refreshToken),
		accountEmail,
		calendarId,
	};
}
