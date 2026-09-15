import { OpenAPIHono, createRoute } from "@hono/zod-openapi";




import {







	canSeeAllCases,








	getApplicant,







	listApplicants,


	patchApplicant,




	serializeApplicant,









} from "../services/cases.js";




































import {

	applicantListSchema,
	applicantSchema,



	CASE_ERROR_CODES,

















	patchApplicantSchema,


























} from "century-nit-shared";














import { HttpError, validationHook } from "../middleware/error.js";
import { actorFrom } from "./caseShared.js";
import { z } from "zod";
import {
	delegateJourneyCoordinator,
	releaseJourneyCoordinator,
} from "../services/consultations.js";


import {
	requireAuth,
	requireMfa,
	requireModule,

	type AuthVariables,

} from "../middleware/auth.js";




/**
 * Notification `type` values addressed only to staff (managers, coordinators,
 * consultants, officers). They never belong in the client portal, so the
 * `/me/notifications` read excludes them — a staff member who also has a client
 * profile (dual-role account) must not see "New lead received", "consultation
 * assigned", etc. on the user end.
 *
 * `chat.message` is staff-to-staff chat — the applicant-facing equivalent is
 * `chat.reply`, which is intentionally NOT listed here so applicants still see
 * their own consultant replies.
 */
import { idParams } from "./caseShared.js";

/* ── Applicants ──────────────────────────────────────────────────────────── */

export const applicantsRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

applicantsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Applicants"],
		middleware: [requireAuth, requireMfa, requireModule("applicants")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: applicantListSchema } },
				description: "Applicants visible to this role",
			},
		},
	}),
	async (c) => {
		const rows = await listApplicants(c.get("staff")!);
		const list = await Promise.all(rows.map(serializeApplicant));
		return c.json({ applicants: list, total: list.length });
	},
);

applicantsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}",
		tags: ["Applicants"],
		middleware: [requireAuth, requireMfa, requireModule("applicants")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: applicantSchema } },
				description: "Applicant",
			},
		},
	}),
	async (c) => {
		const row = await getApplicant(c.req.valid("param").id);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "Applicant not found");
		const staff = c.get("staff")!;
		if (!canSeeAllCases(staff) && row.assignedOfficerId !== staff.opsUserId) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to view this applicant");
		}
		return c.json(await serializeApplicant(row));
	},
);

applicantsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}",
		tags: ["Applicants"],
		middleware: [requireAuth, requireMfa, requireModule("applicants")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: patchApplicantSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicantSchema } },
				description: "Updated",
			},
		},
	}),
	async (c) => {
		const updated = await patchApplicant(c.req.valid("param").id, c.req.valid("json"));
		return c.json(await serializeApplicant(updated));
	},
);

/* ── Journey coordination ──────────────────────────────────────────────────
 * The applicant scope: a coordinator who owns this person's whole journey —
 * every case they open inherits it. Release clears the template; in-flight
 * cases keep whoever already holds them.
 */

applicantsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/delegate-coordination",
		tags: ["Applicants"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": {
						schema: z.object({ coordinatorOpsUserId: z.string().uuid() }),
					},
				},
				required: true,
			},
		},
		responses: {
			200: { description: "Journey coordination delegated" },
			403: { description: "Managers only" },
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		if (!staff) throw new HttpError(401, "UNAUTHORIZED", "Not signed in");
		if (!canSeeAllCases(staff)) {
			throw new HttpError(403, "FORBIDDEN", "Only managers delegate journey coordination");
		}
		await delegateJourneyCoordinator({
			applicantId: c.req.valid("param").id,
			coordinatorOpsUserId: c.req.valid("json").coordinatorOpsUserId,
			actor: actorFrom(staff),
		});
		return c.json({ ok: true });
	},
);

applicantsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/release-coordination",
		tags: ["Applicants"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: { params: idParams },
		responses: {
			200: { description: "Journey coordination released" },
			403: { description: "Managers only" },
			409: { description: "No journey coordinator set" },
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		if (!staff) throw new HttpError(401, "UNAUTHORIZED", "Not signed in");
		if (!canSeeAllCases(staff)) {
			throw new HttpError(403, "FORBIDDEN", "Only managers release journey coordination");
		}
		await releaseJourneyCoordinator({
			applicantId: c.req.valid("param").id,
			actor: actorFrom(staff),
		});
		return c.json({ ok: true });
	},
);
