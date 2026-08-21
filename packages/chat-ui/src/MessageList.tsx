import { useEffect, type CSSProperties } from "react";
import type { ChatMessage } from "century-nit-shared";
import { ensureChatUiStyles } from "./tokens.js";
import { MessageBubble, type MessageBubbleProps } from "./MessageBubble.js";
import { TypingIndicator } from "./TypingIndicator.js";
import { dayKey, formatDayDivider } from "./utils.js";
import { usePinnedToBottom } from "./hooks.js";

export interface MessageListProps {
	messages: ChatMessage[];
	/** True if a participant is currently typing. Shows the dots at the bottom. */
	typing?: { name?: string } | null;
	/** Identifies the current viewer's own messages for alignment + ticks. */
	isOwn: (m: ChatMessage) => boolean;
	/** Show author labels — true in group chats, false in 1:1. */
	showAuthor?: (m: ChatMessage) => boolean;
	/** Per-message action config + callbacks. */
	bubbleProps?: Omit<MessageBubbleProps, "message" | "isOwn" | "showAuthor">;
	/** Scroll-to-message handler — typically scroll the target into view + highlight. */
	onQuoteClick?: (messageId: string) => void;
	/** Optional header shown above the list (e.g. "Load older messages" button). */
	header?: React.ReactNode;
	style?: CSSProperties;
}

/**
 * Scrollable message stream with day dividers, auto-scroll-on-new, and
 * scroll-to-original for quoted replies.
 *
 * The parent owns the data (messages, typing, authorship). This component
 * handles grouping by day, pinning to bottom on new messages when the user
 * is already there, and rendering the typing indicator. Scroll-to-original
 * is delegated via `onQuoteClick`.
 */
export function MessageList({
	messages,
	typing,
	isOwn,
	showAuthor,
	bubbleProps,
	onQuoteClick,
	header,
	style,
}: MessageListProps) {
	ensureChatUiStyles();
	const { ref, pinned, onScroll, scrollToBottom } = usePinnedToBottom<HTMLDivElement>();

	// Auto-scroll to bottom when new messages arrive AND the user is pinned.
	// If they've scrolled up to read history, we don't yank them down.
	const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
	useEffect(() => {
		if (pinned) scrollToBottom("smooth");
	}, [lastId, pinned, scrollToBottom]);

	// On first mount, jump to bottom without animation.
	useEffect(() => {
		scrollToBottom("auto");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Group by day, preserving order.
	const groups: { key: string; label: string; items: ChatMessage[] }[] = [];
	for (const m of messages) {
		const k = dayKey(m.createdAt);
		const last = groups[groups.length - 1];
		if (last && last.key === k) last.items.push(m);
		else groups.push({ key: k, label: formatDayDivider(m.createdAt), items: [m] });
	}

	return (
		<div
			ref={ref}
			onScroll={onScroll}
			className="cn-chat-list"
			style={{
				flex: 1,
				overflowY: "auto",
				padding: 12,
				display: "flex",
				flexDirection: "column",
				gap: 4,
				background: "var(--cn-chat-bg)",
				...style,
			}}
		>
			{header}
			{groups.map((g) => (
				<div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
					<div
						style={{
							display: "flex",
							justifyContent: "center",
							margin: "8px 0",
						}}
					>
						<span
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: "var(--cn-chat-muted-fg)",
								background: "var(--cn-chat-muted)",
								padding: "3px 10px",
								borderRadius: "var(--cn-chat-radius-pill)",
								fontFamily: "var(--cn-chat-font-mono)",
							}}
						>
							{g.label}
						</span>
					</div>
					{g.items.map((m) => (
						<MessageBubble
							key={m.id}
							message={m}
							isOwn={isOwn(m)}
							showAuthor={showAuthor?.(m)}
							onQuoteClick={onQuoteClick}
							{...bubbleProps}
						/>
					))}
				</div>
			))}
			{typing && (
				<div style={{ display: "flex", justifyContent: "flex-start" }}>
					<TypingIndicator name={typing.name} />
				</div>
			)}
		</div>
	);
}
