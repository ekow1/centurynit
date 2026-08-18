import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { staffApi } from "century-nit-core/api";
import { getMfaEnrollment } from "../lib/api";
import { useOpsAuth, ROLE_HOME, ROLE_LABELS, type OpsModule } from "./OpsAuthContext";
import type { ReactNode } from "react";

function Spinner() {
	return (
		<div className="route-loading" role="status" aria-live="polite">
			<span className="route-loading__spinner" aria-hidden="true" />
		</div>
	);
}

export function OpsRequireAuth({ children }: { children: ReactNode }) {
	const { opsUser, authInitializing } = useOpsAuth();
	const location = useLocation();

	/**
	 * Staff must hold a second factor before any case screen.
	 *
	 * Asked of the server rather than inferred from the session, because the
	 * server is what actually decides: `requireMfa` will refuse the data requests
	 * this UI is about to make. Redirecting here just avoids a screen full of
	 * 403s.
	 *
	 * `null` means "not yet known" — rendering children during that window would
	 * flash the dashboard before bouncing, which looks like a bug and briefly
	 * shows data the user is not yet cleared for.
	 */
	const [mfaOk, setMfaOk] = useState<boolean | null>(null);

	useEffect(() => {
		if (!opsUser) return;
		let active = true;
		getMfaEnrollment()
			.then((s) => active && setMfaOk(!s.required || s.enrolled))
			.catch(() => {
				staffApi
					.mfaStatus()
					.then((s) => active && setMfaOk(!s.required || s.enabled))
					.catch(() => {
						if (active) setMfaOk(false);
					});
			});
		return () => {
			active = false;
		};
	}, [opsUser]);

	if (authInitializing) return <Spinner />;

	if (!opsUser) {
		return <Navigate to="/login" replace />;
	}

	// The setup route is itself protected, so exempt it or enrolment is
	// unreachable for exactly the people who need it.
	if (location.pathname === "/mfa-setup") {
		return <>{children}</>;
	}

	if (mfaOk === null) return <Spinner />;
	if (!mfaOk) return <Navigate to="/mfa-setup" replace />;

	return <>{children}</>;
}

/**
 * Route-level permission gate.
 *
 * `ROLE_PERMISSIONS` used to filter only the sidebar and the command palette,
 * which meant typing a URL reached any module — a consultant could open
 * `/system` and get the full platform administration console. The sidebar is
 * a convenience; this is the check.
 *
 * It is still a client-side check and therefore still bypassable from devtools.
 * It becomes real when the same matrix runs as server middleware (see
 * docs/API_MIGRATION_PLAN.md §5). Until then it stops the accidental case, not a
 * determined one.
 */
export function OpsRequireModule({
	module,
	children,
}: {
	module: OpsModule;
	children: ReactNode;
}) {
	const { opsUser, opsRole, hasPermission, authInitializing } = useOpsAuth();

	if (authInitializing) {
		return <div className="route-loading" role="status" aria-live="polite">
			<span className="route-loading__spinner" aria-hidden="true" />
		</div>;
	}

	if (!opsUser) {
		return <Navigate to="/login" replace />;
	}

	if (!hasPermission(module)) {
		const home = opsRole ? ROLE_HOME[opsRole] : "/login";
		return (
			<div className="ops-forbidden" role="alert">
				<h1 className="ops-forbidden__title">Not available to your role</h1>
				<p className="ops-forbidden__body">
					You are signed in as <strong>{opsRole ? ROLE_LABELS[opsRole] : "an unknown role"}</strong>,
					which does not have access to this area.
				</p>
				<Link className="ops-forbidden__link" to={home}>
					Back to your workspace
				</Link>
			</div>
		);
	}

	return <>{children}</>;
}
