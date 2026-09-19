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

/** Map from backend DB enum value (or already-normalized snake_case) to frontend snake_case stage. */
export const LEAD_STAGE_FROM_DB: Record<string, LeadStage> = {
	...Object.fromEntries(
		Object.entries(LEAD_STAGE_TO_DB).map(([k, v]) => [v, k as LeadStage]),
	),
	new: "new",
	contacted: "contacted",
	consultation_booked: "consultation_booked",
	assessment_complete: "assessment_complete",
	converted: "converted",
	lost: "lost",
};

/* ── Touch log ──────────────────────────────────────────────────────────── */

/** How a human reached the lead — "note" is a record touch, not client contact. */
export const leadTouchChannelSchema = z.enum(["call", "whatsapp", "email", "visit", "note"]);
export type LeadTouchChannel = z.infer<typeof leadTouchChannelSchema>;

export const LEAD_TOUCH_CHANNEL_LABELS: Record<LeadTouchChannel, string> = {
	call: "Call",
	whatsapp: "WhatsApp",
	email: "Email",
	visit: "Visit",
	note: "Note",
};

export const leadTouchOutcomeSchema = z.enum([
	"reached",
	"no_answer",
	"left_message",
	"promised_callback",
]);
export type LeadTouchOutcome = z.infer<typeof leadTouchOutcomeSchema>;

export const LEAD_TOUCH_OUTCOME_LABELS: Record<LeadTouchOutcome, string> = {
	reached: "Reached",
	no_answer: "No answer",
	left_message: "Left message",
	promised_callback: "Promised callback",
};

export const logLeadTouchSchema = z.object({
	channel: leadTouchChannelSchema,
	outcome: leadTouchOutcomeSchema.optional(),
	/** What happened — the story the next handler reads. */
	body: z.string().max(4000).optional(),
	/** Optionally schedule the follow-up in the same breath. */
	followUp: z
		.object({
			title: z.string().min(1).max(200),
			dueAt: z.string(),
			assigneeOpsUserId: z.string().uuid().optional(),
		})
		.optional(),
});
export type LogLeadTouch = z.infer<typeof logLeadTouchSchema>;

/* ── Lost reasons ────────────────────────────────────────────────────────── */

export const leadLostReasonSchema = z.enum([
	"no_response",
	"cost",
	"competitor",
	"not_eligible",
	"changed_plans",
	"other",
]);
export type LeadLostReason = z.infer<typeof leadLostReasonSchema>;

export const LEAD_LOST_REASON_LABELS: Record<LeadLostReason, string> = {
	no_response: "No response",
	cost: "Cost",
	competitor: "Chose another agency",
	not_eligible: "Not eligible",
	changed_plans: "Changed plans",
	other: "Other",
};

/* ── Staff tasks ─────────────────────────────────────────────────────────── */

export const opsTaskSchema = z.object({
	id: z.string().uuid(),
	title: z.string(),
	note: z.string().nullable(),
	dueAt: z.string(),
	assigneeOpsUserId: z.string().uuid().nullable(),
	assigneeName: z.string().nullable(),
	createdByOpsUserId: z.string().uuid().nullable(),
	createdByName: z.string().nullable(),
	leadId: z.string().uuid().nullable(),
	leadName: z.string().nullable(),
	applicationId: z.string().uuid().nullable(),
	applicationRef: z.string().nullable(),
	doneAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type ApiOpsTask = z.infer<typeof opsTaskSchema>;

export const opsTaskListSchema = z.object({ tasks: z.array(opsTaskSchema) });

export const createOpsTaskSchema = z.object({
	title: z.string().min(1).max(200),
	note: z.string().max(4000).optional(),
	dueAt: z.string(),
	assigneeOpsUserId: z.string().uuid().optional(),
	leadId: z.string().uuid().optional(),
	applicationId: z.string().uuid().optional(),
});
export type CreateOpsTask = z.infer<typeof createOpsTaskSchema>;

export const updateOpsTaskSchema = z.object({
	title: z.string().min(1).max(200).optional(),
	note: z.string().max(4000).nullable().optional(),
	dueAt: z.string().optional(),
	assigneeOpsUserId: z.string().uuid().nullable().optional(),
	done: z.boolean().optional(),
});
export type UpdateOpsTask = z.infer<typeof updateOpsTaskSchema>;

/* ── The lead ─────────────────────────────────────────────────────────────── */

export const leadSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	email: z.string().email(),
	phone: z.string().nullable(),
	source: z.string(),
	stage: leadStageSchema,
	targetCountry: z.string().nullable(),
	country: z.string().nullable().optional(),
	assignedStaffId: z.string().uuid().nullable(),
	assignedStaffName: z.string().nullable().optional(),
	assignedTo: z.string().nullable().optional(),
	/**
	 * Any edit to the record — kept for "record edited" honesty, but the
	 * cold/warm bands read `lastClientTouchAt` instead.
	 */
	lastContactAt: z.string().nullable().optional(),
	/** The last human touch of the client — calls, WhatsApp, visits, inbound replies. */
	lastClientTouchAt: z.string().nullable().optional(),
	lostReason: leadLostReasonSchema.nullable().optional(),
	lostNote: z.string().nullable().optional(),
	/** The next open follow-up on this lead, if one exists. */
	nextTask: z
		.object({ id: z.string().uuid(), title: z.string(), dueAt: z.string() })
		.nullable()
		.optional(),
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
