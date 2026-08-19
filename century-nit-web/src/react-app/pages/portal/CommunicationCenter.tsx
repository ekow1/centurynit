import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { meApi } from "century-nit-core";
import type { CommunicationContext, ContactCard, PreviousContact, ChatMessage, ChatConversation } from "century-nit-shared";

/**
 * Context-Aware Case Communication Center — the portal's floating chat.
 *
 * Replaces the old three-tab FloatingChat with a single workspace that
 * answers, without navigation: "who can help me, with what, and how do I
 * contact them?" (§23, §31). Support is always pinned; the current stage
 * officer is surfaced automatically; previous contacts are retained for
 * continuity. Conversations are case- and stage-scoped server-side, never
 * duplicated (services/communication.ts → findOrCreateConversation).
 */

const POLL_MS = 10_000;

const PRESENCE_DOT: Record<ContactCard["presence"], string> = {
	available: "#10b981",
	busy: "#f59e0b",
	on_leave: "#a78bfa",
	offline: "#94a3b8",
};

const PRESENCE_LABEL: Record<ContactCard["presence"], string> = {
	available: "Available",
	busy: "Busy",
	on_leave: "On leave",
	offline: "Away",
};

export function CommunicationCenter() {
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [context, setContext] = useState<CommunicationContext | null>(null);
	const [activeConvId, setActiveConvId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [loadingMsgs, setLoadingMsgs] = useState(false);
	const [sending, setSending] = useState(false);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [selectedKind, setSelectedKind] = useState<"support" | "current" | "previous" | "history">("current");
	const messagesRef = useRef<HTMLDivElement>(null);

	/* ── Load communication context ── */
	const loadContext = useCallback(async () => {
		try {
			const ctx = await meApi.getCommunicationContext();
			setContext(ctx);
			setError(null);
			return ctx;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't load your messages");
			return null;
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			const ctx = await loadContext();
			if (cancelled || !ctx) return;
			// Keep the active conversation in sync if it disappears.
			if (activeConvId && !ctx.conversations.some((c) => c.id === activeConvId)) {
				// leave it — messages may still be viewable
			}
		};
		void tick();
		const id = setInterval(tick, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [loadContext, activeConvId]);

	const totalUnread = useMemo(
		() => context?.conversations.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0,
		[context],
	);

	const currentContact = context?.current;
	const previousContacts = context?.previousContacts ?? [];

	/* ── Open a conversation (route → load messages) ── */
	const openConversation = useCallback(
		async (conv: ChatConversation) => {
			setActiveConvId(conv.id);
			setSelectedKind(conv.type === "support" ? "support" : "history");
			setLoadingMsgs(true);
			try {
				const res = await meApi.getCommunicationMessages(conv.id, { limit: 50 });
				setMessages(res.messages);
				setHasMore(res.hasMore);
				await meApi.markCommunicationRead(conv.id);
				// Refresh context so the unread badge updates.
				void loadContext();
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't load messages");
			} finally {
				setLoadingMsgs(false);
			}
		},
		[loadContext],
	);

	/** Route the "Chat" click on the current-contact card to the right conversation. */
	const openCurrentContact = useCallback(async () => {
		if (!context) return;
		try {
			const conv = await meApi.routeCommunication({
				caseId: undefined,
				stageKey: context.activeStageKey ?? undefined,
			});
			await openConversation(conv);
			setOpen(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't open conversation");
		}
	}, [context, openConversation]);

	/** Open the support conversation (always available). */
	const openSupport = useCallback(async () => {
		if (!context) return;
		// Find an existing support conversation, else route to create one.
		const existing = context.conversations.find((c) => c.type === "support");
		if (existing) {
			await openConversation(existing);
		} else {
			try {
				const conv = await meApi.routeCommunication();
				await openConversation(conv);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't open support");
			}
		}
		setOpen(true);
	}, [context, openConversation]);

	/** Open a conversation with a previous contact (route to their case/stage). */
	const openPreviousContact = useCallback(
		async (p: PreviousContact) => {
			try {
				// Route to the conversation for this contact's stage key, if a case is active.
				const conv = await meApi.routeCommunication(
					p.stageKey ? { stageKey: p.stageKey } : undefined,
				);
				await openConversation(conv);
				setOpen(true);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't open that conversation");
			}
		},
		[openConversation],
	);

	/* ── Send a message ── */
	const handleSend = useCallback(
		async (e: FormEvent) => {
			e.preventDefault();
			if (!activeConvId || !draft.trim() || sending) return;
			setSending(true);
			try {
				const msg = await meApi.sendCommunicationMessage(activeConvId, draft.trim());
				setMessages((m) => [...m, msg]);
				setDraft("");
				void loadContext();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Couldn't send message");
			} finally {
				setSending(false);
			}
		},
		[activeConvId, draft, sending, loadContext],
	);

	/* ── Load more (older) messages ── */
	const loadOlder = useCallback(async () => {
		if (!activeConvId || !hasMore || loadingMsgs) return;
		setLoadingMsgs(true);
		try {
			const first = messages[0];
			const res = await meApi.getCommunicationMessages(activeConvId, { before: first?.id });
			setMessages((m) => [...res.messages, ...m]);
			setHasMore(res.hasMore);
		} finally {
			setLoadingMsgs(false);
		}
	}, [activeConvId, hasMore, loadingMsgs, messages]);

	useEffect(() => {
		if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
	}, [messages, activeConvId]);

	/* ── Render ── */

	const activeConv = context?.conversations.find((c) => c.id === activeConvId) ?? null;

	const fabLabel = currentContact && currentContact.kind !== "support"
		? "contact" in currentContact ? currentContact.contact.name : "Support"
		: "Support";

	return (
		<>
			{/* Floating button — adapts to context */}
			<button
				type="button"
				onClick={() => {
					if (!open) {
						// On first open, prefer the current contact's conversation.
						if (currentContact && currentContact.kind !== "support") void openCurrentContact();
						else void openSupport();
					}
					setOpen((o) => !o);
				}}
				style={fabStyle}
				aria-label="Open communication center"
			>
				<span style={{ fontSize: 18 }}>💬</span>
				<span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.1 }}>
					<span style={{ fontWeight: 600, fontSize: 13 }}>{fabLabel}</span>
					<span style={{ fontSize: 11, opacity: 0.8 }}>
						{currentContact && currentContact.kind === "stage_officer"
							? currentContact.stageLabel
							: currentContact && currentContact.kind === "support"
								? "We're here to help"
								: "Communication"}
					</span>
				</span>
				{totalUnread > 0 && <span style={badgeStyle}>{totalUnread}</span>}
			</button>

			{open && (
				<div style={{ ...panelStyle, ...(expanded ? expandedPanelStyle : {}) }}>
					{/* Header */}
					<div style={headerStyle}>
						<span style={{ fontWeight: 700, fontSize: 15 }}>Communication Center</span>
						<div style={{ display: "flex", gap: 8 }}>
							<button
								type="button"
								onClick={() => setExpanded((x) => !x)}
								style={iconBtnStyle}
								title={expanded ? "Collapse" : "Expand"}
							>
								{expanded ? "⤡" : "⛶"}
							</button>
							<button type="button" onClick={() => setOpen(false)} style={iconBtnStyle} title="Close">
								×
							</button>
						</div>
					</div>

					<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
						{/* Left rail */}
						<div style={railStyle}>
							<RailSection
								label="Support"
								active={selectedKind === "support"}
								onClick={() => {
									setSelectedKind("support");
									void openSupport();
								}}
								subtitle="General assistance"
								italic
							/>

							{currentContact && currentContact.kind !== "support" && "contact" in currentContact && (
								<>
									<div style={sectionLabelStyle}>Your current contact</div>
									<ContactCardView
										contact={currentContact.contact}
										active={selectedKind === "current"}
										onClick={() => {
											setSelectedKind("current");
											void openCurrentContact();
										}}
										stageNote={
											currentContact.kind === "stage_officer"
												? `Currently handling your ${currentContact.stageLabel}`
												: currentContact.kind === "escalation"
													? "Escalation owner"
													: "Your case manager"
										}
									/>
								</>
							)}

							{previousContacts.length > 0 && (
								<>
									<div style={sectionLabelStyle}>Previous contacts</div>
									{previousContacts.slice(0, 6).map((p) => (
										<button
											key={p.opsUserId}
											type="button"
											onClick={() => openPreviousContact(p)}
											style={previousRowStyle}
										>
											<span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
											<span style={{ fontSize: 11, opacity: 0.7 }}>
												{p.stageLabel ?? p.role}
											</span>
										</button>
									))}
								</>
							)}

							<div style={sectionLabelStyle}>Conversations</div>
							<div style={{ overflowY: "auto", flex: 1 }}>
								{context?.conversations.map((c) => (
									<button
										key={c.id}
										type="button"
										onClick={() => openConversation(c)}
										style={{
											...convRowStyle,
											...(c.id === activeConvId ? { background: "#eef2ff" } : {}),
										}}
									>
										<span style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</span>
										<span style={{ fontSize: 11, opacity: 0.7, display: "flex", gap: 6 }}>
											<span>{typeLabel(c.type)}</span>
											{c.unreadCount > 0 && <span style={miniBadgeStyle}>{c.unreadCount}</span>}
										</span>
									</button>
								))}
								{(!context || context.conversations.length === 0) && (
									<div style={{ padding: "8px 12px", fontSize: 12, opacity: 0.6 }}>
										No conversations yet.
									</div>
								)}
							</div>
						</div>

						{/* Right: conversation thread */}
						<div style={threadStyle}>
							{activeConv ? (
								<>
									<div style={threadHeaderStyle}>
										<span style={{ fontWeight: 700, fontSize: 14 }}>{activeConv.title}</span>
										{context?.activeCaseRef && (
											<span style={{ fontSize: 11, opacity: 0.7 }}>
												Case {context.activeCaseRef}
												{activeConv.stageKey ? ` · ${stageLabel(activeConv.stageKey)}` : ""}
												{activeConv.status === "closed" ? " · Closed" : ""}
											</span>
										)}
									</div>

									<div ref={messagesRef} style={messagesStyle}>
										{hasMore && (
											<button type="button" onClick={loadOlder} style={loadMoreStyle}>
												{loadingMsgs ? "Loading…" : "Load older messages"}
											</button>
										)}
										{messages.map((m) => (
											<MessageBubble key={m.id} message={m} />
										))}
										{messages.length === 0 && !loadingMsgs && (
											<div style={{ textAlign: "center", opacity: 0.6, fontSize: 13, padding: 24 }}>
												Start the conversation — send a message below.
											</div>
										)}
									</div>

									{activeConv.status === "closed" ? (
										<div style={closedNoteStyle}>
											This conversation is closed. Contact support to reopen it.
										</div>
									) : (
										<form onSubmit={handleSend} style={composerStyle}>
											<input
												value={draft}
												onChange={(e) => setDraft(e.target.value)}
												placeholder="Type a message…"
												style={inputStyle}
												disabled={sending}
											/>
											<button
												type="submit"
												disabled={!draft.trim() || sending}
												style={sendBtnStyle}
											>
												Send
											</button>
										</form>
									)}
								</>
							) : (
								<div style={emptyThreadStyle}>
									<p style={{ fontWeight: 600 }}>How can we help?</p>
									<p style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
										Select a contact or conversation on the left, or message Support.
									</p>
									<button type="button" onClick={openSupport} style={primaryBtnStyle}>
										Message Support
									</button>
								</div>
							)}
						</div>
					</div>

					{error && (
						<div style={errorStyle}>
							{error}
							<button type="button" onClick={() => setError(null)} style={{ marginLeft: 8 }}>
								Dismiss
							</button>
						</div>
					)}
				</div>
			)}
		</>
	);
}

/* ── Subcomponents ── */

function MessageBubble({ message }: { message: ChatMessage }) {
	const isSystem = message.messageType === "system";
	const isApplicant = !message.senderOpsUserId;
	if (isSystem) {
		return (
			<div style={systemMsgStyle}>
				<span>{message.content}</span>
			</div>
		);
	}
	return (
		<div style={{ display: "flex", justifyContent: isApplicant ? "flex-end" : "flex-start", margin: "4px 0" }}>
			<div style={{ ...bubbleStyle, ...(isApplicant ? { background: "#4f46e5", color: "#fff" } : {}) }}>
				{!isApplicant && <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{message.senderName}</div>}
				<div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</div>
			</div>
		</div>
	);
}

function ContactCardView({
	contact,
	active,
	onClick,
	stageNote,
}: {
	contact: ContactCard;
	active: boolean;
	onClick: () => void;
	stageNote: string;
}) {
	return (
		<button type="button" onClick={onClick} style={{ ...contactCardStyle, ...(active ? { borderColor: "#4f46e5" } : {}) }}>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span style={{ ...dotStyle, background: PRESENCE_DOT[contact.presence] }} />
				<span style={{ fontWeight: 700, fontSize: 14 }}>{contact.name}</span>
			</div>
			<div style={{ fontSize: 12, opacity: 0.75 }}>{contact.role ?? contact.branch ?? "Your consultant"}</div>
			<div style={{ fontSize: 12, marginTop: 4 }}>
				<span style={{ color: PRESENCE_DOT[contact.presence] }}>{PRESENCE_LABEL[contact.presence]}</span>
				{contact.availabilityNote ? <span style={{ opacity: 0.6 }}> · {contact.availabilityNote}</span> : null}
			</div>
			<div style={{ fontSize: 12, marginTop: 6, fontStyle: "italic", opacity: 0.85 }}>{stageNote}</div>
			<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
				<span style={chipStyle}>💬 Chat</span>
				<a href={`mailto:${contact.email}`} style={chipStyle} onClick={(e) => e.stopPropagation()}>
					✉ Email
				</a>
			</div>
		</button>
	);
}

function RailSection({
	label,
	subtitle,
	active,
	onClick,
	italic,
}: {
	label: string;
	subtitle: string;
	active: boolean;
	onClick: () => void;
	italic?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{ ...convRowStyle, ...(active ? { background: "#eef2ff" } : {}), fontStyle: italic ? "italic" : "normal" }}
		>
			<span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
			<span style={{ fontSize: 11, opacity: 0.7 }}>{subtitle}</span>
		</button>
	);
}

/* ── Helpers ── */

function typeLabel(type: ChatConversation["type"]): string {
	const map: Record<ChatConversation["type"], string> = {
		direct: "Direct",
		entity: "Case",
		group: "Group",
		applicant: "Consultant",
		support: "Support",
		case: "Case",
		stage: "Stage",
		internal: "Internal",
		escalation: "Escalation",
	};
	return map[type] ?? type;
}

function stageLabel(key: string): string {
	const map: Record<string, string> = {
		document_verification: "Document Verification",
		school_submission: "School Submission",
		offer_letter_review: "Offer Letter Review",
		visa_processing: "Visa Processing",
		payment_execution: "Payment Execution",
		travel_assistance: "Travel Assistance",
		completed: "Completed",
	};
	return map[key] ?? key;
}

/* ── Styles ── */

const fabStyle: CSSProperties = {
	position: "fixed",
	bottom: 24,
	right: 24,
	zIndex: 9999,
	display: "flex",
	alignItems: "center",
	gap: 10,
	padding: "10px 16px",
	background: "#4f46e5",
	color: "#fff",
	border: "none",
	borderRadius: 999,
	boxShadow: "0 8px 24px rgba(79, 70, 229, 0.35)",
	cursor: "pointer",
	fontFamily: "inherit",
};

const badgeStyle: CSSProperties = {
	background: "#ef4444",
	color: "#fff",
	borderRadius: 999,
	padding: "1px 8px",
	fontSize: 11,
	fontWeight: 700,
	marginLeft: 4,
};

const panelStyle: CSSProperties = {
	position: "fixed",
	bottom: 92,
	right: 24,
	zIndex: 9998,
	width: "min(420px, calc(100vw - 32px))",
	height: "min(560px, calc(100vh - 120px))",
	background: "#fff",
	borderRadius: 16,
	boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	fontFamily: "inherit",
	color: "#0f172a",
};

const expandedPanelStyle: CSSProperties = {
	width: "min(960px, 92vw)",
	height: "min(720px, 88vh)",
};

const headerStyle: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "12px 16px",
	borderBottom: "1px solid #e2e8f0",
	background: "#f8fafc",
};

const iconBtnStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	cursor: "pointer",
	fontSize: 16,
	padding: "4px 8px",
	borderRadius: 6,
};

const railStyle: CSSProperties = {
	width: 220,
	borderRight: "1px solid #e2e8f0",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	background: "#fafbfc",
};

const sectionLabelStyle: CSSProperties = {
	padding: "10px 12px 4px",
	fontSize: 11,
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: 0.05,
	color: "#64748b",
};

const convRowStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	gap: 2,
	width: "100%",
	padding: "8px 12px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #f1f5f9",
	cursor: "pointer",
	textAlign: "left",
	fontFamily: "inherit",
};

const contactCardStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	margin: "4px 8px",
	padding: 12,
	border: "1px solid #e2e8f0",
	borderRadius: 10,
	background: "#fff",
	cursor: "pointer",
	textAlign: "left",
	fontFamily: "inherit",
};

const previousRowStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	gap: 2,
	width: "100%",
	padding: "8px 12px",
	background: "transparent",
	border: "none",
	cursor: "pointer",
	textAlign: "left",
	fontFamily: "inherit",
};

const dotStyle: CSSProperties = {
	display: "inline-block",
	width: 8,
	height: 8,
	borderRadius: "50%",
};

const chipStyle: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	padding: "2px 10px",
	fontSize: 12,
	borderRadius: 999,
	background: "#eef2ff",
	color: "#4338ca",
	textDecoration: "none",
	cursor: "pointer",
};

const miniBadgeStyle: CSSProperties = {
	background: "#ef4444",
	color: "#fff",
	borderRadius: 999,
	padding: "0 6px",
	fontSize: 10,
	fontWeight: 700,
};

const threadStyle: CSSProperties = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	minWidth: 0,
	background: "#fff",
};

const threadHeaderStyle: CSSProperties = {
	padding: "10px 16px",
	borderBottom: "1px solid #e2e8f0",
	display: "flex",
	flexDirection: "column",
	gap: 2,
};

const messagesStyle: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "12px 16px",
	display: "flex",
	flexDirection: "column",
	gap: 2,
	background: "#f8fafc",
};

const bubbleStyle: CSSProperties = {
	maxWidth: "78%",
	padding: "8px 12px",
	borderRadius: 12,
	background: "#fff",
	border: "1px solid #e2e8f0",
	fontSize: 13,
};

const systemMsgStyle: CSSProperties = {
	alignSelf: "center",
	background: "#f1f5f9",
	color: "#475569",
	fontSize: 12,
	padding: "6px 12px",
	borderRadius: 8,
	margin: "6px 0",
	textAlign: "center",
	maxWidth: "90%",
};

const composerStyle: CSSProperties = {
	display: "flex",
	gap: 8,
	padding: 12,
	borderTop: "1px solid #e2e8f0",
	background: "#fff",
};

const inputStyle: CSSProperties = {
	flex: 1,
	padding: "8px 12px",
	border: "1px solid #cbd5e1",
	borderRadius: 8,
	fontFamily: "inherit",
	fontSize: 13,
};

const sendBtnStyle: CSSProperties = {
	background: "#4f46e5",
	color: "#fff",
	border: "none",
	padding: "8px 16px",
	borderRadius: 8,
	cursor: "pointer",
	fontWeight: 600,
};

const closedNoteStyle: CSSProperties = {
	padding: 12,
	textAlign: "center",
	fontSize: 13,
	color: "#64748b",
	background: "#f8fafc",
	borderTop: "1px solid #e2e8f0",
};

const emptyThreadStyle: CSSProperties = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	textAlign: "center",
	padding: 24,
	gap: 12,
};

const primaryBtnStyle: CSSProperties = {
	background: "#4f46e5",
	color: "#fff",
	border: "none",
	padding: "8px 16px",
	borderRadius: 8,
	cursor: "pointer",
	fontWeight: 600,
};

const loadMoreStyle: CSSProperties = {
	alignSelf: "center",
	background: "transparent",
	border: "1px solid #cbd5e1",
	padding: "4px 12px",
	borderRadius: 999,
	cursor: "pointer",
	fontSize: 12,
	margin: "4px 0",
};

const errorStyle: CSSProperties = {
	padding: "8px 12px",
	background: "#fef2f2",
	color: "#b91c1c",
	fontSize: 12,
	borderTop: "1px solid #fecaca",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
};
