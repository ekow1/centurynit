import { useEffect, useState } from "react";
import { formatBytes, getFile, isPreviewable } from "century-nit-core";
import { documentsApi } from "century-nit-core/api";

/**
 * Renders the document itself.
 *
 * Two sources, in order of preference:
 *  1. A real file the applicant uploaded this session - embedded as a PDF or
 *     an image, with zoom, rotate, download and open-in-new-tab.
 *  2. Otherwise a facsimile: an actual document-looking page built from the
 *     record's metadata. Seeded records never had file content, and after a
 *     reload the object URLs are gone, so this is the honest fallback.
 *
 * What it replaced was neither - a file icon and a paragraph about compliance,
 * which told a reviewer nothing about what they were being asked to verify.
 */

type Props = {
	name: string;
	category?: string;
	applicantName?: string;
	reference?: string;
	status?: string;
	/** Real document UUID. When provided and no session file is found, a
	 *  signed download URL is fetched from the server so the actual uploaded
	 *  file is rendered instead of the metadata facsimile. */
	documentId?: string;
};

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

export function DocumentViewer({ name, category, applicantName, reference, status, documentId }: Props) {
	const [zoomIdx, setZoomIdx] = useState(1);
	const [rotation, setRotation] = useState(0);
	const [signedUrl, setSignedUrl] = useState<string | null>(null);
	const [signedType, setSignedType] = useState<string | null>(null);
	const [fetchError, setFetchError] = useState<string | null>(null);

	const file = getFile(name);
	const kind = file ? isPreviewable(file.type) : null;
	const zoom = ZOOMS[zoomIdx];

	// When the applicant uploaded the file in a previous session (the normal
	// case for ops review), getFile() returns nothing. Fetch a signed URL from
	// the server so the actual document is rendered instead of the facsimile.
	useEffect(() => {
		if (file || !documentId) return;
		let cancelled = false;
		setSignedUrl(null);
		setSignedType(null);
		setFetchError(null);
		(async () => {
			try {
				const ticket = await documentsApi.downloadUrl(documentId, { inline: true });
				if (cancelled) return;
				setSignedUrl(ticket.url);
				// Infer the content type from the file extension — the signed URL
				// ticket doesn't carry it, and the browser needs a hint to render
				// PDFs in an iframe vs. images in an <img>.
				const ext = name.split(".").pop()?.toLowerCase() ?? "";
				if (ext === "pdf") setSignedType("application/pdf");
				else if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext))
					setSignedType(`image/${ext === "jpg" ? "jpeg" : ext}`);
				else setSignedType("application/octet-stream");
			} catch (err) {
				if (cancelled) return;
				setFetchError(err instanceof Error ? err.message : "Could not load the document.");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [file, documentId, name]);

	const remoteKind = signedUrl && signedType ? isPreviewable(signedType) : null;
	const displayUrl = file?.url ?? signedUrl;
	const displayKind = file ? kind : remoteKind;

	return (
		<div className="docview">
			<div className="docview__bar">
				<span className="docview__source mono">
					{file
						? `${file.name} · ${formatBytes(file.size)}`
						: signedUrl
							? `${name} · signed preview`
							: fetchError
								? "Could not load the document"
								: "Loading document…"}
				</span>

				<div className="docview__tools">
					<button
						type="button"
						className="docview__tool"
						onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
						disabled={zoomIdx === 0}
						aria-label="Zoom out"
					>
						−
					</button>
					<span className="docview__zoom mono">{Math.round(zoom * 100)}%</span>
					<button
						type="button"
						className="docview__tool"
						onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
						disabled={zoomIdx === ZOOMS.length - 1}
						aria-label="Zoom in"
					>
						+
					</button>
					<button
						type="button"
						className="docview__tool"
						onClick={() => setRotation((r) => (r + 90) % 360)}
						aria-label="Rotate"
					>
						↻
					</button>
					{displayUrl ? (
						<>
							<a
								className="docview__tool docview__tool--wide"
								href={displayUrl}
								target="_blank"
								rel="noreferrer"
							>
								Open
							</a>
							<a className="docview__tool docview__tool--wide" href={displayUrl} download={name}>
								Download
							</a>
						</>
					) : null}
				</div>
			</div>

			<div className="docview__stage">
				<div
					className="docview__canvas"
					style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
				>
					{displayKind === "pdf" && displayUrl ? (
						<iframe className="docview__pdf" src={displayUrl} title={name} />
					) : displayKind === "image" && displayUrl ? (
						<img className="docview__img" src={displayUrl} alt={name} />
					) : fetchError ? (
						<div className="docview__error">
							<p className="mono">{fetchError}</p>
							<p className="muted">
								The signed link may have expired or storage is not configured. Try
								reopening the document.
							</p>
						</div>
					) : !displayUrl && documentId ? (
						<div className="docview__loading">
							<p className="mono">Loading document…</p>
						</div>
					) : (
						<Facsimile
							name={name}
							category={category}
							applicantName={applicantName}
							reference={reference}
							status={status}
							unsupported={Boolean(file && !kind)}
							fileType={file?.type}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

/** A document-shaped page built from what the record actually knows */
function Facsimile({
	name,
	category,
	applicantName,
	reference,
	status,
	unsupported,
	fileType,
}: Props & { unsupported: boolean; fileType?: string }) {
	const issued = new Date();

	return (
		<article className="facsim">
			<header className="facsim__head">
				<div>
					<p className="facsim__org">Century NIT International</p>
					<p className="facsim__office mono">Assessment Office · Document Record</p>
				</div>
				<span className="facsim__seal" aria-hidden>
					CN
				</span>
			</header>

			<h3 className="facsim__title">{category || "Official Document"}</h3>
			<p className="facsim__file mono">{name}</p>

			<dl className="facsim__fields">
				<div>
					<dt>Submitted by</dt>
					<dd>{applicantName || "-"}</dd>
				</div>
				<div>
					<dt>Reference</dt>
					<dd className="mono">{reference || "-"}</dd>
				</div>
				<div>
					<dt>Category</dt>
					<dd>{category || "Uncategorised"}</dd>
				</div>
				<div>
					<dt>On file since</dt>
					<dd>{issued.toLocaleDateString()}</dd>
				</div>
			</dl>

			<div className="facsim__body" aria-hidden>
				{/* Redacted body lines - the page reads as a document without
				    inventing content that isn't in the record */}
				{[96, 88, 92, 70, 84, 90, 62].map((w, i) => (
					<span key={i} className="facsim__line" style={{ width: `${w}%` }} />
				))}
			</div>

			<footer className="facsim__foot">
				<span className={`facsim__stamp facsim__stamp--${(status ?? "pending").toLowerCase().replace(/\s+/g, "-")}`}>
					{status ?? "Pending Review"}
				</span>
				<p className="facsim__note">
					{unsupported
						? `Uploaded as ${fileType ?? "an unsupported format"} - download it to open in a native application.`
						: "Original file is not available in this browser session. Metadata shown from the case record."}
				</p>
			</footer>
		</article>
	);
}
