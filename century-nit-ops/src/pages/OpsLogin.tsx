import { useNavigate, Navigate, Link } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS, ROLE_DESCRIPTIONS, ROLE_HOME, type OpsRole } from "./OpsAuthContext";
import { useState } from "react";

const ALL_ROLES: OpsRole[] = ["manager", "coordinator", "consultant", "finance", "admin"];

const ROLE_SVG: Record<OpsRole, string> = {
	super_admin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
	manager: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
	coordinator: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
	consultant: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
	finance: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
	admin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

const LOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const MAIL_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
const BACK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
const SEARCH_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const SHIELD_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

export function OpsLogin() {
	const { opsSignIn, opsSignInWithCredentials, opsUser, authInitializing } = useOpsAuth();
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showForm, setShowForm] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	// If already logged in, redirect
	if (authInitializing) {
		return <div className="route-loading" role="status" aria-live="polite">
			<span className="route-loading__spinner" aria-hidden="true" />
		</div>;
	}
	if (opsUser) {
		return <Navigate to={ROLE_HOME[opsUser.role]} replace />;
	}

	function handleRoleSelect(role: OpsRole) {
		opsSignIn(role);
		navigate(ROLE_HOME[role]);
	}

	async function handleFormSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			await opsSignInWithCredentials(email, password);
			navigate(ROLE_HOME.manager);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Sign-in failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="ops-login">
			{/* Left panel - brand & feature highlights */}
			<div className="ops-login__aside">
				<div className="ops-login__brand">
					<Link to="/" className="ops-login__logo">
						Century NIT
					</Link>
					<p className="ops-login__tagline">Operations Center</p>
				</div>

				<div className="ops-login__features">
					<div className="ops-login__feature">
						<span className="ops-login__feature-icon" dangerouslySetInnerHTML={{ __html: SHIELD_SVG }} />
						<div>
							<p className="ops-login__feature-title">Secure Access</p>
							<p className="ops-login__feature-desc">Role-based permissions across every module</p>
						</div>
					</div>
					<div className="ops-login__feature">
						<span className="ops-login__feature-icon" dangerouslySetInnerHTML={{ __html: SEARCH_SVG }} />
						<div>
							<p className="ops-login__feature-title">Unified Workspace</p>
							<p className="ops-login__feature-desc">CRM, workflow, finance, and cases in one place</p>
						</div>
					</div>
					<div className="ops-login__feature">
						<span className="ops-login__feature-icon" dangerouslySetInnerHTML={{ __html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' }} />
						<div>
							<p className="ops-login__feature-title">Real-time Pipeline</p>
							<p className="ops-login__feature-desc">Track every application from lead to enrollment</p>
						</div>
					</div>
				</div>

				<p className="ops-login__copy">Century NIT &copy; 2026 &middot; Prototype Environment</p>
			</div>

			{/* Right panel - login form / role selection */}
			<div className="ops-login__main">
				<div className="ops-login__card">
					{showForm ? (
						<>
							<div className="ops-login__head">
								<h1 className="ops-login__title">Welcome back</h1>
								<p className="ops-login__subtitle">Sign in to your operations account</p>
							</div>

							<form onSubmit={handleFormSubmit} className="ops-login__form">
								<div className="ops-login__field">
									<label className="ops-login__label">
										<span dangerouslySetInnerHTML={{ __html: MAIL_SVG }} />
										Email
									</label>
									<input
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="you@century-nit.com"
										className="ops-login__input"
									/>
								</div>
								<div className="ops-login__field">
									<label className="ops-login__label">
										<span dangerouslySetInnerHTML={{ __html: LOCK_SVG }} />
										Password
									</label>
									<input
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
										className="ops-login__input"
									/>
								</div>
								{error ? (
									<p className="ops-login__error" role="alert">{error}</p>
								) : null}
								<button type="submit" disabled={loading} className="btn btn--primary ops-login__submit">
									<span>{loading ? "Signing in…" : "Sign In"}</span>
									{loading ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
								</button>
								<button
									type="button"
									onClick={() => setShowForm(false)}
									className="ops-login__back"
								>
									<span dangerouslySetInnerHTML={{ __html: BACK_SVG }} />
									Back to role selection
								</button>
							</form>
						</>
					) : (
						<>
							<div className="ops-login__head">
								<span className="ops-login__badge">Prototype Mode</span>
								<h1 className="ops-login__title">Select your role</h1>
								<p className="ops-login__subtitle">Choose a role to explore the operations dashboard</p>
							</div>

							<div className="ops-login__roles">
								{ALL_ROLES.map((role) => (
									<button
										key={role}
										onClick={() => handleRoleSelect(role)}
										className="ops-login__role"
									>
										<span className="ops-login__role-icon" dangerouslySetInnerHTML={{ __html: ROLE_SVG[role] }} />
										<span className="ops-login__role-body">
											<span className="ops-login__role-name">{ROLE_LABELS[role]}</span>
											<span className="ops-login__role-desc">{ROLE_DESCRIPTIONS[role]}</span>
										</span>
										<span className="ops-login__role-arrow" dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />
									</button>
								))}
							</div>

							<button
								onClick={() => setShowForm(true)}
								className="ops-login__email-toggle"
							>
								<span dangerouslySetInnerHTML={{ __html: MAIL_SVG }} />
								Sign in with email instead
							</button>
						</>
					)}
				</div>

				<Link to="/" className="ops-login__home">
					&larr; Back to public site
				</Link>
			</div>
		</div>
	);
}
