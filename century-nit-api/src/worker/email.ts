import { Worker } from "bullmq";
import { sendEmail } from "../lib/resend.js";
import { connection } from "./queues.js";

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
 */
export const emailWorker = new Worker<{
	to: string;
	subject: string;
	html?: string;
	text?: string;
}>(
	"email",
	async (job) => {
		const { to, subject, html, text } = job.data;
		console.log(`[email] -> ${to} — ${subject}`);
		return sendEmail({ to, subject, html, text });
	},
	{ connection, concurrency: 5 },
);

emailWorker.on("failed", (job, err) => {
	console.error(
		`[email] job ${job?.id} failed (attempt ${job?.attemptsMade ?? 0}):`,
		err.message,
	);
});
