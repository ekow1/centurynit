import { useCallback, useEffect, useState } from "react";
import { ApiError, calendarApi, type CalendarStatus, type CalendarSubscription } from "century-nit-core/api";
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

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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

	return (
		<form className="avail__card" onSubmit={submit}>
			<div className="avail__card-head">
				<h3 className="avail__card-title">Working hours</h3>
				<span className="wh__duration">{timezone}</span>
			</div>
			<p className="ops-panel__muted">
				You can only be assigned a consultation inside these hours, when nothing
				already occupies the slot.
			</p>

			<div className="slotcfg__presets" style={{ marginTop: "1rem" }}>
				<span className="slotcfg__presets-label">Quick set</span>
				<button type="button" className="perm-quick-btn" onClick={() => setWorkingDays([1, 2, 3, 4, 5])}>
					Weekdays only
				</button>
				<button
					type="button"
					className="perm-quick-btn"
					onClick={() => setWorkingDays([1, 2, 3, 4, 5, 6])}
				>
					Include Saturday
				</button>
				<button type="button" className="perm-quick-btn" onClick={copyFirstWorkingDay}>
					Match first working day
				</button>
				<button type="button" className="perm-quick-btn" onClick={() => setWorkingDays([])}>
					Clear all
				</button>
			</div>

			<table className="wh-table">
				<thead>
					<tr>
						<th scope="col">Day</th>
						<th scope="col">Working</th>
						<th scope="col">Hours</th>
						<th scope="col">Total</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => {
						const bad = r.enabled && r.start >= r.end;
						return (
							<tr
								key={r.dayOfWeek}
								className={bad ? "wh-row--bad" : r.enabled ? undefined : "wh-row--off"}
							>
								<td className="wh__day" data-col="day">
									{DAY_NAMES[r.dayOfWeek]}
								</td>
								<td data-col="toggle">
									<label className="perm-switch">
										<input
											type="checkbox"
											checked={r.enabled}
											aria-label={`${DAY_NAMES[r.dayOfWeek]} is a working day`}
											onChange={(e) => update(r.dayOfWeek, { enabled: e.target.checked })}
										/>
										<span className="perm-switch__slider" />
									</label>
								</td>
								<td data-col="span">
									<span className="wh__span">
										<input
											type="time"
											className="slotcfg__time"
											value={r.start}
											disabled={!r.enabled}
											aria-label={`${DAY_NAMES[r.dayOfWeek]} start time`}
											onChange={(e) => update(r.dayOfWeek, { start: e.target.value })}
										/>
										<span className="wh__dash" aria-hidden="true">
											–
										</span>
										<input
											type="time"
											className="slotcfg__time"
											value={r.end}
											disabled={!r.enabled}
											aria-label={`${DAY_NAMES[r.dayOfWeek]} end time`}
											onChange={(e) => update(r.dayOfWeek, { end: e.target.value })}
										/>
									</span>
								</td>
								<td data-col="duration">
									{bad ? (
										<span className="wh__duration wh__duration--bad">
											must end after it starts
										</span>
									) : (
										<span className="wh__duration">
											{r.enabled ? formatSpan(r) : "Not working"}
										</span>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>

			<p className="ops-panel__muted" style={{ marginTop: "0.85rem" }}>
				{workingDays.length === 0
					? "No working days set — you cannot be assigned any consultation."
					: `${workingDays.length} working ${workingDays.length === 1 ? "day" : "days"} · ${Math.round(weeklyMinutes / 60)}h a week`}
			</p>

			{error && <p className="ops-modal__error">{error}</p>}
			{saved && <p className="ops-panel__ok">{saved}</p>}

			{dirty && (
				<div className="slotcfg__savebar">
					<p className="slotcfg__savebar-note">You have unsaved changes to your hours.</p>
					<span className="cal-actions">
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
						<button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
							{saving ? "Saving…" : "Save hours"}
						</button>
					</span>
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
function BranchSlotPreview({ slots }: { slots: CalendarStatus["branchSlots"] }) {
	if (!slots?.days) return null;

	// Monday first, matching the working hours editor directly above.
	const ordered = [1, 2, 3, 4, 5, 6, 0]
		.map((dow) => slots.days.find((d) => d.dayOfWeek === dow))
		.filter((d): d is NonNullable<typeof d> => Boolean(d));
	const open = ordered.filter((d) => d.enabled);
	const closed = ordered.filter((d) => !d.enabled);

	/*
	 * Almost every branch runs the same hours every open day, so spelling out
	 * seven near-identical rows buries the one line a consultant actually needs.
	 * The detail is still one click away for the days that differ.
	 */
	const uniformHours =
		open.length > 0 &&
		open.every(
			(d) =>
				d.openStart === open[0].openStart &&
				d.openEnd === open[0].openEnd &&
				d.slotsPerDay === open[0].slotsPerDay,
		);

	return (
		<div className="avail__card">
			<div className="avail__card-head">
				<h3 className="avail__card-title">Branch slots</h3>
			</div>

			{open.length === 0 ? (
				<p className="branch-slots__summary">
					The branch is currently closed for bookings on every day.
				</p>
			) : (
				<p className="branch-slots__summary">
					Open <strong>{open.map((d) => DAY_NAMES[d.dayOfWeek].slice(0, 3)).join(", ")}</strong>
					{uniformHours ? (
						<>
							{" "}
							<strong>
								{open[0].openStart}–{open[0].openEnd}
							</strong>{" "}
							with <strong>{open[0].slotsPerDay} slots</strong> a day.
						</>
					) : (
						<> with hours that vary by day.</>
					)}{" "}
					{closed.length > 0 && (
						<>Closed {closed.map((d) => DAY_NAMES[d.dayOfWeek]).join(" and ")}. </>
					)}
					Times are shown in {slots.timezone}.
				</p>
			)}

			<p className="ops-panel__muted">
				Managers set this template. Your working hours above decide which of these
				slots you can be assigned.
			</p>

			{open.length > 0 && (
				<details className="branch-slots__detail">
					<summary>View slot times</summary>
					<div style={{ marginTop: "0.5rem" }}>
						{open.map((day) => (
							<div key={day.dayOfWeek} className="branch-slots__day">
								<span className="branch-slots__day-name">{DAY_NAMES[day.dayOfWeek]}</span>
								<span className="slotcfg__times">
									{day.times.map((t) => (
										<span key={t} className="slotcfg__chip">
											{t}
										</span>
									))}
								</span>
							</div>
						))}
					</div>
				</details>
			)}
		</div>
	);
}

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

	return (
		<div className="page-content fade-in" aria-labelledby="calendar-heading">
			<header className="avail__head">
				<h1 id="calendar-heading" className="avail__title">
					My Availability
				</h1>
				<p className="avail__lead">
					When you can take consultations. Managers set which slots the branch offers;
					these hours decide which of those slots can be assigned to you.
				</p>
			</header>

			{error && <p className="ops-modal__error">{error}</p>}
			{!status && !error && <p className="ops-panel__muted">Loading…</p>}

			{status && (
				<>
					<div className="avail__stats">
						<div className="avail__stat">
							<span className="avail__stat-label">Bookable</span>
							<span className="avail__stat-value">
								<span
									className={`cal-dot ${workingDays > 0 ? "cal-dot--on" : "cal-dot--warn"}`}
									aria-hidden="true"
								/>
								{workingDays > 0 ? "Yes" : "No hours set"}
							</span>
						</div>
						<div className="avail__stat">
							<span className="avail__stat-label">Working days</span>
							<span className="avail__stat-value">{workingDays} / 7</span>
						</div>
						<div className="avail__stat">
							<span className="avail__stat-label">Hours a week</span>
							<span className="avail__stat-value">{weeklyHours}h</span>
						</div>
						<div className="avail__stat">
							<span className="avail__stat-label">Calendar sync</span>
							<span className="avail__stat-value">
								<span
									className={`cal-dot ${subscription?.url ? "cal-dot--on" : "cal-dot--off"}`}
									aria-hidden="true"
								/>
								{subscription?.url ? "Connected" : "Off"}
							</span>
						</div>
					</div>

					<div className="avail__layout">
						<div>
							<WorkingHoursEditor status={status} onSaved={load} />
						</div>
						<aside>
							<BranchSlotPreview slots={status.branchSlots} />
							<SyncToPersonalCalendar subscription={subscription} onChanged={load} />
						</aside>
					</div>
				</>
			)}

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
