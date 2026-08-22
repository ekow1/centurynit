import { useCallback, useEffect, useState } from "react";
import { ApiError, calendarApi, type CalendarStatus, type CalendarSubscription } from "century-nit-core/api";
import { ConfirmDialog, Toast } from "./OpsDialogs";

/**
 * Calendar availability — the iCal/ICS mirror that replaced Google Calendar.
 *
 * A staff member pastes their calendar's read-only secret iCal address (Google
 * "Secret address in iCal format", Outlook/Apple "publish calendar" .ics link).
 * The URL is stored encrypted on the server and never returned here — this page
 * only ever learns whether a feed is set up and when it last mirrored. A worker
 * pulls the busy windows into the availability check, so an external meeting
 * blocks the portal slot. Meeting links themselves are set per-booking.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type DayRow = { dayOfWeek: number; enabled: boolean; start: string; end: string };

/** Every weekday, with the employee's saved window applied where one exists. */
function toRows(saved: CalendarStatus["workingHours"]): DayRow[] {
	const byDay = new Map(saved.map((h) => [h.dayOfWeek, h]));
	// Monday first — the working week reads better than Sunday-first here.
	return [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => {
		const hit = byDay.get(dayOfWeek);
		return {
			dayOfWeek,
			enabled: Boolean(hit),
			start: hit?.start ?? "09:00",
			end: hit?.end ?? "17:00",
		};
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
	const [rows, setRows] = useState<DayRow[]>(() => toRows(status.workingHours));
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

	const invalid = rows.filter((r) => r.enabled && r.start >= r.end);

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
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save working hours.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<form className="cal-hours" onSubmit={submit}>
			<h3 className="cal-hours__title">Working hours</h3>
			<p className="ops-panel__muted">
				Times are in {timezone}. You can only be assigned a consultation inside these
				hours, when nothing already occupies the slot.
			</p>

			<ul className="cal-hours__list">
				{rows.map((r) => (
					<li key={r.dayOfWeek} className="cal-hours__edit">
						<label className="cal-hours__day">
							<input
								type="checkbox"
								checked={r.enabled}
								onChange={(e) => update(r.dayOfWeek, { enabled: e.target.checked })}
							/>
							<span>{DAY_NAMES[r.dayOfWeek]}</span>
						</label>
						<div className="cal-hours__inputs">
							<input
								type="time"
								className="input input--full-border"
								value={r.start}
								disabled={!r.enabled}
								aria-label={`${DAY_NAMES[r.dayOfWeek]} start time`}
								onChange={(e) => update(r.dayOfWeek, { start: e.target.value })}
							/>
							<span aria-hidden="true">–</span>
							<input
								type="time"
								className="input input--full-border"
								value={r.end}
								disabled={!r.enabled}
								aria-label={`${DAY_NAMES[r.dayOfWeek]} end time`}
								onChange={(e) => update(r.dayOfWeek, { end: e.target.value })}
							/>
						</div>
						{r.enabled && r.start >= r.end && (
							<span className="cal-hours__invalid">must end after it starts</span>
						)}
					</li>
				))}
			</ul>

			{error && <p className="ops-modal__error">{error}</p>}
			{saved && <p className="ops-panel__ok">{saved}</p>}

			<div className="cal-actions">
				<button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
					{saving ? "Saving…" : "Save working hours"}
				</button>
				<button
					type="button"
					className="btn btn--ghost btn--sm"
					disabled={saving}
					onClick={() => {
						setRows(toRows(status.workingHours));
						setError(null);
						setSaved(null);
					}}
				>
					Reset
				</button>
			</div>
		</form>
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
		<div className="cal-feed cal-subscription">
			<h3 className="cal-hours__title">Sync to your personal calendar</h3>
			<p className="ops-panel__muted">
				Subscribe Google Calendar, Apple Calendar or Outlook to this secret address and your
				Century NIT consultations appear there automatically — and stay in sync when bookings
				change or are cancelled. It is a one-way, read-only mirror: editing it in your
				personal calendar never changes the company calendar.
			</p>

			{url ? (
				<>
					<div className="cal-feed__copy">
						<input
							type="url"
							className="input input--full-border"
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

					<details className="cal-subscription__help">
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

	return (
		<section className="ops-panel" aria-labelledby="calendar-heading">
			<header className="ops-panel__head">
				<h2 id="calendar-heading" className="section-title">
					Calendar availability
				</h2>
			</header>

			{error && <p className="ops-modal__error">{error}</p>}
			{!status && !error && <p className="ops-panel__muted">Loading…</p>}

			
			{status && <SyncToPersonalCalendar subscription={subscription} onChanged={load} />}
			{status && <WorkingHoursEditor status={status} onSaved={load} />}

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</section>
	);
}
