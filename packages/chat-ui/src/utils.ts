/** Time formatting helpers shared across all chat surfaces. */

/**
 * Format a message timestamp as a short wall-clock time (e.g. "14:05").
 *
 * Kept locale-aware so the portal and ops console both render in the user's
 * preferred language without a date library dependency.
 */
export function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Format a relative timestamp for conversation list previews.
 * "just now" → "5m ago" → "3h ago" → "2d ago" → absolute date.
 */
export function formatRelative(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const diff = Date.now() - d.getTime();
	const mins = Math.round(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d ago`;
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Format a day divider label. Same-day messages share a divider; the label is
 * "Today", "Yesterday", or a short date.
 */
export function formatDayDivider(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const today = new Date();
	const yesterday = new Date();
	yesterday.setDate(today.getDate() - 1);
	const sameDay = (a: Date, b: Date) =>
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate();
	if (sameDay(d, today)) return "Today";
	if (sameDay(d, yesterday)) return "Yesterday";
	return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

/** Day bucket key for grouping messages — stable across timezone boundaries. */
export function dayKey(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Truncate a string to `n` chars with an ellipsis. */
export function truncate(text: string, n: number): string {
	if (text.length <= n) return text;
	return text.slice(0, n - 1).trimEnd() + "…";
}
