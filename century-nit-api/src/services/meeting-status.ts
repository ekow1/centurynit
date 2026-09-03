import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings } from "../db/schema.js";
import { getMeetingStatus, MeetAuthError, MeetNotConnectedError } from "../services/meet/index.js";

/**
 * Poll live meeting status for online bookings whose slot is in the
 * "plausibly active" window: from 30 minutes before the scheduled start to
 * 90 minutes after. Outside that window the meeting is either not started or
 * long over — no point hitting Google.
 *
 * For each candidate booking, calls `spaces.get` and updates
 * `meetingActive` / `meetingParticipants` / `meetingCheckedAt` on the row.
 *
 * Errors are per-booking: a dead token or a missing space never fails the
 * whole run. `MeetNotConnectedError` short-circuits the entire batch —
 * there's no point retrying every booking when the integration is off.
 */
export async function pollMeetingStatus(): Promise<void> {
	const now = new Date();
	const from = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago
	const to = new Date(now.getTime() + 90 * 60 * 1000); // 90 min ahead

	const candidates = await db
		.select({
			id: bookings.id,
			meetingSpace: bookings.meetingSpace,
			startsAt: bookings.startsAt,
		})
		.from(bookings)
		.where(
			and(
				isNotNull(bookings.meetingSpace),
				inArray(bookings.status, ["ASSIGNED", "CONFIRMED", "RESCHEDULED"]),
				gte(bookings.startsAt, from),
				lte(bookings.startsAt, to),
			),
		);

	if (candidates.length === 0) return;

	for (const b of candidates) {
		if (!b.meetingSpace) continue;
		try {
			const status = await getMeetingStatus(b.meetingSpace);
			await db
				.update(bookings)
				.set({
					meetingActive: status.active,
					meetingParticipants: status.participantCount,
					meetingCheckedAt: now,
					updatedAt: now,
				})
				.where(eq(bookings.id, b.id));
		} catch (err) {
			if (err instanceof MeetNotConnectedError) {
				// No point continuing — every booking will fail the same way.
				return;
			}
			if (err instanceof MeetAuthError) {
				// Token is dead. Leave the stale status; the next reconnect
				// resets it. Log and move on.
				console.error(`[meetingStatus] auth error for booking ${b.id}:`, err.message);
				continue;
			}
			console.error(`[meetingStatus] error for booking ${b.id}:`, err instanceof Error ? err.message : err);
		}
	}
}
