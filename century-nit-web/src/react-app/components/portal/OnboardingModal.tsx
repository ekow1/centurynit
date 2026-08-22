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
	const [referralSource, setReferralSource] = useState("");

	const isPhoneAuth = authUser?.method === "phone";
	const isEmailAuth =
		authUser?.method === "email" ||
		authUser?.method === "otp" ||
		authUser?.method === "google" ||
		authUser?.method === "apple" ||
		authUser?.method === "linkedin";

	// Fetch real applicant from server on mount to check if details are missing.
	// A brand-new user has no applicant row yet — the modal should still show so
	// they can provide their name/phone/referral, which creates the applicant via
	// PATCH /me/application.
	useEffect(() => {
		if (!authUser) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		Promise.all([meApi.application(), meApi.portalState()])
			.then(([res, portalState]) => {
				if (cancelled) return;
				const app = res.applicant;
				const onboardingDone = portalState?.onboardingCompleted === true;

				// Pre-fill name from server or auth (social sign-in populates authUser.name)
				const serverName = app?.name?.trim() || "";
				const authName = authUser.name?.trim() || "";
				const displayName = serverName || authName;
				setFullName(displayName);

				// Pre-fill phone
				if (isPhoneAuth) {
					setPhone(
						authUser.email.replace("phone_", "").replace("@example.com", ""),
					);
				} else if (app?.phone) {
					setPhone(app.phone);
				}

				const serverReferral = (app?.profile as Record<string, string>)
					?.referralSource;
				if (serverReferral) setReferralSource(serverReferral);

				// Show modal only if onboarding wasn't completed and a field is missing.
				// For a new user with no applicant record, all fields are missing.
				const needsName = !displayName;
				const needsPhone = isEmailAuth && !app?.phone;
				const needsReferral = !serverReferral;
				setShow(!onboardingDone && (needsName || needsPhone || needsReferral));
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

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSaving(true);
		try {
			await meApi.updateProfile({
				name: fullName.trim() || undefined,
				...(isEmailAuth ? { phone } : {}),
				profile: { referralSource },
			});
			await meApi.updatePortalState({ onboardingCompleted: true });
			// Sync local auth state so the name shows immediately everywhere
			if (fullName.trim()) {
				updateApplication({
					firstName: fullName.trim().split(" ")[0] || "",
					lastName: fullName.trim().split(" ").slice(1).join(" ") || "",
					phone,
					referralSource,
					onboardingCompleted: true,
				});
			} else {
				updateApplication({
					phone,
					referralSource,
					onboardingCompleted: true,
				});
			}
			setShow(false);
		} catch {
			// Still close — the data might have saved; user can retry on next refresh
			updateApplication({
				phone,
				referralSource,
				onboardingCompleted: true,
			});
			setShow(false);
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
			}}
		>
			<div
				className="card fade-in"
				style={{
					width: "100%",
					maxWidth: "420px",
					padding: "2rem",
					boxShadow:
						"0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
				}}
			>
				<h2 style={{ marginBottom: "0.5rem", fontSize: "1.4rem" }}>
					Welcome to Century NIT!
				</h2>
				<p
					style={{
						color: "var(--muted-foreground)",
						marginBottom: "1.5rem",
						fontSize: "0.9rem",
					}}
				>
					Just a few more details to complete your account setup.
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
								value={phone}
								onChange={(e) => setPhone(e.target.value)}
								required
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
							required
						>
							<option value="">Select an option</option>
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
					<div style={{ marginTop: "1.5rem" }}>
						<Button type="submit" block arrow disabled={saving}>
							{saving ? "Saving..." : "Continue to Dashboard"}
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
