import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { invoicePayments, invoiceLines, paymentTransactions, applicants } from "../db/schema.js";
import { getSetting } from "./settings.js";
import { receiptEmailMessage } from "./receiptEmail.js";
import { queueEmail } from "../worker/queues.js";
import { getInvoice, recordPayment } from "./invoice.js";
import { generateInvoicePdf, generateReceiptPdf } from "./pdfEngine.js";
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

	const [applicant] = await db
		.select({ phone: applicants.phone })
		.from(applicants)
		.where(eq(applicants.email, invoice.applicantEmail))
		.limit(1);

	// Load the actual invoice line items so the receipt shows what was paid for
	// (visa fee, travel ticket, consultation, etc.) instead of a hardcoded
	// "Consultation, processing & admission fees" row.
	const lines = await db
		.select()
		.from(invoiceLines)
		.where(eq(invoiceLines.invoiceId, invoice.id))
		.orderBy(invoiceLines.position);

	const rate = await getExchangeRate();
	// amountCents is always in the invoice's currency (USD cents). The
	// gateway may have charged in GHS, but the webhook converts to USD
	// cents before calling settleInvoicePayment (see routes/webhooks.ts),
	// so the receipt must treat amountCents as USD and show GHS as the
	// equivalent — never the other way around.
	const amountUsd = payment.amountCents / 100;
	const amountGhs = amountUsd * rate;

	const lineItems =
		lines.length > 0
			? lines.map((l) => ({
					label: l.label,
					detail: l.detail ?? null,
					amountUsd: l.amountCents / 100,
					amountGhs: (l.amountCents / 100) * rate,
				}))
			: undefined;

	const baseData = {
		clientName: invoice.applicantName || "Valued Client",
		clientEmail: invoice.applicantEmail,
		clientPhone: applicant?.phone ?? null,
		invoiceNumber: invoice.invoiceNumber,
		receiptNumber: `REC-${payment.reference ?? Date.now()}`,
		paymentDate: new Date().toLocaleDateString("en-US"),
		issueDate: invoice.createdAt.toLocaleDateString("en-US"),
		dueAt: invoice.dueAt ? invoice.dueAt.toLocaleDateString("en-US") : new Date().toLocaleDateString("en-US"),
		paymentChannel: payment.method,
		reference: payment.reference ?? "",
		totalGhs: amountGhs,
		totalUsd: amountUsd,
		lineItems: lineItems ?? [{ label: `Settlement for Invoice ${invoice.invoiceNumber}`, amountGhs, amountUsd }],
	};

	let invoicePdfBase64: string | undefined;
	let receiptPdfBase64: string | undefined;

	try {
		const invoicePdfBuffer = await generateInvoicePdf(baseData);
		invoicePdfBase64 = invoicePdfBuffer.toString("base64");

		const receiptPdfBuffer = await generateReceiptPdf(baseData);
		receiptPdfBase64 = receiptPdfBuffer.toString("base64");
	} catch (err) {
		console.error("[paymentSettlement] Failed to generate PDFs:", err);
	}

	const message = receiptEmailMessage({
		recipientEmail: invoice.applicantEmail,
		recipientName: invoice.applicantName || "Valued Client",
		recipientPhone: applicant?.phone ?? null,
		receiptNumber: baseData.receiptNumber,
		invoiceNumber: invoice.invoiceNumber,
		amountGhs,
		amountUsd,
		paymentDate: baseData.paymentDate,
		paymentChannel: payment.method,
		reference: baseData.reference,
		description: `Settlement for Invoice ${invoice.invoiceNumber}`,
		lineItems,
	});

	if (invoicePdfBase64 && receiptPdfBase64) {
		message.attachments = [
			{ filename: `Invoice_${invoice.invoiceNumber}.pdf`, content: invoicePdfBase64 },
			{ filename: `Receipt_${baseData.receiptNumber}.pdf`, content: receiptPdfBase64 },
		];
	}

	// Queued rather than sent inline — the receipt retries on its own schedule
	// and lands in notification_log, so a Resend outage can no longer lose the
	// client's proof of payment. Still inside postPaymentSettlement's catch:
	// a Redis failure must not break the settlement either.
	await queueEmail(message);
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
		// The payment is already recorded at this point — a receipt failure
		// must not roll it back. But log it loudly so ops can see that the
		// client did NOT receive their receipt (the previous code swallowed
		// this silently and reported false success).
		try {
			await sendReceipt({ invoice: input.invoice, payment: input.payment });
		} catch (err) {
			console.error(
				`[paymentSettlement] RECEIPT NOT DELIVERED for invoice ${input.invoice.invoiceNumber} (ref ${input.payment.reference ?? "—"}):`,
				err,
			);
		}
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
