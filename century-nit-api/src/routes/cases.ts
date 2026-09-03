import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { and, desc, eq, inArray, not } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
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
	getStaffWorkload,
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
	getOrCreateApplicantConversation,
	getApplicantMessages,
	sendApplicantMessage,
} from "../services/chat.js";
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
	JOURNEY_STAGES,
	JOURNEY_STAGE_TO_PORTAL,
	PORTAL_STAGE_LABELS,
	PORTAL_STAGE_ORDER,
	type JourneyStage,
	invoiceListSchema,
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
	portalStateSchema,
	updatePortalStateSchema,
	notificationSchema,
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

/**
 * Notification `type` values addressed only to staff (managers, coordinators,
 * consultants, officers). They never belong in the client portal, so the
 * `/me/notifications` read excludes them — a staff member who also has a client
 * profile (dual-role account) must not see "New lead received", "consultation
 * assigned", etc. on the user end.
 *
 * `chat.message` is staff-to-staff chat — the applicant-facing equivalent is
 * `chat.reply`, which is intentionally NOT listed here so applicants still see
 * their own consultant replies. `ticket.assigned` is also staff-only.
 */
const STAFF_ONLY_NOTIFICATION_TYPES = [
	"lead.new",
	"booking.new",
	"booking.assigned",
	"consultation.assigned",
	"document.uploaded",
	"ticket.new",
	"ticket.assigned",
	"chat.message",
] as const;

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

/* ── /me ─────────────────────────────────────────────────────────────────── */

export const meRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const identitySchema = z.object({
	isStaff: z.boolean(),
	isApplicant: z.boolean(),
	isBanned: z.boolean(),
});

meRouter.openapi(
	createRoute({
		method: "get",
		path: "/identity",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: identitySchema } },
				description: "Identity flags for the signed-in user",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff");
		const applicant = await getApplicantByUserId(user.id);
		return c.json({
			isStaff: Boolean(staff),
			isApplicant: Boolean(applicant),
			isBanned: false,
		});
	},
);

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
 * Applicant self-service: list their own invoices.
 *
 * Unlike /api/v1/invoices this is not gated by staff module permissions, because
 * the portal (not operations staff) uses it to show the user their invoices.
 */
meRouter.openapi(
	createRoute({
		method: "get",
		path: "/invoices",
		tags: ["Applicants"],
		middleware: [requireAuth, requireMfa] as const,
		responses: {
			200: {
				content: { "application/json": { schema: invoiceListSchema } },
				description: "Signed-in user's invoices",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const rows = await listInvoicesForClient(user.id);
		const list = await Promise.all(rows.map(serializeInvoice));
		return c.json({ invoices: list, total: list.length });
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
		let applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			// Create the applicant record on first profile update — this runs
			// before the first booking/payment, so `branch` is unknown. Use an
			// empty string; `ensureCaseForBooking` sets the real branch later.
			const [created] = await db
				.insert(schema.applicants)
				.values({
					userId: user.id,
					email: user.email,
					name: user.name ?? user.email,
					branch: "",
					profile: {},
				})
				.returning();
			applicant = created;
		}
		const body = c.req.valid("json");
		const updated = await patchApplicant(applicant.id, body);

		// Keep the auth user row in sync when the name changes so the portal
		// sidebar, session probes, and email templates reflect the new name.
		if (body.name !== undefined && body.name.trim() !== applicant.name) {
			await db
				.update(schema.users)
				.set({ name: body.name.trim(), updatedAt: new Date() })
				.where(eq(schema.users.id, user.id));
		}

		return c.json(await serializeApplicant(updated));
	},
);

const packageSelectionResponseSchema = z.object({
	application: applicationSchema,
	proformaInvoice: z.any().nullable().describe("Raised agency proforma split into milestones"),
});

/**
 * Applicant self-service: choose the school application package.
 *
 * Binds packageId, fundingTrack and degreeLevel, voids any previous agency
 * proforma, and raises a new agency proforma pre-split into AGENCY_STAGES.
 * Requires a completed, eligible consultation.
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
				content: { "application/json": { schema: packageSelectionResponseSchema } },
				description: "Package bound and proforma raised",
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
		const { application: updated, proformaInvoice } = await setApplicationPackage({
			id: application.id,
			packageCode: body.packageCode,
			degreeLevel: body.degreeLevel,
		});
		return c.json({
			application: await serializeApplication(updated),
			proformaInvoice,
		});
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

/**
 * Applicant self-service: pay the agency/service fee for their application via
 * Paystack hosted checkout.
 *
 * Resolves the applicant's `agency` invoice automatically — no invoice id is
 * sent. Refuses with 404 if no agency invoice exists, 409 if it is still a
 * proforma (not yet issued by staff), and 409 if it is already paid. Otherwise
 * initializes a Paystack checkout for the outstanding balance and returns the
 * authorization URL to redirect the browser to.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/agency-payment",
		tags: ["Invoices"],
		middleware: [requireAuth] as const,
		request: {},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ authorizationUrl: z.string().url() }),
					},
				},
				description: "Paystack checkout to redirect the browser to",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const invoices = await listInvoicesForClient(user.id);
		const row = invoices.find((i) => i.type === "agency");
		if (!row) {
			throw new HttpError(
				404,
				"INVOICE_NOT_FOUND",
				"No agency invoice found. Please ask your consultant to raise one.",
			);
		}
		if (row.status === "proforma") {
			throw new HttpError(
				409,
				"INVOICE_PROFORMA",
				"Invoice not yet issued. Please ask your consultant to issue it.",
			);
		}
		const serialized = await serializeInvoice(row);
		if (row.status === "paid" || serialized.balanceCents <= 0) {
			throw new HttpError(409, "INVOICE_PAID", "Invoice already paid.");
		}
		const origin = c.req.header("origin") || env.FRONTEND_URL;
		const checkout = await createPaystackCheckout({
			email: user.email,
			amountCents: serialized.balanceCents,
			invoiceId: row.id,
			callbackUrl: `${origin}/portal/pay?invoice=${row.id}&paystack=1`,
		});
		return c.json({ authorizationUrl: checkout.authorizationUrl });
	},
);

const journeySchema = z.object({
	currentStage: z.string(),
	portalStage: z.string(),
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
	stageStatuses: z.record(z.enum(["done", "current", "locked", "skipped"])),
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
				portalStage: "consultation",
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
				stageStatuses: Object.fromEntries(
					PORTAL_STAGE_ORDER.map((sid) => [
						sid,
						sid === "consultation" ? "current" : "locked",
					]),
				),
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
		type PortalStage =
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

		let derivedPortalStage: PortalStage = "consultation";

		if (isCompleted || (isVisaDone && isPreDepartureDone)) {
			derivedPortalStage = "completed";
		} else if (hasAdmitted && isVisaDone) {
			derivedPortalStage = "pre_departure";
		} else if (hasAdmitted && isVisaInvoicePaid) {
			derivedPortalStage = "visa";
		} else if (hasAdmitted && !isVisaInvoicePaid) {
			derivedPortalStage = "visa_invoice";
		} else if (isAppInvoicePaid && hasSelection) {
			derivedPortalStage = "school_tracking";
		} else if (hasSelection && !isAppInvoicePaid) {
			derivedPortalStage = "application_invoice";
		} else if (hasPackage) {
			derivedPortalStage = "school_select";
		} else if (isEligible && !hasPackage) {
			derivedPortalStage = "school_package";
		} else if (hasConsultation) {
			derivedPortalStage = "eligibility";
		}

		// ── Coarse stage from the DB (primary), fall back to derivation ──
		const dbStage = application?.stage;
		const coarseStage: JourneyStage | null =
			dbStage && (JOURNEY_STAGES as string[]).includes(dbStage)
				? (dbStage as JourneyStage)
				: null;

		// ── Portal stage: refine the coarse stage via JOURNEY_STAGE_TO_PORTAL ──
		// with invoice signals. Falls back to the heuristic derivation when no
		// coarse stage is available (e.g. before an application row exists).
		let portalStage: PortalStage = derivedPortalStage;
		if (coarseStage) {
			const base = JOURNEY_STAGE_TO_PORTAL[coarseStage] as PortalStage;
			portalStage = base;
			if (coarseStage === "document_verification") {
				if (hasPackage && !hasSelection) portalStage = "school_select";
				else if (!hasPackage && isEligible) portalStage = "school_package";
				else if (!isEligible && hasConsultation) portalStage = "eligibility";
				else if (!hasConsultation) portalStage = "consultation";
			} else if (coarseStage === "school_submission") {
				if (hasSelection && !isAppInvoicePaid) portalStage = "application_invoice";
				else if (hasSelection && isAppInvoicePaid) portalStage = "school_tracking";
			} else if (coarseStage === "offer_letter_review") {
				portalStage = "school_tracking";
			} else if (coarseStage === "visa_processing" || coarseStage === "payment_execution") {
				if (hasAdmitted && !isVisaInvoicePaid) portalStage = "visa_invoice";
				else if (hasAdmitted && isVisaInvoicePaid) portalStage = "visa";
				else portalStage = "visa";
			} else if (coarseStage === "travel_assistance") {
				if (isCompleted || (isVisaDone && isPreDepartureDone)) portalStage = "completed";
				else portalStage = "pre_departure";
			} else if (coarseStage === "completed") {
				portalStage = "completed";
			}
		}

		const currentStage: string = coarseStage ?? portalStage;

		// ── Labels ─────────────────────────────────────────────────────────
		// Canonical labels/order live in shared (PORTAL_STAGE_LABELS /
		// PORTAL_STAGE_ORDER) — no longer rebuilt inline here.
		const idx = PORTAL_STAGE_ORDER.indexOf(portalStage);
		const nextUnlock =
			idx >= 0 && idx < PORTAL_STAGE_ORDER.length - 1
				? PORTAL_STAGE_LABELS[PORTAL_STAGE_ORDER[idx + 1]]
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

		// ── Per-stage status (done|current|locked|skipped) ────────────────
		// Computed from real signals, not index comparison — a stage advanced
		// past without its signal met shows "skipped", not "done". The portal
		// spine consumes this so "Done" never lies.
		const stageStatuses: Record<string, "done" | "current" | "locked" | "skipped"> = {};
		const currentIdx = PORTAL_STAGE_ORDER.indexOf(portalStage);
		for (const sid of PORTAL_STAGE_ORDER) {
			const si = PORTAL_STAGE_ORDER.indexOf(sid);
			let done = false;
			if (sid === "consultation") done = hasConsultation;
			else if (sid === "eligibility") done = isEligible;
			else if (sid === "school_package") done = hasPackage;
			else if (sid === "school_select") done = hasSelection;
			else if (sid === "application_invoice") done = isAppInvoicePaid;
			else if (sid === "school_tracking") done = hasAdmitted;
			else if (sid === "visa_invoice") done = isVisaInvoicePaid;
			else if (sid === "visa") done = isVisaDone;
			else if (sid === "pre_departure") done = isPreDepartureDone;
			else if (sid === "completed") done = isCompleted;

			if (sid === portalStage) stageStatuses[sid] = "current";
			else if (done) stageStatuses[sid] = "done";
			else if (si < currentIdx) stageStatuses[sid] = "skipped";
			else stageStatuses[sid] = "locked";
		}

		return c.json({
			currentStage,
			portalStage,
			chapterUnlocks,
			stageStatuses,
			label: PORTAL_STAGE_LABELS[portalStage],
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

/* ── /me portal-state ─────────────────────────────────────────────────────── */

meRouter.openapi(
	createRoute({
		method: "get",
		path: "/portal-state",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: portalStateSchema } },
				description: "The portal state",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const applicant = await getApplicantByUserId(user.id);
		if (!applicant) {
			return c.json({});
		}
		return c.json((applicant.portalState as Record<string, unknown>) ?? {});
	},
);

meRouter.openapi(
	createRoute({
		method: "patch",
		path: "/portal-state",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: updatePortalStateSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: portalStateSchema } },
				description: "Updated portal state",
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
		const current = (applicant.portalState as Record<string, unknown>) ?? {};
		const merged = { ...current, ...body };
		await db
			.update(schema.applicants)
			.set({ portalState: merged, updatedAt: new Date() })
			.where(eq(schema.applicants.id, applicant.id));
		return c.json(merged);
	},
);

/* ── /me notifications ────────────────────────────────────────────────────── */

meRouter.openapi(
	createRoute({
		method: "get",
		path: "/notifications",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ notifications: z.array(notificationSchema) }),
					},
				},
				description: "Notifications for the current user",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const rows = await db.query.notifications.findMany({
			// Exclude staff-only notifications so dual-role accounts (a staff
			// member who also has a client profile) do not see "New lead
			// received", "consultation assigned", etc. in the client portal.
			where: and(
				eq(schema.notifications.userId, user.id),
				not(inArray(schema.notifications.type, [...STAFF_ONLY_NOTIFICATION_TYPES])),
			),
			orderBy: [desc(schema.notifications.createdAt)],
			limit: 50,
		});
		return c.json({
			notifications: rows.map((r) => ({
				id: r.id,
				type: r.type,
				title: r.title,
				body: r.body,
				link: r.link,
				read: r.read,
				createdAt: r.createdAt.toISOString(),
			})),
		});
	},
);

meRouter.openapi(
	createRoute({
		method: "patch",
		path: "/notifications/{id}/read",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
				description: "Notification marked as read",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const id = c.req.valid("param").id;
		await db
			.update(schema.notifications)
			.set({ read: true })
			.where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id)));
		return c.json({ ok: true });
	},
);

meRouter.openapi(
	createRoute({
		method: "post",
		path: "/notifications/read-all",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
				description: "All notifications marked as read",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		await db
			.update(schema.notifications)
			.set({ read: true })
			.where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.read, false)));
		return c.json({ ok: true });
	},
);

/* ── /me/conversation — applicant-to-staff chat ──────────────────────────── */

meRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversation",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							id: z.string().uuid(),
							title: z.string(),
							consultantName: z.string().nullable(),
						}),
					},
				},
				description: "The applicant's conversation with their assigned consultant",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const conv = await getOrCreateApplicantConversation(user.id);
		return c.json(conv);
	},
);

meRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversation/messages",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			query: z.object({
				limit: z.number().int().optional(),
				before: z.string().uuid().optional(),
			}),
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							messages: z.array(
								z.object({
									id: z.string().uuid(),
									conversationId: z.string().uuid(),
									senderOpsUserId: z.string().uuid().nullable(),
									senderName: z.string(),
									content: z.string(),
									messageType: z.string(),
									replyToId: z.string().uuid().nullable().optional(),
									createdAt: z.string().datetime(),
								}),
							),
							total: z.number().int(),
							hasMore: z.boolean(),
						}),
					},
				},
				description: "Messages in the applicant's conversation",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const conv = await getOrCreateApplicantConversation(user.id);
		const result = await getApplicantMessages(conv.id, user.id, query);
		return c.json(result);
	},
);

meRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversation/messages",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({ content: z.string().min(1).max(5000) }),
					},
				},
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							id: z.string().uuid(),
							conversationId: z.string().uuid(),
							senderOpsUserId: z.string().uuid().nullable(),
							senderName: z.string(),
							content: z.string(),
							messageType: z.string(),
							replyToId: z.string().uuid().nullable().optional(),
							createdAt: z.string().datetime(),
						}),
					},
				},
				description: "The sent message",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const conv = await getOrCreateApplicantConversation(user.id);
		const msg = await sendApplicantMessage(conv.id, user.id, user.name ?? "Applicant", body.content);
		return c.json(msg);
	},
);


