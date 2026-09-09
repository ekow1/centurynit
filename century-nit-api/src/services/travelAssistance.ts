import { desc, eq } from "drizzle-orm";
import {
	JOURNEY_STAGES,
	type JourneyStage,
} from "century-nit-shared";
import type {
	TravelAssistanceBookingInput,
	TravelAssistanceChecklistInput,
	TravelAssistanceDecisionInput,
	TravelAssistanceQuote,
	TravelAssistanceQuoteInput,
	TravelAssistanceRequest,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	caseComments,
	travelAssistanceRequests,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { createInvoice } from "./invoice.js";
import { notify } from "./notify.js";

/**
 * Travel Assistance — quote-before-invoice flow.
 *
 * The applicant picks yes/hold/no once visa & payment obligations are done.
 * Only "yes" leads to a quote → approval → ticket invoice → booking. The
 * service fee is already collected upfront as part of the package, so only
 * the airline fare is invoiced here, and only after the applicant approves
 * the quote — we never bill a client for a changing ticket price before they
 * have seen and accepted the itinerary.
 */

export const TRAVEL_ERROR_CODES = {
	NOT_FOUND: "TRAVEL_ASSISTANCE_NOT_FOUND",
	APPLICATION_NOT_FOUND: "APPLICATION_NOT_FOUND",
	FORBIDDEN: "FORBIDDEN",
	NOT_ELIGIBLE: "TRAVEL_NOT_ELIGIBLE",
	QUOTE_NOT_PREPARED: "QUOTE_NOT_PREPARED",
	ALREADY_INVOICED: "ALREADY_INVOICED",
	ALREADY_BOOKED: "ALREADY_BOOKED",
	NOT_APPROVED: "QUOTE_NOT_APPROVED",
	VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;

type Actor = { opsUserId?: string | null; name: string; email: string };

function serialize(row: typeof travelAssistanceRequests.$inferSelect): TravelAssistanceRequest {
	return {
		id: row.id,
		applicantId: row.applicantId,
		applicationId: row.applicationId,
		decision: row.decision ?? null,
		status: row.status,
		quote: (row.quote ?? null) as TravelAssistanceQuote | null,
		ticketAmountCents: row.ticketAmountCents ?? null,
		currency: row.currency,
		invoiceId: row.invoiceId ?? null,
		bookingConfirmation: row.bookingConfirmation ?? null,
		opsChecklist: row.opsChecklist ?? [],
		applicantNote: row.applicantNote ?? null,
		opsNote: row.opsNote ?? null,
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
		})
		.from(travelAssistanceRequests)
		.innerJoin(applicants, eq(applicants.id, travelAssistanceRequests.applicantId))
		.innerJoin(applications, eq(applications.id, travelAssistanceRequests.applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt));
	return rows.map((r) => ({
		...serialize(r.req),
		applicantName: r.applicantName,
		applicantEmail: r.applicantEmail,
		applicationReference: r.applicationReference,
		university: r.university,
		program: r.program,
	}));
}

/**
 * Applicant records their decision. Creates a request if none exists.
 *
 * - yes  → status `review` (Ops prepares a quote)
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
	}

	// Notify the applicant that their decision was recorded.
	if (applicant.userId) {
		notify({
			recipientUserId: applicant.userId,
			type: "stage.changed",
			title: "Travel assistance decision recorded",
			body:
				input.decision === "yes"
					? "Your consultant will prepare a flight quote for your review."
					: input.decision === "hold"
						? "Your travel assistance is on hold. You can resume anytime."
						: "You've chosen to arrange your own flight. Safe travels!",
			link: "/portal/travel-assistance",
		}).catch(() => {});
	}

	return serialize(created);
}

/** Applicant approves the prepared quote. */
export async function approveQuote(input: {
	applicationId: string;
	applicantUserId: string;
	note?: string;
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

	const [existing] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.applicationId, input.applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt))
		.limit(1);
	if (!existing) {
		throw new HttpError(404, TRAVEL_ERROR_CODES.NOT_FOUND, "No travel assistance request found");
	}
	if (existing.status !== "quote_prepared") {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.QUOTE_NOT_PREPARED,
			"There is no prepared quote to approve.",
		);
	}

	const [updated] = await db
		.update(travelAssistanceRequests)
		.set({
			status: "quote_approved",
			applicantNote: input.note?.trim() || null,
			updatedAt: new Date(),
		})
		.where(eq(travelAssistanceRequests.id, existing.id))
		.returning();
	return serialize(updated);
}

/** Applicant requests changes to the prepared quote. */
export async function requestQuoteChanges(input: {
	applicationId: string;
	applicantUserId: string;
	note?: string;
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

	const [existing] = await db
		.select()
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.applicationId, input.applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt))
		.limit(1);
	if (!existing) {
		throw new HttpError(404, TRAVEL_ERROR_CODES.NOT_FOUND, "No travel assistance request found");
	}
	if (existing.status !== "quote_prepared") {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.QUOTE_NOT_PREPARED,
			"There is no prepared quote to change.",
		);
	}

	const [updated] = await db
		.update(travelAssistanceRequests)
		.set({
			status: "review",
			applicantNote: input.note?.trim() || null,
			updatedAt: new Date(),
		})
		.where(eq(travelAssistanceRequests.id, existing.id))
		.returning();
	return serialize(updated);
}

/** Ops prepares a flight quote and sends it to the applicant. */
export async function prepareQuote(input: {
	requestId: string;
	quote: TravelAssistanceQuoteInput;
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
	if (existing.status === "invoiced" || existing.status === "booked") {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.ALREADY_INVOICED,
			"This request is already invoiced or booked.",
		);
	}

	const [updated] = await db
		.update(travelAssistanceRequests)
		.set({
			quote: input.quote as TravelAssistanceQuote,
			ticketAmountCents: input.quote.ticketAmountCents,
			opsNote: input.quote.opsNote?.trim() || null,
			status: "quote_prepared",
			updatedAt: new Date(),
		})
		.where(eq(travelAssistanceRequests.id, existing.id))
		.returning();

	// Notify the applicant that a quote is ready for review.
	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.id, existing.applicantId))
		.limit(1);
	if (applicant?.userId) {
		notify({
			recipientUserId: applicant.userId,
			type: "stage.changed",
			title: "Flight quote ready for review",
			body: "Your consultant has prepared a flight option. Review and approve it to proceed.",
			link: "/portal/travel-assistance",
		}).catch(() => {});
	}

	return serialize(updated);
}

/**
 * Ops raises the ticket invoice after the applicant approves the quote.
 * The service fee is already collected upfront — only the airline fare is
 * invoiced here.
 */
export async function raiseTicketInvoice(input: {
	requestId: string;
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
	if (existing.status !== "quote_approved") {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.NOT_APPROVED,
			"The applicant has not approved the quote yet.",
		);
	}
	if (existing.invoiceId) {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.ALREADY_INVOICED,
			"An invoice has already been raised for this request.",
		);
	}

	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.id, existing.applicantId))
		.limit(1);
	if (!applicant) {
		throw new HttpError(404, "APPLICANT_NOT_FOUND", "Applicant not found");
	}

	const ticketAmountCents = existing.ticketAmountCents ?? 0;
	if (ticketAmountCents <= 0) {
		throw new HttpError(
			400,
			TRAVEL_ERROR_CODES.VALIDATION_ERROR,
			"Ticket amount must be set before raising an invoice.",
		);
	}

	const invoice = await createInvoice({
		data: {
			applicantName: applicant.name,
			applicantEmail: applicant.email ?? undefined,
			clientUserId: applicant.userId ?? undefined,
			applicationId: existing.applicationId,
			type: "travel",
			status: "issued",
			lines: [
				{
					label: "Flight ticket",
					detail: "Airline fare per approved quote",
					amountCents: ticketAmountCents,
				},
			],
			note: existing.opsNote ?? undefined,
		},
		actor: input.actor,
	});

	const [updated] = await db
		.update(travelAssistanceRequests)
		.set({
			invoiceId: invoice.id,
			status: "invoiced",
			updatedAt: new Date(),
		})
		.where(eq(travelAssistanceRequests.id, existing.id))
		.returning();
	return serialize(updated);
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
	if (existing.status !== "invoiced") {
		throw new HttpError(
			409,
			TRAVEL_ERROR_CODES.NOT_APPROVED,
			"Booking can only be recorded after the ticket invoice is raised.",
		);
	}

	const [updated] = await db
		.update(travelAssistanceRequests)
		.set({
			bookingConfirmation: {
				confirmationCode: input.booking.confirmationCode?.trim() || undefined,
				carrier: input.booking.carrier?.trim() || undefined,
				notes: input.booking.notes?.trim() || undefined,
			},
			status: "booked",
			updatedAt: new Date(),
		})
		.where(eq(travelAssistanceRequests.id, existing.id))
		.returning();

	// Notify the applicant that their booking is confirmed.
	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.id, existing.applicantId))
		.limit(1);
	if (applicant?.userId) {
		notify({
			recipientUserId: applicant.userId,
			type: "stage.changed",
			title: "Flight booking confirmed",
			body: "Your flight has been booked. Check your travel assistance page for the confirmation details.",
			link: "/portal/travel-assistance",
		}).catch(() => {});
	}

	return serialize(updated);
}

/** Ops updates the internal 12-item pre-departure checklist. */
export async function updateOpsChecklist(input: {
	requestId: string;
	checklist: TravelAssistanceChecklistInput["checklist"];
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

	const [updated] = await db
		.update(travelAssistanceRequests)
		.set({
			opsChecklist: input.checklist,
			updatedAt: new Date(),
		})
		.where(eq(travelAssistanceRequests.id, existing.id))
		.returning();
	return serialize(updated);
}
