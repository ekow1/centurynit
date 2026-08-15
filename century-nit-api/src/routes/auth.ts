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
import { sendEmail } from "../lib/resend.js";
import { getSmsSender } from "../lib/sms.js";

/**
 * Exported so middleware can read the session Better Auth already issues,
 * rather than a second auth system growing alongside it.
 */
export const authInstance = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	basePath: "/api/auth",
	trustedOrigins: [env.BETTER_AUTH_URL, env.FRONTEND_URL, env.CONSOLE_URL, "http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
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
	emailAndPassword: {
		enabled: true,
		/*
		 * 12 characters rather than the default 8. Staff accounts reach applicant
		 * PII and financial records, and a short password is the weakest link in a
		 * system that otherwise checks everything server-side.
		 */
		minPasswordLength: 12,
		sendResetPassword: async ({ user, url }) => {
			await sendEmail({
				to: user.email,
				subject: "Reset your Century NIT password",
				text: `Reset your password: ${url}\n\nIf you did not ask for this, ignore this email — your password is unchanged.`,
				html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p><p>If you did not ask for this, ignore this email — your password is unchanged.</p>`,
			});
		},
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
					await sendEmail({
						to: user.email,
						subject: "Your Century NIT verification code",
						text: `Your verification code is ${otp}. It expires in 3 minutes.`,
						html: `<p>Your verification code is <strong>${otp}</strong>.</p><p>It expires in 3 minutes.</p>`,
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
				await sendEmail({
					to: email,
					subject: `Your Century NIT code: ${otp}`,
					text: `Use ${otp} to ${purpose}. It expires in 10 minutes.`,
					html: `<p>Use <strong>${otp}</strong> to ${purpose}.</p><p>It expires in 10 minutes.</p>`,
				});
			},
		}),
	],
	// Only register Google when it is actually configured. Passing undefined
	// credentials advertises a provider that fails at the redirect instead.
	socialProviders:
		env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
			? {
					google: {
						clientId: env.GOOGLE_CLIENT_ID,
						clientSecret: env.GOOGLE_CLIENT_SECRET,
					},
				}
			: {},
});

const auth = new Hono();

/**
 * Returns the caller's session user and linked staff profile (if any).
 * The ops app uses this after sign-in to learn its role and branch.
 */
auth.get("/me", async (c) => {
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

auth.all("/*", async (c) => {
	return authInstance.handler(c.req.raw);
});

export { auth };
