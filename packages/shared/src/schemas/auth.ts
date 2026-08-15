import { z } from "zod";
import { roleSchema } from "./ops.js";

/**
 * Authentication contracts beyond what Better Auth's own plugins expose.
 *
 * Sign-in, sign-up, OTP and two-factor endpoints all come from Better Auth
 * plugins and are documented by them; nothing here re-declares those. What lives
 * here is the part that is ours: how staff accounts come into existence.
 *
 * Clients self-register. Staff never do — a staff account exists only because
 * somebody with the authority invited it, which is why there is no staff
 * sign-up endpoint anywhere in this API.
 */

/* ── Phone numbers ───────────────────────────────────────────────────────── */

/**
 * E.164, e.g. `+233241234567`.
 *
 * Stored canonically so the same phone cannot register twice under two
 * spellings — `0241234567` and `+233241234567` are one person, and a unique
 * index only helps if the value is normalised before it reaches the database.
 */
export const phoneNumberSchema = z
	.string()
	.trim()
	.regex(/^\+[1-9]\d{7,14}$/, "Enter a phone number in international format, e.g. +233241234567");

/**
 * Normalise a typed number to E.164 where the intent is unambiguous.
 *
 * Only a local number with a known default country can be upgraded; anything
 * else is returned untouched for the schema to reject, rather than guessed at.
 */
export function toE164(input: string, defaultCountryCode = "233"): string {
	const trimmed = input.replace(/[\s()-]/g, "");
	if (trimmed.startsWith("+")) return trimmed;
	// 00 is the other common international prefix.
	if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`;
	// A national trunk "0" prefix, e.g. Ghana 024… -> +23324…
	if (trimmed.startsWith("0")) return `+${defaultCountryCode}${trimmed.slice(1)}`;
	return trimmed;
}

/* ── Staff invitations ───────────────────────────────────────────────────── */

export const createInvitationSchema = z.object({
	email: z.string().email(),
	name: z.string().min(1).max(120),
	role: roleSchema,
	branch: z.string().max(64).optional(),
});
export type CreateInvitation = z.infer<typeof createInvitationSchema>;

/**
 * Accepting an invitation is where the account is actually created, so the
 * invitee — not the inviter — chooses the password. Nobody else ever knows it.
 */
export const acceptInvitationSchema = z
	.object({
		token: z.string().min(20),
		password: z.string().min(12, "Use at least 12 characters"),
		confirmPassword: z.string(),
	})
	.refine((v) => v.password === v.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});
export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;

export const invitationStatusSchema = z.enum([
	"PENDING",
	"ACCEPTED",
	"REVOKED",
	"EXPIRED",
]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const invitationSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	name: z.string(),
	role: roleSchema,
	branch: z.string().nullable(),
	status: invitationStatusSchema,
	invitedByName: z.string().nullable(),
	expiresAt: z.string().datetime(),
	acceptedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/**
 * Returned once, to the person who created the invitation.
 *
 * The link is normally emailed, but email delivery is optional in this system —
 * without it an invitation would be undeliverable and the whole flow unusable.
 * Handing the link back to the authorised inviter lets them pass it on
 * themselves, and costs nothing: they are the one person who is already allowed
 * to create it.
 *
 * Shown once and never stored client-side. Every later read of the invitation
 * (`listInvitations`) omits it, because only the hash is kept server-side.
 */
export const createdInvitationSchema = invitationSchema.extend({
	acceptUrl: z.string().url(),
});

export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;

/** What an invitee is shown before choosing a password — never the token itself. */
export const invitationPreviewSchema = z.object({
	email: z.string().email(),
	name: z.string(),
	role: roleSchema,
	branch: z.string().nullable(),
	organisation: z.string(),
	expiresAt: z.string().datetime(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/* ── Two-factor ──────────────────────────────────────────────────────────── */

/**
 * Whether the caller has MFA, and whether their role obliges them to have it.
 *
 * `required && !enabled` is the state the ops app blocks on: staff hold other
 * people's data, so they enrol before reaching any case screen. Clients may
 * enable it but are never forced — a consultancy that makes applicants install
 * an authenticator app before booking loses bookings.
 */
export const twoFactorStatusSchema = z.object({
	enabled: z.boolean(),
	required: z.boolean(),
	backupCodesRemaining: z.number().int().nullable(),
});
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;

/** Roles that must hold a second factor. */
export const MFA_REQUIRED_ROLES = [
	"super_admin",
	"admin",
	"manager",
	"coordinator",
	"consultant",
	"finance",
] as const;

/** Staff must; clients need not. Kept as a function so the rule has one home. */
export function mfaRequiredForRole(role: string | null | undefined): boolean {
	return Boolean(role) && (MFA_REQUIRED_ROLES as readonly string[]).includes(role!);
}

/* ── Error codes the frontend branches on ────────────────────────────────── */

export const AUTH_ERROR_CODES = {
	INVITATION_INVALID: "INVITATION_INVALID",
	INVITATION_EXPIRED: "INVITATION_EXPIRED",
	INVITATION_ALREADY_ACCEPTED: "INVITATION_ALREADY_ACCEPTED",
	EMAIL_ALREADY_REGISTERED: "EMAIL_ALREADY_REGISTERED",
	MFA_REQUIRED: "MFA_REQUIRED",
	MFA_NOT_ENROLLED: "MFA_NOT_ENROLLED",
	SMS_NOT_CONFIGURED: "SMS_NOT_CONFIGURED",
	CANNOT_INVITE_ROLE: "CANNOT_INVITE_ROLE",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
