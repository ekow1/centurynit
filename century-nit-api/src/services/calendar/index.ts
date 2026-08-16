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
