import { Navigate, useNavigate, Link, useSearchParams } from "react-router-dom";
import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Field";
import { useAppState, type AuthMethod } from "../context/AppState";
import {
	signInWithEmail,
	signInWithGoogle,
	sendEmailCode,
	verifyEmailCode,
	verifyTotp,
	sendMfaEmailCode,
	verifyMfaEmailCode,
	verifyMfaBackupCode,
	fetchMfaMethod,
	requestPasswordReset,
	resetPassword,
	checkEmailExists,
	completeEmailSignup,
} from "../context/authStore";
import { getAuthSettings, type AuthSettingsResponse } from "../lib/api";
import { CHAPTERS } from "century-nit-shared";

/** Monochrome "G" — the four-color logo was the only color on the page. */
function GoogleMark() {
	return (
		<span className="auth-social__mark" aria-hidden>
			G
		</span>
	);
}

/**
 * Six boxed cells — typing auto-advances, paste splits across boxes, the
 * caller's auto-submit effect fires when the string reaches six digits.
 */
function OtpInput({
	id,
	value,
	onChange,
	disabled,
}: {
	id: string;
	value: string;
	onChange: (v: string) => void;
	disabled?: boolean;
}) {
	const refs = useRef<(HTMLInputElement | null)[]>([]);
	const cells = value.padEnd(6).slice(0, 6).split("");

	const setDigit = (i: number, d: string) => {
		const digits = d.replace(/\D/g, "");
		if (!digits) return;
		const next = (value.slice(0, i) + digits + value.slice(i + digits.length)).slice(0, 6);
		onChange(next);
		refs.current[Math.min(i + digits.length, 5)]?.focus();
	};

	const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Backspace") {
			e.preventDefault();
			if (cells[i] !== " ") {
				onChange(value.slice(0, i) + value.slice(i + 1));
			} else if (i > 0) {
				onChange(value.slice(0, i - 1) + value.slice(i));
				refs.current[i - 1]?.focus();
			}
		} else if (e.key === "ArrowLeft" && i > 0) {
			refs.current[i - 1]?.focus();
		} else if (e.key === "ArrowRight" && i < 5) {
			refs.current[i + 1]?.focus();
		}
	};

	const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
		e.preventDefault();
		const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
		if (!digits) return;
		onChange(digits);
		refs.current[Math.min(digits.length, 5)]?.focus();
	};

	return (
		<div className="otp-input" role="group" aria-labelledby={`${id}-label`}>
			{cells.map((c, i) => (
				<input
					key={i}
					ref={(el) => {
						refs.current[i] = el;
					}}
					id={i === 0 ? id : undefined}
					type="text"
					inputMode="numeric"
					autoComplete={i === 0 ? "one-time-code" : "off"}
					maxLength={6}
					className={`otp-input__cell${c !== " " ? " otp-input__cell--filled" : ""}`}
					value={c === " " ? "" : c}
					disabled={disabled}
					aria-label={`Digit ${i + 1} of 6`}
					onChange={(e) => setDigit(i, e.target.value)}
					onKeyDown={(e) => onKey(i, e)}
					onPaste={onPaste}
					onFocus={(e) => e.target.select()}
				/>
			))}
		</div>
	);
}

/**
 * The password checklist — appears only where a password is CHOSEN (signup,
 * reset), never on sign-in. Only length is enforced server-side
 * (`minPasswordLength: 12`); the other rows are suggestions that fill when
 * met but never block submit.
 */
function PwChecklist({ password, email, name }: { password: string; email: string; name: string }) {
	const pw = password.toLowerCase();
	const first = (name.trim().split(/\s+/)[0] ?? "").toLowerCase();
	const local = email.split("@")[0]?.toLowerCase() ?? "";
	const personal = pw.length > 0 && ((first.length >= 3 && pw.includes(first)) || (local.length >= 3 && pw.includes(local)));
	const words = password.trim().split(/\s+/).filter(Boolean).length;
	const rows: { met: boolean; label: string; required?: boolean }[] = [
		{ met: password.length >= 12, label: "12+ characters", required: true },
		{ met: password.length > 0 && !personal, label: "Not your name or email" },
		{ met: words >= 3, label: "A passphrase — 3+ words beats symbols" },
	];
	return (
		<div className="pwcheck">
			{rows.map((r) => (
				<div key={r.label} className={`pwcheck__row${r.met ? " pwcheck__row--met" : ""}`}>
					<span className="pwcheck__box" aria-hidden />
					{r.label}
					{r.required ? <span className="pwcheck__req">required</span> : null}
				</div>
			))}
		</div>
	);
}

type AuthStep = "signin" | "forgot" | "verify" | "set" | "done" | "mfa_otp" | "verify_email";

export function StartJourney() {
	const { isAuthenticated, signIn, sessionStatus, sessionError, clearSessionError } = useAppState();
	const nav = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
	const [authSettings, setAuthSettings] = useState<AuthSettingsResponse | null>(null);
	const [settingsLoading, setSettingsLoading] = useState(true);
	const [email, setEmail] = useState("");
	const [emailExists, setEmailExists] = useState<boolean | null>(null);
	const [password, setPassword] = useState("");
	const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
	const [otpCode, setOtpCode] = useState("");
	const [name, setName] = useState("");
	const [loading, setLoading] = useState(false);
	const [resendCooldown, setResendCooldown] = useState(0);
	const [mfaCode, setMfaCode] = useState("");
	/*
	 * Which second factor the user is answering with, and which they enrolled.
	 *
	 * The challenge window has no session, but the server can still read the
	 * signed two-factor cookie and report the enrolled method (mfaMethod) —
	 * null when the lookup fails, in which case every route stays reachable.
	 * mfaMode is the input currently on screen; it starts on the enrolled
	 * method and moves only through the escape links.
	 */
	const [mfaMode, setMfaMode] = useState<"totp" | "email" | "backup">("totp");
	const [mfaMethod, setMfaMethod] = useState<"totp" | "email_otp" | null>(null);
	/* Verify routes the sign-in response advertised (["totp","otp"] / ["otp"]). */
	const [mfaRoutes, setMfaRoutes] = useState<string[]>([]);
	const [mfaMaskedEmail, setMfaMaskedEmail] = useState<string | null>(null);
	const [mfaBackupCode, setMfaBackupCode] = useState("");
	const [trustDevice, setTrustDevice] = useState(false);
	/*
	 * "password" | "code" — the email-code sign-in is an inline alternative on
	 * the same panel, not a tab. Code mode only exists for sign-in; signup
	 * always needs a password (the OTP verifies the email afterwards).
	 */
	const [emailMode, setEmailMode] = useState<"password" | "code">("password");

	// Debounced real-time email existence check — shown on signup only; an
	// existing account is exactly who signs in, so sign-in paths don't flag it.
	useEffect(() => {
		const mail = email.trim().toLowerCase();
		if (!mail.includes("@")) {
			setEmailExists(null);
			return;
		}
		const timer = window.setTimeout(async () => {
			try {
				const exists = await checkEmailExists(mail);
				setEmailExists(exists);
			} catch {
				setEmailExists(null);
			}
		}, 350);
		return () => window.clearTimeout(timer);
	}, [email]);

	// Sign-up email verification OTP
	const [signupOtp, setSignupOtp] = useState("");
	const [signupEmail, setSignupEmail] = useState("");
	const [signupName, setSignupName] = useState("");

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

	const showSocial = s.portal.social_google;
	const showEmail = s.portal.email_password;
	const showOtp = s.portal.email_otp;
	// If passwords are disabled, code is the only email path left.
	const codeMode = authMode === "signin" && (emailMode === "code" || !showEmail);

	// Fetch auth settings
	useEffect(() => {
		let active = true;
		getAuthSettings()
			.then((st) => { if (active) setAuthSettings(st); })
			.catch(() => { /* Use defaults */ })
			.finally(() => { if (active) setSettingsLoading(false); });
		return () => { active = false; };
	}, []);

	/*
	 * Deep-link params on /start:
	 *   ?verified=true / ?error=… — the email-verification redirect.
	 *   ?token=…                  — the password-reset LINK carries the token;
	 *                               land straight on "choose a new password"
	 *                               instead of asking the user to paste a token
	 *                               the email never shows them.
	 */
	useEffect(() => {
		const verified = searchParams.get("verified");
		const verifyError = searchParams.get("error");
		const token = searchParams.get("token");
		if (token) {
			setResetCode(token);
			setStep("set");
			setSearchParams({}, { replace: true });
		} else if (verified === "true") {
			setVerificationBanner("verified");
			setSearchParams({}, { replace: true });
		} else if (verifyError) {
			setVerificationBanner("error");
			setSearchParams({}, { replace: true });
		}
	}, [searchParams, setSearchParams]);

	// Auto-verify the email OTP as soon as the user types the 6th digit — no
	// need to click "Continue". Skips while loading or after a prior error.
	useEffect(() => {
		if (otpCode.length !== 6 || !codeSentTo || loading) return;
		void onCodeSubmit({ preventDefault() {} } as FormEvent);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [otpCode]);

	// Auto-verify the sign-up email-verification OTP at 6 digits, same as the
	// passwordless flow above.
	useEffect(() => {
		if (signupOtp.length !== 6 || !signupEmail || loading || step !== "verify_email") return;
		void onSignupOtpSubmit();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [signupOtp]);

	// Resend cooldown ticker — counts down 30s to 0 so the button re-enables.
	useEffect(() => {
		if (resendCooldown <= 0) return;
		const t = window.setTimeout(() => setResendCooldown((s) => s - 1), 1_000);
		return () => window.clearTimeout(t);
	}, [resendCooldown]);

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
			if (typeof window !== "undefined") {
				sessionStorage.setItem("century_auth_provider", "google");
				localStorage.setItem("century_auth_provider", "google");
			}
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
		clearSessionError();
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

			if (authMode === "signin") {
				const data = await signInWithEmail({ email: mail, password });

				// Check if MFA is required via the Better Auth twoFactorRedirect.
				// Better Auth issues no session here — the user must provide a TOTP /
				// email-OTP code before they can continue. Transition to the mfa_otp
				// step so they can enter it, rather than dead-ending on an error.
				if ((data as Record<string, unknown>)?.twoFactorRedirect) {
					setLoading(false);
					setMfaCode("");
					setMfaBackupCode("");
					setMfaMode("totp");
					setMfaMethod(null);
					setMfaMaskedEmail(null);
					setTrustDevice(false);
					setError("");
					setStep("mfa_otp");
					void resolveMfaChallenge(
						(data as { twoFactorMethods?: string[] }).twoFactorMethods ?? [],
					);
					return;
				}

				const user = data?.user;
				if (!user) throw new Error("No user returned");
				const finalName = user.name || displayName;
				finish("email", finalName, user.email, user.id);
				return;
			}

			// Sign-up: do NOT call signUpEmail yet. That would create a zombie
			// user row with emailVerified=false the moment the user submits the
			// form, before they've proven they own the inbox. Instead, send a
			// sign-in type OTP to the email — the emailOTP plugin delivers it
			// even when no account exists — and move to the OTP entry step. The
			// account is only created in onSignupOtpSubmit after the OTP is
			// verified, via /api/auth/complete-email-signup.
			setSignupEmail(mail);
			setSignupName(displayName);
			setSignupOtp("");
			setError("");
			setStep("verify_email");
			setLoading(false);
			try {
				await sendEmailCode(mail);
				setResendCooldown(30);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not send verification code");
			}
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
			setResendCooldown(30);
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

	function switchEmailMode(mode: "password" | "code") {
		setEmailMode(mode);
		setCodeSentTo(null);
		setOtpCode("");
		setError("");
		clearSessionError();
	}

	/** Resend the email OTP code to the same address, with a cooldown. */
	async function resendCode() {
		if (!codeSentTo || resendCooldown > 0) return;
		setError("");
		setLoading(true);
		try {
			await sendEmailCode(codeSentTo);
			setResendCooldown(30);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not resend the code");
		} finally {
			setLoading(false);
		}
	}

	/**
	 * Verify the sign-up email-verification OTP, then sign in with the
	 * credentials the user just signed up with so they land in the portal
	 * without re-entering their password.
	 */
	async function onSignupOtpSubmit(e?: FormEvent) {
		e?.preventDefault();
		if (signupOtp.length !== 6 || !signupEmail) return;
		setError("");
		setLoading(true);
		try {
			// Verify the OTP and create the account in one server-side step.
			// The endpoint only creates the user after the OTP is verified, so
			// no zombie account is left behind if the user abandons the flow.
			const created = await completeEmailSignup({
				email: signupEmail,
				password,
				name: signupName || signupEmail.split("@")[0] || "Applicant",
				otp: signupOtp,
			});
			if (!created) throw new Error("Could not create account");
			// Account is created and emailVerified — sign in with the credentials.
			const data = await signInWithEmail({ email: signupEmail, password });
			const user = data?.user;
			if (!user) throw new Error("No user returned");
			finish("email", user.name || signupEmail, user.email || signupEmail, user.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : "That code was not accepted");
			setLoading(false);
			setSignupOtp("");
		}
	}

	/** Resend the sign-up verification OTP, with a cooldown. */
	async function resendSignupOtp() {
		if (!signupEmail || resendCooldown > 0) return;
		setError("");
		setLoading(true);
		try {
			// Resend the sign-in type OTP — no account exists yet to verify.
			await sendEmailCode(signupEmail);
			setResendCooldown(30);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not resend the code");
		} finally {
			setLoading(false);
		}
	}

	/**
	 * Ask the server which second factor this sign-in enrolled.
	 *
	 * There is no session yet — the signed two-factor cookie is the only proof
	 * the password passed — so this reads the method from `/api/auth/mfa/method`
	 * rather than an authenticated settings endpoint. An email-OTP enrollee then
	 * lands straight on the email challenge with the code already sent; anything
	 * unresolved keeps the authenticator input with every escape route intact.
	 */
	async function resolveMfaChallenge(availableRoutes: string[]) {
		setMfaRoutes(availableRoutes);
		let enrolled: "totp" | "email_otp" | null = null;
		try {
			const info = await fetchMfaMethod();
			if (info?.method) {
				enrolled = info.method;
				setMfaMethod(info.method);
				setMfaMaskedEmail(info.email ?? null);
			}
		} catch {
			// Endpoint unreachable — fall back to the advertised routes below.
		}
		/*
		 * When the endpoint can't say, the sign-in response still tells us
		 * which verify routes exist: an email-OTP enrollee gets ["otp"] only —
		 * their TOTP secret was armed but never verified — while a TOTP
		 * enrollee gets ["totp","otp"].
		 */
		if (!enrolled) {
			enrolled = !availableRoutes.includes("totp") && availableRoutes.includes("otp")
				? "email_otp"
				: null;
		}
		if (enrolled === "email_otp") {
			setMfaMode("email");
			try {
				await sendMfaEmailCode();
				setResendCooldown(30);
			} catch {
				// Delivery failed — the resend link below stays available.
			}
		}
	}

	/** Whether an authenticator exists to answer with — gates that escape link. */
	const mfaCanTotp = mfaMethod
		? mfaMethod === "totp"
		: mfaRoutes.length === 0 || mfaRoutes.includes("totp");

	/** Verify the second factor — authenticator, emailed code, or recovery code. */
	async function onMfaSubmit(e: FormEvent) {
		e.preventDefault();
		if (mfaMode === "backup") {
			if (!mfaBackupCode.trim()) return;
		} else if (mfaCode.length !== 6) {
			return;
		}
		setError("");
		setLoading(true);
		try {
			if (mfaMode === "backup") await verifyMfaBackupCode(mfaBackupCode.trim(), trustDevice);
			else if (mfaMode === "email") await verifyMfaEmailCode(mfaCode, trustDevice);
			else await verifyTotp(mfaCode, trustDevice);
			// After MFA verification the session is established — reload so
			// probeSession() picks up the cookie and RequireAuth admits us.
			window.location.href = "/portal";
		} catch (err) {
			setLoading(false);
			setError(err instanceof Error ? err.message : "That code was not accepted");
			setMfaCode("");
			setMfaBackupCode("");
		}
	}

	/** Switch the challenge to an emailed code and send the first one. */
	async function switchToEmailedCode() {
		setError("");
		setLoading(true);
		try {
			await sendMfaEmailCode();
			setMfaMode("email");
			setMfaCode("");
			setResendCooldown(30);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not send the code");
		} finally {
			setLoading(false);
		}
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
		if (newPassword.length < 12) {
			setError("New password must be at least 12 characters");
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

	const stepEyebrow =
		step === "signin" ? "Client portal"
			: step === "verify_email" ? "Check your inbox"
			: step === "mfa_otp" ? "Security check"
			: "Password reset";

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
							? "Enter the code"
							: step === "mfa_otp"
								? "Verify it's you"
								: authMode === "signin"
									? "Welcome back"
									: "Create your account";

	return (
		<div className="start-journey">
			<div className="start-journey__brand">
				<Link to="/" className="start-journey__logo">
					Century NIT <span>International</span>
				</Link>
				<div className="start-journey__brand-content">
					<h2 className="start-journey__brand-title">
						Your entire application journey — <em>in one place.</em>
					</h2>
					<p className="start-journey__brand-lead">
						One account tracks you from first consultation to departure. This is what the portal holds:
					</p>
					<div className="start-journey__chapters">
						{CHAPTERS.map((ch) => (
							<div key={ch.id} className="start-journey__chapter">
								<span className="n">{ch.numeral}</span>
								<span>{ch.label}</span>
								<span className="d">{ch.blurb}</span>
							</div>
						))}
					</div>
				</div>
				<p className="start-journey__brand-footer mono">
					Licensed consultancy — Accra · Kumasi · Takoradi · Tamale · Tema
				</p>
			</div>

			<div className="start-journey__form-side">
				<div className="start-journey__panel">
					<div className="start-journey__header">
						<p className="eyebrow">{stepEyebrow}</p>
						<h1 className="start-journey__title">{stepTitle}</h1>
						{step === "signin" ? (
							<p className="start-journey__sub">
								{authMode === "signin" ? "Sign in to pick up where you left off." : "One account for the whole journey — consultation to departure."}
							</p>
						) : step === "forgot" ? (
							<p className="start-journey__sub">
								We'll email a reset link to the address on your account.
							</p>
						) : step === "verify" ? (
							<p className="start-journey__sub">
								We emailed <strong>{resetEmail}</strong> a reset link — it opens this page ready for a new password. No link? Paste the token manually below.
							</p>
						) : step === "set" ? (
							<p className="start-journey__sub">
								The link in your email carried the token — you're straight to the step that matters{resetEmail ? <>, for <strong>{resetEmail}</strong></> : null}.
							</p>
						) : step === "verify_email" ? (
							<p className="start-journey__sub">
								We sent a 6-digit code to <strong>{signupEmail}</strong>. It expires shortly — the account only exists once the code checks out.
							</p>
						) : step === "mfa_otp" ? null : (
							<p className="start-journey__sub">
								You're all set — sign back in with your new password.
							</p>
						)}
					</div>

					{verificationBanner === "verified" ? (
						<div className="auth-note" role="status">
							Your email is verified. You can sign in now.
						</div>
					) : null}
					{verificationBanner === "error" ? (
						<div className="auth-error" role="alert">
							The verification link was invalid or expired. Please sign up again to request a new one.
						</div>
					) : null}

					{error || sessionError ? (
						<div className="auth-error" role="alert">
							{error || sessionError}
						</div>
					) : null}

					{step === "signin" ? (
						<>
							<div className="auth-tabs" role="tablist">
								<button
									type="button"
									role="tab"
									aria-selected={authMode === "signin"}
									className={`auth-tab${authMode === "signin" ? " auth-tab--active" : ""}`}
									onClick={() => { setAuthMode("signin"); setError(""); clearSessionError(); setEmailExists(null); }}
								>
									Sign in
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={authMode === "signup"}
									className={`auth-tab${authMode === "signup" ? " auth-tab--active" : ""}`}
									onClick={() => { setAuthMode("signup"); setError(""); clearSessionError(); setEmailExists(null); switchEmailMode("password"); }}
								>
									Create account
								</button>
							</div>

							{showSocial ? (
								<div className="auth-social">
									<button
										type="button"
										className="auth-social__btn"
										onClick={() => social("google")}
										disabled={loading}
									>
										<GoogleMark />
										{authMode === "signin" ? "Continue with Google" : "Sign up with Google"}
										<span className="auth-social__arrow" aria-hidden>→</span>
									</button>
								</div>
							) : null}

							{showSocial && (showEmail || (showOtp && authMode === "signin")) ? (
								<div className="auth-divider"><span>or with email</span></div>
							) : null}

							{codeMode ? (
								codeSentTo ? (
									<form className="auth-form" onSubmit={onCodeSubmit} noValidate>
										<div className="field">
											<label id="sj-code-label" htmlFor="sj-code">Enter the 6-digit code</label>
											<OtpInput
												id="sj-code"
												value={otpCode}
												onChange={setOtpCode}
												disabled={loading}
											/>
											<span className="hint">Sent to {codeSentTo}. It expires shortly.</span>
										</div>
										<Button type="submit" block arrow disabled={loading || otpCode.length !== 6}>
											{loading ? "Checking…" : "Continue"}
										</Button>
										<div className="auth-alt">
											<button
												type="button"
												className="auth-alt__link"
												onClick={resendCode}
												disabled={resendCooldown > 0 || loading}
											>
												{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
											</button>
											<button type="button" className="auth-alt__link" onClick={restartCode}>
												Use a different address
											</button>
											{showEmail ? (
												<button type="button" className="auth-alt__link" onClick={() => switchEmailMode("password")}>
													Use password instead
												</button>
											) : null}
										</div>
									</form>
								) : (
									<form className="auth-form" onSubmit={onOtp} noValidate>
										<Field
											label="Email"
											htmlFor="sj-otp-email"
											hint="We'll email you a one-time code — no password needed."
										>
											<Input
												id="sj-otp-email"
												type="email"
												autoComplete="email"
												value={email}
												onChange={(e) => { setEmail(e.target.value); setEmailExists(null); }}
												placeholder="you@example.com"
												fullBorder
											/>
										</Field>
										<Button type="submit" block arrow disabled={loading || !email.trim()}>
											{loading ? "Sending…" : "Email me a code"}
										</Button>
										{showEmail ? (
											<div className="auth-alt">
												<button type="button" className="auth-alt__link" onClick={() => switchEmailMode("password")}>
													Use password instead
												</button>
											</div>
										) : null}
									</form>
								)
							) : showEmail ? (
								<form className="auth-form" onSubmit={onEmail} noValidate>
									{authMode === "signup" && (
										<Field label="Full name" htmlFor="sj-name">
											<Input
												id="sj-name"
												type="text"
												autoComplete="name"
												value={name}
												onChange={(e) => setName(e.target.value)}
												placeholder="Enoch Yaw Enu"
												fullBorder
											/>
										</Field>
									)}
									<Field label="Email" htmlFor="sj-email" error={authMode === "signup" && emailExists ? "This email is already registered — switch to Sign in." : undefined}>
										<Input
											id="sj-email"
											type="email"
											autoComplete="email"
											value={email}
											onChange={(e) => { setEmail(e.target.value); setEmailExists(null); }}
											placeholder="you@example.com"
											fullBorder
										/>
									</Field>
									<Field label="Password" htmlFor="sj-pass">
										<Input
											id="sj-pass"
											type="password"
											autoComplete={authMode === "signin" ? "current-password" : "new-password"}
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											placeholder={authMode === "signup" ? "12+ characters" : "Your password"}
											fullBorder
										/>
										{authMode === "signup" ? (
											<>
												<PwChecklist password={password} email={email} name={name} />
												<span className="hint" style={{ display: "block", marginTop: "0.4rem" }}>
													A passphrase is easiest — "lamp boat cedar nine" beats "P@ssw0rd1".
												</span>
											</>
										) : null}
									</Field>
									<Button type="submit" block arrow disabled={loading || (authMode === "signup" && (password.length < 12 || emailExists === true))}>
										{loading ? (authMode === "signin" ? "Signing in…" : "Creating account…") : authMode === "signin" ? "Sign in" : "Create account"}
									</Button>
									{authMode === "signin" ? (
										<div className="auth-alt">
											{showOtp ? (
												<button type="button" className="auth-alt__link" onClick={() => switchEmailMode("code")}>
													Email me a code instead
												</button>
											) : <span />}
											<button
												type="button"
												className="auth-alt__link"
												onClick={() => {
													setResetEmail(email);
													setError("");
													setStep("forgot");
												}}
											>
												Forgot password?
											</button>
										</div>
									) : null}
								</form>
							) : null}
						</>
					) : null}

					{step === "forgot" ? (
						<form className="auth-form" onSubmit={onForgotSubmit} noValidate>
							<Field label="Email" htmlFor="sj-reset-email">
								<Input
									id="sj-reset-email"
									type="email"
									autoComplete="email"
									value={resetEmail}
									onChange={(e) => setResetEmail(e.target.value)}
									placeholder="you@example.com"
									fullBorder
								/>
							</Field>
							<Button type="submit" block arrow disabled={loading}>
								{loading ? "Sending…" : "Send reset link"}
							</Button>
							<button type="button" className="auth-back" onClick={backToSignIn}>
								← Back to sign in
							</button>
						</form>
					) : null}

					{step === "verify" ? (
						<form className="auth-form" onSubmit={onVerifySubmit} noValidate>
							<Field
								label="Reset token — manual entry"
								htmlFor="sj-reset-code"
								hint="Only needed if the email link didn't open this page for you."
							>
								<Input
									id="sj-reset-code"
									type="text"
									value={resetCode}
									onChange={(e) => setResetCode(e.target.value)}
									placeholder="Paste the token from the link"
									fullBorder
								/>
							</Field>
							<Button type="submit" block arrow disabled={loading}>
								Continue
							</Button>
							<button type="button" className="auth-back" onClick={back}>
								← Back
							</button>
						</form>
					) : null}

					{step === "set" ? (
						<form className="auth-form" onSubmit={onSetPassword} noValidate>
							<Field label="New password" htmlFor="sj-new-pass">
								<Input
									id="sj-new-pass"
									type="password"
									autoComplete="new-password"
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
									placeholder="12+ characters"
									fullBorder
								/>
								<PwChecklist password={newPassword} email={resetEmail} name="" />
								<span className="hint" style={{ display: "block", marginTop: "0.4rem" }}>
									Same bar as signup — 12 characters minimum.
								</span>
							</Field>
							<Field
								label="Confirm password"
								htmlFor="sj-confirm-pass"
								error={confirmPassword.length > 0 && newPassword !== confirmPassword ? "Passwords don't match yet" : undefined}
							>
								<Input
									id="sj-confirm-pass"
									type="password"
									autoComplete="new-password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									placeholder="Again"
									fullBorder
								/>
							</Field>
							<Button type="submit" block arrow disabled={loading || newPassword.length < 12 || newPassword !== confirmPassword}>
								{loading ? "Updating…" : "Update password"}
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

					{step === "verify_email" ? (
						<form className="auth-form" onSubmit={onSignupOtpSubmit} noValidate>
							<div className="field">
								<label id="sj-verify-otp-label" htmlFor="sj-verify-otp">Enter the 6-digit verification code</label>
								<OtpInput
									id="sj-verify-otp"
									value={signupOtp}
									onChange={setSignupOtp}
									disabled={loading}
								/>
								<span className="hint">Sent to {signupEmail}. It expires shortly.</span>
							</div>
							<Button type="submit" block arrow disabled={loading || signupOtp.length !== 6}>
								{loading ? "Verifying…" : "Verify email"}
							</Button>
							<div className="auth-alt">
								<button
									type="button"
									className="auth-alt__link"
									onClick={resendSignupOtp}
									disabled={resendCooldown > 0 || loading}
								>
									{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
								</button>
								<button type="button" className="auth-alt__link" onClick={backToSignIn}>
									Back to sign in
								</button>
							</div>
						</form>
					) : null}

					{step === "mfa_otp" ? (
						<form className="auth-form" onSubmit={onMfaSubmit} noValidate>
							{/* Who is being verified, and where they are in the flow. */}
							<div className="mfa-ident">
								<span className="mfa-ident__dot" aria-hidden />
								<span className="mfa-ident__mail">{email}</span>
								<span className="mfa-ident__step">Step 2 of 2</span>
							</div>

							{mfaMode === "backup" ? (
								<Field
									label="Recovery code"
									htmlFor="sj-mfa-backup"
									hint="One of the single-use codes you saved when you set up two-factor authentication."
								>
									<Input
										id="sj-mfa-backup"
										type="text"
										autoComplete="one-time-code"
										value={mfaBackupCode}
										onChange={(e) => setMfaBackupCode(e.target.value)}
										placeholder="xxxxx-xxxxx"
										fullBorder
									/>
								</Field>
							) : (
								<div className="field">
									<label id="sj-mfa-label" htmlFor="sj-mfa">
										{mfaMode === "email" ? "Email code" : "Authenticator app code"}
									</label>
									<OtpInput
										id="sj-mfa"
										value={mfaCode}
										onChange={setMfaCode}
										disabled={loading}
									/>
									<span className="hint">
										{mfaMode === "email" ? (
											<>
												Code sent the moment you signed in — check{" "}
												<strong>{mfaMaskedEmail ?? "your inbox"}</strong>. It expires in a
												few minutes.
											</>
										) : (
											"Open your authenticator app — the code refreshes every 30 seconds."
										)}
									</span>
								</div>
							)}

							<Button
								type="submit"
								block
								arrow
								disabled={
									loading ||
									(mfaMode === "backup" ? !mfaBackupCode.trim() : mfaCode.length !== 6)
								}
							>
								{loading ? "Verifying…" : "Verify"}
							</Button>

							<label className="mfa-trust">
								<input
									type="checkbox"
									checked={trustDevice}
									onChange={(e) => setTrustDevice(e.target.checked)}
									disabled={loading}
								/>
								Trust this device for 30 days
							</label>

							{/*
							 * Escape routes sit below the action — the methods you're NOT
							 * answering with, framed as recovery. "Use authenticator" only
							 * appears when an authenticator exists to use.
							 */}
							<div className="mfa-escrow">
								{mfaMode === "totp"
									? "Can't get to your authenticator?"
									: mfaMode === "email"
										? "Wrong inbox, or nothing arrived?"
										: "Recovery code not working?"}
							</div>
							<div className="auth-alt auth-alt--center">
								{mfaMode === "email" ? (
									<button
										type="button"
										className="auth-alt__link"
										onClick={switchToEmailedCode}
										disabled={loading || resendCooldown > 0}
									>
										{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
									</button>
								) : (
									<button
										type="button"
										className="auth-alt__link"
										onClick={switchToEmailedCode}
										disabled={loading}
									>
										Email me a code
									</button>
								)}
								{mfaMode !== "backup" ? (
									<button
										type="button"
										className="auth-alt__link"
										onClick={() => { setMfaMode("backup"); setError(""); setMfaCode(""); }}
										disabled={loading}
									>
										Use a recovery code
									</button>
								) : null}
								{mfaMode !== "totp" && mfaCanTotp ? (
									<button
										type="button"
										className="auth-alt__link"
										onClick={() => { setMfaMode("totp"); setError(""); setMfaBackupCode(""); }}
										disabled={loading}
									>
										Use authenticator
									</button>
								) : null}
							</div>
							<div className="auth-alt auth-alt--center" style={{ marginTop: "0.6rem" }}>
								<button type="button" className="auth-alt__link" onClick={backToSignIn}>
									← Back to sign in
								</button>
							</div>
						</form>
					) : null}

					{step === "signin" ? (
						<p className="start-journey__legal mono">
							By continuing you agree to our terms. Protected by two-factor authentication.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}
