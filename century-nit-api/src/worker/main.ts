import { emailWorker } from "./email.js";
import { feedsWorker } from "./feeds.js";
import { connection, emailQueue, calendarQueue, scheduleFeedSyncs } from "./queues.js";

/**
 * Background worker process.
 *
 * Everything the request path deliberately defers ends up here:
 *
 *   email     notifications and reminders — queued, never sent inline, so a
 *             failed send can never roll back a successful booking (§13)
 *
 * Google Calendar handling has been removed — meeting links are set manually
 * by staff, so there is no calendar worker anymore.
 *
 * Run alongside the API, not inside it. A retry storm or a slow send
 * would otherwise compete with request handling, and the API should be able to
 * scale separately from a queue that is idle most of the time.
 *
 *   npm run worker --workspace=century-nit-api
 *
 * Until this process runs, jobs accumulate in Redis and nothing consumes them:
 * bookings still succeed, but meeting links never arrive and no email is sent.
 */

const workers = [
	{ name: "email", worker: emailWorker },
	{ name: "feeds", worker: feedsWorker },
];

console.log(
	`Century NIT workers started: ${workers.map((w) => w.name).join(", ")}`,
);

for (const { name, worker } of workers) {
	worker.on("ready", () => console.log(`[${name}] ready`));
	worker.on("error", (err) => console.error(`[${name}] error:`, err.message));
}

// Schedule the recurring iCal feed mirror (idempotent — BullMQ dedupes by key).
scheduleFeedSyncs().catch((err) => console.error("[feeds] schedule error:", err.message));

/**
 * Graceful shutdown.
 *
 * `close()` lets an in-flight job finish before the process exits. Killing the
 * process mid-job would leave it stalled until BullMQ's lock expires, delaying
 * the very retry the job exists to perform.
 */
let shuttingDown = false;

async function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n${signal} received — finishing in-flight jobs…`);

	const timeout = setTimeout(() => {
		console.error("Shutdown timed out after 30s — exiting anyway.");
		process.exit(1);
	}, 30_000);

	try {
		await Promise.all(workers.map(({ worker }) => worker.close()));
		await Promise.all([emailQueue.close(), calendarQueue.close()]);
		await connection.quit();
		clearTimeout(timeout);
		console.log("Workers stopped cleanly.");
		process.exit(0);
	} catch (err) {
		clearTimeout(timeout);
		console.error("Error during shutdown:", err);
		process.exit(1);
	}
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// A rejected promise that reaches here means a bug, not a job failure — job
// failures are handled by BullMQ. Log loudly rather than dying silently.
process.on("unhandledRejection", (reason) => {
	console.error("[worker] unhandled rejection:", reason);
});
