import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
	DOCUMENT_ERROR_CODES,
	documentListSchema,
	documentSchema,
	downloadTicketSchema,
	requestUploadSchema,
	reviewDocumentSchema,
	uploadTicketSchema,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { applicantDocuments, bookings, users } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireModule,
	type AuthVariables,
	type StaffContext,
} from "../middleware/auth.js";
import { getDocumentStorage, StorageNotConfiguredError } from "../services/storage/index.js";

/**
 * Applicant documents.
 *
 * Files go straight to storage over a signed URL; only metadata passes through
 * here. The server still decides everything that matters — who may upload, whose
 * document this is, and who may read it — before issuing any URL.
 */

const documentsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

type DocumentRow = typeof applicantDocuments.$inferSelect;

function toResponse(row: DocumentRow, ownerEmail?: string) {
	return {
		id: row.id,
		documentType: row.documentType,
		fileName: row.fileName,
		contentType: row.contentType,
		sizeBytes: row.sizeBytes,
		status: row.status,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt?.toISOString() ?? null,
		uploadedAt: row.uploadedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		...(ownerEmail ? { ownerEmail } : {}),
	};
}

/** Staff who may review documents at all. Matches ROLE_PERMISSIONS.documents. */
function canReview(role: string | undefined): boolean {
	return (
		role === "manager" || role === "coordinator" || role === "consultant" || role === "super_admin"
	);
}

/**
 * Which applicants this caller may reach, beyond themselves.
 *
 * `null` means every applicant: managers, coordinators and super admins route
 * work across the whole operation and need the full queue to do it. A
 * consultant gets a list — the applicants actually assigned to them — which is
 * the same row-level rule `canViewBooking` applies to appointments. Anyone else
 * gets an empty list and can only ever see their own documents.
 *
 * This existed as a comment ("Consultants see their own caseload's") long
 * before it existed as code: the listing applied no caseload filter at all, so
 * any consultant could read every applicant's passport scan and bank statement.
 * The ops UI never offered a way to do it, which is exactly why it went
 * unnoticed — a UI is not an access control.
 *
 * Caseload is derived from bookings rather than stored, because assignment is
 * already modelled there and a second copy would drift.
 */
async function reachableOwnerIds(staff: StaffContext | null): Promise<string[] | null> {
	if (!staff || !canReview(staff.role)) return [];
	if (staff.role !== "consultant") return null;

	const rows = await db
		.selectDistinct({ ownerUserId: bookings.clientUserId })
		.from(bookings)
		.where(eq(bookings.employeeId, staff.opsUserId));

	return rows.map((r) => r.ownerUserId);
}

/** Whether this caller may act on a document owned by `ownerUserId`. */
async function mayReachOwner(
	ownerUserId: string,
	user: { id: string },
	staff: StaffContext | null,
): Promise<boolean> {
	if (ownerUserId === user.id) return true;
	const reachable = await reachableOwnerIds(staff);
	return reachable === null || reachable.includes(ownerUserId);
}

async function storageOrThrow() {
	const storage = await getDocumentStorage();
	if (!storage.enabled) {
		throw new HttpError(
			503,
			DOCUMENT_ERROR_CODES.STORAGE_NOT_CONFIGURED,
			"Document uploads are not available yet. Please try again later.",
		);
	}
	return storage;
}

/**
 * Storage path.
 *
 * Server-generated from the owner id, the document type and a fresh uuid. The
 * applicant's filename is never part of the path: it is attacker-controlled, and
 * a name like `../../other-user/passport.pdf` must not be able to reach another
 * applicant's folder. The original name is kept in the database for display.
 */
function buildStorageKey(ownerUserId: string, documentType: string, fileName: string): string {
	const extension = (fileName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "bin").toLowerCase();
	const safeType = documentType.replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "document";
	return `${ownerUserId}/${safeType}/${randomUUID()}.${extension}`;
}

/* ── POST /api/v1/documents/upload-url ──────────────────────────────────────── */

documentsRouter.openapi(
	createRoute({
		method: "post",
		path: "/upload-url",
		tags: ["Documents"],
		summary: "Request a signed URL to upload a document",
		description:
			"Creates the document record at PENDING_UPLOAD and returns a short-lived URL. " +
			"PUT the file to that URL, then call /api/v1/documents/{id}/complete.",
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: requestUploadSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: uploadTicketSchema } },
				description: "Upload ticket",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const storage = await storageOrThrow();

		const storageKey = buildStorageKey(user.id, body.documentType, body.fileName);

		// Replacing a document of the same type: retire the previous row first, or
		// the partial unique index rejects the new one. The old object is removed
		// only after the replacement is confirmed, in /complete.
		await db
			.update(applicantDocuments)
			.set({ status: "REJECTED", reviewNote: "Replaced by a newer upload", updatedAt: new Date() })
			.where(
				and(
					eq(applicantDocuments.ownerUserId, user.id),
					eq(applicantDocuments.documentType, body.documentType),
					eq(applicantDocuments.status, "PENDING_UPLOAD"),
				),
			);

		const [row] = await db
			.insert(applicantDocuments)
			.values({
				ownerUserId: user.id,
				documentType: body.documentType,
				fileName: body.fileName,
				contentType: body.contentType,
				sizeBytes: body.sizeBytes,
				storageKey,
				status: "PENDING_UPLOAD",
			})
			.onConflictDoUpdate({
				target: [applicantDocuments.ownerUserId, applicantDocuments.documentType],
				set: {
					fileName: body.fileName,
					contentType: body.contentType,
					sizeBytes: body.sizeBytes,
					storageKey,
					status: "PENDING_UPLOAD",
					reviewNote: null,
					reviewedAt: null,
					updatedAt: new Date(),
				},
			})
			.returning();

		const ticket = await storage.createUploadUrl({
			key: storageKey,
			contentType: body.contentType,
		});

		return c.json(
			{
				documentId: row.id,
				uploadUrl: ticket.url,
				headers: ticket.headers,
				expiresAt: ticket.expiresAt.toISOString(),
			},
			201,
		);
	},
);

/* ── POST /api/v1/documents/{id}/complete ───────────────────────────────────── */

documentsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/complete",
		tags: ["Documents"],
		summary: "Confirm an upload finished",
		description:
			"Verifies the object actually exists in storage before marking the document UPLOADED.",
		middleware: [requireAuth] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			200: {
				content: { "application/json": { schema: documentSchema } },
				description: "Document",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const storage = await storageOrThrow();

		const [row] = await db
			.select()
			.from(applicantDocuments)
			.where(and(eq(applicantDocuments.id, id), eq(applicantDocuments.ownerUserId, user.id)))
			.limit(1);

		if (!row) {
			throw new HttpError(404, DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND, "Document not found");
		}

		// Trusting the client here would let anyone mark a document uploaded
		// without a file behind it, and a reviewer would open nothing.
		const object = await storage.head(row.storageKey);
		if (!object) {
			throw new HttpError(
				409,
				DOCUMENT_ERROR_CODES.UPLOAD_NOT_COMPLETED,
				"The file has not finished uploading",
			);
		}

		const [updated] = await db
			.update(applicantDocuments)
			.set({
				status: "UPLOADED",
				// Prefer what storage actually received over what the client claimed.
				sizeBytes: object.size ?? row.sizeBytes,
				uploadedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(applicantDocuments.id, row.id))
			.returning();

		// Now that a replacement is confirmed, clear out superseded objects.
		const superseded = await db
			.select({ id: applicantDocuments.id, storageKey: applicantDocuments.storageKey })
			.from(applicantDocuments)
			.where(
				and(
					eq(applicantDocuments.ownerUserId, user.id),
					eq(applicantDocuments.documentType, row.documentType),
					eq(applicantDocuments.status, "REJECTED"),
					ne(applicantDocuments.id, row.id),
				),
			);
		for (const old of superseded) {
			await storage.remove(old.storageKey).catch(() => {
				/* orphaned object; not worth failing the upload the user just made */
			});
		}

		return c.json(toResponse(updated));
	},
);

/* ── GET /api/v1/documents ──────────────────────────────────────────────────── */

documentsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Documents"],
		summary: "List documents",
		description:
			"Applicants see their own. Staff with the documents module see the review queue.",
		middleware: [requireAuth] as const,
		request: {
			query: z.object({
				/** Staff only — read another applicant's documents. */
				ownerUserId: z.string().optional(),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: documentListSchema } },
				description: "Documents",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff");
		const { ownerUserId } = c.req.valid("query");

		const reachable = await reachableOwnerIds(staff);

		// Asking for a named applicant: it must be you, or one you may reach.
		if (ownerUserId && ownerUserId !== user.id) {
			if (reachable !== null && !reachable.includes(ownerUserId)) {
				throw new HttpError(403, "FORBIDDEN", "You can only view your own documents");
			}
		}

		/*
		 * No applicant named, so this is a listing rather than a lookup:
		 *   - not a reviewer → your own documents
		 *   - consultant     → your caseload, and nothing if you have none
		 *   - manager and up → the whole queue
		 */
		let ownerScope;
		if (ownerUserId) {
			ownerScope = eq(applicantDocuments.ownerUserId, ownerUserId);
		} else if (!canReview(staff?.role)) {
			ownerScope = eq(applicantDocuments.ownerUserId, user.id);
		} else if (reachable !== null) {
			// An empty caseload must mean no documents, not every document — which
			// is what an unfiltered query would have returned.
			if (reachable.length === 0) return c.json({ documents: [] });
			ownerScope = inArray(applicantDocuments.ownerUserId, reachable);
		}

		const rows = await db
			.select({ doc: applicantDocuments, ownerEmail: users.email })
			.from(applicantDocuments)
			.leftJoin(users, eq(users.id, applicantDocuments.ownerUserId))
			.where(
				and(
					ownerScope,
					// A pending row has no file behind it yet; it is bookkeeping.
					ne(applicantDocuments.status, "PENDING_UPLOAD"),
				),
			)
			.orderBy(desc(applicantDocuments.createdAt));

		return c.json({
			documents: rows.map((r) =>
				toResponse(r.doc, canReview(staff?.role) ? (r.ownerEmail ?? undefined) : undefined),
			),
		});
	},
);

/* ── GET /api/v1/documents/{id}/download ────────────────────────────────────── */

documentsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}/download",
		tags: ["Documents"],
		summary: "Get a short-lived download URL",
		middleware: [requireAuth] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			200: {
				content: { "application/json": { schema: downloadTicketSchema } },
				description: "Signed URL",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff");
		const { id } = c.req.valid("param");

		const [row] = await db
			.select()
			.from(applicantDocuments)
			.where(eq(applicantDocuments.id, id))
			.limit(1);

		if (!row) {
			throw new HttpError(404, DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND, "Document not found");
		}
		if (!(await mayReachOwner(row.ownerUserId, user, staff))) {
			throw new HttpError(403, "FORBIDDEN", "You cannot view this document");
		}
		if (row.status === "PENDING_UPLOAD") {
			throw new HttpError(
				409,
				DOCUMENT_ERROR_CODES.UPLOAD_NOT_COMPLETED,
				"That upload never completed",
			);
		}

		/*
		 * Storage last, after authorisation.
		 *
		 * It used to be first, which meant a server with no storage configured
		 * answered 503 to everyone — including someone asking for a document that
		 * is not theirs. That is a request that should be refused on its merits
		 * regardless of how the server happens to be configured, and answering
		 * otherwise leaks a little about the deployment to exactly the caller who
		 * should learn nothing.
		 */
		const storage = await storageOrThrow();

		const ticket = await storage.createDownloadUrl({
			key: row.storageKey,
			downloadAs: row.fileName,
		});

		return c.json({ url: ticket.url, expiresAt: ticket.expiresAt.toISOString() });
	},
);

/* ── POST /api/v1/documents/{id}/review ─────────────────────────────────────── */

documentsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/review",
		tags: ["Documents"],
		summary: "Verify or reject a document",
		middleware: [requireAuth, requireModule("documents")] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
			body: {
				content: { "application/json": { schema: reviewDocumentSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: documentSchema } },
				description: "Reviewed",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");

		/*
		 * `requireModule("documents")` establishes that this role reviews documents
		 * at all; it says nothing about *whose*. Read the row first so a consultant
		 * cannot verify an applicant outside their caseload by posting an id they
		 * guessed or kept from an earlier assignment.
		 */
		const [existing] = await db
			.select({ ownerUserId: applicantDocuments.ownerUserId })
			.from(applicantDocuments)
			.where(eq(applicantDocuments.id, id))
			.limit(1);

		if (existing && !(await mayReachOwner(existing.ownerUserId, user, staff))) {
			throw new HttpError(403, "FORBIDDEN", "That applicant is not on your caseload");
		}

		const [updated] = await db
			.update(applicantDocuments)
			.set({
				status: body.status,
				reviewNote: body.note ?? null,
				reviewedBy: staff.opsUserId,
				reviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(and(eq(applicantDocuments.id, id), ne(applicantDocuments.status, "PENDING_UPLOAD")))
			.returning();

		if (!updated) {
			throw new HttpError(
				404,
				DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND,
				"No uploaded document with that id",
			);
		}

		return c.json(toResponse(updated));
	},
);

/* ── DELETE /api/v1/documents/{id} ──────────────────────────────────────────── */

documentsRouter.openapi(
	createRoute({
		method: "delete",
		path: "/{id}",
		tags: ["Documents"],
		summary: "Delete a document",
		middleware: [requireAuth] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ deleted: z.boolean() }) } },
				description: "Deleted",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff");
		const { id } = c.req.valid("param");

		const [row] = await db
			.select()
			.from(applicantDocuments)
			.where(eq(applicantDocuments.id, id))
			.limit(1);

		if (!row) {
			throw new HttpError(404, DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND, "Document not found");
		}
		if (!(await mayReachOwner(row.ownerUserId, user, staff))) {
			throw new HttpError(403, "FORBIDDEN", "You cannot delete this document");
		}
		// A verified document is evidence in a live application; withdrawing it
		// should be a reviewer's decision, not a click in the applicant's vault.
		if (row.status === "VERIFIED" && row.ownerUserId === user.id && !canReview(staff?.role)) {
			throw new HttpError(
				409,
				"FORBIDDEN",
				"This document has been verified. Ask your consultant to replace it.",
			);
		}

		// Storage first: a deleted row with a surviving object is an orphan nobody
		// will ever find, whereas a failed delete leaves the row to try again.
		try {
			await (await getDocumentStorage()).remove(row.storageKey);
		} catch (err) {
			if (!(err instanceof StorageNotConfiguredError)) throw err;
		}

		await db.delete(applicantDocuments).where(eq(applicantDocuments.id, row.id));
		return c.json({ deleted: true });
	},
);

export { documentsRouter };
