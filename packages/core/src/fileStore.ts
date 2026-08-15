/**
 * In-memory store for files the applicant actually uploaded.
 *
 * Deliberately NOT persisted. App state goes to localStorage, and a couple of
 * base64 PDFs would exhaust the ~5MB quota and break the whole save. Object
 * URLs live for the session; after a reload the viewer falls back to rendering
 * a facsimile from the record's metadata, which is all seeded records ever had.
 */

export type StoredFile = {
	name: string;
	type: string;
	size: number;
	url: string;
};

const files = new Map<string, StoredFile>();

/** Key by document name - that is the only identifier that survives into ops records */
export function putFile(key: string, file: File): StoredFile {
	const existing = files.get(key);
	if (existing) URL.revokeObjectURL(existing.url);

	const stored: StoredFile = {
		name: file.name,
		type: file.type || guessType(file.name),
		size: file.size,
		url: URL.createObjectURL(file),
	};
	files.set(key, stored);
	return stored;
}

export function getFile(key: string | null | undefined): StoredFile | undefined {
	if (!key) return undefined;
	return files.get(key);
}

export function dropFile(key: string) {
	const existing = files.get(key);
	if (existing) {
		URL.revokeObjectURL(existing.url);
		files.delete(key);
	}
}

/** Browsers leave `type` empty for some files - fall back to the extension */
function guessType(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "pdf") return "application/pdf";
	if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
	if (["doc", "docx"].includes(ext)) return "application/msword";
	return "application/octet-stream";
}

export function isPreviewable(type: string): "pdf" | "image" | null {
	if (type === "application/pdf") return "pdf";
	if (type.startsWith("image/")) return "image";
	return null;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
