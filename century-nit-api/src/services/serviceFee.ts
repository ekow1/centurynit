import { and, asc, eq, ne, desc } from "drizzle-orm";
import {
	postArrivalInstalments,
	postArrivalScheduleChoiceSchema,
	type PostArrivalFrequency,
	type PostArrivalScheduleChoice,
	POST_ARRIVAL_FREQUENCY_LABELS,
} from "century-nit-shared";
import { AGENCY_STAGES } from "century-nit-core/content";
import { db } from "../db/index.js";
import { applicants, applications, caseComments, invoiceLines, invoicePayments, invoices, travelAssistanceRequests } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { postArrivalCatalogue, serviceFeeSplit } from "./fees.js";
import { cancelQueued, queueReminder } from "../worker/queues.js";
import { instalmentDueForClient } from "./notifications.js";
import { formatGhs } from "./receiptEmail.js";
import { env } from "../env.js";

type Actor = { opsUserId?: string | null; name: string };

/**
 * The service fee as the ledger carries it: one agency invoice per case,
 * its lines the milestones — the deposit, the pre-departure milestone, and
 * the post-arrival remainder, which becomes dated instalments once the
 * client has chosen a schedule. The ledger trigger (drizzle/0073) reads the
 * flags off these lines, so everything here is a line rewrite, never a flag.
 */

/** The case's live agency invoice, newest first, never a void one. */
export async function liveAgencyInvoice(applicationId: string) {
	const [row] = await db
		.select()
		.from(invoices)
		.where(and(eq(invoices.applicationId, applicationId), eq(invoices.type, "agency"), ne(invoices.status, "void")))
		.orderBy(desc(invoices.createdAt))
		.limit(1);
	return row ?? null;
}

async function linesAndPaid(invoiceId: string) {
	const [lines, payments] = await Promise.all([
		db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.position)),
		db.select({ amountCents: invoicePayments.amountCents }).from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId)),
	]);
	const paidCents = payments.reduce((n, p) => n + p.amountCents, 0);
	return { lines, paidCents };
}

/**
 * What the client's next payment is: the first line the payments have not
 * yet covered, less whatever of it is already covered. Never the balance.
 */
export function nextChargeCents(lines: { amountCents: number }[], paidCents: number): number {
	let cum = 0;
	for (const line of lines) {
		const before = cum;
		cum += line.amountCents;
		if (paidCents < cum) return cum - Math.max(paidCents, before);
	}
	return 0;
}

/**
 * The lines a plan wants, from the configured split. The full plan is the
 * deposit and the balance; instalments are the deposit, the pre-departure
 * milestone and the post-arrival remainder (one line until scheduled).
 */
export async function planLines(subtotalCents: number, planId: string | null): Promise<{ position: number; label: string; detail: string; amountCents: number }[]> {
	const split = await serviceFeeSplit();
	const deposit = Math.round((subtotalCents * split.depositPercent) / 100);
	if (planId === "full") {
		return [
			{ position: 0, label: AGENCY_STAGES[0].label, detail: AGENCY_STAGES[0].detail, amountCents: deposit },
			{ position: 1, label: "Service fee · balance", detail: "Due after your visa is approved — releases your travel documents", amountCents: subtotalCents - deposit },
		].filter((l) => l.amountCents > 0);
	}
	const pre = Math.round((subtotalCents * split.preDeparturePercent) / 100);
	return [
		{ position: 0, label: AGENCY_STAGES[0].label, detail: AGENCY_STAGES[0].detail, amountCents: deposit },
		{ position: 1, label: AGENCY_STAGES[1].label, detail: AGENCY_STAGES[1].detail, amountCents: pre },
		{ position: 2, label: AGENCY_STAGES[2].label, detail: AGENCY_STAGES[2].detail, amountCents: subtotalCents - deposit - pre },
	].filter((l) => l.amountCents > 0);
}

/**
 * The plan was chosen (or changed): reshape the unpaid part of the agency
 * invoice to match. Only while nothing beyond the deposit has been paid —
 * after that the lines are the record and the plan cannot move.
 */
export async function reshapeAgencyInvoiceForPlan(applicationId: string, planId: string): Promise<void> {
	const inv = await liveAgencyInvoice(applicationId);
	if (!inv) return;
	const { lines, paidCents } = await linesAndPaid(inv.id);
	const deposit = lines[0]?.amountCents ?? 0;
	if (lines.length > 0 && paidCents > deposit) return;
	const wanted = await planLines(inv.subtotalCents, planId);
	await db.transaction(async (tx) => {
		await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
		await tx.insert(invoiceLines).values(wanted.map((l) => ({ invoiceId: inv.id, ...l })));
	});
}

/** When the post-arrival dates count from: arrival if recorded, else the booked flight's departure. */
async function postArrivalAnchor(applicationId: string, departureDetails: unknown): Promise<Date | null> {
	const dd = (departureDetails ?? {}) as { arrivedAt?: string | null };
	if (dd.arrivedAt) return new Date(dd.arrivedAt);
	const [ta] = await db
		.select({ booking: travelAssistanceRequests.booking, status: travelAssistanceRequests.status })
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.applicationId, applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt))
		.limit(1);
	const departAt = (ta?.booking as { departAt?: string | null } | null)?.departAt;
	if (ta?.status === "booked" && departAt) {
		const d = new Date(departAt);
		d.setUTCDate(d.getUTCDate() + 1);
		return d;
	}
	return null;
}

/**
 * The client (or ops on their behalf) chose how to spread the post-arrival
 * remainder. Validated against the catalogue; refused once any of it is
 * paid. The remainder's line(s) become one dated line per instalment, and
 * a reminder is queued ahead of each date.
 */
export async function setPostArrivalSchedule(input: {
	applicationId: string;
	choice: PostArrivalScheduleChoice;
	actor: Actor;
	/** Ops acting for the client — the reason goes on the case. */
	reason?: string | null;
}): Promise<void> {
	const choice = postArrivalScheduleChoiceSchema.parse(input.choice);
	const catalogue = await postArrivalCatalogue();
	if (!catalogue.durations.includes(choice.months)) {
		throw new HttpError(400, "SCHEDULE_NOT_OFFERED", `A ${choice.months}-month schedule is not on offer.`);
	}
	if (!catalogue.frequencies.includes(choice.frequency)) {
		throw new HttpError(400, "SCHEDULE_NOT_OFFERED", `${POST_ARRIVAL_FREQUENCY_LABELS[choice.frequency]} instalments are not on offer.`);
	}
	const [app] = await db.select().from(applications).where(eq(applications.id, input.applicationId)).limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	if (app.paymentPlanId !== "installment") {
		throw new HttpError(409, "PLAN_NOT_INSTALMENT", "A post-arrival schedule applies to the instalment plan only.");
	}
	await db
		.update(applications)
		.set({ postArrivalMonths: choice.months, postArrivalFrequency: choice.frequency, postArrivalChosenAt: new Date(), updatedAt: new Date() })
		.where(eq(applications.id, app.id));
	await rewritePostArrivalLines(app.id);
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: app.id,
		kind: "status",
		text: `Post-arrival schedule: ${choice.months} months, ${POST_ARRIVAL_FREQUENCY_LABELS[choice.frequency].toLowerCase()}${input.reason ? ` — ${input.reason}` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId ?? null,
	});
}

/**
 * Write the post-arrival instalment lines from the chosen schedule and the
 * anchor we know. Called when the schedule is chosen, when arrival is
 * recorded and when the flight is booked, so the dates settle as the facts
 * arrive. Leaves paid instalments alone; refuses to reshape money already
 * paid into the remainder.
 */
export async function rewritePostArrivalLines(applicationId: string): Promise<void> {
	const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
	if (!app || app.paymentPlanId !== "installment" || !app.postArrivalMonths || !app.postArrivalFrequency) return;
	const inv = await liveAgencyInvoice(applicationId);
	if (!inv) return;
	const { lines, paidCents } = await linesAndPaid(inv.id);
	// The remainder is everything after the first two milestones.
	const head = lines.slice(0, 2);
	const tail = lines.slice(2);
	const headCents = head.reduce((n, l) => n + l.amountCents, 0);
	const remainderCents = tail.reduce((n, l) => n + l.amountCents, 0);
	if (remainderCents <= 0) return;
	if (paidCents > headCents) {
		throw new HttpError(409, "SCHEDULE_LOCKED", "An instalment has already been paid — the schedule can no longer change.");
	}
	const catalogue = await postArrivalCatalogue();
	const anchor = await postArrivalAnchor(applicationId, app.departureDetails);
	const plan = postArrivalInstalments({
		amountCents: remainderCents,
		months: app.postArrivalMonths,
		frequency: app.postArrivalFrequency as PostArrivalFrequency,
		anchor,
		graceDays: catalogue.graceDays,
	});
	const freq = POST_ARRIVAL_FREQUENCY_LABELS[app.postArrivalFrequency as PostArrivalFrequency].toLowerCase();
	await db.transaction(async (tx) => {
		for (const l of tail) await tx.delete(invoiceLines).where(eq(invoiceLines.id, l.id));
		await tx.insert(invoiceLines).values(
			plan.map((p) => ({
				invoiceId: inv.id,
				position: head.length + p.n - 1,
				label: `Service fee · post-arrival ${p.n} of ${p.total}`,
				detail: `${app.postArrivalMonths} months · ${freq}${p.dueAt ? "" : " · dated once you arrive"}`,
				amountCents: p.amountCents,
				dueAt: p.dueAt ? new Date(p.dueAt) : null,
			})),
		);
	});
	await queueInstalmentReminders(applicationId, inv.id, inv.invoiceNumber, catalogue.remindDays);
}

/** A reminder ahead of each dated, unpaid instalment; earlier ones are replaced. */
async function queueInstalmentReminders(applicationId: string, invoiceId: string, invoiceNumber: string, remindDays: number): Promise<void> {
	const [who] = await db
		.select({ name: applicants.name, email: applicants.email })
		.from(applications)
		.innerJoin(applicants, eq(applications.applicantId, applicants.id))
		.where(eq(applications.id, applicationId))
		.limit(1);
	if (!who?.email) return;
	const { lines, paidCents } = await linesAndPaid(invoiceId);
	let cum = 0;
	for (const line of lines) {
		cum += line.amountCents;
		const key = `instalment:due:${invoiceId}:${line.position}`;
		await cancelQueued(key).catch(() => {});
		if (!line.dueAt || paidCents >= cum) continue;
		const sendAt = new Date(line.dueAt);
		sendAt.setUTCDate(sendAt.getUTCDate() - remindDays);
		await queueReminder(
			instalmentDueForClient({
				idempotencyKey: key,
				clientName: who.name ?? "there",
				clientEmail: who.email,
				invoiceNumber,
				lineLabel: line.label,
				amountGhsFormatted: formatGhs(line.amountCents),
				dueAtFormatted: new Date(line.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
				payUrl: `${env.FRONTEND_URL}/portal/payment-execution`,
			}),
			sendAt,
		).catch(() => {});
	}
}

/** Re-date the instalments when arrival or the booking changes the anchor. Never throws. */
export async function refreshPostArrivalDates(applicationId: string): Promise<void> {
	try {
		await rewritePostArrivalLines(applicationId);
	} catch (err) {
		if (err instanceof HttpError && err.status === 409) return;
		console.warn("[serviceFee] Could not re-date the post-arrival instalments:", err);
	}
}
