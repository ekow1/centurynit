import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import type { ServicePackage } from "century-nit-core/ops";
import { fmtBoth, fmtGhs, fmtUsd } from "./currency";
import {
	FEE_DEFINITIONS,
	CUSTOM_FEES_STORAGE_KEY,
	type FeeItem,
} from "./EnterpriseFeeSchedule";

const STANDARD_EXCLUSIONS = [
	"School / university direct application fees",
	"Embassy / government visa filing and biometrics fees",
	"Initial advisory consultation fee",
];

/**
 * Service packages. Finance owns the catalogue; every other role that can see
 * this module gets a read-only view.
 */
export function EnterprisePackages() {
	const { opsUser, canEditPackages } = useOpsAuth();
	const { packages, savePackage, togglePackage } = useOpsState();
	const [editing, setEditing] = useState<ServicePackage | null>(null);

	const by = opsUser?.name ?? "Finance";

	function startNew() {
		setEditing({
			id: `pkg-${Date.now().toString(36)}`,
			name: "",
			price: 0,
			description: "",
			services: [],
			exclusions: [...STANDARD_EXCLUSIONS],
			active: true,
		});
	}

	return (
		<div className="page-content fade-in">
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-end",
					marginBottom: "2rem",
					gap: "1rem",
					flexWrap: "wrap",
				}}
			>
				<div>
					<h1 className="page-title">Service Packages</h1>
					<p className="lead mt-2">
						{canEditPackages
							? "Bundle official fee schedule items into discounted study abroad service packages."
							: "Pricing and included services. The manager maintains this catalogue."}
					</p>
				</div>
				{canEditPackages ? (
					<button className="btn btn--primary" onClick={startNew}>
						+ Create Package
					</button>
				) : (
					<span
						className="portal-pill"
						style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
					>
						🔒 Read only
					</span>
				)}
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
					gap: "2rem",
				}}
			>
				{packages.map((pkg) => (
					<div
						key={pkg.id}
						className="card"
						style={{ display: "flex", flexDirection: "column", opacity: pkg.active ? 1 : 0.55 }}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "flex-start",
								gap: "0.5rem",
								flexWrap: "wrap",
							}}
						>
							<h2 className="section-title mb-1">{pkg.name}</h2>
							{!pkg.active && (
								<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>
									Retired
								</span>
							)}
						</div>
						<p className="page-title mt-2 mb-1">{fmtGhs(pkg.price)}</p>
						<p className="muted mb-3" style={{ fontSize: "var(--text-xs)" }}>
							≈ {fmtUsd(pkg.price)} USD
						</p>
						<p className="muted mb-4">{pkg.description}</p>

						<div style={{ flexGrow: 1 }}>
							<p className="eyebrow mb-2" style={{ color: "var(--primary, #2563eb)", fontWeight: 600 }}>
								✓ Included Services ({pkg.services.length})
							</p>
							<ul
								style={{
									paddingLeft: "1.2rem",
									fontSize: "0.875rem",
									marginBottom: "1.25rem",
									lineHeight: "1.5",
								}}
							>
								{pkg.services.map((s) => (
									<li key={s}>{s}</li>
								))}
							</ul>

							{pkg.exclusions && pkg.exclusions.length > 0 && (
								<div
									style={{
										padding: "0.75rem",
										background: "var(--surface-muted, #f8fafc)",
										border: "1px dashed var(--border-color, #e2e8f0)",
										borderRadius: "8px",
										marginBottom: "1.5rem",
										fontSize: "0.8rem",
									}}
								>
									<p className="eyebrow mb-1" style={{ color: "#64748b", fontSize: "0.75rem" }}>
										✕ Not Included (Separate Official Fees)
									</p>
									<ul style={{ paddingLeft: "1.1rem", margin: 0, color: "#64748b" }}>
										{pkg.exclusions.map((e) => (
											<li key={e}>{e}</li>
										))}
									</ul>
								</div>
							)}
						</div>

						{canEditPackages ? (
							<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
								<button className="btn btn--ghost btn--sm" style={{ flex: 1 }} onClick={() => setEditing(pkg)}>
									Edit
								</button>
								<button className="btn btn--ghost btn--sm" style={{ flex: 1 }} onClick={() => togglePackage(pkg.id, by)}>
									{pkg.active ? "Retire" : "Activate"}
								</button>
							</div>
						) : (
							<p className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
								{pkg.active ? "Available to applicants" : "Not currently offered"}
							</p>
						)}
					</div>
				))}
			</div>

			{editing && canEditPackages && (
				<PackageEditor
					pkg={editing}
					onCancel={() => setEditing(null)}
					onSave={(next) => {
						savePackage(next, by);
						setEditing(null);
					}}
				/>
			)}
		</div>
	);
}

function PackageEditor({
	pkg,
	onSave,
	onCancel,
}: {
	pkg: ServicePackage;
	onSave: (pkg: ServicePackage) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(pkg.name);
	const [price, setPrice] = useState(String(pkg.price));
	const [description, setDescription] = useState(pkg.description);
	const [selectedServices, setSelectedServices] = useState<string[]>(pkg.services);
	const [selectedFeeKeys, setSelectedFeeKeys] = useState<string[]>(() => {
		// Derive fee keys from existing services by matching titles
		const keys: string[] = [];
		for (const svc of pkg.services) {
			const match = FEE_DEFINITIONS.find((f) => f.title.toLowerCase() === svc.toLowerCase());
			if (match) keys.push(match.key);
		}
		return keys;
	});
	const [priceLocked, setPriceLocked] = useState(false);
	const [selectedExclusions, setSelectedExclusions] = useState<string[]>(
		pkg.exclusions ?? [...STANDARD_EXCLUSIONS],
	);
	const [customServiceText, setCustomServiceText] = useState("");
	const [customExclusionText, setCustomExclusionText] = useState("");
	const [selectedFeeKey, setSelectedFeeKey] = useState<string>("");

	// All available fee schedule items (built-in + custom stored)
	const allFeeItems = useMemo<FeeItem[]>(() => {
		try {
			const raw = localStorage.getItem(CUSTOM_FEES_STORAGE_KEY);
			const custom: FeeItem[] = raw ? JSON.parse(raw) : [];
			return [...FEE_DEFINITIONS, ...custom];
		} catch {
			return FEE_DEFINITIONS;
		}
	}, []);

	// Group fee items by category
	const categories = useMemo(() => {
		const map: Record<string, FeeItem[]> = {};
		for (const item of allFeeItems) {
			map[item.category] = map[item.category] || [];
			map[item.category].push(item);
		}
		return map;
	}, [allFeeItems]);

	// Calculate sum of selected fee schedule items — direct key lookup, no fuzzy matching
	const computedSumCents = useMemo(() => {
		let total = 0;
		for (const item of allFeeItems) {
			if (selectedFeeKeys.includes(item.key)) {
				total += item.defaultCents;
			}
		}
		return total;
	}, [allFeeItems, selectedFeeKeys]);

	const computedSumDollars = (computedSumCents / 100).toFixed(2);

	// Auto-set price from fee items when not locked
	useEffect(() => {
		if (!priceLocked && computedSumCents > 0) {
			setPrice(String(computedSumCents / 100));
		}
	}, [computedSumCents, priceLocked]);

	function addFeeItem() {
		if (!selectedFeeKey) return;
		const item = allFeeItems.find((f) => f.key === selectedFeeKey);
		if (!item) return;
		if (selectedFeeKeys.includes(item.key)) return;
		setSelectedFeeKeys((prev) => [...prev, item.key]);
		if (!selectedServices.some((s) => s.toLowerCase() === item.title.toLowerCase())) {
			setSelectedServices((prev) => [...prev, item.title]);
		}
		setSelectedFeeKey("");
	}

	function removeFeeItem(key: string) {
		const item = allFeeItems.find((f) => f.key === key);
		setSelectedFeeKeys((prev) => prev.filter((k) => k !== key));
		if (item) {
			setSelectedServices((prev) =>
				prev.filter((s) => s.toLowerCase() !== item.title.toLowerCase()),
			);
		}
	}

	function toggleExclusion(item: string) {
		if (selectedExclusions.includes(item)) {
			setSelectedExclusions((prev) => prev.filter((e) => e !== item));
		} else {
			setSelectedExclusions((prev) => [...prev, item]);
		}
	}

	function addCustomService() {
		const trimmed = customServiceText.trim();
		if (trimmed && !selectedServices.includes(trimmed)) {
			setSelectedServices((prev) => [...prev, trimmed]);
			setCustomServiceText("");
		}
	}

	function addCustomExclusion() {
		const trimmed = customExclusionText.trim();
		if (trimmed && !selectedExclusions.includes(trimmed)) {
			setSelectedExclusions((prev) => [...prev, trimmed]);
			setCustomExclusionText("");
		}
	}

	function removeExclusion(e: string) {
		setSelectedExclusions((prev) => prev.filter((x) => x !== e));
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		onSave({
			...pkg,
			name: name.trim() || "Untitled package",
			price: Number(price) || 0,
			description: description.trim(),
			services: selectedServices.filter(Boolean),
			exclusions: selectedExclusions.filter(Boolean),
		});
	}

	return createPortal(
		<div
			onClick={onCancel}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 1500,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "1.5rem",
				background: "rgba(0,0,0,0.65)",
				backdropFilter: "blur(3px)",
			}}
		>
			<form
				onClick={(e) => e.stopPropagation()}
				onSubmit={submit}
				className="card"
				style={{
					width: "100%",
					maxWidth: "680px",
					maxHeight: "90vh",
					overflowY: "auto",
					display: "flex",
					flexDirection: "column",
					gap: "1.25rem",
				}}
			>
				<div>
					<h2 className="section-title mb-1">{pkg.name ? "Edit Service Package" : "Create Service Package"}</h2>
					<p className="muted" style={{ fontSize: "0.875rem" }}>
						Select items from the official fee schedule to bundle into this package.
					</p>
				</div>

				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
					<Field label="Package Name">
						<input
							className="input"
							style={{ width: "100%" }}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Standard Study Abroad Package"
							required
						/>
					</Field>
				<Field label="Package Price (USD)">
					<div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
						<input
							className="input"
							style={{ flex: 1 }}
							type="number"
							min="0"
							value={price}
							onChange={(e) => setPrice(e.target.value)}
							placeholder="0.00"
							disabled={!priceLocked}
							required
						/>
						<button
							type="button"
							className={`btn btn--sm ${priceLocked ? "btn--primary" : "btn--secondary"}`}
							onClick={() => setPriceLocked(!priceLocked)}
							title={priceLocked ? "Unlock to auto-calculate from fee items" : "Lock to edit price manually"}
							style={{ whiteSpace: "nowrap", flexShrink: 0 }}
						>
							{priceLocked ? "Locked" : "Auto"}
						</button>
					</div>
					<span className="muted" style={{ fontSize: "var(--text-xs)", display: "block", marginTop: "0.25rem" }}>
						{computedSumCents > 0
							? `Fee items total: $${computedSumDollars}${!priceLocked ? " (auto-calculated)" : " — edit locked"}`
							: "Select fee items below to auto-calculate, or lock to set manually."}
						{" "}{Number(price) > 0 ? `≈ ${fmtBoth(Number(price))}` : ""}
					</span>
				</Field>
				</div>

				<Field label="Short Description">
					<textarea
						className="input"
						style={{ width: "100%" }}
						rows={2}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Brief summary of what this package offers to applicants."
					/>
				</Field>

				{/* ── Official Fee Schedule Items ── */}
				<div>
					<p className="eyebrow mb-2" style={{ fontWeight: 600 }}>
						Official Fee Schedule Items
					</p>
					<p className="muted mb-3" style={{ fontSize: "0.8rem" }}>
						Select items from the master fee schedule to include in this package. Price auto-computes.
					</p>

					<div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
						<select
							className="input"
							style={{ flex: 1 }}
							value={selectedFeeKey}
							onChange={(e) => setSelectedFeeKey(e.target.value)}
						>
							<option value="">— Select a fee item —</option>
							{Object.entries(categories).map(([catName, items]) => (
								<optgroup key={catName} label={catName}>
									{items.map((item) => (
										<option
											key={item.key}
											value={item.key}
											disabled={selectedFeeKeys.includes(item.key)}
										>
											{item.title} — ${(item.defaultCents / 100).toFixed(2)}
										</option>
									))}
								</optgroup>
							))}
						</select>
						<button
							type="button"
							className="btn btn--secondary btn--sm"
							onClick={addFeeItem}
							disabled={!selectedFeeKey}
						>
							+ Add
						</button>
					</div>

					{selectedFeeKeys.length > 0 ? (
						<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ textAlign: "left", padding: "0.5rem 0.75rem", fontWeight: 600 }}>Fee Item</th>
									<th style={{ textAlign: "right", padding: "0.5rem 0.75rem", fontWeight: 600, width: "100px" }}>Amount</th>
									<th style={{ width: "40px" }} />
								</tr>
							</thead>
							<tbody>
								{selectedFeeKeys.map((key) => {
									const item = allFeeItems.find((f) => f.key === key);
									if (!item) return null;
									return (
										<tr key={key} style={{ borderBottom: "1px solid var(--border-light)" }}>
											<td style={{ padding: "0.5rem 0.75rem" }}>
												<span style={{ fontWeight: 600 }}>{item.title}</span>
												<span className="muted" style={{ display: "block", fontSize: "0.75rem", marginTop: "0.1rem" }}>
													{item.category}
												</span>
											</td>
											<td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
												${(item.defaultCents / 100).toFixed(2)}
											</td>
											<td style={{ padding: "0.5rem 0.25rem", textAlign: "center" }}>
												<button
													type="button"
													onClick={() => removeFeeItem(key)}
													style={{ border: "none", background: "transparent", cursor: "pointer", color: "#999", fontSize: "1rem", fontWeight: "bold" }}
													title="Remove"
												>
													×
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
							<tfoot>
								<tr style={{ borderTop: "2px solid var(--border)" }}>
									<td style={{ padding: "0.6rem 0.75rem", fontWeight: 700 }}>Total</td>
									<td style={{ padding: "0.6rem 0.75rem", textAlign: "right", fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: "0.95rem" }}>
										${computedSumDollars}
									</td>
									<td />
								</tr>
							</tfoot>
						</table>
					) : (
						<p className="muted" style={{ fontSize: "0.8rem", padding: "1rem", textAlign: "center", border: "1px dashed var(--border-light)" }}>
							No fee items selected yet. Use the dropdown above to add items from the Official Fee Schedule.
						</p>
					)}
				</div>

				{/* ── Custom service addition ── */}
				<div>
					<p className="eyebrow mb-2" style={{ fontWeight: 600 }}>
						Custom Included Services
					</p>
					<div style={{ display: "flex", gap: "0.5rem" }}>
						<input
							className="input"
							style={{ flex: 1, fontSize: "0.85rem" }}
							placeholder="Add a custom service not in the fee schedule..."
							value={customServiceText}
							onChange={(e) => setCustomServiceText(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									addCustomService();
								}
							}}
						/>
						<button type="button" className="btn btn--secondary btn--sm" onClick={addCustomService}>
							+ Add
						</button>
					</div>
				</div>

				{/* ── Separate Official Fee Exclusions ── */}
				<div
					style={{
						padding: "1rem",
						background: "#fef2f2",
						border: "1px solid #fecaca",
						borderRadius: "8px",
					}}
				>
					<p className="eyebrow mb-2" style={{ color: "#991b1b", fontWeight: 700, fontSize: "0.8rem" }}>
						✕ Separate Official Fees Not Included in Package
					</p>
					<p className="muted mb-3" style={{ fontSize: "0.75rem", color: "#7f1d1d" }}>
						Select official government or third-party fees that are billed or paid separately:
					</p>

					<div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
						{STANDARD_EXCLUSIONS.map((exc) => {
							const checked = selectedExclusions.includes(exc);
							return (
								<label
									key={exc}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "0.5rem",
										fontSize: "0.8rem",
										cursor: "pointer",
										color: "#991b1b",
									}}
								>
									<input
										type="checkbox"
										checked={checked}
										onChange={() => toggleExclusion(exc)}
										style={{ cursor: "pointer" }}
									/>
									<span>{exc}</span>
								</label>
							);
						})}
					</div>

					{selectedExclusions.length > 0 && (
						<div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
							{selectedExclusions.map((e) => (
								<span
									key={e}
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: "0.3rem",
										padding: "0.2rem 0.5rem",
										borderRadius: "4px",
										background: "#fee2e2",
										color: "#991b1b",
										fontSize: "0.75rem",
										fontWeight: 500,
									}}
								>
									✕ {e}
									<button
										type="button"
										onClick={() => removeExclusion(e)}
										style={{
											border: "none",
											background: "transparent",
											cursor: "pointer",
											color: "#991b1b",
											padding: 0,
											fontWeight: "bold",
										}}
									>
										×
									</button>
								</span>
							))}
						</div>
					)}

					<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
						<input
							className="input"
							style={{ flex: 1, fontSize: "0.8rem", background: "#fff" }}
							placeholder="Add other separate fee exclusion..."
							value={customExclusionText}
							onChange={(e) => setCustomExclusionText(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									addCustomExclusion();
								}
							}}
						/>
						<button type="button" className="btn btn--ghost btn--sm" onClick={addCustomExclusion}>
							+ Add
						</button>
					</div>
				</div>

				<div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
					<button type="submit" className="btn btn--primary" style={{ flex: 1 }}>
						Save Package
					</button>
					<button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={onCancel}>
						Cancel
					</button>
				</div>
			</form>
		</div>,
		document.body,
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label style={{ display: "block", marginBottom: "0.5rem" }}>
			<span
				className="eyebrow"
				style={{ display: "block", marginBottom: "0.35rem", fontSize: "var(--text-xs)" }}
			>
				{label}
			</span>
			{children}
		</label>
	);
}
