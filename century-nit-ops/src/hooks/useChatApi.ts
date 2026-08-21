import { useCallback, useEffect, useRef, useState } from "react";
import {
	listChatConversations,
	createChatConversation,
	getChatMessages,
	sendChatMessage,
	editChatMessage,
	deleteChatMessage,
	toggleChatReaction,
	forwardChatMessage,
	setChatTyping,
	markChatConversationRead,
	getChatUnread,
	getStaffDirectory,
	type ChatConversation,
	type ChatMessage,
	type StaffDirectoryEntry,
} from "../lib/api";
import { ApiError } from "../lib/api";
import { useChatStream } from "./useChatStream";

/** A 403 means the role can't access chat or MFA isn't enrolled — fetching won't fix it. */
function isForbidden(e: unknown): boolean {
	return e instanceof ApiError && e.status === 403;
}

/* ── Conversation list hook ─────────────────────────────────────────────── */

export function useChatConversations(enabled = true) {
	const [conversations, setConversations] = useState<ChatConversation[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const forbiddenRef = useRef(false);

	const refresh = useCallback(async () => {
		if (forbiddenRef.current) return;
		try {
			const res = await listChatConversations();
			setConversations(res.conversations);
			setError(null);
		} catch (e: any) {
			if (isForbidden(e)) { forbiddenRef.current = true; return; }
			setError(e.message ?? "Failed to load conversations");
		} finally {
			setLoading(false);
		}
	}, []);

	// Initial load only — SSE keeps the list live after that.
	useEffect(() => {
		if (!enabled) { setLoading(false); return; }
		void refresh();
	}, [enabled, refresh]);

	// SSE: a new conversation or an incoming message both change the list
	// (ordering, lastMessage preview, unread badge) — reload on either.
	useChatStream(useCallback((ev) => {
		if (!enabled) return;
		if (ev.type === "chat.conversation.created" || ev.type === "chat.message") void refresh();
	}, [enabled, refresh]));

	return { conversations, loading, error, refresh };
}

/* ── Unread counts hook ─────────────────────────────────────────────────── */

export function useChatUnread(enabled = true) {
	const [unread, setUnread] = useState({ totalUnread: 0, conversations: [] as { conversationId: string; unreadCount: number }[] });
	const forbiddenRef = useRef(false);

	const refresh = useCallback(async () => {
		if (forbiddenRef.current) return;
		try {
			setUnread(await getChatUnread());
		} catch (e) {
			if (isForbidden(e)) { forbiddenRef.current = true; }
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		void refresh();
	}, [enabled, refresh]);

	// SSE: a new message bumps unread for that conversation; a read event
	// clears it. We re-fetch on either rather than mutate locally, because
	// the unread count depends on per-participant lastReadAt on the server.
	useChatStream(useCallback((ev) => {
		if (!enabled) return;
		if (ev.type === "chat.message" || ev.type === "chat.read") void refresh();
	}, [enabled, refresh]));

	return { unread, refresh };
}

/* ── Single conversation messages hook ──────────────────────────────────── */

export function useChatMessages(conversationId: string | null) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const [typing, setTyping] = useState<{ name?: string } | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const load = useCallback(async () => {
		if (!conversationId) return;
		abortRef.current?.abort();
		abortRef.current = new AbortController();
		setLoading(true);
		try {
			const res = await getChatMessages(conversationId, { limit: 50 });
			setMessages(res.messages);
			setHasMore(res.hasMore);
		} catch {
			// ignore aborted
		} finally {
			setLoading(false);
		}
	}, [conversationId]);

	const loadMore = useCallback(async () => {
		if (!conversationId || !hasMore || !messages.length) return;
		const oldest = messages[0];
		try {
			const res = await getChatMessages(conversationId, { limit: 50, before: oldest.id });
			setMessages((prev) => [...res.messages, ...prev]);
			setHasMore(res.hasMore);
		} catch {
			// silent
		}
	}, [conversationId, hasMore, messages]);

	const send = useCallback(
		async (
			content: string,
			opts?: { replyToId?: string; mentions?: string[]; attachmentIds?: string[] },
		) => {
			if (!conversationId || !content.trim()) return;
			setSending(true);
			try {
				const msg = await sendChatMessage(conversationId, {
					content,
					replyToId: opts?.replyToId,
					mentions: opts?.mentions,
					attachmentIds: opts?.attachmentIds,
				});
				setMessages((prev) => {
					if (prev.some((m) => m.id === msg.id)) return prev;
					return [...prev, msg];
				});
				return msg;
			} finally {
				setSending(false);
			}
		},
		[conversationId],
	);

	const edit = useCallback(async (messageId: string, content: string) => {
		if (!content.trim()) return;
		try {
			const updated = await editChatMessage(messageId, { content });
			setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
		} catch {
			// silent — parent can surface errors
		}
	}, []);

	const remove = useCallback(async (messageId: string) => {
		try {
			await deleteChatMessage(messageId);
			// SSE will deliver the updated tombstone; no local mutation needed.
		} catch {
			// silent
		}
	}, []);

	const react = useCallback(async (messageId: string, emoji: string) => {
		try {
			await toggleChatReaction(messageId, emoji);
			// SSE delivers the updated reactions aggregate.
		} catch {
			// silent
		}
	}, []);

	const forward = useCallback(async (messageId: string, targetIds: string[]) => {
		if (targetIds.length === 0) return;
		try {
			await forwardChatMessage(messageId, targetIds);
		} catch {
			// silent
		}
	}, []);

	const signalTyping = useCallback(async (isTyping: boolean) => {
		if (!conversationId) return;
		try {
			await setChatTyping(conversationId, isTyping);
		} catch {
			// silent
		}
	}, [conversationId]);

	const markRead = useCallback(async () => {
		if (!conversationId) return;
		try {
			await markChatConversationRead(conversationId);
		} catch {
			// silent
		}
	}, [conversationId]);

	// Load on open, then rely on SSE for live updates — no polling.
	useEffect(() => {
		if (!conversationId) return;
		load();
		return () => {
			abortRef.current?.abort();
		};
	}, [conversationId, load]);

	// SSE: handle all real-time events for this conversation.
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
					// Auto-clear after 4s — the typing signal is ephemeral and
					// a dropped "stopped" event would otherwise leave dots forever.
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
		messages,
		hasMore,
		loading,
		sending,
		typing,
		load,
		loadMore,
		send,
		edit,
		delete: remove,
		react,
		forward,
		signalTyping,
		markRead,
	};
}

/* ── Staff directory hook (for @mentions) ───────────────────────────────── */

export function useStaffDirectory() {
	const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);

	useEffect(() => {
		getStaffDirectory()
			.then((res) => setStaff(res.staff))
			.catch(() => {});
	}, []);

	return staff;
}

/* ── Create conversation helper ─────────────────────────────────────────── */

export function useCreateConversation() {
	const [creating, setCreating] = useState(false);

	const create = useCallback(
		async (opts: {
			participantOpsUserId?: string;
			linkedEntityType?: string;
			linkedEntityId?: string;
			title?: string;
			participantOpsUserIds?: string[];
			initialMessage?: string;
		}): Promise<ChatConversation | null> => {
			setCreating(true);
			try {
				return await createChatConversation(opts);
			} catch {
				return null;
			} finally {
				setCreating(false);
			}
		},
		[],
	);

	return { create, creating };
}
