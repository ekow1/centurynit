import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { DocPreviewInline } from "./DocPreviewInline";
import { CaseScaffold } from "./case/CaseScaffold";
import { FilterGroup } from "./FilterGroup";
import { useUrlParam } from "../hooks/useUrlParam";
import { Link } from "react-router-dom";

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
const CATEGORY_LABEL: Record<string, string> = { IDENTITY: "Identity", ACADEMIC: "Academic", LANGUAGE: "Language", FINANCIAL: "Financial", PROFESSIONAL: "Professional", OTHER: "Other" };
type Cut = "all" | "pending" | "verified" | "rejected" | "mine" | (typeof CATEGORY_ORDER)[number];
const uploadedAtOf = (d: ApplicantDocument) => d.uploadedAt ?? d.createdAt;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
function agoLabel(iso: string): string {
	const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
	if (mins < 60) return `${Math.max(1, mins)} min`;
	const h = Math.floor(mins / 60);
	if (h < 24) return `${h} h`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d} d`;
	return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const typeLabel = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function formatBytes(bytes: number | null): string {
	if (bytes == null) return "—";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

/** One case's worth of files inside a client directory. Documents with no
 * caseReference land in "General" — never an invented case. */
interface CaseFolder {
	key: string;
	label: string;
	documents: ApplicantDocument[];
	pendingCount: number;
}

interface ApplicantFolder {
	key: string;
	ownerUserId: string;
	applicantName: string;
	ownerEmail: string;
	caseReferences: string[];
	branch: string;
	assignedStaffName: string;
	documents: ApplicantDocument[];
	cases: CaseFolder[];
	pendingCount: number;
	verifiedCount: number;
	rejectedCount: number;
	/** Newest upload in the directory — the sort stamp on the row. */
	lastUploadAt: string | null;
	/** Oldest pending age in days — pending-first ordering. */
	oldestPendingDays: number;
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

/** The triage cuts stay on the row; status + category cuts sit in the drawer. */
const MAIN_CUTS = [
	{ id: "all", label: "All" },
	{ id: "pending", label: "Pending review" },
	{ id: "mine", label: "Mine" },
] as const;
const DRAWER_CUTS = [
	{ id: "verified", label: "Verified" },
	{ id: "rejected", label: "Rejected" },
	...CATEGORY_ORDER.map((c) => ({ id: c, label: CATEGORY_LABEL[c] })),
] as const;
const CUT_IDS = [...MAIN_CUTS, ...DRAWER_CUTS].map((c) => c.id);

/** File-icon stamp from the extension — "PDF", "JPG", "DOC". */
const fileStamp = (d: ApplicantDocument): string => {
	const ext = d.fileName.split(".").pop()?.toUpperCase() ?? "";
	if (ext === "JPEG") return "JPG";
	if (ext === "DOCX") return "DOC";
	return ext.slice(0, 4) || "FILE";
};

export function EnterpriseDocuments() {
	const { hasPermission, canSeeAllBranches } = useOpsAuth();
	const canReview = hasPermission("documents");

	const [documents, setDocuments] = useState<ApplicantDocument[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { opsUser } = useOpsAuth();
	// Everything addressable — a filtered directory or a single file is a
	// link you can paste into a ticket.
	const [cut, setCut] = useUrlParam<Cut>("cut", { allowed: CUT_IDS, fallback: "all" });
	const [search, setSearch] = useUrlParam("q");
	const [selectedBranch, setSelectedBranch] = useUrlParam<string>("branch", { fallback: "all" });
	const [openClient, setOpenClient] = useUrlParam("client");
	const [docId, setDocId] = useUrlParam("doc");
	const [rejectingDoc, setRejectingDoc] = useState<ApplicantDocument | null>(null);
	const [busyDocId, setBusyDocId] = useState<string | null>(null);
	// The drawer auto-opens while one of its cuts is set — a deep link like
	// ?cut=FINANCIAL shows where the cut came from.
	const drawerActive = (DRAWER_CUTS as readonly { id: string }[]).some((c) => c.id === cut);
	const [drawerToggled, setDrawerToggled] = useState<boolean | null>(null);
	const drawerOpen = drawerToggled ?? drawerActive;

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


	// Build the filing cabinet: one directory per client, one folder per
	// case reference inside it, "General" for anything unattached.
	const { folders } = useMemo(() => {
		if (!documents) return { folders: [] as ApplicantFolder[] };

		const folderMap = new Map<string, ApplicantFolder>();
		for (const doc of documents) {
			if (selectedBranch !== "all" && doc.branch && doc.branch !== selectedBranch) continue;

			const folderKey = doc.ownerUserId || doc.ownerEmail || "unknown";
			let folder = folderMap.get(folderKey);
			if (!folder) {
				folder = {
					key: folderKey,
					ownerUserId: doc.ownerUserId || "",
					applicantName: doc.ownerName || doc.ownerEmail || "Applicant",
					ownerEmail: doc.ownerEmail || "",
					caseReferences: [],
					branch: doc.branch || "Global",
					assignedStaffName: doc.assignedStaffName || "Unassigned",
					documents: [],
					cases: [],
					pendingCount: 0,
					verifiedCount: 0,
					rejectedCount: 0,
					lastUploadAt: null,
					oldestPendingDays: 0,
				};
				folderMap.set(folderKey, folder);
			}

			folder.documents.push(doc);
			if (doc.caseReference && !folder.caseReferences.includes(doc.caseReference)) {
				folder.caseReferences.push(doc.caseReference);
			}
			if (doc.status === "UPLOADED") folder.pendingCount++;
			if (doc.status === "VERIFIED") folder.verifiedCount++;
			if (doc.status === "REJECTED") folder.rejectedCount++;
			const up = uploadedAtOf(doc);
			if (!folder.lastUploadAt || up > folder.lastUploadAt) folder.lastUploadAt = up;
			if (doc.status === "UPLOADED") folder.oldestPendingDays = Math.max(folder.oldestPendingDays, daysSince(up));
		}

		// Subfolders: pending cases first, then by reference; General last.
		for (const folder of folderMap.values()) {
			const caseMap = new Map<string, CaseFolder>();
			for (const doc of folder.documents) {
				const ref = doc.caseReference || "";
				let cf = caseMap.get(ref);
				if (!cf) {
					cf = { key: ref || "general", label: ref || "General", documents: [], pendingCount: 0 };
					caseMap.set(ref, cf);
				}
				cf.documents.push(doc);
				if (doc.status === "UPLOADED") cf.pendingCount++;
			}
			folder.cases = Array.from(caseMap.values()).sort((a, b) => {
				if (a.key === "general") return 1;
				if (b.key === "general") return -1;
				if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
				return a.label.localeCompare(b.label);
			});
		}

		// Index order: pending work first (oldest pending first), then
		// anything needing a re-upload, then the clean archive A–Z.
		const folderList = Array.from(folderMap.values()).sort((a, b) => {
			if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
			if (a.pendingCount > 0 && a.oldestPendingDays !== b.oldestPendingDays) return b.oldestPendingDays - a.oldestPendingDays;
			if (a.rejectedCount !== b.rejectedCount) return b.rejectedCount - a.rejectedCount;
			return a.applicantName.localeCompare(b.applicantName);
		});
		return { folders: folderList };
	}, [documents, selectedBranch]);

	/** Does a file belong to the cut being looked at? */
	const inCut = useCallback(
		(d: ApplicantDocument, f: ApplicantFolder): boolean => {
			if (cut === "pending") return d.status === "UPLOADED";
			if (cut === "verified") return d.status === "VERIFIED";
			if (cut === "rejected") return d.status === "REJECTED";
			if (cut === "mine") return Boolean(opsUser) && f.assignedStaffName === opsUser!.name;
			if (cut !== "all") return (d.documentCategory ?? "OTHER").toUpperCase() === cut;
			return true;
		},
		[cut, opsUser],
	);

	const counts = useMemo(() => {
		const all = folders.flatMap((f) => f.documents.map((d) => [d, f] as const));
		const c: Record<string, number> = {
			all: all.length,
			pending: all.filter(([d]) => d.status === "UPLOADED").length,
			verified: all.filter(([d]) => d.status === "VERIFIED").length,
			rejected: all.filter(([d]) => d.status === "REJECTED").length,
			mine: all.filter(([, f]) => Boolean(opsUser) && f.assignedStaffName === opsUser!.name).length,
		};
		for (const cat of CATEGORY_ORDER) c[cat] = all.filter(([d]) => (d.documentCategory ?? "OTHER").toUpperCase() === cat).length;
		return c;
	}, [folders, opsUser]);

	const day = useMemo(() => {
		const pending = folders.flatMap((f) => f.documents.filter((d) => d.status === "UPLOADED"));
		const weekAgo = new Date().getTime() - 7 * 86_400_000;
		return {
			pending: pending.length,
			clients: folders.filter((f) => f.pendingCount > 0).length,
			oldest: pending.reduce((m, d) => Math.max(m, daysSince(uploadedAtOf(d))), 0),
			verifiedThisWeek: folders.flatMap((f) => f.documents).filter((d) => d.status === "VERIFIED" && d.reviewedAt && new Date(d.reviewedAt).getTime() >= weekAgo).length,
		};
	}, [folders]);

	/** The visible directories — the cut and search narrow which folders
	 *  surface; a folder with no matching files doesn't render. */
	const dirs = useMemo(() => {
		const q = search.trim().toLowerCase();
		const matches = (f: ApplicantFolder, d: ApplicantDocument) =>
			!q || `${f.applicantName} ${f.caseReferences.join(" ")} ${f.ownerEmail} ${d.fileName} ${d.documentType}`.toLowerCase().includes(q);
		return folders
			.map((f) => ({ folder: f, lines: f.documents.filter((d) => inCut(d, f) && matches(f, d)) }))
			.filter((c) => c.lines.length > 0);
	}, [folders, search, inCut]);

	const selectedDoc = useMemo(
		() => folders.flatMap((f) => f.documents).find((d) => d.id === docId) ?? null,
		[folders, docId],
	);
	const selectedFolder = selectedDoc ? (folders.find((f) => f.documents.some((d) => d.id === selectedDoc.id)) ?? null) : null;
	const setSelectedDoc = (d: ApplicantDocument | null) => {
		setDocId(d?.id ?? null);
		if (d) {
			const f = folders.find((x) => x.documents.some((dd) => dd.id === d.id));
			if (f) setOpenClient(f.key);
		}
	};

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
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Documents</h1>
					<p className="lead mt-1">What clients have uploaded — the ones waiting on a reviewer first.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					{canSeeAllBranches && <BranchScopeFilter value={selectedBranch} onChange={setSelectedBranch} />}
					<button type="button" className="btn btn--ghost btn--sm" onClick={load}>
						Refresh
					</button>
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{day.pending}</strong> <span className="dash-day__date">pending review</span>
				</span>
				<span>
					<strong>{day.clients}</strong> <span className="dash-day__date">client{day.clients === 1 ? "" : "s"} waiting</span>
				</span>
				<span>
					<strong>{day.oldest > 0 ? `${day.oldest} d` : "—"}</strong> <span className="dash-day__date">oldest</span>
				</span>
				<span>
					<strong>{day.verifiedThisWeek}</strong> <span className="dash-day__date">verified this week</span>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/workspace" className="dash-link">
					Open the Worklist →
				</Link>
			</div>

			{error && (
				<p className="ops-modal__error" role="alert">
					{error}
				</p>
			)}

			<CaseScaffold
				bare
				collapseDetail
				onClose={() => setSelectedDoc(null)}
				bar={
					selectedDoc ? (
						<span className="cn-filter__label">
							{typeLabel(selectedDoc.documentType)} · {selectedDoc.ownerName || selectedDoc.ownerEmail || "Applicant"}
						</span>
					) : null
				}
				list={
					<>
						<div className="cn-scaffold__filters">
							{/* One row: the triage cuts, the drawer toggle, search. */}
							<div className="cn-scaffold__chips">
								<FilterGroup
									label="Documents"
									options={MAIN_CUTS.map((c) => ({
										id: c.id,
										label: c.label,
										count: counts[c.id] ?? 0,
										hot: c.id === "pending" && (counts.pending ?? 0) > 0,
									}))}
									value={cut}
									onChange={setCut}
								/>
								<button
									type="button"
									className={`ops-pill ops-pill--chip${drawerActive ? " ops-pill--hot" : ""}`}
									style={{ borderStyle: "dashed" }}
									aria-expanded={drawerOpen}
									aria-controls="doc-filter-drawer"
									onClick={() => setDrawerToggled(!drawerOpen)}
								>
									Filters {drawerOpen ? "▴" : "▾"}
								</button>
								<input
									type="search"
									className="cn-search"
									placeholder="Search client, file, case…"
									value={search}
									onChange={(e) => setSearch(e.target.value || null)}
									aria-label="Search documents"
									style={{ flex: "1 1 14rem", width: "auto", marginLeft: "auto" }}
								/>
							</div>
							{drawerOpen && (
								<div
									id="doc-filter-drawer"
									className="cn-scaffold__filter-row"
									style={{ flexWrap: "wrap", gap: "0.75rem 1.5rem", background: "var(--muted)" }}
								>
									<span style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
										<span className="cn-filter__label">Status · Category</span>
										<FilterGroup
											label="Status and category"
											options={DRAWER_CUTS.map((c) => ({ id: c.id, label: c.label, count: counts[c.id] ?? 0 }))}
											value={cut}
											onChange={setCut}
										/>
									</span>
								</div>
							)}
						</div>
						<div className="cn-scaffold__rows">
							{documents === null ? (
								<p className="ops-people__empty">Loading documents…</p>
							) : dirs.length === 0 ? (
								<p className="ops-people__empty">{documents.length === 0 ? "No documents uploaded yet." : "Nothing matches."}</p>
							) : (
								<div>
									{dirs.map(({ folder, lines }) => {
										const open = openClient === folder.key;
										return (
											<div key={folder.key}>
												{/* The directory row — caret, folder glyph, identity,
												    state, cases, size, last touch. */}
												<div
													className={`doc-dir${open ? " doc-dir--open" : ""}`}
													role="button"
													tabIndex={0}
													aria-expanded={open}
													onClick={() => setOpenClient(open ? null : folder.key)}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															setOpenClient(open ? null : folder.key);
														}
													}}
												>
													<span className="doc-dir__caret" aria-hidden>{open ? "▾" : "▸"}</span>
													<span className={`ico-folder${open ? " ico-folder--open" : ""}`} aria-hidden />
													<span className="doc-dir__who" title={`${folder.applicantName} · ${folder.ownerEmail}`}>
														<strong>{folder.applicantName}</strong>{" "}
														<span className="sub">
															{folder.ownerEmail} · {folder.branch === "Global" ? "" : `${folder.branch} · `}handler: {folder.assignedStaffName}
														</span>
													</span>
													<span>
														{folder.pendingCount > 0 ? (
															<span className="ops-pill ops-pill--strong">{folder.pendingCount} pending</span>
														) : folder.rejectedCount > 0 ? (
															<span className="ops-pill">{folder.rejectedCount} rejected</span>
														) : (
															<span className="ops-pill" style={{ opacity: 0.55 }}>all verified</span>
														)}
													</span>
													<span className="doc-dir__mn">
														{folder.caseReferences.length > 0
															? folder.caseReferences.length > 1
																? `${folder.caseReferences[0]} +${folder.caseReferences.length - 1}`
																: folder.caseReferences[0]
															: "— no case yet"}
													</span>
													<span className="doc-dir__mn">{folder.documents.length} file{folder.documents.length === 1 ? "" : "s"}</span>
													<span className="doc-dir__mn">{folder.lastUploadAt ? agoLabel(folder.lastUploadAt) : "—"}</span>
												</div>
												{open && (
													<div className="doc-tree">
														{folder.cases.map((cf) => {
															const linesInCase = cf.documents.filter((d) => lines.includes(d));
															if (linesInCase.length === 0) return null;
															return (
																<div key={cf.key}>
																	<div className="doc-subf">
																		<span className="l">
																			<span className="ico-folder ico-folder--sm" aria-hidden />
																			{cf.label}
																		</span>
																		<span className="n">
																			{linesInCase.length} file{linesInCase.length === 1 ? "" : "s"}
																			{cf.pendingCount > 0 ? ` · ${cf.pendingCount} pending` : ""}
																		</span>
																	</div>
																	<div className="doc-tree">
																		{[...linesInCase]
																			.sort(
																				(a, b) =>
																					CATEGORY_ORDER.indexOf((a.documentCategory ?? "OTHER").toUpperCase()) -
																						CATEGORY_ORDER.indexOf((b.documentCategory ?? "OTHER").toUpperCase()) ||
																					uploadedAtOf(b).localeCompare(uploadedAtOf(a)),
																			)
																			.map((d) => {
																				const on = selectedDoc?.id === d.id;
																				const pending = d.status === "UPLOADED";
																				return (
																					<div
																						key={d.id}
																						className={`doc-file${on ? " doc-file--on" : ""}`}
																						role="button"
																						tabIndex={0}
																						aria-pressed={on}
																						onClick={() => setSelectedDoc(on ? null : d)}
																						onKeyDown={(e) => {
																							if (e.key === "Enter" || e.key === " ") {
																								e.preventDefault();
																								setSelectedDoc(on ? null : d);
																							}
																						}}
																					>
																						<span className="ico-file" aria-hidden><i>{fileStamp(d)}</i></span>
																						<span className="doc-file__name" title={d.fileName}>
																							{d.fileName}
																							<div className="doc-file__sub">
																								{typeLabel(d.documentType)} · {CATEGORY_LABEL[(d.documentCategory ?? "OTHER").toUpperCase()] ?? "Other"} ·{" "}
																								{pending
																									? `uploaded ${agoLabel(uploadedAtOf(d))} ago`
																									: `${STATUS_LABEL[d.status]?.toLowerCase()}${d.reviewedAt ? ` ${agoLabel(d.reviewedAt)} ago` : ""}`}
																								{d.status === "REJECTED" && d.reviewNote ? ` — “${d.reviewNote}”` : ""}
																							</div>
																						</span>
																						<span>
																							{pending ? (
																								<span className="ops-pill ops-pill--strong">pending</span>
																							) : (
																								<span className={`ops-pill${d.status === "REJECTED" ? "" : " ops-pill--chip"}`} style={d.status === "REJECTED" ? { opacity: 0.7 } : undefined}>
																									{STATUS_LABEL[d.status]?.toLowerCase()}
																								</span>
																							)}
																						</span>
																						<span className="doc-file__mn">{formatBytes(d.sizeBytes)}</span>
																						<span className="doc-file__mn">{agoLabel(pending ? uploadedAtOf(d) : (d.reviewedAt ?? uploadedAtOf(d)))}</span>
																					</div>
																				);
																			})}
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
							)}
						</div>
					</>
				}
				detail={
					selectedDoc ? (
						<div className="cn-detail">
							<div className="card cn-now" style={{ padding: 0, overflow: "hidden" }}>
								<DocPreviewInline
									doc={{
										name: selectedDoc.fileName,
										category: selectedDoc.documentCategory,
										status: selectedDoc.status === "UPLOADED" ? "Pending Review" : selectedDoc.status === "VERIFIED" ? "Verified" : "Rejected",
									}}
									documentId={selectedDoc.id}
									applicantName={selectedDoc.ownerName || selectedDoc.ownerEmail}
									reference={selectedDoc.caseReference}
									onVerdict={(status) => updateDocInList({ ...selectedDoc, status })}
								/>
							</div>
							<div className="card cn-now">
								<span className="cn-detailhead__kicker">
									{CATEGORY_LABEL[(selectedDoc.documentCategory ?? "OTHER").toUpperCase()] ?? "Document"} · {typeLabel(selectedDoc.documentType)} · {STATUS_LABEL[selectedDoc.status]?.toLowerCase()}
								</span>
								<h3 className="cn-detailhead__title">{selectedDoc.ownerName || selectedDoc.ownerEmail || "Applicant"}</h3>
								<p className="cn-detailhead__sub">
									{selectedDoc.caseReference || "no case reference"}
									{selectedFolder?.assignedStaffName ? ` · ${selectedFolder.assignedStaffName}` : ""}
									{selectedDoc.branch ? ` · ${selectedDoc.branch}` : ""}
								</p>
								<p className="cn-detailhead__meta">
									uploaded {new Date(uploadedAtOf(selectedDoc)).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {formatBytes(selectedDoc.sizeBytes)}
									{selectedDoc.reviewedAt ? ` · reviewed ${new Date(selectedDoc.reviewedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
								</p>
								{selectedDoc.reviewNote && <p className="cn-detailhead__sub">“{selectedDoc.reviewNote}”</p>}
								{selectedDoc.status === "UPLOADED" && (
									<div className="cn-now__actions">
										<button type="button" className="btn btn--primary btn--sm" disabled={busyDocId === selectedDoc.id} onClick={() => void handleVerify(selectedDoc)}>
											{busyDocId === selectedDoc.id ? "Verifying…" : "Verify"}
										</button>
										<button type="button" className="btn btn--ghost btn--sm" disabled={busyDocId === selectedDoc.id} onClick={() => setRejectingDoc(selectedDoc)}>
											Reject…
										</button>
									</div>
								)}
							</div>
							{/* The directory is the file list — the pane keeps only
							    where in the cabinet this file sits. */}
							{selectedFolder && (
								<div className="card cn-now">
									<div className="cn-detail__rows">
										<div className="cn-detail__row" style={{ cursor: "default" }}>
											<span>
												Location
												<br />
												<span className="cn-detail__row-note">
													{selectedFolder.applicantName} / {selectedFolder.cases.find((c) => c.documents.some((d) => d.id === selectedDoc.id))?.label ?? "General"}
												</span>
											</span>
											<span className="cn-detail__row-note">
												{selectedFolder.verifiedCount} of {selectedFolder.documents.length} verified
											</span>
										</div>
									</div>
								</div>
							)}
						</div>
					) : null
				}
			/>

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
