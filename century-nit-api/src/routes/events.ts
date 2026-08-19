import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Redis } from "ioredis";
import { env } from "../env.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";

/**
 * Server-Sent Events endpoint for real-time notifications.
 *
 * Each connected client subscribes to a per-user Redis pub/sub channel.
 * When `notify()` inserts a notification, it publishes to that channel and
 * the SSE stream pushes it to the browser immediately.
 *
 * Falls back gracefully: if SSE is not connected, the notification simply
 * sits in the `notifications` table and is picked up by the 30s polling
 * fallback in the portal / ops console.
 */
export const eventsRouter = new Hono<{ Variables: AuthVariables }>();

eventsRouter.get("/stream", requireAuth, async (c) => {
	const user = c.get("user");
	const channel = `user:${user.id}:notifications`;

	return streamSSE(c, async (stream) => {
		// Dedicated Redis connection for subscribing — pub/sub requires its own
		// connection; the shared BullMQ connection is used for publishing only.
		const redis = new Redis(env.REDIS_URL, {
			maxRetriesPerRequest: null,
			lazyConnect: false,
		});

		let closed = false;

		const cleanup = () => {
			if (closed) return;
			closed = true;
			try {
				redis.unsubscribe(channel);
			} catch {}
			try {
				redis.disconnect();
			} catch {}
		};

		try {
			await redis.subscribe(channel);

			redis.on("message", (_ch: string, message: string) => {
				if (closed) return;
				try {
					const data = JSON.parse(message);
					stream.writeSSE({
						event: "notification",
						data: JSON.stringify(data),
					});
				} catch {
					/* ignore malformed messages */
				}
			});

			// Send a heartbeat every 15s to keep the connection alive
			const heartbeat = setInterval(() => {
				if (closed) return;
				try {
					stream.writeSSE({
						event: "ping",
						data: new Date().toISOString(),
					});
				} catch {
					/* stream already closed */
				}
			}, 15_000);

			// Send an initial "connected" event so the client knows it's live
			await stream.writeSSE({
				event: "connected",
				data: JSON.stringify({ userId: user.id, ts: Date.now() }),
			});

			// Keep the stream open until the client disconnects
			await new Promise<void>((resolve) => {
				stream.onAbort(() => {
					clearInterval(heartbeat);
					cleanup();
					resolve();
				});
			});
		} catch {
			cleanup();
		}
	});
});
