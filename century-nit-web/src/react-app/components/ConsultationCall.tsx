import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { ApiError, bookingsApi } from "century-nit-core/api";

type CallState = "connecting" | "connected" | "ended" | "error";

/**
 * The consultation's own call surface. LiveKit rooms joined in-app.
 *
 * There is no hosted meeting page for LiveKit, so this component is the
 * whole product: connect to the project's ws host with the join token
 * minted by /bookings/:id/join, publish camera + mic, and render the
 * remote participant's tracks into our own monochrome tiles.
 *
 * The token, not this UI, carries the authority: roomAdmin (host
 * controls) is decided server-side per caller, so "host" here is only a
 * label, never something the client can claim.
 */
export function ConsultationCall({
	url,
	token,
	title,
	waitingFor,
	onClose,
}: {
	/** LiveKit ws host, e.g. wss://centurynit.livekit.cloud */
	url: string;
	/** Join token minted by /bookings/:id/join */
	token: string;
	/** Shown in the header, e.g. "Consultation · CNS-2026-0002" */
	title: string;
	/** Who we're waiting on, e.g. "your consultant" / "the client" */
	waitingFor: string;
	onClose: () => void;
}) {
	const remoteVideoRef = useRef<HTMLVideoElement>(null);
	const remoteAudioRef = useRef<HTMLDivElement>(null);
	const localVideoRef = useRef<HTMLVideoElement>(null);
	const roomRef = useRef<Room | null>(null);

	const [state, setState] = useState<CallState>("connecting");
	const [error, setError] = useState<string | null>(null);
	const [remoteCount, setRemoteCount] = useState(0);
	const [micOn, setMicOn] = useState(true);
	const [camOn, setCamOn] = useState(true);

	useEffect(() => {
		const room = new Room({ adaptiveStream: true, dynacast: true });
		roomRef.current = room;
		let cancelled = false;

		const syncRemoteCount = () => setRemoteCount(room.remoteParticipants.size);

		room
			.on(RoomEvent.ParticipantConnected, syncRemoteCount)
			.on(RoomEvent.ParticipantDisconnected, syncRemoteCount)
			.on(RoomEvent.TrackSubscribed, (track) => {
				if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
					track.attach(remoteVideoRef.current);
				} else if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
					remoteAudioRef.current.appendChild(track.attach());
				}
			})
			.on(RoomEvent.TrackUnsubscribed, (track) => track.detach())
			.on(RoomEvent.Disconnected, () => setState("ended"));

		(async () => {
			try {
				await room.connect(url, token);
				if (cancelled) return;
				await room.localParticipant.enableCameraAndMicrophone();
				const cam = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
				if (cam && localVideoRef.current) cam.attach(localVideoRef.current);
				syncRemoteCount();
				setState("connected");
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Could not connect to the meeting");
				setState("error");
			}
		})();

		return () => {
			cancelled = true;
			room.disconnect();
			roomRef.current = null;
		};
	}, [url, token]);

	async function toggleMic() {
		const next = !micOn;
		await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
		setMicOn(next);
	}

	async function toggleCam() {
		const next = !camOn;
		await roomRef.current?.localParticipant.setCameraEnabled(next);
		setCamOn(next);
	}

	function leave() {
		roomRef.current?.disconnect();
		onClose();
	}

	const live = state === "connected";
	const alone = live && remoteCount === 0;

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={title}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 1000,
				background: "#000",
				display: "flex",
				flexDirection: "column",
				color: "#fff",
			}}
		>
			{/* header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "0.9rem 1.25rem",
					borderBottom: "1px solid #333",
				}}
			>
				<span className="mono" style={{ fontSize: "0.8rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
					{title}
				</span>
				<span className="mono" style={{ fontSize: "0.72rem", color: "#888" }}>
					{state === "connecting" && "CONNECTING…"}
					{alone && "WAITING"}
					{live && remoteCount > 0 && `${remoteCount + 1} IN CALL`}
					{state === "ended" && "ENDED"}
					{state === "error" && "ERROR"}
				</span>
			</div>

			{/* stage */}
			<div style={{ position: "relative", flex: 1, overflow: "hidden", background: "#0a0a0a" }}>
				<video
					ref={remoteVideoRef}
					autoPlay
					playsInline
					style={{ width: "100%", height: "100%", objectFit: "contain", display: remoteCount > 0 ? "block" : "none" }}
				/>
				{/* audio elements for remote tracks live here, out of sight */}
				<div ref={remoteAudioRef} style={{ display: "none" }} />

				{state === "connecting" && (
					<CenterNote title="Connecting…" sub="Opening the meeting room" />
				)}
				{alone && (
					<CenterNote title={`Waiting for ${waitingFor}`} sub="Stay here. The call starts when they join" />
				)}
				{state === "ended" && (
					<CenterNote title="Call ended" sub="You can close this window" action={{ label: "Close", onClick: onClose }} />
				)}
				{state === "error" && (
					<CenterNote title="Couldn't join" sub={error ?? "Something went wrong"} action={{ label: "Close", onClick: onClose }} />
				)}

				{/* local PiP */}
				{live && (
					<video
						ref={localVideoRef}
						autoPlay
						playsInline
						muted
						style={{
							position: "absolute",
							right: "1rem",
							bottom: "1rem",
							width: "180px",
							aspectRatio: "4/3",
							objectFit: "cover",
							border: "1px solid #444",
							background: "#111",
							transform: "scaleX(-1)",
						}}
					/>
				)}
			</div>

			{/* controls */}
			{live && (
				<div
					style={{
						display: "flex",
						justifyContent: "center",
						gap: "0.75rem",
						padding: "1rem",
						borderTop: "1px solid #333",
					}}
				>
					<CallButton onClick={() => void toggleMic()} active={micOn}>
						{micOn ? "Mic on" : "Mic off"}
					</CallButton>
					<CallButton onClick={() => void toggleCam()} active={camOn}>
						{camOn ? "Camera on" : "Camera off"}
					</CallButton>
					<CallButton onClick={leave} danger>
						End call
					</CallButton>
				</div>
			)}
		</div>
	);
}

function CenterNote({
	title,
	sub,
	action,
}: {
	title: string;
	sub: string;
	action?: { label: string; onClick: () => void };
}) {
	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: "0.5rem",
				textAlign: "center",
				padding: "1rem",
			}}
		>
			<div className="mono" style={{ fontSize: "1rem", letterSpacing: "0.05em" }}>{title}</div>
			<div className="mono" style={{ fontSize: "0.78rem", color: "#888" }}>{sub}</div>
			{action && (
				<button type="button" className="btn btn--secondary btn--sm" onClick={action.onClick} style={{ marginTop: "0.75rem" }}>
					{action.label}
				</button>
			)}
		</div>
	);
}

function CallButton({
	onClick,
	active,
	danger,
	children,
}: {
	onClick: () => void;
	active?: boolean;
	danger?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="mono"
			style={{
				padding: "0.6rem 1.1rem",
				fontSize: "0.78rem",
				letterSpacing: "0.06em",
				textTransform: "uppercase",
				cursor: "pointer",
				background: danger ? "#fff" : active === false ? "#222" : "#fff",
				color: danger ? "#000" : active === false ? "#ccc" : "#000",
				border: `1px solid ${danger ? "#fff" : "#555"}`,
			}}
		>
			{children}
		</button>
	);
}

/* "Opens at" modal. The friendly face of the 409 MEETING_NOT_OPEN */

export type MeetingWindowInfo = {
	opensAt: string;
	startsAt: string;
	endsAt: string;
	timezone: string | null;
	earlyMinutes: number;
	reference?: string;
	title: string;
};

function isWindowDetails(d: unknown): d is Omit<MeetingWindowInfo, "title"> {
	return (
		typeof d === "object" && d !== null &&
		typeof (d as Record<string, unknown>).opensAt === "string" &&
		typeof (d as Record<string, unknown>).startsAt === "string"
	);
}

function useMinuteClock() {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 15_000);
		return () => window.clearInterval(id);
	}, []);
	return now;
}

function countdownLabel(now: number, opensAt: number) {
	const ms = opensAt - now;
	if (ms <= 0) return "open now. Press Join again";
	const min = Math.ceil(ms / 60_000);
	if (min < 60) return `opens in ${min} min`;
	const h = Math.floor(min / 60);
	if (h < 48) return `opens in ${h}h ${min % 60 ? `${min % 60}m` : ""}`.trim();
	const d = Math.floor(h / 24);
	return `opens in ${d} day${d === 1 ? "" : "s"}`;
}

/**
 * The modal that answers "The meeting room opens at 08:45" properly,
 * the exact time in the booking's timezone, a live countdown, who gets in
 * when, and a calendar escape. Rendered by useJoinMeeting's overlay slot so
 * every Join surface gets it with no per-page wiring.
 */
export function MeetingWindowModal({ info, onClose }: { info: MeetingWindowInfo; onClose: () => void }) {
	const now = useMinuteClock();
	const opens = new Date(info.opensAt);
	const tz = info.timezone ?? undefined;
	const openTime = opens.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
	const openDay = opens.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: tz });
	const start = new Date(info.startsAt);
	const startLabel = start.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });

	function addToCalendar() {
		const ics = [
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Century NIT//Consultation//EN",
			"BEGIN:VEVENT",
			`UID:${info.reference ?? "century-nit"}@centurynit.com`,
			`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
			`DTSTART:${start.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
			`DTEND:${new Date(info.endsAt).toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
			`SUMMARY:${info.title}`,
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");
		const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "century-nit-appointment.ics";
		a.click();
		URL.revokeObjectURL(url);
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Meeting room not open yet"
			onClick={onClose}
			style={{
				position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.45)",
				display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
			}}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					background: "#fff", border: "1.5px solid #000", maxWidth: "26rem", width: "100%",
					boxShadow: "6px 6px 0 rgba(0,0,0,0.25)", fontFamily: "inherit",
				}}
			>
				<div style={{ borderBottom: "1.5px solid #000", padding: "0.7rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<span className="eyebrow" style={{ margin: 0 }}>Meeting scheduled</span>
					<button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, fontSize: "1.1rem", cursor: "pointer", lineHeight: 1 }}>×</button>
				</div>
				<div style={{ padding: "1.1rem", textAlign: "center" }}>
					<p style={{ fontFamily: "ui-monospace, monospace", fontSize: "2.4rem", letterSpacing: "-0.02em", margin: "0.3rem 0 0.1rem" }}>{openTime}</p>
					<p style={{ fontSize: "0.8rem", color: "#52525b" }}>{openDay}{tz ? ` · ${tz}` : ""}</p>
					<p style={{ display: "inline-block", fontFamily: "ui-monospace, monospace", fontSize: "0.62rem", letterSpacing: "0.1em", textTransform: "uppercase", border: "1px solid #000", padding: "0.25rem 0.55rem", marginTop: "0.55rem" }}>
						{countdownLabel(now, opens.getTime())}
					</p>
					<p style={{ fontSize: "0.78rem", color: "#52525b", lineHeight: 1.55, marginTop: "0.9rem" }}>
						{info.title} starts {startLabel}. The room opens {info.earlyMinutes} minutes early. You can join from {openTime}.
					</p>
				</div>
				<div style={{ borderTop: "1px solid #d4d4d8", padding: "0.8rem 1.1rem", display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
					<button type="button" onClick={addToCalendar} className="btn btn--ghost btn--sm">Add to calendar</button>
					<button type="button" onClick={onClose} className="btn btn--primary btn--sm">Got it</button>
				</div>
			</div>
		</div>
	);
}

/* "Window passed" modal. The friendly face of the 409 MEETING_ENDED */

export type MeetingEndedInfo = {
	startsAt: string;
	endsAt: string;
	windowClosedAt?: string;
	timezone: string | null;
	reference?: string;
	title: string;
};

function isEndedDetails(d: unknown): d is Omit<MeetingEndedInfo, "title"> {
	return (
		typeof d === "object" && d !== null &&
		typeof (d as Record<string, unknown>).startsAt === "string" &&
		typeof (d as Record<string, unknown>).endsAt === "string"
	);
}

/**
 * The ended twin of MeetingWindowModal. Same shell, but the clock is the
 * slot's end (struck through) and the CTA is reschedule instead of calendar.
 * `onReschedule` is optional: surfaces with nowhere to reschedule to render
 * dismiss-only.
 */
export function MeetingEndedModal({
	info,
	onClose,
	onReschedule,
}: {
	info: MeetingEndedInfo;
	onClose: () => void;
	onReschedule?: () => void;
}) {
	const tz = info.timezone ?? undefined;
	const start = new Date(info.startsAt);
	const end = new Date(info.endsAt);
	const day = start.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: tz });
	const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
	const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone: tz };
	const range = `${start.toLocaleTimeString(undefined, timeOpts)} – ${endTime}`;
	const closedLabel = info.windowClosedAt
		? new Date(info.windowClosedAt).toLocaleTimeString(undefined, timeOpts)
		: null;

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Meeting window has passed"
			onClick={onClose}
			style={{
				position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.45)",
				display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
			}}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					background: "#fff", border: "1.5px solid #000", maxWidth: "26rem", width: "100%",
					boxShadow: "6px 6px 0 rgba(0,0,0,0.25)", fontFamily: "inherit",
				}}
			>
				<div style={{ borderBottom: "1.5px solid #000", padding: "0.7rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<span className="eyebrow" style={{ margin: 0 }}>{info.title}</span>
					<button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, fontSize: "1.1rem", cursor: "pointer", lineHeight: 1 }}>×</button>
				</div>
				<div style={{ padding: "1.1rem", textAlign: "center" }}>
					<p className="eyebrow" style={{ color: "#000" }}>This meeting window has passed</p>
					<p style={{ fontFamily: "ui-monospace, monospace", fontSize: "2.4rem", letterSpacing: "-0.02em", margin: "0.3rem 0 0.1rem", textDecoration: "line-through" }}>{endTime}</p>
					<p style={{ fontSize: "0.8rem", color: "#52525b" }}>{day}{tz ? ` · ${tz}` : ""}</p>
					<p style={{ display: "inline-block", fontFamily: "ui-monospace, monospace", fontSize: "0.62rem", letterSpacing: "0.1em", textTransform: "uppercase", border: "1px solid #000", padding: "0.25rem 0.55rem", marginTop: "0.55rem" }}>
						Window closed
					</p>
					<p style={{ fontSize: "0.78rem", color: "#52525b", lineHeight: 1.55, marginTop: "0.9rem" }}>
						{info.title} was {day} · {range}.{closedLabel ? ` The join window stays open 2 hours after the slot. It closed at ${closedLabel}.` : ""}
					</p>
				</div>
				<div style={{ borderTop: "1px solid #d4d4d8", padding: "0.8rem 1.1rem", display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
					{onReschedule && (
						<button type="button" onClick={onReschedule} className="btn btn--primary btn--sm">Reschedule →</button>
					)}
					<button type="button" onClick={onClose} className={`btn btn--sm ${onReschedule ? "btn--ghost" : "btn--primary"}`}>Got it</button>
				</div>
			</div>
		</div>
	);
}

/**
 * The one join path for every surface. `POST /bookings/:id/join` decides
 * authz, mints the per-person credential, and returns either a token'd URL
 * to open (Daily, Google, manual links) or {ws host, token} for the in-app
 * LiveKit call. The stored meetingUrl is never opened directly. For
 * token'd providers it isn't a usable link at all.
 */
export function useJoinMeeting(options?: { onReschedule?: () => void }) {
	const [call, setCall] = useState<{ url: string; token: string; title: string } | null>(null);
	const [notOpen, setNotOpen] = useState<MeetingWindowInfo | null>(null);
	const [ended, setEnded] = useState<MeetingEndedInfo | null>(null);
	const [joining, setJoining] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const onRescheduleRef = useRef(options?.onReschedule);
	onRescheduleRef.current = options?.onReschedule;

	const join = useCallback(async (bookingId: string, title = "Consultation") => {
		setJoining(true);
		setError(null);
		setNotOpen(null);
		setEnded(null);
		try {
			const res = await bookingsApi.joinMeeting(bookingId);
			if (res?.provider === "livekit" && res.token) {
				setCall({ url: res.url, token: res.token, title });
			} else if (res?.url && /^https?:/i.test(res.url)) {
				window.open(res.url, "_blank", "noopener,noreferrer");
			} else {
				setError("No usable meeting link on this booking yet");
			}
		} catch (err) {
			if (err instanceof ApiError && err.code === "MEETING_NOT_OPEN" && isWindowDetails(err.details)) {
				setNotOpen({ ...err.details, title });
			} else if (err instanceof ApiError && err.code === "MEETING_ENDED" && isEndedDetails(err.details)) {
				setEnded({ ...err.details, title });
			} else {
				setError(err instanceof Error ? err.message : "Could not join the meeting");
			}
		} finally {
			setJoining(false);
		}
	}, []);

	const overlay = call ? (
		<ConsultationCall
			url={call.url}
			token={call.token}
			title={call.title}
			waitingFor="your consultant"
			onClose={() => setCall(null)}
		/>
	) : notOpen ? (
		<MeetingWindowModal info={notOpen} onClose={() => setNotOpen(null)} />
	) : ended ? (
		<MeetingEndedModal
			info={ended}
			onClose={() => setEnded(null)}
			onReschedule={onRescheduleRef.current ? () => { setEnded(null); onRescheduleRef.current?.(); } : undefined}
		/>
	) : null;

	return { join, joining, error, overlay };
}
