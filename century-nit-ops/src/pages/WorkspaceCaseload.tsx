import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCases } from "../hooks/useCases";
import { useOpsAuth } from "./OpsAuthContext";
import { useChatHub } from "./ChatHubContext";
import { UnassignedQueue } from "./UnassignedBookings";
import { OPS_BRANCHES } from "century-nit-core/ops";
import { calendarApi, type CalendarStatus } from "century-nit-core/api";
import { JOURNEY_STAGES, JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";

/**
 * The Workspace's Caseload view — who carries what, and where each case
 * sits. Same records as the Worklist, same `scopeRecords` scoping: a
 * manager sees the team, a consultant sees their own load.
 *
 * Read top to bottom: one card per officer (open load, the stage strip,
 * what has stalled), then the records as client cards in stage bands —
 * consultations first, then the journey's stages in order, completed
 * folded away at the end. Clicking an officer narrows the bands to them.
 *
 * Stalled: no movement for a week on a record that isn't done.
 */

const STALLED_AFTER_DAYS = 7;

type Band = "consultations" | JourneyStage;
const BAND_ORDER: Band[] = ["consultations", ...JOURNEY_STAGES];
const BAND_LABEL: Record<Band, string> = {
	consultations: "Consultations",
	...JOURNEY_STAGE_LABELS,
};
/** The in-flight case stages — what the officer strip is made of. */
const FLIGHT_STAGES = JOURNEY_STAGES.filter((s) => s !== "completed");
const STAGE_SHORT: Record<JourneyStage, string> = {
	document_verification: "Docs",
	school_submission: "School",
	offer_letter_review: "Offer",
	visa_processing: "Visa",
	travel_assistance: "Travel",
	payment_execution: "Payment",
	completed: "Done",
};

type Row = {
	id: string;
	kind: "case" | "consultation";
	band: Band;
	done: boolean;
	reference: string;
	clientName: string;
	clientEmail: string | null;
	branch: string;
	staffId: string | null;
	staffName: string | null;
	stageLabel: string;
	step: number;
	total: number;
	sub: string;
	updatedAt: string;
	/** Days without movement when stalled; 0 otherwise. */
	stalled: number;
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

type Chip = "all" | "case" | "consultation" | "stalled" | "completed";
const CHIPS: { id: Chip; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "case", label: "Cases" },
	{ id: "consultation", label: "Consultations" },
	{ id: "stalled", label: "Stalled" },
	{ id: "completed", label: "Completed" },
];

export function WorkspaceCaseload() {
	const { scopeRecords, opsUser, canSeeAllBranches } = useOpsAuth();
	const { applications, consultations, assignees, handoffs, loading, error, refresh: refreshCases } = useCases();
	const { openDM } = useChatHub();
	const [chip, setChip] = useState<Chip>("all");
	const [staff, setStaff] = useState<string>("all");
	const [branch, setBranch] = useState("all");
	const [search, setSearch] = useState("");
	const [showCompleted, setShowCompleted] = useState(false);
	const [view, setView] = useState<"officers" | "stages">("officers");
	const [staffHours, setStaffHours] = useState<Record<string, CalendarStatus["workingHours"]>>({});

	useEffect(() => {
		calendarApi
			.staffWorkingHours()
			.then((r) => setStaffHours(Object.fromEntries(r.staff.map((s) => [s.opsUserId, s.hours]))))
			.catch(() => {});
	}, []);

	const staffIdByEmail = (email: string | null | undefined) => (email ? (assignees.find((a) => a.email === email)?.opsUserId ?? null) : null);

	/** The unified rows from the shared stores — no separate API call. */
	const rows = useMemo<Row[]>(() => {
		const scopedApps = scopeRecords(applications, (a) => Boolean(a.assignedStaffEmail || a.assignedStaff));
		const scopedCons = scopeRecords(consultations, (c) => Boolean(c.assignedOfficerEmail || c.assignedOfficer));
		const out: Row[] = [];
		for (const a of scopedApps) {
			const stage = a.stage as JourneyStage;
			const idx = JOURNEY_STAGES.indexOf(stage);
			const done = stage === "completed";
			const open = a.checklist.filter((c) => !c.checked).length;
			const updatedAt = a.updatedAt ?? a.submittedDate;
			out.push({
				id: a.id,
				kind: "case",
				band: idx >= 0 ? stage : "document_verification",
				done,
				reference: a.appId,
				clientName: a.applicantName,
				clientEmail: a.email,
				branch: a.branch,
				staffId: staffIdByEmail(a.assignedStaffEmail),
				staffName: a.assignedStaff || null,
				stageLabel: JOURNEY_STAGE_LABELS[stage] ?? a.stage,
				step: idx >= 0 ? idx + 1 : 1,
				total: JOURNEY_STAGES.length,
				sub: [a.university || "No university yet", a.status, open > 0 ? `${open} checklist item${open === 1 ? "" : "s"} open` : null].filter(Boolean).join(" · "),
				updatedAt,
				stalled: stalledDays(updatedAt, done),
				link: `/applications?id=${a.id}`,
			});
		}
		for (const c of scopedCons) {
			const done = c.status === "Completed" || c.status === "Cancelled";
			const updatedAt = c.updatedAt ?? "";
			out.push({
				id: c.id,
				kind: "consultation",
				band: done ? "completed" : "consultations",
				done,
				reference: c.ref,
				clientName: c.applicantName,
				clientEmail: c.email,
				branch: c.branch,
				staffId: staffIdByEmail(c.assignedOfficerEmail),
				staffName: c.assignedOfficer || null,
				stageLabel: c.status,
				step: CONSULTATION_STEP[c.status] ?? 1,
				total: 4,
				sub: [c.type, c.targetCountry || null, c.dateTime].filter(Boolean).join(" · "),
				updatedAt,
				stalled: stalledDays(updatedAt, done),
				link: `/consultations?id=${c.id}`,
			});
		}
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps -- staffIdByEmail is stable per render
	}, [applications, consultations, scopeRecords, assignees]);

	/** Every officer carrying something open: load, stage mix, what has stalled. */
	const officers = useMemo(() => {
		const map = new Map<string, { id: string; name: string; cases: number; consultations: number; stalled: number; stages: number[] }>();
		for (const r of rows) {
			if (r.done || !r.staffId || !r.staffName) continue;
			const o = map.get(r.staffId) ?? { id: r.staffId, name: r.staffName, cases: 0, consultations: 0, stalled: 0, stages: FLIGHT_STAGES.map(() => 0) };
			if (r.kind === "case") {
				o.cases++;
				const i = (FLIGHT_STAGES as string[]).indexOf(r.band);
				if (i >= 0) o.stages[i]++;
			} else o.consultations++;
			if (r.stalled) o.stalled++;
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

	const unassigned = rows.filter((r) => !r.done && !r.staffId).length;
	const selectedOfficer = staff !== "all" ? (officers.find((o) => o.id === staff) ?? null) : null;
	const selectedAssignee = selectedOfficer ? assignees.find((a) => a.opsUserId === selectedOfficer.id) : undefined;
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

	return (
		<div>
			{error && <p className="ops-modal__error" role="alert">{error}</p>}

			<header className="hdr-row" style={{ marginTop: "0.25rem" }}>
				<div>
					<h2 className="page-title" style={{ fontSize: "1.2rem" }}>Caseload</h2>
					<p className="lead mt-1">Who carries what — load, mix, and what has stalled.</p>
				</div>
				<div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
					<button
						type="button"
						className="ops-pill"
						onClick={() => setView("officers")}
						style={{
							cursor: "pointer",
							marginLeft: 0,
							border: "1px solid var(--border)",
							background: view === "officers" ? "var(--foreground)" : "transparent",
							color: view === "officers" ? "var(--background)" : "var(--foreground)",
						}}
					>
						By officer
					</button>
					<button
						type="button"
						className="ops-pill"
						onClick={() => setView("stages")}
						style={{
							cursor: "pointer",
							marginLeft: 0,
							border: "1px solid var(--border)",
							background: view === "stages" ? "var(--foreground)" : "transparent",
							color: view === "stages" ? "var(--background)" : "var(--foreground)",
						}}
					>
						By stage
					</button>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => void refreshCases()} disabled={loading}>
						{loading ? "Refreshing…" : "↻ Refresh"}
					</button>
				</div>
			</header>

			<div className="dash-day" style={{ margin: "0.75rem 0 1rem" }}>
				<span className="dash-day__cut"><strong>{officers.length}</strong> carrying work</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{counts.case}</strong> open cases</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{counts.consultation}</strong> consultations</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{unassigned}</strong> unassigned</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{counts.stalled}</strong> stalled 7d+</span>
			</div>

			{/* Who carries what — officer rows left, the selected officer's record right. */}
			{view === "officers" && officers.length > 0 && (
				<div className="ops-split">
					<div className="ops-olist">
						{officers.map((o) => {
							const on = staff === o.id;
							const open = o.cases + o.consultations;
							return (
								<div
									key={o.id}
									className={`ops-orow${on ? " ops-orow--on" : ""}`}
									role="button"
									tabIndex={0}
									aria-pressed={on}
									onClick={() => setStaff(on ? "all" : o.id)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											setStaff(on ? "all" : o.id);
										}
									}}
								>
									<span className="ops-orow__load">{open}</span>
									<div className="ops-orow__who">
										<b>
											{o.name}
											{o.id === me ? " (you)" : ""}
										</b>
										<small>
											{assignees.find((a) => a.opsUserId === o.id)?.role ?? "Consultant"} · {assignees.find((a) => a.opsUserId === o.id)?.branch ?? "—"}
										</small>
										<StageStrip counts={o.stages} />
									</div>
									<div className="ops-orow__right">
										{o.cases} case{o.cases === 1 ? "" : "s"} · {o.consultations} consult{o.consultations === 1 ? "" : "s"}
										<br />
										{o.stalled > 0 ? <strong>{o.stalled} stalled</strong> : <span className="muted">—</span>}
									</div>
								</div>
							);
						})}
					</div>

					{selectedOfficer ? (
						<aside className="ops-opane">
							<div className="ops-opane__head">
								<div>
									<p className="eyebrow" style={{ margin: 0 }}>Officer record</p>
									<h3 style={{ margin: "0.25rem 0 0", fontSize: "1.1rem", fontWeight: 800 }}>
										{selectedOfficer.name}
										{selectedOfficer.id === me ? " (you)" : ""}
									</h3>
									<p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "var(--text-xs)" }}>
										{selectedAssignee?.role ?? "Consultant"} · {selectedAssignee?.branch ?? "—"} branch
										{selectedAssignee?.email ? ` · ${selectedAssignee.email}` : ""}
									</p>
								</div>
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
										const heaviest = FLIGHT_STAGES.map((s, i) => ({ s, n: selectedOfficer.stages[i] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0];
										return heaviest ? ` — heaviest in ${STAGE_SHORT[heaviest.s]} (${heaviest.n})` : "";
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
												<span className="portal-pill" style={{ textDecoration: "underline", textDecorationThickness: 2, fontWeight: 700 }}>stalled {r.stalled}d</span>
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
						</aside>
					) : (
						<aside className="ops-opane ops-opane--empty">
							<p className="eyebrow" style={{ margin: 0 }}>Officer record</p>
							<p className="muted" style={{ marginTop: "0.5rem", fontSize: "var(--text-xs)" }}>
								Select an officer to see their load, this week's hours, and the records they're carrying.
							</p>
						</aside>
					)}
				</div>
			)}

			{/* Shared triage queue — same panel as the Dashboard; collapses to a
			    line when nothing is waiting. */}
			<UnassignedQueue />

			{/* Filters — the chips carry the counts. */}
			<div className="cn-scaffold__filters" style={{ marginTop: "1.25rem", border: "1px solid var(--border-light)" }}>
				<div className="cn-scaffold__chips" role="tablist" aria-label="Caseload">
					{CHIPS.map((c) => {
						const n = counts[c.id];
						const on = chip === c.id;
						return (
							<button
								key={c.id}
								type="button"
								role="tab"
								aria-selected={on}
								className="ops-pill"
								onClick={() => setChip(c.id)}
								style={{
									cursor: "pointer",
									marginLeft: 0,
									border: "1px solid var(--border)",
									background: on ? "var(--foreground)" : "transparent",
									color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
									fontWeight: c.id === "stalled" && n > 0 && !on ? 700 : 500,
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
				<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
					<input
						type="search"
						placeholder="Search reference, client, staff…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
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
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStaff("all")}>
							✕ {officers.find((o) => o.id === staff)?.name ?? "one person"}
						</button>
					)}
					<span className="cn-filter__label" style={{ marginLeft: "auto" }}>
						{loading
							? "Loading…"
							: `${counts.case} case${counts.case === 1 ? "" : "s"} · ${counts.consultation} consultation${counts.consultation === 1 ? "" : "s"} · ${officers.length} officer${officers.length === 1 ? "" : "s"}${counts.stalled > 0 ? ` · ${counts.stalled} stalled` : ""}`}
					</span>
				</div>
			</div>

			{/* The records, by where they sit — the manager's sweep. */}
			{view === "stages" && (bands.length === 0 ? (
				<p className="ops-people__empty">{loading ? "Loading caseload…" : "No records match the current filters."}</p>
			) : (
				<div className="ops-bands" style={{ padding: 0 }}>
					{bands.map(({ band, rows: list }) => {
						const isDone = band === "completed";
						const stalled = list.filter((r) => r.stalled > 0).length;
						const note = isDone ? (completedOpen ? "hide" : "show ▸") : stalled > 0 ? `${stalled} stalled` : band === "consultations" ? "before a case opens" : "";
						return (
							<div key={band}>
								<div
									className={`ops-band${isDone ? " ops-band--toggle" : ""}`}
									role={isDone ? "button" : undefined}
									tabIndex={isDone ? 0 : undefined}
									onClick={isDone && chip !== "completed" ? () => setShowCompleted((v) => !v) : undefined}
									onKeyDown={
										isDone && chip !== "completed"
											? (e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														setShowCompleted((v) => !v);
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
											<div key={r.id} className={`ops-client${r.stalled ? " ops-client--stalled" : ""}`}>
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
													{r.stalled > 0 && <span className="ops-pill ops-pill--strong">Stalled {r.stalled} d</span>}
													<span className="ops-steps" aria-label={`Step ${r.step} of ${r.total}`}>
														{Array.from({ length: r.total }).map((_, i) => (
															<span key={i} className={i < r.step ? "ops-steps__on" : undefined} />
														))}
													</span>
												</div>
												<div className="ops-client__sub" title={r.sub}>
													{r.sub}
												</div>
												<div className="ops-client__foot">
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
			))}
		</div>
	);
}

/** Where a load sits: one segment per in-flight stage, light → dark = early → late. */
export function StageStrip({ counts }: { counts: number[] }) {
	const total = counts.reduce((n, c) => n + c, 0);
	if (total === 0) return <div className="ops-strip ops-strip--empty" aria-hidden />;
	return (
		<div className="ops-strip" aria-hidden>
			{counts.map((c, i) => (c > 0 ? <span key={i} className={`ops-strip__seg ops-strip__seg--${i + 1}`} style={{ flex: c }} /> : null))}
		</div>
	);
}
