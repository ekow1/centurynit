import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useCases } from "../../../hooks/useCases";
import { InvoiceCard } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";
import type { TabId } from "./types";
import { schoolsApi, ApiError } from "century-nit-core/api";
import {
	ALLOWED_DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,

	schoolDecisionNote,
	type SchoolApplication,
	type SchoolOutcome,
} from "century-nit-shared";
import { issueApplicationInvoice, raiseApplicationInvoice } from "../../../lib/api";

function InlineSchoolTracker({ appId, school }: { appId: string; school: SchoolApplication }) {
	const { updateSchoolApplication } = useCases();
	const [status, setStatus] = useState<string>(school.status || "Preparing Application");
	const [outcome, setOutcome] = useState<string>(school.outcome || "Admitted");
	const [consultantNote, setConsultantNote] = useState(school.handlerNote ?? "");
	const [sendUpdateEmail, setSendUpdateEmail] = useState(true);

	const [isSaving, setIsSaving] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [uploadPct, setUploadPct] = useState(0);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [hasLetter, setHasLetter] = useState(Boolean(school.offerLetterStorageKey));
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const showOfferFields = status === "Decision Reached" && outcome === "Admitted";
	const showDecisionFields = status === "Decision Reached";

	const effectiveNote = showDecisionFields
		? consultantNote.trim() ||
			(schoolDecisionNote({
				outcome: outcome as SchoolOutcome,
				universityName: school.universityName,
				programName: school.programName,
			}) ?? "")
		: "";

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await updateSchoolApplication(appId, school.id, {
				status: status as any,
				outcome: status === "Decision Reached" ? outcome as any : null,
				sendUpdateEmail: status === "Decision Reached" && sendUpdateEmail,
				handlerNote: consultantNote.trim() || null,
				consultantNote: consultantNote.trim() || null,
			});
		} catch {
			/* handled by hook */
		} finally {
			setIsSaving(false);
		}
	};

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setUploadError(null);

		if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as any)) {
			setUploadError("Upload a PDF, image (JPEG, PNG), or Word document (DOC, DOCX).");
			e.target.value = "";
			return;
		}
		if (file.size > MAX_DOCUMENT_BYTES) {
			setUploadError("That file is larger than 15 MB.");
			e.target.value = "";
			return;
		}

		setUploading(true);
		setUploadPct(0);
		try {
			await schoolsApi.uploadAdmissionLetter(school.id, file, (p) => setUploadPct(p));
			setHasLetter(true);
		} catch (err) {
			const msg =
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: "Could not upload the admission letter.";
			setUploadError(msg);
		} finally {
			setUploading(false);
			e.target.value = "";
		}
	};

	const handleRemoveLetter = async () => {
		setUploading(true);
		setUploadError(null);
		try {
			await schoolsApi.removeAdmissionLetter(school.id);
			setHasLetter(false);
		} catch (err) {
			const msg =
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: "Could not remove the admission letter.";
			setUploadError(msg);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "var(--text-xs)" }}>
			<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
				<select
					className="input input--sm"
					value={status}
					onChange={(e) => setStatus(e.target.value)}
					style={{ width: "auto" }}
				>
					<option value="Preparing Application">Preparing Application</option>
					<option value="Submitted">Submitted</option>
					<option value="Decision Reached">Decision Reached</option>
				</select>

				{status === "Decision Reached" && (
					<select
						className="input input--sm"
						value={outcome}
						onChange={(e) => setOutcome(e.target.value)}
						style={{ width: "auto" }}
					>
						<option value="Admitted">Admitted</option>
						<option value="Waitlisted">Waitlisted</option>
						<option value="Application Rejected">Application Rejected</option>
						<option value="Withdrawn">Withdrawn</option>
					</select>
				)}

				<button
					type="button"
					className="btn btn--primary btn--sm"
					onClick={handleSave}
					disabled={isSaving}
					style={{ marginLeft: "auto" }}
				>
					{isSaving ? "Saving..." : "Update Status"}
				</button>
			</div>

			{showDecisionFields && (
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", padding: "0.75rem", background: "var(--background)", border: "1px solid var(--border-light)", marginTop: "0.5rem" }}>
					<p className="eyebrow" style={{ gridColumn: "1 / -1", margin: 0 }}>
						{showOfferFields ? "Offer details" : "Decision update"}
					</p>
					{showOfferFields ? (
						<div className="cn-facts__full">
							<p className="muted" style={{ marginBottom: "0.15rem" }}>Official admission letter (PDF / image / Word)</p>
							<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
								<input
									ref={fileInputRef}
									type="file"
									accept={ALLOWED_DOCUMENT_TYPES.join(",")}
									onChange={handleFileChange}
									disabled={uploading}
									className="text-xs"
								/>
								{hasLetter && !uploading ? (
									<button
										type="button"
										className="btn btn--ghost btn--sm"
										onClick={handleRemoveLetter}
									>
										Remove letter
									</button>
								) : null}
								{uploading ? (
									<span className="muted text-xs">
										Uploading… {uploadPct}%
									</span>
								) : hasLetter ? (
									<span style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>
										✓ Letter uploaded
									</span>
								) : null}
							</div>
							{uploadError ? (
								<p style={{ color: "var(--danger, #b91c1c)", fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
									{uploadError}
								</p>
							) : null}
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
								The letter is stored in the document vault under the applicant's folder and emailed
								to the applicant when “Send status update email” is checked.
							</p>
						</div>
					) : null}
					<div className="cn-facts__full">
						<p className="muted" style={{ marginBottom: "0.15rem" }}>
							Note to applicant (optional — leave blank to use the automated message)
						</p>
						<textarea
							className="input input--sm"
							placeholder="Leave blank for the automated message, or type a custom note…"
							value={consultantNote}
							onChange={(e) => setConsultantNote(e.target.value)}
							rows={2}
						/>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.15rem", marginTop: "0.5rem" }}>
							Applicant will see in the portal Latest update:
						</p>
						<div
							style={{
								background: "var(--background)",
								border: "1px solid var(--border-light)",
								padding: "0.5rem 0.6rem",
								fontSize: "var(--text-xs)",
								color: "var(--text)",
								whiteSpace: "pre-wrap",
							}}
						>
							{effectiveNote || <span className="muted">Waiting for first handler update…</span>}
						</div>
					</div>
					<div className="cn-facts__full">
						<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
							<input
								type="checkbox"
								checked={sendUpdateEmail}
								onChange={(e) => setSendUpdateEmail(e.target.checked)}
							/>
							<span>Send status update email to applicant (includes note & admission letter if uploaded)</span>
						</label>
					</div>
				</div>
			)}
		</div>
	);
}


/** Applications — schools, the application fee, submissions and offers. */
export function ApplicationsTab({
	app,
	appInvoice,
	appInvoiceLoading,
	canIssueInvoices,
	outstandingDocs,
	setTab,
	onInvoiceChanged,
}: {
	app: MockApplication;
	appInvoice: ApiInvoice | null;
	appInvoiceLoading: boolean;
	canIssueInvoices: boolean;
	/** Names of the standard documents not yet verified — nothing is invoiced while any remain. */
	outstandingDocs: string[];
	setTab: (t: TabId) => void;
	/** The application invoice was raised or issued; the parent reloads the case's invoices. */
	onInvoiceChanged: (updated: ApiInvoice) => void;
}) {
	const { toggleApplicationChecklist } = useCases();
	const [issuingInvoice, setIssuingInvoice] = useState(false);
	const [invoiceFlash, setInvoiceFlash] = useState<string | null>(null);

	function handleIssueApplicationInvoice() {
		setIssuingInvoice(true);
		(canIssueInvoices ? issueApplicationInvoice(app.id) : raiseApplicationInvoice(app.id))
			.then((updated) => {
				onInvoiceChanged(updated);
				setInvoiceFlash(
					updated.status === "proforma"
						? `Proforma ${updated.invoiceNumber} raised — finance will review and issue it.`
						: `Invoice ${updated.invoiceNumber} issued — applicant can now pay.`,
				);
				window.setTimeout(() => setInvoiceFlash(null), 5000);
			})
			.catch((e) => {
				setInvoiceFlash(e instanceof Error ? e.message : "Failed to issue invoice");
				window.setTimeout(() => setInvoiceFlash(null), 5000);
			})
			.finally(() => setIssuingInvoice(false));
	}
	async function handleToggleChecklist(itemIndex: number) {
		const item = app.checklist[itemIndex];
		if (!item) return;
		await toggleApplicationChecklist(app.id, item.id, !item.checked);
	}
	return (
		<>
					{(() => {
						if (app.appFeePaid) return null;

						const isProforma = appInvoice?.status === "proforma";
						const schools = app.schoolApplications?.length ?? 0;

						return (
							<div className="card">
								{invoiceFlash && (
									<p className="mb-2" style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{invoiceFlash}</p>
								)}
								{appInvoiceLoading ? (
									<p className="muted text-sm">Loading invoice…</p>
								) : !appInvoice ? (
									<>
										<p className="eyebrow mb-1">Application invoice</p>
										<p className="text-sm--strong">
											No invoice yet — {schools === 0 ? "no schools selected" : `${schools} school(s) selected`}
										</p>
										<p className="muted text-xs">
											Issue the application fee invoice so the applicant can pay. Per-school line items are added as schools are selected.
										</p>
										<div className="mt-3" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
											<button
												type="button"
												className="btn btn--sm btn--primary"
												onClick={handleIssueApplicationInvoice}
												disabled={issuingInvoice || outstandingDocs.length > 0}
												title={outstandingDocs.length > 0 ? `Verify first: ${outstandingDocs.join(", ")}` : undefined}
											>
												{issuingInvoice ? (canIssueInvoices ? "Issuing…" : "Raising…") : canIssueInvoices ? "Issue application invoice" : "Raise application invoice"}
											</button>
											{outstandingDocs.length > 0 && (
												<button type="button" className="btn btn--sm btn--ghost" onClick={() => setTab("documents")}>
													Verify documents first · {outstandingDocs.length} outstanding →
												</button>
											)}
										</div>
									</>
								) : (
									<InvoiceCard
										title="Application invoice"
										invoice={appInvoice}
										hint={
											isProforma
												? canIssueInvoices
													? "The applicant cannot pay until you review and issue this invoice."
													: "Raised — the applicant cannot pay until finance reviews and issues it."
												: undefined
										}
										actions={
											isProforma && canIssueInvoices ? (
												<Link to={`/invoices?open=${appInvoice.id}`} className="btn btn--sm btn--primary">
													Review & issue
												</Link>
											) : canIssueInvoices ? (
												<Link to={`/invoices?open=${appInvoice.id}`} className="btn btn--sm btn--ghost">
													Open in Invoices →
												</Link>
											) : undefined
										}
									/>
								)}
							</div>
						);
					})()}
						{/* School Applications */}
						<div className="card">
							<p className="eyebrow mb-3">School Applications</p>
							{(() => {
								const schools = app.schoolApplications ?? [];
								const total = schools.length;
								const admitted = schools.filter((s) => s.outcome === "Admitted").length;
								const pending = schools.filter((s) => s.status !== "Decision Reached").length;
								const rejected = schools.filter((s) => s.outcome === "Application Rejected" || s.outcome === "Withdrawn").length;
								const cap = app.targetSchoolCount ?? null;
								const over = cap != null && cap > 0 && total > cap;
								return (
									<>
										<div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
											<span>{total} school{total !== 1 ? "s" : ""}{cap ? ` of ${cap} allowed` : ""}</span>
											{admitted > 0 ? <span style={{ fontWeight: 700 }}>{admitted} admitted</span> : null}
											{pending > 0 ? <span>{pending} pending</span> : null}
											{rejected > 0 ? <span style={{ color: "var(--danger, #b91c1c)" }}>{rejected} rejected/declined</span> : null}
										</div>
										{over && (
											<div style={{ border: "1px solid var(--foreground)", padding: "0.6rem 0.75rem", marginBottom: "0.75rem" }}>
												<span className="wf-badge wf-badge--warn">Over allowance</span>
												<p className="muted mt-1" style={{ fontSize: "var(--text-xs)" }}>
													{total} schools tracked against a {cap}-school package. Confirm the client has paid for the extra applications before sending them.
												</p>
											</div>
										)}
									</>
								);
							})()}
							{app.schoolApplications && app.schoolApplications.length > 0 ? (
								<div className="cn-stack">
									{app.schoolApplications.map((s) => {
										const displayName = s.universityName || s.universityId;
										const displayProgram = s.programName || s.programId;
										const displayCountry = s.countryName || s.destinationId;
										const admitted = s.outcome === "Admitted";
										return (
											<div
												key={s.id}
												style={{
													padding: "0.6rem 0.75rem",
													border: admitted ? "2px solid var(--foreground)" : "1px solid var(--border-light)",
													background: admitted ? "var(--muted)" : "transparent",
												}}
											>
												<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
													<div style={{ width: "100%" }}>
														<p style={{ fontWeight: 500 }}>{displayName}</p>
														<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.5rem" }}>{displayProgram} · {displayCountry} · {s.intake}</p>
														<InlineSchoolTracker appId={app.appId} school={s} />
													</div>
												</div>
											</div>
										);
									})}
								</div>
							) : (
								<p className="muted text-sm">No schools have been selected yet.</p>
							)}
						</div>
						{/* Document Checklist */}
						<div className="card">
							<p className="eyebrow mb-3">Verification Checklist</p>
							<div className="cn-stack">
								{app.checklist.map((item, idx) => (
									<label
										key={item.id}
										style={{
											display: "flex",
											alignItems: "center",
											gap: "0.75rem",
											fontSize: "var(--text-sm)",
											cursor: "pointer",
											padding: "0.5rem",
											border: "1px solid var(--border-light)",
										}}
									>
										<input
											type="checkbox"
											checked={item.checked}
											onChange={() => handleToggleChecklist(idx)}
										/>
										<span style={{ textDecoration: item.checked ? "line-through" : "none", opacity: item.checked ? 0.7 : 1 }}>
											{item.label}
										</span>
									</label>
								))}
							</div>
						</div>
		</>
	);
}
