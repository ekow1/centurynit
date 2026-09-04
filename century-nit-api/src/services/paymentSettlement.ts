import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { invoicePayments, paymentTransactions, applications, applicants } from "../db/schema.js";
import { getSetting } from "./settings.js";
import { sendPaymentReceiptEmail } from "./receiptEmail.js";
import { getInvoice, recordPayment } from "./invoice.js";
import { HttpError } from "../middleware/error.js";
import type { InvoiceRow } from "./invoice.js";

const SYSTEM_ACTOR = {
	opsUserId: "00000000-0000-0000-0000-000000000000",
	name: "System",
	email: "system@centurynit.com",
};
const DEFAULT_GHS_USD_RATE = 15.0;

export type SettlementActor = { opsUserId?: string; name: string; email: string };
export type PaymentSettlementOptions = {
	sendReceipt?: boolean;
	advanceStage?: boolean;
	recordGatewayTransaction?: boolean;
};

type ApplicationRow = typeof applications.$inferSelect;

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

async function latestApplicationForUser(userId: string): Promise<ApplicationRow | null> {
	const rows = await db
		.select({ application: applications })
		.from(applications)
		.innerJoin(applicants, eq(applications.applicantId, applicants.id))
		.where(eq(applicants.userId, userId))
		.orderBy(desc(applications.createdAt))
		.limit(1);
	return rows[0]?.application ?? null;
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

async function advanceApplicationStage(invoice: InvoiceRow): Promise<void> {
	if (invoice.status !== "paid" || !invoice.clientUserId) return;
	if (!["application", "visa", "agency"].includes(invoice.type)) return;

	try {
		const application = await latestApplicationForUser(invoice.clientUserId);
		if (!application) return;

		const now = new Date();
		if (invoice.type === "application") {
			await db
				.update(applications)
				.set({
					status: "ACCEPTED",
					stage: "school_submission",
					agencySettled: true,
					updatedAt: now,
				})
				.where(eq(applications.id, application.id));
		} else if (invoice.type === "visa") {
			await db
				.update(applications)
				.set({
					visaInvoicePaid: true,
					visaStage: "pending",
					updatedAt: now,
				})
				.where(eq(applications.id, application.id));
		} else if (invoice.type === "agency") {
			await db
				.update(applications)
				.set({
					agencySettled: true,
					updatedAt: now,
				})
				.where(eq(applications.id, application.id));
		}
	} catch (err) {
		console.error("[paymentSettlement] Failed to advance application stage:", err);
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
		const isGhs = payment.currency === "GHS";
		const amountGhs = isGhs ? payment.amountCents / 100 : (payment.amountCents / 100) * rate;
		const amountUsd = isGhs ? (payment.amountCents / 100) / rate : payment.amountCents / 100;

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

	if (options.advanceStage) {
		await advanceApplicationStage(input.invoice);
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
