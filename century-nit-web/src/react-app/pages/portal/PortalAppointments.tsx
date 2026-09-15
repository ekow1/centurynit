import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, bookingsApi } from "century-nit-core/api";
import { formatDualCurrency } from "century-nit-core";
import { useNotifier } from "../../components/notifier/Notifier";
import { Button } from "../../components/ui/Button";
import { FALLBACK_FEE_SCHEDULE, useAppState } from "../../context/AppState";
import { usdFromCents } from "century-nit-shared";
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
		out.push({
			value: `${y}-${m}-${d}`,
			label: cursor.toLocaleDateString(undefined, {
				weekday: "short",
				day: "numeric",
				month: "short",
			}),
		});
		cursor.setDate(cursor.getDate() + 1);
	}
	return out;
}

/** Service names arrive lowercase — display them like the other bold labels. */
function cap(s: string): string {
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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

/** Monochrome pill variant per status — ink marks the live ones. */
function statusPill(status: string): string {
	if (status === "CONFIRMED" || status === "ASSIGNED") return "portal-pill portal-pill--solid";
	if (status === "COMPLETED" || status === "CANCELLED" || status === "NO_SHOW") return "portal-pill portal-pill--done";
	if (status === "UNASSIGNED") return "portal-pill portal-pill--hollow";
	return "portal-pill";
}

/** A booking's effective display state — a COMPLETED in the future is still confirmed. */
function displayState(booking: Booking): { displayStatus: string; isOver: boolean } {
	const isFutureCompleted =
		booking.status === "COMPLETED" && new Date(booking.startsAt).getTime() > Date.now();
	const displayStatus = isFutureCompleted ? "CONFIRMED" : booking.status;
	const isOver = (displayStatus === "CANCELLED" || displayStatus === "COMPLETED") && !isFutureCompleted;
	return { displayStatus, isOver };
}

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
				await bookingsApi.rescheduleRequest(booking.id, {
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
					{busy ? "Sending Request…" : "Request Reschedule"}
				</button>
				<button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
					Keep current time
				</button>
			</div>
		</form>
	);
}

/* ── Cancel — shared by the hero and the rows ─────────────────────────────── */

function useCancelBooking(onChanged: () => void) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { confirm, toast } = useNotifier();
	const { fees } = useAppState();
	// Stated up front — a new booking means a new fee, so say the figure.
	const feeLabel = formatDualCurrency(
		usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents),
	);

	async function cancel(id: string) {
		const ok = await confirm({
			title: "Can't make it?",
			message:
				`Moving is free — use "Move" on this row and your slot holds until your consultant confirms. Cancelling releases the slot and ends the consultation; a new booking means a new fee — ${feeLabel}.`,
			confirmText: "Cancel & release the slot",
			tone: "danger",
		});
		if (!ok) return;
		setBusy(true);
		try {
			await bookingsApi.cancel(id);
			toast.success("Appointment cancelled.");
			onChanged();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Could not cancel.";
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	}

	return { cancel, busy, error };
}

/* ── Row — one line in the book, expands to the reschedule form ──────────── */

function BookingRow({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
	const [rescheduling, setRescheduling] = useState(false);
	const { cancel, busy, error } = useCancelBooking(onChanged);
	const { displayStatus, isOver } = displayState(booking);
	const copy = STATUS_COPY[displayStatus] ?? { label: displayStatus, note: "" };
	const d = new Date(booking.startsAt);

	return (
		<>
			<tr className={isOver ? "ptable__over" : undefined}>
				<td className="ptable__mark" style={{ fontWeight: 700 }}>
					{d.toLocaleDateString(undefined, { day: "numeric", month: "short" }).toUpperCase()}
					<span className="ptable__sub">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
				</td>
				<td>
					<strong>{cap(booking.serviceName)}</strong>
					<span className="ptable__sub">
						{d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: booking.timezone })}
						{" · "}{booking.durationMinutes} min · {booking.type === "online" ? "Online" : "In person"}
					</span>
					{booking.rescheduleRequestedAt && !isOver && (
						<div className="preq">
							<b>Reschedule requested</b>
							You asked to move to {new Date(booking.rescheduleRequestedStartsAt!).toLocaleString()} — waiting for approval.
						</div>
					)}
					{!booking.meetingUrl && booking.type === "online" && !isOver && booking.employeeId && (
						<p className="ptable__sub">Meeting link is being prepared and will be emailed to you.</p>
					)}
					{error && <p className="appt-error">{error}</p>}
				</td>
				<td className="mono" style={{ fontSize: "0.7rem" }}>{booking.employeeName?.toUpperCase() ?? "—"}</td>
				<td><span className={statusPill(displayStatus)}>{copy.label}</span></td>
				<td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
					{booking.meetingUrl && !isOver ? (
						<>
							<a className="jlink" href={booking.meetingUrl} target="_blank" rel="noreferrer">Join</a>
							{" · "}
						</>
					) : null}
					{!isOver && !booking.rescheduleRequestedAt ? (
						<>
							<button type="button" className="jlink" onClick={() => setRescheduling((v) => !v)}>
								{rescheduling ? "Close" : "Move"}
							</button>
							{" · "}
							<button type="button" className="jlink" disabled={busy} onClick={() => void cancel(booking.id)}>
								{busy ? "Cancelling…" : "Cancel"}
							</button>
						</>
					) : null}
				</td>
			</tr>
			{rescheduling ? (
				<tr>
					<td colSpan={5} style={{ background: "var(--muted)" }}>
						<RescheduleForm
							booking={booking}
							onCancel={() => setRescheduling(false)}
							onDone={() => {
								setRescheduling(false);
								onChanged();
							}}
						/>
					</td>
				</tr>
			) : null}
		</>
	);
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function PortalAppointments() {
	const [bookings, setBookings] = useState<Booking[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<"All" | "Upcoming" | "Past" | "Cancelled">("All");
	const [reschedulingNext, setReschedulingNext] = useState(false);

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

	const { cancel: cancelNext, busy: cancelBusy } = useCancelBooking(load);

	useEffect(load, [load]);

	const [now] = useState(() => Date.now());

	const buckets = useMemo(() => {
		const list = bookings ?? [];
		const isPast = (b: Booking) =>
			b.status === "COMPLETED" && new Date(b.startsAt).getTime() <= now;
		return {
			All: list,
			Upcoming: list.filter((b) => b.status !== "CANCELLED" && !isPast(b)),
			Past: list.filter(isPast),
			Cancelled: list.filter((b) => b.status === "CANCELLED"),
		};
	}, [bookings, now]);

	// The next upcoming appointment — lifted out of the list as the hero.
	const next = useMemo(() => {
		return [...buckets.Upcoming].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
	}, [buckets]);

	const filteredBookings = buckets[filter];
	const nextState = next ? displayState(next) : null;

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Appointments</p>
					<h1 className="page-title mt-1">Your calendar</h1>
					<p className="lead mt-2">
						Consultations and check-ins with your Century NIT team. Reschedules are requests — your consultant confirms them.
					</p>
				</div>
				<Button to="/portal/consultation" variant="primary">
					+ Book appointment
				</Button>
			</header>

			{error && <p className="appt-error">{error}</p>}
			{!bookings && !error && <p className="appt-muted">Loading…</p>}

			{/* Next up — lifted out of the book */}
			{next && nextState ? (
				<div className="pnext mt-4">
					<div className="pnext__date">
						<b>{new Date(next.startsAt).getDate()}</b>
						<span>{new Date(next.startsAt).toLocaleDateString(undefined, { month: "short" })}</span>
					</div>
					<div className="pnext__what">
						<p className="eyebrow">Next appointment</p>
						<p className="pnext__title">{cap(next.serviceName)}</p>
						<div className="pnext__facts">
							<span>
								<b>{new Date(next.startsAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: next.timezone })}</b>
								{" · "}{new Date(next.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: next.timezone })}
							</span>
							<span>{next.durationMinutes} min</span>
							<span>{next.type === "online" ? "Online" : "In person"}</span>
							{next.employeeName ? <span>with <b>{next.employeeName}</b></span> : null}
						</div>
						<p className="pnext__ref">REF {next.reference}</p>
						{next.rescheduleRequestedAt ? (
							<div className="preq">
								<b>Reschedule requested</b>
								You asked to move to {new Date(next.rescheduleRequestedStartsAt!).toLocaleString()} — waiting for your consultant to confirm. The original time holds until they do.
							</div>
						) : null}
						{!next.meetingUrl && next.type === "online" && next.employeeId ? (
							<p className="pnext__note">Your meeting link is being prepared and will be emailed to you.</p>
						) : null}
						{reschedulingNext ? (
							<div className="sharp-card mt-3">
								<RescheduleForm
									booking={next}
									onCancel={() => setReschedulingNext(false)}
									onDone={() => {
										setReschedulingNext(false);
										load();
									}}
								/>
							</div>
						) : null}
					</div>
					<div className="pnext__acts">
						{next.meetingUrl ? (
							<a className="btn btn--primary" href={next.meetingUrl} target="_blank" rel="noreferrer">
								Join the meeting
							</a>
						) : null}
						{!next.rescheduleRequestedAt ? (
							<button type="button" className="btn btn--ghost" onClick={() => setReschedulingNext((v) => !v)}>
								{reschedulingNext ? "Keep current time" : "Reschedule"}
							</button>
						) : null}
						<button type="button" className="btn btn--ghost" disabled={cancelBusy} onClick={() => void cancelNext(next.id)}>
							{cancelBusy ? "Cancelling…" : "Cancel"}
						</button>
					</div>
				</div>
			) : bookings && bookings.length === 0 && !error ? (
				<div className="sharp-card mt-4">
					<p className="eyebrow">Nothing scheduled</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>
						Book your consultation to start your journey — or a check-in once you're enrolled.
					</p>
				</div>
			) : null}

			{bookings && bookings.length > 0 ? (
				<div className="psplit mt-5">
					<div>
						{/* The book — every appointment, filtered by chips with counts */}
						<div className="psteps" role="tablist" aria-label="Appointment filters">
							{(["All", "Upcoming", "Past", "Cancelled"] as const).map((t) => (
								<button
									key={t}
									type="button"
									className={`portal-pill${filter === t ? " portal-pill--solid" : ""}`}
									style={{ cursor: "pointer" }}
									onClick={() => setFilter(t)}
								>
									{t} · {buckets[t].length}
								</button>
							))}
						</div>

						{filteredBookings.length === 0 ? (
							<p className="appt-muted mt-3">No appointments found for this filter.</p>
						) : (
							<table className="ptable mt-3">
								<thead>
									<tr>
										<th>Date</th>
										<th>Appointment</th>
										<th>With</th>
										<th>Status</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									{filteredBookings.map((b) => (
										<BookingRow key={b.id} booking={b} onChanged={load} />
									))}
								</tbody>
							</table>
						)}
					</div>

					{/* The rail — book, how it works, the office */}
					<div className="prail">
						<div className="sharp-card sharp-card--key sharp-card--invert">
							<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>Book a slot</p>
							<p style={{ fontSize: "var(--text-sm)", marginTop: "0.5rem", lineHeight: 1.6, color: "rgba(255,255,255,0.85)" }}>
								Check-ins are free once you're enrolled. Pick a day and a time — we confirm by email.
							</p>
							<Button to="/portal/consultation" variant="inverted" style={{ width: "100%", marginTop: "0.9rem", textAlign: "center" }}>
								Book appointment →
							</Button>
						</div>

						<div className="sharp-card">
							<p className="eyebrow">Good to know</p>
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem", lineHeight: 1.6 }}>
								<strong>Rescheduling.</strong> You request a new time; your consultant confirms it.
								The old slot holds until they do — nothing is lost if they can't take the new one.
							</p>
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.6rem", lineHeight: 1.6 }}>
								<strong>Cancelling.</strong> Cancelling a paid consultation cancels the consultation
								itself — the slot releases and a new booking means a new fee. Check-ins after
								enrolment cancel freely.
							</p>
						</div>

						<div className="sharp-card">
							<p className="eyebrow">The office</p>
							<div className="pkv"><span className="pkv__k">Accra HQ</span><span className="pkv__v">14 Independence Ave</span></div>
							<div className="pkv"><span className="pkv__k">Hours</span><span className="pkv__v">Mon–Fri · 09:00–17:00</span></div>
							<div className="pkv"><span className="pkv__k">Online</span><span className="pkv__v">Meet link emailed</span></div>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
