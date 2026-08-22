import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { meApi } from "century-nit-core";
import type { CommunicationContext, ChatMessage, QuotedMessage } from "century-nit-shared";
import {
	ensureChatUiStyles,
	MessageList,
	Composer,
	type MessageActionsConfig,
} from "century-nit-chat-ui";
import { useCommunicationChat } from "../../hooks/useCommunicationChat";
import { useAiChat } from "../../hooks/useAiChat";

/**
 * Context-Aware Communication Hub for the Century NIT Client Portal.
 *
 * Three channels:
 *   - SUPPORT: 24/7 helpdesk, routed via `meApi.routeCommunication()`.
 *   - OFFICER: the applicant's assigned stage officer, routed with
 *     `{ stageKey }` so the backend picks the conversation tied to the
 *     applicant's current journey stage.
 *   - AI: a knowledge assistant streamed from the Workers AI edge endpoint
 *     (`POST /ai/chat`) via `useAiChat`.
 *
 * Support + Officer use the shared `MessageList` + `Composer` from
 * `century-nit-chat-ui` and subscribe to real-time SSE via
 * `useCommunicationChat`. AI is stateless (history replayed each turn).
 */

type ActiveChannel = "support" | "officer" | "ai";

type AIMessage = {
	id: string;
	sender: "user" | "ai";
	text: string;
	at: string;
};

/** Officer card extracted from the `stage_officer` variant of CurrentContact. */
interface OfficerCard {
	name: string;
	role: string;
	branch: string;
	stageLabel: string;
}

/** Narrow the CurrentContact union to an officer card, or null. */
function officerCard(ctx: CommunicationContext | null): OfficerCard | null {
	const c = ctx?.current;
	if (!c || c.kind !== "stage_officer") return null;
	return {
		name: c.contact.name,
		role: c.contact.role ?? "",
		branch: c.contact.branch ?? "",
		stageLabel: c.stageLabel,
	};
}

export function CommunicationCenter() {
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [activeChannel, setActiveChannel] = useState<ActiveChannel>("support");
	const [context, setContext] = useState<CommunicationContext | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Communication chat (support + officer share one routed conversation).
	const chat = useCommunicationChat(open);
	const [draft, setDraft] = useState("");
	const [replyTo, setReplyTo] = useState<QuotedMessage | null>(null);

	// AI chat — streamed from the Workers AI edge endpoint.
	const aiChat = useAiChat("portal-comm", {
		getContext: () => ({ stage: context?.activeStageKey ?? "" }),
	});
	const aiMessages: AIMessage[] = useMemo(
		() =>
			aiChat.messages.map((m) => ({
				id: m.id,
				sender: m.role === "user" ? "user" : "ai",
				text: m.content,
				at: m.at,
			})),
		[aiChat.messages],
	);
	const aiTyping = aiChat.typing;
	const [aiDraft, setAiDraft] = useState("");

	/* ── Load communication context (conversations + assigned officer) ── */
	const loadContext = useCallback(async () => {
		try {
			const ctx = await meApi.getCommunicationContext();
			setContext(ctx);
			setError(null);
			return ctx;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't load communication context");
			return null;
		}
	}, []);

	useEffect(() => {
		if (!open) return;
		void loadContext();
		const id = setInterval(loadContext, 30_000);
		return () => clearInterval(id);
	}, [open, loadContext]);

	const totalUnread = useMemo(
		() => context?.conversations.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0,
		[context],
	);

	const officer = useMemo(() => officerCard(context), [context]);
	const isOfficerAssigned = officer !== null;

	/* ── Switch channel ── */
	const handleSelectChannel = useCallback(async (channel: ActiveChannel) => {
		setActiveChannel(channel);
		setError(null);
		setReplyTo(null);
		setDraft("");

		if (channel === "support") {
			await chat.route();
		} else if (channel === "officer") {
			if (!context || !isOfficerAssigned) return;
			await chat.route({ stageKey: context.activeStageKey ?? undefined });
		}
	}, [chat, context, isOfficerAssigned]);

	// Initialize default support conversation on first open
	useEffect(() => {
		if (open && activeChannel === "support" && !chat.conversationId) {
			void handleSelectChannel("support");
		}
	}, [open, activeChannel, chat.conversationId, handleSelectChannel]);

	/* ── Send message (support + officer) ── */
	const handleSend = useCallback(async (text: string) => {
		if (!text.trim()) return;
		await chat.send(text);
		setDraft("");
		setReplyTo(null);
		void loadContext();
	}, [chat, loadContext]);

	/* ── AI assistant (streamed from Workers AI edge endpoint) ── */
	const handleSendAi = useCallback((e?: FormEvent, customQuery?: string) => {
		if (e) e.preventDefault();
		const query = (customQuery || aiDraft).trim();
		if (!query || aiTyping) return;
		if (!customQuery) setAiDraft("");
		void aiChat.send(query);
	}, [aiDraft, aiTyping, aiChat]);

	/* ── Shared component callbacks (support + officer) ── */
	const isOwn = useCallback(
		(m: ChatMessage) => m.senderOpsUserId == null,
		[],
	);

	const actionsConfig = useMemo<MessageActionsConfig>(() => ({
		reply: true,
		react: false,
		forward: false,
		copy: true,
		edit: false,
		delete: false,
		more: false,
	}), []);

	const bubbleProps = useMemo(() => ({
		actions: actionsConfig,
		onReply: (m: ChatMessage) => {
			if (m.deletedAt) return;
			setReplyTo({
				id: m.id,
				senderName: m.senderName,
				content: m.content,
				deleted: m.deletedAt !== null && m.deletedAt !== undefined,
			});
		},
		onQuoteClick: (_id: string) => {},
	}), [actionsConfig]);

	ensureChatUiStyles();

	const officerFirstName = officer?.name.split(" ")[0] ?? "your officer";

	return (
		<>
			{/* Floating Square Launcher Button */}
			<button
				type="button"
				onClick={() => {
					setOpen((prev) => !prev);
					if (!open) void handleSelectChannel("support");
				}}
				style={launcherSquareBtnStyle}
				aria-label="Open Chat"
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
							<span style={{ ...indicatorDotStyle, background: "#10b981" }} />
							<span style={headerTitleStyle}>CHAT</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
							<button
								type="button"
								onClick={() => setExpanded((prev) => !prev)}
								style={controlBtnStyle}
								title={expanded ? "Restore" : "Expand"}
								aria-label={expanded ? "Restore" : "Expand"}
							>
								{expanded ? "⤡" : "⤢"}
							</button>
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

					{/* Channel Tabs */}
					<nav style={channelNavStyle} aria-label="Chat Channels">
						<button
							type="button"
							onClick={() => handleSelectChannel("support")}
							style={{ ...channelBtnStyle, ...(activeChannel === "support" ? activeChannelBtnStyle : {}) }}
						>
							SUPPORT
						</button>
						<button
							type="button"
							onClick={() => handleSelectChannel("officer")}
							style={{ ...channelBtnStyle, ...(activeChannel === "officer" ? activeChannelBtnStyle : {}) }}
						>
							OFFICER
							{isOfficerAssigned && <span style={assignedDotStyle} />}
						</button>
						<button
							type="button"
							onClick={() => handleSelectChannel("ai")}
							style={{ ...channelBtnStyle, ...(activeChannel === "ai" ? activeChannelBtnStyle : {}) }}
						>
							AI
						</button>
					</nav>

					{/* Error Notification */}
					{error && (
						<div style={errorBannerStyle}>
							<span>{error}</span>
							<button type="button" onClick={() => setError(null)} style={errorCloseStyle}>✕</button>
						</div>
					)}

					{/* Body */}
					<div style={bodyStyle}>
						{/* Support + Officer channels — shared components */}
						{(activeChannel === "support" || activeChannel === "officer") && (
							activeChannel === "officer" && !isOfficerAssigned ? (
								<div style={unassignedStateStyle}>
									<div style={{ fontSize: "12px", fontWeight: 700, color: "#000000", marginBottom: "8px", letterSpacing: "0.04em" }}>
										CONSULTANT BEING ASSIGNED
									</div>
									<p style={{ fontSize: "11px", color: "#52525b", lineHeight: 1.5, maxWidth: "280px", margin: "0 auto 16px" }}>
										Your dedicated specialist will appear here once your application milestone or consultation is active.
									</p>
									<button
										type="button"
										onClick={() => handleSelectChannel("support")}
										style={switchChannelActionBtnStyle}
									>
										SWITCH TO SUPPORT
									</button>
								</div>
							) : (
								<div style={streamContainerStyle}>
									{/* Channel header card */}
									<div style={officerHeaderCardStyle}>
										<div>
											<div style={{ fontWeight: 700, fontSize: "12px", color: "#000000", letterSpacing: "0.04em" }}>
												{activeChannel === "support" ? "CENTURY SUPPORT DESK" : officer?.name.toUpperCase() ?? "ASSIGNED OFFICER"}
											</div>
											<div style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>
												{activeChannel === "support"
													? "24/7 HELPDESK & TRIAGE"
													: `${officer?.role.toUpperCase() ?? ""} · ${officer?.branch.toUpperCase() ?? ""}`}
											</div>
										</div>
										<span style={stagePillStyle}>
											{activeChannel === "support" ? "SUPPORT" : (officer?.stageLabel ?? "OFFICER").toUpperCase()}
										</span>
									</div>

									{/* Messages — shared MessageList */}
									<MessageList
										messages={chat.messages}
										typing={chat.typing}
										isOwn={isOwn}
										bubbleProps={bubbleProps}
										header={
											chat.loading && chat.messages.length === 0 ? (
												<div style={{ textAlign: "center", color: "var(--cn-chat-muted-fg)", fontSize: 12, padding: 16 }}>
													Loading conversation...
												</div>
											) : chat.messages.length === 0 ? (
												<div style={emptySupportPromptStyle}>
													<p style={{ fontWeight: 700, fontSize: "12px", color: "#000000", marginBottom: "6px", letterSpacing: "0.04em" }}>
														{activeChannel === "support" ? "DIRECT SUPPORT QUEUE" : "DIRECT OFFICER THREAD"}
													</p>
													<p style={{ fontSize: "11px", color: "#52525b", marginBottom: "12px", lineHeight: 1.4 }}>
														{activeChannel === "support"
															? "Send a message directly to central support. Responses appear here in real-time."
															: `Connected directly with ${officer?.name ?? "your officer"}.`}
													</p>
													{activeChannel === "support" && (
														<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
															{["Payment & Invoices", "Document Review Status", "Visa Consultation"].map((t) => (
																<button
																	key={t}
																	type="button"
																	onClick={() => setDraft(`Inquiry: ${t} - `)}
																	style={quickChipStyle}
																>
																	{t}
																</button>
															))}
														</div>
													)}
												</div>
											) : null
										}
									/>

									{/* Composer — shared */}
									<Composer
										value={draft}
										onChange={setDraft}
										onSend={handleSend}
										sending={chat.sending}
										replyTo={replyTo}
										onCancelReply={() => setReplyTo(null)}
										placeholder={activeChannel === "support" ? "Type a message…" : `Message ${officerFirstName}…`}
									/>
								</div>
							)
						)}

						{/* AI channel — scripted, local-only */}
						{activeChannel === "ai" && (
							<div style={streamContainerStyle}>
								<div style={officerHeaderCardStyle}>
									<div>
										<div style={{ fontWeight: 700, fontSize: "12px", color: "#000000", letterSpacing: "0.04em" }}>
											CENTURY AI
										</div>
										<div style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>
											KNOWLEDGE ASSISTANT
										</div>
									</div>
									<span style={stagePillStyle}>AI ENGINE</span>
								</div>

								<div style={messageListStyle}>
									{aiMessages.map((m) => {
										const isMe = m.sender === "user";
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
													<div style={bubbleAuthorStyle}>{isMe ? "YOU" : "CENTURY AI"}</div>
													<div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.text}</div>
													<div style={bubbleTimeStyle}>
														{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</div>
												</div>
											</div>
										);
									})}
									{aiTyping && (
										<div style={{ padding: "8px 12px", color: "#52525b", fontSize: "11px", fontFamily: "monospace" }}>
											GENERATING RESPONSE...
										</div>
									)}
								</div>

								{/* AI Quick Prompts */}
								<div style={aiPromptsRowStyle}>
									{["Visa requirements", "Scholarships", "Required documents", "Payment plan"].map((prompt) => (
										<button
											key={prompt}
											type="button"
											onClick={() => handleSendAi(undefined, prompt)}
											style={aiQuickChipStyle}
										>
											{prompt}
										</button>
									))}
								</div>

								<form onSubmit={(e) => handleSendAi(e)} style={aiFormStyle}>
									<input
										type="text"
										value={aiDraft}
										onChange={(e) => setAiDraft(e.target.value)}
										placeholder="Ask Century AI..."
										style={aiInputStyle}
									/>
									<button type="submit" disabled={!aiDraft.trim() || aiTyping} style={aiSendBtnStyle}>
										ASK
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

/* ── Shell styles (header, tabs, AI channel) ────────────────────────────── */
/* Support + Officer channels use the shared chat-ui components which style  */
/* themselves via --cn-chat-* tokens. AI keeps its inline bubbles since it's  */
/* a scripted local-only surface with no server backing.                      */

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
	gridTemplateColumns: "1fr 1fr 1fr",
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

const assignedDotStyle: CSSProperties = {
	width: "4px",
	height: "4px",
	background: "#ffffff",
	borderRadius: "0px",
};

const bodyStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const streamContainerStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const officerHeaderCardStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "12px 16px",
	background: "#ffffff",
	borderBottom: "1px solid #f4f4f5",
};

const stagePillStyle: CSSProperties = {
	fontSize: "10px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	fontWeight: 600,
	color: "#52525b",
	background: "#f4f4f5",
	border: "none",
	padding: "2px 8px",
	borderRadius: "12px",
};

const emptySupportPromptStyle: CSSProperties = {
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	borderRadius: "0px",
	padding: "14px",
	margin: "auto 0",
};

const quickChipStyle: CSSProperties = {
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	color: "#d4d4d8",
	fontSize: "10px",
	fontFamily: "monospace",
	padding: "4px 8px",
	borderRadius: "0px",
	cursor: "pointer",
};

const unassignedStateStyle: CSSProperties = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: "30px 20px",
	textAlign: "center",
};

const switchChannelActionBtnStyle: CSSProperties = {
	background: "#ffffff",
	color: "#000000",
	border: "none",
	borderRadius: "0px",
	padding: "8px 14px",
	fontWeight: 700,
	fontSize: "11px",
	fontFamily: "monospace",
	letterSpacing: "0.04em",
	cursor: "pointer",
};

/* ── AI channel inline styles (scripted, no shared components) ── */

const messageListStyle: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "12px",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
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

const aiPromptsRowStyle: CSSProperties = {
	display: "flex",
	gap: "6px",
	overflowX: "auto",
	padding: "6px 10px",
	background: "#ffffff",
	borderTop: "1px solid #e4e4e7",
};

const aiQuickChipStyle: CSSProperties = {
	whiteSpace: "nowrap",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	color: "#52525b",
	fontSize: "10px",
	fontFamily: "monospace",
	padding: "3px 6px",
	borderRadius: "0px",
	cursor: "pointer",
};

const aiFormStyle: CSSProperties = {
	display: "flex",
	padding: "12px 16px",
	background: "#ffffff",
	borderTop: "1px solid #f4f4f5",
	gap: "10px",
	alignItems: "center",
};

const aiInputStyle: CSSProperties = {
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

const aiSendBtnStyle: CSSProperties = {
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
