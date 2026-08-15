import { useState, useRef, useEffect, useMemo, type FormEvent } from "react";
import { useAppState } from "../../context/AppState";
import { useApplicantTickets } from "../../data/opsTicketBridge";
import { formatDualCurrency, CONSULTATION_FEE, type ChatMessage } from "century-nit-core";

type ChatTab = "ai" | "consultant" | "support";

const AI_REPLIES = [
	"Based on your profile, I'd recommend looking at universities in the UK or Canada for Data Science programmes.",
	"You can upload your documents in the Documents section of your portal. I'd suggest starting with your passport and academic transcripts.",
	"Your application stage is currently in progress. The typical timeline is 4–6 weeks for university responses.",
	"For IELTS, most universities require a minimum overall score of 6.5 with no band below 6.0. Some competitive programmes may ask for 7.0.",
	`That's a common question! The consultation fee is ${formatDualCurrency(CONSULTATION_FEE)} and covers your initial assessment and eligibility review.`,
	"I can help with general questions about study destinations, programme requirements, timelines, and document checklists.",
];

const CONSULTANT_REPLIES = [
	"Got it - I'll check and get back to you within 24 hours.",
	"That's a great question. Let me review your file and I'll update you shortly.",
	"Understood. I'll coordinate with the processing team and let you know the next steps.",
	"Thanks for the update! Everything looks good on our end.",
	"I've noted this down. We'll include it in your application file.",
	"Absolutely - we can arrange that. I'll send you the details after our next meeting.",
];

const SUPPORT_REPLIES = [
	"Thank you for reaching out to support. I'm looking into this for you right now.",
	"I've logged a ticket for this issue - you'll receive an update within 2 business hours.",
	"That seems to be a technical issue on our end. I've notified the engineering team.",
	"You can reset your portal password from the sign-in page. Let me know if you need help.",
	"Your payment receipt has been re-sent to your registered email address.",
	"Support hours are Mon–Fri, 9am–6pm GMT. For urgent matters outside hours, please email support@centurynit.com.",
];

const AI_SUGGESTIONS = [
	"What documents do I need?",
	"Which countries are best for my field?",
	"How long does the process take?",
	"What IELTS score do I need?",
];

const AI_WELCOME_AT = new Date(Date.now() - 3600000).toISOString();
const SUPPORT_WELCOME_AT = new Date().toISOString();

const TAB_META: Record<ChatTab, { label: string; subtitle: string; color: string }> = {
	ai: {
		label: "AI Assistant",
		subtitle: "Instant answers · always available",
		color: "#6366f1",
	},
	consultant: {
		label: "Consultant",
		// Overridden at render with the actually-assigned consultant
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

function MessageBubble({ msg }: { msg: ChatMessage }) {
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
	const { messages, sendMessage, authUser, booking, application } = useAppState();
	const { tickets: myTickets, createTicket, replyToTicket } = useApplicantTickets(authUser?.email);
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<ChatTab>("ai");
	const [input, setInput] = useState("");
	const [typing, setTyping] = useState(false);
	const [aiMessages, setAiMessages] = useState<ChatMessage[]>([
		{
			id: "ai-1",
			sender: "ai",
			authorName: "AI Assistant",
			text: "Hi! I'm your AI assistant. I can answer questions about study destinations, document requirements, timelines, and more. How can I help you today?",
			at: AI_WELCOME_AT,
		},
	]);
	const scrollRef = useRef<HTMLDivElement>(null);

	/**
	 * Support is a real ticket, not a scripted chat. The applicant's most recent
	 * unresolved external ticket *is* this thread — staff reply to it from the
	 * ops helpdesk and it shows up here.
	 */
	const openTicket = useMemo(
		// `myTickets` is already this applicant's own, newest first.
		() => myTickets.find((t) => t.status !== "Resolved") ?? null,
		[myTickets],
	);

	const supportMessages: ChatMessage[] = useMemo(() => {
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

	const currentMessages =
		tab === "ai" ? aiMessages : tab === "consultant" ? messages : supportMessages;

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [currentMessages, typing, open]);

	function getReplies(): string[] {
		if (tab === "ai") return AI_REPLIES;
		if (tab === "consultant") return CONSULTANT_REPLIES;
		return SUPPORT_REPLIES;
	}

	function getSenderName(): string {
		if (tab === "ai") return "AI Assistant";
		// Replies must come from the consultant this applicant was actually
		// assigned, or the thread contradicts the appointment card
		if (tab === "consultant") return booking.consultantName ?? "Your consultant";
		return openTicket?.assignedTo || "Century Support";
	}

	function getSetter():
		| React.Dispatch<React.SetStateAction<ChatMessage[]>>
		| null {
		if (tab === "ai") return setAiMessages;
		// Support is backed by a ticket, not local state
		return null;
	}

	function pushReply(text: string) {
		const reply: ChatMessage = {
			id: `${tab}-reply-${Date.now().toString(36)}`,
			sender: tab === "ai" ? "ai" : tab === "consultant" ? "consultant" : "support",
			authorName: getSenderName(),
			text,
			at: new Date().toISOString(),
		};
		if (tab === "consultant") {
			sendMessage(text);
		} else {
			const setter = getSetter();
			if (setter) setter((prev) => [...prev, reply]);
		}
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const trimmed = input.trim();
		if (!trimmed) return;

		const userMsg: ChatMessage = {
			id: `${tab}-user-${Date.now().toString(36)}`,
			sender: "applicant",
			authorName: authUser?.name ?? "You",
			text: trimmed,
			at: new Date().toISOString(),
		};

		if (tab === "consultant") {
			sendMessage(trimmed);
		} else if (tab === "support") {
			// Real ticketing: append to the open request, or raise a new one.
			// No scripted reply here — a person answers from the ops helpdesk.
			if (openTicket) {
				replyToTicket(openTicket.id, trimmed, authUser?.name ?? "Applicant");
			} else {
				createTicket({
					// First sentence becomes the subject staff see in the queue
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
		} else {
			const setter = getSetter();
			if (setter) setter((prev) => [...prev, userMsg]);
		}

		setInput("");
		setTyping(true);

		const delay = tab === "ai" ? 800 + Math.random() * 600 : 2000 + Math.random() * 1500;
		window.setTimeout(() => {
			const replies = getReplies();
			const reply = replies[Math.floor(Math.random() * replies.length)];
			setTyping(false);
			pushReply(reply);
		}, delay);
	}

	function handleSuggestion(text: string) {
		setInput(text);
	}

	// Name the consultant the flow actually assigned, not a hardcoded one
	const base = TAB_META[tab];
	const meta =
		tab === "consultant" && booking.consultantName
			? { ...base, subtitle: `${booking.consultantName} · responds within 24h` }
			: tab === "support" && openTicket
				? {
						...base,
						// Give the applicant the reference so they can quote it
						subtitle: `${openTicket.ref} · ${openTicket.status}${
							openTicket.assignedTo ? ` · ${openTicket.assignedTo}` : " · awaiting triage"
						}`,
					}
				: base;

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
				<div className="chat-panel">
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
							<Avatar tab={tab} name={booking.consultantName} />
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
										setTyping(false);
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
						{currentMessages.map((msg) => (
							<MessageBubble key={msg.id} msg={msg} />
						))}

						{typing ? (
							<div style={{ display: "flex", justifyContent: "flex-start" }}>
								<TypingDots />
							</div>
						) : null}

						{tab === "ai" && aiMessages.length <= 1 && !typing ? (
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

					{/* Input */}
					<form
						onSubmit={handleSubmit}
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
