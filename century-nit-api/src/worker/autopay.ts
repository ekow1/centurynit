import { Worker } from "bullmq";
import { connection } from "./queues.js";
import { runAutoPaySweep } from "../services/autopay.js";

/**
 * The auto-pay sweep — charges saved cards on instalment due dates.
 *
 * Scheduled once a day (see `scheduleAutoPaySweep`). The job is idempotent:
 * `autopay_attempts` records every charge, so a re-run within the retry
 * window skips lines already attempted and a settled line never re-charges.
 */
export const autopayWorker = new Worker(
	"autopay",
	async (job) => {
		if (job.name === "sweep") {
			// Before charging anything: date any milestone whose event happened
			// but was never stamped, so nothing stays owed-but-unbilled.
			const { reconcileDueTriggers } = await import("../services/serviceFee.js");
			const rec = await reconcileDueTriggers();
			if (rec.stamped) console.log(`[autopay] reconciled ${rec.stamped} undated milestone line(s) on ${rec.invoices} invoice(s)`);
			const result = await runAutoPaySweep();
			if (result.charged || result.failed) {
				console.log(`[autopay] charged ${result.charged}, failed ${result.failed}, skipped ${result.skipped}`);
			}
		}
	},
	{ connection },
);
