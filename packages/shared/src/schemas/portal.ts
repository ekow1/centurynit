import { z } from "zod";

/* ── Pre-departure checklist ──────────────────────────────────────────────── */

/*
 * `category` and `detail` are optional rather than required: the previous
 * version of this schema omitted them, and z.object strips unknown keys, so
 * every task persisted before the fix is missing both. Requiring them would
 * reject the round-trip of that data. The portal re-hydrates missing fields
 * from the PRE_DEPARTURE_TASKS seed by id.
 */
const preDepartureTaskSchema = z.object({
	id: z.string(),
	category: z.enum(["travel", "accommodation", "documents", "health", "finance", "orientation"]).optional(),
	label: z.string(),
	detail: z.string().optional(),
	done: z.boolean(),
});

/* ── Post-arrival payment schedule ────────────────────────────────────────── */

const postArrivalScheduleSchema = z.object({
	id: z.string(),
	label: z.string(),
	detail: z.string(),
	payments: z.number().int(),
	intervalDays: z.number().int(),
	graceDays: z.number().int(),
});

/* ── Portal state (persisted as JSONB on applicants table) ────────────────── */

export const portalStateSchema = z.object({
	preDepartureTasks: z.array(preDepartureTaskSchema).optional(),
	postArrivalScheduleId: z.string().nullable().optional(),
	enabledPostArrivalSchedules: z.array(z.string()).nullable().optional(),
	customPostArrivalSchedules: z.array(postArrivalScheduleSchema).optional(),
});
export type PortalState = z.infer<typeof portalStateSchema>;

export const updatePortalStateSchema = z.object({
	preDepartureTasks: z.array(preDepartureTaskSchema).optional(),
	postArrivalScheduleId: z.string().nullable().optional(),
	enabledPostArrivalSchedules: z.array(z.string()).nullable().optional(),
	customPostArrivalSchedules: z.array(postArrivalScheduleSchema).optional(),
});
export type UpdatePortalState = z.infer<typeof updatePortalStateSchema>;

/* ── In-app notification ──────────────────────────────────────────────────── */

export const notificationSchema = z.object({
	id: z.string().uuid(),
	type: z.string(),
	title: z.string(),
	body: z.string(),
	link: z.string().nullable().optional(),
	read: z.boolean(),
	createdAt: z.string().datetime(),
});
export type ApiNotification = z.infer<typeof notificationSchema>;
