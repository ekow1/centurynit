import { useState } from "react";
import { useOpsAuth } from "./OpsAuthContext";
import { universities, programs, destinations, scholarships } from "century-nit-core/content";

type Tab = "universities" | "programs" | "countries" | "scholarships";

export function EnterpriseUniversities() {
	const { canEditUniversities } = useOpsAuth();
	const [tab, setTab] = useState<Tab>("universities");
	const [search, setSearch] = useState("");
	const [countryFilter, setCountryFilter] = useState("all");
	const [levelFilter, setLevelFilter] = useState("all");

	const q = search.toLowerCase();

	const filteredUnis = universities.filter((u) => {
		if (countryFilter !== "all" && u.destinationId !== countryFilter) return false;
		if (q && !u.name.toLowerCase().includes(q) && !u.city.toLowerCase().includes(q) && !u.tags.some((t) => t.toLowerCase().includes(q))) return false;
		return true;
	});

	const filteredPrograms = programs.filter((p) => {
		if (countryFilter !== "all") {
			const uni = universities.find((u) => u.id === p.universityId);
			if (!uni || uni.destinationId !== countryFilter) return false;
		}
		if (levelFilter !== "all" && p.level !== levelFilter) return false;
		if (q && !p.name.toLowerCase().includes(q) && !p.field.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) return false;
		return true;
	});

	const filteredDestinations = destinations.filter((d) => {
		if (q && !d.name.toLowerCase().includes(q) && !d.region.toLowerCase().includes(q) && !d.description.toLowerCase().includes(q)) return false;
		return true;
	});

	const filteredScholarships = scholarships.filter((s) => {
		if (q && !s.name.toLowerCase().includes(q) && !s.eligibility.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
		return true;
	});

	const programCountForUni = (uniId: string) => programs.filter((p) => p.universityId === uniId).length;
	const uniForProgram = (uniId: string) => universities.find((u) => u.id === uniId);

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
				<div>
					<h1 className="page-title">Programs Directory</h1>
					<p className="lead mt-2">Universities, programs, destinations, and scholarships — read-only reference catalog.</p>
				</div>
				{canEditUniversities ? (
					<button className="btn btn--primary">Add University</button>
				) : (
					<span className="portal-pill" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
						🔒 Read only
					</span>
				)}
			</div>

			{/* Tabs */}
			<div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid var(--border-light)", overflowX: "auto", whiteSpace: "nowrap", paddingBottom: "2px" }}>
				{([["universities", "Universities"], ["programs", "Programs"], ["countries", "Countries"], ["scholarships", "Scholarships"]] as const).map(([key, label]) => (
					<button
						key={key}
						onClick={() => { setTab(key); setSearch(""); setCountryFilter("all"); setLevelFilter("all"); }}
						className="btn btn--ghost"
						style={{ borderBottom: tab === key ? "2px solid var(--foreground)" : "2px solid transparent", borderRadius: 0, paddingBottom: "0.5rem" }}
					>
						{label}
					</button>
				))}
			</div>

			{/* Filters */}
			<div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
				<input
					type="search"
					placeholder={tab === "programs" ? "Search programs, fields, descriptions..." : tab === "scholarships" ? "Search scholarships..." : tab === "countries" ? "Search countries, regions..." : "Search universities, cities, tags..."}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="input input--sm"
					style={{ maxWidth: "360px", flex: 1 }}
				/>
				<select
					className="input input--sm"
					value={countryFilter}
					onChange={(e) => setCountryFilter(e.target.value)}
				>
					<option value="all">All destinations</option>
					{destinations.map((d) => (
						<option key={d.id} value={d.id}>{d.name}</option>
					))}
				</select>
				{tab === "programs" && (
					<select
						className="input input--sm"
						value={levelFilter}
						onChange={(e) => setLevelFilter(e.target.value)}
					>
						<option value="all">All levels</option>
						<option value="Undergraduate">Undergraduate</option>
						<option value="Postgraduate">Postgraduate</option>
						<option value="PhD">PhD</option>
						<option value="Diploma">Diploma</option>
					</select>
				)}
			</div>

			{/* Universities Tab */}
			{tab === "universities" && (
				<div className="card">
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "1rem" }}>Institution</th>
									<th style={{ padding: "1rem" }}>City</th>
									<th style={{ padding: "1rem" }}>Destination</th>
									<th style={{ padding: "1rem" }}>Ranking</th>
									<th style={{ padding: "1rem" }}>Type</th>
									<th style={{ padding: "1rem" }}>Acceptance</th>
									<th style={{ padding: "1rem" }}>Programs</th>
									<th style={{ padding: "1rem" }}>Tags</th>
								</tr>
							</thead>
							<tbody>
								{filteredUnis.length === 0 ? (
									<tr><td colSpan={8} style={{ padding: "2rem", textAlign: "center" }} className="muted">No universities match your filter.</td></tr>
								) : filteredUnis.map((uni) => (
									<tr key={uni.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
										<td style={{ padding: "1rem", fontWeight: 600, fontSize: "var(--text-sm)" }}>{uni.name}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{uni.city}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{destName(uni.destinationId)}</td>
										<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{uni.ranking}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{uni.type}</td>
										<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{uni.acceptance}</td>
										<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{programCountForUni(uni.id)}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-xs)" }}>
											{uni.tags.map((t) => (
												<span key={t} className="portal-pill" style={{ fontSize: "0.65rem", marginRight: "0.3rem", marginBottom: "0.2rem", display: "inline-block" }}>{t}</span>
											))}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Programs Tab */}
			{tab === "programs" && (
				<div className="card">
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "1rem" }}>Program</th>
									<th style={{ padding: "1rem" }}>University</th>
									<th style={{ padding: "1rem" }}>Level</th>
									<th style={{ padding: "1rem" }}>Field</th>
									<th style={{ padding: "1rem" }}>Duration</th>
									<th style={{ padding: "1rem" }}>Tuition</th>
									<th style={{ padding: "1rem" }}>USD</th>
									<th style={{ padding: "1rem" }}>Intake</th>
									<th style={{ padding: "1rem" }}>Deadline</th>
								</tr>
							</thead>
							<tbody>
								{filteredPrograms.length === 0 ? (
									<tr><td colSpan={9} style={{ padding: "2rem", textAlign: "center" }} className="muted">No programs match your filter.</td></tr>
								) : filteredPrograms.map((prog) => {
									const uni = uniForProgram(prog.universityId);
									return (
										<tr key={prog.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
											<td style={{ padding: "1rem", fontWeight: 600, fontSize: "var(--text-sm)" }}>{prog.name}</td>
											<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{uni?.name ?? prog.universityId}</td>
											<td style={{ padding: "1rem" }}>
												<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{prog.level}</span>
											</td>
											<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{prog.field}</td>
											<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{prog.duration}</td>
											<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{prog.tuition}</td>
											<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>${prog.tuitionUsd.toLocaleString()}</td>
											<td style={{ padding: "1rem", fontSize: "var(--text-xs)" }}>{prog.intake.join(", ")}</td>
											<td style={{ padding: "1rem", fontSize: "var(--text-xs)" }}>{prog.applicationDeadline ?? "—"}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Countries Tab */}
			{tab === "countries" && (
				<div className="card">
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "1rem" }}>Country</th>
									<th style={{ padding: "1rem" }}>Region</th>
									<th style={{ padding: "1rem" }}>Tagline</th>
									<th style={{ padding: "1rem" }}>Universities</th>
									<th style={{ padding: "1rem" }}>Programs</th>
									<th style={{ padding: "1rem" }}>Highlights</th>
								</tr>
							</thead>
							<tbody>
								{filteredDestinations.length === 0 ? (
									<tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center" }} className="muted">No destinations match your filter.</td></tr>
								) : filteredDestinations.map((dest) => (
									<tr key={dest.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
										<td style={{ padding: "1rem", fontWeight: 600, fontSize: "var(--text-sm)" }}>{dest.name}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{dest.region}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-sm)", fontStyle: "italic" }}>{dest.tagline}</td>
										<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{dest.universities}</td>
										<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{dest.programs}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-xs)" }}>
											{dest.highlights.map((h) => (
												<span key={h} className="portal-pill" style={{ fontSize: "0.65rem", marginRight: "0.3rem", marginBottom: "0.2rem", display: "inline-block" }}>{h}</span>
											))}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Scholarships Tab */}
			{tab === "scholarships" && (
				<div className="card">
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "1rem" }}>Scholarship</th>
									<th style={{ padding: "1rem" }}>Amount</th>
									<th style={{ padding: "1rem" }}>Type</th>
									<th style={{ padding: "1rem" }}>Deadline</th>
									<th style={{ padding: "1rem" }}>Eligibility</th>
								</tr>
							</thead>
							<tbody>
								{filteredScholarships.length === 0 ? (
									<tr><td colSpan={5} style={{ padding: "2rem", textAlign: "center" }} className="muted">No scholarships match your filter.</td></tr>
								) : filteredScholarships.map((s) => (
									<tr key={s.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
										<td style={{ padding: "1rem", fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.name}</td>
										<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{s.amount}</td>
										<td style={{ padding: "1rem" }}>
											<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{s.type}</span>
										</td>
										<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{s.deadline}</td>
										<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{s.eligibility}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Stats Footer */}
			<div style={{ marginTop: "1.5rem", display: "flex", gap: "2rem", flexWrap: "wrap" }}>
				<div>
					<p className="muted" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Universities</p>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 600 }}>{universities.length}</p>
				</div>
				<div>
					<p className="muted" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Programs</p>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 600 }}>{programs.length}</p>
				</div>
				<div>
					<p className="muted" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Destinations</p>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 600 }}>{destinations.length}</p>
				</div>
				<div>
					<p className="muted" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Scholarships</p>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 600 }}>{scholarships.length}</p>
				</div>
			</div>
		</div>
	);
}

function destName(destId: string): string {
	return destinations.find((d) => d.id === destId)?.name ?? destId;
}
