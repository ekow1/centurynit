import { db } from "../db/index.js";
import { platformSettings, settingsAudit } from "../db/schema.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { env } from "../env.js";

/**
 * Platform settings service.
 *
 * Integration credentials (Resend, Supabase Storage, Google OAuth) are stored
 * encrypted in `platform_settings` and managed from the ops UI. This service
 * reads them with an in-memory cache and falls back to environment variables
 * when a key is not set in the database — so the app works unchanged if the
 * DB has no settings yet, and env vars remain the source of truth for
 * infrastructure (DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY, etc.).
 *
 * Security:
 *   - Values are encrypted at rest with AES-256-GCM (lib/crypto.ts).
 *   - The cache holds decrypted values in memory only — never logged.
 *   - `mask()` produces a safe representation for the API/UI/audit log.
 *   - Only `super_admin` can write (enforced in the route, not here).
 */

export type SettingKey =
	| "RESEND_API_KEY"
	| "RESEND_FROM"
	| "SUPABASE_URL"
	| "SUPABASE_SERVICE_ROLE_KEY"
	| "SUPABASE_STORAGE_BUCKET"
	| "GOOGLE_CLIENT_ID"
	| "GOOGLE_CLIENT_SECRET"
	| "GOOGLE_REDIRECT_URI"
	| "GOOGLE_WEBHOOK_URL"
	| "GOOGLE_WEBHOOK_TOKEN"
	| "BOOKING_BUFFER_MINUTES"
	| "DEFAULT_TIMEZONE";

/** All keys this service manages, with metadata for the UI. */
export const SETTING_DEFS: Record<
	SettingKey,
	{ label: string; group: string; secret: boolean; description: string }
> = {
	RESEND_API_KEY: {
		label: "Resend API Key",
		group: "Email",
		secret: true,
		description: "Used to send transactional emails. Format: re_...",
	},
	RESEND_FROM: {
		label: "From Address",
		group: "Email",
		secret: false,
		description: "Sender email address. Must be a verified domain in Resend.",
	},
	SUPABASE_URL: {
		label: "Supabase URL",
		group: "Storage",
		secret: false,
		description: "Project URL, e.g. https://xxx.supabase.co",
	},
	SUPABASE_SERVICE_ROLE_KEY: {
		label: "Supabase Service Role Key",
		group: "Storage",
		secret: true,
		description: "Server-side key for document storage. Never expose to the browser.",
	},
	SUPABASE_STORAGE_BUCKET: {
		label: "Storage Bucket",
		group: "Storage",
		secret: false,
		description: "Bucket name for applicant document uploads.",
	},
	GOOGLE_CLIENT_ID: {
		label: "Google Client ID",
		group: "Google",
		secret: false,
		description: "OAuth 2.0 Client ID from Google Cloud Console.",
	},
	GOOGLE_CLIENT_SECRET: {
		label: "Google Client Secret",
		group: "Google",
		secret: true,
		description: "OAuth 2.0 Client Secret from Google Cloud Console.",
	},
	GOOGLE_REDIRECT_URI: {
		label: "Google Redirect URI",
		group: "Google",
		secret: false,
		description: "Must match an authorized redirect URI in Google Cloud Console.",
	},
	GOOGLE_WEBHOOK_URL: {
		label: "Google Calendar Webhook URL",
		group: "Google",
		secret: false,
		description: "Public HTTPS URL for Google Calendar change notifications.",
	},
	GOOGLE_WEBHOOK_TOKEN: {
		label: "Google Webhook Token",
		group: "Google",
		secret: true,
		description: "Shared secret echoed in the webhook channel token.",
	},
	BOOKING_BUFFER_MINUTES: {
		label: "Booking Buffer (minutes)",
		group: "Scheduling",
		secret: false,
		description: "Minutes of protected gap either side of a booking. 0 disables.",
	},
	DEFAULT_TIMEZONE: {
		label: "Default Timezone",
		group: "Scheduling",
		secret: false,
		description: "Default IANA zone for branches and working hours.",
	},
};

const ALL_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

/** In-memory cache of decrypted values. Null = unset (fall back to env). */
const cache = new Map<SettingKey, string | null>();
let cacheLoadedAt = 0;

/**
 * How long a cached value may be trusted before it is re-read.
 *
 * The cache was previously loaded once and kept forever, which is correct only
 * if one process ever reads these values. There are at least two — the API and
 * the background worker — and there can be several API replicas. A credential
 * saved from the ops console updated the cache of whichever process handled
 * that request; every other process kept serving the old value until it was
 * restarted, with nothing to indicate why.
 *
 * Thirty seconds is chosen against what these values are: integration
 * credentials, changed by hand, a few times in a system's life. Half a minute
 * of staleness after saving one is not a cost anybody notices, whereas "email
 * still uses the old key until you redeploy" very much is.
 *
 * Cross-process invalidation over Redis would be tighter and is not worth it
 * here: the read is one small indexed query per process per half-minute, and
 * this path must keep working when Redis does not.
 */
const CACHE_TTL_MS = 30_000;

async function loadCache(force = false): Promise<void> {
	if (!force && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return;

	const rows = await db.select().from(platformSettings);
	// Rebuilt rather than merged, so a key deleted from the table stops being
	// served from memory.
	cache.clear();
	for (const row of rows) {
		const key = row.key as SettingKey;
		if (!SETTING_DEFS[key]) continue;
		cache.set(key, row.encryptedValue ? decrypt(row.encryptedValue) : null);
	}
	cacheLoadedAt = Date.now();
}


/**
 * Read a setting value. Returns the DB value if set, else the env var fallback,
 * else undefined. Loads the cache on first call.
 */
export async function getSetting(key: SettingKey): Promise<string | undefined> {
	await loadCache();
	const dbValue = cache.get(key);
	if (dbValue != null) return dbValue;
	// Fall back to env var. `undefined` from env means "not configured".
	return env[key as keyof typeof env] as string | undefined;
}

/*
 * Typed accessors for the two settings that are not credentials.
 *
 * These appear in the ops Settings screen alongside the API keys, but every
 * consumer read `env.BOOKING_BUFFER_MINUTES` and `env.DEFAULT_TIMEZONE`
 * directly — so editing either one in the console did nothing at all, then or
 * ever, and there was no restart that would have made it take. An editable
 * field that cannot change anything is worse than no field.
 */

/** Protected gap either side of a booking, in minutes. */
export async function bookingBufferMinutes(): Promise<number> {
	const raw = await getSetting("BOOKING_BUFFER_MINUTES");
	const parsed = Number(raw);
	// A bad value must not silently become a zero buffer: that would quietly
	// double-book people, which is the exact thing the buffer exists to prevent.
	if (raw == null || raw === "" || !Number.isFinite(parsed) || parsed < 0) {
		return env.BOOKING_BUFFER_MINUTES;
	}
	return Math.floor(parsed);
}

/** Fallback IANA zone for branches and working hours. */
export async function defaultTimezone(): Promise<string> {
	const value = await getSetting("DEFAULT_TIMEZONE");
	return value && value.trim() ? value.trim() : env.DEFAULT_TIMEZONE;
}

/** Read all settings with masked values, for the UI. */
export async function listSettingsForDisplay(): Promise<
	Array<{
		key: SettingKey;
		label: string;
		group: string;
		secret: boolean;
		description: string;
		valueMasked: string | null;
		source: "database" | "env" | "unset";
		updatedAt: string | null;
	}>
> {
	await loadCache();
	const rows = await db
		.select({ key: platformSettings.key, updatedAt: platformSettings.updatedAt })
		.from(platformSettings);
	const updatedAtByKey = new Map(rows.map((r) => [r.key as SettingKey, r.updatedAt]));

	return ALL_KEYS.map((key) => {
		const def = SETTING_DEFS[key];
		const dbValue = cache.get(key);
		const envValue = env[key as keyof typeof env] as string | undefined;

		let value: string | null = null;
		let source: "database" | "env" | "unset" = "unset";

		if (dbValue != null) {
			value = dbValue;
			source = "database";
		} else if (envValue) {
			value = envValue;
			source = "env";
		}

		return {
			key,
			label: def.label,
			group: def.group,
			secret: def.secret,
			description: def.description,
			valueMasked: value ? mask(value, def.secret) : null,
			source,
			updatedAt: updatedAtByKey.get(key)?.toISOString() ?? null,
		};
	});
}

/**
 * Write a setting. Pass `null` to clear (revert to env fallback).
 * Records an audit entry with masked old/new values.
 */
export async function writeSetting(
	key: SettingKey,
	plaintext: string | null,
	actor: { opsUserId: string; email: string },
): Promise<void> {
	await loadCache();
	const def = SETTING_DEFS[key];
	if (!def) throw new Error(`Unknown setting key: ${key}`);

	const oldValue = cache.get(key) ?? null;
	const oldMasked = oldValue ? mask(oldValue, def.secret) : null;
	const newMasked = plaintext ? mask(plaintext, def.secret) : null;

	const encryptedValue = plaintext ? encrypt(plaintext) : null;

	await db
		.insert(platformSettings)
		.values({ key, encryptedValue, updatedBy: actor.opsUserId })
		.onConflictDoUpdate({
			target: platformSettings.key,
			set: {
				encryptedValue,
				updatedBy: actor.opsUserId,
				updatedAt: new Date(),
			},
		});

	await db.insert(settingsAudit).values({
		key,
		actorId: actor.opsUserId,
		actorEmail: actor.email,
		oldValueMasked: oldMasked,
		newValueMasked: newMasked,
	});

	/*
	 * This process sees its own write at once; the others pick it up within the
	 * cache TTL. The immediate update matters because the ops console reloads
	 * the settings list right after saving, and reading back the old value would
	 * look like the save had failed.
	 */
	cache.set(key, plaintext);
}

/** Recent audit entries, newest first. */
export async function getAuditLog(limit = 50): Promise<
	Array<{
		id: string;
		key: string;
		actorEmail: string | null;
		oldValueMasked: string | null;
		newValueMasked: string | null;
		at: string;
	}>
> {
	const rows = await db
		.select()
		.from(settingsAudit)
		.orderBy(settingsAudit.at)
		.limit(limit);
	return rows
		.reverse()
		.map((r) => ({
			id: r.id,
			key: r.key,
			actorEmail: r.actorEmail,
			oldValueMasked: r.oldValueMasked,
			newValueMasked: r.newValueMasked,
			at: r.at.toISOString(),
		}));
}

/**
 * Mask a value for display. Secrets show first 3 + last 4 chars; non-secrets
 * show in full. Short values are fully masked.
 */
export function mask(value: string, secret: boolean): string {
	if (!secret) return value;
	if (value.length <= 8) return "••••••••";
	return `${value.slice(0, 3)}••••••••${value.slice(-4)}`;
}

/** Clear the in-memory cache. Used by tests. */
export function clearSettingsCache(): void {
	cache.clear();
	cacheLoadedAt = 0;
}
