import { Worker } from "bullmq";
import { connection } from "./queues.js";
import { runCampaignSend } from "../services/marketing.js";

/**
 * Campaign worker.
 *
 * Consumes the `campaign` queue that `queues.ts` produces to. A job here is a
 * full campaign delivery pass: the worker reads the campaign's recipient
 * ledger from the DB and sends each email, recording per-recipient outcomes.
 *
 * Delayed jobs (scheduled campaigns) are ordinary jobs with a `delay`, so they
 * need no separate handling. Concurrency is 1 — a campaign pass holds the
 * worker while it runs, and hammering Resend with concurrent passes would
 * invite rate limits.
 */
export const campaignWorker = new Worker<{ campaignId: string }>(
	"campaign",
	async (job) => {
		const { campaignId } = job.data;
		console.log(`[campaign] sending campaign ${campaignId} (attempt ${job.attemptsMade + 1})`);
		try {
			await runCampaignSend(campaignId);
			return { ok: true };
		} catch (err) {
			console.error(`[campaign] campaign ${campaignId} failed:`, err);
			throw err;
		}
	},
	{ connection, concurrency: 1 },
);

campaignWorker.on("failed", (job, err) => {
	console.error(
		`[campaign] job ${job?.id} failed (attempt ${job?.attemptsMade ?? 0}):`,
		err.message,
	);
});