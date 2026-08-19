import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Redis } from "ioredis";
import { env } from "../env.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import { NOTIFICATION_CHANNEL } from "../services/notify.js";

/**
 * Server-Sent Events endpoint for real-time notifications.
 *
 * Each connected client subscribes to the global Redis pub/sub channel
 * `century-nit:notifications`. Messages are filtered by `userId` so a
 * client only receives its own notifications.
 *
 * Falls back gracefully: if SSE is not connected, the notification simply
 * sits in the `notifications` table and is picked up by the 30s polling
 * fallback in the portal / ops console.
 */
export const eventsRouter = new Hono<{ Variables: AuthVariables }>();

eventsRouter.get("/stream", requireAuth, async (c) => {
	const user = c.get("user");

	return streamSSE(c, async (stream) => {
		const redis = new Redis(env.REDIS_URL, {
			maxRetriesPerRequest: null,
			lazyConnect: false,
		});

		let closed = false;

		const cleanup = () => {
			if (closed) return;
			closed = true;
			try {
				redis.unsubscribe(NOTIFICATION_CHANNEL);
			} catch {}
			try {
				redis.disconnect();
			} catch {}
		};

		try {
			await redis.subscribe(NOTIFICATION_CHANNEL);

			redis.on("message", (_ch: string, message: string) => {
				if (closed) return;
				try {
					const data = JSON.parse(message);
					if (data.userId !== user.id) return;

					stream.writeSSE({
						event: "notification",
						data: JSON.stringify({
							id: data.id,
							type: data.type,
							title: data.title,
							body: data.body,
							link: data.link,
							createdAt: data.createdAt,
						}),
					});
				} catch {
					/* ignore malformed messages */
				}
			});

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

			await stream.writeSSE({
				event: "connected",
				data: JSON.stringify({ userId: user.id, ts: Date.now() }),
			});

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
