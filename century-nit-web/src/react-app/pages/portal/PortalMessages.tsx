import { useState, useRef, useEffect, type FormEvent } from "react";
import { useAppState } from "../../context/AppState";
import { Button } from "../../components/ui/Button";

const CONSULTANT_REPLIES = [
	"Got it - I'll check and get back to you within 24 hours.",
	"That's a great question. Let me review your file and I'll update you shortly.",
	"Understood. I'll coordinate with the processing team and let you know the next steps.",
	"Thanks for the update! Everything looks good on our end.",
	"I've noted this down. We'll include it in your application file.",
	"Absolutely - we can arrange that. I'll send you the details after our next meeting.",
];

export function PortalMessages() {
	const { messages, sendMessage, authUser } = useAppState();
	const [input, setInput] = useState("");
	const [consultantTyping, setConsultantTyping] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, consultantTyping]);

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const trimmed = input.trim();
		if (!trimmed) return;
		sendMessage(trimmed);
		setInput("");

		setConsultantTyping(true);
		window.setTimeout(() => {
			const reply =
				CONSULTANT_REPLIES[Math.floor(Math.random() * CONSULTANT_REPLIES.length)];
			setConsultantTyping(false);
			sendMessage(reply);
		}, 2000 + Math.random() * 1500);
	}

	const consultantName =
		messages.find((m) => m.sender === "consultant")?.authorName ?? "Your Consultant";

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Messages</p>
					<h1 className="page-title mt-1">Chat with your consultant</h1>
					<p className="lead mt-2">
						Send questions, share updates, and get guidance from {consultantName} throughout
						your application journey.
					</p>
				</div>
			</header>

			<div
				className="card card--pad mt-4"
				style={{
					display: "flex",
					flexDirection: "column",
					height: "calc(100vh - 320px)",
					minHeight: "400px",
					padding: 0,
					overflow: "hidden",
				}}
			>
				<div
					style={{
						padding: "1rem 1.5rem",
						borderBottom: "1px solid var(--border-light)",
						display: "flex",
						alignItems: "center",
						gap: "0.75rem",
					}}
				>
					<span
						style={{
							width: "36px",
							height: "36px",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							background: "var(--foreground)",
							color: "var(--background)",
							fontWeight: 600,
							fontSize: "0.85rem",
							flexShrink: 0,
						}}
					>
						{consultantName
							.split(" ")
							.map((p) => p[0])
							.join("")
							.slice(0, 2)}
					</span>
					<div>
						<p style={{ fontWeight: 600, fontSize: "0.95rem" }}>{consultantName}</p>
						<p className="muted" style={{ fontSize: "0.8rem" }}>
							Assigned consultant · responds within 24h
						</p>
					</div>
				</div>

				<div
					ref={scrollRef}
					style={{
						flex: 1,
						overflowY: "auto",
						padding: "1.5rem",
						display: "flex",
						flexDirection: "column",
						gap: "1rem",
					}}
				>
					{messages.map((msg) => {
						const isApplicant = msg.sender === "applicant";
						return (
							<div
								key={msg.id}
								style={{
									display: "flex",
									justifyContent: isApplicant ? "flex-end" : "flex-start",
								}}
							>
								<div
									style={{
										maxWidth: "70%",
										padding: "0.75rem 1rem",
										background: isApplicant
											? "var(--foreground)"
											: "var(--muted)",
										color: isApplicant ? "var(--background)" : "var(--foreground)",
										borderRadius: isApplicant
											? "12px 12px 2px 12px"
											: "12px 12px 12px 2px",
									}}
								>
									<p style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>{msg.text}</p>
									<p
										className="mono"
										style={{
											fontSize: "0.65rem",
											opacity: 0.6,
											marginTop: "0.4rem",
										}}
									>
										{msg.authorName} ·{" "}
										{new Date(msg.at).toLocaleString([], {
											hour: "2-digit",
											minute: "2-digit",
											day: "numeric",
											month: "short",
										})}
									</p>
								</div>
							</div>
						);
					})}

					{consultantTyping ? (
						<div
							style={{
								display: "flex",
								justifyContent: "flex-start",
							}}
						>
							<div
								style={{
									padding: "0.75rem 1rem",
									background: "var(--muted)",
									borderRadius: "12px 12px 12px 2px",
									display: "flex",
									gap: "0.25rem",
								}}
							>
								<span
									style={{
										width: "6px",
										height: "6px",
										borderRadius: "50%",
										background: "var(--muted-foreground)",
										animation: "pulse 1s infinite",
									}}
								/>
								<span
									style={{
										width: "6px",
										height: "6px",
										borderRadius: "50%",
										background: "var(--muted-foreground)",
										animation: "pulse 1s infinite 0.2s",
									}}
								/>
								<span
									style={{
										width: "6px",
										height: "6px",
										borderRadius: "50%",
										background: "var(--muted-foreground)",
										animation: "pulse 1s infinite 0.4s",
									}}
								/>
							</div>
						</div>
					) : null}
				</div>

				<form
					onSubmit={handleSubmit}
					style={{
						padding: "1rem 1.5rem",
						borderTop: "1px solid var(--border-light)",
						display: "flex",
						gap: "0.75rem",
					}}
				>
					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={`Message ${consultantName}...`}
						className="input"
						style={{ flex: 1 }}
					/>
					<Button type="submit" arrow disabled={!input.trim()}>
						Send
					</Button>
				</form>
			</div>

			<p className="mono muted mt-3" style={{ fontSize: "0.75rem" }}>
				Signed in as {authUser?.name ?? "Applicant"} · Messages are simulated in this prototype
			</p>
		</div>
	);
}
