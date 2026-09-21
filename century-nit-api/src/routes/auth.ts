import { Hono } from "hono";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { emailOTP } from "better-auth/plugins/email-otp";
import { openAPI } from "better-auth/plugins";
import { eq, and, inArray } from "drizzle-orm";
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
import { welcomeEmail } from "../services/notifications.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { deleteClientUser } from "../services/clientUsers.js";
import { getAuthSettings, markMfaSessionPending } from "../services/auth-settings.js";

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
	/*
	 * The sign-in method toggles in Settings -> Authentication hold here, not
	 * only in the UI. A hidden button is a suggestion; this is the control.
	 * Which setting governs a password sign-in depends on whose account it is:
	 * an active staff email answers to ops.email_password, every other address
	 * to portal.email_password.
	 */
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== "/sign-in/email") return;
			const email =
				typeof (ctx.body as { email?: unknown } | undefined)?.email === "string"
					? (ctx.body as { email: string }).email.trim().toLowerCase()
					: "";
			if (!email) return;
			const [staff] = await db
				.select({ active: schema.opsUsers.active })
				.from(schema.opsUsers)
				.where(eq(schema.opsUsers.email, email))
				.limit(1);
			const settings = await getAuthSettings();
			if (staff?.active) {
				if (!settings["ops.email_password"]) {
					throw APIError.from("FORBIDDEN", {
						code: "METHOD_DISABLED",
						message:
							"Password sign-in is turned off for staff accounts. Use the method your administrator enabled, or ask them to re-enable it.",
					});
				}
			} else if (!settings["portal.email_password"]) {
				throw APIError.from("FORBIDDEN", {
					code: "METHOD_DISABLED",
					message: "Password sign-in is turned off. Use a code or Google to sign in.",
				});
			}
			// Lockout: derived from the audit stream — N failures inside the
			// window minted a lock row younger than lockoutMinutes, and only an
			// audited unlock event (or time) clears it.
			const { signInLockRemaining } = await import("../services/audit.js");
			const remaining = await signInLockRemaining(email);
			if (remaining > 0) {
				throw APIError.from("TOO_MANY_REQUESTS", {
					code: "ACCOUNT_LOCKED",
					message: `This account is locked after repeated failed sign-ins. Try again in ${Math.ceil(remaining / 60000)} min.`,
				});
			}
		}),
	},
	onAPIError: {
		// Failed sign-ins never reach session.create — they land here. Record
		// real credential failures only: METHOD_DISABLED and ACCOUNT_LOCKED are
		// policy rejections, not wrong passwords.
		onError: async (error, ctx) => {
			try {
				const path = (ctx as { path?: string } | null | undefined)?.path ?? "";
				if (path !== "/sign-in/email") return;
				const code = (error as { body?: { code?: string } } | null | undefined)?.body?.code ?? "";
				if (code === "METHOD_DISABLED" || code === "ACCOUNT_LOCKED") return;
				const emailRaw = (ctx as { body?: { email?: unknown } } | null | undefined)?.body?.email;
				const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
				if (!email) return;
				const { recordFailedSignIn } = await import("../services/audit.js");
				await recordFailedSignIn(
					email,
					(ctx as { headers?: Headers } | null | undefined)?.headers?.get("cf-connecting-ip")
						?? (ctx as { headers?: Headers } | null | undefined)?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim()
						?? null,
					(ctx as { headers?: Headers } | null | undefined)?.headers?.get("user-agent") ?? null,
				);
			} catch (err) {
				console.error("[auth] failed-sign-in audit error:", err);
			}
		},
	},
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

					// Fire-and-forget welcome email for real email addresses.
					try {
						if (
							u.email &&
							u.email.includes("@") &&
							!u.email.toLowerCase().endsWith("@phone.centurynit.local")
						) {
							const { queueEmails } = await import("../worker/queues.js");
							await queueEmails([
								welcomeEmail({
									name: u.name ?? undefined,
									email: u.email,
									portalUrl: env.FRONTEND_URL,
								}),
							]);
						}
					} catch (err) {
						console.error("[auth] welcome email failed:", err);
					}
				},
			},
		},
		session: {
			create: {
				/*
				 * Google sign-in on the OAuth callback path: staff accounts are
				 * refused outright — the console is credentials-only, and the
				 * ops.google_sso setting is locked false in the schema. Client
				 * accounts answer to portal.social_google. Enforced at session
				 * creation so it holds for new and previously linked accounts
				 * alike — an account.create hook would only ever see the first
				 * link.
				 */
				before: async (session, ctx) => {
					const path = (ctx as { path?: string } | null | undefined)?.path ?? "";
					if (!path.startsWith("/callback/")) return;
					const provider = path.split("/")[2];
					if (provider !== "google") return;
					const [u] = await db
						.select({ email: schema.users.email })
						.from(schema.users)
						.where(eq(schema.users.id, session.userId))
						.limit(1);
					const email = u?.email?.toLowerCase() ?? "";
					const [staff] = email
						? await db
								.select({ active: schema.opsUsers.active })
								.from(schema.opsUsers)
								.where(eq(schema.opsUsers.email, email))
								.limit(1)
						: [undefined];
					if (staff?.active) {
						throw APIError.from("FORBIDDEN", {
							code: "METHOD_DISABLED",
							message: "Staff accounts sign in with their Century NIT credentials, not Google.",
						});
					}
					const settings = await getAuthSettings();
					if (!settings["portal.social_google"]) {
						throw APIError.from("FORBIDDEN", {
							code: "METHOD_DISABLED",
							message: "Google sign-in is turned off.",
						});
					}
				},
				after: async (session, ctx) => {
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

							// Staff sign-ins go on the admin audit trail; portal sign-ins
							// are ordinary client activity, not console events.
							const staffRow = await db.query.opsUsers.findFirst({
								where: eq(schema.opsUsers.userId, u.id),
							});
							if (staffRow) {
								const { recordAdminEvent } = await import("../services/audit.js");
								await recordAdminEvent({
									category: "Authentication",
									action: `Signed in to the ops console`,
									actorId: staffRow.id,
									actorEmail: staffRow.email,
									target: "ops-console",
									ip: session.ipAddress ?? null,
									userAgent: session.userAgent ?? null,
								});
							}
						}
					} catch (err) {
						console.error("[CRM] Error in session create hook:", err);
					}

					/*
					 * OAuth sessions owe a second factor. The plugin's challenge only
					 * fires on credential paths — a Google callback mints the session
					 * without asking — so sessions created there are flagged
					 * mfa-pending, and requireAuth's staff gate refuses data until the
					 * challenge endpoint clears it. Credential sessions are never
					 * flagged: they either passed the challenge or had none to pass.
					 */
					try {
						const path = (ctx as { path?: string } | null | undefined)?.path ?? "";
						if (path.startsWith("/callback/")) {
							await markMfaSessionPending(session.token, session.expiresAt);
						}
					} catch (err) {
						console.error("[auth] mfa-pending session mark failed:", err);
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
			// The console must only reset passwords for staff, not portal
			// applicants. Staff identity lives in opsUsers; a reset email for
			// any other user would confuse applicants and confirm their
			// account exists to us, so block non-staff before sending.
			const staff = await db.query.opsUsers.findFirst({
				where: eq(schema.opsUsers.email, user.email),
			});
			if (!staff || !staff.active) {
				throw APIError.from("BAD_REQUEST", {
					code: "NOT_STAFF_ACCOUNT",
					message:
						"That email isn't linked to a Century NIT staff account, so no reset link was sent. Check for typos, or ask your administrator to invite you.",
				});
			}
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
			/**
			 * Social-only accounts hold no credential row, so a password check
			 * would permanently lock them out of enrolment. With this on, the
			 * plugin skips the password only for accounts that have none —
			 * password accounts still verify it. Sign-in challenges for
			 * passwordless users are handled by the mfa-ok session gate in
			 * requireAuth, because the plugin's hook only fires on credential
			 * sign-in paths, never on OAuth callbacks.
			 */
			allowPasswordless: true,
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

	let [staff] = await db
		.select()
		.from(schema.opsUsers)
		.where(eq(schema.opsUsers.userId, session.user.id))
		.limit(1);

	if (!staff && session.user.email) {
		const [byEmail] = await db
			.select()
			.from(schema.opsUsers)
			.where(eq(schema.opsUsers.email, session.user.email))
			.limit(1);
		if (byEmail) {
			await db
				.update(schema.opsUsers)
				.set({ userId: session.user.id, updatedAt: new Date() })
				.where(eq(schema.opsUsers.id, byEmail.id));
			staff = { ...byEmail, userId: session.user.id };
		}
	}

	const resolvedName =
		staff?.name?.trim() && !staff.name.includes("@")
			? staff.name.trim()
			: session.user.name?.trim() && !session.user.name.includes("@")
				? session.user.name.trim()
				: session.user.email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (w) => w.toUpperCase());

	return c.json({
		user: {
			id: session.user.id,
			email: session.user.email,
			name: resolvedName,
		},
		staff:
			staff && staff.active
				? {
						opsUserId: staff.id,
						role: staff.role,
						branch: staff.branch,
						name: resolvedName,
						email: staff.email,
					}
				: null,
	});
});

/**
 * Client-initiated account deletion.
 * If the user has paid/partial invoices, we archive the data to preserve financial records.
 * Otherwise, we completely purge the user data.
 */
auth.delete("/me/account", async (c) => {
	const authInstance = await getAuthInstance();
	const session = await authInstance.api.getSession({ headers: c.req.raw.headers });
	if (!session?.user) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	
	const userId = session.user.id;
	
	// Check if user has paid or partial invoices
	const paidInvoices = await db.query.invoices.findMany({
		where: and(
			eq(schema.invoices.clientUserId, userId),
			inArray(schema.invoices.status, ["paid", "partial"])
		),
		limit: 1
	});
	
	const action = paidInvoices.length > 0 ? "archive" : "purge";
	
	const result = await deleteClientUser(userId, action, session.user.name || session.user.email);
	
	return c.json({ success: result.success, action, storageErrors: result.storageErrors });
});

auth.post("/check-email", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body?.email || typeof body.email !== "string") {
		return c.json({ exists: false }, 400);
	}
	const email = body.email.trim().toLowerCase();
	const user = await db.query.users.findFirst({
		where: eq(schema.users.email, email),
	});
	if (user) return c.json({ exists: true });
	// Also check opsUsers so a dangling staff email (no linked users row)
	// is still reported as taken.
	const [staff] = await db
		.select({ id: schema.opsUsers.id })
		.from(schema.opsUsers)
		.where(eq(schema.opsUsers.email, email))
		.limit(1);
	return c.json({ exists: !!staff });
});

auth.use("*", rateLimit);

/**
 * Real-time staff check for the console forgot-password form.
 *
 * The console only resets passwords for staff (see `sendResetPassword`), so
 * this lets the form flag a non-staff address before the user submits. It
 * deliberately mirrors that gate — an `opsUsers` row that is active — and does
 * not consult `users`, so a portal applicant's email never reads as staff. It
 * is a UX aid only; the reset callback remains the authoritative check.
 */
auth.post("/check-staff-email", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body?.email || typeof body.email !== "string") {
		return c.json({ isStaff: false }, 400);
	}
	const email = body.email.trim().toLowerCase();
	const [staff] = await db
		.select({ id: schema.opsUsers.id, active: schema.opsUsers.active })
		.from(schema.opsUsers)
		.where(eq(schema.opsUsers.email, email))
		.limit(1);
	return c.json({ isStaff: Boolean(staff && staff.active) });
});

/**
 * Complete an email/password sign-up after the user has entered the OTP.
 *
 * The portal sends a "sign-in" type OTP to the email *before* any account
 * exists (the emailOTP plugin sends that type even for unknown addresses).
 * This endpoint verifies that OTP manually — `auth.api.verifyEmailOTP`
 * can't be used because it requires the user row to already exist — and
 * only then creates the user with a hashed password and `emailVerified`
 * already set to true. The account is never persisted for an unverified
 * email, which is what the sign-up flow requires.
 *
 * NB: the emailOTP plugin is configured with the default `storeOTP`
 * ("plain"), so the stored verification value is the raw OTP. If that
 * ever changes to "hashed" or "encrypted", this manual comparison must
 * be replaced with the plugin's own verification.
 */
auth.post("/complete-email-signup", async (c) => {
	const body = await c.req.json().catch(() => null);
	const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body?.password === "string" ? body.password : "";
	const name = typeof body?.name === "string" ? body.name.trim() : "";
	const otp = typeof body?.otp === "string" ? body.otp.trim() : "";

	if (!email || !password || !name || !otp) {
		return c.json({ error: "Missing required fields" }, 400);
	}
	if (password.length < 12) {
		return c.json({ error: "Password must be at least 12 characters" }, 400);
	}

	// 1. Verify the sign-in OTP. The identifier matches toOTPIdentifier("sign-in", email).
	const identifier = `sign-in-otp-${email}`;
	const [record] = await db
		.select()
		.from(schema.verifications)
		.where(eq(schema.verifications.identifier, identifier))
		.limit(1);

	if (!record || record.expiresAt < new Date()) {
		if (record) await db.delete(schema.verifications).where(eq(schema.verifications.id, record.id));
		return c.json({ error: "That code was not accepted. Request a new code." }, 400);
	}

	const colonIdx = record.value.lastIndexOf(":");
	const storedOtp = colonIdx === -1 ? record.value : record.value.slice(0, colonIdx);
	const attempts = colonIdx === -1 ? 0 : Number.parseInt(record.value.slice(colonIdx + 1) || "0", 10);
	const allowedAttempts = 3;

	if (Number.isNaN(attempts) || attempts >= allowedAttempts) {
		await db.delete(schema.verifications).where(eq(schema.verifications.id, record.id));
		return c.json({ error: "Too many attempts. Request a new code." }, 400);
	}

	if (storedOtp !== otp) {
		await db
			.update(schema.verifications)
			.set({ value: `${storedOtp}:${attempts + 1}` })
			.where(eq(schema.verifications.id, record.id));
		return c.json({ error: "That code was not accepted." }, 400);
	}

	// OTP is valid — consume it so it can't be reused.
	await db.delete(schema.verifications).where(eq(schema.verifications.id, record.id));

	// 2. Reject if an account already exists for this email.
	// Check opsUsers first so a staff email can't be used to create a
	// client login (even if the linked users row was deleted).
	const [existingStaff] = await db
		.select({ id: schema.opsUsers.id })
		.from(schema.opsUsers)
		.where(eq(schema.opsUsers.email, email))
		.limit(1);
	if (existingStaff) {
		return c.json({ error: "That address already belongs to a staff member. Sign in instead." }, 409);
	}

	const existing = await db.query.users.findFirst({
		where: eq(schema.users.email, email),
	});
	if (existing) {
		return c.json({ error: "An account with this email already exists. Sign in instead." }, 409);
	}

	// 3. Create the user with a hashed password. requireEmailVerification
	//    means signUpEmail returns a user without a session; we flip
	//    emailVerified to true immediately below because the OTP already
	//    proved ownership of the inbox.
	const authInstance = await getAuthInstance();
	try {
		await authInstance.api.signUpEmail({
			body: { email, password, name },
		});
	} catch {
		return c.json({ error: "Could not create account. Please try again." }, 400);
	}

	// 4. Mark the email verified.
	const [created] = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.email, email))
		.limit(1);
	if (created) {
		await db
			.update(schema.users)
			.set({ emailVerified: true })
			.where(eq(schema.users.id, created.id));
	}

	return c.json({
		user: created
			? { id: created.id, email: created.email, name: created.name }
			: null,
	});
});

function readCookie(headers: Headers, name: string): string | null {
	const header = headers.get("cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const eqIdx = part.indexOf("=");
		if (eqIdx < 0) continue;
		if (part.slice(0, eqIdx).trim() === name) return part.slice(eqIdx + 1).trim();
	}
	return null;
}

/**
 * Resolve the enrolled MFA method during the pending two-factor window.
 *
 * Password sign-in with a second factor armed defers the session behind a
 * signed `two_factor` cookie: its value is a verification identifier, and the
 * row's `value` is the user id — the same lookup `verify-totp` performs on
 * the same credential. That cookie is already proof the password passed, so
 * this route needs no session. It verifies the signature exactly as the
 * plugin does, then returns the enrolled method and a masked address so the
 * challenge screen can render the right input instead of guessing.
 *
 * 401 when the cookie is missing, forged or expired — callers fall back to
 * the TOTP challenge.
 */
auth.get("/mfa/method", async (c) => {
	const noPending = () => c.json({ error: "No pending two-factor sign-in" }, 401);

	const raw =
		readCookie(c.req.raw.headers, "better-auth.two_factor") ??
		readCookie(c.req.raw.headers, "__Secure-better-auth.two_factor");
	if (!raw) return noPending();

	// Cookie is `identifier.base64signature`, URL-encoded as a whole.
	const decoded = decodeURIComponent(raw);
	const sep = decoded.lastIndexOf(".");
	if (sep < 1) return noPending();
	const identifier = decoded.slice(0, sep);
	const signature = decoded.slice(sep + 1);

	// The same check better-call performs in getSignedCookie: HMAC-SHA256 of
	// the unsigned value, keyed on the auth secret, base64 signature.
	let signatureBytes: Uint8Array<ArrayBuffer>;
	try {
		const bin = atob(signature);
		signatureBytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) signatureBytes[i] = bin.charCodeAt(i);
	} catch {
		return noPending();
	}
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.BETTER_AUTH_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		signatureBytes,
		new TextEncoder().encode(identifier),
	);
	if (!valid) return noPending();

	const [record] = await db
		.select()
		.from(schema.verifications)
		.where(eq(schema.verifications.identifier, identifier))
		.limit(1);
	if (!record || record.expiresAt < new Date()) return noPending();

	const [user] = await db
		.select({
			email: schema.users.email,
			mfaMethod: schema.users.mfaMethod,
			twoFactorEnabled: schema.users.twoFactorEnabled,
		})
		.from(schema.users)
		.where(eq(schema.users.id, record.value))
		.limit(1);
	if (!user?.email) return noPending();

	const at = user.email.indexOf("@");
	const maskedEmail =
		at > 0
			? `${user.email.slice(0, Math.min(2, at))}***@${user.email.slice(at + 1)}`
			: user.email;

	return c.json({
		method: user.mfaMethod ?? (user.twoFactorEnabled ? "totp" : null),
		email: maskedEmail,
	});
});

auth.all("/*", async (c) => {
	return (await getAuthInstance()).handler(c.req.raw);
});

export { auth };
