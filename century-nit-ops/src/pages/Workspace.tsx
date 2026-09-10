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
import { LEAD_STAGE_LABELS, type Lead, type LeadStage } from "century-nit-core";
import { apiFetch, ApiError } from "../lib/api";
import { bookingsApi } from "century-nit-core/api";
import { Users, Zap, FileText, AlertTriangle, PhoneCall, DollarSign } from "lucide-react";
import { API_PREFIX, JOURNEY_STAGE_LABELS, type JourneyStage, type StageHandoff } from "century-nit-shared";
import {
	buildInvoiceRows,
	buildPendingTasks,
	taskActionLabel,
	timeAgo,
	type PendingTask,
} from "../lib/pendingTasks";
import { PendingTaskTable } from "./PendingTasks";

/**
 * F-shaped workspace / mission control.
 *
 * The first scan is the top KPI strip; the second scan is the long, left-aligned
 * work queue presented as a table with inline assignment; the right-hand pane
 * shows context without leaving the page.
 */

export function Workspace() {
	const { opsUser, canSeeAllBranches, canAssignWork, scopeRecords } = useOpsAuth();
	const {
		consultations,
		applications,
		applicants,
		assignees,
		handoffs,
		loading: casesLoading,
		error: casesError,
		refresh,
		assignConsultation,
		assignApplication,
		resolveHandoff,
		deferHandoff,
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
			invoiceRows,
			invoices,
			leads,
			liveBookingIds: liveBookingIds,
		});
	}, [scopedConsultations, scopedApplications, scopedApplicants, invoiceRows, invoices, leads, liveBookingIds, handoffs]);

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

	const doAssign = useCallback(
		async (task: PendingTask, to: Assignee, reason?: string) => {
			if (task.kind === "consultation" && task.action === "assign") {
				return assignConsultation(task.record.id, to);
			}
			if (task.kind === "application" && task.action === "assign") {
				return assignApplication(task.record.id, to);
			}
			if (task.kind === "handoff" && task.action === "resolve") {
				return resolveHandoff(task.record.id, "assign", {
					opsUserId: to.opsUserId,
					reason: reason || undefined,
				});
			}
			throw new Error("This task cannot be assigned from here.");
		},
		[assignConsultation, assignApplication, resolveHandoff],
	);

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
				<KPICard label="Needs assignment" value={String(stats.needsAssignment)} active={filter === "needs_assignment"} onClick={() => setFilter("needs_assignment")} icon={<Users size={18} strokeWidth={1.5} />} />
				<KPICard label="Needs action" value={String(stats.needsAction)} active={filter === "needs_action"} onClick={() => setFilter("needs_action")} icon={<Zap size={18} strokeWidth={1.5} />} />
				<KPICard label="Needs invoicing" value={String(stats.needsInvoice)} active={filter === "needs_invoice"} onClick={() => setFilter("needs_invoice")} icon={<FileText size={18} strokeWidth={1.5} />} />
				<KPICard label="Overdue invoices" value={String(stats.overdue)} active={filter === "overdue"} onClick={() => setFilter("overdue")} icon={<AlertTriangle size={18} strokeWidth={1.5} />} />
				<KPICard label="Follow up" value={String(stats.needsFollowup)} active={filter === "needs_followup"} onClick={() => setFilter("needs_followup")} icon={<PhoneCall size={18} strokeWidth={1.5} />} />
				<KPICard label="Outstanding" value={fmtGhs(stats.totalOutstanding)} sub={fmtUsd(stats.totalOutstanding)} active={filter === "outstanding"} onClick={() => setFilter("outstanding")} icon={<DollarSign size={18} strokeWidth={1.5} />} />
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

					{/* Queue List — tabular, with inline assignment like the Dashboard */}
					<div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "50vh", maxHeight: "calc(100vh - 280px)", overflow: "hidden", padding: 0 }}>
						<div style={{ flex: 1, overflowY: "auto" }}>
							<PendingTaskTable
								items={filtered}
								assignees={assignees}
								canAssignWork={canAssignWork}
								onAssign={doAssign}
								onAssigned={refresh}
								onSelect={setSelected}
								selectedId={selected?.id}
								emptyLabel={loading ? "Loading your queue…" : "You're all caught up! Nothing on your desk right now."}
							/>
						</div>
					</div>
				</div>

				{/* RIGHT COLUMN: Preview Pane */}
				<div style={{ display: "flex", flexDirection: "column", gap: "1rem", position: "sticky", top: "1rem", height: "calc(100vh - 2rem)" }}>
					{/* Preview Pane */}
					<div className="card" style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
						{selected ? (
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
	onClick,
	icon,
}: {
	label: string;
	value: string;
	sub?: string;
	active?: boolean;
	onClick?: () => void;
	icon?: React.ReactNode;
}) {
	return (
		<button
			className="card"
			onClick={onClick}
			style={{
				textAlign: "left",
				width: "100%",
				cursor: "pointer",
				background: active ? "var(--foreground)" : "var(--card)",
				color: active ? "var(--background)" : "var(--foreground)",
				border: active ? `1px solid var(--foreground)` : `1px solid var(--border-light)`,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: "0.5rem" }}>
				<p className="eyebrow" style={{ opacity: active ? 0.9 : 0.7, margin: 0, color: active ? "var(--background)" : "var(--foreground)" }}>{label}</p>
				{icon && <span style={{ opacity: active ? 1 : 0.8, color: active ? "var(--background)" : "var(--foreground)", display: "flex", alignItems: "center" }}>{icon}</span>}
			</div>
			<p className="page-title" style={{ fontSize: "1.75rem", margin: "0.25rem 0", color: active ? "var(--background)" : "inherit" }}>{value}</p>
			{sub && <p className="muted" style={{ fontSize: "var(--text-xs)", opacity: active ? 0.8 : 1, margin: 0, color: active ? "var(--background)" : "var(--muted-fg)" }}>{sub}</p>}
		</button>
	);
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
	const [assigneeId, setAssigneeId] = useState<string>("");
	const [assigning, setAssigning] = useState(false);
	const [assignError, setAssignError] = useState<string | null>(null);
	const [reason, setReason] = useState<string>("");

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
			} else if (item.kind === "handoff" && item.action === "resolve") {
				await onResolveHandoff(item.record.id, "assign", { opsUserId: to.opsUserId, reason: reason || undefined });
			}
			await onAssigned();
		} catch (err) {
			setAssignError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not assign");
		} finally {
			setAssigning(false);
		}
	}

	async function keepHandler() {
		if (item.kind !== "handoff") return;
		setAssigning(true);
		setAssignError(null);
		try {
			await onResolveHandoff(item.record.id, "keep", { reason: reason || undefined });
			await onAssigned();
		} catch (err) {
			setAssignError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not resolve");
		} finally {
			setAssigning(false);
		}
	}

	async function defer() {
		if (item.kind !== "handoff") return;
		setAssigning(true);
		setAssignError(null);
		try {
			await onDeferHandoff(item.record.id, reason || undefined);
			await onAssigned();
		} catch (err) {
			setAssignError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not defer");
		} finally {
			setAssigning(false);
		}
	}

	const linkLabel =
		item.kind === "booking"
			? "Open Consultations"
			: item.kind === "consultation"
				? "Open Consultations"
				: item.kind === "application"
					? "Open Applications"
					: item.kind === "visa"
						? "Open Visa Processing"
						: item.kind === "handoff"
							? item.record.stage === "visa_processing"
								? "Open Visa Processing"
								: "Open Applications"
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
						{taskActionLabel(item)}
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
			{item.kind === "visa" && <VisaDetails a={item.record} />}
			{item.kind === "handoff" && <HandoffDetails h={item.record} />}
			{item.kind === "applicant" && <ApplicantDetails app={item.record} />}
			{item.kind === "invoice" && <InvoiceDetails inv={item.record} />}
			{item.kind === "lead" && <LeadDetails lead={item.record} />}

			{item.kind === "handoff" && canAssignWork && (
				<div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border-light)" }}>
					<div className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
						This stage needs an owner before it can start. Keep the previous handler, assign a specialist, or defer the decision.
					</div>
					<label className="field" style={{ marginBottom: "0.75rem" }}>
						<span className="field-label">Assign a specialist</span>
						<select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
							<option value="">Select staff…</option>
							{eligibleAssignees.map((a) => (
								<option key={a.opsUserId || a.email} value={a.opsUserId || a.email}>
									{a.name} {a.branch ? `(${a.branch})` : ""}
								</option>
							))}
						</select>
					</label>
					<label className="field" style={{ marginBottom: "0.75rem" }}>
						<span className="field-label">Reason (optional)</span>
						<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change / assignment" />
					</label>
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
						<button
							className="btn btn--primary btn--sm"
							onClick={doAssign}
							disabled={!assigneeId || assigning}
						>
							{assigning ? "Assigning…" : "Assign ↗"}
						</button>
						{item.record.fromOpsUserName && (
							<button
								className="btn btn--ghost btn--sm"
								onClick={keepHandler}
								disabled={assigning}
							>
								{assigning ? "Resolving…" : `Keep ${item.record.fromOpsUserName}`}
							</button>
						)}
						<button
							className="btn btn--ghost btn--sm"
							onClick={defer}
							disabled={assigning}
						>
							{assigning ? "Deferring…" : "Assign later"}
						</button>
					</div>
					{assignError && <p className="ops-modal__error" style={{ marginTop: "0.5rem" }}>{assignError}</p>}
				</div>
			)}

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
