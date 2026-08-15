import { z } from "zod";

export const healthResponseSchema = z.object({
	status: z.string(),
	database: z.enum(["connected", "unavailable"]),
	timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
