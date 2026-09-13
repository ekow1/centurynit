import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";

import { and, desc, eq, isNull, not } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import {
	acceptApplication,
	addCaseComment,


	assignApplication,


	canSeeAllCases,










	getApplication,






	listApplications,





	requestCaseDocuments,

	serializeApplication,



	setApplicationPackage,
	setApplicationStage,
	setApplicationVisaStage,

	toggleApplicationChecklist,
	updateApplication,
} from "../services/cases.js";










import {
	APPLICATION_FEE_PLACEHOLDER_LABEL,
	createProforma,
	getFeeSchedule,
	getInvoice,
	issueProformaByOps,
	schoolFeeLine,
	serializeInvoice,
	syncApplicationProformaLines,
} from "../services/invoice.js";









import { getApplicationActivity } from "../services/applicationActivity.js";






import {
	addCommentSchema,


	applicationListSchema,
	applicationSchema,
	assignCaseSchema,
	CASE_ERROR_CODES,
	choosePackageSchema,












	invoiceSchema,





	patchApplicationSchema,

	requestDocumentsSchema,
	setStageSchema,
	setVisaStageSchema,
	toggleChecklistSchema,



















	applicationActivityResponseSchema,
} from "century-nit-shared";














import { HttpError } from "../middleware/error.js";

import { documentChecklistForApplication, outstandingDocuments } from "../services/documentChecklist.js";
import {
	requireAuth,
	requireMfa,
	requireModule,

	type AuthVariables,
	requireCapability,
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
import { idParams, assertApplicationAccess, actorFrom } from "./caseShared.js";
import { registerHandoffRoutes } from "./handoffs.js";
import { registerTravelQueueRoute, registerTravelRoutes } from "./travelAssistance.js";

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
		const list = await Promise.all(rows.map((r) => serializeApplication(r)));
		return c.json({ applications: list, total: list.length });
	},
);

// Static paths first: `/{id}` below validates a uuid and would answer
// `/handoffs` and `/travel-assistance` with 400 if it came before them.
registerHandoffRoutes(applicationsRouter);
registerTravelQueueRoute(applicationsRouter);

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
		await assertApplicationAccess(c, id, "view");
		return c.json(await serializeApplication(row));
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}/activity",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: applicationActivityResponseSchema } },
				description: "Activity timeline for this application, newest first",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const row = await getApplication(id);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		await assertApplicationAccess(c, id, "view");
		const events = await getApplicationActivity(id);
		return c.json({ events, total: events.length });
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: patchApplicationSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Application updated",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const row = await getApplication(id);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		await assertApplicationAccess(c, id, "update");
		const updated = await updateApplication(id, c.req.valid("json"), actorFrom(staff));
		return c.json(await serializeApplication(updated));
	},
);

/**
 * Staff-side package selection — the same service the applicant's
 * `/me/application/package` uses, so eligibility, consent, invoice voiding
 * and repricing behave identically. Never set `fundingTrack` by hand: it is
 * one half of this transaction, not a standalone field.
 */
applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/package",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: choosePackageSchema } }, required: true },
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							application: applicationSchema,
							proformaInvoice: invoiceSchema.nullable(),
						}),
					},
				},
				description: "Package bound and proforma raised",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const row = await getApplication(id);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		await assertApplicationAccess(c, id, "update");
		const body = c.req.valid("json");
		const { application: updated, proformaInvoice } = await setApplicationPackage({
			id,
			packageCode: body.packageCode,
			degreeLevel: body.degreeLevel,
			targetSchoolCount: body.targetSchoolCount,
		});
		return c.json({
			application: await serializeApplication(updated),
			proformaInvoice: proformaInvoice ? await serializeInvoice(proformaInvoice) : null,
		});
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

/**
 * The application invoice as a proforma: the existing one, a legacy unlinked
 * one, or a new one built from the selected schools. Raising it is handler
 * work; turning it into a payable invoice is a separate, finance-gated step.
 */
async function ensureApplicationProforma(id: string): Promise<typeof schema.invoices.$inferSelect> {
	// Documents first: they were collected at consultation so applications
	// never wait on paperwork. Nothing is invoiced while any is outstanding.
	const outstanding = outstandingDocuments(await documentChecklistForApplication(id));
	if (outstanding.length > 0) {
		throw new HttpError(
			409,
			"DOCUMENTS_OUTSTANDING",
			`Verify the client's documents before invoicing applications. Outstanding: ${outstanding.join(", ")}.`,
		);
	}
	// Load the application and applicant.
	const [app] = await db
		.select()
		.from(schema.applications)
		.where(eq(schema.applications.id, id))
		.limit(1);
	if (!app) {
		throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	}
	const [applicant] = await db
		.select()
		.from(schema.applicants)
		.where(eq(schema.applicants.id, app.applicantId))
		.limit(1);


	// Find the proforma application invoice for this application.
	let [appInvoice] = await db
		.select()
		.from(schema.invoices)
		.where(
			and(
				eq(schema.invoices.applicationId, id),
				eq(schema.invoices.type, "application"),
			),
		)
		.orderBy(desc(schema.invoices.createdAt))
		.limit(1);

	// Fallback: a legacy invoice raised before invoices carried
	// application_id. Only an *unlinked* one qualifies — an invoice linked
	// to a different application is that application's, not this one's.
	if (!appInvoice && applicant?.userId) {
		[appInvoice] = await db
			.select()
			.from(schema.invoices)
			.where(
				and(
					eq(schema.invoices.clientUserId, applicant.userId),
					eq(schema.invoices.type, "application"),
					isNull(schema.invoices.applicationId),
					not(eq(schema.invoices.status, "void")),
				),
			)
			.orderBy(desc(schema.invoices.createdAt))
			.limit(1);
	}

	// If no proforma exists yet, create one from the selected schools.
	// This lets the handler issue the invoice directly without waiting for
	// the applicant to formally "lock" school selection — breaking the
	// deadlock where the handler can't issue, the applicant can't pay, and
	// school processing is blocked. A baseline application fee line is used
	// when no schools are selected yet, so the handler can always bill the
	// applicant and get processing unblocked.
	if (!appInvoice) {
		const schools = await db
			.select()
			.from(schema.schoolApplications)
			.where(eq(schema.schoolApplications.applicationId, app.id));
		const fees = await getFeeSchedule();
		const schoolLines = schools.map((s) => schoolFeeLine(s, fees.appPerSchoolCents));
		const proforma = await createProforma({
			data: {
				applicantName: applicant?.name ?? "Applicant",
				applicantEmail: applicant?.email ?? undefined,
				clientUserId: applicant?.userId ?? undefined,
				applicationId: app.id,
				type: "application",
				status: "proforma",
				lines: schoolLines.length > 0
					? schoolLines
					: [{ label: APPLICATION_FEE_PLACEHOLDER_LABEL, detail: "Per-institution submission fee", amountCents: fees.appPerSchoolCents }],
				note: schools.length > 0
					? `Application invoice for ${schools.length} university application(s).`
					: "Application fee invoice. Per-school line items will follow as schools are added.",
			},
		});
		appInvoice = proforma;
	} else if (appInvoice.status === "proforma") {
		// Still a draft: its lines follow the school list before it goes out.
		if (await syncApplicationProformaLines(app.id)) {
			appInvoice = (await getInvoice(appInvoice.id)) ?? appInvoice;
		}
	}

	// Backfill applicationId if missing.
	if (!appInvoice.applicationId) {
		await db
			.update(schema.invoices)
			.set({ applicationId: id, updatedAt: new Date() })
			.where(eq(schema.invoices.id, appInvoice.id));
	}
	return appInvoice;
}

/**
 * Handler action: raise the application invoice as a proforma so it can be
 * reviewed and issued. Anyone who can work the application may raise it;
 * issuing — which is what lets the applicant pay — needs the invoices module
 * (below), the same two-step the visa and ticket invoices follow.
 */
applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/raise-application-invoice",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: invoiceSchema } },
				description: "The application invoice (proforma, or already issued)",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id, "raise an invoice for");
		const appInvoice = await ensureApplicationProforma(id);
		return c.json(await serializeInvoice(appInvoice));
	},
);

/**
 * Finance action: issue the application invoice, turning the proforma into a
 * payable invoice. Raises it first if nobody has. The applicant cannot pay
 * until this has happened. Gated on the invoices module, not the applications
 * module — a consultant who can work the case must not be able to bill it.
 */
applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/issue-application-invoice",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("issue_invoices")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: invoiceSchema } },
				description: "The issued application invoice",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id, "issue an invoice for");
		const appInvoice = await ensureApplicationProforma(id);
		const updated = await issueProformaByOps({
			invoiceId: appInvoice.id,
			actorName: staff.name ?? "Handler",
		});
		return c.json(await serializeInvoice(updated));
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
		await assertApplicationAccess(c, c.req.valid("param").id);
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
		await assertApplicationAccess(c, c.req.valid("param").id);
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
		await assertApplicationAccess(c, c.req.valid("param").id);
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
		await assertApplicationAccess(c, c.req.valid("param").id);
		const body = c.req.valid("json");
		const updated = await setApplicationVisaStage(
			c.req.valid("param").id,
			body.stage,
			body.note,
			actorFrom(c.get("staff")!),
			body.outcome,
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
		await assertApplicationAccess(c, c.req.valid("param").id);
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
		await assertApplicationAccess(c, c.req.valid("param").id);
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


registerTravelRoutes(applicationsRouter);
