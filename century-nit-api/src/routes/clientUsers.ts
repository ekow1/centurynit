import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthVariables, requireCapability } from "../middleware/auth.js";
import { HttpError, validationHook } from "../middleware/error.js";
import { db } from "../db/index.js";
import { bookings, conversations, conversationParticipants } from "../db/schema.js";
import {
	banClientUser,
	deleteClientUser,
	listClientUsers,
	revokeClientSessions,
	unbanClientUser,
} from "../services/clientUsers.js";
import { recordAdminEvent, requestIp } from "../services/audit.js";

const clientUserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string().email(),
	phoneNumber: z.string().nullable(),
	emailVerified: z.boolean(),
	banned: z.boolean(),
	banReason: z.string().nullable(),
	bannedAt: z.string().nullable(),
	bannedBy: z.string().nullable(),
	activeSessionsCount: z.number(),
	lastActiveAt: z.string(),
	status: z.enum(["active", "inactive", "banned", "unverified", "registered"]),
	leadStage: z.string().nullable(),
	applicantStatus: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const clientListResponseSchema = z.object({
	clients: z.array(clientUserSchema),
	metrics: z.object({
		total: z.number(),
		active: z.number(),
		inactive: z.number(),
		banned: z.number(),
	}),
});

const banBodySchema = z.object({
	reason: z.string().min(3, "Ban reason must be at least 3 characters"),
});

const idParamSchema = z.object({
	id: z.string(),
});

export const clientUsersRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

/* ── GET /api/v1/client-users ────────────────────────────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireCapability("see_all_cases")] as const,
		request: {
			query: z.object({
				status: z.enum(["all", "active", "inactive", "banned", "unverified"]).optional(),
				search: z.string().optional(),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: clientListResponseSchema } },
				description: "List of client accounts and active status metrics",
			},
		},
	}),
	async (c) => {
		const query = c.req.valid("query");
		const data = await listClientUsers(query);
		return c.json(data);
	},
);

/* ── GET /api/v1/client-users/:id/context ──────────────────────────────────────
 * The record pane's live context: their next appointment and how many client
 * threads sit open. Everything else on the pane is already loaded list-side.
 */

clientUsersRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}/context",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireCapability("see_all_cases")] as const,
		request: { params: idParamSchema },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							nextAppointment: z
								.object({ startsAt: z.string(), serviceName: z.string(), status: z.string() })
								.nullable(),
							openConversations: z.number(),
							supportConversationId: z.string().nullable(),
						}),
					},
				},
				description: "Client context for the record pane",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const [[booking], [convCount], [supportConv]] = await Promise.all([
			db
				.select({ startsAt: bookings.startsAt, serviceName: bookings.serviceName, status: bookings.status })
				.from(bookings)
				.where(
					and(
						eq(bookings.clientUserId, id),
						gt(bookings.startsAt, new Date()),
						inArray(bookings.status, ["CONFIRMED", "ASSIGNED", "RESCHEDULED", "UNASSIGNED"]),
					),
				)
				.orderBy(bookings.startsAt)
				.limit(1),
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(conversations)
				.where(
					and(
						inArray(conversations.type, ["support", "applicant", "case", "stage"]),
						eq(conversations.status, "open"),
						sql`(
							${conversations.userId} = ${id}
							OR EXISTS (
								SELECT 1 FROM ${conversationParticipants} cp
								WHERE cp.conversation_id = ${conversations.id}
								  AND cp.participant_user_id = ${id}
							)
						)`,
					),
				),
			db
				.select({ id: conversations.id })
				.from(conversations)
				.where(
					and(
						eq(conversations.type, "support"),
						sql`(
							${conversations.userId} = ${id}
							OR EXISTS (
								SELECT 1 FROM ${conversationParticipants} cp
								WHERE cp.conversation_id = ${conversations.id}
								  AND cp.participant_user_id = ${id}
							)
						)`,
					),
				)
				.orderBy(desc(conversations.lastMessageAt))
				.limit(1),
		]);
		return c.json({
			nextAppointment: booking
				? { startsAt: booking.startsAt.toISOString(), serviceName: booking.serviceName, status: booking.status }
				: null,
			openConversations: convCount?.n ?? 0,
			supportConversationId: supportConv?.id ?? null,
		});
	},
);

/* ── POST /api/v1/client-users/:id/revoke-sessions ───────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/revoke-sessions",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireCapability("manage_clients")] as const,
		request: {
			params: idParamSchema,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							revokedCount: z.number(),
						}),
					},
				},
				description: "Client sessions revoked successfully",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const staff = c.get("staff");
		const result = await revokeClientSessions(id);
		await recordAdminEvent({
			category: "Clients",
			action: `Revoked ${result.revokedCount} client session${result.revokedCount === 1 ? "" : "s"}`,
			actorId: staff?.opsUserId,
			actorEmail: staff?.email,
			target: `client:${id}`,
			ip: requestIp(c),
		});
		return c.json({ success: true, revokedCount: result.revokedCount });
	},
);

/* ── POST /api/v1/client-users/:id/ban ───────────────────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/ban",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireCapability("manage_clients")] as const,
		request: {
			params: idParamSchema,
			body: {
				content: { "application/json": { schema: banBodySchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							user: clientUserSchema.nullable(),
						}),
					},
				},
				description: "Client account banned and sessions revoked",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const { reason } = c.req.valid("json");
		const staff = c.get("staff");
		const actorName = staff?.name || "Operations Staff";

		const result = await banClientUser(id, reason, actorName);
		if (!result.success) {
			throw new HttpError(404, "NOT_FOUND", "Client user not found");
		}
		await recordAdminEvent({
			category: "Clients",
			action: `Suspended client ${result.user?.email ?? id}`,
			actorId: staff?.opsUserId,
			actorEmail: staff?.email,
			target: result.user?.email ?? `client:${id}`,
			detail: reason,
			ip: requestIp(c),
		});
		return c.json(result);
	},
);

/* ── POST /api/v1/client-users/:id/unban ─────────────────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/unban",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireCapability("manage_clients")] as const,
		request: {
			params: idParamSchema,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							user: clientUserSchema.nullable(),
						}),
					},
				},
				description: "Client account access restored",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const staff = c.get("staff");
		const actorName = staff?.name || "Operations Staff";

		const result = await unbanClientUser(id, actorName);
		if (!result.success) {
			throw new HttpError(404, "NOT_FOUND", "Client user not found");
		}
		await recordAdminEvent({
			category: "Clients",
			action: `Restored portal access for ${result.user?.email ?? id}`,
			actorId: staff?.opsUserId,
			actorEmail: staff?.email,
			target: result.user?.email ?? `client:${id}`,
			ip: requestIp(c),
		});
		return c.json(result);
	},
);

/* ── DELETE /api/v1/client-users/:id ────────────────────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "delete",
		path: "/{id}",
		tags: ["Client Directory & Access Control"],
		summary: "Permanently delete a client user",
		middleware: [requireAuth, requireRole("super_admin")] as const,
		request: {
			params: idParamSchema,
			body: {
				content: {
					"application/json": {
						schema: z.object({
							action: z.enum(["disconnect", "purge", "archive"]),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							storageErrors: z.array(z.string()).optional(),
						}),
					},
				},
				description: "Client user permanently deleted. Storage cleanup errors, if any, are returned but do not fail the request.",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const { action } = c.req.valid("json");
		const staff = c.get("staff");
		const actorName = staff?.name || "Operations Staff";
		const result = await deleteClientUser(id, action, actorName);
		if (!result.success) {
			throw new HttpError(404, "NOT_FOUND", "Client user not found");
		}
		await recordAdminEvent({
			category: "Clients",
			action: `Deleted client account (${action})`,
			actorId: staff?.opsUserId,
			actorEmail: staff?.email,
			target: `client:${id}`,
			ip: requestIp(c),
		});
		return c.json(result);
	},
);
