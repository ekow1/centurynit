import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { desc, count, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { notificationLog } from "../db/schema.js";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";

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
