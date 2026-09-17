import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { documentsApi } from "century-nit-core/api";
import { REQUIRED_DOCUMENTS } from "century-nit-core";
import type { ApplicantDocument, DocumentChecklistItem } from "century-nit-shared";
import { StatusPill, type Tone } from "century-nit-core/ui";
import { DocPreviewInline, type DocPreviewData } from "../DocPreviewInline";

const DOC_STATUS_LABEL: Record<string, string> = {
	UPLOADED: "Pending review",
	VERIFIED: "Verified",
	REJECTED: "Rejected",
	PENDING_UPLOAD: "Pending upload",
};
const DOC_STATUS_TONE: Record<string, Tone> = {
	UPLOADED: "waiting",
	VERIFIED: "done",
	REJECTED: "blocked",
	PENDING_UPLOAD: "neutral",
};

/** Words in a filename that say what the file probably is — checked against the declared type. */
const FILE_TELLS: [RegExp, string][] = [
	[/invoice|receipt|payment/i, "an invoice or receipt"],
	[/passport/i, "a passport"],
	[/transcript/i, "a transcript"],
	[/bank|statement/i, "a bank statement"],
	[/ielts|toefl|english/i, "an english test"],
	[/\bcv\b|resume/i, "a cv"],
	[/recommend|reference.?letter/i, "a letter"],
	[/diploma|degree|certificat/i, "a certificate"],
	[/photo|headshot/i, "a photo"],
];
/** The telltale a filename carries when it disagrees with the declared type; null when they agree or nothing is told. */
function filenameTell(fileName: string, declaredType: string): string | null {
	const tell = FILE_TELLS.find(([re]) => re.test(fileName));
	if (!tell) return null;
	const declared = declaredType.toLowerCase();
	// The declared type containing a telltale word is agreement, not mismatch.
	if (tell[1].split(" ").some((w) => w.length > 2 && declared.includes(w))) return null;
	return tell[1];
}

/**
 * The applicant's documents on a case — what was asked for, what arrived,
 * and verify / reject in place with an inline preview. One panel for the
 * consultation and application details; verification is the same act at
 * either stage, so it should not look different.
 */
export function CaseDocumentsPanel({
	ownerUserId,
	applicantName,
	reference,
	requestedDocuments,
	canReview,
	requestHint = "Nothing requested yet.",
	onChange,
	onRequest,
	checklist,
}: {
	/** The standard documents this client must have verified; collected at consultation. */
	checklist?: DocumentChecklistItem[];
	/** Portal user who owns the uploads; null until the applicant has an account. */
	ownerUserId: string | null | undefined;
	applicantName: string;
	reference: string;
	requestedDocuments: string[];
	/** Only the assigned handler (or a manager) may verify. */
	canReview: boolean;
	requestHint?: string;
	/** Fires with the current list whenever it loads or a verdict changes it. */
	onChange?: (docs: ApplicantDocument[]) => void;
	/** Ask the applicant for more documents; absent when the viewer may not. */
	onRequest?: (documents: string[]) => Promise<unknown>;
}) {
	const [requestDraft, setRequestDraft] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [requesting, setRequesting] = useState(false);
	const [requestError, setRequestError] = useState<string | null>(null);
	// The client sees these exact names — offer the canonical list first,
	// free text for anything outside it.
	const asked = new Set([...requestedDocuments, ...(checklist?.map((d) => d.name) ?? [])]);
	const suggested = REQUIRED_DOCUMENTS.filter((d) => !asked.has(d.name)).map((d) => d.name);
	async function sendRequest() {
		const list = [...picked, ...requestDraft.split(",").map((d) => d.trim()).filter(Boolean)];
		if (!onRequest || list.length === 0) return;
		setRequesting(true);
		setRequestError(null);
		try {
			await onRequest(list);
			setRequestDraft("");
			setPicked([]);
		} catch (e) {
			setRequestError(e instanceof Error ? e.message : "Could not send the request");
		} finally {
			setRequesting(false);
		}
	}
	const [docs, setDocs] = useState<ApplicantDocument[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState<(DocPreviewData & { documentId: string }) | null>(null);
	useEffect(() => {
		onChange?.(docs);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- notify on list changes only
	}, [docs]);

	useEffect(() => {
		if (!ownerUserId) {
			setDocs([]);
			return;
		}
		let cancelled = false;
		setLoading(true);
		documentsApi
			.list({ ownerUserId })
			.then((res) => {
				if (!cancelled) setDocs(res.documents);
			})
			.catch(() => {
				if (!cancelled) setDocs([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [ownerUserId]);

	async function review(documentId: string, status: "VERIFIED" | "REJECTED") {
		try {
			const updated = await documentsApi.review(documentId, { status });
			setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
			setPreviewing((prev) => (prev && prev.documentId === updated.id ? { ...prev, status: DOC_STATUS_LABEL[updated.status] ?? updated.status } : prev));
			setError(null);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Could not review document");
		}
	}

	const pending = docs.filter((d) => d.status === "UPLOADED").length;
	const verified = docs.filter((d) => d.status === "VERIFIED").length;

	if (previewing) {
		return (
			<div className="card">
				<div className="cn-docs__preview-head">
					<div>
						<h3 className="cn-docs__preview-title">{previewing.name}</h3>
						<p className="cn-docs__meta">
							{previewing.category} · {applicantName} · {reference}
						</p>
					</div>
					<button type="button" className="btn btn--sm btn--ghost" onClick={() => setPreviewing(null)}>
						← Back to list
					</button>
				</div>
				<DocPreviewInline
					doc={previewing}
					isMine={canReview}
					applicantName={applicantName}
					reference={reference}
					documentId={previewing.documentId}
					onVerdict={(status) => void review(previewing.documentId, status)}
				/>
			</div>
		);
	}

	const requiredVerified = checklist?.filter((d) => d.status === "VERIFIED").length ?? 0;
	return (
		<>
			{checklist && checklist.length > 0 && (
				<div className="card">
					<div className="cn-docs__head">
						<p className="eyebrow">Required documents</p>
						<StatusPill tone={requiredVerified === checklist.length ? "done" : "waiting"} dot>
							{requiredVerified}/{checklist.length} verified
						</StatusPill>
					</div>
					<p className="muted cn-docs__meta">Collected at consultation. Applications cannot be invoiced until every one is verified.</p>
					<ul className="cn-docs__requested">
						{checklist.map((d) => (
							<li key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "baseline" }}>
								<span title={d.hint}>{d.name}</span>
								<StatusPill tone={d.status === "VERIFIED" ? "done" : d.status === "UPLOADED" ? "waiting" : d.status === "REJECTED" ? "blocked" : "neutral"}>
									{d.status === "VERIFIED" ? "Verified" : d.status === "UPLOADED" ? "To review" : d.status === "REJECTED" ? "Rejected" : "Not uploaded"}
								</StatusPill>
							</li>
						))}
					</ul>
				</div>
			)}
			<div className="card">
				<p className="eyebrow mb-2">Requested from the client</p>
				{requestedDocuments.length > 0 ? (
					<ul className="cn-docs__requested">
						{requestedDocuments.map((d) => (
							<li key={d}>{d}</li>
						))}
					</ul>
				) : (
					<p className="muted cn-docs__meta">{requestHint}</p>
				)}
				{onRequest && (
					<form
						className="cn-assign mt-3"
						onSubmit={(e) => {
							e.preventDefault();
							void sendRequest();
						}}
					>
						{suggested.length > 0 && (
							<div className="cn-scaffold__chips" role="group" aria-label="Standard documents">
								{suggested.map((name) => {
									const on = picked.includes(name);
									return (
										<button
											key={name}
											type="button"
											className={`ops-pill ops-pill--chip${on ? " ops-pill--on" : ""}`}
											aria-pressed={on}
											onClick={() => setPicked((prev) => (on ? prev.filter((p) => p !== name) : [...prev, name]))}
										>
											{name}
										</button>
									);
								})}
							</div>
						)}
						<div className="cn-assign__row">
							<input
								className="input input--sm"
								placeholder="Other — one document name, or comma separated"
								value={requestDraft}
								onChange={(e) => setRequestDraft(e.target.value)}
								disabled={requesting}
								aria-label="Other documents to request"
							/>
							<button type="submit" className="btn btn--sm btn--primary" disabled={requesting || (picked.length === 0 && !requestDraft.trim())}>
								{requesting ? "Sending…" : `Request ${picked.length > 0 ? `selected (${picked.length})` : "documents"}`}
							</button>
						</div>
						{requestError && <p className="cn-assign__error">{requestError}</p>}
					</form>
				)}
			</div>

			<div className="card">
				<div className="cn-docs__head">
					<p className="eyebrow">Uploaded</p>
					{docs.length > 0 && (
						<StatusPill tone={pending > 0 ? "waiting" : "done"} dot>
							{verified}/{docs.length} verified{pending > 0 ? ` · ${pending} to review` : ""}
						</StatusPill>
					)}
				</div>
				{error && <p className="cn-assign__error">{error}</p>}
				{loading ? (
					<p className="muted cn-docs__meta">Loading…</p>
				) : docs.length === 0 ? (
					<p className="muted cn-docs__meta">
						{ownerUserId ? "The applicant has not uploaded any documents." : "The applicant does not have a portal account yet."}
					</p>
				) : (
					<ul className="cn-docs">
						{docs.map((doc) => {
							const settled = doc.status === "VERIFIED" || doc.status === "REJECTED";
							return (
								<li key={doc.id} className="cn-docs__row">
									<button
										type="button"
										className="cn-docs__file"
										onClick={() =>
											setPreviewing({
												name: doc.fileName,
												category: doc.documentType,
												status: DOC_STATUS_LABEL[doc.status] ?? doc.status,
												isLive: true,
												documentId: doc.id,
											})
										}
									>
										<span className="cn-docs__name">{doc.fileName}</span>
										<span className="cn-docs__meta">
											declared as {doc.documentType}
											{(() => {
												const tell = filenameTell(doc.fileName, doc.documentType);
												return tell ? ` — filename suggests ${tell}, check before verifying` : "";
											})()}
											{doc.sizeBytes ? ` · ${(doc.sizeBytes / 1024).toFixed(0)} KB` : ""}
											{doc.uploadedAt ? ` · ${new Date(doc.uploadedAt).toLocaleDateString()}` : ""} · Inspect →
										</span>
									</button>
									<div className="cn-docs__actions">
										<StatusPill tone={DOC_STATUS_TONE[doc.status] ?? "neutral"}>{DOC_STATUS_LABEL[doc.status] ?? doc.status}</StatusPill>
										{!settled && canReview && (
											<>
												<button type="button" className="btn btn--sm" onClick={() => void review(doc.id, "VERIFIED")}>
													Verify
												</button>
												<button type="button" className="btn btn--sm btn--ghost" onClick={() => void review(doc.id, "REJECTED")}>
													Reject
												</button>
											</>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
				{docs.some((d) => d.status === "UPLOADED") && !canReview && (
					<p className="muted cn-docs__meta">Only the assigned handler can verify documents.</p>
				)}
				{ownerUserId && (
					<p className="cn-docs__meta">
						<Link to={`/documents?owner=${ownerUserId}`} className="link-arrow">
							Open in Document Vault →
						</Link>
					</p>
				)}
			</div>
		</>
	);
}
