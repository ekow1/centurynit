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

export const lookupValueSchema = z.object({
	id: z.string().uuid(),
	category: z.string(),
	value: z.string(),
	label: z.string(),
	sortOrder: z.number(),
	isActive: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type LookupValue = z.infer<typeof lookupValueSchema>;

export const lookupListResponseSchema = z.object({
	lookups: z.array(lookupValueSchema),
});

export type LookupListResponse = z.infer<typeof lookupListResponseSchema>;


export const lookupUpsertSchema = z.object({
	category: z.string().min(1),
	value: z.string().min(1),
	label: z.string().min(1),
	sortOrder: z.number().int(),
	isActive: z.boolean(),
});
export type LookupUpsert = z.infer<typeof lookupUpsertSchema>;

