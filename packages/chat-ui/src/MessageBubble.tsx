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
	/** Callbacks — all optional; absent actions are hidden. */
	onReply?: () => void;
	onReact?: (emoji: string) => void;
	onForward?: () => void;
	onCopy?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onMore?: () => void;
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
 * actions appear on hover (desktop) or long-press (mobile).
 *
 * The parent owns the message list and decides authorship, authorization for
 * edit/delete, and scroll-to-original behavior. This component is purely
 * presentational.
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
	const longPress = useLongPress(() => setShowActions(true));

	const deleted = message.deletedAt !== null && message.deletedAt !== undefined;
	const edited = message.editedAt !== null && message.editedAt !== undefined;
	const isSystem = message.messageType === "system";

	// System / action messages render as centered pills, not bubbles.
	if (isSystem) {
		return (
			<div
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
						fontSize: 12,
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
		void navigator.clipboard?.writeText(message.content).catch(() => {});
		onCopy?.();
	};

	return (
		<div
			className="cn-chat-message"
			style={{
				display: "flex",
				width: "100%",
				justifyContent: isOwn ? "flex-end" : "flex-start",
				position: "relative",
				...style,
			}}
			onMouseEnter={() => setShowActions(true)}
			onMouseLeave={() => {
				setShowActions(false);
				setShowReactionPicker(false);
			}}
			{...longPress}
		>
			<div style={{ position: "relative", maxWidth: "78%" }}>
				{/* Contextual actions — positioned above the bubble, on the sender's side */}
				{showActions && !deleted && (
					<div
						style={{
							position: "absolute",
							top: -8,
							[isOwn ? "right" : "left"]: 0,
							transform: "translateY(-100%)",
							zIndex: 20,
						}}
					>
						{showReactionPicker ? (
							<ReactionPicker
								onSelect={(emoji) => onReact?.(emoji)}
								onClose={() => setShowReactionPicker(false)}
							/>
						) : (
							<MessageActions
								actions={actions}
								onReply={onReply}
								onReact={() => setShowReactionPicker(true)}
								onForward={onForward}
								onCopy={handleCopy}
								onEdit={onEdit}
								onDelete={onDelete}
								onMore={onMore}
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
						fontSize: 14,
						lineHeight: 1.45,
						fontFamily: "var(--cn-chat-font-sans)",
						wordBreak: "break-word",
						opacity: deleted ? 0.6 : 1,
					}}
				>
					{/* Forwarded indicator */}
					{message.forwardedFrom && !deleted && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 4,
								fontSize: 11,
								fontWeight: 600,
								color: subtleFg,
								marginBottom: 4,
								fontFamily: "var(--cn-chat-font-mono)",
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
							onClick={() => onQuoteClick?.(message.replyTo!.id)}
							style={{
								display: "flex",
								gap: 6,
								padding: "4px 8px",
								marginBottom: 4,
								background: isOwn ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)",
								border: "none",
								borderLeft: `3px solid ${isOwn ? "rgba(255,255,255,0.5)" : "var(--cn-chat-primary)"}`,
								borderRadius: 4,
								cursor: "pointer",
								textAlign: "left",
								width: "100%",
								color: "inherit",
							}}
						>
							<span
								style={{
									fontSize: 11,
									fontWeight: 700,
									color: subtleFg,
									fontFamily: "var(--cn-chat-font-mono)",
									flexShrink: 0,
								}}
							>
								{message.replyTo.senderName}
							</span>
							<span
								style={{
									fontSize: 12,
									opacity: 0.85,
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
								fontWeight: 700,
								color: "var(--cn-chat-primary)",
								fontFamily: "var(--cn-chat-font-mono)",
								letterSpacing: "0.02em",
								marginBottom: 2,
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
								fontSize: 13,
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
									onClick={() => onReact?.(r.emoji)}
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
							marginTop: 2,
							fontSize: 10,
							fontFamily: "var(--cn-chat-font-mono)",
							color: subtleFg,
						}}
					>
						{edited && !deleted && <span style={{ fontStyle: "italic" }}>edited</span>}
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
		return <ClockIcon size={12} style={{ opacity: 0.6 }} />;
	}
	if (status === "sent") {
		return <CheckIcon size={12} style={{ opacity: 0.6 }} />;
	}
	if (status === "delivered") {
		return <CheckCheckIcon size={13} style={{ opacity: 0.6 }} />;
	}
	if (status === "read") {
		return <CheckCheckIcon size={13} style={{ color: "var(--cn-chat-success)" }} />;
	}
	if (status === "failed") {
		return <span style={{ color: "var(--cn-chat-danger)", fontSize: 10, fontWeight: 700 }}>!</span>;
	}
	return null;
}
