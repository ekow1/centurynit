import { Worker } from "bullmq";
import { sendEmail } from "../lib/resend.js";
import { connection } from "./queues.js";
import { db } from "../db/index.js";
import { notificationLog } from "../db/schema.js";

/**
 * Email worker.
 *
 * Consumes the queue that `queues.ts` produces to — including delayed reminder
 * jobs, which are ordinary jobs with a `delay`, so they need no separate worker.
 *
 * The Redis connection and the `email` Queue now come from `queues.ts` rather
 * than being created again here. This file used to define its own of each,
 * which meant two connections and two `Queue("email")` instances pointing at
 * the same keys — harmless by luck rather than design.
 *
 * Throwing propagates to BullMQ, which is what triggers the retry/backoff
 * configured on the producer side. Swallowing an error here would silently drop
 * the notification instead.
 *
 * After each send attempt (success or failure) a row is written to
 * `notification_log` so the ops console can show a real delivery history.
 */
export const emailWorker = new Worker<{
	to: string;
	subject: string;
	html?: string;
	text?: string;
	idempotencyKey?: string;
	template?: string;
	reference?: string;
}>(
	"email",
	async (job) => {
		const { to, subject, html, text, idempotencyKey, template, reference } = job.data;
		console.log(`[email] -> ${to} — ${subject}`);
		try {
			await sendEmail({ to, subject, html, text });
			await db
				.insert(notificationLog)
				.values({
					recipient: to,
					subject,
					template: template ?? null,
					status: "sent",
					reference: reference ?? null,
					idempotencyKey: idempotencyKey ?? null,
				})
				.catch(() => {});
			return { ok: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[email] failed to send to ${to}:`, message);
			await db
				.insert(notificationLog)
				.values({
					recipient: to,
					subject,
					template: template ?? null,
					status: "failed",
					reference: reference ?? null,
					idempotencyKey: idempotencyKey ?? null,
					errorMessage: message,
				})
				.catch(() => {});
			throw err;
		}
	},
	{ connection, concurrency: 5 },
);

emailWorker.on("failed", (job, err) => {
	console.error(
		`[email] job ${job?.id} failed (attempt ${job?.attemptsMade ?? 0}):`,
		err.message,
	);
});
