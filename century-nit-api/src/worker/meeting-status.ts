import { Worker } from "bullmq";
import { connection } from "./queues.js";
import { pollMeetingStatus } from "../services/meeting-status.js";

/**
 * Meeting-status poller worker.
 *
 * Consumes `poll` jobs on the `meetingStatus` queue — one every 60 seconds
 * from the repeatable scheduler in `queues.ts`. Each run fetches online
 * bookings whose slot is in the active window and calls `spaces.get` to
 * update `meetingActive` / `meetingParticipants` / `meetingCheckedAt`.
 *
 * Errors are per-booking inside `pollMeetingStatus`; a failed run retries via
 * BullMQ's default backoff without losing the next tick.
 */
export const meetingStatusWorker = new Worker(
	"meetingStatus",
	async (job) => {
		if (job.name === "poll") {
			await pollMeetingStatus();
		}
	},
	{ connection },
);
