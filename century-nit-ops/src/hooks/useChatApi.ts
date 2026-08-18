import { useCallback, useEffect, useRef, useState } from "react";
import {
	listChatConversations,
	createChatConversation,
	getChatConversation,
	getChatMessages,
	sendChatMessage,
	markChatConversationRead,
	getChatUnread,
	getStaffDirectory,
	type ChatConversation,
	type ChatMessage,
	type ChatMessageListResponse,
	type StaffDirectoryEntry,
} from "../lib/api";

const POLL_INTERVAL = 30_000;

/* ── Conversation list hook ─────────────────────────────────────────────── */

export function useChatConversations() {
	const [conversations, setConversations] = useState<ChatConversation[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const res = await listChatConversations();
			setConversations(res.conversations);
			setError(null);
		} catch (e: any) {
			setError(e.message ?? "Failed to load conversations");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
		const timer = setInterval(refresh, POLL_INTERVAL);
		return () => clearInterval(timer);
	}, [refresh]);

	return { conversations, loading, error, refresh };
}

/* ── Unread counts hook ─────────────────────────────────────────────────── */

export function useChatUnread() {
	const [unread, setUnread] = useState({ totalUnread: 0, conversations: [] as { conversationId: string; unreadCount: number }[] });

	const refresh = useCallback(async () => {
		try {
			setUnread(await getChatUnread());
		} catch {
			// silent — non-critical
		}
	}, []);

	useEffect(() => {
		refresh();
		const timer = setInterval(refresh, POLL_INTERVAL);
		return () => clearInterval(timer);
	}, [refresh]);

	return { unread, refresh };
}

/* ── Single conversation messages hook ──────────────────────────────────── */

export function useChatMessages(conversationId: string | null) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

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
		async (content: string, replyToId?: string, mentions?: string[]) => {
			if (!conversationId || !content.trim()) return;
			setSending(true);
			try {
				const msg = await sendChatMessage(conversationId, { content, replyToId, mentions });
				setMessages((prev) => [...prev, msg]);
				return msg;
			} finally {
				setSending(false);
			}
		},
		[conversationId],
	);

	const markRead = useCallback(async () => {
		if (!conversationId) return;
		try {
			await markChatConversationRead(conversationId);
		} catch {
			// silent
		}
	}, [conversationId]);

	// Poll for new messages
	useEffect(() => {
		if (!conversationId) return;
		load();
		const timer = setInterval(load, POLL_INTERVAL);
		return () => {
			clearInterval(timer);
			abortRef.current?.abort();
		};
	}, [conversationId, load]);

	return { messages, hasMore, loading, sending, load, loadMore, send, markRead };
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
