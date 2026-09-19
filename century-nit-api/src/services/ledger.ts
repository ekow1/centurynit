import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	autopayAttempts,
	invoiceLines,
	invoicePayments,
	invoices,
	paymentAuthorizations,
	paymentTransactions,
} from "../db/schema.js";

/**
 * The transaction ledger — one read model over the payment tables, served
 * twice: the portal trims it to face-value rows, ops gets every attempt with
 * channel, reference and who recorded it. Nothing is stored here; the truth
 * already lives in invoice_payments (settled and manual), autopay_attempts
 * (auto-debit tries, including declines) and payment_transactions (checkout
 * attempts). Scheduled rows come from the invoice's own unpaid dated lines.
 */

export type LedgerStatus = "settled" | "manual" | "declined" | "scheduled";

export type LedgerRow = {
	id: string;
	at: string;
	/** What the money was for — the invoice line it landed on, where known. */
	label: string;
	invoiceId: string;
	invoiceNumber: string;
	/** "Paystack · mobile money", "auto-pay · Visa ····4283", "Cash" */
	channel: string;
	reference: string | null;
	amountCents: number;
	status: LedgerStatus;
	failureReason: string | null;
	/** Staff name for a manually recorded payment; "webhook"/"auto-pay sweep" otherwise. */
	recordedBy: string | null;
	/** Outstanding on the invoice right after this row (settled/manual only). */
	balanceAfterCents: number | null;
};

const CARD_CHANNELS = new Set(["card"]);

function paymentChannel(method: string | null, gateway: string | null, auth: { cardBrand: string | null; cardLast4: string | null } | null, auto: boolean): string {
	if (auto) return `auto-pay · ${auth?.cardBrand ?? "card"}${auth?.cardLast4 ? ` ····${auth.cardLast4}` : ""}`;
	const g = gateway ?? "manual";
	if (!method) return g;
	// "Paystack / Mobile Money" is the gateway label; card detail comes from the authorization where one exists.
	if (auth?.cardBrand && CARD_CHANNELS.has(method.toLowerCase().split(" ").pop() ?? "")) {
		return `${g} · ${auth.cardBrand}${auth.cardLast4 ? ` ····${auth.cardLast4}` : ""}`;
	}
	return `${g} · ${method.toLowerCase()}`;
}

/**
 * The ledger for one invoice. `forOps` keeps gateway references, decline
 * reasons and who recorded each entry; the portal view drops the internals
 * and the failed checkout noise — a client sees settlements, scheduled
 * instalments and declined auto-debits only.
 */
async function ledgerForInvoice(invoiceId: string, forOps: boolean): Promise<LedgerRow[]> {
	const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
	if (!inv) return [];

	const [lines, payments, attempts, txs] = await Promise.all([
		db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.position)),
		db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId)).orderBy(asc(invoicePayments.at)),
		db.select({ a: autopayAttempts, lineLabel: invoiceLines.label, auth: paymentAuthorizations })
			.from(autopayAttempts)
			.leftJoin(invoiceLines, eq(autopayAttempts.invoiceLineId, invoiceLines.id))
			.leftJoin(paymentAuthorizations, eq(autopayAttempts.authorizationId, paymentAuthorizations.id))
			.where(eq(autopayAttempts.invoiceId, invoiceId))
			.orderBy(asc(autopayAttempts.attemptedAt)),
		db.select().from(paymentTransactions).where(eq(paymentTransactions.invoiceId, invoiceId)),
	]);

	const attemptByRef = new Map(attempts.filter((x) => x.a.reference).map((x) => [x.a.reference as string, x]));
	const rows: LedgerRow[] = [];

	// Waterfill the lines so each payment can name the line it settled.
	let cumPaid = 0;
	const cumLines: { start: number; end: number; label: string }[] = [];
	for (const l of lines) {
		cumLines.push({ start: cumPaid, end: cumPaid + l.amountCents, label: l.label });
		cumPaid += l.amountCents;
	}
	const lineFor = (paidBefore: number) => cumLines.find((c) => paidBefore < c.end)?.label ?? "Payment";

	let settled = 0;
	for (const p of payments) {
		const attempt = p.reference ? attemptByRef.get(p.reference) : undefined;
		const auto = Boolean(attempt);
		const manual = !p.gateway && !auto;
		settled += p.amountCents;
		rows.push({
			id: `pay-${p.id}`,
			at: p.at.toISOString(),
			label: lineFor(settled - p.amountCents),
			invoiceId,
			invoiceNumber: inv.invoiceNumber,
			channel: paymentChannel(p.method, p.gateway, attempt?.auth ?? null, auto),
			reference: forOps ? (p.reference ?? null) : null,
			amountCents: p.amountCents,
			status: manual ? "manual" : "settled",
			failureReason: null,
			recordedBy: forOps ? p.recordedByName : null,
			balanceAfterCents: Math.max(0, inv.subtotalCents - settled),
		});
	}

	for (const { a, lineLabel, auth } of attempts) {
		if (a.status !== "failed") continue; // successes already appear via invoice_payments
		rows.push({
			id: `att-${a.id}`,
			at: a.attemptedAt.toISOString(),
			label: lineLabel ?? "Auto-pay instalment",
			invoiceId,
			invoiceNumber: inv.invoiceNumber,
			channel: paymentChannel("card", null, auth, true),
			reference: forOps ? (a.reference ?? null) : null,
			amountCents: a.amountCents,
			status: "declined",
			failureReason: forOps ? (a.failureReason ?? null) : null,
			recordedBy: "auto-pay sweep",
			balanceAfterCents: null,
		});
	}

	if (forOps) {
		const settledRefs = new Set(payments.map((p) => p.reference).filter(Boolean));
		for (const tx of txs) {
			if (tx.status !== "failed") continue;
			if (tx.reference && settledRefs.has(tx.reference)) continue;
			if (tx.reference && attemptByRef.has(tx.reference)) continue;
			rows.push({
				id: `tx-${tx.id}`,
				at: (tx.paidAt ?? tx.createdAt).toISOString(),
				label: "Checkout attempt",
				invoiceId,
				invoiceNumber: inv.invoiceNumber,
				channel: `${tx.gateway} · checkout`,
				reference: tx.reference,
				amountCents: tx.amountCents,
				status: "declined",
				failureReason: null,
				recordedBy: "gateway",
				balanceAfterCents: null,
			});
		}
	}

	// Scheduled rows: unpaid lines that carry a due date. A line is unpaid
	// while the invoice's settled cents have not reached its cumulative end.
	let cum = 0;
	for (const l of lines) {
		const end = cum + l.amountCents;
		cum = end;
		if (settled >= end || !l.dueAt) continue;
		rows.push({
			id: `sched-${l.id}`,
			at: l.dueAt.toISOString(),
			label: l.label,
			invoiceId,
			invoiceNumber: inv.invoiceNumber,
			channel: "—",
			reference: null,
			amountCents: l.amountCents,
			status: "scheduled",
			failureReason: null,
			recordedBy: null,
			balanceAfterCents: null,
		});
	}

	rows.sort((a, b) => a.at.localeCompare(b.at));
	return rows;
}

/** Every ledger row on the application's invoices — the ops Billing view. */
export async function applicationLedger(applicationId: string): Promise<LedgerRow[]> {
	const invs = await db
		.select({ id: invoices.id })
		.from(invoices)
		.where(eq(invoices.applicationId, applicationId));
	const rows = (await Promise.all(invs.map((i) => ledgerForInvoice(i.id, true)))).flat();
	rows.sort((a, b) => a.at.localeCompare(b.at));
	return rows;
}

/** The client's own ledger across their invoices — portal-trimmed rows. */
export async function clientLedger(clientUserId: string): Promise<LedgerRow[]> {
	const invs = await db
		.select({ id: invoices.id })
		.from(invoices)
		.where(eq(invoices.clientUserId, clientUserId));
	const rows = (await Promise.all(invs.map((i) => ledgerForInvoice(i.id, false)))).flat();
	rows.sort((a, b) => a.at.localeCompare(b.at));
	return rows;
}
