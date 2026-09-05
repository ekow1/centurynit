import { useNavigate, Navigate, Link } from "react-router-dom";
import { useOpsAuth, ROLE_HOME } from "./OpsAuthContext";
import { useState, useEffect, useRef } from "react";
import { checkStaffEmail } from "../lib/api";
import { publicSiteUrl } from "../lib/publicSite";

const LOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const MAIL_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
const SEARCH_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const SHIELD_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

const NOT_STAFF_MESSAGE =
	"That email isn't linked to a Century NIT staff account. Check for typos, or ask your administrator to invite you.";

type EmailCheck = "idle" | "checking" | "ok" | "not-staff" | "error";

export function OpsLogin() {
	const { opsSignInWithCredentials, opsVerifyTwoFactor, opsVerifyEmailOtp, opsSendMfaOtp, opsUser, authInitializing } = useOpsAuth();
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [twoFactorRequired, setTwoFactorRequired] = useState(false);
	const [mfaMethod, setMfaMethod] = useState<string | null>(null);
	const [twoFactorCode, setTwoFactorCode] = useState("");
	const [useBackupCode, setUseBackupCode] = useState(false);
	const [otpSent, setOtpSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [resendCooldown, setResendCooldown] = useState(0);
	const [emailCheck, setEmailCheck] = useState<EmailCheck>("idle");

	// Debounced real-time check that the entered email belongs to an active
	// staff account, mirroring the forgot-password form. Late responses are
	// dropped so a fast typist never sees a stale verdict.
	const queryIdRef = useRef(0);
	useEffect(() => {
		const id = ++queryIdRef.current;
		const value = email.trim().toLowerCase();
		if (!/^[^@\s]+@[^@\s]+$/.test(value)) {
			setEmailCheck("idle");
			return;
		}
		setEmailCheck("checking");
		const timer = setTimeout(() => {
			checkStaffEmail(value)
				.then((res) => {
					if (queryIdRef.current !== id) return;
					setEmailCheck(res.isStaff ? "ok" : "not-staff");
				})
				.catch(() => {
					if (queryIdRef.current !== id) return;
					setEmailCheck("error");
				});
		}, 600);
		return () => clearTimeout(timer);
	}, [email]);

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
		if (emailCheck === "not-staff") {
			setError(NOT_STAFF_MESSAGE);
			return;
		}
		setError(null);
		setLoading(true);
		try {
			const res = await opsSignInWithCredentials(email, password);
			if (res.twoFactorRequired) {
				setTwoFactorRequired(true);
				setMfaMethod(res.mfaMethod ?? "totp");
				// If email OTP method, auto-send the code
				if (res.mfaMethod === "email_otp") {
					try {
						await opsSendMfaOtp();
						setOtpSent(true);
					} catch {
						// Code sending failed — user can retry
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

				<p className="ops-login__copy">Century NIT &copy; {new Date().getFullYear()} &middot; Operations Center</p>
			</div>

			{/* Right panel - login form */}
			<div className="ops-login__main">
				<div className="ops-login__card">
				{twoFactorRequired ? (
					<>
						<div className="ops-login__head">
							<h1 className="ops-login__title">Two-Factor Authentication</h1>
							<p className="ops-login__subtitle">
								{mfaMethod === "email_otp"
									? (otpSent
										? `Enter the 6-digit code sent to ${email}`
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

							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem", fontSize: "var(--text-xs)" }}>
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
										setTwoFactorCode("");
										setError(null);
										setOtpSent(false);
									}}
									className="ops-login__back"
									style={{ margin: 0 }}
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
									{emailCheck === "checking" ? (
										<p className="ops-login__hint">Checking…</p>
									) : emailCheck === "not-staff" ? (
										<p className="ops-login__error" role="alert">{NOT_STAFF_MESSAGE}</p>
									) : null}
								</div>
								<div className="ops-login__field">
									<label className="ops-login__label">
										<span dangerouslySetInnerHTML={{ __html: LOCK_SVG }} />
										Password
									</label>
									<input
										type="password"
										value={password}
										onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
										placeholder="••••••••"
										className="ops-login__input"
										required
									/>
								</div>
								{error ? (
									<p className="ops-login__error" role="alert">{error}</p>
								) : null}
							<button type="submit" disabled={loading || !email || !password} className="btn btn--primary ops-login__submit">
								<span>{loading ? "Signing in…" : "Sign In"}</span>
								{loading ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
							</button>
						</form>

						<div style={{ marginTop: "1rem", textAlign: "center" }}>
							<Link to="/forgot-password" className="ops-login__back" style={{ margin: 0 }}>
								Forgot password?
							</Link>
						</div>
					</>
				)}
				</div>

				<a href={publicSiteUrl()} className="ops-login__home">
					&larr; Back to public site
				</a>
			</div>
		</div>
	);
}
