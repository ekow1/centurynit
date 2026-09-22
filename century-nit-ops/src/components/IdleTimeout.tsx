import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Inactivity guard for the signed-in console.
 *
 * The session cookie itself lives far longer than the idle limit — this
 * component is the enforcement. It watches real input events (not API calls:
 * a page left polling would never idle out), keeps the clock on the wall so a
 * hidden tab still expires on time, and mirrors the timestamp into
 * localStorage so every open tab shares one clock.
 *
 * At `warnMs` remaining it opens a modal with a live countdown. From that
 * point activity no longer resets the clock — the staff member must choose:
 * "Stay signed in" pings the session endpoint and resets the timer, or the
 * countdown reaches zero and `onExpire` signs them out.
 */

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
/** Write the shared timestamp at most this often — pointer events are noisy. */
const WRITE_EVERY_MS = 5_000;

export interface IdleTimeoutProps {
	/** Full inactivity allowance before the session ends. */
	idleMs: number;
	/** The warning modal appears when this much time remains. */
	warnMs: number;
	/** localStorage key — unique per app so tabs share one clock. */
	storageKey: string;
	/** First name for "Still there, Efua?" */
	name?: string | null;
	/** "2 hours" / "12 hours" — used in the copy. */
	idleLabel: string;
	/** Lead sentence under the title. */
	lead: string;
	/** Ping the session. Resolve false (or throw) when it is already dead. */
	keepAlive: () => Promise<boolean>;
	/** Sign out and leave. Called once, at zero or on "Sign out now". */
	onExpire: () => void;
}

function fmtClock(ms: number): string {
	const s = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function IdleTimeout({
	idleMs,
	warnMs,
	storageKey,
	name,
	idleLabel,
	lead,
	keepAlive,
	onExpire,
}: IdleTimeoutProps) {
	const lastAt = useRef(Date.now());
	const lastWrite = useRef(0);
	const expired = useRef(false);
	const warning = useRef(false);
	const [remaining, setRemaining] = useState(idleMs);
	const [show, setShow] = useState(false);
	const [busy, setBusy] = useState(false);

	const readShared = useCallback(() => {
		try {
			const v = Number(localStorage.getItem(storageKey));
			if (Number.isFinite(v) && v > lastAt.current) lastAt.current = v;
		} catch {}
	}, [storageKey]);

	const markActivity = useCallback(() => {
		// While the prompt is up the clock keeps running — it needs a choice.
		if (warning.current || expired.current) return;
		const now = Date.now();
		lastAt.current = now;
		if (now - lastWrite.current >= WRITE_EVERY_MS) {
			lastWrite.current = now;
			try {
				localStorage.setItem(storageKey, String(now));
			} catch {}
		}
	}, [storageKey]);

	const expire = useCallback(() => {
		if (expired.current) return;
		expired.current = true;
		try {
			localStorage.removeItem(storageKey);
		} catch {}
		onExpire();
	}, [onExpire, storageKey]);

	useEffect(() => {
		markActivity();
		for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, markActivity, { passive: true });
		const onStorage = (e: StorageEvent) => {
			if (e.key === storageKey) readShared();
		};
		window.addEventListener("storage", onStorage);
		const tick = window.setInterval(() => {
			readShared();
			const left = lastAt.current + idleMs - Date.now();
			setRemaining(left);
			if (left <= 0) {
				expire();
				return;
			}
			const shouldWarn = left <= warnMs;
			warning.current = shouldWarn;
			setShow(shouldWarn);
		}, 1000);
		return () => {
			for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, markActivity);
			window.removeEventListener("storage", onStorage);
			window.clearInterval(tick);
		};
	}, [idleMs, warnMs, storageKey, markActivity, readShared, expire]);

	const stay = async () => {
		setBusy(true);
		let ok = false;
		try {
			ok = await keepAlive();
		} catch {
			ok = false;
		}
		if (!ok) {
			expire();
			return;
		}
		const now = Date.now();
		lastAt.current = now;
		lastWrite.current = now;
		try {
			localStorage.setItem(storageKey, String(now));
		} catch {}
		warning.current = false;
		setBusy(false);
		setShow(false);
		setRemaining(idleMs);
	};

	if (!show) return null;

	const first = name?.trim().split(/\s+/)[0];
	const pct = Math.max(0, Math.min(100, (remaining / warnMs) * 100));

	return (
		<div className="idle-veil" role="alertdialog" aria-modal="true" aria-label="Session expiring">
			<div className="idle-card">
				<div className="idle-card__head">
					<p className="idle-card__eyebrow">
						<i aria-hidden /> Session expiring
					</p>
					<h2 className="idle-card__title">Still there{first ? `, ${first}` : ""}?</h2>
					<p className="idle-card__lead">{lead}</p>
				</div>
				<div className="idle-card__clock">
					<span className="idle-card__digits">{fmtClock(remaining)}</span>
					<span className="idle-card__clockcap">until sign out</span>
				</div>
				<div className="idle-card__meter" aria-hidden>
					<i style={{ width: `${pct}%` }} />
				</div>
				<div className="idle-card__actions">
					<button type="button" className="idle-btn idle-btn--pri" onClick={() => void stay()} disabled={busy}>
						{busy ? "Checking…" : "Stay signed in"}
					</button>
					<button type="button" className="idle-btn idle-btn--ghost" onClick={expire} disabled={busy}>
						Sign out now
					</button>
				</div>
				<p className="idle-card__fine">
					Staying signed in refreshes your session and resets the {idleLabel} idle clock.
				</p>
			</div>
		</div>
	);
}
