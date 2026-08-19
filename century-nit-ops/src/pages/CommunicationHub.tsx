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
 * OPS Staff Communication Hub — Floating & Expandable Monochrome Workstation.
 *
 * Conforms strictly to the Century NIT Monochrome Design System.
 * Features:
 *   1. Internal Mode — Staff Directory with live presence indicators.
 *      Clicking any staff member opens a private 1-on-1 isolated DM session.
 *   2. External Mode — Assigned Client Case Conversations from the applicant portal.
 *   3. Dual Viewport — Standard floating card (420px) & Expanded 2-column workstation (880px).
 */

const HEARTBEAT_MS = 60_000;

type Mode = "internal" | "external";

const PRESENCE_DOT: Record<StaffPresence, string> = {
	available: "#10b981",
	busy: "#f59e0b",
	on_leave: "#a78bfa",
	offline: "#71717a",
};

const PRESENCE_LABEL: Record<StaffPresence, string> = {
	available: "Available",
	busy: "Busy",
	on_leave: "On leave",
	offline: "Offline",
};

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
			{/* Floating Launcher Button */}
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				style={launcherStyle}
				aria-label="Open OPS Communication Hub"
			>
				<span style={{ fontSize: "16px" }}>💬</span>
				<div style={launcherTextCol}>
					<span style={launcherTitleStyle}>OPS Communication</span>
					<span style={launcherSubtitleStyle}>
						{totalUnread > 0 ? `${totalUnread} Unread` : "Staff DMs & Client Threads"}
					</span>
				</div>
				{totalUnread > 0 && <span style={launcherBadgeStyle}>{totalUnread}</span>}
			</button>

			{/* Floating Hub Window */}
			{open && (
				<div style={{ ...windowContainerStyle, ...(expanded ? windowExpandedStyle : {}) }}>
					{/* Header */}
					<header style={headerStyle}>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<span style={{ width: "8px", height: "8px", borderRadius: "50%", background: PRESENCE_DOT[presenceStatus] }} />
							<div>
								<h2 style={headerTitleStyle}>OPS COMMUNICATION WORKSTATION</h2>
								<p style={headerSubtitleStyle}>STAFF DIRECT & CLIENT CHANNELS</p>
							</div>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
							{/* Presence Selector */}
							<select
								value={presenceStatus}
								onChange={(e) => changePresence(e.target.value as StaffPresence)}
								style={presenceSelectStyle}
								aria-label="Set my presence"
							>
								<option value="available">● Available</option>
								<option value="busy">● Busy</option>
								<option value="on_leave">● On leave</option>
								<option value="offline">● Offline</option>
							</select>
							<button
								type="button"
								onClick={() => setExpanded((prev) => !prev)}
								style={controlBtnStyle}
								title={expanded ? "Restore down" : "Expand to widescreen"}
							>
								{expanded ? "⤡" : "⤢"}
							</button>
							<button
								type="button"
								onClick={() => setOpen(false)}
								style={controlBtnStyle}
								title="Close hub"
							>
								✕
							</button>
						</div>
					</header>

					{/* Navigation Switcher: Internal Staff DMs vs External Clients */}
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
							<span>🔒 Internal (Staff DMs)</span>
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
							<span>🌐 External (Clients)</span>
							{externalConversations.some((c) => c.unreadCount > 0) && (
								<span style={tabDotBadgeStyle} />
							)}
						</button>
					</nav>

					{/* Error Banner */}
					{error && (
						<div style={errorBannerStyle}>
							<span>⚠ {error}</span>
							<button type="button" onClick={() => setError(null)} style={errorCloseStyle}>✕</button>
						</div>
					)}

					{/* Hub Workspace */}
					<div style={expanded ? workspaceSplitStyle : workspaceStandardStyle}>
						{/* Mode 1: Internal Staff DMs */}
						{mode === "internal" && !activeConvId && (
							<div style={directoryContainerStyle}>
								{/* Search */}
								<div style={{ padding: "10px 12px", borderBottom: "1px solid #27272a" }}>
									<input
										type="text"
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										placeholder="Search colleagues by name, role or branch..."
										style={searchInputStyle}
									/>
								</div>

								{/* Active Direct Chats */}
								{internalConversations.length > 0 && !searchQuery && (
									<div style={{ borderBottom: "1px solid #27272a" }}>
										<div style={sectionHeaderStyle}>ACTIVE 1-ON-1 SESSIONS</div>
										<div style={{ maxHeight: "160px", overflowY: "auto" }}>
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
															<div style={{ fontSize: "12px", fontWeight: 600, color: "#f4f4f5" }}>
																{c.title}
															</div>
															<div style={{ fontSize: "11px", color: "#71717a", fontFamily: "monospace" }}>
																{c.lastMessage?.content.slice(0, 32) || "No messages yet"}
															</div>
														</div>
													</div>
													{c.unreadCount > 0 && <span style={unreadBadgeStyle}>{c.unreadCount}</span>}
												</button>
											))}
										</div>
									</div>
								)}

								{/* Full Staff Directory */}
								<div style={sectionHeaderStyle}>ALL STAFF MEMBERS (CLICK TO CHAT)</div>
								<div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
									{dirLoading ? (
										<div style={{ textAlign: "center", color: "#71717a", padding: "20px", fontSize: "12px" }}>
											Loading staff directory...
										</div>
									) : filteredDirectory.length === 0 ? (
										<div style={{ textAlign: "center", color: "#71717a", padding: "20px", fontSize: "12px" }}>
											No staff members found.
										</div>
									) : (
										filteredDirectory.map((staff) => (
											<button
												key={staff.opsUserId}
												type="button"
												onClick={() => startDM(staff)}
												style={staffCardBtnStyle}
											>
												<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
													<div style={{ position: "relative" }}>
														<span style={avatarPillStyle}>
															{staff.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
														</span>
														<span
															style={{
																...presenceDotMiniStyle,
																background: PRESENCE_DOT[staff.presence],
															}}
														/>
													</div>
													<div style={{ textAlign: "left" }}>
														<div style={{ fontWeight: 600, fontSize: "12px", color: "#f4f4f5" }}>
															{staff.name}
														</div>
														<div style={{ fontSize: "11px", color: "#a1a1aa", fontFamily: "monospace" }}>
															{staff.role} · {staff.branch}
														</div>
													</div>
												</div>
												<div style={{ textAlign: "right" }}>
													<span style={presenceBadgeStyle}>{PRESENCE_LABEL[staff.presence]}</span>
												</div>
											</button>
										))
									)}
								</div>
							</div>
						)}

						{/* Mode 2: External Client Case Chats */}
						{mode === "external" && !activeConvId && (
							<div style={directoryContainerStyle}>
								<div style={sectionHeaderStyle}>ASSIGNED APPLICANT CONVERSATIONS</div>
								<div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
									{convsLoading ? (
										<div style={{ textAlign: "center", color: "#71717a", padding: "20px", fontSize: "12px" }}>
											Loading client conversations...
										</div>
									) : externalConversations.length === 0 ? (
										<div style={{ textAlign: "center", color: "#71717a", padding: "40px 20px" }}>
											<p style={{ fontWeight: 600, color: "#e4e4e7", fontSize: "13px" }}>No Client Chats Assigned</p>
											<p style={{ fontSize: "12px", color: "#a1a1aa", marginTop: "4px" }}>
												When applicants send messages in their portal, their case threads appear here.
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
												<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
													<span style={avatarPillStyle}>
														{c.title.slice(0, 2).toUpperCase()}
													</span>
													<div style={{ textAlign: "left" }}>
														<div style={{ fontWeight: 600, fontSize: "12px", color: "#f4f4f5" }}>
															{c.title}
														</div>
														<div style={{ fontSize: "11px", color: "#a1a1aa", fontFamily: "monospace" }}>
															{c.lastMessage?.content.slice(0, 40) || "No messages yet"}
														</div>
													</div>
												</div>
												<div style={{ textAlign: "right" }}>
													<span style={stagePillMiniStyle}>{c.type.toUpperCase()}</span>
													{c.unreadCount > 0 && <span style={unreadBadgeStyle}>{c.unreadCount}</span>}
												</div>
											</button>
										))
									)}
								</div>
							</div>
						)}

						{/* Active Conversation Stream (Used for both 1-on-1 Staff DMs and Client Chats) */}
						{activeConvId && (
							<div style={streamContainerStyle}>
								{/* Conversation Header */}
								<div style={threadHeaderStyle}>
									<button
										type="button"
										onClick={() => setActiveConvId(null)}
										style={backBtnStyle}
									>
										← Back
									</button>
									<div>
										<div style={{ fontWeight: 700, fontSize: "13px", color: "#ffffff" }}>
											{activeConv?.title || "Conversation"}
										</div>
										<div style={{ fontSize: "10px", color: "#a1a1aa", fontFamily: "monospace" }}>
											{mode === "internal" ? "🔒 1-on-1 Private Staff Thread" : "🌐 Client Case Thread"}
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
											<p style={{ fontSize: "13px", color: "#e4e4e7" }}>Direct Session Started</p>
											<p style={{ fontSize: "11px", color: "#a1a1aa", marginTop: "4px" }}>
												Messages sent here are private and isolated between participants.
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
													<div style={bubbleAuthorStyle}>{isMe ? "You" : m.senderName}</div>
													<div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.content}</div>
													<div style={bubbleTimeStyle}>
														{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</div>
												</div>
											</div>
										);
									})}
									{msgsLoading && (
										<div style={{ textAlign: "center", color: "#71717a", fontSize: "11px", padding: "10px" }}>
											Loading messages...
										</div>
									)}
								</div>

								{/* Send Input */}
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
										{sending ? "..." : "Send ➔"}
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

/* ── Monochrome Styles for OPS Hub ─────────────────────────────────────── */

const launcherStyle: CSSProperties = {
	position: "fixed",
	bottom: "24px",
	right: "24px",
	zIndex: 9999,
	display: "flex",
	alignItems: "center",
	gap: "10px",
	padding: "10px 18px",
	background: "#09090b",
	color: "#ffffff",
	border: "1px solid #27272a",
	borderRadius: "9999px",
	boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
	cursor: "pointer",
};

const launcherTextCol: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	textAlign: "left",
};

const launcherTitleStyle: CSSProperties = {
	fontSize: "13px",
	fontWeight: 700,
	color: "#fafafa",
};

const launcherSubtitleStyle: CSSProperties = {
	fontSize: "11px",
	color: "#a1a1aa",
	fontFamily: "monospace",
};

const launcherBadgeStyle: CSSProperties = {
	background: "#dc2626",
	color: "#ffffff",
	fontSize: "11px",
	fontWeight: 700,
	padding: "2px 7px",
	borderRadius: "9999px",
	marginLeft: "4px",
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
	borderRadius: "8px",
	boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	color: "#fafafa",
	transition: "width 0.25s ease, height 0.25s ease",
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
	padding: "12px 16px",
	background: "#000000",
	borderBottom: "1px solid #27272a",
};

const headerTitleStyle: CSSProperties = {
	fontSize: "12px",
	fontWeight: 700,
	letterSpacing: "0.06em",
	margin: 0,
	color: "#ffffff",
};

const headerSubtitleStyle: CSSProperties = {
	fontSize: "9px",
	color: "#71717a",
	fontFamily: "monospace",
	margin: 0,
};

const presenceSelectStyle: CSSProperties = {
	background: "#18181b",
	color: "#fafafa",
	border: "1px solid #27272a",
	borderRadius: "4px",
	fontSize: "11px",
	padding: "4px 8px",
	outline: "none",
};

const controlBtnStyle: CSSProperties = {
	background: "transparent",
	border: "1px solid #27272a",
	color: "#a1a1aa",
	width: "26px",
	height: "26px",
	borderRadius: "4px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	fontSize: "12px",
};

const channelNavStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "1fr 1fr",
	borderBottom: "1px solid #27272a",
	background: "#09090b",
};

const channelBtnStyle: CSSProperties = {
	padding: "10px 8px",
	background: "transparent",
	border: "none",
	borderBottom: "2px solid transparent",
	color: "#71717a",
	fontSize: "12px",
	fontWeight: 600,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "6px",
	cursor: "pointer",
};

const activeChannelBtnStyle: CSSProperties = {
	color: "#ffffff",
	borderBottomColor: "#ffffff",
	background: "#18181b",
};

const tabDotBadgeStyle: CSSProperties = {
	width: "6px",
	height: "6px",
	borderRadius: "50%",
	background: "#dc2626",
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
	background: "#18181b",
	border: "1px solid #27272a",
	borderRadius: "4px",
	color: "#fafafa",
	padding: "8px 12px",
	fontSize: "12px",
	outline: "none",
	boxSizing: "border-box",
};

const sectionHeaderStyle: CSSProperties = {
	padding: "8px 12px",
	background: "#0c0c0e",
	color: "#71717a",
	fontSize: "10px",
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
	padding: "8px 12px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #1c1c1f",
	cursor: "pointer",
	textAlign: "left",
};

const staffCardBtnStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "10px 12px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #1c1c1f",
	borderRadius: "4px",
	cursor: "pointer",
};

const clientChatCardBtnStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "12px 14px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #1c1c1f",
	cursor: "pointer",
};

const avatarPillStyle: CSSProperties = {
	width: "32px",
	height: "32px",
	borderRadius: "4px",
	background: "#ffffff",
	color: "#000000",
	fontWeight: 800,
	fontSize: "12px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const avatarMiniStyle: CSSProperties = {
	width: "26px",
	height: "26px",
	borderRadius: "4px",
	background: "#27272a",
	color: "#ffffff",
	fontWeight: 700,
	fontSize: "11px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const presenceDotMiniStyle: CSSProperties = {
	position: "absolute",
	bottom: "-2px",
	right: "-2px",
	width: "8px",
	height: "8px",
	borderRadius: "50%",
	border: "1px solid #09090b",
};

const presenceBadgeStyle: CSSProperties = {
	fontSize: "10px",
	fontFamily: "monospace",
	color: "#a1a1aa",
	background: "#18181b",
	border: "1px solid #27272a",
	padding: "2px 6px",
	borderRadius: "2px",
};

const stagePillMiniStyle: CSSProperties = {
	fontSize: "10px",
	fontFamily: "monospace",
	fontWeight: 700,
	color: "#a1a1aa",
	background: "#18181b",
	border: "1px solid #27272a",
	padding: "2px 6px",
	borderRadius: "2px",
};

const unreadBadgeStyle: CSSProperties = {
	background: "#dc2626",
	color: "#ffffff",
	fontSize: "10px",
	fontWeight: 700,
	padding: "2px 6px",
	borderRadius: "9999px",
	marginLeft: "6px",
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
	padding: "10px 14px",
	background: "#121215",
	borderBottom: "1px solid #27272a",
};

const backBtnStyle: CSSProperties = {
	background: "transparent",
	border: "1px solid #27272a",
	color: "#fafafa",
	padding: "4px 8px",
	borderRadius: "4px",
	fontSize: "11px",
	cursor: "pointer",
};

const messageListStyle: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "14px",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
};

const messageRowStyle: CSSProperties = {
	display: "flex",
	width: "100%",
};

const messageBubbleStyle: CSSProperties = {
	maxWidth: "80%",
	padding: "10px 14px",
	borderRadius: "4px",
	fontSize: "13px",
};

const myBubbleStyle: CSSProperties = {
	background: "#ffffff",
	color: "#09090b",
	border: "1px solid #ffffff",
};

const theirBubbleStyle: CSSProperties = {
	background: "#18181b",
	color: "#f4f4f5",
	border: "1px solid #27272a",
};

const bubbleAuthorStyle: CSSProperties = {
	fontSize: "10px",
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	opacity: 0.6,
	marginBottom: "4px",
};

const bubbleTimeStyle: CSSProperties = {
	fontSize: "10px",
	fontFamily: "monospace",
	opacity: 0.5,
	marginTop: "4px",
	textAlign: "right",
};

const formStyle: CSSProperties = {
	display: "flex",
	padding: "10px 12px",
	background: "#000000",
	borderTop: "1px solid #27272a",
	gap: "8px",
};

const inputStyle: CSSProperties = {
	flex: 1,
	background: "#18181b",
	border: "1px solid #27272a",
	borderRadius: "4px",
	color: "#fafafa",
	padding: "8px 12px",
	fontSize: "13px",
	outline: "none",
};

const sendBtnStyle: CSSProperties = {
	background: "#ffffff",
	color: "#000000",
	border: "none",
	borderRadius: "4px",
	padding: "8px 14px",
	fontWeight: 700,
	fontSize: "12px",
	cursor: "pointer",
};

const errorBannerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	background: "#450a0a",
	color: "#fecaca",
	padding: "6px 12px",
	fontSize: "11px",
	borderBottom: "1px solid #7f1d1d",
};

const errorCloseStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	color: "#fecaca",
	cursor: "pointer",
	fontWeight: 700,
};
