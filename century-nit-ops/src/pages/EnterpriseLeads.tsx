import { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import {
	LEAD_STAGE_LABELS,
	LEAD_STAGE_ORDER,
	type Lead,
	type LeadStage,
} from "century-nit-core";
import { LEAD_STAGE_TO_DB, LEAD_STAGE_FROM_DB, API_PREFIX, type ApiLead, type LeadEvent } from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { CaseScaffold } from "./case/CaseScaffold";
import { whenLabel } from "../lib/pendingTasks";

/**
 * The Leads pad — every enquiry on the desk, hottest first.
 *
 * The stage columns are chips (the cut, with live counts); the pad itself
 * is a flat card grid banded by freshness — hot (worked inside 48h or
 * advanced), warm (in conversation, quiet), cold (landed, nobody replied),
 * closed (enrolled/lost, folded at the end). Selecting a card opens the
 * rail: the stepper, the contact facts, assignment, and the lead's own
 * event trail. No colour anywhere — heat is ink density.
 */

type PadLead = Lead & { staffId: string | null };

function timeAgo(iso?: string | null) {
	if (!iso) return "—";
	const timestamp = new Date(iso).getTime();
	if (Number.isNaN(timestamp)) return "—";
	const diff = Date.now() - timestamp;
	if (diff < 0) return "just now";
	const hours = Math.floor(diff / 3600000);
	if (hours < 1) return "just now";
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

const FRESH_MS = 48 * 3600_000;

/** Base heat by stage; a fresh touch adds a notch. Lost has no heat. */
const STAGE_HEAT: Record<LeadStage, number> = {
	new: 1,
	contacted: 2,
	consultation_booked: 3,
	assessment_complete: 4,
	converted: 5,
	lost: 0,
};

function heat(l: PadLead, now: number): number {
	if (l.stage === "lost") return 0;
	const touched = now - new Date(l.lastContactAt).getTime();
	const fresh = !Number.isNaN(touched) && touched < FRESH_MS;
	return Math.max(1, Math.min(5, STAGE_HEAT[l.stage] + (fresh ? 1 : 0)));
}

type PadBand = "hot" | "warm" | "cold" | "closed";
const PAD_BAND_LABEL: Record<PadBand, string> = {
	hot: "Hot — in play now",
	warm: "Warm — in conversation, quiet",
	cold: "Cold — landed, nobody replied",
	closed: "Closed",
};

function leadBand(l: PadLead, now: number): PadBand {
	if (l.stage === "converted" || l.stage === "lost") return "closed";
	const touched = now - new Date(l.lastContactAt).getTime();
	const stale = Number.isNaN(touched) || touched > FRESH_MS;
	const advanced = l.stage === "consultation_booked" || l.stage === "assessment_complete";
	if (!stale || advanced) return "hot";
	return l.stage === "new" ? "cold" : "warm";
}

const SORTS = [
	{ id: "hottest", label: "Hottest first" },
	{ id: "newest", label: "Newest first" },
	{ id: "stale", label: "Stale first" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

/** The forward walk the stepper shows; "lost" is a pill, not a step. */
const STEPPER_STAGES = LEAD_STAGE_ORDER.filter((s) => s !== "lost");

function HeatMeter({ value }: { value: number }) {
	return (
		<span className="ops-meter" aria-hidden title={`Interest ${value}/5`}>
			<span>{"●".repeat(value)}</span>
			<span className="ops-meter__off">{"●".repeat(5 - value)}</span>
		</span>
	);
}

/* ── The page ─────────────────────────────────────────────────────────── */

export function EnterpriseLeads() {
	const { opsRole, opsUser, canSeeAllBranches } = useOpsAuth();
	const { assignees } = useCases();
	const [apiLeads, setApiLeads] = useState<ApiLead[]>([]);
	const [loading, setLoading] = useState(false);
	const [search, setSearch] = useState("");
	const [assignFilter, setAssignFilter] = useState<"all" | "mine" | "unassigned">("all");
	const [stageFilter, setStageFilter] = useState<"all" | LeadStage>("all");
	const [sourceFilter, setSourceFilter] = useState("all");
	const [sort, setSort] = useState<SortId>("hottest");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	// The clock the bands and heat read — ticks so a quiet lead goes cold in view.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(id);
	}, []);

	const canSeeAll =
		canSeeAllBranches ||
		opsRole === "super_admin" ||
		opsRole === "admin" ||
		opsRole === "manager" ||
		opsRole === "coordinator" ||
		opsRole === "finance" ||
		!opsRole;

	const canMoveAny =
		opsRole === "super_admin" ||
		opsRole === "admin" ||
		opsRole === "manager" ||
		opsRole === "coordinator" ||
		!opsRole;
	const canMoveLead = (l: PadLead) => canMoveAny || l.assignedTo === opsUser?.name;

	const loadApiLeads = useCallback(async () => {
		try {
			const res = await apiFetch<{ leads: ApiLead[] }>(`${API_PREFIX}/leads`);
			if (res && Array.isArray(res.leads)) {
				setApiLeads(res.leads);
			}
		} catch (err) {
			console.warn("[CRM] Could not fetch live leads from server API:", err);
		}
	}, []);

	useEffect(() => {
		void (async () => {
			await loadApiLeads();
		})();
		const interval = setInterval(() => void loadApiLeads(), 10000);
		return () => clearInterval(interval);
	}, [loadApiLeads]);

	const mergedLeads = useMemo<PadLead[]>(
		() =>
			apiLeads.map((al) => ({
				id: al.id,
				name: al.name,
				email: al.email,
				phone: al.phone || "-",
				country: al.targetCountry || al.country || "Ghana",
				stage: LEAD_STAGE_FROM_DB[al.stage] ?? "new",
				source: al.source || "Website Registration",
				createdAt: al.createdAt.slice(0, 10),
				lastContactAt: al.lastContactAt || al.updatedAt || al.createdAt,
				notes: al.notes || "",
				assignedTo: al.assignedStaffName || (al.assignedStaffId ? "Assigned" : "Unassigned"),
				staffId: al.assignedStaffId ?? null,
				consultationId: al.consultationId,
				applicationId: al.applicationId,
			})),
		[apiLeads],
	);

	const roleScopedLeads = useMemo(() => {
		if (canSeeAll) {
			if (assignFilter === "mine") return mergedLeads.filter((l) => l.assignedTo === opsUser?.name);
			if (assignFilter === "unassigned") return mergedLeads.filter((l) => !l.staffId);
			return mergedLeads;
		}
		return mergedLeads.filter(
			(l) => l.assignedTo === opsUser?.name || !l.staffId || l.stage === "new",
		);
	}, [canSeeAll, assignFilter, mergedLeads, opsUser?.name]);

	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim();
		let rows = roleScopedLeads.filter(
			(l) =>
				(stageFilter === "all" || l.stage === stageFilter) &&
				(sourceFilter === "all" || l.source === sourceFilter) &&
				(!q ||
					l.name.toLowerCase().includes(q) ||
					l.email.toLowerCase().includes(q) ||
					l.country.toLowerCase().includes(q)),
		);
		if (sort === "hottest") {
			rows = [...rows].sort(
				(a, b) =>
					heat(b, now) - heat(a, now) ||
					new Date(b.lastContactAt).getTime() - new Date(a.lastContactAt).getTime(),
			);
		} else if (sort === "newest") {
			rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
		} else {
			rows = [...rows].sort(
				(a, b) => new Date(a.lastContactAt).getTime() - new Date(b.lastContactAt).getTime(),
			);
		}
		return rows;
	}, [roleScopedLeads, stageFilter, sourceFilter, search, sort, now]);

	const sources = useMemo(
		() => [...new Set(mergedLeads.map((l) => l.source).filter(Boolean))].sort(),
		[mergedLeads],
	);

	const stats = useMemo(() => {
		const active = roleScopedLeads.filter((l) => l.stage !== "converted" && l.stage !== "lost");
		const stale = active.filter((l) => now - new Date(l.lastContactAt).getTime() > FRESH_MS);
		const converted = roleScopedLeads.filter((l) => l.stage === "converted").length;
		const weekAgo = now - 7 * 86_400_000;
		return {
			total: roleScopedLeads.length,
			newCount: roleScopedLeads.filter((l) => l.stage === "new").length,
			stale: stale.length,
			converted,
			rate: roleScopedLeads.length > 0 ? Math.round((converted / roleScopedLeads.length) * 100) : 0,
			thisWeek: roleScopedLeads.filter((l) => new Date(l.createdAt).getTime() > weekAgo).length,
			stageCounts: new Map(roleScopedLeads.map((l) => [l.stage, (roleScopedLeads.filter((x) => x.stage === l.stage).length)])),
			unassigned: roleScopedLeads.filter((l) => !l.staffId).length,
			mine: roleScopedLeads.filter((l) => l.assignedTo === opsUser?.name).length,
		};
	}, [roleScopedLeads, now, opsUser?.name]);

	const stageCounts = useMemo(() => {
		const m = new Map<LeadStage, number>();
		for (const l of roleScopedLeads) m.set(l.stage, (m.get(l.stage) ?? 0) + 1);
		return m;
	}, [roleScopedLeads]);

	/** Bands only on the All cut — a stage chip is already the cut. */
	const bands = useMemo(() => {
		if (stageFilter !== "all") {
			return [{ band: null as PadBand | null, cards: filtered }];
		}
		const by: Record<PadBand, PadLead[]> = { hot: [], warm: [], cold: [], closed: [] };
		for (const l of filtered) by[leadBand(l, now)].push(l);
		return (Object.keys(by) as PadBand[])
			.filter((b) => by[b].length > 0)
			.map((b) => ({ band: b as PadBand | null, cards: by[b] }));
	}, [filtered, stageFilter, now]);

	const updateLead = useCallback(
		async (id: string, body: Record<string, unknown>) => {
			try {
				await apiFetch(`${API_PREFIX}/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) });
				await loadApiLeads();
			} catch (err) {
				console.warn("[CRM] Lead update failed:", err);
				throw err;
			}
		},
		[loadApiLeads],
	);

	const moveStage = useCallback(
		(id: string, stage: LeadStage) => {
			setApiLeads((prev) =>
				prev.map((l) => (l.id === id ? { ...l, stage: LEAD_STAGE_TO_DB[stage] as ApiLead["stage"] } : l)),
			);
			void updateLead(id, { stage: LEAD_STAGE_TO_DB[stage] }).catch(() => void loadApiLeads());
		},
		[updateLead, loadApiLeads],
	);

	const assignLead = useCallback(
		async (id: string, opsUserId: string) => {
			await updateLead(id, { assignedStaffId: opsUserId });
		},
		[updateLead],
	);

	// The picked lead is an id — the record stays honest across the 10s refresh.
	const selected = mergedLeads.find((l) => l.id === selectedId) ?? null;
	const select = (l: PadLead) => setSelectedId((cur) => (cur === l.id ? null : l.id));

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
				<div>
					<h1 className="page-title">Leads</h1>
					<p className="lead mt-2">Every enquiry on the desk, hottest first. Pick a card to work it.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						onClick={() => {
							setLoading(true);
							void loadApiLeads().finally(() => setLoading(false));
						}}
					>
						{loading ? "Refreshing…" : "↻ Refresh"}
					</button>
					<button type="button" className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
						+ New lead
					</button>
					<span className="portal-pill" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
						{canSeeAll ? `Active: ${stats.total - stats.converted}` : "Assigned to you"}
					</span>
				</div>
			</div>

			{/* The strip: the pipeline as one mono line */}
			<div className="leads-strip">
				<span><strong>{stats.total}</strong> total</span>
				<span className="leads-strip__sep">·</span>
				<span><strong>{stats.newCount}</strong> new</span>
				<span className="leads-strip__sep">·</span>
				<span><strong>{stats.stale}</strong> unworked 48h+</span>
				<span className="leads-strip__sep">·</span>
				<span><strong>{stats.converted}</strong> enrolled</span>
				<span className="leads-strip__sep">·</span>
				<span><strong>{stats.rate}%</strong> conversion</span>
				<span className="leads-strip__sep">·</span>
				<span><strong>{stats.thisWeek}</strong> new this week</span>
			</div>

			<CaseScaffold
				bare
				rail={
					<LeadDesk
						leads={roleScopedLeads}
						now={now}
						onSelect={select}
						onNew={() => setCreating(true)}
					/>
				}
				detail={
					selected ? (
						<LeadPane
							lead={selected}
							now={now}
							assignees={assignees}
							canMove={canMoveLead(selected)}
							onMove={(stage) => void moveStage(selected.id, stage)}
							onAssign={(opsUserId) => assignLead(selected.id, opsUserId)}
						/>
					) : null
				}
				onClose={() => setSelectedId(null)}
				list={
					<>
						<div className="cn-scaffold__filters">
							<div className="cn-scaffold__chips" role="tablist" aria-label="Stage" style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
								{([{ id: "all" as const, label: "All" }, ...LEAD_STAGE_ORDER.map((s) => ({ id: s, label: LEAD_STAGE_LABELS[s] }))]).map((f) => {
									const n = f.id === "all" ? roleScopedLeads.length : stageCounts.get(f.id) ?? 0;
									const on = stageFilter === f.id;
									return (
										<button
											key={f.id}
											type="button"
											role="tab"
											aria-selected={on}
											className="ops-pill"
											onClick={() => setStageFilter(f.id)}
											style={{
												cursor: "pointer",
												border: "1px solid var(--border)",
												background: on ? "var(--foreground)" : "transparent",
												color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
												fontWeight: f.id === "new" && n > 0 && !on ? 700 : 500,
											}}
										>
											{f.label}
											<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>{n}</span>
										</button>
									);
								})}
								<span style={{ flex: 1 }} />
								{canSeeAll && (
									<>
										<button
											type="button"
											className="ops-pill"
											onClick={() => setAssignFilter((f) => (f === "unassigned" ? "all" : "unassigned"))}
											style={{
												cursor: "pointer",
												border: "1px solid var(--border)",
												background: assignFilter === "unassigned" ? "var(--foreground)" : "transparent",
												color: assignFilter === "unassigned" ? "var(--background)" : "var(--foreground)",
											}}
										>
											Unassigned
											<span className="mono" style={{ marginLeft: "0.4rem", opacity: 0.6 }}>{stats.unassigned}</span>
										</button>
										<button
											type="button"
											className="ops-pill"
											onClick={() => setAssignFilter((f) => (f === "mine" ? "all" : "mine"))}
											style={{
												cursor: "pointer",
												border: "1px solid var(--border)",
												background: assignFilter === "mine" ? "var(--foreground)" : "transparent",
												color: assignFilter === "mine" ? "var(--background)" : "var(--foreground)",
											}}
										>
											Mine
											<span className="mono" style={{ marginLeft: "0.4rem", opacity: 0.6 }}>{stats.mine}</span>
										</button>
									</>
								)}
							</div>
							<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
								<input
									type="search"
									placeholder="Search name, email or country…"
									className="cn-search"
									aria-label="Search leads"
									style={{ flex: "1 1 14rem", width: "auto" }}
									value={search}
									onChange={(e) => setSearch(e.target.value)}
								/>
								<label className="cn-filter">
									<span className="cn-filter__label">Sort</span>
									<select className="cn-filter__select" value={sort} onChange={(e) => setSort(e.target.value as SortId)}>
										{SORTS.map((s) => (
											<option key={s.id} value={s.id}>{s.label}</option>
										))}
									</select>
								</label>
								{sources.length > 1 && (
									<label className="cn-filter">
										<span className="cn-filter__label">Source</span>
										<select className="cn-filter__select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
											<option value="all">All</option>
											{sources.map((s) => (
												<option key={s} value={s}>{s}</option>
											))}
										</select>
									</label>
								)}
							</div>
						</div>

						<div className="cn-scaffold__rows">
							{filtered.length === 0 ? (
								<p className="ops-people__empty">
									{search || stageFilter !== "all" ? "No leads match this cut." : "The pad is empty — new sign-ups land here."}
								</p>
							) : (
								<div className="ops-bands">
									{bands.map((section) => (
										<div key={section.band ?? "flat"}>
											{section.band && (
												<div className="ops-band">
													<span className="ops-band__name">
														{PAD_BAND_LABEL[section.band]} · {section.cards.length}
													</span>
												</div>
											)}
											<div className="ops-people">
												{section.cards.map((l) => {
													const sel = selected?.id === l.id;
													const h = heat(l, now);
													return (
														<button
															key={l.id}
															type="button"
															className={`ops-person lead-cell${sel ? " ops-person--sel" : ""}`}
															onClick={() => select(l)}
															aria-pressed={sel}
														>
															<span className="ops-person__head">
																<span className="ops-person__name" title={l.name}>{l.name}</span>
																<span className="ops-person__when">{timeAgo(l.lastContactAt)}</span>
															</span>
															<span className="lead-cell__top">
																<HeatMeter value={h} />
																<span className="lead-cell__stage">{LEAD_STAGE_LABELS[l.stage] ?? l.stage}</span>
															</span>
															<span className="lead-cell__sub" title={l.country}>{l.country}</span>
															<span className="lead-cell__sub muted">{l.source}</span>
															<span className="ops-person__foot">
																<span className="ops-person__meta">{l.assignedTo !== "Unassigned" ? l.assignedTo : "Unassigned"}</span>
																<span className="ops-thing__arrow" aria-hidden>→</span>
															</span>
														</button>
													);
												})}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</>
				}
			/>

			{creating && (
				<NewLeadDialog
					onClose={() => setCreating(false)}
					onCreated={() => {
						setCreating(false);
						void loadApiLeads();
					}}
				/>
			)}
		</div>
	);
}

/* ── The rail: desk summary when nothing is picked ───────────────────── */

function LeadDesk({
	leads,
	now,
	onSelect,
	onNew,
}: {
	leads: PadLead[];
	now: number;
	onSelect: (l: PadLead) => void;
	onNew: () => void;
}) {
	const stale = leads
		.filter((l) => l.stage !== "converted" && l.stage !== "lost")
		.filter((l) => now - new Date(l.lastContactAt).getTime() > FRESH_MS)
		.sort((a, b) => new Date(a.lastContactAt).getTime() - new Date(b.lastContactAt).getTime())
		.slice(0, 5);
	const unassigned = leads.filter((l) => !l.staffId && l.stage !== "converted" && l.stage !== "lost").length;

	return (
		<>
			<div className="cn-scaffold__bar">
				<span className="cn-filter__label">The desk</span>
				<span className="cn-filter__label">{leads.length} leads</span>
			</div>
			<div className="cn-scaffold__body">
				<div className="cn-detail">
					<div className="card cn-now">
						<span className="cn-detailhead__kicker">
							<span className="cn-now__dot cn-now__dot--hollow" aria-hidden />
							Leads pad
						</span>
						<h3 className="cn-detailhead__title">Pick a card to work it</h3>
						<p className="cn-detailhead__sub">
							{unassigned > 0 ? `${unassigned} unassigned · ` : ""}
							{stale.length > 0 ? `${stale.length} quietest shown below` : "Nothing is going cold."}
						</p>
						<div className="cn-now__actions">
							<button type="button" className="btn btn--primary btn--sm" onClick={onNew}>
								+ New lead
							</button>
						</div>
					</div>

					{stale.length > 0 && (
						<div className="card cn-now">
							<p className="cn-detail__eyebrow">Going cold — longest untouched</p>
							<div className="cn-detail__rows">
								{stale.map((l) => (
									<button key={l.id} type="button" className="cn-detail__row cn-now__row" onClick={() => onSelect(l)}>
										<span>
											<span className="cn-now__time">{timeAgo(l.lastContactAt)}</span>
											{l.name}
										</span>
										<span className="cn-detail__row-note">{LEAD_STAGE_LABELS[l.stage] ?? l.stage}</span>
									</button>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</>
	);
}

/* ── The rail: the picked lead ───────────────────────────────────────── */

function LeadPane({
	lead,
	now,
	assignees,
	canMove,
	onMove,
	onAssign,
}: {
	lead: PadLead;
	now: number;
	assignees: { name: string; email: string; opsUserId?: string }[];
	canMove: boolean;
	onMove: (stage: LeadStage) => void;
	onAssign: (opsUserId: string) => Promise<void>;
}) {
	const [events, setEvents] = useState<LeadEvent[]>([]);
	const [assignBusy, setAssignBusy] = useState(false);
	const [assignErr, setAssignErr] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void apiFetch<{ events: LeadEvent[] }>(`${API_PREFIX}/leads/${lead.id}/events`)
			.then((res) => {
				if (!cancelled) setEvents(res.events ?? []);
			})
			.catch(() => {
				if (!cancelled) setEvents([]);
			});
		return () => {
			cancelled = true;
		};
	}, [lead.id]);

	const idx = (STEPPER_STAGES as LeadStage[]).indexOf(lead.stage);
	const next = idx >= 0 ? STEPPER_STAGES[idx + 1] : undefined;
	const prev = idx > 0 ? STEPPER_STAGES[idx - 1] : undefined;
	const closed = lead.stage === "converted" || lead.stage === "lost";

	return (
		<div className="cn-detail">
			<div className="card" style={{ padding: "1.25rem", borderBottom: "none" }}>
				<span className="cn-detailhead__kicker">
					{LEAD_STAGE_LABELS[lead.stage] ?? lead.stage} · <HeatMeter value={heat(lead, now)} />
				</span>
				<h3 className="cn-detailhead__title" style={{ fontSize: "1.25rem", margin: "0.25rem 0" }}>{lead.name}</h3>
				<p className="cn-detailhead__sub">{lead.country} · {lead.source}</p>
				<p className="cn-detailhead__meta">Last touch {timeAgo(lead.lastContactAt)} · Captured {whenLabel(lead.createdAt)}</p>

				{/* The walk: New → Contacted → Booked → Assessed → Enrolled */}
				<div className="lead-stepper" aria-label={`Stage: ${LEAD_STAGE_LABELS[lead.stage] ?? lead.stage}`}>
					{STEPPER_STAGES.map((s, i) => (
						<span key={s} className="lead-stepper__seg">
							<span className={`lead-stepper__dot${i <= idx ? " lead-stepper__dot--on" : ""}`} title={LEAD_STAGE_LABELS[s]} />
							{i < STEPPER_STAGES.length - 1 && <span className="lead-stepper__line" />}
						</span>
					))}
				</div>

				{canMove && !closed && (
					<div className="cn-now__actions">
						{next && (
							<button type="button" className="btn btn--primary btn--sm" onClick={() => onMove(next)}>
								{LEAD_STAGE_LABELS[next]} →
							</button>
						)}
						{prev && (
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => onMove(prev)}>
								← {LEAD_STAGE_LABELS[prev]}
							</button>
						)}
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => onMove("lost")}>
							Mark lost
						</button>
					</div>
				)}
				{lead.stage === "lost" && canMove && (
					<div className="cn-now__actions">
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => onMove("new")}>
							Reopen as new
						</button>
					</div>
				)}
			</div>

			<div className="card" style={{ padding: "1.25rem" }}>
				<p className="cn-detail__eyebrow" style={{ marginBottom: "0.75rem" }}>Contact</p>
				<div className="lead-kv"><span className="lead-kv__k">Phone</span><span className="lead-kv__v mono">{lead.phone}</span></div>
				<div className="lead-kv"><span className="lead-kv__k">Email</span><span className="lead-kv__v">{lead.email}</span></div>
				<div className="lead-kv"><span className="lead-kv__k">Source</span><span className="lead-kv__v">{lead.source}</span></div>
				<div className="lead-kv"><span className="lead-kv__k">Country</span><span className="lead-kv__v">{lead.country}</span></div>
				{lead.notes && <p className="lead-note">{lead.notes}</p>}
			</div>

			<div className="card" style={{ padding: "1.25rem" }}>
				<p className="cn-detail__eyebrow" style={{ marginBottom: "0.75rem" }}>Owner</p>
				<p className="cn-detailhead__meta" style={{ marginBottom: "0.6rem" }}>
					{lead.assignedTo !== "Unassigned" ? lead.assignedTo : "Nobody has this lead yet."}
				</p>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					<select
						className="cn-filter__select"
						style={{ flex: 1 }}
						defaultValue=""
						id={`lead-assign-${lead.id}`}
					>
						<option value="" disabled>Assign to…</option>
						{assignees.filter((a) => a.opsUserId).map((a) => (
							<option key={a.opsUserId} value={a.opsUserId}>{a.name}</option>
						))}
					</select>
					<button
						type="button"
						className="btn btn--primary btn--sm"
						disabled={assignBusy}
						onClick={(e) => {
							const sel = (e.currentTarget.parentElement?.querySelector("select") as HTMLSelectElement | null);
							if (!sel?.value) return;
							setAssignBusy(true);
							setAssignErr(null);
							onAssign(sel.value)
								.catch((err: unknown) => setAssignErr(err instanceof Error ? err.message : "Could not assign"))
								.finally(() => setAssignBusy(false));
						}}
					>
						{assignBusy ? "Assigning…" : "Assign"}
					</button>
				</div>
				{assignErr && <p className="ops-modal__error" style={{ marginTop: "0.5rem" }}>{assignErr}</p>}
			</div>

			{(lead.consultationId || lead.applicationId) && (
				<div className="card" style={{ padding: "1.25rem" }}>
					<p className="cn-detail__eyebrow" style={{ marginBottom: "0.75rem" }}>Linked records</p>
					<div className="cn-detail__rows">
						{lead.consultationId && (
							<Link to="/consultations" className="cn-detail__row cn-now__row" style={{ textDecoration: "none", color: "inherit" }}>
								<span>Consultation</span>
								<span className="cn-detail__row-note">Open →</span>
							</Link>
						)}
						{lead.applicationId && (
							<Link to="/applications" className="cn-detail__row cn-now__row" style={{ textDecoration: "none", color: "inherit" }}>
								<span>Application</span>
								<span className="cn-detail__row-note">Open →</span>
							</Link>
						)}
					</div>
				</div>
			)}

			{events.length > 0 && (
				<div className="card" style={{ padding: "1.25rem" }}>
					<p className="cn-detail__eyebrow">Trail</p>
					<ul className="cn-timeline">
						{events.slice(0, 6).map((e) => (
							<li key={e.id} className="cn-timeline__item">
								<div className="cn-timeline__head">
									<span className="cn-timeline__summary">{e.type.replace(/_/g, " ")}</span>
									<span className="cn-timeline__when">{whenLabel(e.createdAt)}</span>
								</div>
								{e.actorName && <p className="cn-timeline__meta">{e.actorName}</p>}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

/* ── New lead ────────────────────────────────────────────────────────── */

function NewLeadDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [source, setSource] = useState("");
	const [country, setCountry] = useState("");
	const [notes, setNotes] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			await apiFetch(`${API_PREFIX}/leads`, {
				method: "POST",
				body: JSON.stringify({
					name: name.trim(),
					email: email.trim(),
					phone: phone.trim() || null,
					source: source.trim() || undefined,
					targetCountry: country.trim() || null,
					notes: notes.trim() || null,
				}),
			});
			onCreated();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not create lead");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="New lead">
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">New lead</h2>
						<p className="ops-modal__sub">A walk-in, a referral, a phone call — capture it on the pad.</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>✕</button>
				</header>
				{error && <p className="ops-modal__error">{error}</p>}
				<div className="ops-modal__content" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
					<input className="input" placeholder="Full name *" value={name} onChange={(e) => setName(e.target.value)} />
					<input className="input" type="email" placeholder="Email *" value={email} onChange={(e) => setEmail(e.target.value)} />
					<input className="input" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
					<input className="input" placeholder="Source (walk-in, referral, Instagram…)" value={source} onChange={(e) => setSource(e.target.value)} />
					<input className="input" placeholder="Target country" value={country} onChange={(e) => setCountry(e.target.value)} />
					<textarea className="input" placeholder="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
				</div>
				<p className="ops-modal__foot">
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>Cancel</button>
					<button
						type="button"
						className="btn btn--primary btn--sm"
						disabled={busy || !name.trim() || !email.trim()}
						onClick={() => void submit()}
					>
						{busy ? "Adding…" : "Add lead"}
					</button>
				</p>
			</div>
		</div>
	);
}
