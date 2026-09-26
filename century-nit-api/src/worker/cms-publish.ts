import { Worker } from "bullmq";
import { connection } from "./queues.js";
import { publishDueEntries } from "../services/cms.js";

/**
 * CMS scheduled-publish sweep.
 *
 * Every minute (scheduled by scheduleCmsPublishSweep) this flips cms_entries
 * rows sitting in review whose scheduledAt has passed to published — the
 * timestamp the editor set in the console becomes the publish instant.
 */
export const cmsPublishWorker = new Worker(
	"cmsPublish",
	async () => {
		const published = await publishDueEntries();
		if (published > 0) {
			console.log(`[cms-publish] published ${published} scheduled entr${published === 1 ? "y" : "ies"}`);
		}
	},
	{ connection, concurrency: 1 },
);

cmsPublishWorker.on("failed", (job, err) => {
	console.error(`[cms-publish] job ${job?.id} failed:`, err);
});
