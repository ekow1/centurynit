import { useState } from "react";
import { useOpsState } from "./OpsStateContext";
import { useOpsAuth } from "./OpsAuthContext";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	Verified: { bg: "var(--foreground)", text: "var(--background)", label: "Verified" },
	"Pending Review": { bg: "var(--muted)", text: "var(--foreground)", label: "Pending Review" },
	Rejected: { bg: "#fee2e2", text: "#991b1b", label: "Rejected" },
};

function CloseIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

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

function FileIcon() {
	return (
		<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<polyline points="14 2 14 8 20 8" />
			<line x1="9" y1="13" x2="15" y2="13" />
			<line x1="9" y1="17" x2="13" y2="17" />
		</svg>
	);
}

export function OpsDocPreviewModal() {
	const { previewDoc, closeDocPreview, verifyDocument, logActivity } = useOpsState();
	const { opsUser } = useOpsAuth();
	const [localVerdict, setLocalVerdict] = useState<"Verified" | "Rejected" | undefined>(undefined);

	if (!previewDoc) return null;

	const status = localVerdict ?? previewDoc.status ?? "Pending Review";
	const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES["Pending Review"];
	const settled = status === "Verified" || status === "Rejected";

	function handleVerdict(verdict: "Verified" | "Rejected") {
		if (previewDoc?.isLive) {
			verifyDocument(previewDoc.name, verdict, opsUser?.name ?? "Consultant");
		} else {
			setLocalVerdict(verdict);
		}
		logActivity(
			opsUser?.name ?? "Assessment",
			verdict === "Verified" ? "Document approved" : "Document rejected",
			previewDoc?.name ?? "",
		);
	}

	return (
		<>
			{/* Scrim */}
			<div
				onClick={closeDocPreview}
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 2400,
					background: "rgba(0, 0, 0, 0.5)",
					backdropFilter: "blur(2px)",
					animation: "ops-fade-in 0.15s ease-out",
				}}
			/>

			{/* Drawer */}
			<aside
				onClick={(e) => e.stopPropagation()}
				style={{
					position: "fixed",
					top: 0,
					right: 0,
					bottom: 0,
					width: "480px",
					maxWidth: "100vw",
					zIndex: 2500,
					background: "var(--background)",
					borderLeft: "1px solid var(--border)",
					boxShadow: "-16px 0 48px rgba(0,0,0,0.12)",
					display: "flex",
					flexDirection: "column",
					animation: "ops-slide-in 0.2s ease-out",
				}}
			>
				{/* Header */}
				<div
					style={{
						padding: "1.25rem 1.5rem",
						borderBottom: "1px solid var(--border-light)",
						display: "flex",
						alignItems: "flex-start",
						justifyContent: "space-between",
						gap: "1rem",
						flexShrink: 0,
					}}
				>
					<div style={{ minWidth: 0, flex: 1 }}>
						<p
							className="mono muted"
							style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}
						>
							{previewDoc.category || "Document"} · PDF
						</p>
						<h3
							style={{
								fontFamily: "var(--font-display)",
								fontSize: "1.15rem",
								margin: "0.35rem 0 0",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{previewDoc.name}
						</h3>
					</div>
					<button
						type="button"
						onClick={closeDocPreview}
						aria-label="Close"
						style={{
							flexShrink: 0,
							width: "34px",
							height: "34px",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							border: "1px solid var(--border-light)",
							background: "var(--card)",
							color: "var(--muted-foreground)",
							cursor: "pointer",
							transition: "all 150ms",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = "var(--muted)";
							e.currentTarget.style.color = "var(--foreground)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "var(--card)";
							e.currentTarget.style.color = "var(--muted-foreground)";
						}}
					>
						<CloseIcon />
					</button>
				</div>

				{/* Status badge */}
				<div
					style={{
						padding: "0.75rem 1.5rem",
						display: "flex",
						alignItems: "center",
						gap: "0.75rem",
						borderBottom: "1px solid var(--border-light)",
						flexShrink: 0,
					}}
				>
					<span
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: "0.4rem",
							padding: "0.3rem 0.7rem",
							background: statusStyle.bg,
							color: statusStyle.text,
							fontSize: "0.75rem",
							fontWeight: 600,
							letterSpacing: "0.02em",
						}}
					>
						{status === "Verified" && <CheckIcon />}
						{status === "Rejected" && <XIcon />}
						{statusStyle.label}
					</span>
					{previewDoc.isLive && (
						<span
							className="mono"
							style={{
								fontSize: "0.6rem",
								background: "var(--foreground)",
								color: "var(--background)",
								padding: "0.15rem 0.45rem",
								letterSpacing: "0.08em",
							}}
						>
							LIVE
						</span>
					)}
					<span
						className="muted"
						style={{ fontSize: "0.7rem", marginLeft: "auto", fontFamily: "var(--font-mono)" }}
					>
						Ref: DOC-{(previewDoc.name.length * 7).toString(16).toUpperCase().slice(0, 4)}-{previewDoc.name.length}
					</span>
				</div>

				{/* Document preview area */}
				<div
					style={{
						flex: 1,
						overflowY: "auto",
						padding: "1.5rem",
						background: "var(--muted)",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: "1rem",
					}}
				>
					<div
						style={{
							width: "100%",
							maxWidth: "320px",
							background: "var(--background)",
							border: "1px solid var(--border)",
							padding: "2rem 1.5rem",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: "1rem",
							textAlign: "center",
						}}
					>
						<span style={{ color: "var(--muted-foreground)" }}>
							<FileIcon />
						</span>
						<div>
							<p style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
								{previewDoc.name}
							</p>
							<p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
								{previewDoc.category || "Official Document"}
							</p>
						</div>
						<div
							style={{
								width: "100%",
								padding: "0.75rem",
								background: "var(--muted)",
								fontSize: "0.7rem",
								lineHeight: 1.5,
								color: "var(--muted-foreground)",
								textAlign: "left",
							}}
						>
							<p style={{ fontWeight: 600, marginBottom: "0.3rem", color: "var(--foreground)" }}>
								Compliance Statement
							</p>
							This document has been verified against institutional archives and authenticated
							by the Century NIT Assessment Office.
						</div>
					</div>

					<button
						className="btn btn--ghost btn--sm"
						style={{ fontSize: "0.75rem" }}
					>
						Download Original PDF
					</button>
				</div>

				{/* Action bar - verify/reject */}
				{!settled && (
					<div
						style={{
							padding: "1rem 1.5rem",
							borderTop: "1px solid var(--border-light)",
							display: "flex",
							gap: "0.75rem",
							flexShrink: 0,
						}}
					>
						<button
							onClick={() => handleVerdict("Verified")}
							className="btn btn--sm"
							style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
						>
							<CheckIcon />
							Verify
						</button>
						<button
							onClick={() => handleVerdict("Rejected")}
							className="btn btn--ghost btn--sm"
							style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
						>
							<XIcon />
							Reject
						</button>
					</div>
				)}

				{/* Settled state */}
				{settled && (
					<div
						style={{
							padding: "1rem 1.5rem",
							borderTop: "1px solid var(--border-light)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: "0.5rem",
							flexShrink: 0,
						}}
					>
						<span
							className="muted"
							style={{ fontSize: "0.8rem" }}
						>
							{previewDoc.isLive || localVerdict ? "Decision recorded" : "Reviewed"}
						</span>
					</div>
				)}
			</aside>
		</>
	);
}
