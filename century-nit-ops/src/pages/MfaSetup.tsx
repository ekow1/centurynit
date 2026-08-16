import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import QRCode from "qrcode";

/**
 * Two-factor enrolment (TOTP).
 *
 * Enforces Century NIT's Minimalist Monochrome Design System:
 * - Compact, horizontal-split layout (no tall vertical scrolling)
 * - Razor-sharp borders (`--medium`, `--thin`) with 0px radius
 * - Pure monochrome typography and high-contrast QR code
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

	/** The shared secret, for manual entry. */
	const secret = (() => {
		try {
			return new URL(totpUri).searchParams.get("secret") ?? "";
		} catch {
			return "";
		}
	})();

	// Generate crisp monochrome QR code (140x140)
	useEffect(() => {
		if (!totpUri) {
			setQrDataUrl("");
			return;
		}
		let active = true;
		QRCode.toDataURL(totpUri, {
			width: 140,
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
					? `${err.message}. Check your device clock is accurate, then try again.`
					: "That code was not accepted",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="invite-page mfa-page">
			<div
				className={`invite-card mfa-card ${step === "verify" ? "mfa-card--wide" : ""}`}
				role="region"
				aria-labelledby="mfa-title"
			>
				<p className="invite-card__eyebrow">
					{step === "password" && "Step 1 of 3 · Security Enrolment"}
					{step === "verify" && "Step 2 of 3 · Scan & Verify"}
					{step === "codes" && "Step 3 of 3 · Backup Recovery"}
				</p>

				<h1 id="mfa-title" className="invite-card__title">
					Two-Factor Authentication
				</h1>

				{error && <p className="ops-modal__error">{error}</p>}

				{/* Step 1: Password confirmation */}
				{step === "password" && (
					<>
						<p className="invite-card__body">
							Staff accounts require two-factor authentication to protect applicant records and sensitive financial data.
						</p>
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
					</>
				)}

				{/* Step 2: Compact Side-by-Side QR & Code Verification */}
				{step === "verify" && (
					<div className="mfa-verify-grid">
						{/* Left column: QR code & quick copy secret */}
						<div className="mfa-qr-col">
							<div className="mfa-qr-frame">
								{qrDataUrl ? (
									<img
										src={qrDataUrl}
										alt="Scan QR code in your authenticator app"
										className="mfa-qr-image"
										width={140}
										height={140}
									/>
								) : (
									<div className="mfa-qr-placeholder">Generating…</div>
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
								title="Click to copy full secret key"
							>
								{copied ? "Key Copied!" : "Copy Setup Key"}
							</button>
						</div>

						{/* Right column: Instructions, 6-digit input, Submit */}
						<form onSubmit={confirm} className="mfa-action-col">
							<p className="mfa-step__desc">
								Scan the QR code with your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, etc.), or paste the setup key manually, then enter the current 6-digit code.
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

							<button
								type="submit"
								className="btn btn--primary mfa-submit-btn"
								disabled={busy || code.length !== 6}
							>
								{busy ? "Checking…" : "Verify & Activate"}
							</button>

							<div style={{ marginTop: "1rem", fontSize: "var(--text-xs)", color: "var(--muted)", lineHeight: 1.4 }}>
								<p style={{ margin: "0 0 0.25rem 0" }}>
									<strong>Tip:</strong> If you previously scanned an earlier QR code, delete that entry in your app first to avoid entering an expired key's code.
								</p>
								<p style={{ margin: 0 }}>
									Ensure your device clock is set to <strong>Automatic Network Time</strong>.
								</p>
							</div>
						</form>
					</div>
				)}

				{/* Step 3: Backup recovery codes */}
				{step === "codes" && (
					<div className="mfa-step-content">
						<p className="invite-card__body">
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
							<button
								type="button"
								className="btn btn--primary"
								onClick={() => {
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



