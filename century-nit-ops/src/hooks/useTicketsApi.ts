import { useCallback, useEffect, useMemo, useState } from "react";
import { ticketsApi, staffApi } from "century-nit-core/api";
import type { Ticket } from "century-nit-shared";
import type { InternalTicket, TicketStatus, TicketPriority, TicketCategory } from "century-nit-core/ops";

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

const DB_TO_OPS_PRIORITY: Record<string, TicketPriority> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	urgent: "Urgent",
};

/* ── Map a DB ticket into the InternalTicket shape the ops UI expects ──── */

function mapDbTicket(t: Ticket, idx: number): InternalTicket {
	return {
		id: t.id,
		ref: `TKT-${String(idx + 1).padStart(4, "0")}`,
		source: "external",
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

export function useTicketsApi({
	localInternalTickets,
	onLocalCreate,
	onLocalUpdate,
	onLocalAssign,
	onLocalEscalate,
	onLocalReply,
}: {
	/** Internal (staff-to-staff) tickets from localStorage via OpsStateContext */
	localInternalTickets: InternalTicket[];
	onLocalCreate: (ticket: Omit<InternalTicket, "id" | "ref" | "createdAt" | "updatedAt" | "assignedTo" | "assignedToEmail" | "escalatedToAdmin" | "messages"> & { messages?: { id: string; author: string; role: "applicant" | "staff"; body: string; at: string }[] }) => void;
	onLocalUpdate: (id: string, status: TicketStatus, by?: string) => void;
	onLocalAssign: (id: string, to: { name: string; email: string } | null, by: string) => void;
	onLocalEscalate: (id: string, by: string) => void;
	onLocalReply: (id: string, body: string, author: string, role: "applicant" | "staff") => void;
}) {
	const [dbTickets, setDbTickets] = useState<InternalTicket[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [staffList, setStaffList] = useState<StaffMember[]>([]);

	/* ── Fetch external tickets from the DB ──── */

	const refreshTickets = useCallback(() => {
		let cancelled = false;
		setLoading(true);
		ticketsApi
			.listAll()
			.then((res) => {
				if (cancelled) return;
				setDbTickets(res.tickets.map((t, idx) => mapDbTicket(t, idx)));
				setError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setDbTickets([]);
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

	/* ── Merge: DB external tickets + localStorage internal tickets ──── */

	const tickets = useMemo(() => {
		return [...dbTickets, ...localInternalTickets.filter((t) => t.source === "internal")];
	}, [dbTickets, localInternalTickets]);

	/* ── API-backed mutations for external tickets ──── */

	const assignTicket = useCallback(
		async (id: string, to: { name: string; email: string } | null, by: string) => {
			const isDb = dbTickets.some((t) => t.id === id);
			if (isDb) {
				// Find the staff member's ID from the list to set assignedStaffId
				const staffMember = to ? staffList.find((s) => s.email === to.email) : null;
				await ticketsApi.updateStatus(id, {
					status: "pending",
					assignedStaffId: staffMember?.id ?? null,
				});
				refreshTickets();
			} else {
				onLocalAssign(id, to, by);
			}
		},
		[dbTickets, staffList, refreshTickets, onLocalAssign],
	);

	const escalateTicket = useCallback(
		async (id: string, by: string) => {
			const isDb = dbTickets.some((t) => t.id === id);
			if (isDb) {
				// Escalation clears assignment — set assignedStaffId to null
				await ticketsApi.updateStatus(id, {
					status: "pending",
					assignedStaffId: null,
				});
				refreshTickets();
			} else {
				onLocalEscalate(id, by);
			}
		},
		[dbTickets, refreshTickets, onLocalEscalate],
	);

	const updateTicketStatus = useCallback(
		async (id: string, status: TicketStatus, by: string) => {
			const isDb = dbTickets.some((t) => t.id === id);
			if (isDb) {
				await ticketsApi.updateStatus(id, {
					status: OPS_TO_DB_STATUS[status] as "open" | "pending" | "resolved" | "closed",
				});
				refreshTickets();
			} else {
				onLocalUpdate(id, status, by);
			}
		},
		[dbTickets, refreshTickets, onLocalUpdate],
	);

	const replyToTicket = useCallback(
		async (id: string, body: string, author: string, role: "applicant" | "staff") => {
			const isDb = dbTickets.some((t) => t.id === id);
			if (isDb) {
				await ticketsApi.replyAsStaff(id, { message: body });
				refreshTickets();
			} else {
				onLocalReply(id, body, author, role);
			}
		},
		[dbTickets, refreshTickets, onLocalReply],
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
		refreshTickets,
		createTicket: onLocalCreate,
	};
}
