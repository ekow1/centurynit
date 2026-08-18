import { useState, useRef, useEffect, useMemo } from "react";
import { useOpsAuth } from "./OpsAuthContext";
import {
	useChatConversations,
	useChatMessages,
	useChatUnread,
	useStaffDirectory,
	useCreateConversation,
} from "../hooks/useChatApi";
import type { ChatConversation, ChatMessage, StaffDirectoryEntry } from "../lib/api";

/**
 * Floating Chat Widget — persistent bottom-right chat bubble that expands
 * into a compact conversation panel. Replaces the old full-page /chat route.
 */

function relativeTime(iso: string) {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.round(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

const ENTITY_LABELS: Record<string, string> = {
	consultation: "Consultation",
	application: "Application",
	booking: "Booking",
};

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 520;

export function EnterpriseChat() {
	const { opsUser } = useOpsAuth();
	const [open, setOpen] = useState(false);
	const { conversations, loading: convosLoading, refresh: refreshConversations } = useChatConversations();
	const { unread, refresh: refreshUnread } = useChatUnread();
	const staffDirectory = useStaffDirectory();
	const { create: createConversation, creating } = useCreateConversation();

	const [activeId, setActiveId] = useState<string | null>(null);
	const [showNewChat, setShowNewChat] = useState(false);
	const [searchStaff, setSearchStaff] = useState("");
	const [composingTitle, setComposingTitle] = useState("");
	const [selectedStaff, setSelectedStaff] = useState<string[]>([]);

	const active = useMemo(
		() => conversations.find((c) => c.id === activeId) ?? null,
		[conversations, activeId],
	);

	const totalUnread = unread.totalUnread;

	return (
		<>
			{/* ── FAB ── */}
			<button
				onClick={() => setOpen(!open)}
				aria-label={open ? "Close chat" : "Open chat"}
				style={{
					position: "fixed",
					bottom: 24,
					right: 24,
					zIndex: 9999,
					width: 56,
					height: 56,
					borderRadius: "50%",
					background: open ? "#333" : "#000",
					color: "#fff",
					border: "none",
					cursor: "pointer",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
					transition: "transform 150ms, box-shadow 150ms",
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.transform = "scale(1.08)";
					e.currentTarget.style.boxShadow = "0 6px 28px rgba(0,0,0,0.4)";
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.transform = "scale(1)";
					e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";
				}}
			>
				{/* Chat icon / X icon */}
				{open ? (
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				) : (
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
				)}
				{/* Unread badge */}
				{!open && totalUnread > 0 && (
					<span
						style={{
							position: "absolute",
							top: -4,
							right: -4,
							background: "#dc2626",
							color: "#fff",
							fontSize: 11,
							fontWeight: 700,
							fontFamily: "ui-monospace, monospace",
							minWidth: 20,
							height: 20,
							borderRadius: 10,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: "0 5px",
							border: "2px solid #fff",
						}}
					>
						{totalUnread > 99 ? "99+" : totalUnread}
					</span>
				)}
			</button>

			{/* ── Panel ── */}
			{open && (
				<div
					style={{
						position: "fixed",
						bottom: 92,
						right: 24,
						zIndex: 9998,
						width: PANEL_WIDTH,
						height: PANEL_HEIGHT,
						display: "flex",
						flexDirection: "column",
						background: "#fff",
						border: "2px solid #000",
						boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
						overflow: "hidden",
						animation: "chatSlideUp 180ms ease-out",
					}}
				>
					{/* Inject keyframes */}
					<style>{`
						@keyframes chatSlideUp {
							from { opacity: 0; transform: translateY(12px); }
							to   { opacity: 1; transform: translateY(0); }
						}
					`}</style>

					{active ? (
						<ConversationThread
							conversation={active}
							currentUserId={opsUser?.opsUserId ?? ""}
							currentUserName={opsUser?.name ?? "Staff"}
							staffDirectory={staffDirectory}
							onBack={() => setActiveId(null)}
							onSent={() => {
								refreshConversations();
								refreshUnread();
							}}
						/>
					) : (
						<>
							{/* ── Header ── */}
							<div
								style={{
									padding: "12px 16px",
									borderBottom: "2px solid #000",
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									flexShrink: 0,
								}}
							>
								<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
									<h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: "-0.3px" }}>
										Chat
									</h2>
									{totalUnread > 0 && (
										<span
											style={{
												background: "#000",
												color: "#fff",
												padding: "1px 7px",
												fontSize: 10,
												fontFamily: "ui-monospace, monospace",
											}}
										>
											{totalUnread}
										</span>
									)}
								</div>
								<button
									onClick={() => setShowNewChat(!showNewChat)}
									style={{
										background: showNewChat ? "#fff" : "#000",
										color: showNewChat ? "#000" : "#fff",
										border: showNewChat ? "1px solid #000" : "none",
										padding: "4px 10px",
										fontSize: 11,
										fontWeight: 700,
										cursor: "pointer",
										fontFamily: "ui-monospace, monospace",
										letterSpacing: "0.5px",
									}}
								>
									{showNewChat ? "CANCEL" : "+ NEW"}
								</button>
							</div>

							{/* New chat form */}
							{showNewChat && (
								<NewChatForm
									staffDirectory={staffDirectory}
									searchStaff={searchStaff}
									setSearchStaff={setSearchStaff}
									selectedStaff={selectedStaff}
									setSelectedStaff={setSelectedStaff}
									composingTitle={composingTitle}
									setComposingTitle={setComposingTitle}
									creating={creating}
									onCreate={async () => {
										if (selectedStaff.length === 0) return;
										const conv = await createConversation({
											participantOpsUserId: selectedStaff[0],
											title: composingTitle || undefined,
										});
										if (conv) {
											setActiveId(conv.id);
											setShowNewChat(false);
											setSelectedStaff([]);
											setComposingTitle("");
											refreshConversations();
										}
									}}
									currentUserId={opsUser?.opsUserId ?? ""}
								/>
							)}

							{/* ── Conversation list ── */}
							<div style={{ flex: 1, overflowY: "auto" }}>
								{convosLoading && (
									<div style={{ padding: 20, textAlign: "center", color: "#999", fontSize: 12 }}>
										Loading...
									</div>
								)}
								{!convosLoading && conversations.length === 0 && (
									<div style={{ padding: 20, textAlign: "center", color: "#999", fontSize: 12 }}>
										No conversations yet.
										<br />
										Click + NEW to start one.
									</div>
								)}
								{conversations.map((c) => {
									const unreadCount =
										unread.conversations.find((u) => u.conversationId === c.id)?.unreadCount ?? 0;
									return (
										<div
											key={c.id}
											onClick={() => setActiveId(c.id)}
											style={{
												padding: "10px 16px",
												borderBottom: "1px solid #eee",
												cursor: "pointer",
												background: unreadCount > 0 ? "#f9f9f9" : "#fff",
												transition: "background 100ms",
											}}
											onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f3f3")}
											onMouseLeave={(e) => (e.currentTarget.style.background = unreadCount > 0 ? "#f9f9f9" : "#fff")}
										>
											<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
												<span
													style={{
														fontWeight: unreadCount > 0 ? 700 : 400,
														fontSize: 13,
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
														flex: 1,
													}}
												>
													{c.title}
												</span>
												{unreadCount > 0 && (
													<span
														style={{
															background: "#000",
															color: "#fff",
															padding: "1px 6px",
															fontSize: 10,
															fontFamily: "ui-monospace, monospace",
															marginLeft: 8,
															flexShrink: 0,
														}}
													>
														{unreadCount}
													</span>
												)}
											</div>
											{c.linkedEntityType && (
												<div
													style={{
														marginTop: 3,
														fontSize: 9,
														fontFamily: "ui-monospace, monospace",
														letterSpacing: "0.5px",
														textTransform: "uppercase",
														opacity: 0.5,
													}}
												>
													{ENTITY_LABELS[c.linkedEntityType] ?? c.linkedEntityType}
												</div>
											)}
											{c.lastMessage && (
												<div
													style={{
														marginTop: 3,
														fontSize: 11,
														opacity: 0.6,
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
													}}
												>
													<strong>{c.lastMessage.senderName.split(" ")[0]}:</strong>{" "}
													{c.lastMessage.content.slice(0, 50)}
													{c.lastMessage.content.length > 50 ? "..." : ""}
												</div>
											)}
											<div style={{ marginTop: 2, fontSize: 9, opacity: 0.4 }}>
												{c.updatedAt && relativeTime(c.updatedAt)}
											</div>
										</div>
									);
								})}
							</div>
						</>
					)}
				</div>
			)}
		</>
	);
}

/* ── New Chat Form ──────────────────────────────────────────────────────── */

function NewChatForm({
	staffDirectory,
	searchStaff,
	setSearchStaff,
	selectedStaff,
	setSelectedStaff,
	composingTitle,
	setComposingTitle,
	creating,
	onCreate,
	currentUserId,
}: {
	staffDirectory: StaffDirectoryEntry[];
	searchStaff: string;
	setSearchStaff: (v: string) => void;
	selectedStaff: string[];
	setSelectedStaff: (v: string[]) => void;
	composingTitle: string;
	setComposingTitle: (v: string) => void;
	creating: boolean;
	onCreate: () => void;
	currentUserId: string;
}) {
	const filtered = staffDirectory.filter(
		(s) =>
			s.opsUserId !== currentUserId &&
			(s.name.toLowerCase().includes(searchStaff.toLowerCase()) ||
				s.email.toLowerCase().includes(searchStaff.toLowerCase())),
	);

	return (
		<div style={{ padding: "10px 16px", borderBottom: "2px solid #000", background: "#f9f9f9", flexShrink: 0 }}>
			<div style={{ fontSize: 10, fontWeight: 700, fontFamily: "ui-monospace, monospace", letterSpacing: "0.5px", marginBottom: 6 }}>
				NEW CONVERSATION
			</div>
			<input
				type="text"
				placeholder="Title (optional)"
				value={composingTitle}
				onChange={(e) => setComposingTitle(e.target.value)}
				style={{
					width: "100%",
					padding: "5px 8px",
					border: "1px solid #ccc",
					fontSize: 11,
					marginBottom: 6,
					boxSizing: "border-box",
				}}
			/>
			<input
				type="text"
				placeholder="Search staff..."
				value={searchStaff}
				onChange={(e) => setSearchStaff(e.target.value)}
				style={{
					width: "100%",
					padding: "5px 8px",
					border: "1px solid #ccc",
					fontSize: 11,
					marginBottom: 6,
					boxSizing: "border-box",
				}}
			/>
			<div style={{ maxHeight: 100, overflowY: "auto", marginBottom: 6 }}>
				{filtered.slice(0, 6).map((s) => {
					const isSelected = selectedStaff.includes(s.opsUserId);
					return (
						<div
							key={s.opsUserId}
							onClick={() => {
								setSelectedStaff(
									isSelected
										? selectedStaff.filter((id) => id !== s.opsUserId)
										: [s.opsUserId],
								);
							}}
							style={{
								padding: "5px 8px",
								cursor: "pointer",
								background: isSelected ? "#000" : "transparent",
								color: isSelected ? "#fff" : "#000",
								fontSize: 11,
								display: "flex",
								justifyContent: "space-between",
							}}
						>
							<span>{s.name}</span>
							<span style={{ opacity: 0.5, fontSize: 9 }}>{s.role.replace(/_/g, " ")}</span>
						</div>
					);
				})}
				{filtered.length === 0 && searchStaff && (
					<div style={{ padding: 6, fontSize: 11, color: "#999" }}>No staff found</div>
				)}
			</div>
			<button
				onClick={onCreate}
				disabled={selectedStaff.length === 0 || creating}
				style={{
					width: "100%",
					padding: "6px",
					background: selectedStaff.length === 0 || creating ? "#ccc" : "#000",
					color: "#fff",
					border: "none",
					fontSize: 11,
					fontWeight: 700,
					cursor: selectedStaff.length === 0 || creating ? "default" : "pointer",
					fontFamily: "ui-monospace, monospace",
					letterSpacing: "0.5px",
				}}
			>
				{creating ? "CREATING..." : "START CONVERSATION"}
			</button>
		</div>
	);
}

/* ── Conversation Thread ────────────────────────────────────────────────── */

function ConversationThread({
	conversation,
	currentUserId,
	currentUserName,
	staffDirectory,
	onBack,
	onSent,
}: {
	conversation: ChatConversation;
	currentUserId: string;
	currentUserName: string;
	staffDirectory: StaffDirectoryEntry[];
	onBack: () => void;
	onSent: () => void;
}) {
	const { messages, hasMore, loading, sending, loadMore, send, markRead } =
		useChatMessages(conversation.id);

	const [input, setInput] = useState("");
	const [showMentions, setShowMentions] = useState(false);
	const [mentionFilter, setMentionFilter] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	useEffect(() => {
		if (conversation.id) markRead();
	}, [conversation.id, markRead]);

	const handleSend = async () => {
		const content = input.trim();
		if (!content || sending) return;

		const mentionMatches = content.match(/@(\w+)/g);
		const mentionIds: string[] = [];
		if (mentionMatches) {
			for (const match of mentionMatches) {
				const name = match.slice(1).toLowerCase();
				const found = staffDirectory.find(
					(s) => s.name.toLowerCase().includes(name) || s.email.toLowerCase().includes(name),
				);
				if (found) mentionIds.push(found.opsUserId);
			}
		}

		setInput("");
		setShowMentions(false);
		await send(content, undefined, mentionIds.length ? mentionIds : undefined);
		onSent();
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleInput = (value: string) => {
		setInput(value);
		const lastAt = value.lastIndexOf("@");
		if (lastAt >= 0 && (lastAt === 0 || value[lastAt - 1] === " ")) {
			const filter = value.slice(lastAt + 1);
			if (!filter.includes(" ")) {
				setShowMentions(true);
				setMentionFilter(filter);
				return;
			}
		}
		setShowMentions(false);
	};

	const insertMention = (staff: StaffDirectoryEntry) => {
		const lastAt = input.lastIndexOf("@");
		const before = input.slice(0, lastAt);
		setInput(`${before}@${staff.name.split(" ")[0]} `);
		setShowMentions(false);
		inputRef.current?.focus();
	};

	const filteredMentions = staffDirectory.filter(
		(s) =>
			s.opsUserId !== currentUserId &&
			(s.name.toLowerCase().includes(mentionFilter.toLowerCase()) ||
				s.email.toLowerCase().includes(mentionFilter.toLowerCase())),
	);

	const participants = conversation.participants;

	return (
		<div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
			{/* Header */}
			<div
				style={{
					padding: "10px 16px",
					borderBottom: "2px solid #000",
					background: "#fff",
					display: "flex",
					alignItems: "center",
					gap: 10,
					flexShrink: 0,
				}}
			>
				<button
					onClick={onBack}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						padding: 0,
						fontSize: 16,
						color: "#000",
						flexShrink: 0,
						lineHeight: 1,
					}}
					aria-label="Back to conversations"
				>
					←
				</button>
				<div style={{ minWidth: 0, flex: 1 }}>
					<div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
						{conversation.title}
					</div>
					<div style={{ fontSize: 10, color: "#666", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
						{participants.map((p) => p.name).join(", ")}
					</div>
				</div>
				{conversation.linkedEntityType && (
					<div
						style={{
							padding: "3px 6px",
							border: "1px solid #000",
							fontSize: 9,
							fontFamily: "ui-monospace, monospace",
							letterSpacing: "0.5px",
							textTransform: "uppercase",
							flexShrink: 0,
						}}
					>
						{ENTITY_LABELS[conversation.linkedEntityType] ?? conversation.linkedEntityType}
					</div>
				)}
			</div>

			{/* Messages */}
			<div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
				{hasMore && (
					<button
						onClick={loadMore}
						style={{
							display: "block",
							margin: "0 auto 12px",
							padding: "4px 12px",
							background: "transparent",
							border: "1px solid #ccc",
							fontSize: 10,
							cursor: "pointer",
							fontFamily: "ui-monospace, monospace",
						}}
					>
						LOAD EARLIER
					</button>
				)}
				{loading && messages.length === 0 && (
					<div style={{ textAlign: "center", color: "#999", fontSize: 12, padding: 16 }}>
						Loading messages...
					</div>
				)}
				{messages.map((msg) => (
					<ChatBubble
						key={msg.id}
						message={msg}
						isOwn={msg.senderOpsUserId === currentUserId}
					/>
				))}
				<div ref={messagesEndRef} />
			</div>

			{/* Input */}
			<div style={{ padding: "10px 16px", borderTop: "2px solid #000", background: "#fff", flexShrink: 0 }}>
				{showMentions && filteredMentions.length > 0 && (
					<div
						style={{
							border: "1px solid #ccc",
							marginBottom: 6,
							maxHeight: 120,
							overflowY: "auto",
						}}
					>
						{filteredMentions.slice(0, 5).map((s) => (
							<div
								key={s.opsUserId}
								onClick={() => insertMention(s)}
								style={{
									padding: "5px 8px",
									cursor: "pointer",
									fontSize: 11,
									display: "flex",
									justifyContent: "space-between",
									borderBottom: "1px solid #f0f0f0",
								}}
								onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
								onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
							>
								<span>
									<strong>{s.name}</strong>
								</span>
								<span style={{ opacity: 0.5, fontSize: 9 }}>{s.role.replace(/_/g, " ")}</span>
							</div>
						))}
					</div>
				)}
				<div style={{ display: "flex", gap: 6 }}>
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => handleInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Type a message... (@ to mention)"
						rows={1}
						style={{
							flex: 1,
							padding: "6px 10px",
							border: "1px solid #ccc",
							fontSize: 12,
							resize: "none",
							fontFamily: "inherit",
							lineHeight: 1.4,
						}}
					/>
					<button
						onClick={handleSend}
						disabled={!input.trim() || sending}
						style={{
							padding: "6px 14px",
							background: !input.trim() || sending ? "#ccc" : "#000",
							color: "#fff",
							border: "none",
							fontSize: 11,
							fontWeight: 700,
							cursor: !input.trim() || sending ? "default" : "pointer",
							fontFamily: "ui-monospace, monospace",
							letterSpacing: "0.5px",
							alignSelf: "flex-end",
						}}
					>
						{sending ? "..." : "SEND"}
					</button>
				</div>
			</div>
		</div>
	);
}

/* ── Chat Bubble ────────────────────────────────────────────────────────── */

function ChatBubble({ message, isOwn }: { message: ChatMessage; isOwn: boolean }) {
	const isSystem = message.messageType === "system" || message.messageType === "action";

	if (isSystem) {
		return (
			<div
				style={{
					textAlign: "center",
					padding: "6px 0",
					fontSize: 10,
					color: "#999",
					fontStyle: "italic",
				}}
			>
				{message.content}
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				justifyContent: isOwn ? "flex-end" : "flex-start",
				marginBottom: 6,
			}}
		>
			<div
				style={{
					maxWidth: "75%",
					padding: "8px 12px",
					background: isOwn ? "#000" : "#fff",
					color: isOwn ? "#fff" : "#000",
					border: isOwn ? "none" : "1px solid #ddd",
				}}
			>
				{!isOwn && (
					<div
						style={{
							fontSize: 9,
							fontWeight: 700,
							fontFamily: "ui-monospace, monospace",
							letterSpacing: "0.3px",
							marginBottom: 3,
							opacity: 0.6,
						}}
					>
						{message.senderName}
					</div>
				)}
				<div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
					{message.content}
				</div>
				<div
					style={{
						fontSize: 9,
						marginTop: 3,
						opacity: 0.4,
						textAlign: isOwn ? "right" : "left",
					}}
				>
					{relativeTime(message.createdAt)}
				</div>
			</div>
		</div>
	);
}
