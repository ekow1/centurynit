import { useNavigate, Navigate, Link, useSearchParams } from "react-router-dom";
import { useOpsAuth, ROLE_HOME } from "./OpsAuthContext";
import { useState, useEffect } from "react";
import {
	getOpsMethods,
	getPendingMfaMethod,
	getSession,
	signInWithGoogle,
	type OpsMethods,
} from "../lib/api";
import { AuthShell } from "./AuthShell";
import { PasswordField } from "./PasswordField";

const LOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const MAIL_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
const GOOGLE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.35 11.1H12v3.9h5.35c-.5 2.4-2.6 3.9-5.35 3.9a5.9 5.9 0 1 1 0-11.8c1.5 0 2.85.55 3.9 1.45l2.85-2.85A9.9 9.9 0 1 0 12 21.9c5.7 0 9.35-4 9.35-9.6 0-.4-.05-.8-.15-1.2z"/></svg>';

export function OpsLogin() {
	const { opsSignInWithCredentials, opsVerifyTwoFactor, opsVerifyEmailOtp, opsSendMfaOtp, opsUser, authInitializing } = useOpsAuth();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [rememberMe, setRememberMe] = useState(true);
	const [twoFactorRequired, setTwoFactorRequired] = useState(false);
	const [mfaMethod, setMfaMethod] = useState<string | null>(null);
	const [mfaEmail, setMfaEmail] = useState<string | null>(null);
	const [twoFactorCode, setTwoFactorCode] = useState("");
	const [useBackupCode, setUseBackupCode] = useState(false);
	const [trustDevice, setTrustDevice] = useState(false);
	const [otpSent, setOtpSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [ssoBusy, setSsoBusy] = useState(false);
	const [resendCooldown, setResendCooldown] = useState(0);
	const [methods, setMethods] = useState<OpsMethods | null>(null);

	/*
	 * Which sign-in methods the console may offer — answered by the public
	 * /ops-methods endpoint before any session exists. Fails open to
	 * password-only so a flaky fetch never locks anyone out of the form.
	 */
	useEffect(() => {
		getOpsMethods()
			.then(setMethods)
			.catch(() => setMethods({ email_password: true, google_sso: false, mfa_required: true }));
	}, []);

	/*
	 * Resume a pending MFA challenge after a refresh. The signed two_factor
	 * cookie outlives this component's state; /api/auth/mfa/method reads it
	 * server-side and answers which challenge to render. 401s when there is
	 * no pending challenge — nothing to resume.
	 */
	useEffect(() => {
		getPendingMfaMethod()
			.then((pending) => {
				if (!pending.method) return;
				setTwoFactorRequired(true);
				setMfaMethod(pending.method);
				if (pending.email) setMfaEmail(pending.email);
				if (pending.method === "email_otp") {
					opsSendMfaOtp()
						.then(() => setOtpSent(true))
						.catch(() => {});
				}
			})
			.catch(() => {});
	}, [opsSendMfaOtp]);

	/*
	 * Returning from Google. ?sso=error means the provider refused or the
	 * session hook blocked it (e.g. the toggle is off). ?sso=return with a
	 * user but no staff profile means the account signed in fine — it just
	 * isn't a staff account, which is a different message than a failure.
	 */
	useEffect(() => {
		const sso = searchParams.get("sso");
		if (!sso || authInitializing) return;
		setSearchParams({}, { replace: true });
		if (sso === "error") {
			setError("Google sign-in could not be completed. Try your staff credentials, or ask your administrator.");
			return;
		}
		if (sso === "return") {
			getSession()
				.then(({ user, staff }) => {
					if (user && !staff) {
						setError("That Google account isn't linked to a staff account. Sign in with your staff credentials.");
					}
					// staff sessions resolve into opsUser via the provider's own
					// session check — nothing else to do here.
				})
				.catch(() => {});
		}
	}, [searchParams, setSearchParams, authInitializing]);

	// #35: auto-submit the MFA form once the user types the full 6 digits.
	useEffect(() => {
		if (!twoFactorRequired || loading) return;
		if (mfaMethod === "email_otp" || (!useBackupCode && twoFactorCode.length === 6)) {
			const form = document.getElementById("mfa-form") as HTMLFormElement | null;
			if (form && form.requestSubmit) {
				form.requestSubmit();
			}
		}
	}, [twoFactorCode, twoFactorRequired, mfaMethod, useBackupCode, loading]);

	// #36: tick down the resend cooldown timer once per second.
	useEffect(() => {
		if (resendCooldown <= 0) return;
		const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
		return () => clearTimeout(t);
	}, [resendCooldown]);

	// If already logged in, redirect
	if (authInitializing) {
		return <div className="route-loading" role="status" aria-live="polite">
			<span className="route-loading__spinner" aria-hidden="true" />
		</div>;
	}
	if (opsUser) {
		return <Navigate to={ROLE_HOME[opsUser.role]} replace />;
	}

	async function handleFormSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			const res = await opsSignInWithCredentials(email, password, rememberMe);
			if (res.twoFactorRequired) {
				setTwoFactorRequired(true);
				setMfaMethod(res.mfaMethod ?? "totp");
				// If email OTP method, auto-send the code
				if (res.mfaMethod === "email_otp") {
					try {
						await opsSendMfaOtp();
						setOtpSent(true);
					} catch {
						setError("Could not send the verification code. Check your email address or try resending.");
					}
				}
				return;
			}
			if (res.user) {
				navigate(ROLE_HOME[res.user.role] ?? ROLE_HOME.manager);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Sign-in failed");
		} finally {
			setLoading(false);
		}
	}

	async function handleGoogleSignIn() {
		setError(null);
		setSsoBusy(true);
		try {
			const res = await signInWithGoogle(`${window.location.origin}/login?sso=return`);
			if (!res?.url) throw new Error("no-redirect");
			window.location.assign(res.url);
		} catch {
			setError("Could not start Google sign-in. Try your staff credentials instead.");
			setSsoBusy(false);
		}
	}

	async function handleTwoFactorSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			let user;
			if (mfaMethod === "email_otp") {
				user = await opsVerifyEmailOtp(twoFactorCode, trustDevice);
			} else {
				user = await opsVerifyTwoFactor(twoFactorCode, useBackupCode, trustDevice);
			}
			navigate(ROLE_HOME[user.role] ?? ROLE_HOME.manager);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: mfaMethod === "email_otp"
						? "Invalid code. Check your email and try again."
						: "Invalid two-factor code. Check your authenticator app and try again.",
			);
		} finally {
			setLoading(false);
		}
	}

	const showPassword = methods === null || methods.email_password;
	const showSso = Boolean(methods?.google_sso);

	return (
		<AuthShell>
			{twoFactorRequired ? (
				<>
					<div className="ops-login__head">
						<h1 className="ops-login__title">Two-Factor Authentication</h1>
						<p className="ops-login__subtitle">
							{mfaMethod === "email_otp"
								? (otpSent
									? `Enter the 6-digit code sent to ${mfaEmail ?? email}`
									: "Sending you a verification code...")
								: (useBackupCode
									? "Enter one of your 10-character backup recovery codes"
									: "Enter the current 6-digit code from your authenticator app")}
						</p>
					</div>

					<form id="mfa-form" onSubmit={handleTwoFactorSubmit} className="ops-login__form">
						<div className="ops-login__field">
							<label className="ops-login__label">
								<span dangerouslySetInnerHTML={{ __html: LOCK_SVG }} />
								{mfaMethod === "email_otp"
									? "Email Code"
									: (useBackupCode ? "Backup Recovery Code" : "Authenticator Code")}
							</label>
							<input
								type="text"
								value={twoFactorCode}
								onChange={(e) => {
									if (error) setError(null);
									setTwoFactorCode(
										(mfaMethod === "email_otp" || !useBackupCode)
											? e.target.value.replace(/\D/g, "").slice(0, 6)
											: e.target.value.trim(),
									);
								}}
								placeholder={
									mfaMethod === "email_otp"
										? "000000"
										: (useBackupCode ? "e.g. a1b2c3d4e5" : "000000")
								}
								inputMode={(mfaMethod === "email_otp" || !useBackupCode) ? "numeric" : "text"}
								autoComplete="one-time-code"
								pattern={(mfaMethod === "email_otp" || !useBackupCode) ? "[0-9]{6}" : undefined}
								maxLength={mfaMethod === "email_otp" ? 6 : (useBackupCode ? 32 : 6)}
								className="ops-login__input mono"
								required
								autoFocus
							/>
						</div>

						{error ? (
							<p className="ops-login__error" role="alert">{error}</p>
						) : null}

						<button type="submit" disabled={loading || !twoFactorCode} className="btn btn--primary ops-login__submit">
							<span>{loading ? "Verifying..." : "Verify & Sign In"}</span>
							{loading ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
						</button>

						<label className="ops-login__remember">
							<input
								type="checkbox"
								checked={trustDevice}
								onChange={(e) => setTrustDevice(e.target.checked)}
								disabled={loading}
							/>
							Trust this device for 30 days
						</label>

						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--text-xs)" }}>
							{mfaMethod !== "email_otp" && (
								<button
									type="button"
									onClick={() => {
										setUseBackupCode(!useBackupCode);
										setTwoFactorCode("");
										setError(null);
									}}
									className="btn btn--ghost btn--xs"
									style={{ padding: "0.25rem 0.5rem" }}
								>
									{useBackupCode ? "Use Authenticator App" : "Use a backup recovery code"}
								</button>
							)}
							{mfaMethod === "email_otp" && (
								<button
									type="button"
									disabled={resendCooldown > 0}
									onClick={async () => {
										setError(null);
										try {
											await opsSendMfaOtp();
											setOtpSent(true);
											setResendCooldown(30);
										} catch {
											setError("Could not resend code");
										}
									}}
									className="btn btn--ghost btn--xs"
									style={{ padding: "0.25rem 0.5rem" }}
								>
									{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
								</button>
							)}
							<button
								type="button"
								onClick={() => {
									setTwoFactorRequired(false);
									setMfaMethod(null);
									setMfaEmail(null);
									setTwoFactorCode("");
									setError(null);
									setOtpSent(false);
								}}
								className="ops-login__back"
								style={{ margin: 0, width: "auto" }}
							>
								Back to login
							</button>
						</div>
					</form>
				</>
			) : (
				<>
					<div className="ops-login__head">
						<h1 className="ops-login__title">Welcome back</h1>
						<p className="ops-login__subtitle">Sign in to your operations account</p>
					</div>

					{showSso && (
						<button
							type="button"
							className="ops-login__sso"
							onClick={handleGoogleSignIn}
							disabled={ssoBusy || loading}
						>
							<span dangerouslySetInnerHTML={{ __html: GOOGLE_SVG }} />
							<span>{ssoBusy ? "Redirecting..." : "Continue with Google"}</span>
						</button>
					)}

					{showSso && showPassword && <div className="ops-login__divider">or</div>}

					{showPassword ? (
						<form onSubmit={handleFormSubmit} className="ops-login__form">
							<div className="ops-login__field">
								<label className="ops-login__label">
									<span dangerouslySetInnerHTML={{ __html: MAIL_SVG }} />
									Email
								</label>
								<input
									type="email"
									value={email}
									onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
									placeholder="you@century-nit.com"
									className="ops-login__input"
									required
									autoFocus
								/>
							</div>
							<PasswordField
								label={<><span dangerouslySetInnerHTML={{ __html: LOCK_SVG }} />Password</>}
								value={password}
								onChange={(v) => { setPassword(v); if (error) setError(null); }}
								placeholder="••••••••"
							/>
							<div className="ops-login__meta-row">
								<label className="ops-login__remember">
									<input
										type="checkbox"
										checked={rememberMe}
										onChange={(e) => setRememberMe(e.target.checked)}
									/>
									Keep me signed in
								</label>
								<Link to="/forgot-password" className="ops-login__back" style={{ margin: 0, width: "auto", padding: 0 }}>
									Forgot password?
								</Link>
							</div>
							{error ? (
								<p className="ops-login__error" role="alert">{error}</p>
							) : null}
							<button type="submit" disabled={loading || ssoBusy || !email || !password} className="btn btn--primary ops-login__submit">
								<span>{loading ? "Signing in…" : "Sign In"}</span>
								{loading ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
							</button>
						</form>
					) : (
						<div className="ops-login__notice">
							Password sign-in is turned off for this console. Use the sign-in method shown above, or contact your administrator.
						</div>
					)}
				</>
			)}
		</AuthShell>
	);
}
