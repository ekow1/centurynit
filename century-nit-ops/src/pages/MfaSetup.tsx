import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import QRCode from "qrcode";
import {
	getMfaEnrollment,
	enrollMfa,
	confirmMfaOtp,
	sendMfaOtp,
} from "../lib/api";

/**
 * Two-factor enrolment — supports both TOTP and Email OTP.
 *
 * Flow:
 *   1. If already enrolled (method known), skip to verification
 *   2. Otherwise, show method selection (TOTP or Email OTP)
 *   3. For TOTP: password → QR code → verify → backup codes → done
 *   4. For Email OTP: password → send code → verify → done
 */

const authClient = createAuthClient({
	baseURL: typeof window === "undefined" ? "" : window.location.origin,
	basePath: "/api/auth",
	plugins: [twoFactorClient()],
});

type Step =
	| "loading"
	| "method"
	| "totp-password"
	| "totp-verify"
	| "totp-codes"
	| "otp-password"
	| "otp-send"
	| "otp-verify"
	| "done";

export function MfaSetup() {
	const navigate = useNavigate();
	const [step, setStep] = useState<Step>("loading");
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

	const secret = (() => {
		try {
			return new URL(totpUri).searchParams.get("secret") ?? "";
		} catch {
			return "";
		}
	})();

	// On mount, check if user is already enrolled and which method they use
	useEffect(() => {
		let active = true;
		getMfaEnrollment()
			.then((s) => {
				if (!active) return;
				if (s.enrolled && s.method) {
					// Already enrolled — shouldn't be here, but handle gracefully
					setStep("done");
				} else {
					setStep("method");
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
			setError(
				err instanceof Error
					? `${err.message}. Delete any older "Century NIT" entry in your authenticator app and use the latest code.`
					: "Code not accepted. Check your device clock.",
			);
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
			setStep("otp-send");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not start setup");
		} finally {
			setBusy(false);
		}
	}

	async function sendOtpCode() {
		setBusy(true);
		setError(null);
		try {
			await sendMfaOtp();
			setOtpSent(true);
			setStep("otp-verify");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not send code");
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
			<div className="invite-page mfa-page">
				<div className="invite-card mfa-card">
					<div className="route-loading" role="status" aria-live="polite">
						<span className="route-loading__spinner" aria-hidden="true" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="invite-page mfa-page">
			<div
				className={`invite-card mfa-card ${step === "totp-verify" ? "mfa-card--wide" : ""}`}
				role="region"
				aria-labelledby="mfa-title"
			>
				<p className="invite-card__eyebrow">
					{step === "method" && "Security Setup"}
					{step === "totp-password" && "Step 1 of 3 · Authenticator Setup"}
					{step === "totp-verify" && "Step 2 of 3 · Scan & Verify"}
					{step === "totp-codes" && "Step 3 of 3 · Backup Recovery"}
					{step === "otp-password" && "Step 1 of 2 · Email OTP Setup"}
					{step === "otp-send" && "Step 2 of 2 · Send Code"}
					{step === "otp-verify" && "Step 2 of 2 · Verify Code"}
					{step === "done" && "Setup Complete"}
				</p>

				<h1 id="mfa-title" className="invite-card__title">
					{step === "method" && "Choose Your Security Method"}
					{step.startsWith("totp") && "Authenticator App"}
					{step.startsWith("otp") && "Email One-Time Code"}
					{step === "done" && "You're All Set"}
				</h1>

				{error && <p className="ops-modal__error">{error}</p>}

				{/* Method selection */}
				{step === "method" && (
					<>
						<p className="invite-card__body">
							Staff accounts require two-factor authentication to protect applicant records and sensitive financial data.
							Choose how you'd like to receive your verification codes:
						</p>
						<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
							<button
								type="button"
								onClick={() => { setMethod("totp"); setStep("totp-password"); }}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "1rem",
									padding: "1rem",
									border: "2px solid var(--border)",
									background: "var(--surface)",
									cursor: "pointer",
									textAlign: "left",
								}}
							>
								<span style={{ fontSize: "1.5rem" }}>
									<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
										<line x1="12" y1="18" x2="12.01" y2="18" />
									</svg>
								</span>
								<div>
									<div style={{ fontWeight: 600 }}>Authenticator App</div>
									<div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)" }}>
										Google Authenticator, Authy, 1Password — scan a QR code
									</div>
								</div>
							</button>
							<button
								type="button"
								onClick={() => { setMethod("email_otp"); setStep("otp-password"); }}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "1rem",
									padding: "1rem",
									border: "2px solid var(--border)",
									background: "var(--surface)",
									cursor: "pointer",
									textAlign: "left",
								}}
							>
								<span style={{ fontSize: "1.5rem" }}>
									<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
										<polyline points="22,6 12,13 2,6" />
									</svg>
								</span>
								<div>
									<div style={{ fontWeight: 600 }}>Email One-Time Code</div>
									<div style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)" }}>
										Get a 6-digit code sent to your email each time you sign in
									</div>
								</div>
							</button>
						</div>
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
						<form className="invite-form" onSubmit={beginTotp}>
							<div className="field">
								<label htmlFor="mfa-password">Password</label>
								<input
									id="mfa-password"
									type="password"
									className="input input--full-border"
									autoComplete="current-password"
									placeholder="Enter your current password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									autoFocus
								/>
							</div>
							<div className="cal-actions">
								<button type="submit" className="btn btn--primary" disabled={busy || !password}>
									{busy ? "Confirming..." : "Continue to QR Code"}
								</button>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep("method")}>
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
							<div style={{ marginTop: "1rem", fontSize: "var(--text-xs)", color: "var(--muted)" }}>
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
						<form className="invite-form" onSubmit={beginOtp}>
							<div className="field">
								<label htmlFor="otp-password">Password</label>
								<input
									id="otp-password"
									type="password"
									className="input input--full-border"
									autoComplete="current-password"
									placeholder="Enter your current password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									autoFocus
								/>
							</div>
							<div className="cal-actions">
								<button type="submit" className="btn btn--primary" disabled={busy || !password}>
									{busy ? "Confirming..." : "Continue"}
								</button>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep("method")}>
									Back
								</button>
							</div>
						</form>
					</>
				)}

				{/* Email OTP: Send code */}
				{step === "otp-send" && (
					<>
						<p className="invite-card__body">
							We'll send a one-time code to your email to confirm your email MFA setup works.
						</p>
						<div className="cal-actions">
							<button type="button" className="btn btn--primary" onClick={sendOtpCode} disabled={busy}>
								{busy ? "Sending..." : "Send verification code"}
							</button>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep("otp-password")}>
								Back
							</button>
						</div>
					</>
				)}

				{/* Email OTP: Verify code */}
				{step === "otp-verify" && (
					<form className="invite-form" onSubmit={confirmOtp}>
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
								onClick={() => { setCode(""); setError(null); sendOtpCode(); }}
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
							<button type="button" className="btn btn--primary" onClick={() => window.location.assign("/dashboard")}>
								Continue to Dashboard
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
