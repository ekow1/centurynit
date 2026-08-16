import { useCallback, useEffect, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { useOpsAuth } from "./OpsAuthContext";

interface SettingView {
	key: string;
	label: string;
	group: string;
	secret: boolean;
	description: string;
	valueMasked: string | null;
	source: "database" | "env" | "unset";
	updatedAt: string | null;
}

const STEP_UP_STORAGE_KEY = "century_nit_settings_step_up";

interface FeeItem {
	key: string;
	title: string;
	category: string;
	description: string;
	defaultCents: number;
	billingStage: string;
	badge: string;
}

const FEE_DEFINITIONS: FeeItem[] = [
	{
		key: "CONSULTATION_FEE_CENTS",
		title: "Initial Advisory Consultation",
		category: "Consultations",
		description: "Standard 45-minute comprehensive university and visa pathway evaluation session.",
		defaultCents: 5000,
		billingStage: "Upon Booking / Pre-session",
		badge: "Advisory",
	},
	{
		key: "APP_BASE_FEE_CENTS",
		title: "University Application Base Fee",
		category: "Admissions & Processing",
		description: "Initial application setup, credential review, and admissions portal filing.",
		defaultCents: 15000,
		billingStage: "Upon Application Initiation",
		badge: "Admissions",
	},
	{
		key: "APP_PER_SCHOOL_FEE_CENTS",
		title: "Additional University Submission",
		category: "Admissions & Processing",
		description: "Supplementary fee per each additional university beyond the first institution.",
		defaultCents: 5000,
		billingStage: "Per Additional Institution",
		badge: "Per-School",
	},
	{
		key: "APP_DOC_VERIFY_FEE_CENTS",
		title: "Official Document Verification & Notarization",
		category: "Admissions & Processing",
		description: "Transcript notarization, WES/credential evaluation assistance, and apostille verification.",
		defaultCents: 7500,
		billingStage: "Pre-submission Review",
		badge: "Verification",
	},
	{
		key: "APP_MATCH_REVIEW_FEE_CENTS",
		title: "Program Matching & Eligibility Audit",
		category: "Admissions & Processing",
		description: "Deep academic transcript evaluation and tailored scholarship match analysis.",
		defaultCents: 6000,
		billingStage: "Advisory Stage",
		badge: "Matching",
	},
	{
		key: "VISA_BASE_FEE_CENTS",
		title: "Visa Filing & Documentation Guidance",
		category: "Visa & Immigration",
		description: "Embassy filing package preparation, CAS review, financial statement verification, and interview prep.",
		defaultCents: 25000,
		billingStage: "Upon Unconditional Offer / CAS",
		badge: "Immigration",
	},
	{
		key: "VISA_BIOMETRICS_FEE_CENTS",
		title: "Embassy Biometrics & Appointment Coordination",
		category: "Visa & Immigration",
		description: "VFS / TLScontact appointment booking, priority courier handling, and document scanning assistance.",
		defaultCents: 4000,
		billingStage: "Post-Submission Stage",
		badge: "Biometrics",
	},
	{
		key: "VISA_TRANSLATION_FEE_CENTS",
		title: "Certified Document Translation",
		category: "Visa & Immigration",
		description: "Certified legal and academic document translation per certified page.",
		defaultCents: 3000,
		billingStage: "As Requested",
		badge: "Translation",
	},
];

function centsToDollars(cents: number | string | null): string {
	if (cents === null || cents === undefined || cents === "") return "0.00";
	const val = typeof cents === "number" ? cents : Number.parseInt(cents, 10);
	if (Number.isNaN(val)) return "0.00";
	return (val / 100).toFixed(2);
}

function dollarsToCents(dollars: string): number {
	const float = Number.parseFloat(dollars);
	if (Number.isNaN(float)) return 0;
	return Math.round(float * 100);
}

export function EnterpriseFeeSchedule() {
	const { opsRole } = useOpsAuth();
	const [settings, setSettings] = useState<SettingView[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<string | null>(null);
	const [editingFee, setEditingFee] = useState<FeeItem | null>(null);
	const [editAmountDollars, setEditAmountDollars] = useState<string>("");
	const [totpCode, setTotpCode] = useState<string>("");
	const [saving, setSaving] = useState(false);
	const [selectedCategory, setSelectedCategory] = useState<string>("all");

	// Step-up authentication
	const [stepUp, setStepUp] = useState<{ token: string; expiresAt: number } | null>(() => {
		try {
			const raw = sessionStorage.getItem(STEP_UP_STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
				return parsed;
			}
			sessionStorage.removeItem(STEP_UP_STORAGE_KEY);
			return null;
		} catch {
			return null;
		}
	});

	const isSuperAdmin = opsRole === "super_admin";
	const isUnlocked = Boolean(stepUp && Date.now() < stepUp.expiresAt);

	const loadSettings = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<{ settings: SettingView[] }>(`${API_PREFIX}/settings`);
			setSettings(res.settings);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load fee configuration");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	function getFeeValue(key: string, defaultCents: number): number {
		const found = settings.find((s) => s.key === key);
		if (found && found.valueMasked) {
			const parsed = Number.parseInt(found.valueMasked, 10);
			if (!Number.isNaN(parsed)) return parsed;
		}
		return defaultCents;
	}

	function handleOpenEdit(item: FeeItem) {
		const currentCents = getFeeValue(item.key, item.defaultCents);
		setEditingFee(item);
		setEditAmountDollars(centsToDollars(currentCents));
		setTotpCode("");
		setError(null);
	}

	async function handleSaveFee(e: React.FormEvent) {
		e.preventDefault();
		if (!editingFee) return;

		const nextCents = dollarsToCents(editAmountDollars);
		if (nextCents < 0) {
			setError("Fee amount must be greater than or equal to zero.");
			return;
		}

		setSaving(true);
		setError(null);

		try {
			const payload: { key: string; value: string; stepUpToken?: string; totpCode?: string } = {
				key: editingFee.key,
				value: String(nextCents),
			};

			if (isUnlocked && stepUp?.token) {
				payload.stepUpToken = stepUp.token;
			} else if (totpCode.trim()) {
				payload.totpCode = totpCode.trim();
			} else {
				setError("Authenticator code required to modify official fee schedules.");
				setSaving(false);
				return;
			}

			const res = await apiFetch<{ success: boolean; stepUpToken?: string; stepUpExpiresAt?: string }>(
				`${API_PREFIX}/settings`,
				{
					method: "PUT",
					body: JSON.stringify(payload),
				},
			);

			if (res.stepUpToken && res.stepUpExpiresAt) {
				const expiresAt = new Date(res.stepUpExpiresAt).getTime();
				const state = { token: res.stepUpToken, expiresAt };
				setStepUp(state);
				sessionStorage.setItem(STEP_UP_STORAGE_KEY, JSON.stringify(state));
			}

			setFlash(`Fee schedule for "${editingFee.title}" updated to $${editAmountDollars} USD.`);
			setEditingFee(null);
			await loadSettings();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to update fee schedule");
		} finally {
			setSaving(false);
		}
	}

	const categories = ["all", "Consultations", "Admissions & Processing", "Visa & Immigration"];

	const filteredFees = FEE_DEFINITIONS.filter(
		(f) => selectedCategory === "all" || f.category === selectedCategory,
	);

	return (
		<div className="admin-page">
			{/* Header */}
			<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
				<div>
					<h2 className="section-title">Official Fee Schedule</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Master service pricing, application fees, visa filing rates, and milestone billing rates.
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<span
						className="portal-pill"
						style={{
							fontFamily: "var(--font-mono)",
							fontSize: "0.7rem",
							background: "var(--foreground)",
							color: "var(--background)",
						}}
					>
						USD ($) MASTER BASE
					</span>
				</div>
			</div>

			{flash && (
				<div className="inv-flash" style={{ marginBottom: "1.5rem" }}>
					✓ {flash}
				</div>
			)}
			{error && (
				<p className="ops-modal__error" role="alert" style={{ marginBottom: "1.5rem" }}>
					{error}
				</p>
			)}

			{/* Category Filter Tabs */}
			<div className="admin-env-tabs" style={{ marginBottom: "1.5rem" }}>
				{categories.map((c) => (
					<button
						key={c}
						type="button"
						onClick={() => setSelectedCategory(c)}
						className={`admin-env-tab${selectedCategory === c ? " admin-env-tab--active" : ""}`}
					>
						{c === "all" ? "All Fee Schedules" : c}
					</button>
				))}
			</div>

			{/* Fee Schedule Cards Grid */}
			{loading ? (
				<div className="card" style={{ padding: "3rem", textAlign: "center" }}>
					<p className="muted">Loading official fee schedules…</p>
				</div>
			) : (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "1.25rem", marginBottom: "2rem" }}>
					{filteredFees.map((fee) => {
						const cents = getFeeValue(fee.key, fee.defaultCents);
						const dollars = centsToDollars(cents);
						const approxGhs = (Number.parseFloat(dollars) * 15.5).toFixed(2);

						return (
							<div key={fee.key} className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "1.5rem" }}>
							<div>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
									<span
										style={{
											fontSize: "0.65rem",
											fontFamily: "var(--font-mono)",
											textTransform: "uppercase",
											padding: "0.15rem 0.45rem",
											border: "var(--thin)",
											background: "var(--foreground)",
											color: "var(--background)",
											borderRadius: "2px",
										}}
									>
										{fee.badge}
									</span>
									<span className="mono muted" style={{ fontSize: "0.7rem" }}>
										{fee.billingStage}
									</span>
								</div>

								<h3 style={{ margin: "0.25rem 0 0.5rem", fontSize: "1.05rem", fontWeight: 700 }}>
									{fee.title}
								</h3>
								<p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0 0 1rem", lineHeight: 1.4 }}>
									{fee.description}
								</p>
							</div>

							<div style={{ borderTop: "var(--hairline)", paddingTop: "1rem", marginTop: "0.5rem" }}>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem" }}>
									<div>
										<span style={{ fontSize: "1.5rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
											${dollars}
										</span>
										<span className="muted" style={{ fontSize: "var(--text-xs)", marginLeft: "0.3rem" }}>USD</span>
									</div>
									<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
										≈ GH₵ {approxGhs}
									</span>
								</div>

								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
									<code className="mono muted" style={{ fontSize: "0.65rem" }}>
										{fee.key}
									</code>
									{isSuperAdmin && (
										<button
											type="button"
											className="btn btn--ghost btn--sm"
											onClick={() => handleOpenEdit(fee)}
										>
											Edit Rate
										</button>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
			)}

			{/* Edit Fee Modal */}
			{editingFee && (
				<div className="ops-modal-backdrop" onClick={() => setEditingFee(null)} role="dialog" aria-modal="true">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "30rem" }}>
						<header className="ops-modal__head">
							<div>
								<p className="invite-card__eyebrow" style={{ margin: 0 }}>Fee Schedule Configuration</p>
								<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>Edit Fee Rate</h2>
								<p className="ops-modal__sub">{editingFee.title}</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingFee(null)}>
								✕ Close
							</button>
						</header>

						<form onSubmit={handleSaveFee} className="invite-form" style={{ marginTop: "1rem" }}>
							<div className="field">
								<label htmlFor="fee-amount">Official Rate (USD $)</label>
								<input
									id="fee-amount"
									type="number"
									step="0.01"
									min="0"
									className="input input--full-border mono"
									style={{ fontSize: "1.1rem", fontWeight: 700 }}
									value={editAmountDollars}
									onChange={(e) => setEditAmountDollars(e.target.value)}
									required
									autoFocus
								/>
								<p className="field__hint">Stored in database as {dollarsToCents(editAmountDollars)} cents.</p>
							</div>

							{!isUnlocked && (
								<div className="field">
									<label htmlFor="fee-totp">
										Authenticator Code (MFA) <span style={{ color: "#b00020" }}>*</span>
									</label>
									<input
										id="fee-totp"
										type="text"
										inputMode="numeric"
										pattern="[0-9]{6}"
										maxLength={6}
										placeholder="6-digit code"
										className="input input--full-border mono"
										value={totpCode}
										onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
										required
									/>
									<p className="field__hint">6-digit code from your authenticator app to authorize fee changes.</p>
								</div>
							)}

							{isUnlocked && (
								<div
									style={{
										padding: "0.5rem 0.75rem",
										background: "var(--surface-subtle, #f6f6f6)",
										border: "var(--thin)",
										fontSize: "var(--text-xs)",
										marginBottom: "1rem",
									}}
								>
									✓ Session Unlocked · MFA step-up active
								</div>
							)}

							<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingFee(null)} disabled={saving}>
									Cancel
								</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>
									{saving ? "Saving…" : "Update Fee Rate"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
