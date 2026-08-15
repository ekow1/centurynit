/**
 * Object storage for applicant documents.
 *
 * Behind an interface for the same reason the calendar and SMS senders are:
 * the feature has to be buildable and testable before credentials exist, and it
 * must never claim to have stored a file it did not.
 *
 * Uploads and downloads both go through *signed URLs* rather than streaming
 * through this API. Passport scans and bank statements are large and private:
 * routing them through the Node process would make it the bottleneck and put
 * the bytes in application memory for no benefit. The server decides who may
 * upload or read, and hands back a short-lived URL that permits exactly that.
 */

export type StoredObject = {
	/** Path within the bucket. The database stores this, never a public URL. */
	key: string;
	size: number | null;
	contentType: string | null;
};

export type SignedUpload = {
	/** Where the browser PUTs the file. */
	url: string;
	/** The key to record once the upload succeeds. */
	key: string;
	/** Extra headers the browser must send, if the provider requires them. */
	headers?: Record<string, string>;
	expiresAt: Date;
};

export type SignedDownload = {
	url: string;
	expiresAt: Date;
};

export class StorageNotConfiguredError extends Error {
	constructor() {
		super("Document storage is not configured on this server");
		this.name = "StorageNotConfiguredError";
	}
}

export class StorageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StorageError";
	}
}

export interface DocumentStorage {
	readonly enabled: boolean;

	/** A short-lived URL the browser can upload one file to. */
	createUploadUrl(input: {
		key: string;
		contentType: string;
		expiresInSeconds?: number;
	}): Promise<SignedUpload>;

	/**
	 * A short-lived URL to read one object.
	 *
	 * Always signed and always expiring — the bucket is private, so a leaked link
	 * stops working rather than exposing an applicant's passport indefinitely.
	 */
	createDownloadUrl(input: {
		key: string;
		expiresInSeconds?: number;
		/** Suggests a filename to the browser instead of rendering inline. */
		downloadAs?: string;
	}): Promise<SignedDownload>;

	/** Confirms an upload landed, and reports what actually arrived. */
	head(key: string): Promise<StoredObject | null>;

	remove(key: string): Promise<void>;
}
