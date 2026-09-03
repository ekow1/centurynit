import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { platformSettings, settingsAudit } from "../db/schema.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { env } from "../env.js";
import { timeToMinutes } from "../lib/time.js";

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
	| "GOOGLE_COMPANY_ACCOUNT_EMAIL"
	| "GOOGLE_COMPANY_CALENDAR_ID"
	| "GOOGLE_COMPANY_REFRESH_TOKEN"
	| "GOOGLE_COMPANY_ACCESS_TOKEN"
	| "GOOGLE_COMPANY_TOKEN_EXPIRES_AT"
	| "BOOKING_BUFFER_MINUTES"
	| "DEFAULT_TIMEZONE"
	| "SLOTS_PER_DAY"
	| "BRANCH_OPEN_START"
	| "BRANCH_OPEN_END"
	| "WEEKLY_SLOT_SCHEDULE"
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
	{ label: string; group: string; secret: boolean; description: string; hidden?: boolean }
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
	GOOGLE_COMPANY_ACCOUNT_EMAIL: {
		label: "Company Google Account Email",
		group: "Google Calendar",
		secret: false,
		description: "The company Google account that creates all consultation Meet links. Set automatically when you connect.",
	},
	GOOGLE_COMPANY_CALENDAR_ID: {
		label: "Company Calendar ID",
		group: "Google Calendar",
		secret: false,
		description: "Which calendar events are written to. Usually \"primary\". Set automatically when you connect.",
	},
	GOOGLE_COMPANY_REFRESH_TOKEN: {
		label: "Company Google Refresh Token",
		group: "Google Calendar",
		secret: true,
		hidden: true,
		description: "Long-lived OAuth refresh token. Managed by the OAuth callback — do not edit manually.",
	},
	GOOGLE_COMPANY_ACCESS_TOKEN: {
		label: "Company Google Access Token",
		group: "Google Calendar",
		secret: true,
		hidden: true,
		description: "Short-lived access token, auto-refreshed by the backend. Managed by the OAuth callback.",
	},
	GOOGLE_COMPANY_TOKEN_EXPIRES_AT: {
		label: "Company Token Expires At",
		group: "Google Calendar",
		secret: false,
		hidden: true,
		description: "ISO timestamp when the access token expires. Managed by the backend.",
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
	SLOTS_PER_DAY: {
		label: "Consultation Slots Per Day",
		group: "Scheduling",
		secret: false,
		description: "Number of appointment start times offered per branch per day. Times are auto-calculated across opening hours.",
	},
	BRANCH_OPEN_START: {
		label: "Branch Opening Time",
		group: "Scheduling",
		secret: false,
		description: "Opening time in HH:MM used to compute slot times. Example: 09:00.",
	},
	BRANCH_OPEN_END: {
		label: "Branch Closing Time",
		group: "Scheduling",
		secret: false,
		description: "Closing time in HH:MM used to compute slot times. Example: 17:00.",
	},
	WEEKLY_SLOT_SCHEDULE: {
		label: "Weekly Slot Schedule",
		group: "Scheduling",
		secret: false,
		description:
			"JSON weekly schedule: which days are active, how many slots per day, and opening/closing times. Managed from the Scheduling page.",
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

/** Number of consultation slots offered per branch per day. */
export async function slotsPerDay(): Promise<number> {
	const raw = await getSetting("SLOTS_PER_DAY");
	const parsed = Number(raw);
	if (raw == null || raw === "" || !Number.isFinite(parsed) || parsed < 1 || parsed > 48) {
		return env.SLOTS_PER_DAY;
	}
	return Math.floor(parsed);
}

/** Branch opening time in HH:MM. */
export async function branchOpenStart(): Promise<string> {
	const value = await getSetting("BRANCH_OPEN_START");
	return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : env.BRANCH_OPEN_START;
}

/** Branch closing time in HH:MM. */
export async function branchOpenEnd(): Promise<string> {
	const value = await getSetting("BRANCH_OPEN_END");
	return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : env.BRANCH_OPEN_END;
}

export type WeeklySlotScheduleGeneral = {
	/** Default opening time, HH:MM. Used by days with override=false. */
	openStart: string;
	/** Default closing time, HH:MM. */
	openEnd: string;
	/** Default minutes between slot start times. */
	intervalMinutes: number;
	/** Cap on slots per day. null or 0 = no cap. */
	maxSlotsPerDay: number | null;
};

export type WeeklySlotScheduleDay = {
	dayOfWeek: number;
	enabled: boolean;
	/**
	 * When true, this day uses its own openStart/openEnd/intervalMinutes/
	 * maxSlotsPerDay instead of the general template. When false, the day
	 * inherits from `general` (but `enabled` still controls open/closed).
	 */
	override: boolean;
	/** Day-specific opening time, HH:MM. Used only when override=true. */
	openStart: string;
	/** Day-specific closing time, HH:MM. */
	openEnd: string;
	/** Day-specific minutes between slot start times. */
	intervalMinutes: number;
	/** Day-specific cap on slots. null or 0 = no cap. */
	maxSlotsPerDay: number | null;
};

export type WeeklySlotSchedule = {
	timezone: string;
	/** Default values applied to every day with override=false. */
	general: WeeklySlotScheduleGeneral;
	days: WeeklySlotScheduleDay[];
};

/**
 * Resolve the effective slot values for a day — its own if override=true,
 * otherwise the general template. Consumers (availability, feeds, scheduling
 * preview) call this so there is one place that knows the inheritance rule.
 */
export function effectiveDayValues(
	day: WeeklySlotScheduleDay,
	general: WeeklySlotScheduleGeneral,
): {
	openStart: string;
	openEnd: string;
	intervalMinutes: number;
	maxSlotsPerDay: number | null;
} {
	if (day.override) {
		return {
			openStart: day.openStart,
			openEnd: day.openEnd,
			intervalMinutes: day.intervalMinutes,
			maxSlotsPerDay: day.maxSlotsPerDay,
		};
	}
	return {
		openStart: general.openStart,
		openEnd: general.openEnd,
		intervalMinutes: general.intervalMinutes,
		maxSlotsPerDay: general.maxSlotsPerDay,
	};
}

const generalSchema = z.object({
	openStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
	openEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
	intervalMinutes: z.number().int().min(5).max(480),
	maxSlotsPerDay: z.number().int().min(0).max(48).nullable(),
});

const weeklySlotScheduleSchema = z.object({
	timezone: z.string().min(1),
	general: generalSchema,
	days: z
		.array(
			z.object({
				dayOfWeek: z.number().int().min(0).max(6),
				enabled: z.boolean(),
				override: z.boolean(),
				openStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
				openEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
				intervalMinutes: z.number().int().min(5).max(480),
				maxSlotsPerDay: z.number().int().min(0).max(48).nullable(),
			}),
		)
		.length(7),
});

function defaultWeeklySlotSchedule(): WeeklySlotSchedule {
	const defaultInterval = Math.max(
		15,
		Math.floor((8 * 60) / Math.max(1, env.SLOTS_PER_DAY)),
	);
	return {
		timezone: env.DEFAULT_TIMEZONE,
		general: {
			openStart: env.BRANCH_OPEN_START,
			openEnd: env.BRANCH_OPEN_END,
			intervalMinutes: defaultInterval,
			maxSlotsPerDay: null,
		},
		days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
			dayOfWeek,
			enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
			// Days start non-overriding — they inherit from `general`. The admin
			// flips override=true on the days that need their own hours.
			override: false,
			openStart: env.BRANCH_OPEN_START,
			openEnd: env.BRANCH_OPEN_END,
			intervalMinutes: defaultInterval,
			maxSlotsPerDay: null,
		})),
	};
}

/** Whole-week branch slot schedule. Falls back to the legacy global settings. */
export async function weeklySlotSchedule(): Promise<WeeklySlotSchedule> {
	const raw = await getSetting("WEEKLY_SLOT_SCHEDULE");
	if (!raw) return defaultWeeklySlotSchedule();
	try {
		const parsed = JSON.parse(raw);
		/*
		 * Legacy schedules stored a branch-global openStart/openEnd and a
		 * per-day slotsPerDay count. Migrate to per-day start/end/interval:
		 * lift the global window onto every enabled day and convert the count
		 * to an interval (window / count). New writes always use the per-day
		 * shape.
		 */
		if (parsed && Array.isArray(parsed.days)) {
			/*
			 * Two legacy shapes need migrating:
			 *
			 *   1. v1 — branch-global openStart/openEnd + per-day slotsPerDay.
			 *   2. v2 — per-day openStart/openEnd/intervalMinutes, no general,
			 *           no override, no maxSlotsPerDay.
			 *
			 * Both are lifted into the v3 shape: a `general` template derived
			 * from the first enabled day (or env defaults), and every day
			 * marked override=true so existing per-day hours are preserved
			 * exactly. The admin can then switch days to inherit from general
			 * by toggling override off.
			 */
			if (!parsed.general) {
				const firstEnabled = parsed.days.find(
					(d: { enabled?: boolean; openStart?: string }) => d?.enabled && d.openStart,
				);
				const globalStart = parsed.openStart ?? firstEnabled?.openStart ?? env.BRANCH_OPEN_START;
				const globalEnd = parsed.openEnd ?? firstEnabled?.openEnd ?? env.BRANCH_OPEN_END;
				let globalInterval = firstEnabled?.intervalMinutes as number | undefined;
				if (!globalInterval) {
					const total = timeToMinutes(globalEnd) - timeToMinutes(globalStart);
					const count = (firstEnabled as { slotsPerDay?: number } | undefined)?.slotsPerDay ?? env.SLOTS_PER_DAY;
					globalInterval = total > 0 && count > 0 ? Math.max(5, Math.floor(total / count)) : 60;
				}
				parsed.general = {
					openStart: globalStart,
					openEnd: globalEnd,
					intervalMinutes: globalInterval,
					maxSlotsPerDay: null,
				};
			}
			for (const d of parsed.days) {
				if (d && typeof d.slotsPerDay === "number" && !d.intervalMinutes) {
					const total = timeToMinutes(d.openEnd ?? parsed.general.openEnd) - timeToMinutes(d.openStart ?? parsed.general.openStart);
					d.intervalMinutes = total > 0 && d.slotsPerDay > 0
						? Math.max(5, Math.floor(total / d.slotsPerDay))
						: parsed.general.intervalMinutes;
				}
				if (!d.openStart) d.openStart = parsed.general.openStart;
				if (!d.openEnd) d.openEnd = parsed.general.openEnd;
				if (d.override == null) d.override = true; // preserve existing per-day hours
				if (d.maxSlotsPerDay == null) d.maxSlotsPerDay = null;
				delete d.slotsPerDay;
			}
			delete parsed.openStart;
			delete parsed.openEnd;
		}
		return weeklySlotScheduleSchema.parse(parsed);
	} catch (err) {
		console.error("[Settings] Invalid WEEKLY_SLOT_SCHEDULE, falling back to defaults:", err);
		return defaultWeeklySlotSchedule();
	}
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

	return ALL_KEYS.filter((key) => !SETTING_DEFS[key].hidden).map((key) => {
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

/**
 * Write a setting on behalf of the system (OAuth callbacks, token refreshes)
 * where no human actor is present. `updatedBy` is null and the audit entry is
 * recorded with a "system" actor email so the trail is still complete.
 */
export async function writeSettingSystem(
	key: SettingKey,
	plaintext: string | null,
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
		.values({ key, encryptedValue, updatedBy: null })
		.onConflictDoUpdate({
			target: platformSettings.key,
			set: {
				encryptedValue,
				updatedBy: null,
				updatedAt: new Date(),
			},
		});

	await db.insert(settingsAudit).values({
		key,
		actorId: null,
		actorEmail: "system",
		oldValueMasked: oldMasked,
		newValueMasked: newMasked,
	});

	cache.set(key, plaintext);
}

function validateSettingValue(key: SettingKey, value: string | null): void {
	if (value == null) return;

	if (key === "SLOTS_PER_DAY") {
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > 48) {
			throw new Error("Slots per day must be a whole number between 1 and 48");
		}
	}

	if (key === "BRANCH_OPEN_START" || key === "BRANCH_OPEN_END") {
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
			throw new Error("Time must be in 24-hour HH:MM format");
		}
	}

	if (key === "WEEKLY_SLOT_SCHEDULE") {
		try {
			weeklySlotScheduleSchema.parse(JSON.parse(value));
		} catch (err) {
			throw new Error("Weekly slot schedule is invalid");
		}
	}

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
