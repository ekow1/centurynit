import { Worker } from "bullmq";
import { sendEmail } from "../lib/resend.js";
import { connection } from "./queues.js";
import { notify, getManagerAndCoordinatorUserIds } from "../services/notify.js";

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
 * The audit row is written inside `sendEmail` — upserted on the job's
 * idempotency key, so retries update one row rather than adding entries, and
 * direct (unqueued) sends are logged the same way.
 */
export const emailWorker = new Worker<{
	to: string;
	subject: string;
	html?: string;
	text?: string;
	/** Admission letters and the like — `key` is resolved to a fresh download URL at send time. `content` is a base64 string. */
	attachments?: Array<{ filename: string; path?: string; key?: string; content?: string }>;
	idempotencyKey?: string;
	template?: string;
	event?: string;
	reference?: string;
	queuedAt?: string;
}>(
	"email",
	async (job) => {
		const { to, subject, html, text, attachments, idempotencyKey, template, event, reference, queuedAt } = job.data;
		console.log(`[email] -> ${to} — ${subject}`);

		// Storage keys are resolved at send time — a presigned URL baked into the
		// job would have expired by the time a retry runs.
		const resolved = attachments
			? await Promise.all(
					attachments.map(async (a) => {
						if (a.content) {
							return { filename: a.filename, content: Buffer.from(a.content, "base64") };
						}
						if (!a.key) return { filename: a.filename, path: a.path };
						try {
							const { getDocumentStorage } = await import("../services/storage/index.js");
							const storage = await getDocumentStorage();
							if (!storage.enabled) return { filename: a.filename, path: a.path };
							const ticket = await storage.createDownloadUrl({ key: a.key });
							return { filename: a.filename, path: ticket.url };
						} catch {
							return { filename: a.filename, path: a.path };
						}
					}),
				)
			: undefined;

		await sendEmail({
			to,
			subject,
			html,
			text,
			attachments: resolved,
			log: {
				template,
				event,
				reference,
				idempotencyKey,
				attempts: job.attemptsMade + 1,
				queuedAt: queuedAt ? new Date(queuedAt) : undefined,
			},
		});
		return { ok: true };
	},
	{ connection, concurrency: 5 },
);

emailWorker.on("failed", (job, err) => {
	console.error(
		`[email] job ${job?.id} failed (attempt ${job?.attemptsMade ?? 0}):`,
		err.message,
	);
	// The final attempt has failed — the email is permanently undelivered.
	// Flag it to the people who triage the queue so it is re-sent or the
	// client is contacted by hand, instead of vanishing into the failed set.
	if (job && job.attemptsMade === (job.opts.attempts ?? 0)) {
		void getManagerAndCoordinatorUserIds()
			.then((recipients) =>
				Promise.all(
					recipients.map(({ userId }) =>
						notify({
							eventId: `email:dead:${job.id}`,
							recipientUserId: userId,
							type: "email.failed",
							title: "Email delivery failed permanently",
							body: `"${job.data.subject}" to ${job.data.to} — ${job.attemptsMade} attempts, last error: ${err.message}`,
							link: "/notifications",
							priority: "high",
							entityType: "notification",
							entityId: String(job.id),
						}),
					),
				),
			)
			.catch((e) => console.error("[email] dead-letter alert failed:", e));
	}
});
