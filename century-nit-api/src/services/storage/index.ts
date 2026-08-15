import {
	DisabledDocumentStorage,
	SupabaseDocumentStorage,
	supabaseStorageConfigured,
} from "./supabase.js";
import type { DocumentStorage, SignedDownload, SignedUpload, StoredObject } from "./types.js";

export * from "./types.js";
export { supabaseStorageConfigured } from "./supabase.js";

let storage: DocumentStorage | null = null;
let storageInitPromise: Promise<DocumentStorage> | null = null;

/**
 * Lazily resolve storage on first call. Reads from the settings service (which
 * may fall back to env vars), so the client is created only when credentials
 * are available. A settings change requires a process restart to pick up —
 * storage is long-lived and re-reading on every call would be wasteful.
 */
async function resolveStorage(): Promise<DocumentStorage> {
	if (storage) return storage;
	if (!storageInitPromise) {
		storageInitPromise = (async () => {
			const configured = await supabaseStorageConfigured();
			storage = configured ? new SupabaseDocumentStorage() : new DisabledDocumentStorage();
			return storage;
		})();
	}
	return storageInitPromise;
}

export async function getDocumentStorage(): Promise<DocumentStorage> {
	return resolveStorage();
}

/** Test seam. Returns a restore function. */
export function setDocumentStorage(next: DocumentStorage): () => void {
	const previous = storage;
	storage = next;
	storageInitPromise = Promise.resolve(next);
	return () => {
		storage = previous;
		storageInitPromise = previous ? Promise.resolve(previous) : null;
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
