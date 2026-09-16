import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { bookingsApi } from "century-nit-core/api";

type CallState = "connecting" | "connected" | "ended" | "error";

/**
 * The consultation's own call surface — LiveKit rooms joined in-app.
 *
 * There is no hosted meeting page for LiveKit, so this component is the
 * whole product: connect to the project's ws host with the join token
 * minted by /bookings/:id/join, publish camera + mic, and render the
 * remote participant's tracks into our own monochrome tiles.
 *
 * The token — not this UI — carries the authority: roomAdmin (host
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
					<CenterNote title={`Waiting for ${waitingFor}`} sub="Stay here — the call starts when they join" />
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

/**
 * The one join path for every surface — `POST /bookings/:id/join` decides
 * authz, mints the per-person credential, and returns either a token'd URL
 * to open (Daily, Google, manual links) or {ws host, token} for the in-app
 * LiveKit call. The stored meetingUrl is never opened directly — for
 * token'd providers it isn't a usable link at all.
 */
export function useJoinMeeting() {
	const [call, setCall] = useState<{ url: string; token: string; title: string } | null>(null);
	const [joining, setJoining] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const join = useCallback(async (bookingId: string, title = "Consultation") => {
		setJoining(true);
		setError(null);
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
			setError(err instanceof Error ? err.message : "Could not join the meeting");
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
	) : null;

	return { join, joining, error, overlay };
}
