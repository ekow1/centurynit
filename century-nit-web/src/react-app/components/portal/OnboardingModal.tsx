import { useState } from "react";
import { useAppState } from "../../context/AppState";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";

export function OnboardingModal() {
	const { authUser, application, updateApplication } = useAppState();

	const isPhoneAuth = authUser?.method === "phone";
	const isEmailAuth =
		authUser?.method === "email" ||
		authUser?.method === "otp" ||
		authUser?.method === "google" ||
		authUser?.method === "apple" ||
		authUser?.method === "linkedin";

	// If phone auth, authUser.email holds the fake email `phone_XXX@example.com`
	// Wait, we need to extract the phone number from that fake email if it's phone auth
	const defaultPhone = isPhoneAuth
		? authUser?.email.replace("phone_", "").replace("@example.com", "")
		: application.phone;

	const defaultEmail = application.email || (isEmailAuth ? authUser?.email : "");

	const [phone, setPhone] = useState(defaultPhone || "");
	const [email, setEmail] = useState(defaultEmail || "");
	const [referralSource, setReferralSource] = useState("");

	if (!authUser) return null;
	if (application.onboardingCompleted) return null;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		updateApplication({
			phone,
			email,
			referralSource,
			onboardingCompleted: true
		});
	};

	return (
		<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999 }}>
			<div className="card fade-in" style={{ width: '100%', maxWidth: '420px', padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
				<h2 style={{ marginBottom: '0.5rem', fontSize: '1.4rem' }}>Welcome to Century NIT! 🎉</h2>
				<p style={{ color: 'var(--muted-foreground)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>Just a few more details to complete your account setup.</p>
				<form onSubmit={handleSubmit}>
					{isPhoneAuth && (
						<Field label="Email Address" htmlFor="ob-email">
							<Input id="ob-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required fullBorder />
						</Field>
					)}
					{isEmailAuth && (
						<Field label="Phone Number" htmlFor="ob-phone">
							<Input id="ob-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required fullBorder />
						</Field>
					)}
					<Field label="Where did you hear about us?" htmlFor="ob-referral">
						<select id="ob-referral" className="input" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)' }} value={referralSource} onChange={e => setReferralSource(e.target.value)} required>
							<option value="">Select an option</option>
							<option value="Social Media">Social Media (Facebook, Instagram, etc.)</option>
							<option value="Search Engine">Search Engine (Google, Bing, etc.)</option>
							<option value="Friend or Family">Friend or Family</option>
							<option value="Advertisement">Advertisement</option>
							<option value="Other">Other</option>
						</select>
					</Field>
					<div style={{ marginTop: '1.5rem' }}>
						<Button type="submit" block arrow>Continue to Dashboard</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
