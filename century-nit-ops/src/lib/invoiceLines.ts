/**
 * What a milestone line on the service-fee invoice is waiting for, when it
 * fell due, or that it is paid — read from the line's own `dueOn` / `dueAt`.
 * The Invoices page and the case's Billing tab both render from this, so
 * the two never describe the same line differently.
 */

export const TRIGGER_WORDS: Record<string, string> = {
	acceptance: "on acceptance",
	offer: "on the first offer",
	visa_open: "when the visa file opens",
	visa_approved: "on visa approval",
	arrival: "on arrival",
	scheduled: "scheduled",
};

export type LineDue = { text: string; tone: "paid" | "late" | "due" | "waiting" };

export function lineDue(l: { dueOn?: string | null; dueAt?: string | null }, covered: boolean, now = Date.now()): LineDue | null {
	if (!l.dueOn && !l.dueAt) return null;
	if (covered) return { text: "paid", tone: "paid" };
	if (l.dueAt) {
		const at = new Date(l.dueAt);
		const days = Math.floor((now - at.getTime()) / 86_400_000);
		const when = at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
		if (days > 0) return { text: `due ${when} · ${days} d late`, tone: "late" };
		return { text: `due ${when}`, tone: "due" };
	}
	return { text: `waiting · ${TRIGGER_WORDS[l.dueOn ?? ""] ?? l.dueOn}`, tone: "waiting" };
}

/** Payments cover lines in position order — a line is covered once the running total up to it is paid. */
export function coveredLines<L extends { amount: number }>(lines: L[], paid: number): { line: L; covered: boolean }[] {
	const out: { line: L; covered: boolean }[] = [];
	let cum = 0;
	for (const line of lines) {
		cum += line.amount;
		out.push({ line, covered: paid >= cum - 0.005 });
	}
	return out;
}
