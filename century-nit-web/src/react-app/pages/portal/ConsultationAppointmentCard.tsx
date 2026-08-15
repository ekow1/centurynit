import { useState, useSyncExternalStore } from "react";
import { useAppState } from "../../context/AppState";
import {
	CONSULTATION_DURATIONS,
	consultationTypes,
	getBranch,
	getConsultant,
} from "century-nit-core";

const MINUTE = 60_000;

/**
 * Current time, rounded to the minute, as a subscribed external store.
 *
 * Reading `Date.now()` during render would be impure and - more importantly -
 * would never re-evaluate, so a "Join meeting" button would stay disabled for
 * a user who already had the page open when their slot came round.
 */
function useNow() {
	return useSyncExternalStore(
		(onChange) => {
			const id = window.setInterval(onChange, 30_000);
			return () => window.clearInterval(id);
		},
		() => Math.floor(Date.now() / MINUTE) * MINUTE,
	);
}

/**
 * The appointment card for a booked consultation.
 *
 * Replaces the old flat six-field grid, which rendered "-" for every row an
 * online booking has no value for (there is no branch or physical location for
 * a video call) and never surfaced the meeting link that was already stored.
 *
 * Two principles:
 *  - Only show rows that apply to the booking's mode.
 *  - Never print a bare "-". Something not yet decided says so explicitly,
 *    so a pending state doesn't read as a broken one.
 */
export function ConsultationAppointmentCard() {
	const { booking } = useAppState();
	const [copied, setCopied] = useState(false);

	const isOnline = booking.consultationType === "online";
	// Every booking picks a branch, online included - it is the branch whose
	// consultant runs the session and whose local time the slot is in.
	const branch = getBranch(booking.branchId);
	const typeMeta = consultationTypes.find((t) => t.id === booking.consultationType);
	const consultant = getConsultant(booking.consultantId);

	const when = formatWhen(booking.date, booking.time);
	const start = toDate(booking.date, booking.time);
	const minutes = Number(booking.duration) || 45;
	// The duration the applicant actually chose in the wizard, not the
	// marketing range printed on the consultation-type card
	const durationLabel =
		CONSULTATION_DURATIONS.find((d) => d.id === booking.duration)?.label ?? `${minutes} min`;

	// A meeting is joinable from 15 minutes before it starts until an hour after
	const now = useNow();
	const joinable =
		start !== null &&
		now >= start.getTime() - 15 * MINUTE &&
		now <= start.getTime() + (minutes + 60) * MINUTE;

	async function copyLink() {
		if (!booking.meetingLink) return;
		try {
			await navigator.clipboard.writeText(booking.meetingLink);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			/* clipboard blocked - the link is visible on screen anyway */
		}
	}

	function addToCalendar() {
		if (!start) return;
		const end = new Date(start.getTime() + minutes * 60_000);
		const where = isOnline
			? (booking.meetingLink ?? "Online")
			: branch
				? `${branch.name}, ${branch.address}`
				: "Century NIT branch";

		const ics = [
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Century NIT//Consultation//EN",
			"BEGIN:VEVENT",
			`UID:${booking.confirmationId ?? "century-nit"}@centurynit.com`,
			`DTSTAMP:${icsDate(new Date())}`,
			`DTSTART:${icsDate(start)}`,
			`DTEND:${icsDate(end)}`,
			"SUMMARY:Century NIT consultation",
			`LOCATION:${escapeIcs(where)}`,
			`DESCRIPTION:${escapeIcs(
				`Reference ${booking.confirmationId ?? "-"}${
					booking.consultantName ? ` · Consultant: ${booking.consultantName}` : ""
				}`,
			)}`,
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");

		const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `century-nit-consultation.ics`;
		a.click();
		URL.revokeObjectURL(url);
	}

	return (
		<div className="appt card mt-3">
			{/* Consultant - the first thing an applicant looks for */}
			<div className="appt__person">
				{booking.consultantName ? (
					<>
						{consultant ? (
							<img className="appt__photo" src={consultant.image} alt="" loading="lazy" />
						) : (
							<span className="appt__avatar" aria-hidden>
								{booking.consultantName
									.split(" ")
									.map((n) => n[0])
									.slice(0, 2)
									.join("")}
							</span>
						)}
						<span className="appt__person-meta">
							<span className="appt__person-name">{booking.consultantName}</span>
							<span className="appt__person-role mono">
								{consultant?.title ?? "Your consultant"}
							</span>
							{consultant ? (
								<span className="appt__person-tags">
									{consultant.specialties.slice(0, 2).join(" · ")} · {consultant.experience}
								</span>
							) : null}
						</span>
					</>
				) : (
					<>
						<span className="appt__avatar appt__avatar--pending" aria-hidden>
							<span className="appt__spinner" />
						</span>
						<span className="appt__person-meta">
							<span className="appt__person-name">Consultant being assigned</span>
							<span className="appt__person-role mono">
								Your branch assigns one before the session
							</span>
						</span>
					</>
				)}
			</div>

			<div className="appt__body">
				{/* When */}
				<div className="appt__row">
					<span className="appt__label mono">When</span>
					{when ? (
						<span className="appt__value">
							{when}
							<span className="appt__note mono">
								{durationLabel}
								{branch ? " · branch local time" : ""}
							</span>
						</span>
					) : (
						<span className="appt__value appt__value--pending">
							Date &amp; time to be confirmed
						</span>
					)}
				</div>

				{/* Where - mode-dependent */}
				{isOnline ? (
					<>
						<div className="appt__row">
							<span className="appt__label mono">Where</span>
							<span className="appt__value">
								Online video call
								{booking.meetingLink ? (
									/* Not .mono - that class uppercases, and a mangled URL
									   is worse than no URL */
									<a
										className="appt__link"
										href={booking.meetingLink}
										target="_blank"
										rel="noreferrer"
									>
										{booking.meetingLink}
									</a>
								) : (
									<span className="appt__note">
										Link is sent once the branch confirms
									</span>
								)}
							</span>
						</div>
						{branch ? (
							<div className="appt__row">
								<span className="appt__label mono">Hosted by</span>
								<span className="appt__value">
									{branch.name}
									<span className="appt__note mono">{branch.hours}</span>
								</span>
							</div>
						) : null}
					</>
				) : (
					<>
						<div className="appt__row">
							<span className="appt__label mono">Where</span>
							{branch ? (
								<span className="appt__value">
									{branch.name}
									<span className="appt__note">{branch.address}</span>
									<span className="appt__note mono">{branch.hours}</span>
								</span>
							) : (
								<span className="appt__value appt__value--pending">
									Branch to be confirmed
								</span>
							)}
						</div>
						{branch ? (
							<div className="appt__row">
								<span className="appt__label mono">Phone</span>
								<span className="appt__value">
									<a className="appt__tel" href={`tel:${branch.phone.replace(/\s/g, "")}`}>
										{branch.phone}
									</a>
								</span>
							</div>
						) : null}
					</>
				)}

				<div className="appt__row">
					<span className="appt__label mono">Type</span>
					<span className="appt__value">{typeMeta?.name ?? "To be confirmed"}</span>
				</div>

				<div className="appt__row">
					<span className="appt__label mono">Reference</span>
					<span className="appt__value mono">{booking.confirmationId ?? "Pending"}</span>
				</div>
			</div>

			{/* Actions - the point of the card */}
			<div className="appt__actions">
				{isOnline && booking.meetingLink ? (
					<>
						<a
							className={`btn btn--primary${joinable ? "" : " btn--disabled"}`}
							href={booking.meetingLink}
							target="_blank"
							rel="noreferrer"
							aria-disabled={!joinable}
							onClick={(e) => {
								if (!joinable) e.preventDefault();
							}}
						>
							{joinable ? "Join meeting →" : "Join opens 15 min before"}
						</a>
						<button type="button" className="btn btn--secondary" onClick={copyLink}>
							{copied ? "Copied ✓" : "Copy link"}
						</button>
					</>
				) : null}

				{!isOnline && branch ? (
					<a
						className="btn btn--primary"
						href={branch.mapsUrl}
						target="_blank"
						rel="noreferrer"
					>
						Get directions →
					</a>
				) : null}

				{start ? (
					<button type="button" className="btn btn--ghost" onClick={addToCalendar}>
						Add to calendar
					</button>
				) : null}
			</div>
		</div>
	);
}

/** "2026-08-10" + "10:00" → "Mon 10 Aug 2026 · 10:00" */
function formatWhen(date: string, time: string) {
	if (!date) return null;
	const d = toDate(date, time);
	if (!d) return null;
	const day = d.toLocaleDateString(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
	});
	return time ? `${day} · ${time}` : day;
}

function toDate(date: string, time: string): Date | null {
	if (!date) return null;
	const [y, m, d] = date.split("-").map(Number);
	if (!y || !m || !d) return null;
	const [hh, mm] = (time || "09:00").split(":").map(Number);
	return new Date(y, m - 1, d, hh || 0, mm || 0);
}

function icsDate(d: Date) {
	return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function escapeIcs(s: string) {
	return s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}
