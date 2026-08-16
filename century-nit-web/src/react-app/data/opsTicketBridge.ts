import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { safeSetItem } from "century-nit-core";
import { ticketsApi } from "century-nit-core/api";
import type { InternalTicket, TicketCategory, TicketMessage } from "century-nit-core/ops";

/**
 * Applicant-side access to support tickets backed by the live /api/v1/me/tickets API,
 * with local synchronization for instant optimistic updates.
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

export function useApplicantTickets(email: string | undefined) {
	const raw = useSyncExternalStore(subscribe, readRaw);
	const [serverTickets, setServerTickets] = useState<InternalTicket[]>([]);

	// Background fetch from live server API
	useEffect(() => {
		if (!email) return;
		let cancelled = false;
		ticketsApi
			.listMy()
			.then((res) => {
				if (cancelled) return;
				const mapped: InternalTicket[] = res.tickets.map((t, idx) => ({
					id: t.id,
					ref: `CNT-${String(idx + 1).padStart(3, "0")}`,
					source: "external",
					title: t.subject,
					description: t.messages[0]?.message || "",
					category: t.category as TicketCategory,
					status: t.status === "resolved" ? "Resolved" : t.status === "pending" ? "In Progress" : "Open",
					priority: t.priority === "urgent" ? "Urgent" : t.priority === "high" ? "High" : "Medium",
					createdBy: t.applicantName,
					createdByEmail: email,
					assignedTo: t.assignedStaffName || "",
					assignedToEmail: "",
					escalatedToAdmin: false,
					createdAt: t.createdAt,
					updatedAt: t.updatedAt,
					messages: t.messages.map((m) => ({
						id: m.id,
						author: m.senderName,
						role: m.senderType === "applicant" ? "applicant" : "staff",
						body: m.message,
						at: m.createdAt,
					})),

				}));
				setServerTickets(mapped);
			})
			.catch(() => {
				// Ignore background errors, rely on localStorage fallback
			});
		return () => {
			cancelled = true;
		};
	}, [email]);

	const localTickets = useMemo(() => {
		if (!email) return [];
		return parseTickets(raw)
			.filter((t) => t.source === "external" && t.createdByEmail === email)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}, [raw, email]);

	const tickets = serverTickets.length > 0 ? serverTickets : localTickets;

	const createTicket = useCallback((input: NewTicketInput) => {
		const now = new Date().toISOString();
		// Live server dispatch
		ticketsApi
			.create({
				subject: input.title,
				category: input.category,
				message: input.description,
				priority: "medium",
			})
			.catch((err) => console.warn("Failed to sync new ticket to API", err));


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
			// Live server dispatch
			ticketsApi
				.reply(id, { message: body })
				.catch((err) => console.warn("Failed to sync reply to API", err));

			mutateTickets((existing) =>
				existing.map((t) => {
					if (t.id !== id || t.source !== "external" || t.createdByEmail !== email) return t;
					return {
						...t,
						updatedAt: now,
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

