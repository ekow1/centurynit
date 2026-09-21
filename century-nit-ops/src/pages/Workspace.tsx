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
import { passesQueueFilter, rememberQueueCut, type QueueFilter } from "../lib/queueCut";
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
 * Every filter and the open task live in the URL (`?tab=&filter=&type=
 * &branch=&sort=&q=&open=`), so a refresh keeps the view and a notification
 * can deep-link a task straight into the preview pane.
 */

/** The two views — the queue to clear vs the workload being carried. */
const WORKSPACE_TABS: readonly WorkspaceTab[] = ["worklist", "caseload"];

/**
 * Queue filters — the triage cuts live on the main row (everything, mine,
 * unassigned), and the occasional category cuts sit one click deep in the
 * Filters drawer. No time chips: the list is already banded overdue / today /
 * everything else, so a "today" chip would just hide headers.
 */
const QUEUE_FILTERS = [
	{ id: "all", label: "All" },
	{ id: "mine", label: "Mine" },
	{ id: "needs_assignment", label: "Unassigned" },
	{ id: "coordinated", label: "Coordinated" },
	{ id: "needs_invoice", label: "Invoicing" },
	{ id: "needs_followup", label: "Follow-up" },
] as const;
const QUEUE_IDS = QUEUE_FILTERS.map((f) => f.id);

/** The three cuts that answer "what should I touch next" stay on the bar. */
const MAIN_FILTERS: readonly QueueFilter[] = ["all", "mine", "needs_assignment"];
/** The occasional cuts live in the drawer. */
const DRAWER_FILTERS: readonly QueueFilter[] = ["coordinated", "needs_invoice", "needs_followup"];


/** One chip per task kind that exists, named for people; kinds with no tasks behind them get none. */
const TYPE_FILTERS = [
	{ id: "all", label: "All types" },
	{ id: "consultation", label: "Consultation" },
	{ id: "application", label: "Application" },
	{ id: "visa", label: "Visa" },
	{ id: "travel", label: "Departure" },
	{ id: "handoff", label: "Handler needed" },
	{ id: "applicant", label: "Documents" },
	{ id: "invoice", label: "Invoice" },
	{ id: "lead", label: "Lead" },
] as const;
const TYPE_IDS = TYPE_FILTERS.map((f) => f.id);
type TypeFilter = (typeof TYPE_FILTERS)[number]["id"];

const DATE_SORTS = [
	{ id: "default", label: "Priority" },
	{ id: "desc", label: "Newest first" },
	{ id: "asc", label: "Oldest first" },
] as const;
/** Labelled SORT in the drawer — it orders, it doesn't filter. */
const SORT_IDS = DATE_SORTS.map((f) => f.id);
type SortId = (typeof DATE_SORTS)[number]["id"];

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
	const [typeFilter, setTypeFilter] = useUrlParam<TypeFilter>("type", { allowed: TYPE_IDS, fallback: "all" });
	// The dashboard's "queue today" shows the top of *this* cut, so the two never disagree.
	useEffect(() => {
		rememberQueueCut({ filter, type: typeFilter });
	}, [filter, typeFilter]);
	const [branchFilter, setBranchFilter] = useUrlParam<string>("branch", { fallback: "all" });
	const [dateSort, setDateSort] = useUrlParam<SortId>("sort", { allowed: SORT_IDS, fallback: "default" });
	const [search, setSearch] = useUrlParam("q");
	// The open task is `?open=` — a deep link opens it even when the chips
	// would have filtered it out.
	const [openId, setOpenId] = useUrlParam("open");
	// The drawer auto-opens while one of its facets is set, so a deep link
	// like ?filter=coordinated shows where the cut came from.
	const drawerActive =
		DRAWER_FILTERS.includes(filter) ||
		typeFilter !== "all" ||
		branchFilter !== "all" ||
		dateSort !== "default";
	const [drawerToggled, setDrawerToggled] = useState<boolean | null>(null);
	const drawerOpen = drawerToggled ?? drawerActive;
	const setDrawerOpen = () => setDrawerToggled(!drawerOpen);

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
	}, [items, branchFilter, filter, typeFilter, dateSort, search, opsUser]);

	const stats = useMemo(() => {
		const counts = new Map<string, number>([["all", items.length]]);
		for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
		counts.set("today", items.filter((i) => isDueToday(i)).length);
		counts.set("overdue", items.filter((i) => isOverdue(i)).length);
		const me = [opsUser?.name, opsUser?.email].filter(Boolean);
		counts.set("mine", items.filter((i) => me.some((w) => i.owner === w)).length);
		counts.set("coordinated", items.filter((i) => i.kind === "consultation" && Boolean(i.record.coordinatorId)).length);
		const kindCounts = new Map<string, number>();
		for (const i of items) kindCounts.set(i.kind, (kindCounts.get(i.kind) ?? 0) + 1);
		const totalOutstanding = applicants.reduce((n, a) => n + money(a.financials.outstanding), 0);
		return { counts, kindCounts, totalOutstanding };
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
							{/* One row: the three triage cuts, the drawer toggle, search.
							    Everything else is one click deep. */}
							<div className="cn-scaffold__chips">
								<FilterGroup
									label="Queue"
									options={MAIN_FILTERS.map((id) => {
										const f = QUEUE_FILTERS.find((q) => q.id === id)!;
										return {
											id: f.id,
											label: f.label,
											count: stats.counts.get(f.id) ?? 0,
											hot: f.id === "needs_assignment" && (stats.counts.get(f.id) ?? 0) > 0,
										};
									})}
									value={filter}
									onChange={setFilter}
								/>
								<button
									type="button"
									className={`ops-pill ops-pill--chip${drawerActive ? " ops-pill--hot" : ""}`}
									style={{ borderStyle: "dashed" }}
									aria-expanded={drawerOpen}
									aria-controls="queue-filter-drawer"
									onClick={setDrawerOpen}
								>
									Filters {drawerOpen ? "▴" : "▾"}
								</button>
								<input
									type="search"
									placeholder="Search queue…"
									value={search}
									onChange={(e) => setSearch(e.target.value || null)}
									className="cn-search"
									aria-label="Search queue"
									style={{ flex: "1 1 14rem", width: "auto", marginLeft: "auto" }}
								/>
								{loading && <span className="cn-filter__label">Loading…</span>}
							</div>
							{/* The occasional cuts — one quiet strip, opened on demand or
							    automatically when a drawer facet is active. */}
							{drawerOpen && (
								<div
									id="queue-filter-drawer"
									className="cn-scaffold__filter-row"
									style={{ flexWrap: "wrap", gap: "0.75rem 1.5rem", background: "var(--muted)" }}
								>
									<span style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
										<span className="cn-filter__label">Needs</span>
										<FilterGroup
											label="Needs"
											options={DRAWER_FILTERS.map((id) => {
												const f = QUEUE_FILTERS.find((q) => q.id === id)!;
												return { id: f.id, label: f.label, count: stats.counts.get(f.id) ?? 0 };
											})}
											value={filter}
											onChange={setFilter}
										/>
									</span>
									<label className="cn-filter">
										<span className="cn-filter__label">Type</span>
										<select
											className="cn-filter__select"
											value={typeFilter}
											onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
										>
											{TYPE_FILTERS.map((f) => (
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
									<label className="cn-filter">
										<span className="cn-filter__label">Sort</span>
										<select
											className="cn-filter__select"
											value={dateSort}
											onChange={(e) => setDateSort(e.target.value as SortId)}
										>
											{DATE_SORTS.map((f) => (
												<option key={f.id} value={f.id}>
													{f.label}
												</option>
											))}
										</select>
									</label>
								</div>
							)}
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
