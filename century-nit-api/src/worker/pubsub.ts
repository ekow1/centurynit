import { Redis } from "ioredis";
import { env } from "../env.js";

/**
 * Redis pub/sub publisher for real-time SSE delivery.
 *
 * A separate connection from BullMQ's `connection` in queues.ts — BullMQ sets
 * `maxRetriesPerRequest: null` and uses the connection for job polling, which
 * makes it unsuitable for ad-hoc `publish` calls in the hot path.
 *
 * This publisher is fire-and-forget: if Redis is down, the in-app notification
 * is still in the database and the next poll will surface it. SSE clients
 * reconnect automatically (EventSource is built for this).
 */

const publisher = new Redis(env.REDIS_URL, {
	maxRetriesPerRequest: null,
	// Cap reconnect backoff at 30s so a Redis outage doesn't hammer the
	// network — ioredis defaults to retrying every ~2s forever.
	retryStrategy: (times) => Math.min(times * 2_000, 30_000),
});

// Without an error listener every failed reconnect prints
// "[ioredis] Unhandled error event" with a full stack trace.
publisher.on("error", (err) => {
	console.error(`[pubsub] redis error: ${err.message}`);
});

export function publishToUser(userId: string, payload: unknown): void {
	const channel = `user:${userId}:events`;
	publisher.publish(channel, JSON.stringify(payload)).catch((err) => {
		console.error(`[pubsub] publish to ${channel} failed:`, err);
	});
}

export { publisher as pubsubConnection };
