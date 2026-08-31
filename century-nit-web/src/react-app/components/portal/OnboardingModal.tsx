import { useEffect, useState } from "react";
import { meApi } from "century-nit-core/api";
import { useAppState } from "../../context/AppState";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";

export function OnboardingModal() {
	const { authUser, updateApplication } = useAppState();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [show, setShow] = useState(false);

	const [fullName, setFullName] = useState("");
	const [phone, setPhone] = useState("");
	const [email, setEmail] = useState("");
	const [referralSource, setReferralSource] = useState("");

	const isPhoneAuth = authUser?.method === "phone";
	const isEmailAuth =
		authUser?.method === "email" ||
		authUser?.method === "otp" ||
		authUser?.method === "google" ||
		authUser?.method === "apple" ||
		authUser?.method === "linkedin";

	useEffect(() => {
		if (!authUser) {
			setLoading(false);
			return;
		}

		// Don't interrupt if user is completing payment or already dismissed
		const isPaymentFlow =
			window.location.search.includes("paystack") ||
			window.location.search.includes("verify") ||
			window.location.pathname.includes("/pay");

		const dismissedKey = `cn_onboarding_dismissed_${authUser.id || "user"}`;
		const isDismissed = localStorage.getItem(dismissedKey) === "true";

		if (isPaymentFlow || isDismissed) {
			setLoading(false);
			setShow(false);
			return;
		}

		let cancelled = false;
		Promise.all([meApi.application(), meApi.portalState()])
			.then(([res, portalState]) => {
				if (cancelled) return;
				const app = res.applicant;
				const onboardingDone = portalState?.onboardingCompleted === true;

				if (onboardingDone) {
					setShow(false);
					return;
				}

				// Pre-fill name
				const serverName = app?.name?.trim() || "";
				const authName = authUser.name?.trim() || "";
				const displayName = serverName || authName;
				setFullName(displayName);

				// Pre-fill phone / email
				if (isPhoneAuth) {
					setPhone(authUser.email.replace("phone_", "").replace("@example.com", ""));
					setEmail(authUser.email.includes("@example.com") ? "" : authUser.email);
				} else if (app?.phone) {
					setPhone(app.phone);
				}

				const serverReferral = (app?.profile as Record<string, string>)?.referralSource;
				if (serverReferral) setReferralSource(serverReferral);

				// Only show if essential details are missing (e.g. no name or no phone)
				const needsName = !displayName;
				const needsPhone = isEmailAuth && !app?.phone;
				setShow(needsName || needsPhone);
			})
			.catch(() => {
				/* don't block portal on network error */
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [authUser, isPhoneAuth, isEmailAuth]);

	if (!authUser || loading || !show) return null;

	const handleDismiss = () => {
		const dismissedKey = `cn_onboarding_dismissed_${authUser.id || "user"}`;
		localStorage.setItem(dismissedKey, "true");
		setShow(false);
		// Don't call PATCH /me/portal-state here; if updateProfile failed there is
		// no applicant row yet and the server returns APPLICANT_NOT_FOUND.
		// Submitting the form explicitly creates the applicant first.
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSaving(true);
		try {
			await meApi.updateProfile({
				name: fullName.trim() || undefined,
				...(isEmailAuth ? { phone: phone.trim() || undefined } : {}),
				profile: {
					referralSource: referralSource || undefined,
					...(isPhoneAuth && email.trim() ? { email: email.trim() } : {}),
				},
			});
			await meApi.updatePortalState({ onboardingCompleted: true });

			const dismissedKey = `cn_onboarding_dismissed_${authUser.id || "user"}`;
			localStorage.setItem(dismissedKey, "true");

			updateApplication({
				firstName: fullName.trim().split(" ")[0] || "",
				lastName: fullName.trim().split(" ").slice(1).join(" ") || "",
				phone,
				referralSource,
				onboardingCompleted: true,
			});
			setShow(false);
		} catch {
			handleDismiss();
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				position: "fixed",
				inset: 0,
				backgroundColor: "rgba(0,0,0,0.6)",
				zIndex: 9999,
				padding: "16px",
			}}
		>
			<div
				className="card fade-in"
				style={{
					position: "relative",
					width: "100%",
					maxWidth: "420px",
					padding: "2rem",
					background: "#ffffff",
					boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
				}}
			>
				{/* Dismiss button */}
				<button
					type="button"
					onClick={handleDismiss}
					style={{
						position: "absolute",
						top: "16px",
						right: "16px",
						background: "transparent",
						border: "none",
						fontSize: "16px",
						fontWeight: 700,
						color: "#71717a",
						cursor: "pointer",
					}}
					title="Remind me later"
				>
					✕
				</button>

				<h2 style={{ marginBottom: "0.5rem", fontSize: "1.3rem", fontWeight: 800 }}>
					Welcome to Century NIT!
				</h2>
				<p
					style={{
						color: "var(--muted-foreground)",
						marginBottom: "1.5rem",
						fontSize: "0.85rem",
					}}
				>
					Just a few details to complete your account setup.
				</p>
				<form onSubmit={handleSubmit}>
					<Field label="Full Name" htmlFor="ob-name">
						<Input
							id="ob-name"
							type="text"
							value={fullName}
							onChange={(e) => setFullName(e.target.value)}
							placeholder="e.g. Kwame Mensah"
							required
							fullBorder
						/>
					</Field>
					{isEmailAuth && (
						<Field label="Phone Number" htmlFor="ob-phone">
							<Input
								id="ob-phone"
								type="tel"
								value={phone}
								onChange={(e) => setPhone(e.target.value)}
								placeholder="+233 24 000 0000"
								required
								fullBorder
							/>
						</Field>
					)}
					{isPhoneAuth && (
						<Field label="Email Address" htmlFor="ob-email">
							<Input
								id="ob-email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="name@example.com"
								fullBorder
							/>
						</Field>
					)}
					<Field label="Where did you hear about us?" htmlFor="ob-referral">
						<select
							id="ob-referral"
							className="input"
							style={{
								width: "100%",
								padding: "0.5rem",
								border: "1px solid var(--border)",
							}}
							value={referralSource}
							onChange={(e) => setReferralSource(e.target.value)}
						>
							<option value="">Select an option (optional)</option>
							<option value="Social Media">
								Social Media (Facebook, Instagram, etc.)
							</option>
							<option value="Search Engine">
								Search Engine (Google, Bing, etc.)
							</option>
							<option value="Friend or Family">Friend or Family</option>
							<option value="Advertisement">Advertisement</option>
							<option value="Other">Other</option>
						</select>
					</Field>
					<div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "1.5rem" }}>
						<Button type="submit" block arrow disabled={saving}>
							{saving ? "Saving..." : "Continue to Dashboard"}
						</Button>
						<button
							type="button"
							onClick={handleDismiss}
							style={{
								background: "transparent",
								border: "none",
								color: "#71717a",
								fontSize: "12px",
								padding: "6px",
								cursor: "pointer",
								textDecoration: "underline",
							}}
						>
							Remind me later
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
