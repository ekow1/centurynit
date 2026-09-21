import { Worker } from "bullmq";
import { connection } from "./queues.js";
import { runHelpdeskSweep } from "../services/communication.js";

/**
 * Unclaimed-request sweep.
 *
 * Every 15 minutes (scheduled by scheduleHelpdeskSweep) this hands open
 * client-facing conversations that have no owner — and have sat past the
 * grace period — to the least-loaded available customer-service agent.
 * The auto-claim-on-first-reply path still wins when an agent answers first;
 * this only picks up what nobody touched.
 */
export const helpdeskSweepWorker = new Worker(
	"helpdeskSweep",
	async () => {
		const { assigned } = await runHelpdeskSweep();
		if (assigned > 0) {
			console.log(`[helpdesk-sweep] auto-assigned ${assigned} request(s)`);
		}
	},
	{ connection, concurrency: 1 },
);

helpdeskSweepWorker.on("failed", (job, err) => {
	console.error(`[helpdesk-sweep] job ${job?.id} failed:`, err);
});
