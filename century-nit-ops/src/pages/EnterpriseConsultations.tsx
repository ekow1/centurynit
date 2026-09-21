import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { CaseScaffold } from "./case/CaseScaffold";
import { ConsultationDetail } from "./case/ConsultationDetail";
import { StatusPill } from "century-nit-core/ui";
import { AssignSheet } from "./case/AssignSheet";
import { AssignChip } from "./case/ApplicationAssignSheet";
import type { MockConsultation } from "century-nit-core/ops";
import { Toast } from "./OpsDialogs";
import { FilterGroup } from "./FilterGroup";
import { useUrlParam } from "../hooks/useUrlParam";
import { useNow } from "../hooks/useNow";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import { StaffChatBadge } from "./StaffChatBadge";

/** Placeholder values shouldn't be joined into a meta line as bare em-dashes */
function isKnown(v: string | undefined | null): v is string {
	const s = (v ?? "").trim();
	return s !== "" && s !== "-" && s !== "-";
}

const STATUS_IDS = ["All", "Under Review", "Assigned", "Confirmed", "Reschedule asked", "In Assessment", "Completed", "Cancelled"] as const;
/** First-scan cuts that live on the main row; the seven real statuses sit one click deep in the Filters drawer. */
const PSEUDO_CUTS = ["Needs action", "Today"] as const;
const STATUS_PARAM_IDS = [...STATUS_IDS, ...PSEUDO_CUTS] as const;
type StatusFilter = (typeof STATUS_PARAM_IDS)[number];
/** Cuts whose selection opens the drawer automatically. */
const MAIN_CUT_IDS: readonly StatusFilter[] = ["All", "Needs action", "Today"];

const isOnline = (c: MockConsultation) => c.type?.toLowerCase() === "online";
/** YYYY-MM-DD in local time — what the diary bands compare against. */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOf = (c: MockConsultation) => c.slotDate ?? (c.startsAt ? localDay(new Date(c.startsAt)) : null);
const startMs = (c: MockConsultation) => Date.parse(c.startsAt ?? "") || 0;

type Band = "action" | "today" | "upcoming" | "done";
const BAND_ORDER: Band[] = ["action", "today", "upcoming", "done"];
const BAND_LABELS: Record<Band, string> = {
	action: "Needs action",
	today: "Today",
	upcoming: "Upcoming",
	done: "Done & closed",
};
const bandOf = (c: MockConsultation, today: string): Band => {
	if (c.status === "Completed" || c.status === "Cancelled") return "done";
	if (c.status === "Under Review" || c.rescheduleRequestedAt) return "action";
	return dayOf(c) === today ? "today" : "upcoming";
};

/** The slot's hour in the booked zone — off-hours slots get flagged, not hidden. */
function slotHour(c: MockConsultation): number | null {
	if (!c.startsAt) return null;
	try {
		return Number(
			new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: c.timezone ?? undefined }).format(new Date(c.startsAt)),
		);
	} catch {
		return null;
	}
}
const isOffHours = (c: MockConsultation) => {
	const h = slotHour(c);
	return h !== null && (h < 7 || h >= 19);
};

/** The call's state words for a row — same vocabulary the detail strip uses. */
function callState(c: MockConsultation, today: string, now: number): string | null {
	if (!isOnline(c)) return null;
	if (c.status === "In Assessment") return "call running";
	if (c.status !== "Confirmed" && c.status !== "Assigned") return null;
	if (dayOf(c) !== today || !c.startsAt) return c.meetingLink ? "room ready" : "online";
	const opensAt = startMs(c) - 30 * 60_000;
	if (now >= opensAt) return "joinable now";
	return `join opens ${new Date(opensAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function EnterpriseConsultations() {
	const [searchParams, setSearchParams] = useSearchParams();
	const { opsRole, opsUser, canSeeAllBranches, canAssignWork, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { consultations, assignees, assignConsultation, referConsultation, error: casesError } = useCases();
	// Assignment from the list: the card's chip opens the same control the detail uses.
	const [assignFor, setAssignFor] = useState<MockConsultation | null>(null);
	const [selectedConsultation, setSelectedConsultation] = useState<MockConsultation | null>(null);

	// Every control is a URL param — a filtered diary is a shareable link.
	const [statusFilter, setStatusFilter] = useUrlParam<StatusFilter>("status", { allowed: STATUS_PARAM_IDS, fallback: "All" });
	const [ownerFilter, setOwnerFilter] = useUrlParam<"all" | "mine">("owner", { allowed: ["all", "mine"], fallback: "all" });
	// Where the client said they are on the journey — a visa entrant is a
	// different consultation from an admissions one, and staffed differently.
	const [entryFilter, setEntryFilter] = useUrlParam<"all" | "admissions" | "visa" | "departure">("entry", { allowed: ["all", "admissions", "visa", "departure"], fallback: "all" });
	const entryOf = (c: MockConsultation): "admissions" | "visa" | "departure" => (c.entryIntent === "visa" || c.entryIntent === "departure" ? c.entryIntent : "admissions");
	const [branchFilter, setBranchFilter] = useUrlParam<string>("branch", { fallback: "all" });
	const [searchQuery, setSearchQuery] = useUrlParam("q");
	const now = useNow();
	// The drawer auto-opens while one of its facets is set, so a deep link
	// like ?status=Under%20Review shows where the cut came from.
	const drawerActive = !MAIN_CUT_IDS.includes(statusFilter);
	const [drawerToggled, setDrawerToggled] = useState<boolean | null>(null);
	const drawerOpen = drawerToggled ?? drawerActive;
	const setDrawerOpen = () => setDrawerToggled(!drawerOpen);

	const queryId = searchParams.get("id");
	// Closing also clears ?id= so the deep link doesn't reopen the detail.
	const closeDetail = () => {
		setSelectedConsultation(null);
		if (queryId) {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				next.delete("id");
				return next;
			}, { replace: true });
		}
	};
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const showToast = (type: "error" | "success", message: string) => setToast({ type, message });
	/* Date, slot and reason now live inside ReschedulePanel */

	const canSeeAll = canSeeAllBranches;
	const reviewCount = consultations.filter((c) => c.status === "Under Review").length;

	const isMine = useCallback(
		(c: MockConsultation) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
		[opsUser],
	);
	const roleScopedConsultations = useMemo(() => scopeRecords(consultations, isMine), [scopeRecords, consultations, isMine]);

	const today = localDay(new Date());
	const matchesStatus = (c: MockConsultation, s: StatusFilter) =>
		s === "All"
			? true
			: s === "Needs action"
				? // Under Review is a manager's queue — for a consultant the cut is just reschedule asks.
					(canAssignWork && c.status === "Under Review") || Boolean(c.rescheduleRequestedAt)
				: s === "Today"
					? bandOf(c, today) === "today"
					: s === "Reschedule asked"
						? Boolean(c.rescheduleRequestedAt)
						: c.status === s;

	// Search and branch apply before the status facet so each option's count
	// says how much choosing it would show.
	const searchScoped = roleScopedConsultations.filter((c) => {
		if (branchFilter !== "all" && c.branch !== branchFilter) return false;
		const q = searchQuery.toLowerCase();
		return (
			c.applicantName.toLowerCase().includes(q) ||
			c.ref.toLowerCase().includes(q) ||
			c.targetCountry.toLowerCase().includes(q) ||
			c.assignedOfficer.toLowerCase().includes(q)
		);
	});
	const statusCounts = new Map(STATUS_PARAM_IDS.map((s) => [s, searchScoped.filter((c) => matchesStatus(c, s)).length]));
	const filteredConsultations = searchScoped.filter((c) => (ownerFilter === "mine" ? isMine(c) : true) && matchesStatus(c, statusFilter) && (entryFilter === "all" || entryOf(c) === entryFilter));

	const bands = BAND_ORDER.map((band) => ({
		band,
		rows: filteredConsultations.filter((c) => bandOf(c, today) === band).sort((a, b) => startMs(a) - startMs(b)),
	})).filter((g) => g.rows.length > 0);

	const liveSelected = selectedConsultation
		? consultations.find((c) => c.id === selectedConsultation.id) ?? selectedConsultation
		: queryId
			? consultations.find((c) => c.id === queryId) ?? null
		: null;


	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem" }}>
				<div>
					<h1 className="page-title">Consultations</h1>
					<p className="lead mt-1">
						Bookings arrive from the client portal. {canAssignWork ? "Place a handler to begin the assessment." : "You see the ones assigned to you."}
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{reviewCount > 0 && canAssignWork && (
						<span className="portal-pill" style={{ background: "var(--foreground)", color: "var(--background)", whiteSpace: "nowrap" }}>
							{reviewCount} awaiting assignment
						</span>
					)}
					{canSeeAll && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			{casesError ? <p className="ops-modal__error" role="alert">{casesError}</p> : null}

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span className="dash-day__cut">
					<strong>{filteredConsultations.length}</strong> of {roleScopedConsultations.length} consultations
				</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut">
					{canSeeAll
						? `${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
						: requiresAssignmentScope
							? "assigned to you"
							: `${branchName(opsUser?.branch ?? "")} branch`}
				</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut">
					<strong>{bands.find((b) => b.band === "today")?.rows.length ?? 0}</strong> today
				</span>
			</div>

			<CaseScaffold
				onClose={closeDetail}
				emptyHint="Select a consultation from the list to view the full assessment workflow."
				bar={
					liveSelected ? (
						<span className="cn-filter__label">
							{liveSelected.ref} · {liveSelected.status}
						</span>
					) : null
				}
				rail={
					<div style={{ padding: "0.75rem 0.9rem" }}>
						<p className="ops-dsec">Today — nothing selected</p>
						<div className="ops-dkv"><span className="ops-dkv__k">Live now</span><span>{searchScoped.filter((c) => c.status === "In Assessment" && isOnline(c) && dayOf(c) === today).length}</span></div>
						<div className="ops-dkv"><span className="ops-dkv__k">Up next</span><span>{searchScoped.filter((c) => bandOf(c, today) === "today" && startMs(c) > now).length} still to come</span></div>
						<div className="ops-dkv"><span className="ops-dkv__k">Awaiting handler</span><span>{searchScoped.filter((c) => !c.assignedOfficer && c.status !== "Completed" && c.status !== "Cancelled").length}</span></div>
						<div className="ops-dkv"><span className="ops-dkv__k">Reschedule</span><span>{searchScoped.filter((c) => c.rescheduleRequestedAt).length} asked</span></div>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.9rem" }}>Select a consultation to work it.</p>
					</div>
				}
				list={
					<>
						<div className="cn-scaffold__filters">
							{/* One row: the triage cuts, Mine, the drawer toggle, search.
							    The seven real statuses sit one click deep. */}
							<div className="cn-scaffold__chips">
								<FilterGroup
									label="Queue"
									options={MAIN_CUT_IDS.map((s) => ({
										id: s,
										label: s,
										count: statusCounts.get(s) ?? 0,
										hot: s === "Needs action" && (statusCounts.get(s) ?? 0) > 0,
									}))}
									value={statusFilter}
									onChange={setStatusFilter}
								/>
								<FilterGroup
									label="Entry"
									options={[
										{ id: "all" as const, label: "Any entry", count: searchScoped.length },
										{ id: "admissions" as const, label: "Admissions", count: searchScoped.filter((c) => entryOf(c) === "admissions").length },
										{ id: "visa" as const, label: "Enter at Visa", count: searchScoped.filter((c) => entryOf(c) === "visa").length, hot: searchScoped.some((c) => entryOf(c) === "visa" && !c.assignedOfficer) },
										{ id: "departure" as const, label: "Enter at Departure", count: searchScoped.filter((c) => entryOf(c) === "departure").length },
									]}
									value={entryFilter}
									onChange={setEntryFilter}
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
								<button
									type="button"
									className={`ops-pill ops-pill--chip${drawerActive ? " ops-pill--hot" : ""}`}
									style={{ borderStyle: "dashed" }}
									aria-expanded={drawerOpen}
									aria-controls="consultation-filter-drawer"
									onClick={setDrawerOpen}
								>
									Filters {drawerOpen ? "▴" : "▾"}
								</button>
								<input
									type="search"
									placeholder="Search applicant, ref, country…"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value || null)}
									className="cn-search"
									aria-label="Search consultations"
									style={{ flex: "1 1 12rem", width: "auto", marginLeft: "auto" }}
								/>
							</div>
							{drawerOpen && (
								<div
									id="consultation-filter-drawer"
									className="cn-scaffold__filter-row"
									style={{ flexWrap: "wrap", gap: "0.5rem", background: "var(--muted)" }}
								>
									<span style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
										<span className="cn-filter__label">Status</span>
										<FilterGroup
											label="Status"
											options={STATUS_IDS.filter((s) => s !== "All" && (canAssignWork || s !== "Under Review")).map((s) => ({
												id: s,
												label: s,
												count: statusCounts.get(s) ?? 0,
											}))}
											value={statusFilter}
											onChange={setStatusFilter}
										/>
									</span>
								</div>
							)}
						</div>
						<div className="cn-scaffold__rows">
							{bands.length === 0 ? (
								<div className="cn-scaffold__none">No consultations match your filter.</div>
							) : (
								bands.map(({ band, rows }) => (
									<div key={band}>
										<div className="cn-band" style={{ display: "flex", justifyContent: "space-between" }}>
											<span>{BAND_LABELS[band]} · {rows.length}</span>
											{band === "action" && <span>action required</span>}
										</div>
										{rows.map((c) => {
											const isSelected = liveSelected?.id === c.id;
											const requested = c.requestedDocuments?.length ?? 0;
											const docsToReview = c.documentChecklist?.filter((d) => d.status === "UPLOADED").length ?? 0;
											const call = callState(c, today, now);
											return (
												<div
													key={c.id}
													role="button"
													tabIndex={0}
													onClick={() => setSelectedConsultation(c)}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") setSelectedConsultation(c);
													}}
													className={`cn-row${isSelected ? " cn-row--selected" : ""}`}
												>
													<div className="cn-row__main">
														<div className="cn-row__top">
															<span className="cn-row__ref">{c.ref}</span>
															{c.rescheduleRequestedAt && (
																<StatusPill tone="waiting">Reschedule asked</StatusPill>
															)}
															<StatusPill tone={c.status === "Completed" ? "done" : c.status === "Cancelled" ? "void" : c.status === "Under Review" ? "waiting" : "current"}>
																{c.status}
															</StatusPill>
															{isOffHours(c) && <StatusPill tone="waiting">off-hours — verify</StatusPill>}
															{entryOf(c) !== "admissions" && <StatusPill tone="current">{entryOf(c) === "visa" ? "enter at Visa · brings an offer" : "enter at Departure · brings a visa"}</StatusPill>}
															<span className="cn-row__chan">
																{isOnline(c) ? `◉ ${call ?? "online"}` : "◎ in person"}
															</span>
														</div>
														<p className="cn-row__name">{c.applicantName}</p>
														<p className="cn-row__sub">
															{c.rescheduleRequestedAt && c.rescheduleRequestedStartsAt
																? `${c.dateTime} → ${new Date(c.rescheduleRequestedStartsAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
																: c.dateTime}
															{[c.targetCountry, c.type].filter(isKnown).length ? ` · ${[c.targetCountry].filter(isKnown).join(" · ")}` : ""}
														</p>
														<div className="cn-row__meta">
															{c.assignedOfficer ? (
																<StaffChatBadge opsUserId={opsUserIdByEmail(c.assignedOfficerEmail)} name={c.assignedOfficer} email={c.assignedOfficerEmail} />
															) : (
																<span className="cn-row__unassigned">No handler</span>
															)}
															{canAssignWork && !c.assignedOfficer && c.status !== "Completed" && c.status !== "Cancelled" && (
																<AssignChip onClick={() => setAssignFor(c)} />
															)}
															{c.coordinatorName && <span> · → {c.coordinatorName}</span>}
															{requested > 0 && <span> · {requested} document{requested === 1 ? "" : "s"} requested</span>}
															{docsToReview > 0 && <span> · {docsToReview} to review</span>}
														</div>
													</div>
													<span className="cn-row__arrow" aria-hidden>→</span>
												</div>
											);
										})}
									</div>
								))
							)}
						</div>
					</>
				}
				detail={
					liveSelected ? (
						<ConsultationDetail consultation={liveSelected} onToast={showToast} onClosed={closeDetail} />
					) : null
				}
			/>
			{assignFor && (
				<AssignSheet
					open
					onClose={() => setAssignFor(null)}
					title={assignFor.assignedOfficer ? "Change handler" : "Handler · Consultation"}
					stage="consultation"
					staff={assignees}
					branch={assignFor.branch}
					currentName={assignFor.assignedOfficer || null}
					// A visa entrant is best read by someone who can own the visa chapter;
					// a departure entrant by travel staff. Preferred, not required.
					preferCapability={entryOf(assignFor) === "visa" ? "own:visa" : entryOf(assignFor) === "departure" ? "own:depart" : undefined}
					coverage
					onAssign={async ({ opsUserId, scope, branch }) => {
						const to = assignees.find((a) => a.opsUserId === opsUserId);
						if (!to) throw new Error("That staff member is no longer available");
						await assignConsultation(assignFor.id, to, { scope, branch });
						showToast("success", scope === "all" ? "Handler placed — carries the case it opens." : "Handler placed.");
					}}
					onLeaveOpen={async (branch) => {
						await referConsultation(assignFor.id, branch);
						showToast("success", "Referred — left open for the branch to staff.");
					}}
				/>
			)}
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
