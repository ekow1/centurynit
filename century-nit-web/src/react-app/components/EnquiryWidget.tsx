import { useState, useRef, useEffect, useMemo, type FormEvent } from "react";
import { company } from "century-nit-core";
import { useEnquiry, type EnquiryTab } from "./EnquiryContext";
import { useAiChat } from "../hooks/useAiChat";

type Msg = {
	id: string;
	sender: "ai" | "user";
	text: string;
};

const AI_SUGGESTIONS = [
	"Which countries can I study in?",
	"What documents do I need?",
	"How much does it cost?",
	"How long does visa processing take?",
];

const TAB_META: Record<EnquiryTab, { label: string; subtitle: string; color: string }> = {
	ai: {
		label: "Ask AI",
		subtitle: "Instant answers · always available",
		color: "#6366f1",
	},
	whatsapp: {
		label: "WhatsApp",
		subtitle: "Chat with us directly",
		color: "#25D366",
	},
	email: {
		label: "Email",
		subtitle: "Send us a message",
		color: "#ea580c",
	},
};

function EnquiryIcon() {
	return (
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

function SendIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<line x1="22" y1="2" x2="11" y2="13" />
			<polygon points="22 2 15 22 11 13 2 9 22 2" />
		</svg>
	);
}

function WhatsAppIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
			<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.149-.197.297-.767.967-.94 1.165-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
		</svg>
	);
}

function EmailIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<rect x="2" y="4" width="20" height="16" rx="0" />
			<path d="m22 7-10 5L2 7" />
		</svg>
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
						animation: `eq-pulse 1s ${delay}s infinite`,
					}}
				/>
			))}
		</div>
	);
}

function waLink(phone: string) {
	const cleaned = phone.replace(/[^0-9]/g, "");
	return `https://wa.me/${cleaned}?text=${encodeURIComponent("Hello Century NIT Consult, I'd like to enquire about studying abroad.")}`;
}

export function EnquiryWidget() {
	const { open, setOpen, tab, setTab } = useEnquiry();
	const [input, setInput] = useState("");

	// AI chat — streamed from the Workers AI edge endpoint. The public site is
	// gated once by the first-visit Turnstile gate (signed `cnit_v` cookie), so
	// no per-message challenge is needed here.
	const aiChat = useAiChat("web");
	const aiMessages: Msg[] = useMemo(
		() =>
			aiChat.messages.map((m) => ({
				id: m.id,
				sender: m.role === "user" ? "user" : ("ai" as const),
				text: m.content,
			})),
		[aiChat.messages],
	);
	const aiTyping = aiChat.typing;
	const canSend = !aiTyping;

	const [emailForm, setEmailForm] = useState({ name: "", email: "", message: "" });
	const [emailSent, setEmailSent] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [aiMessages, aiTyping, open]);

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const trimmed = input.trim();
		if (!trimmed || !canSend) return;
		setInput("");
		void aiChat.send(trimmed);
	}

	function handleSuggestion(text: string) {
		setInput(text);
	}

	function handleEmailSubmit(e: FormEvent) {
		e.preventDefault();
		if (!emailForm.email.includes("@") || !emailForm.message.trim()) return;
		const subject = encodeURIComponent(`Enquiry from ${emailForm.name || "Website visitor"}`);
		const body = encodeURIComponent(
			`Name: ${emailForm.name}\nEmail: ${emailForm.email}\n\n${emailForm.message}`,
		);
		window.location.href = `mailto:${company.email}?subject=${subject}&body=${body}`;
		setEmailSent(true);
	}

	const meta = TAB_META[tab];

	return (
		<>
			<style>{`
				@keyframes eq-pulse {
					0%, 100% { opacity: 0.3; transform: scale(0.8); }
					50% { opacity: 1; transform: scale(1); }
				}
				@keyframes eq-slide-up {
					from { opacity: 0; transform: translateY(12px); }
					to { opacity: 1; transform: translateY(0); }
				}
				@keyframes eq-badge {
					0%, 100% { transform: scale(1); }
					50% { transform: scale(1.2); }
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
							<span
								style={{
									width: "32px",
									height: "32px",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									background: meta.color,
									color: "#fff",
									borderRadius: "0",
									flexShrink: 0,
								}}
							>
								{tab === "ai" ? (
									<span style={{ fontSize: "0.7rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>AI</span>
								) : tab === "whatsapp" ? (
									<WhatsAppIcon />
								) : (
									<EmailIcon />
								)}
							</span>
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
							aria-label="Close enquiry"
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
						{(["ai", "whatsapp", "email"] as EnquiryTab[]).map((t) => {
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
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										gap: "0.3rem",
									}}
								>
									{m.label}
								</button>
							);
						})}
					</div>

					{/* Content area */}
					{tab === "ai" && (
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
								{aiMessages.map((msg) => (
									<div
										key={msg.id}
										style={{
											display: "flex",
											justifyContent: msg.sender === "user" ? "flex-end" : "flex-start",
										}}
									>
										<div
											style={{
												maxWidth: "78%",
												padding: "0.6rem 0.9rem",
												background: msg.sender === "user" ? "var(--foreground)" : "var(--muted)",
												color: msg.sender === "user" ? "var(--background)" : "var(--foreground)",
												borderRadius: "0",
											}}
										>
											<p style={{ fontSize: "0.85rem", lineHeight: 1.5 }}>{msg.text}</p>
										</div>
									</div>
								))}

							{aiTyping ? (
								<div style={{ display: "flex", justifyContent: "flex-start" }}>
									<TypingDots />
								</div>
							) : null}

							{aiMessages.length <= 1 && !aiTyping ? (
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

						<form
							onSubmit={handleSubmit}
							style={{
								padding: "0.6rem 0.75rem",
								display: "flex",
								gap: "0.5rem",
								background: "var(--card)",
							}}
						>
							<input
								type="text"
								value={input}
								onChange={(e) => setInput(e.target.value)}
								placeholder="Ask about studying abroad..."
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
								disabled={!canSend}
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
									cursor: canSend ? "pointer" : "default",
									opacity: canSend ? 1 : 0.4,
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

					{tab === "whatsapp" && (
						<div
							style={{
								flex: 1,
								overflowY: "auto",
								padding: "1rem",
								display: "flex",
								flexDirection: "column",
								gap: "0.75rem",
							}}
						>
							<div
								style={{
									padding: "1rem",
									background: "#25D366",
									color: "#fff",
									borderRadius: "0",
									textAlign: "center",
								}}
							>
								<WhatsAppIcon />
								<p style={{ fontWeight: 600, fontSize: "0.9rem", marginTop: "0.5rem" }}>
									Chat with us on WhatsApp
								</p>
								<p style={{ fontSize: "0.75rem", opacity: 0.85, marginTop: "0.25rem" }}>
									Tap a number below to start a conversation
								</p>
							</div>

							{company.branches.map((branch) => (
								<div key={branch.id}>
									<p
										className="mono muted"
										style={{ fontSize: "0.7rem", marginBottom: "0.5rem" }}
									>
										{branch.name}
									</p>
									<p
										className="muted"
										style={{ fontSize: "0.72rem", marginBottom: "0.6rem" }}
									>
										{branch.address}
									</p>
									{branch.phones.map((phone) => (
										<a
											key={phone}
											href={waLink(phone)}
											target="_blank"
											rel="noreferrer"
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.6rem",
												padding: "0.7rem 0.9rem",
												background: "var(--muted)",
												border: "1px solid var(--border-light)",
												borderRadius: "0",
												textDecoration: "none",
												color: "var(--foreground)",
												marginBottom: "0.4rem",
												transition: "border-color 150ms, background 150ms",
											}}
											onMouseEnter={(e) => {
												e.currentTarget.style.borderColor = "#25D366";
												e.currentTarget.style.background = "rgba(37, 211, 102, 0.05)";
											}}
											onMouseLeave={(e) => {
												e.currentTarget.style.borderColor = "var(--border-light)";
												e.currentTarget.style.background = "var(--muted)";
											}}
										>
											<span style={{ color: "#25D366", display: "flex", flexShrink: 0 }}>
												<WhatsAppIcon />
											</span>
											<span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
												{phone}
											</span>
											<span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--muted-foreground)" }}>
												→
											</span>
										</a>
									))}
								</div>
							))}

							<div
								style={{
									marginTop: "auto",
									padding: "0.75rem",
									background: "var(--muted)",
									borderRadius: "0",
									textAlign: "center",
								}}
							>
								<p className="mono muted" style={{ fontSize: "0.68rem" }}>
									{company.hours}
								</p>
							</div>
						</div>
					)}

					{tab === "email" && (
						<div
							style={{
								flex: 1,
								overflowY: "auto",
								padding: "1rem",
							}}
						>
							{emailSent ? (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										justifyContent: "center",
										height: "100%",
										textAlign: "center",
										gap: "0.75rem",
									}}
								>
									<span style={{ fontSize: "2rem" }}>✓</span>
									<p style={{ fontWeight: 600, fontSize: "0.95rem" }}>
										Your email client is opening
									</p>
									<p className="muted" style={{ fontSize: "0.8rem" }}>
										We'll reply to {emailForm.email} within 24 hours.
									</p>
									<button
										type="button"
										onClick={() => {
											setEmailSent(false);
											setEmailForm({ name: "", email: "", message: "" });
										}}
										style={{
											background: "none",
											border: "1px solid var(--border)",
											borderRadius: "0",
											padding: "0.4rem 1rem",
											fontSize: "0.8rem",
											cursor: "pointer",
											color: "var(--foreground)",
										}}
									>
										Send another
									</button>
								</div>
							) : (
								<form
									onSubmit={handleEmailSubmit}
									style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
								>
									<p
										className="muted"
										style={{ fontSize: "0.8rem", lineHeight: 1.5 }}
									>
										Send us a quick message and we'll get back to you within 24 hours.
									</p>
									<div>
										<label
											htmlFor="eq-name"
											style={{
												display: "block",
												fontSize: "0.72rem",
												fontWeight: 600,
												marginBottom: "0.3rem",
												color: "var(--muted-foreground)",
											}}
										>
											Your name
										</label>
										<input
											id="eq-name"
											type="text"
											value={emailForm.name}
											onChange={(e) => setEmailForm({ ...emailForm, name: e.target.value })}
											placeholder="John Doe"
											style={{
												width: "100%",
												border: "1px solid var(--border-light)",
												borderRadius: "0",
												padding: "0.5rem 0.75rem",
												fontSize: "0.85rem",
												background: "var(--background)",
												color: "var(--foreground)",
												outline: "none",
											}}
										/>
									</div>
									<div>
										<label
											htmlFor="eq-email"
											style={{
												display: "block",
												fontSize: "0.72rem",
												fontWeight: 600,
												marginBottom: "0.3rem",
												color: "var(--muted-foreground)",
											}}
										>
											Your email
										</label>
										<input
											id="eq-email"
											type="email"
											value={emailForm.email}
											onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
											placeholder="you@example.com"
											required
											style={{
												width: "100%",
												border: "1px solid var(--border-light)",
												borderRadius: "0",
												padding: "0.5rem 0.75rem",
												fontSize: "0.85rem",
												background: "var(--background)",
												color: "var(--foreground)",
												outline: "none",
											}}
										/>
									</div>
									<div>
										<label
											htmlFor="eq-msg"
											style={{
												display: "block",
												fontSize: "0.72rem",
												fontWeight: 600,
												marginBottom: "0.3rem",
												color: "var(--muted-foreground)",
											}}
										>
											Message
										</label>
										<textarea
											id="eq-msg"
											value={emailForm.message}
											onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })}
											placeholder="I'd like to know more about..."
											required
											rows={4}
											style={{
												width: "100%",
												border: "1px solid var(--border-light)",
												borderRadius: "0",
												padding: "0.5rem 0.75rem",
												fontSize: "0.85rem",
												background: "var(--background)",
												color: "var(--foreground)",
												outline: "none",
												resize: "vertical",
												fontFamily: "inherit",
											}}
										/>
									</div>
									<button
										type="submit"
										disabled={!emailForm.email.includes("@") || !emailForm.message.trim()}
										style={{
											width: "100%",
											padding: "0.65rem",
											fontSize: "0.85rem",
											fontWeight: 600,
											background: "var(--foreground)",
											color: "var(--background)",
											border: "none",
											borderRadius: "0",
											cursor:
												emailForm.email.includes("@") && emailForm.message.trim()
													? "pointer"
													: "default",
											opacity:
												emailForm.email.includes("@") && emailForm.message.trim() ? 1 : 0.4,
											transition: "opacity 150ms",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: "0.4rem",
										}}
									>
										<EmailIcon />
										Send Enquiry
									</button>
									<p
										className="mono muted"
										style={{ fontSize: "0.68rem", textAlign: "center" }}
									>
										Or email us directly at {company.email}
									</p>
								</form>
							)}
						</div>
					)}
				</div>
			) : null}

			{/* Floating button */}
			<button
				type="button"
				className="fab"
				onClick={() => setOpen((v) => !v)}
				aria-label={open ? "Close enquiry" : "Make an enquiry"}
			>
				{open ? <CloseIcon /> : <EnquiryIcon />}
				{!open ? (
					<span
						style={{
							position: "absolute",
							top: "-2px",
							right: "-2px",
							width: "12px",
							height: "12px",
							background: "#25D366",
							borderRadius: "50%",
							border: "2px solid var(--background)",
							animation: "eq-badge 2s ease-in-out infinite",
						}}
					/>
				) : null}
			</button>
		</>
	);
}
