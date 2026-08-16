import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	acceptApplication,
	addCaseComment,
	applicantUserIdOfApplication,
	applicantUserIdOfConsultation,
	assignApplication,
	assignConsultation,
	canSeeAllCases,
	canSeeApplication,
	canSeeConsultation,
	completeConsultationAssessment,
	confirmConsultationSlot,
	getApplicant,
	getApplicantByUserId,
	getApplication,
	getConsultation,
	latestApplicationForApplicant,
	latestConsultationForApplicant,
	listApplicants,
	listApplications,
	listConsultations,
	patchApplicant,
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
	paymentWithReferenceExists,
	recordClientPayment,
	serializeInvoice,
} from "../services/invoice.js";
import {
	createPaystackCheckout,
	verifyPaystackTransaction,
} from "../services/paystack.js";
import {
	addCommentSchema,
	applicantListSchema,
	applicantSchema,
	applicationListSchema,
	applicationSchema,
	assignCaseSchema,
	CASE_ERROR_CODES,
	choosePackageSchema,
	choosePaymentPlanSchema,
	completeAssessmentSchema,
	consultationListSchema,
	consultationSchema,
	invoiceSchema,
	myApplicationSchema,
	paystackCheckoutSchema,
	paystackVerifyResponseSchema,
	paystackVerifySchema,
	patchApplicantSchema,
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
		const serialized = await serializeInvoice(row);
		if (serialized.balanceCents <= 0) {
			throw new HttpError(409, "INVOICE_PAID", "This invoice is already fully paid");
		}
		const origin = new URL(c.req.url).origin;
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


