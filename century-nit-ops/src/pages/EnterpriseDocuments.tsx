import { useMemo, useState } from "react";
import { useOpsState } from "./OpsStateContext";
import { useOpsAuth } from "./OpsAuthContext";
import { useCasesApi } from "../hooks/useCasesApi";
import { DocPreviewInline, type DocPreviewData } from "./DocPreviewInline";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { DocumentReviewQueue } from "./DocumentReviewQueue";

type DocRow = {
	key: string;
	name: string;
	owner: string;
	ownerRef: string;
	ownerKey: string;
	assignedEmail: string;
	category: string;
	status: string;
	source: "Applicant" | "Consultation";
	isLive: boolean;
};

type ApplicantFolder = {
	key: string;
	name: string;
	ref: string;
	isLive: boolean;
	docs: DocRow[];
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
	Verified: { bg: "var(--foreground)", text: "var(--background)" },
	"Pending Review": { bg: "var(--muted)", text: "var(--foreground)" },
	Rejected: { bg: "#fee2e2", text: "#991b1b" },
};

function ChevronIcon({ open }: { open: boolean }) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{
				transition: "transform 150ms",
				transform: open ? "rotate(90deg)" : "rotate(0deg)",
			}}
		>
			<polyline points="9 18 15 12 9 6" />
		</svg>
	);
}

function FolderGlyph() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
		</svg>
	);
}

function DocIcon() {
	return (
		<svg
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<polyline points="14 2 14 8 20 8" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
			<polyline points="20 6 9 17 4 12" />
		</svg>
	);
}

function XIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

export function EnterpriseDocuments() {
	const { opsUser } = useOpsAuth();
	const { applicants, consultations } = useCasesApi();
	const { setDocVerdict, seededDocVerdicts, logActivity } = useOpsState();
	const [filter, setFilter] = useState<"All" | "Pending Review" | "Verified">("All");
	const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
	const [selectedDoc, setSelectedDoc] = useState<DocRow | null>(null);
	const [selectedFolder, setSelectedFolder] = useState<ApplicantFolder | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");

	const { canSeeAllBranches, scopeRecords } = useOpsAuth();
	const scopedApplicants = scopeRecords(
		applicants,
		(a) => a.assignedOfficerEmail === opsUser?.email || a.assignedOfficer === opsUser?.name,
	);
	const scopedConsultations = scopeRecords(
		consultations,
		(c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
	);

	const folders = useMemo<ApplicantFolder[]>(() => {
		const map = new Map<string, ApplicantFolder>();

		for (const a of scopedApplicants) {
			if (branchFilter !== "all" && a.branch !== branchFilter) continue;
			const key = `applicant:${a.id}`;
			const docs: DocRow[] = a.documents.map((d) => ({
				key: `applicant:${a.id}:${d.name}`,
				name: d.name,
				owner: a.name,
				ownerRef: a.applicantId,
				ownerKey: key,
				assignedEmail: a.assignedOfficerEmail,
				category: d.category,
				status: d.status,
				source: "Applicant" as const,
				isLive: Boolean(a.isLive),
			}));
			if (docs.length > 0) {
				map.set(key, { key, name: a.name, ref: a.applicantId, isLive: Boolean(a.isLive), docs });
			}
		}

		for (const c of scopedConsultations) {
			if (branchFilter !== "all" && c.branch !== branchFilter) continue;
			const key = `consultation:${c.id}`;
			const docs: DocRow[] = c.documents.map((d) => ({
				key: `consultation:${c.id}:${d.name}`,
				name: d.name,
				owner: c.applicantName,
				ownerRef: c.ref,
				ownerKey: key,
				assignedEmail: c.assignedOfficerEmail,
				category: "Consultation",
				status: d.status,
				source: "Consultation" as const,
				isLive: Boolean(c.isLive),
			}));
			if (docs.length > 0) {
				map.set(key, { key, name: c.applicantName, ref: c.ref, isLive: Boolean(c.isLive), docs });
			}
		}

		return Array.from(map.values());
	}, [scopedApplicants, scopedConsultations, branchFilter]);

	const visibleFolders = folders
		.map((folder) => ({
			...folder,
			docs: folder.docs.filter((d) => {
				const status = d.isLive ? d.status : (seededDocVerdicts[d.key] ?? d.status);
				if (filter === "All") return true;
				return status === filter;
			}),
		}))
		.filter((f) => f.docs.length > 0);

	const totalDocs = folders.reduce((sum, f) => sum + f.docs.length, 0);
	const pendingCount = folders.reduce(
		(sum, f) =>
			sum +
			f.docs.filter((d) => {
				const status = d.isLive ? d.status : (seededDocVerdicts[d.key] ?? d.status);
				return status === "Pending Review";
			}).length,
		0,
	);
	const verifiedCount = folders.reduce(
		(sum, f) =>
			sum +
			f.docs.filter((d) => {
				const status = d.isLive ? d.status : (seededDocVerdicts[d.key] ?? d.status);
				return status === "Verified";
			}).length,
		0,
	);

	function toggleFolder(key: string) {
		setOpenFolders((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	function selectDoc(row: DocRow, folder: ApplicantFolder) {
		setSelectedDoc(row);
		setSelectedFolder(folder);
	}

	function decide(row: DocRow, verdict: "Verified" | "Rejected") {
		setDocVerdict(row.key, row.isLive, row.name, verdict, opsUser?.name ?? "Consultant");
		logActivity(
			opsUser?.name ?? "Assessment",
			verdict === "Verified" ? "Document approved" : "Document rejected",
			`${row.name} - ${row.owner} (${row.ownerRef})`,
		);
	}

	function docStatus(row: DocRow) {
		return row.isLive ? row.status : (seededDocVerdicts[row.key] ?? row.status);
	}

	const selectedPreviewData: DocPreviewData | null = selectedDoc
		? {
				name: selectedDoc.name,
				category: selectedDoc.category,
				status: docStatus(selectedDoc),
				isLive: selectedDoc.isLive,
				docKey: selectedDoc.key,
			}
		: null;

	const selectedIsMine = selectedDoc?.assignedEmail === opsUser?.email;

	return (
		<div className="page-content fade-in">
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-end",
					marginBottom: "1.5rem",
					gap: "1rem",
					flexWrap: "wrap",
				}}
			>
				<div>
					<h1 className="page-title">Document Vault</h1>
					<p className="lead mt-2">
						Organized by applicant. Review, verify, and reject documents per file.
						{pendingCount > 0 ? ` ${pendingCount} awaiting review.` : " All caught up."}
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{(["All", "Pending Review", "Verified"] as const).map((f) => (
						<button
							key={f}
							onClick={() => setFilter(f)}
							className={`btn btn--sm ${filter === f ? "btn--primary" : "btn--ghost"}`}
						>
							{f}
						</button>
					))}
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			<div className="stat-band" style={{ marginBottom: "1.5rem" }}>
				<div className="stat-cell">
					<p className="stat-cell__label">Applicants</p>
					<p className="stat-cell__value">{folders.length}</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Total documents</p>
					<p className="stat-cell__value">{totalDocs}</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Pending</p>
					<p className="stat-cell__value">{pendingCount}</p>
				</div>
				<div className="stat-cell stat-cell--accent">
					<p className="stat-cell__label">Verified</p>
					<p className="stat-cell__value">{verifiedCount}</p>
				</div>
			</div>

			{/*
			 * Real uploads first, demo folders below.
			 *
			 * The counters above and the folders below are the localStorage demo
			 * dataset. This is the live queue — files applicants actually sent, which
			 * are the ones a reviewer is accountable for.
			 */}
			<div style={{ marginBottom: "1.5rem" }}>
				<DocumentReviewQueue />
			</div>

			{visibleFolders.length === 0 ? (
				<div className="card" style={{ padding: "3rem", textAlign: "center" }}>
					<p className="muted">No documents match this filter.</p>
				</div>
			) : (
				<div className="doc-split doc-split--open">
					{/* Left panel: folder & document list */}
					<div className="doc-split__list">
						{visibleFolders.map((folder) => {
							const isOpen = openFolders.has(folder.key);
							const folderPending = folder.docs.filter((d) => docStatus(d) === "Pending Review").length;
							const folderVerified = folder.docs.filter((d) => docStatus(d) === "Verified").length;

							return (
								<div key={folder.key} className="doc-folder">
									<button
										type="button"
										onClick={() => toggleFolder(folder.key)}
										className="doc-folder__header"
									>
										<span className="doc-folder__chevron">
											<ChevronIcon open={isOpen} />
										</span>
										<span className="doc-folder__glyph">
											<FolderGlyph />
										</span>
										<div className="doc-folder__meta">
											<div className="doc-folder__title-row">
												<span className="doc-folder__name">{folder.name}</span>
												{folder.isLive && <span className="doc-folder__live">LIVE</span>}
												<span className="doc-folder__ref mono">{folder.ref}</span>
											</div>
											<p className="doc-folder__sub muted">
												{folder.docs.length} doc{folder.docs.length !== 1 ? "s" : ""} · {folderVerified} verified
												{folderPending > 0 ? ` · ${folderPending} pending` : ""}
											</p>
										</div>
									</button>

									{isOpen && (
										<div className="doc-folder__items">
											{folder.docs.map((row, idx) => {
												const status = docStatus(row);
												const settled = status === "Verified" || status === "Rejected";
												const colors = STATUS_COLORS[status] ?? STATUS_COLORS["Pending Review"];
												const isActive = selectedDoc?.key === row.key;
												return (
													<div
														key={row.key}
														className={`doc-item ${isActive ? "doc-item--active" : ""}`}
														style={{ borderBottom: idx < folder.docs.length - 1 ? "1px solid var(--border-light)" : "none" }}
													>
														<div className="doc-item__row">
															<span className="doc-item__icon">
																<DocIcon />
															</span>
															<button
																type="button"
																onClick={() => selectDoc(row, folder)}
																className="doc-item__name"
															>
																{row.name}
															</button>
															<span
																className="portal-pill doc-item__status"
																style={{ background: colors.bg, color: colors.text }}
															>
																{status}
															</span>
														</div>
														<div className="doc-item__actions">
															<span className="mono muted doc-item__category">{row.category}</span>
															{!settled && row.assignedEmail === opsUser?.email && (
																<div className="doc-item__btns">
																	<button
																		onClick={() => decide(row, "Verified")}
																		className="btn btn--sm doc-item__btn doc-item__btn--verify"
																	>
																		<CheckIcon /> Verify
																	</button>
																	<button
																		onClick={() => decide(row, "Rejected")}
																		className="btn btn--ghost btn--sm doc-item__btn doc-item__btn--reject"
																	>
																		<XIcon /> Reject
																	</button>
																</div>
															)}
															{!settled && row.assignedEmail !== opsUser?.email && (
																<span className="mono muted doc-item__assigned">
																	Assigned to {row.assignedEmail || "-"}
																</span>
															)}
															{settled && (
																<span className="muted doc-item__settled">
																	{row.isLive ? "Persisted" : seededDocVerdicts[row.key] ? "Updated" : "-"}
																</span>
															)}
														</div>
													</div>
												);
											})}
										</div>
									)}
								</div>
							);
						})}
					</div>

					{/* Right panel: document viewer */}
					{selectedDoc && selectedPreviewData && selectedFolder && (
						<div className="doc-split__viewer">
							<div className="doc-split__viewer-header">
								<div className="doc-split__viewer-meta">
									<p className="eyebrow doc-split__viewer-owner">
										{selectedFolder.name} · {selectedFolder.ref}
									</p>
									<h3 className="doc-split__viewer-title">{selectedDoc.name}</h3>
								</div>
								<button
									type="button"
									onClick={() => { setSelectedDoc(null); setSelectedFolder(null); }}
									className="doc-split__close"
									aria-label="Close viewer"
								>
									<CloseIcon />
								</button>
							</div>
							<div className="doc-split__viewer-body">
								<DocPreviewInline
									doc={selectedPreviewData}
									isMine={Boolean(selectedIsMine)}
									applicantName={selectedFolder.name}
									reference={selectedFolder.ref}
									onBack={() => { setSelectedDoc(null); setSelectedFolder(null); }}
								/>
							</div>
						</div>
					)}

					{/* Empty state when no doc selected */}
					{!selectedDoc && (
						<div className="doc-split__empty">
							<div className="doc-split__empty-icon">
								<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
									<polyline points="14 2 14 8 20 8" />
								</svg>
							</div>
							<p className="doc-split__empty-title">Select a document to review</p>
							<p className="muted doc-split__empty-sub">
								Click any document name on the left to preview it here. You can verify or reject without losing your place in the queue.
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
