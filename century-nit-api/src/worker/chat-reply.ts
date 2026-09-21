import { Worker } from "bullmq";
import { and, eq, gt } from "drizzle-orm";
import { connection, queueEmail, type ChatReplyCheckJob } from "./queues.js";
import { db } from "../db/index.js";
import { conversationParticipants, conversations, messages, users } from "../db/schema.js";
import { renderBookingEmail } from "../lib/email-templates.js";
import { env } from "../env.js";

/**
 * Client reply-email worker.
 *
 * `notifyOfflineParticipants` covers staff; this is the mirror for clients.
 * A staff reply on a customer-facing thread enqueues a delayed `check` job —
 * by the time it runs, an engaged client has already seen the reply (read
 * cursor advanced past it, or they answered), so the email is skipped. Only a
 * client who never came back gets "X replied" in their inbox.
 */
export const chatReplyEmailWorker = new Worker<ChatReplyCheckJob>(
	"chatReplyEmail",
	async (job) => {
		const { conversationId, messageId } = job.data;

		const [conv] = await db
			.select({ userId: conversations.userId, title: conversations.title })
			.from(conversations)
			.where(eq(conversations.id, conversationId))
			.limit(1);
		if (!conv?.userId) return;

		const [msg] = await db
			.select({
				createdAt: messages.createdAt,
				content: messages.content,
				senderName: messages.senderName,
			})
			.from(messages)
			.where(eq(messages.id, messageId))
			.limit(1);
		if (!msg) return;

		// Seen? The client's read cursor is at or past this message.
		const [part] = await db
			.select({ lastReadAt: conversationParticipants.lastReadAt })
			.from(conversationParticipants)
			.where(
				and(
					eq(conversationParticipants.conversationId, conversationId),
					eq(conversationParticipants.participantUserId, conv.userId),
				),
			)
			.limit(1);
		if (part?.lastReadAt && part.lastReadAt >= msg.createdAt) return;

		// Answered? Any client message after the staff reply also means they saw it.
		const [reply] = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(
					eq(messages.conversationId, conversationId),
					eq(messages.senderUserId, conv.userId),
					gt(messages.createdAt, msg.createdAt),
				),
			)
			.limit(1);
		if (reply) return;

		const [client] = await db
			.select({ email: users.email, name: users.name })
			.from(users)
			.where(eq(users.id, conv.userId))
			.limit(1);
		if (!client?.email) return;

		const preview =
			msg.content.length > 120 ? `${msg.content.slice(0, 120)}...` : msg.content;
		const link = `${env.FRONTEND_URL}/portal/home?chat=${conversationId}`;
		const { html, text } = renderBookingEmail({
			title: `New reply from ${msg.senderName}`,
			lines: [
				`<strong>${msg.senderName}</strong> replied in <strong>${conv.title}</strong>:`,
				`<em>"${preview}"</em>`,
				`<a href="${link}">Open the conversation</a>`,
			],
			reference: link,
		});

		await queueEmail({
			to: client.email,
			subject: `${msg.senderName} replied - Century NIT`,
			html,
			text,
			idempotencyKey: `chat:client-reply:${messageId}`,
			template: "Chat reply",
			reference: conv.title,
		});
	},
	{ connection },
);
