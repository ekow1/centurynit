import { and, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { ACTIVE_BOOKING_STATUSES, type CalendarSyncStatus } from "century-nit-shared";
import {
  BRANCH_AVAILABILITY,
  branches,
  coreServices,
  servicePackages,
  type Branch,
} from "century-nit-core/content";
import { db } from "../db/index.js";
import {
  bookings,
  opsUsers,
  staffWorkingHours,
} from "../db/schema.js";
import {
  bookingBufferMinutes,
  defaultTimezone,
  weeklySlotSchedule,
} from "./settings.js";
import { HttpError } from "../middleware/error.js";
import {
	addMinutes,
	dayOfWeekInZone,
	minutesToTime,
	overlaps,
	timeToMinutes,
	zonedTimeToUtc,
} from "../lib/time.js";

/**
 * Availability.
 *
 * The rule the whole feature rests on: **the server is authoritative** (§10).
 * The frontend renders these results, but every create, assign and reschedule
 * re-checks here before writing, because the UI's view is always slightly stale
 * and a determined client can send anything.
 *
 * A slot is available only if all four hold:
 *   1. it is in the future
 *   2. it falls inside the employee's working hours for that weekday
 *   3. no active booking of theirs overlaps it
 *   4. no external Google Calendar event of theirs overlaps it (§12)
 *
 * Buffer minutes, when configured, widen the window each existing commitment
 * occupies — travel and note-taking time either side.
 */

function computeSlotTimes(openStart: string, openEnd: string, intervalMinutes: number): string[] {
	const startMin = timeToMinutes(openStart);
	const endMin = timeToMinutes(openEnd);
	if (endMin <= startMin || intervalMinutes <= 0) return [];

	const times: string[] = [];
	for (let t = startMin; t < endMin; t += intervalMinutes) {
		times.push(minutesToTime(t));
	}
	return times;
}

/**
 * Compute slot start times for a given weekday from the weekly schedule.
 *
 * Each day carries its own opening window and interval — Monday can be
 * 09:00–17:00 every 60 minutes while Saturday is 10:00–14:00 every 90.
 */
export async function slotTimesFor(dayOfWeek: number): Promise<string[]> {
	const schedule = await weeklySlotSchedule();
	const day = schedule.days.find((d) => d.dayOfWeek === dayOfWeek);
	if (!day?.enabled) return [];
	return computeSlotTimes(day.openStart, day.openEnd, day.intervalMinutes);
}

/* ── Branch and service catalogue ────────────────────────────────────────────
 * Branches and services stay in `century-nit-core/content`, the catalogue both
 * front ends already render. The API imports the pure-data subpath rather than
 * the package barrel, which also carries browser-only helpers. Duplicating this
 * seed into a database table would give two sources of truth for the same list.
 */

/** Resolve a client-supplied branch id, rejecting anything not in the catalogue. */
export function getBranchOrThrow(branchId: string): Branch {
	const branch = branches.find((b) => b.id === branchId);
	if (!branch) {
		throw new HttpError(400, "VALIDATION_ERROR", `Unknown branch: ${branchId}`);
	}
	return branch;
}

/** Days this branch opens at all, from the existing BRANCH_AVAILABILITY map. */
export function branchOpenOnDay(branchId: string, dayOfWeek: number): boolean {
	const days = BRANCH_AVAILABILITY[branchId];
	return days ? days.includes(dayOfWeek) : true;
}

/**
 * Resolve any spelling of a branch to its canonical catalogue id.
 *
 * The two halves of the product disagree and always have: `ops_users.branch`
 * says "accra", the branch catalogue says "accra-hq". Comparing them raw makes
 * every Accra consultant look like they belong to a different branch, which
 * silently emptied the manager's assign dialog. Anything comparing branches must
 * go through here.
 */
export function canonicalBranchId(label: string | null | undefined): string | null {
	if (!label) return null;
	const needle = label.trim().toLowerCase();
	const match =
		branches.find((b) => b.id.toLowerCase() === needle) ??
		branches.find((b) => b.name.toLowerCase() === needle) ??
		branches.find((b) => b.city.toLowerCase() === needle) ??
		branches.find((b) => b.id.toLowerCase().startsWith(`${needle}-`)) ??
		branches.find((b) => b.name.toLowerCase().includes(needle));
	return match?.id ?? null;
}

/** Whether two branch labels refer to the same branch, whatever their spelling. */
export function sameBranch(a: string | null | undefined, b: string | null | undefined): boolean {
	const ca = canonicalBranchId(a);
	const cb = canonicalBranchId(b);
	return ca !== null && ca === cb;
}

/**
 * Display name for a service id, resolved against the catalogue.
 *
 * Snapshotted onto the booking at creation so the record stays readable even if
 * the catalogue is later re-priced or renamed.
 */
export function resolveServiceName(serviceId: string): string {
	const pkg = servicePackages.find((s) => s.id === serviceId);
	if (pkg) return pkg.name;
	const core = coreServices.find((s) => s.id === serviceId);
	if (core) return core.title ?? core.id;
	// Consultation types are not in either list; fall back to a readable label
	// rather than failing a booking over a cosmetic field.
	return serviceId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type Interval = { startsAt: Date; endsAt: Date };

export type SlotAvailability = {
	time: string;
	startsAt: Date;
	endsAt: Date;
	available: boolean;
	reason?: "past" | "outside-hours" | "booked" | "conflict" | "no-working-hours";
};

/* ── Building blocks ─────────────────────────────────────────────────────── */

/** Active bookings for an employee that intersect the window. */
export async function employeeBookings(
	employeeId: string,
	from: Date,
	to: Date,
	excludeBookingId?: string,
): Promise<Interval[]> {
	const rows = await db
		.select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
		.from(bookings)
		.where(
			and(
				eq(bookings.employeeId, employeeId),
				inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
				lt(bookings.startsAt, to),
				gte(bookings.endsAt, from),
				excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined,
			),
		);
	return rows;
}

export type WorkingWindow = { startMinute: number; endMinute: number; timezone: string };

export async function workingHoursFor(
	employeeId: string,
	dayOfWeek: number,
): Promise<WorkingWindow | null> {
	const [row] = await db
		.select()
		.from(staffWorkingHours)
		.where(
			and(
				eq(staffWorkingHours.opsUserId, employeeId),
				eq(staffWorkingHours.dayOfWeek, dayOfWeek),
			),
		)
		.limit(1);
	return row
		? { startMinute: row.startMinute, endMinute: row.endMinute, timezone: row.timezone }
		: null;
}

/** Widen an interval by the configured buffer on both sides. */
function withBuffer(interval: Interval, buffer: number): Interval {
	if (buffer === 0) return interval;
	return {
		startsAt: addMinutes(interval.startsAt, -buffer),
		endsAt: addMinutes(interval.endsAt, buffer),
	};
}

/*
 * The buffer is passed in rather than read here.
 *
 * It is a setting now, so reading it is async, and this runs inside `.some()`.
 * Each caller resolves it once for the whole check — which is also the correct
 * semantics: one availability decision should use one buffer value throughout,
 * not re-read it per interval.
 */
function conflicts(candidate: Interval, existing: Interval[], buffer: number): boolean {
	return existing.some((e) => {
		const b = withBuffer(e, buffer);
		return overlaps(candidate.startsAt, candidate.endsAt, b.startsAt, b.endsAt);
	});
}

/* ── Employee-level availability ─────────────────────────────────────────── */

/**
 * Can this employee take a meeting at this exact instant?
 *
 * The single check every write path calls before committing — §10's "final
 * availability check".
 */
export async function isEmployeeAvailable(
	employeeId: string,
	startsAt: Date,
	durationMinutes: number,
	options: { excludeBookingId?: string; timezone?: string } = {},
): Promise<{ available: boolean; reason?: SlotAvailability["reason"] }> {
	const endsAt = addMinutes(startsAt, durationMinutes);

	if (startsAt.getTime() <= Date.now()) {
		return { available: false, reason: "past" };
	}

	const timezone = options.timezone ?? (await defaultTimezone());
	const dow = dayOfWeekInZone(startsAt, timezone);
	const hours = await workingHoursFor(employeeId, dow);
	if (!hours) return { available: false, reason: "no-working-hours" };

	// Compare in the employee's own zone — their 09:00 is not the branch's.
	const localStart = dayMinutesInZone(startsAt, hours.timezone);
	const localEnd = localStart + durationMinutes;
	if (localStart < hours.startMinute || localEnd > hours.endMinute) {
		return { available: false, reason: "outside-hours" };
	}

	const booked = await employeeBookings(employeeId, addMinutes(startsAt, -240), addMinutes(endsAt, 240), options.excludeBookingId);

	const buffer = await bookingBufferMinutes();
	if (conflicts({ startsAt, endsAt }, booked, buffer)) return { available: false, reason: "booked" };

	return { available: true };
}

/** Minutes past local midnight for an instant, in a zone. */
function dayMinutesInZone(instant: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
	}).formatToParts(instant);
	const map: Record<string, string> = {};
	for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
	return (Number(map.hour) % 24) * 60 + Number(map.minute);
}

/* ── Branch-level availability (what the client booking form shows) ──────── */

/**
 * Slots a client may book at a branch on a date.
 *
 * Before assignment there is no employee yet, so this reflects branch capacity:
 * one active booking per branch slot, which is what the database's partial
 * unique index enforces (§11). When `employeeId` is given — the manager's assign
 * dialog — it additionally accounts for that employee's own commitments.
 */
export async function branchAvailability(input: {
  branchId: string;
  date: string;
  durationMinutes: number;
  timezone: string;
  employeeId?: string;
  excludeBookingId?: string;
}): Promise<{ slots: SlotAvailability[]; calendarSyncStatus: CalendarSyncStatus }> {
  const { branchId, date, durationMinutes, timezone, employeeId } = input;
  // Resolved once for the whole grid: every slot in one answer must be judged
  // against the same buffer.
  const buffer = await bookingBufferMinutes();

  getBranchOrThrow(branchId); // reject unknown branch ids from client input

  const dayStart = zonedTimeToUtc(date, "00:00", timezone);
  const dayEnd = addMinutes(dayStart, 24 * 60);
  const dayOfWeek = dayOfWeekInZone(dayStart, timezone);
  const times = await slotTimesFor(dayOfWeek);

  // The branch is shut that weekday — no slot on it is bookable, whoever asks.
  if (!branchOpenOnDay(branchId, dayOfWeek)) {
    return {
      slots: times.map((time) => {
        const startsAt = zonedTimeToUtc(date, time, timezone);
        return {
          time,
          startsAt,
          endsAt: addMinutes(startsAt, durationMinutes),
          available: false,
          reason: "outside-hours" as const,
        };
      }),
      calendarSyncStatus: "NOT_REQUIRED",
    };
  }

  const branchTaken = await db
    .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt, employeeId: bookings.employeeId })
    .from(bookings)
    .where(
      and(
        eq(bookings.branchId, branchId),
        inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
        gte(bookings.startsAt, dayStart),
        lt(bookings.startsAt, dayEnd),
        input.excludeBookingId ? ne(bookings.id, input.excludeBookingId) : undefined,
      ),
    );

  const employeeIntervals: Interval[] = employeeId
    ? await employeeBookings(employeeId, dayStart, dayEnd, input.excludeBookingId)
    : [];

  const hours = employeeId
    ? await workingHoursFor(employeeId, dayOfWeekInZone(dayStart, timezone))
    : null;

  // Parallel-consultant capacity. A public-form slot is bookable while at
  // least one consultant is free — working that day, inside their own hours,
  // and not booked (in *any* branch, so cross-branch counts). Each unassigned
  // booking already occupying the slot will consume one free consultant when
  // assigned, so remaining capacity is freeCount minus the unassigned bookings
  // parked at that instant. A slot greys out only when no consultant remains
  // free. The internal calendar is the sole source of truth — no external
  // Google Calendar busy blocks are consulted.
  const consultants = employeeId
    ? []
    : (
        await db
          .select({ id: opsUsers.id })
          .from(opsUsers)
          .where(
            and(
              eq(opsUsers.active, true),
              inArray(opsUsers.role, ["consultant", "coordinator", "manager"]),
            ),
          )
      ).map((c) => c.id);

  const consultantHours = new Map<
    string,
    { startMinute: number; endMinute: number; timezone: string }
  >();
  const consultantBookings = new Map<string, Interval[]>();

  if (consultants.length > 0) {
    const dow = dayOfWeekInZone(dayStart, timezone);
    const hoursRows = await db
      .select()
      .from(staffWorkingHours)
      .where(
        and(
          inArray(staffWorkingHours.opsUserId, consultants),
          eq(staffWorkingHours.dayOfWeek, dow),
        ),
      );
    for (const h of hoursRows) {
      consultantHours.set(h.opsUserId, {
        startMinute: h.startMinute,
        endMinute: h.endMinute,
        timezone: h.timezone,
      });
    }

    // Per-consultant bookings across *all* branches — a consultant busy in
    // Accra is not free for a Kumasi slot at the same instant either.
    const bookingRows = await db
      .select({
        employeeId: bookings.employeeId,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
      })
      .from(bookings)
      .where(
        and(
          inArray(bookings.employeeId, consultants),
          inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
          lt(bookings.startsAt, dayEnd),
          gte(bookings.endsAt, dayStart),
          input.excludeBookingId ? ne(bookings.id, input.excludeBookingId) : undefined,
        ),
      );
    for (const b of bookingRows) {
      if (!b.employeeId) continue;
      const list = consultantBookings.get(b.employeeId) ?? [];
      list.push({ startsAt: b.startsAt, endsAt: b.endsAt });
      consultantBookings.set(b.employeeId, list);
    }
  }

  // The internal calendar is the sole source of truth. There is no external
  // calendar feed to sync, so the response always reports NOT_REQUIRED.
  const calendarSyncStatus: CalendarSyncStatus = "NOT_REQUIRED";

  const slotsResult = times.map((time): SlotAvailability => {
    const startsAt = zonedTimeToUtc(date, time, timezone);
    const endsAt = addMinutes(startsAt, durationMinutes);
    const slot: SlotAvailability = { time, startsAt, endsAt, available: true };

    if (startsAt.getTime() <= Date.now()) {
      return { ...slot, available: false, reason: "past" };
    }

    if (employeeId) {
      // Manager assign dialog — judging one specific consultant.
      if (!hours) return { ...slot, available: false, reason: "no-working-hours" };
      const localStart = timeToMinutes(time);
      if (localStart < hours.startMinute || localStart + durationMinutes > hours.endMinute) {
        return { ...slot, available: false, reason: "outside-hours" };
      }
      if (conflicts({ startsAt, endsAt }, employeeIntervals, buffer)) {
        return { ...slot, available: false, reason: "conflict" };
      }
      return slot;
    }

    // Public booking form — parallel-consultant capacity.
    let freeCount = 0;
    for (const id of consultants) {
      const h = consultantHours.get(id);
      if (!h) continue; // not working that day
      const localStart = dayMinutesInZone(startsAt, h.timezone);
      const localEnd = localStart + durationMinutes;
      if (localStart < h.startMinute || localEnd > h.endMinute) continue;
      if (conflicts({ startsAt, endsAt }, consultantBookings.get(id) ?? [], buffer)) continue;
      freeCount += 1;
    }
    const unassignedAtSlot = branchTaken.filter(
      (b) => b.employeeId === null && b.startsAt.getTime() === startsAt.getTime(),
    ).length;
    if (freeCount - unassignedAtSlot <= 0) {
      return { ...slot, available: false, reason: freeCount === 0 ? "conflict" : "booked" };
    }
    return slot;
  });

  return { slots: slotsResult, calendarSyncStatus };
}

/* ── Assign dialog ───────────────────────────────────────────────────────── */

export type EmployeeOption = {
	id: string;
	name: string;
	email: string;
	role: string;
	branch: string | null;
	available: boolean;
	reason?: SlotAvailability["reason"];
	calendarConnected: boolean;
};

/**
 * Every assignable employee, each marked available or not for this slot.
 *
 * Unavailable staff are returned rather than filtered out so the manager can see
 * *who* is busy and why — the "✕ Kwame - Busy" line in the brief — while the
 * assignment endpoint still refuses them.
 */
export async function assignableEmployees(input: {
	startsAt: Date;
	durationMinutes: number;
	timezone: string;
	branchId?: string;
	excludeBookingId?: string;
}): Promise<EmployeeOption[]> {
	const staff = await db
		.select()
		.from(opsUsers)
		.where(
			and(
				eq(opsUsers.active, true),
				// Only roles that carry a caseload; admin and finance do not.
				inArray(opsUsers.role, ["consultant", "coordinator", "manager"]),
			),
		);

	return Promise.all(
		staff.map(async (s) => {
			const { available, reason } = await isEmployeeAvailable(
				s.id,
				input.startsAt,
				input.durationMinutes,
				{ excludeBookingId: input.excludeBookingId, timezone: input.timezone },
			);
			return {
				id: s.id,
				name: s.name,
				email: s.email,
				role: s.role,
				branch: s.branch,
				available,
				reason,
				// The internal calendar is the sole source of truth and is always
				// available — no external Google Calendar connection to check.
				calendarConnected: true,
			};
		}),
	);
}

/** Default 09:00–17:00, Monday to Friday — seeded for a new employee. */
export async function ensureDefaultWorkingHours(
	opsUserId: string,
	timezone?: string,
): Promise<void> {
	const zone = timezone ?? (await defaultTimezone());
	const existing = await db
		.select({ id: staffWorkingHours.id })
		.from(staffWorkingHours)
		.where(eq(staffWorkingHours.opsUserId, opsUserId))
		.limit(1);
	if (existing.length) return;

	await db.insert(staffWorkingHours).values(
		[1, 2, 3, 4, 5].map((dayOfWeek) => ({
			opsUserId,
			dayOfWeek,
			startMinute: 9 * 60,
			endMinute: 17 * 60,
			timezone: zone,
		})),
	);
}

/**
 * Replace an employee's working hours.
 *
 * The submitted set is the whole truth: days not listed are deleted, so
 * "I no longer work Fridays" is expressed by omission rather than needing a
 * separate delete call. Done in one transaction so a partial write cannot leave
 * an employee with half a week configured.
 *
 * Narrowing hours deliberately does **not** cancel or move existing bookings.
 * An appointment already agreed with a client is a commitment; silently
 * dropping it because someone edited a preference would be worse than the
 * inconsistency. The count of now-outside bookings is returned so the UI can say
 * so plainly.
 */
export async function setWorkingHours(
	opsUserId: string,
	input: { timezone: string; days: { dayOfWeek: number; start: string; end: string }[] },
): Promise<number> {
	await db.transaction(async (tx) => {
		await tx.delete(staffWorkingHours).where(eq(staffWorkingHours.opsUserId, opsUserId));
		if (input.days.length === 0) return;
		await tx.insert(staffWorkingHours).values(
			input.days.map((d) => ({
				opsUserId,
				dayOfWeek: d.dayOfWeek,
				startMinute: timeToMinutes(d.start),
				endMinute: timeToMinutes(d.end),
				timezone: input.timezone,
			})),
		);
	});

	return countBookingsOutsideHours(opsUserId);
}

/**
 * Future bookings assigned to this employee that no longer sit inside their
 * working hours. Advisory only — nothing is changed as a result.
 */
export async function countBookingsOutsideHours(opsUserId: string): Promise<number> {
	const upcoming = await db
		.select({
			startsAt: bookings.startsAt,
			endsAt: bookings.endsAt,
			timezone: bookings.timezone,
		})
		.from(bookings)
		.where(
			and(
				eq(bookings.employeeId, opsUserId),
				inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
				gte(bookings.startsAt, new Date()),
			),
		);

	if (upcoming.length === 0) return 0;

	const hours = await db
		.select()
		.from(staffWorkingHours)
		.where(eq(staffWorkingHours.opsUserId, opsUserId));
	const byDay = new Map(hours.map((h) => [h.dayOfWeek, h]));

	let outside = 0;
	for (const booking of upcoming) {
		const window = byDay.get(dayOfWeekInZone(booking.startsAt, booking.timezone));
		if (!window) {
			outside += 1; // not working that day at all
			continue;
		}
		const startMinute = dayMinutesInZone(booking.startsAt, window.timezone);
		const endMinute = dayMinutesInZone(booking.endsAt, window.timezone);
		if (startMinute < window.startMinute || endMinute > window.endMinute) outside += 1;
	}
	return outside;
}

/** Human-readable working hours, for the settings screen. */
export async function listWorkingHours(opsUserId: string) {
	const rows = await db
		.select()
		.from(staffWorkingHours)
		.where(eq(staffWorkingHours.opsUserId, opsUserId))
		.orderBy(staffWorkingHours.dayOfWeek);
	return rows.map((r) => ({
		dayOfWeek: r.dayOfWeek,
		start: minutesToTime(r.startMinute),
		end: minutesToTime(r.endMinute),
		timezone: r.timezone,
	}));
}

/** Used by the webhook to decide whether a change actually affects anything. */
export async function hasActiveBookingsInWindow(
	employeeId: string,
	from: Date,
	to: Date,
): Promise<boolean> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(bookings)
		.where(
			and(
				eq(bookings.employeeId, employeeId),
				inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
				lt(bookings.startsAt, to),
				gte(bookings.endsAt, from),
				or(eq(bookings.status, "ASSIGNED"), eq(bookings.status, "CONFIRMED")),
			),
		);
	return (row?.count ?? 0) > 0;
}
