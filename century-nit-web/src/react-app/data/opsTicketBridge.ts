import { useCallback, useMemo, useSyncExternalStore } from "react";
import { safeSetItem } from "century-nit-core";
import type { InternalTicket, TicketCategory, TicketMessage } from "century-nit-core/ops";

/**
 * Applicant-side access to the support tickets the Operations Center owns.
 *
 * The portal used to call `useOpsState()` directly and share the ops React
 * store. Now that ops is a separate app and a separate bundle, that import is
 * gone and this reads and writes the ops store through `localStorage` — the same
 * approach `OpsDirectiveBridge` and `useSiteContent` already take. Same origin,
 * so the key is shared; `storage` events mean a ticket raised in the portal
 * window appears in an open ops window without a refresh.
 *
 * Scope is deliberately narrow. The portal may only:
 *   - read `external` tickets belonging to the signed-in applicant
 *   - open a new `external` ticket
 *   - append an `applicant` message to one of its own threads
 *
 * Triage, assignment, escalation and status remain ops-only. Nothing here can
 * touch an `internal` ticket or another applicant's thread.
 *
 * ── On the read-modify-write ──
 * Two apps now write one key, so a simultaneous write from both windows can
 * lose one. That risk existed before the split (ops already wrote this key from
 * multiple tabs); it is not newly introduced, and at localStorage speeds the
 * window is sub-millisecond. It disappears entirely once tickets live behind
 * `/api/tickets` — see docs/API_MIGRATION_PLAN.md §4/§6, where this file should
 * be deleted rather than ported.
 */

const OPS_STATE_KEY = "century-nit-ops-state";

type OpsStateBlob = { internalTickets?: InternalTicket[] };

function readRaw(): string | null {
	try {
		return localStorage.getItem(OPS_STATE_KEY);
	} catch {
		return null;
	}
}

function parseTickets(raw: string | null): InternalTicket[] {
	if (!raw) return [];
	try {
		return (JSON.parse(raw) as OpsStateBlob).internalTickets ?? [];
	} catch {
		return [];
	}
}

/** `storage` fires only in *other* tabs, so poll to catch same-tab writes too. */
function subscribe(onChange: () => void) {
	window.addEventListener("storage", onChange);
	const id = window.setInterval(onChange, 1500);
	return () => {
		window.removeEventListener("storage", onChange);
		window.clearInterval(id);
	};
}

/**
 * Apply a change to the ticket list inside the ops blob, leaving every other
 * key in that blob untouched. A no-op if ops has never initialised its store.
 */
function mutateTickets(update: (tickets: InternalTicket[]) => InternalTicket[]): void {
	const raw = readRaw();
	if (!raw) return;
	let blob: OpsStateBlob & Record<string, unknown>;
	try {
		blob = JSON.parse(raw) as OpsStateBlob & Record<string, unknown>;
	} catch {
		return;
	}
	const next = { ...blob, internalTickets: update(blob.internalTickets ?? []) };
	safeSetItem(OPS_STATE_KEY, JSON.stringify(next));
}

/** `CNT-014` style, continuing whatever ops has already issued. */
function nextRef(tickets: InternalTicket[]): string {
	const highest = tickets.reduce((max, t) => {
		const n = Number.parseInt(t.ref.replace(/\D/g, ""), 10);
		return Number.isFinite(n) && n > max ? n : max;
	}, 0);
	return `CNT-${String(highest + 1).padStart(3, "0")}`;
}

function uid(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type NewTicketInput = {
	title: string;
	description: string;
	category: TicketCategory;
	createdBy: string;
	createdByEmail: string;
	applicantRef?: string;
};

/**
 * The applicant's own support threads, plus the two actions they can take.
 *
 * @param email the signed-in applicant's address; tickets are matched on it.
 *              With no email nothing is returned and the actions are inert.
 */
export function useApplicantTickets(email: string | undefined) {
	const raw = useSyncExternalStore(subscribe, readRaw);

	const tickets = useMemo(() => {
		if (!email) return [];
		return parseTickets(raw)
			.filter((t) => t.source === "external" && t.createdByEmail === email)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}, [raw, email]);

	const createTicket = useCallback((input: NewTicketInput) => {
		const now = new Date().toISOString();
		mutateTickets((existing) => {
			const opening: TicketMessage = {
				id: uid("m"),
				author: input.createdBy,
				role: "applicant",
				body: input.description,
				at: now,
			};
			const record: InternalTicket = {
				id: uid("tkt"),
				ref: nextRef(existing),
				source: "external",
				title: input.title,
				description: input.description,
				category: input.category,
				status: "Open",
				priority: "Medium",
				createdBy: input.createdBy,
				createdByEmail: input.createdByEmail,
				applicantRef: input.applicantRef,
				createdAt: now,
				updatedAt: now,
				// Empty means unassigned — it lands in the ops triage queue.
				assignedTo: "",
				assignedToEmail: "",
				escalatedToAdmin: false,
				messages: [opening],
			};
			return [record, ...existing];
		});
	}, []);

	const replyToTicket = useCallback(
		(id: string, body: string, author: string) => {
			const now = new Date().toISOString();
			mutateTickets((existing) =>
				existing.map((t) => {
					// Re-check ownership at write time, not just in the filtered view.
					if (t.id !== id || t.source !== "external" || t.createdByEmail !== email) return t;
					return {
						...t,
						updatedAt: now,
						// A reply reopens a resolved thread; ops owns every other status.
						status: t.status === "Resolved" ? "Open" : t.status,
						messages: [
							...t.messages,
							{ id: uid("m"), author, role: "applicant" as const, body, at: now },
						],
					};
				}),
			);
		},
		[email],
	);

	return { tickets, createTicket, replyToTicket };
}
