import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { notifications, opsUsers } from "../db/schema.js";
import { queueEmail, queuePush } from "../worker/queues.js";
import { publishToUser } from "../worker/pubsub.js";
import type { QueuedEmail } from "./notifications.js";

/**
 * Roles that triage incoming work (new leads / consultations) and therefore
 * receive email + in-app notifications when one is captured.
 */
const LEAD_NOTIFICATION_ROLES = ["super_admin", "admin", "manager", "coordinator"];

/**
 * Unified notification service — the single entry point for all notifications.
 *
 * Every business event that needs to notify a user calls `notify()` with:
 *   - `recipientUserId` (user.id — works for both clients and staff via Better Auth)
 *   - in-app notification fields (type, title, body, link)
 *   - optionally an `email` (QueuedEmail) — if provided, also enqueued via BullMQ
 *   - optionally `eventId` for idempotency (auto-generated if omitted)
 *
 * The service:
 *   1. Inserts into the `notifications` table (in-app bell)
 *   2. Publishes to Redis pub/sub (SSE real-time push)
 *   3. Enqueues a Web Push fan-out via BullMQ (push worker sends to all subscriptions)
 *   4. Optionally enqueues an email via BullMQ (with retry + audit log)
 *
 * Idempotency: if `eventId` is provided and a row with the same (eventId, userId)
 * already exists, the insert is skipped (ON CONFLICT DO NOTHING). If `eventId` is
 * not provided, one is auto-generated from type + userId + entityId when available,
 * or a random UUID (no dedup) otherwise.
 */

export type NotificationPriority = "critical" | "high" | "normal" | "low";

export type NotifyEvent = {
	/** Deterministic id for deduplication. Auto-generated if omitted. */
	eventId?: string;
	/** Semantic type — e.g. "booking.assigned" | "document.approved" | "lead.created" */
	type: string;
	/** Recipient's user.id (works for both clients and staff via Better Auth) */
	recipientUserId: string;
	title: string;
	body: string;
	/** Deep link to the relevant record in the portal or ops console */
	link?: string;
	priority?: NotificationPriority;
	/** Entity type for filtering — "case" | "document" | "booking" | "chat" | "ticket" | "lead" */
	entityType?: string;
	/** Entity ID for deep linking and dedup */
	entityId?: string;
	/** Case ID for case-scoped queries */
	caseId?: string;
	/** If provided, also queue an email via BullMQ (with retry + audit log) */
	email?: QueuedEmail;
};

function autoEventId(event: NotifyEvent): string {
	if (event.eventId) return event.eventId;
	if (event.entityId) {
		return `${event.type}:${event.recipientUserId}:${event.entityId}`;
	}
	return `${event.type}:${event.recipientUserId}:${randomUUID()}`;
}

/**
 * Send a notification to a single recipient.
 *
 * Creates an in-app notification, publishes to SSE, enqueues a push fan-out,
 * and optionally enqueues an email. All channels are independent — a failure
 * in one does not block the others.
 */
export async function notify(event: NotifyEvent): Promise<void> {
	const eventId = autoEventId(event);
	const priority = event.priority ?? "normal";

	// 1. Insert in-app notification (idempotent via eventId + userId unique index)
	let insertedId: string | null = null;
	try {
		const [row] = await db
			.insert(notifications)
			.values({
				userId: event.recipientUserId,
				type: event.type,
				title: event.title,
				body: event.body,
				link: event.link ?? null,
				eventId,
				priority,
				entityType: event.entityType ?? null,
				entityId: event.entityId ?? null,
				caseId: event.caseId ?? null,
				deliveredAt: new Date(),
			})
			.onConflictDoNothing({
				target: [notifications.eventId, notifications.userId],
			})
			.returning({ id: notifications.id });
		insertedId = row?.id ?? null;
	} catch (err) {
		console.error(`[notify] insert failed for ${eventId}:`, err);
	}

	// If the notification was a duplicate (conflict), skip everything else.
	if (!insertedId) return;

	// 2. Publish to Redis pub/sub for SSE real-time push
	publishToUser(event.recipientUserId, {
		id: insertedId,
		eventId,
		type: event.type,
		title: event.title,
		body: event.body,
		link: event.link,
		priority,
		entityType: event.entityType,
		entityId: event.entityId,
		caseId: event.caseId,
		createdAt: new Date().toISOString(),
	});

	// 3. Enqueue a Web Push fan-out (push worker sends to all subscriptions)
	try {
		await queuePush({
			userId: event.recipientUserId,
			notification: {
				id: insertedId,
				type: event.type,
				title: event.title,
				body: event.body,
				link: event.link ?? null,
			},
		});
	} catch (err) {
		console.error(`[notify] push queue failed for ${eventId}:`, err);
	}

	// 4. Optionally enqueue an email (with retry + audit log)
	if (event.email) {
		try {
			await queueEmail(event.email);
		} catch (err) {
			console.error(`[notify] email queue failed for ${eventId}:`, err);
		}
	}
}

/**
 * Notify multiple recipients with a single event type.
 * Each recipient gets their own in-app notification + push + optional email.
 */
export async function notifyMany(events: NotifyEvent[]): Promise<void> {
	await Promise.all(events.map(notify));
}

/* ── Staff lookup helpers ─────────────────────────────────────────────────── */

/**
 * Get user.ids for all active managers, coordinators, and super_admins.
 * Used to broadcast "new booking" / "new lead" notifications to the people
 * who triage incoming work.
 */
export async function getManagerAndCoordinatorUserIds(): Promise<
	{ userId: string }[]
> {
	const rows = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(and(eq(opsUsers.active, true), inArray(opsUsers.role, LEAD_NOTIFICATION_ROLES)));
	return rows
		.filter((r): r is { userId: string } => r.userId !== null)
		.map((r) => ({ userId: r.userId }));
}

/**
 * Same as getManagerAndCoordinatorUserIds but also returns each staff member's
 * email and name — used when we want to fan out an email alongside the in-app
 * / push / SSE notification (e.g. new lead).
 */
export async function getManagerAndCoordinatorContacts(): Promise<
	{ userId: string; email: string; name: string }[]
> {
	const rows = await db
		.select({ userId: opsUsers.userId, email: opsUsers.email, name: opsUsers.name })
		.from(opsUsers)
		.where(and(eq(opsUsers.active, true), inArray(opsUsers.role, LEAD_NOTIFICATION_ROLES)));
	return rows
		.filter((r): r is { userId: string; email: string; name: string } => r.userId !== null);
}

/**
 * Get the user.id for an ops_user by their email.
 * Used to notify a specific staff member when a booking is assigned to them.
 */
export async function getStaffUserIdByEmail(
	email: string,
): Promise<string | null> {
	const [row] = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(and(eq(opsUsers.email, email), eq(opsUsers.active, true)))
		.limit(1);
	return row?.userId ?? null;
}

/**
 * Get the user.id for an ops_user by their ops_user.id.
 * Used to notify a specific staff member when a case/ticket is assigned to them.
 */
export async function getStaffUserId(
	opsUserId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(eq(opsUsers.id, opsUserId))
		.limit(1);
	return row?.userId ?? null;
}

/**
 * Mark a notification as read (server-side).
 */
export async function markNotificationRead(
	userId: string,
	notificationId: string,
): Promise<void> {
	await db
		.update(notifications)
		.set({ read: true, readAt: new Date() })
		.where(
			and(
				eq(notifications.id, notificationId),
				eq(notifications.userId, userId),
			),
		);
}

/**
 * Mark all unread notifications as read for a user.
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
	await db
		.update(notifications)
		.set({ read: true, readAt: new Date() })
		.where(
			and(
				eq(notifications.userId, userId),
				eq(notifications.read, false),
			),
		);
}
