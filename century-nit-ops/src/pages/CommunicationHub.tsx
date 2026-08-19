import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
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
import { roleCanAccess } from "century-nit-shared";

/**
 * OPS Staff Communication Workstation — Strict Brutalist Monochrome Design.
 *
 * Rules:
 *   - Strict 0px border-radius (no rounded corners).
 *   - Pure monochrome palette (#000000, #ffffff, #000000, #e4e4e7, #ffffff).
 *   - Floating trigger: Square icon button with pure SVG chat icon (no text labels, no emojis).
 *   - 2 Modes: INTERNAL (Staff DMs with 1-on-1 isolation), EXTERNAL (Client threads).
 *   - Expandable Workstation: Standard 420px floating window <-> 880px widescreen workspace.
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
	const { messages, loading: msgsLoading, sending, load, send, markRead } =
		useChatMessages(canChat ? activeConvId : null);

	/* ── Presence heartbeat ── */
	useEffect(() => {
		if (!canChat) return;
		let id: ReturnType<typeof setInterval> | undefined;
		const beat = async () => {
			try {
				await communicationHeartbeat();
			} catch (e) {
				// 403 = role/MFA won't change mid-session; stop pinging.
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
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't load staff directory");
		} finally {
			setDirLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open && mode === "internal") void loadDirectory();
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
	// Internal: Direct 1-on-1 staff conversations
	const internalConversations = useMemo(() => {
		return conversations
			.filter((c) => c.type === "direct" || c.type === "group" || c.type === "internal")
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}, [conversations]);

	// External: Client applicant conversations
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
			void load();
			void markRead();
			void refreshConvs();
		},
		[load, markRead, refreshConvs],
	);

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

	/* ── Send message ── */
	const [draft, setDraft] = useState("");
	const onSend = useCallback(
		async (e: FormEvent) => {
			e.preventDefault();
			if (!draft.trim() || !activeConvId || sending) return;
			const text = draft.trim();
			try {
				await send(text);
				setDraft("");
				void refreshConvs();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to send message");
			}
		},
		[draft, activeConvId, sending, send, refreshConvs],
	);

	const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

	const filteredDirectory = useMemo(() => {
		if (!searchQuery.trim()) return directory;
		const q = searchQuery.toLowerCase();
		return directory.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.role.toLowerCase().includes(q) ||
				(s.branch || "").toLowerCase().includes(q),
		);
	}, [directory, searchQuery]);

	return (
		<>
			{/* Floating Square Launcher Button (Pure SVG icon, 0px border-radius) */}
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
				<div style={{ ...windowContainerStyle, ...(expanded ? windowExpandedStyle : {}) }}>
					{/* Header */}
					<header style={headerStyle}>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<span style={{ ...indicatorDotStyle, background: presenceStatus === "available" ? "#10b981" : presenceStatus === "busy" ? "#ef4444" : presenceStatus === "on_leave" ? "#f59e0b" : "#71717a" }} />
							<span style={headerTitleStyle}>OPS CHAT</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
							{/* Presence Selector */}
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
												<span style={{ ...presenceBadgeStyle, color: "#ffffff", border: "none", background: staff.presence === "available" ? "#10b981" : staff.presence === "busy" ? "#ef4444" : staff.presence === "on_leave" ? "#f59e0b" : "#71717a" }}>{staff.presence.toUpperCase()}</span>
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
							<div style={streamContainerStyle}>
								{/* Header */}
								<div style={threadHeaderStyle}>
									<button
										type="button"
										onClick={() => setActiveConvId(null)}
										style={backBtnStyle}
									>
										[ BACK ]
									</button>
									<div>
										<div style={{ fontWeight: 700, fontSize: "12px", color: "#ffffff", letterSpacing: "0.04em" }}>
											{activeConv?.title.toUpperCase() || "CONVERSATION"}
										</div>
										<div style={{ fontSize: "9px", color: "#52525b", fontFamily: "monospace" }}>
											{mode === "internal" ? "ISOLATED STAFF THREAD" : "CLIENT CASE THREAD"}
										</div>
									</div>
									<span style={stagePillMiniStyle}>
										{mode === "internal" ? "DIRECT" : "CLIENT"}
									</span>
								</div>

								{/* Messages Stream */}
								<div style={messageListStyle}>
									{messages.length === 0 && !msgsLoading && (
										<div style={{ textAlign: "center", color: "#52525b", padding: "40px 20px" }}>
											<p style={{ fontSize: "12px", color: "#000000", fontWeight: 700 }}>SESSION STARTED</p>
											<p style={{ fontSize: "10px", color: "#52525b", marginTop: "4px", fontFamily: "monospace" }}>
												Messages sent here are isolated to participants.
											</p>
										</div>
									)}
									{messages.map((m) => {
										const isMe = m.senderName === opsUser?.name || m.senderName === "You";
										return (
											<div
												key={m.id}
												style={{
													...messageRowStyle,
													justifyContent: isMe ? "flex-end" : "flex-start",
												}}
											>
												<div
													style={{
														...messageBubbleStyle,
														...(isMe ? myBubbleStyle : theirBubbleStyle),
													}}
												>
													<div style={bubbleAuthorStyle}>{isMe ? "YOU" : m.senderName.toUpperCase()}</div>
													<div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.content}</div>
													<div style={bubbleTimeStyle}>
														{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</div>
												</div>
											</div>
										);
									})}
									{msgsLoading && (
										<div style={{ textAlign: "center", color: "#52525b", fontSize: "10px", padding: "10px", fontFamily: "monospace" }}>
											LOADING MESSAGES...
										</div>
									)}
								</div>

								{/* Send Form */}
								<form onSubmit={onSend} style={formStyle}>
									<input
										type="text"
										value={draft}
										onChange={(e) => setDraft(e.target.value)}
										placeholder={`Reply to ${activeConv?.title || "thread"}...`}
										style={inputStyle}
										disabled={sending}
									/>
									<button type="submit" disabled={!draft.trim() || sending} style={sendBtnStyle}>
										{sending ? "..." : "SEND"}
									</button>
								</form>
							</div>
						)}
					</div>
				</div>
			)}
		</>
	);
}

/* ── Strict Brutalist Styles for OPS Hub ───────────────────────────────── */

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
	width: "360px",
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
	width: "800px",
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
	color: "#000000",
	border: "2px solid #000000",
	borderRadius: "0px",
	fontSize: "11px",
	fontWeight: 800,
	fontFamily: "monospace",
	padding: "4px 8px",
	outline: "none",
};

const controlBtnStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	color: "#71717a",
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
	background: "#fafafa",
};

const channelBtnStyle: CSSProperties = {
	padding: "12px 8px",
	background: "transparent",
	border: "none",
	borderBottom: "2px solid transparent",
	color: "#71717a",
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
	background: "#ffffff",
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
	color: "#a1a1aa",
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
	background: "#fafafa",
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
	justifyContent: "space-between",
	padding: "12px 16px",
	background: "#ffffff",
	borderBottom: "1px solid #f4f4f5",
};

const backBtnStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	color: "#71717a",
	padding: "6px",
	borderRadius: "50%",
	fontSize: "14px",
	cursor: "pointer",
	transition: "background 0.2s ease, color 0.2s ease",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const messageListStyle: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "12px",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
};

const messageRowStyle: CSSProperties = {
	display: "flex",
	width: "100%",
};

const messageBubbleStyle: CSSProperties = {
	maxWidth: "75%",
	padding: "10px 14px",
	fontSize: "13px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	lineHeight: "1.4",
};

const myBubbleStyle: CSSProperties = {
	background: "#18181b",
	color: "#ffffff",
	border: "none",
	borderRadius: "16px 16px 4px 16px",
};

const theirBubbleStyle: CSSProperties = {
	background: "#f4f4f5",
	color: "#18181b",
	border: "none",
	borderRadius: "16px 16px 16px 4px",
};

const bubbleAuthorStyle: CSSProperties = {
	fontSize: "9px",
	fontWeight: 700,
	fontFamily: "monospace",
	letterSpacing: "0.06em",
	opacity: 0.6,
	marginBottom: "4px",
};

const bubbleTimeStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	opacity: 0.5,
	marginTop: "4px",
	textAlign: "right",
};

const formStyle: CSSProperties = {
	display: "flex",
	padding: "12px 16px",
	background: "#ffffff",
	borderTop: "1px solid #f4f4f5",
	gap: "10px",
	alignItems: "center",
};

const inputStyle: CSSProperties = {
	flex: 1,
	background: "#f4f4f5",
	border: "1px solid transparent",
	borderRadius: "20px",
	color: "#18181b",
	padding: "10px 16px",
	fontSize: "13px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	outline: "none",
	transition: "background 0.2s ease",
};

const sendBtnStyle: CSSProperties = {
	background: "#18181b",
	color: "#ffffff",
	border: "none",
	borderRadius: "50%",
	width: "36px",
	height: "36px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	transition: "transform 0.1s ease, background 0.2s ease",
};

const errorBannerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	background: "#e4e4e7",
	color: "#ffffff",
	padding: "6px 10px",
	fontSize: "10px",
	fontFamily: "monospace",
	borderBottom: "1px solid #3f3f46",
};

const errorCloseStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	color: "#ffffff",
	cursor: "pointer",
	fontWeight: 700,
};
