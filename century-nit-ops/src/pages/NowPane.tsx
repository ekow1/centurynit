import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Booking } from "century-nit-shared";
import { COMMENT_KIND_LABELS, OPS_BRANCHES } from "century-nit-core/ops";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { Sheet } from "century-nit-core/ui";
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
				<p className="cn-detail__eyebrow">No consultations today · top of your queue</p>
				<div className="cn-detail__row" style={{ cursor: "default" }}>
					<span>
						{top.title}
						<br />
						<span className="cn-detail__row-note" style={{ whiteSpace: "normal" }}>
							{taskActionLabel(top)} · {top.subtitle}
						</span>
					</span>
					<span style={{ display: "flex", gap: "0.9rem", alignItems: "baseline", whiteSpace: "nowrap" }}>
						<Link to={top.linkTo} className="link">
							open →
						</Link>
						<button type="button" className="link" onClick={() => onSelect(top)}>
							queue ↓
						</button>
					</span>
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
					<CoverageCard />
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

/**
 * Who catches today's intake, per branch — the duty roster moved off the
 * Consultations page to where the unassigned pile it explains already sits.
 *
 * The general manager (see_all_branches) sees every branch and can set all of
 * them in one pass; a branch manager sees only their own row. Anyone who
 * can't assign work never sees the card — coverage is a manager concern.
 */
function CoverageCard() {
	const { canAssignWork, canSeeAllBranches, opsUser } = useOpsAuth();
	const { consultations, applications, getDuty, setDuty, getWorkload, refresh } = useCases();
	const branches = useMemo(
		() => (canSeeAllBranches ? OPS_BRANCHES : OPS_BRANCHES.filter((b) => b.id === opsUser?.branch)),
		[canSeeAllBranches, opsUser],
	);
	const [duty, setDutyState] = useState<Record<string, { name: string; email: string } | null>>({});
	const [sheetOpen, setSheetOpen] = useState(false);
	const [workload, setWorkload] = useState<Awaited<ReturnType<typeof getWorkload>> | null>(null);
	const [picks, setPicks] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		if (!canAssignWork || branches.length === 0) return;
		let on = true;
		void Promise.all(branches.map((b) => getDuty(b.id).catch(() => null))).then((rows) => {
			if (!on) return;
			const next: Record<string, { name: string; email: string } | null> = {};
			rows.forEach((d, i) => { next[branches[i].id] = d?.coordinator ?? null; });
			setDutyState(next);
		});
		return () => { on = false; };
	}, [canAssignWork, branches, getDuty]);

	const delegated = useMemo(() => {
		const open = (s: string) => s !== "Completed" && s !== "Cancelled";
		return {
			cases: consultations.filter((c) => Boolean(c.coordinatorId) && open(c.status)).length,
			journeys: new Set(applications.filter((a) => a.journeyCoordinatorName).map((a) => a.applicantId)).size,
		};
	}, [consultations, applications]);

	if (!canAssignWork || branches.length === 0) return null;

	const openSheet = () => {
		setErr(null);
		setPicks({});
		setSheetOpen(true);
		if (!workload) getWorkload().then(setWorkload).catch(() => undefined);
	};

	// The duty record carries name+email, the workload list carries ids —
	// the email is the join. A duty holder no longer coordinator-capable
	// falls back to their email as the option value, which round-trips as
	// "unchanged" on apply.
	const dutyUserId = (branchId: string): string => {
		const d = duty[branchId];
		if (!d) return "";
		return workload?.coordinators.find((c) => c.email === d.email)?.opsUserId ?? d.email;
	};

	const apply = async () => {
		setBusy(true);
		setErr(null);
		try {
			for (const b of branches) {
				const want = picks[b.id];
				if (want === undefined) continue;
				if (want === dutyUserId(b.id)) continue;
				await setDuty(b.id, want || null);
			}
			// Re-read so the card reflects whatever the server kept.
			const rows = await Promise.all(branches.map((b) => getDuty(b.id).catch(() => null)));
			const next: Record<string, { name: string; email: string } | null> = {};
			rows.forEach((d, i) => { next[branches[i].id] = d?.coordinator ?? null; });
			setDutyState(next);
			void refresh();
			setSheetOpen(false);
		} catch (e: unknown) {
			setErr(e instanceof Error ? e.message : "Could not set coverage");
		} finally {
			setBusy(false);
		}
	};

	const covered = branches.filter((b) => Boolean(duty[b.id]));
	const uncovered = branches.length - covered.length;

	return (
		<>
			<div className="card cn-now">
				<p className="cn-detail__eyebrow">Coverage · today</p>
				{/* Covered branches itemize; the uncovered ones collapse into a
				    single count — five identical "nobody" rows were noise. */}
				{covered.map((b) => (
					<div key={b.id} className="cn-detail__row" style={{ cursor: "default" }}>
						<span>
							{b.name}
							<br />
							<span className="cn-detail__row-note">
								{duty[b.id]!.name} — new cases route to them
							</span>
						</span>
						<span className="portal-pill">on duty</span>
					</div>
				))}
				<div className="cn-detail__row" style={{ cursor: "default" }}>
					<span>
						Coverage
						<br />
						<span className="cn-detail__row-note">
							{covered.length} of {branches.length} covered
							{uncovered > 0 ? " · rest → unassigned" : ""}
						</span>
					</span>
					<button type="button" className="link" onClick={openSheet}>
						set →
					</button>
				</div>
				{(delegated.cases > 0 || delegated.journeys > 0) && (
					<div className="cn-detail__row" style={{ cursor: "default" }}>
						<span>
							Delegated
							<br />
							<span className="cn-detail__row-note">
								{delegated.cases} case{delegated.cases === 1 ? "" : "s"} · {delegated.journeys} journe{delegated.journeys === 1 ? "y" : "ys"}
							</span>
						</span>
						<Link to="/workspace?filter=coordinated" className="btn btn--ghost btn--sm">Review</Link>
					</div>
				)}
			</div>

			<Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Coverage · today" size="tall">
				<p className="lead" style={{ fontSize: "var(--text-sm)", marginTop: 0 }}>
					Who catches new cases, per branch. Unset branches route new cases to nobody — they pile in Unassigned.
				</p>
				{workload ? (
					branches.map((b) => (
						<label key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0", borderBottom: "1px solid var(--border-light)" }}>
							<span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
								{b.name}
								{!duty[b.id] && <span className="muted" style={{ fontWeight: 400 }}> — uncovered</span>}
							</span>
							<select
								className="cn-filter__select"
								value={picks[b.id] ?? dutyUserId(b.id)}
								onChange={(e) => setPicks((p) => ({ ...p, [b.id]: e.target.value }))}
							>
								<option value="">— nobody —</option>
								{workload.coordinators.map((c) => (
									<option key={c.opsUserId} value={c.opsUserId}>
										{c.name} · {c.activeCases}/{c.maxCapacity}
									</option>
								))}
								{duty[b.id] && !workload.coordinators.some((c) => c.email === duty[b.id]!.email) && (
									<option value={duty[b.id]!.email}>{duty[b.id]!.name} · on duty</option>
								)}
							</select>
						</label>
					))
				) : (
					<p className="muted" style={{ fontSize: "var(--text-xs)" }}>Loading coordinators…</p>
				)}
				{err && <p className="ops-modal__error" role="alert" style={{ marginTop: "0.6rem" }}>{err}</p>}
				<div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
					<button type="button" className="btn btn--primary btn--sm" disabled={busy || !workload} onClick={() => void apply()}>
						{busy ? "Applying…" : "Apply coverage"}
					</button>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheetOpen(false)}>Cancel</button>
				</div>
			</Sheet>
		</>
	);
}
