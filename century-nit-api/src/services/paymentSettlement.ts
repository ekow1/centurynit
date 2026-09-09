import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { invoicePayments, paymentTransactions, applicants } from "../db/schema.js";
import { getSetting } from "./settings.js";
import { sendPaymentReceiptEmail } from "./receiptEmail.js";
import { getInvoice, recordPayment } from "./invoice.js";
import { HttpError } from "../middleware/error.js";
import type { InvoiceRow } from "./invoice.js";

export type SettlementActor = { opsUserId?: string | null; name: string; email: string };

const SYSTEM_ACTOR: SettlementActor = {
	opsUserId: null,
	name: "System",
	email: "system@centurynit.com",
};
const DEFAULT_GHS_USD_RATE = 15.0;
export type PaymentSettlementOptions = {
	sendReceipt?: boolean;
	recordGatewayTransaction?: boolean;
};

export async function getExchangeRate(): Promise<number> {
	const raw = await getSetting("PLATFORM_EXCHANGE_RATE");
	const n = raw ? Number.parseFloat(raw) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_GHS_USD_RATE;
}

export async function paidCentsOfInvoice(invoiceId: string): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${invoicePayments.amountCents}), 0)::int` })
		.from(invoicePayments)
		.where(eq(invoicePayments.invoiceId, invoiceId));
	return row?.total ?? 0;
}

async function recordGatewayTransaction(input: {
	invoice: InvoiceRow;
	payment: { amountCents: number; currency?: string | null; gateway?: string | null; reference: string };
}): Promise<void> {
	const gateway = input.payment.gateway === "stripe" ? "stripe" : "paystack";
	try {
		await db
			.insert(paymentTransactions)
			.values({
				invoiceId: input.invoice.id,
				clientUserId: input.invoice.clientUserId ?? null,
				reference: input.payment.reference,
				gateway,
				amountCents: input.payment.amountCents,
				currency: input.payment.currency ?? "USD",
				status: "success",
				paidAt: new Date(),
			})
			.onConflictDoUpdate({
				target: paymentTransactions.reference,
				set: {
					status: "success",
					paidAt: new Date(),
					amountCents: input.payment.amountCents,
					currency: input.payment.currency ?? "USD",
					invoiceId: input.invoice.id,
					clientUserId: input.invoice.clientUserId ?? null,
				},
			});
	} catch (err) {
		console.error("[paymentSettlement] Failed to record gateway transaction:", err);
	}
}


async function sendReceipt(input: {
	invoice: InvoiceRow;
	payment: { amountCents: number; method: string; reference?: string | null; currency?: string | null };
}): Promise<void> {
	const { invoice, payment } = input;
	if (!invoice.applicantEmail) return;

	try {
		const [applicant] = await db
			.select({ phone: applicants.phone })
			.from(applicants)
			.where(eq(applicants.email, invoice.applicantEmail))
			.limit(1);

		const rate = await getExchangeRate();
		// amountCents is always in the invoice's currency (USD cents). The
		// gateway may have charged in GHS, but the webhook converts to USD
		// cents before calling settleInvoicePayment (see routes/webhooks.ts),
		// so the receipt must treat amountCents as USD and show GHS as the
		// equivalent — never the other way around.
		const amountUsd = payment.amountCents / 100;
		const amountGhs = amountUsd * rate;

		await sendPaymentReceiptEmail({
			recipientEmail: invoice.applicantEmail,
			recipientName: invoice.applicantName || "Valued Client",
			recipientPhone: applicant?.phone ?? null,
			receiptNumber: `REC-${payment.reference ?? Date.now()}`,
			invoiceNumber: invoice.invoiceNumber,
			amountGhs,
			amountUsd,
			paymentDate: new Date().toLocaleDateString("en-US"),
			paymentChannel: payment.method,
			reference: payment.reference ?? "",
			description: `Settlement for Invoice ${invoice.invoiceNumber}`,
		});
	} catch (err) {
		console.error("[paymentSettlement] Failed to send receipt:", err);
	}
}

export async function postPaymentSettlement(input: {
	invoice: InvoiceRow;
	payment: {
		amountCents: number;
		method: string;
		gateway?: string | null;
		reference?: string | null;
		currency?: string | null;
	};
	actor: SettlementActor;
	options?: PaymentSettlementOptions;
}): Promise<void> {
	const options = {
		sendReceipt: true,
		advanceStage: true,
		recordGatewayTransaction: true,
		...input.options,
	};

	// Nothing in this routine should ever throw back into the request — a
	// failed receipt email or stage update must never stop the payment from
	// being recorded.
	if (options.recordGatewayTransaction && input.payment.gateway && input.payment.reference) {
		await recordGatewayTransaction({
			invoice: input.invoice,
			payment: {
				...input.payment,
				reference: input.payment.reference,
			},
		});
	}

	if (options.sendReceipt) {
		await sendReceipt({ invoice: input.invoice, payment: input.payment });
	}
}

export async function settleInvoicePayment(input: {
	invoiceId: string;
	amountCents: number;
	method: string;
	gateway?: string | null;
	reference?: string | null;
	currency?: string | null;
	actor: SettlementActor;
	options?: PaymentSettlementOptions;
}) {
	const invoice = await getInvoice(input.invoiceId);
	if (!invoice) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");

	const updated = await recordPayment({
		invoiceId: input.invoiceId,
		amountCents: input.amountCents,
		method: input.method,
		gateway: input.gateway ?? undefined,
		reference: input.reference ?? undefined,
		actor: {
			opsUserId: input.actor.opsUserId ?? SYSTEM_ACTOR.opsUserId,
			name: input.actor.name,
			email: input.actor.email,
		},
	});

	await postPaymentSettlement({
		invoice: updated,
		payment: {
			amountCents: input.amountCents,
			method: input.method,
			gateway: input.gateway,
			reference: input.reference,
			currency: input.currency,
		},
		actor: input.actor,
		options: { ...input.options, recordGatewayTransaction: true },
	});

	return updated;
}
