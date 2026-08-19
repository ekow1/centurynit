import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { meApi } from "century-nit-core";
import type { CommunicationContext, ChatMessage } from "century-nit-shared";

/**
 * Strict Monochrome Brutalist Floating Communication Hub for Century NIT Client Portal.
 *
 * Rules:
 *   - Strict 0px border-radius (no rounded corners).
 *   - Pure monochrome palette (#000000, #ffffff, #000000, #e4e4e7, #ffffff).
 *   - Floating trigger: Square icon button with pure SVG chat icon (no text labels, no emojis).
 *   - 3 Clean Channels: SUPPORT (Default), ASSIGNED OFFICER, AI ADVISOR.
 *   - Expandable Workstation: Standard 390px floating card <-> 820px widescreen workspace.
 */

const POLL_MS = 10_000;

type ActiveChannel = "support" | "officer" | "ai";

type AIMessage = {
	id: string;
	sender: "user" | "ai";
	text: string;
	at: string;
};

const AI_KNOWLEDGE_BASE: Record<string, string> = {
	visa: "For student visas, you will need a valid passport (with at least 6 months validity), your unconditional university offer letter, CAS/I-20 document, proof of funds covering tuition and 9 months living costs, TB test results (if applicable), and academic transcripts. Century NIT's visa specialists assist with complete mock interviews and documentation reviews.",
	scholarship: "Century NIT works with partner universities that offer merit-based scholarships ranging from £1,500 to 50% tuition reduction. For top candidates with strong GPAs (First Class / Upper Second), we assist with Commonwealth, Chevening, and University Vice-Chancellor scholarship applications.",
	documents: "Required standard documents: 1) International Passport Bio Data Page, 2) Degree/WASSCE Certificates, 3) Official Academic Transcripts, 4) Statement of Purpose / Personal Statement, 5) Two Academic/Professional Reference Letters, 6) Updated CV. You can upload these directly in your Document Vault.",
	payment: "Century NIT accepts payments securely via Paystack in GHS or USD card/bank transfer. We offer flexible post-arrival installment payment plans for agency fees upon successful visa issuance.",
	stage: "The Century NIT journey has 5 key stages: Stage I (Consultation & Eligibility), Stage II (School Package, Shortlisting & Application), Stage III (Visa Processing), Stage IV (Financial Settlement & Post-Arrival Plan), and Stage V (Pre-Departure & Travel Clearance).",
};

export function CommunicationCenter() {
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [activeChannel, setActiveChannel] = useState<ActiveChannel>("support");
	const [context, setContext] = useState<CommunicationContext | null>(null);

	// Server Chat State (Support & Officer)
	const [activeConvId, setActiveConvId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [loadingMsgs, setLoadingMsgs] = useState(false);
	const [sending, setSending] = useState(false);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);

	// AI Chat State
	const [aiMessages, setAiMessages] = useState<AIMessage[]>([
		{
			id: "ai-welcome",
			sender: "ai",
			text: "Century NIT AI Advisor online. Inquire about university admissions, visa requirements, scholarships, or application stages.",
			at: new Date().toISOString(),
		},
	]);
	const [aiDraft, setAiDraft] = useState("");
	const [aiTyping, setAiTyping] = useState(false);

	const messagesEndRef = useRef<HTMLDivElement>(null);

	/* ── Load communication context from server ── */
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
		let cancelled = false;
		const tick = async () => {
			const ctx = await loadContext();
			if (cancelled || !ctx) return;
		};
		void tick();
		const id = setInterval(tick, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [loadContext]);

	const totalUnread = useMemo(
		() => context?.conversations.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0,
		[context],
	);

	const currentContact = context?.current;
	const isOfficerAssigned = currentContact && currentContact.kind === "stage_officer";

	/* ── Load conversation messages ── */
	const loadConversationMessages = useCallback(async (convId: string) => {
		setActiveConvId(convId);
		setLoadingMsgs(true);
		try {
			const res = await meApi.getCommunicationMessages(convId, { limit: 50 });
			setMessages(res.messages);
			await meApi.markCommunicationRead(convId).catch(() => {});
			void loadContext();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't load messages");
		} finally {
			setLoadingMsgs(false);
		}
	}, [loadContext]);

	/* ── Switch Channel ── */
	const handleSelectChannel = useCallback(async (channel: ActiveChannel) => {
		setActiveChannel(channel);
		setError(null);

		if (channel === "support") {
			if (!context) return;
			const existingSupport = context.conversations.find((c) => c.type === "support");
			if (existingSupport) {
				await loadConversationMessages(existingSupport.id);
			} else {
				try {
					const conv = await meApi.routeCommunication();
					await loadConversationMessages(conv.id);
				} catch (e) {
					setError(e instanceof Error ? e.message : "Couldn't connect to support");
				}
			}
		} else if (channel === "officer") {
			if (!context || !isOfficerAssigned) return;
			try {
				const conv = await meApi.routeCommunication({
					caseId: undefined,
					stageKey: context.activeStageKey ?? undefined,
				});
				await loadConversationMessages(conv.id);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't connect to assigned officer");
			}
		}
	}, [context, isOfficerAssigned, loadConversationMessages]);

	// Initialize default support conversation on first open
	useEffect(() => {
		if (open && activeChannel === "support" && !activeConvId && context) {
			void handleSelectChannel("support");
		}
	}, [open, activeChannel, activeConvId, context, handleSelectChannel]);

	/* ── Send Message to Server (Support or Officer) ── */
	const handleSendServerMessage = useCallback(async (e: FormEvent) => {
		e.preventDefault();
		if (!activeConvId || !draft.trim() || sending) return;
		const text = draft.trim();
		setSending(true);
		try {
			const msg = await meApi.sendCommunicationMessage(activeConvId, text);
			setMessages((prev) => [...prev, msg]);
			setDraft("");
			void loadContext();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to send message");
		} finally {
			setSending(false);
		}
	}, [activeConvId, draft, sending, loadContext]);

	/* ── Send Message to AI Assistant ── */
	const handleSendAiMessage = useCallback((e?: FormEvent, customQuery?: string) => {
		if (e) e.preventDefault();
		const query = (customQuery || aiDraft).trim();
		if (!query || aiTyping) return;

		const userMsg: AIMessage = {
			id: `user-${Date.now()}`,
			sender: "user",
			text: query,
			at: new Date().toISOString(),
		};

		setAiMessages((prev) => [...prev, userMsg]);
		if (!customQuery) setAiDraft("");
		setAiTyping(true);

		setTimeout(() => {
			const lower = query.toLowerCase();
			let replyText = "Query received. For specific profile evaluations, our admissions and visa officers are available on the Support desk.";

			if (lower.includes("visa") || lower.includes("embassy") || lower.includes("cas") || lower.includes("i-20")) {
				replyText = AI_KNOWLEDGE_BASE.visa;
			} else if (lower.includes("scholarship") || lower.includes("funding") || lower.includes("grant") || lower.includes("discount")) {
				replyText = AI_KNOWLEDGE_BASE.scholarship;
			} else if (lower.includes("doc") || lower.includes("passport") || lower.includes("transcript") || lower.includes("upload") || lower.includes("cv")) {
				replyText = AI_KNOWLEDGE_BASE.documents;
			} else if (lower.includes("pay") || lower.includes("fee") || lower.includes("cost") || lower.includes("invoice") || lower.includes("installment")) {
				replyText = AI_KNOWLEDGE_BASE.payment;
			} else if (lower.includes("stage") || lower.includes("process") || lower.includes("step") || lower.includes("journey") || lower.includes("timeline")) {
				replyText = AI_KNOWLEDGE_BASE.stage;
			}

			const aiMsg: AIMessage = {
				id: `ai-${Date.now()}`,
				sender: "ai",
				text: replyText,
				at: new Date().toISOString(),
			};

			setAiMessages((prev) => [...prev, aiMsg]);
			setAiTyping(false);
		}, 400);
	}, [aiDraft, aiTyping]);

	// Auto-scroll on new messages
	useEffect(() => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [messages, aiMessages, activeChannel]);

	return (
		<>
			{/* Floating Square Launcher Button (Pure SVG icon, no text, 0px border-radius) */}
			<button
				type="button"
				onClick={() => {
					setOpen((prev) => !prev);
					if (!open) handleSelectChannel(activeChannel);
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
				<div style={{ ...windowContainerStyle, ...(expanded ? windowExpandedStyle : {}) }}>
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
							style={{
								...channelBtnStyle,
								...(activeChannel === "support" ? activeChannelBtnStyle : {}),
							}}
						>
							SUPPORT
						</button>
						<button
							type="button"
							onClick={() => handleSelectChannel("officer")}
							style={{
								...channelBtnStyle,
								...(activeChannel === "officer" ? activeChannelBtnStyle : {}),
							}}
						>
							OFFICER
							{isOfficerAssigned && <span style={assignedDotStyle} />}
						</button>
						<button
							type="button"
							onClick={() => handleSelectChannel("ai")}
							style={{
								...channelBtnStyle,
								...(activeChannel === "ai" ? activeChannelBtnStyle : {}),
							}}
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

					{/* Body Content Area */}
					<div style={expanded ? bodySplitStyle : bodyStandardStyle}>
						{/* Channel 1: Support Desk */}
						{activeChannel === "support" && (
							<div style={streamContainerStyle}>
								<div style={officerHeaderCardStyle}>
									<div>
										<div style={{ fontWeight: 700, fontSize: "12px", color: "#000000", letterSpacing: "0.04em" }}>
											CENTURY SUPPORT DESK
										</div>
										<div style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>
											24/7 HELPDESK & TRIAGE
										</div>
									</div>
									<span style={stagePillStyle}>SUPPORT</span>
								</div>

								{/* Messages Stream */}
								<div style={messageListStyle}>
									{messages.length === 0 && !loadingMsgs && (
										<div style={emptySupportPromptStyle}>
											<p style={{ fontWeight: 700, fontSize: "12px", color: "#000000", marginBottom: "6px", letterSpacing: "0.04em" }}>
												DIRECT SUPPORT QUEUE
											</p>
											<p style={{ fontSize: "11px", color: "#52525b", marginBottom: "12px", lineHeight: 1.4 }}>
												Send a message directly to central support. Responses appear here in real-time.
											</p>
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
										</div>
									)}

									{messages.map((m) => {
										const isMe = !m.senderOpsUserId;
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
													<div style={bubbleAuthorStyle}>
														{isMe ? "YOU" : m.senderName.toUpperCase()}
													</div>
													<div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.content}</div>
													<div style={bubbleTimeStyle}>
														{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</div>
												</div>
											</div>
										);
									})}
									{loadingMsgs && (
										<div style={{ textAlign: "center", color: "#52525b", fontSize: "11px", padding: "10px", fontFamily: "monospace" }}>
											LOADING CONVERSATION...
										</div>
									)}
									<div ref={messagesEndRef} />
								</div>

								{/* Input Form */}
								<form onSubmit={handleSendServerMessage} style={formStyle}>
									<input
										type="text"
										value={draft}
										onChange={(e) => setDraft(e.target.value)}
										placeholder="Type a message..."
										style={inputStyle}
										disabled={sending}
									/>
									<button type="submit" disabled={!draft.trim() || sending} style={sendBtnStyle}>
										{sending ? "..." : "SEND"}
									</button>
								</form>
							</div>
						)}

						{/* Channel 2: Assigned Case Officer */}
						{activeChannel === "officer" && (
							<div style={streamContainerStyle}>
								{isOfficerAssigned ? (
									<>
										<div style={officerHeaderCardStyle}>
											<div>
												<div style={{ fontWeight: 700, fontSize: "12px", color: "#000000", letterSpacing: "0.04em" }}>
													{currentContact.contact.name.toUpperCase()}
												</div>
												<div style={{ fontSize: "10px", color: "#52525b", fontFamily: "monospace" }}>
													{(currentContact.contact.role || "").toUpperCase()} · {(currentContact.contact.branch || "").toUpperCase()}
												</div>
											</div>
											<span style={stagePillStyle}>{currentContact.stageLabel.toUpperCase()}</span>
										</div>

										<div style={messageListStyle}>
											{messages.length === 0 && !loadingMsgs && (
												<div style={{ textAlign: "center", color: "#52525b", padding: "30px 20px" }}>
													<p style={{ fontSize: "12px", color: "#000000", fontWeight: 700, letterSpacing: "0.04em" }}>
														DIRECT OFFICER THREAD
													</p>
													<p style={{ fontSize: "11px", marginTop: "4px" }}>
														Connected directly with {currentContact.contact.name}.
													</p>
												</div>
											)}
											{messages.map((m) => {
												const isMe = !m.senderOpsUserId;
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
											<div ref={messagesEndRef} />
										</div>

										<form onSubmit={handleSendServerMessage} style={formStyle}>
											<input
												type="text"
												value={draft}
												onChange={(e) => setDraft(e.target.value)}
												placeholder={`Message ${currentContact.contact.name.split(" ")[0]}...`}
												style={inputStyle}
												disabled={sending}
											/>
											<button type="submit" disabled={!draft.trim() || sending} style={sendBtnStyle}>
												{sending ? "..." : "SEND"}
											</button>
										</form>
									</>
								) : (
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
								)}
							</div>
						)}

						{/* Channel 3: AI Assistant */}
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
									<div ref={messagesEndRef} />
								</div>

								{/* AI Quick Prompts */}
								<div style={aiPromptsRowStyle}>
									{[
										"Visa requirements",
										"Scholarships",
										"Required documents",
										"Payment plan",
									].map((prompt) => (
										<button
											key={prompt}
											type="button"
											onClick={() => handleSendAiMessage(undefined, prompt)}
											style={aiQuickChipStyle}
										>
											{prompt}
										</button>
									))}
								</div>

								<form onSubmit={(e) => handleSendAiMessage(e)} style={formStyle}>
									<input
										type="text"
										value={aiDraft}
										onChange={(e) => setAiDraft(e.target.value)}
										placeholder="Ask Century AI..."
										style={inputStyle}
									/>
									<button type="submit" disabled={!aiDraft.trim() || aiTyping} style={sendBtnStyle}>
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

/* ── Strict Monochrome Brutalist Styles ───────────────────────────────── */

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
	border: "1px solid #000000",
	borderRadius: "0px",
	boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
	cursor: "pointer",
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
	bottom: "84px",
	right: "24px",
	zIndex: 9999,
	width: "390px",
	height: "580px",
	maxHeight: "calc(100vh - 100px)",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	borderRadius: "0px",
	boxShadow: "0 25px 50px rgba(0,0,0,0.9)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	color: "#000000",
	transition: "width 0.2s ease, height 0.2s ease",
};

const windowExpandedStyle: CSSProperties = {
	width: "820px",
	height: "640px",
	maxWidth: "calc(100vw - 48px)",
};

const headerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "10px 14px",
	background: "#ffffff",
	borderBottom: "1px solid #e4e4e7",
};

const indicatorDotStyle: CSSProperties = {
	width: "6px",
	height: "6px",
	background: "#10b981",
	borderRadius: "0px",
};

const headerTitleStyle: CSSProperties = {
	fontSize: "11px",
	fontWeight: 700,
	letterSpacing: "0.08em",
	fontFamily: "monospace",
	color: "#ffffff",
};

const controlBtnStyle: CSSProperties = {
	background: "transparent",
	border: "1px solid #e4e4e7",
	color: "#52525b",
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
	gridTemplateColumns: "1fr 1fr 1fr",
	borderBottom: "1px solid #e4e4e7",
	background: "#ffffff",
};

const channelBtnStyle: CSSProperties = {
	padding: "10px 4px",
	background: "transparent",
	border: "none",
	borderBottom: "2px solid transparent",
	color: "#52525b",
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
	background: "#ffffff",
};

const assignedDotStyle: CSSProperties = {
	width: "4px",
	height: "4px",
	background: "#ffffff",
	borderRadius: "0px",
};

const bodyStandardStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const bodySplitStyle: CSSProperties = {
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
	padding: "10px 14px",
	background: "#ffffff",
	borderBottom: "1px solid #e4e4e7",
};

const stagePillStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	fontWeight: 700,
	color: "#52525b",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	padding: "2px 6px",
	borderRadius: "0px",
};

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
	maxWidth: "85%",
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
	background: "#ffffff",
	color: "#000000",
	border: "1px solid #e4e4e7",
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
	background: "#ffffff",
	borderTop: "1px solid #e4e4e7",
	gap: "6px",
};

const inputStyle: CSSProperties = {
	flex: 1,
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	borderRadius: "0px",
	color: "#000000",
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
