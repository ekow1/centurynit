import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
	type WeeklySlotSchedule,
	type WeeklySlotScheduleDay,
	writeSetting,
} from "../services/settings.js";
import { minutesToTime, timeToMinutes } from "../lib/time.js";

/**
 * Scheduling configuration — per-weekday branch consultation slots.
 *
 * This is intentionally separate from the general "settings" module because it
 * should be editable by Operations Managers and System Administrators, not
 * only super admins. Consultants/coordinators do not reach this route.
 */

const schedulingRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

const scheduleDaySchema = z.object({
	dayOfWeek: z.number().int().min(0).max(6),
	enabled: z.boolean(),
	slotsPerDay: z.coerce.number().int().min(1).max(48),
	openStart: timeStringSchema,
	openEnd: timeStringSchema,
});

const schedulingResponseSchema = z.object({
	timezone: z.string(),
	days: z.array(
		z.object({
			dayOfWeek: z.number().int(),
			enabled: z.boolean(),
			slotsPerDay: z.number().int(),
			openStart: timeStringSchema,
			openEnd: timeStringSchema,
			preview: z.array(timeStringSchema),
		}),
	),
});

const updateSchedulingSchema = z.object({
	timezone: z.string().min(1),
	days: z.array(scheduleDaySchema).length(7),
});

function computePreview(start: string, end: string, count: number): string[] {
	const startMin = timeToMinutes(start);
	const endMin = timeToMinutes(end);
	const total = endMin - startMin;
	if (total <= 0 || count <= 0) return [];
	const step = Math.floor(total / count);
	if (step <= 0) return [minutesToTime(startMin)];
	const times: string[] = [];
	for (let i = 0; i < count; i++) {
		times.push(minutesToTime(startMin + i * step));
	}
	return times;
}

function dayResponse(day: WeeklySlotScheduleDay) {
	return {
		...day,
		preview: day.enabled ? computePreview(day.openStart, day.openEnd, day.slotsPerDay) : [],
	};
}

async function readSchedulingConfig(schedule: WeeklySlotSchedule): Promise<{
	timezone: string;
	days: (WeeklySlotScheduleDay & { preview: string[] })[];
}> {
	return {
		timezone: schedule.timezone,
		days: schedule.days.map((d) => dayResponse(d)),
	};
}

function validateSchedule(schedule: WeeklySlotSchedule) {
	const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	for (const day of schedule.days) {
		if (!day.enabled) continue;
		if (timeToMinutes(day.openEnd) <= timeToMinutes(day.openStart)) {
			throw new HttpError(
				400,
				"BAD_REQUEST",
				`${days[day.dayOfWeek]} closing time must be after opening time`,
			);
		}
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
