import { z } from "zod";

export const errorSchema = z.object({
	code: z.string(),
	message: z.string(),
});

export const errorResponseSchema = z.object({
	error: errorSchema,
	requestId: z.string(),
	timestamp: z.string().datetime(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
