import { useEffect, useRef, useState } from "react";

import { documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { StatusPill, type Tone } from "century-nit-core/ui";

const STATUS_TONE: Record<string, Tone> = {
	UPLOADED: "current",
	VERIFIED: "done",
	REJECTED: "blocked",
	PENDING_UPLOAD: "neutral",
};
const STATUS_LABEL: Record<string, string> = {
	UPLOADED: "Uploaded",
	VERIFIED: "Verified",
	REJECTED: "Rejected",
	PENDING_UPLOAD: "Pending upload",
};

const ARTIFACT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.doc,.docx";

/**
 * One official agency artifact on the client's record — a visa application
 * receipt or a flight booking. Staff upload these on the client's behalf;
 * everything else in the vault belongs to the client. The file lands in the
 * applicant's own document list, so the portal shows it to them under the
 * OFFICIAL category without a second delivery path.
 */
export function ArtifactCard({
	ownerUserId,
	documentType,
	title,
	hint,
	canUpload,
}: {
	/** Portal user the artifact belongs to; null until the applicant has an account. */
	ownerUserId: string | null | undefined;
	documentType: "visa_receipt" | "flight_receipt";
	title: string;
	hint?: string;
	/** Holds the documents module — the same gate the server applies. */
	canUpload: boolean;
}) {
	const [docsFor, setDocsFor] = useState<{ owner: string; docs: ApplicantDocument[] } | null>(null);
	const [denied, setDenied] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!ownerUserId) return;
		let alive = true;
		documentsApi
			.list({ ownerUserId })
			.then((res) => {
				if (alive) setDocsFor({ owner: ownerUserId, docs: res.documents });
			})
			.catch(() => {
				if (alive) setDenied(true);
			});
		return () => {
			alive = false;
		};
	}, [ownerUserId]);

	const doc =
		ownerUserId && docsFor?.owner === ownerUserId
			? docsFor.docs
					.filter((d) => d.documentType === documentType && d.status !== "REJECTED")
					.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
			: null;

	async function refresh() {
		if (!ownerUserId) return;
		try {
			const res = await documentsApi.list({ ownerUserId });
			setDocsFor({ owner: ownerUserId, docs: res.documents });
		} catch {
			/* list stays as-is */
		}
	}

	async function onFile(file: File | undefined) {
		if (!file || !ownerUserId) return;
		setBusy(true);
		setError(null);
		try {
			const created = await documentsApi.upload(file, documentType, { ownerUserId });
			// A pre-artifact API silently drops `ownerUserId` and files the upload
			// on the staff member's own record — catch that rather than pretend.
			if (created.ownerUserId !== ownerUserId) {
				setError("The server doesn't support agency artifacts yet — the file landed on your own record; remove it from your documents.");
				return;
			}
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not upload the file");
		} finally {
			setBusy(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	async function onDownload() {
		if (!doc) return;
		try {
			const ticket = await documentsApi.downloadUrl(doc.id);
			window.open(ticket.url, "_blank", "noopener");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not open the file");
		}
	}

	return (
		<div className="card">
			<div className="cn-docs__head">
				<p className="eyebrow">{title}</p>
				{doc && <StatusPill tone={STATUS_TONE[doc.status] ?? "neutral"}>{STATUS_LABEL[doc.status] ?? doc.status}</StatusPill>}
			</div>
			{hint && <p className="muted cn-docs__meta">{hint}</p>}
			{!ownerUserId ? (
				<p className="muted cn-docs__meta">The applicant does not have a portal account yet.</p>
			) : denied ? (
				<p className="muted cn-docs__meta">Your role cannot see this client's documents.</p>
			) : doc ? (
				<div className="cn-docs__row" style={{ paddingLeft: 0, paddingRight: 0 }}>
					<button type="button" className="cn-docs__file" onClick={() => void onDownload()}>
						<span className="cn-docs__name">{doc.fileName}</span>
						<span className="cn-docs__meta">
							{doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(0)} KB` : ""}
							{doc.uploadedAt ? ` · ${new Date(doc.uploadedAt).toLocaleDateString()}` : ""} · Open →
						</span>
					</button>
					{canUpload && (
						<div className="cn-docs__actions">
							<button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
								Replace
							</button>
						</div>
					)}
				</div>
			) : (
				<p className="muted cn-docs__meta">Not on file yet.</p>
			)}
			{error && <p className="cn-assign__error">{error}</p>}
			{ownerUserId && canUpload && !doc && (
				<div className="mt-2">
					<button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => fileRef.current?.click()}>
						{busy ? "Uploading…" : `Upload ${title.toLowerCase()}`}
					</button>
				</div>
			)}
			<input
				ref={fileRef}
				type="file"
				accept={ARTIFACT_ACCEPT}
				style={{ display: "none" }}
				onChange={(e) => void onFile(e.target.files?.[0])}
			/>
		</div>
	);
}
