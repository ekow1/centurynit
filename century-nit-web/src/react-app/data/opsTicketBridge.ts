import { useCallback, useEffect, useState } from "react";
import { ticketsApi } from "century-nit-core/api";
import type { TicketCategory } from "century-nit-core/ops";

/**
 * Applicant-side access to support tickets backed by the live /api/v1/me/tickets API.
 *
 * Server is the single source of truth. All writes go through the API first,
 * then the local list is refreshed from the server response.
 */

export type NewTicketInput = {
	title: string;
	description: string;
	category: TicketCategory;
	createdBy: string;
	createdByEmail: string;
	applicantRef?: string;
};

type TicketMessage = {
	id: string;
	author: string;
	role: "applicant" | "staff";
	body: string;
	at: string;
};

type Ticket = {
	id: string;
	ref: string;
	title: string;
	description: string;
	category: TicketCategory;
	status: "Open" | "In Progress" | "Resolved" | "Closed";
	priority: string;
	createdBy: string;
	createdByEmail: string;
	assignedTo: string;
	createdAt: string;
	updatedAt: string;
	messages: TicketMessage[];
};

function mapServerTicket(t: any, idx: number): Ticket {
	return {
		id: t.id,
		ref: `CNT-${String(idx + 1).padStart(3, "0")}`,
		title: t.subject,
		description: t.messages?.[0]?.message || "",
		category: t.category as TicketCategory,
		status:
			t.status === "resolved"
				? "Resolved"
				: t.status === "pending"
					? "In Progress"
					: t.status === "closed"
						? "Closed"
						: "Open",
		priority: t.priority === "urgent" ? "Urgent" : t.priority === "high" ? "High" : "Medium",
		createdBy: t.applicantName ?? "",
		createdByEmail: "",
		assignedTo: t.assignedStaffName || "",
		createdAt: t.createdAt,
		updatedAt: t.updatedAt,
		messages: (t.messages ?? []).map((m: any) => ({
			id: m.id,
			author: m.senderName,
			role: m.senderType === "applicant" ? "applicant" : ("staff" as const),
			body: m.message,
			at: m.createdAt,
		})),
	};
}

export function useApplicantTickets(email: string | undefined) {
	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		if (!email) return;
		let cancelled = false;
		setLoading(true);
		ticketsApi
			.listMy()
			.then((res) => {
				if (cancelled) return;
				setTickets(res.tickets.map((t, idx) => mapServerTicket(t, idx)));
				setError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setTickets([]);
				setError(err instanceof Error ? err.message : "Could not load support requests.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [email]);

	useEffect(() => {
		const cancel = refresh();
		return () => cancel?.();
	}, [refresh]);

	const createTicket = useCallback(
		async (input: NewTicketInput) => {
			const created = await ticketsApi.create({
				subject: input.title,
				category: input.category,
				message: input.description,
				priority: "medium",
			});
			// Refresh the list so the new ticket appears with correct server ID
			refresh();
			return created;
		},
		[refresh],
	);

	const replyToTicket = useCallback(
		async (ticketId: string, body: string) => {
			const updated = await ticketsApi.reply(ticketId, { message: body });
			// Refresh so the new message appears in the thread
			refresh();
			return updated;
		},
		[refresh],
	);

	return { tickets, loading, error, createTicket, replyToTicket, refresh };
}
