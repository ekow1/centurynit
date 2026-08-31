import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
	branchOpenEnd,
	branchOpenStart,
	defaultTimezone,
	slotsPerDay,
	writeSetting,
} from "../services/settings.js";
import { minutesToTime, timeToMinutes } from "../lib/time.js";

/**
 * Scheduling configuration — branch consultation slots and operating hours.
 *
 * This is intentionally separate from the general "settings" module because it
 * should be editable by Operations Managers and System Administrators, not
 * only super admins. Consultants/coordinators do not reach this route.
 */

const schedulingRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

const schedulingResponseSchema = z.object({
	slotsPerDay: z.number().int(),
	openStart: timeStringSchema,
	openEnd: timeStringSchema,
	timezone: z.string(),
	preview: z.array(timeStringSchema),
});

const updateSchedulingSchema = z.object({
	slotsPerDay: z.coerce.number().int().min(1).max(48),
	openStart: timeStringSchema,
	openEnd: timeStringSchema,
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

async function readSchedulingConfig() {
	const [slots, openStart, openEnd, timezone] = await Promise.all([
		slotsPerDay(),
		branchOpenStart(),
		branchOpenEnd(),
		defaultTimezone(),
	]);
	return {
		slotsPerDay: slots,
		openStart,
		openEnd,
		timezone,
		preview: computePreview(openStart, openEnd, slots),
	};
}

/* ── GET /api/v1/scheduling ───────────────────────────────────────────────── */

schedulingRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Scheduling"],
		summary: "Read consultation slot configuration",
		middleware: [requireAuth, requireMfa, requireModule("scheduling")] as const,
		responses: {
			200: {
				description: "Current scheduling configuration",
				content: { "application/json": { schema: schedulingResponseSchema } },
			},
		},
	}),
	async (c) => {
		const config = await readSchedulingConfig();
		return c.json(config);
	},
);

/* ── PUT /api/v1/scheduling ───────────────────────────────────────────────── */

schedulingRouter.openapi(
	createRoute({
		method: "put",
		path: "/",
		tags: ["Scheduling"],
		summary: "Update consultation slot configuration",
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

		const startMin = timeToMinutes(body.openStart);
		const endMin = timeToMinutes(body.openEnd);
		if (endMin <= startMin) {
			throw new HttpError(400, "BAD_REQUEST", "Closing time must be after opening time");
		}

		const actor = { opsUserId: staff.opsUserId, email: staff.email };
		await Promise.all([
			writeSetting("SLOTS_PER_DAY", String(body.slotsPerDay), actor),
			writeSetting("BRANCH_OPEN_START", body.openStart, actor),
			writeSetting("BRANCH_OPEN_END", body.openEnd, actor),
		]);

		const config = await readSchedulingConfig();
		return c.json(config);
	},
);

export { schedulingRouter };
