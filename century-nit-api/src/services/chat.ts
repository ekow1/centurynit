import { desc, eq, and, sql, gt, ne, inArray, isNull, ilike } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
	ChatConversation,
	ChatConversationList,
	ChatMessage,
	ChatMessageList,
	ChatUnread,
	CreateConversation,
	SendMessage,
	StaffDirectory,
	MessageReaction,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	bookings,
	conversations,
	conversationParticipants,
	invoices,
	messages,
	messageMentions,
	messageReactions,
	messageAttachments,
	opsUsers,
	users,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { queueChatReplyCheck, queueEmail } from "../worker/queues.js";
import type { QueuedEmail } from "./notifications.js";
import { renderBookingEmail } from "../lib/email-templates.js";
import { env } from "../env.js";
import { notify, notifyMany, getManagerAndCoordinatorUserIds, getStaffUserId, isStaffActive } from "./notify.js";
import { publishToUser } from "../worker/pubsub.js";
import { serializeMessageRow, hydrateMessages, getMessageReactions } from "./message-serializer.js";
import { getDocumentStorage } from "./storage/index.js";
import { JOURNEY_STAGE_LABELS, type ConversationStatus } from "century-nit-shared";

/* ── Helpers ───────────────────────────────────────────────────────────── */

async function getParticipantOpsUser(opsUserId: string) {
	const [row] = await db
		.select({ id: opsUsers.id, name: opsUsers.name, email: opsUsers.email })
		.from(opsUsers)
		.where(eq(opsUsers.id, opsUserId))
		.limit(1);
	return row ?? null;
}

async function getParticipants(conversationId: string) {
	return db
		.select({
			opsUserId: conversationParticipants.opsUserId,
			name: opsUsers.name,
			email: opsUsers.email,
			role: conversationParticipants.role,
			lastReadAt: conversationParticipants.lastReadAt,
			joinedAt: conversationParticipants.joinedAt,
		})
		.from(conversationParticipants)
		.innerJoin(opsUsers, eq(conversationParticipants.opsUserId, opsUsers.id))
		.where(eq(conversationParticipants.conversationId, conversationId));
}

/**
 * Resolve the Better Auth user.id for each ops participant in a conversation.
 * SSE channels are keyed by user.id (the `user:{userId}:events` channel), not
 * opsUserId, so we must translate before publishing.
 */
async function getParticipantUserIds(conversationId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: opsUsers.userId })
		.from(conversationParticipants)
		.innerJoin(opsUsers, eq(conversationParticipants.opsUserId, opsUsers.id))
		.where(eq(conversationParticipants.conversationId, conversationId));
	return rows
		.map((r) => r.userId)
		.filter((id): id is string => id != null);
}

/** Publish a chat event to every participant's SSE channel (fire-and-forget). */
export function publishChatEvent(
	conversationId: string,
	payload: { type: string; conversationId: string; [key: string]: unknown },
	excludeOpsUserId?: string,
): void {
	(async () => {
		try {
			let userIds = await getParticipantUserIds(conversationId);
			if (excludeOpsUserId) {
				const [excluded] = await db
					.select({ userId: opsUsers.userId })
					.from(opsUsers)
					.where(eq(opsUsers.id, excludeOpsUserId))
					.limit(1);
				if (excluded?.userId) {
					userIds = userIds.filter((id) => id !== excluded.userId);
				}
			}
			for (const userId of userIds) {
				publishToUser(userId, payload);
			}
		} catch {
			// SSE is best-effort - a publish failure must not block the send.
		}
	})().catch(() => {});
}

/**
 * Conversation types a portal client may read (mirrors
 * CUSTOMER_VISIBLE_TYPES in communication.ts). internal/escalation/entity
 * threads are staff-only even when they happen to carry a userId.
 */
const CLIENT_VISIBLE_TYPES = new Set(["support", "case", "stage", "applicant"]);

/**
 * Push a chat.* event to the client side of a customer-facing conversation.
 * publishChatEvent resolves ops_users only, so it never reaches the portal:
 * the client's SSE channel is keyed by conversations.user_id and
 * participant_user_id rows, which this resolves instead. Callers MUST gate
 * on visibility - an internal note published here would leak into the
 * client's live transcript even though it never appears in history reads.
 */
export function publishChatEventToClient(
	conversationId: string,
	payload: { type: string; conversationId: string; [key: string]: unknown },
): void {
	(async () => {
		try {
			const [conv] = await db
				.select({ type: conversations.type, userId: conversations.userId })
				.from(conversations)
				.where(eq(conversations.id, conversationId))
				.limit(1);
			if (!conv || !CLIENT_VISIBLE_TYPES.has(conv.type)) return;
			const clientIds = new Set<string>();
			if (conv.userId) clientIds.add(conv.userId);
			const parts = await db
				.select({ participantUserId: conversationParticipants.participantUserId })
				.from(conversationParticipants)
				.where(
					and(
						eq(conversationParticipants.conversationId, conversationId),
						sql`${conversationParticipants.participantUserId} IS NOT NULL`,
					),
				);
			for (const p of parts) {
				if (p.participantUserId) clientIds.add(p.participantUserId);
			}
			for (const userId of clientIds) publishToUser(userId, payload);
		} catch {
			// SSE is best-effort - a publish failure must not block the send.
		}
	})().catch(() => {});
}

async function countUnread(conversationId: string, opsUserId: string): Promise<number> {
	const [participant] = await db
		.select({ lastReadAt: conversationParticipants.lastReadAt })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, opsUserId),
			),
		)
		.limit(1);

	if (!participant) return 0;

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(messages)
		.where(
			and(
				eq(messages.conversationId, conversationId),
				// IS DISTINCT FROM, not `<>`: `senderOpsUserId` is NULL for messages
				// sent by applicants, and `NULL <> 'x'` evaluates to NULL (not true),
				// so plain `ne` silently dropped every applicant message from the
				// staff-side unread count.
				sql`${messages.senderOpsUserId} IS DISTINCT FROM ${opsUserId}`,
				participant.lastReadAt
					? gt(messages.createdAt, participant.lastReadAt)
					: sql`true`,
			),
		);

	return count;
}

/* ── Serialize ──────────────────────────────────────────────────────────── */

function serializeConversation(
	row: typeof conversations.$inferSelect,
	participantsMap: Map<string, Awaited<ReturnType<typeof getParticipants>>>,
	unreadMap: Map<string, number>,
	lastMsgMap: Map<string, typeof messages.$inferSelect | undefined>,
	viewerOpsUserId: string,
	lastPublicMsgMap: Map<string, typeof messages.$inferSelect | undefined> = new Map(),
): ChatConversation {
	const participants = participantsMap.get(row.id) ?? [];
	const unread = unreadMap.get(row.id) ?? 0;
	const lastMsg = lastMsgMap.get(row.id);
	const lastPublicMsg = lastPublicMsgMap.get(row.id);
	const title =
		row.type === "direct"
			? (participants.find((p) => p.opsUserId != null && p.opsUserId !== viewerOpsUserId)?.name ?? row.title)
			: row.title;

	return {
		id: row.id,
		type: row.type as "applicant" | "direct" | "entity" | "group",
		status: (row.status ?? "open") as ChatConversation["status"],
		/** The portal user this conversation belongs to (client-facing threads). */
		clientUserId: row.userId ?? null,
		title,
		linkedEntityType: row.linkedEntityType,
		linkedEntityId: row.linkedEntityId,
		createdBy: row.createdBy,
		participants: participants
			.filter(p => p.opsUserId != null)
			.map((p) => ({
				opsUserId: p.opsUserId as string,
				name: p.name,
			email: p.email,
			role: p.role as "owner" | "member",
			lastReadAt: p.lastReadAt?.toISOString() ?? null,
			joinedAt: p.joinedAt.toISOString(),
		})),
		lastMessage: lastMsg ? serializeMessageRow(lastMsg) : null,
		// "Awaiting" = the last PUBLIC message is the client's. An internal
		// note must not mark the thread answered, and the viewer's unread
		// cursor must not mark it waiting.
		awaitingReply: Boolean(lastPublicMsg?.senderUserId),
		unreadCount: unread,
		lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
		subject: row.subject,
		category: row.category as ChatConversation["category"],
		priority: row.priority as ChatConversation["priority"],
		waitingOn: row.waitingOn as ChatConversation["waitingOn"],
		audience: row.audience as ChatConversation["audience"],
		raisedByOpsUserId: row.raisedByOpsUserId,
		firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
		resolvedAt: row.resolvedAt?.toISOString() ?? null,
		csatScore: row.csatScore,
		csatNote: row.csatNote,
		stageKey: row.stageKey,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function serializeMessage(row: typeof messages.$inferSelect): ChatMessage {
	return serializeMessageRow(row);
}

/* ── List conversations ─────────────────────────────────────────────────── */

export async function listConversations(
	opsUserId: string,
	staffRole?: string,
	/** "staff" = the generic chat hub (no client-facing threads); "desk" =
	 *  client-bound threads only (the Helpdesk queue). Default keeps the old
	 *  combined list for callers that haven't chosen a surface. */
	scope?: "staff" | "desk",
): Promise<ChatConversationList> {
	const membership = db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(eq(conversationParticipants.opsUserId, opsUserId))
		.as("membership");

	const SUPPORT_QUEUE_ROLES = new Set([
		"customer_service",
		"coordinator",
		"manager",
		"super_admin",
		"admin",
	]);
	const canSeeSupportQueue = !!staffRole && SUPPORT_QUEUE_ROLES.has(staffRole);

	const activityOrder = desc(sql`COALESCE(${conversations.lastMessageAt}, ${conversations.updatedAt})`);
	const rows = canSeeSupportQueue
		? await db
				.select()
				.from(conversations)
				.leftJoin(membership, eq(conversations.id, membership.conversationId))
				.where(
					// Queue visibility covers every client-bound thread, not just
					// support: an orphaned case/stage conversation (deleted or
					// unassigned officer, no participants) would otherwise be
					// invisible and the client's message would black-hole.
					sql`(${membership.conversationId} IS NOT NULL OR (
						${conversations.userId} IS NOT NULL AND
						${conversations.type} IN ('support', 'case', 'stage', 'applicant')
					))`,
				)
				.orderBy(activityOrder)
		: await db
				.select()
				.from(conversations)
				.innerJoin(membership, eq(conversations.id, membership.conversationId))
				.orderBy(activityOrder);

	const conversationIds = rows.map((r) => r.conversations.id);
	if (conversationIds.length === 0) {
		return { conversations: [], total: 0 };
	}

	// Batch-fetch all participants, unread counts, and last messages in 3 queries
	// instead of 3N individual queries.
	const allParticipants = await db
		.select({
			conversationId: conversationParticipants.conversationId,
			opsUserId: conversationParticipants.opsUserId,
			name: opsUsers.name,
			email: opsUsers.email,
			role: conversationParticipants.role,
			lastReadAt: conversationParticipants.lastReadAt,
			joinedAt: conversationParticipants.joinedAt,
		})
		.from(conversationParticipants)
		.innerJoin(opsUsers, eq(conversationParticipants.opsUserId, opsUsers.id))
		.where(inArray(conversationParticipants.conversationId, conversationIds));

	const participantsMap = new Map<string, typeof allParticipants>();
	for (const p of allParticipants) {
		const list = participantsMap.get(p.conversationId) ?? [];
		list.push(p);
		participantsMap.set(p.conversationId, list);
	}

	// Unread counts: for each conversation, find the user's lastReadAt from the
	// participants data we already fetched, then count messages after it.
	const unreadRows = await db
		.select({
			conversationId: messages.conversationId,
			count: sql<number>`count(*)::int`,
		})
		.from(messages)
		.where(
			and(
				inArray(messages.conversationId, conversationIds),
				ne(messages.senderOpsUserId, opsUserId),
				sql`${messages.createdAt} > (
					SELECT COALESCE(cp.last_read_at, '1970-01-01T00:00:00Z')
					FROM ${conversationParticipants} cp
					WHERE cp.conversation_id = ${messages.conversationId}
					AND cp.ops_user_id = ${opsUserId}
					LIMIT 1
				)`,
			),
		)
		.groupBy(messages.conversationId);

	const unreadMap = new Map<string, number>();
	for (const row of unreadRows) {
		unreadMap.set(row.conversationId, row.count);
	}

	// Last message per conversation. DISTINCT ON returns one row per thread
	// via the (conversation_id, created_at) index - the previous version
	// selected every message of every listed conversation and picked the
	// newest in JS, so each queue refresh read the entire history.
	const lastMsgRows = await db
		.select()
		.from(messages)
		.where(
			sql`${messages.id} = ANY (
				SELECT DISTINCT ON (conversation_id) id
				FROM ${messages}
				WHERE ${inArray(messages.conversationId, conversationIds)}
				ORDER BY conversation_id, created_at DESC
			)`,
		);

	const lastMsgMap = new Map<string, typeof messages.$inferSelect>();
	for (const msg of lastMsgRows) {
		lastMsgMap.set(msg.conversationId, msg);
	}

	// Same shape, restricted to public messages: "awaiting reply" is derived
	// from who wrote the last client-visible message, so a staff-only note
	// can't make a waiting thread look answered.
	const lastPublicMsgRows = await db
		.select()
		.from(messages)
		.where(
			sql`${messages.id} = ANY (
				SELECT DISTINCT ON (conversation_id) id
				FROM ${messages}
				WHERE ${inArray(messages.conversationId, conversationIds)}
				AND visibility = 'public'
				ORDER BY conversation_id, created_at DESC
			)`,
		);

	const lastPublicMsgMap = new Map<string, typeof messages.$inferSelect>();
	for (const msg of lastPublicMsgRows) {
		lastPublicMsgMap.set(msg.conversationId, msg);
	}

	let list = rows.map((r) =>
		serializeConversation(r.conversations, participantsMap, unreadMap, lastMsgMap, opsUserId, lastPublicMsgMap),
	);

	// Surface scoping: the staff chat hub is DMs/groups/internal only —
	// client-facing threads live on the Helpdesk page where claim/queue/SLA
	// exist. Internal-audience requests never reach a client read anyway.
	if (scope === "staff") {
		list = list.filter(
			(c) => !CLIENT_VISIBLE_TYPES.has(c.type) || c.audience === "internal",
		);
	} else if (scope === "desk") {
		list = list.filter(
			(c) => CLIENT_VISIBLE_TYPES.has(c.type) && c.audience !== "internal",
		);
	}

	return { conversations: list, total: list.length };
}

/* ── Get single conversation ────────────────────────────────────────────── */

/**
 * Support-queue roles that can see all type:"support" conversations.
 * Must stay in sync with the `listConversations` bypass above.
 */
const SUPPORT_QUEUE_ROLES = new Set([
	"customer_service",
	"coordinator",
	"manager",
	"super_admin",
	"admin",
]);

/**
 * If the staff member is a support-queue role and the conversation is a
 * client-facing thread they're not yet a participant in, auto-join them as
 * a "member" so they can view and reply. This is called from getConversation
 * and getMessages to bridge the gap between list visibility (which lets them
 * see every client-bound conversation) and detail access (which requires
 * membership). Must cover the same types the list bypass does, or queue
 * staff would see case/stage rows they cannot open.
 */
async function ensureSupportQueueAccess(
	conversationId: string,
	opsUserId: string,
	staffRole: string,
): Promise<void> {
	if (!SUPPORT_QUEUE_ROLES.has(staffRole)) return;
	const [conv] = await db
		.select({ type: conversations.type })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (!conv || !CLIENT_VISIBLE_TYPES.has(conv.type)) return;
	const [existing] = await db
		.select({ id: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, opsUserId),
			),
		)
		.limit(1);
	if (!existing) {
		await db
			.insert(conversationParticipants)
			.values({
				conversationId,
				opsUserId,
				role: "member",
				// Baseline the read cursor at join time: a queue member opening a
				// thread for the first time hasn't "unread" its whole history, so
				// unread means what arrives after they join.
				lastReadAt: sql`now()`,
			})
			.onConflictDoNothing();
	}
}

export async function getConversation(
	conversationId: string,
	opsUserId: string,
	staffRole?: string,
): Promise<ChatConversation> {
	const [row] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (!row) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

	// Auto-join support-queue staff into support conversations they're not
	// yet a participant in so they can view and reply.
	if (staffRole) {
		await ensureSupportQueueAccess(conversationId, opsUserId, staffRole);
	}

	const isParticipant = await db
		.select()
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, opsUserId),
			),
		)
		.limit(1);
	if (!isParticipant.length) {
		throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
	}

	const participants = await getParticipants(conversationId);
	const unread = await countUnread(conversationId, opsUserId);

	const [lastMsg, lastPublicMsg] = await Promise.all([
		db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(desc(messages.createdAt))
			.limit(1),
		db
			.select()
			.from(messages)
			.where(and(eq(messages.conversationId, conversationId), eq(messages.visibility, "public")))
			.orderBy(desc(messages.createdAt))
			.limit(1),
	]);

	const participantsMap = new Map([[conversationId, participants]]);
	const unreadMap = new Map([[conversationId, unread]]);
	const lastMsgMap = new Map<string, typeof messages.$inferSelect>();
	if (lastMsg[0]) lastMsgMap.set(conversationId, lastMsg[0]);
	const lastPublicMsgMap = new Map<string, typeof messages.$inferSelect>();
	if (lastPublicMsg[0]) lastPublicMsgMap.set(conversationId, lastPublicMsg[0]);

	return serializeConversation(row, participantsMap, unreadMap, lastMsgMap, opsUserId, lastPublicMsgMap);
}

/* ── Create conversation ────────────────────────────────────────────────── */

export async function createConversation(
	creatorOpsUser: { id: string; name: string; email: string },
	input: CreateConversation,
): Promise<ChatConversation> {
	// For direct messages, check if one already exists between these two users
	if (input.participantOpsUserId && !input.linkedEntityType) {
		const existing = await findDirectConversation(
			creatorOpsUser.id,
			input.participantOpsUserId,
		);
		if (existing) {
			// If there's an initial message, send it into the existing conversation
			if (input.initialMessage) {
				await sendMessageInternal(existing.id, creatorOpsUser, {
					content: input.initialMessage,
				});
			}
			return getConversation(existing.id, creatorOpsUser.id);
		}
	}

	// Determine title
	let title = input.title;
	if (!title && input.participantOpsUserId) {
		const other = await getParticipantOpsUser(input.participantOpsUserId);
		title = other ? `${creatorOpsUser.name} & ${other.name}` : "Direct Message";
	}
	if (!title) title = "New Conversation";

	// Determine type
	const type = input.linkedEntityType ? "entity" : input.participantOpsUserIds?.length ? "group" : "direct";

	// Create conversation
	const [created] = await db
		.insert(conversations)
		.values({
			type,
			title,
			linkedEntityType: input.linkedEntityType ?? null,
			linkedEntityId: input.linkedEntityId ?? null,
			createdBy: creatorOpsUser.id,
		})
		.returning();

	// Add creator as owner
	await db.insert(conversationParticipants).values({
		conversationId: created.id,
		opsUserId: creatorOpsUser.id,
		role: "owner",
	});

	// Add participants
	const allParticipantIds = new Set<string>();
	if (input.participantOpsUserId) allParticipantIds.add(input.participantOpsUserId);
	if (input.participantOpsUserIds) {
		for (const id of input.participantOpsUserIds) allParticipantIds.add(id);
	}

	for (const pid of allParticipantIds) {
		if (pid === creatorOpsUser.id) continue;
		await db.insert(conversationParticipants).values({
			conversationId: created.id,
			opsUserId: pid,
			role: "member",
		});
	}

	// Send initial message if provided
	if (input.initialMessage) {
		await sendMessageInternal(created.id, creatorOpsUser, {
			content: input.initialMessage,
		});
	}

	// Real-time: notify all participants (including creator) that a new
	// conversation exists so their conversation list refreshes instantly.
	publishChatEvent(created.id, {
		type: "chat.conversation.created",
		conversationId: created.id,
	});

	return getConversation(created.id, creatorOpsUser.id);
}

/* ── Find existing direct conversation ──────────────────────────────────── */

async function findDirectConversation(userId1: string, userId2: string) {
	const user1Conversations = db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(eq(conversationParticipants.opsUserId, userId1))
		.as("user1_convs");

	const [match] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.innerJoin(user1Conversations, eq(conversations.id, user1Conversations.conversationId))
		.where(
			and(
				eq(conversations.type, "direct"),
				sql`EXISTS (
					SELECT 1 FROM ${conversationParticipants}
					WHERE ${conversationParticipants.conversationId} = ${conversations.id}
					AND ${conversationParticipants.opsUserId} = ${userId2}
				)`,
			),
		)
		.limit(1);

	return match ?? null;
}

/* ── Get messages ───────────────────────────────────────────────────────── */

export async function getMessages(
	conversationId: string,
	opsUserId: string,
	opts: { limit?: number; before?: string; q?: string; publicOnly?: boolean } = {},
	staffRole?: string,
): Promise<ChatMessageList> {
	// Authorization: only participants may read a conversation. Without this
	// check any staff member with chat access could read any conversation -
	// including applicant ↔ consultant threads - by iterating IDs.
	// An empty opsUserId is the internal/trusted path (e.g. the applicant
	// route, which does its own ownership check before calling in).
	if (opsUserId) {
		// Auto-join support-queue staff into support conversations so they can
		// read the thread.
		if (staffRole) {
			await ensureSupportQueueAccess(conversationId, opsUserId, staffRole);
		}
		const [membership] = await db
			.select({ conversationId: conversationParticipants.conversationId })
			.from(conversationParticipants)
			.where(
				and(
					eq(conversationParticipants.conversationId, conversationId),
					eq(conversationParticipants.opsUserId, opsUserId),
				),
			)
			.limit(1);
		if (!membership) {
			throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
		}
	}

	const limit = Math.min(opts.limit ?? 50, 100);

	const conditions = [eq(messages.conversationId, conversationId)];
	if (opts.before) {
		conditions.push(sql`${messages.createdAt} < (SELECT created_at FROM ${messages} WHERE id = ${opts.before})`);
	}
	// Client-facing reads never see staff-only notes.
	if (opts.publicOnly) {
		conditions.push(eq(messages.visibility, "public"));
	}
	const q = opts.q?.trim();
	if (q) {
		conditions.push(ilike(messages.content, `%${q}%`));
	}

	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const sliced = hasMore ? rows.slice(0, limit) : rows;

	return {
		messages: await hydrateMessages(sliced.reverse(), { opsUserId: opsUserId || null }),
		total: sliced.length,
		hasMore,
	};
}

/* ── Send message (internal) ────────────────────────────────────────────── */

/** Conversation types that face the customer - helpdesk triage targets. */
const CLIENT_FACING_TYPES = new Set(["applicant", "support", "case", "stage", "entity"]);

async function sendMessageInternal(
	conversationId: string,
	sender: { id: string; name: string; email: string },
	input: SendMessage,
): Promise<ChatMessage> {
	const visibility = input.visibility === "internal" ? "internal" : "public";
	const [created] = await db
		.insert(messages)
		.values({
			conversationId,
			senderOpsUserId: sender.id,
			senderName: sender.name,
			content: input.content,
			messageType: "text",
			replyToId: input.replyToId ?? null,
			visibility,
		})
		.returning();

	// Update conversation timestamps - `lastMessageAt` is the sort key every
	// queue/list orders by, so it must move on every send.
	await db
		.update(conversations)
		.set({ updatedAt: new Date(), lastMessageAt: created.createdAt })
		.where(eq(conversations.id, conversationId));

	// Bind pre-staged uploads to the message now that it exists. Scoped to rows
	// this sender staged and that aren't already bound, so a caller can't
	// attach someone else's upload - or re-attach one already in another
	// message - by guessing ids.
	if (input.attachmentIds?.length) {
		await db
			.update(messageAttachments)
			.set({ messageId: created.id })
			.where(
				and(
					inArray(messageAttachments.id, input.attachmentIds),
					isNull(messageAttachments.messageId),
					eq(messageAttachments.uploadedByOpsUserId, sender.id),
				),
			);
	}

	// Handle @mentions
	if (input.mentions?.length) {
		await db.insert(messageMentions).values(
			input.mentions.map((mentionedOpsUserId) => ({
				messageId: created.id,
				mentionedOpsUserId,
			})),
		);
	}

	// First reply auto-claims: in a client-facing conversation with no owner,
	// the staff member who answers becomes the owner so the queue's "Mine" /
	// "Unclaimed" cuts reflect reality.
	const [convRow] = await db
		.select({ type: conversations.type })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (convRow && CLIENT_FACING_TYPES.has(convRow.type) && visibility === "public") {
		// Request-layer bookkeeping: a public staff reply flips waiting-on to
		// the client and stamps the first response once.
		await db
			.update(conversations)
			.set({
				waitingOn: "client",
				firstResponseAt: sql`COALESCE(${conversations.firstResponseAt}, ${created.createdAt})`,
			})
			.where(eq(conversations.id, conversationId));
	}
	if (convRow && CLIENT_FACING_TYPES.has(convRow.type)) {
		const [owner] = await db
			.select({ opsUserId: conversationParticipants.opsUserId })
			.from(conversationParticipants)
			.where(
				and(
					eq(conversationParticipants.conversationId, conversationId),
					eq(conversationParticipants.role, "owner"),
				),
			)
			.limit(1);
		if (!owner) {
			await db
				.update(conversationParticipants)
				.set({ role: "owner" })
				.where(
					and(
						eq(conversationParticipants.conversationId, conversationId),
						eq(conversationParticipants.opsUserId, sender.id),
					),
				);
			publishChatEvent(conversationId, {
				type: "chat.conversation.updated",
				conversationId,
			});
		}
	}

	// Real-time: push the new message to all online participants via SSE so
	// their chat UI appends it instantly without polling. The sender is
	// excluded - their own send call already returned the message.
	//
	// Hydrated with NO viewer: delivery ticks are only meaningful on your own
	// messages, and this payload is going to everyone else. Passing the sender
	// here would render read receipts on a message the recipient received.
	const [broadcastView] = await hydrateMessages([created], {});
	publishChatEvent(
		conversationId,
		{
			type: "chat.message",
			conversationId,
			message: broadcastView,
		},
		sender.id,
	);

	// The portal widget subscribes to the same event type, but on the
	// client's channel - publishChatEvent resolves staff participants only.
	// Internal notes stay staff-side: the visibility gate is the leak guard.
	if (visibility === "public") {
		publishChatEventToClient(conversationId, {
			type: "chat.message",
			conversationId,
			message: broadcastView,
		});
	}

	// Notify offline participants via email - fire-and-forget so the
	// per-participant DB lookups + email queueing never delay the send.
	void notifyOfflineParticipants(conversationId, sender, created);

	// In-app: when a staff member replies into a customer-facing conversation
	// (applicant/support/case/stage), alert the applicant so they see the reply
	// without polling. Fire-and-forget.
	(async () => {
		try {
			const [conv] = await db
				.select({ type: conversations.type, userId: conversations.userId, title: conversations.title })
				.from(conversations)
				.where(eq(conversations.id, conversationId))
				.limit(1);

			const isCustomerFacing =
				conv?.userId &&
				conv.userId !== sender.id &&
				// Internal notes are staff-only - the client must never be
				// notified that one was posted.
				visibility !== "internal" &&
				(conv.type === "applicant" ||
					conv.type === "support" ||
					conv.type === "case" ||
					conv.type === "stage");

			if (isCustomerFacing && conv.userId) {
				const preview = created.content.length > 160 ? `${created.content.slice(0, 160)}…` : created.content;
				await notify({
					recipientUserId: conv.userId,
					type: "chat.reply",
					title: `${sender.name} replied`,
					body: preview,
					// Deep link into the exact thread - the portal widget reads
					// ?chat=<id> and opens on it (there is no /portal/support page).
					link: `/portal/home?chat=${conversationId}`,
				});
				// Email mirror of notifyOfflineParticipants for clients: a delayed
				// check emails only if the client still hasn't seen the reply.
				await queueChatReplyCheck({ conversationId, messageId: created.id });
				return;
			}

			// Staff-to-staff: notify every other participant so they get the
			// in-app bell + push. Without this, staff only saw SSE (if online
			// with the chat hub open) or email (if offline for 5+ min) - no
			// bell, no push, and no trace in the notifications table.
			if (conv && !isCustomerFacing) {
				const participants = await getParticipants(conversationId);
				const others = participants.filter(
					(p): p is typeof p & { opsUserId: string } =>
						p.opsUserId !== null && p.opsUserId !== sender.id,
				);
				if (others.length === 0) return;

				const preview =
					created.content.length > 160
						? `${created.content.slice(0, 160)}…`
						: created.content;
				const title =
					others.length === 1
						? `${sender.name} sent you a message`
						: `${sender.name} posted in ${conv.title ?? "a conversation"}`;

				const resolved = await Promise.all(
					others.map(async (p) => ({
						userId: await getStaffUserId(p.opsUserId),
						opsUserId: p.opsUserId,
					})),
				);

				await notifyMany(
					resolved
						.filter((r): r is { userId: string; opsUserId: string } => r.userId !== null)
						.map((r) => ({
							recipientUserId: r.userId,
							type: "chat.message",
							title,
							body: preview,
							link: `/helpdesk?id=${conversationId}`,
							entityType: "chat",
							entityId: created.id,
						})),
				);
		}
	} catch {
		// Notification failure must not block the message send.
	}
	})().catch(() => {});

	// Return the hydrated owner view so the sender sees the correct delivery
	// status (double-check "delivered") immediately - mirroring editMessage
	// and forwardMessage. Returning the bare serializeMessage (deliveryStatus:
	// null) makes the bubble render a clock icon that looks like "still sending".
	const [ownerView] = await hydrateMessages([created], { opsUserId: sender.id });
	return ownerView;
}

/* ── Send message (public) ──────────────────────────────────────────────── */

export async function sendMessage(
	conversationId: string,
	senderOpsUser: { id: string; name: string; email: string },
	input: SendMessage,
	staffRole?: string,
): Promise<ChatMessage> {
	// Verify membership - but auto-join support-queue staff into support
	// conversations first so they can reply to threads they just opened.
	if (staffRole) {
		await ensureSupportQueueAccess(conversationId, senderOpsUser.id, staffRole);
	}
	const isParticipant = await db
		.select()
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, senderOpsUser.id),
			),
		)
		.limit(1);
	if (!isParticipant.length) {
		throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
	}

	return sendMessageInternal(conversationId, senderOpsUser, input);
}

/* ── Mark as read ───────────────────────────────────────────────────────── */

export async function markAsRead(conversationId: string, opsUserId: string): Promise<void> {
	await db
		.update(conversationParticipants)
		// `now()` (database clock) rather than `new Date()` (app-server clock).
		// `messages.createdAt` defaults to the database's `now()`, and countUnread
		// compares the two. If the API container's clock drifts even slightly
		// behind Postgres, a JS-generated timestamp lands *before* messages that
		// were already there, so they stay "unread" forever and the badge never
		// clears. Sourcing both sides from the same clock makes that impossible.
		.set({ lastReadAt: sql`now()` })
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, opsUserId),
			),
		);

	// Real-time: let the caller's other tabs/devices know unread state changed
	// so their badge updates without a poll. Published to the caller only.
	const [staff] = await db
		.select({ userId: opsUsers.userId })
		.from(opsUsers)
		.where(eq(opsUsers.id, opsUserId))
		.limit(1);
	if (staff?.userId) {
		publishToUser(staff.userId, {
			type: "chat.read",
			conversationId,
		});
	}
}

/* ── Message actions (spec §11, §12, §13, §16) ──────────────────────────── */

/**
 * Load a message and assert the caller participates in its conversation.
 *
 * Every action below needs the same two facts, and getting either wrong is a
 * data leak - so they share one gate rather than each re-deriving it.
 */
async function loadMessageForActor(
	messageId: string,
	opsUserId: string,
): Promise<typeof messages.$inferSelect> {
	const [row] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
	if (!row) throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message not found");

	const [membership] = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, row.conversationId),
				eq(conversationParticipants.opsUserId, opsUserId),
			),
		)
		.limit(1);
	if (!membership) {
		throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
	}

	return row;
}

/**
 * Edit a message in place (spec §11) - never creates a new row, so replies
 * quoting it and forwards descending from it stay attached.
 */
export async function editMessage(
	messageId: string,
	opsUserId: string,
	content: string,
): Promise<ChatMessage> {
	const row = await loadMessageForActor(messageId, opsUserId);

	// Authorship, not conversation membership: being in a thread doesn't let you
	// rewrite what someone else said.
	if (row.senderOpsUserId !== opsUserId) {
		throw new HttpError(403, "NOT_AUTHOR", "You can only edit your own messages");
	}
	if (row.deletedAt) {
		throw new HttpError(409, "MESSAGE_DELETED", "A deleted message cannot be edited");
	}
	// System and action messages are authored by the platform, not a person -
	// letting a user rewrite them would falsify the audit trail.
	if (row.messageType !== "text") {
		throw new HttpError(409, "NOT_EDITABLE", "Only text messages can be edited");
	}

	const [updated] = await db
		.update(messages)
		.set({ content, editedAt: sql`now()`, updatedAt: sql`now()` })
		.where(eq(messages.id, messageId))
		.returning();

	const [broadcastView] = await hydrateMessages([updated], {});
	publishChatEvent(row.conversationId, {
		type: "chat.message.updated",
		conversationId: row.conversationId,
		message: broadcastView,
	});
	if (updated.visibility === "public") {
		publishChatEventToClient(row.conversationId, {
			type: "chat.message.updated",
			conversationId: row.conversationId,
			message: broadcastView,
		});
	}

	const [ownerView] = await hydrateMessages([updated], { opsUserId });
	return ownerView;
}

/**
 * Soft-delete a message (spec §27). The row survives so quotes and forwards
 * don't dangle; the body is withheld by the serializer.
 */
export async function deleteMessage(
	messageId: string,
	opsUserId: string,
	opts: { canModerate?: boolean } = {},
): Promise<void> {
	const row = await loadMessageForActor(messageId, opsUserId);

	// Authors delete their own; moderators delete anyone's. The caller passes
	// the moderation verdict because role→permission mapping lives in the
	// route layer, not here.
	const isAuthor = row.senderOpsUserId === opsUserId;
	if (!isAuthor && !opts.canModerate) {
		throw new HttpError(403, "NOT_PERMITTED", "You cannot delete this message");
	}
	// Idempotent: re-deleting is a no-op rather than an error, so a double-click
	// or a retried request doesn't surface a failure.
	if (row.deletedAt) return;

	await db
		.update(messages)
		.set({ deletedAt: sql`now()`, deletedByOpsUserId: opsUserId, updatedAt: sql`now()` })
		.where(eq(messages.id, messageId));

	publishChatEvent(row.conversationId, {
		type: "chat.message.deleted",
		conversationId: row.conversationId,
		messageId,
	});
	if (row.visibility === "public") {
		publishChatEventToClient(row.conversationId, {
			type: "chat.message.deleted",
			conversationId: row.conversationId,
			messageId,
		});
	}
}

/**
 * Toggle a reaction (spec §13). Applying an emoji you already used removes it,
 * which is what every messaging client does on a second tap.
 */
export async function toggleReaction(
	messageId: string,
	actor: { opsUserId: string; name: string },
	emoji: string,
): Promise<MessageReaction[]> {
	const row = await loadMessageForActor(messageId, actor.opsUserId);
	if (row.deletedAt) {
		throw new HttpError(409, "MESSAGE_DELETED", "A deleted message cannot be reacted to");
	}

	const existing = await db
		.select({ id: messageReactions.id })
		.from(messageReactions)
		.where(
			and(
				eq(messageReactions.messageId, messageId),
				eq(messageReactions.opsUserId, actor.opsUserId),
				eq(messageReactions.emoji, emoji),
			),
		)
		.limit(1);

	if (existing.length) {
		await db.delete(messageReactions).where(eq(messageReactions.id, existing[0].id));
	} else {
		await db
			.insert(messageReactions)
			.values({
				messageId,
				opsUserId: actor.opsUserId,
				emoji,
				reactorName: actor.name,
			})
			// Concurrent double-taps would otherwise trip the unique index and
			// surface a 500 for what is a harmless no-op.
			.onConflictDoNothing();
	}

	// Recomputed from storage rather than adjusted in memory, so the payload is
	// correct even when several people react at once.
	const reactions = await getMessageReactions(messageId, { opsUserId: actor.opsUserId });
	publishChatEvent(row.conversationId, {
		type: "chat.reaction",
		conversationId: row.conversationId,
		messageId,
		reactions,
	});
	if (row.visibility === "public") {
		publishChatEventToClient(row.conversationId, {
			type: "chat.reaction",
			conversationId: row.conversationId,
			messageId,
			reactions,
		});
	}
	return reactions;
}

/**
 * Forward a message into other conversations (spec §12).
 *
 * Each target gets its own new message whose `forwardedFromId` points at the
 * ORIGINAL, so forwarding a forward still credits the true author rather than
 * building a chain the UI would have to walk.
 */
export async function forwardMessage(
	messageId: string,
	sender: { id: string; name: string; email: string },
	conversationIds: string[],
): Promise<ChatMessage[]> {
	const row = await loadMessageForActor(messageId, sender.id);
	if (row.deletedAt) {
		throw new HttpError(409, "MESSAGE_DELETED", "A deleted message cannot be forwarded");
	}

	// Membership of every target is checked up front, so a partially-authorized
	// batch fails cleanly instead of leaking the message into some targets
	// before erroring on a later one.
	const memberships = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				inArray(conversationParticipants.conversationId, conversationIds),
				eq(conversationParticipants.opsUserId, sender.id),
			),
		);
	const allowed = new Set(memberships.map((m) => m.conversationId));
	const denied = conversationIds.filter((id) => !allowed.has(id));
	if (denied.length) {
		throw new HttpError(
			403,
			"NOT_PARTICIPANT",
			"You are not a participant in every destination conversation",
		);
	}

	const origin = row.forwardedFromId ?? row.id;

	const forwarded: ChatMessage[] = [];
	for (const conversationId of conversationIds) {
		const [created] = await db
			.insert(messages)
			.values({
				conversationId,
				senderOpsUserId: sender.id,
				senderName: sender.name,
				content: row.content,
				messageType: "text",
				forwardedFromId: origin,
			})
			.returning();

		await db
			.update(conversations)
			.set({ updatedAt: new Date() })
			.where(eq(conversations.id, conversationId));

		const [broadcastView] = await hydrateMessages([created], {});
		publishChatEvent(
			conversationId,
			{
				type: "chat.message",
				conversationId,
				message: broadcastView,
			},
			sender.id,
		);

		const [ownerView] = await hydrateMessages([created], { opsUserId: sender.id });
		forwarded.push(ownerView);
	}

	return forwarded;
}

/**
 * Fan a typing signal out to the other participants (spec §16).
 *
 * Deliberately not persisted - typing state is worthless a second later, and
 * writing it would mean a database round trip per keystroke. It exists only as
 * an SSE event, and the sender is excluded so nobody sees themselves typing.
 */
export async function setTyping(
	conversationId: string,
	actor: { opsUserId: string; name: string },
	typing: boolean,
): Promise<void> {
	const [membership] = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, actor.opsUserId),
			),
		)
		.limit(1);
	if (!membership) {
		throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
	}

	publishChatEvent(
		conversationId,
		{
			type: "chat.typing",
			conversationId,
			actorName: actor.name,
			typing,
		},
		actor.opsUserId,
	);
	// Staff typing reaches the client too - "Ama is typing" in the portal.
	publishChatEventToClient(conversationId, {
		type: "chat.typing",
		conversationId,
		actorName: actor.name,
		typing,
	});
}

/* ── Unread counts ──────────────────────────────────────────────────────── */

export async function getUnreadCounts(opsUserId: string): Promise<ChatUnread> {
	const membership = db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(eq(conversationParticipants.opsUserId, opsUserId))
		.as("membership");

	const rows = await db
		.select({ conversationId: membership.conversationId })
		.from(membership);

	const conversations_ = await Promise.all(
		rows.map(async (r) => ({
			conversationId: r.conversationId,
			unreadCount: await countUnread(r.conversationId, opsUserId),
		})),
	);

	const totalUnread = conversations_.reduce((sum, c) => sum + c.unreadCount, 0);

	return {
		totalUnread,
		conversations: conversations_.filter((c) => c.unreadCount > 0),
	};
}

/* ── Add participant ────────────────────────────────────────────────────── */

export async function addParticipant(
	conversationId: string,
	newOpsUserId: string,
): Promise<void> {
	const existing = await db
		.select()
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, newOpsUserId),
			),
		)
		.limit(1);
	if (existing.length) return; // already a participant

	await db.insert(conversationParticipants).values({
		conversationId,
		opsUserId: newOpsUserId,
		role: "member",
	});
}

/* ── Staff directory (for @mention autocomplete) ────────────────────────── */

export async function getStaffDirectory(): Promise<StaffDirectory> {
	const rows = await db
		.select({
			opsUserId: opsUsers.id,
			name: opsUsers.name,
			email: opsUsers.email,
			role: opsUsers.role,
		})
		.from(opsUsers)
		.where(eq(opsUsers.active, true))
		.orderBy(opsUsers.name);

	return {
		staff: rows.map((r) => ({
			opsUserId: r.opsUserId,
			name: r.name,
			email: r.email,
			role: r.role,
		})),
	};
}

/* ── Email notifications for offline participants ───────────────────────── */

export async function notifyOfflineParticipants(
	conversationId: string,
	sender: { id: string; name: string; email: string },
	sentMessage: typeof messages.$inferSelect,
): Promise<void> {
	const participants = await getParticipants(conversationId);
	const [conv] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);

	const frontendUrl = env.CONSOLE_URL;
	const conversationUrl = `${frontendUrl}/helpdesk?id=${conversationId}`;

	for (const p of participants) {
		if (!p.opsUserId) continue;
		if (p.opsUserId === sender.id) continue;

		// Check if user has a linked auth user (to get their email from the users table)
		const [staffUser] = await db
			.select({ userId: opsUsers.userId })
			.from(opsUsers)
			.where(eq(opsUsers.id, p.opsUserId))
			.limit(1);

		if (!staffUser?.userId) continue;

		const [authUser] = await db
			.select({ email: users.email })
			.from(users)
			.where(eq(users.id, staffUser.userId))
			.limit(1);

		if (!authUser?.email) continue;

		// Determine if the participant is "offline" using staff presence
		// (heartbeat within last 15 min, not explicitly offline). If they're
		// active, skip the email - they'll get the SSE + push notification.
		const isActive = await isStaffActive(p.opsUserId);
		if (isActive) continue;

		const preview = sentMessage.content.length > 120
			? `${sentMessage.content.slice(0, 120)}...`
			: sentMessage.content;

		const lines = [
			`<strong>${sender.name}</strong> sent a message in <strong>${conv?.title ?? "a conversation"}</strong>:`,
			`<em>"${preview}"</em>`,
		];

		const { html, text } = renderBookingEmail({
			title: `New message from ${sender.name}`,
			lines,
			reference: conversationUrl,
		});

		const email: QueuedEmail = {
			to: authUser.email,
			subject: `New message from ${sender.name} - Century NIT Chat`,
			html,
			text,
			idempotencyKey: `chat:notify:${sentMessage.id}:${p.opsUserId}`,
			template: "Chat notification",
			reference: conv?.title,
		};

		await queueEmail(email);
	}
}

/* ══════════════════════════════════════════════════════════════════════════
 * Applicant-facing chat - lets applicants message their assigned consultant
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Get or create a conversation between an applicant and their assigned
 * consultant. The conversation is typed as `"applicant"` and linked to the
 * applicant via `conversations.userId`.
 */
export async function getOrCreateApplicantConversation(userId: string): Promise<{
	id: string;
	title: string;
	consultantName: string | null;
}> {
	// Check if a conversation already exists for this user
	const [existing] = await db
		.select()
		.from(conversations)
		.where(and(eq(conversations.userId, userId), eq(conversations.type, "applicant")))
		.limit(1);

	if (existing) {
		const [participant] = await db
			.select({ name: opsUsers.name })
			.from(conversationParticipants)
			.innerJoin(opsUsers, eq(conversationParticipants.opsUserId, opsUsers.id))
			.where(eq(conversationParticipants.conversationId, existing.id))
			.limit(1);
		return {
			id: existing.id,
			title: existing.title,
			consultantName: participant?.name ?? null,
		};
	}

	// Look up the applicant to find their assigned officer
	const [appRow] = await db
		.select({
			id: applicants.id,
			name: applicants.name,
			assignedOfficerId: applicants.assignedOfficerId,
		})
		.from(applicants)
		.where(eq(applicants.userId, userId))
		.limit(1);

	if (!appRow) {
		throw new HttpError(404, "APPLICANT_NOT_FOUND", "No applicant on file");
	}

	// Get the assigned officer details
	let officerName = "Consultant";
	const officerId = appRow.assignedOfficerId;

	if (officerId) {
		const officer = await getParticipantOpsUser(officerId);
		if (officer) officerName = officer.name;
	}

	// Create the conversation - createdBy needs a valid opsUserId
	// If no officer is assigned yet, we still need a value for the NOT NULL column.
	// We'll use a placeholder that will be updated when an officer is assigned.
	if (!officerId) {
		throw new HttpError(409, "NO_ASSIGNED_OFFICER", "Your case has not been assigned to a consultant yet");
	}

	const [conv] = await db
		.insert(conversations)
		.values({
			type: "applicant",
			title: appRow.name,
			userId,
			createdBy: officerId,
		})
		.returning();

	// Add the assigned officer as a participant
	await db.insert(conversationParticipants).values({
		conversationId: conv.id,
		opsUserId: officerId,
		role: "owner",
	});

	return {
		id: conv.id,
		title: conv.title,
		consultantName: officerName,
	};
}

/**
 * Get messages for an applicant's conversation.
 */
export async function getApplicantMessages(
	conversationId: string,
	userId: string,
	opts: { limit?: number; before?: string } = {},
): Promise<ChatMessageList> {
	// Verify the conversation belongs to this user
	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
		.limit(1);
	if (!conv) throw new HttpError(403, "NOT_PARTICIPANT", "This is not your conversation");

	return getMessages(conversationId, "", { ...opts, publicOnly: true });
}

/**
 * Send a message from an applicant into their conversation.
 */
export async function sendApplicantMessage(
	conversationId: string,
	userId: string,
	userName: string,
	content: string,
	attachmentIds?: string[],
): Promise<ChatMessage> {
	// Verify the conversation belongs to this user
	const [conv] = await db
		.select({ id: conversations.id, status: conversations.status })
		.from(conversations)
		.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
		.limit(1);
	if (!conv) throw new HttpError(403, "NOT_PARTICIPANT", "This is not your conversation");

	// A new client message re-opens a resolved conversation - the thread is
	// the record, and "resolved" is a state, not a wall.
	if (conv.status === "closed") {
		await db
			.update(conversations)
			.set({ status: "open", closedAt: null })
			.where(eq(conversations.id, conversationId));
		await db.insert(messages).values({
			conversationId,
			senderName: "System",
			content: "Conversation reopened - new message from the client",
			messageType: "system",
		});
		publishChatEvent(conversationId, {
			type: "chat.conversation.updated",
			conversationId,
			status: "open",
		});
	}

	const [created] = await db
		.insert(messages)
		.values({
			conversationId,
			senderUserId: userId,
			senderName: userName,
			content,
			messageType: "text",
		})
		.returning();

	// Update conversation timestamps
	await db
		.update(conversations)
		.set({ updatedAt: new Date(), lastMessageAt: created.createdAt })
		.where(eq(conversations.id, conversationId));

	// Bind pre-staged uploads - scoped to rows this applicant staged and that
	// aren't already bound, matching the staff path's guard.
	if (attachmentIds?.length) {
		await db
			.update(messageAttachments)
			.set({ messageId: created.id })
			.where(
				and(
					inArray(messageAttachments.id, attachmentIds),
					isNull(messageAttachments.messageId),
					eq(messageAttachments.uploadedByUserId, userId),
				),
			);
	}

	// Real-time: push the applicant's message to all staff participants so
	// the consultant's chat UI appends it instantly without polling.
	publishChatEvent(conversationId, {
		type: "chat.message",
		conversationId,
		message: serializeMessage(created),
	});

	// In-app: alert the assigned consultant (or the triage queue) that the
	// applicant sent a message. Fire-and-forget so a notification hiccup never
	// blocks the message the applicant just sent.
	(async () => {
		try {
			const preview = content.length > 160 ? `${content.slice(0, 160)}…` : content;
			const title = `${userName} sent a message`;

			const [applicant] = await db
				.select({ assignedOfficerId: applicants.assignedOfficerId })
				.from(applicants)
				.where(eq(applicants.userId, userId))
				.limit(1);

			const officerId = applicant?.assignedOfficerId ?? null;
			if (officerId) {
				const staffUserId = await getStaffUserId(officerId);
				if (staffUserId) {
					await notify({
						recipientUserId: staffUserId,
						type: "chat.message",
						title,
						body: preview,
						link: `/helpdesk?id=${conversationId}`,
					});
					return;
				}
			}

			// No consultant linked yet - surface to managers/coordinators.
			const managers = await getManagerAndCoordinatorUserIds();
			await notifyMany(
				managers.map((m) => ({
					recipientUserId: m.userId,
					type: "chat.message",
					title,
					body: preview,
					link: `/helpdesk?id=${conversationId}`,
				})),
			);
		} catch {
			// Notification failure must not block the message send.
		}
	})().catch(() => {});

	return serializeMessage(created);
}

/* ── Lifecycle: resolve / reopen / archive ────────────────────────────── */

/**
 * Flip a conversation's lifecycle status. Resolve writes `closed` + `closedAt`
 * and posts a system divider into the thread so both sides see the boundary.
 * Reopen clears it. Archived hides the thread from client lists.
 *
 * Membership is required - the caller must already participate (support-queue
 * auto-join runs first so triage roles can resolve threads they just opened).
 */
export async function setConversationStatus(
	conversationId: string,
	status: ConversationStatus,
	actor: { id: string; name: string },
	staffRole?: string,
): Promise<ChatConversation> {
	if (staffRole) {
		await ensureSupportQueueAccess(conversationId, actor.id, staffRole);
	}
	const [membership] = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, actor.id),
			),
		)
		.limit(1);
	if (!membership) {
		throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
	}

	const [conv] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
	if (conv.status === status) return getConversation(conversationId, actor.id, staffRole);

	const closing = status === "closed" || status === "archived";
	await db
		.update(conversations)
		.set({
			status,
			closedAt: closing ? new Date() : null,
			resolvedAt: status === "closed" ? new Date() : null,
			waitingOn: closing ? null : "us",
			updatedAt: new Date(),
		})
		.where(eq(conversations.id, conversationId));

	const label =
		status === "closed"
			? `Resolved by ${actor.name}`
			: status === "archived"
				? `Archived by ${actor.name}`
				: `Reopened by ${actor.name}`;
	const [sysMsg] = await db
		.insert(messages)
		.values({
			conversationId,
			senderName: "System",
			content: label,
			messageType: "system",
		})
		.returning();

	publishChatEvent(conversationId, {
		type: "chat.message",
		conversationId,
		message: serializeMessage(sysMsg),
	});
	publishChatEvent(conversationId, {
		type: "chat.conversation.updated",
		conversationId,
		status,
	});
	publishChatEventToClient(conversationId, {
		type: "chat.message",
		conversationId,
		message: serializeMessage(sysMsg),
	});
	publishChatEventToClient(conversationId, {
		type: "chat.conversation.updated",
		conversationId,
		status,
	});

	return getConversation(conversationId, actor.id, staffRole);
}

/* ── Ownership: claim / reassign ──────────────────────────────────────── */

/**
 * Make `targetOpsUserId` the conversation's owner. Any prior owner is demoted
 * to `member` - a thread has exactly one owner, which is what the helpdesk's
 * "Mine"/"Unclaimed" cuts and the row's owner pill read.
 *
 * `targetOpsUserId === null` releases ownership (thread goes back to
 * unclaimed). The actor must participate; queue roles auto-join first.
 */
export async function assignConversationOwner(
	conversationId: string,
	targetOpsUserId: string | null,
	actor: { id: string; name: string },
	staffRole?: string,
): Promise<ChatConversation> {
	if (staffRole) {
		await ensureSupportQueueAccess(conversationId, actor.id, staffRole);
	}
	const [membership] = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, actor.id),
			),
		)
		.limit(1);
	if (!membership) {
		throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
	}

	const [conv] = await db
		.select({ id: conversations.id, status: conversations.status })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

	// Demote every current owner.
	await db
		.update(conversationParticipants)
		.set({ role: "member" })
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.role, "owner"),
			),
		);

	let targetName = "Unclaimed";
	if (targetOpsUserId) {
		const [target] = await db
			.select({ name: opsUsers.name })
			.from(opsUsers)
			.where(eq(opsUsers.id, targetOpsUserId))
			.limit(1);
		if (!target) throw new HttpError(404, "STAFF_NOT_FOUND", "Staff member not found");
		targetName = target.name;

		// Promote the target's existing membership, or join them in as owner.
		const [existing] = await db
			.select({ conversationId: conversationParticipants.conversationId })
			.from(conversationParticipants)
			.where(
				and(
					eq(conversationParticipants.conversationId, conversationId),
					eq(conversationParticipants.opsUserId, targetOpsUserId),
				),
			)
			.limit(1);
		if (existing) {
			await db
				.update(conversationParticipants)
				.set({ role: "owner" })
				.where(
					and(
						eq(conversationParticipants.conversationId, conversationId),
						eq(conversationParticipants.opsUserId, targetOpsUserId),
					),
				);
		} else {
			await db
				.insert(conversationParticipants)
				.values({ conversationId, opsUserId: targetOpsUserId, role: "owner" })
				.onConflictDoNothing();
		}
	}

	const content =
		targetOpsUserId === null
			? `${actor.name} released this conversation`
			: targetOpsUserId === actor.id
				? `${actor.name} claimed this conversation`
				: `${actor.name} assigned this conversation to ${targetName}`;
	const [sysMsg] = await db
		.insert(messages)
		.values({
			conversationId,
			senderName: "System",
			content,
			messageType: "system",
		})
		.returning();

	publishChatEvent(conversationId, {
		type: "chat.message",
		conversationId,
		message: serializeMessage(sysMsg),
	});
	publishChatEvent(conversationId, {
		type: "chat.conversation.updated",
		conversationId,
	});
	publishChatEventToClient(conversationId, {
		type: "chat.message",
		conversationId,
		message: serializeMessage(sysMsg),
	});
	publishChatEventToClient(conversationId, {
		type: "chat.conversation.updated",
		conversationId,
	});

	return getConversation(conversationId, actor.id, staffRole);
}

/* ── Context aggregate - the helpdesk's right rail ────────────────────── */

export interface ConversationContext {
	client: {
		userId: string;
		name: string;
		email: string | null;
		branch: string | null;
		targetCountry: string | null;
		memberSince: string | null;
	} | null;
	cases: { id: string; appNumber: string; stage: string; stageLabel: string; status: string }[];
	money: { type: string; status: string; invoiceNumber: string }[];
	nextAppointment: { startsAt: string; serviceName: string; status: string } | null;
	owner: { opsUserId: string; name: string } | null;
	messageCount: number;
}

/**
 * Everything the helpdesk's context rail needs in one round trip: who the
 * client is, where their cases sit, what they owe, and when we next see them.
 * All blocks are optional - a thread can exist before the applicant record.
 */
export async function getConversationContext(
	conversationId: string,
	opsUserId: string,
	staffRole?: string,
): Promise<ConversationContext> {
	if (staffRole) {
		await ensureSupportQueueAccess(conversationId, opsUserId, staffRole);
	}
	const [membership] = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, opsUserId),
			),
		)
		.limit(1);
	if (!membership) {
		throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
	}

	const [conv] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

	const [ownerRow] = await db
		.select({ opsUserId: conversationParticipants.opsUserId, name: opsUsers.name })
		.from(conversationParticipants)
		.innerJoin(opsUsers, eq(conversationParticipants.opsUserId, opsUsers.id))
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.role, "owner"),
			),
		)
		.limit(1);

	const [{ count: messageCount }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(messages)
		.where(eq(messages.conversationId, conversationId));

	const clientUserId =
		conv.userId ??
		(
			await db
				.select({ participantUserId: conversationParticipants.participantUserId })
				.from(conversationParticipants)
				.where(
					and(
						eq(conversationParticipants.conversationId, conversationId),
						sql`${conversationParticipants.participantUserId} IS NOT NULL`,
					),
				)
				.limit(1)
		)[0]?.participantUserId ??
		null;

	let client: ConversationContext["client"] = null;
	let cases: ConversationContext["cases"] = [];
	let money: ConversationContext["money"] = [];
	let nextAppointment: ConversationContext["nextAppointment"] = null;

	if (clientUserId) {
		const [applicantRow] = await db
			.select({
				id: applicants.id,
				name: applicants.name,
				email: applicants.email,
				branch: applicants.branch,
				targetCountry: applicants.targetCountry,
				createdAt: applicants.createdAt,
			})
			.from(applicants)
			.where(eq(applicants.userId, clientUserId))
			.limit(1);

		const [caseRows, invoiceRows, [booking]] = await Promise.all([
			applicantRow
				? db
						.select({
							id: applications.id,
							appNumber: applications.appNumber,
							stage: applications.stage,
							status: applications.status,
						})
						.from(applications)
						.where(eq(applications.applicantId, applicantRow.id))
						.orderBy(desc(applications.createdAt))
						.limit(3)
				: Promise.resolve([]),
			db
				.select({
					type: invoices.type,
					status: invoices.status,
					invoiceNumber: invoices.invoiceNumber,
				})
				.from(invoices)
				.where(eq(invoices.clientUserId, clientUserId))
				.orderBy(desc(invoices.createdAt))
				.limit(4),
			db
				.select({
					startsAt: bookings.startsAt,
					serviceName: bookings.serviceName,
					status: bookings.status,
				})
				.from(bookings)
				.where(
					and(
						eq(bookings.clientUserId, clientUserId),
						gt(bookings.startsAt, new Date()),
						inArray(bookings.status, ["CONFIRMED", "ASSIGNED", "RESCHEDULED", "UNASSIGNED"]),
					),
				)
				.orderBy(bookings.startsAt)
				.limit(1),
		]);

		if (applicantRow) {
			client = {
				userId: clientUserId,
				name: applicantRow.name,
				email: applicantRow.email,
				branch: applicantRow.branch,
				targetCountry: applicantRow.targetCountry,
				memberSince: applicantRow.createdAt?.toISOString() ?? null,
			};
		} else {
			const [u] = await db
				.select({ name: users.name, email: users.email, createdAt: users.createdAt })
				.from(users)
				.where(eq(users.id, clientUserId))
				.limit(1);
			if (u) {
				client = {
					userId: clientUserId,
					name: u.name ?? "Client",
					email: u.email ?? null,
					branch: null,
					targetCountry: null,
					memberSince: u.createdAt?.toISOString() ?? null,
				};
			}
		}

		cases = caseRows.map((r) => ({
			id: r.id,
			appNumber: r.appNumber,
			stage: r.stage,
			stageLabel:
				(JOURNEY_STAGE_LABELS as Record<string, string>)[r.stage] ?? r.stage,
			status: r.status,
		}));
		money = invoiceRows.map((r) => ({
			type: r.type,
			status: r.status,
			invoiceNumber: r.invoiceNumber,
		}));
		nextAppointment = booking
			? {
					startsAt: booking.startsAt.toISOString(),
					serviceName: booking.serviceName,
					status: booking.status,
				}
			: null;
	}

	return {
		client,
		cases,
		money,
		nextAppointment,
		owner: ownerRow ? { opsUserId: ownerRow.opsUserId!, name: ownerRow.name } : null,
		messageCount,
	};
}

/* ── Attachment staging ───────────────────────────────────────────────── */

/**
 * Two-phase upload, phase one: mint a private storage key, record a staged
 * `message_attachments` row owned by the uploader, and return a presigned PUT
 * the browser uploads straight to storage. Phase two is ordinary sendMessage -
 * `attachmentIds` binds the staged rows to the new message (scoped to the
 * sender, so staged rows can't be attached by anyone else).
 */
export async function stageChatAttachment(
	conversationId: string,
	uploader: { opsUserId: string },
	meta: { fileName: string; contentType: string; sizeBytes: number },
): Promise<{ attachmentId: string; uploadUrl: string; headers: Record<string, string>; expiresAt: string }> {
	if (meta.sizeBytes > 25 * 1024 * 1024) {
		throw new HttpError(413, "ATTACHMENT_TOO_LARGE", "Attachments are limited to 25 MB");
	}
	const [membership] = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, uploader.opsUserId),
			),
		)
		.limit(1);
	if (!membership) {
		throw new HttpError(403, "NOT_PARTICIPANT", "You are not a participant in this conversation");
	}

	const safeName = meta.fileName.replace(/[^\w.\- ]+/g, "_").slice(-120) || "attachment";
	const storageKey = `chat/${conversationId}/${randomUUID()}-${safeName}`;

	const storage = await getDocumentStorage();
	const ticket = await storage.createUploadUrl({
		key: storageKey,
		contentType: meta.contentType,
	});

	const [row] = await db
		.insert(messageAttachments)
		.values({
			uploadedByOpsUserId: uploader.opsUserId,
			storageKey,
			fileName: meta.fileName.slice(0, 255),
			contentType: meta.contentType.slice(0, 128),
			sizeBytes: meta.sizeBytes,
		})
		.returning({ id: messageAttachments.id });

	return {
		attachmentId: row.id,
		uploadUrl: ticket.url,
		headers: ticket.headers ?? {},
		expiresAt: ticket.expiresAt.toISOString(),
	};
}

/**
 * Client-side counterpart - the applicant stages an upload against their own
 * conversation. Ownership check is `conversations.userId`, not participants.
 */
export async function stageCustomerAttachment(
	conversationId: string,
	userId: string,
	meta: { fileName: string; contentType: string; sizeBytes: number },
): Promise<{ attachmentId: string; uploadUrl: string; headers: Record<string, string>; expiresAt: string }> {
	if (meta.sizeBytes > 25 * 1024 * 1024) {
		throw new HttpError(413, "ATTACHMENT_TOO_LARGE", "Attachments are limited to 25 MB");
	}
	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(
			and(
				eq(conversations.id, conversationId),
				sql`(${conversations.userId} = ${userId} OR EXISTS (
					SELECT 1 FROM ${conversationParticipants}
					WHERE ${conversationParticipants.conversationId} = ${conversations.id}
					AND ${conversationParticipants.participantUserId} = ${userId}
				))`,
			),
		)
		.limit(1);
	if (!conv) throw new HttpError(403, "NOT_PARTICIPANT", "This is not your conversation");

	const safeName = meta.fileName.replace(/[^\w.\- ]+/g, "_").slice(-120) || "attachment";
	const storageKey = `chat/${conversationId}/${randomUUID()}-${safeName}`;

	const storage = await getDocumentStorage();
	const ticket = await storage.createUploadUrl({
		key: storageKey,
		contentType: meta.contentType,
	});

	const [row] = await db
		.insert(messageAttachments)
		.values({
			uploadedByUserId: userId,
			storageKey,
			fileName: meta.fileName.slice(0, 255),
			contentType: meta.contentType.slice(0, 128),
			sizeBytes: meta.sizeBytes,
		})
		.returning({ id: messageAttachments.id });

	return {
		attachmentId: row.id,
		uploadUrl: ticket.url,
		headers: ticket.headers ?? {},
		expiresAt: ticket.expiresAt.toISOString(),
	};
}
