import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { useOpsAuth, type OpsRole } from "./OpsAuthContext";
import {
	useChatConversations,
	useChatMessages,
} from "../hooks/useChatApi";
import { roleCanAccess, type ChatConversation, type ChatMessage, type QuotedMessage } from "century-nit-shared";
import {
	ensureChatUiStyles,
	MessageList,
	Composer,
	type MessageActionsConfig,
} from "century-nit-chat-ui";

/**
 * Helpdesk — client conversation queue.
 *
 * Client requests (support / case / stage / applicant conversations) raised
 * from the portal land in the same chat system the OPS console uses for
 * messaging, so there is one thread model platform-wide — no separate ticket
 * store. This page is the triage surface: every client-facing conversation,
 * unread-first, with inline replying via the shared MessageList + Composer.
 *
 * Evolution note: the previous helpdesk ran on a dedicated `tickets` table
 * with its own lifecycle (status, priority, assignment). Those concepts are
 * gone — the conversation itself is the request, its read state is the
 * triage signal, and the portal's communication context is the customer's
 * view. Staff-to-staff chatter lives in the OPS Chat hub, not here.
 */

const CLIENT_TYPES = new Set(["applicant", "support", "case", "stage", "entity"]);

const TYPE_LABELS: Record<string, string> = {
	support: "Support",
	case: "Case",
	stage: "Stage",
	applicant: "Applicant",
	entity: "Conversation",
};

type Filter = "all" | "unread" | "awaiting";

export function EnterpriseHelpdesk() {
	const { opsUser, opsRole } = useOpsAuth();
	const [searchParams] = useSearchParams();
	const canChat = roleCanAccess(opsRole as OpsRole, "chat");

	// The conversation id is the URL's source of truth, so /helpdesk?id=… deep
	// links (e.g. from the Team Assignments board) open a thread directly.
	const activeConvId = searchParams.get("id") || null;

	const { conversations, loading: convsLoading, refresh: refreshConvs } = useChatConversations(canChat);
	const [filter, setFilter] = useState<Filter>("all");
	const [search, setSearch] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [replyTo, setReplyTo] = useState<QuotedMessage | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isTypingRef = useRef(false);

	const {
		messages,
		hasMore,
		loading: msgsLoading,
		sending,
		typing,
		load,
		loadMore,
		send,
		edit,
		delete: deleteMessage,
		react,
		signalTyping,
		markRead,
	} = useChatMessages(activeConvId);

	/* ── Client-facing queue ── */
	const queue = useMemo(() => {
		if (!Array.isArray(conversations)) return [];
		return conversations
			.filter((c) => c && CLIENT_TYPES.has(c.type))
			.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
	}, [conversations]);

	const stats = useMemo(() => {
		const open = queue.filter((c) => c.status !== "closed" && c.status !== "archived").length;
		const unread = queue.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
		const awaiting = queue.filter((c) => (c.unreadCount || 0) > 0).length;
		return { open, unread, awaiting };
	}, [queue]);

	const filtered = useMemo(() => {
		let list = queue;
		if (filter === "unread") list = list.filter((c) => (c.unreadCount || 0) > 0);
		if (filter === "awaiting") list = list.filter((c) => (c.unreadCount || 0) > 0);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(c) =>
					c.title.toLowerCase().includes(q) ||
					(c.lastMessage?.content ?? "").toLowerCase().includes(q) ||
					c.participants.some((p) => p.name.toLowerCase().includes(q)),
			);
		}
		return list;
	}, [queue, filter, search]);

	const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
	const activeInQueue = activeConv && CLIENT_TYPES.has(activeConv.type);

	const isOwn = useCallback(
		(m: ChatMessage) => m.senderOpsUserId != null && m.senderOpsUserId === opsUser?.opsUserId,
		[opsUser?.opsUserId],
	);

	const actionsConfig = useMemo<MessageActionsConfig>(() => ({
		reply: true,
		react: true,
		copy: true,
		edit: true,
		delete: true,
		forward: false,
		more: false,
	}), []);

	const bubbleCallbacks = useMemo(() => ({
		actions: actionsConfig,
		onReply: (m: ChatMessage) => {
			if (m.deletedAt) return;
			setReplyTo({
				id: m.id,
				senderName: m.senderName,
				content: m.content,
				deleted: m.deletedAt !== null && m.deletedAt !== undefined,
			});
			setEditingId(null);
		},
		onEdit: (m: ChatMessage) => {
			if (m.deletedAt || !isOwn(m)) return;
			setEditingId(m.id);
			setDraft(m.content);
			setReplyTo(null);
		},
		onDelete: (m: ChatMessage) => {
			if (m.deletedAt || !isOwn(m)) return;
			void deleteMessage(m.id);
		},
	}), [actionsConfig, isOwn, deleteMessage]);

	/* ── Open conversation: reset composer state, then load + mark read ── */
	const openConversation = useCallback((conv: ChatConversation) => {
		setReplyTo(null);
		setEditingId(null);
		setDraft("");
		window.history.replaceState(null, "", `/helpdesk?id=${conv.id}`);
	}, []);

	useEffect(() => {
		if (activeConvId) {
			void load();
			void markRead().then(() => refreshConvs());
		}
	}, [activeConvId, load, markRead, refreshConvs]);

	// Keep the badge clear on the thread the user is actively reading.
	const messageCount = messages.length;
	useEffect(() => {
		if (!activeConvId || !activeInQueue || messageCount === 0) return;
		if (typeof document !== "undefined" && document.hidden) return;
		void markRead().then(() => refreshConvs());
	}, [activeConvId, activeInQueue, messageCount, markRead, refreshConvs]);

	/* ── Send / edit / typing ── */
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

	return (
		<div className="page-content fade-in hd-page">
			<div className="admin-section-head" style={{ marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Helpdesk</h1>
					<p className="lead mt-1">
						Client requests from the portal — one shared conversation thread per request.
					</p>
				</div>
			</div>

			{!canChat ? (
				<p className="muted mt-2" style={{ color: "var(--error, #b00)" }}>
					This role can&apos;t access the client conversation queue.
				</p>
			) : (
				<>
					{error && (
						<p className="muted mt-2" style={{ color: "var(--error, #b00)" }}>{error}</p>
					)}

					<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
						<HdStat label="Active requests" value={stats.open} note="Open client conversations" />
						<HdStat label="Unread" value={stats.unread} note="Messages not yet read" accent={stats.unread > 0} />
						<HdStat label="Awaiting reply" value={stats.awaiting} note="Need your response" inverted={stats.awaiting > 0} />
					</div>

					<div className="ops-split hd-split">
						{/* Queue list */}
						<div className="ops-split__list hd-list">
							<div className="hd-list__head">
								<input
									type="search"
									className="input input--sm"
									placeholder="Search request, client…"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									style={{ width: "100%" }}
								/>
								<div className="admin-env-tabs" style={{ marginTop: "0.5rem" }}>
									{(["all", "awaiting", "unread"] as const).map((f) => (
										<button
											key={f}
											className={`admin-env-tab${filter === f ? " admin-env-tab--active" : ""}`}
											onClick={() => setFilter(f)}
										>
											{f === "all" ? "All" : f === "awaiting" ? "Awaiting" : "Unread"}
										</button>
									))}
								</div>
							</div>

							<div className="hd-list__body">
								{convsLoading ? (
									<p className="muted hd-empty">Loading conversations…</p>
								) : filtered.length === 0 ? (
									<p className="muted hd-empty">No client requests match.</p>
								) : (
									filtered.map((c) => (
										<button
											key={c.id}
											className={`hd-row${activeConvId === c.id ? " hd-row--active" : ""}`}
											onClick={() => openConversation(c)}
										>
											<span className="hd-row__top">
												<span className="hd-row__ref mono">{TYPE_LABELS[c.type] ?? c.type}</span>
												{c.unreadCount > 0 ? (
													<span className="hd-row__unread mono">{c.unreadCount}</span>
												) : null}
											</span>
											<span className="hd-row__title">{c.title || "Conversation"}</span>
											<span className="hd-row__meta mono">
												{c.lastMessage
													? `${c.lastMessage.senderName}: ${c.lastMessage.content}`
													: c.participants.map((p) => p.name).join(", ")}
											</span>
											<span className="hd-row__foot">
												<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
													{convTime(c.updatedAt)}
												</span>
												<span className="hd-row__owner mono">
													{c.status !== "open" ? c.status : ""}
												</span>
											</span>
										</button>
									))
								)}
							</div>
						</div>

						{/* Thread */}
						<div className="ops-split__detail hd-detail">
							{!activeConv || !activeInQueue ? (
								<div className="hd-placeholder">
									<p className="muted">Select a client request to read the thread and reply.</p>
								</div>
							) : (
								<ConversationThread
									conversation={activeConv}
									messages={messages}
									hasMore={hasMore}
									msgsLoading={msgsLoading}
									sending={sending}
									typing={typing}
									draft={draft}
									replyTo={replyTo}
									editingId={editingId}
									isOwn={isOwn}
									bubbleCallbacks={bubbleCallbacks}
									onDraftChange={setDraft}
									onSend={handleSend}
									onTyping={handleTyping}
									onCancelReply={() => setReplyTo(null)}
									onCancelEdit={() => setEditingId(null)}
									onLoadMore={loadMore}
									onBack={() => {
										window.history.replaceState(null, "", "/helpdesk");
									}}
									onReact={(messageId, emoji) => void react(messageId, emoji)}
									onQuoteClick={() => {/* quote reaction handled by chat-ui */}}
								/>
							)}
						</div>
					</div>
				</>
			)}
		</div>
	);
}

/* ── Conversation Thread (shared chat-ui components) ────────────────────── */

interface ConversationThreadProps {
	conversation: ChatConversation;
	messages: ChatMessage[];
	hasMore: boolean;
	msgsLoading: boolean;
	sending: boolean;
	typing: { name?: string } | null;
	draft: string;
	replyTo: QuotedMessage | null;
	editingId: string | null;
	isOwn: (m: ChatMessage) => boolean;
	bubbleCallbacks: {
		actions: MessageActionsConfig;
		onReply: (m: ChatMessage) => void;
		onEdit: (m: ChatMessage) => void;
		onDelete: (m: ChatMessage) => void;
	};
	onDraftChange: (v: string) => void;
	onSend: (text: string) => void;
	onTyping: () => void;
	onCancelReply: () => void;
	onCancelEdit: () => void;
	onLoadMore: () => void;
	onBack: () => void;
	onReact: (messageId: string, emoji: string) => void;
	onQuoteClick: (messageId: string) => void;
}

function ConversationThread({
	conversation,
	messages,
	hasMore,
	msgsLoading,
	sending,
	typing,
	draft,
	replyTo,
	editingId,
	isOwn,
	bubbleCallbacks,
	onDraftChange,
	onSend,
	onTyping,
	onCancelReply,
	onCancelEdit,
	onLoadMore,
	onBack,
	onReact,
	onQuoteClick,
}: ConversationThreadProps) {
	ensureChatUiStyles();

	const showAuthor = useCallback(
		(m: ChatMessage) => {
			const isGroup = conversation.type === "group" || conversation.type === "entity";
			return isGroup && !isOwn(m);
		},
		[conversation, isOwn],
	);

	const bubbleProps = useMemo(() => ({
		actions: bubbleCallbacks.actions,
		onReply: bubbleCallbacks.onReply,
		onEdit: bubbleCallbacks.onEdit,
		onDelete: bubbleCallbacks.onDelete,
		onQuoteClick,
		onReact: (message: ChatMessage, emoji: string) => onReact(message.id, emoji),
	}), [bubbleCallbacks, onQuoteClick, onReact]);

	return (
		<div style={streamContainerStyle}>
			<div style={threadHeaderStyle}>
				<button
					type="button"
					onClick={onBack}
					style={backBtnStyle}
					aria-label="Back to conversations"
				>
					←
				</button>
				<div style={{ minWidth: 0, flex: 1 }}>
					<div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
						{conversation.title ?? "Conversation"}
					</div>
					<div style={{ fontSize: 10, color: "#52525b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
						{conversation.participants.map((p) => p.name).join(", ")}
					</div>
				</div>
				{conversation.linkedEntityType && (
					<span style={stagePillMiniStyle}>
						{conversation.linkedEntityType.toUpperCase()}
					</span>
				)}
			</div>

			<MessageList
				messages={messages}
				typing={typing}
				isOwn={isOwn}
				showAuthor={showAuthor}
				bubbleProps={bubbleProps}
				onQuoteClick={onQuoteClick}
				header={
					hasMore ? (
						<button
							type="button"
							onClick={onLoadMore}
							style={{
								display: "block",
								margin: "0 auto 12px",
								padding: "4px 12px",
								background: "transparent",
								border: "1px solid var(--cn-chat-border)",
								borderRadius: "var(--cn-chat-radius-pill)",
								fontSize: 10,
								cursor: "pointer",
								fontFamily: "var(--cn-chat-font-mono)",
								color: "var(--cn-chat-muted-fg)",
							}}
						>
							LOAD EARLIER
						</button>
					) : msgsLoading && messages.length === 0 ? (
						<div style={{ textAlign: "center", color: "var(--cn-chat-muted-fg)", fontSize: 12, padding: 16 }}>
							Loading messages...
						</div>
					) : null
				}
			/>

			<Composer
				value={draft}
				onChange={onDraftChange}
				onSend={onSend}
				sending={sending}
				replyTo={replyTo}
				onCancelReply={onCancelReply}
				editing={!!editingId}
				onCancelEdit={onCancelEdit}
				onTyping={onTyping}
				placeholder={editingId ? "Edit message…" : replyTo ? `Reply to ${replyTo.senderName}…` : "Reply to the client…"}
			/>
		</div>
	);
}

function convTime(iso?: string) {
	if (!iso) return "";
	const date = new Date(iso);
	const now = new Date();
	const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
	if (diffDays === 0) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
	return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function HdStat({
	label,
	value,
	note,
	accent,
	inverted,
}: {
	label: string;
	value: number;
	note: string;
	accent?: boolean;
	inverted?: boolean;
}) {
	return (
		<div
			className="card"
			style={
				inverted
					? { background: "var(--foreground)", color: "var(--background)" }
					: accent
						? { borderColor: "var(--foreground)", borderWidth: "2px" }
						: undefined
			}
		>
			<p className="eyebrow" style={inverted ? { color: "var(--muted)" } : undefined}>
				{label}
			</p>
			<p className="page-title mt-1" style={{ fontSize: "1.75rem", ...(inverted ? { color: "var(--background)" } : {}) }}>
				{value}
			</p>
			<p className="muted mt-1" style={{ fontSize: "var(--text-xs)", ...(inverted ? { color: "var(--muted)" } : {}) }}>
				{note}
			</p>
		</div>
	);
}

const streamContainerStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const threadHeaderStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 10,
	padding: "10px 16px",
	background: "#ffffff",
	borderBottom: "1px solid #f4f4f5",
	flexShrink: 0,
};

const backBtnStyle: CSSProperties = {
	background: "none",
	border: "none",
	cursor: "pointer",
	padding: 0,
	fontSize: 16,
	color: "#18181b",
	flexShrink: 0,
	lineHeight: 1,
};

const stagePillMiniStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	fontWeight: 700,
	color: "#52525b",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	padding: "2px 5px",
	borderRadius: "0px",
	flexShrink: 0,
};