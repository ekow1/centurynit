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
import { FilterGroup } from "./FilterGroup";
import { useUrlParam } from "../hooks/useUrlParam";
import { useNow } from "../hooks/useNow";
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
import { caseHandlerName, tasksForApplication, taskActionLabel } from "../lib/pendingTasks";
import { ScopeChip } from "../components/ScopeRoute";
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

/** "Needs handler" sits beside the real statuses — it is the manager's cut. */
type StatusFilter = "All" | "needs-handler" | "Under Review" | "Accepted" | "Action Required" | "Rejected";
const STATUS_IDS = ["All", "needs-handler", "Under Review", "Accepted", "Action Required", "Rejected"] as const;

type SortId = "activity" | "oldest" | "name";
const SORT_IDS = ["activity", "oldest", "name"] as const;
const SORT_LABELS: Record<SortId, string> = { activity: "Last activity", oldest: "Oldest first", name: "Client A–Z" };

/** Days since the record last changed — falls back to the open date. */
function quietDays(app: MockApplication, now: number): number {
	const t = Date.parse(app.updatedAt ?? app.submittedDate ?? "");
	return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : 0;
}

/**
 * The filter pills speak the journey's stages. The old chapter ids stay as
 * the URL values (bookmarked links keep working); enrol and apply are the
 * two halves of Stage I — documents, then offers.
 */
const CHAPTER_LABEL: Record<ChapterId, string> = {
	consult: "0 · Consultation",
	enrol: "I · Documents",
	apply: "I · Offers",
	visa: "II · Visa",
	depart: "III · Departure",
	done: "Done",
};
const CHAPTER_FILTERS: { id: "all" | ChapterId; label: string }[] = [
	{ id: "all", label: "All" },
	...CHAPTERS.filter((c) => c.id !== "consult").map((c) => ({ id: c.id, label: CHAPTER_LABEL[c.id] })),
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
	const { applications, assignees, handoffs, travelRequests, error: casesError } = useCases();
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

	// Every filter is a URL param — a filtered list is a shareable link.
	const [statusFilter, setStatusFilter] = useUrlParam<StatusFilter>("status", { allowed: STATUS_IDS, fallback: "All" });
	const [ownerFilter, setOwnerFilter] = useUrlParam<"all" | "mine">("owner", { allowed: ["all", "mine"], fallback: "all" });
	const [branchFilter, setBranchFilter] = useUrlParam<string>("branch", { fallback: "all" });
	const [searchQuery, setSearchQuery] = useUrlParam("q");
	const [sort, setSort] = useUrlParam<SortId>("sort", { allowed: SORT_IDS, fallback: "activity" });
	const [boardOrder, setBoardOrder] = useState<BoardOrder>("age");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);
	const [actionSuccess, setActionSuccess] = useState<string | null>(null);

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

	// Search and scope apply before the chapter/status facets, so the chip
	// counts always say how much a choice would show.
	const searchScoped = roleScopedApps.filter((a) => {
		if (branchFilter !== "all" && a.branch !== branchFilter) return false;
		const q = searchQuery.toLowerCase();
		return (
			a.applicantName.toLowerCase().includes(q) ||
			a.appId.toLowerCase().includes(q) ||
			a.university.toLowerCase().includes(q) ||
			a.assignedStaff.toLowerCase().includes(q)
		);
	});
	const facetApps = ownerFilter === "mine" ? searchScoped.filter(isMine) : searchScoped;
	const chapterCounts = new Map(CHAPTER_FILTERS.map((f) => [f.id, facetApps.filter((a) => matchesChapter(a, f.id)).length]));
	const statusApps = facetApps.filter((a) => matchesChapter(a, chapter));
	const needsHandler = (a: MockApplication) => assignmentNeeded(a, handoffs);
	const statusCounts = new Map(
		STATUS_IDS.map((s) => [
			s,
			s === "All" ? statusApps.length : s === "needs-handler" ? statusApps.filter(needsHandler).length : statusApps.filter((a) => a.status === s).length,
		]),
	);

	const filteredApps = statusApps.filter((a) =>
		statusFilter === "All" ? true : statusFilter === "needs-handler" ? needsHandler(a) : a.status === statusFilter,
	);
	const now = useNow();
	const sortedApps = [...filteredApps].sort((a, b) =>
		sort === "name"
			? a.applicantName.localeCompare(b.applicantName)
			: sort === "oldest"
				? Date.parse(a.submittedDate) - Date.parse(b.submittedDate)
				: Date.parse(b.updatedAt ?? b.submittedDate) - Date.parse(a.updatedAt ?? a.submittedDate),
	);

	const unassignedCases = roleScopedApps.filter((a) => assignmentNeeded(a, handoffs)).length;
	const initialTab = chapter === "visa" ? "visa" : chapter === "depart" ? "travel" : chapter === "done" ? "payments" : undefined;

	// One filter row for both views — chapter, owner and status are all the
	// shared FilterGroup radiogroups: arrow keys, live counts, URL state.
	const filterChips = (
		<>
			<FilterGroup
				label="Stage"
				options={CHAPTER_FILTERS.map((c) => ({ id: c.id, label: c.label, count: chapterCounts.get(c.id) ?? 0 }))}
				value={chapter}
				onChange={(v) => setChapter(v)}
			/>
			{!requiresAssignmentScope && (
				<FilterGroup
					label="Owner"
					options={[
						{ id: "all" as const, label: "Everyone", count: searchScoped.length },
						{ id: "mine" as const, label: "Mine", count: searchScoped.filter(isMine).length },
					]}
					value={ownerFilter}
					onChange={setOwnerFilter}
				/>
			)}
			<FilterGroup
				label="Status"
				options={STATUS_IDS.map((s) => ({
					id: s,
					label: s === "needs-handler" ? "Needs handler" : s === "All" ? "All" : (CASE_STATUS_LABELS[s] ?? s),
					count: statusCounts.get(s) ?? 0,
					hot: s === "needs-handler" && (statusCounts.get("needs-handler") ?? 0) > 0,
				}))}
				value={statusFilter}
				onChange={setStatusFilter}
			/>
		</>
	);

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
				<div>
					<h1 className="page-title">Cases</h1>
					<p className="lead mt-1">Every client's journey — one list, by stage; open a case to work it.</p>
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
					{canSeeAll && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

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
							<strong>{unassignedCases}</strong> need{unassignedCases === 1 ? "s" : ""} a handler
						</span>
					</>
				)}
			</div>

			{view === "board" ? (
				<>
					<div className="cn-scaffold__filters" style={{ marginBottom: "0.75rem", border: "1px solid var(--border-light)" }}>
						<div className="cn-scaffold__chips">{filterChips}</div>
						<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
							<input type="search" placeholder="Search case ID, client, university…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value || null)} className="cn-search" style={{ flex: "1 1 14rem", width: "auto" }} />
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
					rail={
						<div style={{ padding: "0.75rem 0.9rem" }}>
							<p className="ops-dsec">Queue — nothing selected</p>
							<div className="ops-dkv"><span className="ops-dkv__k">Needs handler</span><span>{unassignedCases} {unassignedCases > 0 && `— oldest ${quietDays(roleScopedApps.filter(needsHandler).sort((a, b) => Date.parse(a.submittedDate) - Date.parse(b.submittedDate))[0] ?? roleScopedApps[0], now)}d`}</span></div>
							<div className="ops-dkv"><span className="ops-dkv__k">Stalled 7d+</span><span>{roleScopedApps.filter((a) => a.stage !== "completed" && quietDays(a, now) >= 7).length}</span></div>
							<div className="ops-dkv"><span className="ops-dkv__k">Awaiting client</span><span>{roleScopedApps.filter((a) => a.status === "Action Required").length}</span></div>
							<p className="ops-dsec" style={{ marginTop: "0.9rem" }}>By stage</p>
							{CHAPTER_FILTERS.filter((c) => c.id !== "all").map((c) => (
								<div className="ops-dkv" key={c.id}>
									<span className="ops-dkv__k">{c.label}</span>
									<span>{chapterCounts.get(c.id) ?? 0}</span>
								</div>
							))}
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.9rem" }}>Select a case to work it.</p>
						</div>
					}
					list={
						<>
							<div className="cn-scaffold__filters">
								<div className="cn-scaffold__chips">{filterChips}</div>
								<input
									type="search"
									placeholder="Search case ID, client, university…"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value || null)}
									className="cn-search"
									aria-label="Search cases"
								/>
								<div className="cn-scaffold__filter-row">
									<label className="cn-filter">
										<span className="cn-filter__label">Sort</span>
										<select className="cn-filter__select" value={sort} onChange={(e) => setSort(e.target.value as SortId)}>
											{SORT_IDS.map((s) => (
												<option key={s} value={s}>
													{SORT_LABELS[s]}
												</option>
											))}
										</select>
									</label>
								</div>
							</div>
							<div className="cn-scaffold__rows">
								{sortedApps.length === 0 ? (
									<div className="cn-scaffold__none">No cases match your filter.</div>
								) : (
									sortedApps.map((app) => {
										const isSelected = liveSelected?.id === app.id;
										const need = needsHandler(app);
										const tasks = tasksForApplication(app, { handoffs, travelRequests, invoices: allInvoices });
										const quiet = app.stage === "completed" ? 0 : quietDays(app, now);
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
														{need && <StatusPill tone="waiting">Needs handler</StatusPill>}
														<StatusPill tone={app.status === "Accepted" ? "done" : app.status === "Rejected" ? "blocked" : "current"}>
															{CASE_STATUS_LABELS[app.status] ?? app.status}
														</StatusPill>
													</div>
													<p className="cn-row__name">{app.applicantName}</p>
													<p className="cn-row__sub">
														{app.university} · {app.program}
														{tasks.length > 0 && <span> — <strong>{tasks[0].subtitle || taskActionLabel(tasks[0])}</strong></span>}
													</p>
													<ScopeChip scopeStages={app.scopeStages} className="cn-row__scope" />
													<div className="cn-row__meta">
														{(() => {
															const seatName = caseHandlerName(app);
															const seatEmail = app.assignedStaff ? app.assignedStaffEmail : (app.stageHandlers ?? []).find((h) => h.stage === app.stage)?.opsUserEmail;
															return seatName ? (
																<StaffChatBadge opsUserId={opsUserIdByEmail(seatEmail ?? "")} name={seatName} email={seatEmail} />
															) : (
																<span className="cn-row__unassigned">No handler</span>
															);
														})()}
														{canSeeAll && <span> · {branchName(app.branch)}</span>}
														<span> · </span>
														<RowMeta app={app} chapter={chapter} invoices={allInvoices} taStatus={taStatusOf(app)} />
														{app.journeyCoordinatorName && <span> · → {app.journeyCoordinatorName}</span>}
														{quiet >= 3 && <span> · quiet {quiet}d</span>}
														{tasks.length > 1 && <span className="cn-row__needs">· +{tasks.length - 1} more</span>}
														{canAssignWork && need && (
															<AssignChip label="Handler…" onClick={() => setAssignFor(app)} />
														)}
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
