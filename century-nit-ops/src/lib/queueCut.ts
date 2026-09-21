import type { PendingTask } from "./pendingTasks";

/**
 * The Worklist's triage cut, shared with the dashboard: the same predicate
 * filters both, and the last cut the Worklist used is remembered so the
 * dashboard's "queue today" is the top of *that* list, not of everything.
 */
export type QueueFilter = "all" | "mine" | "needs_assignment" | "coordinated" | "needs_invoice" | "needs_followup";
export type QueueCut = { filter: QueueFilter; type: string };

const KEY = "ops:worklist:cut";

export const passesQueueFilter = (item: PendingTask, filter: QueueFilter, me?: { name?: string; email?: string }): boolean => {
	if (filter === "all") return true;
	// "Mine" is a real handler check — the seat is held by this officer.
	if (filter === "mine") {
		const who = [me?.name, me?.email].filter(Boolean);
		return who.some((w) => item.owner === w);
	}
	// Delegated cases — a coordinator steers them; the manager watches here.
	if (filter === "coordinated") {
		return item.kind === "consultation" && Boolean(item.record.coordinatorId);
	}
	return item.category === filter;
};

export function rememberQueueCut(cut: QueueCut): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(cut));
	} catch {
		/* private mode — the dashboard falls back to everything */
	}
}

export function rememberedQueueCut(): QueueCut {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) return JSON.parse(raw) as QueueCut;
	} catch {
		/* ignore */
	}
	return { filter: "all", type: "all" };
}
