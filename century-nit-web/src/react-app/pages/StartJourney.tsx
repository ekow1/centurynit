import { Navigate, useNavigate, Link, useSearchParams } from "react-router-dom";
import { useState, useEffect, type FormEvent } from "react";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Field";
import { useAppState, type AuthMethod } from "../context/AppState";
import {
	signInWithEmail,
	signUpWithEmail,
	signInWithGoogle,
	sendEmailCode,
	verifyEmailCode,
	requestPasswordReset,
	resetPassword,
	checkEmailExists,
} from "../context/authStore";
import { getAuthSettings, type AuthSettingsResponse } from "../lib/api";

function GoogleIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
			<path
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
				fill="#4285F4"
			/>
			<path
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
				fill="#34A853"
			/>
			<path
				d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
				fill="#FBBC05"
			/>
			<path
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
				fill="#EA4335"
			/>
		</svg>
	);
}

const FEATURES = [
	"Consultation booking",
	"University & program tracking",
	"Document vault",
	"Visa & payment timeline",
];

type AuthStep = "signin" | "forgot" | "verify" | "set" | "done" | "mfa_otp" | "verify_email";

export function StartJourney() {
	const { isAuthenticated, signIn, sessionStatus } = useAppState();
	const nav = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
	const [authSettings, setAuthSettings] = useState<AuthSettingsResponse | null>(null);
	const [settingsLoading, setSettingsLoading] = useState(true);
	const [email, setEmail] = useState("");
	const [emailExists, setEmailExists] = useState<boolean | null>(null);
	const [password, setPassword] = useState("");
	const [passwordTouched, setPasswordTouched] = useState(false);
	const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
	const [otpCode, setOtpCode] = useState("");
	const [name, setName] = useState("");
	const [loading, setLoading] = useState(false);

	// Password-reset flow
	const [step, setStep] = useState<AuthStep>("signin");
	const [resetEmail, setResetEmail] = useState("");
	const [resetCode, setResetCode] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [verificationBanner, setVerificationBanner] = useState<"verified" | "error" | null>(null);

	// Default settings (all enabled)
	const defaults: AuthSettingsResponse = {
		portal: { email_password: true, social_google: true, email_otp: true, mfa_required: true, mfa_methods: ["totp", "email_otp"] },
		ops: { email_password: true, google_sso: false, mfa_required: true, mfa_methods: ["totp", "email_otp"] },
	};
	const s = authSettings ?? defaults;

	// Which tabs to show
	const showSocial = s.portal.social_google;
	const showEmail = s.portal.email_password;
	const showOtp = s.portal.email_otp;

	// Build tab list
	type TabId = "social" | "email" | "otp";
	const tabs: [TabId, string][] = [];
	if (showSocial) tabs.push(["social", "Social"]);
	if (showEmail) tabs.push(["email", "Email & Password"]);
	if (showOtp) tabs.push(["otp", "Email Code"]);

	const [tab, setTab] = useState<TabId>("social");

	// Set initial tab to first available
	useEffect(() => {
		if (!authSettings) return;
		const first = tabs[0];
		if (first && !tabs.find(([id]) => id === tab)) {
			setTab(first[0]);
		}
	}, [authSettings]);

	// Fetch auth settings
	useEffect(() => {
		let active = true;
		getAuthSettings()
			.then((st) => { if (active) setAuthSettings(st); })
			.catch(() => { /* Use defaults */ })
			.finally(() => { if (active) setSettingsLoading(false); });
		return () => { active = false; };
	}, []);

	// Detect the redirect back from Better Auth's email verification endpoint.
	// On success it redirects to callbackURL with ?verified=true; on failure
	// it adds ?error=... . Show a banner and clear the param so a refresh
	// doesn't re-show it.
	useEffect(() => {
		const verified = searchParams.get("verified");
		const verifyError = searchParams.get("error");
		if (verified === "true") {
			setVerificationBanner("verified");
			setSearchParams({}, { replace: true });
		} else if (verifyError) {
			setVerificationBanner("error");
			setSearchParams({}, { replace: true });
		}
	}, [searchParams, setSearchParams]);

	if (sessionStatus === "checking" || settingsLoading) {
		return (
			<div className="route-loading" role="status" aria-live="polite">
				<span className="route-loading__spinner" aria-hidden="true" />
				<span className="sr-only">Loading...</span>
			</div>
		);
	}

	if (isAuthenticated) {
		return <Navigate to="/portal" replace />;
	}

	function finish(method: AuthMethod, name: string, mail: string, id?: string) {
		setLoading(false);
		signIn({ method, name, email: mail, id });
		nav("/portal", { replace: true });
	}

	async function social(_provider: "google") {
		try {
			setLoading(true);
			setError("");
			await signInWithGoogle();
		} catch (err) {
			setLoading(false);
			setError(err instanceof Error ? err.message : "Google sign-in failed");
		}
	}

	async function handleEmailBlur() {
		if (!email.includes("@")) return;
		const exists = await checkEmailExists(email);
		setEmailExists(exists);
	}

	async function onEmail(e: FormEvent) {
		e.preventDefault();
		const mail = email.trim().toLowerCase();
		setError("");
		if (!mail.includes("@")) {
			setError("Enter a valid email address");
			return;
		}

		const fallbackName = (mail.split("@")[0] || "Applicant").replace(/[._]/g, " ");
		const pretty = fallbackName.replace(/\b\w/g, (c) => c.toUpperCase());
		const displayName = name.trim() || pretty || "Applicant";

		if (authMode === "signup" && !name.trim()) {
			setError("Please enter your full name.");
			return;
		}

		try {
			setLoading(true);
			const data =
				authMode === "signin"
					? await signInWithEmail({ email: mail, password })
					: await signUpWithEmail({ email: mail, password, name: displayName });

			// Check if MFA is required via the Better Auth twoFactorRedirect
			if ((data as Record<string, unknown>)?.twoFactorRedirect) {
				// For now, we show the TOTP code input (Better Auth handles this)
				// In the future this can branch based on the user's mfa_method
				setLoading(false);
				setError("MFA verification required. Please use the ops console to set up your MFA method.");
				return;
			}

			const user = data?.user;
			if (!user) throw new Error("No user returned");

			// Sign-up with requireEmailVerification: true returns a user but no
			// session. Navigating to /portal would immediately bounce back to
			// /start because probeSession() finds no cookie. Show the "check
			// your email" state instead — the user clicks the verification link
			// in the email, lands back here with ?verified=true, then signs in.
			if (authMode === "signup" && !(data as Record<string, unknown>)?.session) {
				setResetEmail(mail);
				setLoading(false);
				setStep("verify_email");
				return;
			}

			const finalName = user.name || displayName;
			finish("email", finalName, user.email, user.id);
		} catch (err) {
			setLoading(false);
			setError(err instanceof Error ? err.message : "Authentication failed");
		}
	}

	/** Step 1 - send the email OTP code for passwordless login. */
	async function onOtp(e: FormEvent) {
		e.preventDefault();
		setError("");
		setLoading(true);
		try {
			const target = await sendEmailCode(email);
			setCodeSentTo(target);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not send the code");
		} finally {
			setLoading(false);
		}
	}

	/** Step 2 - verify the email OTP code. */
	async function onCodeSubmit(e: FormEvent) {
		e.preventDefault();
		if (!codeSentTo) return;
		setError("");
		setLoading(true);
		try {
			const result = await verifyEmailCode(codeSentTo, otpCode);
			const user = (result as { user?: { id?: string; name?: string; email?: string } } | null)?.user;
			finish(
				"otp",
				user?.name || codeSentTo,
				user?.email || codeSentTo,
				user?.id,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "That code was not accepted");
			setLoading(false);
		}
	}

	function restartCode() {
		setCodeSentTo(null);
		setOtpCode("");
		setError("");
	}

	async function onForgotSubmit(e: FormEvent) {
		e.preventDefault();
		const mail = resetEmail.trim().toLowerCase();
		setError("");
		if (!mail.includes("@")) {
			setError("Enter the email you signed in with");
			return;
		}
		try {
			setLoading(true);
			await requestPasswordReset(mail);
			setResetEmail(mail);
			setStep("verify");
		} catch (err) {
			setLoading(false);
			setError(err instanceof Error ? err.message : "Could not send reset email");
		}
	}

	function onVerifySubmit(e: FormEvent) {
		e.preventDefault();
		setError("");
		if (!resetCode.trim()) {
			setError("Paste the reset token from your email");
			return;
		}
		setStep("set");
	}

	async function onSetPassword(e: FormEvent) {
		e.preventDefault();
		setError("");
		if (newPassword.length < 8) {
			setError("New password must be at least 8 characters");
			return;
		}
		if (newPassword !== confirmPassword) {
			setError("Passwords don't match");
			return;
		}
		try {
			setLoading(true);
			await resetPassword({
				token: resetCode,
				newPassword,
				confirmPassword,
			});
			setStep("done");
		} catch (err) {
			setLoading(false);
			setError(err instanceof Error ? err.message : "Could not reset password");
		}
	}

	function backToSignIn() {
		setEmail(resetEmail || email);
		setPassword("");
		setError("");
		setStep("signin");
	}

	function back() {
		setError("");
		setStep(step === "verify" ? "forgot" : step === "set" ? "verify" : "signin");
	}

	if (loading) {
		return (
			<div className="loading-overlay">
				<div className="spinner" aria-hidden />
				<p className="mono">
					{step === "forgot" ? "Sending reset code..." : "Opening your dashboard..."}
				</p>
			</div>
		);
	}

	const stepTitle =
		step === "forgot"
			? "Reset your password"
			: step === "verify"
				? "Check your inbox"
				: step === "set"
					? "Choose a new password"
					: step === "done"
						? "Password updated"
						: step === "verify_email"
							? "Check your email"
							: "Start your journey";

	const stepEyebrow =
		step === "signin" ? (authMode === "signin" ? "Welcome back" : "Create an account") : step === "verify_email" ? "Account created" : "Password reset";

	return (
		<div className="start-journey">
			<div className="start-journey__brand">
				<Link to="/" className="start-journey__logo">
					Century NIT <span>International</span>
				</Link>
				<div className="start-journey__brand-content">
					<h2 className="start-journey__brand-title">
						Your entire application journey - <em>in one place.</em>
					</h2>
					<p className="start-journey__brand-lead">
						Consultation, school packages, admissions tracking, visa processing, and payments -
						unified in a single dashboard.
					</p>
					<ul className="start-journey__features">
						{FEATURES.map((f) => (
							<li key={f}>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
									<path
										d="M3 8.5l3.5 3.5L13 4.5"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="square"
									/>
								</svg>
								{f}
							</li>
						))}
					</ul>
				</div>
				<p className="start-journey__brand-footer mono">
					Licensed consultancy - Accra & Kumasi
				</p>
			</div>

			<div className="start-journey__form-side">
				<div className="start-journey__panel">
					<div className="start-journey__header">
						<p className="eyebrow">{stepEyebrow}</p>
						<h1 className="start-journey__title">{stepTitle}</h1>
						{step === "signin" ? (
							<p className="start-journey__sub">
								{authMode === "signin" ? "Sign in to access your dashboard." : "Create your account to start your application journey."}
							</p>
						) : step === "forgot" ? (
							<p className="start-journey__sub">
								We'll send a one-time reset code to the email on your account.
							</p>
						) : step === "verify" ? (
							<p className="start-journey__sub">
								Enter the 6-digit code we sent to <strong>{resetEmail}</strong>.
							</p>
						) : step === "set" ? (
							<p className="start-journey__sub">
								Pick a new password for <strong>{resetEmail}</strong>.
							</p>
						) : step === "verify_email" ? (
							<p className="start-journey__sub">
								We sent a verification link to <strong>{resetEmail}</strong>. Click it to activate your account, then sign in below.
							</p>
						) : (
							<p className="start-journey__sub">
								You're all set - sign back in with your new password.
							</p>
						)}
					</div>

					{verificationBanner === "verified" ? (
						<div className="auth-error" role="status" style={{ color: "var(--foreground)", borderColor: "var(--foreground)" }}>
							Your email is verified. You can sign in now.
						</div>
					) : null}
					{verificationBanner === "error" ? (
						<div className="auth-error" role="alert">
							The verification link was invalid or expired. Please sign up again to request a new one.
						</div>
					) : null}

					{error ? (
						<div className="auth-error" role="alert">
							{error}
						</div>
					) : null}

					{step === "signin" ? (
						<>
							<div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", borderBottom: "1px solid var(--border-light)" }}>
								<button
									type="button"
									onClick={() => { setAuthMode("signin"); setError(""); setPasswordTouched(false); setEmailExists(null); }}
									style={{
										padding: "0.5rem 1rem",
										borderBottom: authMode === "signin" ? "2px solid var(--primary)" : "2px solid transparent",
										color: authMode === "signin" ? "var(--primary)" : "var(--muted-foreground)",
										fontWeight: authMode === "signin" ? 600 : 400,
									}}
								>
									Log In
								</button>
								<button
									type="button"
									onClick={() => { setAuthMode("signup"); setError(""); setPasswordTouched(false); setEmailExists(null); }}
									style={{
										padding: "0.5rem 1rem",
										borderBottom: authMode === "signup" ? "2px solid var(--primary)" : "2px solid transparent",
										color: authMode === "signup" ? "var(--primary)" : "var(--muted-foreground)",
										fontWeight: authMode === "signup" ? 600 : 400,
									}}
								>
									Sign Up
								</button>
							</div>

							{tabs.length > 1 && (
								<div className="auth-tabs" role="tablist">
									{tabs.map(([id, label]) => (
										<button
											key={id}
											type="button"
											role="tab"
											aria-selected={tab === id}
											className={`auth-tab${tab === id ? " auth-tab--active" : ""}`}
											onClick={() => {
												setTab(id);
												setCodeSentTo(null);
												setOtpCode("");
												setError("");
												setEmailExists(null);
											}}
										>
											{label}
										</button>
									))}
								</div>
							)}

							{tab === "social" && showSocial ? (
								<div className="auth-social">
									<button
										type="button"
										className="auth-social__btn"
										onClick={() => social("google")}
									>
										<span className="auth-social__icon" aria-hidden>
											<GoogleIcon />
										</span>
										Continue with Google
									</button>
								</div>
							) : tab === "email" && showEmail ? (
								<form className="auth-form" onSubmit={onEmail} noValidate>
									{authMode === "signup" && (
										<Field label="Full Name" htmlFor="sj-name">
											<Input
												id="sj-name"
												type="text"
												value={name}
												onChange={(e) => setName(e.target.value)}
												placeholder="John Doe"
												fullBorder
											/>
										</Field>
									)}
									<Field label="Email" htmlFor="sj-email" error={authMode === "signup" && emailExists ? "This email is already registered. Please log in." : undefined}>
										<Input
											id="sj-email"
											type="email"
											value={email}
											onChange={(e) => { setEmail(e.target.value); setEmailExists(null); }}
											onBlur={handleEmailBlur}
											placeholder="you@example.com"
											fullBorder
										/>
									</Field>
									<Field
										label="Password"
										htmlFor="sj-pass"
										error={authMode === "signup" && passwordTouched && password.length < 12 ? "Password must be at least 12 characters" : undefined}
									>
										<Input
											id="sj-pass"
											type="password"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											onBlur={() => setPasswordTouched(true)}
											placeholder="••••••••"
											fullBorder
										/>
									</Field>
									<div className="auth-form__row">
										<Button type="submit" block arrow disabled={loading || (authMode === "signup" && (password.length < 12 || emailExists === true))}>
											{authMode === "signin" ? "Log in" : "Create account"}
										</Button>
										{authMode === "signin" && (
											<button
												type="button"
												className="auth-forgot"
												onClick={() => {
													setResetEmail(email);
													setError("");
													setStep("forgot");
												}}
											>
												Forgot password?
											</button>
										)}
									</div>
								</form>
							) : tab === "otp" && showOtp ? (
								codeSentTo ? (
									<form className="auth-form" onSubmit={onCodeSubmit} noValidate>
										<Field
											label="Enter the 6-digit code"
											htmlFor="sj-code"
											hint={`Sent to ${codeSentTo}. It expires shortly.`}
										>
											<Input
												id="sj-code"
												type="text"
												inputMode="numeric"
												autoComplete="one-time-code"
												maxLength={6}
												value={otpCode}
												onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
												placeholder="000000"
												fullBorder
											/>
										</Field>
										<Button type="submit" block arrow disabled={loading || otpCode.length !== 6}>
											{loading ? "Checking..." : "Continue"}
										</Button>
										<button type="button" className="start-journey__guest" onClick={restartCode}>
											Use a different address
										</button>
									</form>
								) : (
									<form className="auth-form" onSubmit={onOtp} noValidate>
										<Field
											label="Email Address"
											htmlFor="sj-otp-email"
											hint="We will email you a one-time code - no password needed."
											error={emailExists ? "This email is already registered. Please log in using a password." : undefined}
										>
											<Input
												id="sj-otp-email"
												type="email"
												autoComplete="email"
												value={email}
												onChange={(e) => { setEmail(e.target.value); setEmailExists(null); }}
												onBlur={handleEmailBlur}
												placeholder="you@example.com"
												fullBorder
											/>
										</Field>
										<Button type="submit" block arrow disabled={loading || !email.trim() || emailExists === true}>
											{loading ? "Sending..." : "Email me a code"}
										</Button>
									</form>
								)
							) : null}

							</>
					) : null}

					{step === "forgot" ? (
						<form className="auth-form" onSubmit={onForgotSubmit} noValidate>
							<Field label="Email" htmlFor="sj-reset-email">
								<Input
									id="sj-reset-email"
									type="email"
									value={resetEmail}
									onChange={(e) => setResetEmail(e.target.value)}
									placeholder="you@example.com"
									fullBorder
								/>
							</Field>
							<Button type="submit" block arrow>
								Send reset code
							</Button>
							<button type="button" className="auth-back" onClick={backToSignIn}>
								← Back to sign in
							</button>
						</form>
					) : null}

					{step === "verify" ? (
						<form className="auth-form" onSubmit={onVerifySubmit} noValidate>
							<Field
								label="Reset token"
								htmlFor="sj-reset-code"
								hint="Paste the reset token from your email"
							>
								<Input
									id="sj-reset-code"
									type="text"
									inputMode="numeric"
									value={resetCode}
									onChange={(e) => setResetCode(e.target.value)}
									placeholder="123456"
									fullBorder
								/>
							</Field>
							<Button type="submit" block arrow>
								Verify code
							</Button>
							<button type="button" className="auth-back" onClick={back}>
								← Back
							</button>
						</form>
					) : null}

					{step === "set" ? (
						<form className="auth-form" onSubmit={onSetPassword} noValidate>
							<Field label="New password" htmlFor="sj-new-pass" hint="At least 8 characters">
								<Input
									id="sj-new-pass"
									type="password"
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
									placeholder="••••••••"
									fullBorder
								/>
							</Field>
							<Field label="Confirm password" htmlFor="sj-confirm-pass">
								<Input
									id="sj-confirm-pass"
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									placeholder="••••••••"
									fullBorder
								/>
							</Field>
							<Button type="submit" block arrow>
								Update password
							</Button>
							<button type="button" className="auth-back" onClick={back}>
								← Back
							</button>
						</form>
					) : null}

					{step === "done" ? (
						<div className="auth-done">
							<p className="auth-done__mark" aria-hidden>
								Done
							</p>
							<p className="auth-done__text">
								Your password has been updated. Sign in with your new password to continue.
							</p>
							<Button block arrow onClick={backToSignIn}>
								Return to sign in
							</Button>
						</div>
					) : null}

					{step === "verify_email" ? (
						<div className="auth-done">
							<p className="auth-done__mark" aria-hidden>
								✉
							</p>
							<p className="auth-done__text">
								Check <strong>{resetEmail}</strong> for a verification link from Century NIT. Click it to activate your account, then return here to sign in.
							</p>
							<Button block arrow onClick={backToSignIn}>
								Return to sign in
							</Button>
						</div>
					) : null}

					{step === "signin" ? (
						<p className="start-journey__legal mono">
							By continuing you agree to our terms.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}
