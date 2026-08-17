import { HttpError } from "../middleware/error.js";
import { getSetting } from "./settings.js";

const PAYSTACK_API = "https://api.paystack.co";

/** A short, unique reference for a Paystack transaction. */
export function newPaystackReference(): string {
	const rnd = crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
	return `PS-${rnd}`;
}

/**
 * Resolve the Paystack secret key from the ops Settings (encrypted DB value) or
 * the PAYSTACK_SECRET_KEY env var. Throws when unset so the caller can fall
 * back to the direct server-side record path.
 */
export async function paystackSecretKey(): Promise<string> {
	const key = await getSetting("PAYSTACK_SECRET_KEY");
	if (!key) {
		throw new HttpError(
			501,
			"PAYMENT_GATEWAY_UNCONFIGURED",
			"Online payments are not set up yet. Please contact your consultant for an alternative payment method.",
		);
	}
	return key;
}

/**
 * Open a Paystack hosted checkout for an applicant invoice.
 *
 * `metadata.invoiceId` is echoed back by Paystack on verify and webhook, which
 * lets the server confirm the transaction belongs to the invoice it is paying.
 */
export async function createPaystackCheckout(input: {
	email: string;
	amountCents: number;
	invoiceId: string;
	callbackUrl: string;
}): Promise<{ authorizationUrl: string; reference: string; amountCents: number }> {
	const secretKey = await paystackSecretKey();
	const reference = newPaystackReference();
	const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secretKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			email: input.email,
			amount: input.amountCents,
			currency: "USD",
			reference,
			callback_url: input.callbackUrl,
			metadata: { invoiceId: input.invoiceId },
		}),
	});
	let body = (await response.json()) as {
		status?: boolean;
		message?: string;
		data?: { authorization_url?: string };
	};

	// If the merchant integration only accepts GHS, retry in GHS subunits
	if (!response.ok || !body.status || !body.data?.authorization_url) {
		if (
			body.message?.toLowerCase().includes("currency") ||
			body.message?.toLowerCase().includes("usd") ||
			!response.ok
		) {
			const GHS_USD_RATE = 15.0;
			const amountInPesewas = Math.round((input.amountCents / 100) * GHS_USD_RATE * 100);
			const retryRes = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${secretKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email: input.email,
					amount: amountInPesewas,
					currency: "GHS",
					reference,
					callback_url: input.callbackUrl,
					metadata: { invoiceId: input.invoiceId, amountCents: input.amountCents },
				}),
			});
			body = (await retryRes.json()) as typeof body;
		}
	}

	if (!body.status || !body.data?.authorization_url) {
		throw new HttpError(
			502,
			"PAYMENT_GATEWAY_ERROR",
			`Paystack could not start a checkout${body.message ? `: ${body.message}` : "."}`,
		);
	}
	return {
		authorizationUrl: body.data.authorization_url,
		reference,
		amountCents: input.amountCents,
	};
}

export type PaystackVerifiedTransaction = {
	status: string;
	amountCents: number;
	currency: string;
	invoiceId?: string;
};

/** Query Paystack for a transaction, cross-checking the invoice metadata. */
export async function verifyPaystackTransaction(
	reference: string,
): Promise<PaystackVerifiedTransaction> {
	const secretKey = await paystackSecretKey();
	const response = await fetch(
		`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
		{
			headers: { Authorization: `Bearer ${secretKey}` },
		},
	);
	const body = (await response.json()) as {
		status?: boolean;
		message?: string;
		data?: {
			status?: string;
			amount?: number;
			currency?: string;
			metadata?: { invoiceId?: string };
		};
	};
	if (!response.ok || !body.status || !body.data) {
		throw new HttpError(502, "PAYMENT_GATEWAY_ERROR", "Could not verify the payment with Paystack");
	}
	return {
		status: body.data.status ?? "unknown",
		amountCents: body.data.amount ?? 0,
		currency: body.data.currency ?? "USD",
		invoiceId: body.data.metadata?.invoiceId,
	};
}

/** Paystack signs the raw request body with HMAC-SHA512 using the secret key. */
export async function verifyPaystackSignature(
	body: string,
	signature: string | null,
): Promise<boolean> {
	if (!signature) return false;
	const secretKey = await paystackSecretKey();
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secretKey),
		{ name: "HMAC", hash: "SHA-512" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
	return expected === signature.toLowerCase();
}
