/**
 * Century NIT chat-ui design tokens.
 *
 * The ops console uses a hard monochrome palette (#18181b / #f4f4f5 / #e4e4e7);
 * the client portal uses CSS custom properties (--foreground / --muted / ...).
 * Rather than pick one, the components below reference a single set of
 * `--cn-chat-*` variables. `ensureChatUiStyles` installs a defaults layer that
 * maps them onto the portal's existing vars when present, and falls back to the
 * ops monochrome palette when not. Either app can override any token by
 * defining the same variable on an ancestor element.
 */

const STYLE_ID = "cn-chat-ui-styles";

const CSS = `
:root {
	/* Foreground / background */
	--cn-chat-fg: var(--foreground, #18181b);
	--cn-chat-bg: var(--background, #ffffff);
	--cn-chat-muted: var(--muted, #f4f4f5);
	--cn-chat-muted-fg: var(--muted-foreground, #52525b);
	--cn-chat-border: var(--border, #e4e4e7);
	--cn-chat-border-light: var(--border-light, #f4f4f5);
	--cn-chat-card: var(--card, #ffffff);
	--cn-chat-primary: var(--primary, #18181b);
	--cn-chat-primary-fg: var(--primary-foreground, #ffffff);
	--cn-chat-danger: var(--danger, #dc2626);
	--cn-chat-danger-fg: var(--danger-foreground, #ffffff);
	--cn-chat-success: var(--success, #10b981);

	/* Bubble colors — own vs. other */
	--cn-chat-bubble-mine-bg: var(--primary, #18181b);
	--cn-chat-bubble-mine-fg: var(--primary-foreground, #ffffff);
	--cn-chat-bubble-theirs-bg: var(--muted, #f4f4f5);
	--cn-chat-bubble-theirs-fg: var(--foreground, #18181b);

	/* Typography */
	--cn-chat-font-sans: var(--font-sans, system-ui, -apple-system, sans-serif);
	--cn-chat-font-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
	--cn-chat-radius: 16px;
	--cn-chat-radius-sm: 8px;
	--cn-chat-radius-pill: 9999px;

	/* Shadows */
	--cn-chat-shadow-sm: 0 1px 2px rgba(0,0,0,0.06);
	--cn-chat-shadow-md: 0 4px 12px rgba(0,0,0,0.12);
	--cn-chat-shadow-lg: 0 8px 32px rgba(0,0,0,0.16);
}

.cn-chat * { box-sizing: border-box; }
.cn-chat { font-family: var(--cn-chat-font-sans); color: var(--cn-chat-fg); }

@keyframes cn-chat-fade-in {
	from { opacity: 0; transform: translateY(4px); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes cn-chat-typing {
	0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
	30% { opacity: 1; transform: translateY(-3px); }
}
`;

let injected = false;

/**
 * Idempotently inject the default `--cn-chat-*` token layer and keyframes.
 *
 * Safe to call from any component; the first caller wins, subsequent calls are
 * no-ops. Consumers that prefer a stylesheet can skip this and define the
 * variables themselves.
 */
export function ensureChatUiStyles(): void {
	if (injected) return;
	if (typeof document === "undefined") return;
	if (document.getElementById(STYLE_ID)) {
		injected = true;
		return;
	}
	const el = document.createElement("style");
	el.id = STYLE_ID;
	el.textContent = CSS;
	document.head.appendChild(el);
	injected = true;
}
