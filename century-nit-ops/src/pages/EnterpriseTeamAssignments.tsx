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

	return (
		<div className="ops-panel">
			<div className="ops-panel__header">
				<h1 className="ops-panel__title">Team Assignments</h1>
				<p className="ops-panel__muted">Track every case, consultation and ticket assigned to your team.</p>
			</div>

			{loading && <p className="ops-panel__muted">Loading assignments…</p>}
			{error && <p className="ops-panel__error">{error}</p>}

			{!loading && !error && (
				<>
					<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
						<div className="ops-card" style={{ padding: "1.25rem" }}>
							<p className="ops-panel__muted" style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase" }}>Cases</p>
							<p style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0.25rem 0 0" }}>{stats.cases}</p>
						</div>
						<div className="ops-card" style={{ padding: "1.25rem" }}>
							<p className="ops-panel__muted" style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase" }}>Consultations</p>
							<p style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0.25rem 0 0" }}>{stats.consultations}</p>
						</div>
						<div className="ops-card" style={{ padding: "1.25rem" }}>
							<p className="ops-panel__muted" style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase" }}>Tickets</p>
							<p style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0.25rem 0 0" }}>{stats.tickets}</p>
						</div>
						<div className="ops-card" style={{ padding: "1.25rem" }}>
							<p className="ops-panel__muted" style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase" }}>Staff</p>
							<p style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0.25rem 0 0" }}>{stats.staff}</p>
						</div>
					</div>

					<div className="ops-card" style={{ padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
						<div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
							<div style={{ display: "flex", gap: "0.5rem" }}>
								{TYPES.map((t) => (
									<button
										key={t}
										type="button"
										className={`btn btn--sm ${type === t ? "btn--primary" : "btn--ghost"}`}
										onClick={() => setType(t)}
									>
										{TYPE_LABELS[t]}
									</button>
								))}
							</div>
							<select className="input input--sm" value={staff} onChange={(e) => setStaff(e.target.value)} style={{ minWidth: "160px" }}>
								<option value="all">All staff</option>
								{staffList.map((s) => (
									<option key={s.id} value={s.id}>{s.name}</option>
								))}
							</select>
							<input
								type="text"
								className="input input--sm"
								placeholder="Search reference, client, or staff…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								style={{ minWidth: "220px", flex: 1 }}
							/>
							<div style={{ fontSize: "0.85rem", color: "var(--muted-foreground)" }}>
								{filtered.length} item{filtered.length === 1 ? "" : "s"}
							</div>
						</div>
					</div>

					<div className="ops-table-wrap" style={{ marginBottom: "1.5rem" }}>
						<table className="ops-table" style={{ width: "100%" }}>
							<thead>
								<tr>
									<th>Type</th>
									<th>Reference</th>
									<th>Client</th>
									<th>Assigned to</th>
									<th>Stage / Status</th>
									<th>Updated</th>
									<th style={{ width: "80px" }} />
								</tr>
							</thead>
							<tbody>
								{filtered.length === 0 ? (
									<tr>
										<td colSpan={7} style={{ textAlign: "center", padding: "2rem" }}>No assignments found.</td>
									</tr>
								) : (
									filtered.map((i) => (
										<tr key={`${i.type}-${i.id}`}>
											<td>
												<span className="ops-status" style={{ textTransform: "capitalize" }}>{i.type}</span>
											</td>
											<td>{i.reference}</td>
											<td>{i.clientName}</td>
											<td>{i.assignedStaffName ?? "—"}</td>
											<td>
												<span className="ops-status">{i.stageOrStatusLabel}</span>
												{i.priority ? <span className="ops-badge" style={{ marginLeft: "0.5rem" }}>{i.priority}</span> : null}
											</td>
											<td style={{ whiteSpace: "nowrap" }}>{relativeTime(i.updatedAt)}</td>
											<td>
												<Link className="btn btn--sm btn--ghost" to={`${i.link}/${i.id}`}>Open</Link>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>

					{staffList.length > 0 && (
						<div>
							<h3 className="heading-4" style={{ marginBottom: "0.75rem" }}>Workload by staff</h3>
							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "1rem" }}>
								{staffList.map((s) => (
									<div key={s.id} className="ops-card" style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
										<div>
											<p style={{ fontWeight: 600, margin: 0 }}>{s.name}</p>
											<p className="ops-panel__muted" style={{ fontSize: "0.75rem", margin: "0.15rem 0 0" }}>{s.count} active assignment{s.count === 1 ? "" : "s"}</p>
										</div>
										<p style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>{s.count}</p>
									</div>
								))}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
