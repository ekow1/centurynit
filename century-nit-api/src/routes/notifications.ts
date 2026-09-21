import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { validationHook } from "../middleware/error.js";
import { z } from "zod";
import { and, desc, count, eq, ilike, or, sql } from "drizzle-orm";
import { NOTIFICATION_EVENTS } from "century-nit-shared";
import { db } from "../db/index.js";
import { notificationLog, notifications, pushSubscriptions } from "../db/schema.js";
import { requireAuth, requireMfa, requireModule, requireStaff, type AuthVariables } from "../middleware/auth.js";
import { sendEmail } from "../lib/resend.js";
import { getNotificationPreferences, setNotificationPreferences } from "../services/notify.js";
import { recordAdminEvent, requestIp } from "../services/audit.js";
import { emailQueue } from "../worker/queues.js";

export const notificationsRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

const notificationLogItemSchema = z.object({
	id: z.string().uuid(),
	recipient: z.string(),
	subject: z.string(),
	template: z.string().nullable(),
	status: z.string(),
	channel: z.string(),
	event: z.string().nullable(),
	reference: z.string().nullable(),
	errorMessage: z.string().nullable(),
	attempts: z.number(),
	queuedAt: z.string().datetime().nullable(),
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
				channel: z.enum(["email", "in_app", "push", "sms"]).optional(),
				event: z.string().optional(),
				recipient: z.string().optional(),
				q: z.string().optional(),
				from: z.string().optional(),
				to: z.string().optional(),
				before: z.string().optional(),
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
							nextBefore: z.string().nullable(),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const q = c.req.valid("query");

		const conds = [
			q.status ? eq(notificationLog.status, q.status) : undefined,
			q.channel ? eq(notificationLog.channel, q.channel) : undefined,
			q.event ? ilike(notificationLog.event, `%${q.event}%`) : undefined,
			q.recipient ? ilike(notificationLog.recipient, `%${q.recipient}%`) : undefined,
			q.q
				? or(
						ilike(notificationLog.recipient, `%${q.q}%`),
						ilike(notificationLog.subject, `%${q.q}%`),
						ilike(notificationLog.reference ?? "", `%${q.q}%`),
					)
				: undefined,
			q.from ? sql`${notificationLog.sentAt} >= ${new Date(q.from)}` : undefined,
			q.to ? sql`${notificationLog.sentAt} <= ${new Date(q.to)}` : undefined,
			q.before ? sql`${notificationLog.sentAt} < ${new Date(q.before)}` : undefined,
		].filter((x): x is NonNullable<typeof x> => x !== undefined);
		const where = conds.length ? and(...conds) : undefined;

		const rows = await db
			.select()
			.from(notificationLog)
			.where(where ?? sql`true`)
			.orderBy(desc(notificationLog.sentAt))
			.limit(q.limit + 1);
		const page = rows.slice(0, q.limit);

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
			notifications: page.map((r) => ({
				id: r.id,
				recipient: r.recipient,
				subject: r.subject,
				template: r.template,
				status: r.status,
				channel: r.channel,
				event: r.event,
				reference: r.reference,
				errorMessage: r.errorMessage,
				attempts: r.attempts,
				queuedAt: r.queuedAt?.toISOString() ?? null,
				sentAt: r.sentAt.toISOString(),
			})),
			total: totalRow?.total ?? 0,
			sent: sentRow?.total ?? 0,
			failed: failedRow?.total ?? 0,
			nextBefore: rows.length > q.limit ? (page.at(-1)?.sentAt?.toISOString() ?? null) : null,
		});
	},
);

/* ── GET /api/v1/notifications/catalogue ──────────────────────────────────── */

notificationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/catalogue",
		tags: ["Notifications"],
		summary: "Event catalogue — every notification type the system emits",
		middleware: [requireAuth, requireMfa, requireModule("notifications")] as const,
		responses: {
			200: {
				description: "The notification catalogue, generated from the shared registry",
				content: {
					"application/json": {
						schema: z.object({
							events: z.array(
								z.object({
									type: z.string(),
									label: z.string(),
									audience: z.string(),
									channels: z.array(z.string()),
									timing: z.string(),
									required: z.boolean(),
								}),
							),
						}),
					},
				},
			},
		},
	}),
	async (c) =>
		c.json({
			events: NOTIFICATION_EVENTS.map((e) => ({
				type: e.key,
				label: e.label,
				audience: String(e.audience),
				channels: e.channels.map(String),
				timing: e.timing ?? "immediate",
				required: e.required ?? false,
			})),
		}),
);

/* ── GET /api/v1/notifications/log/{id} — view the rendered body ──────────── */

notificationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/log/{id}",
		tags: ["Notifications"],
		summary: "View a rendered delivery",
		middleware: [requireAuth, requireMfa, requireModule("notifications")] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			200: {
				description: "The stored body",
				content: {
					"application/json": {
						schema: z.object({
							id: z.string(),
							recipient: z.string(),
							subject: z.string(),
							status: z.string(),
							bodyHtml: z.string().nullable(),
							bodyText: z.string().nullable(),
							errorMessage: z.string().nullable(),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const [row] = await db
			.select()
			.from(notificationLog)
			.where(eq(notificationLog.id, c.req.valid("param").id))
			.limit(1);
		if (!row) return c.json({ error: "Not found" }, 404) as never;
		return c.json({
			id: row.id,
			recipient: row.recipient,
			subject: row.subject,
			status: row.status,
			bodyHtml: row.bodyHtml,
			bodyText: row.bodyText,
			errorMessage: row.errorMessage,
		});
	},
);

/* ── POST /api/v1/notifications/log/{id}/resend ───────────────────────────── */

notificationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/log/{id}/resend",
		tags: ["Notifications"],
		summary: "Resend a logged email",
		middleware: [requireAuth, requireMfa, requireModule("notifications")] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			200: {
				description: "Re-queued",
				content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		const [row] = await db
			.select()
			.from(notificationLog)
			.where(eq(notificationLog.id, c.req.valid("param").id))
			.limit(1);
		if (!row) return c.json({ error: "Not found" }, 404) as never;
		if (!row.bodyHtml && !row.bodyText) {
			return c.json(
				{ error: "This entry was logged before bodies were stored — nothing to resend." },
				400,
			) as never;
		}
		await sendEmail({
			to: row.recipient,
			subject: row.subject,
			html: row.bodyHtml ?? undefined,
			text: row.bodyText ?? undefined,
			log: {
				template: row.template ?? undefined,
				event: row.event ?? undefined,
				reference: row.reference ?? undefined,
				idempotencyKey: `resend:${row.id}:${Date.now()}`,
			},
		});
		await recordAdminEvent({
			category: "Notifications",
			action: `Resent "${row.subject}" to ${row.recipient}`,
			actorId: staff?.opsUserId,
			actorEmail: staff?.email ?? "staff",
			target: row.recipient,
			targetType: "client",
			severity: "warn",
			ip: requestIp(c),
		});
		return c.json({ ok: true });
	},
);

/* ── GET /api/v1/notifications/health ─────────────────────────────────────── */

notificationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/health",
		tags: ["Notifications"],
		summary: "Notification pipeline health",
		middleware: [requireAuth, requireMfa, requireModule("notifications")] as const,
		responses: {
			200: {
				description: "Pipeline health",
				content: {
					"application/json": {
						schema: z.object({
							sent24h: z.number(),
							failed24h: z.number(),
							deliveryRate24h: z.number().nullable(),
							queueWaiting: z.number(),
							queueFailed: z.number(),
							pushSubscriptions: z.number(),
							lastDeliveryAt: z.string().nullable(),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const [[counts], [pushes], [last]] = await Promise.all([
			db
				.select({
					sent24h: sql<number>`count(*) filter (where ${notificationLog.status} = 'sent' and ${notificationLog.sentAt} > now() - interval '24 hours')::int`,
					failed24h: sql<number>`count(*) filter (where ${notificationLog.status} = 'failed' and ${notificationLog.sentAt} > now() - interval '24 hours')::int`,
				})
				.from(notificationLog),
			db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions),
			db
				.select({ at: notificationLog.sentAt })
				.from(notificationLog)
				.orderBy(desc(notificationLog.sentAt))
				.limit(1),
		]);
		const waiting = await emailQueue.getJobCounts("waiting").then((r) => r.waiting ?? 0).catch(() => 0);
		const failed = await emailQueue.getJobCounts("failed").then((r) => r.failed ?? 0).catch(() => 0);
		const total = counts.sent24h + counts.failed24h;
		return c.json({
			sent24h: counts.sent24h,
			failed24h: counts.failed24h,
			deliveryRate24h: total > 0 ? Math.round((counts.sent24h / total) * 100) : null,
			queueWaiting: waiting,
			queueFailed: failed,
			pushSubscriptions: pushes.n,
			lastDeliveryAt: last?.at?.toISOString() ?? null,
		});
	},
);

/* ── GET/PUT /api/v1/notifications/preferences — the staff member's own matrix ─ */

const prefsSchema = z.object({
	channelFlags: z.record(
		z.string(),
		z.object({
			inApp: z.boolean().optional(),
			email: z.boolean().optional(),
			push: z.boolean().optional(),
			sms: z.boolean().optional(),
		}),
	),
	quietHours: z
		.object({
			start: z.string().optional(),
			end: z.string().optional(),
			timezone: z.string().optional(),
		})
		.nullable()
		.optional(),
});

notificationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/preferences",
		tags: ["Notifications"],
		summary: "My notification preferences",
		middleware: [requireAuth, requireStaff, requireMfa] as const,
		responses: {
			200: { description: "Preferences", content: { "application/json": { schema: prefsSchema } } },
		},
	}),
	async (c) => c.json(await getNotificationPreferences(c.get("user").id)),
);

notificationsRouter.openapi(
	createRoute({
		method: "put",
		path: "/preferences",
		tags: ["Notifications"],
		summary: "Update my notification preferences",
		middleware: [requireAuth, requireStaff, requireMfa] as const,
		request: {
			body: { content: { "application/json": { schema: prefsSchema.partial() } }, required: true },
		},
		responses: {
			200: { description: "Updated preferences", content: { "application/json": { schema: prefsSchema } } },
		},
	}),
	async (c) => c.json(await setNotificationPreferences(c.get("user").id, c.req.valid("json"))),
);

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

/* ── PATCH /api/v1/notifications/ops/{id}/read ────────────────────────────── */

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
