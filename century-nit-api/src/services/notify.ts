import { db } from "../db/index.js";
import { notifications, opsUsers } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { connection } from "../worker/queues.js";

/**
 * Unified notification service.
 *
 * Every business event that needs to tell someone something flows through
 * `notify()`. This inserts a row into the `notifications` table (so the
 * portal/ops bell can list it) and publishes to Redis pub/sub (so any
 * connected SSE client pushes it in real-time).
 *
 * Email and push are handled by their own queues — `notify()` is the in-app
 * channel only. Callers that also need email should call `queueEmails()`
 * alongside `notify()` (or use `notifyWith()` for convenience).
 */

export type NotificationPriority = "critical" | "high" | "normal" | "low";

export type NotificationEvent = {
	/** The `users.id` of the recipient — same table for clients and staff. */
	recipientUserId: string;
	type: string;
	title: string;
	body: string;
	link?: string;
	priority?: NotificationPriority;
};

/** A notification row as returned to the client. */
export type NotificationRow = {
	id: string;
	type: string;
	title: string;
	body: string;
	link: string | null;
	read: boolean;
	createdAt: string;
};

/** Insert a notification and publish it to Redis for SSE delivery. */
export async function notify(event: NotificationEvent): Promise<void> {
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

	const channel = `user:${event.recipientUserId}:notifications`;
	const payload = JSON.stringify({
		id: row.id,
		type: row.type,
		title: row.title,
		body: row.body,
		link: row.link,
		createdAt: row.createdAt.toISOString(),
	});

	await connection.publish(channel, payload).catch(() => {
		/* Redis pub/sub is best-effort — SSE clients fall back to polling */
	});
}

/** Notify multiple recipients. */
export async function notifyMany(events: NotificationEvent[]): Promise<void> {
	await Promise.all(events.map((e) => notify(e).catch(() => {})));
}

/**
 * Resolve ops staff user IDs for a given role (or all active staff).
 * Returns `users.id` values suitable for `notify()`.
 */
export async function getStaffUserIdsByRole(
	roles?: string[],
): Promise<{ userId: string; name: string; email: string }[]> {
	const conditions = [eq(opsUsers.active, true)];
	if (roles && roles.length > 0) {
		conditions.push(
			roles.length === 1
				? eq(opsUsers.role, roles[0])
				: (() => {
						throw new Error("Use query builder for multiple roles");
					})(),
		);
	}

	const rows = await db
		.select({ userId: opsUsers.userId, name: opsUsers.name, email: opsUsers.email })
		.from(opsUsers)
		.where(and(...conditions));

	return rows.filter((r): r is { userId: string; name: string; email: string } => r.userId !== null);
}

/** Get all active managers and coordinators (for new-lead / unassigned-booking alerts). */
export async function getManagerAndCoordinatorUserIds(): Promise<
	{ userId: string; name: string; email: string }[]
> {
	const rows = await db
		.select({ userId: opsUsers.userId, name: opsUsers.name, email: opsUsers.email, role: opsUsers.role })
		.from(opsUsers)
		.where(eq(opsUsers.active, true));

	return rows
		.filter((r) => r.userId !== null && (r.role === "manager" || r.role === "coordinator" || r.role === "super_admin"))
		.map((r) => ({ userId: r.userId!, name: r.name, email: r.email }));
}

/** Resolve a single staff member's userId from their opsUserId. */
export async function getStaffUserId(opsUserId: string): Promise<string | null> {
	const [row] = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(eq(opsUsers.id, opsUserId))
		.limit(1);
	return row?.userId ?? null;
}

/** Resolve a single staff member's userId from their email. */
export async function getStaffUserIdByEmail(email: string): Promise<string | null> {
	const [row] = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(eq(opsUsers.email, email))
		.limit(1);
	return row?.userId ?? null;
}
