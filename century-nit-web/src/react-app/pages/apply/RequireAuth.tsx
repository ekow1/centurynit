import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppState } from "../../context/AppState";

/**
 * Guard for the applicant portal: send unauthenticated visitors to sign-in.
 *
 * Phase 2 — server-authoritative. The portal is only rendered after the
 * `getCurrentSession()` probe resolves `authenticated`. While the probe is
 * in flight we render a fullscreen spinner so a *logged-in* user does not
 * flash to `/start` on every reload; an *unauthenticated* user is redirected
 * the moment the API returns no session. Crucially, `sessionStatus ===
 * "unauthenticated"` does **not** read `authUser` — the probe has already
 * cleared it — so a stale `AUTH_STORAGE_KEY` cannot force the portal open.
 *
 * Previously lived at the bottom of ApplyAuth.tsx, which was otherwise a dead
 * 350-line simulated sign-in screen (any 6-digit OTP, hardcoded social
 * identities) left over from the retired /apply flow. Real applicant auth goes
 * through StartJourney.tsx and Better Auth.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
	const { sessionStatus } = useAppState();

	if (sessionStatus === "checking") {
		return (
			<div className="route-loading" role="status" aria-live="polite">
				<span className="route-loading__spinner" aria-hidden="true" />
				<span className="sr-only">Checking your session…</span>
			</div>
		);
	}

	if (sessionStatus === "unauthenticated") {
		return <Navigate to="/start" replace />;
	}

	return <>{children}</>;
}