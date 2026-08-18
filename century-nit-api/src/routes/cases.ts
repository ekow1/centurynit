import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	acceptApplication,
	addCaseComment,
	applicantUserIdOfApplication,
	applicantUserIdOfConsultation,
	assignApplication,
	assignConsultation,
	cancelConsultation,
	canSeeAllCases,
	canSeeApplication,
	canSeeConsultation,
	completeConsultationAssessment,
	confirmConsultationSlot,
	delegateCoordinator,
	getApplicant,
	getApplicantByUserId,
	getApplication,
	getConsultation,
	getConsultationActivity,
	getCoordinatorWorkload,
	latestApplicationForApplicant,
	latestConsultationForApplicant,
	listApplicants,
	listApplications,
	listConsultations,
	patchApplicant,
	reassignCoordinator,
	respondToOutcome,
	requestCaseDocuments,
	serializeApplicant,
	serializeApplication,
	serializeConsultation,
	setApplicationPackage,
	setApplicationPaymentPlan,
	setApplicationStage,
	setApplicationTravelClearance,
	setApplicationVisaStage,
	startConsultationAssessment,
	toggleApplicationChecklist,
} from "../services/cases.js";
import {
	getInvoice,
	listInvoicesForClient,
	paymentWithReferenceExists,
	recordClientPayment,
	serializeInvoice,
} from "../services/invoice.js";
import {
	createPaystackCheckout,
	verifyPaystackTransaction,
} from "../services/paystack.js";
import { listSchoolsForApplicant } from "../services/schools.js";
import {
	addCommentSchema,
	applicantListSchema,
	applicantSchema,
	applicationListSchema,
	applicationSchema,
	assignCaseSchema,
	CASE_ERROR_CODES,
	cancelConsultationSchema,
	choosePackageSchema,
	choosePaymentPlanSchema,
	completeAssessmentSchema,
	consultationListSchema,
	consultationSchema,
	delegateConsultationSchema,
	invoiceSchema,
	myApplicationSchema,
	paystackCheckoutSchema,
	paystackVerifyResponseSchema,
	paystackVerifySchema,
	patchApplicantSchema,
	reassignCoordinatorSchema,
	recordPaymentSchema,
	requestDocumentsSchema,
	setStageSchema,
	setTravelClearanceSchema,
	setVisaStageSchema,
	toggleChecklistSchema,
	updateMyProfileSchema,
} from "century-nit-shared";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireMfa,
	requireModule,
	type AuthVariables,
	type StaffContext,
} from "../middleware/auth.js";
import { env } from "../env.js";

const idParams = z.object({ id: z.string().uuid() });

function actorFrom(staff: StaffContext) {
	return { opsUserId: staff.opsUserId, name: staff.name, email: staff.email };
}

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
		const list = await Promise.all(rows.map(serializeConsultation));
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

/* ── Applications ────────────────────────────────────────────────────────── */

export const applicationsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

applicationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: applicationListSchema } },
				description: "Applications visible to this role",
			},
		},
	}),
	async (c) => {
		const rows = await listApplications(c.get("staff")!);
		const list = await Promise.all(rows.map(serializeApplication));
		return c.json({ applications: list, total: list.length });
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Application",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const row = await getApplication(id);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		const ownerUserId = await applicantUserIdOfApplication(id);
		if (!canSeeApplication({ ...row, applicantUserId: ownerUserId }, c.get("user").id, c.get("staff"))) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to view this application");
		}
		return c.json(await serializeApplication(row));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/assign",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: assignCaseSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Assigned",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		if (!canSeeAllCases(staff)) {
			throw new HttpError(403, "FORBIDDEN", "Only managers or coordinators can assign applications");
		}
		const updated = await assignApplication({
			id: c.req.valid("param").id,
			employeeId: c.req.valid("json").employeeId,
			actor: actorFrom(staff),
		});
		return c.json(await serializeApplication(updated));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/accept",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Accepted",
			},
		},
	}),
	async (c) => {
		const updated = await acceptApplication(c.req.valid("param").id, actorFrom(c.get("staff")!));
		return c.json(await serializeApplication(updated));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/stage",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: setStageSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Stage updated",
			},
		},
	}),
	async (c) => {
		const updated = await setApplicationStage(
			c.req.valid("param").id,
			c.req.valid("json").stage,
			actorFrom(c.get("staff")!),
		);
		return c.json(await serializeApplication(updated));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/checklist",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: toggleChecklistSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Checklist updated",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const updated = await toggleApplicationChecklist(c.req.valid("param").id, body.itemId, body.checked);
		return c.json(await serializeApplication(updated));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/visa-stage",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: setVisaStageSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Visa stage updated",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const updated = await setApplicationVisaStage(
			c.req.valid("param").id,
			body.stage,
			body.note,
			actorFrom(c.get("staff")!),
		);
		return c.json(await serializeApplication(updated));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/travel-clearance",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: setTravelClearanceSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Travel clearance updated",
			},
		},
	}),
	async (c) => {
		const updated = await setApplicationTravelClearance(
			c.req.valid("param").id,
			c.req.valid("json").cleared,
			actorFrom(c.get("staff")!),
		);
		return c.json(await serializeApplication(updated));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/comments",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: addCommentSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Comment added",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		if (!(await getApplication(id))) {
			throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		}
		await addCaseComment({
			targetType: "application",
			targetId: id,
			data: c.req.valid("json"),
			actor: actorFrom(c.get("staff")!),
		});
		return c.json(await serializeApplication((await getApplication(id))!));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/request-documents",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: requestDocumentsSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Documents requested",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await requestCaseDocuments({
			targetType: "application",
			targetId: id,
			documents: c.req.valid("json").documents,
			actor: actorFrom(c.get("staff")!),
		});
		return c.json(await serializeApplication((await getApplication(id))!));
	},
);

/* ── Applicants ──────────────────────────────────────────────────────────── */

export const applicantsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

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
		if (!canSeeAllCases(staff)) {
			throw new HttpError(403, "FORBIDDEN", "Only managers and owners may view workload");
		}
		return c.json(await getCoordinatorWorkload());
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

/* ── /me ─────────────────────────────────────────────────────────────────── */

export const meRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

meRouter.openapi(
	createRoute({
		method: "get",
		path: "/application",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: myApplicationSchema } },
				description: "The signed-in applicant's case",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			return c.json({ applicant: null, consultation: null, application: null });
		}
		const [consultation, application] = await Promise.all([
			latestConsultationForApplicant(applicant.id),
			latestApplicationForApplicant(applicant.id),
		]);
		return c.json({
			applicant: await serializeApplicant(applicant),
			consultation: consultation ? await serializeConsultation(consultation) : null,
			application: application ? await serializeApplication(application) : null,
		});
	},
);

/**
 * Applicant self-service: update their own profile.
 *
 * Resolves the applicant from the session, so no id is sent and a caller
 * cannot edit somebody else's row. `branch` is deliberately not accepted
 * here — that's an ops placement decision, not the applicant's to make.
 */
meRouter.openapi(
	createRoute({
		method: "patch",
		path: "/application",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: updateMyProfileSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicantSchema } },
				description: "The updated applicant",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "No applicant on file");
		}
		const body = c.req.valid("json");
		const updated = await patchApplicant(applicant.id, body);
		return c.json(await serializeApplicant(updated));
	},
);

/**
 * Applicant self-service: choose the school application package.
 *
 * Sets `fundingTrack` and `degreeLevel` on the applicant's latest application.
 * Requires an application to exist (i.e. the consultation assessment has been
 * completed and produced an eligible outcome); refuses with 409 otherwise.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/package",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: choosePackageSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "The updated application",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "No applicant on file");
		}
		const application = await latestApplicationForApplicant(applicant.id);
		if (!application) {
			throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "No application on file");
		}
		const body = c.req.valid("json");
		const updated = await setApplicationPackage({
			id: application.id,
			fundingTrack: body.fundingTrack,
			degreeLevel: body.degreeLevel,
		});
		return c.json(await serializeApplication(updated));
	},
);

/**
 * Applicant self-service: choose the post-admission payment plan.
 *
 * Sets `paymentPlanId` on the applicant's latest application. Requires an
 * application to exist.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/payment-plan",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: choosePaymentPlanSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "The updated application",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "No applicant on file");
		}
		const application = await latestApplicationForApplicant(applicant.id);
		if (!application) {
			throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "No application on file");
		}
		const body = c.req.valid("json");
		const updated = await setApplicationPaymentPlan({
			id: application.id,
			paymentPlanId: body.paymentPlanId,
		});
		return c.json(await serializeApplication(updated));
	},
);

/**
 * Applicant self-service: record a payment directly against one of their own
 * invoices (the "server-side record" path).
 *
 * Uses `recordClientPayment`, which resolves the invoice, verifies it belongs
 * to the session user, and reuses the same locked transaction, audit event and
 * balance checks as staff-recorded payments. The actor is the session user —
 * never taken from the body.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/invoices/{id}/payments",
		tags: ["Invoices"],
		middleware: [requireAuth] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: recordPaymentSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: invoiceSchema } },
				description: "The updated invoice",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await recordClientPayment({
			invoiceId: id,
			userId: user.id,
			userName: user.name ?? "Applicant",
			userEmail: user.email,
			amountCents: body.amountCents,
			method: body.method,
			gateway: body.gateway,
			reference: body.reference,
		});
		return c.json(await serializeInvoice(updated));
	},
);

/**
 * Applicant self-service: open a Paystack hosted checkout for the outstanding
 * balance of one of their own invoices.
 *
 * The amount is the server-computed balance — the client never picks a price.
 * Without a configured secret key this refuses with PAYMENT_GATEWAY_UNCONFIGURED
 * so the portal can fall back to the direct record path.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/invoices/{id}/paystack/checkout",
		tags: ["Invoices"],
		middleware: [requireAuth] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: paystackCheckoutSchema } },
				description: "Paystack checkout to redirect the browser to",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const row = await getInvoice(id);
		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.clientUserId !== user.id) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to pay this invoice");
		}
		if (row.status === "proforma") {
			throw new HttpError(
				409,
				"INVOICE_PROFORMA",
				"Cannot pay a proforma invoice before it is reviewed and issued by staff",
			);
		}
		const serialized = await serializeInvoice(row);

		if (serialized.balanceCents <= 0) {
			throw new HttpError(409, "INVOICE_PAID", "This invoice is already fully paid");
		}
		const origin = c.req.header("origin") || env.FRONTEND_URL;
		const checkout = await createPaystackCheckout({
			email: user.email,
			amountCents: serialized.balanceCents,
			invoiceId: row.id,
			// Paystack appends `reference` + `trxref` to this URL on return; the
			// portal's /portal/pay route reads them and calls the verify endpoint.
			callbackUrl: `${origin}/portal/pay?invoice=${row.id}&paystack=1`,
		});
		return c.json(checkout);
	},
);

/**
 * Applicant self-service: verify a Paystack transaction after the customer
 * returns from the hosted checkout, recording the payment on success.
 *
 * Idempotent — re-verifying the same reference does not double-record.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/invoices/{id}/paystack/verify",
		tags: ["Invoices"],
		middleware: [requireAuth] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: paystackVerifySchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: paystackVerifyResponseSchema } },
				description: "The verified transaction and updated invoice",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const row = await getInvoice(id);
		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.clientUserId !== user.id) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to pay this invoice");
		}
		const txn = await verifyPaystackTransaction(body.reference);
		if (txn.invoiceId && txn.invoiceId !== row.id) {
			throw new HttpError(
				409,
				"PAYMENT_REFERENCE_MISMATCH",
				"This payment does not belong to that invoice",
			);
		}
		const before = await serializeInvoice(row);
		if (txn.status === "success" && before.balanceCents > 0) {
			const alreadyRecorded = await paymentWithReferenceExists(row.id, body.reference);
			if (!alreadyRecorded) {
				await recordClientPayment({
					invoiceId: row.id,
					userId: user.id,
					userName: row.applicantName,
					userEmail: user.email,
					amountCents: txn.amountCents > 0 ? txn.amountCents : before.balanceCents,
					method: "card",
					gateway: "paystack",
					reference: body.reference,
				});
			}
		}
		const invoice = await serializeInvoice(row);
		return c.json({ invoice });
	},
);

/* ── Journey stage ─────────────────────────────────────────────────────── */

const journeySchema = z.object({
	currentStage: z.string(),
	chapterUnlocks: z.object({
		journey: z.boolean(),
		consultation: z.boolean(),
		package: z.boolean(),
		application: z.boolean(),
		tracking: z.boolean(),
		visa: z.boolean(),
		pre_departure: z.boolean(),
		complete: z.boolean(),
	}),
	label: z.string(),
	nextUnlock: z.string().nullable(),
});

meRouter.openapi(
	createRoute({
		method: "get",
		path: "/journey",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: journeySchema } },
				description: "Current journey stage and chapter unlocks",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const applicant = await getApplicantByUserId(user.id);

		if (!applicant) {
			return c.json({
				currentStage: "consultation",
				chapterUnlocks: {
					journey: true,
					consultation: true,
					package: false,
					application: false,
					tracking: false,
					visa: false,
					pre_departure: false,
					complete: false,
				},
				label: "Stage I · Consultation first",
				nextUnlock: null,
			});
		}

		const [consultation, application, schoolTracks, invoices] =
			await Promise.all([
				latestConsultationForApplicant(applicant.id),
				latestApplicationForApplicant(applicant.id),
				listSchoolsForApplicant(applicant.id),
				listInvoicesForClient(user.id),
			]);

		// ── Derive booleans ────────────────────────────────────────────────
		const hasConsultation = Boolean(consultation);
		const isEligible =
			consultation?.assessmentResult?.outcome === "Eligible" ||
			consultation?.assessmentResult?.outcome === "Conditionally Eligible";

		const hasPackage = Boolean(application?.fundingTrack);
		const hasSelection = schoolTracks.schools.some(
			(s) => s.status !== "Draft",
		);
		const isAppInvoicePaid = invoices.some(
			(i) => i.type === "application" && i.status === "paid",
		);
		const hasAdmitted = schoolTracks.schools.some(
			(s) =>
				s.status === "Unconditional Offer" ||
				s.status === "Offer Accepted",
		);
		const isVisaInvoicePaid = Boolean(application?.visaInvoicePaid);
		const isVisaDone = application?.visaStage === "complete";
		const isPreDepartureDone =
			(application?.checklist?.length ?? 0) > 0 &&
			application?.checklist?.every((item) => item.checked);
		const isCompleted = application?.travelClearance === "cleared";

		// ── Determine stage ────────────────────────────────────────────────
		type Stage =
			| "consultation"
			| "eligibility"
			| "school_package"
			| "school_select"
			| "application_invoice"
			| "school_tracking"
			| "visa_invoice"
			| "visa"
			| "pre_departure"
			| "completed";

		let currentStage: Stage = "consultation";

		if (isCompleted || (isVisaDone && isPreDepartureDone)) {
			currentStage = "completed";
		} else if (hasAdmitted && isVisaDone) {
			currentStage = "pre_departure";
		} else if (hasAdmitted && isVisaInvoicePaid) {
			currentStage = "visa";
		} else if (hasAdmitted && !isVisaInvoicePaid) {
			currentStage = "visa_invoice";
		} else if (isAppInvoicePaid && hasSelection) {
			currentStage = "school_tracking";
		} else if (hasSelection && !isAppInvoicePaid) {
			currentStage = "application_invoice";
		} else if (hasPackage) {
			currentStage = "school_select";
		} else if (isEligible && !hasPackage) {
			currentStage = "school_package";
		} else if (hasConsultation) {
			currentStage = "eligibility";
		}

		// ── Labels ─────────────────────────────────────────────────────────
		const stageLabel: Record<Stage, string> = {
			consultation: "Stage I \u00b7 Consultation first",
			eligibility: "Awaiting eligibility",
			school_package: "Choose school application package",
			school_select: "Select schools & programmes",
			application_invoice: "Pay application invoice",
			school_tracking: "Application process / tracking",
			visa_invoice: "Pay visa invoice",
			visa: "Visa tracking in progress",
			pre_departure: "Travel & pre-departure",
			completed: "Application complete",
		};

		const stageOrder: Stage[] = [
			"consultation",
			"eligibility",
			"school_package",
			"school_select",
			"application_invoice",
			"school_tracking",
			"visa_invoice",
			"visa",
			"pre_departure",
			"completed",
		];

		const idx = stageOrder.indexOf(currentStage);
		const nextUnlock =
			idx >= 0 && idx < stageOrder.length - 1
				? stageLabel[stageOrder[idx + 1]]
				: null;

		// ── Chapter unlocks ────────────────────────────────────────────────
		const chapterUnlocks = {
			journey: true,
			consultation: true,
			package: isEligible,
			application: isEligible && hasPackage,
			tracking: isAppInvoicePaid && hasSelection,
			visa: hasAdmitted,
			pre_departure: hasAdmitted && isVisaInvoicePaid && isVisaDone,
			complete: Boolean(isPreDepartureDone),
		};

		return c.json({
			currentStage,
			chapterUnlocks,
			label: stageLabel[currentStage],
			nextUnlock,
		});
	},
);

/**
 * Applicant self-service: respond to a completed consultation outcome.
 *
 * Two actions:
 * - `accept`: applicant proceeds to package selection (adds an audit comment).
 * - `request_info`: applicant needs more information before deciding (notifies the assigned consultant).
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/consultation/respond",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							action: z.enum(["accept", "request_info"]),
							note: z.string().optional(),
						}),
					},
				},
				required: true,
			},
		},
		responses: {
			200: {
				description: "Response recorded",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "No applicant on file");
		const consultation = await latestConsultationForApplicant(applicant.id);
		if (!consultation) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "No consultation on file");
		await respondToOutcome({
			consultationId: consultation.id,
			userId: user.id,
			action: body.action,
			note: body.note,
		});
		return c.json({ ok: true });
	},
);


