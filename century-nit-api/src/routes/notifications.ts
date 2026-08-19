import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { and, desc, count, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { notificationLog, notifications } from "../db/schema.js";
import {
	requireAuth,
	requireMfa,
	requireModule,
	requireStaff,
	type AuthVariables,
} from "../middleware/auth.js";

export const notificationsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const notificationLogItemSchema = z.object({
	id: z.string().uuid(),
	recipient: z.string(),
	subject: z.string(),
	template: z.string().nullable(),
	status: z.string(),
	reference: z.string().nullable(),
	errorMessage: z.string().nullable(),
	sentAt: z.string().datetime(),
});

/* ── GET /api/v1/notifications/log ────────────────────────────────────────── */

notificationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/log",
		tags: ["Notifications"],
		summary: "Notification delivery log (notifications module only)",
		middleware: [requireAuth, requireMfa, requireModule("notifications")] as const,
		request: {
			query: z.object({
				limit: z.coerce.number().min(1).max(100).optional().default(50),
				status: z.enum(["sent", "failed"]).optional(),
			}),
		},
		responses: {
			200: {
				description: "Recent notification deliveries",
				content: {
					"application/json": {
						schema: z.object({
							notifications: z.array(notificationLogItemSchema),
							total: z.number(),
							sent: z.number(),
							failed: z.number(),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const { limit, status } = c.req.valid("query");

		const where = status ? sql`${notificationLog.status} = ${status}` : undefined;

		const rows = await db
			.select()
			.from(notificationLog)
			.where(where ?? sql`true`)
			.orderBy(desc(notificationLog.sentAt))
			.limit(limit);

		const [totalRow] = await db.select({ total: count() }).from(notificationLog).where(where ?? sql`true`);
		const [sentRow] = await db
			.select({ total: count() })
			.from(notificationLog)
			.where(sql`${notificationLog.status} = 'sent'`);
		const [failedRow] = await db
			.select({ total: count() })
			.from(notificationLog)
			.where(sql`${notificationLog.status} = 'failed'`);

		return c.json({
			notifications: rows.map((r) => ({
				id: r.id,
				recipient: r.recipient,
				subject: r.subject,
				template: r.template,
				status: r.status,
				reference: r.reference,
				errorMessage: r.errorMessage,
				sentAt: r.sentAt.toISOString(),
			})),
			total: totalRow?.total ?? 0,
			sent: sentRow?.total ?? 0,
			failed: failedRow?.total ?? 0,
		});
	},
);

/* ── Ops in-app notifications ──────────────────────────────────────────────── */

const notificationItemSchema = z.object({
	id: z.string().uuid(),
	type: z.string(),
	title: z.string(),
	body: z.string(),
	link: z.string().nullable(),
	read: z.boolean(),
	createdAt: z.string().datetime(),
});

/* ── GET /api/v1/notifications/ops ────────────────────────────────────────── */

notificationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/ops",
		tags: ["Notifications"],
		summary: "In-app notifications for the authenticated staff member",
		middleware: [requireAuth, requireStaff, requireMfa] as const,
		responses: {
			200: {
				description: "Recent notifications for the staff member",
				content: {
					"application/json": {
						schema: z.object({
							notifications: z.array(notificationItemSchema),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const user = c.get("user");

		const rows = await db
			.select()
			.from(notifications)
			.where(eq(notifications.userId, user.id))
			.orderBy(desc(notifications.createdAt))
			.limit(50);

		return c.json({
			notifications: rows.map((r) => ({
				id: r.id,
				type: r.type,
				title: r.title,
				body: r.body,
				link: r.link,
				read: r.read,
				createdAt: r.createdAt.toISOString(),
			})),
		});
	},
);

/* ── PATCH /api/v1/notifications/ops/:id/read ─────────────────────────────── */

notificationsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/ops/{id}/read",
		tags: ["Notifications"],
		summary: "Mark a single notification as read",
		middleware: [requireAuth, requireStaff, requireMfa] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
		},
		responses: {
			200: {
				description: "Notification marked as read",
				content: {
					"application/json": {
						schema: z.object({ success: z.boolean() }),
					},
				},
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const { id } = c.req.valid("param");

		// Scoped by userId so a staff member can only mark their own notifications.
		await db
			.update(notifications)
			.set({ read: true })
			.where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));

		return c.json({ success: true });
	},
);

/* ── POST /api/v1/notifications/ops/read-all ──────────────────────────────── */

notificationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/ops/read-all",
		tags: ["Notifications"],
		summary: "Mark all of the staff member's notifications as read",
		middleware: [requireAuth, requireStaff, requireMfa] as const,
		responses: {
			200: {
				description: "All notifications marked as read",
				content: {
					"application/json": {
						schema: z.object({ success: z.boolean(), updated: z.number() }),
					},
				},
			},
		},
	}),
	async (c) => {
		const user = c.get("user");

		const updated = await db
			.update(notifications)
			.set({ read: true })
			.where(and(eq(notifications.userId, user.id), eq(notifications.read, false)))
			.returning({ id: notifications.id });

		return c.json({ success: true, updated: updated.length });
	},
);
