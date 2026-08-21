import { useState, type CSSProperties } from "react";
import { ensureChatUiStyles } from "./tokens.js";

/**
 * The quick-react emoji set. WhatsApp surfaces six; we mirror that so the
 * interaction is familiar without being a visual clone. Order matters — the
 * first emoji is the default when the picker is opened via keyboard.
 */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export interface ReactionPickerProps {
	/** Called with the chosen emoji. The parent decides toggle vs. set. */
	onSelect: (emoji: string) => void;
	/** Called when the picker is dismissed (click outside, escape, blur). */
	onClose: () => void;
	style?: CSSProperties;
}

/**
 * Compact emoji strip for quick reactions.
 *
 * Rendered as a floating popover anchored by the parent. The parent is
 * responsible for positioning; this component only draws the row and handles
 * selection / dismissal. Closes on Escape and on any pointerdown outside.
 */
export function ReactionPicker({ onSelect, onClose, style }: ReactionPickerProps) {
	ensureChatUiStyles();
	const [closing, setClosing] = useState(false);

	const close = () => {
		if (closing) return;
		setClosing(true);
		onClose();
	};

	return (
		<>
			<div
				onMouseDown={(e) => {
					e.preventDefault();
					close();
				}}
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 90,
					background: "transparent",
				}}
			/>
			<div
				role="toolbar"
				aria-label="Quick reactions"
				onKeyDown={(e) => {
					if (e.key === "Escape") close();
				}}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 2,
					padding: "4px 6px",
					background: "var(--cn-chat-card)",
					border: "1px solid var(--cn-chat-border)",
					borderRadius: "var(--cn-chat-radius-pill)",
					boxShadow: "var(--cn-chat-shadow-md)",
					position: "relative",
					zIndex: 91,
					animation: "cn-chat-fade-in 120ms ease-out",
					...style,
				}}
			>
				{QUICK_REACTIONS.map((emoji) => (
					<button
						key={emoji}
						type="button"
						aria-label={`React with ${emoji}`}
						onClick={() => {
							onSelect(emoji);
							close();
						}}
						style={{
							background: "transparent",
							border: "none",
							cursor: "pointer",
							padding: "4px 6px",
							fontSize: 18,
							lineHeight: 1,
							borderRadius: "var(--cn-chat-radius-pill)",
							transition: "transform 120ms, background 120ms",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.transform = "scale(1.25)";
							e.currentTarget.style.background = "var(--cn-chat-muted)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.transform = "scale(1)";
							e.currentTarget.style.background = "transparent";
						}}
					>
						{emoji}
					</button>
				))}
			</div>
		</>
	);
}
