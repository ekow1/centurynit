import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { fmtGhs, fmtUsd, money } from "./currency";
import type {
	MockConsultation,
	MockApplication,
	MockApplicant,
	Invoice,
	Assignee,
} from "century-nit-core/ops";
import { invoiceBalance, invoiceAgeDays } from "century-nit-core/ops";
import { LEAD_STAGE_LABELS, type Lead, type LeadStage } from "century-nit-core";
import { apiFetch, ApiError } from "../lib/api";
import { applicationsApi, bookingsApi } from "century-nit-core/api";
import { AssignControl } from "century-nit-core/ui";
import { API_PREFIX, JOURNEY_STAGE_LABELS, WORKSPACE_TAB_LABELS, type JourneyStage, type StageHandoff, type WorkspaceTab } from "century-nit-shared";
import {
	buildInvoiceRows,
	buildPendingTasks,
	handoffOffersKeep,
	taskActionLabel,
	TASK_KIND_LABEL,
	timeAgo,
	VISA_STEP_LABELS,
	type PendingTask,
} from "../lib/pendingTasks";
import { PendingTaskTable } from "./PendingTasks";
import { CaseScaffold } from "./case/CaseScaffold";
import { CaseTabs, useCaseTab } from "./case/CaseTabs";
import { WorkspaceCaseload } from "./WorkspaceCaseload";

/**
 * F-shaped workspace / mission control.
 *
 * The first scan is the filter chips; the second is the long, left-aligned
 * work queue presented as a table with inline assignment. The right-hand
 * pane only appears while an item is selected — with nothing selected the
 * queue keeps the page width.
 */

/** The two views — the queue to clear vs the workload being carried. */
const WORKSPACE_TABS: readonly WorkspaceTab[] = ["worklist", "caseload"];

/** Queue filters — every entry is a real task category from buildPendingTasks. */
const QUEUE_FILTERS: { id: string; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "needs_assignment", label: "Needs an owner" },
	{ id: "needs_action", label: "Needs you" },
	{ id: "needs_invoice", label: "Waiting on finance" },
	{ id: "needs_followup", label: "Follow up" },
];

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
		resolveHandoff,
		deferHandoff,
	} = useCases();
	const { invoices, loading: invoicesLoading } = useInvoiceApi();

	const [view, setView] = useCaseTab(WORKSPACE_TABS, () => "worklist", "workspace");
	const [branchFilter, setBranchFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [searchParams, setSearchParams] = useSearchParams();
	const [filter, setFilterState] = useState<string>(searchParams.get("filter") ?? "all");
	const setFilter = (next: string) => {
		setFilterState(next);
		const params = new URLSearchParams(searchParams);
		if (next === "all") params.delete("filter");
		else params.set("filter", next);
		setSearchParams(params, { replace: true });
	};
	const [selected, setSelected] = useState<PendingTask | null>(null);
	const [leads, setLeads] = useState<Lead[]>([]);
	const [leadsLoading, setLeadsLoading] = useState(false);
	const [liveBookingIds, setLiveBookingIds] = useState<Set<string>>(new Set());

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
						assignedTo: l.assignedTo || l.assignedStaffName || "Unassigned",
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
				if (!cancelled) setLiveBookingIds(new Set(res.bookings.map((b) => b.id)));
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

	// Only real task categories are filters — a stale ?filter= (the retired
	// "overdue"/"outstanding" cards) must not silently empty the queue.
	const activeFilter = QUEUE_FILTERS.some((f) => f.id === filter) ? filter : "all";

	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim();
		return items.filter((item) => {
			if (branchFilter !== "all" && item.branch && item.branch !== branchFilter) return false;
			if (activeFilter !== "all" && item.category !== activeFilter) return false;
			if (!q) return true;
			const hay = `${item.title} ${item.subtitle} ${item.meta} ${item.owner}`.toLowerCase();
			return hay.includes(q);
		});
	}, [items, branchFilter, activeFilter, search]);

	const stats = useMemo(() => {
		const counts = new Map<string, number>([["all", items.length]]);
		for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
		const overdue = invoiceRows.filter((r) => r.status === "overdue").length;
		const totalOutstanding = applicants.reduce((n, a) => n + money(a.financials.outstanding), 0);
		return { counts, overdue, totalOutstanding };
	}, [items, invoiceRows, applicants]);

	const loading = casesLoading || invoicesLoading || leadsLoading;

	const doAssign = useCallback(
		async (task: PendingTask, to: Assignee, reason?: string) => {
			if (task.kind === "consultation") {
				return assignConsultation(task.record.id, to);
			}
			if (task.kind === "application") {
				return assignApplication(task.record.id, to);
			}
			if (task.kind === "handoff" && task.action === "resolve") {
				return resolveHandoff(task.record.id, "assign", {
					opsUserId: to.opsUserId,
					reason: reason || undefined,
				});
			}
			if (task.kind === "travel" && to.opsUserId) {
				await applicationsApi.assignTravelHandler(task.record.id, to.opsUserId);
				await refresh();
				return;
			}
			throw new Error("This task cannot be assigned from here.");
		},
		[assignConsultation, assignApplication, resolveHandoff, refresh],
	);

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
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{view === "worklist" && canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			{casesError && view === "worklist" && <p className="ops-modal__error" role="alert">{casesError}</p>}

			<CaseTabs
				pageLevel
				tabs={WORKSPACE_TABS.map((id) => ({ id, label: WORKSPACE_TAB_LABELS[id] }))}
				current={view}
				onChange={setView}
			/>

			{view === "caseload" && <WorkspaceCaseload />}

			{view === "worklist" && <CaseScaffold
				collapseDetail
				onClose={() => setSelected(null)}
				bar={
					selected ? (
						<Link to={selected.linkTo} className="btn btn--primary btn--sm">
							{openLabel(selected)}
						</Link>
					) : null
				}
				list={
					<>
						<div className="cn-scaffold__filters cn-scaffold__filters--row">
							<input
								type="search"
								placeholder="Search queue…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="cn-search"
								aria-label="Search queue"
							/>
							<label className="cn-filter">
								<span className="cn-filter__label">Queue</span>
								<select
									className="cn-filter__select"
									value={activeFilter}
									onChange={(e) => setFilter(e.target.value)}
								>
									{QUEUE_FILTERS.map((f) => (
										<option key={f.id} value={f.id}>
											{f.label} · {stats.counts.get(f.id) ?? 0}
										</option>
									))}
								</select>
							</label>
							{loading && <span className="cn-filter__label">Loading…</span>}
							{stats.overdue > 0 && (
								<span className="cn-filter__label" style={{ marginLeft: "auto" }}>
									{stats.overdue} overdue invoice{stats.overdue === 1 ? "" : "s"}
									{stats.totalOutstanding > 0 ? ` · ${fmtGhs(stats.totalOutstanding)} outstanding` : ""}
								</span>
							)}
						</div>
						<div className="cn-scaffold__rows">
							<PendingTaskTable
								items={filtered}
								assignees={assignees}
								canAssignWork={canAssignWork}
								onAssign={doAssign}
								onAssigned={refresh}
								onSelect={(t) => setSelected((cur) => (cur?.id === t.id ? null : t))}
								selectedId={selected?.id}
								emptyLabel={loading ? "Loading your queue…" : "You're all caught up! Nothing on your desk right now."}
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
							onResolveHandoff={resolveHandoff}
							onDeferHandoff={deferHandoff}
						/>
					) : null
				}
			/>}
		</div>
	);
}

/** The one primary action for a task — where it opens. Every case-flavoured
 * task lands on the unified Cases queue; the label names the destination. */
function openLabel(item: PendingTask): string {
	if (item.kind === "booking" || item.kind === "consultation") return "Open consultation";
	if (item.kind === "applicant") return "Open client";
	if (item.kind === "invoice") return "Open invoice";
	if (item.kind === "lead") return "Open leads";
	return "Open case";
}

function PreviewPane({
	item,
	assignees,
	canAssignWork,
	onAssigned,
	onAssignConsultation,
	onAssignApplication,
	onResolveHandoff,
	onDeferHandoff,
}: {
	item: PendingTask;
	assignees: Assignee[];
	canAssignWork: boolean;
	onAssigned: () => void | Promise<void>;
	onAssignConsultation: (id: string, to: Assignee) => Promise<unknown>;
	onAssignApplication: (id: string, to: Assignee) => Promise<unknown>;
	onResolveHandoff: (handoffId: string, decision: "keep" | "assign", opts?: { opsUserId?: string; reason?: string }) => Promise<unknown>;
	onDeferHandoff: (handoffId: string, reason?: string) => Promise<unknown>;
}) {
	const [deferring, setDeferring] = useState(false);
	const [deferError, setDeferError] = useState<string | null>(null);

	// Which stage the picker is staffing — decides which roles are offered.
	const stageForRoles =
		item.kind === "handoff"
			? item.record.stage
			: item.kind === "travel"
				? "travel_assistance"
				: item.kind === "application"
					? "school_submission"
					: "consultation";

	const byId = (opsUserId: string) => assignees.find((a) => a.opsUserId === opsUserId);

	async function assignTo(opsUserId: string, reason?: string) {
		const to = byId(opsUserId);
		if (!to || !item.record) throw new Error("Staff member not found");
		if (item.kind === "consultation" && item.action === "assign") {
			await onAssignConsultation(item.record.id, to);
		} else if (item.kind === "application" && item.action === "assign") {
			await onAssignApplication(item.record.id, to);
		} else if (item.kind === "handoff" && item.action === "resolve") {
			await onResolveHandoff(item.record.id, "assign", { opsUserId, reason });
		} else if (item.kind === "travel" && item.action === "assign") {
			await applicationsApi.assignTravelHandler(item.record.id, opsUserId);
		}
		await onAssigned();
	}

	async function keepHandler(reason?: string) {
		if (item.kind !== "handoff") return;
		await onResolveHandoff(item.record.id, "keep", { reason });
		await onAssigned();
	}

	async function defer() {
		if (item.kind !== "handoff") return;
		setDeferring(true);
		setDeferError(null);
		try {
			await onDeferHandoff(item.record.id);
			await onAssigned();
		} catch (err) {
			setDeferError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not defer");
		} finally {
			setDeferring(false);
		}
	}

	return (
		<div className="cn-detail">
			{/* The "open" action lives in the scaffold bar beside Close, not here. */}
			<div>
				<span className="cn-detailhead__kicker">{TASK_KIND_LABEL[item.kind]} · {taskActionLabel(item)}</span>
				<h3 className="cn-detailhead__title">{item.title}</h3>
				<p className="cn-detailhead__sub">{item.subtitle}</p>
				{/* `meta` is prose or a reference, never shouted; the mono line below is for facts. */}
				{!item.details && item.meta && <p className="cn-detailhead__sub">{item.meta}</p>}
				<p className="cn-detailhead__meta">
					{item.branch ? `${item.branch} · ` : ""}Assigned: {item.owner}
				</p>
			</div>

			{item.details && (
				<ul className="cn-detail__list">
					{item.details.map((d) => (
						<li key={d}>{d}</li>
					))}
				</ul>
			)}

			<div className="cn-detail__facts">
				{item.kind === "consultation" && <ConsultationDetails c={item.record} />}
				{item.kind === "application" && <ApplicationDetails a={item.record} />}
				{item.kind === "visa" && <VisaDetails a={item.record} />}
				{item.kind === "handoff" && <HandoffDetails h={item.record} />}
				{item.kind === "applicant" && <ApplicantDetails app={item.record} />}
				{item.kind === "invoice" && <InvoiceDetails inv={item.record} />}
				{item.kind === "lead" && <LeadDetails lead={item.record} />}
			</div>

			{item.kind === "handoff" && canAssignWork && (
				<div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border-light)" }}>
					<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
						This stage needs an owner before it can start.
					</p>
					<AssignControl
						stage={item.record.stage}
						staff={assignees}
						branch={item.branch}
						keepName={handoffOffersKeep(item.record) ? item.record.fromOpsUserName : null}
						withReason
						onAssign={assignTo}
						onKeep={keepHandler}
					/>
					<div style={{ marginTop: "0.6rem" }}>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => void defer()} disabled={deferring}>
							{deferring ? "Deferring…" : "Assign later"}
						</button>
						{deferError && <p className="ops-modal__error" style={{ marginTop: "0.5rem" }}>{deferError}</p>}
					</div>
				</div>
			)}

			{item.action === "assign" && canAssignWork && (
				<div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border-light)" }}>
					<AssignControl
						stage={stageForRoles}
						staff={assignees}
						branch={item.branch}
						currentName={item.owner && item.owner !== "Unassigned" ? item.owner : null}
						onAssign={assignTo}
					/>
				</div>
			)}
		</div>
	);
}

function ConsultationDetails({ c }: { c: MockConsultation }) {
	return (
		<div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
			<p style={{ margin: 0 }}><strong>Status:</strong> {c.status}</p>
			<p style={{ margin: 0 }}><strong>Type:</strong> {c.type}</p>
			<p style={{ margin: 0 }}><strong>When:</strong> {c.dateTime}</p>
			<p style={{ margin: 0 }}><strong>Target country:</strong> {c.targetCountry || "—"}</p>
			<p style={{ margin: 0 }}><strong>Assigned:</strong> {c.assignedOfficer || "Unassigned"}</p>
			{c.meetingLink && (
				<p style={{ margin: 0 }}>
					<strong>Meeting:</strong>{" "}
					<a href={c.meetingLink} target="_blank" rel="noreferrer" className="link" style={{ wordBreak: "break-all" }}>
						{c.meetingLink}
					</a>
				</p>
			)}
		</div>
	);
}

function ApplicationDetails({ a }: { a: MockApplication }) {
	const open = a.checklist.filter((i) => !i.checked).length;
	return (
		<div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
			<p style={{ margin: 0 }}><strong>Application:</strong> {a.appId}</p>
			<p style={{ margin: 0 }}><strong>Status:</strong> {a.status}</p>
			<p style={{ margin: 0 }}><strong>Stage:</strong> {JOURNEY_STAGE_LABELS[a.stage as JourneyStage] || a.stage}</p>
			<p style={{ margin: 0 }}><strong>University:</strong> {a.university || "—"}</p>
			<p style={{ margin: 0 }}><strong>Assigned:</strong> {a.assignedStaff || "Unassigned"}</p>
			<p style={{ margin: 0 }}><strong>Application tasks open:</strong> {open}</p>
		</div>
	);
}

function VisaDetails({ a }: { a: MockApplication }) {
	const step = a.visaStage ? (VISA_STEP_LABELS[a.visaStage] ?? a.visaStage) : "Awaiting payment";
	return (
		<div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
			<p style={{ margin: 0 }}><strong>Application:</strong> {a.appId}</p>
			<p style={{ margin: 0 }}><strong>Visa stage:</strong> {step}</p>
			<p style={{ margin: 0 }}><strong>University:</strong> {a.university || "—"}</p>
			<p style={{ margin: 0 }}><strong>Invoice paid:</strong> {a.visaInvoicePaid ? "Yes" : "No"}</p>
			<p style={{ margin: 0 }}><strong>Assigned:</strong> {a.assignedStaff || "Unassigned"}</p>
		</div>
	);
}

function HandoffDetails({ h }: { h: StageHandoff }) {
	return (
		<div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
			<p style={{ margin: 0 }}><strong>Application:</strong> {h.applicationNumber ?? h.applicationId}</p>
			<p style={{ margin: 0 }}><strong>Stage:</strong> {h.stage === "visa_processing" ? "Visa processing" : h.stage}</p>
			<p style={{ margin: 0 }}><strong>Source:</strong> {h.source === "visa_payment" ? "Visa payment received" : h.source === "migration" ? "Existing case setup" : "Stage transition"}</p>
			<p style={{ margin: 0 }}><strong>Previous handler:</strong> {h.fromOpsUserName ?? "None"}</p>
			{h.deferCount > 0 && (
				<p style={{ margin: 0 }}>
					<strong>Deferred:</strong> {h.deferCount}×{h.deferredAt ? ` · last ${timeAgo(h.deferredAt)}` : ""}
				</p>
			)}
			{h.reason && (
				<p style={{ margin: 0 }}>
					<strong>Reason:</strong> {h.reason}
				</p>
			)}
		</div>
	);
}

function ApplicantDetails({ app }: { app: MockApplicant }) {
	const pendingDocs = app.documents.filter((d) => d.status === "Pending Review").length;
	const outstanding = money(app.financials.outstanding);
	return (
		<div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
			<p style={{ margin: 0 }}><strong>Applicant ID:</strong> {app.applicantId}</p>
			<p style={{ margin: 0 }}><strong>Stage:</strong> {app.currentStage}</p>
			<p style={{ margin: 0 }}><strong>Pending documents:</strong> {pendingDocs}</p>
			<p style={{ margin: 0 }}><strong>Outstanding:</strong> {fmtGhs(outstanding)} · {fmtUsd(outstanding)}</p>
			<p style={{ margin: 0 }}><strong>Plan:</strong> {app.financials.plan || "—"}</p>
			<p style={{ margin: 0 }}><strong>Assigned:</strong> {app.assignedOfficer || "—"}</p>
		</div>
	);
}

function InvoiceDetails({ inv }: { inv: Invoice }) {
	const balance = invoiceBalance(inv);
	const age = invoiceAgeDays(inv);
	return (
		<div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
			<p style={{ margin: 0 }}><strong>Invoice:</strong> {inv.invoiceNumber}</p>
			<p style={{ margin: 0 }}><strong>Type:</strong> {inv.type}</p>
			<p style={{ margin: 0 }}><strong>Total:</strong> {fmtGhs(inv.subtotal)}</p>
			<p style={{ margin: 0 }}><strong>Balance:</strong> {fmtGhs(balance)}</p>
			<p style={{ margin: 0 }}><strong>Status:</strong> {inv.status}</p>
			{age !== null && <p style={{ margin: 0 }}><strong>Age:</strong> {age} day{age === 1 ? "" : "s"}</p>}
		</div>
	);
}

function LeadDetails({ lead }: { lead: Lead }) {
	return (
		<div style={{ fontSize: "var(--text-sm)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
			<p style={{ margin: 0 }}><strong>Email:</strong> {lead.email}</p>
			<p style={{ margin: 0 }}><strong>Phone:</strong> {lead.phone || "—"}</p>
			<p style={{ margin: 0 }}><strong>Stage:</strong> {LEAD_STAGE_LABELS[lead.stage as LeadStage] ?? lead.stage}</p>
			<p style={{ margin: 0 }}><strong>Source:</strong> {lead.source || "—"}</p>
			<p style={{ margin: 0 }}><strong>Assigned:</strong> {lead.assignedTo || "Unassigned"}</p>
			<p style={{ margin: 0 }}><strong>Last contact:</strong> {timeAgo(lead.lastContactAt)}</p>
			{lead.notes && <p style={{ margin: 0, fontStyle: "italic" }}>{lead.notes}</p>}
		</div>
	);
}
