import type { CSSProperties } from "react";
import { ensureChatUiStyles } from "./tokens.js";

export interface TypingIndicatorProps {
	/** Who is typing, for the accessible label. */
	name?: string;
	style?: CSSProperties;
}

/**
 * Three-dot typing indicator. Shown in the message stream above the composer
 * when a `chat.typing` event is active for the current viewer.
 */
export function TypingIndicator({ name, style }: TypingIndicatorProps) {
	ensureChatUiStyles();
	return (
		<div
			className="cn-chat-typing"
			role="status"
			aria-live="polite"
			aria-label={name ? `${name} is typing` : "Someone is typing"}
			style={{
				display: "inline-flex",
				gap: "4px",
				padding: "8px 12px",
				background: "var(--cn-chat-bubble-theirs-bg)",
				color: "var(--cn-chat-bubble-theirs-fg)",
				borderRadius: "var(--cn-chat-radius)",
				borderBottomLeftRadius: 4,
				...style,
			}}
		>
			{[0, 1, 2].map((i) => (
				<span
					key={i}
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: "currentColor",
						opacity: 0.5,
						animation: `cn-chat-typing 1s ${i * 0.15}s infinite ease-in-out`,
					}}
				/>
			))}
		</div>
	);
}
