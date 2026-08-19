import { desc, eq, and, sql, gt, ne } from "drizzle-orm";
import type {
	ChatConversation,
	ChatConversationList,
	ChatMessage,
	ChatMessageList,
	ChatUnread,
	CreateConversation,
	SendMessage,
	StaffDirectory,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	conversations,
	conversationParticipants,
	messages,
	messageMentions,
	opsUsers,
	users,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { queueEmail } from "../worker/queues.js";
import type { QueuedEmail } from "./notifications.js";
import { renderBookingEmail } from "../lib/email-templates.js";
import { env } from "../env.js";

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
				ne(messages.senderOpsUserId, opsUserId),
				participant.lastReadAt
					? gt(messages.createdAt, participant.lastReadAt)
					: sql`true`,
			),
		);

	return count;
}

/* ── Serialize ──────────────────────────────────────────────────────────── */

async function serializeConversation(
	row: typeof conversations.$inferSelect,
	forOpsUserId: string,
): Promise<ChatConversation> {
	const participants = await getParticipants(row.id);
	const unread = await countUnread(row.id, forOpsUserId);

	const [lastMsg] = await db
		.select()
		.from(messages)
		.where(eq(messages.conversationId, row.id))
		.orderBy(desc(messages.createdAt))
		.limit(1);

	return {
		id: row.id,
		type: row.type as "applicant" | "direct" | "entity" | "group",
		status: (row as any).status ?? "open",
		title: row.title,
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
		lastMessage: lastMsg
			? {
					id: lastMsg.id,
					conversationId: lastMsg.conversationId,
					senderOpsUserId: lastMsg.senderOpsUserId,
					senderName: lastMsg.senderName,
					content: lastMsg.content,
					messageType: lastMsg.messageType as "text" | "system" | "action",
					replyToId: lastMsg.replyToId,
					createdAt: lastMsg.createdAt.toISOString(),
				}
			: null,
		unreadCount: unread,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function serializeMessage(row: typeof messages.$inferSelect): ChatMessage {
	return {
		id: row.id,
		conversationId: row.conversationId,
		senderOpsUserId: row.senderOpsUserId,
		senderName: row.senderName,
		content: row.content,
		messageType: row.messageType as "text" | "system" | "action",
		replyToId: row.replyToId,
		createdAt: row.createdAt.toISOString(),
	};
}

/* ── List conversations ─────────────────────────────────────────────────── */

export async function listConversations(opsUserId: string): Promise<ChatConversationList> {
	const membership = db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(eq(conversationParticipants.opsUserId, opsUserId))
		.as("membership");

	const rows = await db
		.select()
		.from(conversations)
		.innerJoin(membership, eq(conversations.id, membership.conversationId))
		.orderBy(desc(conversations.updatedAt));

	const list = await Promise.all(
		rows.map((r) => serializeConversation(r.conversations, opsUserId)),
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

	return serializeConversation(row, opsUserId);
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
	_opsUserId: string,
	opts: { limit?: number; before?: string } = {},
): Promise<ChatMessageList> {
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
		messages: sliced.reverse().map(serializeMessage),
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

	// Handle @mentions
	if (input.mentions?.length) {
		await db.insert(messageMentions).values(
			input.mentions.map((mentionedOpsUserId) => ({
				messageId: created.id,
				mentionedOpsUserId,
			})),
		);
	}

	// Notify offline participants via email
	await notifyOfflineParticipants(conversationId, sender, created);

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
		.set({ lastReadAt: new Date() })
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, opsUserId),
			),
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

async function notifyOfflineParticipants(
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

		// Determine if the participant is "offline" (no read within last 5 min)
		const isRecentlyActive =
			p.lastReadAt &&
			Date.now() - p.lastReadAt.getTime() < 5 * 60 * 1000;

		if (isRecentlyActive) continue; // they're active, no email needed

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

	return serializeMessage(created);
}
