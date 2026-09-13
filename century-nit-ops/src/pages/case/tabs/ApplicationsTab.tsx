import { useState } from "react";
import { Link } from "react-router-dom";

import { useCases } from "../../../hooks/useCases";
import { InvoiceCard, SchoolStatePill } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";
import type { Fail, Flash, TabId } from "./types";
import { schoolsApi } from "century-nit-core/api";
import {
	ALLOWED_DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,
	SCHOOL_OUTCOME_LABELS,
	SCHOOL_TRACK_STAGES,
	SCHOOL_TRACK_STATUS_LABELS,
	schoolDecisionNote,
	type SchoolApplication,
	type SchoolOutcome,
	type SchoolTrackStatus,
} from "century-nit-shared";
import { issueApplicationInvoice, raiseApplicationInvoice } from "../../../lib/api";

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
	flash,
	fail,
}: {
	appId: string;
	school: SchoolApplication;
	feePaid: boolean;
	canWork: boolean;
	flash: Flash;
	fail: Fail;
}) {
	const { updateSchoolApplication, refresh } = useCases();
	const decided = school.status === "Decision Reached";
	const admitted = decided && school.outcome === "Admitted";

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

	const [saving, setSaving] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [uploadPct, setUploadPct] = useState(0);
	const [showTimeline, setShowTimeline] = useState(false);

	const hasLetter = Boolean(school.offerLetterStorageKey || school.offerLetterUrl);
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

	async function upload(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
			fail(new Error("Upload a PDF, image (JPEG, PNG) or Word document."), "Unsupported file");
			return;
		}
		if (file.size > MAX_DOCUMENT_BYTES) {
			fail(new Error("That file is larger than 15 MB."), "File too large");
			return;
		}
		setUploading(true);
		setUploadPct(0);
		try {
			await schoolsApi.uploadAdmissionLetter(school.id, file, (p) => setUploadPct(p));
			await refresh();
			flash("Offer letter filed in the client's vault");
		} catch (err) {
			fail(err, "Could not upload the offer letter");
		} finally {
			setUploading(false);
		}
	}

	async function removeLetter() {
		setUploading(true);
		try {
			await schoolsApi.removeAdmissionLetter(school.id);
			await refresh();
			flash("Offer letter removed");
		} catch (err) {
			fail(err, "Could not remove the offer letter");
		} finally {
			setUploading(false);
		}
	}

	async function viewLetter() {
		try {
			const { url } = await schoolsApi.admissionLetterDownloadUrl(school.id);
			window.open(url, "_blank", "noopener");
		} catch (err) {
			fail(err, "Could not open the offer letter");
		}
	}

	const events = [...(school.events ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));

	return (
		<div
			style={{
				border: admitted ? "2px solid var(--foreground)" : "1px solid var(--border-light)",
				background: admitted ? "var(--muted)" : "transparent",
			}}
		>
			{/* Summary — the record */}
			<div style={{ padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
					<div>
						<p style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
							{school.universityName || school.universityId}
							<SchoolStatePill status={school.status} outcome={school.outcome} />
						</p>
						<p className="muted text-xs">
							{school.programName || school.programId} · {school.countryName || school.destinationId} · {school.intake}
						</p>
					</div>
					{canWork && !editing && (
						<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
							<button
								type="button"
								className="btn btn--sm btn--ghost"
								onClick={() => setEditing(true)}
								disabled={!feePaid}
								title={feePaid ? undefined : "Application fee not paid yet — school work starts once it is paid."}
							>
								{decided ? "Edit" : "Update"}
							</button>
						</div>
					)}
				</div>

				<p className="muted text-xs">
					{[
						addedAt && `Added ${addedAt}`,
						submittedAt && `Submitted ${submittedAt}`,
						decidedAt && `Decided ${decidedAt}`,
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
					{hasLetter && (
						<button type="button" className="btn btn--sm btn--ghost" onClick={viewLetter}>
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

			{/* Editor — folded under the record */}
			{editing && (
				<div
					style={{
						borderTop: "1px solid var(--border-light)",
						padding: "0.75rem",
						background: "var(--background)",
						display: "flex",
						flexDirection: "column",
						gap: "0.6rem",
						fontSize: "var(--text-xs)",
					}}
				>
					<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
						<select className="input input--sm" value={status} onChange={(e) => setStatus(e.target.value as SchoolTrackStatus)} style={{ width: "auto" }}>
							{SCHOOL_TRACK_STAGES.map((s) => (
								<option key={s} value={s}>
									{SCHOOL_TRACK_STATUS_LABELS[s]}
								</option>
							))}
						</select>
						{willDecide && (
							<select className="input input--sm" value={outcome} onChange={(e) => setOutcome(e.target.value as SchoolOutcome)} style={{ width: "auto" }}>
								{OUTCOMES.map((o) => (
									<option key={o} value={o}>
										{SCHOOL_OUTCOME_LABELS[o]}
									</option>
								))}
							</select>
						)}
						{movingBack && <span className="muted">← moving back</span>}
					</div>

					{movingBack && (
						<div>
							<p className="muted" style={{ marginBottom: "0.15rem" }}>
								Reason — recorded in the school's timeline
							</p>
							<input
								className="input input--sm"
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								placeholder="e.g. Submission bounced — missing transcript, resubmitting"
							/>
						</div>
					)}

					{willAdmit && (
						<div style={{ border: "1px solid var(--border-light)", padding: "0.6rem 0.75rem" }}>
							<p className="eyebrow" style={{ marginBottom: "0.5rem" }}>
								Offer terms · the client sees these with a deadline countdown
							</p>
							<div className="cn-facts">
								<label>
									<span className="muted">Tuition (USD)</span>
									<input className="input input--sm" inputMode="numeric" value={tuitionUsd} onChange={(e) => setTuitionUsd(e.target.value)} placeholder="28000" />
								</label>
								<label>
									<span className="muted">Tuition as written on the offer</span>
									<input className="input input--sm" value={tuitionLabel} onChange={(e) => setTuitionLabel(e.target.value)} placeholder="£22,500 per year" />
								</label>
								<label>
									<span className="muted">Deposit to hold the place (USD)</span>
									<input className="input input--sm" inputMode="numeric" value={depositUsd} onChange={(e) => setDepositUsd(e.target.value)} placeholder="2000" />
								</label>
								<label>
									<span className="muted">Deposit due</span>
									<input className="input input--sm" type="date" value={depositDue} onChange={(e) => setDepositDue(e.target.value)} />
								</label>
								<label>
									<span className="muted">Deposit paid on</span>
									<input className="input input--sm" type="date" value={depositPaid} onChange={(e) => setDepositPaid(e.target.value)} />
								</label>
							</div>

							<div style={{ marginTop: "0.6rem" }}>
								<p className="muted" style={{ marginBottom: "0.15rem" }}>
									Offer letter (PDF / image / Word) — filed in the client's vault and attached to the email
								</p>
								<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
									<input type="file" accept={ALLOWED_DOCUMENT_TYPES.join(",")} onChange={upload} disabled={uploading} className="text-xs" />
									{uploading ? (
										<span className="muted">Uploading… {uploadPct}%</span>
									) : hasLetter ? (
										<>
											<span style={{ fontWeight: 600 }}>✓ Letter on file</span>
											<button type="button" className="btn btn--ghost btn--sm" onClick={removeLetter}>
												Remove
											</button>
										</>
									) : null}
								</div>
							</div>
						</div>
					)}

					{willDecide && (
						<div>
							<p className="muted" style={{ marginBottom: "0.15rem" }}>
								Note to client (optional — blank uses the standard message)
							</p>
							<textarea
								className="input input--sm"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								rows={2}
								placeholder="Leave blank for the standard message, or write your own…"
							/>
							<p className="muted" style={{ margin: "0.4rem 0 0.15rem" }}>
								The client will see:
							</p>
							<div style={{ border: "1px solid var(--border-light)", padding: "0.5rem 0.6rem", whiteSpace: "pre-wrap" }}>{previewNote}</div>
							<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", marginTop: "0.5rem" }}>
								<input type="checkbox" checked={sendUpdateEmail} onChange={(e) => setSendUpdateEmail(e.target.checked)} />
								<span>Email the client this decision{willAdmit ? " (offer terms and letter included)" : ""}</span>
							</label>
						</div>
					)}

					<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(false)} disabled={saving}>
							Cancel
						</button>
						<button type="button" className="btn btn--sm btn--primary" onClick={save} disabled={saving}>
							{saving ? "Saving…" : "Save"}
						</button>
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
	const [issuing, setIssuing] = useState(false);

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

	const invoicePaid = appInvoice?.status === "paid";
	const isProforma = appInvoice?.status === "proforma";
	const uncoveredSchools = appInvoice && !invoicePaid && appInvoice.status !== "void" ? Math.max(0, total - appInvoice.lines.length) : 0;
	const paidOn = invoicePaid && appInvoice?.payments?.length ? fmtDate(appInvoice.payments[appInvoice.payments.length - 1]?.at) : null;

	// The one sentence that says what moves this chapter.
	const next = (() => {
		if (total === 0) return "No schools yet — the client chooses them in the portal.";
		if (!feePaid) return "Application fee not paid — submissions start once it is paid.";
		if (preparing > 0) return `${preparing} to submit.`;
		if (awaiting > 0) return `Waiting on ${awaiting} decision${awaiting === 1 ? "" : "s"}.`;
		if (admitted > 0) return `All decisions in — ${admitted} admitted. Next: the client accepts an offer, then Visa.`;
		if (waitlisted > 0) return "All decisions in — waitlisted only. Chase the school or add another.";
		return "All decisions in — no admission. Add another school or close the case.";
	})();

	function handleInvoice() {
		setIssuing(true);
		(canIssueInvoices ? issueApplicationInvoice(app.id) : raiseApplicationInvoice(app.id))
			.then((updated) => {
				onInvoiceChanged(updated);
				flash(
					updated.status === "proforma"
						? `Draft ${updated.invoiceNumber} raised — finance will review and issue it.`
						: `Invoice ${updated.invoiceNumber} issued — the client can now pay.`,
				);
			})
			.catch((e) => fail(e, "Could not raise the invoice"))
			.finally(() => setIssuing(false));
	}

	return (
		<>
			{/* Application fee — always on, so the money story never disappears */}
			<div className="card">
				{appInvoiceLoading ? (
					<p className="muted text-sm">Loading invoice…</p>
				) : appInvoice ? (
					<InvoiceCard
						title="Application fee"
						invoice={appInvoice}
						compact={invoicePaid}
						hint={
							isProforma
								? canIssueInvoices
									? "The client cannot pay until you review and issue this invoice."
									: "Raised — the client cannot pay until finance reviews and issues it."
								: uncoveredSchools > 0
									? `${uncoveredSchools} school${uncoveredSchools === 1 ? " was" : "s were"} added after this invoice was raised — its lines do not cover ${uncoveredSchools === 1 ? "it" : "them"} yet.`
									: paidOn
										? `Paid ${paidOn} — school submissions are open.`
										: undefined
						}
						actions={
							canIssueInvoices ? (
								<Link to={`/invoices?open=${appInvoice.id}`} className={`btn btn--sm ${isProforma ? "btn--primary" : "btn--ghost"}`}>
									{isProforma ? "Review & issue" : "Open in Money →"}
								</Link>
							) : undefined
						}
					/>
				) : feePaid ? (
					<>
						<p className="eyebrow mb-1">Application fee</p>
						<p className="text-sm--strong">Paid — recorded on the case</p>
						<p className="muted text-xs">No invoice is linked to this case; the fee was settled before invoicing moved here.</p>
					</>
				) : (
					<>
						<p className="eyebrow mb-1">Application fee</p>
						<p className="text-sm--strong">No invoice yet — {total === 0 ? "no schools chosen" : `${total} school${total === 1 ? "" : "s"} chosen`}</p>
						<p className="muted text-xs">One line per school. Raise it once the standard documents are verified; the client pays, then submissions start.</p>
						{canWork && (
							<div className="mt-3" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
								<button
									type="button"
									className="btn btn--sm btn--primary"
									onClick={handleInvoice}
									disabled={issuing || outstandingDocs.length > 0}
									title={outstandingDocs.length > 0 ? `Verify first: ${outstandingDocs.join(", ")}` : undefined}
								>
									{issuing ? (canIssueInvoices ? "Issuing…" : "Raising…") : canIssueInvoices ? "Issue application invoice" : "Raise application invoice"}
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

			{/* Schools */}
			<div className="card">
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
					<p className="eyebrow" style={{ margin: 0 }}>
						Schools
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
					<span className="muted">Next · </span>
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
							<SchoolRow key={s.id} appId={app.appId} school={s} feePaid={feePaid} canWork={canWork} flash={flash} fail={fail} />
						))}
					</div>
				) : (
					<p className="muted text-sm">No schools chosen yet.</p>
				)}
			</div>
		</>
	);
}
