import { and, desc, eq, lt } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AUTH_ERROR_CODES, roleSchema, type OpsRole, type UpdateStaff } from "century-nit-shared";
import { db } from "../db/index.js";
import { opsUsers, staffInvitations, users } from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { getAuthInstance } from "../routes/auth.js";
import { ensureDefaultWorkingHours } from "./availability.js";
import { sendEmail } from "../lib/resend.js";

/**
 * Staff invitations.
 *
 * A staff account has exactly one origin: somebody with the authority invited
 * it. There is no staff sign-up endpoint, so this is the only door in — which is
 * why the checks here are the ones that matter.
 *
 * The emailed token is a bearer credential that creates a privileged account, so
 * only its SHA-256 hash is stored. A database dump therefore cannot be used to
 * claim outstanding invitations, the same reasoning that applies to passwords.
 */

const INVITE_TTL_DAYS = 7;

/**
 * Who may invite whom.
 *
 * Nobody can invite a role above their own, and only a super_admin can create
 * another super_admin or an admin. Without this an "admin" — whose remit is the
 * platform, not the business — could mint themselves a manager account and read
 * every applicant's file, which is exactly the separation the permission matrix
 * exists to maintain.
 */
const CAN_INVITE: Record<string, OpsRole[]> = {
	super_admin: ["super_admin", "admin", "manager", "coordinator", "consultant", "finance"],
	admin: ["manager", "coordinator", "consultant", "finance"],
	manager: ["coordinator", "consultant", "finance"],
	coordinator: [],
	consultant: [],
	finance: [],
};

export function canInviteRole(inviterRole: string, target: OpsRole): boolean {
	return (CAN_INVITE[inviterRole] ?? []).includes(target);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** URL-safe, 256 bits of entropy — not guessable, and short enough to email. */
function newToken(): string {
	return randomBytes(32).toString("base64url");
}

export type InvitationRow = typeof staffInvitations.$inferSelect;

/* ── Create ──────────────────────────────────────────────────────────────── */

export async function createInvitation(input: {
	email: string;
	name: string;
	role: OpsRole;
	branch?: string;
	invitedBy: { opsUserId: string; name: string; role: string };
}): Promise<{ invitation: InvitationRow; acceptUrl: string }> {
	const email = input.email.trim().toLowerCase();

	if (!canInviteRole(input.invitedBy.role, input.role)) {
		throw new HttpError(
			403,
			AUTH_ERROR_CODES.CANNOT_INVITE_ROLE,
			`Your role cannot invite a ${input.role}`,
		);
	}

	// Already staff? Inviting again would collide on the ops_users email index
	// at acceptance, long after the inviter has moved on.
	const [existingStaff] = await db
		.select({ id: opsUsers.id })
		.from(opsUsers)
		.where(eq(opsUsers.email, email))
		.limit(1);
	if (existingStaff) {
		throw new HttpError(
			409,
			AUTH_ERROR_CODES.EMAIL_ALREADY_REGISTERED,
			"That address already belongs to a staff member",
		);
	}

	// Expire anything stale first, so the partial unique index below reflects
	// reality rather than blocking on a dead invitation.
	await expireOverdue();

	const token = newToken();
	const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

	let invitation: InvitationRow;
	try {
		[invitation] = await db
			.insert(staffInvitations)
			.values({
				email,
				name: input.name.trim(),
				role: input.role,
				branch: input.branch ?? null,
				tokenHash: hashToken(token),
				status: "PENDING",
				expiresAt,
				invitedBy: input.invitedBy.opsUserId,
				invitedByName: input.invitedBy.name,
			})
			.returning();
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new HttpError(
				409,
				AUTH_ERROR_CODES.EMAIL_ALREADY_REGISTERED,
				"An invitation for that address is already outstanding",
			);
		}
		throw err;
	}

	const consoleBase =
		env.CONSOLE_URL && !env.CONSOLE_URL.includes("localhost")
			? env.CONSOLE_URL
			: process.env.NODE_ENV === "production"
				? "https://console.softclicksolutionsgh.workers.dev"
				: env.CONSOLE_URL;
	const acceptUrl = `${consoleBase}/accept-invite?token=${token}`;
	const safeName = escapeHtml(input.name.trim());
	const safeInviter = escapeHtml(input.invitedBy.name);
	const safeRole = escapeHtml(input.role.replace("_", " "));

	await sendEmail({
		to: email,
		subject: `You have been invited to Century NIT Operations`,
		text: [
			`Hello ${input.name},`,
			``,
			`${input.invitedBy.name} has invited you to join Century NIT Operations as ${input.role.replace("_", " ")}.`,
			``,
			`Set your password and sign in: ${acceptUrl}`,
			``,
			`This link expires in ${INVITE_TTL_DAYS} days and can be used once.`,
		].join("\n"),
		html: `
			<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5">
				<h2 style="margin:0 0 16px">You have been invited to Century NIT Operations</h2>
				<p>Hello ${safeName},</p>
				<p><strong>${safeInviter}</strong> has invited you to join as
				<strong>${safeRole}</strong>.</p>
				<p style="margin:24px 0">
					<a href="${acceptUrl}" style="background:#000;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Set your password</a>
				</p>
				<p style="font-size:12px;color:#666">This link expires in ${INVITE_TTL_DAYS} days and can be used once.</p>
			</div>`,
	});

	return { invitation, acceptUrl };
}

/* ── Lookup ──────────────────────────────────────────────────────────────── */

/**
 * Resolve a presented token to a usable invitation.
 *
 * Compares hashes in constant time. The failure cases are deliberately distinct
 * — expired and already-accepted are actionable for the invitee, where a flat
 * "invalid" would leave them guessing — but an unknown token stays generic so
 * this cannot be used to probe which invitations exist.
 */
export async function findByToken(token: string): Promise<InvitationRow> {
	const presented = hashToken(token);

	const [invitation] = await db
		.select()
		.from(staffInvitations)
		.where(eq(staffInvitations.tokenHash, presented))
		.limit(1);

	if (!invitation) {
		throw new HttpError(404, AUTH_ERROR_CODES.INVITATION_INVALID, "This invitation link is not valid");
	}

	// Belt and braces: the index lookup above already matched, but compare in
	// constant time so timing cannot distinguish near-misses.
	const a = Buffer.from(invitation.tokenHash);
	const b = Buffer.from(presented);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw new HttpError(404, AUTH_ERROR_CODES.INVITATION_INVALID, "This invitation link is not valid");
	}

	if (invitation.status === "ACCEPTED") {
		throw new HttpError(
			409,
			AUTH_ERROR_CODES.INVITATION_ALREADY_ACCEPTED,
			"This invitation has already been used. Sign in instead, or ask for a new one.",
		);
	}
	if (invitation.status === "REVOKED") {
		throw new HttpError(410, AUTH_ERROR_CODES.INVITATION_INVALID, "This invitation was withdrawn");
	}
	if (invitation.expiresAt.getTime() < Date.now()) {
		await db
			.update(staffInvitations)
			.set({ status: "EXPIRED", updatedAt: new Date() })
			.where(eq(staffInvitations.id, invitation.id));
		throw new HttpError(
			410,
			AUTH_ERROR_CODES.INVITATION_EXPIRED,
			"This invitation has expired. Ask for a new one.",
		);
	}

	return invitation;
}

/* ── Accept ──────────────────────────────────────────────────────────────── */

/**
 * Claim an invitation: create the login, the staff profile and default hours.
 *
 * The account is created through Better Auth's own sign-up API rather than by
 * inserting rows, so the password is hashed exactly the way sign-in expects — a
 * hand-rolled insert produces an account that can never log in.
 *
 * The invitee chooses the password; nobody else ever knows it, including the
 * person who invited them.
 */
export async function acceptInvitation(input: {
	token: string;
	password: string;
}): Promise<{ opsUserId: string; email: string; role: string }> {
	const invitation = await findByToken(input.token);

	const [existingUser] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, invitation.email))
		.limit(1);

	let userId: string;

	if (existingUser) {
		// They already have a client login. Reuse it rather than refusing — the
		// same person can be both an applicant and a member of staff. The
		// password they typed must be the one they already sign in with, or
		// anyone with the invite link could attach staff to an existing account.
		const authInstance = await getAuthInstance();
		try {
			await authInstance.api.signInEmail({
				body: { email: invitation.email, password: input.password },
			});
		} catch {
			throw new HttpError(
				403,
				AUTH_ERROR_CODES.INVITATION_INVALID,
				"That password does not match the existing account. Sign in with the password you already use.",
			);
		}
		userId = existingUser.id;
	} else {
		const authInstance = await getAuthInstance();
		await authInstance.api.signUpEmail({
			body: { email: invitation.email, password: input.password, name: invitation.name },
		});
		const [created] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, invitation.email))
			.limit(1);
		if (!created) {
			throw new HttpError(500, "INTERNAL_SERVER_ERROR", "Could not create the account");
		}
		userId = created.id;
	}

	const [opsUser] = await db
		.insert(opsUsers)
		.values({
			userId,
			email: invitation.email,
			name: invitation.name,
			role: invitation.role,
			branch: invitation.branch,
			active: true,
		})
		.onConflictDoUpdate({
			target: opsUsers.email,
			set: {
				userId,
				name: invitation.name,
				role: invitation.role,
				branch: invitation.branch,
				active: true,
				updatedAt: new Date(),
			},
		})
		.returning();

	// Without hours they are never assignable, so a new consultant would appear
	// permanently busy.
	await ensureDefaultWorkingHours(opsUser.id);

	await db
		.update(staffInvitations)
		.set({
			status: "ACCEPTED",
			acceptedAt: new Date(),
			acceptedOpsUserId: opsUser.id,
			updatedAt: new Date(),
		})
		.where(eq(staffInvitations.id, invitation.id));

	return { opsUserId: opsUser.id, email: invitation.email, role: invitation.role };
}

/* ── Management ──────────────────────────────────────────────────────────── */

export async function listInvitations(): Promise<InvitationRow[]> {
	await expireOverdue();
	return db.select().from(staffInvitations).orderBy(desc(staffInvitations.createdAt));
}

/**
 * Re-send a pending (or expired) invitation.
 *
 * Issues a fresh token and email for the same invitee — the old row is marked
 * REVOKED so the partial-unique index frees up, and a brand-new PENDING row
 * replaces it. The caller gets back the new acceptUrl just like on the first
 * create, so the ops UI can show it in a copy dialog.
 */
export async function resendInvitation(
	id: string,
	resender: { opsUserId: string; name: string; role: string },
): Promise<{ invitation: InvitationRow; acceptUrl: string }> {
	const [original] = await db
		.select()
		.from(staffInvitations)
		.where(eq(staffInvitations.id, id))
		.limit(1);

	if (!original) {
		throw new HttpError(404, AUTH_ERROR_CODES.INVITATION_INVALID, "Invitation not found");
	}
	if (original.status === "ACCEPTED") {
		throw new HttpError(409, AUTH_ERROR_CODES.INVITATION_ALREADY_ACCEPTED, "This invitation has already been accepted");
	}

	// Revoke the old row so the pending-unique index frees up.
	await db
		.update(staffInvitations)
		.set({ status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() })
		.where(eq(staffInvitations.id, id));

	// Issue a fresh invitation for the same person.
	return createInvitation({
		email: original.email,
		name: original.name,
		role: original.role as OpsRole,
		branch: original.branch ?? undefined,
		invitedBy: resender,
	});
}



export async function revokeInvitation(id: string, by: string): Promise<InvitationRow> {
	const [row] = await db
		.update(staffInvitations)
		.set({ status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(staffInvitations.id, id), eq(staffInvitations.status, "PENDING")))
		.returning();

	if (!row) {
		throw new HttpError(
			404,
			AUTH_ERROR_CODES.INVITATION_INVALID,
			"No pending invitation with that id",
		);
	}
	void by;
	return row;
}

/**
 * Change a staff member's role, branch or active flag.
 *
 * The same invite hierarchy applies: you cannot raise someone above a role you
 * could not invite, and you cannot touch someone whose current role is above
 * yours. You also cannot deactivate or demote yourself — that is how an
 * administrator locks themselves out.
 */
export async function updateStaff(input: {
	id: string;
	patch: UpdateStaff;
	actor: { opsUserId: string; role: string };
}): Promise<typeof opsUsers.$inferSelect> {
	const [target] = await db.select().from(opsUsers).where(eq(opsUsers.id, input.id)).limit(1);
	if (!target) {
		throw new HttpError(404, "NOT_FOUND", "Staff member not found");
	}

	const currentRole = roleSchema.parse(target.role);

	if (target.id === input.actor.opsUserId) {
		if (input.patch.role !== undefined && input.patch.role !== currentRole) {
			throw new HttpError(403, "FORBIDDEN", "You cannot change your own role");
		}
		if (input.patch.active === false) {
			throw new HttpError(403, "FORBIDDEN", "You cannot deactivate your own account");
		}
	} else if (!canInviteRole(input.actor.role, currentRole)) {
		throw new HttpError(403, "FORBIDDEN", "You cannot change a staff member at or above your role");
	}

	if (input.patch.role !== undefined && input.patch.role !== currentRole) {
		if (!canInviteRole(input.actor.role, input.patch.role)) {
			throw new HttpError(
				403,
				AUTH_ERROR_CODES.CANNOT_INVITE_ROLE,
				`Your role cannot assign ${input.patch.role}`,
			);
		}
	}

	const [updated] = await db
		.update(opsUsers)
		.set({
			...(input.patch.role !== undefined ? { role: input.patch.role } : {}),
			...(input.patch.branch !== undefined ? { branch: input.patch.branch } : {}),
			...(input.patch.active !== undefined ? { active: input.patch.active } : {}),
			updatedAt: new Date(),
		})
		.where(eq(opsUsers.id, target.id))
		.returning();

	return updated;
}

/** Mark overdue invitations expired so the pending-unique index frees up. */
export async function expireOverdue(): Promise<number> {
	const rows = await db
		.update(staffInvitations)
		.set({ status: "EXPIRED", updatedAt: new Date() })
		.where(
			and(eq(staffInvitations.status, "PENDING"), lt(staffInvitations.expiresAt, new Date())),
		)
		.returning({ id: staffInvitations.id });
	return rows.length;
}
