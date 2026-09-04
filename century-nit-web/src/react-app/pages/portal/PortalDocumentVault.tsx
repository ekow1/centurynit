import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { REQUIRED_DOCUMENTS } from "century-nit-core";
import { ApiError, documentsApi } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "century-nit-shared";
import type { ApplicantDocument } from "century-nit-shared";
import { Button } from "../../components/ui/Button";
import { IconDoc } from "../../components/ui/Icons";
import { UploadProgressModal, type UploadStage } from "../../components/portal/UploadProgressModal";
import { prepareDocumentForUpload } from "../../lib/upload";

/**
 * The applicant's document vault — fully server-backed.
 *
 * Every file goes through a presigned R2 URL: the browser takes a ticket from
 * the API, PUTs the bytes straight to storage, and tells the API they landed.
 * Nothing passes through Node. The consultant sees the upload in the ops review
 * queue, and their verdict flows back here as `VERIFIED` / `REJECTED`.
 *
 * `RequireAuth` guarantees a signed-in session, so a load failure is an
 * operational error (shown with a retry) rather than the previous "signed out →
 * localStorage demo" path. The demo path has been removed: there is no
 * fabricated upload and no fallback store, only the real one.
 */

const STATUS_META: Record<string, { label: string; pill: string }> = {
	missing: { label: "Action Required", pill: "portal-pill--missing" },
	uploaded: { label: "In Review", pill: "portal-pill--uploaded" },
	verified: { label: "Verified ✓", pill: "portal-pill--verified" },
	rejected: { label: "Resubmit", pill: "portal-pill--rejected" },
};

/** API vocabulary → the vault's. PENDING_UPLOAD never reaches a listing. */
const LIVE_STATUS: Record<string, string> = {
	UPLOADED: "uploaded",
	VERIFIED: "verified",
	REJECTED: "rejected",
};

const ACCEPT = ALLOWED_DOCUMENT_TYPES.join(",");

function readableError(err: unknown, fallback: string): string {
	if (err instanceof ApiError) {
		if (err.code === "STORAGE_NOT_CONFIGURED") {
			return "Uploads are temporarily unavailable. Please try again shortly.";
		}
		return err.message;
	}
	return fallback;
}

type VaultRow = {
	id: string;
	name: string;
	hint: string;
	live: ApplicantDocument | null;
	status: string;
	fileName: string | null;
	uploadedAt: string | null;
};

export function PortalDocumentVault() {
	const { toast } = useNotifier();
	const [liveDocs, setLiveDocs] = useState<Map<string, ApplicantDocument> | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeUpload, setActiveUpload] = useState<{
		fileName: string;
		percent: number;
		stage: UploadStage;
		error?: string;
	} | null>(null);
	const fileInput = useRef<HTMLInputElement | null>(null);
	const pendingTarget = useRef<string | null>(null);
	const [pickDocId, setPickDocId] = useState<string | null>(null);
	const pickDragCounter = useRef(0);
	const [pickDragOver, setPickDragOver] = useState(false);

	const loadLive = useCallback(async () => {
		setLoadError(null);
		try {
			const res = await documentsApi.list();
			setLiveDocs(new Map(res.documents.map((d) => [d.documentType, d])));
		} catch (err) {
			// Signed-out is no longer reachable here (RequireAuth gates the
			// portal), so a failure is operational — surface a retry.
			setLiveDocs(null);
			setLoadError(readableError(err, "Could not load your documents. Check your connection and try again."));
		}
	}, []);

	useEffect(() => {
		void loadLive();
	}, [loadLive]);

	const loading = liveDocs === null && !loadError;

	const rows: VaultRow[] = REQUIRED_DOCUMENTS.map((meta) => {
		const live = liveDocs?.get(meta.id) ?? null;
		return {
			id: meta.id,
			name: meta.name,
			hint: meta.hint,
			live,
			status: live ? (LIVE_STATUS[live.status] ?? "uploaded") : "missing",
			fileName: live?.fileName ?? null,
			uploadedAt: live?.uploadedAt ?? live?.createdAt ?? null,
		};
	});

	const uploadedCount = rows.filter((d) => d.status !== "missing").length;
	const verifiedCount = rows.filter((d) => d.status === "verified").length;
	const allUploaded = uploadedCount === rows.length;
	const allVerified = allUploaded && verifiedCount === rows.length;

	function handleUpload(id: string) {
		setError(null);
		setPickDocId(id);
	}

	function closePickModal() {
		setPickDocId(null);
		setPickDragOver(false);
		pickDragCounter.current = 0;
	}

	function onPickDragEnter(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current += 1;
		if (pickDragCounter.current === 1) setPickDragOver(true);
	}
	function onPickDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current -= 1;
		if (pickDragCounter.current <= 0) {
			pickDragCounter.current = 0;
			setPickDragOver(false);
		}
	}
	function onPickDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}
	function onPickDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current = 0;
		setPickDragOver(false);
		const file = e.dataTransfer.files?.[0];
		if (!file || !pickDocId) return;
		pendingTarget.current = pickDocId;
		closePickModal();
		void onFileChosen(file);
	}

	function pickBrowse() {
		if (!pickDocId) return;
		pendingTarget.current = pickDocId;
		closePickModal();
		fileInput.current?.click();
	}

	async function onFileChosen(file: File) {
		const id = pendingTarget.current;
		pendingTarget.current = null;
		if (!id) return;

		// Checked here as well as server-side, so the applicant learns before
		// waiting for a 15 MB upload to be refused at the end of it.
		if (file.size > MAX_DOCUMENT_BYTES) {
			const msg = `${file.name} is larger than 15 MB. Please upload a smaller scan.`;
			setError(msg);
			toast.error(msg);
			return;
		}
		if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
			const msg = "Upload a PDF, image (JPEG, PNG), or Word document (DOC, DOCX).";
			setError(msg);
			toast.error(msg);
			return;
		}

		setBusyId(id);
		setError(null);
		setActiveUpload({ fileName: file.name, percent: 0, stage: "preparing" });
		try {
			// Large images are re-encoded here so they fit comfortably under the
			// ceiling; PDFs and Word documents pass through untouched.
			const ready = await prepareDocumentForUpload(file, (p) => {
				setActiveUpload((u) => (u ? { ...u, percent: p, stage: "preparing" } : u));
			});

			if (ready.size > MAX_DOCUMENT_BYTES) {
				const msg = `${file.name} is still larger than 15 MB after compression. Please upload a smaller scan.`;
				setActiveUpload((u) => (u ? { ...u, stage: "error", error: msg } : u));
				toast.error(msg);
				return;
			}

			setActiveUpload((u) => (u ? { ...u, percent: 0, stage: "uploading" } : u));
			const saved = await documentsApi.upload(ready, id, {
				onProgress: (p) => {
					setActiveUpload((u) => (u ? { ...u, percent: p, stage: "uploading" } : u));
				},
			});
			setLiveDocs((current) => new Map(current ?? []).set(saved.documentType, saved));
			setActiveUpload(null);
			toast.success(`${file.name} uploaded.`);
		} catch (err) {
			const msg = readableError(err, `Could not upload ${file.name}. Please try again.`);
			setError(msg);
			setActiveUpload((u) => (u ? { ...u, stage: "error", error: msg } : u));
			toast.error(msg);
		} finally {
			setBusyId(null);
		}
	}

	async function handlePreview(row: VaultRow) {
		if (!row.live) {
			toast.info("Upload this document first to preview it.");
			return;
		}
		setBusyId(row.id);
		setError(null);
		try {
			const ticket = await documentsApi.downloadUrl(row.live.id);
			window.open(ticket.url, "_blank", "noopener,noreferrer");
		} catch (err) {
			const msg = readableError(err, "Could not open that document.");
			setError(msg);
			toast.error(msg);
		} finally {
			setBusyId(null);
		}
	}

	async function handleRemove(row: VaultRow) {
		if (!row.live) return;
		setBusyId(row.id);
		setError(null);
		try {
			await documentsApi.remove(row.live.id);
			setLiveDocs((current) => {
				const next = new Map(current ?? []);
				next.delete(row.live!.documentType);
				return next;
			});
			toast.success(`${row.fileName ?? row.name} removed.`);
		} catch (err) {
			// A verified document is refused with 409 — that rule is the server's,
			// and its message already explains what to do instead.
			const msg = readableError(err, "Could not remove that document.");
			setError(msg);
			toast.error(msg);
		} finally {
			setBusyId(null);
		}
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Documents</p>
					<h1 className="page-title mt-1">Document vault</h1>
					<p className="lead mt-2">
						Upload, replace, and track verification of every document in your file. Your
						consultant reviews each upload.
					</p>
				</div>
			</header>

			<div className="vault-hero mt-4">
				<div className="vault-hero__stats">
					<div className="vault-stat-card">
						<span className="vault-stat-card__label">Uploaded</span>
						<div className="vault-stat-card__val-row">
							<span className="vault-stat-card__val">{uploadedCount}</span>
							<span className="vault-stat-card__total">/ {rows.length}</span>
						</div>
						<span className="vault-stat-card__hint">Documents on file</span>
					</div>
					<div className="vault-stat-card">
						<span className="vault-stat-card__label">Verified</span>
						<div className="vault-stat-card__val-row">
							<span className="vault-stat-card__val vault-stat-card__val--green">{verifiedCount}</span>
							<span className="vault-stat-card__total">/ {rows.length}</span>
						</div>
						<span className="vault-stat-card__hint">Approved by consultant</span>
					</div>
					<div className="vault-stat-card">
						<span className="vault-stat-card__label">Review Status</span>
						<div className="vault-stat-card__status">
							<span
								className={`vault-status-chip vault-status-chip--${allVerified ? "verified" : allUploaded ? "review" : "action"}`}
							>
								{allVerified ? "✓ Complete" : allUploaded ? "● In Review" : "○ Action Needed"}
							</span>
						</div>
						<span className="vault-stat-card__hint">
							{allVerified
								? "All documents approved"
								: `${rows.length - uploadedCount} required document(s) remaining`}
						</span>
					</div>
				</div>
				<div className="vault-progress">
					<div className="vault-progress__bar">
						<div
							className="vault-progress__fill"
							style={{ width: `${Math.round((uploadedCount / (rows.length || 1)) * 100)}%` }}
						/>
					</div>
					<div className="vault-progress__meta">
						<span>{Math.round((uploadedCount / (rows.length || 1)) * 100)}% uploaded</span>
						<span>{Math.round((verifiedCount / (rows.length || 1)) * 100)}% verified</span>
					</div>
				</div>
			</div>

			<div className="vault-guidelines mt-3">
				<div className="vault-guidelines__icon" aria-hidden="true">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="16" x2="12" y2="12" />
						<line x1="12" y1="8" x2="12.01" y2="8" />
					</svg>
				</div>
				<div className="vault-guidelines__content">
					<p className="vault-guidelines__title">Accepted Formats & Guidelines</p>
					<p className="vault-guidelines__desc">
						Upload clear, readable copies in <strong>PDF, JPG, PNG, DOC, or DOCX</strong> (max <strong>15 MB</strong> per file). Large images are compressed automatically before upload.
					</p>
				</div>
			</div>

			<input
				ref={fileInput}
				type="file"
				accept={ACCEPT}
				hidden
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (file) void onFileChosen(file);
				}}
			/>

			{loadError ? (
				<div className="card card--pad mt-4" role="alert">
					<p className="muted">{loadError}</p>
					<div className="row mt-3">
						<Button type="button" variant="secondary" onClick={() => void loadLive()}>
							Try again
						</Button>
					</div>
				</div>
			) : null}

			{error ? (
				<div className="card card--pad mt-4" role="alert">
					<p className="muted">{error}</p>
				</div>
			) : null}

			<section className="mt-4">
				<div className="vault-list">
					{rows.map((doc) => {
						const statusMeta = STATUS_META[doc.status] ?? STATUS_META.missing;
						const busy = busyId === doc.id;
						return (
							<div key={doc.id} className={`doc-card doc-card--${doc.status}`}>
								<div className="doc-card__main">
									<span className="doc-card__icon" aria-hidden="true">
										<IconDoc size={22} />
									</span>

									<div className="doc-card__info">
										<div className="doc-card__heading">
											<h3 className="doc-card__title">{doc.name}</h3>
											<p className="doc-card__hint">{doc.hint}</p>
										</div>

										{doc.live?.reviewNote ? (
											<div className="doc-card__review-note">
												<strong>Consultant Feedback:</strong> {doc.live.reviewNote}
											</div>
										) : null}

										{doc.fileName ? (
											<div className="doc-card__attachment">
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
													<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
													<polyline points="14 2 14 8 20 8" />
												</svg>
												<span className="doc-card__filename mono">{doc.fileName}</span>
												{doc.uploadedAt ? (
													<>
														<span className="doc-card__sep" aria-hidden="true">·</span>
														<span className="doc-card__date">
															Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
														</span>
													</>
												) : null}
											</div>
										) : null}
									</div>
								</div>

								<div className="doc-card__side">
									<span className={`portal-pill ${statusMeta.pill}`}>
										{statusMeta.label}
									</span>
									<div className="doc-card__actions">
										{doc.fileName ? (
											<>
												<button
													type="button"
													className="btn btn--secondary btn--sm"
													onClick={() => void handlePreview(doc)}
													disabled={busy}
												>
													Preview
												</button>
												{doc.status !== "verified" ? (
													<button
														type="button"
														className="btn btn--secondary btn--sm"
														onClick={() => handleUpload(doc.id)}
														disabled={busy}
													>
														{busy ? "Uploading…" : "Replace"}
													</button>
												) : null}
												{doc.status !== "verified" ? (
													<button
														type="button"
														className="btn btn--ghost btn--sm btn--danger-hover"
														onClick={() => void handleRemove(doc)}
														disabled={busy}
													>
														Remove
													</button>
												) : null}
											</>
										) : (
											<Button
												type="button"
												variant="secondary"
												size="sm"
												onClick={() => handleUpload(doc.id)}
												disabled={busy || loading}
											>
												{busy ? "Uploading…" : "Upload"}
											</Button>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</section>

			{allUploaded && !allVerified ? (
				<div className="card card--pad mt-5 next-action">
					<p className="eyebrow">All documents uploaded</p>
					<p className="muted mt-1">
						Your consultant will review and verify each document. Check back for status updates.
					</p>
				</div>
			) : null}

			{allVerified ? (
				<div className="card card--pad mt-5">
					<p className="eyebrow">Verification complete</p>
					<p className="display mt-2" style={{ fontSize: "1.2rem" }}>
						All documents verified ✓
					</p>
					<p className="muted mt-1">
						Your document vault is cleared. You can proceed with school selection and
						application tracking.
					</p>
				</div>
			) : null}

			{pickDocId ? (() => {
				const doc = rows.find((r) => r.id === pickDocId);
				return (
					<div
						role="dialog"
						aria-modal="true"
						aria-label={`Upload ${doc?.name ?? "document"}`}
						onDragEnter={onPickDragEnter}
						onDragLeave={onPickDragLeave}
						onDragOver={onPickDragOver}
						onDrop={onPickDrop}
						style={{
							position: "fixed",
							inset: 0,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							background: "rgba(0,0,0,0.6)",
							zIndex: 9998,
							padding: "1rem",
						}}
					>
						<div
							className="card"
							style={{
								width: "100%",
								maxWidth: "420px",
								padding: "1.5rem",
								boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
							}}
						>
							<p className="eyebrow" style={{ margin: 0 }}>
								{doc?.status === "missing" ? "Upload" : "Replace"} document
							</p>
							<p style={{ margin: "0.5rem 0 1rem", fontSize: "0.95rem" }}>
								{doc?.name ?? "Select a file"}
								{doc?.hint ? <span className="muted" style={{ display: "block", fontSize: "0.85rem", marginTop: "0.15rem" }}>{doc.hint}</span> : null}
							</p>
							<div className={`drop-zone${pickDragOver ? " drop-zone--active" : ""}`}>
								<p className="drop-zone__label">Drop file here</p>
								<Button size="sm" onClick={pickBrowse}>
									Browse files
								</Button>
								<p className="drop-zone__hint">PDF, JPG, PNG, DOC or DOCX — max 15 MB</p>
							</div>
							<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
								<Button variant="ghost" size="sm" onClick={closePickModal}>
									Cancel
								</Button>
							</div>
						</div>
					</div>
				);
			})() : null}

			<UploadProgressModal
				open={activeUpload !== null}
				fileName={activeUpload?.fileName ?? ""}
				stage={activeUpload?.stage ?? "preparing"}
				percent={activeUpload?.percent ?? 0}
				error={activeUpload?.error}
				onClose={() => setActiveUpload(null)}
			/>
		</div>
	);
}