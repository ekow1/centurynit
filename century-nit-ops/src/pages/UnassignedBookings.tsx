import { useCallback, useEffect, useState } from "react";
import { ApiError, bookingsApi } from "century-nit-core/api";
import type { AssignableEmployee, Booking } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";

/**
 * The manager's triage queue (§2).
 *
 * Bookings arrive UNASSIGNED — clients book, nobody is allocated automatically
 * and there is no round-robin. A manager or coordinator picks the person, and
 * assigning is what triggers the calendar event and the Meet link.
 *
 * This reads the real API rather than the ops localStorage store: these records
 * live in Postgres, and the availability shown has to be the server's answer,
 * not a browser's guess.
 */

function formatWhen(booking: Booking): { date: string; time: string } {
	const at = new Date(booking.startsAt);
	return {
		date: at.toLocaleDateString(undefined, {
			weekday: "long",
			day: "numeric",
			month: "long",
			year: "numeric",
			timeZone: booking.timezone,
		}),
		time: at.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
			timeZone: booking.timezone,
		}),
	};
}

/** Why an employee cannot take this slot, in words a manager can act on. */
const REASON_LABEL: Record<string, string> = {
	booked: "Busy — another appointment",
	conflict: "Busy — calendar event",
	"outside-hours": "Outside working hours",
	"no-working-hours": "Not working that day",
	past: "Slot is in the past",
};

function AssignDialog({
	booking,
	onClose,
	onAssigned,
}: {
	booking: Booking;
	onClose: () => void;
	onAssigned: (updated: Booking) => void;
}) {
	const [employees, setEmployees] = useState<AssignableEmployee[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [assigning, setAssigning] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		bookingsApi
			.assignableEmployees({ bookingId: booking.id })
			.then((list) => active && setEmployees(list))
			.catch((err) => active && setError(err.message));
		return () => {
			active = false;
		};
	}, [booking.id]);

	async function assign(employee: AssignableEmployee) {
		setAssigning(employee.id);
		setError(null);
		try {
			onAssigned(await bookingsApi.assign(booking.id, employee.id));
		} catch (err) {
			// The server re-checks availability, so this can fail even though the
			// list said "available" — someone else may have just taken the slot.
			setError(
				err instanceof ApiError
					? err.message
					: "Could not assign. Please try again.",
			);
			setAssigning(null);
		}
	}

	const when = formatWhen(booking);

	return (
		<div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Assign employee">
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">Assign employee</h2>
						<p className="ops-modal__sub">
							{booking.clientName} · {booking.serviceName} · {when.date} at {when.time}
						</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
						Close
					</button>
				</header>

				{error && <p className="ops-modal__error">{error}</p>}

				{!employees && <p className="ops-modal__muted">Checking availability…</p>}

				{employees && employees.length === 0 && (
					<p className="ops-modal__muted">
						No employees are configured for this branch.
					</p>
				)}

				{employees && employees.length > 0 && (
					<ul className="assign-list">
						{employees.map((e) => (
							<li
								key={e.id}
								className={`assign-list__row ${e.available ? "" : "assign-list__row--busy"}`}
							>
								<span className="assign-list__mark" aria-hidden="true">
									{e.available ? "✓" : "✕"}
								</span>
								<span className="assign-list__who">
									<strong>{e.name}</strong>
									<span className="assign-list__meta">
										{e.role}
										{e.branch ? ` · ${e.branch}` : ""}
										{!e.calendarConnected && " · calendar not connected"}
									</span>
								</span>
								<span className="assign-list__status">
									{e.available ? (
										<button
											type="button"
											className="btn btn--primary btn--sm"
											disabled={assigning !== null}
											onClick={() => assign(e)}
										>
											{assigning === e.id ? "Assigning…" : "Assign"}
										</button>
									) : (
										(e.reason && REASON_LABEL[e.reason]) || "Unavailable"
									)}
								</span>
							</li>
						))}
					</ul>
				)}

				<p className="ops-modal__foot">
					Assigning creates the calendar event and generates the meeting link, then
					notifies the client and the employee. Staff who haven't connected Google
					Calendar get a temporary fallback meeting link — it's replaced with a Google
					Meet link automatically once they connect.
				</p>
			</div>
		</div>
	);
}

export function UnassignedBookings() {
	const { canAssignWork } = useOpsAuth();
	const [bookings, setBookings] = useState<Booking[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<Booking | null>(null);
	const [justAssigned, setJustAssigned] = useState<Booking | null>(null);

	const load = useCallback(() => {
		bookingsApi
			.list({ status: "UNASSIGNED" })
			.then((res) => {
				setBookings(res.bookings);
				setError(null);
			})
			.catch((err: unknown) => {
				setBookings([]);
				setError(
					err instanceof ApiError && err.isUnauthenticated
						? "Sign in to view bookings."
						: err instanceof Error
							? err.message
							: "Could not load bookings.",
				);
			});
	}, []);

	useEffect(load, [load]);

	if (!canAssignWork) return null; // consultants do not triage

	return (
		<section className="ops-panel" aria-labelledby="unassigned-heading">
			<header className="ops-panel__head">
				<h2 id="unassigned-heading" className="section-title">
					Unassigned bookings
					{bookings && bookings.length > 0 && (
						<span className="ops-pill">{bookings.length}</span>
					)}
				</h2>
				<button type="button" className="btn btn--ghost btn--sm" onClick={load}>
					Refresh
				</button>
			</header>

			{error && <p className="ops-modal__error">{error}</p>}

			{justAssigned && (
				<p className="ops-panel__ok">
					{justAssigned.clientName} assigned to {justAssigned.employeeName}.
					{justAssigned.meetingUrl && justAssigned.calendarSyncStatus === "SYNCED"
						? " Meeting link created and sent."
						: justAssigned.meetingUrl && justAssigned.calendarSyncStatus === "PENDING"
							? " A temporary meeting link was created. It will be replaced with a Google Meet link once the employee connects their calendar."
							: justAssigned.calendarSyncStatus === "FAILED"
								? " The calendar could not be reached — the booking is saved and the link will be created automatically on retry."
								: ""}
				</p>
			)}

			{!bookings && <p className="ops-panel__muted">Loading…</p>}

			{bookings && bookings.length === 0 && !error && (
				<p className="ops-panel__muted">Nothing waiting to be assigned.</p>
			)}

			{bookings && bookings.length > 0 && (
				<table className="ops-table">
					<thead>
						<tr>
							<th>Client</th>
							<th>Service</th>
							<th>Date</th>
							<th>Time</th>
							<th>Duration</th>
							<th>Status</th>
							<th>Created</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{bookings.map((b) => {
							const when = formatWhen(b);
							return (
								<tr key={b.id}>
									<td>
										<strong>{b.clientName}</strong>
										<div className="ops-table__sub">{b.clientEmail}</div>
									</td>
									<td>{b.serviceName}</td>
									<td>{when.date}</td>
									<td>{when.time}</td>
									<td>{b.durationMinutes} minutes</td>
									<td>
										<span className="ops-status ops-status--unassigned">{b.status}</span>
									</td>
									<td>{new Date(b.createdAt).toLocaleDateString()}</td>
									<td>
										<button
											type="button"
											className="btn btn--primary btn--sm"
											onClick={() => setSelected(b)}
										>
											Assign employee
										</button>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}

			{selected && (
				<AssignDialog
					booking={selected}
					onClose={() => setSelected(null)}
					onAssigned={(updated) => {
						setSelected(null);
						setJustAssigned(updated);
						load();
					}}
				/>
			)}
		</section>
	);
}
