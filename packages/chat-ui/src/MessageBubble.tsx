import { useState, type CSSProperties } from "react";
import type { ChatMessage, MessageReaction } from "century-nit-shared";
import { ensureChatUiStyles } from "./tokens.js";
import { MessageActions, type MessageActionsConfig } from "./MessageActions.js";
import { ReactionPicker } from "./ReactionPicker.js";
import { CheckIcon, CheckCheckIcon, ClockIcon, ForwardIcon } from "./icons.js";
import { formatTime } from "./utils.js";
import { useLongPress } from "./hooks.js";

export interface MessageBubbleProps {
	message: ChatMessage;
	/** True if this message was sent by the current viewer. Drives alignment + delivery ticks. */
	isOwn: boolean;
	/** Show the author name above the bubble. Omit in 1:1 threads where it's redundant. */
	showAuthor?: boolean;
	/** Actions config. Edit/delete default to false; parent enables them when authorized. */
	actions?: MessageActionsConfig;
	/** Callbacks — all optional; absent actions are hidden. Each receives the message. */
	onReply?: (message: ChatMessage) => void;
	onReact?: (message: ChatMessage, emoji: string) => void;
	onForward?: (message: ChatMessage) => void;
	onCopy?: (message: ChatMessage) => void;
	onEdit?: (message: ChatMessage) => void;
	onDelete?: (message: ChatMessage) => void;
	onMore?: (message: ChatMessage) => void;
	/** Click on a quoted reply preview — typically scroll-to-original. */
	onQuoteClick?: (messageId: string) => void;
	style?: CSSProperties;
}

/**
 * A single chat message bubble.
 *
 * Renders the full WhatsApp-style message entity: quoted reply preview,
 * forwarded indicator, body (or tombstone if deleted), edit marker,
 * attachments, reactions row, timestamp, and delivery ticks. Contextual
 * actions appear on hover (desktop) or long-press / menu trigger (mobile).
 */
export function MessageBubble({
	message,
	isOwn,
	showAuthor,
	actions,
	onReply,
	onReact,
	onForward,
	onCopy,
	onEdit,
	onDelete,
	onMore,
	onQuoteClick,
	style,
}: MessageBubbleProps) {
	ensureChatUiStyles();
	const [showActions, setShowActions] = useState(false);
	const [showReactionPicker, setShowReactionPicker] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const longPress = useLongPress(() => setMenuOpen(true));

	const deleted = message.deletedAt !== null && message.deletedAt !== undefined;
	const edited = message.editedAt !== null && message.editedAt !== undefined;
	const isSystem = message.messageType === "system";

	const isActionsVisible = (showActions || menuOpen) && !deleted;

	// System / action messages render as centered pills, not bubbles.
	if (isSystem) {
		return (
			<div
				id={`msg-${message.id}`}
				data-message-id={message.id}
				className="cn-chat-system"
				style={{
					display: "flex",
					justifyContent: "center",
					margin: "4px 0",
					...style,
				}}
			>
				<span
					style={{
						fontSize: 11,
						color: "var(--cn-chat-muted-fg)",
						background: "var(--cn-chat-muted)",
						padding: "4px 10px",
						borderRadius: "var(--cn-chat-radius-pill)",
						fontFamily: "var(--cn-chat-font-mono)",
						textAlign: "center",
					}}
				>
					{message.content}
				</span>
			</div>
		);
	}

	const bubbleBg = isOwn ? "var(--cn-chat-bubble-mine-bg)" : "var(--cn-chat-bubble-theirs-bg)";
	const bubbleFg = isOwn ? "var(--cn-chat-bubble-mine-fg)" : "var(--cn-chat-bubble-theirs-fg)";
	const subtleFg = isOwn ? "rgba(255,255,255,0.7)" : "var(--cn-chat-muted-fg)";

	const handleCopy = () => {
		if (deleted) return;
		try {
			if (navigator.clipboard?.writeText) {
				navigator.clipboard.writeText(message.content).catch(() => fallbackCopy());
			} else {
				fallbackCopy();
			}
		} catch {
			fallbackCopy();
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1800);
		onCopy?.(message);
	};

	const fallbackCopy = () => {
		const ta = document.createElement("textarea");
		ta.value = message.content;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		document.execCommand("copy");
		document.body.removeChild(ta);
	};

	return (
		<div
			id={`msg-${message.id}`}
			data-message-id={message.id}
			className="cn-chat-message"
			style={{
				display: "flex",
				width: "100%",
				justifyContent: isOwn ? "flex-end" : "flex-start",
				position: "relative",
				padding: "2px 0",
				...style,
			}}
			onMouseEnter={() => setShowActions(true)}
			onMouseLeave={() => {
				setShowActions(false);
				if (!menuOpen) setShowReactionPicker(false);
			}}
			{...longPress}
		>
			{/* Backdrop to dismiss persistent menu when clicked outside */}
			{menuOpen && (
				<div
					onMouseDown={(e) => {
						e.stopPropagation();
						setMenuOpen(false);
						setShowReactionPicker(false);
						setShowActions(false);
					}}
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 18,
						background: "transparent",
					}}
				/>
			)}

			<div style={{ position: "relative", maxWidth: "80%", minWidth: "90px" }}>
				{/* Copied visual feedback toast badge */}
				{copied && (
					<div
						style={{
							position: "absolute",
							top: -24,
							[isOwn ? "right" : "left"]: 0,
							background: "#18181b",
							color: "#ffffff",
							padding: "2px 8px",
							fontSize: 10,
							fontWeight: 700,
							borderRadius: 4,
							zIndex: 30,
							fontFamily: "var(--cn-chat-font-mono)",
							boxShadow: "var(--cn-chat-shadow-md)",
							animation: "cn-chat-fade-in 100ms ease-out",
						}}
					>
						✓ Copied!
					</div>
				)}

				{/* Contextual actions toolbar */}
				{isActionsVisible && (
					<div
						onMouseEnter={() => setShowActions(true)}
						onMouseLeave={() => {
							if (!menuOpen) {
								setShowActions(false);
								setShowReactionPicker(false);
							}
						}}
						style={{
							position: "absolute",
							top: 0,
							[isOwn ? "right" : "left"]: 0,
							transform: "translateY(-100%)",
							paddingBottom: "6px",
							zIndex: 20,
						}}
					>
						{showReactionPicker ? (
							<ReactionPicker
								onSelect={(emoji) => {
									onReact?.(message, emoji);
									setMenuOpen(false);
									setShowActions(false);
								}}
								onClose={() => {
									setShowReactionPicker(false);
									setMenuOpen(false);
									setShowActions(false);
								}}
							/>
						) : (
							<MessageActions
								actions={actions}
								onReply={() => {
									onReply?.(message);
									setMenuOpen(false);
									setShowActions(false);
								}}
								onReact={() => setShowReactionPicker(true)}
								onForward={() => {
									onForward?.(message);
									setMenuOpen(false);
									setShowActions(false);
								}}
								onCopy={() => {
									handleCopy();
									setMenuOpen(false);
									setShowActions(false);
								}}
								onEdit={() => {
									onEdit?.(message);
									setMenuOpen(false);
									setShowActions(false);
								}}
								onDelete={() => {
									onDelete?.(message);
									setMenuOpen(false);
									setShowActions(false);
								}}
								onMore={() => {
									onMore?.(message);
									setMenuOpen(false);
									setShowActions(false);
								}}
							/>
						)}
					</div>
				)}

				<div
					style={{
						background: bubbleBg,
						color: bubbleFg,
						padding: "8px 12px",
						borderRadius: isOwn
							? "var(--cn-chat-radius) var(--cn-chat-radius) 4px var(--cn-chat-radius)"
							: "var(--cn-chat-radius) var(--cn-chat-radius) var(--cn-chat-radius) 4px",
						fontSize: 13.5,
						lineHeight: 1.45,
						fontFamily: "var(--cn-chat-font-sans)",
						wordBreak: "break-word",
						opacity: deleted ? 0.6 : 1,
						boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
						border: isOwn ? "none" : "1px solid var(--cn-chat-border)",
					}}
				>
					{/* Forwarded indicator */}
					{message.forwardedFrom && !deleted && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 4,
								fontSize: 10,
								fontWeight: 700,
								color: subtleFg,
								marginBottom: 4,
								fontFamily: "var(--cn-chat-font-mono)",
								textTransform: "uppercase",
								letterSpacing: "0.04em",
							}}
						>
							<ForwardIcon size={12} />
							<span>Forwarded from {message.forwardedFrom.senderName}</span>
						</div>
					)}

					{/* Quoted reply preview */}
					{message.replyTo && !deleted && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onQuoteClick?.(message.replyTo!.id);
							}}
							title="Jump to quoted message"
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 2,
								padding: "4px 8px",
								marginBottom: 6,
								background: isOwn ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.05)",
								border: "none",
								borderLeft: `3px solid ${isOwn ? "#ffffff" : "var(--cn-chat-primary)"}`,
								borderRadius: 2,
								cursor: "pointer",
								textAlign: "left",
								width: "100%",
								color: "inherit",
							}}
						>
							<span
								style={{
									fontSize: 10,
									fontWeight: 800,
									color: subtleFg,
									fontFamily: "var(--cn-chat-font-mono)",
									textTransform: "uppercase",
								}}
							>
								{message.replyTo.senderName}
							</span>
							<span
								style={{
									fontSize: 11,
									opacity: 0.9,
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
								}}
							>
								{message.replyTo.content || (message.replyTo.deleted ? "Deleted message" : "Attachment")}
							</span>
						</button>
					)}

					{/* Author label (group chats) */}
					{showAuthor && !isOwn && !deleted && (
						<div
							style={{
								fontSize: 11,
								fontWeight: 800,
								color: "var(--cn-chat-primary)",
								fontFamily: "var(--cn-chat-font-mono)",
								letterSpacing: "0.02em",
								marginBottom: 2,
								textTransform: "uppercase",
							}}
						>
							{message.senderName}
						</div>
					)}

					{/* Body or tombstone */}
					{deleted ? (
						<div
							style={{
								fontStyle: "italic",
								color: subtleFg,
								fontSize: 12,
							}}
						>
							🚫 This message was deleted
						</div>
					) : (
						<div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
					)}

					{/* Attachments */}
					{!deleted && message.attachments.length > 0 && (
						<div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
							{message.attachments.map((a) => (
								<a
									key={a.id}
									href={a.url ?? undefined}
									download={a.fileName}
									target="_blank"
									rel="noreferrer"
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										color: "inherit",
										textDecoration: "underline",
										textUnderlineOffset: 2,
										opacity: 0.9,
									}}
								>
									📎 {a.fileName} ({Math.round(a.sizeBytes / 1024)} KB)
								</a>
							))}
						</div>
					)}

					{/* Reactions row */}
					{message.reactions.length > 0 && (
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: 4,
								marginTop: 4,
							}}
						>
							{message.reactions.map((r: MessageReaction) => (
								<button
									key={r.emoji}
									type="button"
									onClick={() => onReact?.(message, r.emoji)}
									title={r.reactors.join(", ")}
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 3,
										padding: "1px 6px",
										fontSize: 12,
										background: r.mine
											? (isOwn ? "rgba(255,255,255,0.2)" : "var(--cn-chat-primary)")
											: (isOwn ? "rgba(0,0,0,0.15)" : "var(--cn-chat-muted)"),
										color: r.mine
											? (isOwn ? "#fff" : "var(--cn-chat-primary-fg)")
											: "inherit",
										border: "none",
										borderRadius: "var(--cn-chat-radius-pill)",
										cursor: "pointer",
										fontFamily: "var(--cn-chat-font-sans)",
									}}
								>
									<span>{r.emoji}</span>
									<span style={{ fontSize: 11, fontWeight: 600 }}>{r.count}</span>
								</button>
							))}
						</div>
					)}

					{/* Timestamp + delivery ticks + edited marker */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "flex-end",
							gap: 4,
							marginTop: 3,
							fontSize: 10,
							fontFamily: "var(--cn-chat-font-mono)",
							color: subtleFg,
						}}
					>
						{edited && !deleted && <span style={{ fontStyle: "italic", opacity: 0.8 }}>edited</span>}
						<span>{formatTime(message.createdAt)}</span>
						{isOwn && !deleted && <DeliveryTicks status={message.deliveryStatus} />}
					</div>
				</div>
			</div>
		</div>
	);
}

function DeliveryTicks({ status }: { status?: ChatMessage["deliveryStatus"] }) {
	if (!status || status === "sending") {
		return <ClockIcon size={11} style={{ opacity: 0.6 }} />;
	}
	if (status === "sent") {
		return <CheckIcon size={11} style={{ opacity: 0.6 }} />;
	}
	if (status === "delivered") {
		return <CheckCheckIcon size={12} style={{ opacity: 0.6 }} />;
	}
	if (status === "read") {
		return <CheckCheckIcon size={12} style={{ color: "#10b981" }} />;
	}
	if (status === "failed") {
		return <span style={{ color: "#dc2626", fontSize: 10, fontWeight: 800 }}>!</span>;
	}
	return null;
}
