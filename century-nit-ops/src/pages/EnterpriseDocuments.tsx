import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { DocPreviewInline } from "./DocPreviewInline";
import { CaseScaffold } from "./case/CaseScaffold";
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
/** A file waiting this long is late — the reviewer's queue, not the client's. */
const LATE_AFTER_DAYS = 3;
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
	const { opsUser } = useOpsAuth();
	const [cut, setCut] = useState<Cut>("all");
	const [search, setSearch] = useState("");
	const [showAll, setShowAll] = useState(false);
	const [selectedBranch, setSelectedBranch] = useState("all");
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


	// Calculate folders and statistics
	const { folders } = useMemo(() => {
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

		const folderList = Array.from(folderMap.values());
		return {
			folders: folderList,
			totalApplicants: folderList.length,
			totalDocs: folderList.reduce((acc, f) => acc + f.documents.length, 0),
			pendingDocsCount: pendingTotal,
			verifiedDocsCount: verifiedTotal,
		};
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

	/** The queue: waiting for review (oldest first), reviewed this week, everything else folded. */
	const bands = useMemo(() => {
		const q = search.trim().toLowerCase();
		const weekAgo = new Date().getTime() - 7 * 86_400_000;
		const matchesSearch = (f: ApplicantFolder, d: ApplicantDocument) => !q || `${f.applicantName} ${f.caseReference} ${f.ownerEmail} ${d.fileName} ${d.documentType}`.toLowerCase().includes(q);
		type Card = { folder: ApplicantFolder; lines: ApplicantDocument[]; oldest: number };
		const card = (f: ApplicantFolder, lines: ApplicantDocument[]): Card => ({ folder: f, lines, oldest: lines.reduce((m, d) => Math.max(m, daysSince(uploadedAtOf(d))), 0) });
		if (cut !== "all") {
			const cards = folders.map((f) => card(f, f.documents.filter((d) => inCut(d, f) && matchesSearch(f, d)))).filter((c) => c.lines.length > 0);
			return [{ id: "cut", label: "Matching", note: `${cards.reduce((n, c) => n + c.lines.length, 0)} files`, cards, folded: false }];
		}
		const waiting = folders
			.map((f) => card(f, f.documents.filter((d) => d.status === "UPLOADED" && matchesSearch(f, d))))
			.filter((c) => c.lines.length > 0)
			.sort((a, b) => b.oldest - a.oldest);
		const waitingKeys = new Set(waiting.map((c) => c.folder.key));
		const reviewed = folders
			.filter((f) => !waitingKeys.has(f.key))
			.map((f) => card(f, f.documents.filter((d) => d.status !== "UPLOADED" && d.reviewedAt && new Date(d.reviewedAt).getTime() >= weekAgo && matchesSearch(f, d))))
			.filter((c) => c.lines.length > 0);
		const reviewedKeys = new Set(reviewed.map((c) => c.folder.key));
		const rest = folders
			.filter((f) => !waitingKeys.has(f.key) && !reviewedKeys.has(f.key))
			.map((f) => card(f, f.documents.filter((d) => matchesSearch(f, d))))
			.filter((c) => c.lines.length > 0);
		return [
			{ id: "waiting", label: "Waiting for review", note: "oldest first", cards: waiting, folded: false },
			{ id: "reviewed", label: "Reviewed this week", note: `verified ${reviewed.reduce((n, c) => n + c.lines.filter((d) => d.status === "VERIFIED").length, 0)} · rejected ${reviewed.reduce((n, c) => n + c.lines.filter((d) => d.status === "REJECTED").length, 0)}`, cards: reviewed, folded: false },
			{ id: "rest", label: "All folders", note: showAll ? "hide" : "show ▸", cards: rest, folded: !showAll },
		].filter((b) => b.cards.length > 0);
	}, [folders, cut, search, showAll, inCut]);

	const selectedFolder = selectedDoc ? (folders.find((f) => f.documents.some((d) => d.id === selectedDoc.id)) ?? null) : null;

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
							<div className="cn-scaffold__chips" role="tablist" aria-label="Documents">
								{(
									[
										["all", "All"],
										["pending", "Pending"],
										["verified", "Verified"],
										["rejected", "Rejected"],
										...CATEGORY_ORDER.map((c) => [c, CATEGORY_LABEL[c]] as [Cut, string]),
										["mine", "Mine"],
									] as [Cut, string][]
								).map(([id, label]) => {
									const n = counts[id] ?? 0;
									if (n === 0 && id !== "all" && id !== "pending") return null;
									const on = cut === id;
									return (
										<button
											key={id}
											type="button"
											role="tab"
											aria-selected={on}
											className="ops-pill"
											onClick={() => setCut(id)}
											style={{
												cursor: "pointer",
												marginLeft: 0,
												border: "1px solid var(--border)",
												background: on ? "var(--foreground)" : "transparent",
												color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
												fontWeight: id === "pending" && n > 0 && !on ? 700 : 500,
											}}
										>
											{label}
											<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
												{n}
											</span>
										</button>
									);
								})}
							</div>
							<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
								<input type="search" className="cn-search" placeholder="Search client, file, type…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search documents" style={{ flex: "1 1 14rem", width: "auto" }} />
							</div>
						</div>
						<div className="cn-scaffold__rows">
							{documents === null ? (
								<p className="ops-people__empty">Loading documents…</p>
							) : bands.length === 0 ? (
								<p className="ops-people__empty">{documents.length === 0 ? "No documents uploaded yet." : "Nothing matches."}</p>
							) : (
								<div className="ops-bands">
									{bands.map((band) => (
										<div key={band.id}>
											<div
												className={`ops-band${band.id === "rest" ? " ops-band--toggle" : ""}`}
												role={band.id === "rest" ? "button" : undefined}
												tabIndex={band.id === "rest" ? 0 : undefined}
												onClick={band.id === "rest" ? () => setShowAll((v) => !v) : undefined}
												onKeyDown={
													band.id === "rest"
														? (e) => {
																if (e.key === "Enter" || e.key === " ") {
																	e.preventDefault();
																	setShowAll((v) => !v);
																}
															}
														: undefined
												}
											>
												<span className="ops-band__name">
													{band.label} · {band.cards.length}
												</span>
												<span className="ops-band__note">{band.note}</span>
											</div>
											{!band.folded && (
												<div className="ops-people">
													{band.cards.map(({ folder, lines, oldest }) => {
														const late = band.id === "waiting" && oldest >= LATE_AFTER_DAYS;
														const total = folder.documents.length;
														return (
															<div key={folder.key} className={`ops-person${late ? " ops-person--overdue" : ""}`}>
																<div className="ops-person__head">
																	<span className="ops-person__name" title={folder.applicantName}>
																		{folder.applicantName}
																	</span>
																	<span className="ops-person__when">{folder.caseReference !== "—" ? folder.caseReference : folder.branch}</span>
																</div>
																<ul className="ops-things">
																	{lines.map((d) => {
																		const on = selectedDoc?.id === d.id;
																		const pending = d.status === "UPLOADED";
																		const stale = pending && daysSince(uploadedAtOf(d)) >= LATE_AFTER_DAYS;
																		return (
																			<li
																				key={d.id}
																				className={`ops-thing${on ? " ops-thing--selected" : ""}`}
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
																				<span className={`cn-now__dot${stale ? "" : " cn-now__dot--hollow"}`} aria-hidden style={{ marginTop: "0.4rem", flexShrink: 0 }} />
																				<div className="ops-thing__main">
																					<div className="ops-thing__top">
																						<span className="ops-thing__kicker">
																							{typeLabel(d.documentType)} <span className="ops-thing__kind">· {CATEGORY_LABEL[(d.documentCategory ?? "OTHER").toUpperCase()] ?? d.documentCategory}</span>
																						</span>
																						{!pending && <span className={`cn-pill cn-pill--${d.status === "VERIFIED" ? "done" : "blocked"}`}>{STATUS_LABEL[d.status]}</span>}
																					</div>
																					<div className="ops-thing__sub" title={d.fileName}>
																						{d.fileName} · {formatBytes(d.sizeBytes)}
																						{d.status === "REJECTED" && d.reviewNote ? ` · ${d.reviewNote}` : ""}
																					</div>
																				</div>
																				<span className="ops-person__when">{agoLabel(pending ? uploadedAtOf(d) : (d.reviewedAt ?? uploadedAtOf(d)))}</span>
																			</li>
																		);
																	})}
																</ul>
																<div className="ops-person__foot">
																	<span className="ops-person__meta">
																		{folder.verifiedCount} of {total} verified{folder.pendingCount > 0 ? ` · ${folder.pendingCount} pending` : ""}
																		{folder.rejectedCount > 0 ? ` · ${folder.rejectedCount} rejected` : ""}
																	</span>
																	<span className="ops-person__meta">{folder.assignedStaffName}</span>
																</div>
															</div>
														);
													})}
												</div>
											)}
										</div>
									))}
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
							{selectedFolder && (
								<div className="card cn-now">
									<p className="cn-detail__eyebrow">
										This client's documents · {selectedFolder.verifiedCount} of {selectedFolder.documents.length} verified
									</p>
									<div className="cn-detail__rows">
										{[...selectedFolder.documents]
											.sort((a, b) => CATEGORY_ORDER.indexOf((a.documentCategory ?? "OTHER").toUpperCase()) - CATEGORY_ORDER.indexOf((b.documentCategory ?? "OTHER").toUpperCase()))
											.map((d) => (
												<button key={d.id} type="button" className="cn-detail__row cn-now__row" onClick={() => setSelectedDoc(d)}>
													<span style={{ fontWeight: d.id === selectedDoc.id ? 700 : 400 }}>{typeLabel(d.documentType)}</span>
													<span className="cn-detail__row-note">{d.id === selectedDoc.id ? "this one" : d.status === "UPLOADED" ? `pending · ${agoLabel(uploadedAtOf(d))}` : `${STATUS_LABEL[d.status].toLowerCase()}${d.reviewedAt ? ` ${new Date(d.reviewedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}`}</span>
												</button>
											))}
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
