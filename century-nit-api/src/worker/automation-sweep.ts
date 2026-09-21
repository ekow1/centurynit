import { Worker } from "bullmq";
import { connection } from "./queues.js";
import { runDueAutomationSends } from "../services/marketing.js";

/**
 * Automation send sweep.
 *
 * Every minute (scheduled by scheduleAutomationSweep) this walks the
 * automation_sends rows whose scheduledFor has passed and delivers them —
 * the same personalize + layout + tracked-link + suppression-check path a
 * campaign send runs. Paused/draft automations have their rows skipped.
 */
export const automationSweepWorker = new Worker(
	"automationSweep",
	async (job) => {
		if (job.name === "dates") {
			const { runAutomationDateTriggers } = await import("../services/automationHooks.js");
			const res = await runAutomationDateTriggers();
			if (res.departures + res.overdue > 0) {
				console.log(`[automation-sweep] date triggers: ${res.departures} departures, ${res.overdue} overdue`);
			}
			return;
		}
		const sent = await runDueAutomationSends(100);
		if (sent > 0) {
			console.log(`[automation-sweep] delivered ${sent} automation send(s)`);
		}
	},
	{ connection, concurrency: 1 },
);

automationSweepWorker.on("failed", (job, err) => {
	console.error(`[automation-sweep] job ${job?.id} failed:`, err);
});
