import { useMemo, useState } from "react";
import { useOpsState } from "./OpsStateContext";
import { useOpsAuth } from "./OpsAuthContext";
import { BranchScopeFilter } from "./BranchScopeFilter";

const HOURS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseDateAndTime(dateTime: string): { date: string | null; time: string | null } {
	if (!dateTime) return { date: null, time: null };
	const lower = dateTime.toLowerCase();
	const now = new Date();

	const dayMap: Record<string, number> = {
		monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
		today: now.getDay(),
		tomorrow: (now.getDay() + 1) % 7,
	};

	let targetDay: number | null = null;
	for (const [word, day] of Object.entries(dayMap)) {
		if (lower.includes(word)) {
			targetDay = day;
			break;
		}
	}

	const timeMatch = dateTime.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
	let time: string | null = null;
	if (timeMatch) {
		let h = parseInt(timeMatch[1], 10);
		const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
		const period = timeMatch[3]?.toLowerCase();
		if (period === "pm" && h < 12) h += 12;
		if (period === "am" && h === 12) h = 0;
		time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}

	if (targetDay !== null) {
		const diff = (targetDay - now.getDay() + 7) % 7;
		const d = new Date(now);
		d.setDate(d.getDate() + diff);
		const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		return { date, time };
	}

	return { date: null, time };
}

function getWeekDates(anchor: Date): Date[] {
	const monday = new Date(anchor);
	const day = monday.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	monday.setDate(monday.getDate() + diff);
	monday.setHours(0, 0, 0, 0);
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(monday);
		d.setDate(d.getDate() + i);
		return d;
	});
}

function dateToStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EnterpriseAppointments() {
	const { consultations } = useOpsState();
	const { opsUser, canSeeAllBranches, scopeRecords } = useOpsAuth();
	const [branchFilter, setBranchFilter] = useState<string>("all");
	const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());

	const scopedConsultations = scopeRecords(
		consultations,
		(c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
	);

	const weekDates = useMemo(() => getWeekDates(weekAnchor), [weekAnchor]);
	const weekStart = weekDates[0];
	const weekEnd = weekDates[6];
	const monthLabel = weekStart.toLocaleString("en", { month: "long", year: "numeric" });

	const filtered = useMemo(() => {
		return scopedConsultations.filter((c) => {
			if (branchFilter !== "all" && c.branch !== branchFilter) return false;
			return true;
		});
	}, [scopedConsultations, branchFilter]);

	const appointmentsByDate = useMemo(() => {
		const map: Record<string, { consultation: typeof filtered[number]; time: string }[]> = {};
		for (const c of filtered) {
			const { date, time } = parseDateAndTime(c.dateTime);
			if (!date || !time) continue;
			if (!map[date]) map[date] = [];
			map[date].push({ consultation: c, time });
		}
		return map;
	}, [filtered]);

	const stats = useMemo(() => {
		const online = filtered.filter((c) => c.type === "online").length;
		const inPerson = filtered.filter((c) => c.type === "in_person").length;
		const confirmed = filtered.filter((c) => c.slotConfirmed).length;
		return { total: filtered.length, online, inPerson, confirmed };
	}, [filtered]);

	function shiftWeek(direction: number) {
		const d = new Date(weekAnchor);
		d.setDate(d.getDate() + direction * 7);
		setWeekAnchor(d);
	}

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
				<div>
					<h1 className="page-title">Appointments Calendar</h1>
					<p className="lead mt-2">Manage consultations, visa, and embassy appointments.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
				<div className="card card--pad">
					<p className="eyebrow">Total</p>
					<p className="display mt-2" style={{ fontSize: "1.5rem" }}>{stats.total}</p>
				</div>
				<div className="card card--pad">
					<p className="eyebrow">Online</p>
					<p className="display mt-2" style={{ fontSize: "1.5rem", color: "#2563eb" }}>{stats.online}</p>
				</div>
				<div className="card card--pad">
					<p className="eyebrow">In-Person</p>
					<p className="display mt-2" style={{ fontSize: "1.5rem", color: "#059669" }}>{stats.inPerson}</p>
				</div>
				<div className="card card--pad">
					<p className="eyebrow">Confirmed</p>
					<p className="display mt-2" style={{ fontSize: "1.5rem", color: "#7c3aed" }}>{stats.confirmed}</p>
				</div>
			</div>

			<div className="card">
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
						<button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(-1)}>← Prev</button>
						<h2 className="section-title" style={{ margin: 0 }}>
							{monthLabel}
						</h2>
						<button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(1)}>Next →</button>
					</div>
					<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
						<span className="mono muted" style={{ fontSize: "0.75rem" }}>
							{weekStart.toLocaleDateString("en", { month: "short", day: "numeric" })} - {weekEnd.toLocaleDateString("en", { month: "short", day: "numeric" })}
						</span>
						<button className="btn btn--ghost btn--sm" onClick={() => setWeekAnchor(new Date())}>Today</button>
					</div>
				</div>

				<div style={{ overflowX: "auto" }}>
					<div style={{ minWidth: "700px", border: "1px solid var(--border-light)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
						<div style={{ display: "grid", gridTemplateColumns: "60px repeat(7, 1fr)", borderBottom: "1px solid var(--border-light)", background: "var(--muted)", textAlign: "center", fontWeight: 600, fontSize: "var(--text-xs)" }}>
							<div style={{ padding: "0.5rem 0" }}></div>
							{weekDates.map((d, i) => (
								<div key={i} style={{ padding: "0.5rem 0", borderLeft: "1px solid var(--border-light)" }}>
									{DAY_LABELS[i]}
									<br />
									<span style={{ opacity: 0.6 }}>{d.getDate()}</span>
								</div>
							))}
						</div>
						{HOURS.map((hour) => (
							<div key={hour} style={{ display: "grid", gridTemplateColumns: "60px repeat(7, 1fr)", borderBottom: "1px solid var(--border-light)", minHeight: "50px" }}>
								<div style={{ padding: "0.4rem", color: "var(--muted-foreground)", fontSize: "0.7rem", textAlign: "right", paddingRight: "0.5rem" }}>
									{hour}
								</div>
								{weekDates.map((d, i) => {
									const dateStr = dateToStr(d);
									const dayAppts = appointmentsByDate[dateStr]?.filter((a) => a.time === hour) ?? [];
									return (
										<div key={i} style={{ borderLeft: "1px solid var(--border-light)", padding: "0.25rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
											{dayAppts.map(({ consultation: a }) => (
												<div
													key={a.id}
													style={{
														background: a.type === "online" ? "#dbeafe" : "#d1fae5",
														borderLeft: `3px solid ${a.type === "online" ? "#2563eb" : "#059669"}`,
														padding: "0.3rem 0.4rem",
														fontSize: "0.7rem",
														borderRadius: "2px",
														cursor: "default",
													}}
													title={`${a.applicantName} - ${a.type}${a.slotConfirmed ? " (confirmed)" : ""}`}
												>
													<div style={{ fontWeight: 600, color: "var(--foreground)" }}>
														{a.applicantName}
													</div>
													<div style={{ opacity: 0.6, fontSize: "0.65rem" }}>
														{a.type === "online" ? "Online" : "In-Person"}
														{a.slotConfirmed ? " · confirmed" : ""}
													</div>
													{a.meetingLink && (
														<a
															href={a.meetingLink}
															target="_blank"
															rel="noopener noreferrer"
															style={{ fontSize: "0.65rem", color: "#2563eb", display: "block", marginTop: "0.15rem" }}
															onClick={(e) => e.stopPropagation()}
														>
															Join →
														</a>
													)}
													{a.mapsUrl && (
														<a
															href={a.mapsUrl}
															target="_blank"
															rel="noopener noreferrer"
															style={{ fontSize: "0.65rem", color: "#059669", display: "block", marginTop: "0.15rem" }}
															onClick={(e) => e.stopPropagation()}
														>
															Directions →
														</a>
													)}
												</div>
											))}
										</div>
									);
								})}
							</div>
						))}
					</div>
				</div>

				<div style={{ display: "flex", gap: "1.5rem", marginTop: "1rem", fontSize: "var(--text-xs)" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
						<span style={{ width: "12px", height: "12px", background: "#dbeafe", borderLeft: "3px solid #2563eb", borderRadius: "2px" }}></span>
						<span className="muted">Online consultation</span>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
						<span style={{ width: "12px", height: "12px", background: "#d1fae5", borderLeft: "3px solid #059669", borderRadius: "2px" }}></span>
						<span className="muted">In-person consultation</span>
					</div>
				</div>
			</div>

			{filtered.length === 0 && (
				<div className="card card--pad mt-4" style={{ textAlign: "center" }}>
					<p className="muted">No appointments scheduled. Bookings will appear here once clients book consultations.</p>
				</div>
			)}
		</div>
	);
}
