import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
	type WeeklySlotSchedule,
	type WeeklySlotScheduleDay,
	effectiveDayValues,
	writeSetting,
} from "../services/settings.js";
import { validateScheduleConfig, generateSlots } from "century-nit-shared";

/**
 * Scheduling configuration — per-weekday branch consultation slots.
 *
 * This is intentionally separate from the general "settings" module because it
 * should be editable by Operations Managers and System Administrators, not
 * only super admins. Consultants/coordinators do not reach this route.
 */

const schedulingRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

const generalSchema = z.object({
	openStart: timeStringSchema,
	openEnd: timeStringSchema,
	intervalMinutes: z.coerce.number().int().min(5).max(480),
	maxSlotsPerDay: z.coerce.number().int().min(0).max(48).nullable(),
});

const scheduleDaySchema = z.object({
	dayOfWeek: z.number().int().min(0).max(6),
	customEnabled: z.boolean(),
	openStart: timeStringSchema,
	openEnd: timeStringSchema,
	intervalMinutes: z.coerce.number().int().min(5).max(480),
	maxSlotsPerDay: z.coerce.number().int().min(0).max(48).nullable(),
});

const schedulingResponseSchema = z.object({
	timezone: z.string(),
	general: generalSchema,
	days: z.array(
		z.object({
			dayOfWeek: z.number().int(),
			customEnabled: z.boolean(),
			openStart: timeStringSchema,
			openEnd: timeStringSchema,
			intervalMinutes: z.number().int(),
			maxSlotsPerDay: z.number().int().nullable(),
			preview: z.array(timeStringSchema),
		}),
	),
});

const updateSchedulingSchema = z.object({
	timezone: z.string().min(1),
	general: generalSchema,
	days: z.array(scheduleDaySchema).length(7),
});

function dayResponse(day: WeeklySlotScheduleDay, general: WeeklySlotSchedule["general"]) {
	const eff = effectiveDayValues(day, general);
	return {
		...day,
		preview: generateSlots(eff.openStart, eff.openEnd, eff.intervalMinutes, eff.maxSlotsPerDay),
	};
}

async function readSchedulingConfig(schedule: WeeklySlotSchedule): Promise<{
	timezone: string;
	general: WeeklySlotSchedule["general"];
	days: (WeeklySlotScheduleDay & { preview: string[] })[];
}> {
	return {
		timezone: schedule.timezone,
		general: schedule.general,
		days: schedule.days.map((d: WeeklySlotScheduleDay) => dayResponse(d, schedule.general)),
	};
}

function validateSchedule(schedule: WeeklySlotSchedule) {
	const error = validateScheduleConfig(schedule.general, schedule.days);
	if (error) {
		throw new HttpError(400, "BAD_REQUEST", error.message);
	}
}

/* ── GET /api/v1/scheduling ───────────────────────────────────────────────── */

schedulingRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Scheduling"],
		summary: "Read per-weekday consultation slot configuration",
		middleware: [requireAuth, requireMfa, requireModule("scheduling")] as const,
		responses: {
			200: {
				description: "Current weekly scheduling configuration",
				content: { "application/json": { schema: schedulingResponseSchema } },
			},
		},
	}),
	async (c) => {
		const { weeklySlotSchedule } = await import("../services/settings.js");
		const schedule = await weeklySlotSchedule();
		const config = await readSchedulingConfig(schedule);
		return c.json(config);
	},
);

/* ── PUT /api/v1/scheduling ───────────────────────────────────────────────── */

schedulingRouter.openapi(
	createRoute({
		method: "put",
		path: "/",
		tags: ["Scheduling"],
		summary: "Update per-weekday consultation slot configuration",
		middleware: [requireAuth, requireMfa, requireModule("scheduling")] as const,
		request: {
			body: {
				content: { "application/json": { schema: updateSchedulingSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				description: "Updated scheduling configuration",
				content: { "application/json": { schema: schedulingResponseSchema } },
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json" as never) as z.infer<typeof updateSchedulingSchema>;
		const staff = c.get("staff");
		if (!staff) {
			throw new HttpError(403, "FORBIDDEN", "Staff access required");
		}

		const schedule: WeeklySlotSchedule = {
			timezone: body.timezone,
			general: body.general,
			days: body.days,
		};
		validateSchedule(schedule);

		const actor = { opsUserId: staff.opsUserId, email: staff.email };
		await writeSetting("WEEKLY_SLOT_SCHEDULE", JSON.stringify(schedule), actor);

		const config = await readSchedulingConfig(schedule);
		return c.json(config);
	},
);

export { schedulingRouter };
