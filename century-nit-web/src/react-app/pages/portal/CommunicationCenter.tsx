import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { meApi } from "century-nit-core";
import type { CommunicationContext, ChatMessage, QuotedMessage } from "century-nit-shared";
import {
	ensureChatUiStyles,
	MessageList,
	Composer,
	type MessageActionsConfig,
} from "century-nit-chat-ui";
import { useCommunicationChat } from "../../hooks/useCommunicationChat";
import { useChatStream } from "../../hooks/useChatStream";
import { useAiChat } from "../../hooks/useAiChat";
import { useAppState } from "../../context/AppState";

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

	// Pages can open the chat from in-content actions (e.g. "Message us" on the
	// waiting screens). The widget owns the launcher, they just signal intent.
	useEffect(() => {
		const openChat = () => setOpen(true);
		window.addEventListener("century:open-chat", openChat);
		return () => window.removeEventListener("century:open-chat", openChat);
	}, []);
	const [activeChannel, setActiveChannel] = useState<ActiveChannel>("support");
	const [context, setContext] = useState<CommunicationContext | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Journey state. Feeds the AI prompt so answers are personalised to the
	// applicant's actual stage, next step and payment signals (not generic FAQ).
	const { application, journeyPhase, pendingAction } = useAppState();

	// Communication chat (support + officer share one routed conversation).
	const chat = useCommunicationChat(open);
	const [draft, setDraft] = useState("");
	const [replyTo, setReplyTo] = useState<QuotedMessage | null>(null);
	const [pendingFiles, setPendingFiles] = useState<{ name: string; attachmentId: string }[]>([]);
	const [uploading, setUploading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// AI chat. Streamed from the Workers AI edge endpoint. Context carries the
	// live journey signals so the assistant answers with the applicant's real
	// stage, next unlock, pending action and invoice states (worker caps at 6).
	const aiChat = useAiChat("portal-comm", {
		getContext: () => ({
			stage: journeyPhase.label,
			nextUnlock: journeyPhase.nextUnlock ?? "",
			pendingAction: pendingAction?.title ?? "",
			applicationInvoice: application.applicationInvoice.status,
			visaInvoice: application.visaInvoice.status,
		}),
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

	/* Load communication context (conversations + assigned officer) */
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

	// The badge has to work while the window is closed — that's its whole job.
	// Context loads once on mount and refreshes on any inbound SSE message;
	// the 30s refresh only matters while the window is open.
	useEffect(() => {
		void loadContext();
	}, [loadContext]);
	useEffect(() => {
		if (!open) return;
		const id = setInterval(loadContext, 30_000);
		return () => clearInterval(id);
	}, [open, loadContext]);

	// Peek card: the last inbound staff message floats above the launcher
	// while the window is closed. Dismissed ids are remembered for the session.
	const [peek, setPeek] = useState<{ id: string; who: string; text: string } | null>(null);
	const peekDismissed = useRef<Set<string>>(new Set());

	useChatStream(useCallback((ev) => {
		if (ev.type !== "chat.message") return;
		const m = ev.message;
		if (m.senderOpsUserId == null) return; // own message — no badge, no peek
		if (!open) {
			void loadContext();
			if (!peekDismissed.current.has(m.id)) {
				setPeek({ id: m.id, who: m.senderName ?? "Century NIT", text: m.content });
			}
		}
	}, [open, loadContext]));

	useEffect(() => {
		if (open) setPeek(null);
	}, [open]);

	// Esc collapses the window to the launcher.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	const totalUnread = useMemo(
		() => context?.conversations.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0,
		[context],
	);
	// Per-channel badges: support threads type "support"; the officer's thread is
	// the stage/case/applicant thread — everything that isn't the support desk.
	const channelUnread = useMemo(() => {
		const convs = context?.conversations ?? [];
		return {
			support: convs.filter((c) => c.type === "support").reduce((s, c) => s + c.unreadCount, 0),
			officer: convs.filter((c) => c.type !== "support").reduce((s, c) => s + c.unreadCount, 0),
		};
	}, [context]);

	const officer = useMemo(() => officerCard(context), [context]);
	const isOfficerAssigned = officer !== null;

	/* Switch channel */
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

	useEffect(() => {
		const handler = (e: CustomEvent<{ channel?: ActiveChannel }>) => {
			setOpen(true);
			if (e.detail?.channel) {
				void handleSelectChannel(e.detail.channel);
			}
		};
		window.addEventListener("open-chat", handler as EventListener);
		return () => window.removeEventListener("open-chat", handler as EventListener);
	}, [handleSelectChannel]);

	// Notification deep links land on /portal/home?chat=<conversationId>
	// (there is no /portal/support page). The param is consumed so a later
	// refresh doesn't force the widget back open.
	const [searchParams, setSearchParams] = useSearchParams();
	const openConversation = chat.openConversation;
	useEffect(() => {
		const target = searchParams.get("chat");
		if (!target) return;
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			next.delete("chat");
			return next;
		}, { replace: true });
		setOpen(true);
		if (target === "officer") {
			void handleSelectChannel("officer");
		} else if (target === "open" || target === "support") {
			void handleSelectChannel("support");
		} else {
			setActiveChannel("support");
			void openConversation(target);
		}
	}, [searchParams, setSearchParams, handleSelectChannel, openConversation]);

	/* Send message (support + officer) */
	const handleSend = useCallback(async (text: string) => {
		if (!text.trim() && pendingFiles.length === 0) return;
		await chat.send(text.trim() || "📎 Attachment", { attachmentIds: pendingFiles.map((f) => f.attachmentId) });
		setDraft("");
		setReplyTo(null);
		setPendingFiles([]);
		void loadContext();
	}, [chat, loadContext, pendingFiles]);

	/* Attachments: stage → PUT to the presigned URL → the ids bind on send. */
	const onFilesPicked = useCallback(
		async (files: FileList | null) => {
			if (!files || !chat.conversationId) return;
			setUploading(true);
			try {
				for (const file of Array.from(files)) {
					const staged = await meApi.stageCommunicationAttachment(chat.conversationId, {
						fileName: file.name,
						contentType: file.type || "application/octet-stream",
						sizeBytes: file.size,
					});
					const res = await fetch(staged.uploadUrl, {
						method: "PUT",
						headers: { "Content-Type": file.type || "application/octet-stream", ...staged.headers },
						body: file,
					});
					if (!res.ok) throw new Error(`Upload failed (${res.status})`);
					setPendingFiles((prev) => [...prev, { name: file.name, attachmentId: staged.attachmentId }]);
				}
			} catch (e) {
				setError(e instanceof Error ? e.message : "Upload failed");
			} finally {
				setUploading(false);
				if (fileInputRef.current) fileInputRef.current.value = "";
			}
		},
		[chat.conversationId],
	);

	/* AI assistant (streamed from Workers AI edge endpoint) */
	const handleSendAi = useCallback((e?: FormEvent, customQuery?: string) => {
		if (e) e.preventDefault();
		const query = (customQuery || aiDraft).trim();
		if (!query || aiTyping) return;
		if (!customQuery) setAiDraft("");
		void aiChat.send(query);
	}, [aiDraft, aiTyping, aiChat]);

	/* Escalation: AI → human (Phase 2 handoff). Routes the Support thread
	   and posts the AI transcript as a handoff message, so staff see the
	   question and what the AI already answered without the applicant
	   re-explaining. Posts once per question. Repeat clicks (or a routing
	   failure) fall back to the Phase 1 draft prefill. */
	const lastEscalatedRef = useRef<string | null>(null);
	const [escalating, setEscalating] = useState(false);

	const handleEscalate = useCallback(async () => {
		if (escalating) return;
		const lastUser = [...aiChat.messages].reverse().find((m) => m.role === "user");
		const question = lastUser?.content.trim() ?? "";
		setEscalating(true);
		try {
			await handleSelectChannel("support");
			if (!question || lastEscalatedRef.current === question) {
				if (question) setDraft(question);
				return;
			}
			lastEscalatedRef.current = question;
			// Last substantive AI reply. Skip the welcome banner and error stubs.
			const lastAnswer = [...aiChat.messages]
				.reverse()
				.find(
					(m) =>
							m.role === "assistant" &&
							!m.id.endsWith("-welcome") &&
							m.content.trim() !== "" &&
							!m.content.startsWith("Sorry"),
				);
			const reply = (lastAnswer?.content ?? "").trim();
			const handoff = [
				"[AI handoff] I was chatting with the AI assistant and would like a human to help.",
				`My question: "${question}"`,
				reply ? `The AI replied: "${reply.length > 300 ? `${reply.slice(0, 300)}…` : reply}"` : "",
			]
				.filter(Boolean)
				.join("\n");
			await chat.send(handoff);
		} catch {
			// Handoff post failed. Fall back to the Phase 1 behaviour so the
			// applicant's question is never lost.
			setDraft(question);
		} finally {
			setEscalating(false);
		}
	}, [aiChat.messages, handleSelectChannel, chat, escalating]);

	/* Shared component callbacks (support + officer) */
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
		onQuoteClick: () => {},
	}), [actionsConfig]);

	ensureChatUiStyles();

	const officerFirstName = officer?.name.split(" ")[0] ?? "your officer";

	const headMeta =
		activeChannel === "support"
			? { ini: "CS", name: "Century Support", sub: "Desk open · replies within the hour", ai: false }
			: activeChannel === "officer"
				? {
						ini: (officer?.name ?? "··").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
						name: officer?.name ?? "Assigned officer",
						sub: officer ? `${officer.role || "Officer"}${officer.branch ? ` · ${officer.branch}` : ""}` : "Being assigned",
						ai: false,
					}
				: { ini: "AI", name: "Century AI", sub: "Instant · knows your journey stage", ai: true };

	return (
		<>
			{/* Launcher: live badge + last-message peek. The badge is SSE-fed and
			    works while the window is closed — that is its whole job. */}
			<div className="cchat-launch">
				{!open && peek ? (
					<button
						type="button"
						className="cchat-peek"
						onClick={() => setOpen(true)}
					>
						<b>{peek.who}</b>
						{peek.text.slice(0, 90)}{peek.text.length > 90 ? "…" : ""}
						<span
							className="cchat-peek__x"
							role="button"
							tabIndex={0}
							aria-label="Dismiss preview"
							onClick={(e) => {
								e.stopPropagation();
								peekDismissed.current.add(peek.id);
								setPeek(null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									peekDismissed.current.add(peek.id);
									setPeek(null);
								}
							}}
						>
							✕
						</span>
					</button>
				) : null}
				<button
					type="button"
					className="cchat-fab"
					onClick={() => {
						setOpen((prev) => !prev);
						if (!open) void handleSelectChannel("support");
					}}
					aria-label={open ? "Close chat" : "Open chat"}
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
					{totalUnread > 0 && !open && <span className="cchat-fab__badge">{totalUnread}</span>}
				</button>
			</div>

			{/* Floating Hub Window */}
			{open && (
				<div className={`cchat-win cn-chat${expanded ? " cchat-win--xl" : ""}`}>
					{/* Header = who you're talking to, not the word "chat" */}
					<header className="cchat-win__head">
						<span className={`cchat-ava${headMeta.ai ? " cchat-ava--ai" : ""}`}>{headMeta.ini}</span>
						<div className="cchat-win__who">
							<p className="cchat-win__name">{headMeta.name}</p>
							<p className="cchat-win__sub">{headMeta.sub}</p>
						</div>
						<div className="cchat-win__ctl">
							<button
								type="button"
								onClick={() => setOpen(false)}
								title="Minimize"
								aria-label="Minimize"
							>
								—
							</button>
							<button
								type="button"
								className="cchat-win__xl"
								onClick={() => setExpanded((prev) => !prev)}
								title={expanded ? "Restore" : "Expand"}
								aria-label={expanded ? "Restore" : "Expand"}
							>
								{expanded ? "⤡" : "⤢"}
							</button>
							<button
								type="button"
								onClick={() => setOpen(false)}
								title="Close"
								aria-label="Close"
							>
								✕
							</button>
						</div>
					</header>

					{/* Channel tabs carry their own unread counts */}
					<nav className="cchat-tabs" aria-label="Chat channels">
						<button
							type="button"
							onClick={() => handleSelectChannel("support")}
							className={activeChannel === "support" ? "on" : ""}
						>
							Support
							{channelUnread.support > 0 && <span className="u">{channelUnread.support}</span>}
						</button>
						<button
							type="button"
							onClick={() => handleSelectChannel("officer")}
							className={activeChannel === "officer" ? "on" : ""}
						>
							{officer ? officer.name.split(" ")[0] : "Officer"}
							{channelUnread.officer > 0 && <span className="u">{channelUnread.officer}</span>}
						</button>
						<button
							type="button"
							onClick={() => handleSelectChannel("ai")}
							className={activeChannel === "ai" ? "on" : ""}
						>
							AI
						</button>
					</nav>

					{/* Context strip: what this thread is for, right now */}
					<div className="cchat-strip">
						{activeChannel === "support"
							? "Triage queue · your file is attached automatically"
							: activeChannel === "officer"
								? `${officer?.stageLabel ?? "Officer"} · direct thread`.toUpperCase()
								: `Context: ${journeyPhase.label}${pendingAction ? ` · ${pendingAction.title}` : ""}`.toUpperCase()}
					</div>

					{/* Error Notification */}
					{error && (
						<div style={errorBannerStyle}>
							<span>{error}</span>
							<button type="button" onClick={() => setError(null)} style={errorCloseStyle}>✕</button>
						</div>
					)}

					{/* Body */}
					<div style={bodyStyle}>
						{/* Support + Officer channels. Shared components */}
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
									{/* Messages. Shared MessageList */}
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

									{/* Resolved strip. A new message reopens it */}
									{chat.conversationStatus === "closed" && (
										<div style={resolvedBarStyle}>
											Resolved. Send a message to reopen
										</div>
									)}

									{/* Staged attachments */}
									{pendingFiles.length > 0 && (
										<div style={attachTrayStyle}>
											{pendingFiles.map((f) => (
												<span key={f.attachmentId} style={attachChipStyle}>
													📎 {f.name}
													<button
														type="button"
														style={attachRemoveStyle}
														onClick={() => setPendingFiles((prev) => prev.filter((x) => x.attachmentId !== f.attachmentId))}
														aria-label={`Remove ${f.name}`}
													>
														×
													</button>
												</span>
											))}
										</div>
									)}

									{/* Composer. Shared */}
									<Composer
										value={draft}
										onChange={setDraft}
										onSend={handleSend}
										sending={chat.sending}
										replyTo={replyTo}
										onCancelReply={() => setReplyTo(null)}
										onAttach={() => fileInputRef.current?.click()}
										placeholder={uploading ? "Uploading…" : activeChannel === "support" ? "Type a message…" : `Message ${officerFirstName}…`}
									/>
								</div>
							)
						)}

						{/* AI channel. Scripted, local-only */}
						{activeChannel === "ai" && (
							<div style={streamContainerStyle}>
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

									{/* Escalation: persistent affordance to reach a human. Posts the
									    AI transcript into the Support thread on switch. */}
									<button
										type="button"
										disabled={escalating}
										onClick={() => void handleEscalate()}
										style={{ ...escalateBarStyle, ...(escalating ? escalateBarDisabledStyle : {}) }}
									>
										{escalating ? "CONNECTING TO SUPPORT…" : "TALK TO A HUMAN →"}
									</button>

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

			<input
				ref={fileInputRef}
				type="file"
				multiple
				style={{ display: "none" }}
				onChange={(e) => void onFilesPicked(e.target.files)}
			/>
		</>
	);
}

/* Shell styles (header, tabs, AI channel) */
/* Support + Officer channels use the shared chat-ui components which style  */
/* themselves via --cn-chat-* tokens. AI keeps its inline bubbles since it's  */
/* a scripted local-only surface with no server backing.                      */

const resolvedBarStyle: CSSProperties = {
	padding: "8px 12px",
	fontSize: "10px",
	fontFamily: "monospace",
	fontWeight: 700,
	letterSpacing: "0.06em",
	textTransform: "uppercase",
	color: "#52525b",
	background: "#f4f4f5",
	borderTop: "1px dashed #a1a1aa",
	textAlign: "center",
};

const attachTrayStyle: CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: "4px",
	padding: "6px 10px",
	borderTop: "1px solid #e4e4e7",
};

const attachChipStyle: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
	border: "1px solid #18181b",
	background: "#f4f4f5",
	fontFamily: "monospace",
	fontSize: "10px",
	padding: "2px 6px",
};

const attachRemoveStyle: CSSProperties = {
	border: "none",
	background: "none",
	cursor: "pointer",
	fontSize: "12px",
	lineHeight: 1,
	padding: 0,
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
	color: "#71717a",
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

/* AI channel inline styles (scripted, no shared components) */

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
	borderRadius: "0",
};

const theirBubbleStyle: CSSProperties = {
	background: "#f4f4f5",
	color: "#18181b",
	border: "none",
	borderLeft: "2.5px solid #5b21b6",
	borderRadius: "0",
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

const escalateBarStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "6px",
	width: "calc(100% - 32px)",
	margin: "10px 16px 0",
	padding: "8px 12px",
	background: "#ffffff",
	border: "1px solid #18181b",
	color: "#18181b",
	fontSize: "11px",
	fontWeight: 700,
	fontFamily: "monospace",
	letterSpacing: "0.06em",
	cursor: "pointer",
	transition: "background 0.15s ease, color 0.15s ease",
};

const escalateBarDisabledStyle: CSSProperties = {
	opacity: 0.55,
	cursor: "wait",
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
	borderRadius: "0",
	borderColor: "#e4e4e7",
	color: "#18181b",
	padding: "10px 14px",
	fontSize: "13px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	outline: "none",
	transition: "background 0.2s ease",
};

const aiSendBtnStyle: CSSProperties = {
	background: "#18181b",
	color: "#ffffff",
	border: "none",
	borderRadius: "0",
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
	background: "#18181b",
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
