import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent } from "react";
import { useAppState } from "../../context/AppState";
import { useApplicantTickets } from "../../data/opsTicketBridge";
import { type ChatMessage as LocalChatMessage } from "century-nit-core";
import type { ChatMessage as SharedChatMessage, QuotedMessage } from "century-nit-shared";
import {
	ensureChatUiStyles,
	MessageList,
	Composer,
	type MessageActionsConfig,
} from "century-nit-chat-ui";
import { useApplicantChat } from "../../hooks/useApplicantChat";
import { useAiChat } from "../../hooks/useAiChat";

type ChatTab = "ai" | "consultant" | "support";

const AI_SUGGESTIONS = [
	"What documents do I need?",
	"Which countries are best for my field?",
	"How long does the process take?",
	"What IELTS score do I need?",
];

const SUPPORT_WELCOME_AT = new Date().toISOString();

const TAB_META: Record<ChatTab, { label: string; subtitle: string; color: string }> = {
	ai: {
		label: "AI Assistant",
		subtitle: "Instant answers · always available",
		color: "#6366f1",
	},
	consultant: {
		label: "Consultant",
		subtitle: "Responds within 24h",
		color: "#10b981",
	},
	support: {
		label: "Support",
		subtitle: "Technical & account help",
		color: "#f59e0b",
	},
};

function ChatIcon() {
	return (
		<svg
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

function SendIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<line x1="22" y1="2" x2="11" y2="13" />
			<polygon points="22 2 15 22 11 13 2 9 22 2" />
		</svg>
	);
}

function Avatar({ tab, name }: { tab: ChatTab; name?: string | null }) {
	const meta = TAB_META[tab];
	if (tab === "ai") {
		return (
			<span
				style={{
					width: "32px",
					height: "32px",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: meta.color,
					color: "#fff",
					borderRadius: "10px",
					flexShrink: 0,
					fontSize: "0.8rem",
					fontWeight: 700,
					fontFamily: "var(--font-mono)",
				}}
			>
				AI
			</span>
		);
	}
	const initials =
		tab === "consultant"
			? (name
					?.split(" ")
					.map((n) => n[0])
					.slice(0, 2)
					.join("")
					.toUpperCase() ?? "··")
			: "CS";
	return (
		<span
			style={{
				width: "32px",
				height: "32px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: meta.color,
				color: "#fff",
				borderRadius: "50%",
				flexShrink: 0,
				fontSize: "0.75rem",
				fontWeight: 600,
			}}
		>
			{initials}
		</span>
	);
}

function TypingDots() {
	return (
		<div
			style={{
				display: "flex",
				gap: "0.25rem",
				padding: "0.6rem 0.9rem",
				background: "var(--muted)",
				borderRadius: "0",
				width: "fit-content",
			}}
		>
			{[0, 0.2, 0.4].map((delay) => (
				<span
					key={delay}
					style={{
						width: "6px",
						height: "6px",
						borderRadius: "50%",
						background: "var(--muted-foreground)",
						animation: `fc-pulse 1s ${delay}s infinite`,
					}}
				/>
			))}
		</div>
	);
}

function ScriptedMessageBubble({ msg }: { msg: LocalChatMessage }) {
	const isApplicant = msg.sender === "applicant";
	return (
		<div
			style={{
				display: "flex",
				justifyContent: isApplicant ? "flex-end" : "flex-start",
			}}
		>
			<div
				style={{
					maxWidth: "78%",
					padding: "0.6rem 0.9rem",
					background: isApplicant ? "var(--foreground)" : "var(--muted)",
					color: isApplicant ? "var(--background)" : "var(--foreground)",
					borderRadius: "0",
				}}
			>
				<p style={{ fontSize: "0.85rem", lineHeight: 1.5 }}>{msg.text}</p>
				<p
					className="mono"
					style={{
						fontSize: "0.6rem",
						opacity: 0.55,
						marginTop: "0.3rem",
					}}
				>
					{msg.authorName} ·{" "}
					{new Date(msg.at).toLocaleString([], {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</p>
			</div>
		</div>
	);
}

export function FloatingChat() {
	const { authUser, booking, application } = useAppState();
	const { tickets: myTickets, createTicket, replyToTicket } = useApplicantTickets(authUser?.email);
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<ChatTab>("ai");
	const [input, setInput] = useState("");

	// Consultant tab — real chat via shared components + SSE.
	const applicantChat = useApplicantChat(!!authUser);
	const [consultantDraft, setConsultantDraft] = useState("");
	const [consultantReplyTo, setConsultantReplyTo] = useState<QuotedMessage | null>(null);

	// AI tab — real streaming chat via the Workers AI edge endpoint.
	const aiChat = useAiChat("portal-floating", {
		getContext: () => ({
			applicantName: authUser?.name ?? booking.assessment?.firstName ?? "",
			destination: application.destinationId ?? "",
		}),
	});
	const aiMessages: LocalChatMessage[] = useMemo(
		() =>
			aiChat.messages.map((m) => ({
				id: m.id,
				sender: m.role === "user" ? "applicant" : "ai",
				authorName: m.role === "user" ? (authUser?.name ?? "You") : "AI Assistant",
				text: m.content,
				at: m.at,
			})),
		[aiChat.messages, authUser?.name],
	);
	const aiTyping = aiChat.typing;
	const scrollRef = useRef<HTMLDivElement>(null);

	const openTicket = useMemo(
		() => myTickets.find((t) => t.status !== "Resolved") ?? null,
		[myTickets],
	);

	const supportMessages: LocalChatMessage[] = useMemo(() => {
		if (!openTicket) {
			return [
				{
					id: "sup-welcome",
					sender: "support",
					authorName: "Century Support",
					text: "Tell us what you need help with and we'll raise a request for you. A member of the team picks it up and replies right here.",
					at: SUPPORT_WELCOME_AT,
				},
			];
		}
		return openTicket.messages.map((m) => ({
			id: m.id,
			sender: m.role === "applicant" ? "applicant" : "support",
			authorName: m.role === "applicant" ? (authUser?.name ?? "You") : m.author,
			text: m.body,
			at: m.at,
		}));
	}, [openTicket, authUser]);

	useEffect(() => {
		if (scrollRef.current && tab !== "consultant") {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [aiMessages, supportMessages, aiTyping, open, tab]);

	function handleScriptedSubmit(e: FormEvent) {
		e.preventDefault();
		const trimmed = input.trim();
		if (!trimmed) return;

		if (tab === "support") {
			if (openTicket) {
				replyToTicket(openTicket.id, trimmed);
			} else {
				createTicket({
					title: trimmed.split(/[.!?\n]/)[0].slice(0, 80) || "Support request",
					description: trimmed,
					category: "Other",
					createdBy: authUser?.name ?? "Applicant",
					createdByEmail: authUser?.email ?? "",
					applicantRef: application.applicationId ?? booking.confirmationId ?? undefined,
				});
			}
			setInput("");
			return;
		}

		// AI tab — streamed from the Workers AI edge endpoint.
		setInput("");
		void aiChat.send(trimmed);
	}

	function handleSuggestion(text: string) {
		setInput(text);
	}

	const base = TAB_META[tab];
	const meta =
		tab === "consultant" && (applicantChat.consultantName ?? booking.consultantName)
			? { ...base, subtitle: `${applicantChat.consultantName ?? booking.consultantName} · responds within 24h` }
			: tab === "support" && openTicket
				? {
						...base,
						subtitle: `${openTicket.ref} · ${openTicket.status}${
							openTicket.assignedTo ? ` · ${openTicket.assignedTo}` : " · awaiting triage"
						}`,
					}
				: base;

	// Consultant tab — shared component callbacks.
	const isOwn = useCallback(
		(m: SharedChatMessage) => m.senderOpsUserId == null,
		[],
	);

	const consultantActions = useMemo<MessageActionsConfig>(() => ({
		reply: true,
		react: false,
		forward: false,
		copy: true,
		edit: false,
		delete: false,
		more: false,
	}), []);

	const consultantBubbleProps = useMemo(() => ({
		actions: consultantActions,
		onReply: (m: SharedChatMessage) => {
			if (m.deletedAt) return;
			setConsultantReplyTo({
				id: m.id,
				senderName: m.senderName,
				content: m.content,
				deleted: m.deletedAt !== null && m.deletedAt !== undefined,
			});
		},
		onQuoteClick: () => {},
	}), [consultantActions]);

	const handleConsultantSend = useCallback(
		async (text: string) => {
			if (!text.trim()) return;
			await applicantChat.send(text);
			setConsultantReplyTo(null);
		},
		[applicantChat],
	);

	ensureChatUiStyles();

	return (
		<>
			<style>{`
				@keyframes fc-pulse {
					0%, 100% { opacity: 0.3; transform: scale(0.8); }
					50% { opacity: 1; transform: scale(1); }
				}
				@keyframes fc-slide-up {
					from { opacity: 0; transform: translateY(12px); }
					to { opacity: 1; transform: translateY(0); }
				}
			`}</style>

			{open ? (
				<div className="chat-panel cn-chat">
					{/* Header */}
					<div
						style={{
							padding: "0.75rem 1rem",
							borderBottom: "1px solid var(--border-light)",
							background: "var(--muted)",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
							<Avatar tab={tab} name={applicantChat.consultantName ?? booking.consultantName} />
							<div>
								<p style={{ fontWeight: 600, fontSize: "0.85rem" }}>{meta.label}</p>
								<p className="muted" style={{ fontSize: "0.7rem" }}>{meta.subtitle}</p>
							</div>
						</div>
						<button
							type="button"
							onClick={() => setOpen(false)}
							style={{
								background: "none",
								border: "none",
								cursor: "pointer",
								color: "var(--muted-foreground)",
								padding: "0.25rem",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
							aria-label="Close chat"
						>
							<CloseIcon />
						</button>
					</div>

					{/* Tab switcher */}
					<div
						style={{
							display: "flex",
							gap: "0.25rem",
							padding: "0.5rem",
							borderBottom: "1px solid var(--border-light)",
							background: "var(--card)",
						}}
					>
						{(["ai", "consultant", "support"] as ChatTab[]).map((t) => {
							const m = TAB_META[t];
							const active = tab === t;
							return (
								<button
									key={t}
									type="button"
									onClick={() => {
										setTab(t);
									}}
									style={{
										flex: 1,
										padding: "0.4rem 0.5rem",
										fontSize: "0.72rem",
										fontWeight: active ? 600 : 400,
										background: active ? "var(--foreground)" : "transparent",
										color: active ? "var(--background)" : "var(--muted-foreground)",
								border: "none",
									borderRadius: "0",
									cursor: "pointer",
										transition: "all 150ms",
										textAlign: "center",
									}}
								>
									{m.label}
								</button>
							);
						})}
					</div>

					{/* Messages */}
					{tab === "consultant" ? (
						<>
							<MessageList
								messages={applicantChat.messages}
								typing={applicantChat.typing}
								isOwn={isOwn}
								bubbleProps={consultantBubbleProps}
								header={
									applicantChat.loading && applicantChat.messages.length === 0 ? (
										<div style={{ textAlign: "center", color: "var(--cn-chat-muted-fg)", fontSize: 12, padding: 16 }}>
											Loading messages...
										</div>
									) : null
								}
							/>
							<Composer
								value={consultantDraft}
								onChange={setConsultantDraft}
								onSend={handleConsultantSend}
								sending={applicantChat.sending}
								replyTo={consultantReplyTo}
								onCancelReply={() => setConsultantReplyTo(null)}
								placeholder={`Message ${applicantChat.consultantName ?? "your consultant"}…`}
							/>
						</>
					) : (
						<>
							<div
								ref={scrollRef}
								style={{
									flex: 1,
									overflowY: "auto",
									padding: "1rem",
									display: "flex",
									flexDirection: "column",
									gap: "0.75rem",
								}}
							>
								{(tab === "ai" ? aiMessages : supportMessages).map((msg) => (
									<ScriptedMessageBubble key={msg.id} msg={msg} />
								))}

								{tab === "ai" && aiTyping ? (
									<div style={{ display: "flex", justifyContent: "flex-start" }}>
										<TypingDots />
									</div>
								) : null}

								{tab === "ai" && aiMessages.length <= 1 && !aiTyping ? (
									<div
										style={{
											display: "flex",
											flexWrap: "wrap",
											gap: "0.4rem",
											paddingTop: "0.5rem",
										}}
									>
										{AI_SUGGESTIONS.map((s) => (
											<button
												key={s}
												type="button"
												onClick={() => handleSuggestion(s)}
												style={{
												padding: "0.35rem 0.7rem",
												fontSize: "0.72rem",
												background: "var(--muted)",
												border: "1px solid var(--border-light)",
												borderRadius: "0",
												cursor: "pointer",
													color: "var(--foreground)",
													transition: "border-color 150ms",
												}}
												onMouseEnter={(e) => {
													e.currentTarget.style.borderColor = "var(--border)";
												}}
												onMouseLeave={(e) => {
													e.currentTarget.style.borderColor = "var(--border-light)";
												}}
											>
												{s}
											</button>
										))}
									</div>
								) : null}
							</div>

							{/* Input — scripted tabs */}
							<form
								onSubmit={handleScriptedSubmit}
								style={{
									padding: "0.6rem 0.75rem",
									borderTop: "1px solid var(--border-light)",
									display: "flex",
									gap: "0.5rem",
									background: "var(--card)",
								}}
							>
								<input
									type="text"
									value={input}
									onChange={(e) => setInput(e.target.value)}
									placeholder={`Message ${meta.label}...`}
									style={{
										flex: 1,
										border: "1px solid var(--border-light)",
										borderRadius: "0",
										padding: "0.5rem 0.75rem",
										fontSize: "0.85rem",
										background: "var(--background)",
										color: "var(--foreground)",
										outline: "none",
									}}
								/>
								<button
									type="submit"
									disabled={!input.trim()}
									style={{
										width: "36px",
										height: "36px",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										background: "var(--foreground)",
										color: "var(--background)",
										border: "none",
										borderRadius: "0",
										cursor: input.trim() ? "pointer" : "default",
										opacity: input.trim() ? 1 : 0.4,
										flexShrink: 0,
										transition: "opacity 150ms",
									}}
									aria-label="Send message"
								>
									<SendIcon />
								</button>
							</form>
						</>
					)}
				</div>
			) : null}

			{/* Floating button */}
			<button
				type="button"
				className="fab"
				onClick={() => setOpen((v) => !v)}
				aria-label={open ? "Close chat" : "Open chat"}
			>
				{open ? <CloseIcon /> : <ChatIcon />}
			</button>
		</>
	);
}
