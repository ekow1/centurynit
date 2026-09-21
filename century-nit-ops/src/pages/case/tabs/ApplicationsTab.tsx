import { useState } from "react";
import { Link } from "react-router-dom";

import { useCases } from "../../../hooks/useCases";
import { InvoiceCard, SchoolStatePill } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";
import type { Fail, Flash, TabId } from "./types";
import { openInNewTab } from "century-nit-core";
import { schoolsApi } from "century-nit-core/api";
import {
	ALLOWED_DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,
	SCHOOL_FILE_LABELS,
	SCHOOL_OUTCOME_LABELS,
	SCHOOL_TRACK_STAGES,
	SCHOOL_TRACK_STATUS_LABELS,
	JOURNEY_STAGES,
	schoolDecisionNote,
	type JourneyStage,
	type SchoolApplication,
	type SchoolFileKind,
	type SchoolOutcome,
	type SchoolTrackStatus,
} from "century-nit-shared";
import { raiseApplicationInvoice, applicationInvoicePreview } from "../../../lib/api";
import { RaiseLinesSheet } from "../RaiseLinesSheet";
import { fmtBoth } from "../../currency";
import { AddSchoolApplicationModal } from "../../AddSchoolApplicationModal";
import { useFeeCatalogue } from "../../../hooks/useFeeCatalogue";
import { ApproveInvoiceSheet } from "../ApproveInvoiceSheet";
import { PaymentGate } from "../PaymentGate";

/**
 * Applications — the schools, the application fee, submissions and offers.
 *
 * Each school is a summary row (where it is, the dates, the offer) with the
 * editor folded underneath, so a finished case reads as a record and a live
 * one opens to be worked. Every save reports its result through the case's
 * flash/fail, never silently.
 */

const OUTCOMES = Object.keys(SCHOOL_OUTCOME_LABELS) as SchoolOutcome[];

function fmtDate(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** ISO → yyyy-mm-dd for a date input; "" when unset. */
function dateInputValue(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** yyyy-mm-dd → ISO at midday UTC (keeps the calendar day in every zone); null when cleared. */
function dateInputToIso(value: string): string | null {
	return value ? new Date(`${value}T12:00:00Z`).toISOString() : null;
}

function usd(n: number | null | undefined): string | null {
	return n == null ? null : `$${n.toLocaleString("en-US")}`;
}

/** First time the track reached a status — the row's dates. */
function reachedAt(school: SchoolApplication, status: SchoolTrackStatus): string | null {
	const hits = (school.events ?? []).filter((e) => e.status === status);
	if (hits.length === 0) return null;
	return hits.reduce((a, b) => (a.at < b.at ? a : b)).at;
}

/* ── One school ─────────────────────────────────────────────────────────── */

function SchoolRow({
	appId,
	school,
	feePaid,
	canWork,
	accepted,
	otherAccepted,
	offerAcceptedAt,
	flash,
	fail,
}: {
	appId: string;
	school: SchoolApplication;
	feePaid: boolean;
	canWork: boolean;
	/** This is the offer the client is going with. */
	accepted: boolean;
	/** Another school's offer was accepted — accepting this one replaces it. */
	otherAccepted: boolean;
	offerAcceptedAt?: string | null;
	flash: Flash;
	fail: Fail;
}) {
	const { updateSchoolApplication, refresh } = useCases();
	const decided = school.status === "Decision Reached";
	const admitted = decided && school.outcome === "Admitted";
	const preparing = school.status === "Preparing Application";

	const [editing, setEditing] = useState(false);
	const [status, setStatus] = useState<SchoolTrackStatus>(school.status);
	const [outcome, setOutcome] = useState<SchoolOutcome>(school.outcome ?? "Admitted");
	const [note, setNote] = useState(school.handlerNote ?? "");
	const [reason, setReason] = useState("");
	// A decision already announced is not re-emailed by default.
	const [sendUpdateEmail, setSendUpdateEmail] = useState(!decided);
	const [tuitionUsd, setTuitionUsd] = useState(school.offerTuitionUsd != null ? String(school.offerTuitionUsd) : "");
	const [tuitionLabel, setTuitionLabel] = useState(school.offerTuitionLabel ?? "");
	const [depositUsd, setDepositUsd] = useState(school.offerDepositUsd != null ? String(school.offerDepositUsd) : "");
	const [depositDue, setDepositDue] = useState(dateInputValue(school.offerDepositDueAt));
	const [depositPaid, setDepositPaid] = useState(dateInputValue(school.offerDepositPaidAt));

	const [reference, setReference] = useState(school.institutionReference ?? "");

	const [saving, setSaving] = useState(false);
	const [uploading, setUploading] = useState<SchoolFileKind | null>(null);
	const [uploadPct, setUploadPct] = useState(0);
	const [showTimeline, setShowTimeline] = useState(false);
	const [busy, setBusy] = useState(false);

	const hasLetter = Boolean(school.offerLetterStorageKey || school.offerLetterUrl);
	const hasProof = Boolean(school.submissionProofUrl);
	const currentIdx = SCHOOL_TRACK_STAGES.indexOf(school.status);
	const nextIdx = SCHOOL_TRACK_STAGES.indexOf(status);
	const movingBack = nextIdx < currentIdx;
	const willDecide = status === "Decision Reached";
	const willAdmit = willDecide && outcome === "Admitted";

	const addedAt = fmtDate(school.createdAt);
	const submittedAt = fmtDate(reachedAt(school, "Submitted"));
	const decidedAt = fmtDate(reachedAt(school, "Decision Reached"));

	const previewNote = willDecide
		? note.trim() ||
			schoolDecisionNote({ outcome, universityName: school.universityName, programName: school.programName }) ||
			""
		: "";

	const toInt = (v: string): number | null => {
		const n = Number(v.replace(/[^0-9.]/g, ""));
		return v.trim() === "" || Number.isNaN(n) ? null : Math.round(n);
	};

	async function save() {
		if (movingBack && !reason.trim()) {
			fail(new Error("Give a reason for moving this school back — it goes in the school's timeline."), "Reason needed");
			return;
		}
		setSaving(true);
		try {
			await updateSchoolApplication(appId, school.id, {
				status,
				outcome: willDecide ? outcome : null,
				sendUpdateEmail: willDecide && sendUpdateEmail,
				handlerNote: note.trim() || null,
				institutionReference: reference.trim() || null,
				...(movingBack ? { note: reason.trim() } : {}),
				...(willAdmit
					? {
							offerTuitionUsd: toInt(tuitionUsd),
							offerTuitionLabel: tuitionLabel.trim() || null,
							offerDepositUsd: toInt(depositUsd),
							offerDepositDueAt: dateInputToIso(depositDue),
							offerDepositPaidAt: dateInputToIso(depositPaid),
						}
					: {}),
			});
			flash(
				willDecide
					? `${school.universityName ?? "School"} · ${SCHOOL_OUTCOME_LABELS[outcome]}${sendUpdateEmail ? " — client emailed" : ""}`
					: `${school.universityName ?? "School"} · ${SCHOOL_TRACK_STATUS_LABELS[status]}`,
			);
			setReason("");
			setEditing(false);
		} catch (e) {
			fail(e, "Could not update the school");
		} finally {
			setSaving(false);
		}
	}

	async function upload(kind: SchoolFileKind, e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		const label = SCHOOL_FILE_LABELS[kind].toLowerCase();
		if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
			fail(new Error("Upload a PDF document."), "Unsupported file");
			return;
		}
		if (file.size > MAX_DOCUMENT_BYTES) {
			fail(new Error("That file is larger than 15 MB."), "File too large");
			return;
		}
		setUploading(kind);
		setUploadPct(0);
		try {
			await schoolsApi.uploadFile(school.id, kind, file, (p) => setUploadPct(p));
			await refresh();
			flash(`${SCHOOL_FILE_LABELS[kind]} filed in the client's vault`);
		} catch (err) {
			fail(err, `Could not upload the ${label}`);
		} finally {
			setUploading(null);
		}
	}

	async function removeFile(kind: SchoolFileKind) {
		setUploading(kind);
		try {
			await schoolsApi.removeFile(school.id, kind);
			await refresh();
			flash(`${SCHOOL_FILE_LABELS[kind]} removed`);
		} catch (err) {
			fail(err, `Could not remove the ${SCHOOL_FILE_LABELS[kind].toLowerCase()}`);
		} finally {
			setUploading(null);
		}
	}

	async function viewFile(kind: SchoolFileKind) {
		try {
			await openInNewTab(schoolsApi.fileDownloadUrl(school.id, kind));
		} catch (err) {
			fail(err, `Could not open the ${SCHOOL_FILE_LABELS[kind].toLowerCase()}`);
		}
	}

	async function accept() {
		if (otherAccepted && !window.confirm(`Switch the accepted offer to ${school.universityName ?? "this school"}?`)) return;
		setBusy(true);
		try {
			await schoolsApi.acceptOffer(school.id);
			await refresh();
			flash(`${school.universityName ?? "School"} — offer accepted. Visa can open.`);
		} catch (err) {
			fail(err, "Could not accept the offer");
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		if (!window.confirm(`Remove ${school.universityName ?? "this school"} from the application? The draft invoice line goes with it.`)) return;
		setBusy(true);
		try {
			await schoolsApi.removeByStaff(school.id);
			await refresh();
			flash(`${school.universityName ?? "School"} removed`);
		} catch (err) {
			fail(err, "Could not remove the school");
		} finally {
			setBusy(false);
		}
	}

	/** One file slot: a dashed slot with the button over the hidden input, the
	 * file's state on the same line, Remove, and a progress rule while it
	 * uploads. A plain render helper, not a component — a component defined
	 * inside the row would remount (and lose its input) on every keystroke. */
	function fileSlot(kind: SchoolFileKind, present: boolean, hint: string) {
		const isUploading = uploading === kind;
		const inputId = `su-file-${school.id}-${kind}`;
		return (
			<div className={`su-slot${present && !isUploading ? " su-slot--on" : ""}`}>
				<input id={inputId} type="file" accept={ALLOWED_DOCUMENT_TYPES.join(",")} onChange={(e) => upload(kind, e)} disabled={uploading !== null} className="su-slot__in" />
				<label htmlFor={inputId} className={`su-slot__btn${uploading !== null ? " su-slot__btn--off" : ""}`}>
					↑ {present ? "Replace" : "Choose file"}
				</label>
				<span className="su-slot__name">
					{isUploading ? (
						<>
							Uploading…<small>{SCHOOL_FILE_LABELS[kind]} · {uploadPct}%</small>
						</>
					) : present ? (
						<>
							{SCHOOL_FILE_LABELS[kind]}
							<small>✓ on file · {hint}</small>
						</>
					) : (
						<>
							<span className="muted">{SCHOOL_FILE_LABELS[kind]} — {hint}</span>
							<small>PDF · image · Word</small>
						</>
					)}
				</span>
				{present && !isUploading ? (
					<button type="button" className="su-slot__x" onClick={() => removeFile(kind)} disabled={uploading !== null}>
						Remove
					</button>
				) : (
					<span />
				)}
				{isUploading ? (
					<span className="su-slot__bar" aria-hidden>
						<i style={{ width: `${uploadPct}%` }} />
					</span>
				) : null}
			</div>
		);
	}

	const events = [...(school.events ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));

	return (
		<div
			style={{
				border: accepted || admitted ? "2px solid var(--foreground)" : "1px solid var(--border-light)",
				background: accepted ? "var(--muted)" : "transparent",
			}}
		>
			{/* Summary — the record */}
			<div style={{ padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
					<div>
						<p style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
							{school.universityName || school.universityId}
							<SchoolStatePill status={school.status} outcome={school.outcome} />
							{accepted && (
								<span className="text-xs" style={{ fontWeight: 700 }}>
									★ Accepted{offerAcceptedAt ? ` ${fmtDate(offerAcceptedAt)}` : ""}
								</span>
							)}
						</p>
						<p className="muted text-xs">
							{school.programName || school.programId} · {school.countryName || school.destinationId} · {school.intake}
							{school.institutionReference && <> · Ref {school.institutionReference}</>}
						</p>
					</div>
					{canWork && !editing && (
						<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
							{admitted && !accepted && (
								<button type="button" className="btn btn--sm btn--primary" onClick={accept} disabled={busy}>
									{otherAccepted ? "Switch to this offer" : "Accept this offer"}
								</button>
							)}
							<button
								type="button"
								className="btn btn--sm btn--ghost"
								onClick={() => setEditing(true)}
								disabled={!feePaid}
								title={feePaid ? undefined : "Application fee not paid yet — school work starts once it is paid."}
							>
								{decided ? "Edit" : "Update"}
							</button>
							{preparing && (
								<button type="button" className="btn btn--sm btn--ghost" onClick={remove} disabled={busy} title="Only a school still being prepared can be removed">
									Remove
								</button>
							)}
						</div>
					)}
				</div>

				<p className="muted text-xs">
					{[
						addedAt && `Added ${addedAt}`,
						submittedAt && `Submitted ${submittedAt}`,
						decidedAt && `Decided ${decidedAt}`,
						hasProof && "Submission ✓",
						hasLetter && "Letter ✓",
					]
						.filter(Boolean)
						.join(" · ")}
				</p>

				{admitted && (school.offerTuitionUsd != null || school.offerDepositUsd != null || school.offerDepositDueAt) && (
					<p className="text-xs">
						<span className="muted">Offer: </span>
						{[
							school.offerTuitionLabel?.trim() || (usd(school.offerTuitionUsd) && `${usd(school.offerTuitionUsd)} tuition`),
							usd(school.offerDepositUsd) && `${usd(school.offerDepositUsd)} deposit`,
							school.offerDepositDueAt && `due ${fmtDate(school.offerDepositDueAt)}`,
							school.offerDepositPaidAt && `paid ${fmtDate(school.offerDepositPaidAt)}`,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				)}
				{admitted && !school.offerDepositPaidAt && school.offerDepositDueAt && new Date(school.offerDepositDueAt).getTime() < Date.now() && (
					<p className="text-xs" style={{ color: "var(--danger, #b91c1c)", fontWeight: 600 }}>
						Deposit deadline passed — confirm with the school whether the place is still held.
					</p>
				)}

				{decided && school.handlerNote && (
					<p className="text-xs">
						<span className="muted">Client sees: </span>
						{school.handlerNote}
					</p>
				)}

				<div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
					{hasProof && (
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => viewFile("submission-proof")}>
							View submission
						</button>
					)}
					{hasLetter && (
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => viewFile("offer-letter")}>
							View letter
						</button>
					)}
					{events.length > 0 && (
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowTimeline((v) => !v)}>
							{showTimeline ? "Hide timeline" : `Timeline · ${events.length}`}
						</button>
					)}
				</div>

				{showTimeline && (
					<ul className="cn-timeline">
						{events.map((e, i) => (
							<li key={e.id ?? i} className="cn-timeline__item">
								<div className="cn-timeline__head">
									<span className="cn-timeline__summary">
										{e.status === "Decision Reached" && e.outcome
											? SCHOOL_OUTCOME_LABELS[e.outcome]
											: SCHOOL_TRACK_STATUS_LABELS[e.status]}
									</span>
									<span className="cn-timeline__when">{fmtDate(e.at)}</span>
								</div>
								{e.note && <p className="cn-timeline__meta">{e.note}</p>}
							</li>
						))}
					</ul>
				)}
			</div>

			{/* Editor — folded under the record; four steps, opened by the move */}
			{editing && (
				<div className="su">
					<div className="su__h">
						<b>Update · {school.universityName || school.universityId}</b>
						<span className="su__esc">{SCHOOL_TRACK_STATUS_LABELS[school.status]} today</span>
					</div>

					<div className="su-step">
						<div className="su-step__h">
							<span className="su-step__no">1</span>
							<span className="su-step__t">The move</span>
							<span className="su-step__hint">
								{status === school.status
									? "no change"
									: `${SCHOOL_TRACK_STATUS_LABELS[school.status]} → ${SCHOOL_TRACK_STATUS_LABELS[status]}${movingBack ? " · moving back" : ""}`}
							</span>
						</div>
						<div className="su-chips">
							{SCHOOL_TRACK_STAGES.map((st, i) => {
								const on = status === st;
								const reachedDate = i <= currentIdx ? fmtDate(reachedAt(school, st)) : null;
								const done = i <= currentIdx && !on;
								return (
									<button key={st} type="button" className={`su-chip${on ? " su-chip--on" : done ? " su-chip--done" : ""}`} onClick={() => setStatus(st)} aria-pressed={on}>
										<span className="su-chip__m">{done ? "✓" : i + 1}</span>
										{SCHOOL_TRACK_STATUS_LABELS[st]}
										<span className="su-chip__s">{on && movingBack ? "again" : on && i > currentIdx ? "today" : reachedDate ?? ""}</span>
									</button>
								);
							})}
						</div>
						{willDecide && (
							<div className="su-chips su-chips--4">
								{OUTCOMES.map((o) => (
									<button key={o} type="button" className={`su-chip${outcome === o ? " su-chip--on" : ""}`} onClick={() => setOutcome(o)} aria-pressed={outcome === o}>
										<span className="su-chip__m">{outcome === o ? "■" : ""}</span>
										{SCHOOL_OUTCOME_LABELS[o]}
									</button>
								))}
							</div>
						)}
						{movingBack && (
							<label className="su-fld">
								<span className="su-k">Why — recorded in the school's timeline</span>
								<input className="input input--sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Submission bounced — missing transcript, resubmitting" autoFocus />
							</label>
						)}
					</div>

					{!movingBack && (
						<div className="su-step">
							<div className="su-step__h">
								<span className="su-step__no">2</span>
								<span className="su-step__t">The school's file</span>
								<span className="su-step__hint">their reference{status !== "Preparing Application" ? " and the proof we submitted" : ""}</span>
							</div>
							<label className="su-fld">
								<span className="su-k">School's application reference (their number for this application)</span>
								<input className="input input--sm su-mono" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. UCAS 1234567890 / OX-2026-44871" />
							</label>
							{status !== "Preparing Application" && fileSlot("submission-proof", hasProof, "the confirmation page or receipt showing we submitted")}
						</div>
					)}

					{!movingBack && (
						<div className={`su-step${willAdmit ? "" : " su-step--dim"}`}>
							<div className="su-step__h">
								<span className={`su-step__no${willAdmit ? "" : " su-step__no--dim"}`}>3</span>
								<span className="su-step__t">The offer</span>
								{willAdmit && <span className="su-step__hint">the client sees these with a deadline countdown</span>}
							</div>
							{willAdmit ? (
								<>
									<div className="su-grid su-grid--3">
										<label className="su-fld">
											<span className="su-k">Tuition as written on the offer</span>
											<input className="input input--sm" value={tuitionLabel} onChange={(e) => setTuitionLabel(e.target.value)} placeholder="£22,500 per year" />
										</label>
										<label className="su-fld">
											<span className="su-k">Tuition (USD)</span>
											<input className="input input--sm su-mono" inputMode="numeric" value={tuitionUsd} onChange={(e) => setTuitionUsd(e.target.value)} placeholder="28000" />
										</label>
										<label className="su-fld">
											<span className="su-k">Deposit to hold the place (USD)</span>
											<input className="input input--sm su-mono" inputMode="numeric" value={depositUsd} onChange={(e) => setDepositUsd(e.target.value)} placeholder="2000" />
										</label>
									</div>
									<div className="su-grid su-grid--3">
										<label className="su-fld">
											<span className="su-k">Deposit due</span>
											<input className="input input--sm" type="date" value={depositDue} onChange={(e) => setDepositDue(e.target.value)} />
										</label>
										<label className="su-fld">
											<span className="su-k">Deposit paid on</span>
											<input className="input input--sm" type="date" value={depositPaid} onChange={(e) => setDepositPaid(e.target.value)} />
										</label>
									</div>
									{fileSlot("offer-letter", hasLetter, "filed in the client's vault and attached to the email")}
								</>
							) : (
								<p className="su-later">Asked once the school decides and admits.</p>
							)}
						</div>
					)}

					{!movingBack && (
						<div className={`su-step${willDecide ? "" : " su-step--dim"}`}>
							<div className="su-step__h">
								<span className={`su-step__no${willDecide ? "" : " su-step__no--dim"}`}>4</span>
								<span className="su-step__t">Tell the client</span>
								{willDecide && <span className="su-step__hint">what lands in the portal and the email</span>}
							</div>
							{willDecide ? (
								<>
									<div className="su-grid su-grid--2">
										<label className="su-fld">
											<span className="su-k">Your note (blank uses the standard message)</span>
											<textarea className="input input--sm" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Leave blank for the standard message, or write your own…" />
										</label>
										<div className="su-preview">
											<span className="su-k">The client will see</span>
											{previewNote}
										</div>
									</div>
									<div className="su-row">
										<label className="su-tog">
											<input type="checkbox" className="su-tog__in" checked={sendUpdateEmail} onChange={(e) => setSendUpdateEmail(e.target.checked)} />
											<span className="su-tog__bx" aria-hidden />
											Email the client this decision{willAdmit ? " · offer terms and letter included" : ""}
										</label>
										{decided && <span className="su-k">Already announced — tick to send it again</span>}
									</div>
								</>
							) : (
								<p className="su-later">A submission is not emailed — the client sees the move on their card. Decisions are.</p>
							)}
						</div>
					)}

					<div className="su-foot">
						<span className="su-foot__cons">
							{movingBack
								? "Saving moves the file back and writes the reason on the timeline. Nothing is emailed."
								: willAdmit
									? `Saving records the decision on the timeline, files the letter in the client's vault${sendUpdateEmail ? ", emails the client" : ""}, and opens Chapter IV for them.`
									: willDecide
										? `Saving records the decision on the timeline${sendUpdateEmail ? " and emails the client" : ""}.`
										: `Saving marks the file ${SCHOOL_TRACK_STATUS_LABELS[status].toLowerCase()} on the timeline; the client's card moves with it.`}
						</span>
						<div className="su-foot__btns">
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(false)} disabled={saving}>
								Cancel
							</button>
							<button type="button" className="btn btn--sm btn--primary" onClick={save} disabled={saving}>
								{saving ? "Saving…" : willDecide && sendUpdateEmail ? "Save & notify →" : "Save →"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/* ── The tab ────────────────────────────────────────────────────────────── */

export function ApplicationsTab({
	app,
	appInvoice,
	appInvoiceLoading,
	canIssueInvoices,
	canWork,
	outstandingDocs,
	setTab,
	onInvoiceChanged,
	flash,
	fail,
}: {
	app: MockApplication;
	appInvoice: ApiInvoice | null;
	appInvoiceLoading: boolean;
	canIssueInvoices: boolean;
	canWork: boolean;
	/** Names of the standard documents not yet verified — nothing is invoiced while any remain. */
	outstandingDocs: string[];
	setTab: (t: TabId) => void;
	/** The application invoice was raised or issued; the parent reloads the case's invoices. */
	onInvoiceChanged: (updated: ApiInvoice) => void;
	flash: Flash;
	fail: Fail;
}) {
	const [adding, setAdding] = useState(false);
	const [approving, setApproving] = useState<ApiInvoice | null>(null);
	const { addApplication, refresh } = useCases();
	const { catalogue } = useFeeCatalogue();

	const schools = app.schoolApplications ?? [];
	const total = schools.length;
	const cap = app.targetSchoolCount ?? null;
	const preparing = schools.filter((s) => s.status === "Preparing Application").length;
	const awaiting = schools.filter((s) => s.status === "Submitted").length;
	const decidedRows = schools.filter((s) => s.status === "Decision Reached");
	const admitted = decidedRows.filter((s) => s.outcome === "Admitted").length;
	const waitlisted = decidedRows.filter((s) => s.outcome === "Waitlisted").length;
	const unsuccessful = decidedRows.filter((s) => s.outcome === "Application Rejected" || s.outcome === "Withdrawn").length;
	const over = cap != null && cap > 0 && total > cap;
	const feePaid = Boolean(app.appFeePaid);
	const acceptedSchool = app.acceptedSchoolId ? schools.find((s) => s.id === app.acceptedSchoolId) ?? null : null;

	const invoicePaid = appInvoice?.status === "paid";
	const isProforma = appInvoice?.status === "proforma";
	const uncoveredSchools = appInvoice && !invoicePaid && appInvoice.status !== "void" ? Math.max(0, total - appInvoice.lines.length) : 0;
	const paidOn = invoicePaid && appInvoice?.payments?.length ? fmtDate(appInvoice.payments[appInvoice.payments.length - 1]?.at) : null;

	// The one sentence that says what moves this chapter — or, once the case
	// has moved past it, what closed it. A chapter behind the case never
	// says "next".
	const chapterPassed = JOURNEY_STAGES.indexOf(app.stage as JourneyStage) > JOURNEY_STAGES.indexOf("offer_letter_review");
	const next = (() => {
		if (acceptedSchool) return chapterPassed ? `Client accepted ${acceptedSchool.universityName ?? "an offer"} — the case has moved on.` : `Client accepted ${acceptedSchool.universityName ?? "an offer"} — Visa can open.`;
		if (chapterPassed) return "Closed without an accepted offer here — the case has moved on.";
		if (total === 0) return "No schools yet — add them here or the client picks them in the portal.";
		if (!feePaid) return "Application fee not paid — submissions start once it is paid.";
		if (preparing > 0) return `${preparing} to submit.`;
		if (awaiting > 0) return `Waiting on ${awaiting} decision${awaiting === 1 ? "" : "s"}.`;
		if (admitted > 0) return `All decisions in — ${admitted} admitted. Next: the client accepts an offer (here or in the portal), then Visa.`;
		if (waitlisted > 0) return "All decisions in — waitlisted only. Chase the school or add another.";
		return "All decisions in — no admission. Add another school or close the case.";
	})();

	// Raising and approving are two steps for everyone — a manager does both,
	// as two clicks and two history lines. The sheet opens on the preview's
	// suggested lines — the school list and the catalogue — editable before
	// anything is raised.
	const [raising, setRaising] = useState(false);
	const [raisePreview, setRaisePreview] = useState<{ lines: { label: string; detail: string; amountCents: number; schoolApplicationId: string | null }[]; outstandingDocuments: string[] } | null>(null);

	function openRaise() {
		setRaising(true);
		setRaisePreview(null);
		applicationInvoicePreview(app.id)
			.then(setRaisePreview)
			.catch((e) => {
				setRaising(false);
				fail(e, "Could not read the invoice preview");
			});
	}

	async function submitRaise(input: { lines: { label: string; detail?: string; amountCents: number; schoolApplicationId?: string | null }[]; note?: string }) {
		const { invoice, nothingDue } = await raiseApplicationInvoice(app.id, input);
		if (nothingDue || !invoice) {
			flash("No university application fees are due for these schools — submissions can start.");
			void refresh();
			return;
		}
		onInvoiceChanged(invoice);
		flash(canIssueInvoices ? `${invoice.invoiceNumber} raised — approve it to issue.` : `${invoice.invoiceNumber} raised — awaiting approval.`);
	}

	const schoolsCard = (
		<div className="card">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
				<p className="eyebrow" style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.75rem" }}>
					Schools
					{canWork && (
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setAdding(true)}>
							+ Add school
						</button>
					)}
				</p>
				<p className="text-xs" style={{ margin: 0, display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
					<span>
						{total} of {cap ?? "—"} in the package
					</span>
					{preparing > 0 && <span>{preparing} preparing</span>}
					{awaiting > 0 && <span>{awaiting} submitted</span>}
					{admitted > 0 && <span style={{ fontWeight: 700 }}>{admitted} admitted</span>}
					{waitlisted > 0 && <span>{waitlisted} waitlisted</span>}
					{unsuccessful > 0 && <span className="muted">{unsuccessful} unsuccessful</span>}
				</p>
			</div>
			<p className="text-sm mb-3">
				<span className="muted">{chapterPassed ? "Done · " : "Next · "}</span>
				{next}
			</p>

			{over && (
				<div style={{ border: "1px solid var(--foreground)", padding: "0.6rem 0.75rem", marginBottom: "0.75rem" }}>
					<span className="wf-badge wf-badge--warn">Over allowance</span>
					<p className="muted mt-1 text-xs">
						{total} schools against a {cap}-school package. Confirm the client has paid for the extra applications before submitting them.
					</p>
				</div>
			)}

			{total > 0 ? (
				<div className="cn-stack">
					{schools.map((s) => (
						<SchoolRow
							key={s.id}
							appId={app.appId}
							school={s}
							feePaid={feePaid}
							canWork={canWork}
							accepted={app.acceptedSchoolId === s.id}
							otherAccepted={Boolean(app.acceptedSchoolId) && app.acceptedSchoolId !== s.id}
							offerAcceptedAt={app.offerAcceptedAt}
							flash={flash}
							fail={fail}
						/>
					))}
				</div>
			) : (
				<p className="muted text-sm">No schools chosen yet.</p>
			)}
		</div>
	);

	return (
		<>
			{/* Application fee — always on, so the money story never disappears */}
			<div className="card">
				{appInvoiceLoading ? (
					<p className="muted text-sm">Loading invoice…</p>
				) : appInvoice ? (
					<InvoiceCard
						title="University application fees — paid on the client's behalf"
						invoice={appInvoice}
						compact={invoicePaid}
						hint={
							isProforma
								? canIssueInvoices
									? "Awaiting approval — the client cannot see or pay it until you issue it."
									: "Awaiting approval — the client cannot see or pay it until it is issued."
								: uncoveredSchools > 0
									? `${uncoveredSchools} school${uncoveredSchools === 1 ? " was" : "s were"} added after this invoice was raised — its lines do not cover ${uncoveredSchools === 1 ? "it" : "them"} yet.`
									: paidOn
										? `Paid ${paidOn} — school submissions are open.`
										: undefined
						}
						actions={
							canIssueInvoices ? (
								isProforma ? (
									<button type="button" className="btn btn--sm btn--primary" onClick={() => setApproving(appInvoice)}>
										Approve & issue
									</button>
								) : (
									<Link to={`/invoices?open=${appInvoice.id}`} className="btn btn--sm btn--ghost">
										Open in Billing →
									</Link>
								)
							) : undefined
						}
					/>
				) : feePaid ? (
					<>
						<p className="eyebrow mb-1">University application fees</p>
						<p className="text-sm--strong">Nothing due — submissions are open</p>
						<p className="muted text-xs">Either the chosen schools charge no application fee, or the fees were settled before invoicing moved here.</p>
					</>
				) : (
					<>
						<p className="eyebrow mb-1">University application fees</p>
						<p className="text-sm--strong">No invoice yet — {total === 0 ? "no schools chosen" : `${total} school${total === 1 ? "" : "s"} chosen`}</p>
						<p className="muted text-xs">
							Each school's own application fee, paid on the client's behalf at cost{catalogue?.items.some((i) => i.key === "extra_school" && i.active && i.amountCents > 0) ? ", plus the extra-school add-on beyond the package" : ""}.
							Raise it once the standard documents are verified; the client pays, then submissions start.
						</p>
						{canWork && (
							<div className="mt-3" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
								<button
									type="button"
									className="btn btn--sm btn--primary"
									onClick={openRaise}
									disabled={outstandingDocs.length > 0}
									title={outstandingDocs.length > 0 ? `Verify first: ${outstandingDocs.join(", ")}` : undefined}
								>
									Raise application invoice
								</button>
								{outstandingDocs.length > 0 && (
									<button type="button" className="btn btn--sm btn--ghost" onClick={() => setTab("documents")}>
										Verify documents first · {outstandingDocs.length} outstanding →
									</button>
								)}
							</div>
						)}
					</>
				)}
			</div>

			{/* Schools — locked behind the application invoice once it exists:
			    the list is the invoice's input, so it only gates after the
			    handler has raised it and until the client has paid. */}
			{appInvoice && !feePaid ? (
				<PaymentGate
					invoice={appInvoice}
					subject="School work"
					paid={feePaid}
					onApprove={canIssueInvoices ? (inv) => setApproving(inv) : undefined}
					onRecordPayment={canIssueInvoices ? () => setTab("payments") : undefined}
				>
					{schoolsCard}
				</PaymentGate>
			) : (
				schoolsCard
			)}

			<RaiseLinesSheet
				open={raising}
				title="Raise the application invoice"
				intro={`For ${app.applicantName} · ${app.appId}. The lines are the schools' own fees at cost — edit them before anything goes to approval. Raised awaiting approval; the client sees it once it is issued.`}
				suggested={raisePreview?.lines ?? null}
				sees={(totalCents) => `"University application fees" on their Payments page — ${fmtBoth(totalCents / 100)}, payable once issued.`}
				onRaise={submitRaise}
				onClose={() => setRaising(false)}
			/>

			<ApproveInvoiceSheet
				invoice={approving}
				onClose={() => setApproving(null)}
				onIssued={(updated) => {
					onInvoiceChanged(updated);
					flash(`${updated.invoiceNumber} issued — the client can now pay.`);
				}}
				onDeclined={(voided) => {
					onInvoiceChanged(voided);
					flash(`${voided.invoiceNumber} declined and voided.`);
				}}
			/>

			{adding && (
				<AddSchoolApplicationModal
					forApplicant={{ id: app.applicantId, name: app.applicantName }}
					onClose={() => setAdding(false)}
					onAdd={async (applicantId, destinationId, universityId, programId, intake) => {
						await addApplication(applicantId, { destinationId, universityId, programId, intake });
						await refresh();
						flash("School added — the draft invoice has a line for it.");
					}}
				/>
			)}
		</>
	);
}
