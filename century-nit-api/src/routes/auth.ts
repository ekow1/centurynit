import { Hono } from "hono";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { emailOTP } from "better-auth/plugins/email-otp";
import { openAPI } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { toE164 } from "century-nit-shared";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { env } from "../env.js";
import { allowedOrigins } from "../lib/origins.js";
import { sendEmail } from "../lib/resend.js";
import { renderPasswordResetEmail, renderOtpEmail } from "../lib/email-templates.js";
import { getSmsSender } from "../lib/sms.js";
import { getSetting } from "../services/settings.js";
import { captureLeadFromUser } from "../services/leads.js";
import { rateLimit } from "../middleware/rate-limit.js";

/**
 * Exported so middleware can read the session Better Auth already issues,
 * rather than a second auth system growing alongside it.
 */
type GoogleSocialConfig = {
	clientId?: string;
	clientSecret?: string;
	callbackUrl?: string;
};

function callbackHost(callbackUrl: string | undefined): string | null {
	if (!callbackUrl) return null;
	try {
		const parsed = new URL(callbackUrl);
		if (parsed.pathname !== "/api/auth/callback/google" || parsed.search || parsed.hash) return null;
		return parsed.host;
	} catch {
		return null;
	}
}

function configuredHosts(callbackUrl: string | undefined): string[] {
	const hosts = new Set<string>();
	for (const origin of allowedOrigins) {
		try {
			hosts.add(new URL(origin).host);
		} catch {
			// allowedOrigins only contains validated URLs; preserve a safe fallback.
		}
	}
	const socialHost = callbackHost(callbackUrl);
	if (socialHost) hosts.add(socialHost);
	return [...hosts];
}

function createAuth(config: GoogleSocialConfig) {
	const socialHost = callbackHost(config.callbackUrl);
	const googleConfigured = Boolean(config.clientId && config.clientSecret && socialHost);

	return betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	/*
	 * The Web and Ops Workers pass their public host in trusted proxy headers.
	 * Resolve the callback from that host, so Google returns through the same
	 * Worker that initiated login and the session cookie stays first-party.
	 */
	baseURL: {
		allowedHosts: configuredHosts(config.callbackUrl),
		protocol: env.NODE_ENV === "production" ? "https" : "auto",
		fallback: env.BETTER_AUTH_URL,
	},
	basePath: "/api/auth",
	/*
	 * The same list Hono's CORS middleware uses (lib/origins.ts).
	 *
	 * This used to append localhost:5173, :5174 and :3000 unconditionally, so a
	 * production deployment accepted callback URLs pointing at a developer's own
	 * machine. Those origins are still present in development — they are just no
	 * longer compiled in.
	 */
	trustedOrigins: allowedOrigins,
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			user: schema.users,
			session: schema.sessions,
			account: schema.accounts,
			verification: schema.verifications,
			twoFactor: schema.twoFactors,
		},
	}),
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					const u = user as { id?: string; email: string; name?: string | null; phoneNumber?: string | null };
					await captureLeadFromUser(
						{
							id: u.id,
							email: u.email,
							name: u.name,
							phoneNumber: typeof u.phoneNumber === "string" ? u.phoneNumber : null,
						},
						"Account Registration",
					);
				},
			},
		},
		session: {
			create: {
				after: async (session) => {
					try {
						const u = await db.query.users.findFirst({
							where: eq(schema.users.id, session.userId),
						});
						if (u) {
							await captureLeadFromUser(
								{
									id: u.id,
									email: u.email,
									name: u.name,
									phoneNumber: u.phoneNumber,
								},
								"Portal Sign-In",
							);
						}
					} catch (err) {
						console.error("[CRM] Error in session create hook:", err);
					}
				},
			},
		},
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		/*
		 * 12 characters rather than the default 8. Staff accounts reach applicant
		 * PII and financial records, and a short password is the weakest link in a
		 * system that otherwise checks everything server-side.
		 */
		minPasswordLength: 12,
		sendResetPassword: async ({ user, url }) => {
			const { html, text } = renderPasswordResetEmail({
				name: user.name,
				resetUrl: url,
			});
			await sendEmail({
				to: user.email,
				subject: "Reset your Century NIT password",
				text,
				html,
			});
		},
		/*
		 * Email verification is handled by the emailOTP plugin (see below),
		 * which sends a 6-digit code the user enters in the portal — not a
		 * magic link. Keeping this callback as a no-op avoids a duplicate
		 * email; the portal requests the OTP via `emailOtp.sendVerificationOtp`
		 * immediately after sign-up returns without a session.
		 */
		sendVerificationEmail: async () => {},
	},

	/*
	 * Sign-in methods.
	 *
	 * Clients get every route in: password, phone, one-time codes and social.
	 * Staff use email + password and are then challenged for a second factor —
	 * their accounts exist only by invitation, so there is no sign-up path for
	 * them anywhere in this API.
	 */
	plugins: [
		/**
		 * Documents every auth route — the plugin routes below are served by Better
		 * Auth and so never appear in this app's own OpenAPI document. Reference UI
		 * at /api/auth/reference.
		 *
		 * Safe to include now that `lib/resend.ts` imports the Resend SDK lazily:
		 * the React server renderer that broke module loading came from there, not
		 * from here.
		 */
		openAPI(),

		/**
		 * TOTP — Google Authenticator, Authy, 1Password, any RFC 6238 app.
		 *
		 * Enforced for staff and optional for clients. That distinction is a
		 * property of the role, so it lives in `mfaRequiredForRole` and is checked
		 * by middleware rather than configured here; this plugin only provides the
		 * mechanism.
		 */
		twoFactor({
			issuer: "Century NIT",
			otpOptions: {
				async sendOTP({ user, otp }) {
					const { html, text } = renderOtpEmail({
						otp,
						purpose: "verify your identity",
						expiresMinutes: 3,
					});
					await sendEmail({
						to: user.email,
						subject: `Century NIT Verification Code: ${otp}`,
						text,
						html,
					});
				},
			},
		}),

		/**
		 * Phone number as an identity: sign up and sign in by SMS code.
		 *
		 * The delivery side is pluggable and unconfigured by default, so this
		 * refuses loudly instead of appearing to send a code that never arrives.
		 */
		phoneNumber({
			sendOTP: async ({ phoneNumber: to, code }) => {
				await getSmsSender().send({
					to,
					body: `${code} is your Century NIT verification code. It expires in 5 minutes.`,
				});
			},
			/** Normalise before storage so one person cannot become two accounts. */
			phoneNumberValidator: (value) => /^\+[1-9]\d{7,14}$/.test(toE164(value)),
			/**
			 * A verified phone is enough to sign in on its own, so it needs a user
			 * record. The placeholder address is unique per number and never
			 * emailed — the account is upgraded if they later add a real one.
			 */
			signUpOnVerification: {
				getTempEmail: (phone) => `${phone.replace(/\D/g, "")}@phone.centurynit.local`,
				getTempName: (phone) => phone,
			},
		}),

		/**
		 * Email one-time codes — passwordless sign-in, and the verification path
		 * for a new address.
		 */
		emailOTP({
			otpLength: 6,
			expiresIn: 10 * 60,
			async sendVerificationOTP({ email, otp, type }) {
				const purpose =
					type === "forget-password"
						? "reset your password"
						: type === "email-verification"
							? "verify your email address"
							: "sign in";
				const { html, text } = renderOtpEmail({
					otp,
					purpose,
					expiresMinutes: 10,
				});
				await sendEmail({
					to: email,
					subject: `Your Century NIT Code: ${otp}`,
					text,
					html,
				});
			},
		}),
	],
	// Only register Google when it is actually configured. Passing undefined
	// credentials advertises a provider that fails at the redirect instead.
	socialProviders:
		googleConfigured
			? {
					google: {
						clientId: config.clientId!,
						clientSecret: config.clientSecret!,
					},
				}
			: {},
});
}

const legacySocialCallback = `${env.FRONTEND_URL}/api/auth/callback/google`;
let authConfigFingerprint = "";

/**
 * Mutable only through getAuthInstance(): its credentials come from the
 * encrypted platform settings and refresh after the settings cache TTL.
 * Keeping this export preserves the typed direct API used by setup scripts.
 */
export let authInstance = createAuth({
	clientId: env.GOOGLE_AUTH_CLIENT_ID ?? env.GOOGLE_CLIENT_ID,
	clientSecret: env.GOOGLE_AUTH_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET,
	callbackUrl: env.GOOGLE_AUTH_REDIRECT_URI ?? legacySocialCallback,
});

/** Return Better Auth configured from the live Ops-managed Google Sign-In settings. */
export async function getAuthInstance() {
	const [configuredId, configuredSecret, configuredCallback] = await Promise.all([
		getSetting("GOOGLE_AUTH_CLIENT_ID"),
		getSetting("GOOGLE_AUTH_CLIENT_SECRET"),
		getSetting("GOOGLE_AUTH_REDIRECT_URI"),
	]);
	// Never mix a newly saved credential with a legacy fallback credential.
	// A partial UI save leaves Google sign-in disabled until all three values are
	// present, which is safer and much easier to diagnose than an invalid pair.
	const hasDedicatedConfig = Boolean(configuredId || configuredSecret || configuredCallback);
	const config: GoogleSocialConfig = hasDedicatedConfig
		? {
				clientId: configuredId,
				clientSecret: configuredSecret,
				callbackUrl: configuredCallback,
			}
		: {
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET,
				callbackUrl: legacySocialCallback,
			};
	const fingerprint = JSON.stringify(config);
	if (fingerprint !== authConfigFingerprint) {
		authInstance = createAuth(config);
		authConfigFingerprint = fingerprint;
	}
	return authInstance;
}

const auth = new Hono();

/**
 * Returns the caller's session user and linked staff profile (if any).
 * The ops app uses this after sign-in to learn its role and branch.
 */
auth.get("/me", async (c) => {
	const authInstance = await getAuthInstance();
	const session = await authInstance.api.getSession({ headers: c.req.raw.headers });
	if (!session?.user) {
		return c.json({ user: null, staff: null }, 200);
	}

	const [staff] = await db
		.select()
		.from(schema.opsUsers)
		.where(eq(schema.opsUsers.userId, session.user.id))
		.limit(1);

	return c.json({
		user: {
			id: session.user.id,
			email: session.user.email,
			name: session.user.name ?? null,
		},
		staff:
			staff && staff.active
				? {
						opsUserId: staff.id,
						role: staff.role,
						branch: staff.branch,
						name: staff.name,
						email: staff.email,
					}
				: null,
	});
});

auth.post("/check-email", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body?.email || typeof body.email !== "string") {
		return c.json({ exists: false }, 400);
	}
	const user = await db.query.users.findFirst({
		where: eq(schema.users.email, body.email.trim().toLowerCase()),
	});
	return c.json({ exists: !!user });
});

auth.use("*", rateLimit);

auth.all("/*", async (c) => {
	return (await getAuthInstance()).handler(c.req.raw);
});

export { auth };
