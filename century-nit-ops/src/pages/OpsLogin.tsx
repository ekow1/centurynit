import { useNavigate, Navigate, Link, useSearchParams } from "react-router-dom";
import { useOpsAuth, ROLE_HOME } from "./OpsAuthContext";
import { useState, useEffect } from "react";
import { getPendingMfaMethod } from "../lib/api";
import { AuthShell, AuthFeats, maskEmail } from "./AuthShell";
import { OtpInput } from "./OtpInput";
import { PasswordField } from "./PasswordField";

const LOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const MAIL_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

export function OpsLogin() {
	const { opsSignInWithCredentials, opsVerifyTwoFactor, opsVerifyEmailOtp, opsSendMfaOtp, opsUser, authInitializing } = useOpsAuth();
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [rememberMe, setRememberMe] = useState(true);
	const [twoFactorRequired, setTwoFactorRequired] = useState(false);
	const [mfaMethod, setMfaMethod] = useState<string | null>(null);
	const [mfaEmail, setMfaEmail] = useState<string | null>(null);
	const [twoFactorCode, setTwoFactorCode] = useState("");
	const [useBackupCode, setUseBackupCode] = useState(false);
	const [otpSent, setOtpSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [resendCooldown, setResendCooldown] = useState(0);
	// The idle guard lands here as /login?reason=idle — say why, don't pretend
	// it's a fresh visit.
	const [searchParams] = useSearchParams();
	const signedOutIdle = searchParams.get("reason") === "idle";
	// A session that resolved to no staff profile lands here with a flag the
	// API layer or auth context set — "deactivated" is a revoked account,
	// "provisioning" is an invited staff member whose ops row is missing.
	const [staffNotice] = useState<string | null>(() => {
		try {
			const v = sessionStorage.getItem("cn-ops-login-notice");
			sessionStorage.removeItem("cn-ops-login-notice");
			return v === "deactivated" || v === "provisioning" ? v : null;
		} catch {
			return null;
		}
	});
	// The idle guard records the live policy so this notice can quote it —
	// the login page itself has no session to re-read it from.
	const idleHours = (() => {
		try {
			const v = Number(localStorage.getItem("cn-ops-idle-hours"));
			return Number.isFinite(v) && v > 0 ? v : 2;
		} catch {
			return 2;
		}
	})();

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

	// #35: auto-submit the MFA form once the user types the full 6 digits.
	useEffect(() => {
		if (!twoFactorRequired || loading) return;
		if ((mfaMethod === "email_otp" || !useBackupCode) && twoFactorCode.length === 6) {
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

	async function handleTwoFactorSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			let user;
			if (mfaMethod === "email_otp") {
				user = await opsVerifyEmailOtp(twoFactorCode);
			} else {
				user = await opsVerifyTwoFactor(twoFactorCode, useBackupCode);
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

	const lockedOut = !!error && /lock|too many|temporar/i.test(error);
	const maskedWho = maskEmail(mfaEmail ?? email);

	function resetMfa() {
		setTwoFactorRequired(false);
		setMfaMethod(null);
		setMfaEmail(null);
		setTwoFactorCode("");
		setUseBackupCode(false);
		setError(null);
		setOtpSent(false);
	}

	return (
		<AuthShell
			aside={
				twoFactorRequired
					? {
							chip: "Step 2 of 2",
							label: "Two-factor check",
							title:
								mfaMethod === "email_otp" ? (
									<>A 6-digit code went to your <em>account email</em>.</>
								) : (
									<>The code is in your <em>authenticator</em>, under Century NIT Ops.</>
								),
							body:
								mfaMethod === "email_otp" ? (
									<AuthFeats
										items={[
											{ icon: "mail", text: <>The code lands at <strong>{maskedWho}</strong> and expires shortly.</> },
											{ icon: "eye", text: "Check spam if it hasn't arrived." },
											{ icon: "shield", text: <>Every sign-in is <strong>audited</strong>.</> },
										]}
									/>
								) : (
									<AuthFeats
										items={[
											{ icon: "refresh", text: "The code refreshes every 30 seconds." },
											{ icon: "code", text: <>A <strong>backup code</strong> works in place of the app.</> },
											{ icon: "user", text: "Lost the device? A manager resets MFA from the roster." },
										]}
									/>
								),
							footLeft: maskedWho,
						}
					: {
							chip: "Staff only",
							label: "Sign in",
							title: <>Every case, queue and ledger. Behind <em>two factors</em>.</>,
							body: (
								<AuthFeats
									items={[
										{ icon: "lock", text: "Credentials only. No social sign-in on the console." },
										{ icon: "shield", text: <>Two-factor required on <strong>every</strong> staff account.</> },
										{ icon: "mail", text: <>No account? <strong>Ask your manager.</strong> Staff are invited.</> },
									]}
								/>
							),
						}
			}
			card={
				twoFactorRequired
					? {
							barLeft: `${maskedWho} · verify`,
							barRight: mfaMethod === "email_otp" ? "Email code" : "Authenticator · TOTP",
							foot: (
								<>
									{mfaMethod !== "email_otp" ? (
										<button
											type="button"
											className="ops-login__footlink"
											onClick={() => {
												setUseBackupCode(!useBackupCode);
												setTwoFactorCode("");
												setError(null);
											}}
										>
											{useBackupCode ? "Use authenticator" : "Use a backup code"}
										</button>
									) : (
										<button
											type="button"
											className="ops-login__footlink"
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
										>
											{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
										</button>
									)}
									<button type="button" className="ops-login__footlink" onClick={resetMfa}>
										Back
									</button>
								</>
							),
						}
					: {
							barLeft: "Console access",
							barRight: "Step 1 of 2",
							foot: (
								<>
									<span>Locked out?</span>
									<Link to="/forgot-password">Reset via email</Link>
								</>
							),
						}
			}
		>
			{twoFactorRequired ? (
				<>
					<div className="ops-login__head">
						<span className="ops-login__badge">{mfaEmail ?? email}</span>
						<h1 className="ops-login__title">
							{mfaMethod === "email_otp" ? "Check your inbox" : "Verification code"}
						</h1>
						<p className="ops-login__subtitle">
							{mfaMethod === "email_otp"
								? otpSent
									? `A 6-digit code went to ${maskedWho}.`
									: "Sending you a verification code…"
								: useBackupCode
									? "Enter one of your single-use backup codes."
									: "From your authenticator app, under Century NIT Ops."}
						</p>
					</div>

					<form id="mfa-form" onSubmit={handleTwoFactorSubmit} className="ops-login__form">
						{error ? (
							lockedOut ? (
								<div className="ops-lockbox" role="alert">
									<div className="ops-lockbox__head">
										<span>Sign-in locked</span>
										<span>Logged</span>
									</div>
									<div className="ops-lockbox__body">
										{error} A manager can unlock you from Authentication → Events, or
										wait it out.
									</div>
								</div>
							) : (
								<p className="ops-login__error" role="alert">{error}</p>
							)
						) : null}

						{useBackupCode && mfaMethod !== "email_otp" ? (
							<div className="ops-login__field">
								<label className="ops-login__label">
									<span dangerouslySetInnerHTML={{ __html: LOCK_SVG }} />
									Backup recovery code
								</label>
								<input
									type="text"
									value={twoFactorCode}
									onChange={(e) => {
										if (error) setError(null);
										setTwoFactorCode(e.target.value.trim());
									}}
									placeholder="e.g. a1b2c3d4e5"
									maxLength={32}
									className="ops-login__input mono"
									required
									autoFocus
								/>
							</div>
						) : (
							<OtpInput
								id="mfa-otp"
								value={twoFactorCode}
								disabled={loading}
								onChange={(v) => {
									if (error) setError(null);
									setTwoFactorCode(v);
								}}
							/>
						)}

						<button type="submit" disabled={loading || !twoFactorCode} className="btn btn--primary ops-login__submit">
							<span>{loading ? "Verifying…" : "Verify & sign in"}</span>
							{loading ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
						</button>

					</form>
				</>
			) : (
				<>
					<div className="ops-login__head">
						<p className="ops-login__eyebrow">Welcome back</p>
						<h1 className="ops-login__title">Sign in</h1>
						<p className="ops-login__subtitle">
							Your staff credentials. The same email and password on file.
						</p>
					</div>

					<form onSubmit={handleFormSubmit} className="ops-login__form">
						{signedOutIdle ? (
							<div className="ops-login__idle" role="status">
								<span className="ops-login__idle-tag">Signed out</span>
								<span>
									Your session ended after {idleHours} {idleHours === 1 ? "hour" : "hours"} without
									activity. Sign back in to continue.
								</span>
							</div>
						) : null}
						{staffNotice ? (
							<div className="ops-login__idle" role="alert">
								<span className="ops-login__idle-tag">
									{staffNotice === "deactivated" ? "Access off" : "Setup"}
								</span>
								<span>
									{staffNotice === "deactivated"
										? "Your staff access has been deactivated — ask an administrator to re-enable it."
										: "Your account isn't set up for the console yet — open your invitation link, or ask an administrator to re-invite you."}
								</span>
							</div>
						) : null}
						{error ? (
							lockedOut ? (
								<div className="ops-lockbox" role="alert">
									<div className="ops-lockbox__head">
										<span>Account locked</span>
										<span>Logged</span>
									</div>
									<div className="ops-lockbox__body">
										{error} A manager can unlock you from Authentication → Events, or
										wait it out.
									</div>
								</div>
							) : (
								<p className="ops-login__error" role="alert">{error}</p>
							)
						) : null}
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
						<button type="submit" disabled={loading || !email || !password} className="btn btn--primary ops-login__submit">
							<span>{loading ? "Signing in…" : "Sign In"}</span>
							{loading ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
						</button>
					</form>
				</>
			)}
		</AuthShell>
	);
}
