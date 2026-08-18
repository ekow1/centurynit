import { z } from "zod";

/* ── Enums ─────────────────────────────────────────────────────────────── */

export const conversationTypeSchema = z.enum(["direct", "entity", "group"]);
export type ConversationType = z.infer<typeof conversationTypeSchema>;

export const conversationRoleSchema = z.enum(["owner", "member"]);
export type ConversationRole = z.infer<typeof conversationRoleSchema>;

export const messageTypeSchema = z.enum(["text", "system", "action"]);
export type ChatMessageType = z.infer<typeof messageTypeSchema>;

/* ── Message ───────────────────────────────────────────────────────────── */

export const chatMessageSchema = z.object({
	id: z.string().uuid(),
	conversationId: z.string().uuid(),
	senderOpsUserId: z.string().uuid(),
	senderName: z.string(),
	content: z.string(),
	messageType: messageTypeSchema,
	replyToId: z.string().uuid().nullable().optional(),
	createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/* ── Participant ───────────────────────────────────────────────────────── */

export const chatParticipantSchema = z.object({
	opsUserId: z.string().uuid(),
	name: z.string(),
	email: z.string(),
	role: conversationRoleSchema,
	lastReadAt: z.string().datetime().nullable().optional(),
	joinedAt: z.string().datetime(),
});
export type ChatParticipant = z.infer<typeof chatParticipantSchema>;

/* ── Conversation ──────────────────────────────────────────────────────── */

export const chatConversationSchema = z.object({
	id: z.string().uuid(),
	type: conversationTypeSchema,
	title: z.string(),
	linkedEntityType: z.string().nullable().optional(),
	linkedEntityId: z.string().uuid().nullable().optional(),
	createdBy: z.string().uuid(),
	participants: z.array(chatParticipantSchema),
	lastMessage: chatMessageSchema.nullable().optional(),
	unreadCount: z.number().int().nonnegative(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type ChatConversation = z.infer<typeof chatConversationSchema>;

export const chatConversationListSchema = z.object({
	conversations: z.array(chatConversationSchema),
	total: z.number().int(),
});
export type ChatConversationList = z.infer<typeof chatConversationListSchema>;

/* ── Message list (paginated) ──────────────────────────────────────────── */

export const chatMessageListSchema = z.object({
	messages: z.array(chatMessageSchema),
	total: z.number().int(),
	hasMore: z.boolean(),
});
export type ChatMessageList = z.infer<typeof chatMessageListSchema>;

/* ── Unread counts ─────────────────────────────────────────────────────── */

export const chatUnreadSchema = z.object({
	totalUnread: z.number().int(),
	conversations: z.array(
		z.object({
			conversationId: z.string().uuid(),
			unreadCount: z.number().int(),
		}),
	),
});
export type ChatUnread = z.infer<typeof chatUnreadSchema>;

/* ── Request schemas ───────────────────────────────────────────────────── */

export const createConversationSchema = z.object({
	/** For direct messages — the opsUserId of the other person. */
	participantOpsUserId: z.string().uuid().optional(),
	/** For entity-linked conversations. */
	linkedEntityType: z
		.enum(["consultation", "application", "booking"])
		.optional(),
	linkedEntityId: z.string().uuid().optional(),
	/** Explicit title override. Auto-generated for direct messages. */
	title: z.string().min(1).max(255).optional(),
	/** For group conversations — additional participant IDs. */
	participantOpsUserIds: z.array(z.string().uuid()).optional(),
	/** Optional first message to send immediately. */
	initialMessage: z.string().min(1).max(5000).optional(),
});
export type CreateConversation = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z.object({
	content: z.string().min(1).max(5000),
	replyToId: z.string().uuid().optional(),
	mentions: z.array(z.string().uuid()).optional(),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;

export const addParticipantSchema = z.object({
	opsUserId: z.string().uuid(),
});
export type AddParticipant = z.infer<typeof addParticipantSchema>;

export const markReadSchema = z.object({
	conversationId: z.string().uuid(),
});
export type MarkRead = z.infer<typeof markReadSchema>;

/* ── Staff directory (for mention autocomplete) ─────────────────────────── */

export const staffDirectoryEntrySchema = z.object({
	opsUserId: z.string().uuid(),
	name: z.string(),
	email: z.string(),
	role: z.string(),
});
export type StaffDirectoryEntry = z.infer<typeof staffDirectoryEntrySchema>;

export const staffDirectorySchema = z.object({
	staff: z.array(staffDirectoryEntrySchema),
});
export type StaffDirectory = z.infer<typeof staffDirectorySchema>;
