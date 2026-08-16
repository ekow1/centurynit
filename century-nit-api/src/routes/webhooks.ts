import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { paystackWebhookSchema } from "century-nit-shared";
import { HttpError } from "../middleware/error.js";
import { verifyPaystackSignature } from "../services/paystack.js";
import {
	getInvoice,
	paymentWithReferenceExists,
	recordClientPayment,
	serializeInvoice,
} from "../services/invoice.js";

/**
 * Provider webhooks.
 *
 * Mounted outside the versioned `/api/v1` prefix: Paystack points a fixed URL
 * at this Worker and retries failures, so the contract must not move when our
 * own shape does. The secret-key signature check is the authentication — there
 * is deliberately no session middleware here.
 */
export const webhooksRouter = new OpenAPIHono();

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

	const paid = amountCents && amountCents > 0 ? amountCents : serialized.balanceCents;
	await recordClientPayment({
		invoiceId,
		userId: invoice.clientUserId,
		userName: invoice.applicantName,
		userEmail: invoice.applicantEmail ?? "applicant@century-nit.com",
		amountCents: paid,
		method: "card",
		gateway: "paystack",
		reference,
	});

	return c.json({ received: true });
});
