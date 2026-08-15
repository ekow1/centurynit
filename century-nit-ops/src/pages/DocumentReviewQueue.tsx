import { useCallback, useEffect, useState } from "react";
import { ApiError, documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";

/**
 * The real document review queue.
 *
 * Everything else on the Documents screen is the demo dataset: folders built
 * from the localStorage applicant records, with files held in an in-memory map
 * that empties on reload. This panel is the other thing entirely — documents
 * applicants actually uploaded, sitting in Supabase Storage, listed from
 * Postgres.
 *
 * Kept as its own component for the same reason `UnassignedBookings` is: the
 * live records and the demo records have different shapes, different lifetimes
 * and different failure modes, and merging them into one list would leave a
 * reviewer unable to tell which was which.
 *
 * Files are never proxied through the API. A download is a signed URL fetched
 * at the moment of the click and then discarded — no lasting link to somebody's
 * passport scan is ever held in the page.
 */

const STATUS_LABEL: Record<string, string> = {
	UPLOADED: "Pending review",
	VERIFIED: "Verified",
	REJECTED: "Rejected",
};

function formatBytes(bytes: number | null): string {
	if (bytes == null) return "—";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string | null): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

/** Turn an API failure into something a reviewer can act on. */
function readableError(err: unknown, fallback: string): string {
	if (err instanceof ApiError) {
		if (err.isUnauthenticated) return "Your session has expired. Sign in again.";
		// The one failure with an obvious next step, and it is an ops action.
		if (err.code === "STORAGE_NOT_CONFIGURED") {
			return "Document storage is not configured yet — add the Supabase keys under Settings.";
		}
		return err.message;
	}
	return fallback;
}

function RejectDialog({
	document,
	onClose,
	onReviewed,
}: {
	document: ApplicantDocument;
	onClose: () => void;
	onReviewed: (updated: ApplicantDocument) => void;
}) {
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit() {
		setBusy(true);
		setError(null);
		try {
			onReviewed(
				await documentsApi.review(document.id, {
					status: "REJECTED",
					note: note.trim() || undefined,
				}),
			);
		} catch (err) {
			setError(readableError(err, "Could not reject this document."));
			setBusy(false);
		}
	}

	return (
		<div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Reject document">
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">Reject document</h2>
						<p className="ops-modal__sub">
							{document.fileName}
							{document.ownerEmail ? ` · ${document.ownerEmail}` : ""}
						</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
						Close
					</button>
				</header>

				{error && <p className="ops-modal__error">{error}</p>}

				<div className="field">
					<label htmlFor="reject-note">Why? The applicant sees this</label>
					<textarea
						id="reject-note"
						className="input input--full-border"
						rows={3}
						maxLength={1000}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="e.g. The photo page is cut off — please re-upload the full page."
					/>
				</div>

				<div className="cal-actions" style={{ marginTop: "1.25rem" }}>
					<button type="button" className="btn btn--primary" onClick={submit} disabled={busy}>
						{busy ? "Rejecting…" : "Reject document"}
					</button>
					<button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
						Cancel
					</button>
				</div>

				<p className="ops-modal__foot">
					The applicant can upload a replacement; rejecting does not delete the file.
				</p>
			</div>
		</div>
	);
}

export function DocumentReviewQueue() {
	const { hasPermission } = useOpsAuth();
	const canReview = hasPermission("documents");

	const [documents, setDocuments] = useState<ApplicantDocument[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [rejecting, setRejecting] = useState<ApplicantDocument | null>(null);
	const [onlyPending, setOnlyPending] = useState(true);

	const load = useCallback(() => {
		documentsApi
			.list()
			.then((res) => {
				setDocuments(res.documents);
				setError(null);
			})
			.catch((err: unknown) => {
				setDocuments([]);
				setError(readableError(err, "Could not load uploaded documents."));
			});
	}, []);

	useEffect(load, [load]);

	function replace(updated: ApplicantDocument) {
		setDocuments((current) => (current ?? []).map((d) => (d.id === updated.id ? updated : d)));
		setRejecting(null);
		setBusyId(null);
	}

	async function verify(document: ApplicantDocument) {
		setBusyId(document.id);
		setError(null);
		try {
			replace(await documentsApi.review(document.id, { status: "VERIFIED" }));
		} catch (err) {
			setError(readableError(err, "Could not verify this document."));
			setBusyId(null);
		}
	}

	/**
	 * Open the file in a new tab.
	 *
	 * The URL is signed and expires, so it is fetched on the click rather than
	 * rendered into an href — an href would go stale in the page, handing the
	 * reviewer a dead link, and would leave a working link to a private document
	 * sitting in the DOM long after they moved on.
	 */
	async function open(document: ApplicantDocument) {
		setBusyId(document.id);
		setError(null);
		try {
			const ticket = await documentsApi.downloadUrl(document.id);
			window.open(ticket.url, "_blank", "noopener,noreferrer");
		} catch (err) {
			setError(readableError(err, "Could not open this document."));
		} finally {
			setBusyId(null);
		}
	}

	// Consultants and coordinators review; finance and marketing never see this.
	if (!canReview) return null;

	const visible = (documents ?? []).filter((d) => !onlyPending || d.status === "UPLOADED");
	const pendingCount = (documents ?? []).filter((d) => d.status === "UPLOADED").length;

	return (
		<section className="ops-panel" aria-labelledby="doc-queue-heading">
			<header className="ops-panel__head">
				<h2 id="doc-queue-heading" className="section-title">
					Uploaded documents
					{pendingCount > 0 && <span className="ops-pill">{pendingCount}</span>}
				</h2>
				<div className="cal-actions">
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						onClick={() => setOnlyPending((v) => !v)}
					>
						{onlyPending ? "Show all" : "Pending only"}
					</button>
					<button type="button" className="btn btn--ghost btn--sm" onClick={load}>
						Refresh
					</button>
				</div>
			</header>

			<p className="ops-panel__muted">
				Files applicants uploaded through the portal. The folders below are demo records.
			</p>

			{error && <p className="ops-modal__error">{error}</p>}

			{!documents && <p className="ops-modal__muted">Loading…</p>}

			{documents && visible.length === 0 && (
				<p className="ops-modal__muted">
					{documents.length === 0
						? "No applicant has uploaded a document yet."
						: "Nothing waiting for review."}
				</p>
			)}

			{visible.length > 0 && (
				<div className="ops-table-wrap">
					<table className="ops-table">
						<thead>
							<tr>
								<th scope="col">Document</th>
								<th scope="col">Applicant</th>
								<th scope="col">Type</th>
								<th scope="col">Size</th>
								<th scope="col">Uploaded</th>
								<th scope="col">Status</th>
								<th scope="col">Review</th>
							</tr>
						</thead>
						<tbody>
							{visible.map((doc) => {
								const busy = busyId === doc.id;
								return (
									<tr key={doc.id}>
										<td>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => open(doc)}
												disabled={busy}
											>
												{doc.fileName}
											</button>
											{doc.reviewNote && (
												<div className="ops-table__sub">{doc.reviewNote}</div>
											)}
										</td>
										<td>{doc.ownerEmail ?? "—"}</td>
										<td>{doc.documentType}</td>
										<td>{formatBytes(doc.sizeBytes)}</td>
										<td>{formatWhen(doc.uploadedAt ?? doc.createdAt)}</td>
										<td>
											<span
												className={`ops-status${doc.status === "UPLOADED" ? " ops-status--unassigned" : ""}`}
											>
												{STATUS_LABEL[doc.status] ?? doc.status}
											</span>
										</td>
										<td>
											<div className="cal-actions">
												{doc.status !== "VERIFIED" && (
													<button
														type="button"
														className="btn btn--primary btn--sm"
														onClick={() => verify(doc)}
														disabled={busy}
													>
														{busy ? "…" : "Verify"}
													</button>
												)}
												{doc.status !== "REJECTED" && (
													<button
														type="button"
														className="btn btn--ghost btn--sm"
														onClick={() => setRejecting(doc)}
														disabled={busy}
													>
														Reject
													</button>
												)}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{rejecting && (
				<RejectDialog
					document={rejecting}
					onClose={() => setRejecting(null)}
					onReviewed={replace}
				/>
			)}
		</section>
	);
}
