import { Navigate, useNavigate, Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Field";
import { useAppState, type AuthMethod } from "../context/AppState";
import {
	signInWithEmail,
	signUpWithEmail,
	signInWithGoogle,
	sendPhoneCode,
	verifyPhoneCode,
	sendEmailCode,
	verifyEmailCode,
	requestPasswordReset,
	resetPassword,
} from "../context/authStore";

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

function AppleIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<path d="M17.05 12.04c.03 3.21 2.81 4.28 2.85 4.3-.03.08-.45 1.53-1.48 3.03-.89 1.3-1.82 2.6-3.28 2.62-1.43.03-1.89-.84-3.53-.84-1.64 0-2.15.81-3.5.87-1.41.05-2.48-1.41-3.38-2.7C2.6 16.71 1.15 12.93 2.7 10.36c.77-1.27 2.15-2.08 3.64-2.1 1.38-.03 2.68.93 3.53.93.85 0 2.44-1.15 4.12-.98.7.03 2.67.28 3.93 2.12-.1.06-2.35 1.37-2.32 4.08M14.3 6.93c.75-.91 1.26-2.18 1.12-3.44-1.08.04-2.39.72-3.17 1.63-.7.8-1.31 2.09-1.15 3.33 1.2.09 2.45-.61 3.2-1.52" />
		</svg>
	);
}

function LinkedInIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
		</svg>
	);
}

const PROVIDERS = [
	{ id: "google" as const, label: "Google", Icon: GoogleIcon },
	{ id: "apple" as const, label: "Apple", Icon: AppleIcon },
	{ id: "linkedin" as const, label: "LinkedIn", Icon: LinkedInIcon },
];

const FEATURES = [
	"Consultation booking",
	"University & program tracking",
	"Document vault",
	"Visa & payment timeline",
];

type AuthStep = "signin" | "forgot" | "verify" | "set" | "done";

export function StartJourney() {
	const { isAuthenticated, signIn, authUser } = useAppState();
	const nav = useNavigate();
	const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
	const [tab, setTab] = useState<"social" | "email" | "phone" | "otp">("social");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [phone, setPhone] = useState("");
	/** Set once a code has been sent, so the same tab shows the code step. */
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

	if (isAuthenticated) {
		return <Navigate to="/portal" replace />;
	}

	function finish(method: AuthMethod, name: string, mail: string, id?: string) {
		setLoading(false);
		signIn({ method, name, email: mail, id });
		nav("/portal", { replace: true });
	}

	async function social(provider: "google" | "apple" | "linkedin") {
		if (provider !== "google") {
			setError(`${provider} sign-in is not configured yet.`);
			return;
		}
		try {
			setLoading(true);
			setError("");
			await signInWithGoogle();
		} catch (err) {
			setLoading(false);
			setError(err instanceof Error ? err.message : "Google sign-in failed");
		}
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
			const user = data?.user;
			if (!user) throw new Error("No user returned");
			const finalName = user.name || displayName;
			finish("email", finalName, user.email, user.id);
		} catch (err) {
			setLoading(false);
			setError(err instanceof Error ? err.message : "Authentication failed");
		}
	}

	/** Step 1 — send the SMS code. */
	async function onPhone(e: FormEvent) {
		e.preventDefault();
		setError("");
		setLoading(true);
		try {
			setCodeSentTo(await sendPhoneCode(phone));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not send the code");
		} finally {
			setLoading(false);
		}
	}

	/** Step 1 — send the one-time email code. */
	async function onOtp(e: FormEvent) {
		e.preventDefault();
		setError("");
		setLoading(true);
		try {
			setCodeSentTo(await sendEmailCode(email));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not send the code");
		} finally {
			setLoading(false);
		}
	}

	/**
	 * Step 2 — exchange the code for a session.
	 *
	 * Both channels land here; which one is in play is decided by the tab, so
	 * there is one code form rather than two near-identical ones.
	 */
	async function onCodeSubmit(e: FormEvent) {
		e.preventDefault();
		if (!codeSentTo) return;
		setError("");
		setLoading(true);
		try {
			const result =
				tab === "phone"
					? await verifyPhoneCode(codeSentTo, otpCode)
					: await verifyEmailCode(codeSentTo, otpCode);

			const user = (result as { user?: { id?: string; name?: string; email?: string } } | null)?.user;
			finish(
				tab === "phone" ? "phone" : "otp",
				user?.name || codeSentTo,
				user?.email || codeSentTo,
				user?.id,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "That code was not accepted");
			setLoading(false);
		}
	}

	/** Leave the code step to correct a mistyped number or address. */
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
					{step === "forgot" ? "Sending reset code…" : "Opening your dashboard…"}
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
						: "Start your journey";

	const stepEyebrow =
		step === "signin" ? (authMode === "signin" ? "Welcome back" : "Create an account") : "Password reset";

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
					Licensed consultancy · Accra & Kumasi
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
						) : (
							<p className="start-journey__sub">
								You're all set - sign back in with your new password.
							</p>
						)}
					</div>

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
									onClick={() => { setAuthMode("signin"); setError(""); }}
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
									onClick={() => { setAuthMode("signup"); setError(""); }}
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

							<div className="auth-tabs" role="tablist">
								{(
									[
										["social", "Social"],
										["email", "Email & Password"],
										["phone", "Phone (OTP)"],
										["otp", "Email Code"],
									] as const
								).map(([id, label]) => (
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
										}}
									>
										{label}
									</button>
								))}
							</div>

							{tab === "social" ? (
								<div className="auth-social">
									{PROVIDERS.map(({ id, label, Icon }) => (
										<button
											key={id}
											type="button"
											className="auth-social__btn"
											onClick={() => social(id)}
										>
											<span className="auth-social__icon" aria-hidden>
												<Icon />
											</span>
											Continue with {label}
										</button>
									))}
									<p className="auth-social__note mono">Mockup · no real accounts</p>
								</div>
							) : tab === "email" ? (
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
									<Field label="Email" htmlFor="sj-email">
										<Input
											id="sj-email"
											type="email"
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											placeholder="you@example.com"
											fullBorder
										/>
									</Field>
									<Field
										label="Password"
										htmlFor="sj-pass"
									>
										<Input
											id="sj-pass"
											type="password"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											placeholder="••••••••"
											fullBorder
										/>
									</Field>
									<div className="auth-form__row">
										<Button type="submit" block arrow>
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
							) : codeSentTo ? (
								/* One code step serves both channels — the tab decides which. */
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
										{loading ? "Checking…" : "Continue"}
									</Button>
									<button type="button" className="start-journey__guest" onClick={restartCode}>
										Use a different {tab === "phone" ? "number" : "address"}
									</button>
								</form>
							) : tab === "phone" ? (
								<form className="auth-form" onSubmit={onPhone} noValidate>
									<Field
										label="Phone Number"
										htmlFor="sj-phone"
										hint="International format, e.g. +233 24 123 4567. We will text you a code."
									>
										<Input
											id="sj-phone"
											type="tel"
											autoComplete="tel"
											value={phone}
											onChange={(e) => setPhone(e.target.value)}
											placeholder="+233 24 123 4567"
											fullBorder
										/>
									</Field>
									<Button type="submit" block arrow disabled={loading || !phone.trim()}>
										{loading ? "Sending…" : "Send code by SMS"}
									</Button>
								</form>
							) : (
								<form className="auth-form" onSubmit={onOtp} noValidate>
									<Field
										label="Email Address"
										htmlFor="sj-otp-email"
										hint="We will email you a one-time code — no password needed."
									>
										<Input
											id="sj-otp-email"
											type="email"
											autoComplete="email"
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											placeholder="you@example.com"
											fullBorder
										/>
									</Field>
									<Button type="submit" block arrow disabled={loading || !email.trim()}>
										{loading ? "Sending…" : "Email me a code"}
									</Button>
								</form>
							)}

							<div className="start-journey__divider" />

							<button
								type="button"
								className="start-journey__guest"
								onClick={() =>
									finish("email", authUser?.name || "Guest Explorer", "guest@centurynit.example")
								}
							>
								Skip as guest →
							</button>
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
								✓
							</p>
							<p className="auth-done__text">
								Your password has been updated. Sign in with your new password to continue.
							</p>
							<Button block arrow onClick={backToSignIn}>
								Return to sign in
							</Button>
						</div>
					) : null}

					{step === "signin" ? (
						<p className="start-journey__legal mono">
							By continuing you agree to our terms. This is a prototype - no real data is stored.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}
