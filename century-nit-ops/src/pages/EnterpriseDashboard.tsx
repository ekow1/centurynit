import { useMemo, useState, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useWorkQueue } from "../hooks/useWorkQueue";
import { passesQueueFilter, rememberedQueueCut } from "../lib/queueCut";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { LEAD_STAGE_LABELS } from "century-nit-core";
import type { MockApplicant, MockApplication, MockConsultation } from "century-nit-core/ops";
import { OPS_BRANCHES } from "century-nit-core/ops";
import { API_PREFIX, JOURNEY_STAGES, type Booking, type JourneyStage } from "century-nit-shared";
import { fmtFin, fmtGhs, fmtUsd, money } from "./currency";
import { apiFetch } from "../lib/api";
import { isDueToday, isOverdue, taskActionLabel, TASK_KIND_LABEL, priorityNotches, whenLabel, type PendingTask } from "../lib/pendingTasks";
import { StageStrip } from "./WorkspaceCaseload";

/**
 * The Dashboard is the numbers; the work is in the Workspace. Every figure
 * is derived from the API, so drilling into a module always matches the
 * number that sent you there. Manager and finance see every branch
 * (optionally filtered); coordinator and consultant are auto-scoped to
 * their branch / assignments — no filter shown.
 *
 * Shared by every role: the day line (due today · overdue · unassigned ·
 * live) pointing at the Worklist, and "the queue today" — the top of the
 * same queue, five rows, never the whole table again.
 */

const STALLED_AFTER_DAYS = 7;
const STAGE_SHORT: Record<JourneyStage, string> = {
	document_verification: "Docs",
	school_submission: "School",
	offer_letter_review: "Offer",
	visa_processing: "Visa",
	travel_assistance: "Travel",
	payment_execution: "Payment",
	completed: "Done",
};
const FLIGHT_STAGES = JOURNEY_STAGES.filter((s) => s !== "completed");

const hm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Monday 00:00 of the current week, as a Date and as YYYY-MM-DD. */
function weekStart(now = new Date()) {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return { date: d, iso: d.toISOString().slice(0, 10) };
}

export function EnterpriseDashboard() {
	const { opsRole, opsUser, canSeeAllBranches, scopeRecords, roleLabel } = useOpsAuth();
	const { consultations, applications, applicants } = useCases();
	const [branchFilter, setBranchFilter] = useState("all");
	const [leads, setLeads] = useState<{ id: string; stage: string }[] | null>(null);
	const queue = useWorkQueue(branchFilter);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await apiFetch<{ leads: { id: string; stage: string }[] }>(`${API_PREFIX}/leads`);
				if (!cancelled) setLeads(res.leads);
			} catch {
				/* non-fatal — the pipeline just shows 0 */
				if (!cancelled) setLeads([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const roleName = opsRole ? roleLabel(opsRole) : "Staff";

	const scoped = useMemo(() => {
		const scopedConsultations = scopeRecords(consultations, (c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name);
		const scopedApplications = scopeRecords(applications, (a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name);
		const scopedApplicants = scopeRecords(applicants, (a) => a.assignedOfficerEmail === opsUser?.email || a.assignedOfficer === opsUser?.name);
		const inBranch = <T extends { branch: string }>(list: T[]) => (branchFilter === "all" ? list : list.filter((x) => x.branch === branchFilter));
		return {
			consultations: inBranch(scopedConsultations),
			applications: inBranch(scopedApplications),
			applicants: inBranch(scopedApplicants),
		};
	}, [scopeRecords, consultations, applications, applicants, opsUser, branchFilter]);

	const stats = useMemo<Stats>(() => {
		const now = new Date();
		const week = weekStart(now);
		const pendingDocs = scoped.applicants.reduce((n, a) => n + a.documents.filter((d) => d.status === "Pending Review").length, 0);
		const openChecklistItems = scoped.applications.reduce((n, a) => n + a.checklist.filter((c) => !c.checked).length, 0);
		const outstanding = scoped.applicants.reduce((n, a) => n + money(a.financials.outstanding), 0);
		const collected = scoped.applicants.reduce((n, a) => n + money(a.financials.paidAmount), 0);
		const inFlight = scoped.applications.filter((a) => a.stage !== "completed");
		const stalledCases = inFlight.filter((a) => {
			const at = new Date(a.updatedAt ?? a.submittedDate).getTime();
			return !Number.isNaN(at) && now.getTime() - at >= STALLED_AFTER_DAYS * 86_400_000;
		}).length;
		const stageCounts = FLIGHT_STAGES.map((s) => inFlight.filter((a) => a.stage === s).length);
		return {
			consultations: scoped.consultations.length,
			consultationsThisWeek: scoped.consultations.filter((c) => c.slotDate && c.slotDate >= week.iso).length,
			underReview: scoped.consultations.filter((c) => c.status === "Under Review").length,
			inAssessment: scoped.consultations.filter((c) => c.status === "In Assessment").length,
			applications: scoped.applications.length,
			inFlight: inFlight.length,
			casesThisWeek: scoped.applications.filter((a) => a.submittedDate >= week.iso).length,
			stalledCases,
			stageCounts,
			appsUnderReview: scoped.applications.filter((a) => a.status === "Under Review").length,
			accepted: scoped.applications.filter((a) => a.status === "Accepted").length,
			applicants: scoped.applicants.length,
			activeApplicants: scoped.applicants.filter((a) => a.status === "Active").length,
			leads: leads ? leads.length : 0,
			newLeads: leads ? leads.filter((l) => l.stage === "new").length : 0,
			contactedLeads: leads ? leads.filter((l) => l.stage === "contacted").length : 0,
			assessmentCompleteLeads: leads ? leads.filter((l) => l.stage === "assessment_complete").length : 0,
			unassignedConsultations: scoped.consultations.filter((c) => !c.assignedOfficer).length,
			unassignedApplications: scoped.applications.filter((a) => !a.assignedStaff).length,
			pendingDocs,
			openChecklistItems,
			outstanding,
			collected,
			overdueInvoices: queue.invoiceRows.filter((r) => r.status === "overdue").length,
			invoicesToApprove: queue.items.filter((t) => t.action === "issue").length,
		};
	}, [scoped, leads, queue.invoiceRows, queue.items]);

	const day = useMemo(() => {
		const now = new Date();
		return {
			dueToday: queue.items.filter((t) => isDueToday(t, now) && !isOverdue(t, now)).length,
			overdue: queue.items.filter((t) => isOverdue(t, now)).length,
			unassigned: queue.items.filter((t) => t.category === "needs_assignment").length,
			live: queue.items.filter((t) => t.isLive).length,
		};
	}, [queue.items]);

	const pipeline = useMemo(
		() => [
			{ label: LEAD_STAGE_LABELS.new, value: stats.newLeads, to: "/crm" },
			{ label: LEAD_STAGE_LABELS.contacted, value: stats.contactedLeads, to: "/crm" },
			{ label: "Assessed", value: stats.assessmentCompleteLeads, to: "/crm" },
			{ label: "Consultations", value: stats.consultations, to: "/consultations" },
			{ label: "Applications", value: stats.applications, to: "/applications" },
			{ label: "Applicants", value: stats.applicants, to: "/applicants" },
		],
		[stats],
	);

	const view = { stats, pipeline, queue: queue.items, liveBookings: queue.liveBookings, scoped, branch: branchFilter };

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
				<div>
					<h1 className="page-title">Dashboard</h1>
					<p className="lead mt-2">
						{opsUser ? `Welcome back, ${opsUser.name.split(" ")[0]}.` : "Operations overview."} The numbers — the work is in the Workspace.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<span className="portal-pill">{roleName}</span>
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			<DayLine day={day} />

			{opsRole === "coordinator" ? (
				<CoordinatorView {...view} />
			) : opsRole === "consultant" ? (
				<ConsultantView {...view} />
			) : opsRole === "finance" ? (
				<FinanceView {...view} />
			) : (
				/* super_admin, admin, manager, or unassigned staff default to the full overview */
				<ManagerView {...view} />
			)}
		</div>
	);
}

type Stats = {
	consultations: number;
	consultationsThisWeek: number;
	underReview: number;
	inAssessment: number;
	applications: number;
	inFlight: number;
	casesThisWeek: number;
	stalledCases: number;
	stageCounts: number[];
	appsUnderReview: number;
	accepted: number;
	applicants: number;
	activeApplicants: number;
	leads: number;
	newLeads: number;
	contactedLeads: number;
	assessmentCompleteLeads: number;
	unassignedConsultations: number;
	unassignedApplications: number;
	pendingDocs: number;
	openChecklistItems: number;
	outstanding: number;
	collected: number;
	overdueInvoices: number;
	invoicesToApprove: number;
};

type ViewProps = {
	stats: Stats;
	pipeline: { label: string; value: number; to?: string }[];
	queue: PendingTask[];
	liveBookings: Booking[];
	scoped: { consultations: MockConsultation[]; applications: MockApplication[]; applicants: MockApplicant[] };
	branch: string;
};

/* ─── The day line: the Worklist's bands, in one line ─── */

function DayLine({ day }: { day: { dueToday: number; overdue: number; unassigned: number; live: number } }) {
	const today = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
	const cut = (n: number, label: string, filter: string) => (
		<Link to={`/workspace${filter ? `?filter=${filter}` : ""}`} className={`dash-day__cut${n > 0 ? "" : " dash-day__cut--zero"}`}>
			<strong>{n}</strong> {label}
		</Link>
	);
	return (
		<div className="dash-day">
			<span className="dash-day__date">{today}</span>
			<span className="dash-day__sep" aria-hidden>
				|
			</span>
			{cut(day.dueToday, "due today", "today")}
			{cut(day.overdue, "overdue", "overdue")}
			{cut(day.unassigned, "unassigned", "needs_assignment")}
			{cut(day.live, "live now", "today")}
			<span className="dash-day__sep" aria-hidden>
				|
			</span>
			<Link to="/workspace" className="dash-link">
				Open the Worklist →
			</Link>
		</div>
	);
}

/* ─── Manager — the full overview ─── */

function ManagerView({ stats, pipeline, queue, liveBookings, scoped }: ViewProps) {
	return (
		<>
			<div className="dash-kpis">
				<Kpi
					label="Awaiting assignment"
					value={String(stats.unassignedConsultations + stats.unassignedApplications)}
					note={`${stats.unassignedConsultations} consultation${stats.unassignedConsultations === 1 ? "" : "s"} · ${stats.unassignedApplications} case${stats.unassignedApplications === 1 ? "" : "s"}`}
					inverted
					to="/workspace?filter=needs_assignment"
				/>
				<Kpi
					label="Consultations"
					value={String(stats.consultations)}
					delta={`${stats.consultationsThisWeek} this week`}
					note={`${stats.underReview} under review · ${stats.inAssessment} in assessment`}
					to="/consultations"
				/>
				<CasesKpi stats={stats} />
				<Kpi
					label="Collected"
					value={fmtGhs(stats.collected)}
					delta={fmtUsd(stats.collected)}
					note={`${fmtGhs(stats.outstanding)} outstanding${stats.overdueInvoices > 0 ? ` · ${stats.overdueInvoices} invoice${stats.overdueInvoices === 1 ? "" : "s"} overdue` : ""}`}
					to="/finance"
				/>
			</div>

			<div className="dash-grid">
				<div className="dash-col">
					<QueuePanel items={queue} />
					<Pipeline steps={pipeline} leads={stats.leads} applicants={stats.applicants} />
					<Balances applicants={scoped.applicants} />
				</div>
				<div className="dash-col">
					<NowPanel liveBookings={liveBookings} items={queue} />
					<Panel title="Needs attention">
						<ARow label="Invoices to approve" n={stats.invoicesToApprove} to="/workspace?filter=needs_invoice" />
						<ARow label="Documents pending review" n={stats.pendingDocs} to="/documents" />
						<ARow label="Consultations to assess" n={stats.inAssessment} to="/consultations" />
						<ARow label="Open checklist items" n={stats.openChecklistItems} to="/workspace?filter=needs_action" />
						<ARow label={`Cases stalled ${STALLED_AFTER_DAYS}+ days`} n={stats.stalledCases} to="/workspace?tab=caseload" />
					</Panel>
					<TeamLoad applications={scoped.applications} consultations={scoped.consultations} />
				</div>
			</div>
		</>
	);
}

/* ─── Coordinator — assignments and workflow ─── */

function CoordinatorView({ stats, pipeline, queue, liveBookings }: ViewProps) {
	return (
		<>
			<div className="dash-kpis">
				<Kpi label="In the queue" value={String(queue.length)} note={`${stats.unassignedConsultations + stats.unassignedApplications} to assign · ${stats.pendingDocs} documents`} inverted to="/workspace" />
				<Kpi label="Consultations" value={String(stats.consultations)} delta={`${stats.consultationsThisWeek} this week`} note={`${stats.underReview} under review · ${stats.inAssessment} in assessment`} to="/consultations" />
				<CasesKpi stats={stats} />
				<Kpi label="Pending documents" value={String(stats.pendingDocs)} note="Awaiting verification" to="/documents" />
			</div>
			<div className="dash-grid">
				<div className="dash-col">
					<QueuePanel items={queue} />
					<Pipeline steps={pipeline} leads={stats.leads} applicants={stats.applicants} />
				</div>
				<div className="dash-col">
					<NowPanel liveBookings={liveBookings} items={queue} />
					<Panel title="Workflow">
						<ARow label="Consultations to assign" n={stats.unassignedConsultations} to="/workspace?filter=needs_assignment" />
						<ARow label="Cases to assign" n={stats.unassignedApplications} to="/workspace?filter=needs_assignment" />
						<ARow label="Documents pending review" n={stats.pendingDocs} to="/documents" />
						<ARow label="Open checklist items" n={stats.openChecklistItems} to="/workspace?filter=needs_action" />
						<ARow label={`Cases stalled ${STALLED_AFTER_DAYS}+ days`} n={stats.stalledCases} to="/workspace?tab=caseload" />
					</Panel>
				</div>
			</div>
		</>
	);
}

/* ─── Consultant — their own load ─── */

function ConsultantView({ stats, queue, liveBookings, scoped }: ViewProps) {
	const toAssess = scoped.consultations.filter((c) => c.status !== "Completed" && c.status !== "Cancelled");
	return (
		<>
			<div className="dash-kpis dash-kpis--three">
				<Kpi label="My consultations" value={String(stats.consultations)} delta={`${stats.consultationsThisWeek} this week`} note={`${toAssess.length} awaiting assessment`} inverted to="/consultations" />
				<CasesKpi stats={stats} label="My cases" />
				<Kpi label="My applicants" value={String(stats.activeApplicants)} note={`${stats.applicants} in directory`} to="/applicants" />
			</div>
			<div className="dash-grid">
				<div className="dash-col">
					<QueuePanel items={queue} />
					<Panel title="Awaiting my assessment" link={{ to: "/consultations", label: "Consultations →" }}>
						{toAssess.length === 0 ? (
							<p className="dash-empty">Nothing waiting on you.</p>
						) : (
							toAssess.slice(0, 6).map((c) => (
								<Link key={c.id} to={`/consultations?id=${c.id}`} className="dash-row">
									<span className="dash-row__who">{c.applicantName}</span>
									<span className="dash-row__what">
										{c.status}
										{c.targetCountry ? ` · ${c.targetCountry}` : ""}
									</span>
									<span className="dash-row__when">{c.dateTime}</span>
								</Link>
							))
						)}
					</Panel>
				</div>
				<div className="dash-col">
					<NowPanel liveBookings={liveBookings} items={queue} />
					<Panel title="My cases" link={{ to: "/workspace?tab=caseload", label: "Caseload →" }}>
						{scoped.applications.length === 0 ? (
							<p className="dash-empty">No cases assigned to you.</p>
						) : (
							scoped.applications.slice(0, 6).map((a) => (
								<Link key={a.id} to={`/applications?id=${a.id}`} className="dash-row">
									<span className="dash-row__who">{a.applicantName}</span>
									<span className="dash-row__what">{STAGE_SHORT[a.stage as JourneyStage] ?? a.stage}</span>
									<span className="dash-row__when">{a.university || "—"}</span>
								</Link>
							))
						)}
					</Panel>
				</div>
			</div>
		</>
	);
}

/* ─── Finance — the money ─── */

function FinanceView({ stats, scoped }: ViewProps) {
	const applicants = scoped.applicants;
	const settled = applicants.filter((a) => money(a.financials.outstanding) === 0).length;
	return (
		<>
			<div className="dash-kpis">
				<Kpi label="Total outstanding" value={fmtGhs(stats.outstanding)} delta={fmtUsd(stats.outstanding)} note={`${stats.applicants - settled} account${stats.applicants - settled === 1 ? "" : "s"} with a balance${stats.overdueInvoices > 0 ? ` · ${stats.overdueInvoices} invoice${stats.overdueInvoices === 1 ? "" : "s"} overdue` : ""}`} inverted to="/finance" />
				<Kpi label="Collected" value={fmtGhs(stats.collected)} delta={fmtUsd(stats.collected)} note="Across all applicants" to="/finance" />
				<Kpi label="Settled accounts" value={String(settled)} note={`of ${stats.applicants}`} to="/finance" />
				<Kpi label="Invoices to approve" value={String(stats.invoicesToApprove)} note="Proformas raised by consultants" to="/workspace?filter=needs_invoice" />
			</div>
			<Panel title="Applicant balances" link={{ to: "/ledger", label: "Client ledger →" }}>
				{applicants.length === 0 ? (
					<p className="dash-empty">No applicant accounts yet.</p>
				) : (
					<div className="ops-table-wrap">
						<table className="ops-table">
							<thead>
								<tr>
									<th>Applicant ID</th>
									<th>Name</th>
									<th>Total</th>
									<th>Paid</th>
									<th>Outstanding</th>
									<th>Plan</th>
								</tr>
							</thead>
							<tbody>
								{applicants.map((a) => (
									<tr key={a.id}>
										<td className="mono">{a.applicantId}</td>
										<td>
											<Link to="/applicants" style={{ textDecoration: "underline" }}>
												{a.name}
											</Link>
										</td>
										<td>{fmtFin(a.financials.totalAmount)}</td>
										<td>{fmtFin(a.financials.paidAmount)}</td>
										<td>
											<strong>{fmtFin(a.financials.outstanding)}</strong>
										</td>
										<td className="muted">{a.financials.plan}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>
		</>
	);
}

/* ─── Pieces ─── */

function Kpi({
	label,
	value,
	delta,
	note,
	inverted,
	to,
	children,
}: {
	label: string;
	value: string;
	delta?: string;
	note: string;
	inverted?: boolean;
	to?: string;
	children?: ReactNode;
}) {
	const body = (
		<>
			<span className="dash-kpi__label">{label}</span>
			<span className="dash-kpi__value">{value}</span>
			{delta && <span className="dash-kpi__delta">{delta}</span>}
			{children}
			<span className="dash-kpi__note">{note}</span>
		</>
	);
	const cls = `dash-kpi${inverted ? " dash-kpi--on" : ""}`;
	return to ? (
		<Link to={to} className={cls} aria-label={`Open ${label}`}>
			{body}
		</Link>
	) : (
		<div className={cls}>{body}</div>
	);
}

/** Cases in flight, with the stage strip and its legend. */
function CasesKpi({ stats, label = "Cases in flight" }: { stats: Stats; label?: string }) {
	const legend = FLIGHT_STAGES.map((s, i) => (stats.stageCounts[i] > 0 ? `${STAGE_SHORT[s]} ${stats.stageCounts[i]}` : null)).filter(Boolean);
	return (
		<Kpi
			label={label}
			value={String(stats.inFlight)}
			delta={`${stats.casesThisWeek} this week${stats.stalledCases > 0 ? ` · ${stats.stalledCases} stalled` : ""}`}
			note={legend.length > 0 ? legend.join(" · ") : `${stats.applications - stats.inFlight} completed`}
			to="/applications?view=board"
		>
			<StageStrip counts={stats.stageCounts} />
		</Kpi>
	);
}

function Panel({ title, link, live, children }: { title: ReactNode; link?: { to: string; label: string }; live?: boolean; children: ReactNode }) {
	return (
		<section className={`dash-panel${live ? " dash-panel--live" : ""}`}>
			<header className="dash-panel__head">
				<h2 className="dash-panel__title">{title}</h2>
				{link && (
					<Link to={link.to} className="dash-link">
						{link.label}
					</Link>
				)}
			</header>
			{children}
		</section>
	);
}

/** The top of the queue: what is due or late first, then the rest by priority. */
function QueuePanel({ items }: { items: PendingTask[] }) {
	const { opsUser } = useOpsAuth();
	const now = new Date();
	// The Worklist's last cut, so this is the top of the same list.
	const cut = rememberedQueueCut();
	const inCut = items.filter((t) => passesQueueFilter(t, cut.filter, opsUser ?? undefined) && (cut.type === "all" || t.kind === cut.type));
	const urgent = inCut.filter((t) => isDueToday(t, now) || isOverdue(t, now));
	const rest = inCut.filter((t) => !urgent.includes(t));
	const top = [...urgent, ...rest].slice(0, 5);
	const cutLabel = cut.filter === "all" && cut.type === "all" ? "" : ` · ${cut.filter === "mine" ? "mine" : cut.filter.replace("needs_", "")}${cut.type !== "all" ? ` · ${cut.type}` : ""}`;
	return (
		<Panel title={`The queue today${cutLabel}`} link={{ to: `/workspace?filter=${cut.filter}${cut.type !== "all" ? `&type=${cut.type}` : ""}`, label: `All ${inCut.length} →` }}>
			{top.length === 0 ? (
				<p className="dash-empty">Nothing on the desk. All caught up.</p>
			) : (
				top.map((t) => {
					const late = isOverdue(t, now);
					const n = priorityNotches(t.priority);
					const when = t.due && isDueToday(t, now) ? hm(t.due) : t.due ? whenLabel(t.due).split(",")[0] : whenLabel(t.at).split(",")[0];
					return (
						<Link key={t.id} to="/workspace" className="dash-row">
							<span className="ops-meter" aria-hidden>
								<span>{"●".repeat(n)}</span>
								<span className="ops-meter__off">{"●".repeat(3 - n)}</span>
							</span>
							<span className="dash-row__who">{t.title}</span>
							<span className="dash-row__what">
								{taskActionLabel(t)} · {TASK_KIND_LABEL[t.kind]}
								{t.isLive ? " · live" : late ? " · overdue" : ""}
							</span>
							<span className="dash-row__when">{when}</span>
						</Link>
					);
				})
			)}
		</Panel>
	);
}

/** What is happening now: live meetings, else the next slot today. */
function NowPanel({ liveBookings, items }: { liveBookings: Booking[]; items: PendingTask[] }) {
	const now = new Date();
	const next = items
		.filter((t) => t.kind === "consultation" && t.due && !t.isLive && isDueToday(t, now) && new Date(t.due).getTime() >= now.getTime() - 15 * 60_000)
		.sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime())
		.slice(0, liveBookings.length > 0 ? 2 : 3);
	const live = liveBookings.length > 0;
	return (
		<Panel
			title={
				<>
					<span className={`cn-now__dot${live ? "" : " cn-now__dot--hollow"}`} aria-hidden style={{ marginRight: "0.45em" }} />
					Now
				</>
			}
			link={{ to: "/live-meetings", label: "Live meetings →" }}
			live={live}
		>
			{liveBookings.map((b) => {
				const mins = Math.max(0, Math.round((now.getTime() - new Date(b.startsAt).getTime()) / 60_000));
				return (
					<Link key={b.id} to="/live-meetings" className="dash-row">
						<span className="dash-row__who">{b.clientName}</span>
						<span className="dash-row__what">
							{b.employeeName ?? "unassigned"} · {mins} min in{b.meetingParticipants > 0 ? ` · ${b.meetingParticipants} in the room` : ""}
						</span>
					</Link>
				);
			})}
			{next.map((t) => (
				<Link key={t.id} to={t.linkTo} className="dash-row">
					<span className="dash-row__who">{t.title}</span>
					<span className="dash-row__what">next · {t.owner}</span>
					<span className="dash-row__when">{hm(t.due!)}</span>
				</Link>
			))}
			{!live && next.length === 0 && <p className="dash-empty">Nothing live, and no consultations left today.</p>}
		</Panel>
	);
}

function Pipeline({ steps, leads, applicants }: { steps: { label: string; value: number; to?: string }[]; leads: number; applicants: number }) {
	const max = Math.max(1, ...steps.map((s) => s.value));
	const rate = leads > 0 ? Math.round((applicants / leads) * 100) : null;
	return (
		<Panel title="Pipeline" link={{ to: "/crm", label: rate === null ? "Leads →" : `${leads} leads → ${applicants} applicants · ${rate}% converted` }}>
			<div className="dash-pipe">
				{steps.map((s) => (
					<Link key={s.label} to={s.to ?? "/crm"} className="dash-pipe__step" aria-label={`Open ${s.label}`}>
						<span className="dash-pipe__n">{s.value}</span>
						<span className="dash-pipe__l">{s.label}</span>
						<span className="dash-pipe__bar">
							<span style={{ width: `${Math.round((s.value / max) * 100)}%` }} />
						</span>
					</Link>
				))}
			</div>
		</Panel>
	);
}

function ARow({ label, n, to, note }: { label: string; n: number; to: string; note?: string }) {
	return (
		<Link to={to} className="dash-arow">
			<span>
				{label}
				{note && <span className="cn-detail__row-note"> {note}</span>}
			</span>
			<span className={`dash-arow__n${n === 0 ? " dash-arow__n--zero" : ""}`}>{n}</span>
		</Link>
	);
}

function Balances({ applicants }: { applicants: ViewProps["scoped"]["applicants"] }) {
	const owing = applicants
		.map((a) => ({ a, due: money(a.financials.outstanding) }))
		.filter((x) => x.due > 0)
		.sort((x, y) => y.due - x.due)
		.slice(0, 5);
	return (
		<Panel title="Balances" link={{ to: "/ledger", label: "Client ledger →" }}>
			{owing.length === 0 ? (
				<p className="dash-empty">No outstanding balances.</p>
			) : (
				owing.map(({ a, due }) => <ARowMoney key={a.id} label={a.name} amount={fmtGhs(due)} note={`${a.applicantId} · ${a.financials.plan}`} to="/applicants" />)
			)}
		</Panel>
	);
}

function ARowMoney({ label, amount, note, to }: { label: string; amount: string; note: string; to: string }) {
	return (
		<Link to={to} className="dash-arow">
			<span>
				{label}
				<span className="cn-detail__row-note"> {note}</span>
			</span>
			<span className="dash-arow__n">{amount}</span>
		</Link>
	);
}

/** Open load per officer, with what has stalled — the Caseload in four lines. */
function TeamLoad({ applications, consultations }: { applications: ViewProps["scoped"]["applications"]; consultations: ViewProps["scoped"]["consultations"] }) {
	const { canSeeAllBranches, canAssignWork, opsUser } = useOpsAuth();
	const { getDuty } = useCases();
	// Duty is reported, not set, here — the page's contract is numbers-only.
	// An uncovered branch underlines and links to the Workspace, where the
	// Coverage card is the control.
	const dutyBranches = canSeeAllBranches ? OPS_BRANCHES : OPS_BRANCHES.filter((b) => b.id === opsUser?.branch);
	const [duty, setDuty] = useState<Record<string, string | null>>({});
	useEffect(() => {
		if (!canAssignWork) return;
		let on = true;
		void Promise.all(dutyBranches.map((b) => getDuty(b.id).catch(() => null))).then((rows) => {
			if (!on) return;
			const next: Record<string, string | null> = {};
			rows.forEach((d, i) => { next[dutyBranches[i].id] = d?.coordinator?.name ?? null; });
			setDuty(next);
		});
		return () => { on = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps -- dutyBranches is derived from auth scope
	}, [canAssignWork, canSeeAllBranches, opsUser]);

	const now = new Date().getTime();
	const map = new Map<string, { open: number; stalled: number }>();
	const bump = (name: string | undefined, updatedAt: string | undefined, done: boolean) => {
		if (!name || done) return;
		const o = map.get(name) ?? { open: 0, stalled: 0 };
		o.open++;
		const at = updatedAt ? new Date(updatedAt).getTime() : NaN;
		if (!Number.isNaN(at) && now - at >= STALLED_AFTER_DAYS * 86_400_000) o.stalled++;
		map.set(name, o);
	};
	for (const a of applications) bump(a.assignedStaff || undefined, a.updatedAt ?? a.submittedDate, a.stage === "completed");
	for (const c of consultations) bump(c.assignedOfficer || undefined, c.updatedAt, c.status === "Completed" || c.status === "Cancelled");
	const rows = [...map.entries()].sort((x, y) => y[1].open - x[1].open).slice(0, 6);
	const max = Math.max(1, ...rows.map(([, r]) => r.open));
	return (
		<Panel title="Team load" link={{ to: "/workspace?tab=caseload", label: "Caseload →" }}>
			{canAssignWork && dutyBranches.length > 0 && (
				<div className="dash-duty">
					<span className="cn-filter__label">Duty · today</span>
					{/* Each branch is its own inline unit — the row wraps between
					    branches, never mid-name, and can't blow the rail open. */}
					<span className="dash-duty__branches">
						{dutyBranches.map((b) => (
							<span key={b.id} className="dash-duty__branch">
								{b.name}:{" "}
								{duty[b.id] ? (
									duty[b.id]
								) : (
									<Link to="/workspace" style={{ textDecoration: "underline" }}>nobody →</Link>
								)}
							</span>
						))}
					</span>
				</div>
			)}
			{rows.length === 0 ? (
				<p className="dash-empty">No one is carrying anything yet.</p>
			) : (
				rows.map(([name, r]) => (
					<div key={name} className="dash-trow">
						<span>{name}</span>
						<span className="dash-trow__n">
							{r.open} open{r.stalled > 0 ? ` · ${r.stalled} stalled` : ""}
						</span>
						<span className="dash-trow__bar" aria-hidden>
							<span style={{ width: `${Math.round((r.open / max) * 100)}%` }} />
						</span>
					</div>
				))
			)}
		</Panel>
	);
}
