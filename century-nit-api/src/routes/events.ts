import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { Redis } from "ioredis";
import { eq, desc, and, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { notifications } from "../db/schema.js";
import { env } from "../env.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";

/**
 * Real-time notification delivery via Server-Sent Events.
 *
 * Each authenticated user gets a dedicated SSE stream subscribed to their
 * personal Redis pub/sub channel (`user:{userId}:events`). When `notify()`
 * publishes to that channel, the event is pushed to the browser instantly —
 * no polling, no latency beyond the network.
 *
 * EventSource (the browser API) handles reconnection automatically: if the
 * connection drops, the browser reconnects after a short backoff. The server
 * sends a 15-second heartbeat to keep proxies from closing idle connections.
 *
 * Auth is via the session cookie (same as every other endpoint). No token
 * in the URL, no special header — the browser sends the cookie automatically
 * with the EventSource request.
 *
 * Push subscription management (subscribe/unsubscribe/vapid-public-key) lives
 * in routes/push.ts, not here.
 */

export const eventsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── SSE stream ──────────────────────────────────────────────────────────── */

eventsRouter.get("/stream", requireAuth, async (c) => {
	const user = c.get("user");
	const channel = `user:${user.id}:events`;

	return streamSSE(c, async (stream) => {
		let aborted = false;
		stream.onAbort(() => {
			aborted = true;
		});

		// Dedicated subscriber connection for this stream.
		//
		// Hardened against a Redis outage: a capped retry backoff (the ioredis
		// default retries every ~2s forever), an error listener (without one
		// every failed reconnect logs "[ioredis] Unhandled error event" with a
		// stack trace — multiplied by one connection per open SSE stream), and
		// a connect timeout so `subscribe` can't hang the request. If Redis is
		// unreachable the stream degrades to heartbeat-only: the client stays
		// connected and the 30s notification poll covers delivery.
		const subscriber = new Redis(env.REDIS_URL, {
			maxRetriesPerRequest: null,
			connectTimeout: 5_000,
			retryStrategy: (times) => Math.min(times * 2_000, 30_000),
		});
		subscriber.on("error", (err) => {
			console.error(`[sse] redis subscriber error (user ${user.id}): ${err.message}`);
		});
		try {
			await subscriber.subscribe(channel);
		} catch (err) {
			console.error(`[sse] subscribe failed (user ${user.id}):`, err);
		}

		subscriber.on("message", (ch, message) => {
			if (!aborted && ch === channel) {
				stream.writeSSE({ event: "notification", data: message }).catch(() => {
					aborted = true;
				});
			}
		});

		// Send initial connection confirmation
		await stream
			.writeSSE({
				event: "connected",
				data: JSON.stringify({ userId: user.id, at: new Date().toISOString() }),
			})
			.catch(() => {
				aborted = true;
			});

		// Heartbeat loop — keeps the connection alive through proxies
		// and lets us detect a dead connection on the next write.
		while (!aborted) {
			await stream.sleep(15_000);
			if (!aborted) {
				await stream
					.writeSSE({ event: "ping", data: String(Date.now()) })
					.catch(() => {
						aborted = true;
					});
			}
		}

		// Cleanup
		subscriber.unsubscribe(channel).catch(() => {});
		subscriber.quit().catch(() => {});
	});
});

/* ── Unread count (lightweight — for bell badges) ────────────────────────── */

const notificationSchema = z.object({
	id: z.string().uuid(),
	type: z.string(),
	title: z.string(),
	body: z.string(),
	link: z.string().nullable(),
	read: z.boolean(),
	priority: z.string(),
	entityType: z.string().nullable(),
	entityId: z.string().nullable(),
	caseId: z.string().nullable(),
	createdAt: z.string(),
});

eventsRouter.openapi(
	createRoute({
		method: "get",
		path: "/unread-count",
		tags: ["Notifications"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ unread: z.number() }),
					},
				},
				description: "Unread notification count",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const [row] = await db
			.select({ n: count() })
			.from(notifications)
			.where(
				and(eq(notifications.userId, user.id), eq(notifications.read, false)),
			);
		return c.json({ unread: Number(row?.n ?? 0) });
	},
);

/* ── List notifications ─────────────────────────────────────────────────── */

eventsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Notifications"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ notifications: z.array(notificationSchema) }),
					},
				},
				description: "List notifications for the current user",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const rows = await db.query.notifications.findMany({
			where: eq(notifications.userId, user.id),
			orderBy: [desc(notifications.createdAt)],
			limit: 50,
		});
		return c.json({
			notifications: rows.map((r) => ({
				id: r.id,
				type: r.type,
				title: r.title,
				body: r.body,
				link: r.link,
				read: r.read,
				priority: r.priority,
				entityType: r.entityType,
				entityId: r.entityId,
				caseId: r.caseId,
				createdAt: r.createdAt.toISOString(),
			})),
		});
	},
);

/* ── Mark one read ────────────────────────────────────────────────────────── */

eventsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/read",
		tags: ["Notifications"],
		middleware: [requireAuth] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
				description: "Notification marked as read",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const id = c.req.valid("param").id;
		await db
			.update(notifications)
			.set({ read: true, readAt: new Date() })
			.where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
		return c.json({ ok: true });
	},
);

/* ── Mark all read ────────────────────────────────────────────────────────── */

eventsRouter.openapi(
	createRoute({
		method: "post",
		path: "/read-all",
		tags: ["Notifications"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
				description: "All notifications marked as read",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		await db
			.update(notifications)
			.set({ read: true, readAt: new Date() })
			.where(
				and(eq(notifications.userId, user.id), eq(notifications.read, false)),
			);
		return c.json({ ok: true });
	},
);
