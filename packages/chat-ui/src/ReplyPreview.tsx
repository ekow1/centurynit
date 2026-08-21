import type { CSSProperties } from "react";
import type { QuotedMessage } from "century-nit-shared";
import { ensureChatUiStyles } from "./tokens.js";
import { CloseIcon, ReplyIcon } from "./icons.js";
import { truncate } from "./utils.js";

export interface ReplyPreviewProps {
	/** The message being replied to. */
	message: QuotedMessage;
	/** Called when the user dismisses the reply preview. */
	onCancel: () => void;
	style?: CSSProperties;
}

/**
 * Composer header shown when the user is replying to a specific message.
 *
 * Displays the quoted message's author and a truncated preview of its content,
 * with a close button to cancel the reply. Clicking the preview body calls
 * `onCancel` as well — WhatsApp dismisses on click of the quote area.
 */
export function ReplyPreview({ message, onCancel, style }: ReplyPreviewProps) {
	ensureChatUiStyles();
	return (
		<div
			className="cn-chat-reply-preview"
			style={{
				display: "flex",
				alignItems: "stretch",
				gap: 8,
				padding: "8px 12px",
				borderBottom: "1px solid var(--cn-chat-border-light)",
				background: "var(--cn-chat-muted)",
				...style,
			}}
		>
			<span
				style={{
					width: 3,
					alignSelf: "stretch",
					background: "var(--cn-chat-primary)",
					borderRadius: 2,
					flexShrink: 0,
				}}
			/>
			<ReplyIcon size={16} style={{ color: "var(--cn-chat-muted-fg)", flexShrink: 0, marginTop: 2 }} />
			<div style={{ flex: 1, minWidth: 0 }}>
				<div
					style={{
						fontSize: 12,
						fontWeight: 700,
						color: "var(--cn-chat-primary)",
						fontFamily: "var(--cn-chat-font-mono)",
						letterSpacing: "0.02em",
					}}
				>
					{message.senderName}
				</div>
				<div
					style={{
						fontSize: 13,
						color: "var(--cn-chat-muted-fg)",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
				>
					{truncate(message.content || (message.deleted ? "Deleted message" : "Attachment"), 80)}
				</div>
			</div>
			<button
				type="button"
				onClick={onCancel}
				aria-label="Cancel reply"
				style={{
					background: "transparent",
					border: "none",
					color: "var(--cn-chat-muted-fg)",
					cursor: "pointer",
					padding: 4,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					borderRadius: "var(--cn-chat-radius-sm)",
					flexShrink: 0,
				}}
			>
				<CloseIcon size={16} />
			</button>
		</div>
	);
}
