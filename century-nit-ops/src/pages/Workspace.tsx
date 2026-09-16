import { useCallback, useEffect, useMemo, useState } from "react";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { useUrlParam } from "../hooks/useUrlParam";
import { OPS_BRANCHES } from "century-nit-core/ops";

import { fmtGhs, money } from "./currency";
import type {
	Assignee,
} from "century-nit-core/ops";
import { type Lead } from "century-nit-core";
import { apiFetch } from "../lib/api";
import { bookingsApi } from "century-nit-core/api";
import { API_PREFIX, WORKSPACE_TAB_LABELS, type Booking, type WorkspaceTab } from "century-nit-shared";
import {
	assignPendingTask,
	buildInvoiceRows,
	buildPendingTasks,
	isDueToday,
	isOverdue,
	type PendingTask,
} from "../lib/pendingTasks";
import { PendingTaskRows } from "./PendingTasks";
import type { HandlerPlacement } from "./case/AssignSheet";
import { NowPane } from "./NowPane";
import { CaseScaffold } from "./case/CaseScaffold";
import { CaseTabs, useCaseTab } from "./case/CaseTabs";
import { WorkspaceCaseload } from "./WorkspaceCaseload";
import { FilterGroup } from "./FilterGroup";
import { PreviewPane } from "./TaskPreview";

/**
 * F-shaped workspace / mission control.
 *
 * The first scan is the filter chips; the second is the long, left-aligned
 * work queue presented as a table with inline assignment. The right-hand
 * pane only appears while an item is selected — with nothing selected the
 * queue keeps the page width.
 *
 * Every filter and the open task live in the URL (`?tab=&filter=&time=&type=
 * &branch=&sort=&q=&open=`), so a refresh keeps the view and a notification
 * can deep-link a task straight into the preview pane.
 */

/** The two views — the queue to clear vs the workload being carried. */
const WORKSPACE_TABS: readonly WorkspaceTab[] = ["worklist", "caseload"];

/**
 * Queue filters — the two time cuts first (what the day is), then the
 * backlog categories from buildPendingTasks. Each chip carries its live
 * count, so the shape of the day reads before anything is clicked.
 */
const QUEUE_FILTERS = [
	{ id: "all", label: "All" },
	{ id: "mine", label: "Mine" },
	{ id: "needs_assignment", label: "No handler" },
	{ id: "needs_invoice", label: "Invoicing" },
	{ id: "needs_followup", label: "Follow-up" },
] as const;
type QueueFilter = (typeof QUEUE_FILTERS)[number]["id"];
const QUEUE_IDS = QUEUE_FILTERS.map((f) => f.id);

/** The time cut is a second, independent filter — "mine" + "overdue" is a
 * valid and useful cut, so it gets its own radiogroup rather than chips
 * that pretend to be alternatives to the category ones. */
const TIME_FILTERS = [
	{ id: "all", label: "Any time" },
	{ id: "today", label: "Today" },
	{ id: "overdue", label: "Overdue" },
] as const;
type TimeFilter = (typeof TIME_FILTERS)[number]["id"];
const TIME_IDS = TIME_FILTERS.map((f) => f.id);

const passesQueueFilter = (item: PendingTask, filter: QueueFilter, me?: { name?: string; email?: string }): boolean => {
	if (filter === "all") return true;
	// "Mine" is a real handler check — the seat is held by this officer.
	if (filter === "mine") {
		const who = [me?.name, me?.email].filter(Boolean);
		return who.some((w) => item.owner === w);
	}
	return item.category === filter;
};

const passesTimeFilter = (item: PendingTask, time: TimeFilter): boolean => {
	if (time === "today") return isDueToday(item);
	if (time === "overdue") return isOverdue(item);
	return true;
};

const TYPE_FILTERS = [
	{ id: "all", label: "All Types" },
	{ id: "consultation", label: "Consultation" },
	{ id: "application", label: "Application" },
	{ id: "travel", label: "Travel" },
	{ id: "invoice", label: "Invoice" },
	{ id: "lead", label: "Lead" },
] as const;
const TYPE_IDS = TYPE_FILTERS.map((f) => f.id);

const DATE_SORTS = [
	{ id: "default", label: "Priority" },
	{ id: "desc", label: "Newest first" },
	{ id: "asc", label: "Oldest first" },
] as const;
const SORT_IDS = DATE_SORTS.map((f) => f.id);

export function Workspace() {
	const { opsUser, canSeeAllBranches, canAssignWork, scopeRecords } = useOpsAuth();
	const {
		consultations,
		applications,
		applicants,
		assignees,
		handoffs,
		travelRequests,
		loading: casesLoading,
		error: casesError,
		refresh,
		assignConsultation,
		assignApplication,
		referConsultation,
		referApplication,
		resolveHandoff,
		deferHandoff,
	} = useCases();
	const { invoices, loading: invoicesLoading } = useInvoiceApi();

	const [view, setView] = useCaseTab(WORKSPACE_TABS, () => "worklist");
	// All filters live in the URL — refresh-safe, and a stale value falls
	// back instead of silently emptying the queue.
	const [filter, setFilter] = useUrlParam<QueueFilter>("filter", { allowed: QUEUE_IDS, fallback: "all" });
	const [time, setTime] = useUrlParam<TimeFilter>("time", { allowed: TIME_IDS, fallback: "all" });
	const [typeFilter, setTypeFilter] = useUrlParam("type", { allowed: TYPE_IDS, fallback: "all" });
	const [branchFilter, setBranchFilter] = useUrlParam("branch", { fallback: "all" });
	const [dateSort, setDateSort] = useUrlParam("sort", { allowed: SORT_IDS, fallback: "default" });
	const [search, setSearch] = useUrlParam("q");
	// The open task is `?open=` — a deep link opens it even when the chips
	// would have filtered it out.
	const [openId, setOpenId] = useUrlParam("open");
	const [leads, setLeads] = useState<Lead[]>([]);
	const [leadsLoading, setLeadsLoading] = useState(false);
	const [liveBookings, setLiveBookings] = useState<Booking[]>([]);
	const liveBookingIds = useMemo(() => new Set(liveBookings.map((b) => b.id)), [liveBookings]);

	useEffect(() => {
		let cancelled = false;
		setLeadsLoading(true);
		void (async () => {
			try {
				const res = await apiFetch<{ leads: (Lead & { targetCountry?: string; assignedStaffName?: string; updatedAt?: string; createdAt?: string })[] }>(`${API_PREFIX}/leads`);
				if (!cancelled) {
					const mapped = (res.leads || []).map((l) => ({
						...l,
						country: l.country || l.targetCountry || "Ghana",
						assignedTo: l.assignedTo || l.assignedStaffName || "— open",
						lastContactAt: l.lastContactAt || l.updatedAt || l.createdAt || new Date().toISOString(),
						phone: l.phone || "—",
					}));
					setLeads(mapped as Lead[]);
				}
			} catch {
				if (!cancelled) setLeads([]);
			} finally {
				if (!cancelled) setLeadsLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		let cancelled = false;
		const fetchLive = async () => {
			try {
				const res = await bookingsApi.liveMeetings();
				if (!cancelled) setLiveBookings(res.bookings);
			} catch { /* ignore */ }
		};
		void fetchLive();
		const id = setInterval(fetchLive, 60_000);
		return () => { cancelled = true; clearInterval(id); };
	}, []);

	const scopedConsultations = useMemo(
		() =>
			scopeRecords(
				consultations,
				(c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
			),
		[scopeRecords, consultations, opsUser],
	);

	const scopedApplications = useMemo(
		() =>
			scopeRecords(
				applications,
				(a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name,
			),
		[scopeRecords, applications, opsUser],
	);

	const scopedApplicants = useMemo(
		() =>
			scopeRecords(
				applicants,
				(a) => a.assignedOfficerEmail === opsUser?.email || a.assignedOfficer === opsUser?.name,
			),
		[scopeRecords, applicants, opsUser],
	);

	const invoiceRows = useMemo(() => buildInvoiceRows(invoices), [invoices]);

	const items = useMemo<PendingTask[]>(() => {
		return buildPendingTasks({
			consultations: scopedConsultations,
			applications: scopedApplications,
			applicants: scopedApplicants,
			handoffs,
			travelRequests,
			invoiceRows,
			invoices,
			leads,
			liveBookingIds: liveBookingIds,
		});
	}, [scopedConsultations, scopedApplications, scopedApplicants, invoiceRows, invoices, leads, liveBookingIds, handoffs, travelRequests]);

	// The open task resolves against the unfiltered queue — a deep link
	// opens it even when the chips would have hidden the row.
	const selected = useMemo(() => items.find((t) => t.id === openId) ?? null, [items, openId]);
	const selectTask = useCallback(
		(t: PendingTask) => setOpenId(openId === t.id ? null : t.id),
		[openId, setOpenId],
	);

	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim();
		const result = items.filter((item) => {
			if (branchFilter !== "all" && item.branch && item.branch !== branchFilter) return false;
			if (!passesQueueFilter(item, filter, opsUser ?? undefined)) return false;
			if (!passesTimeFilter(item, time)) return false;
			if (typeFilter !== "all" && item.kind !== typeFilter) return false;
			if (!q) return true;
			const hay = `${item.title} ${item.subtitle} ${item.meta} ${item.owner}`.toLowerCase();
			return hay.includes(q);
		});
		if (dateSort === "desc") {
			result.sort((a, b) => (new Date(b.at || 0).getTime()) - (new Date(a.at || 0).getTime()));
		} else if (dateSort === "asc") {
			result.sort((a, b) => (new Date(a.at || 0).getTime()) - (new Date(b.at || 0).getTime()));
		}
		return result;
	}, [items, branchFilter, filter, time, typeFilter, dateSort, search]);

	const stats = useMemo(() => {
		const counts = new Map<string, number>([["all", items.length]]);
		for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
		counts.set("today", items.filter((i) => isDueToday(i)).length);
		counts.set("overdue", items.filter((i) => isOverdue(i)).length);
		const me = [opsUser?.name, opsUser?.email].filter(Boolean);
		counts.set("mine", items.filter((i) => me.some((w) => i.owner === w)).length);
		const totalOutstanding = applicants.reduce((n, a) => n + money(a.financials.outstanding), 0);
		return { counts, totalOutstanding };
	}, [items, applicants, opsUser]);

	const loading = casesLoading || invoicesLoading || leadsLoading;

	const assignActions = useMemo(
		() => ({ assignConsultation, assignApplication, resolveHandoff }),
		[assignConsultation, assignApplication, resolveHandoff],
	);
	const doAssign = useCallback(
		(task: PendingTask, to: Assignee, placement: HandlerPlacement) =>
			assignPendingTask(task, to, placement, assignActions).then(() => refresh()),
		[assignActions, refresh],
	);

	const doLeaveOpen = useCallback(
		async (task: PendingTask, branch: string) => {
			if (task.kind === "consultation") return referConsultation(task.record.id, branch);
			if (task.kind === "application" || task.kind === "visa") return referApplication(task.record.id, branch);
			if (task.kind === "handoff" && task.record.applicationId) return referApplication(task.record.applicationId, branch);
			if (task.kind === "travel") return referApplication(task.record.applicationId, branch);
			throw new Error("This task cannot be referred from here.");
		},
		[referConsultation, referApplication],
	);

	const today = stats.counts.get("today") ?? 0;
	const overdue = stats.counts.get("overdue") ?? 0;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
				<div>
					<h1 className="page-title">Workspace</h1>
					<p className="lead mt-1">
						{opsUser ? `Good day, ${opsUser.name.split(" ")[0]}.` : "Operations workspace."}{" "}
						{view === "worklist" ? "Here is what needs attention." : "Here is what is in flight and who has it."}
					</p>
				</div>
				{/* The day's summary — computed anyway, so put it where a scan starts. */}
				<p className="cn-filter__label" style={{ textAlign: "right", lineHeight: 1.9 }}>
					{new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
					<br />
					<strong style={{ color: "var(--foreground)" }}>{items.length} open</strong> · {today} today · {overdue} overdue
					{stats.totalOutstanding > 0 ? ` · ${fmtGhs(stats.totalOutstanding)} outstanding` : ""}
				</p>
			</div>

			{casesError && view === "worklist" && <p className="ops-modal__error" role="alert">{casesError}</p>}

			<CaseTabs
				pageLevel
				tabs={WORKSPACE_TABS.map((id) => ({ id, label: id === "worklist" ? `${WORKSPACE_TAB_LABELS[id]} ${items.length}` : WORKSPACE_TAB_LABELS[id] }))}
				current={view}
				onChange={setView}
			/>

			{view === "caseload" && <WorkspaceCaseload tasks={items} />}

			{view === "worklist" && <CaseScaffold
				bare
				collapseDetail
				onClose={() => setOpenId(null)}
				bar={null}
				rail={<NowPane items={items} liveBookings={liveBookings} onSelect={(t) => setOpenId(t.id)} />}
				list={
					<>
						<div className="cn-scaffold__filters">
							<div className="cn-scaffold__chips">
								<FilterGroup
									label="Queue"
									options={QUEUE_FILTERS.map((f) => ({
										id: f.id,
										label: f.label,
										count: stats.counts.get(f.id) ?? 0,
										hot: f.id === "mine" && (stats.counts.get("mine") ?? 0) > 0,
									}))}
									value={filter}
									onChange={setFilter}
								/>
								<FilterGroup
									label="When"
									options={TIME_FILTERS.map((f) => ({
										id: f.id,
										label: f.label,
										count: f.id === "all" ? undefined : (stats.counts.get(f.id) ?? 0),
										hot: f.id === "overdue" && overdue > 0,
									}))}
									value={time}
									onChange={setTime}
								/>
							</div>
							<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
							<input
								type="search"
								placeholder="Search queue…"
								value={search}
								onChange={(e) => setSearch(e.target.value || null)}
								className="cn-search"
								aria-label="Search queue"
								style={{ flex: "1 1 14rem", width: "auto" }}
							/>
							<label className="cn-filter">
								<span className="cn-filter__label">Type</span>
								<select
									className="cn-filter__select"
									value={typeFilter}
									onChange={(e) => setTypeFilter(e.target.value)}
								>
									{TYPE_FILTERS.map((f) => (
										<option key={f.id} value={f.id}>
											{f.label}
										</option>
									))}
								</select>
							</label>
							<label className="cn-filter">
								<span className="cn-filter__label">Date/Time</span>
								<select
									className="cn-filter__select"
									value={dateSort}
									onChange={(e) => setDateSort(e.target.value)}
								>
									{DATE_SORTS.map((f) => (
										<option key={f.id} value={f.id}>
											{f.label}
										</option>
									))}
								</select>
							</label>
							{canSeeAllBranches && (
								<label className="cn-filter">
									<span className="cn-filter__label">Branch</span>
									<select
										className="cn-filter__select"
										value={branchFilter}
										onChange={(e) => setBranchFilter(e.target.value)}
									>
										<option value="all">All Branches</option>
										{OPS_BRANCHES.map(b => (
											<option key={b.id} value={b.id}>{b.name}</option>
										))}
									</select>
								</label>
							)}
							{loading && <span className="cn-filter__label" style={{ marginLeft: "auto" }}>Loading…</span>}
							</div>
						</div>
						<div className="cn-scaffold__rows">
							<PendingTaskRows
								items={filtered}
								assignees={assignees}
								canAssignWork={canAssignWork}
								onAssign={doAssign}
								onLeaveOpen={doLeaveOpen}
								onKeepHandler={async (t, reason) => {
									if (t.kind === "handoff") await resolveHandoff(t.record.id, "keep", { reason });
								}}
								onAssigned={refresh}
								onSelect={selectTask}
								selectedId={selected?.id}
								emptyLabel={
									loading
										? "Loading your queue…"
										: "You're all caught up! Nothing on your desk right now."
								}
							/>
						</div>
					</>
				}
				detail={
					selected ? (
						<PreviewPane
							item={selected}
							assignees={assignees}
							canAssignWork={canAssignWork}
							onAssigned={refresh}
							onAssignConsultation={assignConsultation}
							onAssignApplication={assignApplication}
							onReferConsultation={referConsultation}
							onReferApplication={referApplication}
							onResolveHandoff={resolveHandoff}
							onDeferHandoff={deferHandoff}
						/>
					) : null
				}
			/>}
		</div>
	);
}
