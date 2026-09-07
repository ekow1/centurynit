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
	messages: ChatMessage[];
	loading: boolean;
	sending: boolean;
	typing: { name?: string } | null;
	route: (opts?: { caseId?: string; stageKey?: string }) => Promise<string | null>;
	send: (content: string) => Promise<void>;
	markRead: () => Promise<void>;
	reset: () => void;
}

export function useCommunicationChat(enabled: boolean): CommunicationChatState {
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const [typing, setTyping] = useState<{ name?: string } | null>(null);
	const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Mirror of conversationId that route() sets synchronously — send() may be
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
			const res = await meApi.getCommunicationMessages(conv.id, { limit: 50 });
			setMessages(res.messages);
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
		setMessages([]);
		setTyping(null);
	}, []);

	// Send a message. The server returns the created message; we append it
	// locally so the bubble appears instantly without waiting for SSE.
	const send = useCallback(async (content: string) => {
		const convId = conversationIdRef.current;
		if (!convId || !content.trim()) return;
		setSending(true);
		try {
			const msg = await meApi.sendCommunicationMessage(convId, content);
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
			default:
				break;
		}
	}, [conversationId, markRead]));

	useEffect(() => {
		setTyping(null);
	}, [conversationId]);

	return {
		conversationId,
		messages,
		loading,
		sending,
		typing,
		route,
		send,
		markRead,
		reset,
	};
}
