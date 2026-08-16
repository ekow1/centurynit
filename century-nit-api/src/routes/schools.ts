import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	addSchoolApplicationSchema,
	lockSchoolsSchema,
	schoolApplicationListSchema,
	schoolApplicationSchema,
	updateSchoolStatusSchema,
} from "century-nit-shared";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { getApplicantByUserId } from "../services/cases.js";
import {
	addSchoolForApplicant,
	listSchoolsForApplicant,
	lockSchoolsForApplicant,
	removeSchoolForApplicant,
	updateSchoolStatus,
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
