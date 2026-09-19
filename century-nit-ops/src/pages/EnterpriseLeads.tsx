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
import {
	LEAD_STAGE_TO_DB,
	LEAD_STAGE_FROM_DB,
	API_PREFIX,
	LEAD_TOUCH_CHANNEL_LABELS,
	LEAD_TOUCH_OUTCOME_LABELS,
	LEAD_LOST_REASON_LABELS,
	type ApiLead,
	type LeadEvent,
	type LeadLostReason,
	type LeadTouchChannel,
	type LeadTouchOutcome,
} from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { CaseScaffold } from "./case/CaseScaffold";
import { whenLabel } from "../lib/pendingTasks";
import { useUrlParam } from "../hooks/useUrlParam";

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

type PadLead = Lead & {
	staffId: string | null;
	/** The last human touch of the client — not just any record edit. */
	lastClientTouchAt?: string | null;
	lostReason?: LeadLostReason | null;
	lostNote?: string | null;
	nextTask?: { id: string; title: string; dueAt: string } | null;
	updatedAt?: string;
};

/** The touch clock the bands read: real client contact, falling back to record age. */
function touchAt(l: PadLead): string {
	return l.lastClientTouchAt || l.lastContactAt || l.createdAt;
}

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
	const touched = now - new Date(touchAt(l)).getTime();
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
	const touched = now - new Date(touchAt(l)).getTime();
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
	// ?id= makes a lead a shareable link — queue rows and task reminders land here.
	const [selectedId, setSelectedId] = useUrlParam("id");
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
				lastClientTouchAt: al.lastClientTouchAt ?? null,
				lostReason: al.lostReason ?? null,
				lostNote: al.lostNote ?? null,
				nextTask: al.nextTask ?? null,
				updatedAt: al.updatedAt,
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
					new Date(touchAt(b)).getTime() - new Date(touchAt(a)).getTime(),
			);
		} else if (sort === "newest") {
			rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
		} else {
			rows = [...rows].sort(
				(a, b) => new Date(touchAt(a)).getTime() - new Date(touchAt(b)).getTime(),
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
		const stale = active.filter((l) => now - new Date(touchAt(l)).getTime() > FRESH_MS);
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
		(id: string, stage: LeadStage, extra?: { lostReason?: LeadLostReason; lostNote?: string }) => {
			setApiLeads((prev) =>
				prev.map((l) => (l.id === id ? { ...l, stage: LEAD_STAGE_TO_DB[stage] as ApiLead["stage"] } : l)),
			);
			void updateLead(id, {
				stage: LEAD_STAGE_TO_DB[stage],
				...(extra?.lostReason ? { lostReason: extra.lostReason, lostNote: extra.lostNote ?? null } : {}),
			}).catch(() => void loadApiLeads());
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
	const select = (l: PadLead) => setSelectedId(selectedId === l.id ? null : l.id);

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
							onMove={(stage, extra) => void moveStage(selected.id, stage, extra)}
							onAssign={(opsUserId) => assignLead(selected.id, opsUserId)}
							onChanged={() => void loadApiLeads()}
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
																<span className="ops-person__when" title="Last client touch">{timeAgo(touchAt(l))}</span>
															</span>
															<span className="lead-cell__top">
																<HeatMeter value={h} />
																<span className="lead-cell__stage">{LEAD_STAGE_LABELS[l.stage] ?? l.stage}</span>
															</span>
															<span className="lead-cell__sub" title={l.country}>{l.country}</span>
															{l.nextTask ? (
																<span className="lead-cell__sub muted" title={l.nextTask.title}>◷ {whenLabel(l.nextTask.dueAt)}</span>
															) : (
																<span className="lead-cell__sub muted">{l.source}</span>
															)}
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
		.filter((l) => now - new Date(touchAt(l)).getTime() > FRESH_MS)
		.sort((a, b) => new Date(touchAt(a)).getTime() - new Date(touchAt(b)).getTime())
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
	onChanged,
}: {
	lead: PadLead;
	now: number;
	assignees: { name: string; email: string; opsUserId?: string }[];
	canMove: boolean;
	onMove: (stage: LeadStage, extra?: { lostReason?: LeadLostReason; lostNote?: string }) => void;
	onAssign: (opsUserId: string) => Promise<void>;
	onChanged: () => void;
}) {
	const [events, setEvents] = useState<LeadEvent[]>([]);
	const [assignBusy, setAssignBusy] = useState(false);
	const [assignErr, setAssignErr] = useState<string | null>(null);
	const [sheet, setSheet] = useState<"log" | "followup" | "edit" | "lost" | null>(null);
	const [taskBusy, setTaskBusy] = useState(false);

	const reloadEvents = useCallback(() => {
		void apiFetch<{ events: LeadEvent[] }>(`${API_PREFIX}/leads/${lead.id}/events`)
			.then((res) => setEvents(res.events ?? []))
			.catch(() => setEvents([]));
	}, [lead.id]);

	useEffect(() => {
		reloadEvents();
	}, [reloadEvents]);

	const idx = (STEPPER_STAGES as LeadStage[]).indexOf(lead.stage);
	const next = idx >= 0 ? STEPPER_STAGES[idx + 1] : undefined;
	const prev = idx > 0 ? STEPPER_STAGES[idx - 1] : undefined;
	const closed = lead.stage === "converted" || lead.stage === "lost";
	const nextTask = lead.nextTask ?? null;
	const taskOverdue = nextTask ? new Date(nextTask.dueAt).getTime() < now : false;

	const doneTask = useCallback(async () => {
		if (!nextTask) return;
		setTaskBusy(true);
		try {
			await apiFetch(`${API_PREFIX}/tasks/${nextTask.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
			onChanged();
		} catch {
			/* the strip simply stays until the next refresh */
		} finally {
			setTaskBusy(false);
		}
	}, [nextTask, onChanged]);

	return (
		<div className="cn-detail">
			<div className="card" style={{ padding: "1.25rem", borderBottom: "none" }}>
				<span className="cn-detailhead__kicker">
					{LEAD_STAGE_LABELS[lead.stage] ?? lead.stage} · <HeatMeter value={heat(lead, now)} />
				</span>
				<h3 className="cn-detailhead__title" style={{ fontSize: "1.25rem", margin: "0.25rem 0" }}>{lead.name}</h3>
				<p className="cn-detailhead__sub">{lead.country} · {lead.source}</p>
				<p className="cn-detailhead__meta">
					{lead.lastClientTouchAt
						? <>Last client touch <b>{timeAgo(lead.lastClientTouchAt)}</b></>
						: "Never touched — nobody has reached them yet"}
					{lead.updatedAt && <> · record edited {timeAgo(lead.updatedAt)}</>}
					{" · Captured "}{whenLabel(lead.createdAt)}
				</p>

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
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheet("log")}>
							+ Log touch
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheet("followup")}>
							+ Follow up
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheet("lost")}>
							Mark lost
						</button>
					</div>
				)}
				{closed && canMove && (
					<div className="cn-now__actions">
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheet("log")}>
							+ Log touch
						</button>
						{lead.stage === "lost" && (
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => onMove("new")}>
								Reopen as new
							</button>
						)}
					</div>
				)}

				{nextTask && (
					<div className="lead-fup">
						<span className={`lead-fup__when${taskOverdue ? " lead-fup__when--over" : ""}`}>
							◷ {whenLabel(nextTask.dueAt)}
						</span>
						<span className="lead-fup__title">{nextTask.title}</span>
						<button type="button" className="lead-fup__done" disabled={taskBusy} onClick={() => void doneTask()}>
							{taskBusy ? "…" : "done ✓"}
						</button>
					</div>
				)}
			</div>

			{lead.stage === "lost" && lead.lostReason && (
				<div className="card" style={{ padding: "1.25rem" }}>
					<p className="cn-detail__eyebrow" style={{ marginBottom: "0.5rem" }}>Why it was lost</p>
					<p className="cn-detailhead__meta" style={{ fontWeight: 600 }}>{LEAD_LOST_REASON_LABELS[lead.lostReason]}</p>
					{lead.lostNote && <p className="lead-note">{lead.lostNote}</p>}
				</div>
			)}

			<div className="card" style={{ padding: "1.25rem" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem" }}>
					<p className="cn-detail__eyebrow" style={{ margin: 0 }}>Contact</p>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheet("edit")}>✎ Edit</button>
				</div>
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
					<p className="cn-detail__eyebrow">Trail — people and machine, one feed</p>
					<ul className="cn-timeline">
						{events.slice(0, 10).map((e) => <TrailItem key={e.id} e={e} />)}
					</ul>
				</div>
			)}

			{sheet === "log" && (
				<LogTouchSheet
					lead={lead}
					assignees={assignees}
					onClose={() => setSheet(null)}
					onDone={() => { setSheet(null); reloadEvents(); onChanged(); }}
				/>
			)}
			{sheet === "followup" && (
				<FollowUpSheet
					lead={lead}
					assignees={assignees}
					onClose={() => setSheet(null)}
					onDone={() => { setSheet(null); reloadEvents(); onChanged(); }}
				/>
			)}
			{sheet === "edit" && (
				<EditLeadSheet lead={lead} onClose={() => setSheet(null)} onDone={() => { setSheet(null); onChanged(); }} />
			)}
			{sheet === "lost" && (
				<LostReasonDialog
					lead={lead}
					onClose={() => setSheet(null)}
					onDone={(reason, note) => { setSheet(null); onMove("lost", { lostReason: reason, lostNote: note }); }}
				/>
			)}
		</div>
	);
}

/** One trail row — human touches carry channel + outcome; system rows stay terse. */
function TrailItem({ e }: { e: LeadEvent }) {
	const p = (e.payload ?? {}) as { outcome?: string | null; body?: string | null; reason?: string | null; note?: string | null; title?: string | null; dueAt?: string | null };
	const touch = e.type.startsWith("touch.");
	const channel = touch ? (e.type.slice(6) as LeadTouchChannel) : null;
	const label = touch
		? `${LEAD_TOUCH_CHANNEL_LABELS[channel ?? "note"] ?? channel}${p.outcome ? ` · ${LEAD_TOUCH_OUTCOME_LABELS[p.outcome as LeadTouchOutcome] ?? p.outcome}` : ""}`
		: e.type === "lost" && p.reason
			? `lost — ${LEAD_LOST_REASON_LABELS[p.reason as LeadLostReason] ?? p.reason}`
			: e.type.replace(/_/g, " ");
	return (
		<li className={`cn-timeline__item${touch ? "" : " cn-timeline__item--sys"}`}>
			<div className="cn-timeline__head">
				<span className="cn-timeline__summary">{label}</span>
				<span className="cn-timeline__when">{whenLabel(e.createdAt)}</span>
			</div>
			{e.actorName && <p className="cn-timeline__meta">{e.actorName}</p>}
			{p.body && <p className="cn-timeline__meta" style={{ marginTop: "0.2rem" }}>{p.body}</p>}
			{e.type === "lost" && p.note && <p className="cn-timeline__meta" style={{ marginTop: "0.2rem" }}>{p.note}</p>}
			{e.type === "followup_scheduled" && p.title && (
				<p className="cn-timeline__meta" style={{ marginTop: "0.2rem" }}>◷ {p.title} — {p.dueAt ? whenLabel(p.dueAt) : ""}</p>
			)}
		</li>
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

/* ── Log a touch ─────────────────────────────────────────────────────────── */

const TOUCH_CHANNELS: LeadTouchChannel[] = ["call", "whatsapp", "email", "visit", "note"];
const TOUCH_OUTCOMES: LeadTouchOutcome[] = ["reached", "no_answer", "left_message", "promised_callback"];

function LogTouchSheet({
	lead,
	assignees,
	onClose,
	onDone,
}: {
	lead: PadLead;
	assignees: { name: string; email: string; opsUserId?: string }[];
	onClose: () => void;
	onDone: () => void;
}) {
	const [channel, setChannel] = useState<LeadTouchChannel>("call");
	const [outcome, setOutcome] = useState<LeadTouchOutcome>("reached");
	const [body, setBody] = useState("");
	const [fupTitle, setFupTitle] = useState("");
	const [fupDate, setFupDate] = useState("");
	const [fupAssignee, setFupAssignee] = useState(lead.staffId ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			await apiFetch(`${API_PREFIX}/leads/${lead.id}/touches`, {
				method: "POST",
				body: JSON.stringify({
					channel,
					outcome: channel === "note" ? undefined : outcome,
					body: body.trim() || undefined,
					followUp:
						fupTitle.trim() && fupDate
							? {
									title: fupTitle.trim(),
									dueAt: new Date(`${fupDate}T09:00:00`).toISOString(),
									assigneeOpsUserId: fupAssignee || undefined,
								}
							: undefined,
				}),
			});
			onDone();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not log the touch");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Log a touch">
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">Log a touch</h2>
						<p className="ops-modal__sub">{lead.name} — what just happened?</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>✕</button>
				</header>
				{error && <p className="ops-modal__error">{error}</p>}
				<div className="ops-modal__content" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
					<div>
						<p className="cn-filter__label" style={{ marginBottom: "0.4rem" }}>How</p>
						<div className="ops-picks">
							{TOUCH_CHANNELS.map((ch) => (
								<button key={ch} type="button" className={`ops-pick${channel === ch ? " ops-pick--on" : ""}`} onClick={() => setChannel(ch)} aria-pressed={channel === ch}>
									<span className="ops-pick__bx" aria-hidden /> {LEAD_TOUCH_CHANNEL_LABELS[ch]}
								</button>
							))}
						</div>
					</div>
					{channel !== "note" && (
						<div>
							<p className="cn-filter__label" style={{ marginBottom: "0.4rem" }}>Outcome</p>
							<div className="ops-picks">
								{TOUCH_OUTCOMES.map((o) => (
									<button key={o} type="button" className={`ops-pick${outcome === o ? " ops-pick--on" : ""}`} onClick={() => setOutcome(o)} aria-pressed={outcome === o}>
										<span className="ops-pick__bx" aria-hidden /> {LEAD_TOUCH_OUTCOME_LABELS[o]}
									</button>
								))}
							</div>
						</div>
					)}
					<label>
						<p className="cn-filter__label" style={{ marginBottom: "0.4rem" }}>What happened</p>
						<textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Wants January intake — passport renewing first…" />
					</label>
					<div style={{ borderTop: "1px dashed var(--border-light)", paddingTop: "0.75rem" }}>
						<p className="cn-filter__label" style={{ marginBottom: "0.4rem" }}>Follow up — optional, becomes a task</p>
						<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
							<input className="input" style={{ flex: "2 1 10rem" }} placeholder="Call back about…" value={fupTitle} onChange={(e) => setFupTitle(e.target.value)} />
							<input className="input" style={{ flex: "1 1 8rem" }} type="date" value={fupDate} onChange={(e) => setFupDate(e.target.value)} />
						</div>
						{fupTitle.trim() && fupDate && (
							<select className="cn-filter__select" style={{ marginTop: "0.5rem", width: "100%" }} value={fupAssignee} onChange={(e) => setFupAssignee(e.target.value)}>
								<option value="">Assignee — me by default</option>
								{assignees.filter((a) => a.opsUserId).map((a) => (
									<option key={a.opsUserId} value={a.opsUserId}>{a.name}</option>
								))}
							</select>
						)}
					</div>
				</div>
				<p className="ops-modal__foot">
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>Cancel</button>
					<button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void submit()}>
						{busy ? "Logging…" : "Log it"}
					</button>
				</p>
			</div>
		</div>
	);
}

/* ── Follow up ───────────────────────────────────────────────────────────── */

function FollowUpSheet({
	lead,
	assignees,
	onClose,
	onDone,
}: {
	lead: PadLead;
	assignees: { name: string; email: string; opsUserId?: string }[];
	onClose: () => void;
	onDone: () => void;
}) {
	const [title, setTitle] = useState("");
	const [dueAt, setDueAt] = useState("");
	const [assignee, setAssignee] = useState(lead.staffId ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			await apiFetch(`${API_PREFIX}/tasks`, {
				method: "POST",
				body: JSON.stringify({
					title: title.trim(),
					dueAt: new Date(`${dueAt}T09:00:00`).toISOString(),
					assigneeOpsUserId: assignee || undefined,
					leadId: lead.id,
				}),
			});
			onDone();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save the follow-up");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Follow up">
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">Follow up</h2>
						<p className="ops-modal__sub">{lead.name} — lands in the work queue, reminds its owner.</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>✕</button>
				</header>
				{error && <p className="ops-modal__error">{error}</p>}
				<div className="ops-modal__content" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
					<input className="input" placeholder="Call back about January intake…" value={title} onChange={(e) => setTitle(e.target.value)} />
					<label>
						<p className="cn-filter__label" style={{ marginBottom: "0.4rem" }}>Due</p>
						<input className="input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
					</label>
					<select className="cn-filter__select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
						<option value="">Unassigned — sits in the shared queue</option>
						{assignees.filter((a) => a.opsUserId).map((a) => (
							<option key={a.opsUserId} value={a.opsUserId}>{a.name}</option>
						))}
					</select>
				</div>
				<p className="ops-modal__foot">
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>Cancel</button>
					<button type="button" className="btn btn--primary btn--sm" disabled={busy || !title.trim() || !dueAt} onClick={() => void submit()}>
						{busy ? "Saving…" : "Save follow-up"}
					</button>
				</p>
			</div>
		</div>
	);
}

/* ── Edit the record ─────────────────────────────────────────────────────── */

function EditLeadSheet({ lead, onClose, onDone }: { lead: PadLead; onClose: () => void; onDone: () => void }) {
	const [name, setName] = useState(lead.name);
	const [email, setEmail] = useState(lead.email);
	const [phone, setPhone] = useState(lead.phone === "-" ? "" : lead.phone);
	const [country, setCountry] = useState(lead.country === "Ghana" ? "" : lead.country);
	const [notes, setNotes] = useState(lead.notes);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			await apiFetch(`${API_PREFIX}/leads/${lead.id}`, {
				method: "PATCH",
				body: JSON.stringify({
					name: name.trim(),
					email: email.trim(),
					phone: phone.trim() || null,
					targetCountry: country.trim() || null,
					notes: notes.trim() || null,
				}),
			});
			onDone();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save the lead");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit lead">
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">Edit lead</h2>
						<p className="ops-modal__sub">Fix the record — name, contact, where they're headed.</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>✕</button>
				</header>
				{error && <p className="ops-modal__error">{error}</p>}
				<div className="ops-modal__content" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
					<input className="input" placeholder="Full name *" value={name} onChange={(e) => setName(e.target.value)} />
					<input className="input" type="email" placeholder="Email *" value={email} onChange={(e) => setEmail(e.target.value)} />
					<input className="input" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
					<input className="input" placeholder="Target country" value={country} onChange={(e) => setCountry(e.target.value)} />
					<textarea className="input" placeholder="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
				</div>
				<p className="ops-modal__foot">
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>Cancel</button>
					<button type="button" className="btn btn--primary btn--sm" disabled={busy || !name.trim() || !email.trim()} onClick={() => void submit()}>
						{busy ? "Saving…" : "Save"}
					</button>
				</p>
			</div>
		</div>
	);
}

/* ── Mark lost — the reason is the data ──────────────────────────────────── */

const LOST_REASONS: { id: LeadLostReason; hint: string }[] = [
	{ id: "no_response", hint: "unreachable after repeated attempts" },
	{ id: "cost", hint: "couldn't afford the package or fees" },
	{ id: "competitor", hint: "chose another agency" },
	{ id: "not_eligible", hint: "academics, documents, funds" },
	{ id: "changed_plans", hint: "no longer travelling / studying" },
	{ id: "other", hint: "say it below" },
];

function LostReasonDialog({
	lead,
	onClose,
	onDone,
}: {
	lead: PadLead;
	onClose: () => void;
	onDone: (reason: LeadLostReason, note?: string) => void;
}) {
	const [reason, setReason] = useState<LeadLostReason | null>(null);
	const [note, setNote] = useState("");

	return (
		<div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Mark lost">
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">Mark lost — why?</h2>
						<p className="ops-modal__sub">{lead.name} — the reason is what Reports can group.</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>✕</button>
				</header>
				<div className="ops-modal__content">
					<ul className="lead-lost">
						{LOST_REASONS.map((r) => (
							<li key={r.id}>
								<button
									type="button"
									className={`lead-lost__opt${reason === r.id ? " lead-lost__opt--on" : ""}`}
									onClick={() => setReason(r.id)}
									aria-pressed={reason === r.id}
								>
									<span className="lead-lost__rb" aria-hidden />
									<span>
										{LEAD_LOST_REASON_LABELS[r.id]}
										<small>{r.hint}</small>
									</span>
								</button>
							</li>
						))}
					</ul>
					<textarea
						className="input"
						rows={2}
						placeholder="Note — optional"
						style={{ marginTop: "0.75rem", width: "100%" }}
						value={note}
						onChange={(e) => setNote(e.target.value)}
					/>
				</div>
				<p className="ops-modal__foot">
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Keep lead</button>
					<button
						type="button"
						className="btn btn--primary btn--sm"
						disabled={!reason}
						onClick={() => reason && onDone(reason, note.trim() || undefined)}
					>
						Mark lost
					</button>
				</p>
			</div>
		</div>
	);
}
