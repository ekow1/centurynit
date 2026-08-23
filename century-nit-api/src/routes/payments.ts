import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
	initializePaymentResponseSchema,
	initializePaymentSchema,
	paymentVerificationResultSchema,
} from "century-nit-shared";
import { env } from "../env.js";
import { requireAuth, requireModule, type AuthVariables } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { db } from "../db/index.js";
import { paymentTransactions, bookings as bookingsTable, users } from "../db/schema.js";
import {
	initializePayment,
	processPaystackWebhook,
	verifyAndSettlePayment,
} from "../services/payments.js";
import { listPaystackTransactions, verifyPaystackTransaction } from "../services/paystack.js";
import { createBooking } from "../services/booking.js";
import { createConsultationInvoice } from "../services/invoice.js";
import { ensureCaseForBooking } from "../services/cases.js";
import { resolveServiceName } from "../services/availability.js";
import { zonedTimeToUtc } from "../lib/time.js";

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

/* ── GET /api/v1/payments/paystack/transactions ────────────────────────────── */

paymentsRouter.openapi(
	createRoute({
		method: "get",
		path: "/paystack/transactions",
		tags: ["Payments"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ status: z.boolean(), data: z.array(z.any()) }) } },
				description: "Live transactions list from Paystack",
			},
		},
	}),
	async (c) => {
		try {
			const data = await listPaystackTransactions({ perPage: 100 });
			return c.json({ status: true, data });
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Could not fetch Paystack transactions";
			return c.json({ status: false, data: [], error: msg });
		}
	},
);

/* ── POST /api/v1/payments/reconcile-paystack ──────────────────────────────── */

const reconcileSchema = z.object({ reference: z.string().min(1) });

paymentsRouter.openapi(
	createRoute({
		method: "post",
		path: "/reconcile-paystack",
		tags: ["Payments"],
		middleware: [requireAuth, requireModule("payments")] as const,
		request: {
			body: {
				content: { "application/json": { schema: reconcileSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							reconciled: z.boolean(),
							reference: z.string(),
							status: z.string(),
							bookingId: z.string().nullable(),
							invoiceId: z.string().nullable(),
							message: z.string(),
						}),
					},
				},
				description: "Reconciliation result",
			},
		},
	}),
	async (c) => {
		const { reference } = c.req.valid("json");

		// 1. Already recorded in our payment ledger? Nothing to do.
		const [existingTx] = await db
			.select()
			.from(paymentTransactions)
			.where(eq(paymentTransactions.reference, reference))
			.limit(1);
		if (existingTx && existingTx.status === "success") {
			return c.json({
				reconciled: false,
				reference,
				status: "already_recorded",
				bookingId: null,
				invoiceId: existingTx.invoiceId,
				message: "Transaction was already recorded in the payment ledger.",
			});
		}

		// 2. Verify with Paystack.
		const txn = await verifyPaystackTransaction(reference);
		if (txn.status !== "success") {
			throw new HttpError(400, "PAYMENT_NOT_SUCCESSFUL", `Paystack status: ${txn.status}`);
		}

		// 3. Consultation booking flow — metadata carries bookingPayload.
		const bookingPayload = txn.metadata?.bookingPayload;
		if (bookingPayload && bookingPayload.serviceId && bookingPayload.date && bookingPayload.time) {
			// Resolve the client user from Paystack's customer email — the original
			// session user isn't available here because this is a staff-initiated
			// reconciliation, not the applicant's own callback.
			if (!txn.customerEmail) {
				throw new HttpError(
					404,
					"USER_NOT_FOUND",
					"Paystack did not return a customer email for this transaction. Cannot resolve the user.",
				);
			}
			const [userRow] = await db
				.select()
				.from(users)
				.where(eq(users.email, txn.customerEmail))
				.limit(1);
			if (!userRow) {
				throw new HttpError(
					404,
					"USER_NOT_FOUND",
					`No user found with email ${txn.customerEmail}. Ensure the Paystack customer email matches a registered user.`,
				);
			}

			const startsAt = zonedTimeToUtc(
				bookingPayload.date,
				bookingPayload.time,
				bookingPayload.timezone,
			);

			// Idempotency: a booking may already exist for this client + slot.
			const [existingBooking] = await db
				.select()
				.from(bookingsTable)
				.where(
					and(
						eq(bookingsTable.clientUserId, userRow.id),
						eq(bookingsTable.serviceId, bookingPayload.serviceId),
						eq(bookingsTable.startsAt, startsAt),
					),
				)
				.limit(1);

			let bookingId: string | null = null;
			let invoiceId: string | null = null;

			if (existingBooking) {
				bookingId = existingBooking.id;
			} else {
				const serviceName = resolveServiceName(bookingPayload.serviceId);
				const booking = await createBooking({
					data: bookingPayload,
					client: {
						id: userRow.id,
						name: userRow.name ?? userRow.email,
						email: userRow.email,
					},
					serviceName,
				});
				bookingId = booking.id;

				if (bookingPayload.serviceId === "consultation") {
					await ensureCaseForBooking({
						id: booking.id,
						reference: booking.reference,
						clientUserId: userRow.id,
						clientName: userRow.name ?? userRow.email,
						clientEmail: userRow.email,
						clientPhone: booking.clientPhone ?? null,
						branchId: booking.branchId,
						type: booking.type,
					});
					const invoice = await createConsultationInvoice({
						clientUserId: userRow.id,
						applicantName: userRow.name ?? userRow.email,
						applicantEmail: userRow.email,
						bookingId: booking.id,
						reference: booking.reference,
						amountCents: txn.amountCents,
						issuedBy: "Reconciliation",
					});
					invoiceId = invoice.id;
				}
			}

			// If we have an invoice (newly created or pre-existing), make sure the
			// payment_transactions row exists.
			if (invoiceId) {
				await db
					.insert(paymentTransactions)
					.values({
						invoiceId,
						clientUserId: userRow.id,
						reference,
						gateway: "paystack",
						amountCents: txn.amountCents,
						currency: txn.currency,
						status: "success",
						paidAt: new Date(),
					})
					.onConflictDoNothing({ target: paymentTransactions.reference });
			}

			return c.json({
				reconciled: true,
				reference,
				status: "success",
				bookingId,
				invoiceId,
				message: existingBooking
					? "Linked existing booking and recorded the payment transaction."
					: "Created booking, invoice, and payment transaction from the Paystack record.",
			});
		}

		// 4. Invoice payment flow — metadata carries invoiceId.
		const invoiceId: string | undefined = txn.metadata?.invoiceId;
		if (invoiceId) {
			await verifyAndSettlePayment(reference, "paystack");
			return c.json({
				reconciled: true,
				reference,
				status: "success",
				bookingId: null,
				invoiceId,
				message: "Settled the invoice against the verified Paystack transaction.",
			});
		}

		// 5. No recognizable metadata — can't reconcile automatically.
		throw new HttpError(
			422,
			"UNRECOGNIZED_TRANSACTION",
			"This Paystack transaction has no booking payload or invoice id in its metadata. Record it manually.",
		);
	},
);

