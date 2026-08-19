import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
	SCHEDULING_ERROR_CODES,
	occupiesSlot,
	type BookingStatus,
	type CreateBooking,
	type RescheduleBooking,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { bookingEvents, bookings, opsUsers } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { isConflictError } from "../lib/db-errors.js";
import { addMinutes, isValidTimeZone, zonedTimeToUtc } from "../lib/time.js";
import { branchAvailability, isEmployeeAvailable } from "./availability.js";
import { defaultTimezone } from "./settings.js";
import {
	getCalendarClient,
	loadCredentials,
	markNeedsReconnect,
	CalendarAuthError,
} from "./calendar/index.js";
import * as mail from "./notifications.js";
import { notify, notifyMany, getManagerAndCoordinatorUserIds, getStaffUserIdByEmail } from "./notify.js";
import { queueCalendar, queueEmails, queueReminder, cancelQueued, releaseCalendarJob } from "../worker/queues.js";

/**
 * Booking lifecycle.
 *
 * Two rules run through everything here:
 *
 *  §11 — the database decides who wins a race. Availability is re-checked inside
 *  the transaction, but the partial unique index on (branch_id, starts_at) is
 *  what actually makes concurrent inserts safe. A pre-check alone cannot: two
 *  requests can both read "free" before either writes.
 *
 *  §14 — every externally-visible effect is keyed. Assignment, calendar writes
 *  and notifications all carry an idempotency key, so a retry converges on the
 *  same single calendar event and the same single Meet link.
 */

export type BookingRow = typeof bookings.$inferSelect;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** `CNS-2026-0007`. Advisory-locked so concurrent creates cannot collide. */
async function nextReference(tx: typeof db): Promise<string> {
	const year = new Date().getUTCFullYear();
	await tx.execute(sql`SELECT pg_advisory_xact_lock(710001, ${year})`);
	const [row] = await tx
		.select({
			max: sql<number>`coalesce(max(split_part(${bookings.reference}, '-', 3)::int), 0)::int`,
		})
		.from(bookings)
		.where(sql`${bookings.reference} like ${`CNS-${year}-%`}`);
	return `CNS-${year}-${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

/**
 * Record an operation, returning false if this key has already been applied.
 *
 * The unique index on `idempotency_key` is the actual guard — checking first
 * then inserting would leave the same race it is meant to close.
 */
async function claimOperation(
	tx: typeof db,
	bookingId: string,
	type: string,
	idempotencyKey: string,
	actor: string | null,
	payload?: unknown,
): Promise<boolean> {
	try {
		await tx.insert(bookingEvents).values({
			bookingId,
			type,
			actor,
			idempotencyKey,
			payload: payload as never,
		});
		return true;
	} catch (err) {
		if (isConflictError(err)) return false;
		throw err;
	}
}

async function audit(
	bookingId: string,
	type: string,
	actor: string | null,
	payload?: unknown,
): Promise<void> {
	await db.insert(bookingEvents).values({
		bookingId,
		type,
		actor,
		payload: payload as never,
	});
}

async function loadEmployee(employeeId: string) {
	const [row] = await db.select().from(opsUsers).where(eq(opsUsers.id, employeeId)).limit(1);
	return row ?? null;
}

async function notificationContext(
	booking: BookingRow,
	employee?: { name: string; email: string } | null,
) {
	return {
		reference: booking.reference,
		serviceName: booking.serviceName,
		startsAt: booking.startsAt,
		clientTimezone: booking.timezone,
		employeeTimezone: await defaultTimezone(),
		durationMinutes: booking.durationMinutes,
		clientName: booking.clientName,
		clientEmail: booking.clientEmail,
		employeeName: employee?.name ?? null,
		employeeEmail: employee?.email ?? null,
		meetingUrl: booking.meetingUrl,
	};
}

/* ── Create ──────────────────────────────────────────────────────────────── */

/**
 * Create a booking. Always UNASSIGNED — assignment is a manager's decision
 * (§1), never automatic and never round-robin.
 */
export async function createBooking(input: {
	data: CreateBooking;
	client: { id: string; name: string; email: string; phone?: string | null };
	serviceName: string;
	idempotencyKey?: string;
}): Promise<BookingRow> {
	const { data, client } = input;

	if (!isValidTimeZone(data.timezone)) {
		throw new HttpError(400, "VALIDATION_ERROR", `Unknown timezone: ${data.timezone}`);
	}

	const startsAt = zonedTimeToUtc(data.date, data.time, data.timezone);
	const endsAt = addMinutes(startsAt, data.durationMinutes);

	if (startsAt.getTime() <= Date.now()) {
		throw new HttpError(400, SCHEDULING_ERROR_CODES.PAST_SLOT, "That time is in the past");
	}

	// Server-side re-check (§10) — the client's view of availability is a hint.
	const slots = await branchAvailability({
		branchId: data.branchId,
		date: data.date,
		durationMinutes: data.durationMinutes,
		timezone: data.timezone,
	});
	const slot = slots.find((s) => s.time === data.time);
	if (!slot) {
		throw new HttpError(400, "VALIDATION_ERROR", `${data.time} is not a bookable start time`);
	}
	if (!slot.available) {
		throw new HttpError(
			409,
			SCHEDULING_ERROR_CODES.SLOT_TAKEN,
			"That time has just been taken. Please choose another.",
		);
	}

	let booking: BookingRow;
	try {
		booking = await db.transaction(async (tx) => {
			const reference = await nextReference(tx as unknown as typeof db);
			const [row] = await tx
				.insert(bookings)
				.values({
					reference,
					clientUserId: client.id,
					clientName: client.name,
					clientEmail: client.email,
					clientPhone: client.phone ?? null,
					serviceId: data.serviceId,
					serviceName: input.serviceName,
					branchId: data.branchId,
					type: data.type,
					startsAt,
					endsAt,
					timezone: data.timezone,
					durationMinutes: data.durationMinutes,
					status: "UNASSIGNED",
					calendarSyncStatus: "NOT_REQUIRED",
					notes: data.notes ?? null,
				})
				.returning();
			return row;
		});
	} catch (err) {
		// The loser of a race lands here — the index rejected the second insert.
		if (isConflictError(err)) {
			throw new HttpError(
				409,
				SCHEDULING_ERROR_CODES.SLOT_TAKEN,
				"That time has just been taken. Please choose another.",
			);
		}
		throw err;
	}

	await audit(booking.id, "created", client.email, { source: "portal" });

	// The booking is already committed. A case-setup failure must not look like
	// a lost slot race, and must not roll the appointment back.
	try {
		const { ensureCaseForBooking } = await import("./cases.js");
		await ensureCaseForBooking(booking);
	} catch (err) {
		console.error("[booking] could not open the consultation case:", err);
	}

	// Queued, never inline: a failed email must not undo a real booking (§13).
	const ctx = await notificationContext(booking);
	const managers = await db
		.select({ email: opsUsers.email })
		.from(opsUsers)
		.where(and(eq(opsUsers.active, true), inArray(opsUsers.role, ["manager", "coordinator"])));

	await queueEmails([
		mail.bookingCreatedForClient(ctx),
		...managers.map((m) => mail.bookingCreatedForManagers(ctx, m.email)),
	]);

	// In-app notification to every manager/coordinator/super_admin: a new
	// booking is waiting to be assigned. Fire-and-forget so a notification
	// hiccup never rolls back the booking (§13).
	getManagerAndCoordinatorUserIds()
		.then((recipients) =>
			notifyMany(
				recipients.map((r) => ({
					recipientUserId: r.userId,
					type: "booking.new",
					title: "New booking awaiting assignment",
					body: `${booking.clientName} booked a consultation. Ref: ${booking.reference}`,
					link: "/ops/cases",
				})),
			),
		)
		.catch(() => {});

	return booking;
}

/* ── Assign ──────────────────────────────────────────────────────────────── */

/**
 * Assign an employee, then create the calendar event and Meet link.
 *
 * Ordering is deliberate. The assignment commits first; the calendar is
 * attempted after. If Google is down the booking is still ASSIGNED with
 * calendarSyncStatus=FAILED and a queued retry (§13) — the alternative, rolling
 * back the assignment because a third party was unavailable, loses real work.
 */
export async function assignBooking(input: {
	bookingId: string;
	employeeId: string;
	actor: { opsUserId: string; name: string; email: string };
}): Promise<BookingRow> {
	const { bookingId, employeeId, actor } = input;

	const booking = await getBooking(bookingId);
	if (!booking) {
		throw new HttpError(404, SCHEDULING_ERROR_CODES.BOOKING_NOT_FOUND, "Booking not found");
	}
	if (!occupiesSlot(booking.status)) {
		throw new HttpError(
			409,
			SCHEDULING_ERROR_CODES.BOOKING_CANCELLED,
			`Cannot assign a booking that is ${booking.status}`,
		);
	}

	const employee = await loadEmployee(employeeId);
	if (!employee || !employee.active) {
		throw new HttpError(404, "NOT_FOUND", "Employee not found");
	}

	// §2 — never assign into a conflict.
	const check = await isEmployeeAvailable(employeeId, booking.startsAt, booking.durationMinutes, {
		excludeBookingId: booking.id,
		timezone: booking.timezone,
	});
	if (!check.available) {
		throw new HttpError(
			409,
			check.reason === "outside-hours" || check.reason === "no-working-hours"
				? SCHEDULING_ERROR_CODES.OUTSIDE_WORKING_HOURS
				: SCHEDULING_ERROR_CODES.EMPLOYEE_UNAVAILABLE,
			`${employee.name} is not available at that time`,
			{ reason: check.reason },
		);
	}

	// §14 — the same assignment retried must not produce a second calendar event.
	const idempotencyKey = `assign:${bookingId}:${employeeId}`;
	const firstTime = await claimOperation(
		db,
		bookingId,
		"assigned",
		idempotencyKey,
		actor.email,
		{ employeeId },
	);
	if (!firstTime) {
		return (await getBooking(bookingId))!;
	}

	let updated: BookingRow;
	try {
		[updated] = await db
			.update(bookings)
			.set({
				employeeId,
				assignedAt: new Date(),
				assignedBy: actor.opsUserId,
				status: "ASSIGNED",
				calendarSyncStatus: booking.type === "online" ? "PENDING" : "NOT_REQUIRED",
				updatedAt: new Date(),
			})
			.where(eq(bookings.id, bookingId))
			.returning();
	} catch (err) {
		// The employee-overlap exclusion constraint rejected it.
		if (isConflictError(err)) {
			throw new HttpError(
				409,
				SCHEDULING_ERROR_CODES.EMPLOYEE_UNAVAILABLE,
				`${employee.name} was just booked for that time`,
			);
		}
		throw err;
	}

	// In-person meetings need no conference.
	if (updated.type === "online") {
		updated = await syncCalendarForBooking(updated.id);
	}

	const ctx = await notificationContext(updated, employee);
	await queueEmails([mail.bookingAssignedForClient(ctx), mail.bookingAssignedForEmployee(ctx)]);
	await scheduleReminders(updated, employee);

	// In-app notification to the assigned employee about their new consultation.
	if (employee?.email) {
		getStaffUserIdByEmail(employee.email)
			.then((userId) =>
				userId
					? notify({
							recipientUserId: userId,
							type: "booking.assigned",
							title: "New consultation assigned",
							body: `${updated.clientName}'s consultation has been assigned to you. Ref: ${updated.reference}`,
							link: "/ops/cases",
						}).catch(() => {})
					: undefined,
			)
			.catch(() => {});
	}

	const { syncConsultationAssignment } = await import("./cases.js");
	await syncConsultationAssignment(updated.id, employeeId, actor);

	return updated;
}

/* ── Calendar sync ───────────────────────────────────────────────────────── */

/**
 * Create (or repair) the calendar event and Meet link for a booking.
 *
 * Safe to call repeatedly: an existing `calendarEventId` short-circuits, and the
 * request id handed to Google is derived from the booking, so even a genuine
 * retry attaches to the same conference rather than minting a second link.
 */
export async function syncCalendarForBooking(bookingId: string): Promise<BookingRow> {
	const booking = await getBooking(bookingId);
	if (!booking) {
		throw new HttpError(404, SCHEDULING_ERROR_CODES.BOOKING_NOT_FOUND, "Booking not found");
	}

	if (!booking.employeeId || booking.type !== "online") {
		return booking;
	}
	if (booking.calendarEventId && booking.meetingUrl) {
		return booking; // already synced
	}

	const employee = await loadEmployee(booking.employeeId);
	if (!employee) return booking;

	const account = await loadCredentials(booking.employeeId);
	if (!account) {
		return markSyncFailed(
			booking.id,
			"Employee has not connected Google Calendar, or the connection needs renewing",
		);
	}

	const client = await getCalendarClient();
	try {
		const event = await client.createEvent(account.credentials, {
			calendarId: account.calendarId,
			summary: `${booking.serviceName} · ${booking.clientName}`,
			description: [
				`Century NIT ${booking.serviceName}`,
				`Reference: ${booking.reference}`,
				`Client: ${booking.clientName} (${booking.clientEmail})`,
				booking.notes ? `Notes: ${booking.notes}` : "",
			]
				.filter(Boolean)
				.join("\n"),
			startsAt: booking.startsAt,
			endsAt: booking.endsAt,
			timezone: booking.timezone,
			attendees: [
				{ email: employee.email, displayName: employee.name, organizer: true },
				{ email: booking.clientEmail, displayName: booking.clientName },
			],
			// Stable per booking — this is the idempotency handle Google honours.
			requestId: `century-nit-${booking.id}`,
			withMeet: true,
		});

		const [updated] = await db
			.update(bookings)
			.set({
				calendarEventId: event.eventId,
				calendarId: event.calendarId,
				meetingUrl: event.meetingUrl,
				calendarSyncStatus: event.meetingUrl ? "SYNCED" : "FAILED",
				calendarSyncError: event.meetingUrl ? null : "Google returned no meeting link",
				updatedAt: new Date(),
			})
			.where(eq(bookings.id, booking.id))
			.returning();

		await audit(booking.id, "calendar.synced", "system", {
			eventId: event.eventId,
			meetingUrl: event.meetingUrl,
		});
		return updated;
	} catch (err) {
		if (err instanceof CalendarAuthError) {
			await markNeedsReconnect(booking.employeeId);
		}
		const message = err instanceof Error ? err.message : "Calendar sync failed";
		const failed = await markSyncFailed(booking.id, message);
		// Retry out of band; the booking itself is untouched and still valid.
		await queueCalendar({ type: "sync", bookingId: booking.id });
		return failed;
	}
}

async function markSyncFailed(bookingId: string, message: string): Promise<BookingRow> {
	const [row] = await db
		.update(bookings)
		.set({
			calendarSyncStatus: "FAILED",
			calendarSyncError: message,
			calendarSyncAttempts: sql`${bookings.calendarSyncAttempts} + 1`,
			updatedAt: new Date(),
		})
		.where(eq(bookings.id, bookingId))
		.returning();
	await audit(bookingId, "calendar.failed", "system", { message });
	return row;
}

/* ── Reschedule ──────────────────────────────────────────────────────────── */

export async function rescheduleBooking(input: {
	bookingId: string;
	date: string;
	time: string;
	timezone?: string;
	reason?: string;
	actor: { name: string; email: string };
}): Promise<BookingRow> {
	const booking = await getBooking(input.bookingId);
	if (!booking) {
		throw new HttpError(404, SCHEDULING_ERROR_CODES.BOOKING_NOT_FOUND, "Booking not found");
	}
	if (!occupiesSlot(booking.status)) {
		throw new HttpError(
			409,
			SCHEDULING_ERROR_CODES.BOOKING_CANCELLED,
			`Cannot reschedule a booking that is ${booking.status}`,
		);
	}

	const timezone = input.timezone ?? booking.timezone;
	if (!isValidTimeZone(timezone)) {
		throw new HttpError(400, "VALIDATION_ERROR", `Unknown timezone: ${timezone}`);
	}

	const startsAt = zonedTimeToUtc(input.date, input.time, timezone);
	const endsAt = addMinutes(startsAt, booking.durationMinutes);

	if (startsAt.getTime() <= Date.now()) {
		throw new HttpError(400, SCHEDULING_ERROR_CODES.PAST_SLOT, "That time is in the past");
	}
	if (startsAt.getTime() === booking.startsAt.getTime()) {
		return booking; // no-op reschedule
	}

	// Re-check availability against the *new* slot, excluding this booking so it
	// does not conflict with itself.
	const slots = await branchAvailability({
		branchId: booking.branchId,
		date: input.date,
		durationMinutes: booking.durationMinutes,
		timezone,
		excludeBookingId: booking.id,
	});
	const slot = slots.find((s) => s.time === input.time);
	if (!slot?.available) {
		throw new HttpError(
			409,
			SCHEDULING_ERROR_CODES.SLOT_TAKEN,
			"That time is not available. Please choose another.",
		);
	}

	if (booking.employeeId) {
		const check = await isEmployeeAvailable(
			booking.employeeId,
			startsAt,
			booking.durationMinutes,
			{ excludeBookingId: booking.id, timezone },
		);
		if (!check.available) {
			throw new HttpError(
				409,
				SCHEDULING_ERROR_CODES.EMPLOYEE_UNAVAILABLE,
				"The assigned consultant is not available at that time",
				{ reason: check.reason },
			);
		}
	}

	let updated: BookingRow;
	try {
		[updated] = await db
			.update(bookings)
			.set({
				startsAt,
				endsAt,
				timezone,
				status: booking.employeeId ? "RESCHEDULED" : "UNASSIGNED",
				rescheduledAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(bookings.id, booking.id))
			.returning();
	} catch (err) {
		if (isConflictError(err)) {
			throw new HttpError(
				409,
				SCHEDULING_ERROR_CODES.SLOT_TAKEN,
				"That time has just been taken. Please choose another.",
			);
		}
		throw err;
	}

	await audit(booking.id, "rescheduled", input.actor.email, {
		from: booking.startsAt.toISOString(),
		to: startsAt.toISOString(),
		reason: input.reason ?? null,
	});

	// Move the calendar event rather than recreating it, so the Meet link the
	// client already holds keeps working.
	if (updated.calendarEventId && updated.employeeId) {
		updated = await updateCalendarForBooking(updated.id);
	}

	const employee = updated.employeeId ? await loadEmployee(updated.employeeId) : null;
	const ctx = { ...(await notificationContext(updated, employee)), reason: input.reason ?? null };

	// The old reminder points at a time that no longer exists.
	await cancelQueued(`notify:reminder:client:${booking.reference}`);
	await cancelQueued(`notify:reminder:employee:${booking.reference}`);

	await queueEmails([
		mail.bookingRescheduled(ctx, "client"),
		...(employee ? [mail.bookingRescheduled(ctx, "employee")] : []),
	]);
	if (employee) await scheduleReminders(updated, employee);

	// In-app: tell the client and (if assigned) the employee the slot moved.
	notify({
		recipientUserId: updated.clientUserId,
		type: "booking.rescheduled",
		title: "Your appointment has been rescheduled",
		body: `Your consultation has been moved to a new time. Ref: ${updated.reference}`,
		link: "/portal/tracking",
	}).catch(() => {});
	if (employee?.email) {
		getStaffUserIdByEmail(employee.email)
			.then((userId) =>
				userId
					? notify({
							recipientUserId: userId,
							type: "booking.rescheduled",
							title: "Consultation rescheduled",
							body: `${updated.clientName}'s consultation has been rescheduled. Ref: ${updated.reference}`,
							link: "/ops/cases",
						}).catch(() => {})
					: undefined,
			)
			.catch(() => {});
	}

	return updated;
}

export async function requestRescheduleBooking(
	id: string,
	input: RescheduleBooking & { actor: { id: string; email: string } },
): Promise<BookingRow> {
	const booking = await getBooking(id);
	if (!booking) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");

	if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
		throw new HttpError(400, "INVALID_STATE", "Cannot reschedule a closed booking.");
	}

	const timezone = input.timezone ?? booking.timezone;
	if (!isValidTimeZone(timezone)) {
		throw new HttpError(400, "VALIDATION_ERROR", `Unknown timezone: ${timezone}`);
	}

	const startsAt = zonedTimeToUtc(input.date, input.time, timezone);
	const endsAt = addMinutes(startsAt, booking.durationMinutes);

	if (startsAt.getTime() <= Date.now()) {
		throw new HttpError(400, SCHEDULING_ERROR_CODES.PAST_SLOT, "That time is in the past");
	}

	const [updated] = await db
		.update(bookings)
		.set({
			rescheduleRequestedAt: new Date(),
			rescheduleRequestedStartsAt: startsAt,
			rescheduleRequestedEndsAt: endsAt,
			rescheduleRequestedTimezone: timezone,
			rescheduleRequestReason: input.reason ?? null,
			updatedAt: new Date(),
		})
		.where(eq(bookings.id, booking.id))
		.returning();

	await audit(booking.id, "reschedule_requested", input.actor.email, {
		to: startsAt.toISOString(),
		reason: input.reason ?? null,
	});

	// Optionally we could send an email to ops here

	return updated;
}

export async function decideRescheduleBooking(
	id: string,
	decision: "approve" | "reject",
	actor: { id: string; email: string },
): Promise<BookingRow> {
	const booking = await getBooking(id);
	if (!booking) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");

	if (!booking.rescheduleRequestedStartsAt || !booking.rescheduleRequestedEndsAt) {
		throw new HttpError(400, "INVALID_STATE", "No pending reschedule request.");
	}

	if (decision === "approve") {
		// Update the actual booking fields to the requested slot and clear the request
		let [updated] = await db
			.update(bookings)
			.set({
				startsAt: booking.rescheduleRequestedStartsAt!,
				endsAt: booking.rescheduleRequestedEndsAt!,
				timezone: booking.rescheduleRequestedTimezone!,
				status: booking.employeeId ? "RESCHEDULED" : "UNASSIGNED",
				rescheduledAt: new Date(),
				rescheduleRequestedAt: null,
				rescheduleRequestedStartsAt: null,
				rescheduleRequestedEndsAt: null,
				rescheduleRequestedTimezone: null,
				rescheduleRequestReason: null,
				updatedAt: new Date(),
			})
			.where(eq(bookings.id, booking.id))
			.returning();

		await audit(booking.id, "reschedule_approved", actor.email, {
			from: booking.startsAt.toISOString(),
			to: booking.rescheduleRequestedStartsAt!.toISOString(),
		});

		if (updated.calendarEventId && updated.employeeId) {
			updated = await updateCalendarForBooking(updated.id);
		}

		const employee = updated.employeeId ? await loadEmployee(updated.employeeId) : null;
		const ctx = { ...(await notificationContext(updated, employee)), reason: "Your reschedule request was approved." };

		await cancelQueued(`notify:reminder:client:${booking.reference}`);
		await cancelQueued(`notify:reminder:employee:${booking.reference}`);

		await queueEmails([
			mail.bookingRescheduled(ctx, "client"),
			...(employee ? [mail.bookingRescheduled(ctx, "employee")] : []),
		]);
		if (employee) await scheduleReminders(updated, employee);

		// In-app: the approved reschedule is communicated to client + employee.
		notify({
			recipientUserId: updated.clientUserId,
			type: "booking.rescheduled",
			title: "Your reschedule request was approved",
			body: `Your consultation has been moved to a new time. Ref: ${updated.reference}`,
			link: "/portal/tracking",
		}).catch(() => {});
		if (employee?.email) {
			getStaffUserIdByEmail(employee.email)
				.then((userId) =>
					userId
						? notify({
								recipientUserId: userId,
								type: "booking.rescheduled",
								title: "Consultation rescheduled",
								body: `${updated.clientName}'s consultation has been rescheduled. Ref: ${updated.reference}`,
								link: "/ops/cases",
							}).catch(() => {})
						: undefined,
				)
				.catch(() => {});
		}

		return updated;
	} else {
		// reject: just clear the request fields
		const [cleared] = await db
			.update(bookings)
			.set({
				rescheduleRequestedAt: null,
				rescheduleRequestedStartsAt: null,
				rescheduleRequestedEndsAt: null,
				rescheduleRequestedTimezone: null,
				rescheduleRequestReason: null,
				updatedAt: new Date(),
			})
			.where(eq(bookings.id, booking.id))
			.returning();

		await audit(booking.id, "reschedule_rejected", actor.email);
		
		// Optionally we could send an email about rejection to client
		return cleared;
	}
}

export async function updateCalendarForBooking(bookingId: string): Promise<BookingRow> {
	const booking = await getBooking(bookingId);
	if (!booking?.calendarEventId || !booking.employeeId) return booking!;

	const account = await loadCredentials(booking.employeeId);
	if (!account) {
		return markSyncFailed(booking.id, "Calendar connection unavailable for update");
	}

	try {
		const event = await (await getCalendarClient()).updateEvent(account.credentials, {
			calendarId: booking.calendarId ?? account.calendarId,
			eventId: booking.calendarEventId,
			startsAt: booking.startsAt,
			endsAt: booking.endsAt,
			timezone: booking.timezone,
			summary: `${booking.serviceName} · ${booking.clientName}`,
		});
		const [row] = await db
			.update(bookings)
			.set({
				calendarSyncStatus: "SYNCED",
				calendarSyncError: null,
				meetingUrl: event.meetingUrl ?? booking.meetingUrl,
				updatedAt: new Date(),
			})
			.where(eq(bookings.id, booking.id))
			.returning();
		await audit(booking.id, "calendar.updated", "system", { eventId: event.eventId });
		return row;
	} catch (err) {
		if (err instanceof CalendarAuthError) await markNeedsReconnect(booking.employeeId);
		const failed = await markSyncFailed(
			booking.id,
			err instanceof Error ? err.message : "Calendar update failed",
		);
		await queueCalendar({ type: "update", bookingId: booking.id });
		return failed;
	}
}

/* ── Cancel ──────────────────────────────────────────────────────────────── */

export async function cancelBooking(input: {
	bookingId: string;
	reason?: string;
	actor: { name: string; email: string };
}): Promise<BookingRow> {
	const booking = await getBooking(input.bookingId);
	if (!booking) {
		throw new HttpError(404, SCHEDULING_ERROR_CODES.BOOKING_NOT_FOUND, "Booking not found");
	}
	// Cancelling twice is not an error — the caller wanted it cancelled, and it is.
	if (booking.status === "CANCELLED") return booking;

	const [updated] = await db
		.update(bookings)
		.set({
			status: "CANCELLED",
			cancelledAt: new Date(),
			cancelledBy: input.actor.email,
			cancellationReason: input.reason ?? null,
			updatedAt: new Date(),
		})
		.where(eq(bookings.id, booking.id))
		.returning();

	await audit(booking.id, "cancelled", input.actor.email, { reason: input.reason ?? null });

	const { syncConsultationCancelled } = await import("./cases.js");
	await syncConsultationCancelled(booking.id);

	// Free the slot in Google too, and stop the reminders.
	if (updated.calendarEventId && updated.employeeId) {
		await queueCalendar({ type: "cancel", bookingId: updated.id });
	}
	await cancelQueued(`notify:reminder:client:${booking.reference}`);
	await cancelQueued(`notify:reminder:employee:${booking.reference}`);

	const employee = updated.employeeId ? await loadEmployee(updated.employeeId) : null;
	const ctx = { ...(await notificationContext(updated, employee)), reason: input.reason ?? null };
	await queueEmails([
		mail.bookingCancelled(ctx, "client"),
		...(employee ? [mail.bookingCancelled(ctx, "employee")] : []),
	]);

	// In-app: the client and (if assigned) the employee are told the booking
	// is gone.
	notify({
		recipientUserId: updated.clientUserId,
		type: "booking.cancelled",
		title: "Your appointment has been cancelled",
		body: `Your consultation on ${updated.reference} has been cancelled.`,
		link: "/portal/tracking",
	}).catch(() => {});
	if (employee?.email) {
		getStaffUserIdByEmail(employee.email)
			.then((userId) =>
				userId
					? notify({
							recipientUserId: userId,
							type: "booking.cancelled",
							title: "Consultation cancelled",
							body: `${updated.clientName}'s consultation has been cancelled. Ref: ${updated.reference}`,
							link: "/ops/cases",
						}).catch(() => {})
					: undefined,
			)
			.catch(() => {});
	}

	return updated;
}

/* ── Complete / no-show ──────────────────────────────────────────────────── */

/**
 * Mark a booking completed. Releases the slot. The calendar event is left in
 * place so the Meet recording / notes remain on the employee's calendar.
 */
export async function completeBooking(input: {
	bookingId: string;
	actor: { name: string; email: string };
}): Promise<BookingRow> {
	const booking = await getBooking(input.bookingId);
	if (!booking) {
		throw new HttpError(404, SCHEDULING_ERROR_CODES.BOOKING_NOT_FOUND, "Booking not found");
	}
	if (booking.status === "COMPLETED") return booking;
	if (!occupiesSlot(booking.status)) {
		throw new HttpError(
			409,
			SCHEDULING_ERROR_CODES.BOOKING_CANCELLED,
			`Cannot complete a booking that is ${booking.status}`,
		);
	}

	const [updated] = await db
		.update(bookings)
		.set({ status: "COMPLETED", updatedAt: new Date() })
		.where(eq(bookings.id, booking.id))
		.returning();

	await audit(booking.id, "completed", input.actor.email);
	await cancelQueued(`notify:reminder:client:${booking.reference}`);
	await cancelQueued(`notify:reminder:employee:${booking.reference}`);
	return updated;
}

/**
 * Mark a no-show. Releases the slot the same way cancel does, without treating
 * it as a client-initiated cancellation.
 */
export async function markNoShow(input: {
	bookingId: string;
	actor: { name: string; email: string };
}): Promise<BookingRow> {
	const booking = await getBooking(input.bookingId);
	if (!booking) {
		throw new HttpError(404, SCHEDULING_ERROR_CODES.BOOKING_NOT_FOUND, "Booking not found");
	}
	if (booking.status === "NO_SHOW") return booking;
	if (!occupiesSlot(booking.status)) {
		throw new HttpError(
			409,
			SCHEDULING_ERROR_CODES.BOOKING_CANCELLED,
			`Cannot mark a booking that is ${booking.status} as a no-show`,
		);
	}

	const [updated] = await db
		.update(bookings)
		.set({ status: "NO_SHOW", updatedAt: new Date() })
		.where(eq(bookings.id, booking.id))
		.returning();

	await audit(booking.id, "no_show", input.actor.email);
	await cancelQueued(`notify:reminder:client:${booking.reference}`);
	await cancelQueued(`notify:reminder:employee:${booking.reference}`);
	return updated;
}

/** Used by the calendar worker to actually remove the event. */
export async function cancelCalendarForBooking(bookingId: string): Promise<void> {
	const booking = await getBooking(bookingId);
	if (!booking?.calendarEventId || !booking.employeeId) return;

	const account = await loadCredentials(booking.employeeId);
	if (!account) return;

	await (await getCalendarClient()).cancelEvent(account.credentials, {
		calendarId: booking.calendarId ?? account.calendarId,
		eventId: booking.calendarEventId,
	});

	await db
		.update(bookings)
		.set({ calendarSyncStatus: "NOT_REQUIRED", meetingUrl: null, updatedAt: new Date() })
		.where(eq(bookings.id, bookingId));
	await audit(bookingId, "calendar.cancelled", "system");
}

/* ── Reminders ───────────────────────────────────────────────────────────── */

async function scheduleReminders(
	booking: BookingRow,
	employee: { name: string; email: string },
): Promise<void> {
	const sendAt = addMinutes(booking.startsAt, -24 * 60);
	if (sendAt.getTime() <= Date.now()) return;
	const ctx = await notificationContext(booking, employee);
	await queueReminder(mail.bookingReminder(ctx, "client"), sendAt);
	await queueReminder(mail.bookingReminder(ctx, "employee"), sendAt);
}

/* ── Queries ─────────────────────────────────────────────────────────────── */

/**
 * Re-queue calendar sync for an employee's bookings that never got a link.
 *
 * Called when an employee connects Google Calendar. A booking assigned before
 * they connected — or before the server had Google credentials at all — is left
 * ASSIGNED with calendarSyncStatus FAILED and *no* retry queued, because
 * retrying is pointless while there is nothing to authenticate with. Connecting
 * is the event that makes it worth trying again, so this is where the backlog
 * gets picked up.
 *
 * Without it, "configure Google later" would silently mean "every booking made
 * before today never gets a meeting link".
 */
export async function queuePendingCalendarSyncs(employeeId: string): Promise<number> {
	const pending = await db
		.select({ id: bookings.id })
		.from(bookings)
		.where(
			and(
				eq(bookings.employeeId, employeeId),
				eq(bookings.type, "online"),
				inArray(bookings.status, ["ASSIGNED", "CONFIRMED", "RESCHEDULED"]),
				inArray(bookings.calendarSyncStatus, ["FAILED", "PENDING"]),
				// Past appointments do not need a link created retrospectively.
				gte(bookings.startsAt, new Date()),
			),
		);

	for (const row of pending) {
		// Clear the completed job id first, or the queue treats this as a
		// duplicate of the attempt that already ran and drops it.
		await releaseCalendarJob({ type: "sync", bookingId: row.id });
		await queueCalendar({ type: "sync", bookingId: row.id });
	}
	return pending.length;
}

export async function getBooking(id: string): Promise<BookingRow | null> {
	const [row] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
	return row ?? null;
}

export async function listBookingsForClient(clientUserId: string): Promise<BookingRow[]> {
	return db
		.select()
		.from(bookings)
		.where(eq(bookings.clientUserId, clientUserId))
		.orderBy(desc(bookings.startsAt));
}

export async function listBookings(filter: {
	status?: BookingStatus[];
	employeeId?: string;
	branchId?: string;
}): Promise<BookingRow[]> {
	return db
		.select()
		.from(bookings)
		.where(
			and(
				filter.status?.length ? inArray(bookings.status, filter.status) : undefined,
				filter.employeeId ? eq(bookings.employeeId, filter.employeeId) : undefined,
				filter.branchId ? eq(bookings.branchId, filter.branchId) : undefined,
			),
		)
		.orderBy(desc(bookings.startsAt));
}
