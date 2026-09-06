import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { fmtGhs, fmtUsd, money } from "./currency";
import { LiveMeetings } from "./LiveMeetings";
import {
	invoiceBalance,
	invoiceAgeDays,
} from "century-nit-core/ops";
import type {
	MockConsultation,
	MockApplication,
	MockApplicant,
	Invoice,
	Assignee,
	InvoiceStatus,
} from "century-nit-core/ops";
import { LEAD_STAGE_LABELS, type Lead, type LeadStage } from "century-nit-core";
import { apiFetch, ApiError } from "../lib/api";
import { API_PREFIX, JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";

/**
 * F-shaped workspace / mission control.
 *
 * The first scan is the top KPI strip; the second scan is the long, left-aligned
 * work queue; the right-hand pane shows context without leaving the page.
 */

const PRIORITY: Record<string, number> = {
	assign_consultation: 1,
	assign_application: 2,
	reschedule: 3,
	assess: 4,
	review_application: 5,
	checklist: 6,
	docs: 7,
	invoice: 8,
	issue: 9,
	chase: 10,
	followup: 11,
};

type WorkItem =
	| {
			id: string;
			category: string;
			kind: "consultation";
			action: "assign" | "assess" | "reschedule";
			record: MockConsultation;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "application";
			action: "assign" | "review" | "checklist";
			record: MockApplication;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "applicant";
			action: "docs" | "invoice";
			record: MockApplicant;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "invoice";
			action: "issue" | "chase";
			record: Invoice;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "lead";
			action: "followup";
			record: Lead;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  };

function timeAgo(iso: string) {
	const diff = Date.now() - new Date(iso).getTime();
	const hours = Math.floor(diff / 3_600_000);
	if (hours < 1) return "Just now";
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function derivedStatus(inv: Invoice): InvoiceStatus {
	const age = invoiceAgeDays(inv);
	if (inv.status === "overdue") return "overdue";
	if ((inv.status === "issued" || inv.status === "partial") && age !== null && age > 0) return "overdue";
	return inv.status;
}

export function Workspace() {
	const { opsUser, canSeeAllBranches, canAssignWork, scopeRecords } = useOpsAuth();
	const {
		consultations,
		applications,
		applicants,
		assignees,
		loading: casesLoading,
		error: casesError,
		refresh,
		assignConsultation,
		assignApplication,
	} = useCases();
	const { invoices, loading: invoicesLoading } = useInvoiceApi();

	const [branchFilter, setBranchFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [searchParams, setSearchParams] = useSearchParams();
	const initialFilter = searchParams.get("filter") ?? "all";
	const [filter, setFilterState] = useState<string>(initialFilter);
	const setFilter = (next: string) => {
		setFilterState(next);
		const params = new URLSearchParams(searchParams);
		if (next === "all") params.delete("filter");
		else params.set("filter", next);
		setSearchParams(params, { replace: true });
	};
	const [selected, setSelected] = useState<WorkItem | null>(null);
	const [leads, setLeads] = useState<Lead[]>([]);
	const [leadsLoading, setLeadsLoading] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLeadsLoading(true);
		void (async () => {
			try {
				const res = await apiFetch<{ leads: Lead[] }>(`${API_PREFIX}/leads`);
				if (!cancelled) setLeads(res.leads);
			} catch {
				if (!cancelled) setLeads([]);
			} finally {
				if (!cancelled) setLeadsLoading(false);
			}
		})();
		return () => { cancelled = true; };
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

	const invoiceRows = useMemo(
		() =>
			invoices.map((inv) => {
				const status = derivedStatus(inv);
				const balance = invoiceBalance(inv);
				const age = invoiceAgeDays(inv);
				return { inv, status, balance, age };
			}),
		[invoices],
	);

	const items = useMemo<WorkItem[]>(() => {
		const q: WorkItem[] = [];

		for (const c of scopedConsultations) {
			if (c.status === "Under Review" && !c.assignedOfficer) {
				q.push({
					id: `c-assign-${c.id}`,
					category: "needs_assignment",
					kind: "consultation",
					action: "assign",
					record: c,
					title: c.applicantName,
					subtitle: `Consultation · ${c.type} · ${c.targetCountry || "—"}`,
					meta: c.dateTime,
					branch: c.branch,
					owner: "Unassigned",
					linkTo: `/consultations?id=${c.id}`,
					priority: PRIORITY.assign_consultation,
				});
			} else if (c.status === "Assigned" || c.status === "Confirmed" || c.status === "In Assessment") {
				q.push({
					id: `c-assess-${c.id}`,
					category: "needs_action",
					kind: "consultation",
					action: "assess",
					record: c,
					title: c.applicantName,
					subtitle: `Ready for assessment · ${c.type} · ${c.targetCountry || "—"}`,
					meta: c.dateTime,
					branch: c.branch,
					owner: c.assignedOfficer || "—",
					linkTo: `/consultations?id=${c.id}`,
					priority: PRIORITY.assess,
				});
			} else if (c.rescheduleRequestedAt) {
				q.push({
					id: `c-res-${c.id}`,
					category: "needs_action",
					kind: "consultation",
					action: "reschedule",
					record: c,
					title: c.applicantName,
					subtitle: `Reschedule requested · ${c.type}`,
					meta: `Requested ${timeAgo(c.rescheduleRequestedAt)}`,
					branch: c.branch,
					owner: c.assignedOfficer || "—",
					linkTo: `/consultations?id=${c.id}`,
					priority: PRIORITY.reschedule,
				});
			}
		}

		for (const a of scopedApplications) {
			if (!a.assignedStaff) {
				q.push({
					id: `a-assign-${a.id}`,
					category: "needs_assignment",
					kind: "application",
					action: "assign",
					record: a,
					title: `${a.applicantName}`,
					subtitle: `Application ${a.appId} · ${a.country || "—"}`,
					meta: `Stage: ${JOURNEY_STAGE_LABELS[a.stage as JourneyStage] || a.stage}`,
					branch: a.branch,
					owner: "Unassigned",
					linkTo: `/applications?id=${a.id}`,
					priority: PRIORITY.assign_application,
				});
			} else if (a.status === "Under Review") {
				q.push({
					id: `a-review-${a.id}`,
					category: "needs_action",
					kind: "application",
					action: "review",
					record: a,
					title: `${a.applicantName}`,
					subtitle: `Application under review · ${a.university || a.country || "—"}`,
					meta: `Stage: ${JOURNEY_STAGE_LABELS[a.stage as JourneyStage] || a.stage}`,
					branch: a.branch,
					owner: a.assignedStaff,
					linkTo: `/applications?id=${a.id}`,
					priority: PRIORITY.review_application,
				});
			} else if (a.checklist.some((i) => !i.checked)) {
				const open = a.checklist.filter((i) => !i.checked).length;
				q.push({
					id: `a-check-${a.id}`,
					category: "needs_action",
					kind: "application",
					action: "checklist",
					record: a,
					title: `${a.applicantName}`,
					subtitle: `${open} open checklist item${open === 1 ? "" : "s"}`,
					meta: `Stage: ${JOURNEY_STAGE_LABELS[a.stage as JourneyStage] || a.stage}`,
					branch: a.branch,
					owner: a.assignedStaff,
					linkTo: `/applications?id=${a.id}`,
					priority: PRIORITY.checklist,
				});
			}
		}

		for (const app of scopedApplicants) {
			const pendingDocs = app.documents.filter((d) => d.status === "Pending Review").length;
			if (pendingDocs > 0) {
				q.push({
					id: `app-docs-${app.id}`,
					category: "needs_action",
					kind: "applicant",
					action: "docs",
					record: app,
					title: app.name,
					subtitle: `${pendingDocs} document${pendingDocs === 1 ? "" : "s"} pending review`,
					meta: `Stage: ${app.currentStage}`,
					branch: app.branch,
					owner: app.assignedOfficer || "—",
					linkTo: `/applicants?id=${app.id}`,
					priority: PRIORITY.docs,
				});
			}

			const outstanding = money(app.financials.outstanding);
			if (outstanding > 0) {
				const hasOpenInvoice = invoiceRows.some(
					(r) => r.inv.applicantName === app.name && r.status !== "paid" && r.status !== "void",
				);
				if (!hasOpenInvoice) {
					q.push({
						id: `app-inv-${app.id}`,
						category: "needs_invoice",
						kind: "applicant",
						action: "invoice",
						record: app,
						title: app.name,
						subtitle: `Outstanding balance · ${fmtGhs(outstanding)}`,
						meta: `Plan: ${app.financials.plan || "—"}`,
						branch: app.branch,
						owner: app.assignedOfficer || "—",
						linkTo: `/invoices`,
						priority: PRIORITY.invoice,
					});
				}
			}
		}

		for (const r of invoiceRows) {
			if (r.status === "proforma") {
				q.push({
					id: `inv-issue-${r.inv.id}`,
					category: "needs_invoice",
					kind: "invoice",
					action: "issue",
					record: r.inv,
					title: r.inv.applicantName,
					subtitle: `Proforma invoice · ${fmtGhs(r.inv.subtotal)}`,
					meta: r.inv.invoiceNumber,
					branch: "",
					owner: r.inv.issuedBy || "—",
					linkTo: `/invoices`,
					priority: PRIORITY.issue,
				});
			}
			if (r.status === "overdue") {
				q.push({
					id: `inv-chase-${r.inv.id}`,
					category: "needs_invoice",
					kind: "invoice",
					action: "chase",
					record: r.inv,
					title: r.inv.applicantName,
					subtitle: `Overdue · balance ${fmtGhs(r.balance)}`,
					meta: `Due ${r.age ?? "?"} day${r.age === 1 ? "" : "s"} ago`,
					branch: "",
					owner: r.inv.issuedBy || "—",
					linkTo: `/invoices`,
					priority: PRIORITY.chase,
				});
			}
		}

		for (const lead of leads) {
			if (lead.stage === "new" || lead.stage === "contacted") {
				q.push({
					id: `lead-${lead.id}`,
					category: "needs_followup",
					kind: "lead",
					action: "followup",
					record: lead,
					title: lead.name,
					subtitle: `${LEAD_STAGE_LABELS[lead.stage]} · ${lead.country || "—"}`,
					meta: `Last contact ${timeAgo(lead.lastContactAt)}`,
					branch: "",
					owner: lead.assignedTo || "Unassigned",
					linkTo: `/leads`,
					priority: PRIORITY.followup,
				});
			}
		}

		q.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
		return q;
	}, [scopedConsultations, scopedApplications, scopedApplicants, invoiceRows, leads]);

	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim();
		return items.filter((item) => {
			if (branchFilter !== "all" && item.branch && item.branch !== branchFilter) return false;
			if (filter !== "all" && item.category !== filter) return false;
			if (!q) return true;
			const hay = `${item.title} ${item.subtitle} ${item.meta} ${item.owner}`.toLowerCase();
			return hay.includes(q);
		});
	}, [items, branchFilter, filter, search]);

	const stats = useMemo(() => {
		const needsAssignment = items.filter((i) => i.category === "needs_assignment").length;
		const needsAction = items.filter((i) => i.category === "needs_action").length;
		const needsInvoice = items.filter((i) => i.category === "needs_invoice").length;
		const needsFollowup = items.filter((i) => i.category === "needs_followup").length;
		const overdue = invoiceRows.filter((r) => r.status === "overdue").length;
		const totalOutstanding = applicants.reduce((n, a) => n + money(a.financials.outstanding), 0);
		return { needsAssignment, needsAction, needsInvoice, needsFollowup, overdue, totalOutstanding };
	}, [items, invoiceRows, applicants]);

	const loading = casesLoading || invoicesLoading || leadsLoading;

	return (
		<div className="page-content fade-in" style={{ backgroundColor: "#f8fafc", minHeight: "100%" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
				<div>
					<h1 className="page-title">Workspace</h1>
					<p className="lead mt-2">
						{opsUser ? `Good day, ${opsUser.name.split(" ")[0]}.` : "Operations workspace."} Here is what needs attention.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			{/* KPI strip — first horizontal scan */}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
				<KPICard label="Needs assignment" value={String(stats.needsAssignment)} active={filter === "needs_assignment"} onClick={() => setFilter("needs_assignment")} icon="👥" accent="#3b82f6" />
				<KPICard label="Needs action" value={String(stats.needsAction)} active={filter === "needs_action"} onClick={() => setFilter("needs_action")} icon="⚡" accent="#f59e0b" />
				<KPICard label="Needs invoicing" value={String(stats.needsInvoice)} active={filter === "needs_invoice"} onClick={() => setFilter("needs_invoice")} icon="📝" accent="#8b5cf6" />
				<KPICard label="Overdue invoices" value={String(stats.overdue)} active={filter === "overdue"} onClick={() => setFilter("overdue")} urgent={stats.overdue > 0} icon="⚠️" accent="#ef4444" />
				<KPICard label="Follow up" value={String(stats.needsFollowup)} active={filter === "needs_followup"} onClick={() => setFilter("needs_followup")} icon="📞" accent="#0ea5e9" />
				<KPICard label="Outstanding" value={fmtGhs(stats.totalOutstanding)} sub={fmtUsd(stats.totalOutstanding)} active={filter === "outstanding"} onClick={() => setFilter("outstanding")} icon="💰" accent="#10b981" />
			</div>

			{/* Main Content Grid: 2 Columns */}
			<div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem", alignItems: "start" }}>
				
				{/* LEFT COLUMN: Work Queue */}
				<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
					{/* Toolbar & Search */}
					<div className="card" style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", padding: "1rem 1.25rem" }}>
						<h2 className="section-title" style={{ margin: 0, marginRight: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
							Work Queue
							<span className="portal-pill" style={{ fontSize: "var(--text-sm)", fontWeight: "normal" }}>{filtered.length} items</span>
						</h2>
						
						<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
							{loading && <span className="muted" style={{ fontSize: "var(--text-sm)" }}>Loading…</span>}
							{casesError && <span className="ops-modal__error">{casesError}</span>}
							{filter !== "all" && (
								<button className="btn btn--ghost btn--sm" onClick={() => setFilter("all")}>
									Clear filter
								</button>
							)}
							<input
								type="search"
								placeholder="Search queue..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="input"
								style={{ width: "240px" }}
							/>
						</div>
					</div>

					{/* Queue List */}
					<div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "60vh", maxHeight: "calc(100vh - 220px)", overflow: "hidden", padding: 0 }}>
						<div style={{ flex: 1, overflowY: "auto" }}>
							{filtered.length === 0 ? (
								<div style={{ padding: "3rem 2rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }} className="muted">
									<span style={{ fontSize: "3rem", opacity: 0.2 }}>📥</span>
									{loading ? "Loading your queue…" : "You're all caught up! Nothing on your desk right now."}
								</div>
							) : (
								filtered.map((item) => (
									<QueueRow
										key={item.id}
										item={item}
										selected={selected?.id === item.id}
										onSelect={() => setSelected(item)}
									/>
								))
							)}
						</div>
					</div>
				</div>

				{/* RIGHT COLUMN: Live Meetings & Preview Pane */}
				<div style={{ display: "flex", flexDirection: "column", gap: "1rem", position: "sticky", top: "1rem" }}>
					<LiveMeetings compact />
					
					{/* Preview Pane */}
					<div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "50vh", maxHeight: "calc(100vh - 120px)", overflowY: "auto" }}>
						{selected ? (
							<PreviewPane
								item={selected}
								assignees={assignees}
								canAssignWork={canAssignWork}
								onAssigned={refresh}
								onAssignConsultation={assignConsultation}
								onAssignApplication={assignApplication}
							/>
						) : (
							<div style={{ padding: "4rem 2rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }} className="muted">
								<span style={{ fontSize: "3rem", opacity: 0.2 }}>👈</span>
								<p style={{ margin: 0, maxWidth: "200px" }}>Select an item from the queue to see details and next steps.</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function KPICard({
	label,
	value,
	sub,
	active,
	urgent,
	onClick,
	icon,
	accent,
}: {
	label: string;
	value: string;
	sub?: string;
	active?: boolean;
	urgent?: boolean;
	onClick?: () => void;
	icon?: string;
	accent?: string;
}) {
	const baseColor = urgent ? "var(--danger, #b91c1c)" : accent || "var(--accent, #6366f1)";
	
	return (
		<button
			className="card"
			onClick={onClick}
			style={{
				textAlign: "left",
				width: "100%",
				cursor: "pointer",
				background: active ? baseColor : "var(--card)",
				color: active ? "#ffffff" : "var(--foreground)",
				border: active ? `1px solid ${baseColor}` : `1px solid var(--border-light)`,
				borderTop: active ? undefined : `3px solid ${baseColor}`,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: "0.5rem" }}>
				<p className="eyebrow" style={{ opacity: active ? 0.9 : 0.7, margin: 0, color: active ? "#fff" : "var(--foreground)" }}>{label}</p>
				{icon && <span style={{ opacity: active ? 1 : 0.8, color: active ? "#fff" : baseColor, fontSize: "1.1rem" }}>{icon}</span>}
			</div>
			<p className="page-title" style={{ fontSize: "1.75rem", margin: "0.25rem 0", color: active ? "#fff" : "inherit" }}>{value}</p>
			{sub && <p className="muted" style={{ fontSize: "var(--text-xs)", opacity: active ? 0.8 : 1, margin: 0, color: active ? "#fff" : "var(--muted-fg)" }}>{sub}</p>}
		</button>
	);
}

function actionLabel(item: WorkItem): string {
	if (item.action === "assign") return "Assign";
	if (item.action === "assess") return "Assess";
	if (item.action === "reschedule") return "Reschedule";
	if (item.action === "review") return "Review";
	if (item.action === "checklist") return "Checklist";
	if (item.action === "docs") return "Documents";
	if (item.action === "invoice") return "Invoice";
	if (item.action === "issue") return "Issue invoice";
	if (item.action === "chase") return "Chase payment";
	if (item.action === "followup") return "Follow up";
	return item.action;
}

function QueueRow({ item, selected, onSelect }: { item: WorkItem; selected: boolean; onSelect: () => void }) {
	const actionColors: Record<string, string> = {
		assign: "#3b82f6",
		assess: "#6366f1",
		reschedule: "#f59e0b",
		review: "#8b5cf6",
		checklist: "#10b981",
		docs: "#0ea5e9",
		invoice: "#8b5cf6",
		issue: "#ec4899",
		chase: "#ef4444",
		followup: "#0ea5e9",
	};
	const pillBg = actionColors[item.action] || "var(--foreground)";

	return (
		<div
			onClick={onSelect}
			className={`queue-row ${selected ? "queue-row--selected" : ""}`}
		>
			<div style={{ minWidth: 0, flex: 1 }}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", flexWrap: "wrap" }}>
					<span
						className="portal-pill"
						style={{
							fontSize: "var(--text-xs)",
							padding: "0.1rem 0.45rem",
							background: selected ? "#ffffff" : pillBg,
							color: selected ? "var(--foreground)" : "#ffffff",
							border: "none",
						}}
					>
						{actionLabel(item)}
					</span>
					<span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{item.title}</span>
				</div>
				<p className="muted" style={{ fontSize: "var(--text-xs)", margin: 0 }}>
					{item.subtitle}
				</p>
				<p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0.15rem 0 0" }}>
					{item.meta} · {item.owner}
				</p>
			</div>
		</div>
	);
}

function PreviewPane({
	item,
	assignees,
	canAssignWork,
	onAssigned,
	onAssignConsultation,
	onAssignApplication,
}: {
	item: WorkItem;
	assignees: Assignee[];
	canAssignWork: boolean;
	onAssigned: () => void | Promise<void>;
	onAssignConsultation: (id: string, to: Assignee) => Promise<unknown>;
	onAssignApplication: (id: string, to: Assignee) => Promise<unknown>;
}) {
	const [assigneeId, setAssigneeId] = useState<string>("");
	const [assigning, setAssigning] = useState(false);
	const [assignError, setAssignError] = useState<string | null>(null);

	const eligibleAssignees = assignees.filter((a) => a.branch === item.branch || !item.branch || item.branch === "");

	async function doAssign() {
		const to = assignees.find((a) => a.email === assigneeId || a.opsUserId === assigneeId);
		if (!to || !item.record) return;
		setAssigning(true);
		setAssignError(null);
		try {
			if (item.kind === "consultation" && item.action === "assign") {
				await onAssignConsultation(item.record.id, to);
			} else if (item.kind === "application" && item.action === "assign") {
				await onAssignApplication(item.record.id, to);
			}
			await onAssigned();
		} catch (err) {
			setAssignError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not assign");
		} finally {
			setAssigning(false);
		}
	}

	const linkLabel =
		item.kind === "consultation"
			? "Open Consultations"
			: item.kind === "application"
				? "Open Applications"
				: item.kind === "applicant"
					? "Open Applicants"
					: item.kind === "invoice"
						? "Open Invoices"
						: "Open Leads";

	return (
		<div style={{ padding: "1.25rem" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
				<div>
					<span className="portal-pill" style={{ fontSize: "var(--text-xs)", marginBottom: "0.5rem", display: "inline-block" }}>
						{actionLabel(item)}
					</span>
					<h3 style={{ margin: "0.35rem 0 0", fontSize: "1.1rem" }}>{item.title}</h3>
				</div>
				<Link to={item.linkTo} className="btn btn--primary btn--sm">
					{linkLabel}
				</Link>
			</div>

			<div className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "1rem" }}>
				<p style={{ margin: "0 0 0.35rem" }}>{item.subtitle}</p>
				<p style={{ margin: "0 0 0.35rem" }}>{item.meta}</p>
				{item.branch && <p style={{ margin: 0 }}>Branch: {item.branch}</p>}
				<p style={{ margin: "0.35rem 0 0" }}>Owner: {item.owner}</p>
			</div>

			{item.kind === "consultation" && <ConsultationDetails c={item.record} />}
			{item.kind === "application" && <ApplicationDetails a={item.record} />}
			{item.kind === "applicant" && <ApplicantDetails app={item.record} />}
			{item.kind === "invoice" && <InvoiceDetails inv={item.record} />}
			{item.kind === "lead" && <LeadDetails lead={item.record} />}

			{item.action === "assign" && canAssignWork && (
				<div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border-light)" }}>
					<label className="field" style={{ marginBottom: "0.75rem" }}>
						<span className="field-label">Assign to</span>
						<select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
							<option value="">Select staff…</option>
							{eligibleAssignees.map((a) => (
								<option key={a.email} value={a.email}>
									{a.name} {a.branch ? `(${a.branch})` : ""}
								</option>
							))}
						</select>
					</label>
					<button className="btn btn--primary btn--sm" onClick={doAssign} disabled={!assigneeId || assigning}>
						{assigning ? "Assigning…" : "Assign"}
					</button>
					{assignError && <p className="ops-modal__error" style={{ marginTop: "0.5rem" }}>{assignError}</p>}
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
			<p style={{ margin: 0 }}><strong>Open checklist:</strong> {open}</p>
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
			<p style={{ margin: 0 }}><strong>Stage:</strong> {LEAD_STAGE_LABELS[lead.stage as LeadStage]}</p>
			<p style={{ margin: 0 }}><strong>Source:</strong> {lead.source || "—"}</p>
			<p style={{ margin: 0 }}><strong>Assigned:</strong> {lead.assignedTo || "Unassigned"}</p>
			<p style={{ margin: 0 }}><strong>Last contact:</strong> {timeAgo(lead.lastContactAt)}</p>
			{lead.notes && <p style={{ margin: 0, fontStyle: "italic" }}>{lead.notes}</p>}
		</div>
	);
}
