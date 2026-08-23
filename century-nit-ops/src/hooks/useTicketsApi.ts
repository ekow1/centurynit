import { useCallback, useEffect, useState } from "react";
import { ticketsApi, staffApi } from "century-nit-core/api";
import type { Ticket } from "century-nit-shared";
import type { InternalTicket, TicketStatus, TicketCategory } from "century-nit-core/ops";

/* ── Status / Priority mapping between DB enums and ops display values ──── */

const DB_TO_OPS_STATUS: Record<string, TicketStatus> = {
	open: "Open",
	pending: "In Progress",
	resolved: "Resolved",
	closed: "Resolved",
};

const OPS_TO_DB_STATUS: Record<TicketStatus, string> = {
	Open: "open",
	"In Progress": "pending",
	Waiting: "pending",
	Resolved: "resolved",
};

const DB_TO_OPS_PRIORITY: Record<string, InternalTicket["priority"]> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	urgent: "Urgent",
};

const OPS_TO_DB_PRIORITY: Record<
	InternalTicket["priority"],
	"low" | "medium" | "high" | "urgent"
> = {
	Low: "low",
	Medium: "medium",
	High: "high",
	Urgent: "urgent",
};

/* ── Map a DB ticket into the InternalTicket shape the ops UI expects ──── */

let refCounter = 0;

function mapDbTicket(t: Ticket): InternalTicket {
	return {
		id: t.id,
		ref: `TKT-${String(++refCounter).padStart(4, "0")}`,
		source: (t.source as "internal" | "external") ?? "external",
		title: t.subject,
		description: t.messages?.[0]?.message || "",
		category: (t.category as TicketCategory) || "Other",
		status: DB_TO_OPS_STATUS[t.status] ?? "Open",
		priority: DB_TO_OPS_PRIORITY[t.priority] ?? "Medium",
		createdBy: t.applicantName,
		assignedTo: t.assignedStaffName ?? "",
		assignedToEmail: "",
		createdAt: t.createdAt,
		updatedAt: t.updatedAt,
		escalatedToAdmin: false,
		messages: t.messages.map((m) => ({
			id: m.id,
			author: m.senderName,
			role: (m.senderType === "applicant" ? "applicant" : "staff") as "applicant" | "staff",
			body: m.message,
			at: m.createdAt,
		})),
	};
}

/* ── Staff member shape ──── */

export type StaffMember = {
	id: string;
	name: string;
	email: string;
	role: string;
	branch: string | null;
	active: boolean;
};

/* ── Hook ──── */

export function useTicketsApi() {
	const [tickets, setTickets] = useState<InternalTicket[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [staffList, setStaffList] = useState<StaffMember[]>([]);

	/* ── Fetch all tickets from the DB (both internal and external) ──── */

	const refreshTickets = useCallback(() => {
		let cancelled = false;
		setLoading(true);
		ticketsApi
			.listAll()
			.then((res) => {
				if (cancelled) return;
				refCounter = 0;
				setTickets(res.tickets.map(mapDbTicket));
				setError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setTickets([]);
				setError(err instanceof Error ? err.message : "Could not load tickets.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const cancel = refreshTickets();
		return () => cancel?.();
	}, [refreshTickets]);

	/* ── Fetch staff list for assignment dropdown ──── */

	useEffect(() => {
		staffApi
			.list()
			.then((res) => setStaffList(res.staff.filter((s) => s.active)))
			.catch(() => {});
	}, []);

	/* ── All mutations go through the API ──── */

	const assignTicket = useCallback(
		async (id: string, to: { name: string; email: string } | null, _by: string) => {
			const staffMember = to ? staffList.find((s) => s.email === to.email) : null;
			await ticketsApi.updateStatus(id, {
				status: "pending",
				assignedStaffId: staffMember?.id ?? null,
			});
			refreshTickets();
		},
		[staffList, refreshTickets],
	);

	const escalateTicket = useCallback(
		async (id: string, _by: string) => {
			await ticketsApi.updateStatus(id, {
				status: "pending",
				assignedStaffId: null,
			});
			refreshTickets();
		},
		[refreshTickets],
	);

	const updateTicketStatus = useCallback(
		async (id: string, status: TicketStatus, _by?: string) => {
			await ticketsApi.updateStatus(id, {
				status: OPS_TO_DB_STATUS[status] as "open" | "pending" | "resolved" | "closed",
			});
			refreshTickets();
		},
		[refreshTickets],
	);

	const replyToTicket = useCallback(
		async (id: string, body: string, _author: string, _role: "applicant" | "staff") => {
			await ticketsApi.replyAsStaff(id, { message: body });
			refreshTickets();
		},
		[refreshTickets],
	);

	const createTicket = useCallback(
		async (input: { title: string; description: string; category: TicketCategory; priority?: string }) => {
			await ticketsApi.createInternal({
				subject: input.title,
				category: input.category,
				message: input.description,
				// The UI's display casing ("Medium") must become the API's enum
				// value ("medium") — the zod schema rejects anything else.
				priority:
					OPS_TO_DB_PRIORITY[input.priority as InternalTicket["priority"]] ?? "medium",
			});
			refreshTickets();
		},
		[refreshTickets],
	);

	return {
		tickets,
		loading,
		error,
		staffList,
		assignTicket,
		escalateTicket,
		updateTicketStatus,
		replyToTicket,
		createTicket,
		refreshTickets,
	};
}
