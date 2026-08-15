// Must run before anything reads process.env. `dotenv` was already a dependency
// but was never imported, so century-nit-api/.env was silently ignored and every
// value fell through to its default.
import "dotenv/config";
import { z } from "zod";

/**
 * Environment configuration.
 *
 * Development defaults exist so `npm run dev` works against docker-compose with
 * no .env file. Those same defaults must never apply in production: a deploy
 * that forgets BETTER_AUTH_SECRET would otherwise boot happily and sign every
 * session token with a value that is committed to this repository.
 *
 * So the schema is built per-environment. In production the secrets have no
 * defaults and the process refuses to start without them.
 */

const isProduction = process.env.NODE_ENV === "production";

/** Applies a development-only default, leaving the field required in production. */
function devDefault<T extends z.ZodTypeAny>(schema: T, value: z.input<T>) {
	return isProduction ? schema : schema.default(value as never);
}

const schema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	PORT: z.string().default("3000"),

	// ── Required in production, defaulted for local docker-compose ──
	DATABASE_URL: devDefault(
		z.string().url(),
		"postgres://century:century@localhost:5433/century_nit",
	),
	REDIS_URL: devDefault(z.string().url(), "redis://localhost:6380"),
	BETTER_AUTH_SECRET: devDefault(
		z
			.string()
			.min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
			.refine(
				(v) => !isProduction || !/^(change-me|dev-only)/.test(v),
				"BETTER_AUTH_SECRET is still a placeholder. Generate one with: openssl rand -base64 48",
			),
		"dev-only-insecure-secret-do-not-use-in-production",
	),
	BETTER_AUTH_URL: devDefault(z.string().url(), "http://localhost:3000"),
	FRONTEND_URL: devDefault(z.string().url(), "http://localhost:5173"),

	/**
	 * Encrypts OAuth tokens at rest (lib/crypto.ts). Required in production for
	 * the same reason BETTER_AUTH_SECRET is: a committed default would mean every
	 * stored refresh token is decryptable by anyone with the source.
	 */
	ENCRYPTION_KEY: devDefault(
		z
			.string()
			.min(32, "ENCRYPTION_KEY must be at least 32 characters")
			.refine(
				(v) => !isProduction || !/^(change-me|dev-only)/.test(v),
				"ENCRYPTION_KEY is still a placeholder. Generate one with: openssl rand -base64 48",
			),
		"dev-only-insecure-encryption-key-not-for-production",
	),

	// ── Optional integrations — the app degrades gracefully without them ──
	RESEND_API_KEY: z.string().optional(),
	RESEND_FROM: z.string().email().default("noreply@centurynit.com"),
	R2_ENDPOINT: z.string().url().optional(),
	R2_ACCESS_KEY_ID: z.string().optional(),
	R2_SECRET_ACCESS_KEY: z.string().optional(),
	R2_BUCKET: z.string().default("century-nit"),

	/*
	 * Google Calendar / Meet. All optional: without them the scheduling feature
	 * still works end to end, but an assigned booking stays at
	 * calendarSyncStatus=PENDING instead of gaining a Meet link. Configure them
	 * and the queued sync job picks the booking up — nothing is lost meanwhile.
	 */
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	/** Must exactly match an authorised redirect URI in the Google Cloud console. */
	GOOGLE_REDIRECT_URI: z.string().url().optional(),
	/** Public HTTPS URL Google posts calendar change notifications to (§12). */
	GOOGLE_WEBHOOK_URL: z.string().url().optional(),
	/** Shared secret echoed in the webhook channel token, to reject forgeries. */
	GOOGLE_WEBHOOK_TOKEN: z.string().optional(),

	/**
	 * Enables the one-time super-admin bootstrap endpoint.
	 *
	 * Optional, and only useful once: the endpoint refuses as soon as any staff
	 * member exists. Remove it from the environment after setup.
	 */
	BOOTSTRAP_TOKEN: z.string().min(16).optional(),

	/** Minutes of protected gap either side of a booking. 0 disables buffers. */
	BOOKING_BUFFER_MINUTES: z.coerce.number().int().min(0).max(120).default(0),
	/** Default IANA zone for branches and working hours. */
	DEFAULT_TIMEZONE: z.string().default("Africa/Accra"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
	const details = parsed.error.issues
		.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
		.join("\n");
	console.error(
		`\nInvalid environment configuration (NODE_ENV=${process.env.NODE_ENV ?? "development"}):\n${details}\n\n` +
			`See century-nit-api/.env.example for the full list.\n`,
	);
	process.exit(1);
}

export const env = parsed.data;
