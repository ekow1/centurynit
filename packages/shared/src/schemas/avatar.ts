import { z } from "zod";

/**
 * Profile-picture contracts.
 *
 * The photo follows the same shape as applicant documents — a signed URL the
 * browser PUTs the bytes straight to, with the server deciding who may do what
 * before any URL is issued — but it is one image per account, so there is no
 * document row: the storage key lives in `users.image` and the server is told
 * which key to commit on `complete`.
 *
 * A profile photo is small and public-ish (it is the face the applicant's own
 * consultants see), so the ceiling is far lower than a passport scan's.
 */

/** Square-crop-friendly formats only — no HEIC, no WebP. */
export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png"] as const;

/** 5 MB — a phone photo after client-side compression, never a raw RAW file. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const requestAvatarUploadSchema = z.object({
	fileName: z.string().min(1).max(255),
	contentType: z.enum(ALLOWED_AVATAR_TYPES, {
		errorMap: () => ({ message: "Upload a JPEG or PNG photo" }),
	}),
	sizeBytes: z
		.number()
		.int()
		.positive()
		.max(MAX_AVATAR_BYTES, "That photo is larger than 5 MB"),
});
export type RequestAvatarUpload = z.infer<typeof requestAvatarUploadSchema>;

export const avatarUploadTicketSchema = z.object({
	/** Storage key the browser is uploading to; hand it back on complete. */
	key: z.string().min(1).max(512),
	/** Where the browser PUTs the file. Short-lived. */
	uploadUrl: z.string().url(),
	headers: z.record(z.string()).optional(),
	expiresAt: z.string().datetime(),
});
export type AvatarUploadTicket = z.infer<typeof avatarUploadTicketSchema>;

export const completeAvatarUploadSchema = z.object({
	/** The key the ticket returned. Refused unless it is this user's own folder. */
	key: z.string().min(1).max(512),
});
export type CompleteAvatarUpload = z.infer<typeof completeAvatarUploadSchema>;

export const avatarUrlSchema = z.object({
	/** Freshly signed download URL, or null when no photo is set. */
	url: z.string().url().nullable(),
	expiresAt: z.string().datetime().nullable(),
});
export type AvatarUrl = z.infer<typeof avatarUrlSchema>;

export const AVATAR_ERROR_CODES = {
	STORAGE_NOT_CONFIGURED: "STORAGE_NOT_CONFIGURED",
	UPLOAD_NOT_COMPLETED: "UPLOAD_NOT_COMPLETED",
	FILE_TYPE_NOT_ALLOWED: "FILE_TYPE_NOT_ALLOWED",
	INVALID_KEY: "INVALID_KEY",
} as const;
