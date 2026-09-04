import { useState } from "react";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { meApi, ApiError } from "century-nit-core/api";
import { useNotifier } from "../notifier/Notifier";
import { authClient } from "../../lib/auth-client";

const modalBackdrop: React.CSSProperties = {
	position: "fixed",
	inset: 0,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	background: "rgba(0,0,0,0.6)",
	zIndex: 9998,
	padding: "1rem",
};

const modalCard: React.CSSProperties = {
	width: "100%",
	maxWidth: "420px",
	padding: "1.5rem",
	background: "var(--background)",
	boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
};

function ErrorAlert({ message }: { message: string }) {
	return (
		<div
			role="alert"
			style={{
				padding: "0.75rem 1rem",
				background: "#fef2f2",
				color: "#b91c1c",
				fontSize: "0.9rem",
				marginBottom: "1rem",
			}}
		>
			{message}
		</div>
	);
}

export function ChangePasswordModal({
	open,
	currentEmail,
	onClose,
}: {
	open: boolean;
	currentEmail: string;
	onClose: () => void;
}) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { toast } = useNotifier();

	if (!open) return null;

	function reset() {
		setCurrentPassword("");
		setNewPassword("");
		setConfirmPassword("");
		setError(null);
		setBusy(false);
	}

	function handleClose() {
		reset();
		onClose();
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (newPassword.length < 12) {
			setError("New password must be at least 12 characters.");
			return;
		}
		if (newPassword !== confirmPassword) {
			setError("The new passwords do not match.");
			return;
		}
		setBusy(true);
		const { error: authError } = await authClient.changePassword({
			currentPassword,
			newPassword,
			revokeOtherSessions: true,
		});
		setBusy(false);
		if (authError) {
			setError(authError.message ?? "Could not change your password. Please try again.");
			return;
		}
		toast.success("Password changed successfully.");
		reset();
		onClose();
	}

	return (
		<div style={modalBackdrop}>
			<form style={modalCard} className="card" onSubmit={handleSubmit}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "1rem",
						marginBottom: "1rem",
					}}
				>
					<p className="eyebrow" style={{ margin: 0 }}>
						Change password
					</p>
					<button type="button" className="btn btn--ghost btn--sm" onClick={handleClose}>
						Cancel
					</button>
				</div>
				<p className="muted" style={{ fontSize: "0.9rem", marginBottom: "1rem" }}>
					For {currentEmail}. Your other sessions will be signed out.
				</p>
				{error ? <ErrorAlert message={error} /> : null}
				<div style={{ display: "grid", gap: "0.85rem" }}>
					<Field label="Current password" htmlFor="current-password">
						<Input
							id="current-password"
							type="password"
							value={currentPassword}
							onChange={(e) => setCurrentPassword(e.target.value)}
							fullBorder
							required
						/>
					</Field>
					<Field label="New password" htmlFor="new-password">
						<Input
							id="new-password"
							type="password"
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							fullBorder
							minLength={12}
							required
						/>
					</Field>
					<Field label="Confirm new password" htmlFor="confirm-password">
						<Input
							id="confirm-password"
							type="password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							fullBorder
							required
						/>
					</Field>
				</div>
				<div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
					<Button variant="ghost" size="sm" type="button" onClick={handleClose} disabled={busy}>
						Cancel
					</Button>
					<Button size="sm" type="submit" disabled={busy}>
						{busy ? "Saving…" : "Change password"}
					</Button>
				</div>
			</form>
		</div>
	);
}

export function ChangeEmailModal({
	open,
	currentEmail,
	onSaved,
	onClose,
}: {
	open: boolean;
	currentEmail: string;
	onSaved: (newEmail: string) => void;
	onClose: () => void;
}) {
	const [newEmail, setNewEmail] = useState("");
	const [otp, setOtp] = useState("");
	const [step, setStep] = useState<"email" | "otp">("email");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { toast } = useNotifier();

	if (!open) return null;

	function reset() {
		setNewEmail("");
		setOtp("");
		setStep("email");
		setError(null);
		setBusy(false);
	}

	function handleClose() {
		reset();
		onClose();
	}

	async function requestCode(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (!newEmail.trim().includes("@")) {
			setError("Enter a valid email address.");
			return;
		}
		if (newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) {
			setError("This is already your current email address.");
			return;
		}
		setBusy(true);
		try {
			await meApi.requestEmailChange({ newEmail: newEmail.trim() });
			setStep("otp");
			toast.success("A verification code has been sent to your new email.");
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not request the email change.");
		} finally {
			setBusy(false);
		}
	}

	async function confirmChange(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (!/^\d{6}$/.test(otp)) {
			setError("Enter the 6-digit code from your email.");
			return;
		}
		setBusy(true);
		try {
			const result = await meApi.confirmEmailChange({ newEmail: newEmail.trim(), otp });
			toast.success("Email address updated successfully.");
			onSaved(result.email);
			reset();
			onClose();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not confirm the email change.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div style={modalBackdrop}>
			<div style={modalCard} className="card">
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "1rem",
						marginBottom: "1rem",
					}}
				>
					<p className="eyebrow" style={{ margin: 0 }}>
						Change email
					</p>
					<button type="button" className="btn btn--ghost btn--sm" onClick={handleClose}>
						Cancel
					</button>
				</div>
				{error ? <ErrorAlert message={error} /> : null}
				{step === "email" ? (
					<form onSubmit={requestCode} style={{ display: "grid", gap: "0.85rem" }}>
						<p className="muted" style={{ fontSize: "0.9rem" }}>
							We’ll send a 6-digit code to the new address before updating it.
						</p>
						<Field label="New email address" htmlFor="new-email">
							<Input
								id="new-email"
								type="email"
								value={newEmail}
								onChange={(e) => setNewEmail(e.target.value)}
								fullBorder
								required
							/>
						</Field>
						<div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
							<Button variant="ghost" size="sm" type="button" onClick={handleClose} disabled={busy}>
								Cancel
							</Button>
							<Button size="sm" type="submit" disabled={busy}>
								{busy ? "Sending…" : "Send code"}
							</Button>
						</div>
					</form>
				) : (
					<form onSubmit={confirmChange} style={{ display: "grid", gap: "0.85rem" }}>
						<p className="muted" style={{ fontSize: "0.9rem" }}>
							Enter the code sent to <strong>{newEmail}</strong>.
						</p>
						<Field label="Verification code" htmlFor="email-otp">
							<Input
								id="email-otp"
								type="text"
								inputMode="numeric"
								maxLength={6}
								value={otp}
								onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
								fullBorder
								required
							/>
						</Field>
						<div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginTop: "0.5rem" }}>
							<Button variant="ghost" size="sm" type="button" onClick={() => setStep("email")} disabled={busy}>
								Back
							</Button>
							<Button size="sm" type="submit" disabled={busy}>
								{busy ? "Verifying…" : "Update email"}
							</Button>
						</div>
					</form>
				)}
			</div>
		</div>
	);
}
