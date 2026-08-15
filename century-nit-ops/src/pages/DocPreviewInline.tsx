import { useOpsState } from "./OpsStateContext";
import { useOpsAuth } from "./OpsAuthContext";
import { DocumentViewer } from "./DocumentViewer";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	Verified: { bg: "var(--foreground)", text: "var(--background)", label: "Verified" },
	"Pending Review": { bg: "var(--muted)", text: "var(--foreground)", label: "Pending Review" },
	Rejected: { bg: "#fee2e2", text: "#991b1b", label: "Rejected" },
};

function CheckIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
			<polyline points="20 6 9 17 4 12" />
		</svg>
	);
}

function XIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

function ClockIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="10" />
			<polyline points="12 6 12 12 16 14" />
		</svg>
	);
}

export type DocPreviewData = {
	name: string;
	category?: string;
	status?: string;
	isLive?: boolean;
	docKey?: string;
};

/**
 * In-pane document preview - renders inside the detail pane's Documents tab.
 * Replaces the old fixed-overlay OpsDocPreviewModal.
 */
export function DocPreviewInline({
	doc,
	isMine = true,
	applicantName,
	reference,
	onBack,
}: {
	doc: DocPreviewData;
	isMine?: boolean;
	/** Shown on the rendered page when the original file isn't in this session */
	applicantName?: string;
	reference?: string;
	onBack: () => void;
}) {
	const { setDocVerdict, seededDocVerdicts } = useOpsState();
	const { opsUser } = useOpsAuth();

	const isLive = Boolean(doc.isLive);
	const docKey = doc.docKey ?? doc.name;
	const liveStatus = isLive ? doc.status : (seededDocVerdicts[docKey] ?? doc.status);
	const status = liveStatus ?? "Pending Review";
	const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES["Pending Review"];
	const settled = status === "Verified" || status === "Rejected";

	function handleVerdict(verdict: "Verified" | "Rejected") {
		setDocVerdict(docKey, isLive, doc.name, verdict, opsUser?.name ?? "Consultant");
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
			{/* Back link */}
			<button
				type="button"
				onClick={onBack}
				style={{
					background: "none",
					border: "none",
					cursor: "pointer",
					color: "var(--muted-foreground)",
					fontSize: "var(--text-xs)",
					fontFamily: "var(--font-mono)",
					textTransform: "uppercase",
					letterSpacing: "0.05em",
					padding: 0,
					textAlign: "left",
					width: "fit-content",
				}}
			>
				← Back to document list
			</button>

			{/* Status + ref bar */}
			<div style={{
				display: "flex",
				alignItems: "center",
				gap: "0.75rem",
				padding: "0.75rem 1rem",
				border: "1px solid var(--border-light)",
				background: "var(--muted)",
			}}>
				<span style={{
					display: "inline-flex",
					alignItems: "center",
					gap: "0.4rem",
					padding: "0.3rem 0.7rem",
					background: statusStyle.bg,
					color: statusStyle.text,
					fontSize: "0.75rem",
					fontWeight: 600,
				}}>
					{status === "Verified" && <CheckIcon />}
					{status === "Rejected" && <XIcon />}
					{status === "Pending Review" && <ClockIcon />}
					{statusStyle.label}
				</span>
				{isLive && (
					<span className="mono" style={{
						fontSize: "0.6rem",
						background: "var(--foreground)",
						color: "var(--background)",
						padding: "0.15rem 0.45rem",
						letterSpacing: "0.08em",
					}}>
						LIVE
					</span>
				)}
				<span className="muted" style={{ fontSize: "0.7rem", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
					Ref: DOC-{(doc.name.length * 7).toString(16).toUpperCase().slice(0, 4)}-{doc.name.length}
				</span>
			</div>

			{/* The document itself */}
			<DocumentViewer
				name={doc.name}
				category={doc.category}
				applicantName={applicantName}
				reference={reference}
				status={status}
			/>

			{/* Reviewer guidance - kept, but below the document rather than instead of it */}
			<div className="docnote">
				{status === "Verified" ? (
					<>
						<p className="docnote__title">Compliance statement</p>
						<p className="docnote__body">
							Verified against institutional archives and authenticated by the Century NIT
							Assessment Office.
						</p>
					</>
				) : status === "Rejected" ? (
					<>
						<p className="docnote__title docnote__title--bad">Verification rejected</p>
						<p className="docnote__body">
							This document did not pass verification. The applicant may need to resubmit an
							updated copy.
						</p>
					</>
				) : (
					<>
						<p className="docnote__title">Awaiting verification</p>
						<p className="docnote__body">
							{isMine
								? "Check the document above, then verify or reject it below."
								: "Only the assigned consultant can verify this document."}
						</p>
					</>
				)}
			</div>

			{/* Action bar */}
			{!settled && isMine && (
				<div style={{ display: "flex", gap: "0.75rem" }}>
					<button
						onClick={() => handleVerdict("Verified")}
						className="btn btn--sm"
						style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
					>
						<CheckIcon />
						Verify Document
					</button>
					<button
						onClick={() => handleVerdict("Rejected")}
						className="btn btn--ghost btn--sm"
						style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
					>
						<XIcon />
						Reject Document
					</button>
				</div>
			)}

			{!settled && !isMine && (
				<div style={{
					display: "flex",
					alignItems: "center",
					gap: "0.5rem",
					padding: "0.85rem 1rem",
					border: "1px solid var(--border-light)",
					background: "var(--muted)",
				}}>
					<span className="muted" style={{ fontSize: "0.8rem" }}>
						Read-only - only the assigned consultant can verify documents.
					</span>
				</div>
			)}

			{settled && (
				<div style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: "0.5rem",
					padding: "0.85rem 1rem",
					border: `1px solid ${status === "Verified" ? "var(--foreground)" : "#fecaca"}`,
					background: status === "Verified" ? "var(--foreground)" : "#fee2e2",
					color: status === "Verified" ? "var(--background)" : "#991b1b",
				}}>
					<CheckIcon />
					<span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
						Decision recorded - {status}
					</span>
				</div>
			)}
		</div>
	);
}
