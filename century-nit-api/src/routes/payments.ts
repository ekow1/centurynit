import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	initializePaymentResponseSchema,
	initializePaymentSchema,
	paymentVerificationResultSchema,
} from "century-nit-shared";
import { env } from "../env.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import {
	initializePayment,
	processPaystackWebhook,
	verifyAndSettlePayment,
} from "../services/payments.js";

const verifyParams = z.object({ reference: z.string().min(1) });
const verifyQuery = z.object({ gateway: z.enum(["paystack", "stripe"]).default("paystack") });

export const paymentsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── POST /api/v1/payments/initialize ───────────────────────────────────────── */

paymentsRouter.openapi(
	createRoute({
		method: "post",
		path: "/initialize",
		tags: ["Payments"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: initializePaymentSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: initializePaymentResponseSchema } },
				description: "Payment initialized with gateway checkout URL",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const body = c.req.valid("json");
		const res = await initializePayment(user, body, env.FRONTEND_URL);
		return c.json(res);
	},
);

/* ── GET /api/v1/payments/verify/:reference ─────────────────────────────────── */

paymentsRouter.openapi(
	createRoute({
		method: "get",
		path: "/verify/{reference}",
		tags: ["Payments"],
		request: {
			params: verifyParams,
			query: verifyQuery,
		},
		responses: {
			200: {
				content: { "application/json": { schema: paymentVerificationResultSchema } },
				description: "Payment verification result",
			},
		},
	}),
	async (c) => {
		const { reference } = c.req.valid("param");
		const { gateway } = c.req.valid("query");
		const res = await verifyAndSettlePayment(reference, gateway);
		return c.json(res);
	},
);

/* ── POST /api/v1/payments/webhooks/paystack ────────────────────────────────── */

paymentsRouter.openapi(
	createRoute({
		method: "post",
		path: "/webhooks/paystack",
		tags: ["Payments"],
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ status: z.string() }) } },
				description: "Webhook received",
			},
		},
	}),
	async (c) => {
		const rawBody = await c.req.text();
		const signature = c.req.header("x-paystack-signature") || "";
		await processPaystackWebhook(rawBody, signature);
		return c.json({ status: "success" });
	},
);
