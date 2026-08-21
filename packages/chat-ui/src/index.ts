/**
 * Century NIT shared chat UI — WhatsApp-style messaging components.
 *
 * Import from `century-nit-chat-ui` in any host (ops console, client portal,
 * business-context surfaces). All components are themeable via CSS custom
 * properties; call `ensureChatUiStyles()` once at app boot to install the
 * default token layer, or define the `--cn-chat-*` variables yourself.
 */
export { ensureChatUiStyles } from "./tokens.js";
export { MessageBubble, type MessageBubbleProps } from "./MessageBubble.js";
export { MessageActions, type MessageActionsProps, type MessageActionsConfig } from "./MessageActions.js";
export { ReactionPicker, type ReactionPickerProps, QUICK_REACTIONS } from "./ReactionPicker.js";
export { ReplyPreview, type ReplyPreviewProps } from "./ReplyPreview.js";
export { Composer, type ComposerProps } from "./Composer.js";
export { ForwardDialog, type ForwardDialogProps } from "./ForwardDialog.js";
export { TypingIndicator, type TypingIndicatorProps } from "./TypingIndicator.js";
export { MessageList, type MessageListProps } from "./MessageList.js";
export { useLongPress, usePinnedToBottom } from "./hooks.js";
export {
	formatTime,
	formatRelative,
	formatDayDivider,
	dayKey,
	truncate,
} from "./utils.js";
export {
	ReplyIcon,
	ReactIcon,
	ForwardIcon,
	CopyIcon,
	EditIcon,
	DeleteIcon,
	MoreIcon,
	CheckIcon,
	CheckCheckIcon,
	ClockIcon,
	CloseIcon,
	SendIcon,
	PaperclipIcon,
	ChevronDownIcon,
	ArrowUpIcon,
} from "./icons.js";
