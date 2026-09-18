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

/**
 * Broadcast channel every connected ops console subscribes to.
 *
 * Domain events (case moved, invoice paid, lead landed…) are published here
 * once instead of being fanned out to a computed list of staff user
 * channels — the SSE stream in routes/events.ts subscribes staff
 * connections to this channel alongside their personal one, so every open
 * console sees every workspace change without the publisher needing to know
 * who is watching.
 */
export const OPS_EVENTS_CHANNEL = "ops:events";

export function publishToOps(payload: unknown): void {
	publisher.publish(OPS_EVENTS_CHANNEL, JSON.stringify(payload)).catch((err) => {
		console.error(`[pubsub] publish to ${OPS_EVENTS_CHANNEL} failed:`, err);
	});
}

/**
 * A domain event is a refresh signal — "this thing changed on the server,
 * refetch it". Unlike notify() it writes no notification row, queues no
 * push and sends no email: it exists purely to move screens.
 *
 * Audiences:
 *   - `userId` — the applicant's personal channel (portal screens sync)
 *   - `ops: true` — every connected ops console
 *
 * Fire-and-forget like the rest of this module: the 30s client-side polls
 * remain the fallback for anything missed.
 */
export function emitDomain(
	type: string,
	payload: Record<string, unknown>,
	audience: { userId?: string | null; ops?: boolean },
): void {
	const body = { type, at: new Date().toISOString(), ...payload };
	if (audience.userId) publishToUser(audience.userId, body);
	if (audience.ops) publishToOps(body);
}

export { publisher as pubsubConnection };
