import { useCallback, useEffect, useRef, useState } from "react";
import { meApi } from "century-nit-core";
import type { ChatMessage } from "century-nit-shared";
import { useChatStream } from "./useChatStream";

/**
 * Applicant-facing chat hook — loads the conversation with the assigned
 * consultant, sends messages, and subscribes to real-time SSE updates so
 * the thread updates instantly without polling.
 *
 * The backend doesn't yet expose edit/delete/react/forward/typing endpoints
 * for applicants — those actions are staff-only for now. The hook exposes
 * `send` and `markRead`; the shared `MessageList` renders with a reduced
 * action set (reply + copy only) for applicant messages.
 */

interface ApplicantChatState {
	conversationId: string | null;
	consultantName: string | null;
	messages: ChatMessage[];
	loading: boolean;
	sending: boolean;
	typing: { name?: string } | null;
	send: (content: string) => Promise<void>;
	markRead: () => Promise<void>;
}

export function useApplicantChat(enabled: boolean): ApplicantChatState {
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [consultantName, setConsultantName] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const [typing, setTyping] = useState<{ name?: string } | null>(null);
	const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Load (or create) the conversation and its first page of messages.
	const load = useCallback(async () => {
		if (!enabled) return;
		setLoading(true);
		try {
			const conv = await meApi.getConversation();
			setConversationId(conv.id);
			setConsultantName(conv.consultantName);
			const res = await meApi.getConversationMessages({ limit: 50 });
			setMessages(res.messages as unknown as ChatMessage[]);
		} catch {
			// keep local values — the conversation may not exist yet
		} finally {
			setLoading(false);
		}
	}, [enabled]);

	useEffect(() => {
		if (enabled) void load();
	}, [enabled, load]);

	// Send a message. The server returns the created message; we append it
	// locally so the bubble appears instantly without waiting for SSE.
	const send = useCallback(async (content: string) => {
		if (!content.trim()) return;
		setSending(true);
		try {
			const msg = await meApi.sendConversationMessage(content);
			setMessages((prev) => {
				if (prev.some((m) => m.id === msg.id)) return prev;
				return [...prev, msg as unknown as ChatMessage];
			});
		} finally {
			setSending(false);
		}
	}, []);

	const markRead = useCallback(async () => {
		// The applicant's conversation is auto-marked-read on fetch via the
		// server's `getApplicantMessages` path. No explicit call needed yet.
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
	}, [conversationId]));

	// Clear typing indicator when switching conversations.
	useEffect(() => {
		setTyping(null);
	}, [conversationId]);

	return {
		conversationId,
		consultantName,
		messages,
		loading,
		sending,
		typing,
		send,
		markRead,
	};
}
