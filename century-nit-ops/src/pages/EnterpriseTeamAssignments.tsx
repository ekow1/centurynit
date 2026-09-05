import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCases } from "../hooks/useCases";
import { useOpsAuth } from "./OpsAuthContext";
import { useChatHub } from "./ChatHubContext";
import { UnassignedQueue } from "./UnassignedBookings";
import { JOURNEY_STAGES, JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";

/**
 * Unified row shape built from the shared cases store.
 *
 * Previously this page called `GET /team/assignments` — a bespoke endpoint
 * that duplicated the data already in `useCases()` (applications +
 * consultations). That endpoint is now retired; the rows below are derived
 * from the same single source of truth every other page uses, so there is no
 * second API to keep in sync and no heuristic stage mapping.
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
	priority: string | null;
	updatedAt: string;
	link: string;
};

const TYPES = ["all", "case", "consultation", "unassigned"] as const;
const TYPE_LABELS: Record<string, string> = {
	all: "All Records",
	case: "Cases",
	consultation: "Consultations",
	unassigned: "Unassigned Queue",
};

function relativeTime(iso: string) {
	const date = new Date(iso);
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return date.toLocaleDateString();
}

/**
 * Stage progress derived from the real enum values, not string
 * `includes()` heuristics. Cases use `JOURNEY_STAGES` — the same array
 * the Workflow board and Applications page use — so a case is always on
 * the same step here as it is there. Consultations map their status enum
 * directly to a step.
 */
function getStageProgress(type: "case" | "consultation", stageOrStatus: string): { step: number; total: number; label: string } {
	if (type === "case") {
		const idx = JOURNEY_STAGES.indexOf(stageOrStatus as JourneyStage);
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

export function EnterpriseTeamAssignments() {
	const { scopeRecords } = useOpsAuth();
	const { applications, consultations, assignees, loading: casesLoading, error: casesError, refresh: refreshCases } = useCases();
	const [type, setType] = useState<(typeof TYPES)[number]>("all");
	const [selectedStaff, setSelectedStaff] = useState<string>("all");
	const [search, setSearch] = useState("");

	const { openDM } = useChatHub();

	const loading = casesLoading;
	const error = casesError;

	const staffIdByEmail = (email: string) => assignees.find((a) => a.email === email)?.opsUserId ?? null;

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
				priority: null,
				updatedAt: app.submittedDate,
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
				priority: null,
				updatedAt: c.slotDate ?? c.dateTime,
				link: "/consultations",
			});
		}

		return rows;
	}, [applications, consultations, scopeRecords, assignees]);

	const loadData = () => {
		void refreshCases();
	 };

	// Roster of staff members and their respective breakdown
	const staffList = useMemo(() => {
		const map = new Map<
			string,
			{
				id: string;
				name: string;
				email: string | null;
				cases: number;
				consultations: number;
				total: number;
			}
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
				else if (i.type === "consultation") existing.consultations++;
				existing.total++;
				map.set(i.assignedStaffId, existing);
			}
		}
		return Array.from(map.values()).sort((a, b) => b.total - a.total);
	}, [items]);

	const unassignedCount = useMemo(() => {
		return items.filter((i) => !i.assignedStaffId).length;
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
		unassigned: unassignedCount,
	}), [items, staffList, unassignedCount]);

	return (
		<div style={{ padding: "1.5rem", maxWidth: "1600px", margin: "0 auto" }}>
			{/* Page Header */}
			<header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
				<div>
					<p style={{ margin: "0 0 0.25rem 0", fontSize: "0.7rem", fontFamily: "var(--font-mono, monospace)", textTransform: "uppercase", letterSpacing: "0.08em", color: "#71717a" }}>
						Operational Oversight · Dispatch & Workload
					</p>
					<h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "0 0 0.25rem", letterSpacing: "-0.02em" }}>
						Team Assignments &amp; Progress
					</h1>
					<p style={{ fontSize: "0.85rem", color: "#52525b", margin: 0 }}>
						Real-time dispatch board. Track case progress, consultation assignments, and message staff directly.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					<button
						type="button"
						onClick={loadData}
						disabled={loading}
						style={{
							background: "#ffffff",
							border: "1px solid #18181b",
							padding: "0.5rem 0.85rem",
							fontSize: "0.75rem",
							fontWeight: 700,
							textTransform: "uppercase",
							letterSpacing: "0.04em",
							cursor: "pointer",
							display: "inline-flex",
							alignItems: "center",
							gap: "0.4rem",
						}}
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
						<span>{loading ? "Refreshing…" : "Refresh"}</span>
					</button>
				</div>
			</header>

			{error && (
				<div style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #f87171", color: "#991b1b", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
					{error}
				</div>
			)}

			{/* Shared triage queue — same panel as the Dashboard */}
			<div style={{ marginBottom: "1.5rem" }}>
				<UnassignedQueue />
			</div>

			{/* KPI Summary Tiles */}
			<section
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
					border: "1px solid #18181b",
					background: "#ffffff",
					marginBottom: "1.5rem",
				}}
			>
				{[
					{ label: "Active Cases", value: stats.cases, sub: "Pipeline files", highlight: false },
					{ label: "Consultations", value: stats.consultations, sub: "Bookings & intakes", highlight: false },
					{ label: "Active Staff", value: stats.staff, sub: "Assigned officers", highlight: false },
					{ label: "Unassigned Queue", value: stats.unassigned, sub: stats.unassigned > 0 ? "Requires action" : "All dispatched", highlight: stats.unassigned > 0 },
				].map((s, idx, arr) => (
					<div
						key={s.label}
						style={{
							padding: "1.25rem",
							borderRight: idx < arr.length - 1 ? "1px solid #e4e4e7" : undefined,
							background: s.highlight ? "#09090b" : "#ffffff",
							color: s.highlight ? "#ffffff" : "#18181b",
						}}
					>
						<p style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: s.highlight ? "#a1a1aa" : "#71717a", margin: "0 0 0.35rem" }}>
							{s.label}
						</p>
						<p style={{ fontSize: "2rem", fontWeight: 900, margin: 0, lineHeight: 1, fontFamily: "var(--font-mono, monospace)" }}>
							{s.value}
						</p>
						<p style={{ fontSize: "0.7rem", color: s.highlight ? "#71717a" : "#a1a1aa", margin: "0.35rem 0 0" }}>
							{s.sub}
						</p>
					</div>
				))}
			</section>

			{/* Filter Toolbar */}
			<section style={{ background: "#f4f4f5", border: "1px solid #18181b", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between" }}>
					{/* Tabs */}
					<div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
						{TYPES.map((t) => (
							<button
								key={t}
								type="button"
								onClick={() => setType(t)}
								style={{
									border: "1px solid #18181b",
									background: type === t ? "#18181b" : "#ffffff",
									color: type === t ? "#ffffff" : "#18181b",
									fontSize: "0.7rem",
									fontWeight: 700,
									textTransform: "uppercase",
									letterSpacing: "0.04em",
									padding: "0.4rem 0.75rem",
									cursor: "pointer",
								}}
							>
								{TYPE_LABELS[t]}
								{t === "unassigned" && stats.unassigned > 0 ? ` (${stats.unassigned})` : ""}
							</button>
						))}
					</div>

					{/* Search & Staff Filter */}
					<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: "1 1 320px", maxWidth: "600px" }}>
						<select
							value={selectedStaff}
							onChange={(e) => setSelectedStaff(e.target.value)}
							style={{
								border: "1px solid #18181b",
								borderRadius: 0,
								padding: "0.45rem 0.75rem",
								fontSize: "0.75rem",
								background: "#ffffff",
								minWidth: "160px",
								fontWeight: 600,
							}}
						>
							<option value="all">All Assigned Staff</option>
							{staffList.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name} ({s.total})
								</option>
							))}
						</select>

						<div style={{ position: "relative", flex: 1 }}>
							<input
								type="text"
								placeholder="Search reference, client, email, or staff…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								style={{
									border: "1px solid #18181b",
									borderRadius: 0,
									padding: "0.45rem 0.75rem",
									fontSize: "0.75rem",
									background: "#ffffff",
									width: "100%",
									boxSizing: "border-box",
								}}
							/>
							{search && (
								<button
									type="button"
									onClick={() => setSearch("")}
									style={{
										position: "absolute",
										right: "8px",
										top: "50%",
										transform: "translateY(-50%)",
										border: "none",
										background: "transparent",
										cursor: "pointer",
										fontSize: "0.8rem",
									}}
								>
									✕
								</button>
							)}
						</div>
					</div>
				</div>
			</section>

			{/* Assignments Table */}
			<section style={{ border: "1px solid #18181b", background: "#ffffff", marginBottom: "2rem", overflowX: "auto" }}>
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
					<thead>
						<tr style={{ background: "#09090b", color: "#ffffff", borderBottom: "1px solid #18181b" }}>
							<th style={headerCell}>Type</th>
							<th style={headerCell}>Reference</th>
							<th style={headerCell}>Client Details</th>
							<th style={headerCell}>Assigned Officer &amp; Direct Chat</th>
							<th style={headerCell}>Stage Progress</th>
							<th style={{ ...headerCell, textAlign: "right" }}>Last Updated</th>
							<th style={{ ...headerCell, textAlign: "center", width: "90px" }}>Actions</th>
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr>
								<td colSpan={7} style={{ padding: "3rem 1rem", textAlign: "center", color: "#71717a" }}>
									Loading team assignments…
								</td>
							</tr>
						) : filtered.length === 0 ? (
							<tr>
								<td colSpan={7} style={{ padding: "3rem 1rem", textAlign: "center", color: "#71717a" }}>
									No assignments match the selected filter criteria.
								</td>
							</tr>
						) : (
							filtered.map((item) => {
								const prog = getStageProgress(item.type, item.stageOrStatus);
								const isUnassigned = !item.assignedStaffId;

								return (
									<tr
										key={`${item.type}-${item.id}`}
										style={{
											borderBottom: "1px solid #e4e4e7",
											background: isUnassigned ? "rgba(254, 242, 242, 0.4)" : "#ffffff",
											transition: "background 0.15s ease",
										}}
									>
										{/* Type */}
										<td style={bodyCell}>
											<span
												style={{
													display: "inline-block",
													border: "1px solid #18181b",
													padding: "0.2rem 0.45rem",
													fontSize: "0.65rem",
													fontWeight: 800,
													textTransform: "uppercase",
													letterSpacing: "0.05em",
													background:
														item.type === "case"
															? "#18181b"
															: item.type === "consultation"
																? "#f4f4f5"
																: "#ffffff",
													color: item.type === "case" ? "#ffffff" : "#18181b",
												}}
											>
												{item.type}
											</span>
										</td>

										{/* Reference */}
										<td style={bodyCell}>
											<span style={{ fontWeight: 800, fontFamily: "var(--font-mono, monospace)", fontSize: "0.85rem" }}>
												{item.reference}
											</span>
											{item.priority && (
												<span
													style={{
														display: "inline-block",
														marginLeft: "0.4rem",
														background: "#fef2f2",
														color: "#991b1b",
														border: "1px solid #f87171",
														fontSize: "0.6rem",
														fontWeight: 800,
														textTransform: "uppercase",
														padding: "0.1rem 0.35rem",
													}}
												>
													{item.priority}
												</span>
											)}
										</td>

										{/* Client */}
										<td style={bodyCell}>
											<div style={{ fontWeight: 700, color: "#18181b" }}>{item.clientName}</div>
											{item.clientEmail && (
												<div style={{ fontSize: "0.75rem", color: "#71717a", fontFamily: "var(--font-mono, monospace)" }}>
													{item.clientEmail}
												</div>
											)}
										</td>

										{/* Assigned Officer with Chat Trigger */}
										<td style={bodyCell}>
											{item.assignedStaffId && item.assignedStaffName ? (
												<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
													{/* Avatar Tile */}
													<span
														style={{
															width: "26px",
															height: "26px",
															background: "#18181b",
															color: "#ffffff",
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															fontSize: "0.65rem",
															fontWeight: 800,
															fontFamily: "var(--font-mono, monospace)",
															flexShrink: 0,
														}}
													>
														{item.assignedStaffName.slice(0, 2).toUpperCase()}
													</span>

													{/* Staff Details */}
													<div style={{ minWidth: 0 }}>
														<span style={{ fontWeight: 700, color: "#18181b", fontSize: "0.8rem", display: "block" }}>
															{item.assignedStaffName}
														</span>
													</div>

													{/* Chat Trigger Icon */}
													<button
														type="button"
														onClick={(e) => {
															e.preventDefault();
															e.stopPropagation();
															void openDM(item.assignedStaffId!);
														}}
														title={`Open chat with ${item.assignedStaffName}`}
														style={{
															background: "#09090b",
															color: "#ffffff",
															border: "1px solid #18181b",
															width: "26px",
															height: "26px",
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															cursor: "pointer",
															marginLeft: "0.25rem",
															transition: "transform 0.1s ease, background 0.15s ease",
														}}
													>
														<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
															<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
														</svg>
													</button>
												</div>
											) : (
												<span
													style={{
														display: "inline-flex",
														alignItems: "center",
														gap: "0.35rem",
														padding: "0.2rem 0.5rem",
														background: "#fff1f2",
														border: "1px solid #fecdd3",
														color: "#be123c",
														fontSize: "0.7rem",
														fontWeight: 800,
														textTransform: "uppercase",
													}}
												>
													● Unassigned
												</span>
											)}
										</td>

										{/* Stage Progress Bar */}
										<td style={bodyCell}>
											<div style={{ minWidth: "160px" }}>
												<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
													<span
														style={{
															fontSize: "0.7rem",
															fontWeight: 800,
															textTransform: "uppercase",
															letterSpacing: "0.04em",
															color: "#18181b",
														}}
													>
														{item.stageOrStatusLabel || prog.label}
													</span>
													<span style={{ fontSize: "0.65rem", fontFamily: "var(--font-mono, monospace)", color: "#71717a" }}>
														{prog.step}/{prog.total}
													</span>
												</div>
												{/* Progress Bar Segments */}
												<div style={{ display: "flex", gap: "2px", height: "5px", width: "100%", background: "#f4f4f5" }}>
													{Array.from({ length: prog.total }).map((_, idx) => (
														<div
															key={idx}
															style={{
																flex: 1,
																background: idx < prog.step ? "#18181b" : "#e4e4e7",
																height: "100%",
															}}
														/>
													))}
												</div>
											</div>
										</td>

										{/* Updated */}
										<td style={{ ...bodyCell, textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--font-mono, monospace)", fontSize: "0.75rem", color: "#52525b" }}>
											{relativeTime(item.updatedAt)}
										</td>

										{/* Actions */}
										<td style={{ ...bodyCell, textAlign: "center" }}>
											<Link
												to={`${item.link}?id=${item.id}`}
												style={{
													display: "inline-flex",
													alignItems: "center",
													justifyContent: "center",
													padding: "0.35rem 0.65rem",
													background: "#ffffff",
													color: "#18181b",
													border: "1px solid #18181b",
													fontSize: "0.7rem",
													fontWeight: 800,
													textTransform: "uppercase",
													letterSpacing: "0.04em",
													textDecoration: "none",
													transition: "background 0.15s ease, color 0.15s ease",
												}}
											>
												Open →
											</Link>
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</section>

			{/* Workload by Staff Cards */}
			{staffList.length > 0 && (
				<section style={{ border: "1px solid #18181b", background: "#ffffff", padding: "1.5rem" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
						<div>
							<h2 style={{ fontSize: "0.9rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
								Workload Distribution by Staff
							</h2>
							<p style={{ fontSize: "0.75rem", color: "#71717a", margin: "0.2rem 0 0" }}>
								Current capacity and active task load across team members.
							</p>
						</div>
					</div>

					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
						{staffList.map((s) => {
							const capacityPercent = Math.min(100, Math.round((s.total / 10) * 100));

							return (
								<div
									key={s.id}
									style={{
										border: "1px solid #18181b",
										padding: "1rem",
										background: "#fafafa",
										display: "flex",
										flexDirection: "column",
										justifyContent: "space-between",
									}}
								>
									<div>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
											<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
												<span
													style={{
														width: "32px",
														height: "32px",
														background: "#18181b",
														color: "#ffffff",
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														fontSize: "0.75rem",
														fontWeight: 800,
														fontFamily: "var(--font-mono, monospace)",
													}}
												>
													{s.name.slice(0, 2).toUpperCase()}
												</span>
												<div>
													<p style={{ fontWeight: 800, margin: 0, fontSize: "0.85rem", color: "#18181b" }}>
														{s.name}
													</p>
													<p style={{ fontSize: "0.7rem", color: "#71717a", margin: 0, fontFamily: "var(--font-mono, monospace)" }}>
														{s.email ?? "Staff Member"}
													</p>
												</div>
											</div>
											<span style={{ fontSize: "1.25rem", fontWeight: 900, fontFamily: "var(--font-mono, monospace)", color: "#18181b" }}>
												{s.total}
											</span>
										</div>

										{/* Breakdown Badges */}
										<div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
											<span style={pillStyle}>Cases: {s.cases}</span>
											<span style={pillStyle}>Consultations: {s.consultations}</span>
										</div>

										{/* Capacity Gauge */}
										<div style={{ marginBottom: "1rem" }}>
											<div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#71717a", marginBottom: "3px" }}>
												<span>Capacity load</span>
												<span>{s.total}/10 slots</span>
											</div>
											<div style={{ height: "4px", width: "100%", background: "#e4e4e7" }}>
												<div
													style={{
														height: "100%",
														width: `${capacityPercent}%`,
														background: capacityPercent > 80 ? "#dc2626" : "#18181b",
													}}
												/>
											</div>
										</div>
									</div>

									{/* Action Button: Chat With Staff */}
									<button
										type="button"
										onClick={() => void openDM(s.id)}
										style={{
											width: "100%",
											background: "#18181b",
											color: "#ffffff",
											border: "none",
											padding: "0.5rem",
											fontSize: "0.7rem",
											fontWeight: 700,
											textTransform: "uppercase",
											letterSpacing: "0.04em",
											cursor: "pointer",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: "0.4rem",
										}}
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
											<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
										</svg>
										<span>Message {s.name.split(" ")[0]}</span>
									</button>
								</div>
							);
						})}
					</div>
				</section>
			)}
		</div>
	);
}

const headerCell = {
	padding: "0.75rem 1rem",
	fontSize: "0.7rem",
	textTransform: "uppercase" as const,
	letterSpacing: "0.06em",
	fontWeight: 800,
};

const bodyCell = {
	padding: "0.85rem 1rem",
	verticalAlign: "middle" as const,
};

const pillStyle = {
	fontSize: "0.65rem",
	fontWeight: 700,
	textTransform: "uppercase" as const,
	letterSpacing: "0.04em",
	padding: "0.15rem 0.4rem",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	color: "#52525b",
};
