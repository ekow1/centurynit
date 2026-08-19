import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { meApi } from "century-nit-core";
import type { CommunicationContext, ChatMessage } from "century-nit-shared";

/**
 * Unified Monochrome Floating Communication Hub for Century NIT Client Portal.
 *
 * Conforms strictly to the Century NIT Brutalist Monochrome Design System.
 * Features:
 *   1. Support Desk (Default) — Always available 24/7 direct helpdesk.
 *   2. Assigned Officer — Direct 1-on-1 chat with the assigned consultant / stage specialist.
 *   3. Century AI Assistant — Instant study-abroad guidance and knowledge assistant.
 *   4. Expandable Workstation — Dual mode (Standard 390px docked floating window & Expanded 820px split workstation).
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
			text: "Hello! I am your Century NIT AI Advisor. Ask me anything about university admissions, visa requirements, scholarships, or application stages.",
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
			let replyText = "I understand your query. For detailed personal evaluation of your profile, our admissions team can guide you through the required documentation and university options. You can also chat directly with our Support Desk on the Support tab.";

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
		}, 600);
	}, [aiDraft, aiTyping]);

	// Auto-scroll on new messages
	useEffect(() => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [messages, aiMessages, activeChannel]);

	return (
		<>
			{/* Floating Capsule Launcher Button */}
			<button
				type="button"
				onClick={() => {
					setOpen((prev) => !prev);
					if (!open) handleSelectChannel(activeChannel);
				}}
				style={launcherStyle}
				aria-label="Open Communication Hub"
			>
				<span style={launcherIconStyle}>💬</span>
				<div style={launcherTextCol}>
					<span style={launcherTitleStyle}>Century Communication</span>
					<span style={launcherSubtitleStyle}>
						{totalUnread > 0 ? `${totalUnread} new message${totalUnread > 1 ? "s" : ""}` : "Support · Consultant · AI"}
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
							<span style={headerDotStyle} />
							<div>
								<h2 style={headerTitleStyle}>COMMUNICATION HUB</h2>
								<p style={headerSubtitleStyle}>CENTURY NIT APPLICANT NETWORK</p>
							</div>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
							<button
								type="button"
								onClick={() => setExpanded((prev) => !prev)}
								style={controlBtnStyle}
								title={expanded ? "Restore down" : "Expand to widescreen"}
								aria-label={expanded ? "Restore down" : "Expand"}
							>
								{expanded ? "⤡" : "⤢"}
							</button>
							<button
								type="button"
								onClick={() => setOpen(false)}
								style={controlBtnStyle}
								title="Close hub"
								aria-label="Close"
							>
								✕
							</button>
						</div>
					</header>

					{/* Channel Segmented Switcher */}
					<nav style={channelNavStyle} aria-label="Chat Channels">
						<button
							type="button"
							onClick={() => handleSelectChannel("support")}
							style={{
								...channelBtnStyle,
								...(activeChannel === "support" ? activeChannelBtnStyle : {}),
							}}
						>
							<span style={{ fontSize: "14px" }}>🛡️</span>
							<span>Support</span>
						</button>
						<button
							type="button"
							onClick={() => handleSelectChannel("officer")}
							style={{
								...channelBtnStyle,
								...(activeChannel === "officer" ? activeChannelBtnStyle : {}),
							}}
						>
							<span style={{ fontSize: "14px" }}>👤</span>
							<span>Assigned Officer</span>
							{isOfficerAssigned && (
								<span
									style={{
										width: "6px",
										height: "6px",
										borderRadius: "50%",
										background: "#10b981",
										marginLeft: "4px",
									}}
								/>
							)}
						</button>
						<button
							type="button"
							onClick={() => handleSelectChannel("ai")}
							style={{
								...channelBtnStyle,
								...(activeChannel === "ai" ? activeChannelBtnStyle : {}),
							}}
						>
							<span style={{ fontSize: "14px" }}>✨</span>
							<span>Century AI</span>
						</button>
					</nav>

					{/* Error Notification */}
					{error && (
						<div style={errorBannerStyle}>
							<span>⚠ {error}</span>
							<button type="button" onClick={() => setError(null)} style={errorCloseStyle}>✕</button>
						</div>
					)}

					{/* Body Content Area */}
					<div style={expanded ? bodySplitStyle : bodyStandardStyle}>
						{/* Channel 1: Support Desk */}
						{activeChannel === "support" && (
							<div style={streamContainerStyle}>
								<div style={officerHeaderCardStyle}>
									<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
										<span style={avatarPillStyle}>CN</span>
										<div>
											<div style={{ fontWeight: 600, fontSize: "13px", color: "#f4f4f5" }}>
												Century Support Desk
											</div>
											<div style={{ fontSize: "11px", color: "#a1a1aa", fontFamily: "monospace" }}>
												● 24/7 Helpdesk & Triage Desk
											</div>
										</div>
									</div>
									<span style={stagePillStyle}>SUPPORT</span>
								</div>

								{/* Messages Stream */}
								<div style={messageListStyle}>
									{messages.length === 0 && !loadingMsgs && (
										<div style={emptySupportPromptStyle}>
											<p style={{ fontWeight: 600, color: "#e4e4e7", marginBottom: "6px" }}>
												How can we help you today?
											</p>
											<p style={{ fontSize: "12px", color: "#a1a1aa", marginBottom: "12px", lineHeight: 1.4 }}>
												Send a message directly to our central support team. Responses appear here in real-time.
											</p>
											<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
												{["Payment & Invoices", "Document Review Status", "Visa Consultation"].map((t) => (
													<button
														key={t}
														type="button"
														onClick={() => setDraft(`Inquiry regarding ${t}: `)}
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
														{isMe ? "You" : m.senderName}
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
										<div style={{ textAlign: "center", color: "#71717a", fontSize: "12px", padding: "10px" }}>
											Loading conversation...
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
										placeholder="Message support desk..."
										style={inputStyle}
										disabled={sending}
									/>
									<button type="submit" disabled={!draft.trim() || sending} style={sendBtnStyle}>
										{sending ? "..." : "Send ➔"}
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
											<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
												<span style={avatarPillStyle}>
													{currentContact.contact.name
														.split(" ")
														.map((n) => n[0])
														.slice(0, 2)
														.join("")}
												</span>
												<div>
													<div style={{ fontWeight: 600, fontSize: "13px", color: "#f4f4f5" }}>
														{currentContact.contact.name}
													</div>
													<div style={{ fontSize: "11px", color: "#10b981", fontFamily: "monospace" }}>
														● {currentContact.contact.role} · {currentContact.contact.branch} Branch
													</div>
												</div>
											</div>
											<span style={stagePillStyle}>{currentContact.stageLabel.toUpperCase()}</span>
										</div>

										<div style={messageListStyle}>
											{messages.length === 0 && !loadingMsgs && (
												<div style={{ textAlign: "center", color: "#71717a", padding: "30px 20px" }}>
													<p style={{ fontSize: "13px", color: "#e4e4e7" }}>Direct Officer Thread</p>
													<p style={{ fontSize: "12px", marginTop: "4px" }}>
														You are connected directly with {currentContact.contact.name}. Send your questions regarding {currentContact.stageLabel}.
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
															<div style={bubbleAuthorStyle}>{isMe ? "You" : m.senderName}</div>
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
												{sending ? "..." : "Send ➔"}
											</button>
										</form>
									</>
								) : (
									<div style={unassignedStateStyle}>
										<div style={{ fontSize: "28px", marginBottom: "12px" }}>👤</div>
										<h3 style={{ fontSize: "15px", fontWeight: 700, color: "#f4f4f5", marginBottom: "8px" }}>
											CONSULTANT BEING ASSIGNED
										</h3>
										<p style={{ fontSize: "12px", color: "#a1a1aa", lineHeight: 1.5, maxWidth: "280px", margin: "0 auto 16px" }}>
											Your case coordinator or branch will assign your dedicated specialist once your booking or application milestone is active.
										</p>
										<button
											type="button"
											onClick={() => handleSelectChannel("support")}
											style={switchChannelActionBtnStyle}
										>
											Chat with Support Desk Instead ➔
										</button>
									</div>
								)}
							</div>
						)}

						{/* Channel 3: AI Assistant */}
						{activeChannel === "ai" && (
							<div style={streamContainerStyle}>
								<div style={officerHeaderCardStyle}>
									<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
										<span style={{ ...avatarPillStyle, background: "#27272a", color: "#fafafa" }}>AI</span>
										<div>
											<div style={{ fontWeight: 600, fontSize: "13px", color: "#f4f4f5" }}>
												Century AI Advisor
											</div>
											<div style={{ fontSize: "11px", color: "#a1a1aa", fontFamily: "monospace" }}>
												● Study Abroad Knowledge Assistant
											</div>
										</div>
									</div>
									<span style={stagePillStyle}>24/7 ADVISOR</span>
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
													<div style={bubbleAuthorStyle}>{isMe ? "You" : "Century AI"}</div>
													<div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.text}</div>
													<div style={bubbleTimeStyle}>
														{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</div>
												</div>
											</div>
										);
									})}
									{aiTyping && (
										<div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 12px", color: "#71717a", fontSize: "12px" }}>
											<span>Century AI is generating answer...</span>
										</div>
									)}
									<div ref={messagesEndRef} />
								</div>

								{/* AI Quick Prompts */}
								<div style={aiPromptsRowStyle}>
									{[
										"What are the visa requirements?",
										"Scholarships available?",
										"Required documents?",
										"Payment plan options?",
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
										placeholder="Ask Century AI anything..."
										style={inputStyle}
									/>
									<button type="submit" disabled={!aiDraft.trim() || aiTyping} style={sendBtnStyle}>
										Ask ➔
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

/* ── Monochrome Styles ─────────────────────────────────────────────────── */

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
	transition: "transform 0.2s, border-color 0.2s",
};

const launcherIconStyle: CSSProperties = {
	fontSize: "18px",
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
	letterSpacing: "-0.01em",
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
	width: "400px",
	height: "580px",
	maxHeight: "calc(100vh - 100px)",
	background: "#09090b",
	border: "1px solid #27272a",
	borderRadius: "8px",
	boxShadow: "0 25px 50px -12px rgba(0,0,0,0.75)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	color: "#fafafa",
	transition: "width 0.25s ease, height 0.25s ease",
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
	padding: "12px 16px",
	background: "#000000",
	borderBottom: "1px solid #27272a",
};

const headerDotStyle: CSSProperties = {
	width: "8px",
	height: "8px",
	borderRadius: "50%",
	background: "#22c55e",
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
	letterSpacing: "0.08em",
	margin: 0,
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
	gridTemplateColumns: "1fr 1fr 1fr",
	borderBottom: "1px solid #27272a",
	background: "#09090b",
};

const channelBtnStyle: CSSProperties = {
	padding: "10px 4px",
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
	transition: "color 0.15s, border-color 0.15s",
};

const activeChannelBtnStyle: CSSProperties = {
	color: "#ffffff",
	borderBottomColor: "#ffffff",
	background: "#18181b",
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
	background: "#121215",
	borderBottom: "1px solid #27272a",
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

const stagePillStyle: CSSProperties = {
	fontSize: "10px",
	fontFamily: "monospace",
	fontWeight: 700,
	color: "#a1a1aa",
	background: "#18181b",
	border: "1px solid #27272a",
	padding: "2px 6px",
	borderRadius: "2px",
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
	maxWidth: "85%",
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

const emptySupportPromptStyle: CSSProperties = {
	background: "#18181b",
	border: "1px solid #27272a",
	borderRadius: "4px",
	padding: "16px",
	margin: "auto 0",
};

const quickChipStyle: CSSProperties = {
	background: "#09090b",
	border: "1px solid #27272a",
	color: "#d4d4d8",
	fontSize: "11px",
	padding: "4px 8px",
	borderRadius: "4px",
	cursor: "pointer",
};

const aiPromptsRowStyle: CSSProperties = {
	display: "flex",
	gap: "6px",
	overflowX: "auto",
	padding: "6px 12px",
	background: "#09090b",
	borderTop: "1px solid #27272a",
};

const aiQuickChipStyle: CSSProperties = {
	whiteSpace: "nowrap",
	background: "#18181b",
	border: "1px solid #27272a",
	color: "#a1a1aa",
	fontSize: "11px",
	padding: "4px 8px",
	borderRadius: "4px",
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
	borderRadius: "4px",
	padding: "10px 16px",
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
