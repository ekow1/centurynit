import { useMemo, useState, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { LEAD_STAGE_LABELS } from "century-nit-core";
import { API_PREFIX } from "century-nit-shared";
import { fmtFin, fmtGhs, fmtUsd, money } from "./currency";
import { UnassignedBookings } from "./UnassignedBookings";
import { StaffChatBadge } from "./StaffChatBadge";
import { apiFetch } from "../lib/api";

/**
 * Every figure on this page is derived from the API, so drilling into a
 * module always matches the number that sent you there. Manager and finance
 * see every branch (optionally filtered); coordinator and consultant are
 * auto-scoped to their branch / assignments - no filter shown.
 */
export function EnterpriseDashboard() {
	const { opsRole, opsUser, hasPermission, canSeeAllBranches, scopeRecords } = useOpsAuth();
	const { consultations, applications, applicants, assignees } = useCases();
	const [branchFilter, setBranchFilter] = useState("all");
	const [leads, setLeads] = useState<{ id: string; stage: string }[]>([]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await apiFetch<{ leads: { id: string; stage: string }[] }>(`${API_PREFIX}/leads`);
				if (!cancelled) setLeads(res.leads);
			} catch {
				/* non-fatal — funnel just shows 0 */
			}
		})();
		return () => { cancelled = true; };
	}, []);

	const roleName = opsRole ? ROLE_LABELS[opsRole] : "Staff";

	const scoped = useMemo(() => {
		const scopedConsultations = scopeRecords(
			consultations,
			(c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
		);
		const scopedApplications = scopeRecords(
			applications,
			(a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name,
		);
		const scopedApplicants = scopeRecords(
			applicants,
			(a) => a.assignedOfficerEmail === opsUser?.email || a.assignedOfficer === opsUser?.name,
		);
		const inBranch = <T extends { branch: string }>(list: T[]) =>
			branchFilter === "all" ? list : list.filter((x) => x.branch === branchFilter);
		return {
			consultations: inBranch(scopedConsultations),
			applications: inBranch(scopedApplications),
			applicants: inBranch(scopedApplicants),
		};
	}, [scopeRecords, consultations, applications, applicants, opsUser, branchFilter]);

	const stats = useMemo(() => {
		const pendingDocs = scoped.applicants.reduce(
			(n, a) => n + a.documents.filter((d) => d.status === "Pending Review").length,
			0,
		);
		const openChecklistItems = scoped.applications.reduce(
			(n, a) => n + a.checklist.filter((c) => !c.checked).length,
			0,
		);
		const outstanding = scoped.applicants.reduce((n, a) => n + money(a.financials.outstanding), 0);
		const collected = scoped.applicants.reduce((n, a) => n + money(a.financials.paidAmount), 0);

		return {
			consultations: scoped.consultations.length,
			underReview: scoped.consultations.filter((c) => c.status === "Under Review").length,
			inAssessment: scoped.consultations.filter((c) => c.status === "In Assessment").length,
			completedConsults: scoped.consultations.filter((c) => c.status === "Completed").length,
			applications: scoped.applications.length,
			appsUnderReview: scoped.applications.filter((a) => a.status === "Under Review").length,
			accepted: scoped.applications.filter((a) => a.status === "Accepted").length,
			applicants: scoped.applicants.length,
			activeApplicants: scoped.applicants.filter((a) => a.status === "Active").length,
			leads: leads.length,
			convertedLeads: leads.filter((l) => l.stage === "converted").length,
			newLeads: leads.filter((l) => l.stage === "new").length,
			contactedLeads: leads.filter((l) => l.stage === "contacted").length,
			assessmentCompleteLeads: leads.filter((l) => l.stage === "assessment_complete").length,
			unassignedConsultations: scoped.consultations.filter((c) => !c.assignedOfficer).length,
			unassignedApplications: scoped.applications.filter((a) => !a.assignedStaff).length,
			pendingDocs,
			openChecklistItems,
			outstanding,
			collected,
		};
	}, [scoped, leads]);

	const funnel = useMemo(() => {
		return [
			{ label: LEAD_STAGE_LABELS.new, value: stats.newLeads, to: "/crm" },
			{ label: LEAD_STAGE_LABELS.contacted, value: stats.contactedLeads, to: "/crm" },
			{ label: LEAD_STAGE_LABELS.assessment_complete, value: stats.assessmentCompleteLeads, to: "/crm" },
			{ label: "Consultations", value: stats.consultations, to: "/consultations" },
			{ label: "Applications", value: stats.applications, to: "/applications" },
			{ label: "Applicants", value: stats.applicants, to: "/applicants" },
		];
	}, [stats]);

	const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem" }}>
				<div>
					<h1 className="page-title">Mission Control</h1>
					<p className="lead mt-2">
						{opsUser ? `Welcome back, ${opsUser.name.split(" ")[0]}.` : "Operations overview."} Here is
						what needs your attention.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<span className="portal-pill">{roleName}</span>
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			{/* Quick Actions - filtered by permission */}
			<div style={{ display: "flex", gap: "1rem", marginBottom: "2.5rem", flexWrap: "wrap" }}>
				{hasPermission("consultations") && (
					<Link to="/consultations" className="btn btn--primary btn--sm">Review Consultations</Link>
				)}
				{hasPermission("crm") && (
					<Link to="/crm" className="btn btn--ghost btn--sm">Lead Pipeline</Link>
				)}
				{hasPermission("workflow") && (
					<Link to="/workflow" className="btn btn--ghost btn--sm">Open Pipeline Board</Link>
				)}
				{hasPermission("finance") && (
					<Link to="/finance" className="btn btn--ghost btn--sm">Issue Invoice</Link>
				)}
				{hasPermission("packages") && (
					<Link to="/packages" className="btn btn--ghost btn--sm">Service Packages</Link>
				)}
			</div>

			{/* Role-specific dashboard view */}
			{opsRole === "coordinator" ? (
				<CoordinatorView stats={stats} funnel={funnel} funnelMax={funnelMax} />
			) : opsRole === "consultant" ? (
				<ConsultantView stats={stats} consultations={scoped.consultations} applications={scoped.applications} assignees={assignees} />
			) : opsRole === "finance" ? (
				<FinanceView stats={stats} applicants={scoped.applicants} />
			) : (
				/* super_admin, admin, manager, or unassigned staff default to full operational executive overview */
				<ManagerView stats={stats} funnel={funnel} funnelMax={funnelMax} applicants={scoped.applicants} />
			)}
		</div>
	);
}

type Stats = {
	consultations: number;
	underReview: number;
	inAssessment: number;
	completedConsults: number;
	applications: number;
	appsUnderReview: number;
	accepted: number;
	applicants: number;
	activeApplicants: number;
	leads: number;
	convertedLeads: number;
	newLeads: number;
	contactedLeads: number;
	assessmentCompleteLeads: number;
	unassignedConsultations: number;
	unassignedApplications: number;
	pendingDocs: number;
	openChecklistItems: number;
	outstanding: number;
	collected: number;
};

/* ─── Manager - full operational oversight ─── */

function ManagerView({
	stats,
	funnel,
	funnelMax,
	applicants,
}: {
	stats: Stats;
	funnel: { label: string; value: number; to?: string }[];
	funnelMax: number;
	applicants: {
		id: string;
		applicantId: string;
		name: string;
		financials: { outstanding: string; plan: string };
	}[];
}) {
	return (
		<>
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", marginBottom: "2.5rem" }}>
				<KPICard
					label="Awaiting Assignment"
					value={String(stats.unassignedConsultations + stats.unassignedApplications)}
					note={`${stats.unassignedConsultations} consultations · ${stats.unassignedApplications} cases`}
					inverted
					to="/consultations"
				/>
				<KPICard label="Consultations" value={String(stats.consultations)} note={`${stats.underReview} under review · ${stats.inAssessment} in assessment`} to="/consultations" />
				<KPICard label="Applications" value={String(stats.applications)} note={`${stats.appsUnderReview} under review · ${stats.accepted} accepted`} to="/applications" />
				<KPICard label="Active Applicants" value={String(stats.activeApplicants)} note={`${stats.applicants} in directory`} to="/applicants" />
				<KPICard label="Collected Revenue" value={fmtUsd(stats.collected)} note={`Outstanding: ${fmtUsd(stats.outstanding)}`} to="/finance" />
			</div>

			<div style={{ marginBottom: "2rem" }}>
				<UnassignedBookings />
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Conversion Funnel</h2>
					<p className="muted mb-2" style={{ fontSize: "var(--text-xs)" }}>Click a stage to drill into the module.</p>
					<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
						{funnel.map((f) => (
							<FunnelBar key={f.label} label={f.label} value={f.value} max={funnelMax} to={f.to} />
						))}
					</div>
				</div>
				<div className="card">
					<h2 className="section-title mb-3">Needs Attention</h2>
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						<ActivityItem title="Documents pending review" time={`${stats.pendingDocs} awaiting a decision`} to="/documents" />
						<ActivityItem title="Open checklist items" time={`${stats.openChecklistItems} unticked across cases`} to="/applications" />
						<ActivityItem title="Consultations to assess" time={`${stats.inAssessment} in assessment`} to="/consultations" />
						<ActivityItem
							title="Lead → applicant rate"
							time={stats.leads ? `${Math.round((stats.applicants / stats.leads) * 100)}%` : "-"}
							to="/crm"
						/>
					</ul>
				</div>
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Balances</h2>
					{applicants.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No applicant accounts yet.</p>
					) : (
						<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
							{applicants.slice(0, 6).map((a) => (
								<ActivityItem
									key={a.id}
									title={`${a.name} - ${fmtFin(a.financials.outstanding)} outstanding`}
									time={`${a.applicantId} · ${a.financials.plan}`}
									to="/applicants"
								/>
							))}
						</ul>
					)}
				</div>
			</div>
		</>
	);
}

/* ─── Coordinator - CRM leads, assignments, workflow tracking ─── */

function CoordinatorView({
	stats,
	funnel,
	funnelMax,
}: {
	stats: Stats;
	funnel: { label: string; value: number; to?: string }[];
	funnelMax: number;
}) {
	return (
		<>
			<UnassignedBookings />

			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", marginBottom: "3rem" }}>
				<KPICard
					label="Unassigned Bookings"
					value={String(stats.unassignedConsultations)}
					note="Awaiting consultant assignment"
					inverted
					to="/consultations"
				/>
				<KPICard label="Consultations" value={String(stats.consultations)} note={`${stats.underReview} under review · ${stats.inAssessment} in assessment`} to="/consultations" />
				<KPICard label="Applications" value={String(stats.applications)} note={`${stats.appsUnderReview} under review · ${stats.accepted} accepted`} to="/applications" />
				<KPICard label="Pending Docs" value={String(stats.pendingDocs)} note="Awaiting verification" to="/documents" />
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Conversion Funnel</h2>
					<p className="muted mb-2" style={{ fontSize: "var(--text-xs)" }}>Click a stage to drill into the module.</p>
					<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
						{funnel.map((f) => (
							<FunnelBar key={f.label} label={f.label} value={f.value} max={funnelMax} to={f.to} />
						))}
					</div>
				</div>
				<div className="card">
					<h2 className="section-title mb-3">Workflow Status</h2>
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						<ActivityItem title="Consultations to assign" time={`${stats.unassignedConsultations} awaiting a consultant`} to="/consultations" />
						<ActivityItem title="Cases to assign" time={`${stats.unassignedApplications} awaiting staff`} to="/applications" />
						<ActivityItem title="Documents pending review" time={`${stats.pendingDocs} awaiting a decision`} to="/documents" />
						<ActivityItem title="Open checklist items" time={`${stats.openChecklistItems} unticked across cases`} to="/applications" />
					</ul>
				</div>
			</div>
		</>
	);
}

/* ─── Consultant - their own caseload ─── */

function ConsultantView({
	stats,
	consultations,
	applications,
	assignees,
}: {
	stats: Stats;
	consultations: { id: string; applicantName: string; dateTime: string; targetCountry: string; status: string; assignedOfficer?: string; assignedOfficerEmail?: string }[];
	applications: { id: string; appId: string; applicantName: string; stage: string; university: string; assignedStaff?: string; assignedStaffEmail?: string }[];
	assignees: { name: string; email: string; opsUserId?: string }[];
}) {
	const toAssess = consultations.filter((c) => c.status !== "Completed");
	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;

	return (
		<>
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", marginBottom: "3rem" }}>
				<KPICard label="My Consultations" value={String(stats.consultations)} note={`${toAssess.length} awaiting assessment`} inverted to="/consultations" />
				<KPICard label="My Applications" value={String(stats.applications)} note={`${stats.appsUnderReview} under review`} to="/applications" />
				<KPICard label="My Applicants" value={String(stats.activeApplicants)} note="Active across all stages" to="/applicants" />
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Awaiting My Assessment</h2>
					{toAssess.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>Nothing waiting on you.</p>
					) : (
						<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
							{toAssess.slice(0, 6).map((c) => (
								<ActivityItem
									key={c.id}
									title={`${c.applicantName} - ${c.dateTime}`}
									time={`${c.targetCountry} · ${c.status}`}
									to="/consultations"
									chat={
										c.assignedOfficer ? (
											<StaffChatBadge
												opsUserId={opsUserIdByEmail(c.assignedOfficerEmail ?? "")}
												name={c.assignedOfficer}
												email={c.assignedOfficerEmail}
											/>
										) : null
									}
								/>
							))}
						</ul>
					)}
				</div>
				<div className="card">
					<h2 className="section-title mb-3">My Cases</h2>
					{applications.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No cases assigned to you.</p>
					) : (
						<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
							{applications.slice(0, 6).map((a) => (
								<ActivityItem
									key={a.id}
									title={`${a.appId} - ${a.applicantName}`}
									time={`${a.stage} · ${a.university}`}
									to="/applications"
									chat={
										a.assignedStaff ? (
											<StaffChatBadge
												opsUserId={opsUserIdByEmail(a.assignedStaffEmail ?? "")}
												name={a.assignedStaff}
												email={a.assignedStaffEmail}
											/>
										) : null
									}
								/>
							))}
						</ul>
					)}
				</div>
			</div>
		</>
	);
}

/* ─── Finance - money and the package catalogue ─── */

function FinanceView({
	stats,
	applicants,
}: {
	stats: Stats;
	applicants: {
		id: string;
		applicantId: string;
		name: string;
		financials: { totalAmount: string; paidAmount: string; outstanding: string; plan: string };
	}[];
}) {
	const settled = applicants.filter(
		(a) => money(a.financials.outstanding) === 0,
	).length;

	return (
		<>
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", marginBottom: "3rem" }}>
				<KPICard label="Total Outstanding" value={fmtGhs(stats.outstanding)} note={`${stats.applicants} accounts · ≈ ${fmtUsd(stats.outstanding)}`} inverted to="/finance" />
				<KPICard label="Collected" value={fmtGhs(stats.collected)} note={`Across all applicants · ≈ ${fmtUsd(stats.collected)}`} to="/finance" />
				<KPICard label="Settled Accounts" value={String(settled)} note={`${stats.applicants - settled} with a balance`} to="/finance" />
				<KPICard label="Active Applicants" value={String(stats.activeApplicants)} note="Currently billable" to="/applicants" />
			</div>

			<div className="card">
				<h2 className="section-title mb-3">Applicant Balances</h2>
				{applicants.length === 0 ? (
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No applicant accounts yet.</p>
				) : (
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "1rem" }}>Applicant ID</th>
									<th style={{ padding: "1rem" }}>Name</th>
									<th style={{ padding: "1rem" }}>Total</th>
									<th style={{ padding: "1rem" }}>Paid</th>
									<th style={{ padding: "1rem" }}>Outstanding</th>
									<th style={{ padding: "1rem" }}>Plan</th>
								</tr>
							</thead>
							<tbody>
								{applicants.map((a) => (
									<tr key={a.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
										<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600 }}>{a.applicantId}</td>
										<td style={{ padding: "1rem" }}>
											<Link to="/applicants" style={{ textDecoration: "underline" }}>{a.name}</Link>
										</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-xs)" }}>{fmtFin(a.financials.totalAmount)}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-xs)" }}>{fmtFin(a.financials.paidAmount)}</td>
										<td style={{ padding: "1rem", fontWeight: 600, fontSize: "var(--text-xs)" }}>{fmtFin(a.financials.outstanding)}</td>
										<td style={{ padding: "1rem" }} className="muted">{a.financials.plan}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</>
	);
}

/* ─── Shared Components ─── */

function KPICard({ label, value, note, inverted, to }: { label: string; value: string; note: string; inverted?: boolean; to?: string }) {
	const card = (
		<div
			className="card"
			style={{
				...(inverted ? { background: "var(--foreground)", color: "var(--background)" } : undefined),
				height: "100%",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<p className="eyebrow" style={inverted ? { color: "var(--background)", opacity: 0.7 } : undefined}>{label}</p>
			<p className="page-title mt-1" style={inverted ? { color: "var(--background)" } : undefined}>{value}</p>
			<p className="muted mt-2" style={{ ...(inverted ? { color: "var(--background)", opacity: 0.7 } : undefined), marginTop: "auto" }}>{note}</p>
		</div>
	);
	if (!to) return card;
	return (
		<Link
			to={to}
			className="card-link"
			style={{ display: "block", height: "100%" }}
			aria-label={`Open ${label}`}
		>
			{card}
		</Link>
	);
}

function ActivityItem({ title, time, to, chat }: { title: string; time: string; to?: string; chat?: ReactNode }) {
	const item = (
		<li style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border-light)" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
				<div style={{ minWidth: 0 }}>
					<p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{title}</p>
					<p className="muted mt-1" style={{ fontSize: "var(--text-xs)" }}>{time}</p>
				</div>
				{chat}
			</div>
		</li>
	);
	if (!to) return item;
	return (
		<Link to={to} className="card-link" style={{ display: "block" }}>
			{item}
		</Link>
	);
}

function FunnelBar({ label, value, max, to }: { label: string; value: number; max: number; to?: string }) {
	const pct = Math.round((value / max) * 100);
	const bar = (
		<div>
			<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
				<span style={{ fontSize: "var(--text-sm)" }}>{label}</span>
				<span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>{value}</span>
			</div>
			<div style={{ width: "100%", height: "8px", background: "var(--muted)", border: "1px solid var(--border-light)" }}>
				<div style={{ width: `${pct}%`, height: "100%", background: "var(--foreground)", transition: "width 0.6s ease" }} />
			</div>
		</div>
	);
	if (!to) return bar;
	return (
		<Link to={to} className="card-link" aria-label={`Open ${label}`}>
			{bar}
		</Link>
	);
}
