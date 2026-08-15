import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppState } from "../../context/AppState";

/**
 * Guard for the applicant portal: send unauthenticated visitors to sign-in.
 *
 * Previously lived at the bottom of ApplyAuth.tsx, which was otherwise a dead
 * 350-line simulated sign-in screen (any 6-digit OTP, hardcoded social
 * identities) left over from the retired /apply flow. Real applicant auth goes
 * through StartJourney.tsx and Better Auth.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
	const { isAuthenticated } = useAppState();

	if (!isAuthenticated) {
		return <Navigate to="/start" replace />;
	}

	return <>{children}</>;
}
