import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
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
import { registerOpenDM, registerOpenConversation } from "./ChatHubContext";
import {
	ensureChatUiStyles,
	MessageList,
	Composer,
	ForwardDialog,
	type MessageActionsConfig,
} from "century-nit-chat-ui";
import { useOpsAiChat } from "../hooks/useOpsAiChat";

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

type Mode = "internal" | "external" | "ai";

const EXTERNAL_TYPES = new Set(["applicant", "support", "case", "stage", "entity"]);

const PRESENCE_COLORS: Record<string, string> = {
	available: "#10b981",
	busy: "#ef4444",
	on_leave: "#f59e0b",
	offline: "#71717a",
};

export function CommunicationHub() {
	const { opsRole, opsUser } = useOpsAuth();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [mode, setMode] = useState<Mode>("internal");
	const [activeConvId, setActiveConvId] = useState<string | null>(null);
	const [directory, setDirectory] = useState<StaffDirectoryEntryDetailed[]>([]);
	const [dirLoading, setDirLoading] = useState(false);
	const [presenceStatus, setPresenceStatus] = useState<StaffPresence>("available");
	const [showDirectoryDrawer, setShowDirectoryDrawer] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [error, setError] = useState<string | null>(null);

	/* The staff assistant — Tier 2, streams from this worker's /ai/chat which
	   verifies the staff session edge-side. A third channel next to STAFF
	   DMs and CLIENTS. */
	const ai = useOpsAiChat({
		getContext: () => ({
			name: opsUser?.name ?? "",
			role: opsUser?.role ?? "",
			branch: opsUser?.branch ?? "",
		}),
	});
	const [aiDraft, setAiDraft] = useState("");

	/* ── Helper to format relative conversation timestamp ── */
	const formatConvTime = (dateStr?: string) => {
		if (!dateStr) return "";
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
		if (diffDays === 0) {
			return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
		}
		if (diffDays === 1) return "Yesterday";
		if (diffDays < 7) {
			return date.toLocaleDateString([], { weekday: "short" });
		}
		return date.toLocaleDateString([], { month: "short", day: "numeric" });
	};

	// Map staff by name/opsUserId for quick presence lookup
	const staffPresenceMap = useMemo(() => {
		const map = new Map<string, StaffPresence>();
		if (Array.isArray(directory)) {
			for (const s of directory) {
				if (s) {
					map.set((s.name || "").toLowerCase(), s.presence);
					map.set(s.opsUserId, s.presence);
				}
			}
		}
		return map;
	}, [directory]);

	const canChat = roleCanAccess(opsRole as OpsRole, "chat");
	const { conversations, loading: convsLoading, refresh: refreshConvs } = useChatConversations(canChat, "staff");
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
			const list = Array.isArray(res?.staff) ? res.staff : [];
			setDirectory(list);
			const me = list.find((s) => s.email === opsUser?.email);
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
		if (!Array.isArray(conversations)) return [];
		return conversations
			.filter((c) => c && (c.type === "direct" || c.type === "group" || c.type === "internal"))
			.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
	}, [conversations]);

	const externalConversations = useMemo(() => {
		if (!Array.isArray(conversations)) return [];
		return conversations
			.filter((c) => c && (c.type === "applicant" || c.type === "support" || c.type === "case" || c.type === "stage" || c.type === "entity"))
			// Unread-first: the client's unread messages are the triage signal
			// (same rule as the Helpdesk page) — they need a reply, the rest wait.
			.sort((a, b) => {
				const aUnread = (a.unreadCount || 0) > 0 ? 1 : 0;
				const bUnread = (b.unreadCount || 0) > 0 ? 1 : 0;
				if (aUnread !== bUnread) return bUnread - aUnread;
				return (b.updatedAt || "").localeCompare(a.updatedAt || "");
			});
	}, [conversations]);

	const totalUnread = useMemo(
		() => Array.isArray(conversations) ? conversations.reduce((sum, c) => sum + (c?.unreadCount || 0), 0) : 0,
		[conversations],
	);

	/* Peek card + FAB pulse — the portal launcher's grammar. The newest
	   inbound message previews above the FAB without opening the hub, and
	   the button pulses amber once when a fresh message lands closed. */
	const latestInbound = useMemo(() => {
		const candidates = [...internalConversations, ...externalConversations]
			.filter((c) => c.unreadCount > 0 && c.lastMessage?.createdAt)
			.sort((a, b) => Date.parse(b.lastMessage!.createdAt) - Date.parse(a.lastMessage!.createdAt));
		return candidates[0] ?? null;
	}, [internalConversations, externalConversations]);
	const [peekDismissed, setPeekDismissed] = useState<string | null>(null);
	const peek = !open && latestInbound && latestInbound.lastMessage?.id !== peekDismissed ? latestInbound : null;
	const [pulse, setPulse] = useState(false);
	const lastUnreadRef = useRef(0);
	useEffect(() => {
		if (!open && totalUnread > lastUnreadRef.current) setPulse(true);
		lastUnreadRef.current = totalUnread;
	}, [totalUnread, open]);
	useEffect(() => {
		if (!pulse) return;
		const t = setTimeout(() => setPulse(false), 3600);
		return () => clearTimeout(t);
	}, [pulse]);

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

	/* Peek card click — open the hub straight into that conversation's
	   channel (staff DMs vs client threads). */
	const openPeek = useCallback((conv: ChatConversation) => {
		setMode(EXTERNAL_TYPES.has(conv.type) ? "external" : "internal");
		openConversation(conv);
		setOpen(true);
	}, [openConversation]);

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
				setMode("internal");
				setOpen(true);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't start direct message session");
			}
		},
		[openConversation],
	);

	/** Expose openDM + openConversation to the rest of the ops console. */
	useEffect(() => {
		registerOpenDM(async (opsUserId: string) => {
			try {
				const conv = await createChatConversation({ participantOpsUserId: opsUserId });
				openConversation(conv);
				setMode("internal");
				setOpen(true);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't start direct message session");
			}
		});
		registerOpenConversation(async (conversationId: string) => {
			try {
				setActiveConvId(conversationId);
				setMode("external");
				setOpen(true);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't open conversation");
			}
		});
	}, [openConversation]);

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

	/* Header + strip content — the portal hub's grammar: the header says
	   who you're talking to (or who you are at the directory), and the
	   strip under the tabs says what this surface is for right now. */
	const presenceLabel = presenceStatus.replace("_", " ").toUpperCase();
	const internalUnread = internalConversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
	const externalUnread = externalConversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
	const headerIni = mode === "ai"
		? "AI"
		: activeConv
			? activeConv.title.slice(0, 2).toUpperCase()
			: (opsUser?.name ?? "OC").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
	const headerName = mode === "ai" ? "Ops AI" : activeConv ? activeConv.title : "OPS CHAT";
	const headerSub = mode === "ai"
		? "CONSOLE-AWARE · STAFF ONLY"
		: activeConv
			? (EXTERNAL_TYPES.has(activeConv.type) ? "CLIENT THREAD" : "STAFF THREAD")
			: `${presenceLabel} · ${(opsUser?.role ?? "").toUpperCase()}${opsUser?.branch ? ` · ${opsUser.branch.toUpperCase()}` : ""}`;
	const stripText = mode === "ai"
		? "KNOWS THE CONSOLE · LINKS OPEN REAL PAGES"
		: activeConvId
			? (EXTERNAL_TYPES.has(activeConv?.type ?? "") ? "REPLIES GO TO THE PORTAL" : "STAFF DIRECT MESSAGE")
			: mode === "internal"
				? "DIRECTORY · WHO TO REACH NOW"
				: "CLIENT THREADS · REPLIES GO TO THE PORTAL";

	return (
		<>
			{/* FAB pulse keyframes — injected once, portal's amber ring on inbound. */}
			<style>{`@keyframes ochatPulse{0%{box-shadow:0 0 0 0 #b45309}70%{box-shadow:0 0 0 10px rgba(180,83,9,0)}100%{box-shadow:0 0 0 0 rgba(180,83,9,0)}}.ochat-fab--pulse{animation:ochatPulse 1.6s ease-out 2}`}</style>

			{/* Launcher cluster — peek card over the FAB, portal grammar. */}
			<div style={launcherDockStyle}>
				{peek && peek.lastMessage && (
					<button
						type="button"
						style={peekStyle}
						onClick={() => openPeek(peek)}
					>
						<b style={peekWhoStyle}>
							{(peek.lastMessage.senderName || peek.title).toUpperCase()}
							{peek.lastMessage.createdAt ? ` · ${formatConvTime(peek.lastMessage.createdAt)}` : ""}
						</b>
						{peek.lastMessage.content.slice(0, 90)}{peek.lastMessage.content.length > 90 ? "…" : ""}
						<span
							style={peekCloseStyle}
							role="button"
							tabIndex={0}
							aria-label="Dismiss preview"
							onClick={(e) => {
								e.stopPropagation();
								setPeekDismissed(peek.lastMessage?.id ?? null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									setPeekDismissed(peek.lastMessage?.id ?? null);
								}
							}}
						>
							✕
						</span>
					</button>
				)}
				<button
					type="button"
					onClick={() => setOpen((prev) => !prev)}
					style={launcherSquareBtnStyle}
					className={pulse && !open ? "ochat-fab--pulse" : undefined}
					aria-label={open ? "Close OPS Chat" : "Open OPS Chat"}
				>
					{open ? (
						<span style={{ fontSize: "14px", lineHeight: 1 }}>✕</span>
					) : (
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
					)}
					{totalUnread > 0 && !open && <span style={unreadSquareBadgeStyle}>{totalUnread}</span>}
				</button>
			</div>

			{/* Floating Hub Window */}
			{open && (
				<div style={{ ...windowContainerStyle, ...(expanded ? windowExpandedStyle : {}) }} className="cn-chat">
					{/* Header — who you're talking to (or who you are), portal grammar */}
					<header style={headerStyle}>
						<span style={{ ...hubAvatarStyle, ...(mode === "ai" ? { background: "#b45309" } : {}) }}>
							{headerIni}
						</span>
						<div style={{ flex: 1, minWidth: 0 }}>
							<p style={hubNameStyle}>{headerName}</p>
							<p style={hubSubStyle}>
								{!activeConv && mode !== "ai" && (
									<span style={{ ...presenceSqStyle, background: PRESENCE_COLORS[presenceStatus] ?? "#71717a" }} />
								)}
								{headerSub}
							</p>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
							<button
								type="button"
								onClick={() => setOpen(false)}
								style={controlBtnStyle}
								title="Minimize"
								aria-label="Minimize"
							>
								—
							</button>
							<button
								type="button"
								onClick={() => setExpanded((prev) => !prev)}
								style={controlBtnStyle}
								title={expanded ? "Restore" : "Expand"}
								aria-label={expanded ? "Restore" : "Expand"}
							>
								{expanded ? "⤡" : "⤢"}
							</button>
							{mode === "external" && activeConvId && (
								<button
									type="button"
									onClick={() => {
										// Client threads get the full Helpdesk page; staff DMs
										// just expand the hub — the /chat page is retired.
										setOpen(false);
										navigate(`/helpdesk?id=${activeConvId}`);
									}}
									style={controlBtnStyle}
									title="Open in Helpdesk"
									aria-label="Open in Helpdesk"
								>
									↗
								</button>
							)}
							<button
								type="button"
								onClick={() => setOpen(false)}
								style={controlBtnStyle}
								title="Close"
								aria-label="Close"
							>
								✕
							</button>
						</div>
					</header>

					{/* Channel tabs — mono caps, inset underline, red count chips */}
					<nav style={channelNavStyle} aria-label="Chat channels">
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
							<span>Staff</span>
							{internalUnread > 0 && <span style={tabCountChipStyle}>{internalUnread}</span>}
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
							<span>Clients</span>
							{externalUnread > 0 && <span style={tabCountChipStyle}>{externalUnread}</span>}
						</button>
						<button
							type="button"
							onClick={() => {
								setMode("ai");
								setActiveConvId(null);
							}}
							style={{
								...channelBtnStyle,
								...(mode === "ai" ? activeChannelBtnStyle : {}),
							}}
						>
							<span>AI</span>
						</button>
					</nav>

					{/* Context strip — what this surface is for right now. Presence
					    lives here now that the header carries the "who". */}
					<div style={stripStyle}>
						<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{stripText}</span>
						{!activeConvId && mode !== "ai" ? (
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
						) : mode === "external" && activeConvId ? (
							<button
								type="button"
								style={stripLinkStyle}
								onClick={() => {
									setOpen(false);
									navigate(`/helpdesk?id=${activeConvId}`);
								}}
							>
								Open in Helpdesk →
							</button>
						) : null}
					</div>

					{/* Error Banner */}
					{error && (
						<div style={errorBannerStyle}>
							<span>{error}</span>
							<button type="button" onClick={() => setError(null)} style={errorCloseStyle}>✕</button>
						</div>
					)}

					{/* Hub Workspace */}
					<div style={expanded ? workspaceSplitStyle : workspaceStandardStyle}>
						{/* Mode 1: Internal Staff DMs (WhatsApp-style Unified Inbox) */}
						{mode === "internal" && !activeConvId && (
							<div style={directoryContainerStyle}>
								{/* Top Bar: Search & New Chat Action */}
								{showDirectoryDrawer ? (
									<div style={{ padding: "8px 12px", borderBottom: "1px solid #e4e4e7", background: "#f4f4f5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
										<span style={{ fontSize: "11px", fontWeight: 700, color: "#18181b", letterSpacing: "0.04em", textTransform: "uppercase" }}>New Direct Message</span>
										<button
											type="button"
											onClick={() => { setShowDirectoryDrawer(false); setSearchQuery(""); }}
											style={{ background: "#ffffff", border: "1px solid #18181b", padding: "3px 10px", fontSize: "10px", fontWeight: 700, cursor: "pointer", color: "#18181b" }}
										>
											← Back to Chats
										</button>
									</div>
								) : (
									<div style={{ padding: "8px 10px", borderBottom: "1px solid #e4e4e7", display: "flex", gap: "6px", alignItems: "center" }}>
										<input
											type="text"
											value={searchQuery}
											onChange={(e) => setSearchQuery(e.target.value)}
											placeholder="Search chats or colleagues..."
											style={{ ...searchInputStyle, margin: 0, flex: 1, padding: "8px 10px" }}
										/>
										<button
											type="button"
											onClick={() => setShowDirectoryDrawer(true)}
											style={{
												background: "#18181b",
												color: "#ffffff",
												border: "1px solid #18181b",
												padding: "7px 12px",
												fontSize: "10px",
												fontWeight: 700,
												textTransform: "uppercase",
												letterSpacing: "0.04em",
												cursor: "pointer",
												whiteSpace: "nowrap",
												display: "flex",
												alignItems: "center",
												gap: "4px",
											}}
											title="New Message"
										>
											+ New Chat
										</button>
									</div>
								)}

								{/* Drawer View: Full Staff Directory to start a new chat */}
								{showDirectoryDrawer && (
									<div style={{ flex: 1, overflowY: "auto", padding: "4px" }}>
										<div style={{ padding: "8px 10px" }}>
											<input
												type="text"
												value={searchQuery}
												onChange={(e) => setSearchQuery(e.target.value)}
												placeholder="Filter staff by name, role or branch..."
												style={{ ...searchInputStyle, margin: 0, width: "100%" }}
												autoFocus
											/>
										</div>
										<div style={sectionHeaderStyle}>ALL STAFF DIRECTORY</div>
										{dirLoading ? (
											<div style={{ textAlign: "center", color: "#52525b", padding: "24px", fontSize: "11px", fontFamily: "monospace" }}>
												LOADING DIRECTORY...
											</div>
										) : filteredDirectory.length === 0 ? (
											<div style={{ textAlign: "center", color: "#52525b", padding: "24px", fontSize: "11px", fontFamily: "monospace" }}>
												NO STAFF FOUND.
											</div>
										) : (
											filteredDirectory.map((staff) => (
												<button
													key={staff.opsUserId}
													type="button"
													onClick={() => {
														setShowDirectoryDrawer(false);
														setSearchQuery("");
														startDM(staff);
													}}
													style={staffCardBtnStyle}
												>
													<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
														<div style={{ position: "relative" }}>
															<span style={avatarPillStyle}>
																{staff.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
															</span>
															<span
																style={{
																	position: "absolute",
																	bottom: "0",
																	right: "0",
																	width: "8px",
																	height: "8px",
																	borderRadius: "0px",
																	background:
																		staff.presence === "available" ? "#10b981" :
																		staff.presence === "busy" ? "#ef4444" :
																		staff.presence === "on_leave" ? "#f59e0b" : "#a1a1aa",
																	border: "1px solid #ffffff",
																}}
															/>
														</div>
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
														{staff.presence.replace("_", " ").toUpperCase()}
													</span>
												</button>
											))
										)}
									</div>
								)}

								{/* Default View: WhatsApp Unified Thread Inbox */}
								{!showDirectoryDrawer && (
									<div style={{ flex: 1, overflowY: "auto" }}>
										{/* If searching, show filtered active chats + potential new contacts */}
										{searchQuery.trim() ? (
											<>
												{internalConversations
													.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()) || (c.lastMessage?.content || "").toLowerCase().includes(searchQuery.toLowerCase()))
													.map((c) => {
														const presence = staffPresenceMap.get(c.title.toLowerCase()) || "offline";
														return (
															<button
																key={c.id}
																type="button"
																onClick={() => openConversation(c)}
																style={activeChatRowStyle}
															>
																<div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
																	<div style={{ position: "relative" }}>
																		<span style={avatarPillStyle}>
																			{c.title.slice(0, 2).toUpperCase()}
																		</span>
																		<span
																			style={{
																				position: "absolute",
																				bottom: "0",
																				right: "0",
																				width: "8px",
																				height: "8px",
																				borderRadius: "0px",
																				background:
																					presence === "available" ? "#10b981" :
																					presence === "busy" ? "#ef4444" :
																					presence === "on_leave" ? "#f59e0b" : "#a1a1aa",
																				border: "1px solid #ffffff",
																			}}
																		/>
																	</div>
																	<div style={{ textAlign: "left", flex: 1, minWidth: 0 }}>
																		<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
																			<div style={{ fontSize: "11px", fontWeight: 800, color: "#18181b", letterSpacing: "0.02em" }}>
																				{c.title.toUpperCase()}
																			</div>
																			<div style={{ fontSize: "10px", color: "#71717a", fontFamily: "monospace" }}>
																				{formatConvTime(c.updatedAt)}
																			</div>
																		</div>
																		<div style={{ fontSize: "11px", color: "#52525b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
																			{c.lastMessage?.content || "No messages yet"}
																		</div>
																	</div>
																</div>
																{c.unreadCount > 0 && <span style={unreadSquareBadgeInlineStyle}>{c.unreadCount}</span>}
															</button>
														);
													})}

												{/* Show colleagues matching search to start new DM */}
												{filteredDirectory.length > 0 && (
													<>
														<div style={sectionHeaderStyle}>START NEW CHAT WITH</div>
														{filteredDirectory.map((staff) => (
															<button
																key={staff.opsUserId}
																type="button"
																onClick={() => {
																	setSearchQuery("");
																	startDM(staff);
																}}
																style={staffCardBtnStyle}
															>
																<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
																	<span style={avatarPillStyle}>
																		{staff.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
																	</span>
																	<div style={{ textAlign: "left" }}>
																		<div style={{ fontWeight: 700, fontSize: "11px", color: "#000000" }}>
																			{staff.name.toUpperCase()}
																		</div>
																		<div style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>
																			{staff.role.toUpperCase()} · {(staff.branch || "").toUpperCase()}
																		</div>
																	</div>
																</div>
																<span style={{ fontSize: "10px", fontWeight: 700, color: "#18181b", border: "1px solid #18181b", padding: "2px 8px" }}>
																	CHAT
																</span>
															</button>
														))}
													</>
												)}
											</>
										) : internalConversations.length === 0 ? (
											<div style={{ textAlign: "center", padding: "48px 20px" }}>
												<div style={{ fontSize: "28px", marginBottom: "8px" }}>💬</div>
												<p style={{ fontWeight: 800, fontSize: "13px", color: "#18181b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
													No Active Conversations
												</p>
												<p style={{ fontSize: "11px", color: "#71717a", marginTop: "4px", marginBottom: "16px", maxWidth: "260px", margin: "4px auto 16px auto" }}>
													Start a direct message session with any team member across all branches.
												</p>
												<button
													type="button"
													className="btn btn--primary"
													style={{ fontSize: "11px", padding: "8px 16px" }}
													onClick={() => setShowDirectoryDrawer(true)}
												>
													+ Start a Conversation
												</button>
											</div>
										) : (
											<>
												{internalConversations.map((c) => {
													const presence = staffPresenceMap.get(c.title.toLowerCase()) || "offline";
													return (
														<button
															key={c.id}
															type="button"
															onClick={() => openConversation(c)}
															style={activeChatRowStyle}
														>
															<div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
																<div style={{ position: "relative", flexShrink: 0 }}>
																	<span style={avatarPillStyle}>
																		{c.title.slice(0, 2).toUpperCase()}
																	</span>
																	<span
																		style={{
																			position: "absolute",
																			bottom: "0",
																			right: "0",
																			width: "8px",
																			height: "8px",
																			borderRadius: "0px",
																			background:
																				presence === "available" ? "#10b981" :
																				presence === "busy" ? "#ef4444" :
																				presence === "on_leave" ? "#f59e0b" : "#a1a1aa",
																			border: "1px solid #ffffff",
																		}}
																	/>
																</div>
																<div style={{ textAlign: "left", flex: 1, minWidth: 0 }}>
																	<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
																		<div style={{ fontSize: "11px", fontWeight: 800, color: "#18181b", letterSpacing: "0.02em" }}>
																			{c.title.toUpperCase()}
																		</div>
																		<div style={{ fontSize: "10px", color: "#71717a", fontFamily: "monospace" }}>
																			{formatConvTime(c.updatedAt)}
																		</div>
																	</div>
																	<div style={{ fontSize: "11px", color: c.unreadCount > 0 ? "#18181b" : "#52525b", fontWeight: c.unreadCount > 0 ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
																		{c.lastMessage?.content || "No messages yet"}
																	</div>
																</div>
															</div>
															{c.unreadCount > 0 && <span style={unreadSquareBadgeInlineStyle}>{c.unreadCount}</span>}
														</button>
													);
												})}
											</>
										)}
									</div>
								)}
							</div>
						)}

						{/* Mode 2: External Client Case Chats */}
						{mode === "external" && !activeConvId && (
							<div style={directoryContainerStyle}>
								<div style={sectionHeaderStyle}>ASSIGNED CLIENT CHATS</div>
								<div style={{ flex: 1, overflowY: "auto" }}>
									{convsLoading ? (
										<div style={{ textAlign: "center", color: "#52525b", padding: "20px", fontSize: "11px", fontFamily: "monospace" }}>
											LOADING CLIENT CHATS...
										</div>
									) : externalConversations.length === 0 ? (
										<div style={{ textAlign: "center", color: "#52525b", padding: "40px 20px" }}>
											<p style={{ fontWeight: 800, color: "#000000", fontSize: "12px", letterSpacing: "0.04em", textTransform: "uppercase" }}>NO ACTIVE CLIENT CHATS</p>
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
												<div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
													<span style={{ ...avatarPillStyle, flexShrink: 0 }}>
														{c.title.slice(0, 2).toUpperCase()}
													</span>
													<div style={{ textAlign: "left", flex: 1, minWidth: 0 }}>
														<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
															<div style={{ fontWeight: 800, fontSize: "11px", color: "#000000", letterSpacing: "0.02em" }}>
																{c.title.toUpperCase()}
															</div>
															<div style={{ fontSize: "10px", color: "#71717a", fontFamily: "monospace" }}>
																{formatConvTime(c.updatedAt)}
															</div>
														</div>
														<div style={{ fontSize: "11px", color: c.unreadCount > 0 ? "#18181b" : "#52525b", fontWeight: c.unreadCount > 0 ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
															{c.lastMessage?.content || "No messages yet"}
														</div>
													</div>
												</div>
												<div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px", flexShrink: 0 }}>
													<span style={stagePillMiniStyle}>{c.type.toUpperCase()}</span>
													{c.unreadCount > 0 && <span style={unreadSquareBadgeInlineStyle}>{c.unreadCount}</span>}
												</div>
											</button>
										))
									)}
								</div>
							</div>
						)}

						{/* The staff assistant — Tier 2. Console routes in its replies
						    are linkified so "Open → /helpdesk" actually takes you there. */}
						{mode === "ai" && (
							<div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
								<div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
									{ai.messages.map((m) => (
										<div key={m.id} style={m.role === "user" ? aiUserBubbleStyle : aiBotBubbleStyle}>
											{m.role === "assistant" && <span style={aiWhoStyle}>OPS AI</span>}
											{m.role === "assistant" ? renderAiText(m.content, navigate, () => setOpen(false)) : m.content}
											{m.role === "assistant" && !m.content && <span style={{ color: "#71717a" }}>…</span>}
										</div>
									))}
								</div>
								{/* Same Composer as every other chat surface — one input
								    and send affordance across the platform. */}
								<Composer
									value={aiDraft}
									onChange={setAiDraft}
									onSend={(t) => {
										setAiDraft("");
										void ai.send(t);
									}}
									sending={ai.typing}
									placeholder="Ask about the console, a workflow, the code…"
								/>
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
								onQuoteClick={(messageId) => {
									const el = document.getElementById(`msg-${messageId}`);
									if (el) {
										el.scrollIntoView({ behavior: "smooth", block: "center" });
										el.classList.add("cn-chat-highlight-pulse");
										setTimeout(() => el.classList.remove("cn-chat-highlight-pulse"), 1800);
									}
								}}
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

/* Launcher cluster — the portal hub's grammar: the FAB sits in a dock
   with a dismissible peek card of the latest inbound message above it. */
const launcherDockStyle: CSSProperties = {
	position: "fixed",
	bottom: "24px",
	right: "24px",
	zIndex: 9999,
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-end",
	gap: "10px",
};

const peekStyle: CSSProperties = {
	position: "relative",
	maxWidth: "15rem",
	textAlign: "left",
	background: "#18181b",
	color: "#ffffff",
	fontSize: "11px",
	lineHeight: 1.45,
	padding: "9px 26px 9px 13px",
	border: "none",
	cursor: "pointer",
	boxShadow: "3px 3px 0 rgba(0,0,0,0.2)",
};

const peekWhoStyle: CSSProperties = {
	display: "block",
	fontFamily: "monospace",
	fontSize: "9px",
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.1em",
	opacity: 0.6,
	marginBottom: "3px",
};

const peekCloseStyle: CSSProperties = {
	position: "absolute",
	top: "4px",
	right: "6px",
	fontSize: "10px",
	opacity: 0.55,
	cursor: "pointer",
	padding: "2px",
};

const launcherSquareBtnStyle: CSSProperties = {
	position: "relative",
	width: "52px",
	height: "52px",
	background: "#18181b",
	color: "#ffffff",
	border: "1.5px solid #18181b",
	borderRadius: "0px",
	boxShadow: "3px 3px 0 rgba(0,0,0,0.2)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	transition: "transform 0.15s ease",
};

const unreadSquareBadgeStyle: CSSProperties = {
	position: "absolute",
	top: "-7px",
	right: "-7px",
	minWidth: "18px",
	height: "18px",
	background: "#dc2626",
	color: "#ffffff",
	fontSize: "9.5px",
	fontWeight: 800,
	fontFamily: "monospace",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0 4px",
	border: "1.5px solid #ffffff",
	borderRadius: "0px",
};

const windowContainerStyle: CSSProperties = {
	position: "fixed",
	bottom: "24px",
	right: "24px",
	zIndex: 9999,
	width: "370px",
	height: "min(600px, calc(100dvh - 48px))",
	background: "#ffffff",
	border: "1.5px solid #18181b",
	borderRadius: "0px",
	boxShadow: "5px 5px 0 rgba(0,0,0,0.15)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	color: "#18181b",
	transition: "width 0.2s ease, height 0.2s ease, transform 0.2s ease",
};

const windowExpandedStyle: CSSProperties = {
	width: "min(800px, calc(100vw - 48px))",
	maxWidth: "calc(100vw - 48px)",
};

const headerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "10px",
	padding: "10px 14px",
	background: "#ffffff",
	borderBottom: "1.5px solid #18181b",
	flexShrink: 0,
};

/* Avatar square + who block — the portal header's "who you're talking to". */
const hubAvatarStyle: CSSProperties = {
	width: "30px",
	height: "30px",
	flexShrink: 0,
	background: "#18181b",
	color: "#ffffff",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	fontFamily: "monospace",
	fontSize: "10px",
	fontWeight: 700,
};

const hubNameStyle: CSSProperties = {
	fontSize: "13px",
	fontWeight: 700,
	lineHeight: 1.15,
	fontFamily: "system-ui, -apple-system, sans-serif",
};

const hubSubStyle: CSSProperties = {
	fontFamily: "monospace",
	fontSize: "9px",
	fontWeight: 700,
	letterSpacing: "0.08em",
	color: "#71717a",
	marginTop: "2px",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	display: "flex",
	alignItems: "center",
	gap: "4px",
};

const presenceSqStyle: CSSProperties = {
	display: "inline-block",
	width: "6px",
	height: "6px",
	flexShrink: 0,
};

/* Context strip — the muted mono band under the channel tabs. */
const stripStyle: CSSProperties = {
	padding: "6px 14px",
	background: "#f4f4f5",
	borderBottom: "1px solid #e4e4e7",
	fontFamily: "monospace",
	fontSize: "9px",
	fontWeight: 700,
	color: "#71717a",
	letterSpacing: "0.08em",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "8px",
	flexShrink: 0,
};

const stripLinkStyle: CSSProperties = {
	background: "none",
	border: "none",
	padding: 0,
	flexShrink: 0,
	fontFamily: "monospace",
	fontSize: "9px",
	fontWeight: 700,
	letterSpacing: "0.08em",
	color: "#18181b",
	textDecoration: "underline",
	cursor: "pointer",
};

const presenceSelectStyle: CSSProperties = {
	background: "#ffffff",
	color: "#18181b",
	border: "1px solid #e4e4e7",
	borderRadius: "0px",
	fontSize: "9px",
	fontWeight: 700,
	fontFamily: "monospace",
	letterSpacing: "0.08em",
	padding: "3px 5px",
	outline: "none",
	flexShrink: 0,
};

const controlBtnStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	color: "#52525b",
	width: "26px",
	height: "26px",
	borderRadius: "0px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	fontSize: "13px",
	transition: "background 0.2s ease, color 0.2s ease",
};

const channelNavStyle: CSSProperties = {
	display: "flex",
	borderBottom: "1.5px solid #18181b",
	background: "#ffffff",
	flexShrink: 0,
};

const channelBtnStyle: CSSProperties = {
	flex: 1,
	padding: "10px 4px",
	background: "transparent",
	border: "none",
	borderRight: "1px solid #f4f4f5",
	color: "#71717a",
	fontSize: "10px",
	fontWeight: 700,
	fontFamily: "monospace",
	textTransform: "uppercase",
	letterSpacing: "0.09em",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "6px",
	cursor: "pointer",
	transition: "color 0.2s ease",
};

const activeChannelBtnStyle: CSSProperties = {
	color: "#18181b",
	boxShadow: "inset 0 -2.5px 0 #18181b",
};

const tabCountChipStyle: CSSProperties = {
	minWidth: "15px",
	height: "15px",
	background: "#dc2626",
	color: "#ffffff",
	fontSize: "8.5px",
	fontWeight: 800,
	fontFamily: "monospace",
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0 3px",
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
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	borderRadius: "0px",
	color: "#18181b",
	padding: "8px 10px",
	fontSize: "12px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	outline: "none",
	boxSizing: "border-box",
	transition: "border 0.2s ease",
};

const sectionHeaderStyle: CSSProperties = {
	padding: "9px 14px 3px",
	background: "#ffffff",
	color: "#71717a",
	fontSize: "9px",
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.12em",
	fontFamily: "monospace",
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
	width: "34px",
	height: "34px",
	borderRadius: "0px",
	background: "#18181b",
	color: "#ffffff",
	fontWeight: 700,
	fontSize: "10px",
	fontFamily: "monospace",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	border: "none",
	flexShrink: 0,
};

const presenceBadgeStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	fontWeight: 700,
	letterSpacing: "0.05em",
	color: "#52525b",
	background: "#f4f4f5",
	border: "none",
	padding: "2px 6px",
	borderRadius: "0px",
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
	minWidth: "15px",
	height: "15px",
	background: "#dc2626",
	color: "#ffffff",
	fontSize: "8.5px",
	fontWeight: 800,
	fontFamily: "monospace",
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0 3px",
	marginLeft: 6,
	flexShrink: 0,
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

/* ── AI channel ─────────────────────────────────────────────────────────── */

/** Linkify console routes (`/helpdesk`) in assistant replies to real navigation. */
function renderAiText(text: string, navigate: (path: string) => void, close: () => void) {
	return text.split(/(\s+)/).map((tok, i) => {
		const path = tok.replace(/[.,;:!?'"()\]]+$/, "");
		if (!/^\/[a-z][a-z0-9\-/]*$/i.test(path)) return <span key={i}>{tok}</span>;
		const trail = tok.slice(path.length);
		return (
			<span key={i}>
				<button
					type="button"
					onClick={() => {
						close();
						navigate(path);
					}}
					style={aiLinkStyle}
				>
					{path}
				</button>
				{trail}
			</span>
		);
	});
}

const aiUserBubbleStyle: CSSProperties = {
	alignSelf: "flex-end",
	background: "#18181b",
	color: "#ffffff",
	padding: "6px 10px",
	fontSize: "12px",
	maxWidth: "88%",
	lineHeight: 1.45,
	whiteSpace: "pre-wrap",
};

const aiBotBubbleStyle: CSSProperties = {
	alignSelf: "flex-start",
	background: "#f4f4f5",
	border: "1px solid #e4e4e7",
	padding: "6px 10px",
	fontSize: "12px",
	maxWidth: "92%",
	lineHeight: 1.5,
	color: "#18181b",
	whiteSpace: "pre-wrap",
};

const aiWhoStyle: CSSProperties = {
	display: "block",
	fontFamily: "monospace",
	fontSize: "9px",
	fontWeight: 800,
	letterSpacing: "0.1em",
	color: "#b45309",
	marginBottom: "3px",
};

const aiLinkStyle: CSSProperties = {
	background: "none",
	border: "none",
	borderBottom: "1px solid #e8a33d",
	color: "#b45309",
	fontFamily: "monospace",
	fontSize: "11px",
	fontWeight: 700,
	padding: 0,
	cursor: "pointer",
};
