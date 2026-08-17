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
	updateStaffSchema,
	AUTH_ERROR_CODES,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { opsUsers, users } from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireMfa,
	requireRole,
	type AuthVariables,
} from "../middleware/auth.js";
import { getAuthInstance } from "./auth.js";
import {
	acceptInvitation,
	createInvitation,
	findByToken,
	listInvitations,
	resendInvitation,
	revokeInvitation,
	updateStaff,
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

/* ── POST /api/v1/staff/invitations ─────────────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "post",
		path: "/invitations",
		tags: ["Staff"],
		summary: "Invite a new staff member",
		description:
			"Sends an invitation email. The invitee sets their own password; nobody else ever knows it. " +
			"You cannot invite a role above your own — only a super_admin may invite an admin or another super_admin.",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager")] as const,
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

/* ── GET /api/v1/staff/invitations ──────────────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "get",
		path: "/invitations",
		tags: ["Staff"],
		summary: "List staff invitations",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager")] as const,
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

/* ── DELETE /api/v1/staff/invitations/:id ───────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "delete",
		path: "/invitations/{id}",
		tags: ["Staff"],
		summary: "Revoke a pending invitation",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager")] as const,
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

/* ── POST /api/v1/staff/invitations/:id/resend ──────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "post",
		path: "/invitations/{id}/resend",
		tags: ["Staff"],
		summary: "Re-send an invitation",
		description:
			"Issues a fresh token, revokes the old one, and sends a new invitation email. " +
			"Works for PENDING and EXPIRED invitations. Returns the new acceptUrl.",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager")] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			201: {
				content: { "application/json": { schema: createdInvitationSchema } },
				description: "New invitation issued and emailed",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const { invitation, acceptUrl } = await resendInvitation(id, {
			opsUserId: staff.opsUserId,
			name: staff.name,
			role: staff.role,
		});
		return c.json({ ...toInvitationResponse(invitation), acceptUrl }, 201);
	},
);

/* ── GET /api/v1/staff/invitations/preview ──────────────────────────────────── */

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
		const [existing] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, invitation.email))
			.limit(1);
		return c.json({
			email: invitation.email,
			name: invitation.name,
			role: roleSchema.parse(invitation.role),
			branch: invitation.branch,
			organisation: "Century NIT Operations",
			expiresAt: invitation.expiresAt.toISOString(),
			hasExistingLogin: Boolean(existing),
		});
	},
);

/* ── POST /api/v1/staff/invitations/accept ──────────────────────────────────── */

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

/* ── POST /api/v1/staff/bootstrap ───────────────────────────────────────────── */

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
 *
 * BOOTSTRAP_TOKEN is a developer-held secret, not a machine credential — a long
 * passphrase is as valid as `openssl rand -hex 16`, and anything of 16
 * characters or more is accepted. That is precisely why the lockout below
 * exists: a secret somebody can remember is a secret somebody can guess.
 */

/**
 * Failed-attempt lockout.
 *
 * There is no rate limiting anywhere else in this API, and everywhere else that
 * is defensible — the other routes need a session, and Better Auth guards its
 * own sign-in. This one is different: it is unauthenticated by necessity,
 * publicly documented, and what it hands out is the highest privilege in the
 * system.
 *
 * The window is narrow, since a single successful bootstrap closes it forever.
 * But that window is a freshly deployed server with no staff yet, which is
 * exactly when nobody is watching.
 *
 * Counted globally rather than per IP, because per-IP counting is defeated by
 * rotating IPs and the honest threat here is an automated sweep. The cost is
 * that anyone who can reach the endpoint can lock the real operator out for
 * fifteen minutes — an annoyance answered by waiting or restarting the
 * container, and a far better trade than a guessable super admin.
 */
const BOOTSTRAP_MAX_FAILURES = 5;
const BOOTSTRAP_LOCKOUT_MS = 15 * 60_000;
let bootstrapFailures = 0;
let bootstrapLockedUntil = 0;
staffRouter.openapi(
	createRoute({
		method: "post",
		path: "/bootstrap",
		tags: ["Staff"],
		summary: "Create the first super administrator",
		description:
			"One-time setup, and the only way to create a staff account without an " +
			"inviter. Refuses as soon as any staff member exists.\n\n" +
			"**Two different secrets go in this body.** `token` is the server's " +
			"`BOOTSTRAP_TOKEN` — the developer's setup secret, which proves you are " +
			"entitled to claim this deployment. `password` is the login password for " +
			"the administrator being created, and is what they will sign in with " +
			"afterwards. They are not the same value and should not be.\n\n" +
			"Five wrong tokens lock the endpoint for fifteen minutes. Remove " +
			"`BOOTSTRAP_TOKEN` from the environment once setup is done.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							/*
							 * Named and described at the field level because both of these
							 * are secrets in one small JSON body, and the reference is where
							 * somebody decides which is which.
							 */
							token: z.string().min(16).openapi({
								description:
									"The server's BOOTSTRAP_TOKEN. A developer-held secret — a long passphrase is fine, it does not have to be random. Minimum 16 characters.",
								example: "the-setup-secret-you-configured",
							}),
							email: z.string().email().openapi({
								description: "Email for the administrator being created.",
								example: "you@example.com",
							}),
							name: z.string().min(1).max(120).openapi({
								description: "Their display name.",
								example: "Your Name",
							}),
							password: z.string().min(12).openapi({
								description:
									"The login password for the NEW administrator — not the bootstrap token. Minimum 12 characters.",
								example: "at-least-twelve-characters",
							}),
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
			403: { description: "Wrong bootstrap token" },
			409: { description: "Staff already exist — invite further members instead" },
			429: { description: "Locked after repeated wrong tokens" },
			503: { description: "BOOTSTRAP_TOKEN is not configured on the server" },
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

		const now = Date.now();
		if (now < bootstrapLockedUntil) {
			const minutes = Math.ceil((bootstrapLockedUntil - now) / 60_000);
			throw new HttpError(
				429,
				"BOOTSTRAP_LOCKED",
				`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
			);
		}

		const expected = Buffer.from(env.BOOTSTRAP_TOKEN);
		const presented = Buffer.from(body.token);
		if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
			bootstrapFailures += 1;
			if (bootstrapFailures >= BOOTSTRAP_MAX_FAILURES) {
				bootstrapLockedUntil = now + BOOTSTRAP_LOCKOUT_MS;
				bootstrapFailures = 0;
				// Loud on purpose: on a server with no staff yet, this is either the
				// operator fumbling the secret or somebody trying to take the system.
				console.warn(
					`[bootstrap] ${BOOTSTRAP_MAX_FAILURES} failed attempts — locked for ${BOOTSTRAP_LOCKOUT_MS / 60_000} minutes`,
				);
			}
			throw new HttpError(403, "FORBIDDEN", "Invalid bootstrap token");
		}

		bootstrapFailures = 0;

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
			const authInstance = await getAuthInstance();
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

/* ── GET /api/v1/staff/mfa ──────────────────────────────────────────────────── */

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

/* ── GET /api/v1/staff ──────────────────────────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Staff"],
		summary: "List staff members",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator")] as const,
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

/* ── PATCH /api/v1/staff/:id ────────────────────────────────────────────────── */

staffRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}",
		tags: ["Staff"],
		summary: "Update a staff member's role, branch or active flag",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager")] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
			body: {
				content: { "application/json": { schema: updateStaffSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							id: z.string().uuid(),
							email: z.string().email(),
							name: z.string(),
							role: roleSchema,
							branch: z.string().nullable(),
							active: z.boolean(),
						}),
					},
				},
				description: "Updated staff member",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await updateStaff({
			id,
			patch: body,
			actor: { opsUserId: staff.opsUserId, role: staff.role },
		});
		return c.json({
			id: updated.id,
			email: updated.email,
			name: updated.name,
			role: roleSchema.parse(updated.role),
			branch: updated.branch,
			active: updated.active,
		});
	},
);

void AUTH_ERROR_CODES;

export { staffRouter };
