import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { requireAuth, requireRole, type AuthVariables } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
	banClientUser,
	deleteClientUser,
	listClientUsers,
	revokeClientSessions,
	unbanClientUser,
} from "../services/clientUsers.js";

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

export const clientUsersRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── GET /api/v1/client-users ────────────────────────────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireRole("super_admin", "admin", "manager", "coordinator")] as const,
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

/* ── POST /api/v1/client-users/:id/revoke-sessions ───────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/revoke-sessions",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireRole("super_admin", "admin", "manager")] as const,
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
		const result = await revokeClientSessions(id);
		return c.json({ success: true, revokedCount: result.revokedCount });
	},
);

/* ── POST /api/v1/client-users/:id/ban ───────────────────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/ban",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireRole("super_admin", "admin", "manager")] as const,
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
		return c.json(result);
	},
);

/* ── POST /api/v1/client-users/:id/unban ─────────────────────────────────────── */

clientUsersRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/unban",
		tags: ["Client Directory & Access Control"],
		middleware: [requireAuth, requireRole("super_admin", "admin", "manager")] as const,
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
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
						}),
					},
				},
				description: "Client user permanently deleted",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const result = await deleteClientUser(id);
		if (!result.success) {
			throw new HttpError(404, "NOT_FOUND", "Client user not found");
		}
		return c.json({ success: true });
	},
);
