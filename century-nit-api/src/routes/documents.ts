import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
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
import { documentCategory } from "century-nit-core";
import { db } from "../db/index.js";
import {
	applicantDocuments,
	applicants,
	applications,
	bookings,
	consultations,
	opsUsers,
	users,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireMfa,
	requireModule,
	type AuthVariables,
	type StaffContext,
} from "../middleware/auth.js";
import { getDocumentStorage, StorageNotConfiguredError } from "../services/storage/index.js";
import { documentReviewedForClient } from "../services/notifications.js";
import {
	notify,
	notifyMany,
	getManagerAndCoordinatorUserIds,
	getStaffUserId,
} from "../services/notify.js";
import { env } from "../env.js";
import { checkAndAdvanceDocumentStage } from "../services/cases.js";

/**
 * Applicant documents.
 *
 * Files go straight to storage over a signed URL; only metadata passes through
 * here. The server still decides everything that matters — who may upload, whose
 * document this is, and who may read it — before issuing any URL.
 */

const documentsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/** How long rejected/superseded documents are retained before hard deletion. */
const REJECTED_DOC_TTL_MS = env.REJECTED_DOCUMENT_TTL_DAYS * 24 * 60 * 60 * 1000;

type DocumentRow = typeof applicantDocuments.$inferSelect;

/** Extra staff-only fields for the ops Document Vault folder view. */
type StaffEnrichment = {
	ownerEmail?: string;
	ownerName?: string;
	caseReference?: string;
	branch?: string;
	assignedStaffName?: string;
};

function toResponse(row: DocumentRow, enrichment?: StaffEnrichment) {
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
		...(enrichment ? { ownerUserId: row.ownerUserId } : {}),
		...(enrichment?.ownerEmail ? { ownerEmail: enrichment.ownerEmail } : {}),
		...(enrichment?.ownerName ? { ownerName: enrichment.ownerName } : {}),
		...(enrichment?.caseReference ? { caseReference: enrichment.caseReference } : {}),
		...(enrichment?.branch ? { branch: enrichment.branch } : {}),
		...(enrichment?.assignedStaffName ? { assignedStaffName: enrichment.assignedStaffName } : {}),
		documentCategory: documentCategory(row.documentType),
	};
}

/** Staff who may review documents at all. Matches ROLE_PERMISSIONS.documents. */
function canReview(role: string | undefined): boolean {
	return (
		role === "manager" ||
		role === "coordinator" ||
		role === "consultant" ||
		role === "super_admin" ||
		role === "customer_service"
	);
}

/**
 * Which applicants this caller may reach, beyond themselves.
 *
 * `null` means every applicant: managers, coordinators, customer_service and
 * super admins route work across the whole operation and need the full queue
 * to do it. A consultant gets a list — the applicants actually assigned to them — which is
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

	const { assignedApplicantUserIds } = await import("../services/cases.js");
	const fromCases = await assignedApplicantUserIds(staff.opsUserId);
	return Array.from(new Set([...rows.map((r) => r.ownerUserId), ...fromCases]));
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
 * Server-generated from the owner id, document type, applicant name and a
 * short random suffix.  The applicant's *original* filename is never used as
 * the path — it is attacker-controlled, and a name like
 * `../../other-user/passport.pdf` must not reach another applicant's folder.
 *
 * Structure: `{ownerUserId}/{safeDocType}/{name}-{docLabel}-{suffix}.{ext}`
 *
 * Example:   `usr_abc123/passport/john-smith-passport-a1b2c3d4.pdf`
 */
function buildStorageKey(
	ownerUserId: string,
	documentType: string,
	fileName: string,
	ownerName: string | null,
): string {
	const extension = (fileName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "bin").toLowerCase();
	const safeType = documentType.replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "document";

	// Sanitize the applicant's name for use in the filename.
	const nameSlug = sanitizeSlug(ownerName ?? "applicant");
	const docLabel = sanitizeSlug(documentType) || "document";

	// 8-char random hex suffix prevents collisions on repeated uploads.
	const suffix = randomUUID().replace(/-/g, "").slice(0, 8);

	return `${ownerUserId}/${safeType}/${nameSlug}-${docLabel}-${suffix}.${extension}`;
}

/** Lowercase, keep only [a-z0-9-], collapse hyphens, trim. */
function sanitizeSlug(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 64) || "applicant";
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
		middleware: [requireAuth, requireMfa] as const,
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

		const storageKey = buildStorageKey(user.id, body.documentType, body.fileName, user.name);

		// Replacing a document of the same type: retire every live row first, or
		// the partial unique index (`status <> 'REJECTED'`) rejects the new one.
		// The old object is removed only after the replacement is confirmed, in
		// /complete. PENDING_UPLOAD, UPLOADED and VERIFIED all occupy that index.
		await db
			.update(applicantDocuments)
			.set({
				status: "REJECTED",
				reviewNote: "Replaced by a newer upload",
				expiresAt: new Date(Date.now() + REJECTED_DOC_TTL_MS),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(applicantDocuments.ownerUserId, user.id),
					eq(applicantDocuments.documentType, body.documentType),
					ne(applicantDocuments.status, "REJECTED"),
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
		middleware: [requireAuth, requireMfa] as const,
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

		// In-app: let the assigned consultant know a document was uploaded, or
		// fall back to managers/coordinators when nobody is assigned yet.
		(async () => {
			try {
				const [applicant] = await db
					.select({ name: applicants.name, assignedOfficerId: applicants.assignedOfficerId })
					.from(applicants)
					.where(eq(applicants.userId, user.id))
					.limit(1);

				const applicantName = applicant?.name ?? "An applicant";
				const body = `${applicantName} uploaded ${updated.documentType}`;

				const officerId = applicant?.assignedOfficerId ?? null;
				if (officerId) {
					const userId = await getStaffUserId(officerId);
					if (userId) {
						await notify({
							recipientUserId: userId,
							type: "document.uploaded",
							title: "New document uploaded",
							body,
							link: "/documents",
						});
						return;
					}
				}

				// No consultant linked (or not yet an auth user) — surface to the
				// triage queue so somebody picks it up.
				const managers = await getManagerAndCoordinatorUserIds();
				await notifyMany(
					managers.map((m) => ({
						recipientUserId: m.userId,
						type: "document.uploaded",
						title: "New document uploaded",
						body,
						link: "/documents",
					})),
				);
			} catch {
				// Notification failure must not block the upload completion.
			}
		})().catch(() => {});

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
		middleware: [requireAuth, requireMfa] as const,
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

		const isStaff = canReview(staff?.role);

		if (!isStaff) {
			// Applicants get the lean query — no joins needed.
			const rows = await db
				.select({ doc: applicantDocuments })
				.from(applicantDocuments)
				.where(
					and(
						ownerScope,
						ne(applicantDocuments.status, "PENDING_UPLOAD"),
					),
				)
				.orderBy(desc(applicantDocuments.createdAt));

			return c.json({ documents: rows.map((r) => toResponse(r.doc)) });
		}

		/*
		 * Staff listing — enriched for the ops Document Vault folder view.
		 *
		 * Joins applicants for the owner's name and branch; uses sub-queries
		 * for the latest application (APP-xxxx) or consultation (CNS-xxxx)
		 * reference. Documents from users who have no applicant profile, no
		 * consultation and no application are excluded — they uploaded before
		 * entering the pipeline and should not clutter the review queue.
		 */
		// Aliases for the assigned-officer lookup
		const assignedOfficer = db
			.select({
				applicantId: applicants.id,
				officerName: opsUsers.name,
			})
			.from(applicants)
			.innerJoin(opsUsers, eq(opsUsers.id, applicants.assignedOfficerId))
			.as("assigned_officer");

		const latestApp = db
			.selectDistinctOn([applications.applicantId], {
				applicantId: applications.applicantId,
				appNumber: applications.appNumber,
			})
			.from(applications)
			.orderBy(applications.applicantId, desc(applications.createdAt))
			.as("latest_app");

		const latestConsult = db
			.selectDistinctOn([consultations.applicantId], {
				applicantId: consultations.applicantId,
				reference: consultations.reference,
			})
			.from(consultations)
			.orderBy(consultations.applicantId, desc(consultations.createdAt))
			.as("latest_consult");

		const rows = await db
			.select({
				doc: applicantDocuments,
				ownerEmail: users.email,
				ownerName: applicants.name,
				branch: applicants.branch,
				appNumber: latestApp.appNumber,
				consultRef: latestConsult.reference,
				officerName: assignedOfficer.officerName,
			})
			.from(applicantDocuments)
			.innerJoin(users, eq(users.id, applicantDocuments.ownerUserId))
			.innerJoin(applicants, eq(applicants.userId, users.id))
			.leftJoin(latestApp, eq(latestApp.applicantId, applicants.id))
			.leftJoin(latestConsult, eq(latestConsult.applicantId, applicants.id))
			.leftJoin(assignedOfficer, eq(assignedOfficer.applicantId, applicants.id))
			.where(
				and(
					ownerScope,
					ne(applicantDocuments.status, "PENDING_UPLOAD"),
					// Only surface documents for applicants with at least one case
					or(
						isNotNull(latestApp.appNumber),
						isNotNull(latestConsult.reference),
					),
				),
			)
			.orderBy(desc(applicantDocuments.createdAt));

		return c.json({
			documents: rows.map((r) =>
				toResponse(r.doc, {
					ownerEmail: r.ownerEmail ?? undefined,
					ownerName: r.ownerName ?? undefined,
					caseReference: r.appNumber ?? r.consultRef ?? undefined,
					branch: r.branch ?? undefined,
					assignedStaffName: r.officerName ?? undefined,
				}),
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
		middleware: [requireAuth, requireMfa] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
			query: z.object({ inline: z.string().optional() }),
		},
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
		const inline = c.req.valid("query").inline === "true";

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
			downloadAs: inline ? undefined : row.fileName,
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
		middleware: [requireAuth, requireMfa, requireModule("documents")] as const,
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

		const rejected = body.status === "REJECTED";
		const [updated] = await db
			.update(applicantDocuments)
			.set({
				status: body.status,
				reviewNote: body.note ?? null,
				reviewedBy: staff.opsUserId,
				reviewedAt: new Date(),
				expiresAt: rejected ? new Date(Date.now() + REJECTED_DOC_TTL_MS) : undefined,
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

		// In-app + email: tell the document owner their document was approved or rejected.
		const approved = body.status === "VERIFIED";
		if (approved || rejected) {
			const status = approved ? "approved" : "rejected";
			const [owner] = await db
				.select({ email: users.email, applicantName: applicants.name })
				.from(users)
				.leftJoin(applicants, eq(applicants.userId, users.id))
				.where(eq(users.id, updated.ownerUserId))
				.limit(1);

			const clientName = owner?.applicantName ?? "Applicant";
			const email = owner?.email;

			await notify({
				recipientUserId: updated.ownerUserId,
				type: approved ? "document.approved" : "document.rejected",
				title: approved ? "Your document was approved" : "Your document was rejected",
				body: `Your ${updated.documentType} was ${status}.`,
				link: "/portal/documents",
				email: email
					? documentReviewedForClient({
							clientName,
							clientEmail: email,
							documentType: updated.documentType,
							status,
							reviewNote: body.note ?? null,
							portalUrl: env.FRONTEND_URL,
						})
					: undefined,
			}).catch(() => {});
		}

		// If all requested documents are now verified, auto-advance the case stage.
		if (body.status === "VERIFIED") {
			checkAndAdvanceDocumentStage(updated.ownerUserId).catch(() => {});
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
		middleware: [requireAuth, requireMfa] as const,
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
			if (err instanceof StorageNotConfiguredError) {
				// Storage is not configured — the file cannot be removed.
				// Log so this is visible rather than silently orphaning the object.
				console.warn(`[documents] Storage not configured; cannot remove ${row.storageKey}`);
			} else {
				throw err;
			}
		}

		await db.delete(applicantDocuments).where(eq(applicantDocuments.id, row.id));
		return c.json({ deleted: true });
	},
);

export { documentsRouter };
