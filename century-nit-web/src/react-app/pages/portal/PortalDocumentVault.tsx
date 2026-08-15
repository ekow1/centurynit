import { useRef, useState } from "react";
import { useAppState } from "../../context/AppState";
import { REQUIRED_DOCUMENTS } from "century-nit-core";
import { Button } from "../../components/ui/Button";

const STATUS_META: Record<string, { label: string; pill: string }> = {
	missing: { label: "Not uploaded", pill: "portal-pill--needs_info" },
	uploaded: { label: "Uploaded - pending review", pill: "portal-pill--draft" },
	verified: { label: "Verified", pill: "portal-pill--approved" },
	rejected: { label: "Rejected - resubmit", pill: "portal-pill--needs_info" },
};

export function PortalDocumentVault() {
	const { documents, uploadDocument, removeDocument } = useAppState();
	const [previewDoc, setPreviewDoc] = useState<string | null>(null);
	const uploadCounter = useRef(0);

	const uploadedCount = documents.filter((d) => d.status !== "missing").length;
	const verifiedCount = documents.filter((d) => d.status === "verified").length;
	const allUploaded = uploadedCount === documents.length;

	const previewing = previewDoc
		? documents.find((d) => d.id === previewDoc)
		: null;

	function handleUpload(id: string) {
		uploadCounter.current += 1;
		const fakeName = `${id}_scan_${uploadCounter.current.toString().padStart(4, "0")}.pdf`;
		uploadDocument(id, fakeName);
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
						{uploadedCount}/{documents.length}
					</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Verified</p>
					<p className="stat-cell__value">{verifiedCount}</p>
				</div>
				<div className="stat-cell stat-cell--accent">
					<p className="stat-cell__label">Verification</p>
					<p className="stat-cell__value">
						{verifiedCount === documents.length && allUploaded ? "All verified" : "In review"}
					</p>
				</div>
			</div>

			<section className="mt-6">
				<p className="eyebrow mb-3">Required documents</p>
				<div className="ledger">
					{documents.map((doc) => {
						const meta = REQUIRED_DOCUMENTS.find((r) => r.id === doc.id);
						const statusMeta = STATUS_META[doc.status] ?? STATUS_META.missing;
						return (
							<div key={doc.id} className="ledger-item">
								<div className="ledger-item__head">
									<span className="ledger-item__title">
										{meta?.name ?? doc.id}
									</span>
									<span className={`portal-pill ${statusMeta.pill}`}>
										{statusMeta.label}
									</span>
								</div>
								<div className="ledger-item__sub">
									<span className="ledger-item__detail muted">
										{meta?.hint ?? ""}
									</span>
								</div>
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
												onClick={() => setPreviewDoc(doc.id)}
											>
												Preview
											</button>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => handleUpload(doc.id)}
											>
												Replace
											</button>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => removeDocument(doc.id)}
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
										>
											Upload (simulated)
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

			{verifiedCount === documents.length && allUploaded ? (
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

			{previewing ? (
				<>
					<div
						onClick={() => setPreviewDoc(null)}
						style={{
							position: "fixed",
							inset: 0,
							zIndex: 1000,
							background: "rgba(0, 0, 0, 0.5)",
							backdropFilter: "blur(2px)",
							animation: "ops-fade-in 0.15s ease-out",
						}}
					/>
					<aside
						onClick={(e) => e.stopPropagation()}
						style={{
							position: "fixed",
							top: 0,
							right: 0,
							bottom: 0,
							width: "440px",
							maxWidth: "100vw",
							zIndex: 1001,
							background: "var(--background)",
							borderLeft: "1px solid var(--border)",
							boxShadow: "-16px 0 48px rgba(0,0,0,0.12)",
							display: "flex",
							flexDirection: "column",
							animation: "ops-slide-in 0.2s ease-out",
						}}
					>
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
									style={{
										fontSize: "0.65rem",
										textTransform: "uppercase",
										letterSpacing: "0.1em",
										margin: 0,
									}}
								>
									{previewing.id} · PDF
								</p>
								<h3
									style={{
										fontFamily: "var(--font-display)",
										fontSize: "1.15rem",
										margin: "0.35rem 0 0",
									}}
								>
									{REQUIRED_DOCUMENTS.find((r) => r.id === previewing.id)?.name ??
										previewing.id}
								</h3>
							</div>
							<button
								type="button"
								onClick={() => setPreviewDoc(null)}
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
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
									<line x1="18" y1="6" x2="6" y2="18" />
									<line x1="6" y1="6" x2="18" y2="18" />
								</svg>
							</button>
						</div>

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
								className={`portal-pill ${STATUS_META[previewing.status]?.pill ?? ""}`}
								style={{ fontSize: "0.72rem" }}
							>
								{STATUS_META[previewing.status]?.label ?? "Unknown"}
							</span>
							<span
								className="muted"
								style={{ fontSize: "0.7rem", marginLeft: "auto", fontFamily: "var(--font-mono)" }}
							>
								{previewing.fileName}
							</span>
						</div>

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
									maxWidth: "300px",
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
									<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
										<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
										<polyline points="14 2 14 8 20 8" />
										<line x1="9" y1="13" x2="15" y2="13" />
										<line x1="9" y1="17" x2="13" y2="17" />
									</svg>
								</span>
								<div>
									<p style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
										{REQUIRED_DOCUMENTS.find((r) => r.id === previewing.id)?.name ??
											previewing.id}
									</p>
									<p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
										{REQUIRED_DOCUMENTS.find((r) => r.id === previewing.id)?.hint ?? ""}
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
										Upload Details
									</p>
									<p>File: {previewing.fileName}</p>
									<p>
										Uploaded:{" "}
										{previewing.uploadedAt
											? new Date(previewing.uploadedAt).toLocaleString()
											: "-"}
									</p>
								</div>
							</div>
						</div>

						<div
							style={{
								padding: "1rem 1.5rem",
								borderTop: "1px solid var(--border-light)",
								display: "flex",
								gap: "0.75rem",
								flexShrink: 0,
							}}
						>
							<Button
								type="button"
								variant="ghost"
								onClick={() => setPreviewDoc(null)}
								style={{ flex: 1 }}
							>
								Close
							</Button>
							<Button
								type="button"
								variant="secondary"
								onClick={() => {
									handleUpload(previewing.id);
									setPreviewDoc(null);
								}}
								style={{ flex: 1 }}
							>
								Replace
							</Button>
						</div>
					</aside>
				</>
			) : null}
		</div>
	);
}
