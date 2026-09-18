import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
	getMfaEnrollment,
	sendMfaOtp,
	verifyMfaOtp,
	type MfaEnrollmentStatus,
} from "../../lib/api";
import { useAppState } from "../../context/AppState";

/**
 * The MFA nudge ladder. Three surfaces off one status read:
 *
 * - Passwordless challenge: a social-only account enrolled in email-otp MFA
 *   gets a code per session (the plugin's own challenge never fires on OAuth
 *   callbacks, so ours gates the app until `/mfa/verify-otp` marks it).
 * - The sheet: a proper ask on the first portal visit of an account,
 *   dismissible, then gone.
 * - The banner: every sign-in after, while unenrolled. "Skip for now" is a
 *   sessionStorage flag. It dies with the tab, so the next sign-in asks
 *   again, forever until enrolled. There is deliberately no "don't ask".
 */
const SKIP_KEY = "mfa_prompt_skipped_session";
const sheetKey = (uid: string) => `mfa_sheet_seen_${uid}`;
const nudgeKey = (uid: string) => `mfa_nudge_count_${uid}`;
const countedKey = (uid: string) => `mfa_nudge_counted_${uid}`;

function readSkipped(): boolean {
	try {
		return sessionStorage.getItem(SKIP_KEY) === "1";
	} catch {
		return false;
	}
}

function writeSkipped() {
	try {
		sessionStorage.setItem(SKIP_KEY, "1");
	} catch {
		/* ignore. Private mode etc. */
	}
}

function readSheetSeen(uid: string): boolean {
	try {
		return localStorage.getItem(sheetKey(uid)) === "1";
	} catch {
		return false;
	}
}

function writeSheetSeen(uid: string) {
	try {
		localStorage.setItem(sheetKey(uid), "1");
	} catch {
		/* ignore */
	}
}

/** Bump the nudge count once per browser session. StrictMode-safe via the
 * sessionStorage flag rather than render counting. */
function bumpNudgeCount(uid: string): number {
	try {
		if (sessionStorage.getItem(countedKey(uid)) !== "1") {
			sessionStorage.setItem(countedKey(uid), "1");
			const next = (parseInt(localStorage.getItem(nudgeKey(uid)) ?? "0", 10) || 0) + 1;
			localStorage.setItem(nudgeKey(uid), String(next));
			return next;
		}
		return parseInt(localStorage.getItem(nudgeKey(uid)) ?? "0", 10) || 0;
	} catch {
		return 0;
	}
}

const shieldIcon = (
	<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
		<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z" />
		<path d="M9 12l2 2 4-4" />
	</svg>
);

/** Full-screen email-code gate for passwordless enrolments. Blocks the app
 * until the session carries an mfa-ok record. */
function MfaChallenge({ email, onVerified }: { email: string | null; onVerified: () => void }) {
	const { signOut } = useAppState();
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sentAt, setSentAt] = useState<Date | null>(null);

	useEffect(() => {
		let active = true;
		sendMfaOtp()
			.then(() => {
				if (active) setSentAt(new Date());
			})
			.catch(() => {
				if (active) setError("Couldn't send the code. Check your connection, then resend.");
			});
		return () => {
			active = false;
		};
	}, []);

	async function verify(e: React.FormEvent) {
		e.preventDefault();
		const clean = code.trim().replace(/\D/g, "");
		if (clean.length !== 6) {
			setError("Enter the complete 6-digit code from your email.");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await verifyMfaOtp(clean);
			onVerified();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Code not accepted");
		} finally {
			setBusy(false);
		}
	}

	async function resend() {
		setBusy(true);
		setError(null);
		try {
			await sendMfaOtp();
			setSentAt(new Date());
			setCode("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't resend the code");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Verify it's you"
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				position: "fixed",
				inset: 0,
				backgroundColor: "rgba(0,0,0,0.6)",
				zIndex: 10000,
				padding: "16px",
			}}
		>
			<div className="card fade-in" style={{ width: "100%", maxWidth: 420, padding: "2rem", background: "#fff" }}>
				<div className="mfa-prompt__icon" aria-hidden style={{ marginBottom: "1rem" }}>
					{shieldIcon}
				</div>
				<p className="eyebrow">Sign-in check</p>
				<h2 style={{ fontSize: "1.15rem", fontWeight: 650, marginTop: ".35rem" }}>Check your email</h2>
				<p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: ".5rem" }}>
					We sent a 6-digit code{email ? ` to ${email}` : " to your email"}. Enter it to finish signing
					in. This is your account's second factor.
				</p>
				{error ? (
					<div className="auth-error" role="alert" style={{ marginTop: "1rem" }}>
						{error}
					</div>
				) : null}
				<form className="auth-form" onSubmit={verify} noValidate style={{ marginTop: "1rem" }}>
					<div className="field">
						<label htmlFor="mfa-gate-code">Verification code</label>
						<input
							id="mfa-gate-code"
							className="input input--full-border"
							inputMode="numeric"
							autoComplete="one-time-code"
							placeholder="000000"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value)}
							autoFocus
							required
						/>
					</div>
					<div className="cal-actions">
						<button type="submit" className="btn btn--primary" disabled={busy || code.trim().length !== 6}>
							{busy ? "Verifying…" : "Verify"}
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={resend} disabled={busy}>
							Resend code
						</button>
					</div>
				</form>
				<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "1rem" }}>
					{sentAt ? "Code sent. It expires in 5 minutes. " : ""}
					Not you?{" "}
					<button
						type="button"
						onClick={() => void signOut()}
						style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
					>
						Sign out
					</button>
				</p>
			</div>
		</div>
	);
}

/** The once-per-account sheet. The first visit's proper ask. */
function MfaSheet({ required, onSetUp, onDismiss }: { required: boolean; onSetUp: () => void; onDismiss: () => void }) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Secure your account"
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				position: "fixed",
				inset: 0,
				backgroundColor: "rgba(0,0,0,0.6)",
				zIndex: 9999,
				padding: "16px",
			}}
		>
			<div className="card fade-in" style={{ width: "100%", maxWidth: 460, padding: "2rem", background: "#fff" }}>
				<div style={{ display: "flex", gap: ".9rem", alignItems: "center" }}>
					<div className="mfa-prompt__icon" aria-hidden>
						{shieldIcon}
					</div>
					<div>
						<p className="eyebrow">Welcome to Century NIT</p>
						<h2 style={{ fontSize: "1.15rem", fontWeight: 650, marginTop: ".2rem" }}>
							One thing left. Secure your account
						</h2>
					</div>
				</div>
				<div style={{ marginTop: "1.25rem", display: "grid", gap: ".6rem" }}>
					{[
						["Your passport, offers and receipts live here", "One leaked password is all that stands between someone and your file."],
						["Two minutes, once", "Authenticator app or an email code at sign-in. Your pick at setup."],
						["We'll keep asking", "Skip now and we'll remind you at your next sign-in. Until it's on."],
					].map(([t, s], i) => (
						<div key={t} style={{ display: "flex", gap: ".7rem", alignItems: "flex-start" }}>
							<span
								style={{
									width: "1.4rem",
									height: "1.4rem",
									border: "1.5px solid var(--ink, #000)",
									display: "grid",
									placeItems: "center",
									fontFamily: "ui-monospace, monospace",
									fontWeight: 800,
									fontSize: ".68rem",
									flex: "none",
								}}
							>
								{i + 1}
							</span>
							<div>
								<p style={{ fontWeight: 600, fontSize: ".82rem" }}>{t}</p>
								<p className="muted" style={{ fontSize: ".72rem", marginTop: ".1rem" }}>{s}</p>
							</div>
						</div>
					))}
				</div>
				<div style={{ display: "flex", gap: ".5rem", marginTop: "1.5rem", alignItems: "center" }}>
					<Link to="/portal/security" className="btn btn--primary" onClick={onSetUp}>
						Set up 2FA. 2 min
					</Link>
					{required ? null : (
						<button type="button" className="btn btn--ghost" onClick={onDismiss}>
							Not now
						</button>
					)}
					<span className="muted" style={{ fontSize: ".62rem", fontFamily: "ui-monospace, monospace", marginLeft: "auto" }}>
						{required ? "required" : "reminds next sign-in"}
					</span>
				</div>
			</div>
		</div>
	);
}

export function MfaPrompt() {
	const { authUser, sessionStatus } = useAppState();
	const [status, setStatus] = useState<MfaEnrollmentStatus | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [skipped, setSkipped] = useState(readSkipped);
	const [sheetDismissed, setSheetDismissed] = useState(false);
	const [nudgeCount, setNudgeCount] = useState(0);
	const counted = useRef(false);

	useEffect(() => {
		if (sessionStatus !== "authenticated" || !authUser) return;
		let active = true;
		getMfaEnrollment()
			.then((s) => {
				if (!active) return;
				setStatus(s);
			})
			.catch(() => {
				/* If the endpoint is unavailable, don't pester the user. */
				if (active) setStatus(null);
			})
			.finally(() => {
				if (active) setLoaded(true);
			});
		return () => {
			active = false;
		};
	}, [sessionStatus, authUser]);

	// Count this session's banner impression once. The quiet "we mean it" chip.
	useEffect(() => {
		if (!loaded || !authUser || counted.current) return;
		if (status && !status.enrolled && status.applicable !== false && !skipped && authUser.id) {
			counted.current = true;
			setNudgeCount(bumpNudgeCount(authUser.id));
		}
	}, [loaded, authUser, status, skipped]);

	if (!loaded || !authUser) return null;

	// The passwordless session gate outranks every nudge. The app is locked
	// behind the code until it verifies.
	if (status?.challengeRequired) {
		return (
			<MfaChallenge
				email={authUser.email ?? null}
				onVerified={() => setStatus((s) => (s ? { ...s, challengeRequired: false } : s))}
			/>
		);
	}

	if (status?.enrolled) return null;
	if (status?.applicable === false) return null;
	if (skipped) return null;

	const isRequired = status?.required === true;
	const sheetUnseen = authUser.id ? !readSheetSeen(authUser.id) : false;

	// First visit. The sheet, once.
	if (sheetUnseen && !sheetDismissed) {
		return (
			<MfaSheet
				required={isRequired}
				onSetUp={() => authUser.id && writeSheetSeen(authUser.id)}
				onDismiss={() => {
					if (authUser.id) writeSheetSeen(authUser.id);
					writeSkipped();
					setSheetDismissed(true);
					setSkipped(true);
				}}
			/>
		);
	}

	return (
		<div className="mfa-prompt" role="status" aria-live="polite">
			<div className="mfa-prompt__icon" aria-hidden>
				{shieldIcon}
			</div>
			<div className="mfa-prompt__body">
				<p className="mfa-prompt__title">
					{isRequired
						? "Two-factor authentication is required for your account"
						: "2FA isn't on. Your file is one password away"}
				</p>
				<p className="mfa-prompt__sub">
					Application documents, offer letters and receipts are all in this account. Add the second
					step now. It takes two minutes.
				</p>
				<div className="mfa-prompt__actions">
					<Link to="/portal/security" className="btn btn--primary btn--sm">
						Set up 2FA
					</Link>
					{isRequired ? null : (
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							onClick={() => {
								writeSkipped();
								setSkipped(true);
							}}
						>
							Skip for now. Remind me next sign-in
						</button>
					)}
					{nudgeCount > 1 ? (
						<span className="mfa-prompt__count" aria-label={`Nudge ${nudgeCount}`}>
							{isRequired ? "required" : `nudge ${nudgeCount}`}
						</span>
					) : isRequired ? (
						<span className="mfa-prompt__count">required</span>
					) : null}
				</div>
			</div>
		</div>
	);
}
