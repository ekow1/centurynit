import { and, eq, like, lte, gte, sql } from "drizzle-orm";
import { Component, Event as IcalEvent, Time, parse as parseIcs } from "ical.js";
import { db } from "../../db/index.js";
import { calendarBusyBlocks, staffCalendarFeeds } from "../../db/schema.js";
import { decryptNullable } from "../../lib/crypto.js";

/**
 * iCal/ICS availability mirror.
 *
 * Replaces the removed Google Calendar OAuth integration. Each staff member
 * pastes their calendar's read-only secret iCal address; a worker calls
 * {@link syncCalendarFeeds} on a schedule to pull the busy windows into
 * `calendar_busy_blocks`, which the availability check already subtracts — so
 * an external meeting blocks the portal slot with zero OAuth and zero Google
 * verification, and works with Google, Outlook, Apple, or any ICS publisher.
 *
 * Busy blocks written here are namespaced `ics:<uid>` so they never collide
 * with the legacy Google rows (now cleared), and a feed's whole forward window
 * is replaced atomically so a deleted/modified upstream event stops blocking.
 */

/** How far forward to mirror. Busy times beyond this are ignored. */
const FORWARD_DAYS = 90;

export type BusyBlock = {
	uid: string;
	summary: string | null;
	startsAt: Date;
	endsAt: Date;
};

/**
 * Expand an ICS document into concrete busy windows overlapping `[from, to)`.
 *
 * Recurring events (RRULE/EXDATE) are expanded occurrence-by-occurrence via
 * ical.js's iterator; non-recurring events are included verbatim. All-day events
 * (DATE-valued, no time) convert to a UTC midnight range — correct at UTC+0
 * (the deployment's zone) and a close-enough approximation elsewhere.
 */
export function parseIcsBusyBlocks(ics: string, from: Date, to: Date): BusyBlock[] {
	const jcal = parseIcs(ics);
	const comp = new Component(jcal);
	const vevents = comp.getAllSubcomponents("vevent");
	const blocks: BusyBlock[] = [];

	for (const vevent of vevents) {
		const event = new IcalEvent(vevent);
		const uid = event.uid;
		if (!uid) continue;
		const summary = event.summary || null;

		if (event.isRecurring()) {
			const iter = event.iterator();
			let occurrence: Time | null;
			// Occurrences are emitted in ascending order, so the first one past
			// `to` means we are done — no need to walk the whole unbounded series.
			while ((occurrence = iter.next()) !== null) {
				const start = occurrence.toJSDate();
				if (start.getTime() > to.getTime()) break;
				const det = event.getOccurrenceDetails(occurrence);
				const endsAt = det.endDate.toJSDate();
				if (endsAt.getTime() <= from.getTime()) continue;
				blocks.push({ uid, summary, startsAt: det.startDate.toJSDate(), endsAt });
			}
		} else {
			const startsAt = event.startDate.toJSDate();
			const endsAt = event.endDate.toJSDate();
			if (endsAt.getTime() > from.getTime() && startsAt.getTime() < to.getTime()) {
				blocks.push({ uid, summary, startsAt, endsAt });
			}
		}
	}

	return blocks;
}

/**
 * Mirror every configured feed into `calendar_busy_blocks`.
 *
 * Each feed is independent — one feed failing to fetch or parse must not stop
 * the others, and each stores its own `lastError` so the UI can say which
 * consultant's calendar is not syncing.
 */
export async function syncCalendarFeeds(): Promise<void> {
	const feeds = await db.select().from(staffCalendarFeeds);
	for (const feed of feeds) {
		try {
			await syncFeed(feed.id);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Unknown sync error";
			await db
				.update(staffCalendarFeeds)
				.set({ lastError: message.slice(0, 500), updatedAt: new Date() })
				.where(eq(staffCalendarFeeds.id, feed.id));
		}
	}
}

/** Fetch and mirror a single feed, replacing its forward busy windows. */
export async function syncFeed(feedId: string): Promise<void> {
	const [feed] = await db
		.select()
		.from(staffCalendarFeeds)
		.where(eq(staffCalendarFeeds.id, feedId))
		.limit(1);
	if (!feed) return;

	const url = decryptNullable(feed.icsUrlEncrypted);
	if (!url) {
		throw new Error("Feed URL could not be decrypted — re-add the calendar feed.");
	}

	const from = new Date();
	const to = new Date(from.getTime() + FORWARD_DAYS * 24 * 60 * 60 * 1000);

	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok) throw new Error(`Calendar feed returned HTTP ${res.status}`);
	const ics = await res.text();

	const blocks = parseIcsBusyBlocks(ics, from, to);

	await db.transaction(async (tx) => {
		// Replace this user's ICS-sourced forward window in one shot so a
		// deleted/edited upstream event stops blocking the slot immediately.
		await tx
			.delete(calendarBusyBlocks)
			.where(
				and(
					eq(calendarBusyBlocks.opsUserId, feed.opsUserId),
					like(calendarBusyBlocks.externalEventId, "ics:%"),
					gte(calendarBusyBlocks.startsAt, from),
				),
			);
		if (blocks.length > 0) {
			await tx.insert(calendarBusyBlocks).values(
				blocks.map((b) => ({
					opsUserId: feed.opsUserId,
					externalEventId: `ics:${b.uid}`,
					startsAt: b.startsAt,
					endsAt: b.endsAt,
					summary: b.summary,
					syncedAt: new Date(),
				})),
			);
		}
		await tx
			.update(staffCalendarFeeds)
			.set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
			.where(eq(staffCalendarFeeds.id, feed.id));
	});
}

/** Remove a feed and the busy blocks it was mirroring. */
export async function removeCalendarFeed(opsUserId: string): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(calendarBusyBlocks).where(
			and(
				eq(calendarBusyBlocks.opsUserId, opsUserId),
				like(calendarBusyBlocks.externalEventId, "ics:%"),
			),
		);
		await tx.delete(staffCalendarFeeds).where(eq(staffCalendarFeeds.opsUserId, opsUserId));
	});
}

/** Total busy blocks mirrored, for an at-a-glance health signal in the UI. */
export async function feedBlockCount(opsUserId: string): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(calendarBusyBlocks)
		.where(
			and(
				eq(calendarBusyBlocks.opsUserId, opsUserId),
				like(calendarBusyBlocks.externalEventId, "ics:%"),
				lte(calendarBusyBlocks.startsAt, new Date()),
			),
		);
	return row?.count ?? 0;
}
