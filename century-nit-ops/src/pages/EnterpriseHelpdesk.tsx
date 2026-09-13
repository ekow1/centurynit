import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

type Filter = "all" | "awaiting" | "unread" | "mine" | "support" | "case" | "stage" | "applicant";
const CHIPS: { id: Filter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "awaiting", label: "Awaiting reply" },
	{ id: "unread", label: "Unread" },
	{ id: "support", label: "Support" },
	{ id: "case", label: "Case" },
	{ id: "stage", label: "Stage" },
	{ id: "applicant", label: "Applicant" },
	{ id: "mine", label: "Mine" },
];

/** The client wrote last and nobody has answered. */
const awaitingReply = (c: ChatConversation) => Boolean(c.lastMessage?.senderUserId) || (c.unreadCount || 0) > 0;
const isClosed = (c: ChatConversation) => c.status === "closed" || c.status === "archived";
/** How long the client has been waiting, in hours; 0 when not waiting. */
function waitingHours(c: ChatConversation, now: number): number {
	if (!awaitingReply(c) || isClosed(c)) return 0;
	const at = new Date(c.lastMessage?.createdAt ?? c.updatedAt).getTime();
	return Number.isNaN(at) ? 0 : Math.max(0, (now - at) / 3_600_000);
}
const waitLabel = (h: number) => (h < 1 ? "just now" : h < 24 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} d`);
/** The client's name: the last client message's author, else the title (support/applicant threads are titled by the client). */
function clientName(c: ChatConversation): string {
	if (c.lastMessage?.senderUserId) return c.lastMessage.senderName;
	if (c.type === "support" || c.type === "applicant") return c.title || "Client";
	return c.title || "Conversation";
}
/** "Support · APP-2026-0142", "Stage · Consultation" — the thread's subject without opening it. */
function kickerOf(c: ChatConversation): string {
	const type = TYPE_LABELS[c.type] ?? c.type;
	if (c.type === "case" || c.type === "stage") return `${type} · ${c.title}`;
	if (c.linkedEntityType) return `${type} · ${c.linkedEntityType}`;
	return type;
}
function entityLink(c: ChatConversation): { to: string; label: string } | null {
	if (!c.linkedEntityId) return null;
	if (c.linkedEntityType === "application") return { to: `/applications?id=${c.linkedEntityId}`, label: "Open case" };
	if (c.linkedEntityType === "consultation") return { to: `/consultations?id=${c.linkedEntityId}`, label: "Open consultation" };
	return null;
}

export function EnterpriseHelpdesk() {
	const { opsUser, opsRole } = useOpsAuth();
	const [searchParams] = useSearchParams();
	const canChat = roleCanAccess(opsRole as OpsRole, "chat");

	// The conversation id is the URL's source of truth, so /helpdesk?id=… deep
	// links (e.g. from the Team Assignments board) open a thread directly.
	const activeConvId = searchParams.get("id") || null;

	const { conversations, loading: convsLoading, refresh: refreshConvs } = useChatConversations(canChat);
	const [filter, setFilter] = useState<Filter>("all");
	const [showClosed, setShowClosed] = useState(false);
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

	const now = Date.now();
	const isMine = useCallback((c: ChatConversation) => Boolean(opsUser) && c.participants.some((p) => p.opsUserId === opsUser!.opsUserId), [opsUser]);

	const stats = useMemo(() => {
		const open = queue.filter((c) => !isClosed(c));
		const waiting = open.filter(awaitingReply);
		const longest = waiting.reduce((m, c) => Math.max(m, waitingHours(c, now)), 0);
		return {
			open: open.length,
			unread: queue.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
			awaiting: waiting.length,
			longest,
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is this render's clock
	}, [queue]);

	const counts = useMemo<Record<Filter, number>>(() => {
		const open = queue.filter((c) => !isClosed(c));
		return {
			all: open.length,
			awaiting: open.filter(awaitingReply).length,
			unread: open.filter((c) => (c.unreadCount || 0) > 0).length,
			mine: open.filter(isMine).length,
			support: open.filter((c) => c.type === "support").length,
			case: open.filter((c) => c.type === "case").length,
			stage: open.filter((c) => c.type === "stage").length,
			applicant: open.filter((c) => c.type === "applicant").length,
		};
	}, [queue, isMine]);

	const filtered = useMemo(() => {
		let list = queue;
		if (filter === "unread") list = list.filter((c) => (c.unreadCount || 0) > 0);
		else if (filter === "awaiting") list = list.filter(awaitingReply);
		else if (filter === "mine") list = list.filter(isMine);
		else if (filter !== "all") list = list.filter((c) => c.type === filter);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(c) =>
					c.title.toLowerCase().includes(q) ||
					(c.lastMessage?.content ?? "").toLowerCase().includes(q) ||
					(c.lastMessage?.senderName ?? "").toLowerCase().includes(q) ||
					c.participants.some((p) => p.name.toLowerCase().includes(q)),
			);
		}
		return list;
	}, [queue, filter, search, isMine]);

	/** Bands by who owes the next word: waiting on you (longest first), in conversation, closed (folded). */
	const bands = useMemo(() => {
		const waiting = filtered.filter((c) => !isClosed(c) && awaitingReply(c)).sort((a, b) => waitingHours(b, now) - waitingHours(a, now));
		const talking = filtered.filter((c) => !isClosed(c) && !awaitingReply(c));
		const closed = filtered.filter(isClosed);
		return [
			{ id: "waiting", label: "Awaiting your reply", note: "longest wait first", rows: waiting },
			{ id: "talking", label: "In conversation", note: "you replied last", rows: talking },
			{ id: "closed", label: "Closed", note: showClosed ? "hide" : "show ▸", rows: closed },
		].filter((b) => b.rows.length > 0);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is this render's clock
	}, [filtered, showClosed]);

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
					<p className="lead mt-1">Every client conversation, the ones waiting on you first.</p>
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

					<div className="dash-day" style={{ margin: "0 0 1rem" }}>
						<span>
							<strong>{stats.open}</strong> <span className="dash-day__date">open</span>
						</span>
						<span>
							<strong>{stats.awaiting}</strong> <span className="dash-day__date">awaiting your reply</span>
						</span>
						<span>
							<strong>{stats.unread}</strong> <span className="dash-day__date">unread</span>
						</span>
						<span>
							<strong>{stats.longest > 0 ? waitLabel(stats.longest) : "—"}</strong> <span className="dash-day__date">longest wait</span>
						</span>
						<span className="dash-day__sep" aria-hidden>
							|
						</span>
						<Link to="/workspace" className="dash-link">
							Open the Worklist →
						</Link>
					</div>

					<div className="ops-split hd-split">
						{/* Queue list */}
						<div className="ops-split__list hd-list">
							<div className="hd-list__head">
								<div className="cn-scaffold__chips" role="tablist" aria-label="Conversations">
									{CHIPS.map((f) => {
										const n = counts[f.id];
										const on = filter === f.id;
										if (n === 0 && f.id !== "all" && f.id !== "awaiting" && f.id !== "unread" && f.id !== "mine") return null;
										return (
											<button
												key={f.id}
												type="button"
												role="tab"
												aria-selected={on}
												className="ops-pill"
												onClick={() => setFilter(f.id)}
												style={{
													cursor: "pointer",
													marginLeft: 0,
													border: "1px solid var(--border)",
													background: on ? "var(--foreground)" : "transparent",
													color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
													fontWeight: f.id === "awaiting" && n > 0 && !on ? 700 : 500,
												}}
											>
												{f.label}
												<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
													{n}
												</span>
											</button>
										);
									})}
								</div>
								<input
									type="search"
									className="cn-search"
									placeholder="Search client, request…"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									aria-label="Search conversations"
									style={{ marginTop: "0.5rem" }}
								/>
							</div>

							<div className="hd-list__body">
								{convsLoading ? (
									<p className="muted hd-empty">Loading conversations…</p>
								) : bands.length === 0 ? (
									<p className="muted hd-empty">No client requests match.</p>
								) : (
									bands.map((band) => (
										<div key={band.id}>
											<div
												className={`ops-band hd-band${band.id === "closed" ? " ops-band--toggle" : ""}`}
												role={band.id === "closed" ? "button" : undefined}
												tabIndex={band.id === "closed" ? 0 : undefined}
												onClick={band.id === "closed" ? () => setShowClosed((v) => !v) : undefined}
												onKeyDown={
													band.id === "closed"
														? (e) => {
																if (e.key === "Enter" || e.key === " ") {
																	e.preventDefault();
																	setShowClosed((v) => !v);
																}
															}
														: undefined
												}
											>
												<span className="ops-band__name">
													{band.label} · {band.rows.length}
												</span>
												<span className="ops-band__note">{band.note}</span>
											</div>
											{(band.id !== "closed" || showClosed) &&
												band.rows.map((c) => {
													const hours = waitingHours(c, now);
													const link = entityLink(c);
													return (
														<button
															key={c.id}
															type="button"
															className={`hd-row${activeConvId === c.id ? " hd-row--active" : ""}${hours >= 24 ? " hd-row--wait" : ""}`}
															onClick={() => openConversation(c)}
														>
															<span className="hd-row__line">
																<span className="hd-row__main">
																	<span className="hd-row__ref mono">{kickerOf(c)}</span>
																	<span className="hd-row__title">{clientName(c)}</span>
																	<span className="hd-row__meta">
																		{c.lastMessage
																			? `${c.lastMessage.senderUserId ? c.lastMessage.senderName : "You"}: ${c.lastMessage.content}`
																			: link
																				? link.label.replace("Open ", "")
																				: c.participants.map((p) => p.name).join(", ")}
																	</span>
																</span>
																<span className="hd-row__side">
																	<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
																		{convTime(c.lastMessage?.createdAt ?? c.updatedAt)}
																	</span>
																	{c.unreadCount > 0 ? <span className="hd-row__unread mono">{c.unreadCount}</span> : null}
																	{hours > 0 && band.id === "waiting" ? <span className={`hd-row__wait mono${hours >= 24 ? " hd-row__wait--long" : ""}`}>waiting {waitLabel(hours)}</span> : null}
																	{isClosed(c) ? <span className="hd-row__owner mono">{c.status}</span> : null}
																</span>
															</span>
														</button>
													);
												})}
										</div>
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
					<div className="cn-detailhead__kicker" style={{ marginBottom: 0 }}>{kickerOf(conversation)}</div>
					<div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clientName(conversation)}</div>
					<div style={{ fontSize: 10, color: "#52525b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
						{conversation.participants.length > 0 ? `with ${conversation.participants.map((p) => p.name).join(", ")}` : ""}
						{conversation.status !== "open" ? ` · ${conversation.status}` : ""}
					</div>
				</div>
				{(() => {
					const link = entityLink(conversation);
					return link ? (
						<Link to={link.to} className="btn btn--ghost btn--sm" style={{ flexShrink: 0 }}>
							{link.label} →
						</Link>
					) : conversation.linkedEntityType ? (
						<span style={stagePillMiniStyle}>{conversation.linkedEntityType.toUpperCase()}</span>
					) : null;
				})()}
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