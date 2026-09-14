import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, bookingsApi, calendarApi, type CalendarStatus, type CalendarSubscription } from "century-nit-core/api";
import type { Booking } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";
import { ConfirmDialog, Toast } from "./OpsDialogs";

/**
 * My Availability — personal working hours and external calendar sync.
 *
 * A staff member pastes their calendar's read-only secret iCal address (Google
 * "Secret address in iCal format", Outlook/Apple "publish calendar" .ics link).
 * The URL is stored encrypted on the server and never returned here — this page
 * only ever learns whether a feed is set up and when it last mirrored. A worker
 * pulls the busy windows into the availability check, so an external meeting
 * blocks the portal slot. Meeting links themselves are set per-booking.
 *
 * Branch-wide consultation slot times are configured separately by managers and
 * systems staff. Consultants see those slots read-only here so they can align
 * their own availability with the branch schedule.
 */

/** Monday first — the working week reads better than Sunday-first here. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

type DayRow = { dayOfWeek: number; enabled: boolean; start: string; end: string };

/** Every weekday, with the employee's saved window applied where one exists. */
function toRows(saved: CalendarStatus["workingHours"]): DayRow[] {
	const byDay = new Map(saved.map((h) => [h.dayOfWeek, h]));
	return WEEK_ORDER.map((dayOfWeek) => {
		const hit = byDay.get(dayOfWeek);
		return {
			dayOfWeek,
			enabled: Boolean(hit),
			start: hit?.start ?? "09:00",
			end: hit?.end ?? "17:00",
		};
	});
}

function minutesOf(value: string): number {
	const [h, m] = value.split(":").map(Number);
	return h * 60 + m;
}

/** "7h 30m" — the span a row actually covers, so the times mean something. */
function formatSpan(row: DayRow): string {
	const mins = minutesOf(row.end) - minutesOf(row.start);
	if (mins <= 0) return "—";
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function sameRows(a: DayRow[], b: DayRow[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((row, i) => {
		const other = b[i];
		return (
			row.dayOfWeek === other.dayOfWeek &&
			row.enabled === other.enabled &&
			row.start === other.start &&
			row.end === other.end
		);
	});
}

/**
 * Weekly hours editor. A day is non-working by being absent from the saved set,
 * so unticking it is how you say "I don't work Fridays". Narrowing hours never
 * touches existing bookings; the server reports how many now sit outside and
 * this says so.
 */
function WorkingHoursEditor({
	status,
	onSaved,
}: {
	status: CalendarStatus;
	onSaved: () => void;
}) {
	const baseline = toRows(status.workingHours);
	const [rows, setRows] = useState<DayRow[]>(baseline);
	const [savedRows, setSavedRows] = useState<DayRow[]>(baseline);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);

	const timezone =
		status.workingHours[0]?.timezone ??
		Intl.DateTimeFormat().resolvedOptions().timeZone ??
		"Africa/Accra";

	function update(dayOfWeek: number, patch: Partial<DayRow>) {
		setRows((prev) => prev.map((r) => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r)));
		setSaved(null);
	}

	/** Copy Monday's window onto every other working day. */
	function copyFirstWorkingDay() {
		const source = rows.find((r) => r.enabled);
		if (!source) return;
		setRows((prev) =>
			prev.map((r) =>
				r.dayOfWeek === source.dayOfWeek || !r.enabled
					? r
					: { ...r, start: source.start, end: source.end },
			),
		);
		setSaved(null);
	}

	function setWorkingDays(active: number[]) {
		setRows((prev) => prev.map((r) => ({ ...r, enabled: active.includes(r.dayOfWeek) })));
		setSaved(null);
	}

	const invalid = rows.filter((r) => r.enabled && r.start >= r.end);
	const dirty = !sameRows(rows, savedRows);
	const workingDays = rows.filter((r) => r.enabled);
	const weeklyMinutes = workingDays.reduce(
		(sum, r) => sum + Math.max(0, minutesOf(r.end) - minutesOf(r.start)),
		0,
	);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (invalid.length > 0) {
			setError("Each working day must start before it ends.");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const res = await calendarApi.updateWorkingHours({
				timezone,
				days: rows
					.filter((r) => r.enabled)
					.map((r) => ({ dayOfWeek: r.dayOfWeek, start: r.start, end: r.end })),
			});
			setSaved(
				res.conflictingBookings > 0
					? `Saved. ${res.conflictingBookings} existing appointment${
							res.conflictingBookings === 1 ? "" : "s"
						} now fall outside these hours — those are unchanged and still yours to attend.`
					: "Working hours saved.",
			);
			setSavedRows(rows.map((r) => ({ ...r })));
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save working hours.");
		} finally {
			setSaving(false);
		}
	}

	const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const branchDay = (dow: number) => status.branchSlots?.days.find((d) => d.dayOfWeek === dow) ?? null;
	// The bar is the branch's day: its window drawn light, mine in ink inside it.
	const bar = (row: DayRow) => {
		const b = branchDay(row.dayOfWeek);
		const bOpen = b && b.enabled && b.times.length > 0;
		const lo = Math.min(bOpen ? minutesOf(b.openStart) : 9 * 60, row.enabled ? minutesOf(row.start) : 24 * 60, 8 * 60);
		const hi = Math.max(bOpen ? minutesOf(b.openEnd) : 17 * 60, row.enabled ? minutesOf(row.end) : 0, 18 * 60);
		const pct = (m: number) => `${Math.round(((m - lo) / (hi - lo)) * 100)}%`;
		return (
			<div className="ops-avbar" aria-hidden>
				{bOpen && <div className="ops-avbar__branch" style={{ top: pct(minutesOf(b.openStart)), bottom: `calc(100% - ${pct(minutesOf(b.openEnd))})` }} />}
				{row.enabled && minutesOf(row.start) < minutesOf(row.end) && <div className="ops-avbar__mine" style={{ top: pct(minutesOf(row.start)), bottom: `calc(100% - ${pct(minutesOf(row.end))})` }} />}
				<span className="ops-avbar__t" style={{ top: 2 }}>
					{String(Math.floor(lo / 60)).padStart(2, "0")}
				</span>
				<span className="ops-avbar__t" style={{ bottom: 2 }}>
					{String(Math.floor(hi / 60)).padStart(2, "0")}
				</span>
			</div>
		);
	};

	return (
		<form onSubmit={submit}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
				<span className="eyebrow">Your week · ▮ your hours inside ▯ the branch's · {timezone}</span>
				<span className="cn-filter__label" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
					<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setWorkingDays([1, 2, 3, 4, 5])}>
						Mon–Fri
					</button>
					<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setWorkingDays([1, 2, 3, 4, 5, 6])}>
						Mon–Sat
					</button>
					<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={copyFirstWorkingDay}>
						same hours every day
					</button>
					<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setWorkingDays([])}>
						clear
					</button>
				</span>
			</div>
			<div className="ops-av">
				{rows.map((row) => {
					const b = branchDay(row.dayOfWeek);
					const bOpen = b && b.enabled && b.times.length > 0;
					const bad = row.enabled && row.start >= row.end;
					return (
						<div key={row.dayOfWeek} className={`ops-avday${row.enabled ? "" : " ops-avday--off"}${bad ? " ops-avday--bad" : ""}`}>
							<span className="ops-wkday__h">
								<span className="ops-wkday__n">{DAY_SHORT[row.dayOfWeek]}</span>
								<label className="ops-tog" title={row.enabled ? "Working — switch off" : "Off — switch on"}>
									<input type="checkbox" checked={row.enabled} onChange={(e) => update(row.dayOfWeek, { enabled: e.target.checked })} />
									<span className={`ops-tog__k${row.enabled ? " ops-tog__k--on" : ""}`} aria-hidden />
								</label>
							</span>
							{row.enabled ? (
								<span className="ops-avday__times">
									<input type="time" className="ops-avday__in" value={row.start} onChange={(e) => update(row.dayOfWeek, { start: e.target.value })} aria-label={`${DAY_SHORT[row.dayOfWeek]} start`} />
									<input type="time" className="ops-avday__in" value={row.end} onChange={(e) => update(row.dayOfWeek, { end: e.target.value })} aria-label={`${DAY_SHORT[row.dayOfWeek]} end`} />
								</span>
							) : (
								<span className="ops-wkday__hours">—</span>
							)}
							{bar(row)}
							<span className="ops-wkday__k">{bOpen ? `branch ${b.openStart}–${b.openEnd}` : b && !b.enabled ? "branch closed" : "branch —"}</span>
							{row.enabled && <span className="ops-wkday__k">{bad ? "ends before it starts" : formatSpan(row)}</span>}
						</div>
					);
				})}
			</div>
			<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>
				{workingDays.length === 0 ? "No working days set — you cannot be assigned any consultation." : `${workingDays.length} working ${workingDays.length === 1 ? "day" : "days"} · ${Math.round(weeklyMinutes / 60)} h a week. You can only be assigned a consultation inside these hours, when nothing already occupies the slot.`}
			</p>
			{error && <p className="ops-modal__error">{error}</p>}
			{saved && <p className="ops-panel__ok">{saved}</p>}
			{dirty && (
				<div className="cn-now__actions" style={{ marginTop: "0.5rem" }}>
					<button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
						{saving ? "Saving…" : "Save hours"}
					</button>
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						disabled={saving}
						onClick={() => {
							setRows(savedRows.map((r) => ({ ...r })));
							setError(null);
							setSaved(null);
						}}
					>
						Discard
					</button>
				</div>
			)}
		</form>
	);
}


/**
 * Branch slot template — read-only for consultants.
 *
 * Managers and systems staff control how many slots the branch offers per day
 * and the operating hours. This view lets every staff member see the resulting
 * times so they can align their own working hours.
 */

/**
 * Sync to your personal calendar — the company calendar as a one-way,
 * read-only iCal feed. The URL is a private credential: anyone who has it can
 * read your appointment times, so keep it to yourself. Regenerate it to
 * invalidate a leaked URL; revoke to turn it off entirely.
 */
function SyncToPersonalCalendar({
	subscription,
	onChanged,
}: {
	subscription: CalendarSubscription | null;
	onChanged: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [confirm, setConfirm] = useState<null | "regenerate" | "revoke">(null);

	const url = subscription?.url ?? null;

	function err(e: unknown) {
		return e instanceof ApiError && e.isForbidden
			? "Only staff can use a calendar subscription."
			: e instanceof Error
				? e.message
				: "Something went wrong.";
	}

	async function copy() {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	}

	async function create() {
		setBusy(true);
		setError(null);
		try {
			await calendarApi.createSubscription();
			onChanged();
		} catch (e) {
			setError(err(e));
		} finally {
			setBusy(false);
		}
	}

	async function runConfirm() {
		setBusy(true);
		setError(null);
		try {
			if (confirm === "regenerate") await calendarApi.regenerateSubscription();
			else if (confirm === "revoke") await calendarApi.revokeSubscription();
			setConfirm(null);
			onChanged();
		} catch (e) {
			setError(err(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="avail__card">
			<div className="avail__card-head">
				<h3 className="avail__card-title">Personal calendar sync</h3>
			</div>

			<p className="avail__sync-state">
				<span className={`cal-dot ${url ? "cal-dot--on" : "cal-dot--off"}`} aria-hidden="true" />
				{url ? "Subscription active" : "Not set up"}
			</p>

			<p className="ops-panel__muted">
				Subscribe Google, Apple or Outlook Calendar to this secret address and your
				consultations appear there automatically. One-way and read-only — editing it
				there never changes the company calendar.
			</p>

			{url ? (
				<>
					<div className="avail__url">
						<input
							type="url"
							value={url}
							readOnly
							aria-label="Calendar subscription URL"
							onFocus={(e) => e.currentTarget.select()}
						/>
						<button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
					<p className="ops-panel__muted cal-feed__warn">
						Anyone with this link can read your appointment times. Keep it private.
					</p>

					<details className="cal-feed__help">
						<summary>How to subscribe</summary>
						<ul className="cal-feed__steps">
							<li>
								<strong>Google Calendar:</strong> Settings → Add calendar → From URL → paste the
								link → Add calendar.
							</li>
							<li>
								<strong>Apple Calendar:</strong> File → New Calendar Subscription… → paste the
								link → Subscribe.
							</li>
							<li>
								<strong>Outlook:</strong> Add calendar → Subscribe from web → paste the link →
								Import.
							</li>
						</ul>
					</details>

					<div className="cal-actions">
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							disabled={busy}
							onClick={() => setConfirm("regenerate")}
						>
							Regenerate URL
						</button>
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							disabled={busy}
							onClick={() => setConfirm("revoke")}
						>
							Revoke
						</button>
					</div>
				</>
			) : (
				<div className="cal-actions">
					<button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={create}>
						{busy ? "Creating…" : "Create subscription URL"}
					</button>
				</div>
			)}

			{error && <p className="ops-modal__error">{error}</p>}

			<ConfirmDialog
				open={confirm === "regenerate"}
				title="Regenerate subscription URL?"
				message="Your current link stops working immediately, including any calendar already subscribed to it. You'll get a new link to subscribe with."
				danger
				onConfirm={() => runConfirm()}
				onCancel={() => setConfirm(null)}
			/>
			<ConfirmDialog
				open={confirm === "revoke"}
				title="Revoke subscription?"
				message="Your personal calendar stops receiving updates. You can create a new URL later."
				danger
				onConfirm={() => runConfirm()}
				onCancel={() => setConfirm(null)}
			/>
		</div>
	);
}



export function CalendarSettings() {
	const { opsUser } = useOpsAuth();
	const [status, setStatus] = useState<CalendarStatus | null>(null);
	const [subscription, setSubscription] = useState<CalendarSubscription | null>(null);
	const [error, setError] = useState<string | null>(null);

	const [toast, setToast] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);

	function _showToast(type: "error" | "success" | "info", message: string) {
		setToast({ type, message });
	}
	void _showToast;

	const load = useCallback(() => {
		calendarApi
			.status()
			.then((s) => {
				setStatus(s);
				setError(null);
			})
			.catch((err: unknown) => {
				setError(
					err instanceof ApiError && err.isForbidden
						? "Only staff can set up a calendar feed."
						: err instanceof Error
							? err.message
							: "Could not load calendar status.",
				);
			});
		calendarApi.getSubscription().then(setSubscription).catch(() => {});
	}, []);

	useEffect(load, [load]);

	// Summarised at the top so a consultant can confirm they are bookable
	// without reading the whole page.
	const workingDays = status?.workingHours.length ?? 0;
	const weeklyHours = status
		? Math.round(
				status.workingHours.reduce(
					(sum, h) => sum + Math.max(0, minutesOf(h.end) - minutesOf(h.start)),
					0,
				) / 60,
			)
		: 0;

	const [myBookings, setMyBookings] = useState<Booking[]>([]);
	useEffect(() => {
		if (!opsUser) return;
		bookingsApi
			.list({ employeeId: opsUser.opsUserId })
			.then((res) => {
				const from = new Date();
				from.setHours(0, 0, 0, 0);
				const to = new Date(from.getTime() + 7 * 86_400_000);
				setMyBookings(res.bookings.filter((b) => b.status !== "CANCELLED" && new Date(b.startsAt) >= from && new Date(b.startsAt) < to).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
			})
			.catch(() => setMyBookings([]));
	}, [opsUser]);
	const outsideHours = (b: Booking): string | null => {
		if (!status) return null;
		const d = new Date(b.startsAt);
		const h = status.workingHours.find((w) => w.dayOfWeek === d.getDay());
		if (!h) return "not a working day";
		const m = d.getHours() * 60 + d.getMinutes();
		if (m < minutesOf(h.start)) return `before your ${h.start} start`;
		if (m >= minutesOf(h.end)) return `after your ${h.end} end`;
		return null;
	};
	const hm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short" });
	const run = (() => {
		if (!status || status.workingHours.length === 0) return null;
		const sorted = [...status.workingHours].sort((a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7));
		const same = sorted.every((h) => h.start === sorted[0].start && h.end === sorted[0].end);
		const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		return { days: sorted.length === 1 ? names[sorted[0].dayOfWeek] : `${names[sorted[0].dayOfWeek]}–${names[sorted[sorted.length - 1].dayOfWeek]}`, hours: same ? `${sorted[0].start} – ${sorted[0].end}` : "varies" };
	})();

	return (
		<div className="page-content fade-in" aria-labelledby="calendar-heading">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 id="calendar-heading" className="page-title">
						My Availability
					</h1>
					<p className="lead mt-2">When you can take consultations, inside the hours the branch offers.</p>
				</div>
				<Link to="/appointments" className="btn btn--ghost btn--sm">
					Appointments →
				</Link>
			</div>

			{status && (
				<div className="dash-day" style={{ margin: "0 0 1rem" }}>
					{run ? (
						<span>
							<strong>{run.days}</strong> <span className="dash-day__date">{run.hours}</span>
						</span>
					) : (
						<span>
							<strong>no hours set</strong>
						</span>
					)}
					<span>
						<strong>{weeklyHours} h</strong> <span className="dash-day__date">a week</span>
					</span>
					<span>
						<strong>{workingDays > 0 ? "bookable" : "not bookable"}</strong>
					</span>
					<span>
						<strong>calendar</strong> <span className="dash-day__date">{subscription?.url ? "connected" : "off"}</span>
					</span>
					<span>
						<strong>{myBookings.length}</strong> <span className="dash-day__date">booking{myBookings.length === 1 ? "" : "s"} in the next 7 days</span>
					</span>
				</div>
			)}

			{error && <p className="ops-modal__error">{error}</p>}
			{!status && !error && <p className="ops-panel__muted">Loading…</p>}
			{status && (
				<>
					<WorkingHoursEditor status={status} onSaved={load} />
					<div className="dash-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "1rem" }}>
						<section className="dash-panel">
							<header className="dash-panel__head">
								<h2 className="dash-panel__title">Your bookings · next 7 days</h2>
								<Link to="/appointments" className="dash-link">
									Appointments →
								</Link>
							</header>
							{myBookings.length === 0 ? (
								<p className="dash-empty">Nothing booked with you in the next seven days.</p>
							) : (
								<div className="cn-detail__rows">
									{myBookings.map((b) => {
										const outside = outsideHours(b);
										return (
											<div key={b.id} className="cn-detail__row">
												<span>
													<span className="cn-now__time">
														{dayOf(b.startsAt)} {hm(b.startsAt)}
													</span>
													{b.clientName}
												</span>
												<span className="cn-detail__row-note">
													{b.serviceName} · {b.type === "online" ? "online" : "in person"}
													{outside ? (
														<>
															{" · "}
															<strong>{outside}</strong>
														</>
													) : null}
												</span>
											</div>
										);
									})}
								</div>
							)}
						</section>
						<SyncToPersonalCalendar subscription={subscription} onChanged={load} />
					</div>
				</>
			)}
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);

}
