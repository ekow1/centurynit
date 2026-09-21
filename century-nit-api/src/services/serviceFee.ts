import { and, asc, eq, ne, desc, sql } from "drizzle-orm";
import {
	isFullScope,
	milestoneLines,
	SERVICE_STAGES,
	type Quote,
	postArrivalInstalments,
	postArrivalScheduleChoiceSchema,
	type DueTrigger,
	type PostArrivalFrequency,
	type PostArrivalScheduleChoice,
	POST_ARRIVAL_FREQUENCY_LABELS,
} from "century-nit-shared";
import { AGENCY_STAGES } from "century-nit-core/content";
import { db } from "../db/index.js";
import { applicants, applications, caseComments, invoiceLines, invoicePayments, invoices, travelAssistanceRequests } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { exchangeRate, milestoneSplit, postArrivalCatalogue } from "./fees.js";
import { nextUncoveredDueAt } from "./invoice.js";
import { cancelQueued, queueEmail, queueReminder } from "../worker/queues.js";
import { emailLayout } from "../lib/email-templates.js";
import { instalmentDueForClient } from "./notifications.js";
import { formatGhs, formatUsd } from "./receiptEmail.js";
import { emitDomain } from "../worker/pubsub.js";
import { env } from "../env.js";

type Actor = { opsUserId?: string | null; name: string };

/** A schedule change moves screens on both sides — ops refetches, the portal re-syncs. */
async function broadcastScheduleChange(applicationId: string): Promise<void> {
	try {
		const [row] = await db
			.select({ app: applications, userId: applicants.userId })
			.from(applications)
			.innerJoin(applicants, eq(applications.applicantId, applicants.id))
			.where(eq(applications.id, applicationId))
			.limit(1);
		if (!row) return;
		emitDomain(
			"case.updated",
			{ caseId: row.app.id, appNumber: row.app.appNumber, stage: row.app.stage, postArrivalStatus: row.app.postArrivalStatus },
			{ ops: true, userId: row.userId ?? null },
		);
	} catch (err) {
		console.warn("[serviceFee] Failed to broadcast schedule change:", err);
	}
}

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
 * The lines a full-journey plan wants, from the configured split. The full
 * plan is the deposit and the balance; instalments are the deposit, the
 * pre-departure milestone and the post-arrival remainder (one line until
 * scheduled). A partial scope has no plan shape — its lines are its stages.
 */
export async function planLines(subtotalCents: number, planId: string | null): Promise<{ position: number; label: string; detail: string; amountCents: number; dueOn: DueTrigger }[]> {
	const split = await milestoneSplit();
	const quote: Quote = { scope: [...SERVICE_STAGES], full: true, stageLines: [], alaCarteCents: subtotalCents, bundleDiscountCents: 0, totalCents: subtotalCents };
	return milestoneLines(quote, split, planId).map(({ stage: _stage, ...l }) => l);
}

/**
 * The plan was chosen (or changed): reshape the unpaid part of the agency
 * invoice to match. Only while nothing beyond the deposit has been paid —
 * after that the lines are the record and the plan cannot move. Only a
 * full-journey invoice raised as one has a plan shape: a partial scope, or
 * a plan that grew stage by stage, keeps its stage lines.
 */
export async function reshapeAgencyInvoiceForPlan(applicationId: string, planId: string): Promise<void> {
	const inv = await liveAgencyInvoice(applicationId);
	if (!inv) return;
	const [app] = await db.select({ scopeStages: applications.scopeStages }).from(applications).where(eq(applications.id, applicationId)).limit(1);
	if (app && app.scopeStages && !isFullScope(app.scopeStages)) return;
	const { lines, paidCents } = await linesAndPaid(inv.id);
	if (lines.some((l) => l.dueOn === "offer" || l.dueOn === "visa_open")) return;
	const deposit = lines[0]?.amountCents ?? 0;
	if (lines.length > 0 && paidCents > deposit) return;
	const wanted = await planLines(inv.subtotalCents, planId);
	const acceptedAt = lines[0]?.dueAt ?? new Date();
	await db.transaction(async (tx) => {
		await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
		await tx.insert(invoiceLines).values(wanted.map((l) => ({ invoiceId: inv.id, ...l, dueAt: l.dueOn === "acceptance" ? acceptedAt : null })));
	});
	await refreshInvoiceDueAt(inv.id);
}

/**
 * A case event that makes a milestone due — the first offer, the visa
 * file opening, the visa approval, the arrival. Stamps `dueAt` on the
 * live agency invoice's matching lines (once) and moves the invoice's own
 * due date to the earliest unpaid one, which is what "overdue" reads.
 */
export async function fireDueTrigger(applicationId: string, trigger: DueTrigger): Promise<void> {
	const inv = await liveAgencyInvoice(applicationId);
	if (!inv) return;
	await db
		.update(invoiceLines)
		.set({ dueAt: new Date() })
		.where(and(eq(invoiceLines.invoiceId, inv.id), eq(invoiceLines.dueOn, trigger), sql`${invoiceLines.dueAt} IS NULL`));
	await refreshInvoiceDueAt(inv.id);
}

/**
 * The invoice falls due when its first unpaid dated line does. Payments
 * cover lines in position order, so the invoice's due date is the earliest
 * `dueAt` among the lines the payments have not yet reached.
 */
export async function refreshInvoiceDueAt(invoiceId: string): Promise<void> {
	const { paidCents } = await linesAndPaid(invoiceId);
	const due = await nextUncoveredDueAt(invoiceId, paidCents);
	await db.update(invoices).set({ dueAt: due, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
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
 * remainder. Validated against the catalogue; refused once an approved
 * plan stands. The pick is a *request* — it does not touch the invoice.
 * Finance or a manager enters the start date and approves; only then do
 * the dated instalment lines appear.
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
	if (app.postArrivalStatus === "approved") {
		throw new HttpError(409, "SCHEDULE_LOCKED", "The post-arrival plan is approved — it can no longer change.");
	}
	await db
		.update(applications)
		.set({
			postArrivalMonths: choice.months,
			postArrivalFrequency: choice.frequency,
			postArrivalChosenAt: new Date(),
			postArrivalStatus: "pending",
			postArrivalStartAt: null,
			postArrivalReviewedBy: null,
			postArrivalReviewedAt: null,
			postArrivalDeclineReason: null,
			postArrivalInterestPct: null,
			updatedAt: new Date(),
		})
		.where(eq(applications.id, app.id));
	await collapsePostArrivalTail(app.id);
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: app.id,
		kind: "status",
		text: `Post-arrival schedule requested: ${choice.months} months, ${POST_ARRIVAL_FREQUENCY_LABELS[choice.frequency].toLowerCase()} — awaiting finance/manager approval${input.reason ? ` (${input.reason})` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId ?? null,
	});
	await broadcastScheduleChange(app.id);
}

/**
 * A pending request becomes the contractual plan: the start date is
 * entered by finance/manager (the system never picks it), the catalogue's
 * flat interest is priced in and frozen on the row, and the invoice's
 * remainder becomes one dated line per instalment through the end.
 */
export async function approvePostArrivalSchedule(input: {
	applicationId: string;
	startAt: string;
	actor: Actor;
}): Promise<void> {
	const startAt = new Date(input.startAt);
	if (Number.isNaN(startAt.getTime())) {
		throw new HttpError(400, "START_DATE_REQUIRED", "Enter a valid start date for the plan.");
	}
	const [app] = await db.select().from(applications).where(eq(applications.id, input.applicationId)).limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	if (app.postArrivalStatus !== "pending" || !app.postArrivalMonths || !app.postArrivalFrequency) {
		throw new HttpError(409, "SCHEDULE_NOT_PENDING", "There is no schedule request waiting for approval.");
	}
	const catalogue = await postArrivalCatalogue();
	const interestPct = catalogue.interestPct;
	await db
		.update(applications)
		.set({
			postArrivalStatus: "approved",
			postArrivalStartAt: startAt,
			postArrivalInterestPct: interestPct,
			postArrivalReviewedBy: input.actor.name,
			postArrivalReviewedAt: new Date(),
			postArrivalDeclineReason: null,
			updatedAt: new Date(),
		})
		.where(eq(applications.id, app.id));
	await rewritePostArrivalLines(app.id);
	const freq = POST_ARRIVAL_FREQUENCY_LABELS[app.postArrivalFrequency as PostArrivalFrequency].toLowerCase();
	const start = startAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: app.id,
		kind: "status",
		text: `Post-arrival plan approved — ${app.postArrivalMonths} months, ${freq}, starting ${start}${interestPct > 0 ? `, ${interestPct}% interest on the remainder` : ""}.`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId ?? null,
	});
	await notifyScheduleReviewed(app.id, "approved").catch(() => {});
	await broadcastScheduleChange(app.id);
}

/** Decline the pending request; the client can pick again. */
export async function declinePostArrivalSchedule(input: {
	applicationId: string;
	reason: string;
	actor: Actor;
}): Promise<void> {
	const [app] = await db.select().from(applications).where(eq(applications.id, input.applicationId)).limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	if (app.postArrivalStatus !== "pending") {
		throw new HttpError(409, "SCHEDULE_NOT_PENDING", "There is no schedule request waiting for review.");
	}
	await db
		.update(applications)
		.set({
			postArrivalStatus: "declined",
			postArrivalReviewedBy: input.actor.name,
			postArrivalReviewedAt: new Date(),
			postArrivalDeclineReason: input.reason,
			updatedAt: new Date(),
		})
		.where(eq(applications.id, app.id));
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: app.id,
		kind: "status",
		text: `Post-arrival plan declined — ${input.reason}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId ?? null,
	});
	await notifyScheduleReviewed(app.id, "declined").catch(() => {});
	await broadcastScheduleChange(app.id);
}

/**
 * While a request is pending or declined the remainder is a single undated
 * line — nothing looks payable on a schedule nobody has approved.
 */
async function collapsePostArrivalTail(applicationId: string): Promise<void> {
	const inv = await liveAgencyInvoice(applicationId);
	if (!inv) return;
	const { lines, paidCents } = await linesAndPaid(inv.id);
	const head = lines.slice(0, 2);
	const tail = lines.slice(2);
	if (tail.length === 0) return;
	const headCents = head.reduce((n, l) => n + l.amountCents, 0);
	if (paidCents > headCents) {
		throw new HttpError(409, "SCHEDULE_LOCKED", "An instalment has already been paid — the schedule can no longer change.");
	}
	const remainderCents = tail.reduce((n, l) => n + l.amountCents, 0);
	await db.transaction(async (tx) => {
		for (const l of tail) await tx.delete(invoiceLines).where(eq(invoiceLines.id, l.id));
		await tx.insert(invoiceLines).values({
			invoiceId: inv.id,
			position: head.length,
			label: AGENCY_STAGES[2].label,
			detail: "A payment schedule is under review — dates appear once approved",
			amountCents: remainderCents,
			dueAt: null,
			dueOn: "arrival",
		});
	});
	await refreshInvoiceDueAt(inv.id);
}

/** Tell the client their schedule was approved or declined. */
async function notifyScheduleReviewed(applicationId: string, outcome: "approved" | "declined"): Promise<void> {
	const [who] = await db
		.select({ name: applicants.name, email: applicants.email, declineReason: applications.postArrivalDeclineReason })
		.from(applications)
		.innerJoin(applicants, eq(applications.applicantId, applicants.id))
		.where(eq(applications.id, applicationId))
		.limit(1);
	if (!who?.email) return;
	const portalUrl = `${env.FRONTEND_URL}/portal/financial`;
	const title = outcome === "approved" ? "Your payment plan is set" : "Your payment plan request was declined";
	const body =
		outcome === "approved"
			? `<p>Hi ${who.name ?? "there"},</p><p>The office has approved your post-arrival payment schedule — your dated instalments are now on your Payments page.</p><p><a href="${portalUrl}">View your payment plan →</a></p>`
			: `<p>Hi ${who.name ?? "there"},</p><p>The office couldn't approve the payment schedule you requested${who.declineReason ? ` — <i>${who.declineReason}</i>` : ""}. You can pick a different schedule on your Payments page.</p><p><a href="${portalUrl}">Review your options →</a></p>`;
	await queueEmail({
		to: who.email,
		subject: title,
		html: emailLayout({ title, preheader: title, bodyHtml: body }),
		text: title,
		idempotencyKey: `postarrival:${outcome}:${applicationId}:${Date.now()}`,
		template: `Post-arrival ${outcome}`,
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
	// Pending and declined requests never write dated lines.
	if (app.postArrivalStatus !== "approved") return;
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
	// Approved plans anchor on the staff-entered start date — the first
	// instalment falls on it. Legacy rows approved before this flow keep the
	// old anchor (arrival, else the booked flight + a day) plus grace.
	const approved = app.postArrivalStartAt != null;
	const anchor = approved ? app.postArrivalStartAt : await postArrivalAnchor(applicationId, app.departureDetails);
	const interestPct = app.postArrivalInterestPct ?? 0;
	const plan = postArrivalInstalments({
		amountCents: remainderCents,
		months: app.postArrivalMonths,
		frequency: app.postArrivalFrequency as PostArrivalFrequency,
		anchor,
		graceDays: approved ? 0 : catalogue.graceDays,
		interestPct,
	});
	const freq = POST_ARRIVAL_FREQUENCY_LABELS[app.postArrivalFrequency as PostArrivalFrequency].toLowerCase();
	const interestNote = interestPct > 0 ? ` · incl. ${interestPct}% interest` : "";
	await db.transaction(async (tx) => {
		for (const l of tail) await tx.delete(invoiceLines).where(eq(invoiceLines.id, l.id));
		await tx.insert(invoiceLines).values(
			plan.map((p) => ({
				invoiceId: inv.id,
				position: head.length + p.n - 1,
				label: `Service fee · post-arrival ${p.n} of ${p.total}`,
				detail: `${app.postArrivalMonths} months · ${freq}${interestNote}${p.dueAt ? "" : " · dated once you arrive"}`,
				amountCents: p.amountCents,
				dueAt: p.dueAt ? new Date(p.dueAt) : null,
				dueOn: "scheduled",
			})),
		);
	});
	await refreshInvoiceDueAt(inv.id);
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
	const rate = await exchangeRate();
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
				amountGhsFormatted: `${formatGhs((line.amountCents / 100) * rate)} (${formatUsd(line.amountCents / 100)})`,
				dueAtFormatted: new Date(line.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
				payUrl: `${env.FRONTEND_URL}/portal/payment-execution`,
			}),
			sendAt,
		).catch(() => {});
	}
}

/**
 * Re-date the instalments when arrival or the booking changes the anchor.
 * Never throws. Only legacy approved plans (no staff-entered start date)
 * still re-anchor — a start date set at approval is contractual.
 */
export async function refreshPostArrivalDates(applicationId: string): Promise<void> {
	try {
		const [app] = await db
			.select({ status: applications.postArrivalStatus, startAt: applications.postArrivalStartAt })
			.from(applications)
			.where(eq(applications.id, applicationId))
			.limit(1);
		if (!app || app.status !== "approved" || app.startAt) return;
		await rewritePostArrivalLines(applicationId);
	} catch (err) {
		if (err instanceof HttpError && err.status === 409) return;
		console.warn("[serviceFee] Could not re-date the post-arrival instalments:", err);
	}
}
