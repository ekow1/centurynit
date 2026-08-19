import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { pushSubscriptions } from "../db/schema.js";
import { sendPushNotification } from "../lib/push.js";
import { connection, type PushJob } from "./queues.js";

/**
 * Push (browser notification) worker.
 *
 * Consumes the queue that `queuePush` produces. For each job it loads every
 * subscription the recipient owns and sends the payload to each one, pruning
 * any that the push service reports as gone (410 / 404) so a dead subscription
 * never gets retried.
 *
 * If *every* subscription for a job fails, the job rethrows so BullMQ retries
 * it under the same exponential backoff as email — a transient push-service
 * outage should not silently drop a notification. A partial failure (some
 * subscriptions delivered, some not) is treated as success: the recipient was
 * reached, and the failed subscriptions will either recover on the next job or
 * be pruned as gone.
 */

export const pushWorker = new Worker<PushJob>(
	"push",
	async (job) => {
		const { userId, notification } = job.data;
		const payload = JSON.stringify({
			title: notification.title,
			body: notification.body,
			link: notification.link ?? null,
			type: notification.type,
		});

		const subs = await db
			.select()
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.userId, userId));

		if (subs.length === 0) return { ok: true, sent: 0, reason: "no-subscriptions" };

		let sent = 0;
		let failed = 0;
		const now = new Date();

		for (const sub of subs) {
			const result = await sendPushNotification(
				{ endpoint: sub.endpoint, keys: sub.keys },
				payload,
			);

			if (result.gone) {
				// The push service has expired or revoked this subscription.
				// Prune it so no future job wastes a round-trip on it.
				await db
					.delete(pushSubscriptions)
					.where(eq(pushSubscriptions.id, sub.id))
					.catch(() => {
						/* already deleted by a concurrent job — fine */
					});
				failed++;
				continue;
			}

			if (result.ok) {
				sent++;
			} else {
				failed++;
			}

			// Refresh lastUsedAt for any subscription we actually reached, so
			// the ops console can show which browsers are still active.
			if (result.ok) {
				await db
					.update(pushSubscriptions)
					.set({ lastUsedAt: now })
					.where(eq(pushSubscriptions.id, sub.id))
					.catch(() => {
						/* a stale lastUsedAt is harmless */
					});
			}
		}

		console.log(
			`[push] notification ${notification.id} → ${userId}: sent=${sent} failed=${failed} of ${subs.length}`,
		);

		// If every subscription failed (and none were pruned as gone), rethrow so
		// BullMQ retries under the standard backoff — the failure was likely a
		// transient push-service outage rather than per-subscription expiry.
		if (sent === 0 && failed === subs.length) {
			throw new Error(
				`[push] all ${failed} subscriptions failed for notification ${notification.id}`,
			);
		}

		return { ok: true, sent, failed };
	},
	{ connection, concurrency: 5 },
);

pushWorker.on("failed", (job, err) => {
	console.error(
		`[push] job ${job?.id} failed (attempt ${job?.attemptsMade ?? 0}):`,
		err.message,
	);
});
