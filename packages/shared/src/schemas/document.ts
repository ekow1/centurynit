import { z } from "zod";

/**
 * Applicant document contracts.
 *
 * Uploads are two steps: ask the server for a signed URL, PUT the file straight
 * to storage, then tell the server it landed. The file never passes through the
 * API — passport scans and bank statements are large and private, and routing
 * them through Node would make it the bottleneck for no benefit.
 */

export const documentStatusSchema = z.enum([
	"PENDING_UPLOAD",
	"UPLOADED",
	"VERIFIED",
	"REJECTED",
]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

/**
 * What may be uploaded.
 *
 * An allowlist, not a blocklist: anything not named here is refused. HEIC and
 * WebP are deliberately absent — phone HEIC shots are refused as-is because the
 * vault compresses images client-side first (a HEIC that arrives here has been
 * re-encoded as JPEG or PNG), and WebP is still too unevenly supported in the
 * tools reviewers open documents with. Office formats are allowed only in their
 * DOC/DOCX forms, per the portal's requirements.
 */
export const ALLOWED_DOCUMENT_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

/** 15 MB — comfortably above a phone photo of a passport, well below abuse. */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export const requestUploadSchema = z.object({
	/** Which required document this satisfies, e.g. "passport". */
	documentType: z.string().min(1).max(64),
	fileName: z.string().min(1).max(255),
	contentType: z.enum(ALLOWED_DOCUMENT_TYPES, {
		errorMap: () => ({ message: "Upload a PDF, image (JPEG, PNG), or Word document (DOC, DOCX)" }),
	}),
	sizeBytes: z
		.number()
		.int()
		.positive()
		.max(MAX_DOCUMENT_BYTES, "That file is larger than 15 MB"),
});
export type RequestUpload = z.infer<typeof requestUploadSchema>;

export const uploadTicketSchema = z.object({
	documentId: z.string().uuid(),
	/** Where the browser PUTs the file. Short-lived. */
	uploadUrl: z.string().url(),
	headers: z.record(z.string()).optional(),
	expiresAt: z.string().datetime(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const documentSchema = z.object({
	id: z.string().uuid(),
	documentType: z.string(),
	fileName: z.string(),
	contentType: z.string(),
	sizeBytes: z.number().int().nullable(),
	status: documentStatusSchema,
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().datetime().nullable(),
	uploadedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	/** Owner's email — staff-only; omitted from an applicant's own listing. */
	ownerEmail: z.string().email().optional(),
});
export type ApplicantDocument = z.infer<typeof documentSchema>;

export const documentListSchema = z.object({
	documents: z.array(documentSchema),
});

/** A signed, expiring link. Never a permanent URL. */
export const downloadTicketSchema = z.object({
	url: z.string().url(),
	expiresAt: z.string().datetime(),
});
export type DownloadTicket = z.infer<typeof downloadTicketSchema>;

export const reviewDocumentSchema = z.object({
	status: z.enum(["VERIFIED", "REJECTED"]),
	note: z.string().max(1000).optional(),
});
export type ReviewDocument = z.infer<typeof reviewDocumentSchema>;

export const DOCUMENT_ERROR_CODES = {
	STORAGE_NOT_CONFIGURED: "STORAGE_NOT_CONFIGURED",
	DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
	UPLOAD_NOT_COMPLETED: "UPLOAD_NOT_COMPLETED",
	FILE_TYPE_NOT_ALLOWED: "FILE_TYPE_NOT_ALLOWED",
} as const;
