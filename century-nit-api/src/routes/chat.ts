import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { validationHook } from "../middleware/error.js";
import { z } from "zod";
import {
	chatConversationSchema,
	chatConversationListSchema,
	chatMessageListSchema,
	chatUnreadSchema,
	chatMessageSchema,
	staffDirectorySchema,
	createConversationSchema,
	sendMessageSchema,
	addParticipantSchema,
	editMessageSchema,
	forwardMessageSchema,
	reactToMessageSchema,
	messageReactionSchema,
	typingSchema,
	requestCategorySchema,
	requestPrioritySchema,
	cannedReplySchema,
	upsertCannedReplySchema,
} from "century-nit-shared";
import { requireAuth, requireMfa, requireAnyModule, type AuthVariables } from "../middleware/auth.js";
import {
	listConversations,
	getConversation,
	createConversation,
	getMessages,
	sendMessage,
	markAsRead,
	getUnreadCounts,
	addParticipant,
	getStaffDirectory,
	editMessage,
	deleteMessage,
	toggleReaction,
	forwardMessage,
	setTyping,
	setConversationStatus,
	assignConversationOwner,
	getConversationContext,
	stageChatAttachment,
} from "../services/chat.js";
import { startClientConversation } from "../services/communication.js";
import {
	createStaffRequest,
	setConversationWaitingOn,
	escalateConversation,
	listCannedReplies,
	createCannedReply,
	deleteCannedReply,
	deskStats,
} from "../services/communication.js";

const idParams = z.object({ id: z.string().uuid() });
const messageIdParams = z.object({ messageId: z.string().uuid() });

/**
 * Roles allowed to delete a message they did not author.
 *
 * Deliberately narrow: moderation is a trust-and-safety power, not a
 * convenience, and "can access the chat module" is a much weaker claim than
 * "may remove someone else's words from the record".
 */
const MODERATOR_ROLES = new Set(["super_admin", "manager"]);

export const chatRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

/* ── GET /api/v1/chat/conversations ─────────────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversations",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			query: z.object({
				/** staff = generic hub (DMs/groups/internal only); desk = client
				 *  threads only (the Helpdesk queue). Unset keeps both. */
				scope: z.enum(["staff", "desk"]).optional(),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: chatConversationListSchema } },
				description: "Staff member's conversations",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { scope } = c.req.valid("query");
		const list = await listConversations(staff.opsUserId, staff.role, scope);
		return c.json(list);
	},
);

/* ── POST /api/v1/chat/conversations ────────────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			body: {
				content: { "application/json": { schema: createConversationSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: chatConversationSchema } },
				description: "Conversation created",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		if (body.clientUserId) {
			// Staff-initiated client thread — support / case / stage. Idempotent:
			// an existing thread for the same client+context is joined, not
			// duplicated, and the creator is made a participant.
			const conv = await startClientConversation(
				body.clientUserId,
				{ id: staff.opsUserId, name: staff.name, email: staff.email },
				{
					linkedEntityType: body.linkedEntityType,
					linkedEntityId: body.linkedEntityId,
					stageKey: body.stageKey,
					initialMessage: body.initialMessage,
				},
			);
			return c.json(conv, 201);
		}
		const created = await createConversation({ id: staff.opsUserId, name: staff.name, email: staff.email }, body);
		return c.json(created, 201);
	},
);

/* ── GET /api/v1/chat/conversations/:id ─────────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversations/{id}",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: chatConversationSchema } },
				description: "Conversation details",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const conv = await getConversation(id, staff.opsUserId, staff.role);
		return c.json(conv);
	},
);

/* ── GET /api/v1/chat/conversations/:id/messages ────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversations/{id}/messages",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			query: z.object({
				limit: z.coerce.number().int().min(1).max(100).optional(),
				before: z.string().uuid().optional(),
				/** Thread-scoped message search (ILIKE on content). */
				q: z.string().min(1).max(200).optional(),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: chatMessageListSchema } },
				description: "Paginated messages",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const query = c.req.valid("query");
		const list = await getMessages(id, staff.opsUserId, query, staff.role);
		return c.json(list);
	},
);

/* ── PATCH /api/v1/chat/conversations/:id/status ──────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "patch",
		path: "/conversations/{id}/status",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": {
						schema: z.object({ status: z.enum(["open", "closed", "archived"]) }),
					},
				},
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: chatConversationSchema } },
				description: "Lifecycle updated — resolve/reopen writes a system divider",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const { status } = c.req.valid("json");
		const conv = await setConversationStatus(
			id,
			status,
			{ id: staff.opsUserId, name: staff.name },
			staff.role,
		);
		return c.json(conv);
	},
);

/* ── POST /api/v1/chat/conversations/:id/owner ────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/owner",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": {
						schema: z.object({
							/** Claim: pass your own id. Unclaim: null. Reassign: another staff id. */
							opsUserId: z.string().uuid().nullable(),
						}),
					},
				},
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: chatConversationSchema } },
				description: "Ownership updated",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const { opsUserId } = c.req.valid("json");
		const conv = await assignConversationOwner(
			id,
			opsUserId,
			{ id: staff.opsUserId, name: staff.name },
			staff.role,
		);
		return c.json(conv);
	},
);

/* ── GET /api/v1/chat/conversations/:id/context ───────────────────────── */

const conversationContextSchema = z.object({
	client: z
		.object({
			userId: z.string(),
			name: z.string(),
			email: z.string().nullable(),
			branch: z.string().nullable(),
			targetCountry: z.string().nullable(),
			memberSince: z.string().nullable(),
		})
		.nullable(),
	cases: z.array(
		z.object({
			id: z.string().uuid(),
			appNumber: z.string(),
			stage: z.string(),
			stageLabel: z.string(),
			status: z.string(),
		}),
	),
	money: z.array(
		z.object({ type: z.string(), status: z.string(), invoiceNumber: z.string() }),
	),
	nextAppointment: z
		.object({ startsAt: z.string(), serviceName: z.string(), status: z.string() })
		.nullable(),
	owner: z.object({ opsUserId: z.string(), name: z.string() }).nullable(),
	messageCount: z.number().int(),
});

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversations/{id}/context",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: { params: idParams },
		responses: {
			200: {
				content: { "application/json": { schema: conversationContextSchema } },
				description: "Client/case/money/appointment context for the helpdesk rail",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const ctx = await getConversationContext(id, staff.opsUserId, staff.role);
		return c.json(ctx);
	},
);

/* ── POST /api/v1/chat/conversations/:id/attachments ──────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/attachments",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": {
						schema: z.object({
							fileName: z.string().min(1).max(255),
							contentType: z.string().min(1).max(128),
							sizeBytes: z.number().int().positive(),
						}),
					},
				},
				required: true,
			},
		},
		responses: {
			201: {
				content: {
					"application/json": {
						schema: z.object({
							attachmentId: z.string().uuid(),
							uploadUrl: z.string(),
							headers: z.record(z.string(), z.string()),
							expiresAt: z.string(),
						}),
					},
				},
				description: "Staged attachment + presigned upload URL",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const staged = await stageChatAttachment(id, { opsUserId: staff.opsUserId }, body);
		return c.json(staged, 201);
	},
);

/* ── POST /api/v1/chat/conversations/:id/messages ───────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/messages",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: sendMessageSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: chatMessageSchema } },
				description: "Message sent",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const msg = await sendMessage(id, { id: staff.opsUserId, name: staff.name, email: staff.email }, body, staff.role);
		return c.json(msg, 201);
	},
);

/* ── POST /api/v1/chat/conversations/:id/read ───────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/read",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: { params: idParams },
		responses: {
			200: {
				description: "Marked as read",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		await markAsRead(id, staff.opsUserId);
		return c.json({ ok: true });
	},
);

/* ── GET /api/v1/chat/unread ────────────────────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/unread",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: chatUnreadSchema } },
				description: "Unread message counts",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const unread = await getUnreadCounts(staff.opsUserId);
		return c.json(unread);
	},
);

/* ── POST /api/v1/chat/conversations/:id/participants ───────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/participants",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: addParticipantSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				description: "Participant added",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		await addParticipant(id, body.opsUserId);
		return c.json({ ok: true });
	},
);

/* ── GET /api/v1/chat/staff-directory ───────────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/staff-directory",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: staffDirectorySchema } },
				description: "Active staff directory for @mentions",
			},
		},
	}),
	async (c) => {
		const dir = await getStaffDirectory();
		return c.json(dir);
	},
);

/* ── PATCH /api/v1/chat/messages/:messageId ─────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "patch",
		path: "/messages/{messageId}",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: messageIdParams,
			body: { content: { "application/json": { schema: editMessageSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: chatMessageSchema } },
				description: "Edited message",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { messageId } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await editMessage(messageId, staff.opsUserId, body.content);
		return c.json(updated);
	},
);

/* ── DELETE /api/v1/chat/messages/:messageId ────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "delete",
		path: "/messages/{messageId}",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: { params: messageIdParams },
		responses: { 204: { description: "Message deleted" } },
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { messageId } = c.req.valid("param");
		await deleteMessage(messageId, staff.opsUserId, {
			canModerate: MODERATOR_ROLES.has(staff.role),
		});
		return c.body(null, 204);
	},
);

/* ── POST /api/v1/chat/messages/:messageId/reactions ────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/messages/{messageId}/reactions",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: messageIdParams,
			body: { content: { "application/json": { schema: reactToMessageSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.array(messageReactionSchema) } },
				description: "Aggregated reactions after toggle",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { messageId } = c.req.valid("param");
		const body = c.req.valid("json");
		const reactions = await toggleReaction(
			messageId,
			{ opsUserId: staff.opsUserId, name: staff.name },
			body.emoji,
		);
		return c.json(reactions);
	},
);

/* ── POST /api/v1/chat/messages/:messageId/forward ──────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/messages/{messageId}/forward",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: messageIdParams,
			body: { content: { "application/json": { schema: forwardMessageSchema } }, required: true },
		},
		responses: {
			201: {
				content: { "application/json": { schema: z.array(chatMessageSchema) } },
				description: "Forwarded messages created in each target conversation",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { messageId } = c.req.valid("param");
		const body = c.req.valid("json");
		const forwarded = await forwardMessage(
			messageId,
			{ id: staff.opsUserId, name: staff.name, email: staff.email },
			body.conversationIds,
		);
		return c.json(forwarded, 201);
	},
);

/* ── POST /api/v1/chat/conversations/:id/typing ─────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/typing",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: typingSchema } }, required: true },
		},
		responses: { 204: { description: "Typing signal fanned out" } },
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		await setTyping(id, { opsUserId: staff.opsUserId, name: staff.name }, body.typing);
		return c.body(null, 204);
	},
);

/* ── Request layer ────────────────────────────────────────────────────── */

const logRequestSchema = z.object({
	/** File for a client (phone/walk-in intake). Omit for an internal ticket. */
	clientUserId: z.string().uuid().optional(),
	category: requestCategorySchema,
	subject: z.string().min(1).max(255),
	content: z.string().min(1).max(5000),
	internal: z.boolean().optional().default(false),
	assigneeOpsUserId: z.string().uuid().optional(),
	priority: requestPrioritySchema.optional(),
});

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/requests",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			body: { content: { "application/json": { schema: logRequestSchema } }, required: true },
		},
		responses: {
			201: {
				content: { "application/json": { schema: chatConversationSchema } },
				description: "Request logged — client-facing or internal ticket",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		const conv = await createStaffRequest(staff.opsUserId, body);
		return c.json(conv, 201);
	},
);

chatRouter.openapi(
	createRoute({
		method: "patch",
		path: "/conversations/{id}/waiting-on",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": {
						schema: z.object({ waitingOn: z.enum(["us", "client"]).nullable() }),
					},
				},
				required: true,
			},
		},
		responses: { 200: { description: "Waiting-on updated" } },
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const { waitingOn } = c.req.valid("json");
		await setConversationWaitingOn(id, waitingOn);
		return c.json({ ok: true });
	},
);

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/escalate",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": { schema: z.object({ reason: z.string().min(1).max(500) }) },
				},
				required: true,
			},
		},
		responses: { 200: { description: "Escalated to the manager queue" } },
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const { reason } = c.req.valid("json");
		await escalateConversation(id, staff.opsUserId, reason);
		return c.json({ ok: true });
	},
);

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/canned-replies",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			query: z.object({ scope: z.string().optional() }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.array(cannedReplySchema) } },
				description: "Canned replies visible to this staff member",
			},
		},
	}),
	async (c) => {
		const { scope } = c.req.valid("query");
		return c.json(await listCannedReplies(scope ?? null));
	},
);

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/canned-replies",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: {
			body: { content: { "application/json": { schema: upsertCannedReplySchema } }, required: true },
		},
		responses: {
			201: {
				content: { "application/json": { schema: cannedReplySchema } },
				description: "Canned reply created",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const row = await createCannedReply(body);
		return c.json(row, 201);
	},
);

chatRouter.openapi(
	createRoute({
		method: "delete",
		path: "/canned-replies/{id}",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		request: { params: idParams },
		responses: { 204: { description: "Deleted" } },
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await deleteCannedReply(id);
		return c.body(null, 204);
	},
);

const deskStatsSchema = z.object({
	open: z.number().int(),
	waitingOnClient: z.number().int(),
	unclaimed: z.number().int(),
	breaching: z.number().int(),
	medianFirstResponseMinutes: z.number().nullable(),
	medianResolutionHours: z.number().nullable(),
	csatAvg: z.number().nullable(),
	settings: z.object({
		hoursLabel: z.string(),
		firstResponseMinutes: z.number(),
		resolutionHours: z.number(),
		daysOpen: z.array(z.number()),
		openMinutes: z.number(),
		closeMinutes: z.number(),
		timezone: z.string(),
		autoAssignMinutes: z.number(),
	}),
});

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/desk/stats",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireAnyModule("chat", "helpdesk")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: deskStatsSchema } },
				description: "Helpdesk queue statistics + SLA settings",
			},
		},
	}),
	async (c) => {
		return c.json(await deskStats());
	},
);
