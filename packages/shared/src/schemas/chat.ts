import { z } from "zod";

/* Enums */

export const conversationTypeSchema = z.enum([
	"direct",
	"entity",
	"group",
	"applicant",
	"support",
	"case",
	"stage",
	"internal",
	"escalation",
]);
export type ConversationType = z.infer<typeof conversationTypeSchema>;

export const conversationRoleSchema = z.enum(["owner", "member", "former"]);
export type ConversationRole = z.infer<typeof conversationRoleSchema>;

export const conversationStatusSchema = z.enum(["open", "closed", "archived"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

/* Request layer — a support thread is one request, not a client's history. */

export const requestCategorySchema = z.enum([
	"payment",
	"documents",
	"application",
	"visa",
	"departure",
	"account",
	"other",
]);
export type RequestCategory = z.infer<typeof requestCategorySchema>;

export const requestPrioritySchema = z.enum(["normal", "high", "urgent"]);
export type RequestPriority = z.infer<typeof requestPrioritySchema>;

/** Whose move it is: the desk owes a reply, or the client does. */
export const waitingOnSchema = z.enum(["us", "client"]);
export type WaitingOn = z.infer<typeof waitingOnSchema>;

/** client = portal-visible; internal = ops-only ticket. */
export const conversationAudienceSchema = z.enum(["client", "internal"]);
export type ConversationAudience = z.infer<typeof conversationAudienceSchema>;

export const staffPresenceSchema = z.enum(["available", "busy", "on_leave", "offline"]);
export type StaffPresence = z.infer<typeof staffPresenceSchema>;

export const stageAssignmentStatusSchema = z.enum([
	"active",
	"reassigned",
	"on_leave",
	"completed",
	"released",
]);
export type StageAssignmentStatus = z.infer<typeof stageAssignmentStatusSchema>;

export const stageHandoffStatusSchema = z.enum(["pending", "resolved", "cancelled"]);
export type StageHandoffStatus = z.infer<typeof stageHandoffStatusSchema>;

export const stageHandoffDecisionSchema = z.enum(["keep", "assign"]);
export type StageHandoffDecision = z.infer<typeof stageHandoffDecisionSchema>;

export const messageTypeSchema = z.enum(["text", "system", "action"]);
export type ChatMessageType = z.infer<typeof messageTypeSchema>;

/**
 * `internal` messages are staff-only notes. They render dashed in the ops
 * thread and are filtered out of every client-facing read path (portal
 * transcript, applicant SSE). Server defaults to `public`.
 */
export const messageVisibilitySchema = z.enum(["public", "internal"]);
export type MessageVisibility = z.infer<typeof messageVisibilitySchema>;

/**
 * Per-message delivery state (spec §15).
 *
 * `sending` and `failed` are CLIENT-ONLY: they describe an optimistic bubble
 * that has no server row yet. The server never emits them. Everything from
 * `sent` onwards is derived server-side. See `deliveryStatus` on
 * `chatMessageSchema`.
 */
export const messageDeliverySchema = z.enum(["sending", "sent", "delivered", "read", "failed"]);
export type MessageDelivery = z.infer<typeof messageDeliverySchema>;

/* Reactions */

/**
 * Reactions arrive pre-aggregated by emoji rather than as a flat row list, so
 * a bubble can render "👍 3" without the client grouping them on every paint.
 * `mine` lets the UI highlight the viewer's own reaction without needing to
 * know its own identity in reactor terms (staff vs client id spaces differ).
 */
export const messageReactionSchema = z.object({
	emoji: z.string().min(1).max(16),
	count: z.number().int().positive(),
	/** Display names of reactors, for the "who reacted" popover. */
	reactors: z.array(z.string()),
	/** True when the requesting user is one of the reactors. */
	mine: z.boolean(),
});
export type MessageReaction = z.infer<typeof messageReactionSchema>;

/* Attachments */

export const messageAttachmentSchema = z.object({
	id: z.string().uuid(),
	fileName: z.string(),
	contentType: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	/** Short-lived presigned download URL. Never a raw storage key. */
	url: z.string().nullable(),
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

/* Quoted reply / forward provenance */

/**
 * A denormalised snapshot of the message being quoted, hydrated server-side.
 * Without this the client would have to already hold the parent in its local
 * page of messages to render a quote. Which breaks the moment the parent is
 * older than the current scroll window.
 */
export const quotedMessageSchema = z.object({
	id: z.string().uuid(),
	senderName: z.string(),
	/** Truncated preview. Empty string when the parent was deleted. */
	content: z.string(),
	deleted: z.boolean(),
});
export type QuotedMessage = z.infer<typeof quotedMessageSchema>;

/* Message */

export const chatMessageSchema = z.object({
	id: z.string().uuid(),
	conversationId: z.string().uuid(),
	senderOpsUserId: z.string().uuid().nullable(),
	/** Set instead of `senderOpsUserId` when the author is a client/applicant. */
	senderUserId: z.string().nullable().optional(),
	senderName: z.string(),
	content: z.string(),
	messageType: messageTypeSchema,
	replyToId: z.string().uuid().nullable().optional(),
	/** Hydrated preview of `replyToId`, so quotes render without a second fetch. */
	replyTo: quotedMessageSchema.nullable().optional(),
	/** Present when this message was forwarded. Identifies the original author. */
	forwardedFrom: quotedMessageSchema.nullable().optional(),
	/** Non-null once the body was edited; drives the "edited" marker. */
	editedAt: z.string().datetime().nullable().optional(),
	/** Non-null when soft-deleted; `content` is blanked and a tombstone shown. */
	deletedAt: z.string().datetime().nullable().optional(),
	/** `internal` = staff-only note; never sent to client reads or SSE. */
	visibility: messageVisibilitySchema.default("public"),
	reactions: z.array(messageReactionSchema).default([]),
	attachments: z.array(messageAttachmentSchema).default([]),
	/**
	 * Derived from participants' `lastReadAt`, not stored per-message. Only
	 * meaningful on messages the requesting user sent; `null` on received ones.
	 */
	deliveryStatus: messageDeliverySchema.nullable().optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime().optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/* Participant */

export const chatParticipantSchema = z.object({
	opsUserId: z.string().uuid(),
	name: z.string(),
	email: z.string(),
	role: conversationRoleSchema,
	lastReadAt: z.string().datetime().nullable().optional(),
	joinedAt: z.string().datetime(),
});
export type ChatParticipant = z.infer<typeof chatParticipantSchema>;

/* Conversation */

export const chatConversationSchema = z.object({
	id: z.string().uuid(),
	type: conversationTypeSchema,
	/** Human-facing ticket ref (REQ-2026-0142). Null on rows predating 0115 until the backfill runs. */
	reference: z.string().nullable().optional(),
	title: z.string(),
	linkedEntityType: z.string().nullable().optional(),
	linkedEntityId: z.string().uuid().nullable().optional(),
	createdBy: z.string().uuid().nullable(),
	/** Journey stage key this conversation is scoped to (for `stage` type). */
	stageKey: z.string().nullable().optional(),
	/** Lifecycle: open / closed / archived. */
	status: conversationStatusSchema.default("open"),
	/** The portal user a client-facing conversation belongs to (applicant/support/case/stage). */
	clientUserId: z.string().nullable().optional(),
	/** Opaque token used for inbound email threading (null for non-email convo). */
	emailInboxToken: z.string().nullable().optional(),
	/** For escalations only. */
	escalatedByOpsUserId: z.string().uuid().nullable().optional(),
	escalationReason: z.string().nullable().optional(),
	/* Request layer (0110) */
	subject: z.string().nullable().optional(),
	category: requestCategorySchema.nullable().optional(),
	priority: requestPrioritySchema.optional(),
	waitingOn: waitingOnSchema.nullable().optional(),
	audience: conversationAudienceSchema.optional(),
	/** Set when the office logged the request on the client's behalf. */
	raisedByOpsUserId: z.string().uuid().nullable().optional(),
	firstResponseAt: z.string().datetime().nullable().optional(),
	resolvedAt: z.string().datetime().nullable().optional(),
	/** 1 = thumbs down, 5 = thumbs up. */
	csatScore: z.number().int().nullable().optional(),
	csatNote: z.string().nullable().optional(),
	participants: z.array(chatParticipantSchema),
	lastMessage: chatMessageSchema.nullable().optional(),
	/**
	 * Server-computed triage flag: the last PUBLIC message came from the
	 * client, so the thread is waiting on staff. Internal notes never clear
	 * it, and it does not depend on the viewer's unread cursor.
	 */
	awaitingReply: z.boolean().optional(),
	unreadCount: z.number().int().nonnegative(),
	/** Denormalised activity timestamp. Set by the server on every send. */
	lastMessageAt: z.string().datetime().nullable().optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type ChatConversation = z.infer<typeof chatConversationSchema>;

export const chatConversationListSchema = z.object({
	conversations: z.array(chatConversationSchema),
	total: z.number().int(),
});
export type ChatConversationList = z.infer<typeof chatConversationListSchema>;

/* Message list (paginated) */

export const chatMessageListSchema = z.object({
	messages: z.array(chatMessageSchema),
	total: z.number().int(),
	hasMore: z.boolean(),
});
export type ChatMessageList = z.infer<typeof chatMessageListSchema>;

/* Unread counts */

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

/* Request schemas */

export const createConversationSchema = z.object({
	/** For direct messages. The opsUserId of the other person. */
	participantOpsUserId: z.string().uuid().optional(),
	/** For entity-linked conversations. */
	linkedEntityType: z
		.enum(["consultation", "application", "booking"])
		.optional(),
	linkedEntityId: z.string().uuid().optional(),
	/** Explicit title override. Auto-generated for direct messages. */
	title: z.string().min(1).max(255).optional(),
	/** For group conversations. Additional participant IDs. */
	participantOpsUserIds: z.array(z.string().uuid()).optional(),
	/**
	 * Staff-initiated client thread. The portal user the conversation is
	 * with. Type derives from context: `linkedEntityId` + `stageKey` → stage
	 * thread, `linkedEntityId` alone → case thread, neither → support.
	 * Idempotent: an existing open thread for the same client+context is
	 * returned (and the creator joined) rather than forking a second one.
	 */
	clientUserId: z.string().min(1).optional(),
	/** Journey stage key for a `stage`-scoped client thread. */
	stageKey: z.string().optional(),
	/** Optional first message to send immediately. */
	initialMessage: z.string().min(1).max(5000).optional(),
	/* Request layer — staff filing a request on a client's behalf, or an
	   internal ticket. Ignored for direct/group conversations. */
	subject: z.string().min(1).max(255).optional(),
	category: requestCategorySchema.optional(),
	priority: requestPrioritySchema.optional(),
	audience: conversationAudienceSchema.optional(),
});

/** Client intake: one request = category + subject + first message. */
export const createCustomerRequestSchema = z.object({
	category: requestCategorySchema,
	subject: z.string().min(1).max(255),
	content: z.string().min(1).max(5000),
	/** Optional case the request is about. */
	caseId: z.string().uuid().optional(),
});
export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>;

/** Post-resolve rating. */
export const rateConversationSchema = z.object({
	/** 1 = thumbs down, 5 = thumbs up. */
	score: z.union([z.literal(1), z.literal(5)]),
	note: z.string().max(1000).optional(),
});
export type RateConversation = z.infer<typeof rateConversationSchema>;

export const cannedReplySchema = z.object({
	id: z.string().uuid(),
	label: z.string(),
	body: z.string(),
	scope: z.enum(["all", "branch", "stage"]),
	scopeValue: z.string().nullable().optional(),
});
export type CannedReply = z.infer<typeof cannedReplySchema>;

export const upsertCannedReplySchema = z.object({
	label: z.string().min(1).max(120),
	body: z.string().min(1).max(4000),
	scope: z.enum(["all", "branch", "stage"]).optional().default("all"),
	scopeValue: z.string().max(80).optional(),
});
export type UpsertCannedReply = z.infer<typeof upsertCannedReplySchema>;
export type CreateConversation = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z.object({
	content: z.string().min(1).max(5000),
	replyToId: z.string().uuid().optional(),
	mentions: z.array(z.string().uuid()).optional(),
	/** Ids returned by the attachment-upload endpoint, bound on send. */
	attachmentIds: z.array(z.string().uuid()).max(10).optional(),
	/**
	 * Client-generated id echoed back on the created message so an optimistic
	 * bubble can be reconciled with its server row instead of briefly
	 * double-rendering when the SSE echo arrives before the HTTP response.
	 */
	clientNonce: z.string().max(64).optional(),
	/**
	 * Staff-only: `internal` posts a note visible to ops but filtered from
	 * every client-facing read. Ignored on the applicant send path.
	 */
	visibility: messageVisibilitySchema.optional(),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;

/* Message actions (spec §11, §12, §13) */

export const editMessageSchema = z.object({
	content: z.string().min(1).max(5000),
});
export type EditMessage = z.infer<typeof editMessageSchema>;

/**
 * Forwarding targets existing conversations by id. Deliberately NOT "forward to
 * user". Resolving a user to a conversation is a separate, permission-checked
 * step, and accepting user ids here would let a caller create conversations as
 * a side effect of forwarding.
 */
export const forwardMessageSchema = z.object({
	conversationIds: z.array(z.string().uuid()).min(1).max(10),
});
export type ForwardMessage = z.infer<typeof forwardMessageSchema>;

export const reactToMessageSchema = z.object({
	/** Unicode emoji. Applying an emoji already present removes it (toggle). */
	emoji: z.string().min(1).max(16),
});
export type ReactToMessage = z.infer<typeof reactToMessageSchema>;

export const typingSchema = z.object({
	/** false when the user clears the composer or sends. */
	typing: z.boolean(),
});
export type Typing = z.infer<typeof typingSchema>;

/* Real-time event contract (spec §20) */

/**
 * Every event the server pushes over SSE for a conversation.
 *
 * This is the single source of truth for the realtime contract. The ops
 * console, the client portal, and the API all import it, so adding an event
 * without handling it somewhere becomes a type error rather than a silent
 * no-op. Declared as a TypeScript union rather than a zod schema because these
 * are server-authored and trusted; there is no untrusted boundary to validate.
 *
 * Transport is SSE (server→client). The one genuinely client→server signal,
 * typing, is a plain POST that fans back out as `chat.typing`.
 */
export type ChatRealtimeEvent =
	| { type: "chat.message"; conversationId: string; message: ChatMessage }
	| { type: "chat.message.updated"; conversationId: string; message: ChatMessage }
	| { type: "chat.message.deleted"; conversationId: string; messageId: string }
	| {
			type: "chat.reaction";
			conversationId: string;
			messageId: string;
			reactions: MessageReaction[];
	  }
	| { type: "chat.conversation.created"; conversationId: string }
	| {
			type: "chat.conversation.updated";
			conversationId: string;
			/** Set when lifecycle changed. Resolve/reopen/archive. */
			status?: ConversationStatus;
	  }
	| { type: "chat.read"; conversationId: string }
	| {
			type: "chat.typing";
			conversationId: string;
			/** Who is typing. Never the recipient's own id. */
			actorName: string;
			typing: boolean;
	  }
	| { type: "chat.presence"; opsUserId: string; presence: StaffPresence };

export const addParticipantSchema = z.object({
	opsUserId: z.string().uuid(),
});
export type AddParticipant = z.infer<typeof addParticipantSchema>;

export const markReadSchema = z.object({
	conversationId: z.string().uuid(),
});
export type MarkRead = z.infer<typeof markReadSchema>;

/* Staff directory (for mention autocomplete) */

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

/* ══════════════════════════════════════════════════════════════════════════
 * Context-Aware Case Communication. Extends the chat contract with the
 * concepts needed to route a customer to the officer currently responsible
 * for their case stage (see services/communication.ts).
 * ══════════════════════════════════════════════════════════════════════════ */

/** A staff member with the context in which they are connected to a case. */
export const contactCardSchema = z.object({
	opsUserId: z.string().uuid(),
	name: z.string(),
	email: z.string(),
	role: z.string().nullable(),
	branch: z.string().nullable(),
	/** Stage label the officer is responsible for, if any. */
	stageLabel: z.string().nullable().optional(),
	/** Stage key (`JourneyStage`) the officer is responsible for, if any. */
	stageKey: z.string().nullable().optional(),
	presence: staffPresenceSchema,
	/** Average response time hint shown to customers, e.g. "Replies in ~1h". */
	availabilityNote: z.string().nullable().optional(),
});
export type ContactCard = z.infer<typeof contactCardSchema>;

/**
 * The resolved answer to "who can help me, with what, and how do I contact
 * them?". The single most important payload the portal chat renders.
 */
export const currentContactSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("support"),
	}),
	z.object({
		kind: z.literal("case_manager"),
		contact: contactCardSchema,
		caseRef: z.string(),
	}),
	z.object({
		kind: z.literal("stage_officer"),
		contact: contactCardSchema,
		caseRef: z.string(),
		stageKey: z.string(),
		stageLabel: z.string(),
		caseManager: contactCardSchema.nullable(),
	}),
	z.object({
		kind: z.literal("escalation"),
		contact: contactCardSchema,
		caseRef: z.string(),
		reason: z.string().nullable().optional(),
	}),
]);
export type CurrentContact = z.infer<typeof currentContactSchema>;

/** A previous contact from the customer's journey through this case. */
export const previousContactSchema = z.object({
	opsUserId: z.string().uuid(),
	name: z.string(),
	role: z.string().nullable(),
	stageLabel: z.string().nullable().optional(),
	stageKey: z.string().nullable().optional(),
	endedReason: z.string().nullable().optional(),
});
export type PreviousContact = z.infer<typeof previousContactSchema>;

/** The portal's full communication context. Drives the Communication Center. */
export const communicationContextSchema = z.object({
	current: currentContactSchema,
	previousContacts: z.array(previousContactSchema),
	/** Conversation summaries the customer can open. */
	conversations: z.array(chatConversationSchema),
	/** The active case reference, if any. */
	activeCaseRef: z.string().nullable(),
	activeStageKey: z.string().nullable().optional(),
});
export type CommunicationContext = z.infer<typeof communicationContextSchema>;

/** Stage assignment. The per-stage officer mapping for a case. */
export const stageAssignmentSchema = z.object({
	id: z.string().uuid(),
	applicationId: z.string().uuid(),
	stage: z.string(),
	opsUserId: z.string().uuid(),
	opsUserName: z.string().nullable().optional(),
	status: stageAssignmentStatusSchema,
	assignedAt: z.string().datetime(),
	assignedBy: z.string().uuid().nullable().optional(),
	endedAt: z.string().datetime().nullable().optional(),
	endedReason: z.string().nullable().optional(),
});
export type StageAssignment = z.infer<typeof stageAssignmentSchema>;

export const createStageAssignmentSchema = z.object({
	applicationId: z.string().uuid(),
	stage: z.string().min(1).max(80),
	opsUserId: z.string().uuid(),
	reason: z.string().max(500).optional(),
	/** `stage` = per-stage specialist (writes stage_assignments); `all` = whole-case owner (writes case_assignments). */
	scope: z.enum(["stage", "all"]).optional().default("stage"),
});
export type CreateStageAssignment = z.infer<typeof createStageAssignmentSchema>;

/**
 * Stage handoff. An assignment decision waiting on a manager.
 *
 * The queue item the Workspace renders as an "Assignment required" card.
 * Resolution writes an active stage_assignment via assignStageOfficer and
 * activates the stage (`visa awaiting_handler → pending`).
 */
export const stageHandoffSchema = z.object({
	id: z.string().uuid(),
	applicationId: z.string().uuid(),
	applicationNumber: z.string().nullable(),
	applicantName: z.string().nullable(),
	stage: z.string(),
	source: z.string(),
	status: stageHandoffStatusSchema,
	decision: stageHandoffDecisionSchema.nullable(),
	fromOpsUserId: z.string().uuid().nullable(),
	fromOpsUserName: z.string().nullable(),
	resolvedOpsUserId: z.string().uuid().nullable(),
	resolvedOpsUserName: z.string().nullable(),
	decidedBy: z.string().uuid().nullable(),
	decidedAt: z.string().datetime().nullable(),
	deferredAt: z.string().datetime().nullable(),
	deferCount: z.number().int().nonnegative().default(0),
	reason: z.string().nullable(),
	/** Stamped once when the handoff ages past the escalation threshold. */
	escalatedAt: z.string().datetime().nullable().optional(),
	createdAt: z.string().datetime(),
});
export type StageHandoff = z.infer<typeof stageHandoffSchema>;

export const listStageHandoffsQuerySchema = z.object({
	status: z.enum(["pending", "all"]).optional().default("pending"),
});
export type ListStageHandoffsQuery = z.infer<typeof listStageHandoffsQuerySchema>;

export const stageHandoffListSchema = z.object({
	handoffs: z.array(stageHandoffSchema),
	total: z.number().int().nonnegative(),
});
export type StageHandoffList = z.infer<typeof stageHandoffListSchema>;

export const resolveStageHandoffSchema = z.object({
	decision: stageHandoffDecisionSchema,
	/** Required when `decision === "assign"`; ignored for `keep`. */
	opsUserId: z.string().uuid().optional(),
	reason: z.string().max(500).optional(),
	/**
	 * Coverage. `stage` staffs only the stage the handoff opened; `all`
	 * makes the handler carry the rest of the case (no further placement).
	 */
	scope: z.enum(["stage", "all"]).optional(),
	/** Referral. Move the case to another handling branch with this resolution. */
	branch: z.string().min(1).max(64).optional(),
});
export type ResolveStageHandoff = z.infer<typeof resolveStageHandoffSchema>;

export const deferStageHandoffSchema = z.object({
	reason: z.string().max(500).optional(),
});
export type DeferStageHandoff = z.infer<typeof deferStageHandoffSchema>;

/** Staff directory entry with presence + load. The OPS hub view. */
export const staffDirectoryEntryDetailedSchema = z.object({
	opsUserId: z.string().uuid(),
	name: z.string(),
	email: z.string(),
	role: z.string(),
	branch: z.string().nullable(),
	presence: staffPresenceSchema,
	lastSeenAt: z.string().datetime().nullable().optional(),
	unreadCount: z.number().int().nonnegative().default(0),
	activeCaseCount: z.number().int().nonnegative().default(0),
	currentAssignmentSummary: z.string().nullable().optional(),
});
export type StaffDirectoryEntryDetailed = z.infer<typeof staffDirectoryEntryDetailedSchema>;

export const staffDirectoryDetailedSchema = z.object({
	staff: z.array(staffDirectoryEntryDetailedSchema),
});
export type StaffDirectoryDetailed = z.infer<typeof staffDirectoryDetailedSchema>;

/** Communication audit event (read-only). */
export const communicationEventSchema = z.object({
	id: z.string().uuid(),
	actorUserId: z.string().nullable().optional(),
	actorOpsUserId: z.string().uuid().nullable().optional(),
	action: z.string(),
	conversationId: z.string().uuid().nullable().optional(),
	applicationId: z.string().uuid().nullable().optional(),
	stageKey: z.string().nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().datetime(),
});
export type CommunicationEvent = z.infer<typeof communicationEventSchema>;

/** Update staff presence (heartbeat from the OPS frontend). */
export const updatePresenceSchema = z.object({
	status: staffPresenceSchema,
});
export type UpdatePresence = z.infer<typeof updatePresenceSchema>;

/** Send a customer-visible or internal message. Supports system/system author. */
export const sendContextMessageSchema = z.object({
	content: z.string().min(1).max(5000),
	replyToId: z.string().uuid().optional(),
	mentions: z.array(z.string().uuid()).optional(),
	/** Staged upload ids bound to this message on send. */
	attachmentIds: z.array(z.string().uuid()).max(10).optional(),
});
export type SendContextMessage = z.infer<typeof sendContextMessageSchema>;
