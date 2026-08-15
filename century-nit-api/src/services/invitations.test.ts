import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { mfaRequiredForRole } from "century-nit-shared";
import { db } from "../db/index.js";
import { opsUsers, staffInvitations, staffWorkingHours, users } from "../db/schema.js";
import {
	acceptInvitation,
	canInviteRole,
	createInvitation,
	expireOverdue,
	findByToken,
	listInvitations,
	revokeInvitation,
} from "./invitations.js";

/**
 * Staff invitations are the only door into a privileged account, so these cover
 * the checks that keep it shut: who may invite whom, that the emailed token is
 * never recoverable from the database, and that a link works exactly once.
 */

const dbAvailable = await (async () => {
	try {
		await db.execute(sql`SELECT 1 FROM staff_invitations LIMIT 1`);
		return true;
	} catch {
		console.warn("\n[invitations] Postgres not reachable — skipping.\n");
		return false;
	}
})();

const maybe = () => (dbAvailable ? it : it.skip);

const INVITER = {
	opsUserId: "",
	name: "Test Super Admin",
	role: "super_admin",
};

async function reset() {
	await db.delete(staffInvitations);
	await db.delete(staffWorkingHours);
	await db.delete(opsUsers);
	await db.delete(users).where(sql`email LIKE '%@invite-test.local'`);

	const [inviter] = await db
		.insert(opsUsers)
		.values({
			email: "inviter@invite-test.local",
			name: INVITER.name,
			role: "super_admin",
			branch: "platform",
		})
		.returning();
	INVITER.opsUserId = inviter.id;
}

beforeEach(async () => {
	if (dbAvailable) await reset();
});

afterAll(async () => {
	if (dbAvailable) await reset();
});

/* ── Authority ───────────────────────────────────────────────────────────── */

describe("who may invite whom", () => {
	it("only a super_admin can create another super_admin or an admin", () => {
		expect(canInviteRole("super_admin", "super_admin")).toBe(true);
		expect(canInviteRole("super_admin", "admin")).toBe(true);

		// An admin's remit is the platform, not the business. Letting them mint a
		// manager would hand them every applicant's file — the exact separation
		// the permission matrix exists to keep.
		expect(canInviteRole("admin", "super_admin")).toBe(false);
		expect(canInviteRole("admin", "admin")).toBe(false);
		expect(canInviteRole("admin", "manager")).toBe(true);
	});

	it("a manager cannot invite sideways or upward", () => {
		expect(canInviteRole("manager", "manager")).toBe(false);
		expect(canInviteRole("manager", "admin")).toBe(false);
		expect(canInviteRole("manager", "consultant")).toBe(true);
	});

	it("roles without authority can invite nobody", () => {
		for (const role of ["consultant", "coordinator", "finance", "", "nonsense"]) {
			for (const target of ["consultant", "manager", "admin", "super_admin"] as const) {
				expect(canInviteRole(role, target)).toBe(false);
			}
		}
	});

	maybe()("the service refuses an escalating invitation", async () => {
		await expect(
			createInvitation({
				email: "escalate@invite-test.local",
				name: "Escalate",
				role: "super_admin",
				invitedBy: { ...INVITER, role: "admin" },
			}),
		).rejects.toMatchObject({ code: "CANNOT_INVITE_ROLE" });
	});
});

/* ── Token handling ──────────────────────────────────────────────────────── */

describe("invitation tokens", () => {
	maybe()("stores only a hash, never the token itself", async () => {
		const { invitation, acceptUrl } = await createInvitation({
			email: "hashed@invite-test.local",
			name: "Hashed",
			role: "consultant",
			invitedBy: INVITER,
		});

		const token = new URL(acceptUrl).searchParams.get("token")!;
		expect(token.length).toBeGreaterThan(20);

		const [row] = await db
			.select()
			.from(staffInvitations)
			.where(eq(staffInvitations.id, invitation.id));

		// The emailed link creates a privileged account, so a database dump must
		// not be usable to claim outstanding invitations.
		expect(row.tokenHash).not.toBe(token);
		expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
		expect(JSON.stringify(row)).not.toContain(token);
	});

	maybe()("rejects an unknown token", async () => {
		await expect(findByToken("a".repeat(43))).rejects.toMatchObject({
			code: "INVITATION_INVALID",
		});
	});

	maybe()("rejects an expired token and marks it expired", async () => {
		const { invitation, acceptUrl } = await createInvitation({
			email: "expired@invite-test.local",
			name: "Expired",
			role: "consultant",
			invitedBy: INVITER,
		});
		const token = new URL(acceptUrl).searchParams.get("token")!;

		await db
			.update(staffInvitations)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(staffInvitations.id, invitation.id));

		await expect(findByToken(token)).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });

		const [row] = await db
			.select()
			.from(staffInvitations)
			.where(eq(staffInvitations.id, invitation.id));
		expect(row.status).toBe("EXPIRED");
	});

	maybe()("rejects a revoked token", async () => {
		const { invitation, acceptUrl } = await createInvitation({
			email: "revoked@invite-test.local",
			name: "Revoked",
			role: "consultant",
			invitedBy: INVITER,
		});
		const token = new URL(acceptUrl).searchParams.get("token")!;

		await revokeInvitation(invitation.id, "tester");
		await expect(findByToken(token)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
	});
});

/* ── Acceptance ──────────────────────────────────────────────────────────── */

describe("accepting an invitation", () => {
	maybe()("creates the login, the staff profile and default working hours", async () => {
		const { acceptUrl } = await createInvitation({
			email: "newstaff@invite-test.local",
			name: "New Staff",
			role: "consultant",
			branch: "accra",
			invitedBy: INVITER,
		});
		const token = new URL(acceptUrl).searchParams.get("token")!;

		const result = await acceptInvitation({
			token,
			password: "a-sufficiently-long-password",
		});

		expect(result.role).toBe("consultant");
		expect(mfaRequiredForRole(result.role)).toBe(true);

		// The login must exist, or the account can never be used.
		const [user] = await db
			.select()
			.from(users)
			.where(eq(users.email, "newstaff@invite-test.local"));
		expect(user).toBeTruthy();

		// Linked, or requireStaff will not recognise them.
		const [staff] = await db.select().from(opsUsers).where(eq(opsUsers.id, result.opsUserId));
		expect(staff.userId).toBe(user.id);
		expect(staff.branch).toBe("accra");
		expect(staff.active).toBe(true);

		// Without hours a new consultant is never assignable and appears
		// permanently busy.
		const hours = await db
			.select()
			.from(staffWorkingHours)
			.where(eq(staffWorkingHours.opsUserId, result.opsUserId));
		expect(hours).toHaveLength(5);
	});

	maybe()("can be used exactly once", async () => {
		const { acceptUrl } = await createInvitation({
			email: "once@invite-test.local",
			name: "Once",
			role: "consultant",
			invitedBy: INVITER,
		});
		const token = new URL(acceptUrl).searchParams.get("token")!;

		await acceptInvitation({ token, password: "a-sufficiently-long-password" });

		await expect(
			acceptInvitation({ token, password: "a-sufficiently-long-password" }),
		).rejects.toMatchObject({ code: "INVITATION_ALREADY_ACCEPTED" });
	});

	maybe()("refuses a second outstanding invitation for the same address", async () => {
		await createInvitation({
			email: "dup@invite-test.local",
			name: "Dup",
			role: "consultant",
			invitedBy: INVITER,
		});

		await expect(
			createInvitation({
				email: "dup@invite-test.local",
				name: "Dup Again",
				role: "manager",
				invitedBy: INVITER,
			}),
		).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
	});

	maybe()("refuses to invite somebody who is already staff", async () => {
		await expect(
			createInvitation({
				email: "inviter@invite-test.local",
				name: "Already Staff",
				role: "consultant",
				invitedBy: INVITER,
			}),
		).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
	});
});

/* ── Housekeeping ────────────────────────────────────────────────────────── */

describe("expiry sweep", () => {
	maybe()("frees the address so a fresh invitation can be sent", async () => {
		const { invitation } = await createInvitation({
			email: "stale@invite-test.local",
			name: "Stale",
			role: "consultant",
			invitedBy: INVITER,
		});

		await db
			.update(staffInvitations)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(staffInvitations.id, invitation.id));

		expect(await expireOverdue()).toBe(1);

		// The partial unique index only covers PENDING rows, so re-inviting works.
		const again = await createInvitation({
			email: "stale@invite-test.local",
			name: "Stale Again",
			role: "consultant",
			invitedBy: INVITER,
		});
		expect(again.invitation.status).toBe("PENDING");

		const all = await listInvitations();
		expect(all.filter((i) => i.email === "stale@invite-test.local")).toHaveLength(2);
	});
});

/* ── MFA policy ──────────────────────────────────────────────────────────── */

describe("who must hold a second factor", () => {
	it("every staff role must; a client need not", () => {
		for (const role of ["super_admin", "admin", "manager", "coordinator", "consultant", "finance"]) {
			expect(mfaRequiredForRole(role)).toBe(true);
		}
		// A client has no staff role at all.
		expect(mfaRequiredForRole(null)).toBe(false);
		expect(mfaRequiredForRole(undefined)).toBe(false);
		expect(mfaRequiredForRole("")).toBe(false);
	});
});
