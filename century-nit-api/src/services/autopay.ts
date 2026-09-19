import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	applications,
	autopayAttempts,
	invoiceLines,
	invoicePayments,
	invoices,
	opsUsers,
	paymentAuthorizations,
	paymentTransactions,
	users,
} from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { emailLayout } from "../lib/email-templates.js";
import { queueEmail } from "../worker/queues.js";
import { getSetting } from "./settings.js";
import { getExchangeRate } from "./paymentSettlement.js";
import { formatGhs, formatUsd } from "./receiptEmail.js";

/**
 * Auto-pay — charging a client's saved card when an instalment line falls
 * due.
 *
 * How it works:
 *   1. A successful card payment returns a reusable Paystack authorization;
 *      `captureAuthorization` stores it (Mobile Money authorizations are not
 *      reusable and are never stored).
 *   2. The client opts in — `active` is their consent. Nothing is charged
 *      while it is off.
 *   3. `runAutoPaySweep` (a daily BullMQ job) walks invoice lines whose
 *      `dueAt` has passed on issued invoices, and for each unpaid due line
 *      calls `charge_authorization`. A success settles through the same
 *      `verifyAndSettlePayment` path a checkout payment takes — the webhook
 *      and SSE fan-out behave identically. A failure is logged on
 *      `autopay_attempts` and the client is emailed once per attempt; the
 *      line retries after `RETRY_DAYS`.
 *   4. The sweep is bound to the invoice's own schedule: when the last line
 *      is covered there is nothing left to charge, and auto-pay simply has
 *      no work. A new invoice starts a new schedule.
 */

/** Days between a failed debit and the next attempt. */
const RETRY_DAYS = 3;
/** Days of failed retries before the line escalates to the case handler. */
const ESCALATE_DAYS = 10;

export type PaystackAuthorization = {
	authorization_code?: string;
	bin?: string;
	last4?: string;
	exp_month?: string;
	exp_year?: string;
	channel?: string;
	card_type?: string;
	bank?: string;
	brand?: string;
	reusable?: boolean;
};

/** Persist a reusable card authorization after a successful payment. Never throws. */
export async function captureAuthorization(
	userId: string | null | undefined,
	email: string | null | undefined,
	authorization: PaystackAuthorization | null | undefined,
): Promise<void> {
	try {
		if (!userId || !email || !authorization?.reusable || !authorization.authorization_code) return;
		if (authorization.channel && authorization.channel !== "card") return;
		await db
			.insert(paymentAuthorizations)
			.values({
				userId,
				email,
				authorizationCode: authorization.authorization_code,
				cardBrand: authorization.brand ?? authorization.card_type ?? null,
				cardLast4: authorization.last4 ?? null,
				bank: authorization.bank ?? null,
				expMonth: authorization.exp_month ?? null,
				expYear: authorization.exp_year ?? null,
			})
			.onConflictDoUpdate({
				target: [paymentAuthorizations.userId, paymentAuthorizations.authorizationCode],
				set: {
					email,
					cardBrand: authorization.brand ?? authorization.card_type ?? null,
					cardLast4: authorization.last4 ?? null,
					bank: authorization.bank ?? null,
					expMonth: authorization.exp_month ?? null,
					expYear: authorization.exp_year ?? null,
					updatedAt: new Date(),
				},
			});
	} catch (err) {
		console.warn("[autopay] could not store the card authorization:", err);
	}
}

/** What the portal shows: whether a card is on file, whether auto-pay is on,
 * and the latest failed debit (drives the portal banner). */
export async function getAutoPay(userId: string): Promise<{
	available: boolean;
	active: boolean;
	card: { brand: string | null; last4: string | null; bank: string | null } | null;
	lastFailure: {
		label: string;
		amountCents: number;
		reason: string | null;
		retryAt: string;
	} | null;
}> {
	const [auth] = await db
		.select()
		.from(paymentAuthorizations)
		.where(eq(paymentAuthorizations.userId, userId))
		.orderBy(desc(paymentAuthorizations.createdAt))
		.limit(1);
	let lastFailure: {
		label: string;
		amountCents: number;
		reason: string | null;
		retryAt: string;
	} | null = null;
	if (auth?.active) {
		const [fail] = await db
			.select({ a: autopayAttempts, label: invoiceLines.label })
			.from(autopayAttempts)
			.innerJoin(invoiceLines, eq(autopayAttempts.invoiceLineId, invoiceLines.id))
			.innerJoin(invoices, eq(autopayAttempts.invoiceId, invoices.id))
			.where(
				and(
					eq(autopayAttempts.authorizationId, auth.id),
					eq(autopayAttempts.status, "failed"),
					eq(invoices.clientUserId, userId),
				),
			)
			.orderBy(desc(autopayAttempts.attemptedAt))
			.limit(1);
		if (fail) {
			// Don't banner a line that's since been covered by another payment.
			const allLines = await db
				.select({ position: invoiceLines.position, amountCents: invoiceLines.amountCents })
				.from(invoiceLines)
				.where(eq(invoiceLines.invoiceId, fail.a.invoiceId));
			const payments = await db
				.select({ amountCents: invoicePayments.amountCents })
				.from(invoicePayments)
				.where(eq(invoicePayments.invoiceId, fail.a.invoiceId));
			const paidCents = payments.reduce((n, p) => n + p.amountCents, 0);
			const [line] = await db
				.select({ position: invoiceLines.position })
				.from(invoiceLines)
				.where(eq(invoiceLines.id, fail.a.invoiceLineId))
				.limit(1);
			const remaining = line ? lineDueCents(allLines, paidCents, line.position) : 0;
			if (remaining > 0) {
				lastFailure = {
					label: fail.label,
					amountCents: Math.min(remaining, fail.a.amountCents),
					reason: fail.a.failureReason,
					retryAt: new Date(fail.a.attemptedAt.getTime() + RETRY_DAYS * 86_400_000).toISOString(),
				};
			}
		}
	}
	return {
		available: Boolean(auth),
		active: auth?.active ?? false,
		card: auth ? { brand: auth.cardBrand, last4: auth.cardLast4, bank: auth.bank } : null,
		lastFailure,
	};
}

/** The client's consent toggle. Enabling requires a card already on file. */
export async function setAutoPay(userId: string, enabled: boolean) {
	const [auth] = await db
		.select()
		.from(paymentAuthorizations)
		.where(eq(paymentAuthorizations.userId, userId))
		.orderBy(desc(paymentAuthorizations.createdAt))
		.limit(1);
	if (!auth) {
		throw new HttpError(400, "NO_CARD_ON_FILE", "Auto-pay needs a card — pay once by card and it can be charged automatically.");
	}
	const [updated] = await db
		.update(paymentAuthorizations)
		.set({ active: enabled, consentedAt: enabled ? (auth.consentedAt ?? new Date()) : null, updatedAt: new Date() })
		.where(eq(paymentAuthorizations.id, auth.id))
		.returning();
	return getAutoPay(updated.userId);
}

type DueLine = {
	line: typeof invoiceLines.$inferSelect;
	invoice: typeof invoices.$inferSelect;
};

/** The due, unpaid invoice lines on issued invoices — the sweep's workload. */
async function dueLines(now: Date): Promise<DueLine[]> {
	return db
		.select({ line: invoiceLines, invoice: invoices })
		.from(invoiceLines)
		.innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
		.where(and(isNotNull(invoiceLines.dueAt), lte(invoiceLines.dueAt, now), eq(invoices.status, "issued")));
}

/** How much of one line is still unpaid, given cumulative coverage. */
function lineDueCents(lines: { position: number; amountCents: number }[], paidCents: number, position: number): number {
	let cum = 0;
	for (const l of [...lines].sort((a, b) => a.position - b.position)) {
		cum += l.amountCents;
		if (l.position === position) return Math.max(0, cum - paidCents);
	}
	return 0;
}

async function lastAttempt(lineId: string) {
	// Only real charge attempts drive the retry cadence — an "escalated"
	// marker row must not reset the window.
	const [a] = await db
		.select()
		.from(autopayAttempts)
		.where(
			and(
				eq(autopayAttempts.invoiceLineId, lineId),
				inArray(autopayAttempts.status, ["success", "failed"]),
			),
		)
		.orderBy(desc(autopayAttempts.attemptedAt))
		.limit(1);
	return a ?? null;
}

/** First failed attempt on a line — the escalation clock starts here. */
async function firstFailure(lineId: string) {
	const [a] = await db
		.select()
		.from(autopayAttempts)
		.where(
			and(
				eq(autopayAttempts.invoiceLineId, lineId),
				eq(autopayAttempts.status, "failed"),
			),
		)
		.orderBy(autopayAttempts.attemptedAt)
		.limit(1);
	return a ?? null;
}

async function alreadyEscalated(lineId: string): Promise<boolean> {
	const [a] = await db
		.select({ id: autopayAttempts.id })
		.from(autopayAttempts)
		.where(
			and(
				eq(autopayAttempts.invoiceLineId, lineId),
				eq(autopayAttempts.status, "escalated"),
			),
		)
		.limit(1);
	return Boolean(a);
}

async function chargeAuthorization(input: {
	secret: string;
	email: string;
	amountGhsPesewas: number;
	authorizationCode: string;
	reference: string;
	invoiceId: string;
	lineId: string;
}): Promise<{ ok: boolean; reason: string | null }> {
	const res = await fetch("https://api.paystack.co/transaction/charge_authorization", {
		method: "POST",
		headers: { Authorization: `Bearer ${input.secret}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			email: input.email,
			amount: input.amountGhsPesewas,
			authorization_code: input.authorizationCode,
			reference: input.reference,
			metadata: { invoice_id: input.invoiceId, invoice_line_id: input.lineId, auto_pay: true },
		}),
	});
	const data = (await res.json().catch(() => null)) as {
		status?: boolean;
		message?: string;
		data?: { status?: string; gateway_response?: string };
	} | null;
	if (!res.ok || !data?.status || data.data?.status !== "success") {
		return { ok: false, reason: data?.data?.gateway_response ?? data?.message ?? `HTTP ${res.status}` };
	}
	return { ok: true, reason: null };
}

function failureEmail(input: { name: string; amountGhs: string; card: string; retryOn: string }): { html: string; text: string } {
	const body = `
		<p style="margin:0 0 16px">Hi ${input.name},</p>
		<p style="margin:0 0 16px">Your instalment of <strong>${input.amountGhs}</strong> was due, but the charge on ${input.card} did not go through.</p>
		<p style="margin:0 0 16px">We will try the card once more on <strong>${input.retryOn}</strong>. To pay now — or pay another way (MoMo, another card, bank transfer) — use your payment page:</p>
		<p style="margin:24px 0"><a href="${env.FRONTEND_URL}/portal/payment-execution" style="display:inline-block;background:#000000;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold">Pay now</a></p>
		<p style="margin:0">Questions? Reply to this email — it reaches your consultant.</p>`;
	const html = emailLayout({ title: "We couldn't charge your card", preheader: `${input.amountGhs} instalment — card declined`, bodyHtml: body });
	const text = `Hi ${input.name}, your instalment of ${input.amountGhs} was due but the charge on ${input.card} did not go through. We will try the card once more on ${input.retryOn}. Pay now or another way: ${env.FRONTEND_URL}/portal/payment-execution — Questions? Reply to this email.`;
	return { html, text };
}

function escalationEmail(input: { name: string; amountGhs: string; handlerName: string | null }): { html: string; text: string } {
	const who = input.handlerName ? `${input.handlerName}, your consultant,` : "Your consultant";
	const body = `
		<p style="margin:0 0 16px">Hi ${input.name},</p>
		<p style="margin:0 0 16px">Your instalment of <strong>${input.amountGhs}</strong> is still unpaid after several card attempts. ${who} has been notified and will follow up with you.</p>
		<p style="margin:0 0 16px">If the card on file can't take the payment, you can pay another way — Mobile Money, a different card, or bank transfer:</p>
		<p style="margin:24px 0"><a href="${env.FRONTEND_URL}/portal/payment-execution" style="display:inline-block;background:#000000;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold">Pay another way</a></p>
		<p style="margin:0">Questions? Reply to this email — it reaches your consultant.</p>`;
	const html = emailLayout({ title: "Your instalment is overdue", preheader: `${input.amountGhs} — still unpaid`, bodyHtml: body });
	const text = `Hi ${input.name}, your instalment of ${input.amountGhs} is still unpaid after several card attempts. ${who} has been notified. Pay another way: ${env.FRONTEND_URL}/portal/payment-execution`;
	return { html, text };
}

/**
 * The daily sweep. Charges every due, unpaid instalment line on an issued
 * invoice where the client has auto-pay on. Returns a small run summary the
 * worker logs.
 */
export async function runAutoPaySweep(now = new Date()): Promise<{ charged: number; failed: number; skipped: number }> {
	const secret = await getSetting("PAYSTACK_SECRET_KEY");
	if (!secret) {
		console.warn("[autopay] PAYSTACK_SECRET_KEY unset — sweep skipped");
		return { charged: 0, failed: 0, skipped: 0 };
	}
	const rate = await getExchangeRate();
	const due = await dueLines(now);
	let charged = 0;
	let failed = 0;
	let skipped = 0;

	// Group by invoice so one invoice's lines are walked in order.
	const byInvoice = new Map<string, DueLine[]>();
	for (const d of due) {
		const list = byInvoice.get(d.invoice.id) ?? [];
		list.push(d);
		byInvoice.set(d.invoice.id, list);
	}

	for (const [invoiceId, rows] of byInvoice) {
		const invoice = rows[0].invoice;
		if (!invoice.clientUserId) {
			skipped += rows.length;
			continue;
		}
		const [auth] = await db
			.select()
			.from(paymentAuthorizations)
			.where(and(eq(paymentAuthorizations.userId, invoice.clientUserId), eq(paymentAuthorizations.active, true)))
			.orderBy(desc(paymentAuthorizations.createdAt))
			.limit(1);
		if (!auth) {
			skipped += rows.length;
			continue;
		}
		const [client] = await db.select({ name: users.name }).from(users).where(eq(users.id, invoice.clientUserId)).limit(1);

		// Payments cover the lines in order; a paid line never re-charges.
		const allLines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
		const payments = await db
			.select({ amountCents: invoicePayments.amountCents })
			.from(invoicePayments)
			.where(eq(invoicePayments.invoiceId, invoiceId));
		let paidCents = payments.reduce((n, p) => n + p.amountCents, 0);

		for (const { line } of rows.sort((a, b) => a.line.position - b.line.position)) {
			const amountCents = Math.min(lineDueCents(allLines, paidCents, line.position), invoice.subtotalCents - invoice.creditedCents - paidCents);
			if (amountCents <= 0) continue;

			// Escalation — a line still unpaid ESCALATE_DAYS after its first
			// failed debit goes to the case handler once, while retries continue.
			const first = await firstFailure(line.id);
			if (first && now.getTime() - first.attemptedAt.getTime() >= ESCALATE_DAYS * 86_400_000 && !(await alreadyEscalated(line.id))) {
				await db.insert(autopayAttempts).values({
					invoiceLineId: line.id,
					authorizationId: auth.id,
					invoiceId,
					amountCents,
					status: "escalated",
				});
				let handlerEmail: string | null = null;
				let handlerName: string | null = null;
				if (invoice.applicationId) {
					const [app] = await db
						.select({ assignedStaffId: applications.assignedStaffId })
						.from(applications)
						.where(eq(applications.id, invoice.applicationId))
						.limit(1);
					if (app?.assignedStaffId) {
						const [staff] = await db
							.select({ email: opsUsers.email, name: opsUsers.name })
							.from(opsUsers)
							.where(eq(opsUsers.id, app.assignedStaffId))
							.limit(1);
						handlerEmail = staff?.email ?? null;
						handlerName = staff?.name ?? null;
					}
				}
				const amountGhs = `${formatGhs((amountCents / 100) * rate)} (${formatUsd(amountCents / 100)})`;
				const mail = escalationEmail({ name: client?.name ?? "there", amountGhs, handlerName });
				await queueEmail({
					to: auth.email,
					subject: `Your instalment is overdue — ${line.label}`,
					...mail,
					idempotencyKey: `autopay:escalate:${line.id}`,
					template: "Auto-pay instalment overdue",
					reference: invoice.invoiceNumber ?? invoiceId,
				}).catch(() => {});
				if (handlerEmail) {
					await queueEmail({
						to: handlerEmail,
						subject: `Auto-pay overdue — ${client?.name ?? "client"} · ${invoice.invoiceNumber ?? invoiceId}`,
						html: emailLayout({
							title: "Instalment overdue — follow up needed",
							preheader: `${client?.name ?? "Client"} · ${amountGhs}`,
							bodyHtml: `<p style="margin:0">${client?.name ?? "The client"}'s instalment of <strong>${amountGhs}</strong> (${line.label}) has been failing for ${ESCALATE_DAYS}+ days. The client has been emailed; please follow up.</p>`,
						}),
						text: `${client?.name ?? "Client"}'s instalment of ${amountGhs} (${line.label}) has been failing for ${ESCALATE_DAYS}+ days. Please follow up.`,
						idempotencyKey: `autopay:escalate:staff:${line.id}`,
						template: "Auto-pay overdue — handler",
						reference: invoice.invoiceNumber ?? invoiceId,
					}).catch(() => {});
				}
			}

			const last = await lastAttempt(line.id);
			if (last?.status === "success" || (last && now.getTime() - last.attemptedAt.getTime() < RETRY_DAYS * 86_400_000)) continue;

			const reference = `AUTO-${line.id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
			const amountGhsPesewas = Math.round((amountCents / 100) * rate * 100);
			const result = await chargeAuthorization({
				secret,
				email: auth.email,
				amountGhsPesewas,
				authorizationCode: auth.authorizationCode,
				reference,
				invoiceId,
				lineId: line.id,
			});

			if (result.ok) {
				// Settle through the same path a checkout payment takes.
				await db.insert(paymentTransactions).values({
					invoiceId,
					clientUserId: invoice.clientUserId,
					reference,
					gateway: "paystack",
					amountCents,
					currency: "USD",
					status: "pending",
				});
				const { verifyAndSettlePayment } = await import("./payments.js");
				await verifyAndSettlePayment(reference, "paystack");
				await db.insert(autopayAttempts).values({
					invoiceLineId: line.id,
					authorizationId: auth.id,
					invoiceId,
					amountCents,
					reference,
					status: "success",
				});
				await db.update(paymentAuthorizations).set({ lastChargeAt: now, updatedAt: now }).where(eq(paymentAuthorizations.id, auth.id));
				paidCents += amountCents;
				charged++;
			} else {
				await db.insert(autopayAttempts).values({
					invoiceLineId: line.id,
					authorizationId: auth.id,
					invoiceId,
					amountCents,
					reference,
					status: "failed",
					failureReason: result.reason,
				});
				const retryOn = new Date(now.getTime() + RETRY_DAYS * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
				const card = [auth.cardBrand, auth.cardLast4 ? `····${auth.cardLast4}` : ""].filter(Boolean).join(" ") || "your card";
				const mail = failureEmail({
					name: client?.name ?? "there",
					amountGhs: `${formatGhs((amountCents / 100) * rate)} (${formatUsd(amountCents / 100)})`,
					card,
					retryOn,
				});
				await queueEmail({
					to: auth.email,
					subject: `We couldn't charge your card — ${line.label}`,
					...mail,
					idempotencyKey: `autopay:fail:${line.id}:${reference}`,
					template: "Auto-pay debit failed",
					reference: invoice.invoiceNumber ?? invoiceId,
				}).catch(() => {});
				failed++;
			}
		}
	}
	return { charged, failed, skipped };
}
