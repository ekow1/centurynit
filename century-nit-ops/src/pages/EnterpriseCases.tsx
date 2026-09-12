import { useEffect, useState } from "react";
import { CaseDetail } from "./case/CaseDetail";
import { CaseScaffold } from "./case/CaseScaffold";
import { CaseBoard } from "./case/CaseBoard";
import { StatusPill, VisaStagePill } from "century-nit-core/ui";
import { useSearchParams } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { StaffChatBadge } from "./StaffChatBadge";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { AddSchoolApplicationModal } from "./AddSchoolApplicationModal";
import { AssignScholarshipModal } from "./AssignScholarshipModal";
import { branchName, invoiceBalance } from "century-nit-core/ops";
import type { MockApplication, Invoice } from "century-nit-core/ops";
import {
	CASE_STATUS_LABELS,
	CHAPTERS,
	STAGE_CHAPTER,
	TRAVEL_STATUS_LABELS,
	preDepartureFeePaid,
	type ChapterId,
} from "century-nit-shared";
import { ApplicationAssignSheet, AssignChip, assignmentNeeded } from "./case/ApplicationAssignSheet";
import { tasksForApplication } from "../lib/pendingTasks";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { fmtBoth } from "./currency";

/**
 * The one list of cases. The old Applications, Visa and Departure queues
 * and the Board were four pages over the same rows, each with its own
 * filters, scoping and card; they are views here — a chapter filter and a
 * list/board switch — so a handler moving between them finds the same
 * frame, the same search and the same detail every time.
 */

type View = "list" | "board";

const CHAPTER_FILTERS: { id: "all" | ChapterId; label: string }[] = [
	{ id: "all", label: "All" },
	...CHAPTERS.filter((c) => c.id !== "consult").map((c) => ({ id: c.id, label: c.label })),
];

/** The chapter a case is in, by its stored stage. */
function chapterOf(app: MockApplication): ChapterId {
	return STAGE_CHAPTER[app.stage] ?? "enrol";
}

function visaInvoiceFor(invoices: Invoice[], app: MockApplication): Invoice | undefined {
	return invoices.find((i) => i.type === "Visa" && i.applicationId != null && i.applicationId === app.id);
}

/** What the row says under the name, by the chapter being looked at. */
function RowMeta({
	app,
	chapter,
	invoices,
	taStatus,
}: {
	app: MockApplication;
	chapter: "all" | ChapterId;
	invoices: Invoice[];
	taStatus: string | null;
}) {
	if (chapter === "visa") {
		const inv = visaInvoiceFor(invoices, app);
		const officer = (app.stageHandlers ?? []).find((h) => h.stage === "visa_processing")?.opsUserName;
		return (
			<>
				<VisaStagePill stage={app.visaStage ?? "locked"} />
				<span>
					{" · "}
					{inv
						? inv.status === "paid"
							? "Visa fee paid"
							: invoiceBalance(inv) > 0
								? `${inv.invoiceNumber} · ${fmtBoth(invoiceBalance(inv))} due`
								: "Visa fee settled"
						: app.visaInvoicePaid
							? "Visa fee paid"
							: "No visa fee yet"}
				</span>
				{officer && <span> · Visa officer {officer}</span>}
			</>
		);
	}
	if (chapter === "depart") {
		const officer = (app.stageHandlers ?? []).find((h) => h.stage === "travel_assistance")?.opsUserName;
		return (
			<>
				<StatusPill tone={taStatus === "booked" ? "done" : taStatus === "declined" || taStatus === "on_hold" ? "neutral" : taStatus ? "current" : "waiting"}>
					{taStatus ? (TRAVEL_STATUS_LABELS[taStatus] ?? taStatus) : "Awaiting choice"}
				</StatusPill>
				<span> · {preDepartureFeePaid(app) ? "Fee milestone paid" : "Fee milestone due"}</span>
				{officer && <span> · Travel officer {officer}</span>}
			</>
		);
	}
	return <span>{app.journey?.label ?? CHAPTERS.find((c) => c.id === chapterOf(app))?.label ?? app.stage}</span>;
}

export function EnterpriseCases({
	chapter: initialChapter = "all",
	view: initialView = "list",
}: {
	/** Preset by the route: /visa, /travel open the list on that chapter. */
	chapter?: "all" | ChapterId;
	/** Preset by the route: /workflow opens the board. */
	view?: View;
}) {
	const [searchParams] = useSearchParams();
	const { opsRole, opsUser, canSeeAllBranches, canAssignWork, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { applications, assignees, handoffs, travelRequests, error: casesError, addApplication } = useCases();
	const { invoices: allInvoices } = useInvoiceApi();
	// Assignment from the list: the card's chip opens the same sheet the detail uses.
	const [assignFor, setAssignFor] = useState<MockApplication | null>(null);

	const [chapter, setChapter] = useState<"all" | ChapterId>(initialChapter);
	const [view, setView] = useState<View>(initialView);
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [ownerFilter, setOwnerFilter] = useState<"all" | "mine">("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);
	const [actionSuccess, setActionSuccess] = useState<string | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");
	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [isScholarshipModalOpen, setIsScholarshipModalOpen] = useState(false);

	// The routes (/applications, /visa, /travel, /workflow) mount distinct
	// wrapper components, so moving between them remounts this page and the
	// presets above take effect without an effect.

	const queryId = searchParams.get("id");
	useEffect(() => {
		if (queryId) {
			const match = applications.find((a) => a.id === queryId);
			if (match) setSelectedApp(match);
		}
	}, [queryId, applications]);

	const canSeeAll = canSeeAllBranches;
	const liveSelected = selectedApp ? (applications.find((a) => a.appId === selectedApp.appId) ?? selectedApp) : null;
	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;
	const isMine = (a: MockApplication) =>
		a.assignedStaffEmail === opsUser?.email ||
		a.assignedStaff === opsUser?.name ||
		(a.stageHandlers ?? []).some((h) => h.opsUserEmail === opsUser?.email);
	const taStatusOf = (a: MockApplication) => travelRequests.find((t) => t.applicationId === a.id)?.status ?? a.travelAssistanceStatus ?? null;

	const roleScopedApps = scopeRecords(applications, isMine);

	const filteredApps = roleScopedApps.filter((a) => {
		if (branchFilter !== "all" && a.branch !== branchFilter) return false;
		if (ownerFilter === "mine" && !isMine(a)) return false;
		if (chapter !== "all") {
			// A chapter view shows the cases in it and the ones past it that
			// still have that chapter's work open (a visa case in Departure).
			const c = chapterOf(a);
			const order = CHAPTERS.map((x) => x.id);
			const inOrPast = order.indexOf(c) >= order.indexOf(chapter);
			if (chapter === "visa") {
				if (!(inOrPast || (a.visaStage && a.visaStage !== "locked") || Boolean(visaInvoiceFor(allInvoices, a)))) return false;
			} else if (!inOrPast) return false;
			if (chapter !== "done" && c === "done" && chapter !== "depart") return false;
		}
		const q = searchQuery.toLowerCase();
		const matchesSearch =
			a.applicantName.toLowerCase().includes(q) ||
			a.appId.toLowerCase().includes(q) ||
			a.university.toLowerCase().includes(q) ||
			a.assignedStaff.toLowerCase().includes(q);
		if (!matchesSearch) return false;
		if (statusFilter === "All") return true;
		return a.status === statusFilter;
	});

	const unassignedCases = roleScopedApps.filter((a) => assignmentNeeded(a, handoffs)).length;
	const initialTab = chapter === "visa" ? "visa" : chapter === "depart" ? "travel" : chapter === "done" ? "payments" : undefined;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
				<div>
					<h1 className="page-title">Cases</h1>
					<p className="lead mt-1">Every client's journey — one list, by chapter; open a case to work it.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<div className="cn-scaffold__chips" role="tablist" aria-label="View">
						<button type="button" role="tab" aria-selected={view === "list"} className={`btn btn--sm ${view === "list" ? "btn--primary" : "btn--ghost"}`} onClick={() => setView("list")}>
							List
						</button>
						<button type="button" role="tab" aria-selected={view === "board"} className={`btn btn--sm ${view === "board" ? "btn--primary" : "btn--ghost"}`} onClick={() => setView("board")}>
							Board
						</button>
					</div>
					<button className="btn btn--primary" onClick={() => setIsAddModalOpen(true)} style={{ whiteSpace: "nowrap" }}>
						+ Add school application
					</button>
					{canAssignWork && unassignedCases > 0 && (
						<span className="portal-pill" style={{ background: "var(--foreground)", color: "var(--background)", whiteSpace: "nowrap" }}>
							{unassignedCases} need{unassignedCases === 1 ? "s" : ""} an owner
						</span>
					)}
					{canSeeAll && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			{isAddModalOpen && (
				<AddSchoolApplicationModal
					onClose={() => setIsAddModalOpen(false)}
					onAdd={async (applicantId, destinationId, universityId, programId, intake) => {
						await addApplication(applicantId, { destinationId, universityId, programId, intake });
						setActionSuccess("School application added.");
						setTimeout(() => setActionSuccess(null), 4000);
					}}
				/>
			)}

			{isScholarshipModalOpen && selectedApp && (
				<AssignScholarshipModal applicantId={selectedApp.applicantId} onClose={() => setIsScholarshipModalOpen(false)} />
			)}

			{casesError ? <p className="ops-modal__error" role="alert">{casesError}</p> : null}

			{actionSuccess && (
				<div style={{ padding: "0.85rem 1.25rem", background: "var(--foreground)", color: "var(--background)", marginBottom: "1rem" }}>✓ {actionSuccess}</div>
			)}

			<div
				style={{
					padding: "0.65rem 1rem",
					border: "1px solid var(--border-light)",
					background: canSeeAll ? "var(--foreground)" : "var(--muted)",
					color: canSeeAll ? "var(--background)" : "var(--foreground)",
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "1rem",
					gap: "0.75rem",
					flexWrap: "wrap",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
					<span style={{ fontSize: "1rem" }}>{canSeeAll ? "◱" : "◈"}</span>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						{canSeeAll
							? `${filteredApps.length} of ${roleScopedApps.length} cases · ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: requiresAssignmentScope
								? `${filteredApps.length} of ${roleScopedApps.length} assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch · ${filteredApps.length} of ${roleScopedApps.length} cases`}
					</p>
				</div>
				{!requiresAssignmentScope && (
					<button
						type="button"
						className="btn btn--sm btn--ghost"
						style={canSeeAll ? { color: "var(--background)", borderColor: "var(--background)" } : undefined}
						onClick={() => setOwnerFilter(ownerFilter === "mine" ? "all" : "mine")}
					>
						{ownerFilter === "mine" ? "Showing my cases" : "My cases"}
					</button>
				)}
			</div>

			{view === "board" ? (
				<>
					<div className="cn-scaffold__filters" style={{ marginBottom: "0.75rem" }}>
						<div className="cn-scaffold__chips">
							{CHAPTER_FILTERS.map((c) => (
								<button key={c.id} type="button" onClick={() => setChapter(c.id)} className={`btn btn--sm ${chapter === c.id ? "btn--primary" : "btn--ghost"}`}>
									{c.label}
								</button>
							))}
						</div>
						<input type="search" placeholder="Search case ID, client, university…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input input--sm" />
					</div>
					<CaseBoard apps={filteredApps} onOpen={(app) => { setSelectedApp(app); setView("list"); }} />
				</>
			) : (
				<CaseScaffold
					onClose={() => setSelectedApp(null)}
					emptyHint="Select a case from the list to review it and take action."
					list={
						<>
							<div className="cn-scaffold__filters">
								<div className="cn-scaffold__chips">
									{CHAPTER_FILTERS.map((c) => (
										<button key={c.id} type="button" onClick={() => setChapter(c.id)} className={`btn btn--sm ${chapter === c.id ? "btn--primary" : "btn--ghost"}`}>
											{c.label}
										</button>
									))}
								</div>
								<div className="cn-scaffold__chips">
									{["All", "Under Review", "Accepted", "Action Required", "Rejected"].map((tab) => (
										<button key={tab} type="button" onClick={() => setStatusFilter(tab)} className={`btn btn--sm ${statusFilter === tab ? "btn--primary" : "btn--ghost"}`}>
											{tab === "All" ? "Any status" : (CASE_STATUS_LABELS[tab] ?? tab)}
										</button>
									))}
								</div>
								<input type="search" placeholder="Search case ID, client, university…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input input--sm" />
							</div>
							<div className="cn-scaffold__rows">
								{filteredApps.length === 0 ? (
									<div className="cn-scaffold__none">No cases match your filter.</div>
								) : (
									filteredApps.map((app) => {
										const isSelected = selectedApp?.appId === app.appId;
										const need = assignmentNeeded(app, handoffs);
										const todo = tasksForApplication(app, { handoffs, travelRequests, invoices: allInvoices }).length;
										return (
											<div
												key={app.id}
												role="button"
												tabIndex={0}
												onClick={() => setSelectedApp(app)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") setSelectedApp(app);
												}}
												className={`cn-row${isSelected ? " cn-row--selected" : ""}`}
											>
												<div className="cn-row__main">
													<div className="cn-row__top">
														<span className="cn-row__ref">{app.appId}</span>
														<StatusPill tone={app.status === "Accepted" ? "done" : app.status === "Rejected" ? "blocked" : "current"}>
															{CASE_STATUS_LABELS[app.status] ?? app.status}
														</StatusPill>
													</div>
													<p className="cn-row__name">{app.applicantName}</p>
													<p className="cn-row__sub">
														{app.university} · {app.program}
													</p>
													<div className="cn-row__meta">
														{app.assignedStaff ? (
															<StaffChatBadge opsUserId={opsUserIdByEmail(app.assignedStaffEmail)} name={app.assignedStaff} email={app.assignedStaffEmail} />
														) : (
															<span>Unassigned</span>
														)}
														<span> · </span>
														<RowMeta app={app} chapter={chapter} invoices={allInvoices} taStatus={taStatusOf(app)} />
														{canAssignWork && need && (
															<AssignChip label={need.kind === "handoff" ? "Assign owner" : "Assign"} onClick={() => setAssignFor(app)} />
														)}
														{todo > 0 && <span className="cn-row__needs">· {todo} to do</span>}
													</div>
												</div>
												<span className="cn-row__arrow" aria-hidden>
													→
												</span>
											</div>
										);
									})
								)}
							</div>
						</>
					}
					detail={liveSelected ? <CaseDetail app={liveSelected} initialTab={initialTab} /> : null}
				/>
			)}

			{assignFor && (
				<ApplicationAssignSheet
					app={applications.find((a) => a.id === assignFor.id) ?? assignFor}
					open
					onClose={() => setAssignFor(null)}
					onDone={(msg) => setActionSuccess(msg)}
				/>
			)}
		</div>
	);
}
