import { useCallback, useEffect, useRef, useState } from "react";
import {
	listChatConversations,
	createChatConversation,
	getChatMessages,
	sendChatMessage,
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

	// SSE: a new conversation was created (by us or someone else) — reload.
	useChatStream(useCallback((ev) => {
		if (!enabled) return;
		if (ev.type === "chat.conversation.created") void refresh();
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

	// Load on open, then rely on SSE for live updates — no polling.
	useEffect(() => {
		if (!conversationId) return;
		load();
		return () => {
			abortRef.current?.abort();
		};
	}, [conversationId, load]);

	// SSE: append incoming messages for this conversation in real time.
	useChatStream(useCallback((ev) => {
		if (ev.type !== "chat.message") return;
		if (ev.conversationId !== conversationId) return;
		setMessages((prev) => {
			if (prev.some((m) => m.id === ev.message.id)) return prev;
			return [...prev, ev.message];
		});
	}, [conversationId]));

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
