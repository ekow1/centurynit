import { useCallback, useEffect, useRef, useState } from "react";
import { REQUIRED_DOCUMENTS } from "century-nit-core";
import { ApiError, documentsApi } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "century-nit-shared";
import type { ApplicantDocument } from "century-nit-shared";
import { Button } from "../../components/ui/Button";
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
	missing: { label: "Not uploaded", pill: "portal-pill--needs_info" },
	uploaded: { label: "Uploaded - pending review", pill: "portal-pill--draft" },
	verified: { label: "Verified", pill: "portal-pill--approved" },
	rejected: { label: "Rejected - resubmit", pill: "portal-pill--needs_info" },
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

	function handleUpload(id: string) {
		setError(null);
		pendingTarget.current = id;
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
			toast.success(`${file.name} uploaded. Your consultant will review it.`);
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

			<div className="stat-band mt-4">
				<div className="stat-cell">
					<p className="stat-cell__label">Uploaded</p>
					<p className="stat-cell__value">
						{uploadedCount}/{rows.length}
					</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Verified</p>
					<p className="stat-cell__value">{verifiedCount}</p>
				</div>
				<div className="stat-cell stat-cell--accent">
					<p className="stat-cell__label">Verification</p>
					<p className="stat-cell__value">
						{verifiedCount === rows.length && allUploaded ? "All verified" : "In review"}
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
					// Reset first: choosing the same file twice must fire again, and it
					// will not if the value still matches.
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

			<section className="mt-6">
				<p className="eyebrow mb-3">Required documents</p>
				<div className="ledger">
					{rows.map((doc) => {
						const statusMeta = STATUS_META[doc.status] ?? STATUS_META.missing;
						const busy = busyId === doc.id;
						return (
							<div key={doc.id} className="ledger-item">
								<div className="ledger-item__head">
									<span className="ledger-item__title">{doc.name}</span>
									<span className={`portal-pill ${statusMeta.pill}`}>
										{statusMeta.label}
									</span>
								</div>
								<div className="ledger-item__sub">
									<span className="ledger-item__detail muted">{doc.hint}</span>
								</div>
								{doc.live?.reviewNote ? (
									<p className="muted mt-1" style={{ fontSize: "0.8rem" }}>
										{doc.live.reviewNote}
									</p>
								) : null}
								{doc.fileName ? (
									<div className="row mt-2" style={{ alignItems: "center", gap: "0.75rem" }}>
										<span className="mono" style={{ fontSize: "0.8rem" }}>
											{doc.fileName}
										</span>
										{doc.uploadedAt ? (
											<span className="muted" style={{ fontSize: "0.75rem" }}>
												{new Date(doc.uploadedAt).toLocaleDateString()}
											</span>
										) : null}
										<div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => void handlePreview(doc)}
												disabled={busy}
											>
												Preview
											</button>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => handleUpload(doc.id)}
												disabled={busy}
											>
												{busy ? "Uploading…" : "Replace"}
											</button>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => void handleRemove(doc)}
												disabled={busy}
											>
												Remove
											</button>
										</div>
									</div>
								) : (
									<div className="row mt-2">
										<Button
											type="button"
											variant="secondary"
											onClick={() => handleUpload(doc.id)}
											disabled={busy || loading}
										>
											{busy ? "Uploading…" : "Upload"}
										</Button>
									</div>
								)}
							</div>
						);
					})}
				</div>
			</section>

			{allUploaded ? (
				<div className="card card--pad mt-5 next-action">
					<p className="eyebrow">All documents uploaded</p>
					<p className="muted mt-1">
						Your consultant will review and verify each document. Check back for status updates.
					</p>
				</div>
			) : null}

			{verifiedCount === rows.length && allUploaded ? (
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