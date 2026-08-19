import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../env.js";
import type { QueuedEmail } from "../services/notifications.js";

/**
 * Queue producers.
 *
 * The `email` queue and its worker already existed but nothing ever enqueued to
 * them. This adds the producers, plus a `calendar` queue for the retry path in
 * §13 — a calendar failure must leave the booking intact and recoverable, which
 * means the retry belongs on a queue rather than in the request.
 *
 * Redis is shared with the existing worker connection settings.
 */

export const connection = new Redis(env.REDIS_URL, {
	maxRetriesPerRequest: null,
	// Cap reconnect backoff at 30s — the ioredis default retries every ~2s
	// forever, which floods the logs during a Redis outage.
	retryStrategy: (times) => Math.min(times * 2_000, 30_000),
});

// Without an error listener every failed reconnect prints
// "[ioredis] Unhandled error event" with a full stack trace.
connection.on("error", (err) => {
	console.error(`[queues] redis error: ${err.message}`);
});

/** BullMQ job ids may not contain `:`, which our idempotency keys use as a separator. */
function toJobId(id: string): string {
	return id.replace(/:/g, ".");
}

/** Exponential backoff — a Google outage should not be hammered. */
const RETRY: JobsOptions = {
	attempts: 5,
	backoff: { type: "exponential", delay: 5_000 },
	removeOnComplete: 1000,
	removeOnFail: 5000,
};

export const emailQueue = new Queue("email", { connection });
export const calendarQueue = new Queue("calendar", { connection });
export const pushQueue = new Queue("push", { connection });

/* ── Email ───────────────────────────────────────────────────────────────── */

/**
 * Queue an email.
 *
 * The message's `idempotencyKey` becomes the BullMQ job id, so re-running an
 * operation that has already notified is a no-op: BullMQ refuses a duplicate job
 * id rather than sending a second copy (§14).
 */
export async function queueEmail(message: QueuedEmail): Promise<void> {
	if (!message.to) return; // nothing to send to — e.g. unassigned booking
	await emailQueue.add("send", message, { ...RETRY, jobId: toJobId(message.idempotencyKey) });
}

export async function queueEmails(messages: QueuedEmail[]): Promise<void> {
	await Promise.all(messages.map(queueEmail));
}

/* ── Calendar ────────────────────────────────────────────────────────────── */

export type CalendarJob =
	| { type: "sync"; bookingId: string }
	| { type: "update"; bookingId: string }
	| { type: "cancel"; bookingId: string }
	| { type: "refreshBusy"; opsUserId: string };

/**
 * Queue calendar work.
 *
 * Job id is derived from the operation so a retry of the same logical action
 * collapses onto the existing job instead of creating a second calendar event.
 */
export async function queueCalendar(job: CalendarJob): Promise<void> {
	const id =
		job.type === "refreshBusy"
			? `calendar:refreshBusy:${job.opsUserId}`
			: `calendar:${job.type}:${job.bookingId}`;
	await calendarQueue.add(job.type, job, { ...RETRY, jobId: toJobId(id) });
}

/**
 * Remove a completed job id so the same logical operation can run again later.
 *
 * Needed because a reschedule may legitimately update the same booking's event
 * more than once, and the job id would otherwise be permanently claimed.
 */
export async function releaseCalendarJob(job: CalendarJob): Promise<void> {
	const id =
		job.type === "refreshBusy"
			? `calendar:refreshBusy:${job.opsUserId}`
			: `calendar:${job.type}:${job.bookingId}`;
	const existing = await calendarQueue.getJob(toJobId(id));
	if (existing && (await existing.isCompleted())) {
		await existing.remove();
	}
}

/** Reminder scheduled for a specific instant. */
export async function queueReminder(
	message: QueuedEmail,
	sendAt: Date,
): Promise<void> {
	const delay = sendAt.getTime() - Date.now();
	if (delay <= 0) return; // in the past — nothing useful to send
	await emailQueue.add("send", message, {
		...RETRY,
		jobId: toJobId(message.idempotencyKey),
		delay,
	});
}

/** Cancel a scheduled reminder, e.g. after a cancellation or reschedule. */
export async function cancelQueued(idempotencyKey: string): Promise<void> {
	const job = await emailQueue.getJob(toJobId(idempotencyKey));
	if (job && !(await job.isActive())) {
		await job.remove().catch(() => {
			/* already gone or running — nothing to do */
		});
	}
}

/* ── Push (browser notifications) ────────────────────────────────────────── */

/**
 * One push fan-out: deliver a single notification to every subscription owned
 * by `userId`. The worker reads the subscriptions from the DB at run time, so
 * a browser that subscribes after the job was enqueued still receives it as
 * long as the job has not yet been picked up.
 */
export type PushJob = {
	userId: string;
	notification: {
		id: string;
		type: string;
		title: string;
		body: string;
		link?: string | null;
	};
};

/**
 * Queue a push fan-out for a notification row.
 *
 * The idempotency key is `push:{notificationId}:{userId}`, so re-running the
 * same logical notification collapses onto the existing job instead of
 * lighting up every browser a second time.
 */
export async function queuePush(job: PushJob): Promise<void> {
	const id = `push:${job.notification.id}:${job.userId}`;
	await pushQueue.add("send", job, { ...RETRY, jobId: toJobId(id) });
}
