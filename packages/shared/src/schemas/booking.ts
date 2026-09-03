import { z } from "zod";

/**
 * Scheduling contract shared by the API, the applicant portal and the
 * Operations Center.
 *
 * These names deliberately match the vocabulary already in the product rather
 * than inventing a parallel one: a booking is the thing an applicant creates in
 * the portal and staff see as a consultation in ops.
 */

/* ─── Status ─────────────────────────────────────────────────────────────── */

/**
 * Lifecycle of a booking.
 *
 * This is the server's own state machine. The portal's `consultationPhase` and
 * the ops `ConsultationStatus` are *presentation* states layered on top and are
 * unchanged — see `BOOKING_STATUS_TO_OPS` below for the mapping, which exists so
 * neither of those had to be rewritten.
 */
export const bookingStatusSchema = z.enum([
	"UNASSIGNED",
	"ASSIGNED",
	"CONFIRMED",
	"RESCHEDULED",
	"CANCELLED",
	"COMPLETED",
	"NO_SHOW",
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** Statuses that still occupy their slot. Everything else releases it. */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
	"UNASSIGNED",
	"ASSIGNED",
	"CONFIRMED",
	"RESCHEDULED",
];

export function occupiesSlot(status: BookingStatus): boolean {
	return ACTIVE_BOOKING_STATUSES.includes(status);
}

/** Existing ops-side status vocabulary, so those screens keep working unchanged. */
export const BOOKING_STATUS_TO_OPS: Record<BookingStatus, string> = {
	UNASSIGNED: "Under Review",
	ASSIGNED: "Assigned",
	CONFIRMED: "Assigned",
	RESCHEDULED: "Assigned",
	CANCELLED: "Cancelled",
	COMPLETED: "Completed",
	NO_SHOW: "Cancelled",
};

/**
 * How far the booking has got with Google Calendar.
 *
 * Separate from `status` on purpose: a calendar failure must never lose the
 * booking, so an assignment can be ASSIGNED while its calendar sync is FAILED
 * and awaiting retry.
 */
export const calendarSyncStatusSchema = z.enum([
	"NOT_REQUIRED",
	"PENDING",
	"SYNCED",
	"FAILED",
]);
export type CalendarSyncStatus = z.infer<typeof calendarSyncStatusSchema>;

export const bookingTypeSchema = z.enum(["online", "in_person"]);
export type BookingType = z.infer<typeof bookingTypeSchema>;

/* ─── Primitives ─────────────────────────────────────────────────────────── */

/** YYYY-MM-DD in the branch's local calendar. */
export const dateStringSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** HH:MM, 24-hour, in the branch's local time. */
export const timeStringSchema = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

/**
 * IANA zone, e.g. "Africa/Accra". Never a fixed offset: offsets change with DST
 * and a stored offset silently becomes wrong.
 */
export const timezoneSchema = z.string().min(1).max(64);

/* ─── Requests ───────────────────────────────────────────────────────────── */

export const createBookingSchema = z.object({
	serviceId: z.string().min(1),
	branchId: z.string().min(1),
	type: bookingTypeSchema,
	date: dateStringSchema,
	time: timeStringSchema,
	durationMinutes: z.number().int().min(15).max(240),
	timezone: timezoneSchema,
	notes: z.string().max(2000).optional(),
});
export type CreateBooking = z.infer<typeof createBookingSchema>;

export const assignBookingSchema = z.object({
	employeeId: z.string().uuid(),
});
export type AssignBooking = z.infer<typeof assignBookingSchema>;

export const rescheduleBookingSchema = z.object({
	date: dateStringSchema,
	time: timeStringSchema,
	timezone: timezoneSchema.optional(),
	reason: z.string().max(1000).optional(),
});
export type RescheduleBooking = z.infer<typeof rescheduleBookingSchema>;

export const rescheduleDecisionSchema = z.object({
	decision: z.enum(["approve", "reject"]),
});
export type RescheduleDecision = z.infer<typeof rescheduleDecisionSchema>;

export const cancelBookingSchema = z.object({
	reason: z.string().max(1000).optional(),
});
export type CancelBooking = z.infer<typeof cancelBookingSchema>;

export const availabilityQuerySchema = z.object({
	branchId: z.string().min(1),
	date: dateStringSchema,
	durationMinutes: z.coerce.number().int().min(15).max(240).default(45),
	/** Restrict to one employee — used by the manager's assign dialog. */
	employeeId: z.string().uuid().optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/* ─── Responses ──────────────────────────────────────────────────────────── */

export const availabilitySlotSchema = z.object({
	time: timeStringSchema,
	/** UTC instant this slot starts — the authoritative value. */
	startsAt: z.string().datetime(),
	available: z.boolean(),
	/** Why not, when unavailable: "booked" | "outside-hours" | "past" | "conflict". */
	reason: z.string().optional(),
});
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

export const availabilityResponseSchema = z.object({
    branchId: z.string(),
    date: dateStringSchema,
    timezone: timezoneSchema,
    durationMinutes: z.number().int(),
    slots: z.array(availabilitySlotSchema),
    /** Calendar sync status for the employee whose availability is being queried. */
    calendarSyncStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'SYNCED', 'FAILED']).optional(),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

/** An employee offered in the manager's assign dialog. */
export const assignableEmployeeSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	email: z.string().email(),
	role: z.string(),
	branch: z.string().nullable(),
	available: z.boolean(),
	/** "busy" | "outside-hours" | "no-working-hours" | "conflict" */
	reason: z.string().optional(),
	/** Whether this employee has connected Google Calendar. */
	calendarConnected: z.boolean(),
});
export type AssignableEmployee = z.infer<typeof assignableEmployeeSchema>;

export const bookingSchema = z.object({
	id: z.string().uuid(),
	reference: z.string(),
	status: bookingStatusSchema,

	serviceId: z.string(),
	serviceName: z.string(),
	branchId: z.string(),
	type: bookingTypeSchema,

	/** UTC. The client renders these in `timezone`. */
	startsAt: z.string().datetime(),
	endsAt: z.string().datetime(),
	timezone: timezoneSchema,
	durationMinutes: z.number().int(),

	clientName: z.string(),
	clientEmail: z.string().email(),
	clientPhone: z.string().nullable(),

	employeeId: z.string().uuid().nullable(),
	employeeName: z.string().nullable(),
	employeeEmail: z.string().email().nullable(),
	assignedAt: z.string().datetime().nullable(),

	meetingUrl: z.string().url().nullable(),
	meetingProvider: z.string().nullable(),
	meetingSpace: z.string().nullable(),
	calendarEventId: z.string().nullable(),
	calendarSyncStatus: calendarSyncStatusSchema,

	/** Live meeting status — populated by the meetingStatusPoller worker. */
	meetingActive: z.boolean(),
	meetingParticipants: z.number().int(),
	meetingCheckedAt: z.string().datetime().nullable(),

	rescheduledAt: z.string().datetime().nullable(),
	rescheduleRequestedAt: z.string().datetime().nullable(),
	rescheduleRequestedStartsAt: z.string().datetime().nullable(),
	rescheduleRequestedEndsAt: z.string().datetime().nullable(),
	rescheduleRequestedTimezone: z.string().nullable(),
	rescheduleRequestReason: z.string().nullable(),

	cancelledAt: z.string().datetime().nullable(),
	cancellationReason: z.string().nullable(),

	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const bookingListSchema = z.object({
	bookings: z.array(bookingSchema),
	total: z.number().int(),
});

/* ─── Working hours ──────────────────────────────────────────────────────── */

/** Minutes past local midnight for `HH:MM`. */
function minutesOf(time: string): number {
	const [h, m] = time.split(":").map(Number);
	return h * 60 + m;
}

/**
 * One weekday's availability window.
 *
 * A day the employee does not work is simply absent — the same convention the
 * database uses, where a missing row means "not working". An `enabled` flag
 * instead would be a second representation of the same fact that every query
 * would have to remember to filter on.
 */
export const workingHoursDaySchema = z
	.object({
		/** 0 = Sunday … 6 = Saturday. */
		dayOfWeek: z.number().int().min(0).max(6),
		start: timeStringSchema,
		end: timeStringSchema,
	})
	.refine((d) => minutesOf(d.start) < minutesOf(d.end), {
		message: "Start time must be before end time",
		path: ["end"],
	});

export type WorkingHoursDay = z.infer<typeof workingHoursDaySchema>;

export const updateWorkingHoursSchema = z
	.object({
		timezone: timezoneSchema,
		/** The complete set. Days omitted are treated as not working. */
		days: z.array(workingHoursDaySchema).max(7),
	})
	.refine((v) => new Set(v.days.map((d) => d.dayOfWeek)).size === v.days.length, {
		message: "Each day may appear only once",
		path: ["days"],
	});

export type UpdateWorkingHours = z.infer<typeof updateWorkingHoursSchema>;

export const workingHoursResponseSchema = z.object({
	workingHours: z.array(
		z.object({
			dayOfWeek: z.number().int(),
			start: z.string(),
			end: z.string(),
			timezone: z.string(),
		}),
	),
	/**
	 * Bookings already assigned to this employee that now fall outside their
	 * hours. Narrowing hours never cancels anything — existing commitments stand
	 * — but the employee should be told they have some.
	 */
	conflictingBookings: z.number().int(),
});

export type WorkingHoursResponse = z.infer<typeof workingHoursResponseSchema>;

/* ─── Errors specific to scheduling ──────────────────────────────────────── */

/**
 * Codes the frontend branches on. `SLOT_TAKEN` in particular is the response to
 * losing the race described in §11 and must be handled, not just surfaced.
 */
export const SCHEDULING_ERROR_CODES = {
	SLOT_TAKEN: "SLOT_TAKEN",
	EMPLOYEE_UNAVAILABLE: "EMPLOYEE_UNAVAILABLE",
	OUTSIDE_WORKING_HOURS: "OUTSIDE_WORKING_HOURS",
	BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND",
	BOOKING_CANCELLED: "BOOKING_CANCELLED",
	CALENDAR_NOT_CONNECTED: "CALENDAR_NOT_CONNECTED",
	CALENDAR_SYNC_FAILED: "CALENDAR_SYNC_FAILED",
	PAST_SLOT: "PAST_SLOT",
} as const;

export type SchedulingErrorCode =
	(typeof SCHEDULING_ERROR_CODES)[keyof typeof SCHEDULING_ERROR_CODES];
