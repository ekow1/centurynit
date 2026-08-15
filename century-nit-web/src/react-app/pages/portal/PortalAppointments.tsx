import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, bookingsApi } from "century-nit-core/api";
import { branches, CONSULTATION_DURATIONS } from "century-nit-core/content";
import type { AvailabilitySlot, Booking } from "century-nit-shared";

/**
 * The applicant's real appointments (§1, §7, §8).
 *
 * Server-backed, unlike the rest of the portal: these bookings live in Postgres
 * because they have to be visible to staff, survive a browser, and be protected
 * from double-booking. The surrounding simulated journey is untouched.
 *
 * Availability shown here is advisory. The server re-checks on submit, so a slot
 * can still be refused — that outcome is handled rather than assumed away.
 */

const DEFAULT_DURATION = 45;

/** The next N days a client may pick. Today is never offered — too short notice. */
function upcomingDates(count = 21): { value: string; label: string }[] {
	const out: { value: string; label: string }[] = [];
	const cursor = new Date();
	cursor.setHours(0, 0, 0, 0);
	cursor.setDate(cursor.getDate() + 1);
	for (let i = 0; i < count; i++) {
		const y = cursor.getFullYear();
		const m = String(cursor.getMonth() + 1).padStart(2, "0");
		const d = String(cursor.getDate()).padStart(2, "0");
		// Sunday is closed everywhere, so do not offer it at all.
		if (cursor.getDay() !== 0) {
			out.push({
				value: `${y}-${m}-${d}`,
				label: cursor.toLocaleDateString(undefined, {
					weekday: "short",
					day: "numeric",
					month: "short",
				}),
			});
		}
		cursor.setDate(cursor.getDate() + 1);
	}
	return out;
}

function browserTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Accra";
	} catch {
		return "Africa/Accra";
	}
}

function formatWhen(booking: Booking): string {
	return new Date(booking.startsAt).toLocaleString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZone: booking.timezone,
	});
}

const STATUS_COPY: Record<string, { label: string; note: string }> = {
	UNASSIGNED: {
		label: "Awaiting assignment",
		// §1 — never imply someone has been assigned when nobody has.
		note: "A team member will be assigned to your appointment and you will receive confirmation once it is assigned.",
	},
	ASSIGNED: { label: "Confirmed", note: "Your consultant has been assigned." },
	CONFIRMED: { label: "Confirmed", note: "Your consultant has been assigned." },
	RESCHEDULED: { label: "Rescheduled", note: "Your appointment has been moved." },
	CANCELLED: { label: "Cancelled", note: "This appointment has been cancelled." },
	COMPLETED: { label: "Completed", note: "This appointment has taken place." },
	NO_SHOW: { label: "Missed", note: "This appointment was not attended." },
};

/* ── Slot picker, shared by booking and rescheduling ─────────────────────── */

function SlotPicker({
	branchId,
	date,
	onDateChange,
	time,
	onTimeChange,
	durationMinutes,
	excludeMessage,
}: {
	branchId: string;
	date: string;
	onDateChange: (d: string) => void;
	time: string;
	onTimeChange: (t: string) => void;
	durationMinutes: number;
	excludeMessage?: string;
}) {
	const dates = useMemo(() => upcomingDates(), []);

	/**
	 * Results are stored with the query that produced them.
	 *
	 * Deriving "loading" from a key mismatch rather than clearing state inside
	 * the effect avoids a synchronous setState there, and it also discards a slow
	 * response for a date the user has already moved away from — which would
	 * otherwise paint the wrong day's availability.
	 */
	const requestKey = `${branchId}|${date}|${durationMinutes}`;
	const [result, setResult] = useState<{ key: string; slots: AvailabilitySlot[] } | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!branchId || !date) return;
		let active = true;
		bookingsApi
			.availability({ branchId, date, durationMinutes })
			.then((res) => {
				if (!active) return;
				setResult({ key: requestKey, slots: res.slots });
				setError(null);
			})
			.catch((err: unknown) => {
				if (!active) return;
				setError(err instanceof Error ? err.message : "Could not load availability.");
			});
		return () => {
			active = false;
		};
	}, [branchId, date, durationMinutes, requestKey]);

	const slots = result?.key === requestKey ? result.slots : null;

	return (
		<>
			<div className="field">
				<label htmlFor="appt-date">Date</label>
				<select
					id="appt-date"
					className="select select--full-border"
					value={date}
					onChange={(e) => {
						onDateChange(e.target.value);
						onTimeChange("");
					}}
				>
					{dates.map((d) => (
						<option key={d.value} value={d.value}>
							{d.label}
						</option>
					))}
				</select>
			</div>

			<div className="field">
				<label>Time</label>
				{error && <p className="appt-error">{error}</p>}
				{!slots && !error && <p className="appt-muted">Checking availability…</p>}
				{slots && (
					<div className="appt-slots">
						{slots.map((s) => (
							<button
								key={s.time}
								type="button"
								className={`appt-slot ${time === s.time ? "appt-slot--on" : ""}`}
								disabled={!s.available}
								title={s.available ? undefined : s.reason === "booked" ? "Already booked" : "Not available"}
								onClick={() => onTimeChange(s.time)}
							>
								{s.time}
							</button>
						))}
					</div>
				)}
				{slots?.every((s) => !s.available) && (
					<p className="appt-muted">No times are free on this date. Please choose another.</p>
				)}
				{excludeMessage && <p className="appt-muted">{excludeMessage}</p>}
			</div>
		</>
	);
}

/* ── Booking form ────────────────────────────────────────────────────────── */

function BookForm({ onBooked }: { onBooked: (b: Booking) => void }) {
	const dates = useMemo(() => upcomingDates(), []);
	const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
	const [date, setDate] = useState(dates[0]?.value ?? "");
	const [time, setTime] = useState("");
	const [duration, setDuration] = useState(DEFAULT_DURATION);
	const [type, setType] = useState<"online" | "in_person">("online");
	const [notes, setNotes] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!time) {
			setError("Choose a time.");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			onBooked(
				await bookingsApi.create({
					serviceId: "consultation",
					branchId,
					type,
					date,
					time,
					durationMinutes: duration,
					timezone: browserTimeZone(),
					notes: notes.trim() || undefined,
				}),
			);
		} catch (err) {
			setError(
				err instanceof ApiError && err.isSlotTaken
					? "That time was just taken. Please pick another."
					: err instanceof ApiError && err.isUnauthenticated
						? "Please sign in again to book."
						: err instanceof Error
							? err.message
							: "Could not create the booking.",
			);
			// A taken slot must refresh the picker, not leave a stale selection.
			if (err instanceof ApiError && err.isSlotTaken) setTime("");
		} finally {
			setBusy(false);
		}
	}

	return (
		<form className="appt-form" onSubmit={submit}>
			<div className="form-grid form-grid--2">
				<div className="field">
					<label htmlFor="appt-branch">Branch</label>
					<select
						id="appt-branch"
						className="select select--full-border"
						value={branchId}
						onChange={(e) => {
							setBranchId(e.target.value);
							setTime("");
						}}
					>
						{branches.map((b) => (
							<option key={b.id} value={b.id}>
								{b.name}
							</option>
						))}
					</select>
				</div>

				<div className="field">
					<label htmlFor="appt-type">Format</label>
					<select
						id="appt-type"
						className="select select--full-border"
						value={type}
						onChange={(e) => setType(e.target.value as "online" | "in_person")}
					>
						<option value="online">Online (video call)</option>
						<option value="in_person">In person</option>
					</select>
				</div>

				<div className="field">
					<label htmlFor="appt-duration">Duration</label>
					<select
						id="appt-duration"
						className="select select--full-border"
						value={String(duration)}
						onChange={(e) => {
							setDuration(Number(e.target.value));
							setTime("");
						}}
					>
						{CONSULTATION_DURATIONS.map((d) => (
							<option key={d.id} value={d.id}>
								{d.label}
							</option>
						))}
					</select>
				</div>

				<SlotPicker
					branchId={branchId}
					date={date}
					onDateChange={setDate}
					time={time}
					onTimeChange={setTime}
					durationMinutes={duration}
				/>
			</div>

			<div className="field">
				<label htmlFor="appt-notes">Anything we should know? (optional)</label>
				<textarea
					id="appt-notes"
					className="input input--full-border"
					rows={3}
					maxLength={2000}
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
				/>
			</div>

			{error && <p className="appt-error">{error}</p>}

			<button type="submit" className="btn btn--primary" disabled={busy || !time}>
				{busy ? "Requesting…" : "Request appointment"}
			</button>
		</form>
	);
}

/* ── Reschedule ──────────────────────────────────────────────────────────── */

function RescheduleForm({
	booking,
	onDone,
	onCancel,
}: {
	booking: Booking;
	onDone: (b: Booking) => void;
	onCancel: () => void;
}) {
	const dates = useMemo(() => upcomingDates(), []);
	const [date, setDate] = useState(dates[0]?.value ?? "");
	const [time, setTime] = useState("");
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!time) {
			setError("Choose a new time.");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			onDone(
				await bookingsApi.reschedule(booking.id, {
					date,
					time,
					reason: reason.trim() || undefined,
				}),
			);
		} catch (err) {
			setError(
				err instanceof ApiError && err.isSlotTaken
					? "That time was just taken. Please pick another."
					: err instanceof Error
						? err.message
						: "Could not reschedule.",
			);
			if (err instanceof ApiError && err.isSlotTaken) setTime("");
		} finally {
			setBusy(false);
		}
	}

	return (
		<form className="appt-form appt-form--inline" onSubmit={submit}>
			<h4 className="appt-subhead">Choose a new time</h4>
			<div className="form-grid form-grid--2">
				<SlotPicker
					branchId={booking.branchId}
					date={date}
					onDateChange={setDate}
					time={time}
					onTimeChange={setTime}
					durationMinutes={booking.durationMinutes}
					excludeMessage={
						booking.employeeId
							? "Your consultant must also be free at the new time."
							: undefined
					}
				/>
			</div>
			<div className="field">
				<label htmlFor="appt-reason">Reason (optional)</label>
				<input
					id="appt-reason"
					className="input input--full-border"
					value={reason}
					maxLength={1000}
					onChange={(e) => setReason(e.target.value)}
				/>
			</div>
			{error && <p className="appt-error">{error}</p>}
			<div className="appt-actions">
				<button type="submit" className="btn btn--primary btn--sm" disabled={busy || !time}>
					{busy ? "Moving…" : "Confirm new time"}
				</button>
				<button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
					Keep current time
				</button>
			</div>
		</form>
	);
}

/* ── Card ────────────────────────────────────────────────────────────────── */

function BookingCard({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
	const [rescheduling, setRescheduling] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const copy = STATUS_COPY[booking.status] ?? { label: booking.status, note: "" };
	const isOver = booking.status === "CANCELLED" || booking.status === "COMPLETED";

	async function cancel() {
		if (!window.confirm("Cancel this appointment? The time will be released.")) return;
		setBusy(true);
		try {
			await bookingsApi.cancel(booking.id);
			onChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not cancel.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<article className={`appt-card ${isOver ? "appt-card--over" : ""}`}>
			<header className="appt-card__head">
				<div>
					<h3 className="appt-card__title">{booking.serviceName}</h3>
					<p className="appt-card__when">{formatWhen(booking)}</p>
				</div>
				<span className={`appt-status appt-status--${booking.status.toLowerCase()}`}>
					{copy.label}
				</span>
			</header>

			<dl className="appt-meta">
				<div>
					<dt>Reference</dt>
					<dd>{booking.reference}</dd>
				</div>
				<div>
					<dt>Duration</dt>
					<dd>{booking.durationMinutes} minutes</dd>
				</div>
				{booking.employeeName && (
					<div>
						<dt>With</dt>
						<dd>{booking.employeeName}</dd>
					</div>
				)}
			</dl>

			{copy.note && <p className="appt-note">{copy.note}</p>}

			{booking.meetingUrl && !isOver && (
				<a className="btn btn--primary btn--sm" href={booking.meetingUrl} target="_blank" rel="noreferrer">
					Join the meeting
				</a>
			)}

			{/* Assigned but the calendar has not caught up: say so plainly rather
			    than showing a Join button that goes nowhere. */}
			{!booking.meetingUrl && booking.type === "online" && !isOver && booking.employeeId && (
				<p className="appt-muted">
					Your meeting link is being prepared and will be emailed to you shortly.
				</p>
			)}

			{error && <p className="appt-error">{error}</p>}

			{!isOver && !rescheduling && (
				<div className="appt-actions">
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setRescheduling(true)}>
						Reschedule
					</button>
					<button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={cancel}>
						{busy ? "Cancelling…" : "Cancel"}
					</button>
				</div>
			)}

			{rescheduling && (
				<RescheduleForm
					booking={booking}
					onCancel={() => setRescheduling(false)}
					onDone={() => {
						setRescheduling(false);
						onChanged();
					}}
				/>
			)}
		</article>
	);
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function PortalAppointments() {
	const [bookings, setBookings] = useState<Booking[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [booking, setBooking] = useState(false);
	const [justBooked, setJustBooked] = useState<Booking | null>(null);

	const load = useCallback(() => {
		bookingsApi
			.list()
			.then((res) => {
				setBookings(res.bookings);
				setError(null);
			})
			.catch((err: unknown) => {
				setBookings([]);
				setError(
					err instanceof ApiError && err.isUnauthenticated
						? "Sign in to see your appointments."
						: err instanceof Error
							? err.message
							: "Could not load appointments.",
				);
			});
	}, []);

	useEffect(load, [load]);

	const upcoming = (bookings ?? []).filter(
		(b) => b.status !== "CANCELLED" && b.status !== "COMPLETED",
	);
	const past = (bookings ?? []).filter(
		(b) => b.status === "CANCELLED" || b.status === "COMPLETED",
	);

	return (
		<div className="appt-page">
			<header className="appt-page__head">
				<h1 className="page-title">Appointments</h1>
				{!booking && (
					<button type="button" className="btn btn--primary btn--sm" onClick={() => setBooking(true)}>
						Book an appointment
					</button>
				)}
			</header>

			{error && <p className="appt-error">{error}</p>}

			{justBooked && (
				<div className="appt-confirm" role="status">
					<h2 className="appt-confirm__title">Your appointment has been received</h2>
					<p>
						{formatWhen(justBooked)} · reference <strong>{justBooked.reference}</strong>
					</p>
					{/* §1 verbatim — do not tell the client an employee has been assigned. */}
					<p>
						A team member will be assigned to your appointment and you will receive
						confirmation once it is assigned.
					</p>
				</div>
			)}

			{booking && (
				<section className="appt-section">
					<h2 className="section-title">New appointment</h2>
					<BookForm
						onBooked={(b) => {
							setBooking(false);
							setJustBooked(b);
							load();
						}}
					/>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setBooking(false)}>
						Cancel
					</button>
				</section>
			)}

			{!bookings && !error && <p className="appt-muted">Loading…</p>}

			{bookings && upcoming.length === 0 && !booking && (
				<p className="appt-muted">You have no upcoming appointments.</p>
			)}

			{upcoming.map((b) => (
				<BookingCard key={b.id} booking={b} onChanged={load} />
			))}

			{past.length > 0 && (
				<section className="appt-section">
					<h2 className="section-title">Past and cancelled</h2>
					{past.map((b) => (
						<BookingCard key={b.id} booking={b} onChanged={load} />
					))}
				</section>
			)}
		</div>
	);
}
