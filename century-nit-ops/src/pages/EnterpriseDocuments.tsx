import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { DocPreviewInline } from "./DocPreviewInline";

const STATUS_LABEL: Record<string, string> = {
	UPLOADED: "Pending review",
	VERIFIED: "Verified",
	REJECTED: "Rejected",
};

const CATEGORY_ORDER = [
	"IDENTITY",
	"ACADEMIC",
	"LANGUAGE",
	"FINANCIAL",
	"PROFESSIONAL",
	"OTHER",
];

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

function readableError(err: unknown, fallback: string): string {
	if (err instanceof ApiError) {
		if (err.isUnauthenticated) return "Your session has expired. Sign in again.";
		if (err.code === "STORAGE_NOT_CONFIGURED") {
			return "Document storage is not configured yet — add Supabase keys under Settings.";
		}
		return err.message;
	}
	return fallback;
}

interface ApplicantFolder {
	key: string;
	ownerUserId: string;
	applicantName: string;
	ownerEmail: string;
	caseReference: string;
	branch: string;
	assignedStaffName: string;
	documents: ApplicantDocument[];
	pendingCount: number;
	verifiedCount: number;
	rejectedCount: number;
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
			const updated = await documentsApi.review(document.id, {
				status: "REJECTED",
				note: note.trim() || undefined,
			});
			onReviewed(updated);
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
					<label htmlFor="reject-note">Reason (visible to applicant)</label>
					<textarea
						id="reject-note"
						className="input input--full-border"
						rows={3}
						maxLength={1000}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="e.g. The document is blurry — please re-upload a clear scanned copy."
					/>
				</div>

				<div className="cal-actions" style={{ marginTop: "1.25rem" }}>
					<button type="button" className="btn btn--primary" onClick={submit} disabled={busy}>
						{busy ? "Rejecting…" : "Confirm Rejection"}
					</button>
					<button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}

export function EnterpriseDocuments() {
	const { hasPermission, canSeeAllBranches } = useOpsAuth();
	const canReview = hasPermission("documents");

	const [documents, setDocuments] = useState<ApplicantDocument[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"ALL" | "PENDING" | "VERIFIED">("ALL");
	const [selectedBranch, setSelectedBranch] = useState("all");
	const [expandedFolderKeys, setExpandedFolderKeys] = useState<Set<string>>(new Set());
	const [selectedDoc, setSelectedDoc] = useState<ApplicantDocument | null>(null);
	const [rejectingDoc, setRejectingDoc] = useState<ApplicantDocument | null>(null);
	const [busyDocId, setBusyDocId] = useState<string | null>(null);

	const load = useCallback(() => {
		documentsApi
			.list()
			.then((res) => {
				setDocuments(res.documents);
				setError(null);
			})
			.catch((err: unknown) => {
				setDocuments([]);
				setError(readableError(err, "Could not load documents."));
			});
	}, []);

	useEffect(load, [load]);

	// Auto-expand first folder on initial load if none expanded
	useEffect(() => {
		if (documents && documents.length > 0 && expandedFolderKeys.size === 0) {
			const firstKey = documents[0].ownerUserId || documents[0].ownerEmail || "";
			if (firstKey) {
				setExpandedFolderKeys(new Set([firstKey]));
			}
		}
	}, [documents]);

	// Calculate folders and statistics
	const { folders, totalApplicants, totalDocs, pendingDocsCount, verifiedDocsCount } = useMemo(() => {
		if (!documents) {
			return {
				folders: [],
				totalApplicants: 0,
				totalDocs: 0,
				pendingDocsCount: 0,
				verifiedDocsCount: 0,
			};
		}

		// Group documents by applicant user ID or email
		const folderMap = new Map<string, ApplicantFolder>();

		let pendingTotal = 0;
		let verifiedTotal = 0;

		for (const doc of documents) {
			if (doc.status === "UPLOADED") pendingTotal++;
			if (doc.status === "VERIFIED") verifiedTotal++;

			// Branch filter check
			if (selectedBranch !== "all" && doc.branch && doc.branch !== selectedBranch) {
				continue;
			}

			const folderKey = doc.ownerUserId || doc.ownerEmail || "unknown";
			let folder = folderMap.get(folderKey);
			if (!folder) {
				const newFolder: ApplicantFolder = {
					key: folderKey,
					ownerUserId: doc.ownerUserId || "",
					applicantName: doc.ownerName || doc.ownerEmail || "Applicant",
					ownerEmail: doc.ownerEmail || "",
					caseReference: doc.caseReference || "—",
					branch: doc.branch || "Global",
					assignedStaffName: doc.assignedStaffName || "Unassigned",
					documents: [],
					pendingCount: 0,
					verifiedCount: 0,
					rejectedCount: 0,
				};
				folderMap.set(folderKey, newFolder);
				folder = newFolder;
			}

			folder.documents.push(doc);
			if (doc.status === "UPLOADED") folder.pendingCount++;
			if (doc.status === "VERIFIED") folder.verifiedCount++;
			if (doc.status === "REJECTED") folder.rejectedCount++;
		}

		let folderList = Array.from(folderMap.values());

		// Tab filter
		if (activeTab === "PENDING") {
			folderList = folderList.filter((f) => f.pendingCount > 0);
		} else if (activeTab === "VERIFIED") {
			folderList = folderList.filter((f) => f.verifiedCount > 0);
		}

		return {
			folders: folderList,
			totalApplicants: folderList.length,
			totalDocs: folderList.reduce((acc, f) => acc + f.documents.length, 0),
			pendingDocsCount: pendingTotal,
			verifiedDocsCount: verifiedTotal,
		};
	}, [documents, selectedBranch, activeTab]);

	function toggleFolder(key: string) {
		setExpandedFolderKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
				const folder = folders.find((f) => f.key === key);
				if (folder && folder.documents.length > 0 && !selectedDoc) {
					setSelectedDoc(folder.documents[0]);
				}
			}
			return next;
		});
	}

	function updateDocInList(updated: ApplicantDocument) {
		setDocuments((current) => (current ?? []).map((d) => (d.id === updated.id ? updated : d)));
		if (selectedDoc?.id === updated.id) {
			setSelectedDoc(updated);
		}
		setRejectingDoc(null);
		setBusyDocId(null);
	}

	async function handleVerify(doc: ApplicantDocument) {
		setBusyDocId(doc.id);
		setError(null);
		try {
			const updated = await documentsApi.review(doc.id, { status: "VERIFIED" });
			updateDocInList(updated);
		} catch (err) {
			setError(readableError(err, "Could not verify document."));
			setBusyDocId(null);
		}
	}

	if (!canReview) return null;

	return (
		<div className="page-content fade-in">
			{/* Page Header */}
			<div style={{ marginBottom: "1.5rem" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
					<div>
						<h1 className="page-title">Document Vault</h1>
						<p className="lead mt-1">
							Organized by applicant. Review, verify, and reject documents per file.
						</p>
					</div>

					<div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
						{canSeeAllBranches && (
							<BranchScopeFilter value={selectedBranch} onChange={setSelectedBranch} />
						)}
						<button type="button" className="btn btn--ghost btn--sm" onClick={load}>
							Refresh
						</button>
					</div>
				</div>
			</div>

			{/* KPI Stats Strip */}
			<div className="vault-kpi">
				<div className="vault-kpi__card">
					<span className="vault-kpi__label">APPLICANTS</span>
					<span className="vault-kpi__value">{totalApplicants}</span>
					<span className="vault-kpi__sub">Folders in view</span>
				</div>

				<div className="vault-kpi__card">
					<span className="vault-kpi__label">TOTAL DOCUMENTS</span>
					<span className="vault-kpi__value">{totalDocs}</span>
					<span className="vault-kpi__sub">Across folders</span>
				</div>

				<div className="vault-kpi__card">
					<span className="vault-kpi__label">PENDING REVIEW</span>
					<span className="vault-kpi__value">{pendingDocsCount}</span>
					<span className="vault-kpi__sub">Awaiting decision</span>
				</div>

				<div className="vault-kpi__card vault-kpi__card--highlight">
					<span className="vault-kpi__label">VERIFIED</span>
					<span className="vault-kpi__value">{verifiedDocsCount}</span>
					<span className="vault-kpi__sub">Authenticated</span>
				</div>
			</div>

			{/* Filter Tabs */}
			<div className="vault-filter-tabs">
				<button
					type="button"
					className={`vault-tab ${activeTab === "ALL" ? "vault-tab--active" : ""}`}
					onClick={() => setActiveTab("ALL")}
				>
					ALL APPLICANTS
				</button>
				<button
					type="button"
					className={`vault-tab ${activeTab === "PENDING" ? "vault-tab--active" : ""}`}
					onClick={() => setActiveTab("PENDING")}
				>
					PENDING REVIEW
				</button>
				<button
					type="button"
					className={`vault-tab ${activeTab === "VERIFIED" ? "vault-tab--active" : ""}`}
					onClick={() => setActiveTab("VERIFIED")}
				>
					VERIFIED
				</button>
			</div>

			{error && <p className="ops-modal__error" style={{ marginBottom: "1rem" }}>{error}</p>}

			{!documents && <p className="ops-modal__muted">Loading documents…</p>}

			{documents && folders.length === 0 && (
				<div className="ops-panel" style={{ padding: "3rem", textAlign: "center" }}>
					<p className="ops-modal__muted" style={{ margin: 0 }}>
						{documents.length === 0
							? "No documents have been uploaded by active applicants yet."
							: "No applicant folders match the selected filters."}
					</p>
				</div>
			)}

			{/* Two-column layout: Folder list (left) & Sticky Document Preview (right) */}
			{folders.length > 0 && (
				<div className={`vault-layout ${selectedDoc ? "vault-layout--has-preview" : ""}`}>
					{/* Folder List (Left Column) */}
					<div className="vault-folder-list">
						{folders.map((folder) => {
							const isOpen = expandedFolderKeys.has(folder.key);

							// Group folder docs by Category
							const categoriesMap = new Map<string, ApplicantDocument[]>();
							for (const doc of folder.documents) {
								const cat = doc.documentCategory || "OTHER";
								const catList = categoriesMap.get(cat) || [];
								catList.push(doc);
								categoriesMap.set(cat, catList);
							}

							const categoriesPresent = CATEGORY_ORDER.filter((cat) => categoriesMap.has(cat));
							// Catch any uncategorized
							for (const cat of Array.from(categoriesMap.keys())) {
								if (!categoriesPresent.includes(cat)) {
									categoriesPresent.push(cat);
								}
							}

							return (
								<div
									key={folder.key}
									className={`vault-folder-card ${isOpen ? "vault-folder-card--open" : ""}`}
								>
									{/* Folder Accordion Header */}
									<div
										className="vault-folder-header"
										onClick={() => toggleFolder(folder.key)}
									>
										<div className="vault-folder-header-top">
											<div className="vault-folder-title-wrap">
												<div className="vault-folder-icon">📁</div>
												<div className="vault-folder-applicant-name">
													{folder.applicantName}
													{folder.caseReference !== "—" && (
														<span className="vault-folder-case-ref">{folder.caseReference}</span>
													)}
												</div>
											</div>

											<div className="vault-folder-counts">
												<span className="vault-folder-badge">
													{folder.documents.length} doc{folder.documents.length === 1 ? "" : "s"}
												</span>
												{folder.pendingCount > 0 && (
													<span className="vault-folder-badge vault-folder-badge--pending">
														{folder.pendingCount} pending
													</span>
												)}
												<span style={{ fontSize: "0.85rem", opacity: 0.5, marginLeft: "0.4rem" }}>
													{isOpen ? "▲" : "▼"}
												</span>
											</div>
										</div>

										<div className="vault-folder-meta">
											<span>{folder.ownerEmail}</span>
											<span>·</span>
											<span>{folder.branch}</span>
											<span>·</span>
											<span>Staff: {folder.assignedStaffName}</span>
										</div>
									</div>

									{/* Folder Body (Expanded Content) */}
									{isOpen && (
										<div className="vault-folder-body">
											{categoriesPresent.map((category) => {
												const catDocs = categoriesMap.get(category) || [];
												return (
													<div key={category} className="vault-category-group">
														<div className="vault-category-title">{category}</div>

														{catDocs.map((doc) => {
															const isSelected = selectedDoc?.id === doc.id;
															const isBusy = busyDocId === doc.id;
															const isSettled = doc.status === "VERIFIED" || doc.status === "REJECTED";

															return (
																<div
																	key={doc.id}
																	className={`vault-doc-item ${isSelected ? "vault-doc-item--selected" : ""}`}
																	onClick={() => setSelectedDoc(doc)}
																>
																	<div className="vault-doc-item-main">
																		<div className="vault-doc-item-left">
																			<div className="vault-doc-file-icon">DOC</div>
																			<div className="vault-doc-info">
																				<span className="vault-doc-name">
																					{doc.fileName}
																				</span>
																			</div>
																		</div>

																		<div className="vault-doc-actions">
																			<span
																				className={`vault-doc-status vault-doc-status--${doc.status.toLowerCase()}`}
																			>
																				{STATUS_LABEL[doc.status] ?? doc.status}
																			</span>

																			<button
																				type="button"
																				className="btn btn--ghost btn--sm"
																				onClick={(e) => {
																					e.stopPropagation();
																					setSelectedDoc(doc);
																				}}
																			>
																				Preview
																			</button>

																			{!isSettled && (
																				<>
																					<button
																						type="button"
																						className="btn btn--primary btn--sm"
																						onClick={(e) => {
																							e.stopPropagation();
																							handleVerify(doc);
																						}}
																						disabled={isBusy}
																					>
																						{isBusy ? "…" : "Verify"}
																					</button>

																					<button
																						type="button"
																						className="btn btn--ghost btn--sm"
																						onClick={(e) => {
																							e.stopPropagation();
																							setRejectingDoc(doc);
																						}}
																						disabled={isBusy}
																					>
																						Reject
																					</button>
																				</>
																			)}
																		</div>
																	</div>

																	<div className="vault-doc-sub">
																		<span>{doc.documentType}</span>
																		<span>·</span>
																		<span>{formatBytes(doc.sizeBytes)}</span>
																		<span>·</span>
																		<span>{formatWhen(doc.uploadedAt ?? doc.createdAt)}</span>
																	</div>
																</div>
															);
														})}
													</div>
												);
											})}
										</div>
									)}
								</div>
							);
						})}
					</div>

					{/* Inline Right Document Preview Panel */}
					{selectedDoc && (
						<div className="vault-preview-panel">
							<div className="vault-preview-head">
								<div>
									<div className="vault-preview-title">
										{selectedDoc.ownerName || selectedDoc.ownerEmail || "Applicant"}
									</div>
									<div className="vault-preview-sub">
										Ref: {selectedDoc.caseReference || "—"} · {selectedDoc.branch || "Global"}
									</div>
								</div>
								<button
									type="button"
									className="btn btn--ghost btn--sm"
									onClick={() => setSelectedDoc(null)}
								>
									Close
								</button>
							</div>

							<DocPreviewInline
								doc={{
									name: selectedDoc.fileName,
									category: selectedDoc.documentCategory,
									status:
										selectedDoc.status === "UPLOADED"
											? "Pending Review"
											: selectedDoc.status === "VERIFIED"
												? "Verified"
												: "Rejected",
								}}
								documentId={selectedDoc.id}
								applicantName={selectedDoc.ownerName || selectedDoc.ownerEmail}
								reference={selectedDoc.caseReference}
								onVerdict={(status) => {
									const updated = { ...selectedDoc, status };
									updateDocInList(updated);
								}}
							/>
						</div>
					)}
				</div>
			)}

			{/* Reject Dialog Modal */}
			{rejectingDoc && (
				<RejectDialog
					document={rejectingDoc}
					onClose={() => setRejectingDoc(null)}
					onReviewed={updateDocInList}
				/>
			)}
		</div>
	);
}
