import { createAuthClient } from "better-auth/client";
import { emailOTPClient, phoneNumberClient, twoFactorClient } from "better-auth/client/plugins";
import {
	phoneNumberSchema,
	signInSchema,
	signUpSchema,
	toE164,
	type SignIn,
	type SignUp,
} from "century-nit-shared";

/**
 * Better Auth client for the same-origin `/api/auth` endpoints.
 *
 * The plugins mirror the server's exactly — a client plugin only adds the typed
 * calls for routes the server already exposes, so the two lists have to agree or
 * the call simply 404s.
 */
export const authClient = createAuthClient({
	baseURL: typeof window === "undefined" ? "" : window.location.origin,
	basePath: "/api/auth",
	plugins: [phoneNumberClient(), emailOTPClient(), twoFactorClient()],
});

function formatError(
	error: { message?: string; status?: number } | null | undefined,
	fallback = "Authentication failed",
): string {
	if (!error) return fallback;
	return error.message || `${fallback} (${error.status ?? "unknown"})`;
}

export async function signInWithEmail(input: SignIn) {
	const parsed = signInSchema.safeParse(input);
	if (!parsed.success) {
		throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
	}
	const { data, error } = await authClient.signIn.email(parsed.data);
	if (error) throw new Error(formatError(error, "Invalid email or password"));
	return data;
}

export async function signUpWithEmail(input: SignUp) {
	const parsed = signUpSchema.safeParse(input);
	if (!parsed.success) {
		throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
	}
	const { data, error } = await authClient.signUp.email(parsed.data);
	if (error) throw new Error(formatError(error, "Could not create account"));
	return data;
}

export async function signInWithGoogle() {
	const { data, error } = await authClient.signIn.social({
		provider: "google",
		callbackURL: `${window.location.origin}/portal`,
	});
	if (error) throw new Error(formatError(error, "Google sign in failed"));
	if (data?.url) window.location.href = data.url;
	return data;
}

export async function signOut() {
	const { error } = await authClient.signOut();
	if (error) throw new Error(formatError(error, "Sign out failed"));
}

export async function getCurrentSession() {
	const { data, error } = await authClient.getSession();
	if (error) throw new Error(formatError(error, "Could not load session"));
	return data;
}

export async function requestPasswordReset(email: string) {
	const { error } = await authClient.requestPasswordReset({
		email,
		redirectTo: `${window.location.origin}/start`,
	});
	if (error) throw new Error(formatError(error, "Could not send reset email"));
}

export async function resetPassword({ token, newPassword, confirmPassword }: { token: string; newPassword: string; confirmPassword: string }) {
	if (newPassword !== confirmPassword) {
		throw new Error("Passwords don't match");
	}
	const { error } = await authClient.resetPassword({
		token,
		newPassword,
	});
	if (error) throw new Error(formatError(error, "Could not reset password"));
}

/* ── Phone ───────────────────────────────────────────────────────────────── */

/**
 * Send a sign-in code by SMS.
 *
 * The number is normalised to E.164 before it leaves the browser so that
 * "024 123 4567" and "+233241234567" are the same account rather than two.
 */
export async function sendPhoneCode(rawPhone: string) {
	const phoneNumber = toE164(rawPhone);
	const parsed = phoneNumberSchema.safeParse(phoneNumber);
	if (!parsed.success) {
		throw new Error(parsed.error.issues[0]?.message ?? "Enter a valid phone number");
	}

	const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: parsed.data });
	if (error) {
		// The server refuses rather than pretending when no SMS provider is
		// configured; say so plainly instead of leaving the user waiting.
		if (error.status === 503) {
			throw new Error("Phone sign-in is not available yet. Use email instead.");
		}
		throw new Error(formatError(error, "Could not send the code"));
	}
	return parsed.data;
}

/** Verify the SMS code. Creates the account on first use. */
export async function verifyPhoneCode(phoneNumber: string, code: string) {
	const { data, error } = await authClient.phoneNumber.verify({
		phoneNumber: toE164(phoneNumber),
		code,
	});
	if (error) throw new Error(formatError(error, "That code was not accepted"));
	return data;
}

/* ── One-time email codes ────────────────────────────────────────────────── */

export async function sendEmailCode(email: string) {
	const mail = email.trim().toLowerCase();
	if (!mail.includes("@")) throw new Error("Enter a valid email address");

	const { error } = await authClient.emailOtp.sendVerificationOtp({
		email: mail,
		type: "sign-in",
	});
	if (error) throw new Error(formatError(error, "Could not send the code"));
	return mail;
}

/** Sign in with a one-time email code — no password involved. */
export async function verifyEmailCode(email: string, otp: string) {
	const { data, error } = await authClient.signIn.emailOtp({
		email: email.trim().toLowerCase(),
		otp,
	});
	if (error) throw new Error(formatError(error, "That code was not accepted"));
	return data;
}

/* ── Two-factor (optional for clients) ───────────────────────────────────── */

/**
 * Whether sign-in stopped to ask for a second factor.
 *
 * Better Auth answers a password sign-in with `twoFactorRedirect` and issues no
 * session, so the caller must branch on this rather than assuming success.
 */
export function needsSecondFactor(data: unknown): boolean {
	return Boolean((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect);
}

export async function verifyTotp(code: string) {
	const { data, error } = await authClient.twoFactor.verifyTotp({ code });
	if (error) throw new Error(formatError(error, "That code was not accepted"));
	return data;
}
