import { Worker } from "bullmq";
import { and, eq, lt } from "drizzle-orm";
import { connection } from "./queues.js";
import { db } from "../db/index.js";
import { applicantDocuments } from "../db/schema.js";
import { getDocumentStorage, StorageNotConfiguredError } from "../services/storage/index.js";

/**
 * Hard-delete rejected/superseded documents whose TTL has expired.
 *
 * The job is idempotent: if a row is deleted ahead of the worker (e.g. by a
 * successful re-upload that replaced it), the query simply returns nothing.
 */
async function cleanupExpiredDocuments(): Promise<{
	purged: number;
	failed: number;
	storageUnavailable: boolean;
}> {
	const storage = await getDocumentStorage();
	if (!storage.enabled) {
		console.warn("[document-cleanup] storage not configured; skipping run");
		return { purged: 0, failed: 0, storageUnavailable: true };
	}

	const expired = await db
		.select({ id: applicantDocuments.id, storageKey: applicantDocuments.storageKey })
		.from(applicantDocuments)
		.where(and(eq(applicantDocuments.status, "REJECTED"), lt(applicantDocuments.expiresAt, new Date())));

	let purged = 0;
	let failed = 0;

	for (const doc of expired) {
		try {
			await storage.remove(doc.storageKey).catch((err) => {
				// Already-gone objects are fine to ignore.
				if (err instanceof StorageNotConfiguredError) throw err;
				console.warn(`[document-cleanup] could not remove ${doc.storageKey}:`, err instanceof Error ? err.message : err);
			});
			await db.delete(applicantDocuments).where(eq(applicantDocuments.id, doc.id));
			purged++;
		} catch (err) {
			failed++;
			console.error(
				`[document-cleanup] failed to purge document ${doc.id}:`,
				err instanceof Error ? err.message : err,
			);
		}
	}

	return { purged, failed, storageUnavailable: false };
}

export const documentCleanupWorker = new Worker(
	"documentCleanup",
	async (job) => {
		if (job.name === "cleanup") {
			const result = await cleanupExpiredDocuments();
			if (result.purged || result.failed) {
				console.log(
					`[document-cleanup] purged ${result.purged} document(s), ${result.failed} failure(s)`,
				);
			}
		}
	},
	{ connection },
);
