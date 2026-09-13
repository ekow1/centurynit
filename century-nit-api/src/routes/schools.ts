import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	assignScholarshipSchema,
	studentScholarshipSchema,
	addSchoolApplicationSchema,
	lockSchoolsSchema,
	opsAddSchoolApplicationSchema,
	schoolApplicationListSchema,
	schoolApplicationSchema,
	schoolFileKindSchema,
	SCHOOL_FILE_LABELS,
	updateSchoolStatusSchema,
	type SchoolFileKind,
} from "century-nit-shared";
import { ALLOWED_DOCUMENT_TYPES } from "century-nit-shared";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { getApplicantByUserId } from "../services/cases.js";
import {
	addSchoolForApplicant,
	listSchoolsForApplicant,
	lockSchoolsForApplicant,
	removeSchoolForApplicant,
	updateSchoolStatus,
	assignScholarshipForApplicant,
	removeScholarshipForApplicant,
	listScholarshipsForApplicant,
	acceptOffer,
	createSchoolFileUpload,
	completeSchoolFileUpload,
	removeSchoolByStaff,
	removeSchoolFile,
	getSchoolFileDownloadUrl,
} from "../services/schools.js";

const idParams = z.object({ id: z.string().uuid() });

export const meSchoolsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();
export const opsSchoolsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── GET /api/v1/me/schools ─────────────────────────────────────────────────── */

meSchoolsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Schools"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: schoolApplicationListSchema } },
				description: "Signed-in applicant's school application tracks",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			return c.json({ schools: [], total: 0 });
		}
		const list = await listSchoolsForApplicant(applicant.id);
		return c.json(list);
	},
);

/* ── POST /api/v1/me/schools ────────────────────────────────────────────────── */

meSchoolsRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["Schools"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: addSchoolApplicationSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: schoolApplicationSchema } },
				description: "School application added",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			throw new HttpError(404, "APPLICANT_NOT_FOUND", "No applicant record found for this user");
		}
		const body = c.req.valid("json");
		const created = await addSchoolForApplicant(applicant.id, body);
		return c.json(created, 201);
	},
);

/* ── DELETE /api/v1/me/schools/:id ─────────────────────────────────────────── */

meSchoolsRouter.openapi(
	createRoute({
		method: "delete",
		path: "/{id}",
		tags: ["Schools"],
		middleware: [requireAuth] as const,
		request: { params: idParams },
		responses: {
			204: { description: "School application removed" },
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const { id } = c.req.valid("param");
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			throw new HttpError(404, "APPLICANT_NOT_FOUND", "No applicant record found for this user");
		}
		await removeSchoolForApplicant(applicant.id, id);
		return c.body(null, 204);
	},
);

/* ── POST /api/v1/me/schools/{id}/accept (Applicant) ────────────────────────── */

meSchoolsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/accept",
		tags: ["Schools"],
		middleware: [requireAuth] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: schoolApplicationSchema } },
				description: "The offer the client is going with",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const { id } = c.req.valid("param");
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			throw new HttpError(404, "APPLICANT_NOT_FOUND", "No applicant record found for this user");
		}
		const updated = await acceptOffer(id, { name: user.name ?? applicant.name ?? "Client", applicantId: applicant.id });
		return c.json(updated);
	},
);

/* ── POST /api/v1/me/schools/lock ───────────────────────────────────────────── */

meSchoolsRouter.openapi(
	createRoute({
		method: "post",
		path: "/lock",
		tags: ["Schools"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: lockSchoolsSchema } },
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: schoolApplicationListSchema } },
				description: "School applications locked and Stage II invoice raised",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			throw new HttpError(404, "APPLICANT_NOT_FOUND", "No applicant record found for this user");
		}
		const result = await lockSchoolsForApplicant(applicant.id, user);
		return c.json(result);
	},
);

/* ── POST /api/v1/schools (Ops) — the consultant adds a school for the client ── */

opsSchoolsRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["Schools"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			body: {
				content: { "application/json": { schema: opsAddSchoolApplicationSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: schoolApplicationSchema } },
				description: "School added to the client's application",
			},
		},
	}),
	async (c) => {
		const { applicantId, ...input } = c.req.valid("json");
		const created = await addSchoolForApplicant(applicantId, input);
		return c.json(created, 201);
	},
);

/* ── DELETE /api/v1/schools/{id} (Ops) — only while still being prepared ───── */

opsSchoolsRouter.openapi(
	createRoute({
		method: "delete",
		path: "/{id}",
		tags: ["Schools"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			204: { description: "School removed" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await removeSchoolByStaff(id);
		return c.body(null, 204);
	},
);

/* ── POST /api/v1/schools/{id}/accept (Ops) — on the client's word ─────────── */

opsSchoolsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/accept",
		tags: ["Schools"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: schoolApplicationSchema } },
				description: "The offer the client is going with",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const updated = await acceptOffer(id, { name: staff.name, opsUserId: staff.opsUserId });
		return c.json(updated);
	},
);

/* ── GET /api/v1/schools/:applicantId (Ops) ───────────────────────────────── */
/* Staff list of an applicant's school application tracks, so the ops console
   can show per-school offer decisions in the workflow board. */

opsSchoolsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{applicantId}",
		tags: ["Schools"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: z.object({ applicantId: z.string().uuid() }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: schoolApplicationListSchema } },
				description: "Applicant's school application tracks",
			},
		},
	}),
	async (c) => {
		const { applicantId } = c.req.valid("param");
		const list = await listSchoolsForApplicant(applicantId);
		return c.json(list);
	},
);

/* ── PATCH /api/v1/schools/:id/status (Ops) ────────────────────────────────── */
opsSchoolsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/status",
		tags: ["Schools"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {

			params: idParams,
			body: {
				content: { "application/json": { schema: updateSchoolStatusSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: schoolApplicationSchema } },
				description: "School application status updated",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await updateSchoolStatus(id, body, staff.name);
		return c.json(updated);
	},
);

/* ── GET /api/v1/schools/:applicantId/scholarships (Ops) ─────────────────── */

opsSchoolsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{applicantId}/scholarships",
		tags: ["Schools"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: z.object({ applicantId: z.string().uuid() }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ scholarships: z.array(studentScholarshipSchema) }) } },
				description: "List scholarships for applicant",
			},
		},
	}),
	async (c) => {
		const { applicantId } = c.req.valid("param");
		const list = await listScholarshipsForApplicant(applicantId);
		return c.json({ scholarships: list });
	},
);

/* ── POST /api/v1/schools/:applicantId/scholarships (Ops) ────────────────── */

opsSchoolsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{applicantId}/scholarships",
		tags: ["Schools"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: z.object({ applicantId: z.string().uuid() }),
			body: {
				content: { "application/json": { schema: assignScholarshipSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: studentScholarshipSchema } },
				description: "Scholarship assigned",
			},
		},
	}),
	async (c) => {
		const { applicantId } = c.req.valid("param");
		const body = c.req.valid("json");
		const created = await assignScholarshipForApplicant(applicantId, body);
		return c.json(created, 201);
	},
);

/* ── DELETE /api/v1/schools/:applicantId/scholarships/:scholarshipId (Ops) ─ */

opsSchoolsRouter.openapi(
	createRoute({
		method: "delete",
		path: "/{applicantId}/scholarships/{scholarshipId}",
		tags: ["Schools"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: z.object({ 
				applicantId: z.string().uuid(),
				scholarshipId: z.string().min(1),
			}),
		},
		responses: {
			204: { description: "Scholarship removed" },
		},
	}),
	async (c) => {
		const { applicantId, scholarshipId } = c.req.valid("param");
		await removeScholarshipForApplicant(applicantId, scholarshipId);
		return c.body(null, 204);
	},
);

/* ── Admission letter (offer letter) upload / download ───────────────────── */

const admissionLetterUploadBody = z.object({
	fileName: z.string().min(1).max(255),
	contentType: z.enum(ALLOWED_DOCUMENT_TYPES, {
		errorMap: () => ({ message: "Upload a PDF, image (JPEG, PNG), or Word document (DOC, DOCX)" }),
	}),
});

const admissionLetterCompleteBody = z.object({
	storageKey: z.string().min(1).max(512),
});

const admissionUploadTicketSchema = z.object({
	uploadUrl: z.string().url(),
	storageKey: z.string(),
	headers: z.record(z.string()).optional(),
	expiresAt: z.string().datetime(),
});

const admissionDownloadTicketSchema = z.object({
	url: z.string().url(),
	expiresAt: z.string().datetime(),
});

/* ── Files on a school row — the offer letter and the submission proof ────────
 *
 * The same four staff routes and one applicant download, registered once per
 * kind: `/{id}/admission-letter/…` (the offer letter, path kept for existing
 * clients) and `/{id}/submission-proof/…`.
 */

const SCHOOL_FILE_PATHS: Record<SchoolFileKind, string> = {
	"offer-letter": "admission-letter",
	"submission-proof": "submission-proof",
};

for (const kind of schoolFileKindSchema.options) {
	const seg = SCHOOL_FILE_PATHS[kind];
	const label = SCHOOL_FILE_LABELS[kind].toLowerCase();
	opsSchoolsRouter.openapi(
		createRoute({
			method: "post",
			path: `/{id}/${seg}/upload-url`,
			tags: ["Schools"],
			middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
			request: {
				params: idParams,
				body: {
					content: { "application/json": { schema: admissionLetterUploadBody } },
					required: true,
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: admissionUploadTicketSchema } },
					description: `Signed upload URL for the ${label}`,
				},
			},
		}),
		async (c) => {
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			const ticket = await createSchoolFileUpload(id, kind, body);
			return c.json(ticket, 201);
		},
	);

	opsSchoolsRouter.openapi(
		createRoute({
			method: "post",
			path: `/{id}/${seg}/complete`,
			tags: ["Schools"],
			middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
			request: {
				params: idParams,
				body: {
					content: { "application/json": { schema: admissionLetterCompleteBody } },
					required: true,
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: schoolApplicationSchema } },
					description: `School application with the ${label} attached`,
				},
			},
		}),
		async (c) => {
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			const updated = await completeSchoolFileUpload(id, kind, body.storageKey);
			return c.json(updated);
		},
	);

	opsSchoolsRouter.openapi(
		createRoute({
			method: "delete",
			path: `/{id}/${seg}`,
			tags: ["Schools"],
			middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
			request: { params: idParams },
			responses: {
				200: {
					content: { "application/json": { schema: schoolApplicationSchema } },
					description: `${SCHOOL_FILE_LABELS[kind]} removed`,
				},
			},
		}),
		async (c) => {
			const { id } = c.req.valid("param");
			const updated = await removeSchoolFile(id, kind);
			return c.json(updated);
		},
	);

	opsSchoolsRouter.openapi(
		createRoute({
			method: "get",
			path: `/{id}/${seg}/download`,
			tags: ["Schools"],
			middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
			request: {
				params: idParams,
				query: z.object({ inline: z.string().optional() }),
			},
			responses: {
				200: {
					content: { "application/json": { schema: admissionDownloadTicketSchema } },
					description: `Signed download URL for the ${label}`,
				},
			},
		}),
		async (c) => {
			const { id } = c.req.valid("param");
			const ticket = await getSchoolFileDownloadUrl(id, kind);
			return c.json(ticket);
		},
	);

	meSchoolsRouter.openapi(
		createRoute({
			method: "get",
			path: `/{id}/${seg}/download`,
			tags: ["Schools"],
			middleware: [requireAuth] as const,
			request: {
				params: idParams,
				query: z.object({ inline: z.string().optional() }),
			},
			responses: {
				200: {
					content: { "application/json": { schema: admissionDownloadTicketSchema } },
					description: `Signed download URL for the ${label}`,
				},
			},
		}),
		async (c) => {
			const user = c.get("user")!;
			const { id } = c.req.valid("param");
			const applicant = await getApplicantByUserId(user.id);
			if (!applicant) {
				throw new HttpError(404, "APPLICANT_NOT_FOUND", "No applicant record found for this user");
			}
			// Verify the school application belongs to this applicant before handing
			// out a signed URL — the storage key alone is not authorisation.
			const list = await listSchoolsForApplicant(applicant.id);
			if (!list.schools.some((s) => s.id === id)) {
				throw new HttpError(403, "FORBIDDEN", "That school application is not yours");
			}
			const ticket = await getSchoolFileDownloadUrl(id, kind);
			return c.json(ticket);
		},
	);
}
