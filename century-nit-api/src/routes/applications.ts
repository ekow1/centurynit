import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";

import { and, desc, eq, isNull, not } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import {
	addCaseComment,


	assignApplication,
	referApplicationBranch,










	getApplication,






	listApplications,





	requestCaseDocuments,

	serializeApplication,



	setApplicationPackage,
	setApplicationStage,
	setApplicationVisaStage,
	updateVisaDetails,
	updateDepartureDetails,

	toggleApplicationChecklist,
	updateApplication,
} from "../services/cases.js";










import {
	applicationFeeLinesFor,
	createProforma,
	getInvoice,
	serializeInvoice,
	syncApplicationProformaLines,
} from "../services/invoice.js";
import { markApplicationFeesNotDue } from "../services/cases.js";
import { setPreDepartureTask } from "../services/preDeparture.js";
import { setReleaseOverride } from "../services/release.js";









import { getApplicationActivity } from "../services/applicationActivity.js";
import { decideContinuation } from "../services/continuations.js";






import {
	addCommentSchema,


	applicationListSchema,
	applicationSchema,
	assignCaseSchema,
	caseTeamSchema,
	referCaseSchema,
	releaseSeatSchema,
	stageHandoffSchema,
	CASE_ERROR_CODES,
	choosePackageSchema,












	invoiceSchema,





	patchApplicationSchema,

	requestDocumentsSchema,
	setStageSchema,
	setVisaStageSchema,
	decideContinuationSchema,
	continuationRequestSchema,
	updateVisaDetailsSchema,
	updateDepartureDetailsSchema,
	releaseOverrideSchema,
	setPreDepartureTaskSchema,
	toggleChecklistSchema,



















	applicationActivityResponseSchema,
	ledgerRowSchema,
	postArrivalScheduleChoiceSchema,
} from "century-nit-shared";














import { HttpError, validationHook } from "../middleware/error.js";

import { outstandingForStage, documentChecklistForApplication } from "../services/documentChecklist.js";
import {
	requireAuth,
	requireMfa,
	requireModule,
	requireCapability,

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
import { idParams, assertApplicationAccess, actorFrom } from "./caseShared.js";
import { registerHandoffRoutes } from "./handoffs.js";
import { registerTravelQueueRoute, registerTravelRoutes } from "./travelAssistance.js";

/* ── Applications ────────────────────────────────────────────────────────── */

export const applicationsRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

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
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		const { application: updated, proformaInvoice } = await setApplicationPackage({
			id,
			packageCode: body.packageCode,
			degreeLevel: body.degreeLevel,
			targetSchoolCount: body.targetSchoolCount,
			stages: body.stages,
			// Ops choosing for the client goes on the case with the reason.
			actor: { name: staff.name, opsUserId: staff.opsUserId, reason: body.reason ?? null },
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
		middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("assign_work")] as const,
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
		const body = c.req.valid("json");
		const updated = await assignApplication({
			id: c.req.valid("param").id,
			employeeId: body.employeeId,
			scope: body.scope,
			branch: body.branch,
			reason: body.reason,
			actor: actorFrom(staff),
		});
		return c.json(await serializeApplication(updated));
	},
);

/* ── Staffing context: team sheet, seat release, claim ────────────────────── */

/** Who holds each seat on the case — live seats, open seats, and the history. */
applicationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}/team",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: caseTeamSchema } },
				description: "The case's seats — owner, coordinator, specialists, history",
			},
		},
	}),
	async (c) => {
		const id = c.req.valid("param").id;
		await assertApplicationAccess(c, id);
		const { getCaseTeam } = await import("../services/handoffs.js");
		return c.json(await getCaseTeam(id));
	},
);

/**
 * Return a seat to the staffing queue — `"owner"` for the whole-case handler,
 * or a journey stage for a specialist seat. Ends the assignment and opens a
 * `manual_release` handoff.
 */
applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/seats/{seat}/release",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("assign_work")] as const,
		request: {
			params: z.object({ id: z.string().uuid(), seat: z.string().min(1).max(80) }),
			body: { content: { "application/json": { schema: releaseSeatSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: stageHandoffSchema } },
				description: "Seat released — handoff opened on the current stage",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id, seat } = c.req.valid("param");
		const body = c.req.valid("json");
		const { releaseApplicationSeat } = await import("../services/handoffs.js");
		return c.json(
			await releaseApplicationSeat({
				applicationId: id,
				seat,
				note: body.note,
				actor: actorFrom(staff),
			}),
		);
	},
);

/**
 * Self-serve staffing — the officer claims the case's pending handoff. The
 * service enforces role (`canOwnStage`) and branch; the claim resolves the
 * handoff through the normal path so it stays race-safe.
 */
applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/claim",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: stageHandoffSchema } },
				description: "Handoff claimed — the officer is seated on the stage",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { claimPendingHandoff } = await import("../services/handoffs.js");
		return c.json(
			await claimPendingHandoff({
				applicationId: c.req.valid("param").id,
				actor: actorFrom(staff),
			}),
		);
	},
);

/**
 * Refer a case to another handling branch — the office that owns the file
 * moves, the handler seat opens in the receiving desk's queue. Distinct from
 * assign: no person is picked here.
 */
applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/refer",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("assign_work")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: referCaseSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "Referred to another branch",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		const updated = await referApplicationBranch({
			id: c.req.valid("param").id,
			branch: body.branch,
			note: body.note,
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
async function ensureApplicationProforma(id: string, raisedBy: { opsUserId?: string | null; name: string; email?: string | null }): Promise<typeof schema.invoices.$inferSelect | null> {
	// Documents first: they were collected at consultation so applications
	// never wait on paperwork. Nothing is invoiced while any is outstanding.
	const outstanding = outstandingForStage(await documentChecklistForApplication(id), "admissions");
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
		// Money paid on the client's behalf: each school's own fee from the
		// catalogue, plus the extra-school add-on beyond the package. Nothing
		// due means no invoice — the case records it and submissions can start.
		const lines = await applicationFeeLinesFor(app.id);
		if (lines.length === 0) {
			await markApplicationFeesNotDue(app.id, raisedBy.name);
			return null;
		}
		const schools = new Set(lines.map((l) => l.schoolApplicationId)).size;
		appInvoice = await createProforma({
			data: {
				applicantName: applicant?.name ?? "Applicant",
				applicantEmail: applicant?.email ?? undefined,
				clientUserId: applicant?.userId ?? undefined,
				applicationId: app.id,
				type: "application",
				status: "proforma",
				lines,
				note: `University application fees for ${schools} school(s), paid on your behalf.`,
			},
			raisedBy,
		});
	} else if (appInvoice.status === "proforma") {
		// Still a draft: its lines follow the school list before it goes out.
		if (await syncApplicationProformaLines(app.id)) {
			const fresh = await getInvoice(appInvoice.id);
			if (!fresh || fresh.status === "void") {
				await markApplicationFeesNotDue(app.id, raisedBy.name);
				return null;
			}
			appInvoice = fresh;
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
const raiseLinesSchema = z.object({
	lines: z
		.array(
			z.object({
				label: z.string().min(1).max(200),
				detail: z.string().max(300).optional(),
				amountCents: z.number().int().min(0).max(1_000_000_000),
				schoolApplicationId: z.string().uuid().nullable().optional(),
			}),
		)
		.min(1)
		.max(40),
	note: z.string().max(1000).optional(),
});

/** The lines the sheet starts from — the school list and the catalogue — and what still gates the raise. */
applicationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}/application-invoice-preview",
		tags: ["Applications"],
		middleware: [requireAuth, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							lines: z.array(z.object({ label: z.string(), detail: z.string(), amountCents: z.number().int(), schoolApplicationId: z.string().nullable() })),
							outstandingDocuments: z.array(z.string()),
						}),
					},
				},
				description: "The suggested lines and the documents still outstanding",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id);
		const [lines, checklist] = await Promise.all([applicationFeeLinesFor(id), documentChecklistForApplication(id)]);
		return c.json({ lines: lines.map((l) => ({ ...l, schoolApplicationId: l.schoolApplicationId ?? null })), outstandingDocuments: outstandingForStage(checklist, "admissions") });
	},
);

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/raise-application-invoice",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: raiseLinesSchema } }, required: false },
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ invoice: invoiceSchema.nullable(), nothingDue: z.boolean() }) } },
				description: "The application invoice (draft, or already issued) — or nothing due, in which case submissions can start",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id, "raise an invoice for");
		const body = c.req.valid("json") as z.infer<typeof raiseLinesSchema> | undefined;
		// The officer's lines, when the sheet sent them; the catalogue's otherwise.
		const appInvoice = body?.lines ? await raiseApplicationProformaWithLines(id, body, actorFrom(c.get("staff")!)) : await ensureApplicationProforma(id, actorFrom(c.get("staff")!));
		return c.json({ invoice: appInvoice ? await serializeInvoice(appInvoice) : null, nothingDue: !appInvoice });
	},
);

/** The visa invoice's suggested lines — the destination's tariff. */
applicationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}/visa-invoice-preview",
		tags: ["Applications"],
		middleware: [requireAuth, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ lines: z.array(z.object({ label: z.string(), detail: z.string(), amountCents: z.number().int() })) }) } },
				description: "The tariff's lines for this case's destination",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id);
		const row = await getApplication(id);
		if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
		const { visaCostLinesFor } = await import("../services/cases.js");
		return c.json({ lines: await visaCostLinesFor(row) });
	},
);

/**
 * The visa officer raises the visa invoice — the tariff's lines as the
 * sheet edited them. A proforma; finance approves and issues it. One live
 * visa invoice per case.
 */
applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/raise-visa-invoice",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: raiseLinesSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: invoiceSchema } }, description: "The visa proforma, awaiting approval" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id, "raise an invoice for");
		const body = c.req.valid("json");
		const row = await getApplication(id);
		if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
		const [live] = await db
			.select({ id: schema.invoices.id, invoiceNumber: schema.invoices.invoiceNumber })
			.from(schema.invoices)
			.where(and(eq(schema.invoices.applicationId, id), eq(schema.invoices.type, "visa"), not(eq(schema.invoices.status, "void"))))
			.limit(1);
		if (live) throw new HttpError(409, "VISA_INVOICE_EXISTS", `A visa invoice is already on this case (${live.invoiceNumber}).`);
		const [applicant] = await db.select().from(schema.applicants).where(eq(schema.applicants.id, row.applicantId)).limit(1);
		const created = await createProforma({
			data: {
				applicantName: applicant?.name ?? "Applicant",
				applicantEmail: applicant?.email ?? undefined,
				clientUserId: applicant?.userId ?? undefined,
				applicationId: id,
				type: "visa",
				status: "proforma",
				lines: body.lines.filter((l) => l.amountCents > 0 || l.label.trim()).map((l) => ({ label: l.label.trim(), detail: l.detail?.trim() || undefined, amountCents: l.amountCents })),
				note: body.note?.trim() || "Visa costs paid on your behalf, at cost.",
			},
			raisedBy: actorFrom(c.get("staff")!),
		});
		return c.json(await serializeInvoice(created));
	},
);

/**
 * The handler's lines for the application invoice — the sheet's, not the
 * catalogue's. The documents gate still stands; one live invoice per case.
 */
async function raiseApplicationProformaWithLines(
	id: string,
	body: z.infer<typeof raiseLinesSchema>,
	raisedBy: { opsUserId?: string | null; name: string; email?: string | null },
): Promise<typeof schema.invoices.$inferSelect> {
	const outstanding = outstandingForStage(await documentChecklistForApplication(id), "admissions");
	if (outstanding.length > 0) {
		throw new HttpError(409, "DOCUMENTS_OUTSTANDING", `Verify the client's documents before invoicing applications. Outstanding: ${outstanding.join(", ")}.`);
	}
	const [app] = await db.select().from(schema.applications).where(eq(schema.applications.id, id)).limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	const [live] = await db
		.select({ id: schema.invoices.id, invoiceNumber: schema.invoices.invoiceNumber })
		.from(schema.invoices)
		.where(and(eq(schema.invoices.applicationId, id), eq(schema.invoices.type, "application"), not(eq(schema.invoices.status, "void"))))
		.limit(1);
	if (live) throw new HttpError(409, "APPLICATION_INVOICE_EXISTS", `An application invoice is already on this case (${live.invoiceNumber}).`);
	const [applicant] = await db.select().from(schema.applicants).where(eq(schema.applicants.id, app.applicantId)).limit(1);
	const schools = new Set(body.lines.map((l) => l.schoolApplicationId).filter(Boolean)).size;
	return createProforma({
		data: {
			applicantName: applicant?.name ?? "Applicant",
			applicantEmail: applicant?.email ?? undefined,
			clientUserId: applicant?.userId ?? undefined,
			applicationId: app.id,
			type: "application",
			status: "proforma",
			lines: body.lines.map((l) => ({ label: l.label.trim(), detail: l.detail?.trim() || undefined, amountCents: l.amountCents, schoolApplicationId: l.schoolApplicationId ?? null })),
			note: body.note?.trim() || `University application fees${schools > 0 ? ` for ${schools} school(s)` : ""}, paid on your behalf.`,
		},
		raisedBy,
	});
}


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
			c.req.valid("json").note,
		);
		return c.json(await serializeApplication(updated));
	},
);

/**
 * The office decides a client's "continue to the next stage" request.
 * Approving extends the plan — the stage's lines bill through the ordinary
 * package machinery — and reopens the case into the stage's journey step.
 */
applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/continuations/{requestId}",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: z.object({ id: z.string().uuid(), requestId: z.string().uuid() }),
			body: { content: { "application/json": { schema: decideContinuationSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: continuationRequestSchema } },
				description: "Continuation decided",
			},
		},
	}),
	async (c) => {
		await assertApplicationAccess(c, c.req.valid("param").id);
		const { request } = await decideContinuation({
			requestId: c.req.valid("param").requestId,
			applicationId: c.req.valid("param").id,
			decision: c.req.valid("json").decision,
			note: c.req.valid("json").note,
			actor: actorFrom(c.get("staff")!),
		});
		return c.json(request);
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
			body.details,
		);
		return c.json(await serializeApplication(updated));
	},
);

/* ── POST /applications/{id}/pre-departure/{taskId} — the officer ticks or waives ── */

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/pre-departure/{taskId}",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams.extend({ taskId: z.string().min(1).max(64) }),
			body: { content: { "application/json": { schema: setPreDepartureTaskSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: applicationSchema } }, description: "The application with the item updated" },
		},
	}),
	async (c) => {
		const { id, taskId } = c.req.valid("param");
		await assertApplicationAccess(c, id);
		const staff = c.get("staff")!;
		const updated = await setPreDepartureTask(id, taskId, c.req.valid("json"), { kind: "staff", name: staff.name, opsUserId: staff.opsUserId });
		return c.json(await serializeApplication(updated));
	},
);

/* ── POST /applications/{id}/release-override — release held documents early ── */

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/release-override",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("issue_invoices")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: releaseOverrideSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: applicationSchema } }, description: "Documents released early (or the release withdrawn), with the reason on the case" },
		},
	}),
	async (c) => {
		await assertApplicationAccess(c, c.req.valid("param").id);
		const updated = await setReleaseOverride(c.req.valid("param").id, c.req.valid("json"), actorFrom(c.get("staff")!));
		return c.json(await serializeApplication(updated));
	},
);

/* ── PATCH /applications/{id}/departure-details — the Departure facts ────── */

applicationsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/departure-details",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: updateDepartureDetailsSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: applicationSchema } }, description: "Departure facts recorded" },
		},
	}),
	async (c) => {
		await assertApplicationAccess(c, c.req.valid("param").id);
		const updated = await updateDepartureDetails(c.req.valid("param").id, c.req.valid("json"), actorFrom(c.get("staff")!));
		return c.json(await serializeApplication(updated));
	},
);

/* ── POST /applications/{id}/post-arrival-schedule — ops sets the client's schedule, with a reason ── */

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/post-arrival-schedule",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: postArrivalScheduleChoiceSchema.extend({ reason: z.string().min(1).max(500) }) } },
				required: true,
			},
		},
		responses: {
			200: { content: { "application/json": { schema: applicationSchema } }, description: "Schedule set" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id);
		const { reason, ...choice } = c.req.valid("json");
		const { setPostArrivalSchedule } = await import("../services/serviceFee.js");
		await setPostArrivalSchedule({ applicationId: id, choice, actor: actorFrom(c.get("staff")!), reason });
		const updated = await getApplication(id);
		return c.json(await serializeApplication(updated!));
	},
);

/* ── POST /applications/{id}/post-arrival-schedule/review — finance/manager approves (with the start date) or declines ── */

applicationsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/post-arrival-schedule/review",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("approve_schedules")] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": {
						schema: z.discriminatedUnion("decision", [
							z.object({ decision: z.literal("approve"), startAt: z.string().min(1, "Enter the plan's start date") }),
							z.object({ decision: z.literal("decline"), reason: z.string().min(1).max(500) }),
						]),
					},
				},
				required: true,
			},
		},
		responses: {
			200: { content: { "application/json": { schema: applicationSchema } }, description: "Schedule reviewed" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id);
		const body = c.req.valid("json");
		const { approvePostArrivalSchedule, declinePostArrivalSchedule } = await import("../services/serviceFee.js");
		const actor = actorFrom(c.get("staff")!);
		if (body.decision === "approve") {
			await approvePostArrivalSchedule({ applicationId: id, startAt: body.startAt, actor });
		} else {
			await declinePostArrivalSchedule({ applicationId: id, reason: body.reason, actor });
		}
		const updated = await getApplication(id);
		return c.json(await serializeApplication(updated!));
	},
);

/* ── GET /applications/{id}/ledger — the full operational ledger across the case's invoices ── */

applicationsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}/ledger",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: { params: idParams },
		responses: {
			200: { content: { "application/json": { schema: z.object({ rows: z.array(ledgerRowSchema) }) } }, description: "The case's transaction ledger" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await assertApplicationAccess(c, id);
		const { applicationLedger } = await import("../services/ledger.js");
		return c.json({ rows: await applicationLedger(id) });
	},
);

/* ── PATCH /applications/{id}/visa-details — the facts, without a stage move ── */

applicationsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/visa-details",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: updateVisaDetailsSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: applicationSchema } }, description: "Visa facts recorded" },
		},
	}),
	async (c) => {
		await assertApplicationAccess(c, c.req.valid("param").id);
		const updated = await updateVisaDetails(c.req.valid("param").id, c.req.valid("json"), actorFrom(c.get("staff")!));
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
