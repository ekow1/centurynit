import { HttpError } from "../middleware/error.js";
import { getSetting } from "./settings.js";
import { exchangeRate } from "./fees.js";

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
 * The publishable key the portal needs for Paystack's inline checkout
 * (PaystackPop). Not a secret — safe to return to signed-in clients. Null when
 * unset so the portal can fall back to the hosted-redirect flow.
 */
export async function paystackPublicKey(): Promise<string | null> {
	const key = await getSetting("PAYSTACK_PUBLIC_KEY");
	return key && key.trim() ? key.trim() : null;
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
	invoiceId?: string;
	customMetadata?: Record<string, any>;
	callbackUrl: string;
}): Promise<{ authorizationUrl: string; reference: string; amountCents: number; accessCode?: string }> {
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
			metadata: {
				...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
				invoiceAmountCents: input.amountCents,
				...input.customMetadata,
			},
		}),
	});
	let body = (await response.json()) as {
		status?: boolean;
		message?: string;
		data?: { authorization_url?: string; access_code?: string };
	};

	// If the merchant integration only accepts GHS, retry in GHS subunits
	if (!response.ok || !body.status || !body.data?.authorization_url) {
		if (
			body.message?.toLowerCase().includes("currency") ||
			body.message?.toLowerCase().includes("usd") ||
			!response.ok
		) {
			const GHS_USD_RATE = await exchangeRate();
			// Paystack GHS minimum transaction amount is 100 pesewas (GH₵ 1.00)
			const amountInPesewas = Math.max(100, Math.round((input.amountCents / 100) * GHS_USD_RATE * 100));
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
				metadata: {
					...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
					invoiceAmountCents: input.amountCents,
					...input.customMetadata,
				},
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
		accessCode: body.data.access_code,
	};
}

export type MomoChargeResult = {
	reference: string;
	/** Paystack charge status — pending | send_otp | success | failed | … */
	status: string;
	displayText: string | null;
};

/**
 * Charge a Ghana Mobile Money wallet server-side. No card data is involved,
 * so the portal can render the whole checkout itself: it collects the wallet
 * number + network, calls our endpoint, and the client approves the prompt on
 * their phone. Amount arrives as USD cents (the invoice's currency) and is
 * converted to GHS pesewas — MoMo is a GHS-only channel. `invoiceAmountCents`
 * in the metadata keeps the USD figure so verification converts back at the
 * configured rate, exactly like the hosted-checkout fallback.
 */
export async function chargeMoMo(input: {
	email: string;
	amountCents: number;
	phone: string;
	provider: "mtn" | "vod" | "atl";
	invoiceId: string;
}): Promise<MomoChargeResult> {
	const secretKey = await paystackSecretKey();
	const reference = newPaystackReference();
	const rate = await exchangeRate();
	const pesewas = Math.max(100, Math.round((input.amountCents / 100) * rate * 100));
	const response = await fetch(`${PAYSTACK_API}/charge`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secretKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			email: input.email,
			amount: pesewas,
			currency: "GHS",
			reference,
			mobile_money: { phone: input.phone, provider: input.provider },
			metadata: { invoiceId: input.invoiceId, invoiceAmountCents: input.amountCents },
		}),
	});
	const body = (await response.json()) as {
		status?: boolean;
		message?: string;
		data?: { status?: string; reference?: string; display_text?: string };
	};
	if (!response.ok || !body.status || !body.data?.reference) {
		throw new HttpError(
			502,
			"PAYMENT_GATEWAY_ERROR",
			`Paystack could not start the Mobile Money charge${body.message ? `: ${body.message}` : "."}`,
		);
	}
	return {
		reference: body.data.reference,
		status: body.data.status ?? "pending",
		displayText: body.data.display_text ?? null,
	};
}

/**
 * Submit the OTP a MoMo provider asks for after the initial charge (Telecel in
 * particular can take this path instead of the plain approval prompt).
 */
export async function submitPaystackOtp(input: {
	reference: string;
	otp: string;
}): Promise<MomoChargeResult> {
	const secretKey = await paystackSecretKey();
	const response = await fetch(`${PAYSTACK_API}/charge/submit_otp`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secretKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ reference: input.reference, otp: input.otp }),
	});
	const body = (await response.json()) as {
		status?: boolean;
		message?: string;
		data?: { status?: string; reference?: string; display_text?: string };
	};
	if (!response.ok || !body.status) {
		throw new HttpError(
			502,
			"PAYMENT_GATEWAY_ERROR",
			`Paystack rejected the code${body.message ? `: ${body.message}` : "."}`,
		);
	}
	return {
		reference: body.data?.reference ?? input.reference,
		status: body.data?.status ?? "pending",
		displayText: body.data?.display_text ?? null,
	};
}

export type PaystackVerifiedTransaction = {
	status: string;
	amountCents: number;
	currency: string;
	invoiceId?: string;
	invoiceAmountCents?: number;
	customerEmail?: string;
	authorization?: {
		authorization_code?: string;
		last4?: string;
		exp_month?: string;
		exp_year?: string;
		channel?: string;
		card_type?: string;
		bank?: string;
		brand?: string;
		reusable?: boolean;
	};
	metadata?: Record<string, any>;
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
			customer?: { email?: string };
			authorization?: PaystackVerifiedTransaction["authorization"];
			metadata?: { invoiceId?: string } & Record<string, any>;
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
		invoiceAmountCents: body.data.metadata?.invoiceAmountCents ?? body.data.metadata?.amountCents,
		customerEmail: body.data.customer?.email,
		authorization: body.data.authorization,
		metadata: body.data.metadata,
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

/** Fetch live transactions directly from the Paystack API. */
export async function listPaystackTransactions(params?: {
	perPage?: number;
	page?: number;
}): Promise<any[]> {
	const secretKey = await paystackSecretKey();
	const perPage = params?.perPage ?? 50;
	const page = params?.page ?? 1;
	const response = await fetch(`${PAYSTACK_API}/transaction?perPage=${perPage}&page=${page}`, {
		headers: {
			Authorization: `Bearer ${secretKey}`,
		},
	});
	const body = (await response.json()) as {
		status?: boolean;
		message?: string;
		data?: any[];
	};
	if (!response.ok || !body.status || !Array.isArray(body.data)) {
		throw new HttpError(
			502,
			"PAYMENT_GATEWAY_ERROR",
			`Could not fetch Paystack transactions${body.message ? `: ${body.message}` : "."}`,
		);
	}
	return body.data;
}

