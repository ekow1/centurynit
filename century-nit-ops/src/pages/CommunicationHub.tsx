import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
	useChatConversations,
	useChatMessages,
} from "../hooks/useChatApi";
import {
	getCommunicationStaffDirectory,
	updateCommunicationPresence,
	communicationHeartbeat,
	createChatConversation,
	type ChatConversation,
	type StaffDirectoryEntryDetailed,
	type StaffPresence,
} from "../lib/api";
import { ApiError } from "../lib/api";
import { useOpsAuth, type OpsRole } from "./OpsAuthContext";
import { roleCanAccess, type ChatMessage, type QuotedMessage } from "century-nit-shared";
import {
	ensureChatUiStyles,
	MessageList,
	Composer,
	ForwardDialog,
	type MessageActionsConfig,
} from "century-nit-chat-ui";

/**
 * OPS Staff Communication Workstation — WhatsApp-style messaging on the
 * shared chat-ui component package.
 *
 * The shell (floating launcher, window, presence, mode switcher, directory,
 * conversation list) is specific to the ops console. The message stream and
 * composer use the shared `MessageList` and `Composer` from
 * `century-nit-chat-ui`, so every chat surface across the platform renders
 * the same interaction model.
 */

const HEARTBEAT_MS = 60_000;

type Mode = "internal" | "external";

export function CommunicationHub() {
	const { opsRole, opsUser } = useOpsAuth();
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [mode, setMode] = useState<Mode>("internal");
	const [activeConvId, setActiveConvId] = useState<string | null>(null);
	const [directory, setDirectory] = useState<StaffDirectoryEntryDetailed[]>([]);
	const [dirLoading, setDirLoading] = useState(false);
	const [presenceStatus, setPresenceStatus] = useState<StaffPresence>("available");
	const [searchQuery, setSearchQuery] = useState("");
	const [error, setError] = useState<string | null>(null);

	const canChat = roleCanAccess(opsRole as OpsRole, "chat");
	const { conversations, loading: convsLoading, refresh: refreshConvs } = useChatConversations(canChat);
	const {
		messages, hasMore, loading: msgsLoading, sending, typing,
		load, loadMore, send, edit, delete: deleteMessage, react, forward, signalTyping, markRead,
	} = useChatMessages(canChat ? activeConvId : null);

	// Composer state — owned here so it survives window close/reopen.
	const [draft, setDraft] = useState("");
	const [replyTo, setReplyTo] = useState<QuotedMessage | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);

	// Typing signal debounce — only send when the user pauses, not on every keystroke.
	const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isTypingRef = useRef(false);

	/* ── Presence heartbeat ── */
	useEffect(() => {
		if (!canChat) return;
		let id: ReturnType<typeof setInterval> | undefined;
		const beat = async () => {
			try {
				await communicationHeartbeat();
			} catch (e) {
				if (e instanceof ApiError && e.status === 403) {
					if (id) clearInterval(id);
					id = undefined;
				}
			}
		};
		void beat();
		id = setInterval(beat, HEARTBEAT_MS);
		return () => { if (id) clearInterval(id); };
	}, [canChat]);

	/* ── Staff directory (with presence + load) ── */
	const loadDirectory = useCallback(async () => {
		setDirLoading(true);
		try {
			const res = await getCommunicationStaffDirectory();
			setDirectory(res.staff);
			const me = res.staff.find((s) => s.email === opsUser?.email);
			if (me) setPresenceStatus(me.presence);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't load staff directory");
		} finally {
			setDirLoading(false);
		}
	}, [opsUser?.email]);

	useEffect(() => {
		if (open && mode === "internal") void loadDirectory();
	}, [open, mode, loadDirectory]);

	useEffect(() => {
		if (!open || mode !== "internal") return;
		const id = setInterval(() => { void loadDirectory(); }, 30_000);
		return () => clearInterval(id);
	}, [open, mode, loadDirectory]);

	/* ── Set presence ── */
	const changePresence = useCallback(async (status: StaffPresence) => {
		setPresenceStatus(status);
		try {
			await updateCommunicationPresence(status);
			void loadDirectory();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't update presence");
		}
	}, [loadDirectory]);

	/* ── Filter Conversations ── */
	const internalConversations = useMemo(() => {
		return conversations
			.filter((c) => c.type === "direct" || c.type === "group" || c.type === "internal")
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}, [conversations]);

	const externalConversations = useMemo(() => {
		return conversations
			.filter((c) => c.type === "applicant" || c.type === "support" || c.type === "case" || c.type === "stage" || c.type === "entity")
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}, [conversations]);

	const totalUnread = useMemo(
		() => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
		[conversations],
	);

	/* ── Open conversation ── */
	const openConversation = useCallback(
		(conv: ChatConversation) => {
			setActiveConvId(conv.id);
			setReplyTo(null);
			setEditingId(null);
			setDraft("");
		},
		[],
	);

	useEffect(() => {
		if (activeConvId) {
			void load();
			void markRead().then(() => refreshConvs());
		}
	}, [activeConvId, load, markRead, refreshConvs]);

	// A message arriving over SSE while the thread is already open would
	// otherwise re-raise the unread badge for something the user is actively
	// looking at. Re-mark on every new message so the badge behaves like
	// WhatsApp: open thread == read, no matter when the message lands.
	const messageCount = messages.length;
	useEffect(() => {
		if (!activeConvId || !open || messageCount === 0) return;
		if (typeof document !== "undefined" && document.hidden) return;
		void markRead().then(() => refreshConvs());
	}, [activeConvId, open, messageCount, markRead, refreshConvs]);

	/* ── Start 1-on-1 Direct Message with Colleague ── */
	const startDM = useCallback(
		async (entry: StaffDirectoryEntryDetailed) => {
			try {
				const conv = await createChatConversation({ participantOpsUserId: entry.opsUserId });
				openConversation(conv);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't start direct message session");
			}
		},
		[openConversation],
	);

	const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

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
				// Stop typing signal on send.
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

	// Stop typing when leaving the conversation.
	useEffect(() => {
		if (!activeConvId && isTypingRef.current) {
			isTypingRef.current = false;
			void signalTyping(false);
		}
	}, [activeConvId, signalTyping]);

	const filteredDirectory = useMemo(() => {
		const withoutSelf = directory.filter((s) => s.email !== opsUser?.email);
		if (!searchQuery.trim()) return withoutSelf;
		const q = searchQuery.toLowerCase();
		return withoutSelf.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.role.toLowerCase().includes(q) ||
				(s.branch || "").toLowerCase().includes(q),
		);
	}, [directory, searchQuery, opsUser?.email]);

	const isOwn = useCallback(
		(m: ChatMessage) => m.senderOpsUserId != null && m.senderOpsUserId === opsUser?.opsUserId,
		[opsUser?.opsUserId],
	);

	// Authorize edit/delete: author only (ops console has no moderator UI here).
	const actionsConfig = useMemo<MessageActionsConfig>(() => ({
		reply: true,
		react: true,
		forward: true,
		copy: true,
		edit: true,
		delete: true,
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
		onForward: (m: ChatMessage) => {
			if (m.deletedAt) return;
			setForwardTarget(m);
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

	return (
		<>
			{/* Floating Square Launcher Button */}
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				style={launcherSquareBtnStyle}
				aria-label="Open OPS Chat"
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="square"
					strokeLinejoin="miter"
				>
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
				</svg>
				{totalUnread > 0 && <span style={unreadSquareBadgeStyle}>{totalUnread}</span>}
			</button>

			{/* Floating Hub Window */}
			{open && (
				<div style={{ ...windowContainerStyle, ...(expanded ? windowExpandedStyle : {}) }} className="cn-chat">
					{/* Header */}
					<header style={headerStyle}>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<span style={{ ...indicatorDotStyle, background: presenceStatus === "available" ? "#10b981" : presenceStatus === "busy" ? "#ef4444" : presenceStatus === "on_leave" ? "#f59e0b" : "#71717a" }} />
							<span style={headerTitleStyle}>OPS CHAT</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
							<select
								value={presenceStatus}
								onChange={(e) => changePresence(e.target.value as StaffPresence)}
								style={presenceSelectStyle}
								aria-label="Set presence"
							>
								<option value="available">ONLINE</option>
								<option value="busy">BUSY</option>
								<option value="on_leave">ON LEAVE</option>
								<option value="offline">OFFLINE</option>
							</select>
							<button
								type="button"
								onClick={() => setExpanded((prev) => !prev)}
								style={controlBtnStyle}
								title={expanded ? "Restore" : "Expand"}
							>
								{expanded ? "⤡" : "⤢"}
							</button>
							<button
								type="button"
								onClick={() => setOpen(false)}
								style={controlBtnStyle}
								title="Close"
							>
								✕
							</button>
						</div>
					</header>

					{/* Navigation Switcher */}
					<nav style={channelNavStyle}>
						<button
							type="button"
							onClick={() => {
								setMode("internal");
								setActiveConvId(null);
							}}
							style={{
								...channelBtnStyle,
								...(mode === "internal" ? activeChannelBtnStyle : {}),
							}}
						>
							<span>STAFF DMs</span>
						</button>
						<button
							type="button"
							onClick={() => {
								setMode("external");
								setActiveConvId(null);
							}}
							style={{
								...channelBtnStyle,
								...(mode === "external" ? activeChannelBtnStyle : {}),
							}}
						>
							<span>CLIENTS</span>
							{externalConversations.some((c) => c.unreadCount > 0) && (
								<span style={tabDotBadgeStyle} />
							)}
						</button>
					</nav>

					{/* Error Banner */}
					{error && (
						<div style={errorBannerStyle}>
							<span>{error}</span>
							<button type="button" onClick={() => setError(null)} style={errorCloseStyle}>✕</button>
						</div>
					)}

					{/* Hub Workspace */}
					<div style={expanded ? workspaceSplitStyle : workspaceStandardStyle}>
						{/* Mode 1: Internal Staff DMs */}
						{mode === "internal" && !activeConvId && (
							<div style={directoryContainerStyle}>
								{/* Search */}
								<div style={{ padding: "8px 10px", borderBottom: "1px solid #e4e4e7" }}>
									<input
										type="text"
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										placeholder="Filter colleagues by name, role or branch..."
										style={searchInputStyle}
									/>
								</div>

								{/* Active Direct Chats */}
								{internalConversations.length > 0 && !searchQuery && (
									<div style={{ borderBottom: "1px solid #e4e4e7" }}>
										<div style={sectionHeaderStyle}>ACTIVE 1-ON-1 SESSIONS</div>
										<div style={{ maxHeight: "150px", overflowY: "auto" }}>
											{internalConversations.map((c) => (
												<button
													key={c.id}
													type="button"
													onClick={() => openConversation(c)}
													style={activeChatRowStyle}
												>
													<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
														<span style={avatarMiniStyle}>
															{c.title.slice(0, 2).toUpperCase()}
														</span>
														<div style={{ textAlign: "left" }}>
															<div style={{ fontSize: "11px", fontWeight: 700, color: "#000000", letterSpacing: "0.02em" }}>
																{c.title.toUpperCase()}
															</div>
															<div style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>
																{c.lastMessage?.content.slice(0, 32) || "No messages yet"}
															</div>
														</div>
													</div>
													{c.unreadCount > 0 && <span style={unreadSquareBadgeInlineStyle}>{c.unreadCount}</span>}
												</button>
											))}
										</div>
									</div>
								)}

								{/* Full Staff Directory */}
								<div style={sectionHeaderStyle}>STAFF DIRECTORY (CLICK TO CHAT)</div>
								<div style={{ flex: 1, overflowY: "auto", padding: "4px" }}>
									{dirLoading ? (
										<div style={{ textAlign: "center", color: "#52525b", padding: "20px", fontSize: "11px", fontFamily: "monospace" }}>
											LOADING DIRECTORY...
										</div>
									) : filteredDirectory.length === 0 ? (
										<div style={{ textAlign: "center", color: "#52525b", padding: "20px", fontSize: "11px", fontFamily: "monospace" }}>
											NO STAFF FOUND.
										</div>
									) : (
										filteredDirectory.map((staff) => (
											<button
												key={staff.opsUserId}
												type="button"
												onClick={() => startDM(staff)}
												style={staffCardBtnStyle}
											>
												<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
													<span style={avatarPillStyle}>
														{staff.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
													</span>
													<div style={{ textAlign: "left" }}>
														<div style={{ fontWeight: 700, fontSize: "11px", color: "#000000", letterSpacing: "0.02em" }}>
															{staff.name.toUpperCase()}
														</div>
														<div style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>
															{staff.role.toUpperCase()} · {(staff.branch || "").toUpperCase()}
														</div>
													</div>
												</div>
												<span
													style={{
														...presenceBadgeStyle,
														background:
															staff.presence === "available" ? "#ecfdf5" :
															staff.presence === "busy" ? "#fef2f2" :
															staff.presence === "on_leave" ? "#fffbeb" : "#f4f4f5",
														color:
															staff.presence === "available" ? "#065f46" :
															staff.presence === "busy" ? "#991b1b" :
															staff.presence === "on_leave" ? "#92400e" : "#3f3f46",
														border: `1px solid ${
															staff.presence === "available" ? "#a7f3d0" :
															staff.presence === "busy" ? "#fecaca" :
															staff.presence === "on_leave" ? "#fde68a" : "#e4e4e7"
														}`,
														display: "inline-flex",
														alignItems: "center",
														gap: "4px",
													}}
												>
													<span
														style={{
															width: "6px",
															height: "6px",
															borderRadius: "50%",
															background:
																staff.presence === "available" ? "#10b981" :
																staff.presence === "busy" ? "#ef4444" :
																staff.presence === "on_leave" ? "#f59e0b" : "#a1a1aa",
														}}
													/>
													{staff.presence.replace("_", " ").toUpperCase()}
												</span>
											</button>
										))
									)}
								</div>
							</div>
						)}

						{/* Mode 2: External Client Case Chats */}
						{mode === "external" && !activeConvId && (
							<div style={directoryContainerStyle}>
								<div style={sectionHeaderStyle}>ASSIGNED CLIENT CHATS</div>
								<div style={{ flex: 1, overflowY: "auto", padding: "4px" }}>
									{convsLoading ? (
										<div style={{ textAlign: "center", color: "#52525b", padding: "20px", fontSize: "11px", fontFamily: "monospace" }}>
											LOADING CLIENT CHATS...
										</div>
									) : externalConversations.length === 0 ? (
										<div style={{ textAlign: "center", color: "#52525b", padding: "40px 20px" }}>
											<p style={{ fontWeight: 700, color: "#000000", fontSize: "12px", letterSpacing: "0.04em" }}>NO ACTIVE CLIENT CHATS</p>
											<p style={{ fontSize: "11px", color: "#52525b", marginTop: "4px" }}>
												Client case messages will appear here.
											</p>
										</div>
									) : (
										externalConversations.map((c) => (
											<button
												key={c.id}
												type="button"
												onClick={() => openConversation(c)}
												style={clientChatCardBtnStyle}
											>
												<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
													<span style={avatarPillStyle}>
														{c.title.slice(0, 2).toUpperCase()}
													</span>
													<div style={{ textAlign: "left" }}>
														<div style={{ fontWeight: 700, fontSize: "11px", color: "#000000", letterSpacing: "0.02em" }}>
															{c.title.toUpperCase()}
														</div>
														<div style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>
															{c.lastMessage?.content.slice(0, 36) || "No messages yet"}
														</div>
													</div>
												</div>
												<div style={{ textAlign: "right" }}>
													<span style={stagePillMiniStyle}>{c.type.toUpperCase()}</span>
													{c.unreadCount > 0 && <span style={unreadSquareBadgeInlineStyle}>{c.unreadCount}</span>}
												</div>
											</button>
										))
									)}
								</div>
							</div>
						)}

						{/* Active Conversation Stream */}
						{activeConvId && (
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
								onCancelEdit={() => { setEditingId(null); setDraft(""); }}
								onLoadMore={loadMore}
								onBack={() => setActiveConvId(null)}
								onReact={(messageId, emoji) => void react(messageId, emoji)}
								onQuoteClick={() => {/* scroll-to-original — TODO via ref map */}}
							/>
						)}
					</div>

					{/* Forward dialog */}
					{forwardTarget && (
						<ForwardDialog
							conversations={conversations}
							preview={forwardTarget.content}
							onConfirm={(targetIds) => {
								void forward(forwardTarget.id, targetIds);
								setForwardTarget(null);
							}}
							onClose={() => setForwardTarget(null)}
						/>
					)}
				</div>
			)}
		</>
	);
}

/* ── Conversation Thread (shared components) ────────────────────────────── */

interface ConversationThreadProps {
	conversation: ChatConversation | null;
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
		onForward: (m: ChatMessage) => void;
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

	// Group chats show author labels; 1:1 doesn't.
	const showAuthor = useCallback(
		(m: ChatMessage) => {
			if (!conversation) return false;
			const isGroup = conversation.type === "group" || conversation.type === "entity";
			return isGroup && !isOwn(m);
		},
		[conversation, isOwn],
	);

	const bubbleProps = useMemo(() => ({
		actions: bubbleCallbacks.actions,
		onReply: bubbleCallbacks.onReply,
		onForward: bubbleCallbacks.onForward,
		onEdit: bubbleCallbacks.onEdit,
		onDelete: bubbleCallbacks.onDelete,
		onQuoteClick,
		onReact: (message: ChatMessage, emoji: string) => onReact(message.id, emoji),
	}), [bubbleCallbacks, onQuoteClick, onReact]);

	return (
		<div style={streamContainerStyle}>
			{/* Header */}
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
						{conversation?.title ?? "Conversation"}
					</div>
					<div style={{ fontSize: 10, color: "#52525b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
						{conversation?.participants.map((p) => p.name).join(", ")}
					</div>
				</div>
				{conversation?.linkedEntityType && (
					<span style={stagePillMiniStyle}>
						{conversation.linkedEntityType.toUpperCase()}
					</span>
				)}
			</div>

			{/* Messages — shared MessageList */}
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

			{/* Composer — shared */}
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
				placeholder={editingId ? "Edit message…" : replyTo ? `Reply to ${replyTo.senderName}…` : "Type a message…"}
			/>
		</div>
	);
}

/* ── Shell styles for OPS Hub ───────────────────────────────────────────── */
/* Only the shell styles remain here; message bubbles + composer use the    */
/* shared chat-ui components which style themselves via --cn-chat-* tokens. */

const launcherSquareBtnStyle: CSSProperties = {
	position: "fixed",
	bottom: "24px",
	right: "24px",
	zIndex: 9999,
	width: "56px",
	height: "56px",
	background: "#18181b",
	color: "#ffffff",
	border: "none",
	borderRadius: "50%",
	boxShadow: "0 10px 25px -5px rgba(0,0,0,0.2)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
};

const unreadSquareBadgeStyle: CSSProperties = {
	position: "absolute",
	top: "-6px",
	right: "-6px",
	background: "#dc2626",
	color: "#ffffff",
	fontSize: "10px",
	fontWeight: 800,
	fontFamily: "monospace",
	padding: "1px 5px",
	border: "1px solid #000000",
	borderRadius: "0px",
};

const windowContainerStyle: CSSProperties = {
	position: "fixed",
	bottom: "24px",
	right: "24px",
	zIndex: 9999,
	width: "420px",
	height: "600px",
	maxHeight: "calc(100vh - 48px)",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	borderRadius: "16px",
	boxShadow: "0 10px 40px -10px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.05)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	color: "#18181b",
	transition: "width 0.2s ease, height 0.2s ease, transform 0.2s ease",
};

const windowExpandedStyle: CSSProperties = {
	width: "880px",
	maxHeight: "calc(100vh - 48px)",
	maxWidth: "calc(100vw - 48px)",
};

const headerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "12px 16px",
	background: "#ffffff",
	borderBottom: "1px solid #f4f4f5",
};

const indicatorDotStyle: CSSProperties = {
	width: "6px",
	height: "6px",
	background: "#10b981",
	borderRadius: "0px",
};

const headerTitleStyle: CSSProperties = {
	fontSize: "13px",
	fontWeight: 700,
	fontFamily: "system-ui, -apple-system, sans-serif",
	color: "#18181b",
};

const presenceSelectStyle: CSSProperties = {
	background: "#ffffff",
	color: "#18181b",
	border: "1px solid #e4e4e7",
	borderRadius: "6px",
	fontSize: "11px",
	fontWeight: 600,
	fontFamily: "system-ui, -apple-system, sans-serif",
	padding: "4px 8px",
	outline: "none",
};

const controlBtnStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	color: "#52525b",
	width: "28px",
	height: "28px",
	borderRadius: "50%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	fontSize: "14px",
	transition: "background 0.2s ease, color 0.2s ease",
};

const channelNavStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "1fr 1fr",
	borderBottom: "1px solid #f4f4f5",
	background: "#f5f5f5",
};

const channelBtnStyle: CSSProperties = {
	padding: "12px 8px",
	background: "transparent",
	border: "none",
	borderBottom: "2px solid transparent",
	color: "#52525b",
	fontSize: "12px",
	fontWeight: 600,
	fontFamily: "system-ui, -apple-system, sans-serif",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "6px",
	cursor: "pointer",
	transition: "color 0.2s ease",
};

const activeChannelBtnStyle: CSSProperties = {
	color: "#18181b",
	borderBottomColor: "#18181b",
};

const tabDotBadgeStyle: CSSProperties = {
	width: "4px",
	height: "4px",
	background: "#dc2626",
	borderRadius: "0px",
};

const workspaceStandardStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const workspaceSplitStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const directoryContainerStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const searchInputStyle: CSSProperties = {
	width: "calc(100% - 24px)",
	margin: "12px",
	background: "#f4f4f5",
	border: "1px solid transparent",
	borderRadius: "8px",
	color: "#18181b",
	padding: "10px 14px",
	fontSize: "13px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	outline: "none",
	boxSizing: "border-box",
	transition: "border 0.2s ease",
};

const sectionHeaderStyle: CSSProperties = {
	padding: "8px 16px",
	background: "#ffffff",
	color: "#52525b",
	fontSize: "11px",
	fontWeight: 600,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	fontFamily: "system-ui, -apple-system, sans-serif",
	borderBottom: "1px solid #f4f4f5",
};

const activeChatRowStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "12px 16px",
	background: "#f5f5f5",
	border: "none",
	borderBottom: "1px solid #f4f4f5",
	cursor: "pointer",
	textAlign: "left",
	transition: "background 0.2s ease",
};

const staffCardBtnStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "12px 16px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #f4f4f5",
	cursor: "pointer",
	textAlign: "left",
	transition: "background 0.2s ease",
};

const clientChatCardBtnStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "12px 16px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #f4f4f5",
	cursor: "pointer",
	textAlign: "left",
	transition: "background 0.2s ease",
};

const avatarPillStyle: CSSProperties = {
	width: "36px",
	height: "36px",
	borderRadius: "50%",
	background: "#f4f4f5",
	color: "#18181b",
	fontWeight: 600,
	fontSize: "12px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	border: "1px solid #e4e4e7",
};

const avatarMiniStyle: CSSProperties = {
	width: "28px",
	height: "28px",
	borderRadius: "50%",
	background: "#f4f4f5",
	color: "#18181b",
	fontWeight: 600,
	fontSize: "10px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	border: "1px solid #e4e4e7",
};

const presenceBadgeStyle: CSSProperties = {
	fontSize: "10px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	fontWeight: 600,
	color: "#52525b",
	background: "#f4f4f5",
	border: "none",
	padding: "2px 8px",
	borderRadius: "12px",
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

const unreadSquareBadgeInlineStyle: CSSProperties = {
	background: "#dc2626",
	color: "#ffffff",
	fontSize: "9px",
	fontWeight: 800,
	fontFamily: "monospace",
	padding: "1px 5px",
	border: "1px solid #000000",
	borderRadius: "0px",
	marginLeft: 6,
};

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

const errorBannerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	background: "#ef4444",
	color: "#ffffff",
	padding: "6px 10px",
	fontSize: "11px",
	fontWeight: 500,
	fontFamily: "system-ui, -apple-system, sans-serif",
	borderBottom: "1px solid #b91c1c",
};

const errorCloseStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	color: "#ffffff",
	cursor: "pointer",
	fontWeight: 700,
};
