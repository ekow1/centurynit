import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useCases } from "../hooks/useCases";
import { useUrlParam } from "../hooks/useUrlParam";
import { useOpsAuth } from "./OpsAuthContext";
import { useChatHub } from "./ChatHubContext";
import { UnassignedQueue } from "./UnassignedBookings";
import { OPS_BRANCHES } from "century-nit-core/ops";
import { calendarApi, type CalendarStatus } from "century-nit-core/api";
import { Sheet } from "century-nit-core/ui";
import { DelegateSheet } from "./case/DelegateSheet";
import { Toast } from "./OpsDialogs";
import { API_PREFIX, CHAPTERS_ORDERED, chapterProgress, type ChapterKey } from "century-nit-shared";
import { gateFor, normaliseStage } from "../lib/caseGate";
import { apiFetch } from "../lib/api";
import { ScopeChip } from "../components/ScopeRoute";
import type { PendingTask } from "../lib/pendingTasks";
import { FilterGroup } from "./FilterGroup";
import { PreviewPane } from "./TaskPreview";

/**
 * The Workspace's Caseload view — who carries what, and where each case
 * sits. Same records as the Worklist, same `scopeRecords` scoping: a
 * manager sees the team, a consultant sees their own load.
 *
 * Read top to bottom: the records nobody owns, the officer strip (click a
 * card to narrow the page to them and open their record), then every record
 * as client cards in stage bands — consultations first, then the journey's
 * stages in order, completed folded away at the end. A card opens the same
 * task preview the worklist uses when the record has a pending task.
 *
 * All of it lives in the URL (`?chip=&officer=&branch=&q=&done=&row=`), so
 * a refresh keeps the officer being inspected and a link can point at one.
 *
 * Stalled: no movement for a week on a record that isn't done.
 */

const STALLED_AFTER_DAYS = 7;

/**
 * Bands are the chapters — the one numbering (I–VI) the case detail, the
 * board and the list filters use. A consultation is chapter I; a case sits
 * in the chapter its journey stage belongs to; `payment_execution` (folded
 * into Departure by 0079) never gets a band of its own.
 */
type Band = ChapterKey;
const BAND_ORDER: Band[] = CHAPTERS_ORDERED.map((c) => c.id);
const BAND_LABEL: Record<Band, string> = Object.fromEntries(CHAPTERS_ORDERED.map((c) => [c.id, `${c.numeral} · ${c.label}`])) as Record<Band, string>;
/** The four working chapters — what the officer strip is made of. */
const FLIGHT_CHAPTERS: ChapterKey[] = ["enrolment", "applications", "visa", "departure"];
const CHAPTER_SHORT: Record<ChapterKey, string> = { consultation: "I", enrolment: "II", applications: "III", visa: "IV", departure: "V", complete: "VI" };

type Row = {
	id: string;
	kind: "case" | "consultation";
	band: Band;
	done: boolean;
	reference: string;
	clientName: string;
	clientEmail: string | null;
	branch: string;
	/** The applicant behind the record — journey delegation targets it. */
	applicantId: string | null;
	/** Who steers the whole journey, when the applicant has been delegated. */
	journeyCoordinatorName: string | null;
	staffId: string | null;
	staffName: string | null;
	stageLabel: string;
	step: number;
	total: number;
	sub: string;
	/** The case's plan — the scope chip; null on consultations. */
	scopeStages: string[] | null;
	updatedAt: string;
	/** Days without movement when stalled; 0 otherwise. */
	stalled: number;
	/** Whose move it is while stalled — Century's or the client's — from the case's gate. */
	stalledOn: "us" | "client" | null;
	/** The case sits in its plan's last working chapter. */
	atExit: boolean;
	link: string;
};

const CONSULTATION_STEP: Record<string, number> = {
	"Under Review": 1,
	Assigned: 2,
	Confirmed: 2,
	"In Assessment": 3,
	Completed: 4,
	Cancelled: 0,
};

function relativeTime(iso: string) {
	if (!iso) return "—";
	const diff = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(diff)) return "—";
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	if (hours < 24) return `${hours} h ago`;
	if (days < 7) return `${days} d ago`;
	return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function stalledDays(updatedAt: string, done: boolean): number {
	if (done || !updatedAt) return 0;
	const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
	return Number.isNaN(days) || days < STALLED_AFTER_DAYS ? 0 : days;
}

type Chip = "all" | "case" | "consultation" | "stalled" | "stalled_us" | "stalled_client" | "completed";
const CHIPS: { id: Chip; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "case", label: "Cases" },
	{ id: "consultation", label: "Consultations" },
	{ id: "stalled_us", label: "Waiting on us" },
	{ id: "stalled_client", label: "Waiting on client" },
	{ id: "completed", label: "Completed" },
];
const CHIP_IDS = CHIPS.map((c) => c.id);

export function WorkspaceCaseload({ tasks = [] }: { tasks?: PendingTask[] }) {
	const { scopeRecords, opsUser, canSeeAllBranches, canAssignWork } = useOpsAuth();
	const {
		applications,
		consultations,
		assignees,
		handoffs,
		loading,
		error,
		refresh: refreshCases,
		assignConsultation,
		assignApplication,
		referConsultation,
		referApplication,
		resolveHandoff,
		deferHandoff,
	} = useCases();
	const { openDM } = useChatHub();
	// Every control is a URL param — the branch and search deliberately share
	// the worklist's keys so they carry across the tab switch.
	const [chip, setChip] = useUrlParam<Chip>("chip", { allowed: CHIP_IDS, fallback: "all" });
	const [staff, setStaff] = useUrlParam<string>("officer", { fallback: "all" });
	const [branch, setBranch] = useUrlParam<string>("branch", { fallback: "all" });
	const [search, setSearch] = useUrlParam("q");
	const [doneParam, setDoneParam] = useUrlParam("done");
	const [rowParam, setRowParam] = useUrlParam("row");
	const showCompleted = doneParam === "1";
	const [staffHours, setStaffHours] = useState<Record<string, CalendarStatus["workingHours"]>>({});
	const [delegateFor, setDelegateFor] = useState<{ id: string; name: string; journeyCoordinatorName: string | null } | null>(null);
	// One number turns the officer strip into the answer to its own question.
	const [capacity, setCapacity] = useState(15);
	useEffect(() => {
		let alive = true;
		apiFetch<{ officerCapacity: number }>(`${API_PREFIX}/settings/ops-config`)
			.then((r) => { if (alive && r.officerCapacity > 0) setCapacity(r.officerCapacity); })
			.catch(() => {});
		return () => { alive = false; };
	}, []);
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	// Week hours are only needed once an officer's record opens — fetch lazily.
	const hoursLoaded = useRef(false);
	useEffect(() => {
		if (staff === "all" || hoursLoaded.current) return;
		hoursLoaded.current = true;
		calendarApi
			.staffWorkingHours()
			.then((r) => setStaffHours(Object.fromEntries(r.staff.map((s) => [s.opsUserId, s.hours]))))
			.catch(() => {
				hoursLoaded.current = false;
			});
	}, [staff]);

	const staffIdByEmail = (email: string | null | undefined) => (email ? (assignees.find((a) => a.email === email)?.opsUserId ?? null) : null);

	/** The unified rows from the shared stores — no separate API call. */
	const rows = useMemo<Row[]>(() => {
		const scopedApps = scopeRecords(applications, (a) => Boolean(a.assignedStaffEmail || a.assignedStaff));
		const scopedCons = scopeRecords(consultations, (c) => Boolean(c.assignedOfficerEmail || c.assignedOfficer));
		const out: Row[] = [];
		for (const a of scopedApps) {
			const stage = normaliseStage(a.stage);
			const done = stage === "completed";
			const open = a.checklist.filter((c) => !c.checked).length;
			const updatedAt = a.updatedAt ?? a.submittedDate;
			// Progress in the chapters on this plan, and whose move it is.
			const progress = chapterProgress(a.scopeStages ?? null, stage);
			const gate = done ? null : gateFor(a);
			const stalled = stalledDays(updatedAt, done);
			out.push({
				id: a.id,
				kind: "case",
				band: progress.key,
				done,
				reference: a.appId,
				clientName: a.applicantName,
				clientEmail: a.email,
				branch: a.branch,
				applicantId: a.applicantId,
				journeyCoordinatorName: a.journeyCoordinatorName ?? null,
				staffId: staffIdByEmail(a.assignedStaffEmail),
				staffName: a.assignedStaff || null,
				stageLabel: `${progress.numeral} · ${progress.label}${gate && gate.kind !== "ready" ? ` · ${gate.label}` : gate?.kind === "ready" && gate.next === "completed" ? " · ready to complete" : ""}`,
				step: progress.step,
				total: progress.total,
				sub: [a.university || "No university yet", a.status, open > 0 ? `${open} checklist item${open === 1 ? "" : "s"} open` : null].filter(Boolean).join(" · "),
				scopeStages: a.scopeStages ?? null,
				updatedAt,
				stalled,
				stalledOn: stalled > 0 && gate ? (gate.kind === "wait" ? "client" : "us") : null,
				atExit: progress.atExit && !done,
				link: `/applications?id=${a.id}`,
			});
		}
		for (const c of scopedCons) {
			const done = c.status === "Completed" || c.status === "Cancelled";
			const updatedAt = c.updatedAt ?? "";
			out.push({
				id: c.id,
				kind: "consultation",
				band: done ? "complete" : "consultation",
				done,
				reference: c.ref,
				clientName: c.applicantName,
				clientEmail: c.email,
				branch: c.branch,
				applicantId: c.applicantId,
				journeyCoordinatorName: c.coordinatedVia === "applicant" ? (c.coordinatorName ?? null) : null,
				staffId: staffIdByEmail(c.assignedOfficerEmail),
				staffName: c.assignedOfficer || null,
				stageLabel: c.status,
				step: CONSULTATION_STEP[c.status] ?? 1,
				total: 4,
				sub: [c.type, c.targetCountry || null, c.dateTime].filter(Boolean).join(" · "),
				scopeStages: null,
				updatedAt,
				stalled: stalledDays(updatedAt, done),
				// A consultation waits on Century until it is held; the assessment is ours too.
				stalledOn: stalledDays(updatedAt, done) > 0 ? "us" : null,
				atExit: false,
				link: `/consultations?id=${c.id}`,
			});
		}
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps -- staffIdByEmail is stable per render
	}, [applications, consultations, scopeRecords, assignees]);

	/** Every officer carrying something open: load, stage mix, what has stalled. */
	/** Cases each officer steers as coordinator — delegated work, not theirs. */
	const coordinating = useMemo(() => {
		const m = new Map<string, number>();
		for (const c of consultations) {
			if (c.coordinatorId && c.status !== "Completed" && c.status !== "Cancelled") {
				m.set(c.coordinatorId, (m.get(c.coordinatorId) ?? 0) + 1);
			}
		}
		for (const a of applications) {
			if (a.journeyCoordinatorEmail && a.stage !== "completed") {
				const id = staffIdByEmail(a.journeyCoordinatorEmail);
				if (id) m.set(id, (m.get(id) ?? 0) + 1);
			}
		}
		return m;
		// eslint-disable-next-line react-hooks/exhaustive-deps -- staffIdByEmail is stable per render
	}, [consultations, applications, assignees]);

	const officers = useMemo(() => {
		const map = new Map<string, { id: string; name: string; cases: number; consultations: number; stalled: number; stalledUs: number; stalledClient: number; stages: number[] }>();
		for (const r of rows) {
			if (r.done || !r.staffId || !r.staffName) continue;
			const o = map.get(r.staffId) ?? { id: r.staffId, name: r.staffName, cases: 0, consultations: 0, stalled: 0, stalledUs: 0, stalledClient: 0, stages: FLIGHT_CHAPTERS.map(() => 0) };
			if (r.kind === "case") {
				o.cases++;
				const i = FLIGHT_CHAPTERS.indexOf(r.band);
				if (i >= 0) o.stages[i]++;
			} else o.consultations++;
			if (r.stalled) {
				o.stalled++;
				if (r.stalledOn === "client") o.stalledClient++;
				else o.stalledUs++;
			}
			map.set(r.staffId, o);
		}
		return [...map.values()].sort((a, b) => b.cases + b.consultations - (a.cases + a.consultations) || a.name.localeCompare(b.name));
	}, [rows]);

	const counts = useMemo(() => {
		const open = rows.filter((r) => !r.done);
		return {
			all: open.length,
			case: open.filter((r) => r.kind === "case").length,
			consultation: open.filter((r) => r.kind === "consultation").length,
			stalled: open.filter((r) => r.stalled > 0).length,
			stalled_us: open.filter((r) => r.stalled > 0 && r.stalledOn !== "client").length,
			stalled_client: open.filter((r) => r.stalled > 0 && r.stalledOn === "client").length,
			completed: rows.filter((r) => r.done).length,
		};
	}, [rows]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return rows.filter((r) => {
			if (chip === "completed" ? !r.done : chip !== "all" && r.done) return false;
			if (chip === "case" && r.kind !== "case") return false;
			if (chip === "consultation" && r.kind !== "consultation") return false;
			if (chip === "stalled" && !r.stalled) return false;
			if (chip === "stalled_us" && !(r.stalled > 0 && r.stalledOn !== "client")) return false;
			if (chip === "stalled_client" && !(r.stalled > 0 && r.stalledOn === "client")) return false;
			if (staff !== "all" && r.staffId !== staff) return false;
			if (branch !== "all" && r.branch !== branch) return false;
			if (q && ![r.reference, r.clientName, r.clientEmail ?? "", r.staffName ?? ""].some((v) => v.toLowerCase().includes(q))) return false;
			return true;
		});
	}, [rows, chip, staff, branch, search]);

	const bands = useMemo(() => {
		const by = new Map<Band, Row[]>();
		for (const r of filtered) by.set(r.band, [...(by.get(r.band) ?? []), r]);
		// Inside a band the stalled come first, then the most recently moved.
		for (const list of by.values()) list.sort((a, b) => b.stalled - a.stalled || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
		return BAND_ORDER.filter((b) => by.has(b)).map((b) => ({ band: b, rows: by.get(b)! }));
	}, [filtered]);

	const completedOpen = chip === "completed" || showCompleted;
	const me = opsUser?.opsUserId;

	// The "All officers" card: everyone's stage mix in one bar.
	const allStages = useMemo(() => {
		const agg = FLIGHT_CHAPTERS.map(() => 0);
		for (const o of officers) o.stages.forEach((n, i) => (agg[i] += n));
		return agg;
	}, [officers]);

	const unassigned = rows.filter((r) => !r.done && !r.staffId).length;
	// The officer comes from the URL, so a deep link works even when their
	// current load is zero — fall back to the staff directory, not the strip.
	const selectedAssignee = staff !== "all" ? assignees.find((a) => a.opsUserId === staff) : undefined;
	const selectedOfficer = selectedAssignee
		? (officers.find((o) => o.id === staff) ?? { id: staff, name: selectedAssignee.name, cases: 0, consultations: 0, stalled: 0, stalledUs: 0, stalledClient: 0, stages: FLIGHT_CHAPTERS.map(() => 0) })
		: null;
	const officerRows = useMemo(
		() => (selectedOfficer ? rows.filter((r) => r.staffId === selectedOfficer.id && !r.done).sort((a, b) => b.stalled - a.stalled || a.reference.localeCompare(b.reference)) : []),
		[rows, selectedOfficer],
	);
	const officerHandoffs = useMemo(() => {
		if (!selectedOfficer) return { away: 0, waiting: 0 };
		const ownIds = new Set(officerRows.map((r) => r.id));
		let away = 0;
		let waiting = 0;
		for (const h of handoffs) {
			if (h.status !== "pending") continue;
			if (h.fromOpsUserId === selectedOfficer.id) away++;
			if (h.applicationId && ownIds.has(h.applicationId)) waiting++;
		}
		return { away, waiting };
	}, [handoffs, officerRows, selectedOfficer]);

	// A card's `?row=` resolves to its row; when the record has a pending task
	// the sheet shows the same preview the worklist does.
	const previewRow = useMemo(() => (rowParam ? (rows.find((r) => `${r.kind}:${r.id}` === rowParam) ?? null) : null), [rows, rowParam]);
	const previewTask = useMemo(() => (previewRow ? (tasks.find((t) => t.linkTo === previewRow.link) ?? null) : null), [tasks, previewRow]);

	/** Arrow keys move along the officer strip — it is a radiogroup, not a pile of buttons. */
	function officerKeys(e: React.KeyboardEvent<HTMLDivElement>) {
		const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
		const i = cards.indexOf(document.activeElement as HTMLElement);
		if (i < 0) return;
		const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? cards[i + 1] : e.key === "ArrowLeft" || e.key === "ArrowUp" ? cards[i - 1] : e.key === "Home" ? cards[0] : e.key === "End" ? cards[cards.length - 1] : null;
		if (next) {
			e.preventDefault();
			next.focus();
			next.click();
		}
	}

	return (
		<div>
			{error && <p className="ops-modal__error" role="alert">{error}</p>}

			<header className="hdr-row" style={{ marginTop: "0.25rem" }}>
				<div>
					<h2 className="page-title" style={{ fontSize: "1.2rem" }}>Caseload</h2>
					<p className="lead mt-1">
						{officers.length} carrying · {counts.case} open case{counts.case === 1 ? "" : "s"} · {counts.consultation} consultation{counts.consultation === 1 ? "" : "s"} · {unassigned} unassigned{counts.stalled > 0 ? ` · ${counts.stalled} stalled 7d+` : ""}
					</p>
				</div>
				<button type="button" className="btn btn--ghost btn--sm" onClick={() => void refreshCases()} disabled={loading}>
					{loading ? "Refreshing…" : "↻ Refresh"}
				</button>
			</header>

			{/* The records nobody owns come first — the page is a triage surface. */}
			<UnassignedQueue />

			{/* Who carries what — one card per officer; selecting filters the bands
			    and opens their record. */}
			{officers.length > 0 && (
				<div className="ops-ostrip" role="radiogroup" aria-label="Officer" style={{ marginTop: "0.75rem" }} onKeyDown={officerKeys}>
					<button
						type="button"
						role="radio"
						aria-checked={staff === "all"}
						className={`ops-ocard${staff === "all" ? " ops-ocard--on" : ""}`}
						onClick={() => setStaff(null)}
					>
						<span className="ops-ocard__top">
							<span className="ops-ocard__who">All officers</span>
							<span className="ops-ocard__load">{counts.all}</span>
						</span>
						<span className="ops-ocard__meta">
							everyone
							{counts.stalled_us > 0 ? <> · <span className="hot">{counts.stalled_us} waiting on us</span></> : ""}
							{counts.stalled_client > 0 ? <> · {counts.stalled_client} on client</> : ""}
						</span>
						<StageStrip counts={allStages} />
					</button>
					{officers.map((o) => {
						const on = staff === o.id;
						const open = o.cases + o.consultations;
						const assignee = assignees.find((a) => a.opsUserId === o.id);
						return (
							<button
								key={o.id}
								type="button"
								role="radio"
								aria-checked={on}
								className={`ops-ocard${on ? " ops-ocard--on" : ""}`}
								onClick={() => setStaff(on ? null : o.id)}
							>
								<span className="ops-ocard__top">
									<span className="ops-ocard__who">
										<span className="hsheet__presence" data-presence={assignee?.presence ?? "offline"} aria-hidden="true" />
										{o.name}
										{o.id === me ? " (you)" : ""}
									</span>
									<span className={`ops-ocard__load${open > capacity ? " ops-ocard__load--over" : open >= Math.ceil(capacity * 0.9) ? " ops-ocard__load--near" : ""}`} title={`${open} open against a capacity of ${capacity}`}>
										{open}<small>/{capacity}</small>
									</span>
								</span>
								<span className="ops-ocard__meta">
									{o.cases} case{o.cases === 1 ? "" : "s"} · {o.consultations} consult{o.consultations === 1 ? "" : "s"}
									{assignee?.openStageSeats ? ` · ${assignee.openStageSeats} seat${assignee.openStageSeats === 1 ? "" : "s"}` : ""}
									{o.stalledUs > 0 ? <> · <span className="hot">{o.stalledUs} waiting on us</span></> : ""}
									{o.stalledClient > 0 ? <> · {o.stalledClient} on client</> : ""}
								</span>
								{(coordinating.get(o.id) ?? 0) > 0 && (
									<span className="ops-ocard__meta" style={{ textDecoration: "underline" }}>
										Coordinating {coordinating.get(o.id)}
									</span>
								)}
								<StageStrip counts={o.stages} />
							</button>
						);
					})}
				</div>
			)}

			{/* Filters — the chips carry the counts. */}
			<div className="cn-scaffold__filters" style={{ marginTop: "1rem", border: "1px solid var(--border-light)" }}>
				<div className="cn-scaffold__chips">
					<FilterGroup
						label="Caseload"
						options={CHIPS.map((c) => ({
							id: c.id,
							label: c.label,
							count: counts[c.id],
							hot: c.id === "stalled_us" && counts.stalled_us > 0,
						}))}
						value={chip}
						onChange={setChip}
					/>
				</div>
				<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
					<input
						type="search"
						placeholder="Search reference, client, staff…"
						value={search}
						onChange={(e) => setSearch(e.target.value || null)}
						className="cn-search"
						aria-label="Search caseload"
						style={{ flex: "1 1 14rem", width: "auto" }}
					/>
					{canSeeAllBranches && (
						<label className="cn-filter">
							<span className="cn-filter__label">Branch</span>
							<select className="cn-filter__select" value={branch} onChange={(e) => setBranch(e.target.value)}>
								<option value="all">All branches</option>
								{OPS_BRANCHES.map((b) => (
									<option key={b.id} value={b.id}>
										{b.name}
									</option>
								))}
							</select>
						</label>
					)}
					{staff !== "all" && (
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStaff(null)}>
							✕ {selectedAssignee?.name ?? "one person"}
						</button>
					)}
					{loading && <span className="cn-filter__label" style={{ marginLeft: "auto" }}>Loading…</span>}
				</div>
			</div>

			{/* The records, by where they sit — the manager's sweep. */}
			{bands.length === 0 ? (
				<p className="ops-people__empty">{loading ? "Loading caseload…" : "No records match the current filters."}</p>
			) : (
				<div className="ops-bands" style={{ padding: 0 }}>
					{bands.map(({ band, rows: list }) => {
						const isDone = band === "complete";
						const stalledUs = list.filter((r) => r.stalled > 0 && r.stalledOn !== "client").length;
						const stalledClient = list.filter((r) => r.stalled > 0 && r.stalledOn === "client").length;
						const note = isDone ? (completedOpen ? "hide" : "show ▸") : [stalledUs > 0 ? `${stalledUs} waiting on us` : null, stalledClient > 0 ? `${stalledClient} on client` : null].filter(Boolean).join(" · ") || (band === "consultation" ? "before a case opens" : "");
						return (
							<div key={band}>
								<div
									className={`ops-band${isDone ? " ops-band--toggle" : ""}`}
									role={isDone ? "button" : undefined}
									tabIndex={isDone ? 0 : undefined}
									onClick={isDone && chip !== "completed" ? () => setDoneParam(showCompleted ? null : "1") : undefined}
									onKeyDown={
										isDone && chip !== "completed"
											? (e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														setDoneParam(showCompleted ? null : "1");
													}
												}
											: undefined
									}
								>
									<span className="ops-band__name">
										{BAND_LABEL[band]} · {list.length}
									</span>
									{note && <span className="ops-band__note">{note}</span>}
								</div>
								{(!isDone || completedOpen) && (
									<div className="ops-people ops-people--three">
										{list.map((r) => (
											<div
												key={r.id}
												className={`ops-client${r.stalled ? " ops-client--stalled" : ""}`}
												role="button"
												tabIndex={0}
												style={{ cursor: "pointer" }}
												onClick={() => setRowParam(`${r.kind}:${r.id}`)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														setRowParam(`${r.kind}:${r.id}`);
													}
												}}
											>
												<div className="ops-client__head">
													<span className="ops-client__name" title={r.clientName}>
														{r.clientName}
														<span className="ops-client__ref">{r.reference}</span>
													</span>
													<span className="ops-client__when" title={r.updatedAt ? new Date(r.updatedAt).toLocaleString() : undefined}>
														{relativeTime(r.updatedAt)}
													</span>
												</div>
												<div className="ops-client__line">
													<span className="ops-thing__kicker">
														{r.stageLabel} <span className="ops-thing__kind">· {r.kind === "case" ? "Case" : "Consultation"}</span>
													</span>
													{r.stalled > 0 && (
														<span className={`ops-pill${r.stalledOn === "client" ? "" : " ops-pill--strong"}`}>
															{r.stalledOn === "client" ? "Waiting on client" : "Waiting on us"} {r.stalled} d
														</span>
													)}
													{r.atExit ? (
														<span className="ops-steps__n" title="The last working chapter on this plan">at its exit</span>
													) : (
														<>
															<span className="ops-steps" role="img" aria-label={`Chapter ${r.step} of ${r.total} on this plan`}>
																{Array.from({ length: r.total }).map((_, i) => (
																	<span key={i} className={i < r.step ? "ops-steps__on" : undefined} />
																))}
															</span>
															<span className="ops-steps__n">{r.step}/{r.total}</span>
														</>
													)}
												</div>
												<div className="ops-client__sub" title={r.sub}>
													{r.sub}
													{r.scopeStages ? <> <ScopeChip scopeStages={r.scopeStages} /></> : null}
												</div>
												<div className="ops-client__foot" onClick={(e) => e.stopPropagation()}>
													<span className="ops-client__meta">
														{r.staffName ? `Handler: ${r.staffName}` : "No handler"}
														{r.staffId && r.staffId !== me && (
															<>
																{" · "}
																<button type="button" className="ops-client__msg" onClick={() => void openDM(r.staffId!)}>
																	Message
																</button>
															</>
														)}
													</span>
													<Link to={r.link} className="btn btn--ghost btn--sm">
														Open →
													</Link>
												</div>
											</div>
										))}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* The officer's record — the strip narrows; the sheet holds the detail. */}
			<Sheet open={!!selectedOfficer} onClose={() => setStaff(null)} title={selectedOfficer ? `${selectedOfficer.name}${selectedOfficer.id === me ? " (you)" : ""}` : "Officer"} size="tall">
				{selectedOfficer && (
					<div>
						<div className="ops-opane__head">
							<p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "var(--text-xs)" }}>
								{selectedAssignee?.role ?? "Consultant"} · {selectedAssignee?.branch ?? "—"} branch
								{selectedAssignee?.email ? ` · ${selectedAssignee.email}` : ""}
							</p>
							{selectedOfficer.id !== me && (
								<button type="button" className="btn btn--primary btn--sm" onClick={() => void openDM(selectedOfficer.id)}>
									Message
								</button>
							)}
						</div>

						<p className="ops-dsec">Load · {selectedOfficer.cases + selectedOfficer.consultations} open</p>
						<div className="ops-dkv">
							<span className="ops-dkv__k">Cases</span>
							<span>
								{selectedOfficer.cases}
								{(() => {
									const heaviest = FLIGHT_CHAPTERS.map((s, i) => ({ s, n: selectedOfficer.stages[i] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0];
									return heaviest ? ` — heaviest in ${CHAPTER_SHORT[heaviest.s]} · ${CHAPTERS_ORDERED.find((c) => c.id === heaviest.s)?.label ?? heaviest.s} (${heaviest.n})` : "";
								})()}
							</span>
						</div>
						<div className="ops-dkv"><span className="ops-dkv__k">Consultations</span><span>{selectedOfficer.consultations} upcoming</span></div>
						<div className="ops-dkv">
							<span className="ops-dkv__k">Stalled</span>
							<span>{selectedOfficer.stalled > 0 ? <span className="portal-pill" style={{ textDecoration: "underline", textDecorationThickness: 2, fontWeight: 700 }}>{selectedOfficer.stalled} stalled</span> : "none"}</span>
						</div>

						<p className="ops-dsec">This week's hours</p>
						<div className="ops-hours">
							{[1, 2, 3, 4, 5, 6, 0].map((d) => {
								const h = (staffHours[selectedOfficer.id] ?? []).find((w) => w.dayOfWeek === d);
								const label = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d];
								return (
									<div key={d}>
										<b className={h ? undefined : "off"}>{h ? `${h.start}–${h.end}` : "—"}</b>
										<span>{label}</span>
									</div>
								);
							})}
						</div>

						<p className="ops-dsec">Carrying · {officerRows.length}</p>
						{officerRows.length === 0 ? (
							<p className="muted" style={{ fontSize: "var(--text-xs)" }}>Nothing open right now.</p>
						) : (
							officerRows.map((r) => (
								<div className="ops-mini" key={r.id}>
									<span>
										<span className="ops-mini__ref">{r.reference}</span> <b>{r.clientName}</b>
									</span>
									<span className="ops-mini__st">
										{r.stalled > 0 ? (
											<span className="portal-pill" style={{ textDecoration: "underline", textDecorationThickness: 2, fontWeight: r.stalledOn === "client" ? 400 : 700 }}>{r.stalledOn === "client" ? "on client" : "on us"} {r.stalled}d</span>
										) : (
											r.stageLabel
										)}
									</span>
									<Link to={r.link} className="dash-link">open →</Link>
								</div>
							))
						)}

						<p className="ops-dsec">Handoffs</p>
						<div className="ops-dkv"><span className="ops-dkv__k">Pending on their records</span><span>{officerHandoffs.waiting}</span></div>
						<div className="ops-dkv"><span className="ops-dkv__k">Handed off by them</span><span>{officerHandoffs.away}</span></div>
					</div>
				)}
			</Sheet>

			{/* A client card's preview — the worklist's task pane when the record
			    has a pending task, the card's facts when it doesn't. */}
			<Sheet open={!!previewRow} onClose={() => setRowParam(null)} title={previewRow ? `${previewRow.clientName} · ${previewRow.reference}` : "Record"} size="tall">
				{previewRow && (
					<>
						{previewTask ? (
						<PreviewPane
							item={previewTask}
							assignees={assignees}
							canAssignWork={canAssignWork}
							onAssigned={refreshCases}
							onAssignConsultation={assignConsultation}
							onAssignApplication={assignApplication}
							onReferConsultation={referConsultation}
							onReferApplication={referApplication}
							onResolveHandoff={resolveHandoff}
							onDeferHandoff={deferHandoff}
						/>
					) : (
						<div>
							<div className="ops-dkv"><span className="ops-dkv__k">Reference</span><span>{previewRow.reference}</span></div>
							<div className="ops-dkv"><span className="ops-dkv__k">Client</span><span>{previewRow.clientName}{previewRow.clientEmail ? ` · ${previewRow.clientEmail}` : ""}</span></div>
							<div className="ops-dkv"><span className="ops-dkv__k">Stage</span><span>{previewRow.stageLabel} ({previewRow.step}/{previewRow.total})</span></div>
							<div className="ops-dkv"><span className="ops-dkv__k">Handler</span><span>{previewRow.staffName ?? "— open"}</span></div>
							<div className="ops-dkv"><span className="ops-dkv__k">Branch</span><span>{previewRow.branch || "—"}</span></div>
							{previewRow.stalled > 0 && <div className="ops-dkv"><span className="ops-dkv__k">Stalled</span><span>{previewRow.stalled} days without movement</span></div>}
							{previewRow.sub && <p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: "0.75rem" }}>{previewRow.sub}</p>}
							<div style={{ marginTop: "1.25rem", display: "flex", justifyContent: "flex-end" }}>
								<Link to={previewRow.link} className="btn btn--primary btn--sm">
									Open →
								</Link>
							</div>
						</div>
					)}
						{/* Journey delegation lives on the client, not the case — a
						    manager hands "everything this client opens" over from here. */}
						{canAssignWork && previewRow.applicantId && (
							<div style={{ borderTop: "1px solid var(--border-light)", marginTop: "1rem", paddingTop: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
								<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
									{previewRow.journeyCoordinatorName
										? <>Journey steered by <strong>{previewRow.journeyCoordinatorName}</strong> — every case routes to them</>
										: "No journey coordinator"}
								</span>
								<button
									type="button"
									className="btn btn--ghost btn--sm"
									onClick={() =>
										setDelegateFor({
											id: previewRow.applicantId!,
											name: previewRow.clientName,
											journeyCoordinatorName: previewRow.journeyCoordinatorName,
										})
									}
								>
									{previewRow.journeyCoordinatorName ? "Manage journey…" : "Delegate journey…"}
								</button>
							</div>
						)}
					</>
				)}
			</Sheet>

			<DelegateSheet
				open={!!delegateFor}
				onClose={() => setDelegateFor(null)}
				applicant={delegateFor}
				onToast={(type, message) => setToast({ type, message })}
			/>
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}

/** Where a load sits: one segment per in-flight stage, light → dark = early → late. */
/** The four working chapters, in order — a caller's counts line up with these. */
export const STRIP_CHAPTERS = FLIGHT_CHAPTERS;
export const STRIP_SHORT = CHAPTER_SHORT;

export function StageStrip({ counts }: { counts: number[] }) {
	const total = counts.reduce((n, c) => n + c, 0);
	if (total === 0) return <div className="ops-strip ops-strip--empty" aria-hidden />;
	return (
		<div className="ops-strip" aria-hidden>
			{counts.map((c, i) => (c > 0 ? <span key={i} className={`ops-strip__seg ops-strip__seg--${i + 1}`} style={{ flex: c }} /> : null))}
		</div>
	);
}
