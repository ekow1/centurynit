import { useState } from "react";
import { formatBytes, getFile, isPreviewable } from "century-nit-core";

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
};

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

export function DocumentViewer({ name, category, applicantName, reference, status }: Props) {
	const [zoomIdx, setZoomIdx] = useState(1);
	const [rotation, setRotation] = useState(0);

	const file = getFile(name);
	const kind = file ? isPreviewable(file.type) : null;
	const zoom = ZOOMS[zoomIdx];

	return (
		<div className="docview">
			<div className="docview__bar">
				<span className="docview__source mono">
					{file ? `${file.name} · ${formatBytes(file.size)}` : "Rendered preview · original not in this session"}
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
					{file ? (
						<>
							<a
								className="docview__tool docview__tool--wide"
								href={file.url}
								target="_blank"
								rel="noreferrer"
							>
								Open
							</a>
							<a className="docview__tool docview__tool--wide" href={file.url} download={file.name}>
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
					{file && kind === "pdf" ? (
						<iframe className="docview__pdf" src={file.url} title={name} />
					) : file && kind === "image" ? (
						<img className="docview__img" src={file.url} alt={name} />
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
