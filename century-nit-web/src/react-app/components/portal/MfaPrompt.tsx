import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMfaEnrollment, type MfaEnrollmentStatus } from "../../lib/api";
import { useAppState } from "../../context/AppState";

/**
 * Recommend MFA on every portal visit while the user is not enrolled.
 *
 * - On sign-up: the prompt appears the first time the portal loads, with a
 *   "Skip for now" option so the user can defer without being blocked.
 * - On sign-in: the prompt re-appears on each new browser session — the skip
 *   is stored in `sessionStorage`, which clears when the tab closes, so the
 *   next sign-in reminds them again until they enrol.
 * - Once enrolled, the prompt stays gone (the API reports `enrolled: true`).
 */
const SKIP_KEY = "mfa_prompt_skipped_session";

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
		/* ignore — private mode etc. */
	}
}

export function MfaPrompt() {
	const { authUser, sessionStatus } = useAppState();
	const [status, setStatus] = useState<MfaEnrollmentStatus | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [skipped, setSkipped] = useState(readSkipped);

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

	if (!loaded || !authUser) return null;
	if (status?.enrolled) return null;
	// Google and passwordless users hold no password here, so a second factor
	// would guard nothing — and enrolment, which asks for that password, could
	// not complete anyway. Say nothing rather than offer a dead end.
	if (status?.applicable === false) return null;
	if (skipped) return null;

	const isRequired = status?.required === true;

	return (
		<div className="mfa-prompt" role="status" aria-live="polite">
			<div className="mfa-prompt__icon" aria-hidden>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
					<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z" />
					<path d="M9 12l2 2 4-4" />
				</svg>
			</div>
			<div className="mfa-prompt__body">
				<p className="mfa-prompt__title">
					{isRequired
						? "Two-factor authentication is required for your account"
						: "Protect your account with two-factor authentication"}
				</p>
				<p className="mfa-prompt__sub">
					Add a second step at sign-in to keep your application documents and payment history safe. It
					only takes a minute.
				</p>
				<div className="mfa-prompt__actions">
					<Link to="/portal/security" className="btn btn--primary btn--sm">
						Set up MFA
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
							Skip for now
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
