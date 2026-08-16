import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import QRCode from "qrcode";

/**
 * Two-factor enrolment (TOTP).
 *
 * Required for every staff role: staff hold applicant records and financial
 * data, so a password alone must not be enough on its own. The API enforces
 * this independently in `requireMfa`.
 *
 * Enrolment is a clean three-step flow:
 * 1. Password confirmation (prevents unattended desk hijacking)
 * 2. Scan QR Code & Verify 6-digit TOTP code
 * 3. Save single-use backup recovery codes
 */

const authClient = createAuthClient({
	baseURL: typeof window === "undefined" ? "" : window.location.origin,
	basePath: "/api/auth",
	plugins: [twoFactorClient()],
});

type Step = "password" | "verify" | "codes";

export function MfaSetup() {
	const navigate = useNavigate();
	const [step, setStep] = useState<Step>("password");
	const [password, setPassword] = useState("");
	const [totpUri, setTotpUri] = useState("");
	const [qrDataUrl, setQrDataUrl] = useState<string>("");
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [showManualKey, setShowManualKey] = useState(false);

	/** The shared secret, for anyone whose app cannot scan a QR code. */
	const secret = (() => {
		try {
			return new URL(totpUri).searchParams.get("secret") ?? "";
		} catch {
			return "";
		}
	})();

	// Generate QR code locally in browser whenever totpUri is available
	useEffect(() => {
		if (!totpUri) {
			setQrDataUrl("");
			return;
		}
		let active = true;
		QRCode.toDataURL(totpUri, {
			width: 220,
			margin: 1,
			color: {
				dark: "#0f172a",
				light: "#ffffff",
			},
			errorCorrectionLevel: "M",
		})
			.then((url) => {
				if (active) setQrDataUrl(url);
			})
			.catch((err) => {
				console.error("Failed to generate QR code", err);
			});
		return () => {
			active = false;
		};
	}, [totpUri]);

	async function begin(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const { data, error: err } = await authClient.twoFactor.enable({ password });
			if (err) throw new Error(err.message ?? "Could not start setup");
			setTotpUri(data?.totpURI ?? "");
			setBackupCodes(data?.backupCodes ?? []);
			setStep("verify");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not start setup");
		} finally {
			setBusy(false);
		}
	}

	async function confirm(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const { error: err } = await authClient.twoFactor.verifyTotp({ code });
			if (err) throw new Error(err.message ?? "That code was not accepted");
			setStep("codes");
		} catch (err) {
			setError(
				err instanceof Error
					? `${err.message}. Check your device clock is accurate, then try the current code.`
					: "That code was not accepted",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mfa-page-container">
			<div className="mfa-card" role="region" aria-labelledby="mfa-title">
				{/* Header */}
				<header className="mfa-header">
					<div className="mfa-badge">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
							<path d="m9 12 2 2 4-4" />
						</svg>
						<span>Security Enrolment</span>
					</div>
					<h1 id="mfa-title" className="mfa-title">
						Two-Factor Authentication
					</h1>
					<p className="mfa-subtitle">
						Protect staff access to applicant records and financial data. Compatible with
						Microsoft Authenticator, 1Password, Bitwarden, Authy, Apple Passwords, or any standard
						TOTP authenticator app.
					</p>

					{/* Stepper dots */}
					<div className="mfa-stepper" aria-label="Setup progress">
						<span
							className={`mfa-stepper__dot ${step === "password" ? "mfa-stepper__dot--active" : "mfa-stepper__dot--done"}`}
						>
							1. Password
						</span>
						<span className="mfa-stepper__line" />
						<span
							className={`mfa-stepper__dot ${step === "verify" ? "mfa-stepper__dot--active" : step === "codes" ? "mfa-stepper__dot--done" : ""}`}
						>
							2. Scan & Verify
						</span>
						<span className="mfa-stepper__line" />
						<span
							className={`mfa-stepper__dot ${step === "codes" ? "mfa-stepper__dot--active" : ""}`}
						>
							3. Backup Codes
						</span>
					</div>
				</header>

				{error && (
					<div className="mfa-error" role="alert">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="8" x2="12" y2="12" />
							<line x1="12" y1="16" x2="12.01" y2="16" />
						</svg>
						<span>{error}</span>
					</div>
				)}

				{/* Step 1: Password confirmation */}
				{step === "password" && (
					<form className="mfa-form" onSubmit={begin}>
						<div className="field">
							<label htmlFor="mfa-password">Confirm your password to begin</label>
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
						<div className="mfa-actions">
							<button type="submit" className="btn btn--primary btn--full" disabled={busy || !password}>
								{busy ? "Confirming…" : "Continue to QR Code"}
							</button>
							<button
								type="button"
								className="btn btn--ghost btn--sm btn--full"
								onClick={() => navigate("/login")}
							>
								Back to sign in
							</button>
						</div>
					</form>
				)}

				{/* Step 2: Scan QR Code & Enter 6-digit TOTP */}
				{step === "verify" && (
					<div className="mfa-flow">
						<div className="mfa-qr-section">
							<p className="mfa-step-label">1. Scan QR code in your authenticator</p>
							<div className="mfa-qr-box">
								{qrDataUrl ? (
									<img
										src={qrDataUrl}
										alt="Scan this QR code with your authenticator app"
										className="mfa-qr-img"
										width={200}
										height={200}
									/>
								) : (
									<div className="mfa-qr-loading">
										<span className="route-loading__spinner" aria-hidden="true" />
										<span>Generating QR code…</span>
									</div>
								)}
							</div>

							<div className="mfa-manual-toggle">
								<button
									type="button"
									className="btn btn--ghost btn--xs"
									onClick={() => setShowManualKey((v) => !v)}
								>
									{showManualKey ? "Hide manual key" : "Cannot scan? View manual setup key"}
								</button>
							</div>

							{showManualKey && (
								<div className="mfa-secret-box">
									<div className="mfa-secret-row">
										<span className="mfa-secret-label">Setup Key</span>
										<code className="mfa-secret-code">{secret || "—"}</code>
										<button
											type="button"
											className="btn btn--ghost btn--xs"
											onClick={() => {
												void navigator.clipboard.writeText(secret);
												setCopied(true);
												window.setTimeout(() => setCopied(false), 2000);
											}}
										>
											{copied ? "Copied!" : "Copy"}
										</button>
									</div>
									{totpUri && (
										<a href={totpUri} className="mfa-direct-link">
											Open directly in authenticator app →
										</a>
									)}
								</div>
							)}
						</div>

						<form onSubmit={confirm} className="mfa-verify-section">
							<p className="mfa-step-label">2. Enter the 6-digit code from your app</p>
							<div className="mfa-input-row">
								<input
									className="input input--full-border mfa-code-input"
									inputMode="numeric"
									autoComplete="one-time-code"
									pattern="[0-9]{6}"
									maxLength={6}
									placeholder="000000"
									aria-label="Six-digit code"
									value={code}
									onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
									required
									autoFocus
								/>
							</div>
							<button
								type="submit"
								className="btn btn--primary btn--full"
								disabled={busy || code.length !== 6}
							>
								{busy ? "Verifying…" : "Verify & Activate 2FA"}
							</button>
						</form>
					</div>
				)}

				{/* Step 3: Backup codes */}
				{step === "codes" && (
					<div className="mfa-flow">
						<div className="mfa-codes-banner">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
							</svg>
							<div>
								<strong>Save your single-use backup codes</strong>
								<p className="muted mt-1" style={{ fontSize: "var(--text-xs)" }}>
									If you lose access to your authenticator app, these emergency backup codes are the
									only way to recover your account. Store them in a secure password manager.
								</p>
							</div>
						</div>

						<ul className="mfa-codes-grid">
							{backupCodes.map((c) => (
								<li key={c} className="mfa-code-item">
									<code>{c}</code>
								</li>
							))}
						</ul>

						<div className="mfa-actions">
							<button
								type="button"
								className="btn btn--ghost btn--sm btn--full"
								onClick={() => {
									void navigator.clipboard.writeText(backupCodes.join("\n"));
									setCopied(true);
									window.setTimeout(() => setCopied(false), 2000);
								}}
							>
								{copied ? "Copied to clipboard!" : "Copy all backup codes"}
							</button>
							<button
								type="button"
								className="btn btn--primary btn--full"
								onClick={() => {
									// Full reload so all auth contexts re-read the session with 2FA enabled
									window.location.assign("/dashboard");
								}}
							>
								I have saved my codes — Continue to Console
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

