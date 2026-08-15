import { useState, useMemo } from "react";
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
	const prevStage = LEAD_STAGE_ORDER[currentIdx - 1];
	const color = STAGE_COLORS[lead.stage];

	return (
		<div
			draggable={canMove}
			onDragStart={(e) => {
				if (!canMove) return;
				e.dataTransfer.effectAllowed = "move";
				onDragStart();
			}}
			onDragEnd={onDragEnd}
			style={{
				background: "var(--card)",
				border: "1px solid var(--border-light)",
				borderLeft: `3px solid ${color}`,
				padding: "0.85rem 0.9rem",
				cursor: canMove ? "grab" : "pointer",
				opacity: dragging ? 0.4 : 1,
				transition: "border-color 120ms, box-shadow 120ms, opacity 120ms",
			}}
			onClick={() => setExpanded((v) => !v)}
			onMouseEnter={(e) => {
				e.currentTarget.style.borderColor = "var(--border)";
				e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)";
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.borderColor = "var(--border-light)";
				e.currentTarget.style.boxShadow = "none";
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
				<div style={{ minWidth: 0, flex: 1 }}>
					<p style={{ fontWeight: 600, fontSize: "0.85rem" }}>{lead.name}</p>
					<p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.15rem" }}>
						{lead.country} · {lead.degreeLevel}
					</p>
				</div>
				<span
					style={{
						fontSize: "0.62rem",
						fontFamily: "var(--font-mono)",
						color: "var(--muted-foreground)",
						flexShrink: 0,
						whiteSpace: "nowrap",
					}}
				>
					{timeAgo(lead.lastContactAt)}
				</span>
			</div>

			<div style={{ display: "flex", gap: "0.35rem", marginTop: "0.55rem", flexWrap: "wrap" }}>
				<span
					style={{
						fontSize: "0.62rem",
						padding: "0.12rem 0.45rem",
						background: "var(--muted)",
						borderRadius: "3px",
						fontWeight: 500,
					}}
				>
					{lead.source}
				</span>
				<span
					style={{
						fontSize: "0.62rem",
						padding: "0.12rem 0.45rem",
						background: "var(--muted)",
						borderRadius: "3px",
					}}
				>
					{lead.assignedTo}
				</span>
				{lead.value > 0 ? (
					<span
						style={{
							fontSize: "0.62rem",
							padding: "0.12rem 0.45rem",
							fontFamily: "var(--font-mono)",
							borderRadius: "3px",
							background: "var(--foreground)",
							color: "var(--background)",
							fontWeight: 600,
						}}
					>
						{fmtBoth(lead.value)}
					</span>
				) : null}
			</div>

			{expanded ? (
				<div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-light)" }}>
					<p className="muted" style={{ fontSize: "0.78rem", lineHeight: 1.5 }}>
						{lead.notes}
					</p>
					<p className="mono" style={{ fontSize: "0.65rem", marginTop: "0.4rem", opacity: 0.6 }}>
						{lead.email} · {lead.phone}
					</p>
					{canMove && (
						<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
							{prevStage && prevStage !== "lost" ? (
								<button
									type="button"
									className="btn btn--ghost btn--sm"
									style={{ fontSize: "0.7rem" }}
									onClick={(e) => {
										e.stopPropagation();
										onMove(lead.id, prevStage);
									}}
								>
									← {LEAD_STAGE_LABELS[prevStage]}
								</button>
							) : null}
							{nextStage ? (
								<button
									type="button"
									className="btn btn--primary btn--sm"
									style={{ fontSize: "0.7rem" }}
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
	const { opsRole, opsUser, canSeeAllBranches, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { leads, moveLead } = useOpsState();
	const [search, setSearch] = useState("");
	const [branchFilter, setBranchFilter] = useState("all");

	const canSeeAll = canSeeAllBranches;
	/**
	 * Manager and coordinator work any lead; the assigned owner works their own.
	 * Dragging was absent entirely before - stages could only be changed by
	 * expanding a card and clicking the arrow buttons.
	 */
	const canMoveAny = opsRole === "manager" || opsRole === "coordinator";
	const canMoveLead = (l: Lead) => canMoveAny || l.assignedTo === opsUser?.name;

	const [dragging, setDragging] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState<LeadStage | null>(null);

	const roleScopedLeads = scopeRecords(leads, (l) => l.assignedTo === opsUser?.name);

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
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
				<div>
					<h1 className="page-title">CRM · Lead Pipeline</h1>
					<p className="lead mt-2">
						Drag a lead between columns, or expand a card to move it a stage at a time.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<span className="portal-pill" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
						{canSeeAll ? "All leads · Auto-populated" : "Assigned to you"}
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
							? `All ${roleScopedLeads.length} leads · ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: requiresAssignmentScope
								? `${roleScopedLeads.length} leads assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch · ${roleScopedLeads.length} leads`}
					</p>
				</div>
				<span className="portal-pill" style={canSeeAll ? { background: "var(--background)", color: "var(--foreground)", border: "none" } : undefined}>
					{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
				</span>
			</div>

			{/* Stats */}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.75rem" }}>
				<StatTile label="Total Leads" value={String(roleScopedLeads.length)} />
				<StatTile label="Active" value={String(activeCount)} accent="#3b82f6" />
				<StatTile label="Converted" value={String(convertedCount)} accent="#22c55e" />
				<StatTile label="Conversion Rate" value={`${conversionRate}%`} accent="#8b5cf6" />
				<StatTile label="Pipeline Value" value={fmtBoth(totalValue)} accent="#f59e0b" />
			</div>

			{/* Search */}
			<div style={{ marginBottom: "1.5rem" }}>
				<input
					type="search"
					placeholder="Search leads by name, email, or country..."
					className="input input--sm"
					style={{ maxWidth: "420px" }}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</div>

			{/* Kanban Board */}
			<div
				className="ops-board"
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
								if (dragging) moveLead(dragging, stage);
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
											onMove={moveLead}
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
