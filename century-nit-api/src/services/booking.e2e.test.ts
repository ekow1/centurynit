import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	bookingEvents,
	bookings,
	calendarBusyBlocks,
	opsUsers,
	staffCalendarAccounts,
	staffWorkingHours,
	users,
} from "../db/schema.js";
import { encrypt } from "../lib/crypto.js";
import { addMinutes, dateKeyInZone, zonedTimeToUtc } from "../lib/time.js";
import { FakeCalendarClient } from "./calendar/fake.js";
import { setCalendarClient } from "./calendar/index.js";
import {
	assignBooking,
	cancelBooking,
	cancelCalendarForBooking,
	createBooking,
	getBooking,
	queuePendingCalendarSyncs,
	rescheduleBooking,
	syncCalendarForBooking,
} from "./booking.js";
import {
	assignableEmployees,
	branchAvailability,
	isEmployeeAvailable,
	listWorkingHours,
	setWorkingHours,
} from "./availability.js";
import { clearSettingsCache, writeSetting } from "./settings.js";

/**
 * The end-to-end scenario from the brief, run against a real Postgres.
 *
 * These are integration tests on purpose. The most important guarantees in this
 * feature — §11's double-booking prevention and §14's idempotency — are enforced
 * by database constraints, so a mocked database would test nothing that matters
 * and would pass even if the constraints were missing.
 *
 * Requires a migrated database. Skipped, loudly, when one is not reachable.
 */

const TZ = "Africa/Accra";
const BRANCH = "accra-hq";
const calendar = new FakeCalendarClient();
let restoreCalendar: () => void;

/**
 * Probed at module load, not in `beforeAll`.
 *
 * `it`/`it.skip` is chosen while the file is being collected, which happens
 * before any hook runs — deciding in `beforeAll` would leave every case skipped
 * even with a database present, and the suite would look green while testing
 * nothing.
 */
const dbAvailable = await (async () => {
	try {
		await db.execute(sql`SELECT 1`);
		// Also confirm the scheduling migration has been applied.
		await db.execute(sql`SELECT 1 FROM bookings LIMIT 1`);
		return true;
	} catch {
		console.warn(
			"\n[booking.e2e] Postgres not reachable or migration not applied — skipping.\n" +
				"  docker compose up -d db && npm run db:migrate\n",
		);
		return false;
	}
})();

/** A weekday far enough ahead that "never offer today" cannot interfere. */
function futureWeekday(offsetDays = 7): string {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() + offsetDays);
	while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return dateKeyInZone(d, TZ);
}

/** The next date falling on `dow` (0=Sun…6=Sat), at least a week out. */
function nextWeekday(dow: number): string {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() + 7);
	while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
	return dateKeyInZone(d, TZ);
}

const CLIENT_ID = "e2e-client-user";
const CLIENT_2_ID = "e2e-client-user-2";
let employeeA: string;
/** Any staff member will do — the audit row just needs a real actor. */
const ACTOR = { opsUserId: "", email: "e2e-buffer@example.com" };
let employeeB: string;

async function seed() {
	await db
		.insert(users)
		.values([
			{ id: CLIENT_ID, email: "e2e-client@example.com", name: "John Doe", emailVerified: true },
			{ id: CLIENT_2_ID, email: "e2e-client2@example.com", name: "Jane Roe", emailVerified: true },
		])
		.onConflictDoNothing();

	const [a] = await db
		.insert(opsUsers)
		.values({
			email: "e2e-enoch@century-nit.com",
			name: "Enoch",
			role: "consultant",
			branch: "accra",
		})
		.onConflictDoUpdate({ target: opsUsers.email, set: { name: "Enoch" } })
		.returning();
	const [b] = await db
		.insert(opsUsers)
		.values({
			email: "e2e-ama@century-nit.com",
			name: "Ama",
			role: "consultant",
			branch: "accra",
		})
		.onConflictDoUpdate({ target: opsUsers.email, set: { name: "Ama" } })
		.returning();

	employeeA = a.id;
	ACTOR.opsUserId = a.id;
	employeeB = b.id;

	// Mon–Fri 09:00–17:00 for both (§3).
	for (const id of [employeeA, employeeB]) {
		await db
			.insert(staffWorkingHours)
			.values(
				[1, 2, 3, 4, 5].map((dayOfWeek) => ({
					opsUserId: id,
					dayOfWeek,
					startMinute: 9 * 60,
					endMinute: 17 * 60,
					timezone: TZ,
				})),
			)
			.onConflictDoNothing();

		await db
			.insert(staffCalendarAccounts)
			.values({
				opsUserId: id,
				provider: "google",
				googleAccountEmail: `${id}@example.com`,
				calendarId: "primary",
				accessTokenEncrypted: encrypt("access-token"),
				refreshTokenEncrypted: encrypt("refresh-token"),
				accessTokenExpiresAt: new Date(Date.now() + 3600_000),
			})
			.onConflictDoNothing();
	}
}

async function cleanBookings() {
	await db.delete(bookingEvents);
	await db.delete(bookings);
	await db.delete(calendarBusyBlocks);
}

beforeAll(async () => {
	if (!dbAvailable) return;
	restoreCalendar = setCalendarClient(calendar);
	await cleanBookings();
	await seed();
});

afterAll(async () => {
	if (!dbAvailable) return;
	await cleanBookings();
	restoreCalendar?.();
});

beforeEach(async () => {
	if (!dbAvailable) return;
	calendar.reset();
	await cleanBookings();
});

const maybe = () => (dbAvailable ? it : it.skip);

describe("required end-to-end scenario", () => {
	maybe()(
		"books, assigns, generates Meet, reschedules, cancels, and frees the slot",
		async () => {
			const date = futureWeekday();

			/* 1–2. Client books "Consultation"; it is created UNASSIGNED. */
			const created = await createBooking({
				data: {
					serviceId: "consultation",
					branchId: BRANCH,
					type: "online",
					date,
					time: "10:00",
					durationMinutes: 45,
					timezone: TZ,
				},
				client: { id: CLIENT_ID, name: "John Doe", email: "e2e-client@example.com" },
				serviceName: "Website Consultation",
			});

			expect(created.status).toBe("UNASSIGNED");
			expect(created.employeeId).toBeNull();
			// §1 — the client must not be told anyone is assigned yet.
			expect(created.meetingUrl).toBeNull();
			expect(created.reference).toMatch(/^CNS-\d{4}-\d{4}$/);

			/* 3–5. Manager sees it and checks who is actually free. */
			const startsAt = zonedTimeToUtc(date, "10:00", TZ);
			const options = await assignableEmployees({
				startsAt,
				durationMinutes: 45,
				timezone: TZ,
				branchId: BRANCH,
			});
			const enoch = options.find((o) => o.id === employeeA)!;
			expect(enoch.available).toBe(true);
			// calendarConnected now reflects an iCal feed, not the legacy Google
			// account this scenario still seeds to exercise the test calendar.
			expect(enoch.calendarConnected).toBe(false);

			/* 6–9. Assign → calendar event → Meet link saved on the booking. */
			const assigned = await assignBooking({
				bookingId: created.id,
				employeeId: employeeA,
				actor: { opsUserId: employeeA, name: "Manager", email: "manager@century-nit.com" },
			});

			expect(assigned.status).toBe("ASSIGNED");
			expect(assigned.employeeId).toBe(employeeA);
			expect(assigned.assignedAt).toBeTruthy();
			expect(assigned.calendarEventId).toBeTruthy();
			expect(assigned.meetingUrl).toMatch(/^https:\/\/meet\.google\.com\//);
			expect(assigned.calendarSyncStatus).toBe("SYNCED");

			/* 10–11. Both parties were notified — the calendar event carries both. */
			const event = calendar.events.get(assigned.calendarEventId!)!;
			expect(event.summary).toContain("John Doe");

			/* 12–16. Client reschedules; the event moves, the link survives. */
			const moved = await rescheduleBooking({
				bookingId: assigned.id,
				date,
				time: "14:00",
				reason: "Client requested a later slot",
				actor: { name: "John Doe", email: "e2e-client@example.com" },
			});

			expect(moved.status).toBe("RESCHEDULED");
			expect(moved.startsAt.getTime()).toBe(zonedTimeToUtc(date, "14:00", TZ).getTime());
			expect(moved.rescheduledAt).toBeTruthy();
			// The link the client already holds must keep working.
			expect(moved.meetingUrl).toBe(assigned.meetingUrl);
			expect(calendar.events.get(moved.calendarEventId!)!.startsAt.getTime()).toBe(
				moved.startsAt.getTime(),
			);

		/* The 10:00 slot it left is bookable again. */
		const afterMove = await branchAvailability({
			branchId: BRANCH,
			date,
			durationMinutes: 45,
			timezone: TZ,
		});
		expect(afterMove.find((s) => s.time === "10:00")?.available).toBe(true);
		// Parallel-consultant capacity: 14:00 still holds Enoch's booking, but Ama
		// is free there, so the slot remains bookable for the branch (not greyed).
		expect(afterMove.find((s) => s.time === "14:00")?.available).toBe(true);

			/* 17–19. Cancel: status CANCELLED and the calendar event is dropped. */
			const cancelled = await cancelBooking({
				bookingId: moved.id,
				reason: "No longer needed",
				actor: { name: "John Doe", email: "e2e-client@example.com" },
			});
			expect(cancelled.status).toBe("CANCELLED");
			expect(cancelled.cancelledAt).toBeTruthy();

			// The worker performs the Google side; run it inline here.
			await cancelCalendarForBooking(cancelled.id);
			expect(calendar.isCancelled(moved.calendarEventId!)).toBe(true);

			/* 20. The slot is free again — for the branch and for the employee. */
			const afterCancel = await branchAvailability({
				branchId: BRANCH,
				date,
				durationMinutes: 45,
				timezone: TZ,
			});
			expect(afterCancel.find((s) => s.time === "14:00")?.available).toBe(true);

			const employeeFree = await isEmployeeAvailable(
				employeeA,
				zonedTimeToUtc(date, "14:00", TZ),
				45,
				{ timezone: TZ },
			);
			expect(employeeFree.available).toBe(true);
		},
	);
});

describe("§11 double booking", () => {
	maybe()("two bookings can share a slot, but not the same consultant", async () => {
		const date = futureWeekday(8);

		const attempt = (clientId: string, name: string, email: string) =>
			createBooking({
				data: {
					serviceId: "consultation",
					branchId: BRANCH,
					type: "online",
					date,
					time: "11:00",
					durationMinutes: 45,
					timezone: TZ,
				},
				client: { id: clientId, name, email },
				serviceName: "Website Consultation",
			});

		// Parallel-consultant capacity: two unassigned bookings at the same
		// branch slot both succeed — the partial unique index is now keyed on
		// (branch, employee, startsAt), and null employees are distinct.
		const results = await Promise.allSettled([
			attempt(CLIENT_ID, "John Doe", "e2e-client@example.com"),
			attempt(CLIENT_2_ID, "Jane Roe", "e2e-client2@example.com"),
		]);
		const won = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
			{ id: string }
		>[];
		expect(won).toHaveLength(2);

		// The guard is per-consultant: assigning both to the same employee must
		// fail the second — the employee-overlap EXCLUDE constraint rejects it.
		await assignBooking({
			bookingId: won[0].value.id,
			employeeId: employeeA,
			actor: { opsUserId: employeeA, name: "Manager", email: "m@century-nit.com" },
		});
		await expect(
			assignBooking({
				bookingId: won[1].value.id,
				employeeId: employeeA,
				actor: { opsUserId: employeeA, name: "Manager", email: "m@century-nit.com" },
			}),
		).rejects.toMatchObject({ code: "EMPLOYEE_UNAVAILABLE" });

		// The second can still be routed to a different consultant.
		const ok = await assignBooking({
			bookingId: won[1].value.id,
			employeeId: employeeB,
			actor: { opsUserId: employeeB, name: "Manager", email: "m@century-nit.com" },
		});
		expect(ok.employeeId).toBe(employeeB);

		const [{ count }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(bookings)
			.where(eq(bookings.branchId, BRANCH));
		expect(count).toBe(2);
	});

	maybe()("refuses to assign an employee who already has that slot", async () => {
		const date = futureWeekday(9);

		const first = await createBooking({
			data: {
				serviceId: "consultation",
				branchId: BRANCH,
				type: "online",
				date,
				time: "09:00",
				durationMinutes: 45,
				timezone: TZ,
			},
			client: { id: CLIENT_ID, name: "John Doe", email: "e2e-client@example.com" },
			serviceName: "Consultation",
		});
		await assignBooking({
			bookingId: first.id,
			employeeId: employeeA,
			actor: { opsUserId: employeeA, name: "Manager", email: "m@century-nit.com" },
		});

		// A second booking at a different branch, same instant.
		const second = await createBooking({
			data: {
				serviceId: "consultation",
				branchId: "kumasi",
				type: "online",
				date,
				time: "09:00",
				durationMinutes: 45,
				timezone: TZ,
			},
			client: { id: CLIENT_2_ID, name: "Jane Roe", email: "e2e-client2@example.com" },
			serviceName: "Consultation",
		});

		await expect(
			assignBooking({
				bookingId: second.id,
				employeeId: employeeA,
				actor: { opsUserId: employeeA, name: "Manager", email: "m@century-nit.com" },
			}),
		).rejects.toMatchObject({ code: "EMPLOYEE_UNAVAILABLE" });

		// The manager can still route it to someone who is free (§2, no round-robin).
		const ok = await assignBooking({
			bookingId: second.id,
			employeeId: employeeB,
			actor: { opsUserId: employeeB, name: "Manager", email: "m@century-nit.com" },
		});
		expect(ok.employeeId).toBe(employeeB);
	});
});

describe("§14 idempotency", () => {
	maybe()("re-assigning the same employee does not create a second Meet link", async () => {
		const date = futureWeekday(10);
		const booking = await createBooking({
			data: {
				serviceId: "consultation",
				branchId: BRANCH,
				type: "online",
				date,
				time: "13:00",
				durationMinutes: 45,
				timezone: TZ,
			},
			client: { id: CLIENT_ID, name: "John Doe", email: "e2e-client@example.com" },
			serviceName: "Consultation",
		});

		const actor = { opsUserId: employeeA, name: "Manager", email: "m@century-nit.com" };
		const first = await assignBooking({ bookingId: booking.id, employeeId: employeeA, actor });
		const retry = await assignBooking({ bookingId: booking.id, employeeId: employeeA, actor });

		expect(retry.calendarEventId).toBe(first.calendarEventId);
		expect(retry.meetingUrl).toBe(first.meetingUrl);
		expect(calendar.events.size).toBe(1);
	});
});

describe("§13 failure handling", () => {
	maybe()("keeps the booking when Google is unavailable, and recovers on retry", async () => {
		const date = futureWeekday(11);
		const booking = await createBooking({
			data: {
				serviceId: "consultation",
				branchId: BRANCH,
				type: "online",
				date,
				time: "15:00",
				durationMinutes: 45,
				timezone: TZ,
			},
			client: { id: CLIENT_ID, name: "John Doe", email: "e2e-client@example.com" },
			serviceName: "Consultation",
		});

		calendar.failNextCalls = 1;
		const assigned = await assignBooking({
			bookingId: booking.id,
			employeeId: employeeA,
			actor: { opsUserId: employeeA, name: "Manager", email: "m@century-nit.com" },
		});

		// The booking survives the outage in a recoverable state.
		expect(assigned.status).toBe("ASSIGNED");
		expect(assigned.employeeId).toBe(employeeA);
		expect(assigned.calendarSyncStatus).toBe("FAILED");
		expect(assigned.calendarSyncError).toBeTruthy();
		expect(assigned.meetingUrl).toBeNull();

		// What the queued retry does.
		const repaired = await syncCalendarForBooking(booking.id);
		expect(repaired.calendarSyncStatus).toBe("SYNCED");
		expect(repaired.meetingUrl).toMatch(/^https:\/\/meet\.google\.com\//);
	});

	maybe()("marks the account for reconnection when the token is revoked", async () => {
		const date = futureWeekday(12);
		const booking = await createBooking({
			data: {
				serviceId: "consultation",
				branchId: BRANCH,
				type: "online",
				date,
				time: "16:00",
				durationMinutes: 45,
				timezone: TZ,
			},
			client: { id: CLIENT_ID, name: "John Doe", email: "e2e-client@example.com" },
			serviceName: "Consultation",
		});

		calendar.failWithAuthError = true;
		const assigned = await assignBooking({
			bookingId: booking.id,
			employeeId: employeeB,
			actor: { opsUserId: employeeB, name: "Manager", email: "m@century-nit.com" },
		});

		expect(assigned.status).toBe("ASSIGNED"); // not lost
		expect(assigned.calendarSyncStatus).toBe("FAILED");

		const [account] = await db
			.select()
			.from(staffCalendarAccounts)
			.where(eq(staffCalendarAccounts.opsUserId, employeeB));
		expect(account.needsReconnect).toBe(true);

		calendar.failWithAuthError = false;
	});
});

describe("deferred Google configuration", () => {
	maybe()(
		"a booking assigned before the calendar was connected is picked up afterwards",
		async () => {
			const date = futureWeekday(17);

			// The employee has no calendar account yet — the state a deployment is in
			// before anyone has connected, or before GOOGLE_* is configured at all.
			await db.delete(staffCalendarAccounts).where(eq(staffCalendarAccounts.opsUserId, employeeB));

			const booking = await createBooking({
				data: {
					serviceId: "consultation",
					branchId: BRANCH,
					type: "online",
					date,
					time: "11:00",
					durationMinutes: 45,
					timezone: TZ,
				},
				client: { id: CLIENT_ID, name: "John Doe", email: "e2e-client@example.com" },
				serviceName: "Consultation",
			});

			const assigned = await assignBooking({
				bookingId: booking.id,
				employeeId: employeeB,
				actor: { opsUserId: employeeB, name: "Manager", email: "m@century-nit.com" },
			});

			// Assignment still succeeds; only the link is missing. With no calendar
			// connection the sync is a no-op, so the booking stays PENDING.
			expect(assigned.status).toBe("ASSIGNED");
			expect(assigned.calendarSyncStatus).toBe("PENDING");
			expect(assigned.meetingUrl).toBeNull();

			// The employee now connects. queuePendingCalendarSyncs is what the OAuth
			// callback calls; here we assert it finds the backlog.
			await db.insert(staffCalendarAccounts).values({
				opsUserId: employeeB,
				provider: "google",
				googleAccountEmail: "late@example.com",
				calendarId: "primary",
				accessTokenEncrypted: encrypt("access-token"),
				refreshTokenEncrypted: encrypt("refresh-token"),
				accessTokenExpiresAt: new Date(Date.now() + 3600_000),
			});

			const queued = await queuePendingCalendarSyncs(employeeB);
			expect(queued).toBeGreaterThanOrEqual(1);

			// What the queued job does when it runs.
			const repaired = await syncCalendarForBooking(booking.id);
			expect(repaired.calendarSyncStatus).toBe("SYNCED");
			expect(repaired.meetingUrl).toMatch(/^https:\/\/meet\.google\.com\//);
		},
	);
});

describe("§3 editing working hours", () => {
	maybe()("replaces the week, and omitting a day makes it non-working", async () => {
		// Tuesday mornings only.
		const outside = await setWorkingHours(employeeA, {
			timezone: TZ,
			days: [{ dayOfWeek: 2, start: "09:00", end: "12:00" }],
		});
		expect(outside).toBe(0);

		const saved = await listWorkingHours(employeeA);
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({ dayOfWeek: 2, start: "09:00", end: "12:00" });

		// Monday is gone, so nobody can be assigned then.
		const monday = nextWeekday(1);
		const onMonday = await isEmployeeAvailable(
			employeeA,
			zonedTimeToUtc(monday, "10:00", TZ),
			45,
			{ timezone: TZ },
		);
		expect(onMonday.available).toBe(false);
		expect(onMonday.reason).toBe("no-working-hours");

		// Tuesday afternoon is outside the new window.
		const tuesday = nextWeekday(2);
		const tueAfternoon = await isEmployeeAvailable(
			employeeA,
			zonedTimeToUtc(tuesday, "14:00", TZ),
			45,
			{ timezone: TZ },
		);
		expect(tueAfternoon.available).toBe(false);
		expect(tueAfternoon.reason).toBe("outside-hours");

		// Tuesday morning still works.
		const tueMorning = await isEmployeeAvailable(
			employeeA,
			zonedTimeToUtc(tuesday, "10:00", TZ),
			45,
			{ timezone: TZ },
		);
		expect(tueMorning.available).toBe(true);

		// Restore for the rest of the suite.
		await setWorkingHours(employeeA, {
			timezone: TZ,
			days: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
				dayOfWeek,
				start: "09:00",
				end: "17:00",
			})),
		});
	});

	maybe()("reports existing bookings left outside narrowed hours, without moving them", async () => {
		const date = futureWeekday(19);
		const booking = await createBooking({
			data: {
				serviceId: "consultation",
				branchId: BRANCH,
				type: "online",
				date,
				time: "15:00",
				durationMinutes: 45,
				timezone: TZ,
			},
			client: { id: CLIENT_ID, name: "John Doe", email: "e2e-client@example.com" },
			serviceName: "Consultation",
		});
		await assignBooking({
			bookingId: booking.id,
			employeeId: employeeA,
			actor: { opsUserId: employeeA, name: "Manager", email: "m@century-nit.com" },
		});

		// Employee now says they finish at noon — the 15:00 booking predates that.
		const outside = await setWorkingHours(employeeA, {
			timezone: TZ,
			days: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
				dayOfWeek,
				start: "09:00",
				end: "12:00",
			})),
		});

		expect(outside).toBe(1);

		// The commitment stands — narrowing hours must not cancel or move it.
		const after = await getBooking(booking.id);
		expect(after?.status).toBe("ASSIGNED");
		expect(after?.employeeId).toBe(employeeA);
		expect(after?.startsAt.getTime()).toBe(zonedTimeToUtc(date, "15:00", TZ).getTime());

		await setWorkingHours(employeeA, {
			timezone: TZ,
			days: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
				dayOfWeek,
				start: "09:00",
				end: "17:00",
			})),
		});
	});
});

describe("§12 external calendar conflicts", () => {
	maybe()("treats an event added directly in Google as busy", async () => {
		const date = futureWeekday(13);
		const startsAt = zonedTimeToUtc(date, "10:00", TZ);

		const before = await isEmployeeAvailable(employeeA, startsAt, 45, { timezone: TZ });
		expect(before.available).toBe(true);

		// What the webhook-driven refresh writes.
		await db.insert(calendarBusyBlocks).values({
			opsUserId: employeeA,
			externalEventId: "ext-dentist",
			startsAt,
			endsAt: addMinutes(startsAt, 60),
			summary: "Dentist",
		});

		const after = await isEmployeeAvailable(employeeA, startsAt, 45, { timezone: TZ });
		expect(after.available).toBe(false);
		expect(after.reason).toBe("conflict");
	});
});

describe("§3 working hours", () => {
	maybe()("refuses a slot outside the employee's hours", async () => {
		const date = futureWeekday(14);
		// 17:00 start with a 45-minute service ends past a 17:00 finish.
		const late = await isEmployeeAvailable(employeeA, zonedTimeToUtc(date, "17:00", TZ), 45, {
			timezone: TZ,
		});
		expect(late.available).toBe(false);
		expect(late.reason).toBe("outside-hours");
	});

	maybe()("refuses a weekend, when no working hours exist for that day", async () => {
		const sunday = new Date();
		sunday.setUTCHours(0, 0, 0, 0);
		sunday.setUTCDate(sunday.getUTCDate() + 7);
		while (sunday.getUTCDay() !== 0) sunday.setUTCDate(sunday.getUTCDate() + 1);

		const result = await isEmployeeAvailable(
			employeeA,
			zonedTimeToUtc(dateKeyInZone(sunday, TZ), "10:00", TZ),
			45,
			{ timezone: TZ },
		);
		expect(result.available).toBe(false);
		expect(result.reason).toBe("no-working-hours");
	});
});

describe("booking buffer, set from the ops console", () => {
	/**
	 * The buffer is a platform setting, and every consumer used to read
	 * `process.env` instead — so the field in the Settings screen was inert, then
	 * and after any restart. Asserting on `bookingBufferMinutes()` alone would
	 * not have caught that: the accessor was correct, nothing called it.
	 *
	 * So this goes through `isEmployeeAvailable`, which is the check every write
	 * path runs before committing.
	 */
	maybe()("protects the gap after an existing booking", async () => {
		const date = futureWeekday(21);
		const startsAt = zonedTimeToUtc(date, "10:00", TZ);
		// Immediately after the 45-minute booking above ends.
		const backToBack = zonedTimeToUtc(date, "10:45", TZ);

		await db.insert(bookings).values({
			reference: "CNS-BUFFER-1",
			clientUserId: CLIENT_ID,
			clientName: "John Doe",
			clientEmail: "e2e-client@example.com",
			serviceId: "consultation",
			serviceName: "Consultation",
			branchId: BRANCH,
			startsAt,
			endsAt: addMinutes(startsAt, 45),
			timezone: TZ,
			durationMinutes: 45,
			status: "ASSIGNED",
			employeeId: employeeA,
		});

		// No buffer configured: back-to-back is allowed.
		await writeSetting("BOOKING_BUFFER_MINUTES", "0", ACTOR);
		clearSettingsCache();
		expect((await isEmployeeAvailable(employeeA, backToBack, 45, { timezone: TZ })).available).toBe(
			true,
		);

		// Save 30 minutes in the console; the very next check must honour it.
		await writeSetting("BOOKING_BUFFER_MINUTES", "30", ACTOR);
		const guarded = await isEmployeeAvailable(employeeA, backToBack, 45, { timezone: TZ });
		expect(guarded.available).toBe(false);
		expect(guarded.reason).toBe("booked");
	});
});
