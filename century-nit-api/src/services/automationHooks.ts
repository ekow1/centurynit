import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { applicants, applications, invoices } from "../db/schema.js";
import { emitAutomationEvent } from "./marketing.js";

/**
 * Automation event sources — the moments the six starters hang off.
 *
 * Instant events are fired from the service that owns the moment (visa
 * approval, offer decision, booking no-show, assessment completion): the
 * automation's own delay handles the "3 days later" part, so a client who
 * enrols on day 2 simply fails the segment check at send time.
 *
 * `runAutomationDateTriggers` is the daily half — moments defined by a
 * date, not an action: 30 days to departure, an invoice 3 days overdue.
 * Each firing keys on the entity + day so the dedupe ledger makes a daily
 * rescan idempotent.
 */

/** Resolve the applicant behind a case and fire the automation event. */
export async function emitForApplication(event: string, applicationId: string): Promise<void> {
	try {
		const [row] = await db
			.select({ email: applicants.email, name: applicants.name })
			.from(applications)
			.innerJoin(applicants, eq(applicants.id, applications.applicantId))
			.where(eq(applications.id, applicationId))
			.limit(1);
		if (!row?.email) return;
		await emitAutomationEvent(event, `app:${applicationId}`, [{ email: row.email, name: row.name }]);
	} catch (err) {
		console.warn(`[automations] ${event} for ${applicationId} failed:`, err);
	}
}

/** The visa approval moment — cases.ts fires this once, on the transition. */
export const visaApproved = (applicationId: string) => emitForApplication("visa.approved", applicationId);

/** An offer landed — schools.ts fires when a decision reads Admitted. */
export const offerReceived = (applicationId: string) => emitForApplication("offer.received", applicationId);

/** A booking was marked no-show — the lead/Client never arrived. */
export async function bookingNoShow(bookingId: string, email: string, name: string | null): Promise<void> {
	try {
		await emitAutomationEvent("booking.no_show", `booking:${bookingId}`, [{ email, name }]);
	} catch (err) {
		console.warn(`[automations] booking.no_show for ${email} failed:`, err);
	}
}

/**
 * The assessment-complete moment. consultations.ts fires this when the
 * consultant submits the assessment — the automation's delay is what makes
 * it a "day 3 / day 10" nudge, and the segment drops anyone who enrols
 * before the send lands.
 */
export async function assessmentCompleted(email: string, name: string | null, key: string): Promise<void> {
	try {
		await emitAutomationEvent("assessment.completed", `assess:${key}`, [{ email, name }]);
	} catch (err) {
		console.warn(`[automations] assessment.completed for ${email} failed:`, err);
	}
}

/**
 * Daily scan for date-defined moments. Trigger keys carry the day so one
 * firing per entity per day, and the automation_sends unique constraint
 * dedupes a re-run on the same day.
 */
export async function runAutomationDateTriggers(): Promise<{ departures: number; overdue: number }> {
	const today = new Date().toISOString().slice(0, 10);

	// Departure −30: applications whose report-by is 29–31 days out.
	const departures = await db
		.select({ id: applications.id, email: applicants.email, name: applicants.name })
		.from(applications)
		.innerJoin(applicants, eq(applicants.id, applications.applicantId))
		.where(
			and(
				sql`${applications.departureDetails}->>'reportBy' is not null`,
				sql`(${applications.departureDetails}->>'reportBy')::timestamptz between now() + interval '29 days' and now() + interval '31 days'`,
			),
		);
	for (const r of departures) {
		await emitAutomationEvent("departure.minus_30", `dep:${r.id}:${today}`, [{ email: r.email, name: r.name }]);
	}

	// Invoice overdue day 3: issued/partial invoices whose due date passed
	// ~3 days ago (a 1-day window so the daily scan catches each once).
	const overdue = await db
		.select({ id: invoices.id, email: invoices.applicantEmail, name: invoices.applicantName })
		.from(invoices)
		.where(
			and(
				isNotNull(invoices.dueAt),
				inArray(invoices.status, ["issued", "partial"]),
				sql`${invoices.dueAt} between now() - interval '3.5 days' and now() - interval '2.5 days'`,
			),
		);
	for (const r of overdue) {
		if (r.email) await emitAutomationEvent("invoice.overdue", `inv:${r.id}:${today}`, [{ email: r.email, name: r.name }]);
	}

	return { departures: departures.length, overdue: overdue.length };
}
