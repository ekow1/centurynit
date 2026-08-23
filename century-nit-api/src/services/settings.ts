import { desc } from "drizzle-orm";
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
	| "GOOGLE_AUTH_CLIENT_ID"
	| "GOOGLE_AUTH_CLIENT_SECRET"
	| "GOOGLE_AUTH_REDIRECT_URI"
	| "GOOGLE_WEBHOOK_URL"
	| "GOOGLE_WEBHOOK_TOKEN"
	| "BOOKING_BUFFER_MINUTES"
	| "DEFAULT_TIMEZONE"
	| "PAYSTACK_SECRET_KEY"
	| "STRIPE_SECRET_KEY"
	| "APP_BASE_FEE_CENTS"
	| "APP_PER_SCHOOL_FEE_CENTS"
	| "APP_DOC_VERIFY_FEE_CENTS"
	| "APP_MATCH_REVIEW_FEE_CENTS"
	| "VISA_BASE_FEE_CENTS"
	| "VISA_BIOMETRICS_FEE_CENTS"
	| "VISA_TRANSLATION_FEE_CENTS"
	| "CONSULTATION_FEE_CENTS"
	| "TRAVEL_COORDINATION_FEE_CENTS"
	| "HOUSING_ASSISTANCE_FEE_CENTS"
	| "PRE_DEPARTURE_BRIEFING_FEE_CENTS";


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
		label: "Google Calendar Client ID",
		group: "Google Calendar",
		secret: false,
		description: "OAuth 2.0 client ID used to connect staff calendars.",
	},
	GOOGLE_CLIENT_SECRET: {
		label: "Google Calendar Client Secret",
		group: "Google Calendar",
		secret: true,
		description: "OAuth 2.0 client secret used to connect staff calendars.",
	},
	GOOGLE_REDIRECT_URI: {
		label: "Google Calendar Callback URL",
		group: "Google Calendar",
		secret: false,
		description: "Must end in /api/v1/calendar/callback and match Google Cloud Console.",
	},
	GOOGLE_AUTH_CLIENT_ID: {
		label: "Google Sign-In Client ID",
		group: "Google Sign-In",
		secret: false,
		description: "OAuth 2.0 client ID used for applicant Google sign-in.",
	},
	GOOGLE_AUTH_CLIENT_SECRET: {
		label: "Google Sign-In Client Secret",
		group: "Google Sign-In",
		secret: true,
		description: "OAuth 2.0 client secret used for applicant Google sign-in.",
	},
	GOOGLE_AUTH_REDIRECT_URI: {
		label: "Google Sign-In Callback URL",
		group: "Google Sign-In",
		secret: false,
		description: "Must end in /api/auth/callback/google and match Google Cloud Console.",
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
	PAYSTACK_SECRET_KEY: {
		label: "Paystack Secret Key",
		group: "Payments",
		secret: true,
		description:
			"Server-side Paystack key used to open and verify applicant invoice checkouts. Starts with sk_live_ or sk_test_.",
	},
	STRIPE_SECRET_KEY: {
		label: "Stripe Secret Key",
		group: "Payments",
		secret: true,
		description:
			"Server-side Stripe key used for international USD/GBP card checkouts. Starts with sk_live_ or sk_test_.",
	},
	APP_BASE_FEE_CENTS: {
		label: "Application Base Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Application processing base fee in USD cents. Default: 35000 ($350).",
	},
	APP_PER_SCHOOL_FEE_CENTS: {
		label: "Per-School Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Per-university application fee in USD cents. Default: 10000 ($100).",
	},
	APP_DOC_VERIFY_FEE_CENTS: {
		label: "Document Verification Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Document verification and courier fee in USD cents. Default: 4000 ($40).",
	},
	APP_MATCH_REVIEW_FEE_CENTS: {
		label: "Match Review Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Course matching and credit evaluation fee in USD cents. Default: 3000 ($30).",
	},
	VISA_BASE_FEE_CENTS: {
		label: "Visa Base Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Visa processing base fee in USD cents. Default: 35000 ($350).",
	},
	VISA_BIOMETRICS_FEE_CENTS: {
		label: "Visa Biometrics Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Visa biometrics appointment booking fee in USD cents. Default: 4000 ($40).",
	},
	VISA_TRANSLATION_FEE_CENTS: {
		label: "Visa Translation Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Document translation assistance fee in USD cents. Default: 3000 ($30).",
	},
	CONSULTATION_FEE_CENTS: {
		label: "Consultation Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Initial consultation fee in USD cents. Default: 7500 ($75).",
	},
	TRAVEL_COORDINATION_FEE_CENTS: {
		label: "Travel Coordination Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Flight and travel booking assistance fee in USD cents. Default: 5000 ($50).",
	},
	HOUSING_ASSISTANCE_FEE_CENTS: {
		label: "Housing Assistance Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Student housing and accommodation guidance fee in USD cents. Default: 10000 ($100).",
	},
	PRE_DEPARTURE_BRIEFING_FEE_CENTS: {
		label: "Pre-Departure Briefing Fee (cents)",
		group: "Fee Schedule",
		secret: false,
		description: "Pre-departure and airport arrival support fee in USD cents. Default: 4000 ($40).",
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

	try {
		const rows = await db.select().from(platformSettings);
		// Rebuilt rather than merged, so a key deleted from the table stops being
		// served from memory.
		cache.clear();
		for (const row of rows) {
			const key = row.key as SettingKey;
			if (!SETTING_DEFS[key]) continue;
			if (!row.encryptedValue) {
				cache.set(key, null);
				continue;
			}
			try {
				cache.set(key, decrypt(row.encryptedValue));
			} catch (decErr) {
				console.warn(`[Settings] Failed to decrypt setting '${key}', falling back to env/default:`, decErr);
				cache.set(key, null);
			}
		}
		cacheLoadedAt = Date.now();
	} catch (dbErr) {
		console.error("[Settings] Failed to read platform_settings table:", dbErr);
	}
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
	validateSettingValue(key, plaintext);

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

function validateSettingValue(key: SettingKey, value: string | null): void {
	if (value == null) return;

	if (key === "GOOGLE_REDIRECT_URI" || key === "GOOGLE_AUTH_REDIRECT_URI") {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			throw new Error("Enter a valid HTTPS callback URL");
		}

		if (url.protocol !== "https:" && env.NODE_ENV === "production") {
			throw new Error("Google callback URLs must use HTTPS in production");
		}

		const expectedPath =
			key === "GOOGLE_AUTH_REDIRECT_URI"
				? "/api/auth/callback/google"
				: "/api/v1/calendar/callback";
		if (url.pathname !== expectedPath || url.search || url.hash) {
			throw new Error(`Callback URL must be exactly ${expectedPath}`);
		}
	}
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
		.orderBy(desc(settingsAudit.at))
		.limit(limit);
	return rows
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
