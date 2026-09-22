import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import QRCode from "qrcode";
import {
	getMfaEnrollment,
	enrollMfa,
	confirmMfaOtp,
	type MfaEnrollmentStatus,
} from "../lib/api";
import { useOpsAuth, ROLE_HOME } from "./OpsAuthContext";
import { AuthShell } from "./AuthShell";
import { PasswordField } from "./PasswordField";

/**
 * Two-factor enrolment — supports both TOTP and Email OTP.
 *
 * The methods on offer come from `availableMethods` on GET
 * /auth-settings/mfa — the same list an admin trims in Settings ->
 * Authentication, and the same list the API enforces on enrol. Rendering
 * anything else would offer a method that fails at submit.
 *
 * Flow:
 *   1. If already enrolled, land on a manage view — not a dead "done" page —
 *      with the option to switch to another enabled method.
 *   2. Otherwise, method selection (only what is enabled), then:
 *      TOTP: password -> QR code -> verify -> backup codes -> done
 *      Email OTP: password -> verify -> done
 */

const authClient = createAuthClient({
	baseURL: typeof window === "undefined" ? "" : window.location.origin,
	basePath: "/api/auth",
	plugins: [twoFactorClient()],
});

type Step =
	| "loading"
	| "method"
	| "manage"
	| "totp-password"
	| "totp-verify"
	| "totp-codes"
	| "otp-password"
	| "otp-verify"
	| "done";

const METHOD_META: Record<string, { name: string; desc: string; icon: string }> = {
	totp: {
		name: "Authenticator App",
		desc: "Google Authenticator, Authy, 1Password — scan a QR code",
		icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>',
	},
	email_otp: {
		name: "Email One-Time Code",
		desc: "Get a 6-digit code sent to your email each time you sign in",
		icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>',
	},
};

export function MfaSetup() {
	const navigate = useNavigate();
	const { opsUser } = useOpsAuth();
	const [step, setStep] = useState<Step>("loading");
	const [status, setStatus] = useState<MfaEnrollmentStatus | null>(null);
	const [method, setMethod] = useState<"totp" | "email_otp">("totp");
	const [password, setPassword] = useState("");
	const [totpUri, setTotpUri] = useState("");
	const [qrDataUrl, setQrDataUrl] = useState<string>("");
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [otpSent, setOtpSent] = useState(false);

	const home = opsUser ? ROLE_HOME[opsUser.role] : "/";

	const secret = (() => {
		try {
			return new URL(totpUri).searchParams.get("secret") ?? "";
		} catch {
			return "";
		}
	})();

	// On mount, check if user is already enrolled and which methods are allowed
	useEffect(() => {
		let active = true;
		getMfaEnrollment()
			.then((s) => {
				if (!active) return;
				setStatus(s);
				if (s.enrolled && s.method) {
					// Manage view — not a dead end. The switch method control only
					// offers what is still enabled.
					setMethod(s.method === "email_otp" ? "email_otp" : "totp");
					setStep("manage");
				} else {
					const allowed = s.availableMethods.filter((m) => m === "totp" || m === "email_otp");
					if (allowed.length === 1) {
						setMethod(allowed[0] as "totp" | "email_otp");
						setStep(allowed[0] === "totp" ? "totp-password" : "otp-password");
					} else {
						setStep("method");
					}
				}
			})
			.catch(() => {
				if (active) setStep("method");
			});
		return () => { active = false; };
	}, []);

	// Generate QR code for TOTP
	useEffect(() => {
		if (!totpUri) {
			setQrDataUrl("");
			return;
		}
		let active = true;
		QRCode.toDataURL(totpUri, {
			width: 140,
			margin: 1,
			color: { dark: "#000000", light: "#ffffff" },
			errorCorrectionLevel: "M",
		})
			.then((url) => { if (active) setQrDataUrl(url); })
			.catch((err) => console.error("QR generation failed", err));
		return () => { active = false; };
	}, [totpUri]);

	function pickMethod(m: "totp" | "email_otp") {
		setMethod(m);
		setError(null);
		setPassword("");
		setCode("");
		setStep(m === "totp" ? "totp-password" : "otp-password");
	}

	const enabledMethods = (status?.availableMethods ?? ["totp", "email_otp"]).filter(
		(m): m is "totp" | "email_otp" => m === "totp" || m === "email_otp",
	);
	const alternativeMethods = enabledMethods.filter((m) => m !== status?.method);

	/* ── TOTP flow ── */

	async function beginTotp(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const result = await enrollMfa("totp", password);
			if (result.totpURI) {
				setTotpUri(result.totpURI);
				setBackupCodes(result.backupCodes ?? []);
				setStep("totp-verify");
			} else {
				throw new Error(result.message ?? "Could not start TOTP setup");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not start setup");
		} finally {
			setBusy(false);
		}
	}

	async function confirmTotp(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const cleanCode = code.trim().replace(/\D/g, "");
		if (cleanCode.length !== 6) {
			setError("Enter the complete 6-digit code from your authenticator app.");
			setBusy(false);
			return;
		}
		try {
			const { error: err } = await authClient.twoFactor.verifyTotp({ code: cleanCode });
			if (err) throw new Error(err.message ?? "Code not accepted");
			setStep("totp-codes");
		} catch (err) {
			// The stale-entry advice only makes sense when a code was actually
			// rejected — appending it to a network error sends people deleting
			// working authenticator entries.
			if (err instanceof Error && /code|invalid|otp/i.test(err.message)) {
				setError(`${err.message}. Delete any older "Century NIT" entry in your authenticator app and use the latest code.`);
			} else {
				setError(err instanceof Error ? err.message : "Code not accepted. Check your device clock.");
			}
		} finally {
			setBusy(false);
		}
	}

	/* ── Email OTP flow ── */

	async function beginOtp(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await enrollMfa("email_otp", password);
			setOtpSent(true);
			setStep("otp-verify");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not start setup");
		} finally {
			setBusy(false);
		}
	}

	async function resendOtp() {
		setBusy(true);
		setError(null);
		try {
			await enrollMfa("email_otp", password);
			setOtpSent(true);
			setCode("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not resend code");
		} finally {
			setBusy(false);
		}
	}

	async function confirmOtp(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const cleanCode = code.trim().replace(/\D/g, "");
		if (cleanCode.length !== 6) {
			setError("Enter the 6-digit code from your email.");
			setBusy(false);
			return;
		}
		try {
			await confirmMfaOtp(cleanCode);
			setStep("done");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Code not accepted");
		} finally {
			setBusy(false);
		}
	}

	/* ── Render ── */

	if (step === "loading") {
		return (
			<AuthShell>
				<div className="route-loading" role="status" aria-live="polite">
					<span className="route-loading__spinner" aria-hidden="true" />
				</div>
			</AuthShell>
		);
	}

	const eyebrow =
		step === "method" ? "Security Setup"
		: step === "manage" ? "Two-Factor Authentication"
		: step === "totp-password" ? "Step 1 of 3 · Authenticator Setup"
		: step === "totp-verify" ? "Step 2 of 3 · Scan & Verify"
		: step === "totp-codes" ? "Step 3 of 3 · Backup Recovery"
		: step === "otp-password" ? "Step 1 of 2 · Email OTP Setup"
		: step === "otp-verify" ? "Step 2 of 2 · Verify Code"
		: "Setup Complete";

	const title =
		step === "method" ? "Choose Your Security Method"
		: step === "manage" ? "Two-factor is on"
		: step.startsWith("totp") ? "Authenticator App"
		: step.startsWith("otp") ? "Email One-Time Code"
		: "You're All Set";

	return (
		<AuthShell>
			<p className="invite-card__eyebrow">{eyebrow}</p>
			<h1 id="mfa-title" className="ops-login__title" style={{ margin: "0 0 0.5rem" }}>{title}</h1>

			{error && <p className="ops-login__error" role="alert">{error}</p>}

			{/* Manage view — already enrolled */}
			{step === "manage" && (
				<div className="mfa-step-content">
					<p className="invite-card__body">
						Your account is protected by{" "}
						<strong>{status?.method === "email_otp" ? "email one-time codes" : "an authenticator app"}</strong>.
						{status?.required ? " Two-factor authentication is required for staff accounts." : ""}
					</p>
					{alternativeMethods.length > 0 && (
						<>
							<p className="mfa-step__desc">Switch to another method:</p>
							<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
								{alternativeMethods.map((m) => (
									<button key={m} type="button" className="auth-method" onClick={() => pickMethod(m)}>
										<span className="auth-method__icon" dangerouslySetInnerHTML={{ __html: METHOD_META[m].icon }} />
										<div>
											<div className="auth-method__name">{METHOD_META[m].name}</div>
											<div className="auth-method__desc">{METHOD_META[m].desc}</div>
										</div>
									</button>
								))}
							</div>
						</>
					)}
					<button type="button" className="btn btn--primary" onClick={() => navigate(home)} style={{ marginTop: "1rem" }}>
						Continue
					</button>
				</div>
			)}

			{/* Method selection */}
			{step === "method" && (
				<>
					<p className="invite-card__body">
						{status?.required
							? "Staff accounts require two-factor authentication to protect applicant records and sensitive financial data."
							: "Add a second factor to protect your account."}
						{" "}Choose how you'd like to receive your verification codes:
					</p>
					{enabledMethods.length === 0 ? (
						<p className="ops-login__notice">
							No verification methods are currently enabled. Contact your administrator.
						</p>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
							{enabledMethods.map((m) => (
								<button key={m} type="button" className="auth-method" onClick={() => pickMethod(m)}>
									<span className="auth-method__icon" dangerouslySetInnerHTML={{ __html: METHOD_META[m].icon }} />
									<div>
										<div className="auth-method__name">{METHOD_META[m].name}</div>
										<div className="auth-method__desc">{METHOD_META[m].desc}</div>
									</div>
								</button>
							))}
						</div>
					)}
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						onClick={() => navigate("/login")}
						style={{ marginTop: "1rem" }}
					>
						Back to sign in
					</button>
				</>
			)}

			{/* TOTP: Password confirmation */}
			{step === "totp-password" && (
				<>
					<p className="invite-card__body">
						Confirm your password to set up authenticator-based two-factor authentication.
					</p>
					<form className="ops-login__form" onSubmit={beginTotp}>
						<PasswordField
							id="mfa-password"
							label="Password"
							autoComplete="current-password"
							placeholder="Enter your current password"
							value={password}
							onChange={setPassword}
							autoFocus
						/>
						<div className="cal-actions">
							<button type="submit" className="btn btn--primary" disabled={busy || !password}>
								{busy ? "Confirming..." : "Continue to QR Code"}
							</button>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep(status?.enrolled ? "manage" : "method")}>
								Back
							</button>
						</div>
					</form>
				</>
			)}

			{/* TOTP: Scan & Verify */}
			{step === "totp-verify" && (
				<div className="mfa-verify-grid">
					<div className="mfa-qr-col">
						<div className="mfa-qr-frame">
							{qrDataUrl ? (
								<img src={qrDataUrl} alt="Scan QR code" className="mfa-qr-image" width={140} height={140} />
							) : (
								<div className="mfa-qr-placeholder">Generating...</div>
							)}
						</div>
						<button
							type="button"
							className="btn btn--ghost btn--sm mfa-copy-key-btn"
							onClick={() => {
								void navigator.clipboard.writeText(secret);
								setCopied(true);
								window.setTimeout(() => setCopied(false), 2000);
							}}
						>
							{copied ? "Key Copied!" : "Copy Setup Key"}
						</button>
					</div>
					<form onSubmit={confirmTotp} className="mfa-action-col">
						<p className="mfa-step__desc">
							Scan the QR code with your authenticator app, then enter the current 6-digit code.
						</p>
						<div className="field">
							<label htmlFor="mfa-code-input">Six-digit code</label>
							<input
								id="mfa-code-input"
								className="input input--full-border mfa-code"
								inputMode="numeric"
								autoComplete="one-time-code"
								pattern="[0-9]{6}"
								maxLength={6}
								placeholder="000000"
								value={code}
								onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
								required
								autoFocus
							/>
						</div>
						<button type="submit" className="btn btn--primary mfa-submit-btn" disabled={busy || code.length !== 6}>
							{busy ? "Checking..." : "Verify & Activate"}
						</button>
						<div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
							Ensure your device clock is set to Automatic Network Time.
						</div>
					</form>
				</div>
			)}

			{/* TOTP: Backup codes */}
			{step === "totp-codes" && (
				<div className="mfa-step-content">
					<p className="invite-card__body">
						Save these single-use recovery codes. <strong>This is the only time they are shown.</strong>
					</p>
					<ul className="mfa-codes">
						{backupCodes.map((c) => (
							<li key={c}><code>{c}</code></li>
						))}
					</ul>
					<div className="cal-actions" style={{ marginTop: "1.25rem" }}>
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							onClick={() => {
								void navigator.clipboard.writeText(backupCodes.join("\n"));
								setCopied(true);
								window.setTimeout(() => setCopied(false), 2000);
							}}
						>
							{copied ? "Copied!" : "Copy all codes"}
						</button>
						<button type="button" className="btn btn--primary" onClick={() => setStep("done")}>
							I have saved them — Continue
						</button>
					</div>
				</div>
			)}

			{/* Email OTP: Password confirmation */}
			{step === "otp-password" && (
				<>
					<p className="invite-card__body">
						Confirm your password to set up email-based two-factor authentication.
						You'll receive a 6-digit code each time you sign in.
					</p>
					<form className="ops-login__form" onSubmit={beginOtp}>
						<PasswordField
							id="otp-password"
							label="Password"
							autoComplete="current-password"
							placeholder="Enter your current password"
							value={password}
							onChange={setPassword}
							autoFocus
						/>
						<div className="cal-actions">
							<button type="submit" className="btn btn--primary" disabled={busy || !password}>
								{busy ? "Confirming..." : "Continue"}
							</button>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep(status?.enrolled ? "manage" : "method")}>
								Back
							</button>
						</div>
					</form>
				</>
			)}

			{/* Email OTP: Verify code */}
			{step === "otp-verify" && (
				<form className="ops-login__form" onSubmit={confirmOtp}>
					<p className="invite-card__body">
						{otpSent
							? "Enter the 6-digit code we just sent to your email."
							: "We'll send a code to your email to confirm setup."}
					</p>
					<div className="field">
						<label htmlFor="otp-code-input">Verification code</label>
						<input
							id="otp-code-input"
							className="input input--full-border mfa-code"
							inputMode="numeric"
							autoComplete="one-time-code"
							pattern="[0-9]{6}"
							maxLength={6}
							placeholder="000000"
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
							required
							autoFocus
						/>
					</div>
					<div className="cal-actions">
						<button type="submit" className="btn btn--primary" disabled={busy || code.length !== 6}>
							{busy ? "Verifying..." : "Verify & Activate"}
						</button>
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							onClick={() => { setCode(""); setError(null); resendOtp(); }}
							disabled={busy}
						>
							Resend code
						</button>
					</div>
				</form>
			)}

			{/* Done */}
			{step === "done" && (
				<div className="mfa-step-content">
					<p className="invite-card__body">
						Your two-factor authentication is now active. You'll use your {method === "totp" ? "authenticator app" : "email"} for future sign-ins.
					</p>
					<div className="cal-actions" style={{ marginTop: "1.25rem" }}>
						<button type="button" className="btn btn--primary" onClick={() => navigate(home)}>
							Continue
						</button>
					</div>
				</div>
			)}
		</AuthShell>
	);
}
