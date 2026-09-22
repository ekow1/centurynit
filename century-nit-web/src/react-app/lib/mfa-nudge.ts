/**
 * Storage for the MFA nudge ladder (see components/portal/MfaPrompt.tsx).
 *
 * Two lifetimes, deliberately different:
 *
 * - The skip flag is per-sitting: "Skip for now. Remind me next sign-in" means
 *   the next authenticated session asks again. It lives in sessionStorage and
 *   is also cleared the moment the app observes the session end — a sign-out,
 *   an expired cookie, a dead probe — because sessionStorage otherwise outlives
 *   sign-out inside the same tab and the reminder would never come back.
 * - The sheet-seen and nudge-count markers are per-account-per-browser
 *   (localStorage): the welcome sheet is a once-ever ask, and the count is the
 *   quiet escalation signal across sittings.
 */

export const MFA_SKIP_KEY = "mfa_prompt_skipped_session";
export const mfaSheetKey = (uid: string) => `mfa_sheet_seen_${uid}`;
export const mfaNudgeKey = (uid: string) => `mfa_nudge_count_${uid}`;
export const mfaCountedKey = (uid: string) => `mfa_nudge_counted_${uid}`;

export function readMfaSkipped(): boolean {
	try {
		return sessionStorage.getItem(MFA_SKIP_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeMfaSkipped() {
	try {
		sessionStorage.setItem(MFA_SKIP_KEY, "1");
	} catch {
		/* ignore. Private mode etc. */
	}
}

/** The sitting ended: the next sign-in must nudge again. */
export function clearMfaSessionNudge() {
	try {
		sessionStorage.removeItem(MFA_SKIP_KEY);
	} catch {
		/* ignore */
	}
}

export function readMfaSheetSeen(uid: string): boolean {
	try {
		return localStorage.getItem(mfaSheetKey(uid)) === "1";
	} catch {
		return false;
	}
}

export function writeMfaSheetSeen(uid: string) {
	try {
		localStorage.setItem(mfaSheetKey(uid), "1");
	} catch {
		/* ignore */
	}
}

/** Bump the nudge count once per browser session. StrictMode-safe via the
 * sessionStorage flag rather than render counting. */
export function bumpMfaNudgeCount(uid: string): number {
	try {
		if (sessionStorage.getItem(mfaCountedKey(uid)) !== "1") {
			sessionStorage.setItem(mfaCountedKey(uid), "1");
			const next = (parseInt(localStorage.getItem(mfaNudgeKey(uid)) ?? "0", 10) || 0) + 1;
			localStorage.setItem(mfaNudgeKey(uid), String(next));
			return next;
		}
		return parseInt(localStorage.getItem(mfaNudgeKey(uid)) ?? "0", 10) || 0;
	} catch {
		return 0;
	}
}
