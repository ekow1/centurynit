import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { LEAD_STAGE_LABELS, type LeadStage } from "century-nit-core";
import { API_PREFIX, JOURNEY_STAGES, JOURNEY_STAGE_LABELS, LEAD_STAGE_FROM_DB, type JourneyStage } from "century-nit-shared";
import { documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { StageStrip } from "./WorkspaceCaseload";

/**
 * Analytics — how the pipeline moved this period, and who moved it.
 *
 * Every figure is derived from the records the console already holds:
 * leads, consultations, cases, documents. Time in stage is a median of real
 * dates the journey records (opened → offer accepted → visa lodged →
 * decision → collected); where fewer than five cases carry both dates the
 * figure is "—", never a made-up number. Consultants see the same page
 * scoped to their own work.
 */

interface ApiLead {
	id: string;
	name: string;
	source: string;
	stage: string;
	targetCountry: string | null;
	assignedStaffName: string | null;
	createdAt: string;
	updatedAt: string;
}

type PeriodId = "month" | "last_month" | "quarter" | "year" | "all";
const PERIODS: { id: PeriodId; label: string }[] = [
	{ id: "month", label: "This month" },
	{ id: "last_month", label: "Last month" },
	{ id: "quarter", label: "This quarter" },
	{ id: "year", label: "Last 12 months" },
	{ id: "all", label: "All time" },
];
function windowOf(id: PeriodId, now: Date): { from: Date | null; to: Date; prevFrom: Date | null; prevTo: Date | null; label: string } {
	const start = (y: number, m: number) => new Date(y, m, 1);
	const y = now.getFullYear();
	const m = now.getMonth();
	if (id === "month") return { from: start(y, m), to: now, prevFrom: start(y, m - 1), prevTo: start(y, m), label: now.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
	if (id === "last_month") return { from: start(y, m - 1), to: start(y, m), prevFrom: start(y, m - 2), prevTo: start(y, m - 1), label: start(y, m - 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
	if (id === "quarter") {
		const q = Math.floor(m / 3) * 3;
		return { from: start(y, q), to: now, prevFrom: start(y, q - 3), prevTo: start(y, q), label: `Q${Math.floor(m / 3) + 1} ${y}` };
	}
	if (id === "year") return { from: start(y - 1, m + 1), to: now, prevFrom: start(y - 2, m + 1), prevTo: start(y - 1, m + 1), label: "Last 12 months" };
	return { from: null, to: now, prevFrom: null, prevTo: null, label: "All time" };
}
const inWindow = (iso: string | null | undefined, from: Date | null, to: Date | null) => {
	if (!iso) return false;
	const t = new Date(iso).getTime();
	return !Number.isNaN(t) && (from === null || t >= from.getTime()) && (to === null || t < to.getTime());
};
const FLIGHT_STAGES = JOURNEY_STAGES.filter((s) => s !== "completed");
const STAGE_SHORT: Record<string, string> = { document_verification: "Docs", school_submission: "School", offer_letter_review: "Offer", visa_processing: "Visa", travel_assistance: "Travel" };
const MIN_SAMPLES = 5;
const median = (xs: number[]): number | null => {
	if (xs.length < MIN_SAMPLES) return null;
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
const daysBetween = (a?: string | null, b?: string | null): number | null => {
	if (!a || !b) return null;
	const d = (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
	return Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
};
const pts = (a: number, b: number | null) => (b === null ? null : `${a - b >= 0 ? "+" : ""}${a - b} pts`);

export function EnterpriseReports() {
	const { opsRole, opsUser, canSeeAllBranches, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { consultations, applications, applicants } = useCases();
	const [apiLeads, setApiLeads] = useState<ApiLead[]>([]);
	const [documents, setDocuments] = useState<ApplicantDocument[]>([]);
	const [period, setPeriod] = useState<PeriodId>("month");
	const [branchFilter, setBranchFilter] = useState("all");
	const now = useMemo(() => new Date(), []);
	const win = useMemo(() => windowOf(period, now), [period, now]);
	const isConsultant = opsRole === "consultant";
	const me = opsUser?.name ?? "";

	useEffect(() => {
		let alive = true;
		apiFetch<{ leads: ApiLead[] }>(`${API_PREFIX}/leads`)
			.then((res) => alive && setApiLeads(Array.isArray(res?.leads) ? res.leads : []))
			.catch(() => alive && setApiLeads([]));
		documentsApi
			.list()
			.then((res) => alive && setDocuments(res.documents))
			.catch(() => alive && setDocuments([]));
		return () => {
			alive = false;
		};
	}, []);

	const inBranch = <T extends { branch: string }>(list: T[]) => (branchFilter === "all" ? list : list.filter((x) => x.branch === branchFilter));
	const cons = useMemo(() => inBranch(scopeRecords(consultations, (c) => c.assignedOfficer === me)), [consultations, scopeRecords, me, branchFilter]); // eslint-disable-line react-hooks/exhaustive-deps
	const apps = useMemo(() => inBranch(scopeRecords(applications, (a) => a.assignedStaff === me)), [applications, scopeRecords, me, branchFilter]); // eslint-disable-line react-hooks/exhaustive-deps
	const leads = useMemo(() => {
		const all = apiLeads.map((l) => ({ ...l, stageId: (LEAD_STAGE_FROM_DB[l.stage] ?? LEAD_STAGE_FROM_DB[l.stage.toLowerCase().replace(/\s+/g, "_")] ?? "new") as LeadStage }));
		if (canSeeAllBranches) return all;
		return requiresAssignmentScope ? all.filter((l) => l.assignedStaffName === me) : all;
	}, [apiLeads, canSeeAllBranches, requiresAssignmentScope, me]);

	/** The period's counts, and the period before it for the deltas. */
	const period_ = useMemo(() => {
		const count = (from: Date | null, to: Date | null) => {
			const landed = leads.filter((l) => inWindow(l.createdAt, from, to));
			const enrolled = landed.filter((l) => l.stageId === "converted").length;
			const slotIso = (c: (typeof cons)[number]) => (c.slotDate ? `${c.slotDate}T${c.slotTime ?? "09:00"}:00` : c.updatedAt);
			const heldIn = cons.filter((c) => inWindow(slotIso(c), from, to));
			const held = heldIn.filter((c) => c.status === "Completed").length;
			const noShow = heldIn.filter((c) => c.status === "Cancelled").length;
			const opened = apps.filter((a) => inWindow(a.submittedDate, from, to)).length;
			const completed = apps.filter((a) => a.stage === "completed" && inWindow(a.updatedAt, from, to)).length;
			const decided = apps.filter((a) => inWindow(a.visaDetails?.decidedAt, from, to));
			const approved = decided.filter((a) => a.visaOutcome === "approved").length;
			const departed = apps.filter((a) => a.stage === "completed" && inWindow(a.updatedAt, from, to)).length;
			return { landed: landed.length, enrolled, conversion: landed.length > 0 ? Math.round((enrolled / landed.length) * 100) : null, held, noShow, booked: heldIn.length, opened, completed, decided: decided.length, approved, approval: decided.length > 0 ? Math.round((approved / decided.length) * 100) : null, departed };
		};
		return { cur: count(win.from, win.to), prev: win.prevFrom ? count(win.prevFrom, win.prevTo) : null };
	}, [leads, cons, apps, win]);
	const { cur, prev } = period_;

	const inFlight = apps.filter((a) => a.stage !== "completed");
	const stageCounts = FLIGHT_STAGES.map((s) => inFlight.filter((a) => a.stage === s).length);

	const pipeline = useMemo(() => {
		const byLead = (s: LeadStage) => leads.filter((l) => l.stageId === s).length;
		return [
			{ label: LEAD_STAGE_LABELS.new, value: byLead("new"), to: "/crm" },
			{ label: LEAD_STAGE_LABELS.contacted, value: byLead("contacted"), to: "/crm" },
			{ label: LEAD_STAGE_LABELS.assessment_complete, value: byLead("assessment_complete"), to: "/crm" },
			{ label: "Consultations", value: cons.length, to: "/consultations" },
			{ label: "Cases", value: apps.length, to: "/applications" },
			{ label: "Clients", value: inBranch(applicants).length, to: "/applicants" },
		];
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [leads, cons, apps, applicants, branchFilter]);
	const pipeMax = Math.max(1, ...pipeline.map((p) => p.value));

	/** Median days between the dates the journey records. */
	const timeInStage = useMemo(() => {
		const rows = [
			{ label: "Opened → offer accepted", days: apps.map((a) => daysBetween(a.submittedDate, a.offerAcceptedAt)).filter((d): d is number => d !== null) },
			{ label: "Offer → visa lodged", days: apps.map((a) => daysBetween(a.offerAcceptedAt, a.visaDetails?.submittedAt)).filter((d): d is number => d !== null) },
			{ label: "Lodged → biometrics", days: apps.map((a) => daysBetween(a.visaDetails?.submittedAt, a.visaDetails?.biometricsAt)).filter((d): d is number => d !== null) },
			{ label: "Lodged → decision", days: apps.map((a) => daysBetween(a.visaDetails?.submittedAt, a.visaDetails?.decidedAt)).filter((d): d is number => d !== null) },
			{ label: "Decision → passport back", days: apps.map((a) => daysBetween(a.visaDetails?.decidedAt, a.visaDetails?.collectedAt)).filter((d): d is number => d !== null) },
		];
		return rows.map((r) => ({ label: r.label, n: r.days.length, median: median(r.days) }));
	}, [apps]);
	const tisMax = Math.max(1, ...timeInStage.map((r) => r.median ?? 0));

	const team = useMemo(() => {
		if (isConsultant) return [];
		const map = new Map<string, { held: number; moved: number; carried: number; leads: number; enrolled: number }>();
		const bump = (name: string | null | undefined, f: (e: { held: number; moved: number; carried: number; leads: number; enrolled: number }) => void) => {
			if (!name) return;
			const e = map.get(name) ?? { held: 0, moved: 0, carried: 0, leads: 0, enrolled: 0 };
			f(e);
			map.set(name, e);
		};
		for (const c of cons) if (c.status === "Completed" && inWindow(c.slotDate ? `${c.slotDate}T${c.slotTime ?? "09:00"}:00` : c.updatedAt, win.from, win.to)) bump(c.assignedOfficer, (e) => e.held++);
		for (const a of apps) {
			if (a.stage !== "completed") bump(a.assignedStaff, (e) => e.carried++);
			if (inWindow(a.updatedAt, win.from, win.to)) bump(a.assignedStaff, (e) => e.moved++);
		}
		for (const l of leads) {
			if (!inWindow(l.createdAt, win.from, win.to)) continue;
			bump(l.assignedStaffName, (e) => {
				e.leads++;
				if (l.stageId === "converted") e.enrolled++;
			});
		}
		return [...map.entries()].map(([name, e]) => ({ name, ...e })).sort((x, y) => y.held + y.moved - (x.held + x.moved));
	}, [cons, apps, leads, win, isConsultant]);

	const sources = useMemo(() => {
		const map = new Map<string, { landed: number; enrolled: number }>();
		for (const l of leads) {
			if (!inWindow(l.createdAt, win.from, win.to)) continue;
			const k = l.source || "Unknown";
			const e = map.get(k) ?? { landed: 0, enrolled: 0 };
			e.landed++;
			if (l.stageId === "converted") e.enrolled++;
			map.set(k, e);
		}
		return [...map.entries()].map(([label, e]) => ({ label, ...e })).sort((a, b) => b.landed - a.landed);
	}, [leads, win]);
	const srcMax = Math.max(1, ...sources.map((s) => s.landed));
	const destinations = useMemo(() => {
		const map = new Map<string, number>();
		for (const l of leads) if (inWindow(l.createdAt, win.from, win.to) && l.targetCountry) map.set(l.targetCountry, (map.get(l.targetCountry) ?? 0) + 1);
		return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
	}, [leads, win]);
	const docsReviewed = documents.filter((d) => d.reviewedAt && inWindow(d.reviewedAt, win.from, win.to)).length;

	function exportCsv() {
		const rows: string[][] = [
			["Metric", "Value"],
			["Period", win.label],
			["Leads landed", String(cur.landed)],
			["Leads enrolled", String(cur.enrolled)],
			["Consultations held", String(cur.held)],
			["Cases opened", String(cur.opened)],
			["Visas decided", String(cur.decided)],
			["Visas approved", String(cur.approved)],
			["Documents reviewed", String(docsReviewed)],
			[],
			["Stage", "Median days", "Cases"],
			...timeInStage.map((r) => [r.label, r.median === null ? "" : String(r.median), String(r.n)]),
			[],
			["Officer", "Consultations held", "Cases moved", "Cases carried", "Leads", "Enrolled"],
			...team.map((t) => [t.name, String(t.held), String(t.moved), String(t.carried), String(t.leads), String(t.enrolled)]),
		];
		const csv = rows.map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
		const a = document.createElement("a");
		a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
		a.download = `analytics-${win.label.replace(/\s+/g, "-").toLowerCase()}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Analytics</h1>
					<p className="lead mt-2">{isConsultant ? "How your pipeline moved this period." : "How the pipeline moved this period, and who moved it."}</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<label className="cn-filter">
						<span className="cn-filter__label">Period</span>
						<select className="cn-filter__select" value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)}>
							{PERIODS.map((p) => (
								<option key={p.id} value={p.id}>
									{p.label}
								</option>
							))}
						</select>
					</label>
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
					<button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv}>
						Export CSV
					</button>
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span className="dash-day__date">{win.label}</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<span>
					<strong>{cur.landed}</strong> <span className="dash-day__date">leads landed</span>
				</span>
				<span>
					<strong>{cur.held}</strong> <span className="dash-day__date">consultations held</span>
				</span>
				<span>
					<strong>{cur.opened}</strong> <span className="dash-day__date">cases opened</span>
				</span>
				<span>
					<strong>{cur.approved}</strong> <span className="dash-day__date">visas approved</span>
				</span>
				<span>
					<strong>{cur.completed}</strong> <span className="dash-day__date">completed</span>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/workspace" className="dash-link">
					Workspace →
				</Link>
			</div>

			<div className="dash-kpis">
				<div className="dash-kpi dash-kpi--on">
					<span className="dash-kpi__label">Lead → client</span>
					<span className="dash-kpi__value">{cur.conversion === null ? "—" : `${cur.conversion}%`}</span>
					<span className="dash-kpi__delta">{prev && cur.conversion !== null && prev.conversion !== null ? `${pts(cur.conversion, prev.conversion)} vs before` : ""}</span>
					<span className="dash-kpi__note">
						{cur.landed} leads · {cur.enrolled} enrolled
					</span>
				</div>
				<div className="dash-kpi">
					<span className="dash-kpi__label">Consultations held</span>
					<span className="dash-kpi__value">{cur.held}</span>
					<span className="dash-kpi__delta">
						{prev ? `${cur.held - prev.held >= 0 ? "+" : ""}${cur.held - prev.held} vs before` : ""}
						{cur.noShow > 0 ? ` · ${cur.noShow} cancelled` : ""}
					</span>
					<span className="dash-kpi__note">{cur.booked > 0 ? `${Math.round((cur.held / cur.booked) * 100)}% of ${cur.booked} booked` : "nothing booked in the period"}</span>
				</div>
				<div className="dash-kpi">
					<span className="dash-kpi__label">Cases in flight</span>
					<span className="dash-kpi__value">{inFlight.length}</span>
					<span className="dash-kpi__delta">
						{cur.opened} opened · {cur.completed} completed
					</span>
					<StageStrip counts={stageCounts} />
					<span className="dash-kpi__note">{FLIGHT_STAGES.map((s, i) => (stageCounts[i] > 0 ? `${STAGE_SHORT[s]} ${stageCounts[i]}` : null)).filter(Boolean).join(" · ") || "none in flight"}</span>
				</div>
				<div className="dash-kpi">
					<span className="dash-kpi__label">Visa approval</span>
					<span className="dash-kpi__value">{cur.approval === null ? "—" : `${cur.approval}%`}</span>
					<span className="dash-kpi__delta">
						{cur.approved} of {cur.decided} decided
					</span>
					<span className="dash-kpi__note">{timeInStage[3].median !== null ? `median ${timeInStage[3].median} d from lodged to decision` : "median needs 5 decided cases"}</span>
				</div>
			</div>

			<div className="dash-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
				<section className="dash-panel">
					<header className="dash-panel__head">
						<h2 className="dash-panel__title">Pipeline · where clients are</h2>
						<Link to="/applications?view=board" className="dash-link">
							Cases board →
						</Link>
					</header>
					{pipeline.map((p) => (
						<Link key={p.label} to={p.to} className="ops-hbar" style={{ color: "inherit" }}>
							<span>{p.label}</span>
							<span className="ops-hbar__t">
								<span style={{ width: `${Math.round((p.value / pipeMax) * 100)}%` }} />
							</span>
							<span className="ops-hbar__v">{p.value}</span>
						</Link>
					))}
				</section>
				<section className="dash-panel">
					<header className="dash-panel__head">
						<h2 className="dash-panel__title">Time in stage · median days</h2>
						<span className="cn-filter__label">from the dates the case records</span>
					</header>
					{timeInStage.map((r) => (
						<div key={r.label} className="ops-hbar">
							<span>{r.label}</span>
							<span className="ops-hbar__t">
								<span style={{ width: r.median === null ? "0%" : `${Math.round((r.median / tisMax) * 100)}%` }} />
							</span>
							<span className="ops-hbar__v">{r.median === null ? `— · ${r.n} case${r.n === 1 ? "" : "s"}` : `${r.median} d · ${r.n}`}</span>
						</div>
					))}
					<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>Fewer than {MIN_SAMPLES} cases with both dates shows as —. Cases that skipped a step are left out.</p>
				</section>
			</div>

			<div className="dash-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "1rem" }}>
				{!isConsultant && (
					<section className="dash-panel">
						<header className="dash-panel__head">
							<h2 className="dash-panel__title">Team · this period</h2>
							<Link to="/workspace?tab=caseload" className="dash-link">
								Caseload →
							</Link>
						</header>
						{team.length === 0 ? (
							<p className="dash-empty">Nothing moved in this period.</p>
						) : (
							<div className="ops-table-wrap">
								<table className="ops-table ops-ledger">
									<thead>
										<tr>
											<th>Officer</th>
											<th className="ops-ledger__r">Held</th>
											<th className="ops-ledger__r">Cases moved</th>
											<th className="ops-ledger__r">Carrying</th>
											<th className="ops-ledger__r">Lead → client</th>
										</tr>
									</thead>
									<tbody>
										{team.map((t) => (
											<tr key={t.name}>
												<td>{t.name}</td>
												<td className="ops-ledger__r cn-money">{t.held}</td>
												<td className="ops-ledger__r cn-money">{t.moved}</td>
												<td className="ops-ledger__r cn-money">{t.carried}</td>
												<td className="ops-ledger__r cn-money">{t.leads > 0 ? `${Math.round((t.enrolled / t.leads) * 100)}% · ${t.leads}` : "—"}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
						<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>
							{docsReviewed} document{docsReviewed === 1 ? "" : "s"} reviewed in the period
						</p>
					</section>
				)}
				<section className="dash-panel">
					<header className="dash-panel__head">
						<h2 className="dash-panel__title">Where leads come from</h2>
						<Link to="/marketing" className="dash-link">
							Marketing →
						</Link>
					</header>
					{sources.length === 0 ? (
						<p className="dash-empty">No leads landed in this period.</p>
					) : (
						sources.map((s) => (
							<div key={s.label} className="ops-hbar">
								<span>{s.label}</span>
								<span className="ops-hbar__t">
									<span style={{ width: `${Math.round((s.landed / srcMax) * 100)}%` }} />
								</span>
								<span className="ops-hbar__v">
									{s.landed} · {s.enrolled} enrolled
								</span>
							</div>
						))
					)}
					{destinations.length > 0 && (
						<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>Destinations asked for: {destinations.map(([c, n]) => `${c} ${n}`).join(" · ")}</p>
					)}
				</section>
			</div>
			<p className="cn-detailhead__meta" style={{ marginTop: "1rem" }}>
				Stages: {JOURNEY_STAGES.map((s) => JOURNEY_STAGE_LABELS[s as JourneyStage]).join(" → ")}
			</p>
		</div>
	);
}
