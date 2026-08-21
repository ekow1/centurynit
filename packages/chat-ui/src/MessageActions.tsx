import { type CSSProperties } from "react";
import { ensureChatUiStyles } from "./tokens.js";
import {
	ReplyIcon,
	ReactIcon,
	ForwardIcon,
	CopyIcon,
	EditIcon,
	DeleteIcon,
	MoreIcon,
} from "./icons.js";

export interface MessageActionsConfig {
	/** Show the reply action. Default true. */
	reply?: boolean;
	/** Show the react action. Default true. */
	react?: boolean;
	/** Show the forward action. Default true. */
	forward?: boolean;
	/** Show the copy action. Default true. */
	copy?: boolean;
	/** Show the edit action. Only meaningful for the author's own messages. */
	edit?: boolean;
	/** Show the delete action. Author or moderator. */
	delete?: boolean;
	/** Show the "more" overflow. Default true. */
	more?: boolean;
}

export interface MessageActionsProps {
	/** Which actions to surface. All default to true except edit/delete. */
	actions?: MessageActionsConfig;
	onReply?: () => void;
	onReact?: () => void;
	onForward?: () => void;
	onCopy?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onMore?: () => void;
	style?: CSSProperties;
}

/**
 * Contextual action toolbar shown on hover (desktop) or long-press (mobile).
 *
 * Mirrors WhatsApp's surface: Reply, React, Forward, Copy, Edit (own),
 * Delete (own/mod), More. The parent controls visibility and positioning;
 * this component only draws the bar and fires callbacks. Actions that aren't
 * applicable (e.g. edit on someone else's message) should be omitted via the
 * `actions` prop rather than disabled.
 */
export function MessageActions({
	actions,
	onReply,
	onReact,
	onForward,
	onCopy,
	onEdit,
	onDelete,
	onMore,
	style,
}: MessageActionsProps) {
	ensureChatUiStyles();
	const cfg: Required<MessageActionsConfig> = {
		reply: actions?.reply ?? true,
		react: actions?.react ?? true,
		forward: actions?.forward ?? true,
		copy: actions?.copy ?? true,
		edit: actions?.edit ?? false,
		delete: actions?.delete ?? false,
		more: actions?.more ?? true,
	};

	const btn = (label: string, icon: React.ReactNode, onClick?: () => void) => (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={(e) => {
				e.stopPropagation();
				onClick?.();
			}}
			style={{
				background: "transparent",
				border: "none",
				color: "var(--cn-chat-muted-fg)",
				cursor: "pointer",
				padding: 6,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				borderRadius: "var(--cn-chat-radius-sm)",
				transition: "background 120ms, color 120ms",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.background = "var(--cn-chat-muted)";
				e.currentTarget.style.color = "var(--cn-chat-fg)";
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "transparent";
				e.currentTarget.style.color = "var(--cn-chat-muted-fg)";
			}}
		>
			{icon}
		</button>
	);

	return (
		<div
			className="cn-chat-actions"
			role="toolbar"
			aria-label="Message actions"
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 2,
				padding: 2,
				background: "var(--cn-chat-card)",
				border: "1px solid var(--cn-chat-border)",
				borderRadius: "var(--cn-chat-radius-pill)",
				boxShadow: "var(--cn-chat-shadow-md)",
				animation: "cn-chat-fade-in 100ms ease-out",
				...style,
			}}
		>
			{cfg.reply && btn("Reply", <ReplyIcon size={16} />, onReply)}
			{cfg.react && btn("React", <ReactIcon size={16} />, onReact)}
			{cfg.forward && btn("Forward", <ForwardIcon size={16} />, onForward)}
			{cfg.copy && btn("Copy", <CopyIcon size={16} />, onCopy)}
			{cfg.edit && btn("Edit", <EditIcon size={16} />, onEdit)}
			{cfg.delete && btn("Delete", <DeleteIcon size={16} />, onDelete)}
			{cfg.more && btn("More", <MoreIcon size={16} />, onMore)}
		</div>
	);
}
