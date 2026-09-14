import { useState } from "react";
import { CaseDetail } from "./case/CaseDetail";
import { CaseScaffold } from "./case/CaseScaffold";
import { CaseBoard, BOARD_ORDERS, type BoardOrder } from "./case/CaseBoard";
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

/** The chapter filter named in the URL, or "all" for anything unknown. */
function parseChapter(raw: string | null): "all" | ChapterId {
	return CHAPTER_FILTERS.some((c) => c.id === raw) ? (raw as "all" | ChapterId) : "all";
}

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

export function EnterpriseCases() {
	const [searchParams, setSearchParams] = useSearchParams();
	const { opsRole, opsUser, canSeeAllBranches, canAssignWork, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { applications, assignees, handoffs, travelRequests, error: casesError, addApplication } = useCases();
	const { invoices: allInvoices } = useInvoiceApi();
	// Assignment from the list: the card's chip opens the same sheet the detail uses.
	const [assignFor, setAssignFor] = useState<MockApplication | null>(null);

	// Chapter and view live in the URL (?chapter=visa&view=board), so a
	// filtered list is a link — bookmarkable, shareable, and the old /visa,
	// /travel and /workflow routes redirect here. Defaults are left off the URL.
	const chapter = parseChapter(searchParams.get("chapter"));
	const view: View = searchParams.get("view") === "board" ? "board" : "list";
	const setParam = (key: "chapter" | "view", value: string, fallback: string) =>
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			if (value === fallback) next.delete(key);
			else next.set(key, value);
			return next;
		}, { replace: true });
	const setChapter = (c: "all" | ChapterId) => setParam("chapter", c, "all");
	const setView = (v: View) => setParam("view", v, "list");

	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [boardOrder, setBoardOrder] = useState<BoardOrder>("age");
	const [ownerFilter, setOwnerFilter] = useState<"all" | "mine">("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);
	const [actionSuccess, setActionSuccess] = useState<string | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");
	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [isScholarshipModalOpen, setIsScholarshipModalOpen] = useState(false);

	// A `?id=` link selects the case directly — derived, not synced through an
	// effect, so closing the detail also clears the param.
	const queryId = searchParams.get("id");
	const queryMatch = queryId ? (applications.find((a) => a.id === queryId) ?? null) : null;
	const closeDetail = () => {
		setSelectedApp(null);
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			next.delete("id");
			return next;
		}, { replace: true });
	};

	const canSeeAll = canSeeAllBranches;
	const liveSelected = (selectedApp ? (applications.find((a) => a.appId === selectedApp.appId) ?? selectedApp) : null) ?? queryMatch;
	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;
	const isMine = (a: MockApplication) =>
		a.assignedStaffEmail === opsUser?.email ||
		a.assignedStaff === opsUser?.name ||
		(a.stageHandlers ?? []).some((h) => h.opsUserEmail === opsUser?.email);
	const taStatusOf = (a: MockApplication) => travelRequests.find((t) => t.applicationId === a.id)?.status ?? a.travelAssistanceStatus ?? null;

	const roleScopedApps = scopeRecords(applications, isMine);

	// A chapter view shows the cases in it and the ones past it that still
	// have that chapter's work open (a visa case in Departure). Closed cases
	// live under Complete only.
	const CHAPTER_ORDER = CHAPTERS.map((x) => x.id);
	const matchesChapter = (a: MockApplication, ch: "all" | ChapterId): boolean => {
		if (ch === "all") return true;
		const c = chapterOf(a);
		if (c === "done") return ch === "done";
		const inOrPast = CHAPTER_ORDER.indexOf(c) >= CHAPTER_ORDER.indexOf(ch);
		if (ch === "visa") {
			return inOrPast || Boolean(a.visaStage && a.visaStage !== "locked") || Boolean(visaInvoiceFor(allInvoices, a));
		}
		return inOrPast;
	};

	const STATUS_FILTERS = ["All", "Under Review", "Accepted", "Action Required", "Rejected"] as const;

	// Search and scope apply before the chapter/status facets, so the select
	// counts always say how much a choice would show.
	const facetApps = roleScopedApps.filter((a) => {
		if (branchFilter !== "all" && a.branch !== branchFilter) return false;
		if (ownerFilter === "mine" && !isMine(a)) return false;
		const q = searchQuery.toLowerCase();
		return (
			a.applicantName.toLowerCase().includes(q) ||
			a.appId.toLowerCase().includes(q) ||
			a.university.toLowerCase().includes(q) ||
			a.assignedStaff.toLowerCase().includes(q)
		);
	});
	const chapterCounts = new Map(CHAPTER_FILTERS.map((f) => [f.id, facetApps.filter((a) => matchesChapter(a, f.id)).length]));
	const statusApps = facetApps.filter((a) => matchesChapter(a, chapter));
	const statusCounts = new Map(STATUS_FILTERS.map((s) => [s, s === "All" ? statusApps.length : statusApps.filter((a) => a.status === s).length]));

	const filteredApps = statusApps.filter((a) => statusFilter === "All" || a.status === statusFilter);

	const unassignedCases = roleScopedApps.filter((a) => assignmentNeeded(a, handoffs)).length;
	const initialTab = chapter === "visa" ? "visa" : chapter === "depart" ? "travel" : chapter === "done" ? "payments" : undefined;

	// The same chapter pills in list and board — one control, two homes.
	const chapterPills = (
		<div className="cn-scaffold__chips" role="tablist" aria-label="Chapter" style={{ flexWrap: "wrap" }}>
			{CHAPTER_FILTERS.map((c) => {
				const n = chapterCounts.get(c.id) ?? 0;
				const on = chapter === c.id;
				return (
					<button
						key={c.id}
						type="button"
						role="tab"
						aria-selected={on}
						className="ops-pill"
						onClick={() => setChapter(c.id)}
						style={{
							cursor: "pointer",
							marginLeft: 0,
							border: "1px solid var(--border)",
							background: on ? "var(--foreground)" : "transparent",
							color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
						}}
					>
						{c.label}
						<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
							{n}
						</span>
					</button>
				);
			})}
		</div>
	);

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

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span className="dash-day__cut">
					<strong>{filteredApps.length}</strong> of {roleScopedApps.length} cases
				</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut">
					{canSeeAll
						? `${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
						: requiresAssignmentScope
							? "assigned to you"
							: `${branchName(opsUser?.branch ?? "")} branch`}
				</span>
				{canAssignWork && unassignedCases > 0 && (
					<>
						<span className="dash-day__sep">·</span>
						<span className="dash-day__cut">
							<strong>{unassignedCases}</strong> need{unassignedCases === 1 ? "s" : ""} an owner
						</span>
					</>
				)}
				{!requiresAssignmentScope && (
					<>
						<span className="dash-day__sep">·</span>
						<button type="button" className="dash-day__cut" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", textTransform: "inherit", letterSpacing: "inherit" }} onClick={() => setOwnerFilter(ownerFilter === "mine" ? "all" : "mine")}>
							{ownerFilter === "mine" ? <strong>My cases · on</strong> : "My cases"}
						</button>
					</>
				)}
			</div>

			{view === "board" ? (
				<>
					<div className="cn-scaffold__filters" style={{ marginBottom: "0.75rem", border: "1px solid var(--border-light)" }}>
						{chapterPills}
						<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
							<input type="search" placeholder="Search case ID, client, university…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="cn-search" style={{ flex: "1 1 14rem", width: "auto" }} />
							<label className="cn-filter">
								<span className="cn-filter__label">Order</span>
								<select className="cn-filter__select" value={boardOrder} onChange={(e) => setBoardOrder(e.target.value as BoardOrder)}>
									{BOARD_ORDERS.map((o) => (
										<option key={o.id} value={o.id}>
											{o.label}
										</option>
									))}
								</select>
							</label>
						</div>
					</div>
					<CaseBoard
						apps={filteredApps}
						chapter={chapter}
						order={boardOrder}
						onOpen={(app) => { setSelectedApp(app); setView("list"); }}
						onAssign={canAssignWork ? (app) => setAssignFor(app) : undefined}
					/>
				</>
			) : (
				<CaseScaffold
					onClose={closeDetail}
					emptyHint="Select a case from the list to review it and take action."
					list={
						<>
							<div className="cn-scaffold__filters">
								{chapterPills}
								<input
									type="search"
									placeholder="Search case ID, client, university…"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="cn-search"
									aria-label="Search cases"
								/>
								<div className="cn-scaffold__filter-row">
									<label className="cn-filter">
										<span className="cn-filter__label">Status</span>
										<select
											className="cn-filter__select"
											value={statusFilter}
											onChange={(e) => setStatusFilter(e.target.value)}
										>
											{STATUS_FILTERS.map((s) => (
												<option key={s} value={s}>
													{s === "All" ? "Any" : (CASE_STATUS_LABELS[s] ?? s)} · {statusCounts.get(s) ?? 0}
												</option>
											))}
										</select>
									</label>
								</div>
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
															<span className="cn-row__unassigned">No owner</span>
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
