import { desc, eq } from "drizzle-orm";
import {
	JOURNEY_STAGES,
	type JourneyStage,
} from "century-nit-shared";
import type {
	TravelAssistanceBookingInput,
	TravelAssistanceDecisionInput,
	TravelAssistanceRequest,
	TravelAssistanceStatus,
	TravelFlight,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	caseComments,
	opsUsers,
	travelAssistanceRequests,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { createInvoice } from "./invoice.js";
import { notify } from "./notify.js";
import { upsertStageConsent } from "./stageConsents.js";
import * as mail from "./notifications.js";
import { queueEmails } from "../worker/queues.js";
import { env } from "../env.js";

/**
 * Travel Assistance — direct-invoice flow.
 *
 * The applicant picks yes/hold/no once visa & payment obligations are done.
 * Only "yes" leads to handler assignment → ticket invoice → booking. The
 * service fee is already collected upfront as part of the package, so only
 * the airline fare is invoiced here, and only after a handler is assigned —
 * we never bill a client for a ticket before someone owns the case.
 */

export const TRAVEL_ERROR_CODES = {
	NOT_FOUND: "TRAVEL_ASSISTANCE_NOT_FOUND",
	APPLICATION_NOT_FOUND: "APPLICATION_NOT_FOUND",
	FORBIDDEN: "FORBIDDEN",
	NOT_ELIGIBLE: "TRAVEL_NOT_ELIGIBLE",
	ALREADY_INVOICED: "ALREADY_INVOICED",
	ALREADY_BOOKED: "ALREADY_BOOKED",
	NOT_APPROVED: "QUOTE_NOT_APPROVED",
	HANDLER_NOT_ASSIGNED: "HANDLER_NOT_ASSIGNED",
	VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;

type Actor = { opsUserId?: string | null; name: string; email: string };

/**
 * The database enum still carries the retired labels (Postgres cannot drop
 * enum values in place); rows were migrated, but map defensively so a stray
 * value can never reach a client as a status it does not know.
 */
export function normalizeTravelStatus(status: string): TravelAssistanceStatus {
	switch (status) {
		case "quote_prepared":
		case "quote_approved":
			return "invoiced";
		case "cleared":
			return "booked";
		default:
			return status as TravelAssistanceStatus;
	}
}

function serialize(row: typeof travelAssistanceRequests.$inferSelect): TravelAssistanceRequest {
	return {
		id: row.id,
		applicantId: row.applicantId,
		applicationId: row.applicationId,
		decision: row.decision ?? null,
		status: normalizeTravelStatus(row.status),
		flight: row.flight ?? null,
		currency: row.currency,
		invoiceId: row.invoiceId ?? null,
		booking: row.booking ?? null,
		applicantNote: row.applicantNote ?? null,
		opsNote: row.opsNote ?? null,
		assignedOpsUserId: row.assignedOpsUserId ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * When an applicant says "yes" to travel assistance, advance the application's
 * journey stage to `travel_assistance` if it hasn't been advanced yet and the
 * visa gate is satisfied. This keeps the ops travel cases list in sync with
 * the portal — without it the request exists but the application stays at an
 * earlier stage and never appears in the ops travel page's main list.
 */
async function autoAdvanceToTravelAssistance(
	applicationId: string,
	currentStage: string,
	visaStage: string,
): Promise<void> {
	const targetIdx = JOURNEY_STAGES.indexOf("travel_assistance");
	const currentIdx = JOURNEY_STAGES.indexOf(currentStage as JourneyStage);
	if (currentIdx < 0 || currentIdx >= targetIdx) return;
	if (visaStage !== "complete") return;

	const [updated] = await db
		.update(applications)
		.set({ stage: "travel_assistance", updatedAt: new Date() })
		.where(eq(applications.id, applicationId))
		.returning();
	if (!updated) return;

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: applicationId,
		kind: "status",
		text: "Stage → travel_assistance (applicant requested travel assistance)",
		authorName: "System",
		authorOpsUserId: null,
	});
}

/** The application a travel request belongs to (for access checks). */
export async function applicationIdOfTravelRequest(requestId: string): Promise<string> {
	const [row] = await db
		.select({ applicationId: travelAssistanceRequests.applicationId })
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.id, requestId))
		.limit(1);
	if (!row) throw new HttpError(404, TRAVEL_ERROR_CODES.NOT_FOUND, "Travel assistance request not found");
	return row.applicationId;
}

/** Find the active travel assistance request for an application. */
export async function getForApplication(
	applicationId: string,
): Promise<TravelAssistanceRequest | null> {
	const [row] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.applicationId, applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt))
		.limit(1);
	return row ? serialize(row) : null;
}

/** Find the active travel assistance request for an application (ops view, with context). */
export async function getForApplicationWithContext(
	applicationId: string,
): Promise<TravelAssistanceRequest | null> {
	const [row] = await db
		.select({
			req: travelAssistanceRequests,
			applicantName: applicants.name,
			applicantEmail: applicants.email,
			applicationReference: applications.appNumber,
			university: applications.university,
			program: applications.program,
			assignedOpsUserName: opsUsers.name,
		})
		.from(travelAssistanceRequests)
		.innerJoin(applicants, eq(applicants.id, travelAssistanceRequests.applicantId))
		.innerJoin(applications, eq(applications.id, travelAssistanceRequests.applicationId))
		.leftJoin(opsUsers, eq(opsUsers.id, travelAssistanceRequests.assignedOpsUserId))
		.where(eq(travelAssistanceRequests.applicationId, applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt))
		.limit(1);
	if (!row) return null;
	return {
		...serialize(row.req),
		applicantName: row.applicantName,
		applicantEmail: row.applicantEmail,
		applicationReference: row.applicationReference,
		university: row.university,
		program: row.program,
		assignedOpsUserName: row.assignedOpsUserName ?? undefined,
	};
}

/** List all travel assistance requests (Ops queue). */
export async function listForOps(): Promise<TravelAssistanceRequest[]> {
	const rows = await db
		.select({
			req: travelAssistanceRequests,
			applicantName: applicants.name,
			applicantEmail: applicants.email,
			applicationReference: applications.appNumber,
			university: applications.university,
			program: applications.program,
			assignedOpsUserName: opsUsers.name,
		})
		.from(travelAssistanceRequests)
		.innerJoin(applicants, eq(applicants.id, travelAssistanceRequests.applicantId))
		.innerJoin(applications, eq(applications.id, travelAssistanceRequests.applicationId))
		.leftJoin(opsUsers, eq(opsUsers.id, travelAssistanceRequests.assignedOpsUserId))
		.orderBy(desc(travelAssistanceRequests.createdAt));
	return rows.map((r) => ({
		...serialize(r.req),
		applicantName: r.applicantName,
		applicantEmail: r.applicantEmail,
		applicationReference: r.applicationReference,
		university: r.university,
		program: r.program,
		assignedOpsUserName: r.assignedOpsUserName ?? undefined,
	}));
}

/**
 * Applicant records their decision. Creates a request if none exists.
 *
 * - yes  → status `review` (Ops assigns a handler, then raises the ticket invoice)
 * - hold → status `on_hold` (no invoice, no handler, resumable)
 * - no   → status `declined` (no invoice, unblocks journey completion)
 */
export async function recordDecision(input: {
	applicationId: string;
	applicantUserId: string;
	decision: TravelAssistanceDecisionInput["decision"];
}): Promise<TravelAssistanceRequest> {
	const [app] = await db
		.select()
		.from(applications)
		.where(eq(applications.id, input.applicationId))
		.limit(1);
	if (!app) {
		throw new HttpError(404, TRAVEL_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	}

	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.id, app.applicantId))
		.limit(1);
	if (!applicant || applicant.userId !== input.applicantUserId) {
		throw new HttpError(403, TRAVEL_ERROR_CODES.FORBIDDEN, "Not your application");
	}

	// Find an existing request for this application.
	const [existing] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.applicationId, input.applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt))
		.limit(1);

	const status =
		input.decision === "yes"
			? "review"
			: input.decision === "hold"
				? "on_hold"
				: "declined";

	// This decision *is* the applicant's consent for the travel stage — one
	// question, answered once. Record it as the stage consent too, so the
	// manual stage-advance guard and the case history see it, without a
	// separate consent card or a second manager queue item: the travel
	// request itself is what ops works from.
	await upsertStageConsent({
		applicationId: input.applicationId,
		stage: "travel",
		decision: input.decision === "yes" ? "continue" : input.decision === "hold" ? "hold" : "opt_out",
		decidedByClientUserId: input.applicantUserId,
	});

	if (existing) {
		// Don't allow re-deciding after a booking is confirmed or an invoice is paid.
		if (existing.status === "booked" || existing.status === "invoiced") {
			throw new HttpError(
				409,
				TRAVEL_ERROR_CODES.ALREADY_INVOICED,
				"Travel assistance is already invoiced or booked. Contact your consultant to make changes.",
			);
		}
		const [updated] = await db
			.update(travelAssistanceRequests)
			.set({
				decision: input.decision,
				status,
				updatedAt: new Date(),
			})
			.where(eq(travelAssistanceRequests.id, existing.id))
			.returning();
		if (input.decision === "yes") {
			await autoAdvanceToTravelAssistance(input.applicationId, app.stage, app.visaStage);
			// Re-create the handoff if the applicant resumes from hold/declined
			// and no handler is assigned yet (idempotent via createOrGetHandoff).
			if (!existing.assignedOpsUserId) {
				const { ensureTravelHandoffForApplication } = await import("./handoffs.js");
				await ensureTravelHandoffForApplication({ applicationId: input.applicationId }).catch(() => {});
			}
		} else if (input.decision === "no") {
			await settleTravel(input.applicationId, "applicant is booking their own flight", applicant.name ?? "Applicant");
		}
		return serialize(updated);
	}

	const [created] = await db
		.insert(travelAssistanceRequests)
		.values({
			applicantId: app.applicantId,
			applicationId: input.applicationId,
			decision: input.decision,
			status,
		})
		.returning();

	if (input.decision === "yes") {
		await autoAdvanceToTravelAssistance(input.applicationId, app.stage, app.visaStage);
		// Create a `travel_assistance` handoff so the case appears in the same
		// Workspace "Needs assignment" queue and on the Cases board handoff
		// column as application and visa — one assignment pattern, not two.
		// `createOrGetHandoff` dedupes on pending, so this is idempotent.
		const { ensureTravelHandoffForApplication } = await import("./handoffs.js");
		await ensureTravelHandoffForApplication({ applicationId: input.applicationId }).catch(() => {});
	} else if (input.decision === "no") {
		// Booking their own flight settles travel; the case moves on now
		// rather than waiting for someone to notice.
		await settleTravel(input.applicationId, "applicant is booking their own flight", applicant.name ?? "Applicant");
	}

	// Notify the applicant that their decision was recorded.
	if (applicant.userId) {
		notify({
			recipientUserId: applicant.userId,
			type: "stage.changed",
			title: "Travel assistance decision recorded",
			body:
				input.decision === "yes"
					? "Your request has been sent to our travel team. A handler will be assigned to raise your ticket invoice."
					: input.decision === "hold"
						? "Your travel assistance is on hold. You can resume anytime."
						: "You've chosen to arrange your own flight. Safe travels!",
			link: "/portal/travel-assistance",
		}).catch(() => {});
	}

	return serialize(created);
}

/**
 * Manager assigns a handler to work a travel assistance request.
 * The handler is the ops user responsible for issuing the ticket invoice
 * and recording the booking confirmation.
 */
export async function assignHandler(input: {
	requestId: string;
	opsUserId: string;
	actor: Actor;
}): Promise<TravelAssistanceRequest> {
	const [existing] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.id, input.requestId))
		.limit(1);
	if (!existing) {
		throw new HttpError(404, TRAVEL_ERROR_CODES.NOT_FOUND, "Travel assistance request not found");
	}
	if (existing.status === "booked" || existing.status === "declined") {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.ALREADY_BOOKED,
			"This request is already resolved and cannot be reassigned.",
		);
	}

	const { loadAssignableStaff } = await import("./cases.js");
	const handler = await loadAssignableStaff(input.opsUserId, "travel_assistance");

	// The travel handler is the travel-stage specialist. Recording them in
	// stage_assignments (the one place stage ownership lives) is what makes
	// activeHandlerFor, case access and chat routing recognise them; the
	// column on the request is a convenience mirror for the Travel page.
	const { assignStageOfficer } = await import("./communication.js");
	await assignStageOfficer({
		applicationId: existing.applicationId,
		stage: "travel_assistance",
		opsUserId: input.opsUserId,
		assignedBy: input.actor.opsUserId ?? input.opsUserId,
		reason: "travel request",
	});
	// Resolve any pending `travel_assistance` handoff so the case disappears
	// from the Workspace "Needs assignment" queue — same pattern as
	// resolveStageHandoff for application/visa.
	const { resolveTravelHandoffForApplication } = await import("./handoffs.js");
	await resolveTravelHandoffForApplication({
		applicationId: existing.applicationId,
		opsUserId: input.opsUserId,
		actor: {
			opsUserId: input.actor.opsUserId ?? input.opsUserId,
			name: input.actor.name,
			email: input.actor.email,
		},
	}).catch(() => {});
	const [updated] = await db
		.update(travelAssistanceRequests)
		.set({
			assignedOpsUserId: input.opsUserId,
			updatedAt: new Date(),
		})
		.where(eq(travelAssistanceRequests.id, existing.id))
		.returning();

	// Notify the assigned handler.
	const handlerUserIds = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(eq(opsUsers.id, input.opsUserId))
		.limit(1);
	if (handlerUserIds[0]?.userId) {
		notify({
			recipientUserId: handlerUserIds[0].userId,
			type: "stage.changed",
			title: "Travel assistance request assigned to you",
			body: `A travel assistance request has been assigned to you. Review it and issue the ticket invoice when ready.`,
			link: "/ops/travel",
		}).catch(() => {});
	}

	// Email the assigned handler and the applicant so both sides know who is
	// handling the travel request. Fire-and-forget — a failed email must not
	// block the assignment.
	try {
		const [applicant] = await db
			.select({ name: applicants.name, email: applicants.email })
			.from(applicants)
			.where(eq(applicants.id, existing.applicantId))
			.limit(1);
		const [application] = await db
			.select({ appNumber: applications.appNumber })
			.from(applications)
			.where(eq(applications.id, existing.applicationId))
			.limit(1);
		const reference = application?.appNumber ?? updated.id;

		if (handler.email) {
			await queueEmails([
				mail.travelHandlerAssigned({
					reference,
					clientName: applicant?.name ?? "Client",
					clientEmail: applicant?.email ?? "",
					handlerName: handler.name,
					handlerEmail: handler.email,
				}),
			]);
		}

		if (applicant?.email) {
			await queueEmails([
				mail.travelHandlerAssignedForClient({
					clientName: applicant.name,
					clientEmail: applicant.email,
					handlerName: handler.name,
					handlerEmail: handler.email,
					reference,
					portalUrl: env.FRONTEND_URL,
				}),
			]);
		}
	} catch (err) {
		console.error("[travelAssistance] failed to queue handler assignment emails:", err);
	}

	return serialize(updated);
}

/**
 * Handler raises the ticket invoice: the airline fare, for a specific flight.
 * The service fee was collected with the package, so the fare is the only
 * line. Raised as a proforma; issued in the same step when the caller holds
 * the invoices module (`issueNow`), otherwise finance issues it from the
 * Invoices page — the same two-step every other invoice follows. The request
 * is `invoiced` either way; whether the applicant can pay yet is the
 * invoice's own status.
 */
export async function raiseTicketInvoice(input: {
	requestId: string;
	fareCents: number;
	flight: TravelFlight;
	issueNow: boolean;
	actor: Actor;
}): Promise<TravelAssistanceRequest> {
	const [existing] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.id, input.requestId))
		.limit(1);
	if (!existing) {
		throw new HttpError(404, TRAVEL_ERROR_CODES.NOT_FOUND, "Travel assistance request not found");
	}
	if (existing.status !== "review") {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.NOT_APPROVED,
			"The ticket invoice can only be raised after the applicant asks for travel assistance.",
		);
	}
	if (!existing.assignedOpsUserId) {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.HANDLER_NOT_ASSIGNED,
			"Assign a handler before raising the ticket invoice.",
		);
	}
	if (existing.invoiceId) {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.ALREADY_INVOICED,
			"A ticket invoice has already been raised for this request.",
		);
	}
	if (input.fareCents <= 0) {
		throw new HttpError(400, TRAVEL_ERROR_CODES.VALIDATION_ERROR, "The fare must be greater than zero.");
	}

	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.id, existing.applicantId))
		.limit(1);
	if (!applicant) {
		throw new HttpError(404, "APPLICANT_NOT_FOUND", "Applicant not found");
	}

	const flight = cleanFlight(input.flight);
	const route = [flight.from, flight.to].filter(Boolean).join(" → ");
	const detail = [
		[flight.carrier, flight.flightNumber].filter(Boolean).join(" "),
		route,
		flight.departAt ? new Date(flight.departAt).toUTCString().replace(/:\d\d GMT$/, " UTC") : "",
	]
		.filter(Boolean)
		.join(" · ");

	const created = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const invoice = await createInvoice({
			data: {
				applicantName: applicant.name,
				applicantEmail: applicant.email ?? undefined,
				clientUserId: applicant.userId ?? undefined,
				applicationId: existing.applicationId,
				type: "travel",
				status: "proforma",
				lines: [{ label: "Flight ticket", detail: detail || "Airline fare", amountCents: input.fareCents }],
				note: flight.notes,
			},
			actor: input.actor,
			tx: txDb,
		});
		await txDb
			.update(travelAssistanceRequests)
			.set({
				invoiceId: invoice.id,
				flight,
				opsNote: flight.notes ?? null,
				status: "invoiced",
				updatedAt: new Date(),
			})
			.where(eq(travelAssistanceRequests.id, existing.id));
		return invoice;
	});

	if (input.issueNow) {
		const { issueInvoiceByOps } = await import("./invoice.js");
		await issueInvoiceByOps({
			invoiceId: created.id,
			actorName: input.actor.name,
			auditNote: "Ticket invoice raised and issued by the travel handler",
		});
		if (applicant.userId) {
			notify({
				recipientUserId: applicant.userId,
				type: "stage.changed",
				title: "Flight ticket invoice ready",
				body: "Your flight ticket invoice has been issued. Pay it and we will book your flight.",
				link: "/portal/pre-departure",
			}).catch(() => {});
		}
	} else {
		if (applicant.userId) {
			notify({
				recipientUserId: applicant.userId,
				type: "stage.changed",
				title: "Flight ticket invoice raised",
				body: "Your handler has prepared your flight ticket invoice. You will be able to pay it here once finance issues it.",
				link: "/portal/pre-departure",
			}).catch(() => {});
		}
	}

	const [updated] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.id, existing.id))
		.limit(1);
	return serialize(updated);
}

/** Trim the flight fields; drop empties so the JSON stays small and honest. */
function cleanFlight<T extends TravelFlight>(f: T): T {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(f)) {
		if (typeof v === "string") {
			const t = v.trim();
			if (t) out[k] = t;
		} else if (v !== undefined && v !== null) {
			out[k] = v;
		}
	}
	return out as T;
}


/**
 * Mark the ticket as paid. Called when the travel invoice is settled.
 * Moves the request from `invoiced` → `ticket_paid`, signalling the handler
 * can now record the booking confirmation.
 */
export async function markTicketPaid(requestId: string): Promise<void> {
	const [existing] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.id, requestId))
		.limit(1);
	if (!existing) return;
	if (existing.status !== "invoiced") return;

	await db
		.update(travelAssistanceRequests)
		.set({ status: "ticket_paid", updatedAt: new Date() })
		.where(eq(travelAssistanceRequests.id, requestId));

	// Notify the assigned handler that the ticket is paid and booking can proceed.
	if (existing.assignedOpsUserId) {
		const [handler] = await db
			.select({ userId: opsUsers.userId })
			.from(opsUsers)
			.where(eq(opsUsers.id, existing.assignedOpsUserId))
			.limit(1);
		if (handler?.userId) {
			notify({
				recipientUserId: handler.userId,
				type: "stage.changed",
				title: "Flight ticket paid — ready to book",
				body: "The applicant has paid their flight ticket. Confirm the booking to update the portal.",
				link: "/ops/travel",
			}).catch(() => {});
		}
	}
}

/** Ops records the booking confirmation after the ticket is paid and issued. */
export async function recordBooking(input: {
	requestId: string;
	booking: TravelAssistanceBookingInput;
	actor: Actor;
}): Promise<TravelAssistanceRequest> {
	const [existing] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.id, input.requestId))
		.limit(1);
	if (!existing) {
		throw new HttpError(404, TRAVEL_ERROR_CODES.NOT_FOUND, "Travel assistance request not found");
	}
	if (existing.status !== "ticket_paid") {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.NOT_APPROVED,
			"The booking can only be recorded after the ticket is paid.",
		);
	}
	// The booked flight defaults to the one on the invoice; the handler
	// overrides whatever the airline changed.
	const booking = cleanFlight({ ...(existing.flight ?? {}), ...input.booking });
	const [updated] = await db
		.update(travelAssistanceRequests)
		.set({ booking, status: "booked", updatedAt: new Date() })
		.where(eq(travelAssistanceRequests.id, existing.id))
		.returning();

	await settleTravel(existing.applicationId, "flight booked", input.actor.name);

	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.id, existing.applicantId))
		.limit(1);
	if (applicant?.userId) {
		notify({
			recipientUserId: applicant.userId,
			type: "stage.changed",
			title: "Flight booked",
			body: "Your flight is booked. The details are on your travel page; your payment plan is next.",
			link: "/portal/pre-departure",
		}).catch(() => {});
	}
	return serialize(updated);
}

/**
 * Travel is settled — booked, or the applicant is booking their own — so the
 * case leaves Travel Assistance the way it entered: on its own. Idempotent;
 * a case that is not at travel_assistance is left where it is.
 */
async function settleTravel(applicationId: string, why: string, actorName: string): Promise<void> {
	const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
	if (!app || app.stage !== "travel_assistance") return;
	const { enterPaymentExecution } = await import("./cases.js");
	await enterPaymentExecution(app, why, actorName).catch((err) => {
		console.error("[travelAssistance] could not advance to payment_execution:", err);
	});
}
