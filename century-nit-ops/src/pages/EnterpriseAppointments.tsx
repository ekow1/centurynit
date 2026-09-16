import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { bookingsApi } from "century-nit-core/api";
import { Sheet } from "century-nit-core/ui";
import type { Booking } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { AssignDialog } from "./UnassignedBookings";
import { useJoinMeeting } from "./case/ConsultationCall";

/**
 * Appointments — the week's consultations: who, with whom, and where.
 *
 * Today's agenda sits above the week grid; the grid is ink only — ● online,
 * ○ in person, a dashed slot needs a consultant, an inverted one is live,
 * a muted one is done, a struck one a no-show. A booking opens in a sheet:
 * the now-card with Join, the client's contact, the session record the
 * booking itself knows, and the actions — reassign, reschedule (or answer
 * the client's request), no-show, complete.
 */

const HOURS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type View = "week" | "list";
type Cut = "all" | "mine" | "unassigned";

function localParts(iso: string, timeZone: string): { date: string; hour: string } {
	const at = new Date(iso);
	const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
	const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).slice(0, 2);
	return { date, hour: `${hour}:00` };
}

function getWeekDates(anchor: Date): Date[] {
	const monday = new Date(anchor);
	const day = monday.getDay();
	monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
	monday.setHours(0, 0, 0, 0);
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(monday);
		d.setDate(d.getDate() + i);
		return d;
	});
}

const dateToStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const isOpen = (b: Booking) => !b.employeeId;
const isDone = (b: Booking) => b.status === "COMPLETED";
const isNoShow = (b: Booking) => b.status === "NO_SHOW";
const isPast = (b: Booking) => isDone(b) || isNoShow(b);

export function EnterpriseAppointments() {
	const { opsUser, canSeeAllBranches, canAssignWork } = useOpsAuth();
	const { consultations } = useCases();
	const [branchFilter, setBranchFilter] = useState<string>("all");
	const [view, setView] = useState<View>("week");
	const [cut, setCut] = useState<Cut>("all");
	const [consultant, setConsultant] = useState<string>("all");
	const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
	const [bookings, setBookings] = useState<Booking[]>([]);
	const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
	const [loadError, setLoadError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [assigning, setAssigning] = useState<Booking | null>(null);
	const [now, setNow] = useState(() => new Date());

	const refresh = useCallback(async () => {
		try {
			const { bookings: rows } = await bookingsApi.list();
			setBookings(rows.filter((b) => b.status !== "CANCELLED"));
			setLoadError(null);
		} catch (err) {
			setLoadError(err instanceof Error ? err.message : "Could not load bookings");
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Live meetings and the clock, once a minute — the agenda's "live" and "n min in".
	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			setNow(new Date());
			try {
				const res = await bookingsApi.liveMeetings();
				if (!cancelled) setLiveIds(new Set(res.bookings.map((b) => b.id)));
			} catch {
				/* the next tick tries again */
			}
		};
		void tick();
		const id = setInterval(tick, 60_000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

	const isMine = useCallback((b: Booking) => Boolean(opsUser) && (b.employeeEmail === opsUser!.email || b.employeeId === opsUser!.opsUserId), [opsUser]);

	const weekDates = useMemo(() => getWeekDates(weekAnchor), [weekAnchor]);
	const weekStart = weekDates[0];
	const weekEnd = new Date(weekDates[6]);
	weekEnd.setHours(23, 59, 59, 999);

	const scoped = useMemo(
		() =>
			bookings.filter((b) => {
				if (branchFilter !== "all" && b.branchId !== branchFilter) return false;
				if (cut === "mine" && !isMine(b)) return false;
				if (cut === "unassigned" && !isOpen(b)) return false;
				if (consultant !== "all" && b.employeeId !== consultant) return false;
				return true;
			}),
		[bookings, branchFilter, cut, consultant, isMine],
	);
	const inWeek = useMemo(() => scoped.filter((b) => new Date(b.startsAt) >= weekStart && new Date(b.startsAt) <= weekEnd), [scoped, weekStart, weekEnd]);
	const today = useMemo(() => scoped.filter((b) => sameDay(new Date(b.startsAt), now)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [scoped, now]);

	const consultants = useMemo(() => {
		const map = new Map<string, string>();
		for (const b of bookings) if (b.employeeId && b.employeeName) map.set(b.employeeId, b.employeeName);
		return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
	}, [bookings]);

	const counts = useMemo(() => {
		const base = bookings.filter((b) => branchFilter === "all" || b.branchId === branchFilter);
		const week = base.filter((b) => new Date(b.startsAt) >= weekStart && new Date(b.startsAt) <= weekEnd);
		return {
			all: week.length,
			mine: week.filter(isMine).length,
			unassigned: week.filter(isOpen).length,
			today: base.filter((b) => sameDay(new Date(b.startsAt), now)).length,
			live: base.filter((b) => liveIds.has(b.id)).length,
			noShow: week.filter(isNoShow).length,
		};
	}, [bookings, branchFilter, weekStart, weekEnd, isMine, now, liveIds]);

	const byCell = useMemo(() => {
		const map: Record<string, Booking[]> = {};
		for (const b of inWeek) {
			const { date, hour } = localParts(b.startsAt, b.timezone);
			(map[`${date} ${hour}`] ??= []).push(b);
		}
		return map;
	}, [inWeek]);

	const selected = selectedId ? (bookings.find((b) => b.id === selectedId) ?? null) : null;
	const onUpdated = (updated: Booking) => setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));

	const slotClass = (b: Booking) =>
		`ops-slot ops-slot--${b.type === "online" ? "online" : "person"}${liveIds.has(b.id) ? " ops-slot--live" : isOpen(b) ? " ops-slot--open" : isDone(b) ? " ops-slot--done" : isNoShow(b) ? " ops-slot--noshow" : ""}`;
	const mark = (b: Booking) => <span className={`ops-dot${b.type === "online" ? "" : " ops-dot--hollow"}`} aria-hidden />;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Appointments</h1>
					<p className="lead mt-2">The week's consultations — who, with whom, and where.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<div className="cn-scaffold__chips" role="tablist" aria-label="View">
						<button type="button" role="tab" aria-selected={view === "week"} className={`btn btn--sm ${view === "week" ? "btn--primary" : "btn--ghost"}`} onClick={() => setView("week")}>
							Week
						</button>
						<button type="button" role="tab" aria-selected={view === "list"} className={`btn btn--sm ${view === "list" ? "btn--primary" : "btn--ghost"}`} onClick={() => setView("list")}>
							List
						</button>
					</div>
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{counts.all}</strong> <span className="dash-day__date">this week</span>
				</span>
				<span>
					<strong>{counts.today}</strong> <span className="dash-day__date">today</span>
				</span>
				<span>
					<strong>{counts.live}</strong> <span className="dash-day__date">live now</span>
				</span>
				<span>
					<strong>{counts.unassigned}</strong> <span className="dash-day__date">unassigned</span>
				</span>
				<span>
					<strong>{counts.noShow}</strong> <span className="dash-day__date">no-show</span>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/live-meetings" className="dash-link">
					Live meetings →
				</Link>
			</div>

			{loadError && (
				<p className="ops-modal__error" role="alert">
					{loadError}
				</p>
			)}

			{/* Today's agenda */}
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
				<span className="eyebrow">Today · {now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
				<span className="cn-filter__label">{today.length > 0 ? "click a booking to open it" : "nothing booked today"}</span>
			</div>
			{today.length > 0 && (
				<div className="ops-agenda">
					{today.map((b) => {
						const live = liveIds.has(b.id);
						const mins = Math.round((now.getTime() - new Date(b.startsAt).getTime()) / 60_000);
						return (
							<button key={b.id} type="button" className={`ops-appt${live ? " ops-appt--live" : isOpen(b) ? " ops-appt--open" : isPast(b) ? " ops-appt--past" : ""}`} onClick={() => setSelectedId(b.id)}>
								<span className="ops-appt__time">
									{hm(b.startsAt)} – {hm(b.endsAt)}
									{live ? ` · live · ${Math.max(0, mins)} min in` : b.rescheduleRequestedAt ? " · reschedule asked" : isDone(b) ? " · done" : isNoShow(b) ? " · no-show" : ""}
								</span>
								<span className="ops-appt__name">{b.clientName}</span>
								<span className="ops-appt__sub">
									{b.serviceName} · {b.type === "online" ? "online" : "in person"} · {b.employeeName ?? <strong>needs a consultant</strong>}
								</span>
							</button>
						);
					})}
				</div>
			)}

			{/* Week controls */}
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "1rem 0 0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setWeekAnchor(new Date(weekAnchor.getTime() - 7 * 86_400_000))}>
						← Prev
					</button>
					<span className="mono" style={{ fontWeight: 700 }}>
						{weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – {weekDates[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
					</span>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setWeekAnchor(new Date(weekAnchor.getTime() + 7 * 86_400_000))}>
						Next →
					</button>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setWeekAnchor(new Date())}>
						Today
					</button>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<div className="cn-scaffold__chips" role="tablist" aria-label="Bookings">
						{(
							[
								["all", "All", counts.all],
								["mine", "Mine", counts.mine],
								["unassigned", "Unassigned", counts.unassigned],
							] as [Cut, string, number][]
						).map(([id, label, n]) => {
							const on = cut === id;
							return (
								<button
									key={id}
									type="button"
									role="tab"
									aria-selected={on}
									className="ops-pill"
									onClick={() => setCut(id)}
									style={{
										cursor: "pointer",
										marginLeft: 0,
										border: "1px solid var(--border)",
										background: on ? "var(--foreground)" : "transparent",
										color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
										fontWeight: id === "unassigned" && n > 0 && !on ? 700 : 500,
									}}
								>
									{label}
									<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
										{n}
									</span>
								</button>
							);
						})}
					</div>
					{canAssignWork && consultants.length > 0 && (
						<label className="cn-filter">
							<span className="cn-filter__label">Consultant</span>
							<select className="cn-filter__select" value={consultant} onChange={(e) => setConsultant(e.target.value)}>
								<option value="all">Everyone</option>
								{consultants.map(([id, name]) => (
									<option key={id} value={id}>
										{name}
									</option>
								))}
							</select>
						</label>
					)}
				</div>
			</div>

			{view === "week" ? (
				<>
					<div className="ops-week-wrap">
						<div className="ops-week">
							<div className="ops-week__head">
								<div />
								{weekDates.map((d, i) => {
									const isToday = sameDay(d, now);
									return (
										<div key={i} className={`ops-week__day${isToday ? " ops-week__day--today" : ""}`}>
											<span>{DAY_LABELS[i]}</span>
											<span className="ops-week__n">{d.getDate()}</span>
										</div>
									);
								})}
							</div>
							{HOURS.map((hour) => (
								<div key={hour} className="ops-week__row">
									<div className="ops-week__hour">{hour}</div>
									{weekDates.map((d, i) => {
										const cell = byCell[`${dateToStr(d)} ${hour}`] ?? [];
										return (
											<div key={i} className={`ops-week__cell${sameDay(d, now) ? " ops-week__cell--today" : ""}`}>
												{cell.map((b) => (
													<button key={b.id} type="button" className={slotClass(b)} onClick={() => setSelectedId(b.id)} title={`${b.clientName} — ${b.serviceName} · ${b.status.toLowerCase().replace("_", " ")}`}>
														<span className="ops-slot__name">
															{mark(b)}
															{b.clientName}
														</span>
														<span className="ops-slot__sub">
															{b.serviceName}
															{b.employeeName ? ` · ${b.employeeName.split(" ")[0]}` : " · unassigned"}
														</span>
													</button>
												))}
											</div>
										);
									})}
								</div>
							))}
						</div>
					</div>
					<div className="ops-legend">
						<span>
							<span className="ops-dot" aria-hidden /> online
						</span>
						<span>
							<span className="ops-dot ops-dot--hollow" aria-hidden /> in person
						</span>
						<span>
							<span className="ops-legend__sw" style={{ borderStyle: "dashed" }} aria-hidden /> needs a consultant
						</span>
						<span>
							<span className="ops-legend__sw" style={{ background: "var(--foreground)" }} aria-hidden /> live now
						</span>
						<span style={{ textDecoration: "line-through" }}>no-show</span>
					</div>
				</>
			) : (
				<AgendaList bookings={inWeek} liveIds={liveIds} onOpen={setSelectedId} />
			)}

			<Sheet open={selected !== null} onClose={() => setSelectedId(null)} size="tall" label="Booking">
				{selected && (
					<BookingSheet
						booking={selected}
						live={liveIds.has(selected.id)}
						now={now}
						consultationId={consultations.find((c) => c.bookingId === selected.id)?.id ?? null}
						canAssign={canAssignWork}
						onAssign={() => setAssigning(selected)}
						onUpdated={onUpdated}
						onError={setLoadError}
					/>
				)}
			</Sheet>

			{assigning && (
				<AssignDialog
					booking={assigning}
					onClose={() => setAssigning(null)}
					onAssigned={(updated) => {
						setAssigning(null);
						onUpdated(updated);
					}}
				/>
			)}
		</div>
	);
}

/** The week as a list — one band per day, the agenda cards inside. */
function AgendaList({ bookings, liveIds, onOpen }: { bookings: Booking[]; liveIds: Set<string>; onOpen: (id: string) => void }) {
	const byDay = new Map<string, Booking[]>();
	for (const b of [...bookings].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
		const key = dayLabel(b.startsAt);
		byDay.set(key, [...(byDay.get(key) ?? []), b]);
	}
	if (byDay.size === 0) return <p className="ops-people__empty">Nothing booked this week.</p>;
	return (
		<div className="ops-bands" style={{ padding: 0 }}>
			{[...byDay.entries()].map(([day, list]) => (
				<div key={day}>
					<div className="ops-band">
						<span className="ops-band__name">
							{day} · {list.length}
						</span>
					</div>
					<div className="ops-agenda" style={{ margin: "0.75rem 0 0" }}>
						{list.map((b) => (
							<button key={b.id} type="button" className={`ops-appt${liveIds.has(b.id) ? " ops-appt--live" : isOpen(b) ? " ops-appt--open" : isPast(b) ? " ops-appt--past" : ""}`} onClick={() => onOpen(b.id)}>
								<span className="ops-appt__time">
									{hm(b.startsAt)} – {hm(b.endsAt)}
									{isDone(b) ? " · done" : isNoShow(b) ? " · no-show" : b.rescheduleRequestedAt ? " · reschedule asked" : ""}
								</span>
								<span className="ops-appt__name">{b.clientName}</span>
								<span className="ops-appt__sub">
									{b.serviceName} · {b.type === "online" ? "online" : "in person"} · {b.employeeName ?? <strong>needs a consultant</strong>}
								</span>
							</button>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/** One booking, opened: the now-card, the client, the record, the actions. */
function BookingSheet({
	booking: b,
	live,
	now,
	consultationId,
	canAssign,
	onAssign,
	onUpdated,
	onError,
}: {
	booking: Booking;
	live: boolean;
	now: Date;
	consultationId: string | null;
	canAssign: boolean;
	onAssign: () => void;
	onUpdated: (b: Booking) => void;
	onError: (msg: string | null) => void;
}) {
	const [busy, setBusy] = useState<string | null>(null);
	const [moving, setMoving] = useState(false);
	const [date, setDate] = useState(() => dateToStr(new Date(b.startsAt)));
	const [time, setTime] = useState(() => hm(b.startsAt));
	const { join, joining, error: joinError, overlay } = useJoinMeeting();

	async function run(kind: string, fn: () => Promise<Booking>) {
		setBusy(kind);
		onError(null);
		try {
			onUpdated(await fn());
			setMoving(false);
		} catch (err) {
			onError(err instanceof Error ? err.message : "Could not update the booking");
		} finally {
			setBusy(null);
		}
	}

	const past = isPast(b);
	const startedMin = Math.round((now.getTime() - new Date(b.startsAt).getTime()) / 60_000);
	const record: { summary: string; at: string; meta?: string }[] = [];
	if (live && b.meetingCheckedAt) record.push({ summary: `Meeting live${b.meetingParticipants > 0 ? ` · ${b.meetingParticipants} in the room` : ""}`, at: b.meetingCheckedAt, meta: b.meetingProvider ?? undefined });
	if (isDone(b)) record.push({ summary: "Marked complete", at: b.updatedAt });
	if (isNoShow(b)) record.push({ summary: "Marked no-show", at: b.updatedAt });
	if (b.rescheduleRequestedAt) record.push({ summary: `Client asked to move the slot${b.rescheduleRequestedStartsAt ? ` to ${dayLabel(b.rescheduleRequestedStartsAt)} ${hm(b.rescheduleRequestedStartsAt)}` : ""}`, at: b.rescheduleRequestedAt, meta: b.rescheduleRequestReason ?? undefined });
	if (b.rescheduledAt) record.push({ summary: "Rescheduled", at: b.rescheduledAt });
	if (b.assignedAt) record.push({ summary: `Assigned to ${b.employeeName ?? "a consultant"}`, at: b.assignedAt, meta: b.meetingUrl ? "meeting link created" : undefined });
	record.push({ summary: `Booked by ${b.clientName}`, at: b.createdAt, meta: b.serviceName });
	record.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());

	return (
		<div className="cn-detail" style={{ paddingBottom: "1rem" }}>
			<div className={`card cn-now${live ? " cn-now--live" : ""}`}>
				<span className="cn-detailhead__kicker">
					<span className={`cn-now__dot${live ? "" : " cn-now__dot--hollow"}`} aria-hidden />
					{live ? "Live" : isDone(b) ? "Done" : isNoShow(b) ? "No-show" : isOpen(b) ? "Needs a consultant" : "Booked"} · {b.type === "online" ? "online" : "in person"} · {b.reference}
				</span>
				<h3 className="cn-detailhead__title">{b.clientName}</h3>
				<p className="cn-detailhead__sub">{b.serviceName}</p>
				<p className="cn-detailhead__meta">
					{dayLabel(b.startsAt)} · {hm(b.startsAt)} – {hm(b.endsAt)}
					{live ? ` · ${Math.max(0, startedMin)} min in` : ""} · {b.employeeName ?? "unassigned"}
					{b.meetingSpace ? ` · ${b.meetingSpace}` : ""}
				</p>
				<div className="cn-now__actions">
					{b.meetingUrl && !past && (
						<button type="button" className="btn btn--primary btn--sm" disabled={joining} onClick={() => void join(b.id, `Consultation · ${b.reference ?? b.clientName}`)}>
							{joining ? "Joining…" : "Join meeting"}
						</button>
					)}
					{joinError && <span className="cn-detailhead__meta">{joinError}</span>}
					{consultationId && (
						<Link to={`/consultations?id=${consultationId}`} className={`btn btn--sm ${b.meetingUrl && !past ? "btn--ghost" : "btn--primary"}`}>
							Open consultation
						</Link>
					)}
				</div>
				{overlay}
			</div>

			<div className="card cn-now">
				<p className="cn-detail__eyebrow">Client</p>
				<div className="cn-detail__rows">
					<div className="cn-detail__row">
						<a href={`mailto:${b.clientEmail}`}>{b.clientEmail}</a>
						<span className="cn-detail__row-note">email</span>
					</div>
					{b.clientPhone && (
						<div className="cn-detail__row">
							<a href={`tel:${b.clientPhone}`}>{b.clientPhone}</a>
							<span className="cn-detail__row-note">phone</span>
						</div>
					)}
				</div>
			</div>

			{b.rescheduleRequestedAt && !past && (
				<div className="card cn-now" style={{ borderColor: "var(--foreground)" }}>
					<p className="cn-detail__eyebrow">The client asked to move this</p>
					<p style={{ fontSize: "var(--text-sm)", margin: 0 }}>
						{b.rescheduleRequestedStartsAt ? `${dayLabel(b.rescheduleRequestedStartsAt)} · ${hm(b.rescheduleRequestedStartsAt)}` : "a new time"}
						{b.rescheduleRequestReason ? ` — “${b.rescheduleRequestReason}”` : ""}
					</p>
					<div className="cn-now__actions">
						<button type="button" className="btn btn--primary btn--sm" disabled={busy !== null} onClick={() => void run("approve", () => bookingsApi.rescheduleDecision(b.id, "approve"))}>
							{busy === "approve" ? "Moving…" : "Approve"}
						</button>
						<button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => void run("reject", () => bookingsApi.rescheduleDecision(b.id, "reject"))}>
							Keep the slot
						</button>
					</div>
				</div>
			)}

			<div className="card cn-now">
				<p className="cn-detail__eyebrow">Session record</p>
				<ul className="cn-timeline">
					{record.map((e, i) => (
						<li key={`${e.at}-${i}`} className="cn-timeline__item">
							<div className="cn-timeline__head">
								<span className="cn-timeline__summary">{e.summary}</span>
								<span className="cn-timeline__when">{sameDay(new Date(e.at), now) ? hm(e.at) : dayLabel(e.at)}</span>
							</div>
							{e.meta && <p className="cn-timeline__meta">{e.meta}</p>}
						</li>
					))}
				</ul>
			</div>

			{moving && (
				<div className="card cn-now">
					<p className="cn-detail__eyebrow">Move to</p>
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
						<input type="date" className="cn-search" style={{ width: "auto", flex: "1 1 8rem" }} value={date} onChange={(e) => setDate(e.target.value)} aria-label="New date" />
						<input type="time" className="cn-search" style={{ width: "auto", flex: "0 1 7rem" }} value={time} onChange={(e) => setTime(e.target.value)} aria-label="New time" />
						<button type="button" className="btn btn--primary btn--sm" disabled={busy !== null || !date || !time} onClick={() => void run("move", () => bookingsApi.reschedule(b.id, { date, time, timezone: b.timezone }))}>
							{busy === "move" ? "Moving…" : "Move"}
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setMoving(false)}>
							Cancel
						</button>
					</div>
				</div>
			)}

			{!past && (
				<div className="actions" style={{ marginTop: 0, justifyContent: "flex-start" }}>
					{canAssign && (
						<button type="button" className="btn btn--ghost btn--sm" onClick={onAssign}>
							{isOpen(b) ? "Assign" : "Reassign"}
						</button>
					)}
					{!moving && (
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setMoving(true)}>
							Reschedule
						</button>
					)}
					<button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => void run("noshow", () => bookingsApi.markNoShow(b.id))}>
						{busy === "noshow" ? "Saving…" : "No-show"}
					</button>
					<button type="button" className="btn btn--secondary btn--sm" disabled={busy !== null} onClick={() => void run("complete", () => bookingsApi.complete(b.id))} style={{ marginLeft: "auto" }}>
						{busy === "complete" ? "Saving…" : "Mark complete"}
					</button>
				</div>
			)}
		</div>
	);
}
