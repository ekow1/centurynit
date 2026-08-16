import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import QRCode from "qrcode";

/**
 * Two-factor enrolment (TOTP).
 *
 * Enforces Century NIT's Minimalist Monochrome Design System:
 * - Sharp borders (`--medium`, `--thin`) with 0px radius
 * - Pure monochrome hierarchy (black, white, muted)
 * - Monospace meta and uppercase step indicators
 * - Client-side high-contrast black & white QR code rendering
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

	// Generate QR code locally in browser whenever totpUri is available (pure monochrome)
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
				dark: "#000000",
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
		<div className="invite-page mfa-page">
			<div className="invite-card mfa-card" role="region" aria-labelledby="mfa-title">
				{/* Monochrome Eyebrow & Stepper */}
				<p className="invite-card__eyebrow">
					{step === "password" && "Step 1 of 3 · Security Enrolment"}
					{step === "verify" && "Step 2 of 3 · Scan & Verify"}
					{step === "codes" && "Step 3 of 3 · Backup Recovery"}
				</p>

				<h1 id="mfa-title" className="invite-card__title">
					Two-Factor Authentication
				</h1>

				<p className="invite-card__body">
					Staff accounts protect applicant records and sensitive financial data.
					You will need an authenticator app (Microsoft Authenticator, 1Password, Bitwarden,
					Authy, Apple Passwords, or any standard TOTP app).
				</p>

				{error && <p className="ops-modal__error">{error}</p>}

				{/* Step 1: Password confirmation */}
				{step === "password" && (
					<form className="invite-form" onSubmit={begin}>
						<div className="field">
							<label htmlFor="mfa-password">Confirm your password to continue</label>
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
								{busy ? "Confirming…" : "Continue to QR Code"}
							</button>
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={() => navigate("/login")}
							>
								Back to sign in
							</button>
						</div>
					</form>
				)}

				{/* Step 2: Scan QR Code & Enter 6-digit TOTP */}
				{step === "verify" && (
					<div className="mfa-step-content">
						<h2 className="mfa-step__title">1 · Scan with your authenticator app</h2>
						<p className="mfa-step__desc">
							Scan this QR code, or enter the setup key manually if your app cannot scan.
						</p>

						<div className="mfa-qr-frame">
							{qrDataUrl ? (
								<img
									src={qrDataUrl}
									alt="Scan QR code in your authenticator app"
									className="mfa-qr-image"
									width={200}
									height={200}
								/>
							) : (
								<div className="mfa-qr-placeholder">Generating QR code…</div>
							)}
						</div>

						<div className="mfa-manual-wrapper">
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={() => setShowManualKey((v) => !v)}
							>
								{showManualKey ? "Hide setup key" : "Cannot scan? View manual setup key"}
							</button>
						</div>

						{showManualKey && (
							<div className="mfa-secret">
								<span className="mfa-secret__label">Setup key</span>
								<code className="mfa-secret__value">{secret || "—"}</code>
								<button
									type="button"
									className="btn btn--ghost btn--sm"
									onClick={() => {
										void navigator.clipboard.writeText(secret);
										setCopied(true);
										window.setTimeout(() => setCopied(false), 2000);
									}}
								>
									{copied ? "Copied" : "Copy"}
								</button>
							</div>
						)}

						{totpUri && (
							<p className="ops-modal__sub" style={{ marginTop: "0.5rem" }}>
								Most apps also accept the direct link:{" "}
								<a href={totpUri} style={{ color: "var(--foreground)", textDecoration: "underline" }}>
									open in your authenticator
								</a>
							</p>
						)}

						<h2 className="mfa-step__title" style={{ marginTop: "1.5rem" }}>
							2 · Enter the six-digit code it shows
						</h2>
						<form onSubmit={confirm} className="mfa-verify">
							<input
								className="input input--full-border mfa-code"
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
							<button
								type="submit"
								className="btn btn--primary"
								disabled={busy || code.length !== 6}
							>
								{busy ? "Checking…" : "Verify & Activate"}
							</button>
						</form>
					</div>
				)}

				{/* Step 3: Backup recovery codes */}
				{step === "codes" && (
					<div className="mfa-step-content">
						<h2 className="mfa-step__title">Save your backup recovery codes</h2>
						<p className="invite-card__body">
							Each code works once, and only these will get you in if you lose your
							device. <strong>This is the only time they are shown.</strong>
						</p>

						<ul className="mfa-codes">
							{backupCodes.map((c) => (
								<li key={c}>
									<code>{c}</code>
								</li>
							))}
						</ul>

						<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={() => {
									void navigator.clipboard.writeText(backupCodes.join("\n"));
									setCopied(true);
									window.setTimeout(() => setCopied(false), 2000);
								}}
							>
								{copied ? "Copied" : "Copy all"}
							</button>
							<button
								type="button"
								className="btn btn--primary"
								onClick={() => {
									// Full reload so every context re-reads the session with verified 2FA
									window.location.assign("/dashboard");
								}}
							>
								I have saved them — Continue
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}


