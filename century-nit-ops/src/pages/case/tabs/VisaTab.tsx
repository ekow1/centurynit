import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "../../OpsAuthContext";
import { useCases } from "../../../hooks/useCases";
import { InvoiceCard, Sheet, StatusPill } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import { getApplicationActivity, type ApiInvoice } from "../../../lib/api";
import type { Flash, Fail, TabId } from "./types";
import { VISA_STAGE_LABELS, type ApplicationActivityEvent, type StageHandoff, type VisaDetails, type VisaStage } from "century-nit-shared";
import { ArtifactCard } from "../ArtifactCard";
import { ApproveInvoiceSheet } from "../ApproveInvoiceSheet";

/**
 * Visa — the fee, the officer, then the application as a set of milestones
 * with their facts: lodged (type, reference, date), appointment (when,
 * where), biometrics (date), decision (date, outcome, validity), collected.
 * Each milestone is recorded through a small sheet that writes the facts
 * and moves the stage in one call, so the case history reads as a timeline
 * and the client sees the same dates in the portal.
 */

const VISA_ORDER: VisaStage[] = ["locked", "awaiting_handler", "pending", "biometrics", "decision", "complete"];

const VISA_TYPES = ["UK Student visa", "Canada study permit", "US F-1 student visa", "Australia student visa (subclass 500)", "Ireland study visa", "Germany national visa (study)", "Schengen study visa"];

function fmtDate(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}
function fmtDateTime(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function dateInputValue(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function dateTimeInputValue(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** yyyy-mm-dd → ISO at midday UTC (keeps the calendar day in every zone); null when cleared. */
function dateToIso(value: string): string | null {
	return value ? new Date(`${value}T12:00:00Z`).toISOString() : null;
}
function dateTimeToIso(value: string): string | null {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const today = () => new Date().toISOString().slice(0, 10);

type SheetId = "lodged" | "appointment" | "biometrics" | "decision" | "collected" | "back";

/* ── Milestone row ──────────────────────────────────────────────────────── */

function Milestone({
	n,
	title,
	state,
	facts,
	action,
}: {
	n: number;
	title: string;
	state: "done" | "current" | "todo" | "blocked";
	facts: (string | null | false | undefined)[];
	action?: React.ReactNode;
}) {
	const shown = facts.filter(Boolean) as string[];
	return (
		<div
			style={{
				display: "flex",
				alignItems: "flex-start",
				gap: "0.75rem",
				padding: "0.6rem 0.75rem",
				border: state === "current" ? "1px solid var(--foreground)" : "1px solid var(--border-light)",
				opacity: state === "todo" ? 0.6 : 1,
			}}
		>
			<span
				style={{
					width: "28px",
					height: "28px",
					flexShrink: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontSize: "0.72rem",
					fontWeight: 700,
					fontFamily: "var(--font-mono)",
					border: "2px solid",
					borderColor: state === "todo" ? "var(--border)" : state === "blocked" ? "var(--danger, #b91c1c)" : "var(--foreground)",
					color: state === "done" ? "var(--background)" : state === "blocked" ? "var(--danger, #b91c1c)" : "var(--foreground)",
					background: state === "done" ? "var(--foreground)" : "transparent",
				}}
			>
				{state === "done" ? "✓" : state === "blocked" ? "!" : n}
			</span>
			<div style={{ flex: 1, minWidth: 0 }}>
				<p className="text-sm--strong">{title}</p>
				{shown.length > 0 && <p className="muted text-xs">{shown.join(" · ")}</p>}
			</div>
			{action && <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>{action}</div>}
		</div>
	);
}

/* ── The tab ────────────────────────────────────────────────────────────── */

export function VisaTab({
	app,
	handoffs,
	visaApiInvoice,
	canIssueInvoices,
	canWork,
	setTab,
	onAssign,
	onInvoicesChanged,
	flash,
	fail,
}: {
	app: MockApplication;
	handoffs: StageHandoff[];
	visaApiInvoice: ApiInvoice | null;
	canIssueInvoices: boolean;
	canWork: boolean;
	setTab: (t: TabId) => void;
	/** Opens the case's assignment sheet — for the awaiting-officer state. */
	onAssign: () => void;
	/** An invoice was issued or voided here; the parent reloads the case's invoices. */
	onInvoicesChanged: () => void;
	flash: Flash;
	fail: Fail;
}) {
	const [approving, setApproving] = useState<ApiInvoice | null>(null);
	const { hasPermission } = useOpsAuth();
	const { setVisaStage, setVisaDetails, setVisaCounselorNote } = useCases();
	const d: VisaDetails = app.visaDetails ?? {};
	const stage = app.visaStage ?? "locked";
	const idx = VISA_ORDER.indexOf(stage);
	const refused = stage === "decision" && app.visaOutcome === "refused";
	const approved = stage === "complete";
	const open = idx >= VISA_ORDER.indexOf("pending");

	const [sheet, setSheet] = useState<SheetId | null>(null);
	const [busy, setBusy] = useState(false);

	// Sheet drafts — seeded from the facts when a sheet opens.
	const [visaType, setVisaType] = useState("");
	const [reference, setReference] = useState("");
	const [submittedAt, setSubmittedAt] = useState("");
	const [appointmentAt, setAppointmentAt] = useState("");
	const [appointmentCentre, setAppointmentCentre] = useState("");
	const [biometricsAt, setBiometricsAt] = useState("");
	const [decidedAt, setDecidedAt] = useState("");
	const [outcome, setOutcome] = useState<"approved" | "refused">("approved");
	const [validFrom, setValidFrom] = useState("");
	const [validTo, setValidTo] = useState("");
	const [refusalReason, setRefusalReason] = useState("");
	const [collectedAt, setCollectedAt] = useState("");
	const [backTo, setBackTo] = useState<VisaStage>("pending");
	const [backReason, setBackReason] = useState("");

	function openSheet(id: SheetId) {
		setVisaType(d.visaType ?? "");
		setReference(d.reference ?? "");
		setSubmittedAt(dateInputValue(d.submittedAt) || today());
		setAppointmentAt(dateTimeInputValue(d.appointmentAt));
		setAppointmentCentre(d.appointmentCentre ?? "");
		setBiometricsAt(dateInputValue(d.biometricsAt) || today());
		setDecidedAt(dateInputValue(d.decidedAt) || today());
		setOutcome("approved");
		setValidFrom(dateInputValue(d.validFrom));
		setValidTo(dateInputValue(d.validTo));
		setRefusalReason("");
		setCollectedAt(dateInputValue(d.collectedAt) || today());
		setBackTo(stage === "complete" ? "decision" : stage === "decision" ? "biometrics" : "pending");
		setBackReason("");
		setSheet(id);
	}

	async function run(label: string, work: () => Promise<unknown>, fallback: string) {
		setBusy(true);
		try {
			await work();
			flash(label);
			setSheet(null);
		} catch (e) {
			fail(e, fallback);
		} finally {
			setBusy(false);
		}
	}

	// Note to the client — shown in the portal's visa hub.
	const [noteDraft, setNoteDraft] = useState("");
	const [editingNote, setEditingNote] = useState(false);
	async function saveNote() {
		if (!noteDraft.trim()) return;
		try {
			await setVisaCounselorNote(app.appId, noteDraft.trim());
			flash("Note to client saved");
			setEditingNote(false);
			setNoteDraft("");
		} catch (e) {
			fail(e, "Could not save the note");
		}
	}

	// Visa decisions are written to the case timeline as status comments
	// ("Visa refused" / "Visa approved"). Reading them back gives the attempts
	// log — a reopened case keeps its earlier refusals visible.
	const [activityFor, setActivityFor] = useState<{ id: string; events: ApplicationActivityEvent[] } | null>(null);
	useEffect(() => {
		let alive = true;
		getApplicationActivity(app.id)
			.then((res) => {
				if (alive) setActivityFor({ id: app.id, events: res.events });
			})
			.catch(() => {
				if (alive) setActivityFor({ id: app.id, events: [] });
			});
		return () => {
			alive = false;
		};
	}, [app.id, app.visaStage, app.visaOutcome]);
	const decisions = (activityFor?.id === app.id ? activityFor.events : [])
		.filter((e) => typeof e.detail === "string" && /^Visa (refused|approved)/.test(e.detail))
		.sort((a, b) => a.at.localeCompare(b.at));

	const consent = app.visaConsent?.decision;
	const consentLine =
		consent === "continue"
			? "Client confirmed visa processing"
			: consent === "hold"
				? "Client put the visa chapter on hold"
				: consent === "opt_out"
					? "Client opted out of visa processing"
					: "Awaiting the client's decision to continue";

	const docs = app.visaDocumentChecklist ?? [];
	const docsVerified = docs.filter((x) => x.status === "VERIFIED").length;

	const pendingHandoff = handoffs.find((h) => h.applicationId === app.id && h.status === "pending" && h.stage === "visa_processing");
	const work = canWork && open;
	const stateOf = (step: VisaStage): "done" | "current" | "todo" | "blocked" => {
		const s = VISA_ORDER.indexOf(step);
		if (step === "decision" && refused) return "blocked";
		if (idx > s) return "done";
		if (idx === s) return "current";
		return "todo";
	};

	return (
		<>
			{/* Visa fee — the same card as every other invoice */}
			<div className="card">
				{visaApiInvoice ? (
					<InvoiceCard
						title="Visa fee"
						invoice={visaApiInvoice}
						compact={visaApiInvoice.status === "paid"}
						hint={visaApiInvoice.status === "proforma" ? "Awaiting approval — the client cannot see or pay it until it is issued." : undefined}
						actions={
							canIssueInvoices ? (
								visaApiInvoice.status === "proforma" ? (
									<button type="button" className="btn btn--sm btn--primary" onClick={() => setApproving(visaApiInvoice)}>
										Approve & issue
									</button>
								) : (
									<Link to={`/invoices?open=${visaApiInvoice.id}`} className="btn btn--sm btn--ghost">
										Open in Money →
									</Link>
								)
							) : undefined
						}
					/>
				) : (
					<>
						<p className="eyebrow mb-1">Visa fee</p>
						<p className="muted text-sm">
							{app.visaInvoicePaid
								? "Recorded as paid — no invoice is linked to this case."
								: "Raised automatically when the client confirms the visa chapter and an officer is assigned."}
						</p>
					</>
				)}
			</div>

			{/* The application, milestone by milestone */}
			<div className="card">
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
					<p className="eyebrow" style={{ margin: 0 }}>
						Visa application
					</p>
					<p className="text-xs" style={{ margin: 0, display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
						<span className="muted">{consentLine}</span>
						<StatusPill tone={approved ? "done" : refused ? "blocked" : open ? "current" : stage === "awaiting_handler" ? "waiting" : "neutral"} dot>
							{refused ? "Refused" : VISA_STAGE_LABELS[stage]}
						</StatusPill>
					</p>
				</div>

				{stage === "locked" && (
					<p className="muted text-sm mb-3">
						Opens once the visa fee is paid{consent !== "continue" ? " and the client confirms the chapter" : ""}.
					</p>
				)}
				{stage === "awaiting_handler" && (
					<div style={{ border: "1px solid var(--foreground)", padding: "0.6rem 0.75rem" }} className="mb-3">
						<p className="text-sm--strong">Awaiting a visa officer</p>
						<p className="muted text-xs">The client is ready; tracking opens once an officer is assigned.</p>
						{pendingHandoff && (
							<button type="button" className="btn btn--sm btn--primary mt-2" onClick={onAssign}>
								Assign visa officer
							</button>
						)}
					</div>
				)}

				<div className="cn-stack">
					<Milestone
						n={1}
						title="Lodged"
						state={stateOf("pending")}
						facts={[d.visaType, d.reference && `Ref ${d.reference}`, d.submittedAt && `Submitted ${fmtDate(d.submittedAt)}`]}
						action={
							work && (
								<button type="button" className="btn btn--sm btn--ghost" onClick={() => openSheet("lodged")}>
									{d.reference || d.submittedAt ? "Edit" : "Record application"}
								</button>
							)
						}
					/>
					<Milestone
						n={2}
						title="Appointment & biometrics"
						state={stateOf("biometrics")}
						facts={[
							d.appointmentAt && `Appointment ${fmtDateTime(d.appointmentAt)}`,
							d.appointmentCentre,
							d.biometricsAt && `Biometrics given ${fmtDate(d.biometricsAt)}`,
						]}
						action={
							work && (
								<>
									{stage === "pending" && (
										<button type="button" className="btn btn--sm btn--ghost" onClick={() => openSheet("appointment")}>
											{d.appointmentAt ? "Change appointment" : "Book appointment"}
										</button>
									)}
									{stage === "pending" && (
										<button type="button" className="btn btn--sm btn--primary" onClick={() => openSheet("biometrics")}>
											Biometrics done
										</button>
									)}
								</>
							)
						}
					/>
					<Milestone
						n={3}
						title="Decision"
						state={stateOf("decision")}
						facts={[
							d.decidedAt && `Decided ${fmtDate(d.decidedAt)}`,
							refused && "Refused — see the attempt below",
							approved && (d.validFrom || d.validTo) && `Valid ${fmtDate(d.validFrom) ?? "…"} → ${fmtDate(d.validTo) ?? "…"}`,
						]}
						action={
							work && (
								<>
									{stage === "biometrics" && (
										<button type="button" className="btn btn--sm btn--primary" onClick={() => openSheet("decision")}>
											Record decision
										</button>
									)}
									{stage === "decision" && !refused && (
										<button type="button" className="btn btn--sm btn--primary" onClick={() => openSheet("decision")}>
											Record decision
										</button>
									)}
									{refused && (
										<button
											type="button"
											className="btn btn--sm btn--ghost"
											disabled={busy}
											onClick={() =>
												run(
													"Visa case reopened for reapplication",
													() => setVisaStage(app.appId, "pending", undefined, undefined, { decidedAt: null, validFrom: null, validTo: null }),
													"Could not reopen the visa case",
												)
											}
										>
											Reopen for reapplication
										</button>
									)}
								</>
							)
						}
					/>
					<Milestone
						n={4}
						title="Approved & collected"
						state={approved ? (d.collectedAt ? "done" : "current") : "todo"}
						facts={[approved && !d.collectedAt && "Passport / permit not collected yet", d.collectedAt && `Collected ${fmtDate(d.collectedAt)}`]}
						action={
							work &&
							approved && (
								<button type="button" className="btn btn--sm btn--ghost" onClick={() => openSheet("collected")}>
									{d.collectedAt ? "Edit" : "Collected"}
								</button>
							)
						}
					/>
				</div>

				{work && idx > VISA_ORDER.indexOf("pending") && (
					<div className="mt-2" style={{ textAlign: "right" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => openSheet("back")}>
							← Move back
						</button>
					</div>
				)}

				{/* Prior decisions survive a reopen — refusals stay on record. */}
				{decisions.length > 0 && (
					<div className="mt-3">
						<p className="muted mb-1" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
							Attempts
						</p>
						<div className="cn-stack">
							{[...decisions].reverse().map((e, i) => {
								const attemptNo = decisions.length - i;
								const wasRefused = e.detail!.startsWith("Visa refused");
								const reason = e.detail!.split("\n")[0].split(" — ").slice(1).join(" — ").trim();
								return (
									<div
										key={e.id}
										style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.75rem", border: "1px solid var(--border-light)" }}
									>
										<div>
											<p className="text-sm--strong">Attempt {attemptNo}</p>
											<p className="muted text-xs">
												{fmtDate(e.at)}
												{e.actorName ? ` · ${e.actorName}` : ""}
											</p>
											{reason && <p className="muted text-xs">{reason}</p>}
										</div>
										<StatusPill tone={wasRefused ? "blocked" : "done"} dot>
											{wasRefused ? "Refused" : "Approved"}
										</StatusPill>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>

			{/* The visa document set — verified on the Documents tab */}
			{docs.length > 0 && (
				<div className="card">
					<div className="cn-docs__head">
						<p className="eyebrow">Visa documents</p>
						<StatusPill tone={docsVerified === docs.length ? "done" : "waiting"} dot>
							{docsVerified}/{docs.length} verified
						</StatusPill>
					</div>
					<p className="muted cn-docs__meta">What the application is built from. The client uploads to their vault; verify on the Documents tab.</p>
					<ul className="cn-docs__requested">
						{docs.map((x) => (
							<li key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "baseline" }}>
								<span title={x.hint}>{x.name}</span>
								<StatusPill tone={x.status === "VERIFIED" ? "done" : x.status === "UPLOADED" ? "waiting" : x.status === "REJECTED" ? "blocked" : "neutral"}>
									{x.status === "VERIFIED" ? "Verified" : x.status === "UPLOADED" ? "To review" : x.status === "REJECTED" ? "Rejected" : "Not uploaded"}
								</StatusPill>
							</li>
						))}
					</ul>
					<button type="button" className="btn btn--sm btn--ghost mt-2" onClick={() => setTab("documents")}>
						Open Documents →
					</button>
				</div>
			)}

			{/* Official artifact — uploaded on the client's behalf, lands in their vault. */}
			<ArtifactCard
				ownerUserId={app.applicantUserId}
				documentType="visa_receipt"
				title="Visa application receipt"
				hint="The embassy or VFS submission receipt — shared with the client via their document vault."
				canUpload={hasPermission("documents")}
			/>

			{/* Note to the client — what their visa hub says */}
			<div className="card">
				<p className="eyebrow mb-2">Note to client</p>
				{app.visaCounselorNote && !editingNote ? (
					<div>
						<p style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{app.visaCounselorNote}</p>
						{canWork && (
							<button
								type="button"
								onClick={() => {
									setEditingNote(true);
									setNoteDraft(app.visaCounselorNote ?? "");
								}}
								className="btn btn--ghost btn--sm mt-2"
							>
								Edit note
							</button>
						)}
					</div>
				) : canWork ? (
					<div>
						<textarea
							value={noteDraft}
							onChange={(e) => setNoteDraft(e.target.value)}
							placeholder="What the client should know or do next — shown in their visa hub…"
							rows={3}
							className="input"
							style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
						/>
						<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
							<button type="button" onClick={saveNote} className="btn btn--primary btn--sm" disabled={!noteDraft.trim()}>
								Save note
							</button>
							{editingNote && (
								<button
									type="button"
									onClick={() => {
										setEditingNote(false);
										setNoteDraft("");
									}}
									className="btn btn--ghost btn--sm"
								>
									Cancel
								</button>
							)}
						</div>
					</div>
				) : (
					<p className="muted text-sm">No note yet.</p>
				)}
			</div>

			{/* ── Sheets ──────────────────────────────────────────────────────── */}

			<ApproveInvoiceSheet
				invoice={approving}
				onClose={() => setApproving(null)}
				onIssued={(updated) => {
					onInvoicesChanged();
					flash(`${updated.invoiceNumber} issued — the client can now pay.`);
				}}
				onDeclined={(voided) => {
					onInvoicesChanged();
					flash(`${voided.invoiceNumber} declined and voided.`);
				}}
			/>

			<Sheet open={sheet === "lodged"} onClose={() => setSheet(null)} title="Visa application">
				<div className="cn-stack">
					<label>
						<span className="muted text-xs">Visa type</span>
						<input className="input input--sm" list="visa-types" value={visaType} onChange={(e) => setVisaType(e.target.value)} placeholder="UK Student visa" />
						<datalist id="visa-types">
							{VISA_TYPES.map((t) => (
								<option key={t} value={t} />
							))}
						</datalist>
					</label>
					<label>
						<span className="muted text-xs">Authority reference (GWF / UCI / SEVIS / application number)</span>
						<input className="input input--sm" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="GWF012345678" />
					</label>
					<label>
						<span className="muted text-xs">Submitted on</span>
						<input className="input input--sm" type="date" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
					</label>
					<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSheet(null)} disabled={busy}>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn--sm btn--primary"
							disabled={busy}
							onClick={() =>
								run(
									"Visa application recorded",
									() => setVisaDetails(app.appId, { visaType: visaType.trim() || null, reference: reference.trim() || null, submittedAt: dateToIso(submittedAt) }),
									"Could not record the application",
								)
							}
						>
							{busy ? "Saving…" : "Save"}
						</button>
					</div>
				</div>
			</Sheet>

			<Sheet open={sheet === "appointment"} onClose={() => setSheet(null)} title="Visa appointment">
				<div className="cn-stack">
					<p className="muted text-sm">The client sees the date and the centre in their visa hub and gets a notification.</p>
					<label>
						<span className="muted text-xs">When</span>
						<input className="input input--sm" type="datetime-local" value={appointmentAt} onChange={(e) => setAppointmentAt(e.target.value)} />
					</label>
					<label>
						<span className="muted text-xs">Where (centre)</span>
						<input className="input input--sm" value={appointmentCentre} onChange={(e) => setAppointmentCentre(e.target.value)} placeholder="VFS Global, Accra" />
					</label>
					<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSheet(null)} disabled={busy}>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn--sm btn--primary"
							disabled={busy || !appointmentAt}
							onClick={() =>
								run(
									"Appointment recorded — client notified",
									() => setVisaDetails(app.appId, { appointmentAt: dateTimeToIso(appointmentAt), appointmentCentre: appointmentCentre.trim() || null }),
									"Could not record the appointment",
								)
							}
						>
							{busy ? "Saving…" : "Save"}
						</button>
					</div>
				</div>
			</Sheet>

			<Sheet open={sheet === "biometrics"} onClose={() => setSheet(null)} title="Biometrics done">
				<div className="cn-stack">
					<label>
						<span className="muted text-xs">Biometrics given on</span>
						<input className="input input--sm" type="date" value={biometricsAt} onChange={(e) => setBiometricsAt(e.target.value)} />
					</label>
					<p className="muted text-xs">Moves the visa to “{VISA_STAGE_LABELS.biometrics}” — the case now waits on the authority.</p>
					<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSheet(null)} disabled={busy}>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn--sm btn--primary"
							disabled={busy || !biometricsAt}
							onClick={() =>
								run(
									"Biometrics recorded — awaiting the decision",
									() => setVisaStage(app.appId, "biometrics", undefined, undefined, { biometricsAt: dateToIso(biometricsAt) }),
									"Could not record biometrics",
								)
							}
						>
							{busy ? "Saving…" : "Save"}
						</button>
					</div>
				</div>
			</Sheet>

			<Sheet open={sheet === "decision"} onClose={() => setSheet(null)} title="Visa decision">
				<div className="cn-stack">
					<div style={{ display: "flex", gap: "0.5rem" }}>
						<button type="button" className={`btn btn--sm ${outcome === "approved" ? "btn--primary" : "btn--ghost"}`} onClick={() => setOutcome("approved")}>
							Approved
						</button>
						<button type="button" className={`btn btn--sm ${outcome === "refused" ? "btn--primary" : "btn--ghost"}`} onClick={() => setOutcome("refused")}>
							Refused
						</button>
					</div>
					<label>
						<span className="muted text-xs">Decision received on</span>
						<input className="input input--sm" type="date" value={decidedAt} onChange={(e) => setDecidedAt(e.target.value)} />
					</label>
					{outcome === "approved" ? (
						<div className="cn-facts">
							<label>
								<span className="muted text-xs">Valid from</span>
								<input className="input input--sm" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
							</label>
							<label>
								<span className="muted text-xs">Valid to</span>
								<input className="input input--sm" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
							</label>
						</div>
					) : (
						<label>
							<span className="muted text-xs">Refusal reason — kept on record for the next attempt</span>
							<textarea
								className="input"
								rows={2}
								maxLength={2000}
								value={refusalReason}
								onChange={(e) => setRefusalReason(e.target.value)}
								placeholder="e.g. Insufficient ties to home country; missing financial evidence"
							/>
						</label>
					)}
					<p className="muted text-xs">
						{outcome === "approved" ? "Approval opens Departure — the client is told and the pre-departure fee falls due." : "The case stays at Decision; reopen it for a reapplication when the client is ready."}
					</p>
					<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSheet(null)} disabled={busy}>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn--sm btn--primary"
							disabled={busy || !decidedAt || (outcome === "refused" && !refusalReason.trim())}
							onClick={() =>
								outcome === "approved"
									? run(
											"Visa approved — the client can continue to Departure",
											() =>
												setVisaStage(app.appId, "complete", undefined, "approved", {
													decidedAt: dateToIso(decidedAt),
													validFrom: dateToIso(validFrom),
													validTo: dateToIso(validTo),
												}),
											"Could not record the decision",
										)
									: run(
											"Visa refusal recorded",
											() => setVisaStage(app.appId, "decision", refusalReason.trim(), "refused", { decidedAt: dateToIso(decidedAt) }),
											"Could not record the decision",
										)
							}
						>
							{busy ? "Saving…" : outcome === "approved" ? "Record approval" : "Record refusal"}
						</button>
					</div>
				</div>
			</Sheet>

			<Sheet open={sheet === "collected"} onClose={() => setSheet(null)} title="Passport / permit collected">
				<div className="cn-stack">
					<label>
						<span className="muted text-xs">Collected on</span>
						<input className="input input--sm" type="date" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} />
					</label>
					<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSheet(null)} disabled={busy}>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn--sm btn--primary"
							disabled={busy || !collectedAt}
							onClick={() => run("Collection recorded", () => setVisaDetails(app.appId, { collectedAt: dateToIso(collectedAt) }), "Could not record collection")}
						>
							{busy ? "Saving…" : "Save"}
						</button>
					</div>
				</div>
			</Sheet>

			<Sheet open={sheet === "back"} onClose={() => setSheet(null)} title="Move the visa back">
				<div className="cn-stack">
					<label>
						<span className="muted text-xs">Back to</span>
						<select className="input input--sm" value={backTo} onChange={(e) => setBackTo(e.target.value as VisaStage)}>
							{(["pending", "biometrics", "decision"] as VisaStage[])
								.filter((s) => VISA_ORDER.indexOf(s) < idx)
								.map((s) => (
									<option key={s} value={s}>
										{VISA_STAGE_LABELS[s]}
									</option>
								))}
						</select>
					</label>
					<label>
						<span className="muted text-xs">Reason — goes in the case history</span>
						<input className="input input--sm" value={backReason} onChange={(e) => setBackReason(e.target.value)} placeholder="e.g. Appointment rescheduled by the centre" />
					</label>
					<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSheet(null)} disabled={busy}>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn--sm btn--primary"
							disabled={busy || !backReason.trim()}
							onClick={() => run(`Visa moved back to ${VISA_STAGE_LABELS[backTo]}`, () => setVisaStage(app.appId, backTo, backReason.trim()), "Could not move the visa back")}
						>
							{busy ? "Saving…" : "Move back"}
						</button>
					</div>
				</div>
			</Sheet>
		</>
	);
}
