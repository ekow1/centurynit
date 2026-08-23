import { desc, eq, and, sql, gt, ne, inArray, isNull } from "drizzle-orm";
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
	conversations,
	conversationParticipants,
	messages,
	messageMentions,
	messageReactions,
	messageAttachments,
	opsUsers,
	users,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { queueEmail } from "../worker/queues.js";
import type { QueuedEmail } from "./notifications.js";
import { renderBookingEmail } from "../lib/email-templates.js";
import { env } from "../env.js";
import { notify, notifyMany, getManagerAndCoordinatorUserIds, getStaffUserId, isStaffActive } from "./notify.js";
import { publishToUser } from "../worker/pubsub.js";
import { serializeMessageRow, hydrateMessages, getMessageReactions } from "./message-serializer.js";

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
			// SSE is best-effort — a publish failure must not block the send.
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
): ChatConversation {
	const participants = participantsMap.get(row.id) ?? [];
	const unread = unreadMap.get(row.id) ?? 0;
	const lastMsg = lastMsgMap.get(row.id);
	const title =
		row.type === "direct"
			? (participants.find((p) => p.opsUserId != null && p.opsUserId !== viewerOpsUserId)?.name ?? row.title)
			: row.title;

	return {
		id: row.id,
		type: row.type as "applicant" | "direct" | "entity" | "group",
		status: (row as any).status ?? "open",
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
		unreadCount: unread,
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

	const rows = canSeeSupportQueue
		? await db
				.select()
				.from(conversations)
				.leftJoin(membership, eq(conversations.id, membership.conversationId))
				.where(
					sql`(${membership.conversationId} IS NOT NULL OR ${conversations.type} = 'support')`,
				)
				.orderBy(desc(conversations.updatedAt))
		: await db
				.select()
				.from(conversations)
				.innerJoin(membership, eq(conversations.id, membership.conversationId))
				.orderBy(desc(conversations.updatedAt));

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

	// Last message per conversation
	const lastMsgRows = await db
		.select()
		.from(messages)
		.where(inArray(messages.conversationId, conversationIds))
		.orderBy(desc(messages.createdAt));

	const lastMsgMap = new Map<string, typeof messages.$inferSelect>();
	for (const msg of lastMsgRows) {
		// First row per conversationId is the latest (ORDER BY desc)
		if (!lastMsgMap.has(msg.conversationId)) {
			lastMsgMap.set(msg.conversationId, msg);
		}
	}

	const list = rows.map((r) =>
		serializeConversation(r.conversations, participantsMap, unreadMap, lastMsgMap, opsUserId),
	);

	return { conversations: list, total: list.length };
}

/* ── Get single conversation ────────────────────────────────────────────── */

export async function getConversation(
	conversationId: string,
	opsUserId: string,
): Promise<ChatConversation> {
	const [row] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (!row) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

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

	const [lastMsg] = await db
		.select()
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
		.orderBy(desc(messages.createdAt))
		.limit(1);

	const participantsMap = new Map([[conversationId, participants]]);
	const unreadMap = new Map([[conversationId, unread]]);
	const lastMsgMap = new Map<string, typeof messages.$inferSelect>();
	if (lastMsg) lastMsgMap.set(conversationId, lastMsg);

	return serializeConversation(row, participantsMap, unreadMap, lastMsgMap, opsUserId);
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
	opts: { limit?: number; before?: string } = {},
): Promise<ChatMessageList> {
	// Authorization: only participants may read a conversation. Without this
	// check any staff member with chat access could read any conversation —
	// including applicant ↔ consultant threads — by iterating IDs.
	// An empty opsUserId is the internal/trusted path (e.g. the applicant
	// route, which does its own ownership check before calling in).
	if (opsUserId) {
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

async function sendMessageInternal(
	conversationId: string,
	sender: { id: string; name: string; email: string },
	input: SendMessage,
): Promise<ChatMessage> {
	const [created] = await db
		.insert(messages)
		.values({
			conversationId,
			senderOpsUserId: sender.id,
			senderName: sender.name,
			content: input.content,
			messageType: "text",
			replyToId: input.replyToId ?? null,
		})
		.returning();

	// Update conversation timestamp
	await db
		.update(conversations)
		.set({ updatedAt: new Date() })
		.where(eq(conversations.id, conversationId));

	// Bind pre-staged uploads to the message now that it exists. Scoped to rows
	// this sender staged and that aren't already bound, so a caller can't
	// attach someone else's upload — or re-attach one already in another
	// message — by guessing ids.
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

	// Real-time: push the new message to all online participants via SSE so
	// their chat UI appends it instantly without polling. The sender is
	// excluded — their own send call already returned the message.
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

	// Notify offline participants via email — fire-and-forget so the
	// per-participant DB lookups + email queueing never delay the send.
	void notifyOfflineParticipants(conversationId, sender, created);

	// In-app: when a staff member replies into an applicant conversation, alert
	// the applicant so they see the reply without polling. Fire-and-forget.
	(async () => {
		try {
			const [conv] = await db
				.select({ type: conversations.type, userId: conversations.userId, title: conversations.title })
				.from(conversations)
				.where(eq(conversations.id, conversationId))
				.limit(1);

			if (conv?.type === "applicant" && conv.userId && conv.userId !== sender.id) {
				const preview = created.content.length > 160 ? `${created.content.slice(0, 160)}…` : created.content;
				await notify({
					recipientUserId: conv.userId,
					type: "chat.reply",
					title: `${sender.name} replied`,
					body: preview,
					link: "/portal/support",
				});
				return;
			}

			// Staff-to-staff: notify every other participant so they get the
			// in-app bell + push. Without this, staff only saw SSE (if online
			// with the chat hub open) or email (if offline for 5+ min) — no
			// bell, no push, and no trace in the notifications table.
			if (conv && conv.type !== "applicant") {
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
							link: `/chat?conversation=${conversationId}`,
							entityType: "chat",
							entityId: created.id,
						})),
				);
			}
		} catch {
			// Notification failure must not block the message send.
		}
	})().catch(() => {});

	return serializeMessage(created);
}

/* ── Send message (public) ──────────────────────────────────────────────── */

export async function sendMessage(
	conversationId: string,
	senderOpsUser: { id: string; name: string; email: string },
	input: SendMessage,
): Promise<ChatMessage> {
	// Verify membership
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
 * data leak — so they share one gate rather than each re-deriving it.
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
 * Edit a message in place (spec §11) — never creates a new row, so replies
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
	// System and action messages are authored by the platform, not a person —
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
 * Deliberately not persisted — typing state is worthless a second later, and
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
	const conversationUrl = `${frontendUrl}/chat?conversation=${conversationId}`;

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
		// active, skip the email — they'll get the SSE + push notification.
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
			subject: `New message from ${sender.name} — Century NIT Chat`,
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
 * Applicant-facing chat — lets applicants message their assigned consultant
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

	// Create the conversation — createdBy needs a valid opsUserId
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

	return getMessages(conversationId, "", opts);
}

/**
 * Send a message from an applicant into their conversation.
 */
export async function sendApplicantMessage(
	conversationId: string,
	userId: string,
	userName: string,
	content: string,
): Promise<ChatMessage> {
	// Verify the conversation belongs to this user
	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
		.limit(1);
	if (!conv) throw new HttpError(403, "NOT_PARTICIPANT", "This is not your conversation");

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

	// Update conversation timestamp
	await db
		.update(conversations)
		.set({ updatedAt: new Date() })
		.where(eq(conversations.id, conversationId));

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
						link: "/inbox",
					});
					return;
				}
			}

			// No consultant linked yet — surface to managers/coordinators.
			const managers = await getManagerAndCoordinatorUserIds();
			await notifyMany(
				managers.map((m) => ({
					recipientUserId: m.userId,
					type: "chat.message",
					title,
					body: preview,
					link: "/inbox",
				})),
			);
		} catch {
			// Notification failure must not block the message send.
		}
	})().catch(() => {});

	return serializeMessage(created);
}
