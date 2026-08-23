import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getTeamAssignments, type TeamAssignment } from "../lib/api";

const TYPES = ["all", "case", "consultation", "ticket"] as const;
const TYPE_LABELS: Record<string, string> = {
	all: "All",
	case: "Cases",
	consultation: "Consultations",
	ticket: "Tickets",
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

export function EnterpriseTeamAssignments() {
	const [items, setItems] = useState<TeamAssignment[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [type, setType] = useState<(typeof TYPES)[number]>("all");
	const [staff, setStaff] = useState<string>("all");
	const [search, setSearch] = useState("");

	useEffect(() => {
		setLoading(true);
		getTeamAssignments()
			.then((res) => setItems(res.items))
			.catch((err) => setError(err instanceof Error ? err.message : "Failed to load team assignments"))
			.finally(() => setLoading(false));
	}, []);

	const staffList = useMemo(() => {
		const map = new Map<string, { id: string; name: string; count: number }>();
		for (const i of items) {
			if (i.assignedStaffId && i.assignedStaffName) {
				const existing = map.get(i.assignedStaffId);
				map.set(i.assignedStaffId, {
					id: i.assignedStaffId,
					name: i.assignedStaffName,
					count: (existing?.count ?? 0) + 1,
				});
			}
		}
		return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
	}, [items]);

	const filtered = useMemo(() => {
		let list = items;
		if (type !== "all") list = list.filter((i) => i.type === type);
		if (staff !== "all") list = list.filter((i) => i.assignedStaffId === staff);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(i) =>
					i.reference.toLowerCase().includes(q) ||
					i.clientName.toLowerCase().includes(q) ||
					(i.assignedStaffName ?? "").toLowerCase().includes(q),
			);
		}
		return list;
	}, [items, type, staff, search]);

	const stats = useMemo(() => ({
		cases: items.filter((i) => i.type === "case").length,
		consultations: items.filter((i) => i.type === "consultation").length,
		tickets: items.filter((i) => i.type === "ticket").length,
		staff: staffList.length,
	}), [items, staffList]);

	const baseInput = {
		border: "1px solid #000",
		borderRadius: 0,
		padding: "0.5rem 0.75rem",
		fontSize: "0.8rem",
		background: "#fff",
	};

	return (
		<div style={{ padding: "1.5rem" }}>
			<header style={{ marginBottom: "1.5rem" }}>
				<h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.25rem" }}>Team Assignments</h1>
				<p style={{ fontSize: "0.85rem", color: "#6b6b6b", margin: 0 }}>Track every case, consultation and ticket assigned to your team.</p>
			</header>

			{loading && <p style={{ fontSize: "0.85rem", color: "#6b6b6b" }}>Loading assignments…</p>}
			{error && <p style={{ fontSize: "0.85rem", color: "#b91c1c" }}>{error}</p>}

			{!loading && !error && (
				<>
					<section
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(4, 1fr)",
							borderTop: "1px solid #000",
							borderBottom: "1px solid #000",
							marginBottom: "1.5rem",
						}}
					>
						{[
							{ label: "Cases", value: stats.cases },
							{ label: "Consultations", value: stats.consultations },
							{ label: "Tickets", value: stats.tickets },
							{ label: "Staff", value: stats.staff },
						].map((s, idx, arr) => (
							<div
								key={s.label}
								style={{
									padding: "1rem",
									borderRight: idx < arr.length - 1 ? "1px solid #000" : undefined,
								}}
							>
								<p style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b6b6b", margin: "0 0 0.25rem" }}>{s.label}</p>
								<p style={{ fontSize: "1.75rem", fontWeight: 600, margin: 0 }}>{s.value}</p>
							</div>
						))}
					</section>

					<section style={{ marginBottom: "1.5rem" }}>
						<div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", borderBottom: "1px solid #000", paddingBottom: "1rem" }}>
							<div style={{ display: "flex", gap: "0.5rem" }}>
								{TYPES.map((t) => (
									<button
										key={t}
										type="button"
										onClick={() => setType(t)}
										style={{
											border: "none",
											borderBottom: type === t ? "2px solid #000" : "2px solid transparent",
											background: "transparent",
											fontSize: "0.75rem",
											textTransform: "uppercase",
											letterSpacing: "0.05em",
											padding: "0.35rem 0.25rem",
											cursor: "pointer",
											color: "#000",
										}}
									>
										{TYPE_LABELS[t]}
									</button>
								))}
							</div>
							<select
								value={staff}
								onChange={(e) => setStaff(e.target.value)}
								style={{ ...baseInput, minWidth: "160px" }}
							>
								<option value="all">All staff</option>
								{staffList.map((s) => (
									<option key={s.id} value={s.id}>{s.name}</option>
								))}
							</select>
							<input
								type="text"
								placeholder="Search reference, client, or staff…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								style={{ ...baseInput, minWidth: "240px", flex: 1 }}
							/>
							<span style={{ fontSize: "0.8rem", color: "#6b6b6b" }}>{filtered.length} item{filtered.length === 1 ? "" : "s"}</span>
						</div>
					</section>

					<section style={{ marginBottom: "1.5rem" }}>
						<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
							<thead>
								<tr style={{ borderBottom: "1px solid #000" }}>
									<th style={{ ...headerCell, width: "90px" }}>Type</th>
									<th style={headerCell}>Reference</th>
									<th style={headerCell}>Client</th>
									<th style={headerCell}>Assigned to</th>
									<th style={headerCell}>Stage / Status</th>
									<th style={{ ...headerCell, width: "100px" }}>Updated</th>
									<th style={{ ...headerCell, width: "60px" }} />
								</tr>
							</thead>
							<tbody>
								{filtered.length === 0 ? (
									<tr>
										<td colSpan={7} style={{ padding: "2rem 0", textAlign: "left", color: "#6b6b6b" }}>No assignments found.</td>
									</tr>
								) : (
									filtered.map((i) => (
										<tr key={`${i.type}-${i.id}`} style={{ borderBottom: "1px solid #e5e5e5" }}>
											<td style={{ padding: "0.85rem 0" }}>
												<span
													style={{
														display: "inline-block",
														border: "1px solid #000",
														padding: "0.15rem 0.4rem",
														fontSize: "0.65rem",
														textTransform: "uppercase",
														letterSpacing: "0.04em",
													}}
												>
													{i.type}
												</span>
											</td>
											<td style={cell}>{i.reference}</td>
											<td style={cell}>{i.clientName}</td>
											<td style={cell}>{i.assignedStaffName ?? "—"}</td>
											<td style={cell}>
												<span
													style={{
														border: "1px solid #000",
														padding: "0.15rem 0.4rem",
														fontSize: "0.65rem",
														textTransform: "uppercase",
														letterSpacing: "0.04em",
													}}
												>
													{i.stageOrStatusLabel}
												</span>
												{i.priority ? <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", textTransform: "uppercase", color: "#6b6b6b" }}>{i.priority}</span> : null}
											</td>
											<td style={{ ...cell, whiteSpace: "nowrap" }}>{relativeTime(i.updatedAt)}</td>
											<td style={cell}>
												<Link to={`${i.link}/${i.id}`} style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#000", textDecoration: "none", borderBottom: "1px solid #000" }}>Open</Link>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</section>

					{staffList.length > 0 && (
						<section style={{ borderTop: "1px solid #000", paddingTop: "1rem" }}>
							<h2 style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 0.75rem", fontWeight: 600 }}>Workload by staff</h2>
							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0" }}>
								{staffList.map((s, idx) => (
									<div
										key={s.id}
										style={{
											padding: "0.75rem 0",
											borderTop: idx > 0 ? "1px solid #e5e5e5" : "1px solid #000",
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
										}}
									>
										<div>
											<p style={{ fontWeight: 600, margin: 0, fontSize: "0.9rem" }}>{s.name}</p>
											<p style={{ fontSize: "0.75rem", color: "#6b6b6b", margin: "0.1rem 0 0" }}>{s.count} active assignment{s.count === 1 ? "" : "s"}</p>
										</div>
										<p style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>{s.count}</p>
									</div>
								))}
							</div>
						</section>
					)}
				</>
			)}
		</div>
	);
}

const headerCell = {
	padding: "0.6rem 0",
	textAlign: "left" as const,
	fontSize: "0.65rem",
	textTransform: "uppercase" as const,
	letterSpacing: "0.06em",
	fontWeight: 600,
	color: "#6b6b6b",
};

const cell = {
	padding: "0.85rem 0.5rem 0.85rem 0",
};

