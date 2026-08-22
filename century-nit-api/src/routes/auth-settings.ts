import { OpenAPIHono } from "@hono/zod-openapi";
import {
	updateAuthSettingsSchema,
	enrollMfaSchema,
} from "century-nit-shared";
import { requireAuth, requireModule, requireStaff } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getAuthInstance } from "./auth.js";
import {
	getAuthSettings,
	updateAuthSetting,
} from "../services/auth-settings.js";
import { sendEmail } from "../lib/resend.js";
import { renderOtpEmail } from "../lib/email-templates.js";

const authSettings = new OpenAPIHono();

/* ── GET /auth-settings/portal — PUBLIC portal-facing auth settings ────────
 * The login screen needs to know which sign-in methods an admin has enabled
 * (email/password, Google, OTP) BEFORE the user is authenticated. The
 * staff-gated `GET /` returns the ops settings too, which must never be
 * public. This endpoint exposes only the portal subset, unauthenticated. */
authSettings.get("/portal", async (c) => {
	const raw = await getAuthSettings();
	return c.json({
		portal: {
			email_password: raw["portal.email_password"],
			social_google: raw["portal.social_google"],
			email_otp: raw["portal.email_otp"],
			mfa_required: raw["portal.mfa_required"],
			mfa_methods: raw["portal.mfa_methods"],
		},
	});
});

/* ── GET /auth-settings — read all settings ──────────────────────────────── */

authSettings.get(
	"/",
	requireAuth,
	requireStaff,
	requireModule("auth"),
	async (c) => {
		const raw = await getAuthSettings();

		return c.json({
			portal: {
				email_password: raw["portal.email_password"],
				social_google: raw["portal.social_google"],
				email_otp: raw["portal.email_otp"],
				mfa_required: raw["portal.mfa_required"],
				mfa_methods: raw["portal.mfa_methods"],
			},
			ops: {
				email_password: raw["ops.email_password"],
				google_sso: raw["ops.google_sso"],
				mfa_required: raw["ops.mfa_required"],
				mfa_methods: raw["ops.mfa_methods"],
			},
		});
	},
);

/* ── PUT /auth-settings — update settings ────────────────────────────────── */

authSettings.put(
	"/",
	requireAuth,
	requireStaff,
	requireModule("auth"),
	async (c) => {
		const staff = c.get("staff");
		const body = await c.req.json();
		const parsed = updateAuthSettingsSchema.safeParse(body);
		if (!parsed.success) {
			throw new HttpError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input");
		}

		const updates = parsed.data;
		const staffId = staff!.opsUserId;

		// Update portal settings
		if (updates.portal) {
			if (updates.portal.email_password !== undefined) {
				await updateAuthSetting("portal.email_password", updates.portal.email_password, staffId);
			}
			if (updates.portal.social_google !== undefined) {
				await updateAuthSetting("portal.social_google", updates.portal.social_google, staffId);
			}
			if (updates.portal.email_otp !== undefined) {
				await updateAuthSetting("portal.email_otp", updates.portal.email_otp, staffId);
			}
			if (updates.portal.mfa_required !== undefined) {
				await updateAuthSetting("portal.mfa_required", updates.portal.mfa_required, staffId);
			}
			if (updates.portal.mfa_methods !== undefined) {
				await updateAuthSetting("portal.mfa_methods", updates.portal.mfa_methods, staffId);
			}
		}

		// Update ops settings
		if (updates.ops) {
			if (updates.ops.google_sso !== undefined) {
				await updateAuthSetting("ops.google_sso", updates.ops.google_sso, staffId);
			}
			if (updates.ops.mfa_methods !== undefined) {
				await updateAuthSetting("ops.mfa_methods", updates.ops.mfa_methods, staffId);
			}
		}

		// Return updated settings
		const raw = await getAuthSettings();
		return c.json({
			portal: {
				email_password: raw["portal.email_password"],
				social_google: raw["portal.social_google"],
				email_otp: raw["portal.email_otp"],
				mfa_required: raw["portal.mfa_required"],
				mfa_methods: raw["portal.mfa_methods"],
			},
			ops: {
				email_password: raw["ops.email_password"],
				google_sso: raw["ops.google_sso"],
				mfa_required: raw["ops.mfa_required"],
				mfa_methods: raw["ops.mfa_methods"],
			},
		});
	},
);

/* ── GET /auth-settings/mfa — current user's MFA enrollment status ───────── */

authSettings.get(
	"/mfa",
	requireAuth,
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff");

		const [dbUser] = await db
			.select({
				twoFactorEnabled: users.twoFactorEnabled,
				mfaMethod: users.mfaMethod,
				mfaEnrolled: users.mfaEnrolled,
			})
			.from(users)
			.where(eq(users.id, user.id))
			.limit(1);

		const settings = await getAuthSettings();
		const isStaff = Boolean(staff);
		const mfaRequired = isStaff
			? (settings["ops.mfa_required"] as boolean)
			: (settings["portal.mfa_required"] as boolean);
		const availableMethods = isStaff
			? (settings["ops.mfa_methods"] as string[])
			: (settings["portal.mfa_methods"] as string[]);

		// Determine the effective enrolled state
		// For TOTP users: twoFactorEnabled is true
		// For email_otp users: mfaEnrolled is true
		const enrolled = Boolean(dbUser?.mfaEnrolled || dbUser?.twoFactorEnabled);
		const method = dbUser?.mfaMethod ?? (dbUser?.twoFactorEnabled ? "totp" : null);

		return c.json({
			enrolled,
			method,
			required: mfaRequired,
			availableMethods,
		});
	},
);

/* ── POST /auth-settings/mfa/enroll — choose and set up MFA method ───────── */

authSettings.post(
	"/mfa/enroll",
	requireAuth,
	async (c) => {
		const user = c.get("user");
		const body = await c.req.json();
		const parsed = enrollMfaSchema.safeParse(body);
		if (!parsed.success) {
			throw new HttpError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input");
		}

		const { method, password } = parsed.data;

		// Verify password by attempting a Better Auth operation
		const authInstance = await getAuthInstance();

		if (method === "totp") {
			// Enable TOTP via Better Auth's twoFactor plugin
			// First verify password by enabling 2FA (it requires password)
			const result = await authInstance.api.enableTwoFactor({
				body: { password },
				headers: c.req.raw.headers,
			});

			if (!result) {
				throw new HttpError(400, "MFA_ENROLL_FAILED", "Could not enable TOTP. Check your password.");
			}

			// Update user record
			await db
				.update(users)
				.set({ mfaMethod: "totp", mfaEnrolled: true })
				.where(eq(users.id, user.id));

			return c.json({
				totpURI: (result as { totpURI?: string }).totpURI ?? "",
				backupCodes: (result as { backupCodes?: string[] }).backupCodes ?? [],
			});
		}

		if (method === "email_otp") {
			// For email OTP, we just need to verify the password and mark as enrolled
			// Generate a verification code and send it to confirm the email works
			const code = Math.floor(100000 + Math.random() * 900000).toString();
			const identifier = `mfa-enroll:${user.id}`;

			// Store in verifications table
			const { verifications } = await import("../db/schema.js");
			// Clear any stale enrollment code so the latest one is the only one
			await db.delete(verifications).where(eq(verifications.identifier, identifier));
			await db.insert(verifications).values({
				id: crypto.randomUUID(),
				identifier,
				value: code,
				expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
			});

			// Send the code
			const { html, text } = renderOtpEmail({
				otp: code,
				purpose: "confirm email MFA setup",
				expiresMinutes: 10,
			});
			await sendEmail({
				to: user.email,
				subject: `Your Century NIT MFA Code: ${code}`,
				text,
				html,
			});

			return c.json({
				message: "Verification code sent to your email",
				email: user.email,
			});
		}

		throw new HttpError(400, "INVALID_METHOD", "Invalid MFA method. Use 'totp' or 'email_otp'.");
	},
);

/* ── POST /auth-settings/mfa/confirm — confirm email OTP enrollment ──────── */

authSettings.post(
	"/mfa/confirm",
	requireAuth,
	async (c) => {
		const user = c.get("user");
		const body = await c.req.json();
		const code = body?.code;

		if (!code || typeof code !== "string") {
			throw new HttpError(400, "VALIDATION_ERROR", "Enter the 6-digit code from your email");
		}

		const identifier = `mfa-enroll:${user.id}`;
		const { verifications } = await import("../db/schema.js");

		const [record] = await db
			.select()
			.from(verifications)
			.where(eq(verifications.identifier, identifier))
			.limit(1);

		if (!record) {
			throw new HttpError(400, "MFA_ENROLL_FAILED", "No verification code pending. Request a new one.");
		}

		if (new Date(record.expiresAt) < new Date()) {
			await db.delete(verifications).where(eq(verifications.identifier, identifier));
			throw new HttpError(400, "MFA_ENROLL_FAILED", "Code expired. Request a new one.");
		}

		if (record.value !== code.trim()) {
			throw new HttpError(400, "MFA_ENROLL_FAILED", "Incorrect code. Check your email and try again.");
		}

		// Code verified — mark MFA as enrolled
		await db.delete(verifications).where(eq(verifications.identifier, identifier));
		await db
			.update(users)
			.set({ mfaMethod: "email_otp", mfaEnrolled: true })
			.where(eq(users.id, user.id));

		return c.json({ success: true });
	},
);

/* ── POST /auth-settings/mfa/send-otp — send OTP for email MFA verification ─ */

authSettings.post(
	"/mfa/send-otp",
	requireAuth,
	async (c) => {
		const user = c.get("user");
		const code = Math.floor(100000 + Math.random() * 900000).toString();
		const identifier = `mfa-verify:${user.id}`;

		const { verifications } = await import("../db/schema.js");

		// Clean up any existing OTP for this user
		await db.delete(verifications).where(eq(verifications.identifier, identifier));

		// Store new code
		await db.insert(verifications).values({
			id: crypto.randomUUID(),
			identifier,
			value: code,
			expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
		});

		// Send the code
		const { html, text } = renderOtpEmail({
			otp: code,
			purpose: "verify your identity",
			expiresMinutes: 5,
		});
		await sendEmail({
			to: user.email,
			subject: `Your Century NIT Code: ${code}`,
			text,
			html,
		});

		return c.json({ sent: true });
	},
);

/* ── POST /auth-settings/mfa/verify-otp — verify OTP for email MFA login ─── */

authSettings.post(
	"/mfa/verify-otp",
	requireAuth,
	async (c) => {
		const user = c.get("user");
		const body = await c.req.json();
		const code = body?.code;

		if (!code || typeof code !== "string") {
			throw new HttpError(400, "VALIDATION_ERROR", "Enter the 6-digit code");
		}

		const identifier = `mfa-verify:${user.id}`;
		const { verifications } = await import("../db/schema.js");

		const [record] = await db
			.select()
			.from(verifications)
			.where(eq(verifications.identifier, identifier))
			.limit(1);

		if (!record) {
			throw new HttpError(400, "MFA_FAILED", "No verification code pending. Request a new one.");
		}

		if (new Date(record.expiresAt) < new Date()) {
			await db.delete(verifications).where(eq(verifications.identifier, identifier));
			throw new HttpError(400, "MFA_FAILED", "Code expired. Request a new one.");
		}

		if (record.value !== code.trim()) {
			throw new HttpError(400, "MFA_FAILED", "Incorrect code. Try again.");
		}

		// Code verified — delete it and return success
		await db.delete(verifications).where(eq(verifications.identifier, identifier));

		return c.json({ success: true });
	},
);

export { authSettings };
