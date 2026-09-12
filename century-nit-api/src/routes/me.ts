import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { and, desc, eq, inArray, not } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import {


	completeFromDeparture,








	acceptProceedForApplication,

	declineProceedForApplication,

	ensureVisaInvoiceForApplication,

	getApplicantByUserId,




	latestApplicationForApplicant,
	latestConsultationForApplicant,



	patchApplicant,
	pauseProceedForApplication,

	respondToOutcome,

	serializeApplicant,
	serializeApplication,
	serializeConsultation,
	setApplicationPackage,
	setApplicationPaymentPlan,





} from "../services/cases.js";
import {
	getForApplication as getTravelAssistanceForApplication,


	recordDecision as recordTravelAssistanceDecision,




} from "../services/travelAssistance.js";
import {
	getInvoice,
	listInvoicesForClient,
	paymentWithReferenceExists,
	serializeInvoice,
	acceptProformaClient,



} from "../services/invoice.js";
import {
	createPaystackCheckout,
	verifyPaystackTransaction,
} from "../services/paystack.js";
import {
	getExchangeRate,
	settleInvoicePayment,
} from "../services/paymentSettlement.js";
import { journeyForApplicant } from "../services/journey.js";

import { syncLeadFromApplicant } from "../services/leads.js";
import {
	getOrCreateApplicantConversation,
	getApplicantMessages,
	sendApplicantMessage,
} from "../services/chat.js";
import {


	applicantSchema,

	applicationSchema,

	CASE_ERROR_CODES,

	choosePackageSchema,
	choosePaymentPlanSchema,




	JOURNEY_STAGES,
	JOURNEY_STAGE_LABELS,
	type JourneyStage,
	emptyJourney,
	invoiceListSchema,
	invoiceSchema,
	myApplicationSchema,
	paystackCheckoutSchema,
	paystackVerifyResponseSchema,
	paystackVerifySchema,







	updateMyProfileSchema,
	requestEmailChangeSchema,
	confirmEmailChangeSchema,
	portalStateSchema,
	updatePortalStateSchema,
	notificationSchema,





	travelAssistanceRequestSchema,
	travelAssistanceDecisionInputSchema,


	stageConsentSchema,
	stageConsentInputSchema,
	type StageConsentStage,
	type StageConsent,

} from "century-nit-shared";
import {




	createOrGetHandoff,
	activeHandlerFor,
} from "../services/handoffs.js";
import {
	getStageConsent,
	upsertStageConsent,
	getApplicationForClientUser,
} from "../services/stageConsents.js";
import { randomUUID } from "node:crypto";
import { HttpError } from "../middleware/error.js";


import {
	requireAuth,
	requireMfa,


	type AuthVariables,

} from "../middleware/auth.js";
import { env } from "../env.js";
import { sendEmail } from "../lib/resend.js";
import { renderOtpEmail } from "../lib/email-templates.js";

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
import { STAFF_ONLY_NOTIFICATION_TYPES, idParams } from "./caseShared.js";

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
			consultation: consultation ? await serializeConsultation(consultation, true) : null,
			application: application ? await serializeApplication(application, true) : null,
		});
	},
);

/**
 * Applicant self-service: list their own invoices.
 *
 * Unlike /api/v1/invoices this is not gated by staff module permissions, because
 * the portal (not operations staff) uses it to show the user their invoices.
 */
/**
 * Applicant self-service: the invoices of their *current* case.
 *
 * Scoped to the newest application (plus the consultation invoice, which
 * predates any application). A returning client's earlier application keeps
 * its invoices to itself — the portal reads this list to decide what is paid,
 * so an old paid visa or application invoice must never appear here as if it
 * belonged to the new case.
 */
meRouter.openapi(
	createRoute({
		method: "get",
		path: "/invoices",
		tags: ["Applicants"],
		middleware: [requireAuth, requireMfa] as const,
		request: {
			query: z.object({
				type: z.string().optional(),
				status: z.string().optional(),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: invoiceListSchema } },
				description: "Signed-in user's invoices for their current application",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const applicant = await getApplicantByUserId(user.id);
		const application = applicant ? await latestApplicationForApplicant(applicant.id) : null;
		const rows = (await listInvoicesForClient(user.id)).filter((i) => {
			if (query.type && i.type !== query.type) return false;
			if (query.status && i.status !== query.status) return false;
			if (!application) return true;
			return i.applicationId === application.id || (i.applicationId === null && i.type === "consultation");
		});
		const list = await Promise.all(rows.map(serializeInvoice));
		return c.json({ invoices: list, total: list.length });
	},
);

/**
 * Applicant self-service: idempotently ensure their visa invoice exists.
 * Raises a proforma estimate when none has been raised yet (so Ops can review
 * and issue it), backfills the application link on an orphaned one, and never
 * duplicates an existing visa invoice. Returns the invoice in every case.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/invoices/visa/ensure",
		tags: ["Applicants"],
		middleware: [requireAuth, requireMfa] as const,
		responses: {
			200: {
				content: { "application/json": { schema: invoiceSchema } },
				description: "The applicant's visa invoice (existing or newly raised)",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const row = await ensureVisaInvoiceForApplication(user.id, {
			name: user.name ?? "Applicant",
			email: user.email,
		});
		return c.json(await serializeInvoice(row));
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

		// Sync the CRM lead so the ops console reflects the name/phone the
		// applicant entered in the onboarding popup — `captureLeadFromUser`
		// only runs on auth events and only fills missing fields, so without
		// this the lead keeps the email-derived name and null phone forever.
		const profile = (updated.profile as Record<string, string> | null) ?? {};
		syncLeadFromApplicant({
			email: updated.email ?? user.email,
			name: updated.name,
			phone: updated.phone ?? null,
			referralSource: profile.referralSource ?? null,
		}).catch(() => {});

		return c.json(await serializeApplicant(updated));
	},
);

const CHANGE_OTP_EXPIRES_MINUTES = 10;
const CHANGE_OTP_IDENTIFIER = (email: string) => `change-email-${email}`;

/**
 * Applicant self-service: request an OTP to confirm a new email address.
 *
 * The code is sent to the *new* address. Confirming it updates both the Better
 * Auth users row and the applicant record, so the portal and ops stay in sync.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/change-email/request",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: requestEmailChangeSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
				description: "OTP sent (or silently skipped if address is taken)",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const newEmail = body.newEmail.trim().toLowerCase();

		if (newEmail === user.email?.toLowerCase()) {
			return c.json({ ok: true });
		}

		// Enumeration protection: don't reveal whether the address is taken.
		const [existingUser] = await db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(eq(schema.users.email, newEmail))
			.limit(1);
		const [existingStaff] = await db
			.select({ id: schema.opsUsers.id })
			.from(schema.opsUsers)
			.where(eq(schema.opsUsers.email, newEmail))
			.limit(1);
		if (existingUser || existingStaff) {
			return c.json({ ok: true });
		}

		const otp = String(Math.floor(100000 + Math.random() * 900000));
		const identifier = CHANGE_OTP_IDENTIFIER(newEmail);
		const expiresAt = new Date(Date.now() + CHANGE_OTP_EXPIRES_MINUTES * 60 * 1000);

		// Consume any previous code for this address.
		await db.delete(schema.verifications).where(eq(schema.verifications.identifier, identifier));
		await db.insert(schema.verifications).values({
			id: randomUUID(),
			identifier,
			value: `${otp}:0`,
			expiresAt,
		});

		const { html, text } = renderOtpEmail({
			otp,
			purpose: "verify your new Century NIT email address",
			expiresMinutes: CHANGE_OTP_EXPIRES_MINUTES,
		});
		await sendEmail({
			to: body.newEmail,
			subject: `Your Century NIT Code: ${otp}`,
			text,
			html,
		});

		return c.json({ ok: true });
	},
);

/**
 * Applicant self-service: confirm a new email address with the OTP.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/change-email/confirm",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: confirmEmailChangeSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ ok: z.boolean(), email: z.string() }) } },
				description: "Email updated",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const newEmail = body.newEmail.trim().toLowerCase();
		const otp = body.otp.trim();

		const [existingUser] = await db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(eq(schema.users.email, newEmail))
			.limit(1);
		const [existingStaff] = await db
			.select({ id: schema.opsUsers.id })
			.from(schema.opsUsers)
			.where(eq(schema.opsUsers.email, newEmail))
			.limit(1);
		if (existingUser || existingStaff) {
			throw new HttpError(409, "EMAIL_IN_USE", "That email address is already in use.");
		}

		const identifier = CHANGE_OTP_IDENTIFIER(newEmail);
		const [record] = await db
			.select()
			.from(schema.verifications)
			.where(eq(schema.verifications.identifier, identifier))
			.limit(1);

		if (!record || record.expiresAt < new Date()) {
			if (record) await db.delete(schema.verifications).where(eq(schema.verifications.id, record.id));
			throw new HttpError(400, "INVALID_CODE", "The code has expired. Please request a new one.");
		}

		const colonIdx = record.value.lastIndexOf(":");
		const storedOtp = colonIdx === -1 ? record.value : record.value.slice(0, colonIdx);
		const attempts = colonIdx === -1 ? 0 : Number.parseInt(record.value.slice(colonIdx + 1) || "0", 10);
		const allowedAttempts = 3;

		if (Number.isNaN(attempts) || attempts >= allowedAttempts) {
			await db.delete(schema.verifications).where(eq(schema.verifications.id, record.id));
			throw new HttpError(400, "INVALID_CODE", "Too many attempts. Please request a new code.");
		}

		if (storedOtp !== otp) {
			await db
				.update(schema.verifications)
				.set({ value: `${storedOtp}:${attempts + 1}` })
				.where(eq(schema.verifications.id, record.id));
			throw new HttpError(400, "INVALID_CODE", "The code was not accepted. Please try again.");
		}

		await db.transaction(async (tx) => {
			await tx
				.update(schema.users)
				.set({ email: newEmail, updatedAt: new Date() })
				.where(eq(schema.users.id, user.id));
			await tx
				.update(schema.applicants)
				.set({ email: newEmail, updatedAt: new Date() })
				.where(eq(schema.applicants.userId, user.id));
		});

		await db.delete(schema.verifications).where(eq(schema.verifications.id, record.id));

		return c.json({ ok: true, email: newEmail });
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
			targetSchoolCount: body.targetSchoolCount,
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
 * Applicant self-service: complete the journey from Payment Execution.
 *
 * The gate is per-plan — full plans need the agency service fee settled in
 * full, installment plans only their first installment — plus the ticketing
 * fee, travel clearance, and the finished pre-departure checklist
 * (`canAdvanceToStage` enforces it server-side).
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/complete",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {},
		responses: {
			200: {
				content: { "application/json": { schema: applicationSchema } },
				description: "The application, now Completed",
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
		const updated = await completeFromDeparture({
			id: application.id,
			applicantUserId: user.id,
		});
		return c.json(await serializeApplication(updated));
	},
);

/* ── Travel Assistance (applicant self-service, direct-invoice) ────────────── */

meRouter.openapi(
	createRoute({
		method: "get",
		path: "/application/travel-assistance",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {},
		responses: {
			200: {
				content: { "application/json": { schema: travelAssistanceRequestSchema.nullable() } },
				description: "The applicant's current travel assistance request, if any",
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
		const req = await getTravelAssistanceForApplication(application.id);
		return c.json(req);
	},
);

meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/travel-assistance/decision",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: travelAssistanceDecisionInputSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: travelAssistanceRequestSchema } },
				description: "The updated travel assistance request",
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
		const updated = await recordTravelAssistanceDecision({
			applicationId: application.id,
			applicantUserId: user.id,
			decision: body.decision,
		});
		return c.json(updated);
	},
);


// NOTE: there is deliberately no applicant-side "record a payment" route.
// Applicants only settle invoices through Paystack (checkout + verify +
// webhook); a self-recorded payment would let a signed-in client mark their
// own invoice paid and advance the journey without paying.

/**
 * Applicant self-service: accept a proforma estimate to turn it into an issued invoice.
 */
meRouter.openapi(
	createRoute({
		method: "post",
		path: "/invoices/{id}/accept",
		tags: ["Invoices"],
		middleware: [requireAuth] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: invoiceSchema } },
				description: "The accepted invoice",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const { id } = c.req.valid("param");
		const updated = await acceptProformaClient({
			invoiceId: id,
			userId: user.id,
			userName: user.name ?? "Applicant",
			userEmail: user.email,
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
			if (row.type === "agency") {
				await db
					.update(schema.invoices)
					.set({ status: "issued", updatedAt: new Date() })
					.where(eq(schema.invoices.id, row.id));
				row.status = "issued";
			} else {
				throw new HttpError(
					409,
					"INVOICE_PROFORMA",
					"Cannot pay a proforma invoice before it is reviewed and issued by staff",
				);
			}
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
		if (txn.status !== "success") {
			throw new HttpError(
				400,
				"PAYMENT_NOT_COMPLETED",
				`Payment was not completed (${txn.status}). If you were charged, the payment will still be recorded via the webhook.`,
			);
		}
		const before = await serializeInvoice(row);
		if (before.balanceCents > 0) {
			const alreadyRecorded = await paymentWithReferenceExists(row.id, body.reference);
			if (!alreadyRecorded) {
				const rate = await getExchangeRate();
				const rawAmountCents =
					txn.invoiceAmountCents ??
					(txn.currency === "GHS" ? Math.round(txn.amountCents / rate) : txn.amountCents);
				const amountCents = Math.min(Math.max(rawAmountCents, 0), before.balanceCents);
				if (amountCents > 0) {
					await settleInvoicePayment({
						invoiceId: row.id,
						amountCents,
						method: "card",
						gateway: "paystack",
						reference: body.reference,
						currency: txn.currency ?? "USD",
						actor: { name: "Paystack", email: "payments@centurynit.com" },
					});
				}
			}
		}
		const freshRow = await getInvoice(row.id);
		const invoice = await serializeInvoice(freshRow ?? row);
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
		const applicant = await getApplicantByUserId(user.id);
		const application = applicant ? await latestApplicationForApplicant(applicant.id) : null;
		const invoices = await listInvoicesForClient(user.id);
		// The current application's live agency invoice — never a void one, and
		// never one raised for an earlier application.
		const row = invoices.find(
			(i) =>
				i.type === "agency" &&
				i.status !== "void" &&
				(application ? i.applicationId === application.id : true),
		);
		if (!row) {
			throw new HttpError(
				404,
				"INVOICE_NOT_FOUND",
				"No agency invoice found. Please ask your consultant to raise one.",
			);
		}
		const serialized = await serializeInvoice(row);
		if (row.status === "paid" || serialized.balanceCents <= 0) {
			throw new HttpError(409, "INVOICE_PAID", "Invoice already paid.");
		}
		const depositCents = Math.round(serialized.subtotalCents * 0.1);
		const hasPaidDeposit = serialized.paidCents >= depositCents;
		const amountCents = !hasPaidDeposit
			? Math.min(depositCents - serialized.paidCents, serialized.balanceCents)
			: serialized.balanceCents;

		const origin = c.req.header("origin") || env.FRONTEND_URL;
		const checkout = await createPaystackCheckout({
			email: user.email,
			amountCents,
			invoiceId: row.id,
			callbackUrl: `${origin}/portal/pay?invoice=${row.id}&paystack=1${!hasPaidDeposit ? "&deposit=1" : ""}`,
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
		payment_execution: z.boolean(),
		travel_assistance: z.boolean(),
		complete: z.boolean(),
	}),
	stageStatuses: z.record(z.enum(["done", "current", "locked", "skipped"])),
	label: z.string(),
	nextUnlock: z.string().nullable(),
});
/**
 * Applicant self-service: where they are in the journey.
 *
 * The facts are gathered by `journeyForApplicant` (shared with the ops
 * application serializer) and turned into a portal stage, chapter unlocks and
 * per-step statuses by `deriveJourney` in century-nit-shared, which is pure
 * and unit-tested.
 */
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
		if (!applicant) return c.json(emptyJourney());
		const application = await latestApplicationForApplicant(applicant.id);
		return c.json(await journeyForApplicant(applicant, application));
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

/* ── Stage consent ───────────────────────────────────────────────────────── */
/**
 * The applicant's explicit decision to start, hold, or opt out of a major
 * journey stage. Only "continue" sends the case to Ops for handler assignment.
 */

/**
 * Shared helper: process a consent decision for a stage. Called by the three
 * stage-specific endpoints below.
 *
 * The application stage has exactly one state machine — `proceedStatus`,
 * driven by the transactional `accept/pause/declineProceedForApplication`
 * helpers — and this is its only applicant-facing entry point. The consent
 * record is written after the transition so a refused transition (already
 * open, etc.) leaves no half-recorded decision behind.
 *
 * No handoff is created here for the application stage: the handler is
 * requested when the 10% deposit is paid (see recordPayment in invoice.ts),
 * which is the moment the case is actually ready for one. Visa and travel do
 * hand off on consent, because consent is what opens those stages.
 */
export async function processConsentDecision(input: {
	userId: string;
	stage: StageConsentStage;
	decision: "continue" | "hold" | "opt_out";
	reason?: string;
}): Promise<{ consent: StageConsent }> {
	const { applicant, application } = await getApplicationForClientUser(input.userId);
	const actor = { name: applicant.name ?? "Applicant" };

	if (input.stage === "application") {
		if (input.decision === "continue") {
			if (application.proceedStatus !== "accepted") {
				await acceptProceedForApplication({ applicationId: application.id, actor });
			}
		} else if (input.decision === "hold") {
			await pauseProceedForApplication({ applicationId: application.id, reason: input.reason, actor });
		} else {
			await declineProceedForApplication({ applicationId: application.id, reason: input.reason, actor });
		}
	}

	const consent = await upsertStageConsent({
		applicationId: application.id,
		stage: input.stage,
		decision: input.decision,
		reason: input.reason,
		decidedByClientUserId: input.userId,
	});

	// The proceed helpers write their own audit comment for the application
	// stage; visa and travel are recorded here.
	if (input.stage !== "application") {
		const verb =
			input.decision === "continue"
				? "consented to continue with"
				: input.decision === "hold"
					? "put on hold"
					: "opted out of";
		const suffix = input.decision !== "continue" && input.reason ? ` — ${input.reason}` : "";
		await db.insert(schema.caseComments).values({
			targetType: "application",
			targetId: application.id,
			kind: "status",
			text: `Applicant ${verb} the ${input.stage} stage${suffix}`,
			authorName: actor.name,
		});
	}

	if (input.stage === "application" || input.decision !== "continue") {
		return { consent };
	}

	// ── Visa / travel: consent opens the stage and requests a specialist ──
	const handoffStage = input.stage === "visa" ? "visa_processing" : "travel_assistance";

	// Only a specialist assigned to *this* stage counts. The whole-case school
	// handler (assignedStaffId) is not automatically the visa or travel
	// specialist, so activeHandlerFor's fallback must not be used here.
	const [existingHandler] = await db
		.select({
			opsUserId: schema.stageAssignments.opsUserId,
			name: schema.opsUsers.name,
			email: schema.opsUsers.email,
		})
		.from(schema.stageAssignments)
		.innerJoin(schema.opsUsers, eq(schema.stageAssignments.opsUserId, schema.opsUsers.id))
		.where(
			and(
				eq(schema.stageAssignments.applicationId, application.id),
				eq(schema.stageAssignments.stage, handoffStage),
				eq(schema.stageAssignments.status, "active"),
			),
		)
		.limit(1);

	if (!existingHandler) {
		// The current stage's handler is the continuity candidate the manager
		// can "keep".
		const current = await activeHandlerFor(application.id, application.stage);
		await createOrGetHandoff({
			applicationId: application.id,
			stage: handoffStage,
			source: `${input.stage}_consent_continue`,
			fromOpsUserId: current?.opsUserId ?? null,
		});
	}

	if (input.stage === "visa") {
		// The applicant's consent opens the visa stage, whatever column the
		// case sits in on the ops board. If the handler never moved it to
		// offer_letter_review, that column is skipped — say so in the case
		// history rather than block the applicant on board housekeeping or
		// fabricate a stage the case never occupied.
		const skippedStages = (JOURNEY_STAGES as string[])
			.slice(JOURNEY_STAGES.indexOf(application.stage) + 1, JOURNEY_STAGES.indexOf("visa_processing"))
			.map((s) => JOURNEY_STAGE_LABELS[s as JourneyStage]);
		await db
			.update(schema.applications)
			.set({
				stage: "visa_processing",
				visaStage: existingHandler ? "pending" : "awaiting_handler",
				updatedAt: new Date(),
			})
			.where(and(eq(schema.applications.id, application.id), not(eq(schema.applications.stage, "visa_processing"))));
		if (application.stage !== "visa_processing") {
			await db.insert(schema.caseComments).values({
				targetType: "application",
				targetId: application.id,
				kind: "status",
				text:
					skippedStages.length > 0
						? `Stage → Visa Processing on the applicant's consent (${skippedStages.join(", ")} skipped — offers were accepted while the case was still in ${JOURNEY_STAGE_LABELS[application.stage as JourneyStage] ?? application.stage}).`
						: "Stage → Visa Processing on the applicant's consent.",
				authorName: "System",
				authorOpsUserId: null,
			});
		}

		if (existingHandler) {
			await ensureVisaInvoiceForApplication(input.userId, {
				opsUserId: existingHandler.opsUserId,
				name: existingHandler.name,
				email: existingHandler.email,
			});
		}
	}

	return { consent };
}

meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/consent",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: stageConsentInputSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ consent: stageConsentSchema }) } },
				description: "Application stage consent recorded",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const body = c.req.valid("json");
		const result = await processConsentDecision({
			userId: user.id,
			stage: "application",
			decision: body.decision,
			reason: body.reason,
		});
		return c.json(result, 200);
	},
);

meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/visa/consent",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: stageConsentInputSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ consent: stageConsentSchema }) } },
				description: "Visa stage consent recorded",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const body = c.req.valid("json");
		const result = await processConsentDecision({
			userId: user.id,
			stage: "visa",
			decision: body.decision,
			reason: body.reason,
		});
		return c.json(result, 200);
	},
);

meRouter.openapi(
	createRoute({
		method: "post",
		path: "/application/travel/consent",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: stageConsentInputSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ consent: stageConsentSchema }) } },
				description: "Travel stage consent recorded",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const body = c.req.valid("json");
		const result = await processConsentDecision({
			userId: user.id,
			stage: "travel",
			decision: body.decision,
			reason: body.reason,
		});
		return c.json(result, 200);
	},
);

/** Get the consent status for a specific stage (used by the portal to decide
 * whether to show the consent card). */
meRouter.openapi(
	createRoute({
		method: "get",
		path: "/application/consent/{stage}",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			params: z.object({ stage: z.enum(["application", "visa", "travel"]) }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ consent: stageConsentSchema.nullable() }) } },
				description: "Consent status for the stage",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const { stage } = c.req.valid("param");
		const { application } = await getApplicationForClientUser(user.id);
		const consent = await getStageConsent(application.id, stage);
		return c.json({ consent }, 200);
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


