import { useEffect, useRef, type CSSProperties, type FormEvent } from "react";
import type { QuotedMessage } from "century-nit-shared";
import { ensureChatUiStyles } from "./tokens.js";
import { ReplyPreview } from "./ReplyPreview.js";
import { SendIcon, CloseIcon, PaperclipIcon } from "./icons.js";

export interface ComposerProps {
	/** Current draft text. Parent-owned so it survives remounts. */
	value: string;
	onChange: (v: string) => void;
	/** Submit the message. Parent handles the API call and optimistic append. */
	onSend: (text: string) => void;
	/** True while the send request is in flight — disables the input. */
	sending?: boolean;
	/** Placeholder text. */
	placeholder?: string;
	/** Replying-to state. When set, a ReplyPreview header is shown. */
	replyTo?: QuotedMessage | null;
	onCancelReply?: () => void;
	/** Editing state. When set, the composer shows "Edit" instead of "Send". */
	editing?: boolean;
	onCancelEdit?: () => void;
	/** Attachment staging callback. Parent runs the presign + upload flow. */
	onAttach?: () => void;
	/** Typing signal callback. Fired on input change, debounced by parent. */
	onTyping?: () => void;
	style?: CSSProperties;
}

/**
 * Message composer with three modes: normal, replying, editing.
 *
 * The parent owns the draft and all side effects (send, attach, typing). This
 * component is purely the input surface — a textarea that grows with content,
 * a reply/edit preview header when applicable, and a send button that swaps
 * to a spinner while `sending` is true.
 *
 * Enter sends; Shift+Enter inserts a newline. This matches every modern
 * messaging app and is the single behavior users expect.
 */
export function Composer({
	value,
	onChange,
	onSend,
	sending,
	placeholder,
	replyTo,
	onCancelReply,
	editing,
	onCancelEdit,
	onAttach,
	onTyping,
	style,
}: ComposerProps) {
	ensureChatUiStyles();
	const taRef = useRef<HTMLTextAreaElement | null>(null);

	// Auto-grow the textarea up to a max height, then scroll inside.
	useEffect(() => {
		const ta = taRef.current;
		if (!ta) return;
		ta.style.height = "auto";
		ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
	}, [value]);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		const trimmed = value.trim();
		if (!trimmed || sending) return;
		onSend(trimmed);
	};

	return (
		<form
			className="cn-chat-composer"
			onSubmit={submit}
			style={{
				display: "flex",
				flexDirection: "column",
				borderTop: "1px solid var(--cn-chat-border-light)",
				background: "var(--cn-chat-card)",
				...style,
			}}
		>
			{replyTo && <ReplyPreview message={replyTo} onCancel={onCancelReply ?? (() => {})} />}
			{editing && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "8px 12px",
						borderBottom: "1px solid var(--cn-chat-border-light)",
						background: "var(--cn-chat-muted)",
						fontSize: 12,
						fontFamily: "var(--cn-chat-font-mono)",
						color: "var(--cn-chat-muted-fg)",
					}}
				>
					<span>Editing message</span>
					<button
						type="button"
						onClick={onCancelEdit}
						aria-label="Cancel edit"
						style={{
							background: "transparent",
							border: "none",
							color: "var(--cn-chat-muted-fg)",
							cursor: "pointer",
							padding: 4,
							display: "flex",
							alignItems: "center",
						}}
					>
						<CloseIcon size={14} />
					</button>
				</div>
			)}
			<div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 12px" }}>
				{onAttach && (
					<button
						type="button"
						onClick={onAttach}
						aria-label="Attach file"
						disabled={sending}
						style={{
							background: "transparent",
							border: "none",
							color: "var(--cn-chat-muted-fg)",
							cursor: "pointer",
							padding: 8,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							borderRadius: "var(--cn-chat-radius-sm)",
							flexShrink: 0,
							transition: "color 120ms",
						}}
						onMouseEnter={(e) => (e.currentTarget.style.color = "var(--cn-chat-fg)")}
						onMouseLeave={(e) => (e.currentTarget.style.color = "var(--cn-chat-muted-fg)")}
					>
						<PaperclipIcon size={18} />
					</button>
				)}
				<textarea
					ref={taRef}
					value={value}
					onChange={(e) => {
						onChange(e.target.value);
						onTyping?.();
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submit(e as unknown as FormEvent);
						}
					}}
					placeholder={placeholder ?? "Type a message…"}
					rows={1}
					disabled={sending}
					style={{
						flex: 1,
						resize: "none",
						border: "1px solid var(--cn-chat-border)",
						borderRadius: "var(--cn-chat-radius-sm)",
						padding: "8px 12px",
						fontSize: 14,
						fontFamily: "var(--cn-chat-font-sans)",
						background: "var(--cn-chat-bg)",
						color: "var(--cn-chat-fg)",
						outline: "none",
						maxHeight: 140,
						overflowY: "auto",
						lineHeight: 1.4,
					}}
				/>
				<button
					type="submit"
					disabled={!value.trim() || sending}
					aria-label={editing ? "Save edit" : "Send message"}
					style={{
						width: 36,
						height: 36,
						flexShrink: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "var(--cn-chat-primary)",
						color: "var(--cn-chat-primary-fg)",
						border: "none",
						borderRadius: "var(--cn-chat-radius-sm)",
						cursor: value.trim() && !sending ? "pointer" : "default",
						opacity: value.trim() && !sending ? 1 : 0.4,
						transition: "opacity 120ms",
					}}
				>
					{sending ? (
						<span
							style={{
								width: 14,
								height: 14,
								border: "2px solid currentColor",
								borderTopColor: "transparent",
								borderRadius: "50%",
								animation: "cn-chat-typing 0.6s linear infinite",
							}}
						/>
					) : (
						<SendIcon size={16} />
					)}
				</button>
			</div>
		</form>
	);
}
