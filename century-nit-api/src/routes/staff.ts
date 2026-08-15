import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import {
	acceptInvitationSchema,
	createInvitationSchema,
	invitationPreviewSchema,
	invitationSchema,
	createdInvitationSchema,
	mfaRequiredForRole,
	roleSchema,
	twoFactorStatusSchema,
	AUTH_ERROR_CODES,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { opsUsers, users } from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireStaff,
	requireRole,
	type AuthVariables,
} from "../middleware/auth.js";
import { authInstance } from "./auth.js";
import {
	acceptInvitation,
	createInvitation,
	findByToken,
	listInvitations,
	revokeInvitation,
	type InvitationRow,
} from "../services/invitations.js";
import { ensureDefaultWorkingHours } from "../services/availability.js";

/**
 * Staff identity: invitations, the super-admin bootstrap, and MFA state.
 *
 * There is deliberately no staff sign-up route. A staff account can only come
 * into existence by invitation, or through the one-time bootstrap below when
 * there are no staff at all.
 */

const staffRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

function toInvitationResponse(row: InvitationRow) {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		role: roleSchema.parse(row.role),
		branch: row.branch,
		status: row.status,
		invitedByName: row.invitedByName,
		expiresAt: row.expiresAt.toISOString(),
		acceptedAt: row.acceptedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
	};
}

/* ── POST /api/staff/invitations ─────────────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "post",
		path: "/invitations",
		tags: ["Staff"],
		summary: "Invite a new staff member",
		description:
			"Sends an invitation email. The invitee sets their own password; nobody else ever knows it. " +
			"You cannot invite a role above your own — only a super_admin may invite an admin or another super_admin.",
		middleware: [requireAuth, requireRole("super_admin", "admin", "manager")] as const,
		request: {
			body: {
				content: { "application/json": { schema: createInvitationSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: createdInvitationSchema } },
				description:
					"Invitation created and emailed. `acceptUrl` is returned once so the inviter can pass the link on directly when email delivery is not configured.",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");

		const { invitation, acceptUrl } = await createInvitation({
			...body,
			invitedBy: { opsUserId: staff.opsUserId, name: staff.name, role: staff.role },
		});

		// Only here, and only to the inviter. Never on any subsequent read.
		return c.json({ ...toInvitationResponse(invitation), acceptUrl }, 201);
	},
);

/* ── GET /api/staff/invitations ──────────────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "get",
		path: "/invitations",
		tags: ["Staff"],
		summary: "List staff invitations",
		middleware: [requireAuth, requireRole("super_admin", "admin", "manager")] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ invitations: z.array(invitationSchema) }),
					},
				},
				description: "Invitations, newest first",
			},
		},
	}),
	async (c) => {
		const rows = await listInvitations();
		return c.json({ invitations: rows.map(toInvitationResponse) });
	},
);

/* ── DELETE /api/staff/invitations/:id ───────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "delete",
		path: "/invitations/{id}",
		tags: ["Staff"],
		summary: "Revoke a pending invitation",
		middleware: [requireAuth, requireRole("super_admin", "admin", "manager")] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			200: {
				content: { "application/json": { schema: invitationSchema } },
				description: "Revoked",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		return c.json(toInvitationResponse(await revokeInvitation(id, staff.email)));
	},
);

/* ── GET /api/staff/invitations/preview ──────────────────────────────────── */

/**
 * What the invitee sees before choosing a password.
 *
 * Public by necessity — they have no account yet. Returns only what the emailed
 * link already told them, so a guessed token reveals nothing new, and never
 * echoes the token back.
 */
staffRouter.openapi(
	createRoute({
		method: "get",
		path: "/invitations/preview",
		tags: ["Staff"],
		summary: "Preview an invitation from its token",
		request: { query: z.object({ token: z.string().min(20) }) },
		responses: {
			200: {
				content: { "application/json": { schema: invitationPreviewSchema } },
				description: "Invitation details",
			},
		},
	}),
	async (c) => {
		const { token } = c.req.valid("query");
		const invitation = await findByToken(token);
		return c.json({
			email: invitation.email,
			name: invitation.name,
			role: roleSchema.parse(invitation.role),
			branch: invitation.branch,
			organisation: "Century NIT Operations",
			expiresAt: invitation.expiresAt.toISOString(),
		});
	},
);

/* ── POST /api/staff/invitations/accept ──────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "post",
		path: "/invitations/accept",
		tags: ["Staff"],
		summary: "Accept an invitation and set your password",
		description:
			"Creates the login and staff profile. Sign in afterwards — staff are then required to enrol a second factor.",
		request: {
			body: {
				content: { "application/json": { schema: acceptInvitationSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: {
					"application/json": {
						schema: z.object({
							email: z.string().email(),
							role: roleSchema,
							mfaRequired: z.boolean(),
						}),
					},
				},
				description: "Account created",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const result = await acceptInvitation({ token: body.token, password: body.password });
		return c.json(
			{
				email: result.email,
				role: roleSchema.parse(result.role),
				mfaRequired: mfaRequiredForRole(result.role),
			},
			201,
		);
	},
);

/* ── POST /api/staff/bootstrap ───────────────────────────────────────────── */

/**
 * Create the first super administrator.
 *
 * A chicken-and-egg problem: invitations require an inviter, and at first there
 * is nobody. This is the way out, and it is deliberately hard to misuse:
 *
 *   - it refuses once any staff member exists, so it cannot be replayed;
 *   - it requires BOOTSTRAP_TOKEN, compared in constant time, so an exposed
 *     deployment cannot be claimed by whoever finds the docs first;
 *   - it is visible in the API reference, which is where the operator setting a
 *     system up will look.
 *
 * Once the first super_admin exists this endpoint is permanently inert, and the
 * token can be removed from the environment.
 */
staffRouter.openapi(
	createRoute({
		method: "post",
		path: "/bootstrap",
		tags: ["Staff"],
		summary: "Create the first super administrator",
		description:
			"One-time setup. Refuses once any staff member exists. Requires the BOOTSTRAP_TOKEN configured on the server.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							token: z.string().min(16),
							email: z.string().email(),
							name: z.string().min(1).max(120),
							password: z.string().min(12),
						}),
					},
				},
				required: true,
			},
		},
		responses: {
			201: {
				content: {
					"application/json": {
						schema: z.object({ email: z.string().email(), role: roleSchema }),
					},
				},
				description: "Super administrator created",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");

		if (!env.BOOTSTRAP_TOKEN) {
			throw new HttpError(
				503,
				"BOOTSTRAP_DISABLED",
				"Bootstrap is not enabled. Set BOOTSTRAP_TOKEN on the server to use it.",
			);
		}

		const expected = Buffer.from(env.BOOTSTRAP_TOKEN);
		const presented = Buffer.from(body.token);
		if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
			throw new HttpError(403, "FORBIDDEN", "Invalid bootstrap token");
		}

		const [{ count }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(opsUsers);
		if (count > 0) {
			throw new HttpError(
				409,
				"ALREADY_BOOTSTRAPPED",
				"Staff already exist. Invite further members instead.",
			);
		}

		const email = body.email.trim().toLowerCase();

		const [existing] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);

		let userId: string;
		if (existing) {
			userId = existing.id;
		} else {
			await authInstance.api.signUpEmail({
				body: { email, password: body.password, name: body.name },
			});
			const [created] = await db
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, email))
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
				email,
				name: body.name.trim(),
				role: "super_admin",
				branch: "platform",
				active: true,
			})
			.returning();

		await ensureDefaultWorkingHours(opsUser.id);

		return c.json({ email, role: roleSchema.parse("super_admin") }, 201);
	},
);

/* ── GET /api/staff/mfa ──────────────────────────────────────────────────── */

/**
 * Whether the caller has a second factor, and whether their role obliges one.
 *
 * The ops app blocks on `required && !enabled`; the portal uses the same shape
 * to offer MFA without insisting on it.
 */
staffRouter.openapi(
	createRoute({
		method: "get",
		path: "/mfa",
		tags: ["Staff"],
		summary: "Two-factor status for the signed-in user",
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: twoFactorStatusSchema } },
				description: "Status",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff");

		const [row] = await db
			.select({ twoFactorEnabled: users.twoFactorEnabled })
			.from(users)
			.where(eq(users.id, user.id))
			.limit(1);

		return c.json({
			enabled: row?.twoFactorEnabled ?? false,
			required: mfaRequiredForRole(staff?.role),
			backupCodesRemaining: null,
		});
	},
);

/* ── GET /api/staff ──────────────────────────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Staff"],
		summary: "List staff members",
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							staff: z.array(
								z.object({
									id: z.string().uuid(),
									email: z.string().email(),
									name: z.string(),
									role: roleSchema,
									branch: z.string().nullable(),
									active: z.boolean(),
									hasLogin: z.boolean(),
									mfaEnabled: z.boolean(),
								}),
							),
						}),
					},
				},
				description: "Staff directory",
			},
		},
	}),
	async (c) => {
		const rows = await db
			.select({
				id: opsUsers.id,
				email: opsUsers.email,
				name: opsUsers.name,
				role: opsUsers.role,
				branch: opsUsers.branch,
				active: opsUsers.active,
				userId: opsUsers.userId,
				twoFactorEnabled: users.twoFactorEnabled,
			})
			.from(opsUsers)
			.leftJoin(users, eq(users.id, opsUsers.userId));

		return c.json({
			staff: rows.map((r) => ({
				id: r.id,
				email: r.email,
				name: r.name,
				role: roleSchema.parse(r.role),
				branch: r.branch,
				active: r.active,
				// A profile with no linked login cannot sign in — worth surfacing,
				// since seeded rows can exist without one.
				hasLogin: Boolean(r.userId),
				mfaEnabled: r.twoFactorEnabled ?? false,
			})),
		});
	},
);

void AUTH_ERROR_CODES;

export { staffRouter };
