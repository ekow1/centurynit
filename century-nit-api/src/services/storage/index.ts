import {
	DisabledDocumentStorage,
	SupabaseDocumentStorage,
	supabaseStorageConfigured,
} from "./supabase.js";
import type { DocumentStorage, SignedDownload, SignedUpload, StoredObject } from "./types.js";

export * from "./types.js";
export { supabaseStorageConfigured } from "./supabase.js";

let storage: DocumentStorage | null = null;
let storageOverride: DocumentStorage | null = null;

/**
 * Resolve storage against the credentials that are configured *now*.
 *
 * This used to decide once, on the first call, and hold that decision for the
 * life of the process. So a deployment that started without Supabase keys was
 * permanently disabled: an administrator could save the keys in the ops console
 * and every upload would still answer STORAGE_NOT_CONFIGURED, telling them to
 * go and set the keys they had just set.
 *
 * The check is cheap — `supabaseStorageConfigured` reads two values from the
 * settings cache — and the Supabase client behind it is reused unless the
 * credentials themselves change. What is re-decided here is only *which kind*
 * of storage is in play, disabled or real, which is exactly the thing that
 * changes when somebody finishes configuring the system.
 */
async function resolveStorage(): Promise<DocumentStorage> {
	if (storageOverride) return storageOverride;

	const configured = await supabaseStorageConfigured();

	if (!configured) {
		// Deliberately not remembered: keys can arrive at any moment.
		return new DisabledDocumentStorage();
	}

	// Reused so the underlying client, and its connection pool, survive.
	storage ??= new SupabaseDocumentStorage();
	return storage;
}

export async function getDocumentStorage(): Promise<DocumentStorage> {
	return resolveStorage();
}

/** Test seam. Returns a restore function. */
export function setDocumentStorage(next: DocumentStorage): () => void {
	const previous = storageOverride;
	storageOverride = next;
	return () => {
		storageOverride = previous;
	};
}

/**
 * In-memory storage for tests.
 *
 * Real enough to exercise the flow — it records what was "uploaded", so a test
 * can assert that a document was stored under the key the database recorded,
 * which is the part that actually goes wrong.
 */
export class MemoryDocumentStorage implements DocumentStorage {
	readonly enabled = true;
	readonly objects = new Map<string, StoredObject>();

	async createUploadUrl(input: { key: string; contentType: string }): Promise<SignedUpload> {
		return {
			url: `memory://upload/${encodeURIComponent(input.key)}`,
			key: input.key,
			headers: { "content-type": input.contentType },
			expiresAt: new Date(Date.now() + 300_000),
		};
	}

	async createDownloadUrl(input: { key: string }): Promise<SignedDownload> {
		return {
			url: `memory://download/${encodeURIComponent(input.key)}`,
			expiresAt: new Date(Date.now() + 300_000),
		};
	}

	async head(key: string): Promise<StoredObject | null> {
		return this.objects.get(key) ?? null;
	}

	async remove(key: string): Promise<void> {
		this.objects.delete(key);
	}

	/** Stand in for the browser's PUT completing. */
	simulateUpload(key: string, size = 1024, contentType = "application/pdf"): void {
		this.objects.set(key, { key, size, contentType });
	}

	reset(): void {
		this.objects.clear();
	}
}
