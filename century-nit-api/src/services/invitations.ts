import { and, desc, eq, lt } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AUTH_ERROR_CODES, type OpsRole } from "century-nit-shared";
import { db } from "../db/index.js";
import { opsUsers, staffInvitations, users } from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { authInstance } from "../routes/auth.js";
import { ensureDefaultWorkingHours } from "./availability.js";
import { queueEmail } from "../worker/queues.js";

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

	const acceptUrl = `${env.FRONTEND_URL}/ops/accept-invite?token=${token}`;

	await queueEmail({
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
				<p>Hello ${input.name},</p>
				<p><strong>${input.invitedBy.name}</strong> has invited you to join as
				<strong>${input.role.replace("_", " ")}</strong>.</p>
				<p style="margin:24px 0">
					<a href="${acceptUrl}" style="background:#000;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Set your password</a>
				</p>
				<p style="font-size:12px;color:#666">This link expires in ${INVITE_TTL_DAYS} days and can be used once.</p>
			</div>`,
		// One invitation, one email — a retry must not send a second.
		idempotencyKey: `notify:invite:${invitation.id}`,
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
		// same person can be both an applicant and a member of staff.
		userId = existingUser.id;
	} else {
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
