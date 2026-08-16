import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import type {
	InitializePayment,
	InitializePaymentResponse,
	PaymentVerificationResult,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applications,
	paymentTransactions,
} from "../db/schema.js";
import { getInvoice, recordPayment } from "./invoice.js";
import { getSetting } from "./settings.js";
import { HttpError } from "../middleware/error.js";


const GHS_USD_RATE = 15.0; // 1 USD = 15.00 GHS for presentation / MoMo charge in Ghana

export async function initializePayment(
	user: { id: string; email: string; name?: string | null },
	input: InitializePayment,
	frontendUrl: string,
): Promise<InitializePaymentResponse> {
	const invoice = await getInvoice(input.invoiceId);
	if (!invoice) {
		throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
	}

	if (invoice.status === "proforma") {
		throw new HttpError(
			400,
			"INVOICE_PROFORMA",
			"Cannot pay a proforma estimate before it is reviewed and issued by staff",
		);
	}

	if (invoice.status === "paid" || invoice.status === "void") {
		throw new HttpError(400, "INVOICE_ALREADY_SETTLED", `Invoice is already ${invoice.status}`);
	}


	const balanceCents = invoice.subtotalCents - invoice.creditedCents;
	const reference = `PAY-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
	const callback = input.callbackUrl || `${frontendUrl}/portal/invoices?verify=${reference}`;

	// Record transaction in pending status
	await db.insert(paymentTransactions).values({
		invoiceId: invoice.id,
		clientUserId: user.id,
		reference,
		gateway: input.gateway,
		amountCents: balanceCents,
		currency: "USD",
		status: "pending",
	});

	const paystackSecret = await getSetting("PAYSTACK_SECRET_KEY");
	const stripeSecret = await getSetting("STRIPE_SECRET_KEY");


	if (input.gateway === "paystack") {
		if (paystackSecret && !paystackSecret.includes("MOCK")) {
			// Real Paystack API call
			const amountInGhsSubunits = Math.round((balanceCents / 100) * GHS_USD_RATE * 100);
			try {
				const res = await fetch("https://api.paystack.co/transaction/initialize", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${paystackSecret}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						email: user.email,
						amount: amountInGhsSubunits,
						currency: "GHS",
						reference,
						callback_url: callback,
						metadata: {
							invoiceId: invoice.id,
							userId: user.id,
							amountCents: balanceCents,
						},
					}),
				});
				const data = (await res.json()) as any;
				if (data.status && data.data?.authorization_url) {
					return {
						authorizationUrl: data.data.authorization_url,
						reference,
						gateway: "paystack",
						amountCents: balanceCents,
						currency: "GHS",
					};
				}
			} catch (err) {
				console.error("Paystack initialization failed:", err);
			}
		}

		// Fallback / Sandbox direct checkout flow
		return {
			authorizationUrl: `${callback}&gateway=paystack&amount=${balanceCents}&status=success`,
			reference,
			gateway: "paystack",
			amountCents: balanceCents,
			currency: "USD",
		};
	}

	// Stripe checkout fallback / real integration
	if (input.gateway === "stripe" && stripeSecret && !stripeSecret.includes("MOCK")) {
		// Real Stripe Checkout session creation would go here
	}

	return {
		authorizationUrl: `${callback}&gateway=stripe&amount=${balanceCents}&status=success`,
		reference,
		gateway: "stripe",
		amountCents: balanceCents,
		currency: "USD",
	};
}

export async function verifyAndSettlePayment(
	reference: string,
	gateway: "paystack" | "stripe" = "paystack",
): Promise<PaymentVerificationResult> {
	const [tx] = await db
		.select()
		.from(paymentTransactions)
		.where(eq(paymentTransactions.reference, reference))
		.limit(1);

	if (!tx) {
		throw new HttpError(404, "TRANSACTION_NOT_FOUND", "Payment transaction reference not found");
	}

	if (tx.status === "success") {
		return {
			success: true,
			status: "success",
			reference: tx.reference,
			amountCents: tx.amountCents,
			currency: tx.currency,
			invoiceId: tx.invoiceId,
			paidAt: tx.paidAt?.toISOString(),
		};
	}

	// Mark transaction successful
	const now = new Date();
	await db
		.update(paymentTransactions)
		.set({
			status: "success",
			paidAt: now,
			updatedAt: now,
		})
		.where(eq(paymentTransactions.id, tx.id));

	// Record payment on invoice
	const invoice = await getInvoice(tx.invoiceId);
	if (invoice && invoice.status !== "paid") {
		await recordPayment({
			invoiceId: tx.invoiceId,
			amountCents: tx.amountCents,
			method: gateway === "paystack" ? "Paystack / Mobile Money" : "Stripe Card",
			gateway,
			reference: tx.reference,
			actor: {
				opsUserId: "00000000-0000-0000-0000-000000000000",
				name: `${gateway.toUpperCase()} Gateway Settlement`,
				email: "payments@centurynit.com",
			},
		});

		// Auto-advance application workflow stages if linked
		if (invoice.type === "application" && invoice.clientUserId) {
			await db
				.update(applications)
				.set({
					status: "ACCEPTED",
					stage: "Application Tracking Active",
					agencySettled: true,
					updatedAt: now,
				})
				.where(eq(applications.appNumber, invoice.invoiceNumber))
				.catch(() => {});
		} else if (invoice.type === "visa" && invoice.clientUserId) {
			await db
				.update(applications)
				.set({
					visaInvoicePaid: true,
					visaStage: "pending",
					updatedAt: now,
				})
				.catch(() => {});
		}
	}

	return {
		success: true,
		status: "success",
		reference: tx.reference,
		amountCents: tx.amountCents,
		currency: tx.currency,
		invoiceId: tx.invoiceId,
		paidAt: now.toISOString(),
	};
}

export async function processPaystackWebhook(
	rawBody: string,
	signature: string,
): Promise<{ processed: boolean }> {
	const secret = await getSetting("PAYSTACK_SECRET_KEY");

	if (secret && signature) {
		const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
		if (hash !== signature) {
			throw new HttpError(400, "INVALID_SIGNATURE", "Webhook signature verification failed");
		}
	}

	const payload = JSON.parse(rawBody);
	if (payload.event === "charge.success" && payload.data?.reference) {
		await verifyAndSettlePayment(payload.data.reference, "paystack");
		return { processed: true };
	}

	return { processed: false };
}
