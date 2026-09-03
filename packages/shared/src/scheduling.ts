import { z } from "zod";

/**
 * Shared scheduling primitives.
 *
 * The scheduling model is intentionally simple:
 *
 *   - General settings are the default template for every day.
 *   - A day may override the general template only when its `customEnabled`
 *     flag is true.
 *
 * Keeping the generation and resolution logic in one place means the ops UI,
 * API availability service, and calendar feeds cannot drift out of sync.
 */

const timeStringSchema = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

export type TimeString = string;

export interface WeeklySlotScheduleGeneral {
	/** Default opening time, HH:MM. */
	openStart: string;
	/** Default closing time, HH:MM. */
	openEnd: string;
	/** Default minutes between slot start times. */
	intervalMinutes: number;
	/** Cap on slots per day. null or 0 = no cap. */
	maxSlotsPerDay: number | null;
}

export interface WeeklySlotScheduleDay {
	/** 0 = Sunday … 6 = Saturday. */
	dayOfWeek: number;
	/** When true, this day uses its own values instead of the general template. */
	customEnabled: boolean;
	/** Day-specific opening time, used only when customEnabled = true. */
	openStart: string;
	/** Day-specific closing time. */
	openEnd: string;
	/** Day-specific interval. */
	intervalMinutes: number;
	/** Day-specific slot cap. */
	maxSlotsPerDay: number | null;
}

export interface WeeklySlotSchedule {
	timezone: string;
	general: WeeklySlotScheduleGeneral;
	days: WeeklySlotScheduleDay[];
}

export function timeToMinutes(value: string | undefined | null): number {
	if (!value || typeof value !== "string") return 0;
	const [h, m] = value.split(":").map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
	return h * 60 + m;
}

export function minutesToTime(min: number): string {
	const h = Math.floor(min / 60).toString().padStart(2, "0");
	const m = (min % 60).toString().padStart(2, "0");
	return `${h}:${m}`;
}

/** Generate start-time strings from opening to closing, capped by maxSlots. */
export function generateSlots(
	openStart: string,
	openEnd: string,
	intervalMinutes: number,
	maxSlotsPerDay: number | null,
): string[] {
	if (!openStart || !openEnd || !intervalMinutes || intervalMinutes <= 0) return [];
	const startMin = timeToMinutes(openStart);
	const endMin = timeToMinutes(openEnd);
	if (endMin <= startMin) return [];

	const times: string[] = [];
	for (let t = startMin; t < endMin; t += intervalMinutes) {
		times.push(minutesToTime(t));
		if (maxSlotsPerDay && maxSlotsPerDay > 0 && times.length >= maxSlotsPerDay) break;
	}
	return times;
}

export function effectiveDayValues(
	day: WeeklySlotScheduleDay,
	general: WeeklySlotScheduleGeneral,
): WeeklySlotScheduleGeneral {
	if (day.customEnabled) {
		return {
			openStart: day.openStart,
			openEnd: day.openEnd,
			intervalMinutes: day.intervalMinutes,
			maxSlotsPerDay: day.maxSlotsPerDay,
		};
	}
	return { ...general };
}

export function formatSlotRange(openStart: string, openEnd: string): string {
	return `${openStart} - ${openEnd}`;
}

export interface ScheduleValidationError {
	field?: string;
	message: string;
}

export function validateScheduleConfig(
	general: WeeklySlotScheduleGeneral,
	days: WeeklySlotScheduleDay[],
): ScheduleValidationError | null {
	if (timeToMinutes(general.openEnd) <= timeToMinutes(general.openStart)) {
		return { field: "general.openEnd", message: "General closing time must be after opening time" };
	}
	if (general.intervalMinutes < 5 || general.intervalMinutes > 480) {
		return { field: "general.intervalMinutes", message: "General interval must be between 5 and 480 minutes" };
	}
	if (general.maxSlotsPerDay != null && general.maxSlotsPerDay < 0) {
		return { field: "general.maxSlotsPerDay", message: "Maximum slots must be 0 or more" };
	}

	const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	for (const day of days) {
		if (!day.customEnabled) continue;
		if (timeToMinutes(day.openEnd) <= timeToMinutes(day.openStart)) {
			return {
				field: `days[${day.dayOfWeek}].openEnd`,
				message: `${dayNames[day.dayOfWeek]}: closing time must be after opening time`,
			};
		}
		if (day.intervalMinutes < 5 || day.intervalMinutes > 480) {
			return {
				field: `days[${day.dayOfWeek}].intervalMinutes`,
				message: `${dayNames[day.dayOfWeek]}: interval must be between 5 and 480 minutes`,
			};
		}
		if (day.maxSlotsPerDay != null && day.maxSlotsPerDay < 0) {
			return {
				field: `days[${day.dayOfWeek}].maxSlotsPerDay`,
				message: `${dayNames[day.dayOfWeek]}: maximum slots must be 0 or more`,
			};
		}
	}

	return null;
}

export const weeklySlotScheduleGeneralSchema = z.object({
	openStart: timeStringSchema,
	openEnd: timeStringSchema,
	intervalMinutes: z.coerce.number().int().min(5).max(480),
	maxSlotsPerDay: z.coerce.number().int().min(0).max(48).nullable(),
});

export const weeklySlotScheduleDaySchema = z.object({
	dayOfWeek: z.number().int().min(0).max(6),
	customEnabled: z.boolean(),
	openStart: timeStringSchema,
	openEnd: timeStringSchema,
	intervalMinutes: z.coerce.number().int().min(5).max(480),
	maxSlotsPerDay: z.coerce.number().int().min(0).max(48).nullable(),
});

export const weeklySlotScheduleSchema = z.object({
	timezone: z.string().min(1),
	general: weeklySlotScheduleGeneralSchema,
	days: z.array(weeklySlotScheduleDaySchema).length(7),
});
