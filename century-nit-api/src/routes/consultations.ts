import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";



import {

	addCaseComment,

	applicantUserIdOfConsultation,

	assignConsultation,
	cancelConsultation,
	canSeeAllCases,

	canSeeConsultation,
	completeConsultationAssessment,

	confirmConsultationSlot,






	getConsultation,






	listConsultations,




	requestCaseDocuments,

	serializeApplication,
	serializeConsultation,




	startConsultationAssessment,


	delegateCoordinator,
	reassignCoordinator,
	getStaffWorkload,
	getConsultationActivity,
} from "../services/cases.js";




































import {
	addCommentSchema,



	applicationSchema,
	assignCaseSchema,
	CASE_ERROR_CODES,
	cancelConsultationSchema,


	completeAssessmentSchema,
	consultationListSchema,
	consultationSchema,














	requestDocumentsSchema,























	delegateConsultationSchema,
	reassignCoordinatorSchema,
} from "century-nit-shared";














import { HttpError } from "../middleware/error.js";


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
import { idParams, actorFrom } from "./caseShared.js";

/* ── Consultations ───────────────────────────────────────────────────────── */

export const consultationsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

consultationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: consultationListSchema } },
				description: "Consultations visible to this role",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const rows = await listConsultations(staff);
		const list = await Promise.all(rows.map((r) => serializeConsultation(r)));
		return c.json({ consultations: list, total: list.length });
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Consultation",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const row = await getConsultation(id);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
		const ownerUserId = await applicantUserIdOfConsultation(id);
		if (!canSeeConsultation({ ...row, applicantUserId: ownerUserId }, c.get("user").id, c.get("staff"))) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to view this consultation");
		}
		return c.json(await serializeConsultation(row));
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/assign",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: assignCaseSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Assigned",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		if (!canSeeAllCases(staff)) {
			throw new HttpError(403, "FORBIDDEN", "Only managers or coordinators can assign consultations");
		}
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await assignConsultation({
			id,
			employeeId: body.employeeId,
			actor: actorFrom(staff),
		});
		return c.json(await serializeConsultation(updated));
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/confirm-slot",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Slot confirmed",
			},
		},
	}),
	async (c) => {
		const updated = await confirmConsultationSlot(c.req.valid("param").id, actorFrom(c.get("staff")!));
		return c.json(await serializeConsultation(updated));
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/start-assessment",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Assessment started",
			},
		},
	}),
	async (c) => {
		const updated = await startConsultationAssessment(
			c.req.valid("param").id,
			actorFrom(c.get("staff")!),
		);
		return c.json(await serializeConsultation(updated));
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/complete-assessment",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: completeAssessmentSchema } }, required: true },
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							consultation: consultationSchema,
							application: applicationSchema.nullable(),
						}),
					},
				},
				description: "Assessment completed",
			},
		},
	}),
	async (c) => {
		const result = await completeConsultationAssessment({
			id: c.req.valid("param").id,
			result: c.req.valid("json"),
			actor: actorFrom(c.get("staff")!),
		});
		return c.json({
			consultation: await serializeConsultation(result.consultation),
			application: result.application ? await serializeApplication(result.application) : null,
		});
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/comments",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: addCommentSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Comment added",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		if (!(await getConsultation(id))) {
			throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
		}
		await addCaseComment({
			targetType: "consultation",
			targetId: id,
			data: c.req.valid("json"),
			actor: actorFrom(c.get("staff")!),
		});
		return c.json(await serializeConsultation((await getConsultation(id))!));
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/request-documents",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: requestDocumentsSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Documents requested",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await requestCaseDocuments({
			targetType: "consultation",
			targetId: id,
			documents: c.req.valid("json").documents,
			actor: actorFrom(c.get("staff")!),
		});
		return c.json(await serializeConsultation((await getConsultation(id))!));
	},
);

/* ── PATCH /consultations/:id/cancel ─────────────────────────────────────── */

consultationsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/cancel",
		tags: ["Consultations"],
		summary: "Force-cancel a consultation (ops only)",
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: cancelConsultationSchema } },
				description: "Cancellation reason",
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Consultation cancelled",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json") as { reason?: string };
		const staff = c.get("staff");
		const actor = staff
			? { opsUserId: staff.opsUserId, name: staff.name, email: staff.email }
			: { opsUserId: "", name: c.get("user").name ?? c.get("user").email, email: c.get("user").email };
		await cancelConsultation(id, actor, body?.reason);
		return c.json(await serializeConsultation((await getConsultation(id))!));
	},
);

/* ── Coordinator delegation ─────────────────────────────────────────────── */

consultationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/delegate",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: delegateConsultationSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Consultation delegated to coordinator",
			},
			404: { description: "Consultation or coordinator not found" },
			409: { description: "Consultation is closed" },
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		if (!staff) throw new HttpError(401, "UNAUTHORIZED", "Not signed in");
		if (!canSeeAllCases(staff)) {
			throw new HttpError(403, "FORBIDDEN", "Only managers and owners may delegate consultations");
		}
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await delegateCoordinator({
			consultationId: id,
			coordinatorOpsUserId: body.coordinatorOpsUserId,
			note: body.delegationNote,
			actor: actorFrom(staff),
		});
		return c.json(await serializeConsultation(updated));
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "put",
		path: "/{id}/delegate",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: reassignCoordinatorSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: consultationSchema } },
				description: "Coordinator reassigned",
			},
			404: { description: "Consultation or coordinator not found" },
			409: { description: "Consultation is closed" },
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		if (!staff) throw new HttpError(401, "UNAUTHORIZED", "Not signed in");
		if (!canSeeAllCases(staff)) {
			throw new HttpError(403, "FORBIDDEN", "Only managers and owners may reassign coordinators");
		}
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await reassignCoordinator({
			consultationId: id,
			newCoordinatorOpsUserId: body.newCoordinatorOpsUserId,
			reason: body.reason,
			actor: actorFrom(staff),
		});
		return c.json(await serializeConsultation(updated));
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/workload",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							coordinators: z.array(
								z.object({
									opsUserId: z.string().uuid(),
									name: z.string(),
									email: z.string(),
									role: z.string(),
									activeCases: z.number().int(),
									overdueCases: z.number().int(),
									maxCapacity: z.number().int(),
									capacityPercent: z.number(),
								}),
							),
							maxCapacityPerCoordinator: z.number().int(),
						}),
					},
				},
				description: "Workload per coordinator",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		if (!staff) throw new HttpError(401, "UNAUTHORIZED", "Not signed in");
		return c.json(await getStaffWorkload(staff.branch ?? undefined));
	},
);

consultationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}/activity",
		tags: ["Consultations"],
		middleware: [requireAuth, requireMfa, requireModule("consultations")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							activities: z.array(
								z.object({
									id: z.string().uuid(),
									consultationId: z.string().uuid(),
									type: z.string(),
									actorName: z.string().nullable(),
									payload: z.any().nullable(),
									createdAt: z.string().datetime(),
								}),
							),
							total: z.number().int(),
						}),
					},
				},
				description: "Activity timeline for this consultation",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		const user = c.get("user");
		if (!staff && !user) throw new HttpError(401, "UNAUTHORIZED", "Not signed in");
		const { id } = c.req.valid("param");
		const consultation = await getConsultation(id);
		if (!consultation) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
		const activities = await getConsultationActivity(id);
		return c.json({
			activities: activities.map((a) => ({
				...a,
				createdAt: a.createdAt.toISOString(),
			})),
			total: activities.length,
		});
	},
);

