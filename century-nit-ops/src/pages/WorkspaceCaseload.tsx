import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCases } from "../hooks/useCases";
import { useOpsAuth } from "./OpsAuthContext";
import { useChatHub } from "./ChatHubContext";
import { UnassignedQueue } from "./UnassignedBookings";
import {
	JOURNEY_STAGES,
	JOURNEY_STAGE_LABELS,
	type JourneyStage,
} from "century-nit-shared";

/**
 * The Workspace's Caseload view — every assigned case and consultation, who
 * carries it, and where each stands on the journey. Same records as the
 * Worklist, same `scopeRecords` scoping: a manager sees the team, a
 * consultant sees their own load.
 *
 * Rows are derived from the shared `useCases()` store — there is no separate
 * assignments API to keep in sync.
 */

type AssignmentRow = {
	id: string;
	type: "case" | "consultation";
	reference: string;
	clientName: string;
	clientEmail: string | null;
	assignedStaffId: string | null;
	assignedStaffName: string | null;
	assignedStaffEmail: string | null;
	stageOrStatus: string;
	stageOrStatusLabel: string;
	updatedAt: string;
	link: string;
};

const TYPES = ["all", "case", "consultation", "unassigned"] as const;

const TYPE_LABELS: Record<(typeof TYPES)[number], string> = {
	all: "All Records",
	case: "Cases",
	consultation: "Consultations",
	unassigned: "Unassigned Queue",
};

function relativeTime(iso: string) {
	if (!iso) return "—";
	const diff = Date.now() - new Date(iso).getTime();
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString();
}

/**
 * Stage progress derived from the real enum values. Cases use
 * `JOURNEY_STAGES` — the same array the board and Applications page use —
 * so a case is always on the same step here as it is there. Consultations
 * map their status enum onto a 4-step assessment model.
 */
function getStageProgress(type: "case" | "consultation", stageOrStatus: string): { step: number; total: number; label: string } {
	if (type === "case") {
		const idx = (JOURNEY_STAGES as readonly string[]).indexOf(stageOrStatus);
		const step = idx >= 0 ? idx + 1 : 1;
		const label = JOURNEY_STAGE_LABELS[stageOrStatus as JourneyStage] ?? stageOrStatus;
		return { step, total: JOURNEY_STAGES.length, label };
	}
	const map: Record<string, { step: number; label: string }> = {
		"Under Review": { step: 1, label: "Under Review" },
		"Assigned": { step: 2, label: "Assigned" },
		"Confirmed": { step: 2, label: "Confirmed" },
		"In Assessment": { step: 3, label: "In Assessment" },
		"Completed": { step: 4, label: "Completed" },
		"Cancelled": { step: 0, label: "Cancelled" },
	};
	return { step: map[stageOrStatus]?.step ?? 1, total: 4, label: map[stageOrStatus]?.label ?? stageOrStatus };
}

export function WorkspaceCaseload() {
	const { scopeRecords, opsUser } = useOpsAuth();
	const { applications, consultations, assignees, loading, error, refresh: refreshCases } = useCases();
	const { openDM } = useChatHub();

	const [type, setType] = useState<(typeof TYPES)[number]>("all");
	const [selectedStaff, setSelectedStaff] = useState<string>("all");
	const [search, setSearch] = useState("");

	const staffIdByEmail = (email: string | null | undefined) =>
		email ? (assignees.find((a) => a.email === email)?.opsUserId ?? null) : null;

	/** Derive the unified rows from the shared stores — no separate API call. */
	const items = useMemo<AssignmentRow[]>(() => {
		const scopedApps = scopeRecords(applications, (a) => Boolean(a.assignedStaffEmail || a.assignedStaff));
		const scopedCons = scopeRecords(consultations, (c) => Boolean(c.assignedOfficerEmail || c.assignedOfficer));

		const rows: AssignmentRow[] = [];

		for (const app of scopedApps) {
			rows.push({
				id: app.id,
				type: "case",
				reference: app.appId,
				clientName: app.applicantName,
				clientEmail: app.email,
				assignedStaffId: staffIdByEmail(app.assignedStaffEmail),
				assignedStaffName: app.assignedStaff || null,
				assignedStaffEmail: app.assignedStaffEmail || null,
				stageOrStatus: app.stage,
				stageOrStatusLabel: JOURNEY_STAGE_LABELS[app.stage as JourneyStage] ?? app.stage,
				updatedAt: app.updatedAt ?? app.submittedDate,
				link: "/applications",
			});
		}

		for (const c of scopedCons) {
			rows.push({
				id: c.id,
				type: "consultation",
				reference: c.ref,
				clientName: c.applicantName,
				clientEmail: c.email,
				assignedStaffId: staffIdByEmail(c.assignedOfficerEmail),
				assignedStaffName: c.assignedOfficer || null,
				assignedStaffEmail: c.assignedOfficerEmail || null,
				stageOrStatus: c.status,
				stageOrStatusLabel: c.status,
				updatedAt: c.updatedAt ?? c.slotDate ?? c.dateTime,
				link: "/consultations",
			});
		}

		return rows;
		// eslint-disable-next-line react-hooks/exhaustive-deps -- staffIdByEmail is stable per render
	}, [applications, consultations, scopeRecords, assignees]);

	// Roster of staff members and their respective breakdown.
	const staffList = useMemo(() => {
		const map = new Map<
			string,
			{ id: string; name: string; email: string | null; cases: number; consultations: number; total: number }
		>();

		for (const i of items) {
			if (i.assignedStaffId && i.assignedStaffName) {
				const existing = map.get(i.assignedStaffId) || {
					id: i.assignedStaffId,
					name: i.assignedStaffName,
					email: i.assignedStaffEmail,
					cases: 0,
					consultations: 0,
					total: 0,
				};
				if (i.type === "case") existing.cases++;
				else existing.consultations++;
				existing.total++;
				map.set(i.assignedStaffId, existing);
			}
		}
		return Array.from(map.values()).sort((a, b) => b.total - a.total);
	}, [items]);

	const filtered = useMemo(() => {
		let list = items;
		if (type === "unassigned") {
			list = list.filter((i) => !i.assignedStaffId);
		} else if (type !== "all") {
			list = list.filter((i) => i.type === type);
		}
		if (selectedStaff !== "all") {
			list = list.filter((i) => i.assignedStaffId === selectedStaff);
		}
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(i) =>
					i.reference.toLowerCase().includes(q) ||
					i.clientName.toLowerCase().includes(q) ||
					(i.clientEmail ?? "").toLowerCase().includes(q) ||
					(i.assignedStaffName ?? "").toLowerCase().includes(q),
			);
		}
		return list;
	}, [items, type, selectedStaff, search]);

	const stats = useMemo(() => ({
		cases: items.filter((i) => i.type === "case").length,
		consultations: items.filter((i) => i.type === "consultation").length,
		staff: staffList.length,
		unassigned: items.filter((i) => !i.assignedStaffId).length,
	}), [items, staffList]);

	return (
		<div>
			{error && <p className="ops-modal__error" role="alert">{error}</p>}

			{/* Summary first — a manager reads who is carrying what before the rows. */}
			{staffList.length > 0 && (
				<section className="ops-panel" style={{ marginBottom: "1.25rem" }}>
					<header className="ops-panel__head">
						<h2 className="section-title">Workload distribution</h2>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => void refreshCases()} disabled={loading}>
							{loading ? "Refreshing…" : "Refresh"}
						</button>
					</header>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem" }}>
						{staffList.map((s) => {
							const capacityPercent = Math.min(100, Math.round((s.total / 10) * 100));
							return (
								<div
									key={s.id}
									style={{
										border: "1px solid var(--border-light)",
										padding: "0.85rem",
										display: "flex",
										flexDirection: "column",
										justifyContent: "space-between",
										gap: "0.75rem",
									}}
								>
									<div>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
											<div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
												<span
													style={{
														width: "28px",
														height: "28px",
														background: "var(--foreground)",
														color: "var(--background)",
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														fontSize: "0.7rem",
														fontWeight: 800,
														fontFamily: "var(--font-mono, monospace)",
													}}
												>
													{s.name.slice(0, 2).toUpperCase()}
												</span>
												<div>
													<p style={{ fontWeight: 800, margin: 0, fontSize: "var(--text-sm)" }}>{s.name}</p>
													{s.email && (
														<p className="ops-table__sub" style={{ margin: 0, fontFamily: "var(--font-mono, monospace)" }}>
															{s.email}
														</p>
													)}
												</div>
											</div>
											<span style={{ fontSize: "1.1rem", fontWeight: 900, fontFamily: "var(--font-mono, monospace)" }}>
												{s.total}
											</span>
										</div>
										<div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
											<span className="ops-pill">Cases: {s.cases}</span>
											<span className="ops-pill">Consultations: {s.consultations}</span>
										</div>
										<div>
											<div className="ops-table__sub" style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
												<span>Capacity load</span>
												<span>{s.total}/10 slots</span>
											</div>
											<div style={{ height: "3px", width: "100%", background: "var(--border-light)" }}>
												<div
													style={{
														height: "100%",
														width: `${capacityPercent}%`,
														background: "var(--foreground)",
													}}
												/>
											</div>
										</div>
									</div>
									{s.id !== opsUser?.opsUserId && (
										<button
											type="button"
											className="btn btn--primary btn--sm"
											style={{ width: "100%" }}
											onClick={() => void openDM(s.id)}
										>
											Message {s.name.split(" ")[0]}
										</button>
									)}
								</div>
							);
						})}
					</div>
				</section>
			)}

			{/* Shared triage queue — same panel as the Dashboard; collapses to a
			    line when nothing is waiting. */}
			<UnassignedQueue />

			{/* Filters — one row, same cn-filter pattern as the Worklist queue. */}
			<div className="cn-scaffold__filters cn-scaffold__filters--row" style={{ marginTop: "1.25rem", border: "1px solid var(--border-light)" }}>
				<input
					type="search"
					placeholder="Search reference, client, staff…"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="cn-search"
					aria-label="Search caseload"
				/>
				<label className="cn-filter">
					<span className="cn-filter__label">Type</span>
					<select
						className="cn-filter__select"
						value={type}
						onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
					>
						{TYPES.map((t) => (
							<option key={t} value={t}>{TYPE_LABELS[t]}</option>
						))}
					</select>
				</label>
				<label className="cn-filter">
					<span className="cn-filter__label">Staff</span>
					<select
						className="cn-filter__select"
						value={selectedStaff}
						onChange={(e) => setSelectedStaff(e.target.value)}
					>
						<option value="all">All staff</option>
						{staffList.map((s) => (
							<option key={s.id} value={s.id}>{s.name} · {s.total}</option>
						))}
					</select>
				</label>
				<span className="cn-filter__label" style={{ marginLeft: "auto" }}>
					{loading ? "Loading…" : (
						<>
							{stats.cases} case{stats.cases === 1 ? "" : "s"} · {stats.consultations} consultation{stats.consultations === 1 ? "" : "s"}
							{" · "}{stats.staff} officer{stats.staff === 1 ? "" : "s"}
							{stats.unassigned > 0 ? ` · ${stats.unassigned} unassigned` : ""}
						</>
					)}
				</span>
			</div>

			{/* Assignments table */}
			<div className="ops-table-wrap" style={{ marginTop: "0.75rem" }}>
				<table className="ops-table">
					<thead>
						<tr>
							<th>Record</th>
							<th>Type</th>
							<th>Assigned</th>
							<th>Progress</th>
							<th>Updated</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{filtered.length === 0 ? (
							<tr>
								<td colSpan={6}>
									<p className="ops-panel__muted" style={{ padding: "0.5rem 0" }}>
										{loading ? "Loading caseload…" : "No records match the current filters."}
									</p>
								</td>
							</tr>
						) : filtered.map((r) => {
							const progress = getStageProgress(r.type, r.stageOrStatus);
							const isSelf = r.assignedStaffId && r.assignedStaffId === opsUser?.opsUserId;
							return (
								<tr key={r.id}>
									<td>
										<strong>{r.clientName}</strong>
										<div className="ops-table__sub" style={{ fontFamily: "var(--font-mono, monospace)" }}>
											{r.reference}
										</div>
										{r.clientEmail && <div className="ops-table__sub">{r.clientEmail}</div>}
									</td>
									<td>
										<span className="ops-pill">{r.type === "case" ? "Case" : "Consultation"}</span>
									</td>
									<td>
										{r.assignedStaffName ?? "Unassigned"}
										{r.assignedStaffId && !isSelf && (
											<div className="ops-table__sub">
												<button
													type="button"
													onClick={() => void openDM(r.assignedStaffId!)}
													style={{
														background: "none",
														border: "none",
														padding: 0,
														cursor: "pointer",
														fontSize: "inherit",
														color: "inherit",
														textDecoration: "underline",
													}}
												>
													Message →
												</button>
											</div>
										)}
									</td>
									<td style={{ minWidth: "9rem" }}>
										<div className="ops-table__sub" style={{ marginBottom: "0.3rem" }}>
											{progress.label} · {progress.step}/{progress.total}
										</div>
										<div style={{ display: "flex", gap: "3px" }}>
											{Array.from({ length: progress.total }).map((_, i) => (
												<span
													key={i}
													style={{
														flex: 1,
														height: "2px",
														background: i < progress.step ? "var(--muted-foreground)" : "var(--border-light)",
													}}
												/>
											))}
										</div>
									</td>
									<td style={{ whiteSpace: "nowrap" }}>{relativeTime(r.updatedAt)}</td>
									<td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
										<Link to={`${r.link}?id=${r.id}`} className="btn btn--ghost btn--sm">
											Open →
										</Link>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

		</div>
	);
}
