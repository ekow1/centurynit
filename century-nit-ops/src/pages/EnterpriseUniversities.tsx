import { useOpsAuth } from "./OpsAuthContext";

export function EnterpriseUniversities() {
	const { canEditUniversities } = useOpsAuth();
	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
				<div>
					<h1 className="page-title">University Directory</h1>
					<p className="lead mt-2">Manage countries, universities, programs, and requirements.</p>
				</div>
				{canEditUniversities ? (
					<button className="btn btn--primary">Add University</button>
				) : (
					<span className="portal-pill" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
						🔒 Read only
					</span>
				)}
			</div>

			<div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid var(--border-light)", overflowX: "auto", whiteSpace: "nowrap", paddingBottom: "2px" }}>
				<button className="btn btn--ghost" style={{ borderBottom: "2px solid var(--foreground)", borderRadius: 0, paddingBottom: "0.5rem" }}>Universities</button>
				<button className="btn btn--ghost" style={{ paddingBottom: "0.5rem", color: "var(--muted-foreground)" }}>Programs</button>
				<button className="btn btn--ghost" style={{ paddingBottom: "0.5rem", color: "var(--muted-foreground)" }}>Countries</button>
				<button className="btn btn--ghost" style={{ paddingBottom: "0.5rem", color: "var(--muted-foreground)" }}>Scholarships</button>
			</div>

			<div className="card">
				<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
					<input type="search" placeholder="Search universities..." className="input input--sm" style={{ maxWidth: "300px" }} />
					<select className="input input--sm">
						<option>Filter by Country...</option>
						<option>Canada</option>
						<option>UK</option>
						<option>USA</option>
					</select>
				</div>
				<div className="ops-table-wrap">
					<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
						<thead>
							<tr style={{ borderBottom: "2px solid var(--border)" }}>
								<th style={{ padding: "1rem" }}>Institution</th>
								<th style={{ padding: "1rem" }}>Country</th>
								<th style={{ padding: "1rem" }}>Programs Listed</th>
								<th style={{ padding: "1rem" }}>Status</th>
								<th style={{ padding: "1rem" }}>Action</th>
							</tr>
						</thead>
						<tbody>
							{[1,2,3,4].map((i) => (
								<tr key={i} style={{ borderBottom: "1px solid var(--border-light)" }}>
									<td style={{ padding: "1rem", fontWeight: 500 }}>University of Technology {i}</td>
									<td style={{ padding: "1rem" }} className="muted">Canada</td>
									<td style={{ padding: "1rem" }}>{12 + i}</td>
									<td style={{ padding: "1rem" }}>
										<span className="portal-pill">Active</span>
									</td>
								<td style={{ padding: "1rem" }}>
									{canEditUniversities ? (
										<button className="btn btn--ghost btn--sm">Edit</button>
									) : (
										<span className="muted" style={{ fontSize: "var(--text-xs)" }}>-</span>
									)}
								</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
