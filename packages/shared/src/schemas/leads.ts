import { z } from "zod";

/**
 * CRM Lead Pipeline schemas.
 *
 * The 6 canonical stages match the backend `lead_stage` Postgres enum exactly.
 * The frontend uses these same keys as its `LeadStage` type.
 */

export const leadStageSchema = z.enum([
	"new",
	"contacted",
	"consultation_booked",
	"assessment_complete",
	"converted",
	"lost",
]);
export type LeadStage = z.infer<typeof leadStageSchema>;

/** Map from frontend snake_case stage to backend Title Case DB enum value. */
export const LEAD_STAGE_TO_DB: Record<LeadStage, string> = {
	new: "New Lead",
	contacted: "Contacted",
	consultation_booked: "Consultation Booked",
	assessment_complete: "Assessment Complete",
	converted: "Enrolled",
	lost: "Lost",
};

/** Map from backend DB enum value to frontend snake_case stage. */
export const LEAD_STAGE_FROM_DB: Record<string, LeadStage> = Object.fromEntries(
	Object.entries(LEAD_STAGE_TO_DB).map(([k, v]) => [v, k as LeadStage]),
) as Record<string, LeadStage>;

export const leadSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	email: z.string().email(),
	phone: z.string().nullable(),
	source: z.string(),
	stage: leadStageSchema,
	targetCountry: z.string().nullable(),
	assignedStaffId: z.string().uuid().nullable(),
	assignedStaffName: z.string().nullable().optional(),
	consultationId: z.string().uuid().nullable(),
	applicationId: z.string().uuid().nullable(),
	notes: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type ApiLead = z.infer<typeof leadSchema>;

export const leadListSchema = z.object({
	leads: z.array(leadSchema),
});

export const leadEventSchema = z.object({
	id: z.string().uuid(),
	leadId: z.string().uuid(),
	type: z.string(),
	actorName: z.string().nullable(),
	payload: z.any().nullable(),
	createdAt: z.string(),
});
export type LeadEvent = z.infer<typeof leadEventSchema>;

export const leadEventListSchema = z.object({
	events: z.array(leadEventSchema),
	total: z.number(),
});
