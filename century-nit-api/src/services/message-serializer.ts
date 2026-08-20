import { inArray, eq } from "drizzle-orm";
import type { ChatMessage, MessageReaction, QuotedMessage } from "century-nit-shared";
import { db } from "../db/index.js";
import {
	messages,
	messageReactions,
	messageAttachments,
	conversationParticipants,
} from "../db/schema.js";
import { getDocumentStorage } from "./storage/index.js";

/**
 * Who is looking at these messages.
 *
 * Staff and clients live in two different id spaces (`ops_users` vs Better Auth
 * `users`) and a viewer is always exactly one of them. Carrying both here — and
 * comparing against both on every row — is what lets a single serializer serve
 * the ops console and the client portal instead of each growing its own.
 */
export type MessageViewer = {
	opsUserId?: string | null;
	userId?: string | null;
};

/** How much of a quoted parent to inline before truncating. */
const QUOTE_PREVIEW_CHARS = 140;

function quotePreview(row: typeof messages.$inferSelect): QuotedMessage {
	const deleted = row.deletedAt !== null;
	return {
		id: row.id,
		senderName: row.senderName,
		content: deleted
			? ""
			: row.content.length > QUOTE_PREVIEW_CHARS
				? `${row.content.slice(0, QUOTE_PREVIEW_CHARS)}…`
				: row.content,
		deleted,
	};
}

function isOwn(row: typeof messages.$inferSelect, viewer: MessageViewer): boolean {
	if (row.senderOpsUserId && viewer.opsUserId) return row.senderOpsUserId === viewer.opsUserId;
	if (row.senderUserId && viewer.userId) return row.senderUserId === viewer.userId;
	return false;
}

/**
 * Serialize a single row with no enrichment — no reactions, attachments, or
 * quoted parent.
 *
 * Only correct where those genuinely don't apply (a `lastMessage` preview in a
 * conversation list, for instance). Anything rendering an actual message
 * transcript must go through `hydrateMessages`, or reactions and attachments
 * silently vanish from the UI.
 */
export function serializeMessageRow(row: typeof messages.$inferSelect): ChatMessage {
	const deleted = row.deletedAt !== null;
	return {
		id: row.id,
		conversationId: row.conversationId,
		senderOpsUserId: row.senderOpsUserId,
		senderUserId: row.senderUserId,
		senderName: row.senderName,
		// A soft-deleted message keeps its row so replies and forwards don't
		// dangle, but its body must never reach a client.
		content: deleted ? "" : row.content,
		messageType: row.messageType as "text" | "system" | "action",
		replyToId: row.replyToId,
		replyTo: null,
		forwardedFrom: null,
		editedAt: row.editedAt?.toISOString() ?? null,
		deletedAt: row.deletedAt?.toISOString() ?? null,
		reactions: [],
		attachments: [],
		deliveryStatus: null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt?.toISOString(),
	};
}

/**
 * Serialize a page of messages with everything a bubble needs to render.
 *
 * Every lookup here is batched across the whole page. Doing it per-message
 * would mean four extra round trips per bubble, which at a 50-message page is
 * 200 queries to paint one conversation.
 */
export async function hydrateMessages(
	rows: (typeof messages.$inferSelect)[],
	viewer: MessageViewer,
): Promise<ChatMessage[]> {
	if (rows.length === 0) return [];

	const ids = rows.map((r) => r.id);
	const conversationId = rows[0].conversationId;

	// Parents referenced by replies/forwards may sit outside this page (an old
	// message quoted by a recent one), so they're fetched by id rather than
	// resolved from `rows`.
	const parentIds = [
		...new Set(
			rows.flatMap((r) => [r.replyToId, r.forwardedFromId].filter((v): v is string => !!v)),
		),
	];

	const [reactionRows, attachmentRows, parentRows, participantRows] = await Promise.all([
		db.select().from(messageReactions).where(inArray(messageReactions.messageId, ids)),
		db.select().from(messageAttachments).where(inArray(messageAttachments.messageId, ids)),
		parentIds.length
			? db.select().from(messages).where(inArray(messages.id, parentIds))
			: Promise.resolve([]),
		db
			.select({
				opsUserId: conversationParticipants.opsUserId,
				participantUserId: conversationParticipants.participantUserId,
				lastReadAt: conversationParticipants.lastReadAt,
			})
			.from(conversationParticipants)
			.where(eq(conversationParticipants.conversationId, conversationId)),
	]);

	const parentsById = new Map(parentRows.map((p) => [p.id, p]));

	/* ── Reactions, pre-aggregated by emoji ── */
	const reactionsByMessage = new Map<string, Map<string, MessageReaction>>();
	for (const r of reactionRows) {
		let byEmoji = reactionsByMessage.get(r.messageId);
		if (!byEmoji) {
			byEmoji = new Map();
			reactionsByMessage.set(r.messageId, byEmoji);
		}
		const existing = byEmoji.get(r.emoji);
		const mine =
			(!!r.opsUserId && r.opsUserId === viewer.opsUserId) ||
			(!!r.userId && r.userId === viewer.userId);
		if (existing) {
			existing.count += 1;
			existing.reactors.push(r.reactorName);
			existing.mine ||= mine;
		} else {
			byEmoji.set(r.emoji, { emoji: r.emoji, count: 1, reactors: [r.reactorName], mine });
		}
	}

	/* ── Attachments, with short-lived signed URLs ── */
	const storage = attachmentRows.length ? await getDocumentStorage() : null;
	const attachmentsByMessage = new Map<string, ChatMessage["attachments"]>();
	await Promise.all(
		attachmentRows.map(async (a) => {
			let url: string | null = null;
			if (storage?.enabled) {
				try {
					const ticket = await storage.createDownloadUrl({
						key: a.storageKey,
						downloadAs: a.fileName,
					});
					url = ticket.url;
				} catch {
					// A missing or expired object shouldn't blank the whole
					// transcript — render the attachment without a link instead of
					// failing the page it appears on.
					url = null;
				}
			}
			const list = attachmentsByMessage.get(a.messageId!) ?? [];
			list.push({
				id: a.id,
				fileName: a.fileName,
				contentType: a.contentType,
				sizeBytes: a.sizeBytes,
				url,
			});
			attachmentsByMessage.set(a.messageId!, list);
		}),
	);

	/* ── Read state of everyone except the viewer ── */
	const otherLastReadAt = participantRows
		.filter(
			(p) =>
				!(p.opsUserId && p.opsUserId === viewer.opsUserId) &&
				!(p.participantUserId && p.participantUserId === viewer.userId),
		)
		.map((p) => p.lastReadAt);

	return rows.map((row) => {
		const base = serializeMessageRow(row);
		const reactions = [...(reactionsByMessage.get(row.id)?.values() ?? [])];

		let replyTo: QuotedMessage | null = null;
		if (row.replyToId) {
			const parent = parentsById.get(row.replyToId);
			if (parent) replyTo = quotePreview(parent);
		}

		let forwardedFrom: QuotedMessage | null = null;
		if (row.forwardedFromId) {
			const origin = parentsById.get(row.forwardedFromId);
			if (origin) forwardedFrom = quotePreview(origin);
		}

		// Delivery ticks only mean something on your own messages; showing them
		// on received ones is how you end up telling someone their own inbound
		// message is "unread".
		let deliveryStatus: ChatMessage["deliveryStatus"] = null;
		if (isOwn(row, viewer)) {
			const everyoneRead =
				otherLastReadAt.length > 0 &&
				otherLastReadAt.every((t) => t !== null && t > row.createdAt);
			// The row exists, so it is at minimum delivered to the server and
			// fanned out over SSE — "sent" is only ever a client-side state.
			deliveryStatus = everyoneRead ? "read" : "delivered";
		}

		return {
			...base,
			replyTo,
			forwardedFrom,
			reactions,
			attachments: attachmentsByMessage.get(row.id) ?? [],
			deliveryStatus,
		};
	});
}

/**
 * Recompute the aggregated reactions for one message. Used by the reaction
 * endpoint to build the `chat.reaction` event payload after a toggle.
 */
export async function getMessageReactions(
	messageId: string,
	viewer: MessageViewer,
): Promise<MessageReaction[]> {
	const rows = await db
		.select()
		.from(messageReactions)
		.where(eq(messageReactions.messageId, messageId));

	const byEmoji = new Map<string, MessageReaction>();
	for (const r of rows) {
		const mine =
			(!!r.opsUserId && r.opsUserId === viewer.opsUserId) ||
			(!!r.userId && r.userId === viewer.userId);
		const existing = byEmoji.get(r.emoji);
		if (existing) {
			existing.count += 1;
			existing.reactors.push(r.reactorName);
			existing.mine ||= mine;
		} else {
			byEmoji.set(r.emoji, { emoji: r.emoji, count: 1, reactors: [r.reactorName], mine });
		}
	}
	return [...byEmoji.values()];
}
