import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { opsUsers, users } from "../db/schema.js";
import { notifications } from "../db/schema.js";
import { connection } from "../worker/queues.js";

/**
 * Unified in-app notification service.
 *
 * `notify()` is the single producer for the `notifications` table. It writes a
 * row (the source of truth, so a notification survives a Redis hiccup) and then
 * publishes the same payload to Redis pub/sub so any connected SSE/WebSocket
 * listener can push it to the client in real time.
 *
 * Every call site wraps `notify()` in `.catch(() => {})` — a notification
 * failure must never roll back the business operation that triggered it
 * (§13), the same contract the email queue already honours.
 */

export type NotificationPriority = "low" | "normal" | "high";

export type NotifyEvent = {
	recipientUserId: string;
	type: string;
	title: string;
	body: string;
	link?: string | null;
	priority?: NotificationPriority;
};

/** Redis channel clients subscribe to for real-time delivery. */
export const NOTIFICATION_CHANNEL = "century-nit:notifications";

/**
 * Insert a notification and publish it to Redis pub/sub.
 *
 * Returns the created row on success. Callers that treat this as fire-and-
 * forget should chain `.catch(() => {})` so a transient Redis/DB error does not
 * surface as a 500 on the triggering request.
 */
export async function notify(event: NotifyEvent): Promise<typeof notifications.$inferSelect> {
	const [row] = await db
		.insert(notifications)
		.values({
			userId: event.recipientUserId,
			type: event.type,
			title: event.title,
			body: event.body,
			link: event.link ?? null,
		})
		.returning();

	// Best-effort realtime fan-out. A failed publish just means the client polls
	// on its next request — the row is already persisted.
	try {
		await connection.publish(
			NOTIFICATION_CHANNEL,
			JSON.stringify({
				id: row.id,
				userId: row.userId,
				type: row.type,
				title: row.title,
				body: row.body,
				link: row.link,
				createdAt: row.createdAt.toISOString(),
				priority: event.priority ?? "normal",
			}),
		);
	} catch (err) {
		console.warn("[notify] redis publish failed:", err instanceof Error ? err.message : err);
	}

	return row;
}

/**
 * Batch variant of {@link notify}. Inserts all rows in one statement and
 * publishes each payload. Use this when several recipients get the same event
 * (e.g. every manager is told about a new booking).
 */
export async function notifyMany(events: NotifyEvent[]): Promise<void> {
	if (events.length === 0) return;
	await Promise.all(events.map((e) => notify(e).catch(() => {})));
}

/**
 * Every active manager, coordinator and super admin — the roles that triage
 * unassigned work. Returns the `users.id` (what `notifications.userId` stores)
 * alongside the name and email for callers that also send an email.
 */
export async function getManagerAndCoordinatorUserIds(): Promise<
	{ userId: string; name: string; email: string }[]
> {
	const rows = await db
		.select({
			userId: opsUsers.userId,
			name: opsUsers.name,
			email: opsUsers.email,
		})
		.from(opsUsers)
		.where(
			and(
				eq(opsUsers.active, true),
				inArray(opsUsers.role, ["manager", "coordinator", "super_admin"]),
			),
		);

	// `userId` is nullable on opsUsers (a staff row may exist before the auth
	// link is made). Drop any that are not yet linked — they cannot receive an
	// in-app notification until they are.
	return rows.filter((r): r is { userId: string; name: string; email: string } => Boolean(r.userId));
}

/** Resolve an `ops_users.id` to the `users.id` that owns the session. */
export async function getStaffUserId(opsUserId: string): Promise<string | null> {
	const [row] = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(eq(opsUsers.id, opsUserId))
		.limit(1);
	return row?.userId ?? null;
}

/** Resolve a staff member's email to the `users.id` that owns the session. */
export async function getStaffUserIdByEmail(email: string): Promise<string | null> {
	const [row] = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(eq(opsUsers.email, email))
		.limit(1);
	return row?.userId ?? null;
}

/**
 * Resolve a client/applicant's `users.id` from their email. Used by callers
 * that have a booking's `clientEmail` snapshot rather than the user id.
 */
export async function getUserIdByEmail(email: string): Promise<string | null> {
	const [row] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email))
		.limit(1);
	return row?.id ?? null;
}
