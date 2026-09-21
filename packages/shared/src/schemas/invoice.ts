import { z } from "zod";

/**
 * Invoice schemas. Shared by the API (validation + OpenAPI) and both
 * frontends (types).
 *
 * Money is **integer cents in USD** everywhere (API_MIGRATION_PLAN.md §3).
 * The `"GH₵45,000 / $3,000"` → `450003000` bug is why: never a formatted
 * string, never a float.
 *
 * "overdue" is a *derived* status. The database stores only issued / partial /
 * paid / void, and the server computes overdue from `dueAt` and the balance at
 * read time, so a paid-late invoice can never get stuck in a stale status.
 */

export const invoiceTypeSchema = z.enum([
	"application",
	"visa",
	"consultation",
	"agency",
	"travel",
	"custom",
]);

/** What the database stores. */
export const invoiceStoredStatusSchema = z.enum(["proforma", "issued", "partial", "paid", "void"]);

/** What responses carry. Stored status plus the derived "overdue". */
export const invoiceStatusSchema = z.enum(["proforma", "issued", "partial", "paid", "overdue", "void"]);

/** A single invoice line at creation. Amounts are integer cents. */
export const invoiceLineInputSchema = z.object({
	label: z.string().min(1).max(200),
	detail: z.string().max(500).optional(),
	amountCents: z.number().int().min(0).max(100_000_000),
	/** The school this line bills, on application invoices. */
	schoolApplicationId: z.string().uuid().nullable().optional(),
});

/** Accepts ISO datetime (2026-09-15T00:00:00Z), date-only (2026-09-15), or empty/null. */
export const invoiceDueAtSchema = z
	.union([
		z.string().datetime(),
		z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (expected YYYY-MM-DD)"),
		z.literal(""),
	])
	.nullable()
	.optional();

export const createInvoiceSchema = z.object({
	applicantName: z.string().min(1).max(200),
	applicantEmail: z.string().email().optional(),
	/** The applicant's login id, when known. Lets the portal show it later. */
	clientUserId: z.string().min(1).optional(),
	applicationId: z.string().uuid().optional(),
	type: invoiceTypeSchema.default("custom"),
	status: invoiceStoredStatusSchema.default("issued"),
	lines: z.array(invoiceLineInputSchema).min(1).max(50),
	note: z.string().max(2000).optional(),
	dueAt: invoiceDueAtSchema,
});

export const recordPaymentSchema = z.object({
	amountCents: z.number().int().positive().max(100_000_000),
	method: z.string().min(1).max(48),
	gateway: z.string().max(48).optional(),
	reference: z.string().max(64).optional(),
});

export const voidInvoiceSchema = z.object({
	reason: z.string().min(3).max(500),
});

export const creditInvoiceSchema = z.object({
	amountCents: z.number().int().positive().max(100_000_000),
	reason: z.string().min(3).max(500),
});

/** Staff action: review a proforma estimate and issue it as a real invoice. */
export const issueProformaSchema = z.object({
	/** Staff can adjust the line items before issuing. */
	lines: z.array(invoiceLineInputSchema).min(1).max(50),
	note: z.string().max(2000).optional(),
	dueAt: invoiceDueAtSchema,
});

export const listInvoicesQuerySchema = z.object({
	status: invoiceStatusSchema.optional(),
	type: invoiceTypeSchema.optional(),
	/** Only invoices raised on this application (all types). */
	applicationId: z.string().uuid().optional(),
	/** Matches invoice number or applicant name, case-insensitively. */
	q: z.string().max(120).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Paystack checkout for an applicant paying one of their own invoices.
 *
 * The server derives the amount from the invoice balance. The client never
 * picks a price. And returns the Paystack hosted checkout URL to redirect to.
 */
export const paystackCheckoutSchema = z.object({
	authorizationUrl: z.string().url(),
	reference: z.string(),
	amountCents: z.number().int(),
	/** Lets PaystackPop.resumeTransaction open this transaction inline, no redirect. */
	accessCode: z.string().optional(),
});

/** The public key the portal needs to open Paystack's inline checkout. */
export const paystackConfigSchema = z.object({
	publicKey: z.string().nullable(),
});

/** Ghana Mobile Money networks Paystack's /charge endpoint accepts. */
export const MOMO_PROVIDERS = ["mtn", "vod", "atl"] as const;
export type MomoProvider = (typeof MOMO_PROVIDERS)[number];

/** Start a Mobile Money charge against an invoice's outstanding balance. */
export const momoChargeSchema = z.object({
	phone: z.string().min(7).max(20),
	provider: z.enum(MOMO_PROVIDERS),
});

export const momoChargeResponseSchema = z.object({
	reference: z.string(),
	/** Paystack charge status: pending | send_otp | success | failed | … */
	status: z.string(),
	/** Paystack's customer-facing instruction when it gives one. */
	displayText: z.string().nullable(),
	amountCents: z.number().int(),
});

/** Submit the OTP a MoMo provider asks for after the initial charge. */
export const momoOtpSchema = z.object({
	reference: z.string().min(1).max(200),
	otp: z.string().min(3).max(10),
});

/** Verify a Paystack transaction reference against an invoice. */
export const paystackVerifySchema = z.object({
	reference: z.string().min(1).max(200),
});

/** Paystack webhook `charge.success` payload, the only shape we consume. */
export const paystackWebhookSchema = z.object({
	event: z.string(),
	data: z
		.object({
			reference: z.string().optional(),
			amount: z.number().int().optional(),
			currency: z.string().optional(),
			metadata: z
				.object({
					invoiceId: z.string().optional(),
				})
				.optional(),
		})
		.optional(),
});

/* Responses */

export const invoiceLineSchema = z.object({
	id: z.string().uuid(),
	label: z.string(),
	detail: z.string().nullable(),
	amountCents: z.number().int(),
	schoolApplicationId: z.string().uuid().nullable().optional(),
	/** When this line falls due. Stamped when its `dueOn` event fires, or dated on a post-arrival instalment. */
	dueAt: z.string().datetime().nullable().optional(),
	/** The case event that makes this line due; null on lines raised by hand. */
	dueOn: z.string().nullable().optional(),
});

/**
 * The next thing to pay on a milestone invoice: the first line the payments
 * have not covered, less whatever of it already is. Never the balance —
 * a client pays one milestone at a time.
 */
export const invoiceNextDueSchema = z.object({
	label: z.string(),
	amountCents: z.number().int(),
	dueOn: z.string().nullable(),
	dueAt: z.string().datetime().nullable(),
	/** What is still owed after this milestone. */
	remainingCents: z.number().int(),
});

export const invoicePaymentSchema = z.object({
	id: z.string().uuid(),
	amountCents: z.number().int(),
	method: z.string(),
	gateway: z.string().nullable(),
	reference: z.string().nullable(),
	recordedByName: z.string(),
	at: z.string().datetime(),
});

export const invoiceEventSchema = z.object({
	id: z.string().uuid(),
	action: z.string(),
	actor: z.string().nullable(),
	detail: z.string().nullable(),
	at: z.string().datetime(),
});

export const invoiceSchema = z.object({
	id: z.string().uuid(),
	invoiceNumber: z.string(),
	status: invoiceStatusSchema,
	type: invoiceTypeSchema,
	applicantName: z.string(),
	applicantEmail: z.string().nullable(),
	clientUserId: z.string().nullable(),
	applicationId: z.string().uuid().nullable(),
	lines: z.array(invoiceLineSchema),
	subtotalCents: z.number().int(),
	paidCents: z.number().int(),
	creditedCents: z.number().int(),
	balanceCents: z.number().int(),
	/** The next milestone to pay, when the invoice is paid in milestones; null on a one-line invoice or a settled one. */
	nextDue: invoiceNextDueSchema.nullable().optional(),
	note: z.string().nullable(),
	/** Who raised it. The chapter owner, the client via the portal, or "System". */
	raisedByName: z.string().nullable(),
	raisedAt: z.string().datetime(),
	/** Who issued (approved) it. Equals the raiser until approval. */
	issuedByName: z.string(),
	reviewedByName: z.string().nullable(),
	reviewedAt: z.string().datetime().nullable(),
	dueAt: z.string().datetime().nullable(),
	voidedAt: z.string().datetime().nullable(),
	voidReason: z.string().nullable(),
	payments: z.array(invoicePaymentSchema),
	history: z.array(invoiceEventSchema),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const invoiceListSchema = z.object({
	invoices: z.array(invoiceSchema),
	total: z.number().int(),
});

/* Declared below invoiceSchema so the field is a plain reference — zod-to-openapi
 * cannot document z.lazy, and there is no real cycle to break. */
/** Poll for the outcome of a MoMo charge — settles the invoice on success. */
export const momoStatusResponseSchema = z.object({
	status: z.string(),
	settled: z.boolean(),
	invoice: invoiceSchema.optional(),
	displayText: z.string().nullable().optional(),
});

/** Result of verifying a Paystack transaction against an invoice. */
export const paystackVerifyResponseSchema = z.object({
	invoice: invoiceSchema,
});

export type InvoiceType = z.infer<typeof invoiceTypeSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type InvoiceStoredStatus = z.infer<typeof invoiceStoredStatusSchema>;
export type CreateInvoice = z.infer<typeof createInvoiceSchema>;
export type IssueProforma = z.infer<typeof issueProformaSchema>;
export type RecordPayment = z.infer<typeof recordPaymentSchema>;
export type VoidInvoice = z.infer<typeof voidInvoiceSchema>;
export type CreditInvoice = z.infer<typeof creditInvoiceSchema>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;
export type InvoicePaymentRecord = z.infer<typeof invoicePaymentSchema>;
export type InvoiceEventRecord = z.infer<typeof invoiceEventSchema>;
export type ApiInvoice = z.infer<typeof invoiceSchema>;
export type PaystackCheckout = z.infer<typeof paystackCheckoutSchema>;
export type PaystackConfig = z.infer<typeof paystackConfigSchema>;
export type MomoCharge = z.infer<typeof momoChargeSchema>;
export type MomoChargeResponse = z.infer<typeof momoChargeResponseSchema>;
export type MomoOtp = z.infer<typeof momoOtpSchema>;
export type MomoStatusResponse = z.infer<typeof momoStatusResponseSchema>;
export type PaystackVerify = z.infer<typeof paystackVerifySchema>;
export type PaystackVerifyResponse = z.infer<typeof paystackVerifyResponseSchema>;
export type PaystackWebhook = z.infer<typeof paystackWebhookSchema>;
