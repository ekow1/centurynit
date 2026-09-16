import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
	MessageList,
	Composer,
	ForwardDialog,
	ensureChatUiStyles,
	type MessageActionsConfig,
} from "century-nit-chat-ui";
import { roleCanAccess, type ChatMessage, type QuotedMessage } from "century-nit-shared";
import {
	useChatConversations,
	useChatMessages,
	useCreateConversation,
} from "../hooks/useChatApi";
import {
	getChatMessages,
	getCommunicationStaffDirectory,
	type ChatConversation,
	type StaffDirectoryEntryDetailed,
} from "../lib/api";
import { useOpsAuth, type OpsRole } from "./OpsAuthContext";

const PRESENCE_COLOR: Record<string, string> = {
	available: "#18181b",
	busy: "#71717a",
	on_leave: "#a1a1aa",
	offline: "#e4e4e7",
};

function formatConvTime(dateStr?: string) {
	if (!dateStr) return "";
	const date = new Date(dateStr);
	const now = new Date();
	const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
	if (diffDays === 0) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
	return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Full-page staff chat — every `chat.*` notification deep-links here via ?conversation=. */
export function ChatPage() {
	ensureChatUiStyles();
	const { opsRole, opsUser } = useOpsAuth();
	const [searchParams, setSearchParams] = useSearchParams();
	const activeConvId = searchParams.get("conversation");

	const canChat = opsRole ? roleCanAccess(opsRole as OpsRole, "chat") : false;
	const { conversations, loading: convsLoading, refresh: refreshConvs } = useChatConversations(canChat);
	const {
		messages, hasMore, loading: msgsLoading, sending, typing,
		load, loadMore, send, edit, delete: deleteMessage, react, forward, signalTyping, markRead,
	} = useChatMessages(activeConvId);

	const { create, creating } = useCreateConversation();

	const [directory, setDirectory] = useState<StaffDirectoryEntryDetailed[]>([]);
	const [draft, setDraft] = useState("");
	const [replyTo, setReplyTo] = useState<QuotedMessage | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [threadSearch, setThreadSearch] = useState("");
	const [threadMatches, setThreadMatches] = useState<ChatMessage[] | null>(null);
	const [showDirectory, setShowDirectory] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isTypingRef = useRef(false);

	const loadDirectory = useCallback(() => {
		getCommunicationStaffDirectory()
			.then((res) => setDirectory(Array.isArray(res?.staff) ? res.staff : []))
			.catch(() => {});
	}, []);

	useEffect(() => {
		loadDirectory();
		const id = setInterval(loadDirectory, 60_000);
		return () => clearInterval(id);
	}, [loadDirectory]);

	const openConversation = useCallback(
		(id: string) => {
			setSearchParams({ conversation: id });
			setReplyTo(null);
			setEditingId(null);
			setDraft("");
			setThreadSearch("");
			setThreadMatches(null);
		},
		[setSearchParams],
	);

	useEffect(() => {
		if (activeConvId) {
			void load();
			void markRead().then(() => refreshConvs());
		}
	}, [activeConvId, load, markRead, refreshConvs]);

	const messageCount = messages.length;
	useEffect(() => {
		if (!activeConvId || messageCount === 0) return;
		if (typeof document !== "undefined" && document.hidden) return;
		void markRead().then(() => refreshConvs());
	}, [activeConvId, messageCount, markRead, refreshConvs]);

	const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

	const filteredConvs = useMemo(() => {
		if (!searchQuery.trim()) return conversations;
		const q = searchQuery.toLowerCase();
		return conversations.filter(
			(c) =>
				c.title.toLowerCase().includes(q) ||
				(c.lastMessage?.content ?? "").toLowerCase().includes(q),
		);
	}, [conversations, searchQuery]);

	/* Server-side message search for the open thread. */
	useEffect(() => {
		if (!activeConvId || !threadSearch.trim()) {
			setThreadMatches(null);
			return;
		}
		const t = setTimeout(() => {
			getChatMessages(activeConvId, { limit: 50, q: threadSearch.trim() })
				.then((res) => setThreadMatches(res.messages))
				.catch(() => setThreadMatches([]));
		}, 300);
		return () => clearTimeout(t);
	}, [activeConvId, threadSearch]);

	const isOwn = useCallback(
		(m: ChatMessage) => m.senderOpsUserId != null && m.senderOpsUserId === opsUser?.opsUserId,
		[opsUser?.opsUserId],
	);

	const showAuthor = useCallback(
		(m: ChatMessage) => {
			if (!activeConv) return false;
			return (activeConv.type === "group" || activeConv.type === "entity") && !isOwn(m);
		},
		[activeConv, isOwn],
	);

	const presenceFor = useCallback(
		(conv: ChatConversation) => {
			// DM conversations take the other participant's name as their title.
			if (conv.type !== "direct") return null;
			return staffPresenceFromTitle(directory, conv.title);
		},
		[directory],
	);

	const actionsConfig = useMemo<MessageActionsConfig>(
		() => ({ reply: true, react: true, forward: true, copy: true, edit: true, delete: true, more: false }),
		[],
	);

	const bubbleProps = useMemo(
		() => ({
			actions: actionsConfig,
			onReply: (m: ChatMessage) => {
				if (m.deletedAt) return;
				setReplyTo({ id: m.id, senderName: m.senderName, content: m.content, deleted: false });
				setEditingId(null);
			},
			onForward: (m: ChatMessage) => setForwardTarget(m),
			onEdit: (m: ChatMessage) => {
				if (!isOwn(m) || m.deletedAt) return;
				setEditingId(m.id);
				setDraft(m.content);
				setReplyTo(null);
			},
			onDelete: (m: ChatMessage) => {
				if (!isOwn(m)) return;
				void deleteMessage(m.id);
			},
			onReact: (m: ChatMessage, emoji: string) => void react(m.id, emoji),
			onQuoteClick: (messageId: string) => {
				const el = document.getElementById(`msg-${messageId}`);
				if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
			},
		}),
		[actionsConfig, isOwn, deleteMessage, react],
	);

	const handleSend = useCallback(
		async (text: string) => {
			if (!activeConvId || !text.trim()) return;
			try {
				if (editingId) {
					await edit(editingId, text);
					setEditingId(null);
				} else {
					await send(text, { replyToId: replyTo?.id });
					setReplyTo(null);
				}
				setDraft("");
				void refreshConvs();
				if (isTypingRef.current) {
					isTypingRef.current = false;
					void signalTyping(false);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to send message");
			}
		},
		[activeConvId, editingId, replyTo, send, edit, refreshConvs, signalTyping],
	);

	const handleTyping = useCallback(() => {
		if (!activeConvId) return;
		if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
		if (!isTypingRef.current) {
			isTypingRef.current = true;
			void signalTyping(true);
		}
		typingTimerRef.current = setTimeout(() => {
			isTypingRef.current = false;
			void signalTyping(false);
		}, 2500);
	}, [activeConvId, signalTyping]);

	const startDM = useCallback(
		async (entry: StaffDirectoryEntryDetailed) => {
			const conv = await create({ participantOpsUserId: entry.opsUserId });
			if (conv) {
				openConversation(conv.id);
				setShowDirectory(false);
				void refreshConvs();
			}
		},
		[create, openConversation, refreshConvs],
	);

	const displayedMessages = threadMatches ?? messages;

	return (
		<div className="hd-page">
			<div className="admin-section-head">
				<div>
					<h1>Chat</h1>
					<p className="admin-section-sub">
						Direct messages, team threads and case conversations.
					</p>
				</div>
				<button
					type="button"
					className="btn btn--primary"
					onClick={() => setShowDirectory((v) => !v)}
					disabled={creating}
				>
					+ New chat
				</button>
			</div>
			{error && <div className="banner banner--error">{error}</div>}

			<div className="hd-split" style={{ alignItems: "stretch" }}>
				{/* ── Conversation list ── */}
				<aside className="hd-list">
					<div className="hd-list__head">
						<input
							className="input"
							placeholder="Search conversations…"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
					<div className="hd-list__body">
						{showDirectory && (
							<>
								<div className="chat-page__section">Start new chat</div>
								{directory
									.filter((s) => s.email !== opsUser?.email)
									.map((s) => (
										<button
											key={s.opsUserId}
											type="button"
											className="hd-row"
											onClick={() => void startDM(s)}
										>
											<div className="hd-row__top">
												<span className="hd-row__title">{s.name}</span>
												<span
													className="chat-page__presence"
													style={{ background: PRESENCE_COLOR[s.presence] ?? PRESENCE_COLOR.offline }}
													title={s.presence.replace("_", " ")}
												/>
											</div>
											<div className="hd-row__meta">
												{s.role.toUpperCase()} · {(s.branch || "HQ").toUpperCase()}
											</div>
										</button>
									))}
								<div className="chat-page__section">Recent</div>
							</>
						)}
						{convsLoading && conversations.length === 0 ? (
							<div className="hd-empty">Loading…</div>
						) : filteredConvs.length === 0 ? (
							<div className="hd-empty">No conversations yet.</div>
						) : (
							filteredConvs.map((c) => {
								const presence = presenceFor(c);
								return (
									<button
										key={c.id}
										type="button"
										className={`hd-row${c.id === activeConvId ? " hd-row--active" : ""}`}
										onClick={() => openConversation(c.id)}
									>
										<div className="hd-row__top">
											<span className="hd-row__title">
												{presence && (
													<span
														className="chat-page__presence"
														style={{ background: PRESENCE_COLOR[presence] ?? PRESENCE_COLOR.offline }}
														title={presence.replace("_", " ")}
													/>
												)}
												{c.title}
											</span>
											<span className="hd-row__ref">{formatConvTime(c.lastMessageAt ?? c.updatedAt)}</span>
										</div>
										<div className="hd-row__meta">
											{(c.lastMessage?.content ?? "No messages yet").slice(0, 60)}
										</div>
										<div className="hd-row__foot">
											<span className="hd-row__ref">{c.type.toUpperCase()}</span>
											{c.unreadCount > 0 && <span className="hd-row__unread">{c.unreadCount}</span>}
										</div>
									</button>
								);
							})
						)}
					</div>
				</aside>

				{/* ── Thread ── */}
				<section className="hd-detail">
					{!activeConvId ? (
						<div className="hd-placeholder">
							<p>Select a conversation, or start a new one.</p>
						</div>
					) : (
						<>
							<div className="hd-head">
								<div style={{ minWidth: 0, flex: 1 }}>
									<h2 style={{ margin: 0 }}>{activeConv?.title ?? "Conversation"}</h2>
									<div className="hd-row__meta" style={{ marginTop: 2 }}>
										{activeConv?.participants.map((p) => p.name).join(", ")}
										{activeConv?.linkedEntityType && ` · ${activeConv.linkedEntityType.toUpperCase()}`}
									</div>
								</div>
								<input
									className="input"
									style={{ width: 180 }}
									placeholder="Search in thread…"
									value={threadSearch}
									onChange={(e) => setThreadSearch(e.target.value)}
								/>
								<button type="button" className="btn" onClick={() => setSearchParams({})}>
									← List
								</button>
							</div>

							{threadMatches && (
								<div className="banner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
									<span>{threadMatches.length} match{threadMatches.length === 1 ? "" : "es"} for “{threadSearch}”</span>
									<button type="button" className="btn" onClick={() => { setThreadSearch(""); setThreadMatches(null); }}>
										Clear
									</button>
								</div>
							)}

							<div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
								<MessageList
									messages={displayedMessages}
									typing={typing}
									isOwn={isOwn}
									showAuthor={showAuthor}
									bubbleProps={bubbleProps}
									header={
										hasMore && !threadMatches ? (
											<button type="button" className="btn" onClick={() => void loadMore()}>
												Load earlier
											</button>
										) : msgsLoading && messages.length === 0 ? (
											<div className="hd-empty">Loading…</div>
										) : null
									}
								/>
							</div>

							<Composer
								value={draft}
								onChange={setDraft}
								onSend={handleSend}
								sending={sending}
								replyTo={replyTo}
								onCancelReply={() => setReplyTo(null)}
								editing={!!editingId}
								onCancelEdit={() => { setEditingId(null); setDraft(""); }}
								onTyping={handleTyping}
								placeholder={
									editingId
										? "Edit message…"
										: replyTo
											? `Reply to ${replyTo.senderName}…`
											: "Type a message…"
								}
							/>
						</>
					)}
				</section>
			</div>

			{forwardTarget && (
				<ForwardDialog
					conversations={conversations.filter((c) => c.id !== activeConvId)}
					onConfirm={(ids) => {
						void forward(forwardTarget.id, ids);
						setForwardTarget(null);
					}}
					onClose={() => setForwardTarget(null)}
				/>
			)}
		</div>
	);
}

function staffPresenceFromTitle(
	directory: StaffDirectoryEntryDetailed[],
	title: string,
): string | null {
	const match = directory.find((s) => s.name.toLowerCase() === title.toLowerCase());
	return match?.presence ?? null;
}
