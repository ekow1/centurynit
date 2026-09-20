import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { DOCUMENT_TYPES, REQUIRED_DOCUMENTS } from "century-nit-core";
import { ApiError, documentsApi, meApi } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "century-nit-shared";
import type { ApplicantDocument } from "century-nit-shared";
import { Button } from "../../components/ui/Button";
import { UploadProgressModal, type UploadStage } from "../../components/portal/UploadProgressModal";
import { prepareDocumentForUpload } from "../../lib/upload";
import { useAppState, documentsReleasedFor, documentHoldReasonFor } from "../../context/AppState";
import { OfficialDocuments, officialRows } from "../../components/OfficialDocuments";
import { DocumentSheet, STATUS_META } from "../../components/portal/DocumentSheet";
import { useMediaQuery } from "../../hooks/useMediaQuery";

/**
 * The applicant's document vault. Fully server-backed.
 *
 * Every file goes through a presigned R2 URL: the browser takes a ticket from
 * the API, PUTs the bytes straight to storage, and tells the API they landed.
 * Nothing passes through Node. The consultant sees the upload in the ops review
 * queue, and their verdict flows back here as `VERIFIED` / `REJECTED`.
 *
 * `RequireAuth` guarantees a signed-in session, so a load failure is an
 * operational error (shown with a retry) rather than the previous "signed out →
 * localStorage demo" path. The demo path has been removed: there is no
 * fabricated upload and no fallback store, only the real one.
 */

/** API vocabulary → the vault's. PENDING_UPLOAD never reaches a listing. */
const LIVE_STATUS: Record<string, string> = {
	UPLOADED: "uploaded",
	VERIFIED: "verified",
	REJECTED: "rejected",
};

const ACCEPT = ALLOWED_DOCUMENT_TYPES.join(",");

function readableError(err: unknown, fallback: string): string {
	if (err instanceof ApiError) {
		if (err.code === "STORAGE_NOT_CONFIGURED") {
			return "Uploads are temporarily unavailable. Please try again shortly.";
		}
		return err.message;
	}
	return fallback;
}

type VaultRow = {
	id: string;
	name: string;
	hint: string;
	chapter: "file" | "visa" | "departure";
	live: ApplicantDocument | null;
	status: string;
	fileName: string | null;
	uploadedAt: string | null;
	history: ApplicantDocument[];
};

export function PortalDocumentVault() {
	const { application, schoolApplications, booking } = useAppState();
	const [allDocs, setAllDocs] = useState<ApplicantDocument[]>([]);
	const { toast } = useNotifier();
	const [liveDocs, setLiveDocs] = useState<Map<string, ApplicantDocument> | null>(null);
	const [docHistory, setDocHistory] = useState<Map<string, ApplicantDocument[]>>(new Map());
	const [openId, setOpenId] = useState<string | null>(null);
	const isMobile = useMediaQuery("(max-width: 900px)");
	const [loadError, setLoadError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeUpload, setActiveUpload] = useState<{
		fileName: string;
		percent: number;
		stage: UploadStage;
		error?: string;
	} | null>(null);
	const fileInput = useRef<HTMLInputElement | null>(null);
	const pendingTarget = useRef<string | null>(null);
	const [pickDocId, setPickDocId] = useState<string | null>(null);
	const pickDragCounter = useRef(0);
	const [pickDragOver, setPickDragOver] = useState(false);

	// Which documents this client needs: their package's list (or the one the
	// assessment recommended), falling back to the standard set.
	const [required, setRequired] = useState<{ id: string; name: string; hint: string; chapter: VaultRow["chapter"] }[]>(
		REQUIRED_DOCUMENTS.map((d) => ({ ...d, chapter: "file" as const })),
	);

	const loadLive = useCallback(async () => {
		setLoadError(null);
		try {
			const [res, me] = await Promise.all([documentsApi.list(), meApi.application().catch(() => null)]);
			const base = (me?.application?.documentChecklist ?? me?.consultation?.documentChecklist ?? [])
				.map((d) => ({ id: d.id, name: d.name, hint: d.hint, chapter: "file" as const }));
			// The visa set joins the list once the visa chapter has opened; the
			// departure proofs (insurance, accommodation) once Departure has.
			const visa = (me?.application?.visaDocumentChecklist ?? [])
				.map((d) => ({ id: d.id, name: d.name, hint: d.hint, chapter: "visa" as const }));
			const departure = (me?.application?.preDepartureTasks ?? [])
				.filter((t) => t.evidence)
				.map((t) => {
					const meta = DOCUMENT_TYPES.find((d) => d.id === t.evidence);
					return { id: t.evidence as string, name: meta?.name ?? t.label, hint: meta?.hint ?? t.detail ?? "", chapter: "departure" as const };
				});
			const seen = new Set(base.map((d) => d.id));
			const list = [...base, ...visa.filter((d) => !seen.has(d.id)), ...departure.filter((d) => !seen.has(d.id) && !visa.some((v) => v.id === d.id))];
			if (list.length > 0) setRequired(list);
			// The list is newest-first per type. Replaced rows stay as REJECTED
			// for 30 days, so the current doc is the first non-REJECTED row.
			const grouped = new Map<string, ApplicantDocument[]>();
			for (const d of res.documents) {
				const list = grouped.get(d.documentType) ?? [];
				list.push(d);
				grouped.set(d.documentType, list);
			}
			const current = new Map<string, ApplicantDocument>();
			for (const [type, docs] of grouped) {
				current.set(type, docs.find((d) => d.status !== "REJECTED") ?? docs[0]);
			}
			setLiveDocs(current);
			setDocHistory(grouped);
			setAllDocs(res.documents);
		} catch (err) {
			// Signed-out is no longer reachable here (RequireAuth gates the
			// portal), so a failure is operational. Surface a retry.
			setLiveDocs(null);
			setLoadError(readableError(err, "Could not load your documents. Check your connection and try again."));
		}
	}, []);

	useEffect(() => {
		void loadLive();
	}, [loadLive]);

	const loading = liveDocs === null && !loadError;

	const rows: VaultRow[] = required.map((meta) => {
		const live = liveDocs?.get(meta.id) ?? null;
		return {
			id: meta.id,
			name: meta.name,
			hint: meta.hint,
			chapter: meta.chapter,
			live,
			status: live ? (LIVE_STATUS[live.status] ?? "uploaded") : "missing",
			fileName: live?.fileName ?? null,
			uploadedAt: live?.uploadedAt ?? live?.createdAt ?? null,
			history: docHistory.get(meta.id) ?? [],
		};
	});
	const groups: { chapter: VaultRow["chapter"]; label: string; numeral: string | null }[] = [
		{ chapter: "file", label: "Your file", numeral: null },
		{ chapter: "visa", label: "Visa", numeral: "IV" },
		{ chapter: "departure", label: "Departure", numeral: "V" },
	];

	const uploadedCount = rows.filter((d) => d.status !== "missing").length;
	const verifiedCount = rows.filter((d) => d.status === "verified").length;
	const inReviewCount = rows.filter((d) => d.status === "uploaded").length;
	const needsYouCount = rows.filter((d) => d.status === "missing" || d.status === "rejected").length;
	const allUploaded = uploadedCount === rows.length;
	const allVerified = allUploaded && verifiedCount === rows.length;
	const openRow = openId ? (rows.find((r) => r.id === openId && r.live) ?? null) : null;

	useEffect(() => {
		if (openId && !rows.some((r) => r.id === openId && r.live)) setOpenId(null);
	}, [openId, rows]);

	const sheet =
		openRow && openRow.live ? (
			<DocumentSheet
				row={{ id: openRow.id, name: openRow.name, status: openRow.status, live: openRow.live, history: openRow.history }}
				onClose={() => setOpenId(null)}
				onReplace={() => handleUpload(openRow.id)}
				onRemove={
					openRow.status !== "verified"
						? () => {
								void handleRemove(openRow).then((ok) => {
									if (ok) setOpenId(null);
								});
							}
						: undefined
				}
				busy={busyId === openRow.id}
			/>
		) : null;

	function handleUpload(id: string) {
		setError(null);
		setPickDocId(id);
	}

	function closePickModal() {
		setPickDocId(null);
		setPickDragOver(false);
		pickDragCounter.current = 0;
	}

	function onPickDragEnter(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current += 1;
		if (pickDragCounter.current === 1) setPickDragOver(true);
	}
	function onPickDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current -= 1;
		if (pickDragCounter.current <= 0) {
			pickDragCounter.current = 0;
			setPickDragOver(false);
		}
	}
	function onPickDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}
	function onPickDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current = 0;
		setPickDragOver(false);
		const file = e.dataTransfer.files?.[0];
		if (!file || !pickDocId) return;
		pendingTarget.current = pickDocId;
		closePickModal();
		void onFileChosen(file);
	}

	function pickBrowse() {
		if (!pickDocId) return;
		pendingTarget.current = pickDocId;
		closePickModal();
		fileInput.current?.click();
	}

	async function onFileChosen(file: File) {
		const id = pendingTarget.current;
		pendingTarget.current = null;
		if (!id) return;

		// Checked here as well as server-side, so the applicant learns before
		// waiting for a 15 MB upload to be refused at the end of it.
		if (file.size > MAX_DOCUMENT_BYTES) {
			const msg = `${file.name} is larger than 15 MB. Please upload a smaller scan.`;
			setError(msg);
			toast.error(msg);
			return;
		}
		if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
			const msg = "Upload a PDF document.";
			setError(msg);
			toast.error(msg);
			return;
		}

		setBusyId(id);
		setError(null);
		setActiveUpload({ fileName: file.name, percent: 0, stage: "preparing" });
		try {
			// Large images are re-encoded here so they fit comfortably under the
			// ceiling; PDFs and Word documents pass through untouched.
			const ready = await prepareDocumentForUpload(file, (p) => {
				setActiveUpload((u) => (u ? { ...u, percent: p, stage: "preparing" } : u));
			});

			if (ready.size > MAX_DOCUMENT_BYTES) {
				const msg = `${file.name} is still larger than 15 MB after compression. Please upload a smaller scan.`;
				setActiveUpload((u) => (u ? { ...u, stage: "error", error: msg } : u));
				toast.error(msg);
				return;
			}

			setActiveUpload((u) => (u ? { ...u, percent: 0, stage: "uploading" } : u));
			const saved = await documentsApi.upload(ready, id, {
				onProgress: (p) => {
					setActiveUpload((u) => (u ? { ...u, percent: p, stage: "uploading" } : u));
				},
			});
			setLiveDocs((current) => new Map(current ?? []).set(saved.documentType, saved));
			setDocHistory((h) => new Map(h).set(saved.documentType, [saved, ...(h.get(saved.documentType) ?? [])]));
			setActiveUpload(null);
			toast.success(`${file.name} uploaded.`);
		} catch (err) {
			const msg = readableError(err, `Could not upload ${file.name}. Please try again.`);
			setError(msg);
			setActiveUpload((u) => (u ? { ...u, stage: "error", error: msg } : u));
			toast.error(msg);
		} finally {
			setBusyId(null);
		}
	}

	async function handleRemove(row: VaultRow): Promise<boolean> {
		if (!row.live) return false;
		setBusyId(row.id);
		setError(null);
		try {
			await documentsApi.remove(row.live.id);
			setLiveDocs((current) => {
				const next = new Map(current ?? []);
				next.delete(row.live!.documentType);
				return next;
			});
			setDocHistory((h) => {
				const next = new Map(h);
				next.set(row.live!.documentType, (next.get(row.live!.documentType) ?? []).filter((d) => d.id !== row.live!.id));
				return next;
			});
			toast.success(`${row.fileName ?? row.name} removed.`);
			return true;
		} catch (err) {
			// A verified document is refused with 409. That rule is the server's,
			// and its message already explains what to do instead.
			const msg = readableError(err, "Could not remove that document.");
			setError(msg);
			toast.error(msg);
			return false;
		} finally {
			setBusyId(null);
		}
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

			{/* the count. One line of truth; the inverted cell is what needs you */}
			<div className="dcount mt-4">
				<div>
					<p className="dcount__n">
						{uploadedCount}<span className="muted" style={{ fontSize: "1rem", fontWeight: 400 }}> / {rows.length}</span>
					</p>
					<p className="dcount__l">On file</p>
				</div>
				<div>
					<p className="dcount__n">{verifiedCount}</p>
					<p className="dcount__l">Verified</p>
				</div>
				<div>
					<p className="dcount__n">{inReviewCount}</p>
					<p className="dcount__l">In review</p>
				</div>
				<div className="dcount__act">
					<p className="dcount__n">{needsYouCount}</p>
					<p className="dcount__l">Needs you</p>
				</div>
			</div>

			<input
				ref={fileInput}
				type="file"
				accept={ACCEPT}
				hidden
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (file) void onFileChosen(file);
				}}
			/>

			{loadError ? (
				<div className="card card--pad mt-4" role="alert">
					<p className="muted">{loadError}</p>
					<div className="row mt-3">
						<Button type="button" variant="secondary" onClick={() => void loadLive()}>
							Try again
						</Button>
					</div>
				</div>
			) : null}

			{error ? (
				<div className="card card--pad mt-4" role="alert">
					<p className="muted">{error}</p>
				</div>
			) : null}

			<div className="psplit mt-4">
				<div>
					{/* documents grouped by the chapter they unlock */}
					{groups.map((g) => {
						const grows = rows.filter((r) => r.chapter === g.chapter);
						if (grows.length === 0) return null;
						const gv = grows.filter((r) => r.status === "verified").length;
						const allGv = gv === grows.length;
						return (
							<div key={g.chapter}>
								<div className="psec mt-5">
									<span className={`psec__no${allGv ? " psec__no--done" : ""}`}>{allGv ? "✓" : g.numeral ?? "•"}</span>
									<span className="psec__title">{g.label}</span>
									<span className="psec__hint">{gv} of {grows.length} verified</span>
								</div>
								<div>
									{grows.map((doc) => {
										const statusMeta = STATUS_META[doc.status] ?? STATUS_META.missing;
										const busy = busyId === doc.id;
										const rowCls = `${
											doc.status === "verified" ? "drow drow--ok" : doc.status === "rejected" ? "drow drow--now" : "drow"
										}${openId === doc.id ? " drow--open" : ""}`;
										const mark =
											doc.status === "verified" ? "✓" : doc.status === "rejected" ? "!" : doc.status === "uploaded" ? "…" : "·";
										return (
											<div
												key={doc.id}
												className={rowCls}
												role={doc.fileName ? "button" : undefined}
												onClick={doc.fileName ? () => setOpenId(doc.id) : undefined}
											>
												<span className="drow__mark">{mark}</span>
												<div>
													<p className="drow__name">{doc.name}</p>
													{doc.hint ? <p className="drow__hint">{doc.hint}</p> : null}
													{doc.fileName ? (
														<p className="drow__file">
															{doc.fileName}
															{doc.uploadedAt ? ` · ${new Date(doc.uploadedAt).toLocaleDateString()}` : ""}
														</p>
													) : null}
													{doc.live?.reviewNote ? (
														<div className="drow__note">
															<strong>Your consultant:</strong> {doc.live.reviewNote}
														</div>
													) : null}
												</div>
												<span className={`portal-pill ${statusMeta.pill}`}>{statusMeta.label}</span>
												<span className="drow__acts">
													{doc.fileName ? (
														<>
															<button
																type="button"
																className="jlink"
																onClick={(e) => {
																	e.stopPropagation();
																	setOpenId(doc.id);
																}}
																disabled={busy}
															>
																Open
															</button>
															{doc.status !== "verified" ? (
																<button
																	type="button"
																	className="jlink"
																	onClick={(e) => {
																		e.stopPropagation();
																		handleUpload(doc.id);
																	}}
																	disabled={busy}
																>
																	{busy ? "Uploading…" : "Replace"}
																</button>
															) : null}
														</>
													) : (
														<Button type="button" variant="primary" size="sm" onClick={() => handleUpload(doc.id)} disabled={busy || loading}>
															{busy ? "Uploading…" : doc.status === "rejected" ? "Re-upload" : "Upload"}
														</Button>
													)}
												</span>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}

					{/* what the milestone releases. Now in your hands */}
					<div className="psec mt-5">
						<span className="psec__no">↓</span>
						<span className="psec__title">In your hands</span>
						<span className="psec__hint">Released to you</span>
					</div>
					<OfficialDocuments
						rows={officialRows({ schools: schoolApplications, docs: allDocs })}
						released={documentsReleasedFor(application)}
						holdReason={documentHoldReasonFor(application)}
					/>

					{allUploaded && !allVerified ? (
						<div className="sharp-card mt-5">
							<p className="eyebrow">All documents uploaded</p>
							<p className="muted mt-1" style={{ fontSize: "var(--text-sm)" }}>
								Your consultant will review and verify each document. Check back for status updates.
							</p>
						</div>
					) : null}

					{allVerified ? (
						<div className="sharp-card sharp-card--key mt-5">
							<p className="eyebrow">Verification complete</p>
							<p className="mt-2" style={{ fontSize: "1.1rem", fontWeight: 700 }}>
								All documents verified ✓
							</p>
							<p className="muted mt-1" style={{ fontSize: "var(--text-sm)" }}>
								Your document vault is cleared. The file moves with the journey.
							</p>
						</div>
					) : null}
				</div>

				{/* the rail — on desktop the preview sheet takes its place */}
				{!isMobile && sheet ? (
					sheet
				) : (
				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow">The count</p>
						<div className="pkv"><span className="pkv__k">On file</span><span className="pkv__v">{uploadedCount} / {rows.length}</span></div>
						<div className="pkv"><span className="pkv__k">Verified</span><span className="pkv__v">{verifiedCount}</span></div>
						<div className="pkv"><span className="pkv__k">In review</span><span className="pkv__v">{inReviewCount}</span></div>
						<div className="pkv"><span className="pkv__k">Needs you</span><span className="pkv__v"><strong>{needsYouCount}</strong></span></div>
						{needsYouCount > 0 ? (
							<p className="muted" style={{ fontSize: "0.66rem", marginTop: "0.8rem", lineHeight: 1.5 }}>
								{needsYouCount === 1 ? "One document stands" : needsYouCount + " documents stand"} between you and a complete file.
							</p>
						) : null}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">What documents unlock</p>
						<div className="pkv"><span className="pkv__k">Chapter IV</span><span className="pkv__v">Visa submission</span></div>
						<div className="pkv"><span className="pkv__k">Chapter V</span><span className="pkv__v">Departure proofs</span></div>
						<div className="pkv"><span className="pkv__k">Milestone</span><span className="pkv__v">Releases your letters</span></div>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Formats</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.6 }}>
							PDF only. Max 15 MB. Clear scans — your consultant reviews every upload.
						</p>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Reviewer</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem" }}>
							{booking.consultantName ? `${booking.consultantName} · your consultant` : "Your consultant"}
						</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>
							Reviews within 1–2 working days.
						</p>
					</div>
				</div>
				)}
			</div>

			{isMobile && sheet ? (
				<>
					<div className="dsheet__backdrop" onClick={() => setOpenId(null)} />
					{sheet}
				</>
			) : null}

			{pickDocId ? (() => {
				const doc = rows.find((r) => r.id === pickDocId);
				return (
					<div
						role="dialog"
						aria-modal="true"
						aria-label={`Upload ${doc?.name ?? "document"}`}
						onDragEnter={onPickDragEnter}
						onDragLeave={onPickDragLeave}
						onDragOver={onPickDragOver}
						onDrop={onPickDrop}
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
							<p className="eyebrow" style={{ margin: 0 }}>
								{doc?.status === "missing" ? "Upload" : "Replace"} document
							</p>
							<p style={{ margin: "0.5rem 0 1rem", fontSize: "0.95rem" }}>
								{doc?.name ?? "Select a file"}
								{doc?.hint ? <span className="muted" style={{ display: "block", fontSize: "0.85rem", marginTop: "0.15rem" }}>{doc.hint}</span> : null}
							</p>
							<div className={`drop-zone${pickDragOver ? " drop-zone--active" : ""}`}>
								<p className="drop-zone__label">Drop file here</p>
								<Button size="sm" onClick={pickBrowse}>
									Browse files
								</Button>
								<p className="drop-zone__hint">PDF, JPG, PNG, DOC or DOCX. Max 15 MB</p>
							</div>
							<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
								<Button variant="ghost" size="sm" onClick={closePickModal}>
									Cancel
								</Button>
							</div>
						</div>
					</div>
				);
			})() : null}

			<UploadProgressModal
				open={activeUpload !== null}
				fileName={activeUpload?.fileName ?? ""}
				stage={activeUpload?.stage ?? "preparing"}
				percent={activeUpload?.percent ?? 0}
				error={activeUpload?.error}
				onClose={() => setActiveUpload(null)}
			/>
		</div>
	);
}