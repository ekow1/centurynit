import { db } from "../db/index.js";
import { authSettings, verifications } from "../db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Auth configuration settings.
 *
 * Key-value store for admin-configurable auth options (portal login methods,
 * MFA methods, Google SSO toggle). Keys follow dot-notation:
 *   portal.email_password, portal.social_google, portal.email_otp,
 *   portal.mfa_required, portal.mfa_methods,
 *   ops.email_password, ops.google_sso, ops.mfa_required, ops.mfa_methods
 *
 * Defaults are applied in code so the system works without any DB rows.
 * Only admin/manager can write (enforced in the route, not here).
 */

export type AuthSettingsKey =
	| "portal.email_password"
	| "portal.social_google"
	| "portal.email_otp"
	| "portal.mfa_required"
	| "portal.mfa_methods"
	| "ops.email_password"
	| "ops.google_sso"
	| "ops.mfa_required"
	| "ops.mfa_methods";

export type AuthSettings = Record<AuthSettingsKey, boolean | string[]>;

const DEFAULTS: AuthSettings = {
	"portal.email_password": true,
	"portal.social_google": true,
	"portal.email_otp": true,
	/*
	 * Optional for clients. `requireMfa` only gates staff roles, so a `true`
	 * here enforced nothing and merely made the portal claim MFA was mandatory
	 * while letting every unenrolled user straight through.
	 */
	"portal.mfa_required": false,
	"portal.mfa_methods": ["totp", "email_otp"],
	"ops.email_password": true,
	"ops.google_sso": false,
	"ops.mfa_required": true,
	"ops.mfa_methods": ["totp", "email_otp"],
};

/** Cache TTL in ms — 5 minutes. */
const CACHE_TTL = 5 * 60 * 1000;
let cache: { settings: AuthSettings; at: number } | null = null;

export async function getAuthSettings(): Promise<AuthSettings> {
	if (cache && Date.now() - cache.at < CACHE_TTL) {
		return cache.settings;
	}

	const rows = await db.select().from(authSettings);
	const settings = { ...DEFAULTS };
	for (const row of rows) {
		const key = row.key as AuthSettingsKey;
		settings[key] = row.value as boolean | string[];
	}

	cache = { settings, at: Date.now() };
	return settings;
}

export async function updateAuthSetting(
	key: AuthSettingsKey,
	value: boolean | string[],
	updatedBy: string | null,
): Promise<void> {
	await db
		.insert(authSettings)
		.values({ key, value, updatedBy })
		.onConflictDoUpdate({
			target: authSettings.key,
			set: { value, updatedBy, updatedAt: new Date() },
		});
	// Invalidate cache
	cache = null;
}

/** Convenience helpers for common checks. */

export async function isPortalMethodEnabled(method: "email_password" | "social_google" | "email_otp"): Promise<boolean> {
	const settings = await getAuthSettings();
	return settings[`portal.${method}`] as boolean;
}

export async function isPortalMfaRequired(): Promise<boolean> {
	const settings = await getAuthSettings();
	return settings["portal.mfa_required"] as boolean;
}

export async function getPortalMfaMethods(): Promise<string[]> {
	const settings = await getAuthSettings();
	return settings["portal.mfa_methods"] as string[];
}

export async function isOpsGoogleSsoEnabled(): Promise<boolean> {
	const settings = await getAuthSettings();
	return settings["ops.google_sso"] as boolean;
}

export async function getOpsMfaMethods(): Promise<string[]> {
	const settings = await getAuthSettings();
	return settings["ops.mfa_methods"] as string[];
}

/* ── Passwordless MFA session gate ─────────────────────────────────────────
 *
 * A social-only account (no credential row) enrolled in email-otp MFA can
 * never be challenged by the twoFactor plugin — its sign-in hook only matches
 * credential paths (`/sign-in/email` et al), never OAuth callbacks. The gate
 * is therefore ours: requireAuth demands an `mfa-ok:{token}` record before a
 * passwordless session with email-otp enrolled may call the API. The record
 * dies with the session, so every new sign-in asks for a fresh code.
 */

const mfaOkIdentifier = (sessionToken: string) => `mfa-ok:${sessionToken}`;

/** Whether this session token has already passed the email-code gate. */
export async function mfaSessionOk(sessionToken: string): Promise<boolean> {
	const [row] = await db
		.select({ expiresAt: verifications.expiresAt })
		.from(verifications)
		.where(eq(verifications.identifier, mfaOkIdentifier(sessionToken)))
		.limit(1);
	return Boolean(row && new Date(row.expiresAt) > new Date());
}

/** Mark the session as having passed the gate — valid until it expires. */
export async function markMfaSessionOk(sessionToken: string, expiresAt: Date): Promise<void> {
	await db.delete(verifications).where(eq(verifications.identifier, mfaOkIdentifier(sessionToken)));
	await db.insert(verifications).values({
		id: crypto.randomUUID(),
		identifier: mfaOkIdentifier(sessionToken),
		value: "1",
		expiresAt,
	});
	// Passing the gate also settles a pending OAuth challenge on this session.
	await clearMfaSessionPending(sessionToken);
}

/* ── OAuth MFA gate ────────────────────────────────────────────────────────
 *
 * The twoFactor plugin's challenge only fires on credential sign-in paths —
 * an OAuth callback mints a session with no second factor asked. Sessions
 * created on `/callback/*` are therefore marked `mfa-pending`, and requireAuth
 * refuses staff data until the challenge endpoint clears it. Gating on the
 * marker's presence — rather than the absence of an mfa-ok record — means
 * sessions minted before this existed, and every credential sign-in, are
 * untouched: only OAuth-arriving sessions ever owe a factor.
 */

const mfaPendingIdentifier = (sessionToken: string) => `mfa-pending:${sessionToken}`;

/** Whether this session was minted by OAuth and still owes a factor. */
export async function mfaSessionPending(sessionToken: string): Promise<boolean> {
	const [row] = await db
		.select({ expiresAt: verifications.expiresAt })
		.from(verifications)
		.where(eq(verifications.identifier, mfaPendingIdentifier(sessionToken)))
		.limit(1);
	return Boolean(row && new Date(row.expiresAt) > new Date());
}

/** Flag an OAuth-created session as owing a second factor. */
export async function markMfaSessionPending(sessionToken: string, expiresAt: Date): Promise<void> {
	await db.delete(verifications).where(eq(verifications.identifier, mfaPendingIdentifier(sessionToken)));
	await db.insert(verifications).values({
		id: crypto.randomUUID(),
		identifier: mfaPendingIdentifier(sessionToken),
		value: "1",
		expiresAt,
	});
}

/** Clear the pending flag — the session answered its challenge. */
export async function clearMfaSessionPending(sessionToken: string): Promise<void> {
	await db.delete(verifications).where(eq(verifications.identifier, mfaPendingIdentifier(sessionToken)));
}
