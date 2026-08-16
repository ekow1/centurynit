export type UploadStage = "preparing" | "uploading" | "done" | "error";

/**
 * A small modal showing a single file's upload progress.
 *
 * `percent` covers whichever step is active: while `preparing` it reflects
 * client-side compression, otherwise the PUT to storage. The modal stays open
 * on error (with the message and a Close button) so the failure is seen, and
 * closes itself once the caller moves past `done`.
 */
export function UploadProgressModal({
	open,
	fileName,
	stage,
	percent,
	error,
	onClose,
}: {
	open: boolean;
	fileName: string;
	stage: UploadStage;
	percent: number;
	error?: string | null;
	onClose?: () => void;
}) {
	if (!open) return null;

	const label =
		stage === "preparing"
			? percent === 0
				? "Preparing file…"
				: `Compressing image… ${percent}%`
			: stage === "uploading"
				? `Uploading… ${percent}%`
				: stage === "error"
					? "Upload failed"
					: "Upload complete";

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Upload progress"
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
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "1rem",
						marginBottom: "0.75rem",
					}}
				>
					<p className="eyebrow" style={{ margin: 0 }}>
						Upload
					</p>
					{stage === "done" || stage === "error" ? (
						<button type="button" className="btn btn--ghost btn--sm" onClick={onClose} style={{ flexShrink: 0 }}>
							Close
						</button>
					) : null}
				</div>
				<p
					style={{ margin: "0 0 0.15rem", fontWeight: 600, fontSize: "0.95rem", wordBreak: "break-all" }}
				>
					{fileName}
				</p>
				<p className="muted" style={{ margin: "0 0 1rem", fontSize: "0.85rem" }}>
					{label}
				</p>

				{stage === "error" ? (
					<p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#e53935" }}>
						{error ?? "Something went wrong while uploading. Please try again."}
					</p>
				) : (
					<div
						style={{
							height: 8,
							borderRadius: 4,
							background: "var(--border, #e5e5e5)",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								height: "100%",
								width: `${Math.max(2, percent)}%`,
								background: "var(--foreground)",
								transition: "width 0.2s ease",
								borderRadius: 4,
							}}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
