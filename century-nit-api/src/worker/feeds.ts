import { Worker } from "bullmq";
import { connection } from "./queues.js";
import { syncCalendarFeeds } from "../services/calendar/ics.js";

/**
 * iCal feed mirror worker.
 *
 * Consumes `syncFeeds` jobs on the (reused) `calendar` queue — the only thing
 * that queue now does, since Google Calendar was removed. Jobs come from the
 * repeatable scheduler in `queues.ts` and from manual "Sync now" triggers. A
 * failed fetch/parse for one feed never fails the job: `syncCalendarFeeds`
 * catches per-feed and records `lastError` on the row, so the worker logs a
 * clean completion rather than churning retries for a permanently bad URL.
 */
export const feedsWorker = new Worker(
	"calendar",
	async (job) => {
		if (job.name === "syncFeeds") {
			await syncCalendarFeeds();
		}
	},
	{ connection },
);
