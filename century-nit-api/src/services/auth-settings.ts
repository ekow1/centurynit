import { db } from "../db/index.js";
import { authSettings } from "../db/schema.js";

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
	"portal.mfa_required": true,
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
