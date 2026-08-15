import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";

/**
 * Two-factor enrolment (TOTP).
 *
 * Required for every staff role: staff hold other people's data, so a stolen
 * password must not be enough on its own. The API enforces this independently in
 * `requireMfa` — this screen exists so enrolling is possible, not to be the
 * check.
 *
 * Enrolment is deliberately three steps rather than one. The secret is only
 * trusted once the user has proved their authenticator produces a matching code,
 * and the backup codes are shown last because that is the point at which the
 * account can actually be locked out.
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
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	/** The shared secret, for anyone whose app cannot scan a QR code. */
	const secret = (() => {
		try {
			return new URL(totpUri).searchParams.get("secret") ?? "";
		} catch {
			return "";
		}
	})();

	async function begin(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			// Re-authenticating here is what stops someone at an unattended desk
			// binding their own authenticator to the session.
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
					? `${err.message}. Check your device's clock is correct, then try the current code.`
					: "That code was not accepted",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="ops-panel mfa-panel" aria-labelledby="mfa-heading">
			<header className="ops-panel__head">
				<h1 id="mfa-heading" className="section-title">
					Set up two-factor authentication
				</h1>
			</header>

			<p className="ops-panel__muted">
				Staff accounts reach applicant records and financial data, so a password alone
				is not enough. You will need an authenticator app — Google Authenticator, Authy,
				1Password, or any other.
			</p>

			{error && <p className="ops-modal__error">{error}</p>}

			{step === "password" && (
				<form className="mfa-step" onSubmit={begin}>
					<div className="field">
						<label htmlFor="mfa-password">Confirm your password to continue</label>
						<input
							id="mfa-password"
							type="password"
							className="input input--full-border"
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
						/>
					</div>
					<button type="submit" className="btn btn--primary" disabled={busy || !password}>
						{busy ? "Starting…" : "Begin setup"}
					</button>
				</form>
			)}

			{step === "verify" && (
				<div className="mfa-step">
					<h2 className="mfa-step__title">1 · Add the account to your app</h2>
					<p className="ops-panel__muted">
						Scan this code, or enter the key by hand if your app cannot scan.
					</p>

					{/*
					 * Rendered as a link rather than an <img> from a third-party QR service:
					 * sending the TOTP secret to an external image host would hand the second
					 * factor to somebody else entirely.
					 */}
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

					<p className="ops-panel__muted">
						Most apps also accept the full setup link:{" "}
						<a href={totpUri}>open in your authenticator</a>
					</p>

					<h2 className="mfa-step__title">2 · Enter the six-digit code it shows</h2>
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
						/>
						<button type="submit" className="btn btn--primary" disabled={busy || code.length !== 6}>
							{busy ? "Checking…" : "Verify"}
						</button>
					</form>
				</div>
			)}

			{step === "codes" && (
				<div className="mfa-step">
					<h2 className="mfa-step__title">Save your backup codes</h2>
					<p className="ops-panel__muted">
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

					<div className="cal-actions">
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
								// Full reload so every context re-reads the session, which now
								// carries a verified second factor.
								window.location.assign("/ops");
							}}
						>
							I have saved them — continue
						</button>
					</div>
				</div>
			)}

			{step === "password" && (
				<button
					type="button"
					className="btn btn--ghost btn--sm mfa-signout"
					onClick={() => navigate("/ops/login")}
				>
					Back to sign in
				</button>
			)}
		</section>
	);
}
