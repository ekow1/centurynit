/**
 * Inline SVG icons for the chat UI.
 *
 * Kept dependency-free (no lucide import) so the package stays tree-shakeable
 * and works in both the ops console and the client portal without pulling a
 * shared icon library that may not be installed in every host.
 */
import type { CSSProperties } from "react";

type IconProps = { size?: number; className?: string; style?: CSSProperties };

function svg(
	path: string,
	{ size = 16, className, style }: IconProps,
	viewBox = "0 0 24 24",
) {
	return (
		<svg
			width={size}
			height={size}
			viewBox={viewBox}
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			style={style}
			aria-hidden="true"
		>
			<path d={path} />
		</svg>
	);
}

export function ReplyIcon(p: IconProps) {
	return svg("M9 17l-5-5 5-5M4 12h11a4 4 0 0 1 4 4v3", p);
}

export function ReactIcon(p: IconProps) {
	return svg("M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM8 12s1.5-2 4-2 4 2 4 2M9 9h.01M15 9h.01", p);
}

export function ForwardIcon(p: IconProps) {
	return svg("M15 17l5-5-5-5M20 12H9a4 4 0 0 0-4 4v3", p);
}

export function CopyIcon(p: IconProps) {
	return svg("M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 4h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", p);
}

export function EditIcon(p: IconProps) {
	return svg("M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z", p);
}

export function DeleteIcon(p: IconProps) {
	return svg("M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6", p);
}

export function MoreIcon(p: IconProps) {
	return svg("M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0", p);
}

export function CheckIcon(p: IconProps) {
	return svg("M20 6L9 17l-5-5", p);
}

export function CheckCheckIcon(p: IconProps) {
	return svg("M18 6L7 17l-2-2M22 6l-7 7", p);
}

export function ClockIcon(p: IconProps) {
	return svg("M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 6v6l4 2", p);
}

export function CloseIcon(p: IconProps) {
	return svg("M18 6L6 18M6 6l12 12", p);
}

export function SendIcon(p: IconProps) {
	return svg("M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z", p);
}

export function PaperclipIcon(p: IconProps) {
	return svg("M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48", p);
}

export function ChevronDownIcon(p: IconProps) {
	return svg("M6 9l6 6 6-6", p);
}

export function ArrowUpIcon(p: IconProps) {
	return svg("M12 19V5M5 12l7-7 7 7", p);
}
