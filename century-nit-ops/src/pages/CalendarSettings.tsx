import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, calendarApi, type CalendarStatus } from "century-nit-core/api";
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

function formatSynced(iso: string | null): string {
	if (!iso) return "never";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "never";
	return d.toLocaleString();
}

/**
 * The outbound half of the mirror — a read-only ICS URL that publishes this
 * consultant's own Century NIT consultations, so their personal calendar shows
 * their bookings and they don't get double-booked on their side. The token in
 * the URL is the only credential, so keep it private.
 */
function OutboundFeed({ url }: { url: string }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div className="cal-feed__outbound">
			<h3 className="cal-hours__title">Your bookings on your calendar</h3>
			<p className="ops-panel__muted">
				Subscribe your personal calendar to this secret address to see your Century NIT
				consultations there — Google/Outlook/Apple all support “add calendar by URL”.
			</p>
			<div className="cal-feed__copy">
				<input
					type="url"
					className="input input--full-border"
					value={url}
					readOnly
					aria-label="Outbound ICS subscription URL"
					onFocus={(e) => e.currentTarget.select()}
				/>
				<button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<p className="ops-panel__muted cal-feed__warn">
				Anyone with this link can read your appointment times. Keep it private.
			</p>
		</div>
	);
}

function FeedSection({
	status,
	onSaved,
}: {
	status: CalendarStatus;
	onSaved: () => void;
}) {
	const [url, setUrl] = useState("");
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [ok, setOk] = useState<string | null>(null);

	const [confirmOpen, setConfirmOpen] = useState(false);
	const confirmActionRef = useRef<() => void>(() => {});

	async function save(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = url.trim();
		if (!trimmed) {
			setError("Paste your calendar's secret iCal address.");
			return;
		}
		if (!/^https:\/\/|^webcal:\/\//i.test(trimmed)) {
			setError("The link must start with https:// or webcal://");
			return;
		}
		setBusy(true);
		setError(null);
		setOk(null);
		try {
			await calendarApi.saveFeed({ icsUrl: trimmed, label: label.trim() || undefined });
			setUrl("");
			setLabel("");
			setOk("Saved — mirroring your calendar now.");
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save the feed.");
		} finally {
			setBusy(false);
		}
	}

	async function syncNow() {
		setBusy(true);
		setError(null);
		try {
			await calendarApi.syncNow();
			setOk("Syncing — refresh in a moment to see updated busy times.");
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not sync.");
		} finally {
			setBusy(false);
		}
	}

	function remove() {
		setConfirmOpen(true);
		confirmActionRef.current = async () => {
			setBusy(true);
			try {
				await calendarApi.removeFeed();
				onSaved();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not remove the feed.");
			} finally {
				setBusy(false);
			}
		};
	}

	return (
		<div className="cal-feed">
			{status.hasFeed ? (
				<>
					<p className="cal-state">
						<span className="cal-dot cal-dot--on" aria-hidden="true" />
						{status.label ? `Mirroring “${status.label}”` : "Calendar feed connected"}
						{status.busyBlocksCount > 0
							? ` · ${status.busyBlocksCount} busy time${status.busyBlocksCount === 1 ? "" : "s"} mirrored`
							: ""}
					</p>
					<p className="ops-panel__muted">
						Last synced {formatSynced(status.lastSyncedAt)}.
						{status.lastError ? ` Last error: ${status.lastError}` : ""}
					</p>
					<div className="cal-actions">
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							disabled={busy}
							onClick={syncNow}
						>
							Sync now
						</button>
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							disabled={busy}
							onClick={remove}
						>
							Remove feed
						</button>
					</div>

				<form className="cal-feed__replace" onSubmit={save}>
					<label className="ops-panel__muted">Replace with a different calendar address</label>
					<input
						type="url"
						className="input input--full-border"
						placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
					/>
					<button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
						{busy ? "Saving…" : "Replace feed"}
					</button>
				</form>

				{status.outboundUrl && (
					<OutboundFeed url={status.outboundUrl} />
				)}
				</>
			) : (
				<form className="cal-feed__add" onSubmit={save}>
					<p className="ops-panel__muted">
						Paste your calendar's read-only secret iCal address so your external meetings
						block the slots applicants can book. Works with Google, Outlook and Apple — no
						account connection needed.
					</p>
					<ul className="cal-feed__steps">
						<li><strong>Google:</strong> Calendar settings → Integrate calendar → “Secret address in iCal format”</li>
						<li><strong>Outlook/Office 365:</strong> Share → Publish calendar → .ics link</li>
						<li><strong>Apple:</strong> Share → public calendar URL</li>
					</ul>
					<input
						type="url"
						className="input input--full-border"
						placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						aria-label="Secret iCal address"
					/>
					<input
						type="text"
						className="input input--full-border"
						placeholder="Label (optional, e.g. Work calendar)"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						aria-label="Label"
					/>
					<button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
						{busy ? "Saving…" : "Connect calendar"}
					</button>
				</form>
			)}

			{error && <p className="ops-modal__error">{error}</p>}
			{ok && <p className="ops-panel__ok">{ok}</p>}

			<ConfirmDialog
				open={confirmOpen}
				title="Remove calendar feed?"
				message="Your external meetings will no longer block booking slots. This cannot be undone."
				danger
				onConfirm={() => {
					setConfirmOpen(false);
					confirmActionRef.current();
				}}
				onCancel={() => setConfirmOpen(false)}
			/>
		</div>
	);
}

export function CalendarSettings() {
	const [status, setStatus] = useState<CalendarStatus | null>(null);
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

			{status && <FeedSection status={status} onSaved={load} />}
			{status && <WorkingHoursEditor status={status} onSaved={load} />}

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</section>
	);
}
