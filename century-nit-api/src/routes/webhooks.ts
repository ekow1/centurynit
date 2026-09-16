import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { paystackWebhookSchema } from "century-nit-shared";
import { HttpError, validationHook } from "../middleware/error.js";
import { verifyPaystackSignature } from "../services/paystack.js";
import {
	getInvoice,
	paymentWithReferenceExists,
	serializeInvoice,
} from "../services/invoice.js";
import { getExchangeRate, settleInvoicePayment } from "../services/paymentSettlement.js";
import { applyResendEvent } from "../services/marketing.js";
import { env } from "../env.js";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Provider webhooks.
 *
 * Mounted outside the versioned `/api/v1` prefix: Paystack points a fixed URL
 * at this Worker and retries failures, so the contract must not move when our
 * own shape does. The secret-key signature check is the authentication — there
 * is deliberately no session middleware here.
 */
export const webhooksRouter = new OpenAPIHono({ defaultHook: validationHook });

const webhookBodySchema = z.unknown();

const paystackWebhookRoute = createRoute({
	method: "post",
	path: "/paystack",
	tags: ["Webhooks"],
	summary: "Paystack charge.webhook.deliverable",
	description:
		"Consumes Paystack `charge.success` events. Authenticated by the " +
		"`x-paystack-signature` header (HMAC-SHA512 of the raw body) — no session " +
		"is required. Returns 200 to stop retries even for events we do not act on.",
	request: {
		headers: z.object({
			"x-paystack-signature": z.string().optional(),
		}),
		body: { content: { "application/json": { schema: webhookBodySchema } } },
	},
	responses: {
		200: {
			description: "Webhook acknowledged.",
			content: { "application/json": { schema: z.object({ received: z.boolean() }) } },
		},
	},
});

webhooksRouter.openapi(paystackWebhookRoute, async (c) => {
	const rawBody = await c.req.text();
	const signature = c.req.header("x-paystack-signature") ?? null;
	if (!(await verifyPaystackSignature(rawBody, signature))) {
		throw new HttpError(401, "INVALID_WEBHOOK_SIGNATURE", "Webhook signature mismatch");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		throw new HttpError(400, "INVALID_WEBHOOK_BODY", "Webhook body is not valid JSON");
	}

	const event = paystackWebhookSchema.safeParse(parsed);
	if (!event.success) return c.json({ received: true }); // not something we consume

	if (event.data.event !== "charge.success") return c.json({ received: true });
	const reference = event.data.data?.reference;
	const invoiceId = event.data.data?.metadata?.invoiceId;
	const metadata = event.data.data?.metadata as Record<string, unknown> | undefined;
	const invoiceAmountCents = typeof metadata?.invoiceAmountCents === "number" ? metadata.invoiceAmountCents : undefined;
	const amountCents = event.data.data?.amount;
	if (!reference || !invoiceId) return c.json({ received: true });

	const invoice = await getInvoice(invoiceId);
	if (!invoice) return c.json({ received: true });
	if (!invoice.clientUserId) return c.json({ received: true });

	// Idempotency: a retried delivery must not double-charge the invoice.
	if (await paymentWithReferenceExists(invoiceId, reference)) {
		return c.json({ received: true });
	}
	const serialized = await serializeInvoice(invoice);
	if (serialized.balanceCents <= 0) return c.json({ received: true });

	const currency = event.data.data?.currency ?? "USD";
	const rate = await getExchangeRate();
	const amount = amountCents ?? serialized.balanceCents;
	const rawAmountCents =
		invoiceAmountCents ??
		(currency === "GHS" ? Math.round(amount / rate) : amount);
	const paid = Math.min(Math.max(rawAmountCents, 0), serialized.balanceCents);

	if (paid > 0) {
		await settleInvoicePayment({
			invoiceId,
			amountCents: paid,
			method: "card",
			gateway: "paystack",
			reference,
			currency,
			actor: { name: "Paystack Webhook", email: "payments@centurynit.com" },
		});
	}

	return c.json({ received: true });
});

/* ── Resend delivery webhook ─────────────────────────────────────────────── */
/* Resend signs webhooks the Svix way: HMAC-SHA256 of                       */
/* `${svix-id}.${svix-timestamp}.${rawBody}` with the whsec_ secret, sent as  */
/* `svix-signature: v1,<base64>` (possibly several space-separated sigs).    */

function verifySvixSignature(
	rawBody: string,
	msgId: string,
	timestamp: string,
	signatureHeader: string,
	secret: string,
): boolean {
	const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
	const key = Buffer.from(keyB64, "base64");
	const expected = createHmac("sha256", key)
		.update(`${msgId}.${timestamp}.${rawBody}`)
		.digest("base64");
	const expectedBuf = Buffer.from(expected);
	return signatureHeader
		.split(" ")
		.filter(Boolean)
		.some((part) => {
			const sig = part.startsWith("v1,") ? part.slice(3) : part;
			const sigBuf = Buffer.from(sig);
			return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
		});
}

const resendWebhookRoute = createRoute({
	method: "post",
	path: "/resend",
	tags: ["Webhooks"],
	summary: "Resend delivery events",
	description:
		"Consumes Resend `email.opened`/`email.bounced`/`email.complained` events " +
		"and stamps the matching campaign_recipients row via provider_message_id. " +
		"Authenticated by Svix signature headers — no session required.",
	request: {
		headers: z.object({
			"svix-id": z.string().optional(),
			"svix-timestamp": z.string().optional(),
			"svix-signature": z.string().optional(),
		}),
		body: { content: { "application/json": { schema: webhookBodySchema } } },
	},
	responses: {
		200: {
			description: "Webhook acknowledged.",
			content: { "application/json": { schema: z.object({ received: z.boolean() }) } },
		},
	},
});

webhooksRouter.openapi(resendWebhookRoute, async (c) => {
	const rawBody = await c.req.text();
	const secret = env.RESEND_WEBHOOK_SECRET;

	// Fail closed: an unverified delivery report is worse than none — a forged
	// "opened" would poison the report the operator reads.
	if (!secret) {
		throw new HttpError(503, "WEBHOOK_NOT_CONFIGURED", "RESEND_WEBHOOK_SECRET is not set");
	}
	const msgId = c.req.header("svix-id");
	const timestamp = c.req.header("svix-timestamp");
	const signature = c.req.header("svix-signature");
	if (!msgId || !timestamp || !signature) {
		throw new HttpError(401, "INVALID_WEBHOOK_SIGNATURE", "Missing Svix signature headers");
	}
	if (!verifySvixSignature(rawBody, msgId, timestamp, signature, secret)) {
		throw new HttpError(401, "INVALID_WEBHOOK_SIGNATURE", "Webhook signature mismatch");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		throw new HttpError(400, "INVALID_WEBHOOK_BODY", "Webhook body is not valid JSON");
	}
	const event = parsed as { type?: string; data?: { email_id?: string; created_at?: string } };
	if (typeof event.type !== "string") return c.json({ received: true });

	await applyResendEvent({ type: event.type, data: event.data });
	return c.json({ received: true });
});
