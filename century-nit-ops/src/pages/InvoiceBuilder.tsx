import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fmtBoth, fmtGhs, fmtUsd } from "./currency";
import type { InvoiceType, OpsInvoiceLine, ServicePackage } from "century-nit-core/ops";
import {
	APP_INVOICE_BASE,
	APP_INVOICE_PER_SCHOOL,
	APP_DOC_VERIFY_FEE,
	APP_MATCH_REVIEW_FEE,
	VISA_INVOICE_AMOUNT,
	VISA_BIOMETRICS_FEE,
	VISA_TRANSLATION_FEE,
	CONSULTATION_FEE_AMOUNT,
} from "century-nit-core";

/**
 * Invoice builder dialog.
 *
 * Extracted from EnterpriseFinance so the Invoices page owns it — it is a
 * transactional tool, and it was only a modal because the reports page had
 * nowhere to put it.
 */

const sum = (lines: OpsInvoiceLine[]) => lines.reduce((n, l) => n + l.amount, 0);

/** Auto-generate line items based on the applicant's package and invoice type. */
function defaultLines(pkg: string, packages: ServicePackage[], type: InvoiceType, schoolCount: number): OpsInvoiceLine[] {
	const match = packages.find((p) => p.name === pkg);
	const lines: OpsInvoiceLine[] = [];

	if (type === "Application") {
		if (match) {
			lines.push({ id: "package", label: match.name, detail: match.description, amount: match.price });
		} else {
			lines.push({ id: "processing", label: "Application processing", detail: "Case preparation & filing", amount: APP_INVOICE_BASE });
		}
		const n = Math.max(1, schoolCount);
		lines.push({ id: "per-school", label: `School submissions (${n})`, detail: `$${APP_INVOICE_PER_SCHOOL} per institution`, amount: APP_INVOICE_PER_SCHOOL * n });
		lines.push({ id: "verification", label: "Document verification", detail: "Credential authentication", amount: APP_DOC_VERIFY_FEE });
		lines.push({ id: "match-review", label: "Match review", detail: "Programme fit assessment", amount: APP_MATCH_REVIEW_FEE });
	} else if (type === "Visa") {
		lines.push({ id: "visa-prep", label: "Visa file preparation", detail: "Forms, evidence pack & review", amount: VISA_INVOICE_AMOUNT });
		lines.push({ id: "biometrics", label: "Biometrics & appointment", detail: "Booking and support", amount: VISA_BIOMETRICS_FEE });
		lines.push({ id: "translation", label: "Document translation", detail: "Certified translations", amount: VISA_TRANSLATION_FEE });
	} else if (type === "Consultation") {
		lines.push({ id: "consultation", label: "Initial consultation", detail: "1-on-1 assessment session", amount: CONSULTATION_FEE_AMOUNT });
	} else if (type === "Agency") {
		lines.push({ id: "agency-deposit", label: "Service fee - deposit", detail: "Required before choosing your payment plan", amount: 0 });
		lines.push({ id: "agency-predeparture", label: "Service fee - pre departure", detail: "Due before you travel to your destination", amount: 0 });
		lines.push({ id: "agency-postarrival", label: "Service fee - post-arrival", detail: "Settle after you've arrived — no deadline pressure", amount: 0 });
	} else {
		lines.push({ id: "custom", label: "Custom service", detail: "", amount: 0 });
	}

	return lines;
}

export function InvoiceBuilder({
	applicantId,
	applicantName,
	type: initialType,
	packages,
	applicantPackage,
	schoolCount,
	onIssue,
	onCancel,
}: {
	applicantId: string;
	applicantName: string;
	type: InvoiceType;
	packages: ServicePackage[];
	applicantPackage: string;
	schoolCount: number;
	onIssue: (lines: OpsInvoiceLine[], note: string, type: InvoiceType) => void;
	onCancel: () => void;
}) {
	const [type, setType] = useState<InvoiceType>(initialType);
	const [lines, setLines] = useState<OpsInvoiceLine[]>(() => defaultLines(applicantPackage, packages, initialType, schoolCount));
	const [note, setNote] = useState("");

	const total = sum(lines);

	// A modal has to be dismissible from the keyboard and must not let the
	// page behind it scroll away underneath.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onCancel();
		}
		document.addEventListener("keydown", onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [onCancel]);

	function updateLine(id: string, field: "label" | "detail" | "amount", value: string) {
		setLines((prev) => prev.map((l) =>
			l.id === id
				? { ...l, [field]: field === "amount" ? Number(value) || 0 : value }
				: l,
		));
	}

	function addLine() {
		setLines((prev) => [...prev, { id: `line-${Date.now().toString(36)}`, label: "", detail: "", amount: 0 }]);
	}

	function removeLine(id: string) {
		setLines((prev) => prev.filter((l) => l.id !== id));
	}

	function changeType(t: InvoiceType) {
		setType(t);
		setLines(defaultLines(applicantPackage, packages, t, schoolCount));
	}

	/* Portalled to <body>: a dialog must not inherit an ancestor's containing
	   block. Anything transformed above it captures position:fixed and pins the
	   scrim to that box instead of the viewport. */
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
				padding: "2rem",
				background: "rgba(0,0,0,0.6)",
				backdropFilter: "blur(2px)",
			}}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				className="card"
				role="dialog"
				aria-modal="true"
				aria-label="Invoice builder"
				style={{ width: "100%", maxWidth: "640px", maxHeight: "85vh", overflowY: "auto" }}
			>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
					<div>
						<h2 className="section-title">Invoice Builder</h2>
						<p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: "0.25rem" }}>
							{applicantName} · {applicantId}
						</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>✕</button>
				</div>

				{/* Invoice type selector */}
				<div style={{ marginBottom: "1.25rem" }}>
					<span className="eyebrow" style={{ display: "block", marginBottom: "0.4rem", fontSize: "var(--text-xs)" }}>Invoice Type</span>
					<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
						{(["Application", "Visa", "Consultation", "Agency", "Custom"] as InvoiceType[]).map((t) => (
							<button
								key={t}
								type="button"
								onClick={() => changeType(t)}
								className={`btn btn--sm ${type === t ? "btn--primary" : "btn--ghost"}`}
							>
								{t}
							</button>
						))}
					</div>
				</div>

				{/* Line items */}
				<div style={{ marginBottom: "1.25rem" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
						<span className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Line Items</span>
						<button type="button" className="btn btn--ghost btn--sm" onClick={addLine}>+ Add Line</button>
					</div>
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse" }}>
							<thead>
								<tr style={{ borderBottom: "1px solid var(--border-light)" }}>
									<th style={{ padding: "0.4rem", textAlign: "left", fontSize: "var(--text-xs)" }}>Description</th>
									<th style={{ padding: "0.4rem", textAlign: "left", fontSize: "var(--text-xs)" }}>Detail</th>
									<th style={{ padding: "0.4rem", textAlign: "right", fontSize: "var(--text-xs)", width: "90px" }}>Amount</th>
									<th style={{ width: "32px" }}></th>
								</tr>
							</thead>
							<tbody>
								{lines.map((line) => (
									<tr key={line.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
										<td style={{ padding: "0.4rem" }}>
											<input
												className="input input--sm"
												style={{ width: "100%", padding: "0.3rem 0.4rem" }}
												value={line.label}
												placeholder="Item name"
												onChange={(e) => updateLine(line.id, "label", e.target.value)}
											/>
										</td>
										<td style={{ padding: "0.4rem" }}>
											<input
												className="input input--sm"
												style={{ width: "100%", padding: "0.3rem 0.4rem" }}
												value={line.detail}
												placeholder="Description"
												onChange={(e) => updateLine(line.id, "detail", e.target.value)}
											/>
										</td>
										<td style={{ padding: "0.4rem" }}>
											<input
												className="input input--sm"
												style={{ width: "90px", padding: "0.3rem 0.4rem", textAlign: "right", fontFamily: "var(--font-mono)" }}
												type="number"
												min="0"
												value={line.amount}
												onChange={(e) => updateLine(line.id, "amount", e.target.value)}
											/>
										</td>
										<td style={{ padding: "0.4rem", textAlign: "center" }}>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												style={{ padding: "0.2rem 0.4rem", fontSize: "0.7rem" }}
												onClick={() => removeLine(line.id)}
											>
												✕
											</button>
										</td>
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr style={{ borderTop: "2px solid var(--border)" }}>
									<td colSpan={2} style={{ padding: "0.6rem 0.4rem", textAlign: "right", fontWeight: 600, fontSize: "var(--text-sm)" }}>Total</td>
									{/* The amount column is narrow - stack the two currencies
								    instead of letting "GH₵ 15,000 · $1,000" wrap mid-figure */}
								<td style={{ padding: "0.6rem 0.4rem", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "var(--text-xs)" }}>
									<span style={{ display: "block", whiteSpace: "nowrap" }}>{fmtGhs(total)}</span>
									<span style={{ display: "block", whiteSpace: "nowrap", fontWeight: 400, opacity: 0.65 }}>{fmtUsd(total)}</span>
								</td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					</div>
				</div>

				{/* Note */}
				<div style={{ marginBottom: "1.5rem" }}>
					<span className="eyebrow" style={{ display: "block", marginBottom: "0.35rem", fontSize: "var(--text-xs)" }}>Invoice Note</span>
					<textarea
						className="input"
						style={{ width: "100%" }}
						rows={2}
						placeholder="Note sent to the applicant with this invoice..."
						value={note}
						onChange={(e) => setNote(e.target.value)}
					/>
				</div>

				{/* Actions - pinned, or on a short window the whole card scrolls and
				    the total and Issue button leave the screen entirely */}
				<div
					style={{
						display: "flex",
						gap: "0.75rem",
						position: "sticky",
						bottom: 0,
						background: "var(--card)",
						paddingTop: "0.85rem",
						marginTop: "-0.35rem",
						borderTop: "1px solid var(--border-light)",
					}}
				>
					<button
						type="button"
						className="btn btn--primary"
						style={{ flex: 1 }}
						disabled={total === 0 || lines.length === 0}
						onClick={() => onIssue(lines, note, type)}
					>
						Issue Invoice - {fmtBoth(total)}
					</button>
					<button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
				</div>

				{applicantPackage && (
					<p className="mono muted mt-3" style={{ fontSize: "var(--text-xs)" }}>
						Package: {applicantPackage} - line items auto-populated from the service catalogue.
					</p>
				)}
			</div>
		</div>,
		document.body,
	);
}
