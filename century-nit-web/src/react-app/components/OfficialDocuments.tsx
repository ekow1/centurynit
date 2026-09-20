import { useEffect, useState } from "react";
import { DOCUMENT_TYPES } from "century-nit-core";
import { ApiError, documentsApi, schoolsApi } from "century-nit-core/api";
import { openInNewTab } from "century-nit-core";
import { RELEASE_GATED_DOCUMENT_TYPES, type ApplicantDocument } from "century-nit-shared";
import { Button } from "./ui/Button";

/**
 * The documents Century holds as the client's agent. The admission letter
 * from each school, the visa receipt, the visa grant, the flight receipt.
 * Visible from the moment they are filed; the letter and the visa documents
 * open once the pre-departure fee milestone is paid (the API refuses
 * before then. This is what that refusal looks like).
 */

export type OfficialRow =
	| { kind: "offer-letter"; id: string; label: string; detail: string; gated: true }
	| { kind: "document"; id: string; label: string; detail: string; gated: boolean; doc: ApplicantDocument };

export function officialRows(input: {
	schools: { id: string; universityName?: string | null; programName?: string | null; offerLetterStorageKey?: string | null }[];
	docs: ApplicantDocument[];
}): OfficialRow[] {
	const rows: OfficialRow[] = [];
	for (const s of input.schools) {
		if (s.offerLetterStorageKey) {
			rows.push({ kind: "offer-letter", id: s.id, label: `Admission letter · ${s.universityName ?? "your school"}`, detail: s.programName ?? "", gated: true });
		}
	}
	for (const type of ["visa_grant", "visa_receipt", "flight_receipt"]) {
		const doc = input.docs.find((d) => d.documentType === type && d.status !== "PENDING_UPLOAD");
		if (!doc) continue;
		const meta = DOCUMENT_TYPES.find((d) => d.id === type);
		rows.push({
			kind: "document",
			id: doc.id,
			label: meta?.name ?? (type === "visa_receipt" ? "Visa application receipt" : type === "flight_receipt" ? "Flight receipt" : type),
			detail: doc.fileName,
			gated: RELEASE_GATED_DOCUMENT_TYPES.includes(type),
			doc,
		});
	}
	return rows;
}

export function OfficialDocuments({
	rows,
	released,
	holdReason,
	hidePayCta = false,
	variant = "cards",
}: {
	rows: OfficialRow[];
	/** The pre-departure fee milestone is paid, or a manager released early. */
	released: boolean;
	holdReason: string;
	/** The pay CTA lives elsewhere on the page (the departure chapter keeps one pay button). */
	hidePayCta?: boolean;
	/** "rows" is the departure chapter's document list; "cards" keeps the shared look. */
	variant?: "cards" | "rows";
}) {
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setError(null), [released]);
	if (rows.length === 0) return null;
	const held = rows.filter((r) => r.gated && !released);

	async function open(row: OfficialRow) {
		setBusy(row.id);
		setError(null);
		try {
			await openInNewTab(
				row.kind === "offer-letter" ? schoolsApi.meAdmissionLetterDownloadUrl(row.id) : documentsApi.downloadUrl(row.id),
			);
		} catch (err) {
			setError(err instanceof ApiError && err.code === "RELEASE_HELD" ? err.message : "Could not open the document. Please try again.");
		} finally {
			setBusy(null);
		}
	}

	if (variant === "rows") {
		return (
			<div>
				{rows.map((row) => {
					const locked = row.gated && !released;
					const date =
						row.kind === "document"
							? (row.doc.uploadedAt ?? row.doc.createdAt)
							: null;
					return (
						<div key={`${row.kind}-${row.id}`} className={`vdoc${locked ? " vdoc--held" : ""}`}>
							<span className={`vdoc__mark${locked ? "" : " vdoc__mark--on"}`}>{locked ? "○" : "●"}</span>
							<div>
								<p className="vdoc__nm">{row.label}</p>
								<p className="vdoc__hint">
									Filed by Century NIT{date ? ` · ${new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
								</p>
							</div>
							<span className={`portal-pill ${locked ? "portal-pill--hollow" : "portal-pill--solid"}`}>
								{locked ? "Held until fee" : "Released"}
							</span>
							{locked ? null : (
								<Button variant="ghost" size="sm" onClick={() => void open(row)} disabled={busy === row.id} style={{ minHeight: 44 }}>
									{busy === row.id ? "Opening…" : "Download ↓"}
								</Button>
							)}
						</div>
					);
				})}
				{held.length > 0 ? (
					<p className="muted mt-2" style={{ fontSize: "0.78rem" }}>
						All {held.length} release together once the service fee settles. {holdReason}
					</p>
				) : null}
				{held.length > 0 && !hidePayCta ? (
					<div className="row mt-3">
						<Button to="/portal/payment-execution" arrow>
							Pay the fee milestone
						</Button>
					</div>
				) : null}
				{error ? (
					<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
						{error}
					</p>
				) : null}
			</div>
		);
	}

	return (
		<section className="sharp-card">
			<div className="between" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
				<p className="eyebrow">From Century NIT · official documents</p>
				<span className="mono muted" style={{ fontSize: "0.8rem" }}>
					{held.length > 0 ? `${held.length} held` : "released"}
				</span>
			</div>
			<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
				{held.length > 0
					? `Filed and waiting for you. ${holdReason}`
					: "Filed by your consultant. Open them any time."}
			</p>
			<ul style={{ listStyle: "none", margin: "0.75rem 0 0", padding: 0 }}>
				{rows.map((row) => {
					const locked = row.gated && !released;
					return (
						<li key={`${row.kind}-${row.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0", borderBottom: "1px solid var(--border-light)" }}>
							<div style={{ minWidth: 0 }}>
								<p style={{ fontWeight: 600 }}>{row.label}</p>
								{row.detail ? (
									<p className="muted" style={{ fontSize: "0.85rem" }}>
										{row.detail}
									</p>
								) : null}
							</div>
							{locked ? (
								<span className="portal-pill portal-pill--hollow">held</span>
							) : (
								<Button variant="secondary" className="btn--sm" onClick={() => void open(row)} disabled={busy === row.id}>
									{busy === row.id ? "Opening…" : "Open"}
								</Button>
							)}
						</li>
					);
				})}
			</ul>
			{held.length > 0 && !hidePayCta ? (
				<div className="row mt-3">
					<Button to="/portal/payment-execution" arrow>
						Pay the fee milestone
					</Button>
				</div>
			) : null}
			{error ? (
				<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
					{error}
				</p>
			) : null}
		</section>
	);
}
