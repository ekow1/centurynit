import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../env.js";
import { getSetting } from "../settings.js";
import {
	StorageError,
	StorageNotConfiguredError,
	type DocumentStorage,
	type SignedDownload,
	type SignedUpload,
	type StoredObject,
} from "./types.js";

/**
 * Supabase Storage.
 *
 * Uses the **service-role** key, which bypasses row-level security. That is the
 * right key here and the wrong key almost anywhere else: this server is the
 * thing deciding who may touch which document, and it does so from the session
 * before ever calling storage. The key must never reach the browser.
 *
 * Credentials are read from the platform settings service (DB-stored,
 * encrypted, managed from the ops UI) with a fallback to the `SUPABASE_*` env
 * vars. The client is created lazily on first use so a key changed from the UI
 * takes effect without a restart — at the cost of one settings read per
 * storage operation.
 *
 * The bucket is private. Every read is a signed, expiring URL.
 */

const DEFAULT_UPLOAD_TTL = 60 * 5;
const DEFAULT_DOWNLOAD_TTL = 60 * 5;

export async function supabaseStorageConfigured(): Promise<boolean> {
	const url = await getSetting("SUPABASE_URL");
	const key = await getSetting("SUPABASE_SERVICE_ROLE_KEY");
	return Boolean(url && key);
}

export class SupabaseDocumentStorage implements DocumentStorage {
	readonly enabled = true;
	private clientPromise: Promise<SupabaseClient> | null = null;
	private bucketPromise: Promise<string> | null = null;

	private async getClient(): Promise<{ client: SupabaseClient; bucket: string }> {
		if (!this.clientPromise) {
			this.clientPromise = (async () => {
				const url = await getSetting("SUPABASE_URL");
				const key = await getSetting("SUPABASE_SERVICE_ROLE_KEY");
				if (!url || !key) throw new StorageNotConfiguredError();
				return createClient(url, key, {
					auth: {
						persistSession: false,
						autoRefreshToken: false,
					},
				});
			})();
		}
		if (!this.bucketPromise) {
			this.bucketPromise = (async () => {
				return (await getSetting("SUPABASE_STORAGE_BUCKET")) ?? env.SUPABASE_STORAGE_BUCKET;
			})();
		}
		return { client: await this.clientPromise, bucket: await this.bucketPromise };
	}

	async createUploadUrl(input: {
		key: string;
		contentType: string;
		expiresInSeconds?: number;
	}): Promise<SignedUpload> {
		const { client, bucket } = await this.getClient();
		const { data, error } = await client.storage
			.from(bucket)
			.createSignedUploadUrl(input.key);

		if (error || !data) {
			throw new StorageError(error?.message ?? "Could not create an upload URL");
		}

		return {
			url: data.signedUrl,
			key: input.key,
			headers: { "content-type": input.contentType },
			expiresAt: new Date(Date.now() + (input.expiresInSeconds ?? DEFAULT_UPLOAD_TTL) * 1000),
		};
	}

	async createDownloadUrl(input: {
		key: string;
		expiresInSeconds?: number;
		downloadAs?: string;
	}): Promise<SignedDownload> {
		const ttl = input.expiresInSeconds ?? DEFAULT_DOWNLOAD_TTL;
		const { client, bucket } = await this.getClient();
		const { data, error } = await client.storage
			.from(bucket)
			.createSignedUrl(input.key, ttl, input.downloadAs ? { download: input.downloadAs } : undefined);

		if (error || !data) {
			throw new StorageError(error?.message ?? "Could not create a download URL");
		}

		return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttl * 1000) };
	}

	async head(key: string): Promise<StoredObject | null> {
		const { client, bucket } = await this.getClient();
		const lastSlash = key.lastIndexOf("/");
		const prefix = lastSlash === -1 ? "" : key.slice(0, lastSlash);
		const name = lastSlash === -1 ? key : key.slice(lastSlash + 1);

		const { data, error } = await client.storage
			.from(bucket)
			.list(prefix, { search: name, limit: 100 });

		if (error) throw new StorageError(error.message);

		const hit = data?.find((f) => f.name === name);
		if (!hit) return null;

		return {
			key,
			size: (hit.metadata?.size as number | undefined) ?? null,
			contentType: (hit.metadata?.mimetype as string | undefined) ?? null,
		};
	}

	async remove(key: string): Promise<void> {
		const { client, bucket } = await this.getClient();
		const { error } = await client.storage.from(bucket).remove([key]);
		if (error && !/not found/i.test(error.message)) {
			throw new StorageError(error.message);
		}
	}
}

/**
 * Used when Supabase Storage is not configured.
 *
 * Refuses rather than accepting a document it cannot store — an applicant who
 * believes their passport was uploaded, when it was not, is worse off than one
 * told plainly that uploads are unavailable.
 */
export class DisabledDocumentStorage implements DocumentStorage {
	readonly enabled = false;

	private refuse(): never {
		throw new StorageNotConfiguredError();
	}

	async createUploadUrl(): Promise<SignedUpload> {
		this.refuse();
	}
	async createDownloadUrl(): Promise<SignedDownload> {
		this.refuse();
	}
	async head(): Promise<StoredObject | null> {
		return null;
	}
	async remove(): Promise<void> {
		// Nothing was ever stored, so there is nothing to delete.
	}
}
