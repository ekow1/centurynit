import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
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
} from "century-nit-shared";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
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
} from "../services/chat.js";

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

export const chatRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── GET /api/v1/chat/conversations ─────────────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversations",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: chatConversationListSchema } },
				description: "Staff member's conversations",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const list = await listConversations(staff.opsUserId, staff.role);
		return c.json(list);
	},
);

/* ── POST /api/v1/chat/conversations ────────────────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		const conv = await getConversation(id, staff.opsUserId);
		return c.json(conv);
	},
);

/* ── GET /api/v1/chat/conversations/:id/messages ────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversations/{id}/messages",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
		request: {
			params: idParams,
			query: z.object({
				limit: z.coerce.number().int().min(1).max(100).optional(),
				before: z.string().uuid().optional(),
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
		const list = await getMessages(id, staff.opsUserId, query);
		return c.json(list);
	},
);

/* ── POST /api/v1/chat/conversations/:id/messages ───────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/messages",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		const msg = await sendMessage(id, { id: staff.opsUserId, name: staff.name, email: staff.email }, body);
		return c.json(msg, 201);
	},
);

/* ── POST /api/v1/chat/conversations/:id/read ───────────────────────────── */

chatRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/read",
		tags: ["Chat"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
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
