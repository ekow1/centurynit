import { useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../../context/AppState";
import { ConsultationCall, MeetingEndedModal, MeetingWindowModal, type MeetingEndedInfo, type MeetingWindowInfo } from "../../components/ConsultationCall";
import { ApiError, bookingsApi } from "century-nit-core/api";
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
	const { booking, updateBooking } = useAppState();
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

	// A meeting is joinable from 15 minutes before it starts until an hour after (or if start is unparsed)
	const now = useNow();
	const joinable =
		start === null || (
			now >= start.getTime() - 15 * MINUTE &&
			now <= start.getTime() + (minutes + 60) * MINUTE
		);

	const [joining, setJoining] = useState(false);
	const [joinError, setJoinError] = useState<string | null>(null);
	const [notOpen, setNotOpen] = useState<MeetingWindowInfo | null>(null);
	const [ended, setEnded] = useState<MeetingEndedInfo | null>(null);
	const [call, setCall] = useState<{ url: string; token: string } | null>(null);
	const nav = useNavigate();
	const [withdrawing, setWithdrawing] = useState(false);

	/**
	 * The one door in. Token'd providers (Daily, LiveKit) need a per-person
	 * credential. The join endpoint mints it; other providers return the
	 * stored link untouched. LiveKit hands back {ws url, token} and the call
	 * happens in-app; everything else opens externally. Copy takes the same
	 * path so a copied link actually works on another device.
	 */
	type JoinResult = { url: string; token?: string; provider: string };

	async function joinTicket(): Promise<JoinResult | null> {
		if (!booking.bookingId) {
			const link = booking.meetingLink ?? "";
			// Token'd rooms have no shareable URL. Without a booking to mint
			// through, opening one is a dead end (blank page / "not available").
			if (link.startsWith("livekit:") || link.includes("daily.co")) return null;
			return link ? { url: link, provider: "manual" } : null;
		}
		return bookingsApi.joinMeeting(booking.bookingId);
	}

	async function joinMeeting() {
		setJoining(true);
		setJoinError(null);
		setNotOpen(null);
		setEnded(null);
		try {
			const res = await joinTicket();
			if (res?.provider === "livekit" && res.token) {
				setCall({ url: res.url, token: res.token });
			} else if (res?.url && /^https?:/i.test(res.url)) {
				window.open(res.url, "_blank", "noopener,noreferrer");
			} else {
				setJoinError("No usable meeting link on this booking yet");
			}
		} catch (err) {
			if (
				err instanceof ApiError && err.code === "MEETING_NOT_OPEN" &&
				typeof err.details === "object" && err.details !== null && "opensAt" in err.details
			) {
				setNotOpen({
					...(err.details as Omit<MeetingWindowInfo, "title">),
					title: `Consultation · ${booking.confirmationId ?? ""}`,
				});
			} else if (
				err instanceof ApiError && err.code === "MEETING_ENDED" &&
				typeof err.details === "object" && err.details !== null && "endsAt" in err.details
			) {
				setEnded({
					...(err.details as Omit<MeetingEndedInfo, "title">),
					title: `Consultation · ${booking.confirmationId ?? ""}`,
				});
			} else {
				setJoinError(err instanceof Error ? err.message : "Could not join the meeting");
			}
		} finally {
			setJoining(false);
		}
	}

	async function withdrawReschedule() {
		if (!booking.bookingId) return;
		setWithdrawing(true);
		try {
			await bookingsApi.withdrawRescheduleRequest(booking.bookingId);
			updateBooking({
				rescheduleRequestedAt: null,
				rescheduleRequestedStartsAt: null,
				rescheduleRequestReason: null,
			});
		} catch (err) {
			setJoinError(err instanceof Error ? err.message : "Could not withdraw the request");
		} finally {
			setWithdrawing(false);
		}
	}

	async function copyLink() {
		if (!booking.meetingLink) return;
		try {
			const res = await joinTicket();
			const url = res?.provider === "livekit" ? null : (res?.url ?? booking.meetingLink);
			if (!url) return; // a livekit join can't travel as a link. It needs the in-app call
			await navigator.clipboard.writeText(url);
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
									booking.meetingLink.startsWith("livekit:") || booking.meetingLink.includes("daily.co") ? (
										/* Token'd rooms have no shareable URL. Join mints
										   a per-person credential. Never render the raw value. */
										<span className="appt__note">
											Private room. Use Join above when it opens
										</span>
									) : (
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
									)
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

			{/* Pending reschedule. The held slot stays live until ops decides,
			    so it sits between the facts and the actions, not in place of them */}
			{booking.rescheduleRequestedAt && booking.rescheduleRequestedStartsAt ? (
				<div
					style={{
						border: "1.5px dashed var(--ink, #000)",
						background: "var(--muted-bg, #f5f5f5)",
						padding: "0.6rem 0.8rem",
						fontSize: "0.78rem",
						lineHeight: 1.5,
						margin: "0 1.25rem 0.9rem",
					}}
				>
					<span className="mono" style={{ fontSize: "0.62rem", letterSpacing: "0.12em", textTransform: "uppercase", display: "block", marginBottom: "0.15rem" }}>
						Reschedule requested. Awaiting your consultant
					</span>
					You asked to move to{" "}
					<b>
						{new Date(booking.rescheduleRequestedStartsAt).toLocaleString(undefined, {
							weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
						})}
					</b>
					. The slot above holds until they confirm. The join details stay valid for it.
					{booking.rescheduleRequestReason ? (
						<span className="muted"> Reason: “{booking.rescheduleRequestReason}”</span>
					) : null}
					{booking.bookingId ? (
						<>
							{" "}
							<button
								type="button"
								className="appt__link"
								style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", textDecoration: "underline" }}
								disabled={withdrawing}
								onClick={() => void withdrawReschedule()}
							>
								{withdrawing ? "Withdrawing…" : "Withdraw request"}
							</button>
						</>
					) : null}
				</div>
			) : null}

			{/* Actions - the point of the card */}
			<div className="appt__actions">
				{isOnline && booking.meetingLink ? (
					<>
						<button
							type="button"
							className={`btn btn--primary${joinable ? "" : " btn--disabled"}`}
							disabled={!joinable || joining}
							aria-disabled={!joinable}
							onClick={() => { if (joinable) void joinMeeting(); }}
						>
							{joining ? "Joining…" : joinable ? "Join meeting →" : "Join opens 15 min before"}
						</button>
						{!booking.meetingLink.startsWith("livekit:") && (
							<button type="button" className="btn btn--secondary" onClick={copyLink}>
								{copied ? "Copied ✓" : "Copy link"}
							</button>
						)}
						{joinError ? (
							<span className="mono" style={{ fontSize: "0.75rem", color: "var(--ink-muted, #777)" }}>{joinError}</span>
						) : null}
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

			{call ? (
				<ConsultationCall
					url={call.url}
					token={call.token}
					title={`Consultation · ${booking.confirmationId ?? ""}`}
					waitingFor="your consultant"
					onClose={() => setCall(null)}
				/>
			) : null}
			{notOpen ? (
				<MeetingWindowModal info={notOpen} onClose={() => setNotOpen(null)} />
			) : null}
			{ended ? (
				<MeetingEndedModal
					info={ended}
					onClose={() => setEnded(null)}
					onReschedule={() => { setEnded(null); nav("/portal/appointments"); }}
				/>
			) : null}
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
