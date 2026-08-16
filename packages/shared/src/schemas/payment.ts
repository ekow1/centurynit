import { z } from "zod";

export const paymentGatewayEnum = z.enum(["paystack", "stripe"]);
export type PaymentGateway = z.infer<typeof paymentGatewayEnum>;

export const initializePaymentSchema = z.object({
	invoiceId: z.string().uuid(),
	gateway: paymentGatewayEnum.default("paystack"),
	callbackUrl: z.string().url().optional(),
});
export type InitializePayment = z.infer<typeof initializePaymentSchema>;

export const initializePaymentResponseSchema = z.object({
	authorizationUrl: z.string().url(),
	reference: z.string(),
	gateway: paymentGatewayEnum,
	amountCents: z.number().int(),
	currency: z.string(),
});
export type InitializePaymentResponse = z.infer<typeof initializePaymentResponseSchema>;

export const verifyPaymentSchema = z.object({
	reference: z.string().min(1).max(200),
	gateway: paymentGatewayEnum.optional(),
});
export type VerifyPayment = z.infer<typeof verifyPaymentSchema>;

export const paymentVerificationResultSchema = z.object({
	success: z.boolean(),
	status: z.string(),
	reference: z.string(),
	amountCents: z.number().int(),
	currency: z.string(),
	invoiceId: z.string().uuid().optional(),
	paidAt: z.string().datetime().optional(),
});
export type PaymentVerificationResult = z.infer<typeof paymentVerificationResultSchema>;
