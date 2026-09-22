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
import { AuthShell, maskEmail, type AuthStep } from "./AuthShell";
import { OtpInput } from "./OtpInput";
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
	| "totp-scan"
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
				setStep("totp-scan");
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

	function downloadCodes() {
		const body = [
			"Century NIT — Operations Center",
			"Two-factor backup codes",
			`Account: ${opsUser?.email ?? ""}`,
			"",
			...backupCodes,
			"",
			"Each code works once, in place of your authenticator.",
			"Keep them somewhere safe — they are never shown again.",
		].join("\n");
		const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "century-nit-ops-backup-codes.txt";
		a.click();
		URL.revokeObjectURL(url);
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

	const isTotp = method === "totp";
	const who = maskEmail(opsUser?.email);

	const steps: AuthStep[] | undefined = step.startsWith("totp")
		? [
				{ label: "Confirm password", state: step === "totp-password" ? "on" : "done" },
				{
					label: "Add the authenticator",
					hint: step === "totp-scan" ? "now" : undefined,
					state: step === "totp-scan" ? "on" : step === "totp-password" ? "todo" : "done",
				},
				{
					label: "Prove it works",
					hint: step === "totp-verify" ? "now" : undefined,
					state: step === "totp-verify" ? "on" : step === "totp-codes" ? "done" : "todo",
				},
				{ label: "Save backup codes", state: step === "totp-codes" ? "on" : "todo" },
			]
		: step.startsWith("otp")
			? [
					{ label: "Confirm password", state: step === "otp-password" ? "on" : "done" },
					{ label: "Verify the code", hint: step === "otp-verify" ? "now" : undefined, state: step === "otp-verify" ? "on" : "todo" },
				]
			: undefined;

	const barRight =
		step === "totp-password" || step === "otp-password" ? `Step 1 of ${isTotp ? 4 : 2}`
		: step === "totp-scan" ? "Step 2 of 4"
		: step === "totp-verify" ? "Step 3 of 4"
		: step === "totp-codes" ? "Step 4 of 4"
		: step === "otp-verify" ? "Step 2 of 2"
		: step === "done" ? "Complete"
		: undefined;

	return (
		<AuthShell
			aside={{
				chip: "Setup",
				label: "Two-factor setup",
				title:
					step === "manage" ? (
						<>Your account already carries <em>two factors</em>.</>
					) : step === "done" ? (
						<>Two-factor is <em>on</em> — you're covered.</>
					) : (
						<>No skip — every staff account carries <em>two factors</em>.</>
					),
				body:
					step === "manage" || step === "method" ? (
						<>
							An authenticator app is the stronger option — codes work offline and can't be
							intercepted. Email codes are the fallback for shared or restricted devices.
						</>
					) : step === "totp-codes" ? (
						<>
							<strong>Without these and your phone</strong>, only an admin reset recovers the
							account. Store them like a password.
						</>
					) : undefined,
				steps,
				footLeft: "1Password · Google · Microsoft · Authy",
				footRight: "Enrolment audited",
			}}
			card={{
				barLeft:
					step === "manage" ? `${who} — enrolled`
					: step === "method" ? "Choose a method"
					: step === "done" ? `${who} — enrolled`
					: `Authenticator setup`,
				barRight,
				wide: step === "totp-scan" || step === "totp-codes",
				foot:
					step === "totp-scan" ? (
						<>
							<button type="button" className="ops-login__footlink" onClick={() => setStep("totp-password")}>
								Back
							</button>
							<span>Enrols as Century NIT Ops · {who}</span>
						</>
					) : step === "totp-verify" ? (
						<>
							<button type="button" className="ops-login__footlink" onClick={() => setStep("totp-scan")}>
								Back to the code
							</button>
							<span>Device clock must be automatic</span>
						</>
					) : step === "otp-verify" ? (
						<>
							<button
								type="button"
								className="ops-login__footlink"
								disabled={busy}
								onClick={() => {
									setCode("");
									setError(null);
									resendOtp();
								}}
							>
								Resend code
							</button>
							<span>Check spam too</span>
						</>
					) : undefined,
			}}
		>
			{error && <p className="ops-login__error" role="alert">{error}</p>}

			{/* Manage view — already enrolled */}
			{step === "manage" && (
				<div className="mfa-step-content">
					<p className="ops-login__eyebrow">Two-factor authentication</p>
					<h1 id="mfa-title" className="ops-login__title">Two-factor is on</h1>
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
					<button type="button" className="btn btn--primary ops-login__submit" onClick={() => navigate(home)} style={{ marginTop: "1rem" }}>
						Continue
					</button>
				</div>
			)}

			{/* Method selection */}
			{step === "method" && (
				<>
					<p className="ops-login__eyebrow">Security setup</p>
					<h1 className="ops-login__title">Choose your second factor</h1>
					<p className="invite-card__body">
						{status?.required
							? "Staff accounts require two-factor authentication to protect applicant records and financial data."
							: "Add a second factor to protect your account."}
					</p>
					{enabledMethods.length === 0 ? (
						<p className="ops-login__notice">
							No verification methods are currently enabled. Contact your administrator.
						</p>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.25rem" }}>
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
						className="ops-login__footlink"
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
					<p className="ops-login__eyebrow">Add your authenticator</p>
					<h1 className="ops-login__title">Confirm your password</h1>
					<p className="invite-card__body">
						Pairing a new factor is sensitive — prove it's you first.
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
								{busy ? "Confirming…" : "Continue"}
							</button>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep(status?.enrolled ? "manage" : "method")}>
								Back
							</button>
						</div>
					</form>
				</>
			)}

			{/* TOTP: Scan — QR + manual key side by side */}
			{step === "totp-scan" && (
				<>
					<p className="ops-login__eyebrow">Add your authenticator</p>
					<h1 className="ops-login__title">Scan with your app</h1>
					<p className="invite-card__body">Camera on the code — or type the key on the right.</p>
					<div className="mfa-enrol">
						<div className="mfa-qr-frame">
							{qrDataUrl ? (
								<img src={qrDataUrl} alt="Scan QR code" className="mfa-qr-image" width={138} height={138} />
							) : (
								<div className="mfa-qr-placeholder">Generating…</div>
							)}
						</div>
						<div>
							<h5 className="mfa-enrol__label">Manual entry</h5>
							<p className="mfa-enrol__copy">"Enter setup key" in your app:</p>
							<div className="mfa-keybox">
								<span>{secret.replace(/(.{4})/g, "$1 ").trim() || "…"}</span>
								<button
									type="button"
									className="mfa-keybox__copy"
									onClick={() => {
										void navigator.clipboard.writeText(secret);
										setCopied(true);
										window.setTimeout(() => setCopied(false), 2000);
									}}
								>
									{copied ? "Copied" : "Copy"}
								</button>
							</div>
							<p className="mfa-enrol__copy" style={{ marginTop: "0.55rem" }}>
								Enrols as <strong>Century NIT Ops · {who}</strong>
							</p>
						</div>
					</div>
					<div className="cal-actions">
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep("totp-password")}>
							Back
						</button>
						<button type="button" className="btn btn--primary" onClick={() => setStep("totp-verify")}>
							I've scanned it
						</button>
					</div>
				</>
			)}

			{/* TOTP: Prove the pairing works */}
			{step === "totp-verify" && (
				<form className="ops-login__form" onSubmit={confirmTotp}>
					<p className="ops-login__eyebrow">Verify the pairing</p>
					<h1 className="ops-login__title">Type the first code</h1>
					<p className="invite-card__body">
						The app now shows a code under <strong>Century NIT Ops</strong>.
					</p>
					<OtpInput id="mfa-setup-otp" value={code} disabled={busy} onChange={setCode} />
					<button type="submit" className="btn btn--primary ops-login__submit" disabled={busy || code.length !== 6}>
						{busy ? "Checking…" : "Confirm pairing"}
					</button>
				</form>
			)}

			{/* TOTP: Backup codes — a deliverable */}
			{step === "totp-codes" && (
				<div className="mfa-step-content">
					<p className="ops-login__eyebrow">Backup codes</p>
					<h1 className="ops-login__title">Your only way back in</h1>
					<div className="mfa-warn">
						Shown once. Each works once. Without these <em>and</em> your phone, only an admin
						reset recovers the account.
					</div>
					<div className="ops-codes">
						{backupCodes.map((c) => (
							<span key={c}>{c}</span>
						))}
					</div>
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
							{copied ? "Copied!" : "Copy all"}
						</button>
						<button
							type="button"
							className="btn btn--primary"
							onClick={() => {
								downloadCodes();
								setStep("done");
							}}
						>
							Download &amp; continue
						</button>
					</div>
				</div>
			)}

			{/* Email OTP: Password confirmation */}
			{step === "otp-password" && (
				<>
					<p className="ops-login__eyebrow">Email one-time codes</p>
					<h1 className="ops-login__title">Confirm your password</h1>
					<p className="invite-card__body">
						You'll receive a 6-digit code at {who} each time you sign in.
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
								{busy ? "Confirming…" : "Continue"}
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
					<p className="ops-login__eyebrow">Verify the email path</p>
					<h1 className="ops-login__title">Check your inbox</h1>
					<p className="invite-card__body">
						{otpSent
							? `A 6-digit code went to ${who}.`
							: "We'll send a code to your email to confirm setup."}
					</p>
					<OtpInput id="otp-setup-otp" value={code} disabled={busy} onChange={setCode} />
					<button type="submit" className="btn btn--primary ops-login__submit" disabled={busy || code.length !== 6}>
						{busy ? "Verifying…" : "Verify & activate"}
					</button>
				</form>
			)}

			{/* Done */}
			{step === "done" && (
				<div className="mfa-step-content">
					<p className="ops-login__eyebrow">Setup complete</p>
					<h1 className="ops-login__title">You're covered</h1>
					<p className="invite-card__body">
						Two-factor authentication is active. You'll use your{" "}
						{method === "totp" ? "authenticator app" : "email"} on future sign-ins.
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
