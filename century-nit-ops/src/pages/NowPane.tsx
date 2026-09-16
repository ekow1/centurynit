import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Booking } from "century-nit-shared";
import { COMMENT_KIND_LABELS } from "century-nit-core/ops";
import { useOpsAuth } from "./OpsAuthContext";
import { isOverdue, taskActionLabel, whenLabel, type PendingTask } from "../lib/pendingTasks";
import { useJoinMeeting } from "./case/ConsultationCall";

/**
 * The Workspace rail with nothing selected: what is happening now.
 *
 * Three states, in order of urgency —
 *  - a consultation is live: the client, Join meeting, the session record
 *    (what the booking itself knows: booked, assigned, moved, live), and
 *    what is up next today;
 *  - nothing live but a consultation later today: the same surface with
 *    Join held until ten minutes before the slot;
 *  - no consultations today: the top of the queue takes the surface, and
 *    the next consultation on the calendar is named.
 *
 * Nothing here is fetched separately — it reads the queue the page already
 * built and the live-meeting poll the page already runs.
 */

const JOIN_OPENS_MIN = 10;
/** A slot that started this long ago still counts as "next", not missed. */
const GRACE_MIN = 15;

const hm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function spanLabel(mins: number): string {
	const m = Math.abs(mins);
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	const r = m % 60;
	return r ? `${h} h ${r} min` : `${h} h`;
}
/** "Mon 09:30" this week, a dated stamp beyond it. */
function slotLabel(iso: string, now: Date): string {
	const d = new Date(iso);
	if (sameDay(d, now)) return hm(iso);
	if (d.getTime() - now.getTime() < 6 * 86_400_000) return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
	return whenLabel(iso);
}

type ConsultationTask = Extract<PendingTask, { kind: "consultation" }>;
type Entry = { summary: string; at: string; meta?: string };

export function NowPane({
	items,
	liveBookings,
	onSelect,
}: {
	/** The queue, in priority order, before any chip or search narrows it. */
	items: PendingTask[];
	/** Bookings whose meeting is live right now (the page's poll). */
	liveBookings: Booking[];
	onSelect: (task: PendingTask) => void;
}) {
	const { opsUser, canAssignWork, canSeeAllBranches } = useOpsAuth();
	const { join, joining, error: joinError, overlay } = useJoinMeeting();
	// The clock in the bar, and everything relative to it.
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 30_000);
		return () => clearInterval(id);
	}, []);

	const consultations = useMemo(
		() =>
			items.filter((t): t is ConsultationTask => t.kind === "consultation" && Boolean(t.due)).sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime()),
		[items],
	);

	// Whose meetings this rail speaks for: my own first; those who assign
	// work see their branch's (or everyone's) too.
	const mine = (b: Booking) => Boolean(opsUser) && (b.employeeEmail === opsUser!.email || b.employeeId === opsUser!.opsUserId);
	const inScope = (b: Booking) => canSeeAllBranches || !opsUser?.branch || b.branchId === opsUser.branch;
	const live = liveBookings.find(mine) ?? (canAssignWork ? liveBookings.find(inScope) : undefined) ?? null;
	const liveTask = live ? consultations.find((t) => t.record.bookingId === live.id) ?? null : null;

	const upcomingToday = consultations.filter((t) => {
		const d = new Date(t.due!);
		return sameDay(d, now) && d.getTime() >= now.getTime() - GRACE_MIN * 60_000 && !t.isLive && t.record.bookingId !== live?.id;
	});
	const next = upcomingToday[0] ?? null;
	const upNext = (live ? upcomingToday : upcomingToday.slice(1)).slice(0, 3);
	const later = consultations.find((t) => new Date(t.due!).getTime() > now.getTime() && !sameDay(new Date(t.due!), now)) ?? null;
	const top = items[0] ?? null;

	// The four numbers a manager checks first — above the fold, before the Now card.
	const health = useMemo(() => {
		const me = [opsUser?.name, opsUser?.email].filter(Boolean);
		return {
			mine: items.filter((t) => me.some((w) => t.owner === w)).length,
			overdue: items.filter((t) => isOverdue(t)).length,
			unassigned: items.filter((t) => t.category === "needs_assignment").length,
			approval: items.filter((t) => t.action === "issue").length,
		};
	}, [items, opsUser]);

	const bar = (
		<div className="cn-scaffold__bar">
			<span className="cn-filter__label">Now</span>
			<span className="cn-filter__label">{now.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
		</div>
	);

	let head: ReactNode;
	let record: Entry[] = [];
	if (live) {
		const startedMin = Math.round((now.getTime() - new Date(live.startsAt).getTime()) / 60_000);
		const country = liveTask?.record.targetCountry;
		head = (
			<div className="card cn-now cn-now--live">
				<span className="cn-detailhead__kicker">
					<span className="cn-now__dot" aria-hidden />
					Live · Consultation
				</span>
				<h3 className="cn-detailhead__title">{live.clientName}</h3>
				<p className="cn-detailhead__sub">
					{live.serviceName}
					{country ? ` · ${country}` : ""}
				</p>
				<p className="cn-detailhead__meta">
					{hm(live.startsAt)} – {hm(live.endsAt)} · {startedMin >= 0 ? `started ${spanLabel(startedMin)} ago` : `starts in ${spanLabel(startedMin)}`}
					{live.meetingParticipants > 0 ? ` · ${live.meetingParticipants} in the room` : ""}
				</p>
				<div className="cn-now__actions">
					{live.meetingUrl ? (
						<button type="button" className="btn btn--primary btn--sm" disabled={joining} onClick={() => void join(live.id, `Consultation · ${live.clientName}`)}>
							{joining ? "Joining…" : "Join meeting"}
						</button>
					) : (
						<button type="button" className="btn btn--primary btn--sm" disabled>
							Join meeting
						</button>
					)}
					<Link to={liveTask?.linkTo ?? "/live-meetings"} className="btn btn--ghost btn--sm">
						Open consultation
					</Link>
				</div>
				{!live.meetingUrl && <p className="cn-detailhead__meta">No meeting link on this booking.</p>}
			</div>
		);
		if (live.meetingCheckedAt) record.push({ summary: `Meeting live${live.meetingParticipants > 0 ? ` · ${live.meetingParticipants} in the room` : ""}`, at: live.meetingCheckedAt, meta: live.meetingProvider ?? undefined });
		if (live.rescheduleRequestedAt) record.push({ summary: "Client asked to move the slot", at: live.rescheduleRequestedAt, meta: live.rescheduleRequestReason ?? undefined });
		if (live.rescheduledAt) record.push({ summary: "Rescheduled", at: live.rescheduledAt });
		if (live.assignedAt) record.push({ summary: `Assigned to ${live.employeeName ?? "a consultant"}`, at: live.assignedAt });
		record.push({ summary: `Booked by ${live.clientName}`, at: live.createdAt, meta: live.serviceName });
	} else if (next) {
		const c = next.record;
		const due = new Date(next.due!);
		const inMin = Math.round((due.getTime() - now.getTime()) / 60_000);
		const joinOpen = inMin <= JOIN_OPENS_MIN;
		const opensAt = new Date(due.getTime() - JOIN_OPENS_MIN * 60_000);
		head = (
			<div className="card cn-now">
				<span className="cn-detailhead__kicker">
					<span className="cn-now__dot cn-now__dot--hollow" aria-hidden />
					Next · {hm(next.due!)} · {inMin >= 0 ? `in ${spanLabel(inMin)}` : `${spanLabel(inMin)} ago`}
				</span>
				<h3 className="cn-detailhead__title">{c.applicantName}</h3>
				<p className="cn-detailhead__sub">
					{c.type}
					{c.targetCountry ? ` · ${c.targetCountry}` : ""}
				</p>
				<p className="cn-detailhead__meta">
					{c.dateTime}
					{c.rescheduleRequestedAt ? " · reschedule asked" : ""}
				</p>
				<div className="cn-now__actions">
					{c.meetingLink && joinOpen && c.bookingId ? (
						<button type="button" className="btn btn--primary btn--sm" disabled={joining} onClick={() => void join(c.bookingId!, `Consultation · ${c.applicantName}`)}>
							{joining ? "Joining…" : "Join meeting"}
						</button>
					) : (
						<button type="button" className="btn btn--primary btn--sm" disabled>
							Join meeting
						</button>
					)}
					<Link to={next.linkTo} className="btn btn--ghost btn--sm">
						Open consultation
					</Link>
				</div>
				<p className="cn-detailhead__meta">{!c.meetingLink ? "No meeting link yet — in person, or not generated." : joinOpen ? "The room is open." : `Join opens at ${hm(opensAt.toISOString())}`}</p>
			</div>
		);
		if (c.rescheduleRequestedAt) record.push({ summary: "Client asked to move the slot", at: c.rescheduleRequestedAt, meta: c.rescheduleRequestReason ?? undefined });
		for (const cm of (c.comments ?? []).slice(-4)) {
			record.push({ summary: cm.text.length > 90 ? `${cm.text.slice(0, 88)}…` : cm.text, at: cm.at, meta: `${COMMENT_KIND_LABELS[cm.kind] ?? cm.kind} · ${cm.author}` });
		}
	} else if (top) {
		head = (
			<div className="card cn-now">
				<span className="cn-detailhead__kicker">
					<span className="cn-now__dot cn-now__dot--hollow" aria-hidden />
					No consultations today
				</span>
				<h3 className="cn-detailhead__title">Top of your queue</h3>
				<p className="cn-detailhead__sub">
					{top.title} · {taskActionLabel(top)}
				</p>
				<p className="cn-detailhead__meta">{top.subtitle}</p>
				<div className="cn-now__actions">
					<Link to={top.linkTo} className="btn btn--primary btn--sm">
						Open
					</Link>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => onSelect(top)}>
						Show in queue
					</button>
				</div>
			</div>
		);
	} else {
		head = (
			<div className="card cn-now">
				<span className="cn-detailhead__kicker">
					<span className="cn-now__dot cn-now__dot--hollow" aria-hidden />
					Nothing on your desk
				</span>
				<h3 className="cn-detailhead__title">All caught up</h3>
				<p className="cn-detailhead__sub">No consultations today and nothing in the queue.</p>
			</div>
		);
	}
	record = record.filter((e) => !Number.isNaN(new Date(e.at).getTime())).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

	return (
		<>
			{bar}
			{overlay}
			<div className="cn-scaffold__body">
				<div className="cn-detail">
					{joinError && <p className="muted" style={{ fontSize: "var(--text-xs)" }}>{joinError}</p>}
					<div className="card cn-now">
						<div className="ops-health">
							<div><b>{health.mine}</b><span>Mine open</span></div>
							<div><b>{health.overdue}</b><span>Overdue</span></div>
							<div><b>{health.unassigned}</b><span>Unassigned</span></div>
							<div><b>{health.approval}</b><span>Awaiting approval</span></div>
						</div>
					</div>
					{head}
					{record.length > 0 && (
						<div className="card cn-now">
							<p className="cn-detail__eyebrow">Session record</p>
							<ul className="cn-timeline">
								{record.map((e, i) => (
									<li key={`${e.at}-${i}`} className="cn-timeline__item">
										<div className="cn-timeline__head">
											<span className="cn-timeline__summary">{e.summary}</span>
											<span className="cn-timeline__when">{slotLabel(e.at, now)}</span>
										</div>
										{e.meta && <p className="cn-timeline__meta">{e.meta}</p>}
									</li>
								))}
							</ul>
						</div>
					)}
					{upNext.length > 0 && (
						<div className="card cn-now">
							<p className="cn-detail__eyebrow">Up next</p>
							<div className="cn-detail__rows">
								{upNext.map((t) => (
									<button key={t.id} type="button" className="cn-detail__row cn-now__row" onClick={() => onSelect(t)}>
										<span>
											<span className="cn-now__time">{hm(t.due!)}</span>
											{t.record.applicantName}
										</span>
										<span className="cn-detail__row-note">{t.record.rescheduleRequestedAt ? "reschedule asked" : t.record.targetCountry || t.record.type}</span>
									</button>
								))}
							</div>
						</div>
					)}
					{!live && !next && later && (
						<div className="card cn-now">
							<p className="cn-detail__eyebrow">Next consultation</p>
							<div className="cn-detail__rows">
								<button type="button" className="cn-detail__row cn-now__row" onClick={() => onSelect(later)}>
									<span>
										<span className="cn-now__time">{slotLabel(later.due!, now)}</span>
										{later.record.applicantName}
									</span>
									<span className="cn-detail__row-note">{later.record.targetCountry || later.record.type}</span>
								</button>
							</div>
						</div>
					)}
				</div>
			</div>
		</>
	);
}
