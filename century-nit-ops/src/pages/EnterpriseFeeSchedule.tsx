import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { useOpsAuth } from "./OpsAuthContext";
import { Toast } from "./OpsDialogs";
import { GHS_PER_USD } from "./currency";
import { useFeeSettings, type InvoiceMode } from "../hooks/FeeSettingsContext";

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

export interface FeeItem {
	key: string;
	title: string;
	category: string;
	description: string;
	defaultCents: number;
	billingStage: string;
	badge: string;
}

export const FEE_DEFINITIONS: FeeItem[] = [
	{
		key: "CONSULTATION_FEE_CENTS",
		title: "Initial Advisory Consultation",
		category: "Consultations",
		description: "Standard 45-minute comprehensive university and visa pathway evaluation session.",
		defaultCents: 100,
		billingStage: "Upon Booking / Pre-session",
		badge: "Advisory",
	},
	{
		key: "APP_BASE_FEE_CENTS",
		title: "University Application Base Fee",
		category: "Admissions & Processing",
		description: "Initial application setup, credential review, and admissions portal filing.",
		defaultCents: 100,
		billingStage: "Upon Application Initiation",
		badge: "Admissions",
	},
	{
		key: "APP_PER_SCHOOL_FEE_CENTS",
		title: "Additional University Submission",
		category: "Admissions & Processing",
		description: "Supplementary fee per each additional university beyond the first institution.",
		defaultCents: 100,
		billingStage: "Per Additional Institution",
		badge: "Per-School",
	},
	{
		key: "APP_DOC_VERIFY_FEE_CENTS",
		title: "Official Document Verification & Notarization",
		category: "Admissions & Processing",
		description: "Transcript notarization, WES/credential evaluation assistance, and apostille verification.",
		defaultCents: 100,
		billingStage: "Pre-submission Review",
		badge: "Verification",
	},
	{
		key: "APP_MATCH_REVIEW_FEE_CENTS",
		title: "Program Matching & Eligibility Audit",
		category: "Admissions & Processing",
		description: "Deep academic transcript evaluation and tailored scholarship match analysis.",
		defaultCents: 100,
		billingStage: "Advisory Stage",
		badge: "Matching",
	},
	{
		key: "VISA_BASE_FEE_CENTS",
		title: "Visa Filing & Documentation Guidance",
		category: "Visa & Immigration",
		description: "Embassy filing package preparation, CAS review, financial statement verification, and interview prep.",
		defaultCents: 100,
		billingStage: "Upon Unconditional Offer / CAS",
		badge: "Immigration",
	},
	{
		key: "VISA_BIOMETRICS_FEE_CENTS",
		title: "Embassy Biometrics & Appointment Coordination",
		category: "Visa & Immigration",
		description: "VFS / TLScontact appointment booking, priority courier handling, and document scanning assistance.",
		defaultCents: 100,
		billingStage: "Post-Submission Stage",
		badge: "Biometrics",
	},
	{
		key: "VISA_TRANSLATION_FEE_CENTS",
		title: "Certified Document Translation",
		category: "Visa & Immigration",
		description: "Certified legal and academic document translation per certified page.",
		defaultCents: 100,
		billingStage: "As Requested",
		badge: "Translation",
	},
	{
		key: "TRAVEL_COORDINATION_FEE_CENTS",
		title: "Traveling & Flight Booking Assistance",
		category: "Travel & Relocation",
		description: "Flight itinerary coordination, student discount fares, and baggage allowance assistance.",
		defaultCents: 100,
		billingStage: "Post-Visa Approval",
		badge: "Travel",
	},
	{
		key: "HOUSING_ASSISTANCE_FEE_CENTS",
		title: "Student Housing & Accommodation Guidance",
		category: "Travel & Relocation",
		description: "University dorm reservation support, student apartment search, and lease review.",
		defaultCents: 100,
		billingStage: "Pre-Departure Stage",
		badge: "Housing",
	},
	{
		key: "PRE_DEPARTURE_BRIEFING_FEE_CENTS",
		title: "Pre-Departure & Airport Arrival Support",
		category: "Travel & Relocation",
		description: "Cultural & academic orientation, transit guidance, and airport arrival assistance.",
		defaultCents: 100,
		billingStage: "Pre-Departure Stage",
		badge: "Relocation",
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

const feeHeader = {
	padding: "0.6rem 0",
	textAlign: "left" as const,
	fontSize: "0.65rem",
	textTransform: "uppercase" as const,
	letterSpacing: "0.06em",
	fontWeight: 600,
	color: "#6b6b6b",
};

const feeCell = {
	padding: "0.85rem 0.5rem 0.85rem 0",
};

export function EnterpriseFeeSchedule() {
	const { opsRole } = useOpsAuth();
	const [settings, setSettings] = useState<SettingView[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<string | null>(null);
	const [editingFee, setEditingFee] = useState<FeeItem | null>(null);
	const [editAmountDollars, setEditAmountDollars] = useState<string>("");
	const [editMode, setEditMode] = useState<InvoiceMode>("issued");
	const [saving, setSaving] = useState(false);
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const { refresh: refreshGlobalSettings, feeModes, customFees } = useFeeSettings();

	const [addingFee, setAddingFee] = useState(false);
	const [newFee, setNewFee] = useState({
		title: "",
		category: "Admissions & Processing",
		amountDollars: "1.00",
		mode: "proforma" as InvoiceMode
	});

	// Toast
	const [toast, setToast] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);

	function _showToast(type: "error" | "success" | "info", message: string) {
		setToast({ type, message });
	}
	void _showToast;

	const isSuperAdmin = opsRole === "super_admin";

	const loadSettings = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<{ settings: SettingView[] }>(`${API_PREFIX}/settings?include_hidden=true`);
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
		setEditMode(feeModes[item.key] || "issued");
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
			// 1. Save fee amount
			if (editingFee.key.startsWith("CUSTOM_FEE_")) {
				const nextCustomFees = customFees.map(f =>
					f.key === editingFee.key ? { ...f, defaultCents: nextCents } : f
				);
				await apiFetch(
					`${API_PREFIX}/settings`,
					{ method: "PUT", body: JSON.stringify({ key: "CUSTOM_FEE_ITEMS", value: JSON.stringify(nextCustomFees) }) },
				);
			} else {
				await apiFetch(
					`${API_PREFIX}/settings`,
					{ method: "PUT", body: JSON.stringify({ key: editingFee.key, value: String(nextCents) }) },
				);
			}

			// 2. Save updated per-fee mode
			const nextModes = { ...feeModes, [editingFee.key]: editMode };
			await apiFetch(
				`${API_PREFIX}/settings`,
				{ method: "PUT", body: JSON.stringify({ key: "FEE_ISSUANCE_MODES", value: JSON.stringify(nextModes) }) },
			);

			const usdAmount = Number.parseFloat(editAmountDollars) || 0;
			const ghsAmount = Math.round(usdAmount * GHS_PER_USD).toLocaleString();
			const modeLabel = editMode === "proforma" ? "Estimate" : "Actual";
			setFlash(`"${editingFee.title}" updated — GH₵ ${ghsAmount} ($${editAmountDollars} USD), ${modeLabel}.`);
			setEditingFee(null);
			await loadSettings();
			void refreshGlobalSettings();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to update fee schedule");
		} finally {
			setSaving(false);
		}
	}

	async function handleAddFee(e: React.FormEvent) {
		e.preventDefault();
		const nextCents = dollarsToCents(newFee.amountDollars);
		if (nextCents < 0 || !newFee.title) {
			setError("Invalid fee details.");
			return;
		}

		setSaving(true);
		setError(null);

		try {
			const feeKey = `CUSTOM_FEE_${Date.now()}`;
			const feeItem: FeeItem = {
				key: feeKey,
				title: newFee.title,
				category: newFee.category,
				description: "Custom dynamically added fee.",
				defaultCents: nextCents,
				billingStage: "As Requested",
				badge: "Custom",
			};

			const nextCustomFees = [...customFees, feeItem];
			await apiFetch(
				`${API_PREFIX}/settings`,
				{ method: "PUT", body: JSON.stringify({ key: "CUSTOM_FEE_ITEMS", value: JSON.stringify(nextCustomFees) }) },
			);

			const nextModes = { ...feeModes, [feeKey]: newFee.mode };
			await apiFetch(
				`${API_PREFIX}/settings`,
				{ method: "PUT", body: JSON.stringify({ key: "FEE_ISSUANCE_MODES", value: JSON.stringify(nextModes) }) },
			);

			setFlash(`Added custom fee "${newFee.title}".`);
			setAddingFee(false);
			setNewFee({ title: "", category: "Admissions & Processing", amountDollars: "1.00", mode: "proforma" });
			await loadSettings();
			void refreshGlobalSettings();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to add custom fee");
		} finally {
			setSaving(false);
		}
	}

	const categories = [
		"all",
		"Consultations",
		"Admissions & Processing",
		"Visa & Immigration",
		"Relocation & Travel",
		"Supplementary Services",
	];

	const allFees = useMemo(() => [...FEE_DEFINITIONS, ...customFees], [customFees]);

	const filteredFees = allFees.filter(
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
					{isSuperAdmin && (
						<button type="button" className="btn btn--primary btn--sm" onClick={() => setAddingFee(true)}>
							+ Add Custom Fee
						</button>
					)}
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
			<div style={{ display: "flex", gap: "1rem", borderBottom: "1px solid #000", marginBottom: "1.5rem" }}>
				{categories.map((c) => (
					<button
						key={c}
						type="button"
						onClick={() => setSelectedCategory(c)}
						style={{
							border: "none",
							borderBottom: selectedCategory === c ? "2px solid #000" : "2px solid transparent",
							background: "transparent",
							fontSize: "0.75rem",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
							padding: "0.5rem 0.25rem",
							cursor: "pointer",
							color: "#000",
						}}
					>
						{c === "all" ? `All Fee Schedules (${allFees.length})` : c}
					</button>
				))}
			</div>

			{/* Fee Schedule Cards Grid */}
			{loading ? (
				<p style={{ color: "#6b6b6b" }}>Loading official fee schedules…</p>
			) : filteredFees.length === 0 ? (
				<p style={{ color: "#6b6b6b" }}>No fee schedules found for "{selectedCategory}".</p>
			) : (
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "2rem" }}>
					<thead>
						<tr style={{ borderBottom: "1px solid #000" }}>
							<th style={feeHeader}>Service</th>
							<th style={feeHeader}>Stage</th>
							<th style={{ ...feeHeader, textAlign: "right" }}>GHS (₵)</th>
							<th style={{ ...feeHeader, textAlign: "right" }}>USD Equivalent</th>
							<th style={feeHeader}>Mode</th>
							<th style={feeHeader} />
						</tr>
					</thead>
					<tbody>
						{filteredFees.map((fee) => {
							const cents = getFeeValue(fee.key, fee.defaultCents);
							const ghs = centsToDollars(cents);
							const usd = (Number.parseFloat(ghs) / 15.5).toFixed(2);

							return (
								<tr key={fee.key} style={{ borderBottom: "1px solid #e5e5e5" }}>
									<td style={feeCell}>
										<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
											<span
												style={{
													border: "1px solid #000",
													padding: "0.15rem 0.4rem",
													fontSize: "0.65rem",
													textTransform: "uppercase",
													letterSpacing: "0.04em",
												}}
											>
												{fee.badge}
											</span>
											<div>
												<p style={{ fontWeight: 600, margin: 0 }}>{fee.title}</p>
												<p style={{ color: "#6b6b6b", fontSize: "0.75rem", margin: "0.15rem 0 0" }}>{fee.description}</p>
											</div>
										</div>
									</td>
									<td style={{ ...feeCell, color: "#6b6b6b", fontSize: "0.75rem" }}>{fee.billingStage}</td>
									<td style={{ ...feeCell, textAlign: "right", fontWeight: 600 }}>GH₵ {ghs}</td>
									<td style={{ ...feeCell, textAlign: "right", color: "#6b6b6b" }}>≈ ${usd} USD</td>
									<td style={feeCell}>
										<span
											style={{
												border: `1px solid ${(feeModes[fee.key] || "issued") === "proforma" ? "var(--primary, #0066cc)" : "#000"}`,
												color: (feeModes[fee.key] || "issued") === "proforma" ? "var(--primary, #0066cc)" : "#000",
												padding: "0.15rem 0.4rem",
												fontSize: "0.65rem",
												textTransform: "uppercase",
												letterSpacing: "0.04em",
											}}
										>
											{(feeModes[fee.key] || "issued") === "proforma" ? "◯ Estimate" : "◉ Actual"}
										</span>
									</td>
									<td style={feeCell}>
										{isSuperAdmin && (
											<button
												type="button"
												onClick={() => handleOpenEdit(fee)}
												style={{
													border: "1px solid #000",
													borderRadius: 0,
													background: "transparent",
													fontSize: "0.7rem",
													textTransform: "uppercase",
													padding: "0.35rem 0.6rem",
													cursor: "pointer",
												}}
											>
												Edit
											</button>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}

		{/* Add Custom Fee Modal */}
			{addingFee && (
				<div className="ops-modal-backdrop" onClick={() => setAddingFee(false)} role="dialog" aria-modal="true">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "30rem" }}>
						<header className="ops-modal__head">
							<div>
								<p className="invite-card__eyebrow" style={{ margin: 0 }}>Fee Schedule Configuration</p>
								<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>Add Custom Fee</h2>
								<p className="ops-modal__sub">Create a new fee item to apply to invoices.</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setAddingFee(false)}>
								✕ Close
							</button>
						</header>

						<form onSubmit={handleAddFee} className="invite-form" style={{ marginTop: "1rem" }}>
							<div className="field">
								<label htmlFor="new-fee-title">Fee Title</label>
								<input
									id="new-fee-title"
									type="text"
									className="input input--full-border"
									value={newFee.title}
									onChange={(e) => setNewFee({ ...newFee, title: e.target.value })}
									required
									autoFocus
								/>
							</div>

							<div className="field">
								<label htmlFor="new-fee-category">Category</label>
								<select
									id="new-fee-category"
									className="input input--full-border"
									value={newFee.category}
									onChange={(e) => setNewFee({ ...newFee, category: e.target.value })}
									required
								>
									{categories.filter(c => c !== "all").map(c => (
										<option key={c} value={c}>{c}</option>
									))}
								</select>
							</div>

							<div className="field">
								<label htmlFor="new-fee-amount">Official Rate (USD $)</label>
								<input
									id="new-fee-amount"
									type="number"
									step="0.01"
									min="0"
									className="input input--full-border mono"
									style={{ fontSize: "1.1rem", fontWeight: 700 }}
									value={newFee.amountDollars}
									onChange={(e) => setNewFee({ ...newFee, amountDollars: e.target.value })}
									required
								/>
							</div>

							<div className="field">
								<label>Issuance Mode</label>
								<div style={{ display: "flex", gap: "0.5rem" }}>
									<button
										type="button"
										onClick={() => setNewFee({ ...newFee, mode: "issued" })}
										className={`btn btn--sm ${newFee.mode === "issued" ? "btn--primary" : "btn--ghost"}`}
									>
										◉ Actual Invoice
									</button>
									<button
										type="button"
										onClick={() => setNewFee({ ...newFee, mode: "proforma" })}
										className={`btn btn--sm ${newFee.mode === "proforma" ? "btn--primary" : "btn--ghost"}`}
									>
										◯ Estimated Quote
									</button>
								</div>
							</div>

							{error && (
								<p className="ops-modal__error" role="alert">{error}</p>
							)}

							<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setAddingFee(false)} disabled={saving}>
									Cancel
								</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>
									{saving ? "Saving…" : "Add Fee"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

		{/* Edit Fee Modal */}
			{editingFee && (
				<div className="ops-modal-backdrop" onClick={() => setEditingFee(null)} role="dialog" aria-modal="true">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "30rem" }}>
						<header className="ops-modal__head">
							<div>
								<p className="invite-card__eyebrow" style={{ margin: 0 }}>Fee Schedule Configuration</p>
								<h2 className="ops-modal__title" style={{ marginTop: "0.25rem" }}>Edit Fee</h2>
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

							<div className="field">
								<label>Issuance Mode</label>
								<div style={{ display: "flex", gap: "0.5rem" }}>
									<button
										type="button"
										onClick={() => setEditMode("issued")}
										className={`btn btn--sm ${editMode === "issued" ? "btn--primary" : "btn--ghost"}`}
									>
										◉ Actual Invoice
									</button>
									<button
										type="button"
										onClick={() => setEditMode("proforma")}
										className={`btn btn--sm ${editMode === "proforma" ? "btn--primary" : "btn--ghost"}`}
									>
										◯ Estimated Quote
									</button>
								</div>
								<p className="field__hint">
									{editMode === "proforma"
										? "Advisory quote — applicant sees an estimate, not a binding invoice."
										: "Binding invoice — appears in receivables, triggers payment tracking."}
								</p>
							</div>

							{error && (
								<p className="ops-modal__error" role="alert">{error}</p>
							)}

							<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingFee(null)} disabled={saving}>
									Cancel
								</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>
									{saving ? "Saving…" : "Save Fee"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{toast && (
				<Toast
					type={toast.type}
					message={toast.message}
					onDone={() => setToast(null)}
				/>
			)}
		</div>
	);
}
