import { useEffect, useState } from "react";
import { DOCUMENT_TYPES } from "century-nit-core";
import { ApiError, documentsApi, schoolsApi } from "century-nit-core/api";
import { RELEASE_GATED_DOCUMENT_TYPES, type ApplicantDocument } from "century-nit-shared";
import { Button } from "./ui/Button";

/**
 * The documents Century holds as the client's agent — the admission letter
 * from each school, the visa receipt, the visa grant, the flight receipt.
 * Visible from the moment they are filed; the letter and the visa documents
 * open once the pre-departure fee milestone is paid (the API refuses
 * before then — this is what that refusal looks like).
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
			rows.push({ kind: "offer-letter", id: s.id, label: `Admission letter — ${s.universityName ?? "your school"}`, detail: s.programName ?? "", gated: true });
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
}: {
	rows: OfficialRow[];
	/** The pre-departure fee milestone is paid, or a manager released early. */
	released: boolean;
	holdReason: string;
	/** The pay CTA lives elsewhere on the page (the departure chapter keeps one pay button). */
	hidePayCta?: boolean;
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
			const ticket = row.kind === "offer-letter" ? await schoolsApi.meAdmissionLetterDownloadUrl(row.id) : await documentsApi.downloadUrl(row.id);
			window.open(ticket.url, "_blank", "noopener");
		} catch (err) {
			setError(err instanceof ApiError && err.code === "RELEASE_HELD" ? err.message : "Could not open the document. Please try again.");
		} finally {
			setBusy(null);
		}
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
					: "Filed by your consultant — open them any time."}
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
