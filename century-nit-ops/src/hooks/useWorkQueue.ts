import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, bookingsApi } from "century-nit-core/api";
import type { Booking } from "century-nit-shared";
import type { Lead } from "century-nit-core";
import { API_PREFIX } from "century-nit-shared";
import { useOpsAuth } from "../pages/OpsAuthContext";
import { useCases } from "./useCases";
import { useOpsSSE } from "./useChatStream";
import { useInvoiceApi } from "./useInvoiceApi";
import { apiFetch } from "../lib/api";
import {
	buildInvoiceRows,
	buildPendingTasks,
	formatBookingWhenCompact,
	PRIORITY,
	sortTasks,
	type PendingTask,
} from "../lib/pendingTasks";

/**
 * The work queue as one hook — the same tasks the Workspace worklist and
 * the Dashboard's pending panel show, scoped to the signed-in user and
 * optionally to a branch: unassigned bookings, consultations to assess,
 * cases to assign, visa steps, documents, invoices, leads, handoffs.
 *
 * Also carries the live-meeting poll (once a minute) so a page can say
 * what is happening right now without a second timer.
 */
export function useWorkQueue(branchFilter = "all") {
	const { opsUser, scopeRecords } = useOpsAuth();
	const {
		consultations,
		applications,
		applicants,
		handoffs,
		travelRequests,
		loading: casesLoading,
		error: casesError,
		refresh,
	} = useCases();
	const { invoices, loading: invoicesLoading } = useInvoiceApi();

	const [bookings, setBookings] = useState<Booking[] | null>(null);
	const [bookingsError, setBookingsError] = useState<string | null>(null);
	const [leads, setLeads] = useState<Lead[]>([]);
	const [liveBookings, setLiveBookings] = useState<Booking[]>([]);

	const loadBookings = useCallback(() => {
		bookingsApi
			.list({ status: "UNASSIGNED" })
			.then((res) => {
				setBookings(res.bookings);
				setBookingsError(null);
			})
			.catch((err: unknown) => {
				setBookings([]);
				setBookingsError(
					err instanceof ApiError && err.isUnauthenticated
						? "Sign in to view bookings."
						: err instanceof Error
							? err.message
							: "Could not load bookings.",
				);
			});
	}, []);

	useEffect(loadBookings, [loadBookings]);

	const loadLeads = useCallback(() => {
		void (async () => {
			try {
				const res = await apiFetch<{ leads: (Lead & { targetCountry?: string; assignedStaffName?: string; updatedAt?: string; createdAt?: string })[] }>(`${API_PREFIX}/leads`);
				setLeads(
					(res.leads || []).map((l) => ({
						...l,
						country: l.country || l.targetCountry || "Ghana",
						assignedTo: l.assignedTo || l.assignedStaffName || "Unassigned",
						lastContactAt: l.lastContactAt || l.updatedAt || l.createdAt || new Date().toISOString(),
						phone: l.phone || "—",
					})),
				);
			} catch {
				setLeads([]);
			}
		})();
	}, []);

	useEffect(loadLeads, [loadLeads]);

	useEffect(() => {
		let cancelled = false;
		const fetchLive = async () => {
			try {
				const res = await bookingsApi.liveMeetings();
				if (!cancelled) setLiveBookings(res.bookings);
			} catch {
				/* ignore — the poll tries again in a minute */
			}
		};
		void fetchLive();
		const id = setInterval(fetchLive, 60_000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

	// Live refresh for the queue's own data: unassigned bookings and leads.
	// (Consultations, applications, handoffs, travel and invoices refresh
	// themselves inside useCasesApi / useInvoiceApi.) Debounced so a burst
	// of events is one refetch.
	const queueRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingQueueReloads = useRef({ bookings: false, leads: false });
	useOpsSSE((event) => {
		const t = String(event.type ?? "").replace(/_/g, ".");
		if (t.startsWith("booking.")) pendingQueueReloads.current.bookings = true;
		else if (t.startsWith("lead.")) pendingQueueReloads.current.leads = true;
		else return;
		if (queueRefreshTimer.current) clearTimeout(queueRefreshTimer.current);
		queueRefreshTimer.current = setTimeout(() => {
			const pending = pendingQueueReloads.current;
			pendingQueueReloads.current = { bookings: false, leads: false };
			if (pending.bookings) loadBookings();
			if (pending.leads) loadLeads();
		}, 1500);
	});

	const liveIds = useMemo(() => new Set(liveBookings.map((b) => b.id)), [liveBookings]);

	const scopedConsultations = useMemo(
		() => scopeRecords(consultations, (c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name),
		[scopeRecords, consultations, opsUser],
	);
	const scopedApplications = useMemo(
		() => scopeRecords(applications, (a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name),
		[scopeRecords, applications, opsUser],
	);
	const scopedApplicants = useMemo(
		() => scopeRecords(applicants, (a) => a.assignedOfficerEmail === opsUser?.email || a.assignedOfficer === opsUser?.name),
		[scopeRecords, applicants, opsUser],
	);

	const inBranch = useCallback(
		<T extends { branch: string }>(list: T[]) => (branchFilter === "all" ? list : list.filter((x) => x.branch === branchFilter)),
		[branchFilter],
	);

	const invoiceRows = useMemo(() => buildInvoiceRows(invoices), [invoices]);

	const items = useMemo<PendingTask[]>(() => {
		const built = buildPendingTasks({
			consultations: inBranch(scopedConsultations),
			applications: inBranch(scopedApplications),
			applicants: inBranch(scopedApplicants),
			handoffs,
			travelRequests,
			invoiceRows,
			invoices,
			leads,
			liveBookingIds: liveIds,
			excludeBookingIds: new Set((bookings ?? []).map((b) => b.id)),
		});
		const bookingTasks: PendingTask[] = (bookings ?? []).map((b) => ({
			id: `booking-${b.id}`,
			category: "needs_assignment",
			kind: "booking",
			action: "assign",
			record: b,
			at: b.startsAt,
			due: b.startsAt,
			title: b.clientName,
			subtitle: b.serviceName,
			meta: formatBookingWhenCompact(b),
			branch: "",
			owner: "Unassigned",
			linkTo: "/consultations",
			priority: PRIORITY.assign_consultation,
			isLive: liveIds.has(b.id),
		}));
		return sortTasks([...built, ...bookingTasks]);
	}, [scopedConsultations, scopedApplications, scopedApplicants, handoffs, travelRequests, invoiceRows, invoices, leads, liveIds, bookings, inBranch]);

	const refreshAll = useCallback(() => {
		loadBookings();
		void refresh();
	}, [loadBookings, refresh]);

	return {
		items,
		liveBookings,
		liveIds,
		invoiceRows,
		leads,
		loading: (casesLoading || invoicesLoading) && items.length === 0,
		error: bookingsError ?? casesError ?? null,
		refresh: refreshAll,
	};
}
