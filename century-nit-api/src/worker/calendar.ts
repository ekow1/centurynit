import { Worker } from "bullmq";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { calendarBusyBlocks, staffCalendarAccounts } from "../db/schema.js";
import {
	cancelCalendarForBooking,
	syncCalendarForBooking,
	updateCalendarForBooking,
} from "../services/booking.js";
import {
	CalendarAuthError,
	getCalendarClient,
	loadCredentials,
	markNeedsReconnect,
} from "../services/calendar/index.js";
import { connection, type CalendarJob } from "./queues.js";

/**
 * Calendar worker.
 *
 * This is what turns §13 from a promise into behaviour: when Google is
 * unavailable the booking is already committed and a job is waiting here, so
 * the Meet link arrives late rather than never. BullMQ's retry/backoff drives
 * the schedule; this only has to be idempotent, which the service layer
 * guarantees (an existing calendarEventId short-circuits).
 */

/**
 * Failures that will never succeed on retry.
 *
 * BullMQ retries anything that throws, which is right for a Google outage and
 * wrong for a booking that no longer exists — that job would burn all five
 * attempts with backoff and fill the log, for a row that is never coming back.
 * Permanent failures are logged and swallowed so the job completes.
 */
function isPermanent(err: unknown): boolean {
	const code = (err as { code?: string })?.code;
	return code === "BOOKING_NOT_FOUND" || code === "BOOKING_CANCELLED";
}

export const calendarWorker = new Worker<CalendarJob>(
	"calendar",
	async (job) => {
		const data = job.data;

		try {
			switch (data.type) {
				case "sync":
					await syncCalendarForBooking(data.bookingId);
					return;

				case "update":
					// Move the existing event. syncCalendarForBooking returns early
					// once a Meet link exists, so a failed reschedule must not go
					// down that path or the new time is never written to Google.
					await updateCalendarForBooking(data.bookingId);
					return;

				case "cancel":
					await cancelCalendarForBooking(data.bookingId);
					return;

				case "refreshBusy":
					await refreshBusyBlocks(data.opsUserId);
					return;
			}
		} catch (err) {
			if (isPermanent(err)) {
				console.warn(
					`[calendar] ${data.type} skipped — ${(err as Error).message}. Not retrying.`,
				);
				return;
			}
			throw err; // transient: let BullMQ back off and try again
		}
	},
	{ connection, concurrency: 4 },
);

/**
 * Re-read an employee's Google calendar into `calendar_busy_blocks`.
 *
 * §12 — the database is not assumed to be in step with Google. This is the
 * reconciliation: whatever Google currently says for the window replaces what we
 * held, so an event the employee added or deleted outside the app is reflected
 * in availability.
 *
 * The window is bounded (now → +60 days) because availability is only ever
 * offered that far ahead, and an unbounded sync on a busy calendar is slow and
 * mostly wasted.
 */
export async function refreshBusyBlocks(opsUserId: string): Promise<void> {
	const account = await loadCredentials(opsUserId);
	if (!account) return; // not connected, or needs reconnect — nothing to sync

	const from = new Date();
	const to = new Date(from.getTime() + 60 * 24 * 60 * 60 * 1000);

	let intervals;
	try {
		intervals = await (await getCalendarClient()).listBusy(account.credentials, {
			calendarId: account.calendarId,
			from,
			to,
		});
	} catch (err) {
		if (err instanceof CalendarAuthError) {
			await markNeedsReconnect(opsUserId);
			return; // do not retry a dead credential — the employee must reconnect
		}
		throw err; // transient: let BullMQ back off and retry
	}

	// Replace the window wholesale. Deleting first is what makes a *removed*
	// Google event free the slot again — an upsert-only sync never would.
	await db.transaction(async (tx) => {
		await tx
			.delete(calendarBusyBlocks)
			.where(
				and(
					eq(calendarBusyBlocks.opsUserId, opsUserId),
					gte(calendarBusyBlocks.startsAt, from),
					lte(calendarBusyBlocks.startsAt, to),
				),
			);

		if (intervals.length === 0) return;

		await tx
			.insert(calendarBusyBlocks)
			.values(
				intervals.map((i) => ({
					opsUserId,
					externalEventId: i.externalEventId,
					startsAt: i.startsAt,
					endsAt: i.endsAt,
					summary: i.summary,
					syncedAt: new Date(),
				})),
			)
			.onConflictDoNothing();
	});

	await db
		.update(staffCalendarAccounts)
		.set({ updatedAt: new Date() })
		.where(eq(staffCalendarAccounts.opsUserId, opsUserId));
}

calendarWorker.on("failed", (job, err) => {
	console.error(`[calendar worker] ${job?.name} ${job?.id} failed:`, err.message);
});
