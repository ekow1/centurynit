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
 * Auto-focuses when reply or edit state changes, and allows Esc to cancel.
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

	// Auto-focus and scroll to input when replying or editing
	useEffect(() => {
		if (replyTo || editing) {
			taRef.current?.focus();
		}
	}, [replyTo, editing]);

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
				borderTop: "1px solid var(--cn-chat-border)",
				background: "#ffffff",
				...style,
			}}
		>
			{/* Quoted Reply Banner */}
			{replyTo && (
				<ReplyPreview
					message={replyTo}
					onCancel={onCancelReply ?? (() => {})}
				/>
			)}

			{/* Editing Banner */}
			{editing && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "6px 12px",
						borderBottom: "1px solid var(--cn-chat-border-light)",
						background: "#fef3c7",
						fontSize: 11,
						fontFamily: "var(--cn-chat-font-mono)",
						color: "#92400e",
					}}
				>
					<span style={{ fontWeight: 700 }}>EDITING MESSAGE (Esc to cancel)</span>
					<button
						type="button"
						onClick={onCancelEdit}
						aria-label="Cancel edit"
						style={{
							background: "transparent",
							border: "none",
							color: "#92400e",
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

			{/* Input Box Row */}
			<div style={{ display: "flex", alignItems: "flex-end", gap: 6, padding: "8px 10px" }}>
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
							borderRadius: 0,
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
						} else if (e.key === "Escape") {
							if (replyTo) onCancelReply?.();
							if (editing) onCancelEdit?.();
						}
					}}
					placeholder={placeholder ?? "Type a message…"}
					rows={1}
					disabled={sending}
					style={{
						flex: 1,
						resize: "none",
						border: "1px solid #18181b",
						borderRadius: 0,
						padding: "8px 10px",
						fontSize: 13,
						fontFamily: "var(--cn-chat-font-sans)",
						background: "#ffffff",
						color: "#18181b",
						outline: "none",
						maxHeight: 140,
						overflowY: "auto",
						lineHeight: 1.4,
						boxSizing: "border-box",
					}}
				/>

				<button
					type="submit"
					disabled={!value.trim() || sending}
					aria-label={editing ? "Save edit" : "Send message"}
					style={{
						background: !value.trim() || sending ? "#e4e4e7" : "#18181b",
						border: "1px solid #18181b",
						color: !value.trim() || sending ? "#a1a1aa" : "#ffffff",
						cursor: !value.trim() || sending ? "not-allowed" : "pointer",
						padding: "8px 12px",
						height: "36px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						borderRadius: 0,
						flexShrink: 0,
						transition: "background 150ms ease, color 150ms ease",
					}}
				>
					{sending ? (
						<span style={{ fontSize: 10, fontFamily: "var(--cn-chat-font-mono)", fontWeight: 700 }}>…</span>
					) : (
						<SendIcon size={16} />
					)}
				</button>
			</div>
		</form>
	);
}
