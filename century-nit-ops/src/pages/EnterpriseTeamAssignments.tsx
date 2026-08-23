import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getTeamAssignments, type TeamAssignment } from "../lib/api";
const TYPES = ["all", "case", "consultation", "ticket"] as const;

export function EnterpriseTeamAssignments() {
	const [items, setItems] = useState<TeamAssignment[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [type, setType] = useState<(typeof TYPES)[number]>("all");
	const [search, setSearch] = useState("");

	useEffect(() => {
		setLoading(true);
		getTeamAssignments()
			.then((res) => setItems(res.items))
			.catch((err) => setError(err instanceof Error ? err.message : "Failed to load team assignments"))
			.finally(() => setLoading(false));
	}, []);

	const filtered = useMemo(() => {
		let list = items;
		if (type !== "all") list = list.filter((i) => i.type === type);
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
	}, [items, type, search]);

	const byStaff = useMemo(() => {
		const map = new Map<string, { id: string | null; name: string }>();
		for (const i of items) {
			if (i.assignedStaffId) {
				map.set(i.assignedStaffId, { id: i.assignedStaffId, name: i.assignedStaffName ?? i.assignedStaffEmail ?? "Staff" });
			}
		}
		return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
	}, [items]);

	return (
		<div className="ops-panel">
			<div className="ops-panel__header">
				<h1 className="ops-panel__title">Team Assignments</h1>
				<p className="ops-panel__muted">Track cases, consultations, and tickets assigned to your team.</p>
			</div>

			<div className="ops-toolbar" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<select className="input input--sm" value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
					<option value="all">All types</option>
					<option value="case">Cases</option>
					<option value="consultation">Consultations</option>
					<option value="ticket">Tickets</option>
				</select>
				<input
					type="text"
					className="input input--sm"
					placeholder="Search reference, client, or staff..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<div style={{ marginLeft: "auto" }}>
					<strong>{filtered.length}</strong> active item{filtered.length === 1 ? "" : "s"}
				</div>
			</div>

			{loading && <p>Loading…</p>}
			{error && <p className="ops-panel__error">{error}</p>}

			{!loading && !error && (
				<table className="ops-table" style={{ width: "100%", borderCollapse: "collapse" }}>
					<thead>
						<tr>
							<th style={{ textAlign: "left" }}>Type</th>
							<th style={{ textAlign: "left" }}>Reference</th>
							<th style={{ textAlign: "left" }}>Client</th>
							<th style={{ textAlign: "left" }}>Assigned to</th>
							<th style={{ textAlign: "left" }}>Stage / Status</th>
							<th style={{ textAlign: "left" }}>Updated</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{filtered.map((i) => (
							<tr key={`${i.type}-${i.id}`}>
								<td className="ops-status ops-status--capitalize">{i.type}</td>
								<td>{i.reference}</td>
								<td>{i.clientName}</td>
								<td>{i.assignedStaffName ?? "Unassigned"}</td>
								<td>
									{i.stageOrStatusLabel}
									{i.priority ? <span className="ops-badge" style={{ marginLeft: "0.5rem" }}>{i.priority}</span> : null}
								</td>
								<td>{new Date(i.updatedAt).toLocaleString()}</td>
								<td>
									<Link className="ops-link" to={`${i.link}/${i.id}`}>Open</Link>
								</td>
							</tr>
						))}
							{filtered.length === 0 && (
								<tr>
									<td colSpan={7} style={{ textAlign: "center", padding: "2rem" }}>No assignments found.</td>
								</tr>
							)}
						</tbody>
					</table>
				)}

			{!loading && !error && byStaff.length > 0 && (
				<div className="ops-card" style={{ marginTop: "1.5rem" }}>
					<h3 className="heading-4">By staff member</h3>
					<ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
						{byStaff.map((s) => (
							<li key={s.id} className="ops-card__item" style={{ display: "flex", justifyContent: "space-between" }}>
								<span>{s.name}</span>
								<strong>{items.filter((i) => i.assignedStaffId === s.id).length}</strong>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
