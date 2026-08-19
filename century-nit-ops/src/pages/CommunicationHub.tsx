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
import { useOpsAuth, type OpsRole } from "./OpsAuthContext";
import { roleCanAccess } from "century-nit-shared";

/**
 * OPS Staff Communication Workstation — Strict Brutalist Monochrome Design.
 *
 * Rules:
 *   - Strict 0px border-radius (no rounded corners).
 *   - Pure monochrome palette (#000000, #09090b, #18181b, #27272a, #ffffff).
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

	const { conversations, loading: convsLoading, refresh: refreshConvs } = useChatConversations();
	const { messages, loading: msgsLoading, sending, load, send, markRead } =
		useChatMessages(activeConvId);

	/* ── Presence heartbeat ── */
	useEffect(() => {
		if (!roleCanAccess(opsRole as OpsRole, "chat")) return;
		void communicationHeartbeat().catch(() => {});
		const id = setInterval(() => {
			void communicationHeartbeat().catch(() => {});
		}, HEARTBEAT_MS);
		return () => clearInterval(id);
	}, [opsRole]);

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
							<span style={indicatorDotStyle} />
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
								<div style={{ padding: "8px 10px", borderBottom: "1px solid #27272a" }}>
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
									<div style={{ borderBottom: "1px solid #27272a" }}>
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
															<div style={{ fontSize: "11px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "0.02em" }}>
																{c.title.toUpperCase()}
															</div>
															<div style={{ fontSize: "10px", color: "#71717a", fontFamily: "monospace" }}>
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
										<div style={{ textAlign: "center", color: "#71717a", padding: "20px", fontSize: "11px", fontFamily: "monospace" }}>
											LOADING DIRECTORY...
										</div>
									) : filteredDirectory.length === 0 ? (
										<div style={{ textAlign: "center", color: "#71717a", padding: "20px", fontSize: "11px", fontFamily: "monospace" }}>
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
														<div style={{ fontWeight: 700, fontSize: "11px", color: "#f4f4f5", letterSpacing: "0.02em" }}>
															{staff.name.toUpperCase()}
														</div>
														<div style={{ fontSize: "10px", color: "#a1a1aa", fontFamily: "monospace" }}>
															{staff.role.toUpperCase()} · {(staff.branch || "").toUpperCase()}
														</div>
													</div>
												</div>
												<span style={presenceBadgeStyle}>{staff.presence.toUpperCase()}</span>
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
										<div style={{ textAlign: "center", color: "#71717a", padding: "20px", fontSize: "11px", fontFamily: "monospace" }}>
											LOADING CLIENT CHATS...
										</div>
									) : externalConversations.length === 0 ? (
										<div style={{ textAlign: "center", color: "#71717a", padding: "40px 20px" }}>
											<p style={{ fontWeight: 700, color: "#f4f4f5", fontSize: "12px", letterSpacing: "0.04em" }}>NO ACTIVE CLIENT CHATS</p>
											<p style={{ fontSize: "11px", color: "#a1a1aa", marginTop: "4px" }}>
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
														<div style={{ fontWeight: 700, fontSize: "11px", color: "#f4f4f5", letterSpacing: "0.02em" }}>
															{c.title.toUpperCase()}
														</div>
														<div style={{ fontSize: "10px", color: "#a1a1aa", fontFamily: "monospace" }}>
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
										<div style={{ fontSize: "9px", color: "#71717a", fontFamily: "monospace" }}>
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
										<div style={{ textAlign: "center", color: "#71717a", padding: "40px 20px" }}>
											<p style={{ fontSize: "12px", color: "#f4f4f5", fontWeight: 700 }}>SESSION STARTED</p>
											<p style={{ fontSize: "10px", color: "#a1a1aa", marginTop: "4px", fontFamily: "monospace" }}>
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
										<div style={{ textAlign: "center", color: "#71717a", fontSize: "10px", padding: "10px", fontFamily: "monospace" }}>
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
	width: "48px",
	height: "48px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	background: "#000000",
	color: "#ffffff",
	border: "1px solid #27272a",
	borderRadius: "0px",
	boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
	cursor: "pointer",
};

const unreadSquareBadgeStyle: CSSProperties = {
	position: "absolute",
	top: "-6px",
	right: "-6px",
	background: "#ffffff",
	color: "#000000",
	fontSize: "10px",
	fontWeight: 800,
	fontFamily: "monospace",
	padding: "1px 5px",
	border: "1px solid #000000",
	borderRadius: "0px",
};

const windowContainerStyle: CSSProperties = {
	position: "fixed",
	bottom: "84px",
	right: "24px",
	zIndex: 9999,
	width: "420px",
	height: "600px",
	maxHeight: "calc(100vh - 100px)",
	background: "#09090b",
	border: "1px solid #27272a",
	borderRadius: "0px",
	boxShadow: "0 25px 50px rgba(0,0,0,0.9)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	color: "#fafafa",
	transition: "width 0.2s ease, height 0.2s ease",
};

const windowExpandedStyle: CSSProperties = {
	width: "880px",
	height: "660px",
	maxWidth: "calc(100vw - 48px)",
};

const headerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "10px 14px",
	background: "#000000",
	borderBottom: "1px solid #27272a",
};

const indicatorDotStyle: CSSProperties = {
	width: "6px",
	height: "6px",
	background: "#ffffff",
	borderRadius: "0px",
};

const headerTitleStyle: CSSProperties = {
	fontSize: "11px",
	fontWeight: 700,
	letterSpacing: "0.08em",
	fontFamily: "monospace",
	color: "#ffffff",
};

const presenceSelectStyle: CSSProperties = {
	background: "#121215",
	color: "#fafafa",
	border: "1px solid #27272a",
	borderRadius: "0px",
	fontSize: "10px",
	fontFamily: "monospace",
	padding: "3px 6px",
	outline: "none",
};

const controlBtnStyle: CSSProperties = {
	background: "transparent",
	border: "1px solid #27272a",
	color: "#a1a1aa",
	width: "24px",
	height: "24px",
	borderRadius: "0px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	fontSize: "11px",
};

const channelNavStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "1fr 1fr",
	borderBottom: "1px solid #27272a",
	background: "#000000",
};

const channelBtnStyle: CSSProperties = {
	padding: "10px 8px",
	background: "transparent",
	border: "none",
	borderBottom: "2px solid transparent",
	color: "#71717a",
	fontSize: "11px",
	fontWeight: 700,
	letterSpacing: "0.06em",
	fontFamily: "monospace",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "4px",
	cursor: "pointer",
	borderRadius: "0px",
};

const activeChannelBtnStyle: CSSProperties = {
	color: "#ffffff",
	borderBottomColor: "#ffffff",
	background: "#121215",
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
	width: "100%",
	background: "#121215",
	border: "1px solid #27272a",
	borderRadius: "0px",
	color: "#fafafa",
	padding: "6px 10px",
	fontSize: "11px",
	fontFamily: "monospace",
	outline: "none",
	boxSizing: "border-box",
};

const sectionHeaderStyle: CSSProperties = {
	padding: "6px 10px",
	background: "#000000",
	color: "#71717a",
	fontSize: "9px",
	fontWeight: 700,
	letterSpacing: "0.08em",
	fontFamily: "monospace",
	borderBottom: "1px solid #1c1c1f",
};

const activeChatRowStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "8px 10px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #1c1c1f",
	borderRadius: "0px",
	cursor: "pointer",
	textAlign: "left",
};

const staffCardBtnStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "8px 10px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #1c1c1f",
	borderRadius: "0px",
	cursor: "pointer",
};

const clientChatCardBtnStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "10px 12px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #1c1c1f",
	borderRadius: "0px",
	cursor: "pointer",
};

const avatarPillStyle: CSSProperties = {
	width: "28px",
	height: "28px",
	borderRadius: "0px",
	background: "#ffffff",
	color: "#000000",
	fontWeight: 800,
	fontSize: "11px",
	fontFamily: "monospace",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const avatarMiniStyle: CSSProperties = {
	width: "24px",
	height: "24px",
	borderRadius: "0px",
	background: "#27272a",
	color: "#ffffff",
	fontWeight: 700,
	fontSize: "10px",
	fontFamily: "monospace",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const presenceBadgeStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	color: "#a1a1aa",
	background: "#121215",
	border: "1px solid #27272a",
	padding: "2px 5px",
	borderRadius: "0px",
};

const stagePillMiniStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	fontWeight: 700,
	color: "#a1a1aa",
	background: "#000000",
	border: "1px solid #27272a",
	padding: "2px 5px",
	borderRadius: "0px",
};

const unreadSquareBadgeInlineStyle: CSSProperties = {
	background: "#ffffff",
	color: "#000000",
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
	padding: "8px 12px",
	background: "#121215",
	borderBottom: "1px solid #27272a",
};

const backBtnStyle: CSSProperties = {
	background: "transparent",
	border: "1px solid #27272a",
	color: "#fafafa",
	padding: "3px 6px",
	borderRadius: "0px",
	fontSize: "10px",
	fontFamily: "monospace",
	cursor: "pointer",
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
	maxWidth: "80%",
	padding: "8px 12px",
	borderRadius: "0px",
	fontSize: "12px",
};

const myBubbleStyle: CSSProperties = {
	background: "#ffffff",
	color: "#000000",
	border: "1px solid #ffffff",
};

const theirBubbleStyle: CSSProperties = {
	background: "#18181b",
	color: "#f4f4f5",
	border: "1px solid #27272a",
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
	padding: "8px 10px",
	background: "#000000",
	borderTop: "1px solid #27272a",
	gap: "6px",
};

const inputStyle: CSSProperties = {
	flex: 1,
	background: "#121215",
	border: "1px solid #27272a",
	borderRadius: "0px",
	color: "#fafafa",
	padding: "8px 10px",
	fontSize: "12px",
	outline: "none",
};

const sendBtnStyle: CSSProperties = {
	background: "#ffffff",
	color: "#000000",
	border: "none",
	borderRadius: "0px",
	padding: "8px 14px",
	fontWeight: 700,
	fontSize: "11px",
	fontFamily: "monospace",
	letterSpacing: "0.05em",
	cursor: "pointer",
};

const errorBannerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	background: "#27272a",
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
