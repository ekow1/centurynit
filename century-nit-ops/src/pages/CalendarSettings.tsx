import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, calendarApi, type CalendarStatus } from "century-nit-core/api";
import { ConfirmDialog, Toast } from "./OpsDialogs";

/**
 * Employee Google Calendar connection (§4).
 *
 * The browser never sees a token. "Connect" asks the server for a consent URL
 * and hands the employee to Google; the authorisation code is exchanged
 * server-side and the tokens are stored encrypted. All this screen ever learns
 * is whether a calendar is connected.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Outcomes the OAuth callback redirects back with. */
const CALLBACK_MESSAGE: Record<string, { text: string; tone: "ok" | "warn" }> = {
	connected: { text: "Google Calendar connected.", tone: "ok" },
	denied: { text: "Connection cancelled — no access was granted.", tone: "warn" },
	expired: { text: "That connection link expired. Please try again.", tone: "warn" },
	failed: { text: "Google could not complete the connection. Please try again.", tone: "warn" },
	no_refresh_token: {
		text:
			"Google did not return long-term access. Remove Century NIT from your Google account permissions, then connect again.",
		tone: "warn",
	},
};

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
 * Weekly hours editor (§3).
 *
 * A day is non-working by being absent from the saved set, so unticking it is
 * how you say "I don't work Fridays" — there is no separate delete.
 *
 * Narrowing hours never touches existing bookings: an appointment already agreed
 * with a client is a commitment, and silently dropping it because someone edited
 * a preference would be worse than the inconsistency. The server reports how
 * many now sit outside the new hours and this says so.
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

	// Caught here so the invalid row is visible; the server rejects it too.
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

export function CalendarSettings() {
	const [status, setStatus] = useState<CalendarStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [params, setParams] = useSearchParams();

	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmTitle, setConfirmTitle] = useState("");
	const [confirmMessage, setConfirmMessage] = useState("");
	const [confirmDanger, setConfirmDanger] = useState(false);
	const confirmActionRef = useRef<() => void>(() => {});

	const [toast, setToast] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);

	function _showToast(type: "error" | "success" | "info", message: string) {
		setToast({ type, message });
	}
	void _showToast;

	function confirm(title: string, message: string, action: () => void, danger = false) {
		setConfirmTitle(title);
		setConfirmMessage(message);
		setConfirmDanger(danger);
		confirmActionRef.current = action;
		setConfirmOpen(true);
	}

	const callback = params.get("calendar");
	const banner = callback ? CALLBACK_MESSAGE[callback] : undefined;

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
						? "Only staff can connect a calendar."
						: err instanceof Error
							? err.message
							: "Could not load calendar status.",
				);
			});
	}, []);

	useEffect(load, [load]);

	// Clear the callback flag so a refresh does not replay the banner.
	useEffect(() => {
		if (!callback) return;
		const timer = window.setTimeout(() => {
			params.delete("calendar");
			setParams(params, { replace: true });
		}, 6000);
		return () => window.clearTimeout(timer);
	}, [callback, params, setParams]);

	async function connect() {
		setBusy(true);
		setError(null);
		try {
			const { url } = await calendarApi.connect();
			window.location.href = url; // hand off to Google
		} catch (err) {
			setError(
				err instanceof ApiError && err.code === "CALENDAR_NOT_CONFIGURED"
					? "Google Calendar is not configured on this server yet."
					: err instanceof Error
						? err.message
						: "Could not start the connection.",
			);
			setBusy(false);
		}
	}

	async function disconnect() {
		confirm(
			"Disconnect Google Calendar?",
			"New bookings will not create meeting links.",
			async () => {
				setBusy(true);
				try {
					await calendarApi.disconnect();
					load();
				} catch (err) {
					setError(err instanceof Error ? err.message : "Could not disconnect.");
				} finally {
					setBusy(false);
				}
			},
			true,
		);
	}

	return (
		<section className="ops-panel" aria-labelledby="calendar-heading">
			<header className="ops-panel__head">
				<h2 id="calendar-heading" className="section-title">
					Google Calendar
				</h2>
			</header>

			{banner && (
				<p className={banner.tone === "ok" ? "ops-panel__ok" : "ops-modal__error"}>{banner.text}</p>
			)}
			{error && <p className="ops-modal__error">{error}</p>}
			{!status && !error && <p className="ops-panel__muted">Loading…</p>}

			{status && !status.configured && (
				<p className="ops-panel__muted">
					Google Calendar is not configured on this server. Bookings still work — meeting
					links are created automatically once an administrator adds the credentials.
				</p>
			)}

			{status?.configured && (
				<>
					<p className="cal-state">
						<span
							className={`cal-dot ${
								status.connected ? "cal-dot--on" : status.needsReconnect ? "cal-dot--warn" : "cal-dot--off"
							}`}
							aria-hidden="true"
						/>
						{status.connected ? (
							<>
								Connected{status.googleAccountEmail ? ` as ${status.googleAccountEmail}` : ""}
							</>
						) : status.needsReconnect ? (
							<>Access expired — reconnect to keep creating meeting links</>
						) : (
							<>Not connected</>
						)}
					</p>

					<div className="cal-actions">
						{status.connected ? (
							<button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={disconnect}>
								Disconnect
							</button>
						) : (
							<button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={connect}>
								{busy ? "Opening Google…" : status.needsReconnect ? "Reconnect Google Calendar" : "Connect Google Calendar"}
							</button>
						)}
					</div>

					<p className="ops-modal__foot">
						Century NIT reads your calendar only to know when you are busy, and creates
						events for consultations assigned to you. Your credentials stay on the server.
					</p>
				</>
			)}

			{status && <WorkingHoursEditor status={status} onSaved={load} />}

			<ConfirmDialog
				open={confirmOpen}
				title={confirmTitle}
				message={confirmMessage}
				danger={confirmDanger}
				onConfirm={() => {
					setConfirmOpen(false);
					confirmActionRef.current();
				}}
				onCancel={() => setConfirmOpen(false)}
			/>

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</section>
	);
}
