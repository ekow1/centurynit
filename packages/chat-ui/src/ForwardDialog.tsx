import { useMemo, useState, type CSSProperties } from "react";
import type { ChatConversation } from "century-nit-shared";
import { ensureChatUiStyles } from "./tokens.js";
import { CloseIcon, ForwardIcon } from "./icons.js";
import { truncate } from "./utils.js";

export interface ForwardDialogProps {
	/** Conversations the user may forward into. */
	conversations: ChatConversation[];
	/** Called with the selected conversation ids. */
	onConfirm: (targetIds: string[]) => void;
	onClose: () => void;
	/** Preview of the message being forwarded. */
	preview?: string;
	style?: CSSProperties;
}

/**
 * Conversation picker modal for forwarding a message.
 *
 * Multi-select: the user may forward into several conversations at once, which
 * matches WhatsApp's "Share" flow. The parent owns the actual forward API
 * call; this dialog only collects the target ids and calls `onConfirm`.
 */
export function ForwardDialog({
	conversations,
	onConfirm,
	onClose,
	preview,
	style,
}: ForwardDialogProps) {
	ensureChatUiStyles();
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return conversations;
		return conversations.filter((c) => c.title.toLowerCase().includes(q));
	}, [conversations, query]);

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Forward message"
			onClick={onClose}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 100,
				background: "rgba(0,0,0,0.4)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 16,
			}}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					width: "100%",
					maxWidth: 420,
					maxHeight: "80vh",
					display: "flex",
					flexDirection: "column",
					background: "var(--cn-chat-card)",
					border: "1px solid var(--cn-chat-border)",
					borderRadius: "var(--cn-chat-radius)",
					boxShadow: "var(--cn-chat-shadow-lg)",
					overflow: "hidden",
					animation: "cn-chat-fade-in 160ms ease-out",
					...style,
				}}
			>
				{/* Header */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "12px 16px",
						borderBottom: "1px solid var(--cn-chat-border-light)",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<ForwardIcon size={18} style={{ color: "var(--cn-chat-muted-fg)" }} />
						<span
							style={{
								fontSize: 14,
								fontWeight: 700,
								fontFamily: "var(--cn-chat-font-mono)",
								letterSpacing: "0.02em",
							}}
						>
							FORWARD TO
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						style={{
							background: "transparent",
							border: "none",
							color: "var(--cn-chat-muted-fg)",
							cursor: "pointer",
							padding: 4,
							display: "flex",
						}}
					>
						<CloseIcon size={18} />
					</button>
				</div>

				{/* Preview of the forwarded content */}
				{preview && (
					<div
						style={{
							padding: "8px 16px",
							fontSize: 12,
							color: "var(--cn-chat-muted-fg)",
							background: "var(--cn-chat-muted)",
							borderBottom: "1px solid var(--cn-chat-border-light)",
							fontStyle: "italic",
						}}
					>
						{truncate(preview, 100)}
					</div>
				)}

				{/* Search */}
				<div style={{ padding: 12, borderBottom: "1px solid var(--cn-chat-border-light)" }}>
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search conversations…"
						autoFocus
						style={{
							width: "100%",
							padding: "8px 12px",
							fontSize: 13,
							fontFamily: "var(--cn-chat-font-sans)",
							background: "var(--cn-chat-muted)",
							color: "var(--cn-chat-fg)",
							border: "1px solid transparent",
							borderRadius: "var(--cn-chat-radius-sm)",
							outline: "none",
							boxSizing: "border-box",
						}}
					/>
				</div>

				{/* List */}
				<div style={{ flex: 1, overflowY: "auto" }}>
					{filtered.length === 0 ? (
						<div
							style={{
								padding: 24,
								textAlign: "center",
								color: "var(--cn-chat-muted-fg)",
								fontSize: 13,
							}}
						>
							No conversations found.
						</div>
					) : (
						filtered.map((c) => {
							const checked = selected.has(c.id);
							return (
								<button
									key={c.id}
									type="button"
									onClick={() => toggle(c.id)}
									style={{
										width: "100%",
										display: "flex",
										alignItems: "center",
										gap: 10,
										padding: "10px 16px",
										background: checked ? "var(--cn-chat-muted)" : "transparent",
										border: "none",
										borderBottom: "1px solid var(--cn-chat-border-light)",
										cursor: "pointer",
										textAlign: "left",
									}}
								>
									<span
										aria-hidden
										style={{
											width: 16,
											height: 16,
											borderRadius: 4,
											border: checked
												? "2px solid var(--cn-chat-primary)"
												: "2px solid var(--cn-chat-border)",
											background: checked ? "var(--cn-chat-primary)" : "transparent",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											color: "var(--cn-chat-primary-fg)",
											fontSize: 10,
											fontWeight: 700,
											flexShrink: 0,
										}}
									>
										{checked ? "✓" : ""}
									</span>
									<span
										style={{
											width: 32,
											height: 32,
											borderRadius: "50%",
											background: "var(--cn-chat-muted)",
											color: "var(--cn-chat-fg)",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: 11,
											fontWeight: 600,
											flexShrink: 0,
										}}
									>
										{c.title.slice(0, 2).toUpperCase()}
									</span>
									<span style={{ flex: 1, minWidth: 0 }}>
										<span
											style={{
												display: "block",
												fontSize: 13,
												fontWeight: 600,
												whiteSpace: "nowrap",
												overflow: "hidden",
												textOverflow: "ellipsis",
											}}
										>
											{c.title}
										</span>
										<span
											style={{
												display: "block",
												fontSize: 11,
												color: "var(--cn-chat-muted-fg)",
												fontFamily: "var(--cn-chat-font-mono)",
												textTransform: "uppercase",
											}}
										>
											{c.type}
										</span>
									</span>
								</button>
							);
						})
					)}
				</div>

				{/* Footer */}
				<div
					style={{
						display: "flex",
						justifyContent: "flex-end",
						gap: 8,
						padding: 12,
						borderTop: "1px solid var(--cn-chat-border-light)",
					}}
				>
					<button
						type="button"
						onClick={onClose}
						style={{
							padding: "8px 16px",
							fontSize: 13,
							fontFamily: "var(--cn-chat-font-sans)",
							background: "transparent",
							color: "var(--cn-chat-fg)",
							border: "1px solid var(--cn-chat-border)",
							borderRadius: "var(--cn-chat-radius-sm)",
							cursor: "pointer",
						}}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => onConfirm([...selected])}
						disabled={selected.size === 0}
						style={{
							padding: "8px 16px",
							fontSize: 13,
							fontWeight: 600,
							fontFamily: "var(--cn-chat-font-sans)",
							background: "var(--cn-chat-primary)",
							color: "var(--cn-chat-primary-fg)",
							border: "none",
							borderRadius: "var(--cn-chat-radius-sm)",
							cursor: selected.size === 0 ? "default" : "pointer",
							opacity: selected.size === 0 ? 0.4 : 1,
						}}
					>
						Forward ({selected.size})
					</button>
				</div>
			</div>
		</div>
	);
}
