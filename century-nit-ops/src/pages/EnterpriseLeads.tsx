import { useState, useMemo, useEffect, useCallback } from "react";
import { useOpsState } from "./OpsStateContext";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import {
	LEAD_STAGE_LABELS,
	LEAD_STAGE_ORDER,
	type Lead,
	type LeadStage,
} from "century-nit-core";
import { fmtBoth } from "./currency";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch } from "../lib/api";

interface ApiLead {
	id: string;
	name: string;
	email: string;
	phone: string | null;
	source: string;
	stage: "New Lead" | "Contacted" | "Consultation Booked" | "Assessment Complete" | "Enrolled" | "Lost";
	targetCountry: string | null;
	assignedStaffId: string | null;
	assignedStaffName: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

const STAGE_MAP_FROM_API: Record<string, LeadStage> = {
	"New Lead": "new",
	"Contacted": "contacted",
	"Consultation Booked": "consultation_scheduled",
	"Assessment Complete": "interested",
	"Enrolled": "converted",
	"Lost": "lost",
};

const STAGE_MAP_TO_API: Record<LeadStage, string> = {
	new: "New Lead",
	contacted: "Contacted",
	consultation_scheduled: "Consultation Booked",
	interested: "Assessment Complete",
	consulted: "Assessment Complete",
	converted: "Enrolled",
	lost: "Lost",
};

const STAGE_COLORS: Record<LeadStage, string> = {
	new: "#3b82f6",
	contacted: "#8b5cf6",
	interested: "#f59e0b",
	consultation_scheduled: "#06b6d4",
	consulted: "#10b981",
	converted: "#22c55e",
	lost: "#ef4444",
};

const STAGE_ICONS: Record<LeadStage, string> = {
	new: "✦",
	contacted: "✉",
	interested: "★",
	consultation_scheduled: "◷",
	consulted: "✓",
	converted: "◆",
	lost: "✕",
};

function timeAgo(iso: string) {
	const diff = Date.now() - new Date(iso).getTime();
	const hours = Math.floor(diff / 3600000);
	if (hours < 1) return "Just now";
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function LeadCard({
	lead,
	onMove,
	canMove,
	dragging,
	onDragStart,
	onDragEnd,
}: {
	lead: Lead;
	onMove: (id: string, stage: LeadStage) => void;
	canMove: boolean;
	dragging: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const currentIdx = LEAD_STAGE_ORDER.indexOf(lead.stage);
	const nextStage = LEAD_STAGE_ORDER[currentIdx + 1];

	return (
		<div
			className={`lead-card${expanded ? " lead-card--expanded" : ""}${dragging ? " lead-card--dragging" : ""}`}
			draggable={canMove}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onClick={() => setExpanded(!expanded)}
			style={{
				background: "var(--card)",
				border: "1px solid var(--border-light)",
				borderLeft: `3px solid ${STAGE_COLORS[lead.stage]}`,
				padding: "0.85rem 0.9rem",
				cursor: canMove ? "grab" : "pointer",
				opacity: dragging ? 0.4 : 1,
				transition: "border-color 120ms, box-shadow 120ms, opacity 120ms",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
				<strong style={{ fontSize: "var(--text-sm)" }}>{lead.name}</strong>
				<span
					style={{
						fontSize: "var(--text-xs)",
						fontFamily: "var(--font-mono)",
						color: STAGE_COLORS[lead.stage],
						fontWeight: 600,
					}}
				>
					{STAGE_ICONS[lead.stage]} {lead.country}
				</span>
			</div>

			<p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0 0 0.5rem" }}>
				{lead.email}
			</p>

			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--text-xs)" }}>
				<span className="mono" style={{ fontWeight: 600 }}>{fmtBoth(lead.value)}</span>
				<span className="muted">{timeAgo(lead.lastContactAt)}</span>
			</div>

			{expanded ? (
				<div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-light)", fontSize: "var(--text-xs)" }}>
					<p style={{ margin: "0 0 0.25rem" }}><strong>Phone:</strong> {lead.phone}</p>
					<p style={{ margin: "0 0 0.25rem" }}><strong>Source:</strong> {lead.source}</p>
					<p style={{ margin: "0 0 0.25rem" }}><strong>Branch:</strong> {branchName(lead.branch)}</p>
					<p style={{ margin: "0 0 0.5rem" }}><strong>Assigned:</strong> {lead.assignedTo}</p>
					<p className="muted" style={{ margin: "0 0 0.75rem", fontStyle: "italic" }}>{lead.notes}</p>

					{canMove && (
						<div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
							{currentIdx > 0 ? (
								<button
									type="button"
									className="btn btn--ghost btn--xs"
									onClick={(e) => {
										e.stopPropagation();
										const prevStage = LEAD_STAGE_ORDER[currentIdx - 1];
										onMove(lead.id, prevStage);
									}}
								>
									← {LEAD_STAGE_LABELS[LEAD_STAGE_ORDER[currentIdx - 1]]}
								</button>
							) : null}
							{nextStage ? (
								<button
									type="button"
									className="btn btn--primary btn--xs"
									onClick={(e) => {
										e.stopPropagation();
										onMove(lead.id, nextStage);
									}}
								>
									{LEAD_STAGE_LABELS[nextStage]} →
								</button>
							) : null}
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}

export function EnterpriseLeads() {
	const { opsRole, opsUser, canSeeAllBranches } = useOpsAuth();
	const { moveLead, liveCase } = useOpsState();
	const [apiLeads, setApiLeads] = useState<ApiLead[]>([]);
	const [loading, setLoading] = useState(false);
	const [search, setSearch] = useState("");
	const [branchFilter, setBranchFilter] = useState("all");
	const [assignFilter, setAssignFilter] = useState<"all" | "mine">("all");

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
	const canMoveLead = (l: Lead) => canMoveAny || l.assignedTo === opsUser?.name;

	const [dragging, setDragging] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState<LeadStage | null>(null);

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
		void loadApiLeads();
		const interval = setInterval(loadApiLeads, 10000);
		return () => clearInterval(interval);
	}, [loadApiLeads]);

	const mergedLeads = useMemo<Lead[]>(() => {
		const emailSet = new Set<string>();
		const result: Lead[] = [];

		// 1. Live database leads take priority
		for (const al of apiLeads) {
			emailSet.add(al.email.toLowerCase());
			result.push({
				id: al.id,
				name: al.name,
				email: al.email,
				phone: al.phone || "-",
				country: al.targetCountry || "Canada",
				degreeLevel: "Master's",
				branch: "accra",
				stage: STAGE_MAP_FROM_API[al.stage] ?? "new",
				source: al.source || "Website Registration",
				value: 3000,
				createdAt: al.createdAt.slice(0, 10),
				lastContactAt: al.updatedAt || al.createdAt,
				notes: al.notes || "Captured automatically from client sign-in.",
				assignedTo: al.assignedStaffName || (al.assignedStaffId ? "Assigned" : "Unassigned"),
			});
		}

		// 2. Active client portal session
		if (liveCase?.present && liveCase.email) {
			const liveEmail = liveCase.email.toLowerCase();
			if (!emailSet.has(liveEmail)) {
				emailSet.add(liveEmail);
				result.unshift({
					id: "lead-live-session",
					name: liveCase.name || "Live Portal Client",
					email: liveCase.email,
					phone: liveCase.phone || "-",
					country: liveCase.targetCountry || "Canada",
					degreeLevel: liveCase.degreeLevel || "Master's",
					branch: "accra",
					stage: "new",
					source: "Live Portal Sign-In",
					value: 3000,
					createdAt: new Date().toISOString().slice(0, 10),
					lastContactAt: new Date().toISOString(),
					notes: `Active client portal session at stage: ${liveCase.stageLabel || "New Client"}.`,
					assignedTo: "Unassigned",
				});
			}
		}

		return result;
	}, [apiLeads, liveCase]);

	const handleLeadMove = useCallback(
		async (id: string, stage: LeadStage) => {
			moveLead(id, stage);
			setApiLeads((prev) =>
				prev.map((l) => (l.id === id ? { ...l, stage: (STAGE_MAP_TO_API[stage] as ApiLead["stage"]) } : l)),
			);
			try {
				await apiFetch(`${API_PREFIX}/leads/${id}`, {
					method: "PATCH",
					body: JSON.stringify({ stage: STAGE_MAP_TO_API[stage] }),
				});
			} catch (err) {
				console.warn("[CRM] Stage update not persisted to API:", err);
			}
		},
		[moveLead],
	);

	const roleScopedLeads = useMemo(() => {
		if (canSeeAll) {
			if (assignFilter === "mine") {
				return mergedLeads.filter((l) => l.assignedTo === opsUser?.name);
			}
			return mergedLeads;
		}
		// Non-manager roles (e.g. consultant) see leads assigned to them, unassigned leads, or any incoming new lead
		return mergedLeads.filter(
			(l) =>
				l.assignedTo === opsUser?.name ||
				l.assignedTo === "Unassigned" ||
				!l.assignedTo ||
				l.stage === "new",
		);
	}, [canSeeAll, assignFilter, mergedLeads, opsUser?.name]);

	const branchScopedLeads = useMemo(
		() =>
			branchFilter === "all"
				? roleScopedLeads
				: roleScopedLeads.filter((l) => l.branch === branchFilter),
		[roleScopedLeads, branchFilter],
	);

	const filtered = branchScopedLeads.filter(
		(l) =>
			l.name.toLowerCase().includes(search.toLowerCase()) ||
			l.email.toLowerCase().includes(search.toLowerCase()) ||
			l.country.toLowerCase().includes(search.toLowerCase()),
	);

	const totalValue = branchScopedLeads
		.filter((l) => l.stage !== "lost")
		.reduce((sum, l) => sum + l.value, 0);
	const convertedCount = branchScopedLeads.filter((l) => l.stage === "converted").length;
	const activeCount = branchScopedLeads.filter(
		(l) => l.stage !== "converted" && l.stage !== "lost",
	).length;
	const conversionRate = branchScopedLeads.length > 0
		? Math.round((convertedCount / branchScopedLeads.length) * 100)
		: 0;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
				<div>
					<h1 className="page-title">CRM · Lead Pipeline</h1>
					<p className="lead mt-2">
						Drag a lead between columns, or expand a card to move it a stage at a time.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						onClick={() => {
							setLoading(true);
							void loadApiLeads().finally(() => setLoading(false));
						}}
						title="Refresh leads from database"
					>
						{loading ? "Refreshing…" : "↻ Refresh"}
					</button>

					{canSeeAll && (
						<div className="admin-env-tabs" style={{ margin: 0 }}>
							<button
								type="button"
								className={`admin-env-tab${assignFilter === "all" ? " admin-env-tab--active" : ""}`}
								onClick={() => setAssignFilter("all")}
							>
								All Leads ({mergedLeads.length})
							</button>
							<button
								type="button"
								className={`admin-env-tab${assignFilter === "mine" ? " admin-env-tab--active" : ""}`}
								onClick={() => setAssignFilter("mine")}
							>
								Assigned to Me
							</button>
						</div>
					)}

					<span className="portal-pill" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
						{canSeeAll ? `Active: ${branchScopedLeads.length}` : "Assigned to you"}
					</span>
					{canSeeAll && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			{/* Role scope banner */}
			<div style={{
				padding: "0.65rem 1rem",
				border: "1px solid var(--border-light)",
				background: canSeeAll ? "var(--foreground)" : "var(--muted)",
				color: canSeeAll ? "var(--background)" : "var(--foreground)",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				marginBottom: "1.25rem",
			}}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
					<span style={{ fontSize: "1rem" }}>{canSeeAll ? "◱" : "◎"}</span>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						{canSeeAll
							? `${assignFilter === "all" ? "All organization leads" : "Your assigned leads"} · ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: `${roleScopedLeads.length} leads assigned to you`}
					</p>
				</div>
				<span className="mono" style={{ fontSize: "var(--text-xs)", opacity: 0.8 }}>
					{branchName(branchFilter)}
				</span>
			</div>

			{/* KPI Summary Tiles */}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
				<StatTile label="Total Leads" value={String(branchScopedLeads.length)} accent="var(--foreground)" />
				<StatTile label="Active Leads" value={String(activeCount)} accent="#3b82f6" />
				<StatTile label="Converted" value={String(convertedCount)} accent="#22c55e" />
				<StatTile label="Conversion Rate" value={`${conversionRate}%`} accent="#8b5cf6" />
				<StatTile label="Pipeline Value" value={fmtBoth(totalValue)} accent="#f59e0b" />
			</div>

			{/* Search */}
			<div style={{ marginBottom: "1.5rem" }}>
				<input
					type="search"
					placeholder="Search leads by client name, email or country..."
					className="input input--sm input--full-border"
					style={{ maxWidth: "360px" }}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</div>

			{/* Kanban Board */}
			<div className="leads-board"
				style={{
					display: "grid",
					gridTemplateColumns: `repeat(${LEAD_STAGE_ORDER.length}, minmax(230px, 1fr))`,
					gap: "0.75rem",
					overflowX: "auto",
					paddingBottom: "1rem",
				}}
			>
				{LEAD_STAGE_ORDER.map((stage) => {
					const stageLeads = filtered.filter((l) => l.stage === stage);
					const color = STAGE_COLORS[stage];
					const isTarget = dragOver === stage;
					return (
						<div
							key={stage}
							onDragOver={(e) => {
								if (!dragging) return;
								e.preventDefault();
								setDragOver(stage);
							}}
							onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
							onDrop={(e) => {
								e.preventDefault();
								if (dragging) handleLeadMove(dragging, stage);
								setDragging(null);
								setDragOver(null);
							}}
							style={{
								display: "flex",
								flexDirection: "column",
								minHeight: "200px",
								outline: isTarget ? `2px dashed ${color}` : "2px dashed transparent",
								outlineOffset: "3px",
								transition: "outline-color 120ms",
							}}
						>
							{/* Column header */}
							<div
								style={{
									padding: "0.7rem 0.85rem",
									borderBottom: `2px solid ${color}`,
									marginBottom: "0.6rem",
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									background: "var(--card)",
									borderTop: "1px solid var(--border-light)",
									borderLeft: "1px solid var(--border-light)",
									borderRight: "1px solid var(--border-light)",
								}}
							>
								<div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
									<span style={{ fontSize: "0.8rem", color, fontWeight: 700 }}>{STAGE_ICONS[stage]}</span>
									<span
										style={{
											fontSize: "0.72rem",
											fontWeight: 600,
											textTransform: "uppercase",
											letterSpacing: "0.05em",
										}}
									>
										{LEAD_STAGE_LABELS[stage]}
									</span>
								</div>
								<span
									style={{
										fontSize: "0.68rem",
										fontFamily: "var(--font-mono)",
										color: "var(--muted-foreground)",
										background: "var(--muted)",
										padding: "0.1rem 0.4rem",
										borderRadius: "3px",
									}}
								>
									{stageLeads.length}
								</span>
							</div>
							{/* Column body */}
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: "0.5rem",
									flex: 1,
								}}
							>
								{stageLeads.length === 0 ? (
									<div
										style={{
											padding: "1.5rem 0.5rem",
											textAlign: "center",
											border: "1px dashed var(--border-light)",
											borderRadius: "4px",
										}}
									>
										<p className="muted" style={{ fontSize: "0.72rem", opacity: 0.5 }}>
												No leads
											</p>
									</div>
								) : (
									stageLeads.map((lead) => (
										<LeadCard
											key={lead.id}
											lead={lead}
											onMove={handleLeadMove}
											canMove={canMoveLead(lead)}
											dragging={dragging === lead.id}
											onDragStart={() => setDragging(lead.id)}
											onDragEnd={() => {
												setDragging(null);
												setDragOver(null);
											}}
										/>
									))
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
	return (
		<div className="card" style={{ padding: "1rem 1.1rem", position: "relative", overflow: "hidden" }}>
			{accent && (
				<div style={{ position: "absolute", top: 0, left: 0, width: "3px", height: "100%", background: accent }} />
			)}
			<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>{label}</p>
			<p className="page-title mt-1" style={{ fontSize: "1.5rem" }}>{value}</p>
		</div>
	);
}
