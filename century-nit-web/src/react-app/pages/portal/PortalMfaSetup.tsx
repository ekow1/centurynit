import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import QRCode from "qrcode";
import {
	getMfaEnrollment,
	enrollMfa,
	confirmMfaOtp,
	type MfaEnrollmentStatus,
} from "../../lib/api";

/**
 * Two-factor setup for portal clients — optional, recommended.
 *
 * Mirrors the ops MfaSetup flow but lives behind /portal/security so clients
 * can enrol at their own pace. The backend endpoints are shared
 * (/auth-settings/mfa/*), so the same TOTP and Email OTP methods work here.
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
	| "otp-verify"
	| "done";

export function PortalMfaSetup() {
	const nav = useNavigate();
	const [step, setStep] = useState<Step>("loading");
	const [status, setStatus] = useState<MfaEnrollmentStatus | null>(null);
	const [method, setMethod] = useState<"totp" | "email_otp">("totp");
	const [password, setPassword] = useState("");
	const [totpUri, setTotpUri] = useState("");
	const [qrDataUrl, setQrDataUrl] = useState("");
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

	useEffect(() => {
		let active = true;
		getMfaEnrollment()
			.then((s) => {
				if (!active) return;
				setStatus(s);
				setStep(s.enrolled ? "done" : "method");
			})
			.catch(() => {
				if (active) setStep("method");
			});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		if (!totpUri) {
			setQrDataUrl("");
			return;
		}
		let active = true;
		QRCode.toDataURL(totpUri, {
			width: 160,
			margin: 1,
			color: { dark: "#000000", light: "#ffffff" },
			errorCorrectionLevel: "M",
		})
			.then((url) => {
				if (active) setQrDataUrl(url);
			})
			.catch((err) => console.error("QR generation failed", err));
		return () => {
			active = false;
		};
	}, [totpUri]);

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

	if (step === "loading") {
		return (
			<div className="portal-section" style={{ maxWidth: 540 }}>
				<div className="route-loading" role="status" aria-live="polite">
					<span className="route-loading__spinner" aria-hidden="true" />
				</div>
			</div>
		);
	}

	/*
	 * This page is reachable by direct URL, so the guard belongs here and not
	 * only on the links into it. Without a stored password there is nothing for
	 * a second factor to protect — and enrolment asks for that very password, so
	 * the wizard could never complete. Explain rather than show a dead end.
	 *
	 * Anyone already enrolled keeps the full page regardless, so a second factor
	 * can always be inspected and changed by the person who set it up.
	 */
	if (status?.applicable === false && !status.enrolled) {
		return (
			<div className="portal-section" style={{ maxWidth: 560 }}>
				<Link to="/portal/profile" className="link-arrow" style={{ marginBottom: "1rem", display: "inline-block" }}>
					← Back to profile
				</Link>
				<p className="eyebrow">Security</p>
				<h1 className="page-title mt-1">Two-factor authentication</h1>
				<div className="card mt-4" style={{ padding: "1.5rem" }}>
					<p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
						This doesn't apply to your account
					</p>
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
						You sign in without a Century NIT password, so there is no password here
						for a second step to protect. Your account is secured by whichever
						provider you sign in with — add two-factor authentication there instead.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="portal-section" style={{ maxWidth: 560 }}>
			<Link to="/portal/profile" className="link-arrow" style={{ marginBottom: "1rem", display: "inline-block" }}>
				← Back to profile
			</Link>
			<p className="eyebrow">Security</p>
			<h1 className="page-title mt-1">Two-factor authentication</h1>
			<p className="lead mt-2" style={{ marginBottom: "1.5rem" }}>
				Add a second layer of security to your account. We recommend it — your application documents and
				payment history are sensitive, and MFA stops anyone else from signing in even if they learn your
				password.
			</p>

			{error ? <div className="auth-error" role="alert">{error}</div> : null}

			{step === "done" && status?.enrolled ? (
				<div className="card" style={{ padding: "1.5rem" }}>
					<p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>MFA is active on your account</p>
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
						{status.method === "totp"
							? "You're using an authenticator app. You'll enter a 6-digit code each time you sign in."
							: status.method === "email_otp"
								? "You're using email one-time codes. We'll email you a 6-digit code each time you sign in."
								: "Two-factor authentication is enabled."}
					</p>
				</div>
			) : null}

			{step === "method" && (
				<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
					<button
						type="button"
						onClick={() => {
							setMethod("totp");
							setStep("totp-password");
						}}
						className="portal-mfa-option"
					>
						<span className="portal-mfa-option__icon" aria-hidden>
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
								<line x1="12" y1="18" x2="12.01" y2="18" />
							</svg>
						</span>
						<span className="portal-mfa-option__body">
							<span className="portal-mfa-option__title">Authenticator app</span>
							<span className="portal-mfa-option__sub">Google Authenticator, Authy, 1Password — scan a QR code</span>
						</span>
					</button>
					<button
						type="button"
						onClick={() => {
							setMethod("email_otp");
							setStep("otp-password");
						}}
						className="portal-mfa-option"
					>
						<span className="portal-mfa-option__icon" aria-hidden>
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
								<polyline points="22,6 12,13 2,6" />
							</svg>
						</span>
						<span className="portal-mfa-option__body">
							<span className="portal-mfa-option__title">Email one-time code</span>
							<span className="portal-mfa-option__sub">Get a 6-digit code emailed each sign-in</span>
						</span>
					</button>
				</div>
			)}

			{step === "totp-password" && (
				<form className="auth-form" onSubmit={beginTotp} noValidate>
					<p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "1rem" }}>
						Confirm your password to set up authenticator-based two-factor authentication.
					</p>
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
			)}

			{step === "totp-verify" && (
				<div className="mfa-verify-grid">
					<div className="mfa-qr-col">
						<div className="mfa-qr-frame">
							{qrDataUrl ? (
								<img src={qrDataUrl} alt="Scan QR code" className="mfa-qr-image" width={160} height={160} />
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
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
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
						<button type="submit" className="btn btn--primary" disabled={busy || code.length !== 6}>
							{busy ? "Checking..." : "Verify & Activate"}
						</button>
					</form>
				</div>
			)}

			{step === "totp-codes" && (
				<div>
					<p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "1rem" }}>
						Save these single-use recovery codes. <strong>This is the only time they are shown.</strong>
					</p>
					<ul className="mfa-codes">
						{backupCodes.map((c) => (
							<li key={c}>
								<code>{c}</code>
							</li>
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

			{step === "otp-password" && (
				<form className="auth-form" onSubmit={beginOtp} noValidate>
					<p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "1rem" }}>
						Confirm your password to set up email-based two-factor authentication. You'll receive a
						6-digit code each time you sign in.
					</p>
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
			)}


			{step === "otp-verify" && (
				<form className="auth-form" onSubmit={confirmOtp} noValidate>
					<p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "1rem" }}>
						{otpSent ? "Enter the 6-digit code we just sent to your email." : "We'll send a code to your email to confirm setup."}
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
							onClick={() => {
								setCode("");
								setError(null);
								void resendOtp();
							}}
							disabled={busy}
						>
							Resend code
						</button>
					</div>
				</form>
			)}

			{step === "done" && !status?.enrolled && (
				<div className="card" style={{ padding: "1.5rem" }}>
					<p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Two-factor authentication is now active</p>
					<p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "1rem" }}>
						You'll use your {method === "totp" ? "authenticator app" : "email"} for future sign-ins.
					</p>
					<button type="button" className="btn btn--primary" onClick={() => nav("/portal/home")}>
						Back to dashboard
					</button>
				</div>
			)}
		</div>
	);
}
