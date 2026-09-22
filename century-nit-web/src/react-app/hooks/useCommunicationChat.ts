import { useCallback, useEffect, useRef, useState } from "react";
import { meApi } from "century-nit-core";
import type { ChatMessage } from "century-nit-shared";
import { useChatStream } from "./useChatStream";

/**
 * Context-aware communication chat hook for the portal.
 *
 * The portal's Communication Center routes the applicant to the right
 * conversation (support desk or assigned officer) via `meApi.routeCommunication`,
 * then loads/sends messages via the `/me/communication/*` endpoints.
 *
 * This hook wraps that flow with real-time SSE updates so the thread
 * updates instantly without the 10-second polling loop the old widget used.
 */

interface CommunicationChatState {
	conversationId: string | null;
	conversationStatus: string | null;
	messages: ChatMessage[];
	loading: boolean;
	sending: boolean;
	typing: { name?: string } | null;
	route: (opts?: { caseId?: string; stageKey?: string }) => Promise<string | null>;
	openConversation: (conversationId: string) => Promise<void>;
	send: (content: string, opts?: { attachmentIds?: string[] }) => Promise<void>;
	markRead: () => Promise<void>;
	reset: () => void;
}

export function useCommunicationChat(enabled: boolean): CommunicationChatState {
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [conversationStatus, setConversationStatus] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const [typing, setTyping] = useState<{ name?: string } | null>(null);
	const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Mirror of conversationId that route() sets synchronously. Send() may be
	// called in the same tick as route() (AI handoff escalation) before the
	// state update re-renders, so the closure copy would still be stale/null.
	const conversationIdRef = useRef<string | null>(null);

	// Route to (or create) the right conversation for this context.
	const route = useCallback(async (opts?: { caseId?: string; stageKey?: string }) => {
		if (!enabled) return null;
		setLoading(true);
		try {
			const conv = await meApi.routeCommunication(opts);
			conversationIdRef.current = conv.id;
			setConversationId(conv.id);
			setConversationStatus(conv.status ?? "open");
			const res = await meApi.getCommunicationMessages(conv.id, { limit: 50 });
			setMessages(res.messages.filter((m) => m.messageType !== "system"));
			void meApi.markCommunicationRead(conv.id).catch(() => {});
			return conv.id;
		} catch {
			return null;
		} finally {
			setLoading(false);
		}
	}, [enabled]);

	const reset = useCallback(() => {
		conversationIdRef.current = null;
		setConversationId(null);
		setConversationStatus(null);
		setMessages([]);
		setTyping(null);
	}, []);

	// Open a specific conversation by id - notification deep links
	// (/portal/home?chat=<id>) already know the exact thread, so they bypass
	// route()'s pick. Falls back to routing when the id is stale (archived
	// thread, revoked access) so the widget still lands somewhere useful.
	const openConversation = useCallback(async (convId: string) => {
		if (!enabled) return;
		setLoading(true);
		try {
			const [res, convs] = await Promise.all([
				meApi.getCommunicationMessages(convId, { limit: 50 }),
				meApi.listCommunicationConversations().catch(() => null),
			]);
			conversationIdRef.current = convId;
			setConversationId(convId);
			setConversationStatus(convs?.conversations.find((c) => c.id === convId)?.status ?? "open");
			setMessages(res.messages.filter((m) => m.messageType !== "system"));
			void meApi.markCommunicationRead(convId).catch(() => {});
		} catch {
			conversationIdRef.current = null;
			setConversationId(null);
			await route();
		} finally {
			setLoading(false);
		}
	}, [enabled, route]);

	// Send a message. The server returns the created message; we append it
	// locally so the bubble appears instantly without waiting for SSE.
	const send = useCallback(async (content: string, opts?: { attachmentIds?: string[] }) => {
		const convId = conversationIdRef.current;
		if (!convId || (!content.trim() && !opts?.attachmentIds?.length)) return;
		setSending(true);
		try {
			const msg = await meApi.sendCommunicationMessage(convId, content, { attachmentIds: opts?.attachmentIds });
			setMessages((prev) => {
				if (prev.some((m) => m.id === msg.id)) return prev;
				return [...prev, msg];
			});
		} finally {
			setSending(false);
		}
	}, []);

	const markRead = useCallback(async () => {
		const convId = conversationIdRef.current;
		if (!convId) return;
		await meApi.markCommunicationRead(convId).catch(() => {});
	}, []);

	// SSE: handle real-time events for this conversation.
	useChatStream(useCallback((ev) => {
		switch (ev.type) {
			case "chat.message": {
				if (ev.conversationId !== conversationId) return;
				// System housekeeping rows are filtered from the transcript
				// server-side; skip them on live pushes too so they never flash.
				if (ev.message.messageType === "system") break;
				setMessages((prev) => {
					if (prev.some((m) => m.id === ev.message.id)) return prev;
					return [...prev, ev.message];
				});
				void markRead();
				break;
			}
			case "chat.message.updated": {
				if (ev.conversationId !== conversationId) return;
				setMessages((prev) => prev.map((m) => (m.id === ev.message.id ? ev.message : m)));
				break;
			}
			case "chat.message.deleted": {
				if (ev.conversationId !== conversationId) return;
				setMessages((prev) =>
					prev.map((m) =>
						m.id === ev.messageId
							? {
								...m,
								content: "",
								deletedAt: new Date().toISOString(),
								reactions: [],
								attachments: [],
							}
							: m,
					),
				);
				break;
			}
			case "chat.reaction": {
				if (ev.conversationId !== conversationId) return;
				setMessages((prev) => prev.map((m) => (m.id === ev.messageId ? { ...m, reactions: ev.reactions } : m)));
				break;
			}
			case "chat.typing": {
				if (ev.conversationId !== conversationId) return;
				if (ev.typing) {
					setTyping({ name: ev.actorName });
					if (typingTimer.current) clearTimeout(typingTimer.current);
					typingTimer.current = setTimeout(() => setTyping(null), 4000);
				} else {
					setTyping(null);
				}
				break;
			}
			case "chat.conversation.updated": {
				if (ev.conversationId !== conversationId) return;
				if (ev.status) setConversationStatus(ev.status);
				break;
			}
			default:
				break;
		}
	}, [conversationId, markRead]));

	useEffect(() => {
		setTyping(null);
	}, [conversationId]);

	return {
		conversationId,
		conversationStatus,
		messages,
		loading,
		sending,
		typing,
		route,
		openConversation,
		send,
		markRead,
		reset,
	};
}
