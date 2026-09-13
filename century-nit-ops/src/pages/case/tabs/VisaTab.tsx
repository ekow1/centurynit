import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "../../OpsAuthContext";
import { useCases } from "../../../hooks/useCases";
import { InvoiceCard, StatusPill } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import { getApplicationActivity, type ApiInvoice } from "../../../lib/api";
import type { Flash, Fail } from "./types";
import { VISA_STAGE_LABELS, type ApplicationActivityEvent, type StageHandoff, type VisaStage } from "century-nit-shared";
import { ArtifactCard } from "../ArtifactCard";

const VISA_STEPS: { id: VisaStage; label: string }[] = [
	{ id: "pending", label: VISA_STAGE_LABELS.pending },
	{ id: "biometrics", label: VISA_STAGE_LABELS.biometrics },
	{ id: "decision", label: VISA_STAGE_LABELS.decision },
	{ id: "complete", label: VISA_STAGE_LABELS.complete },
];
const VISA_ORDER: VisaStage[] = ["locked", "awaiting_handler", "pending", "biometrics", "decision", "complete"];


/** Visa — consent, fee, officer, the tracking steps, the decision, the note to the client. */
export function VisaTab({
	app,
	handoffs,
	visaApiInvoice,
	canIssueInvoices,
	flash,
	fail,
}: {
	app: MockApplication;
	handoffs: StageHandoff[];
	visaApiInvoice: ApiInvoice | null;
	canIssueInvoices: boolean;
	flash: Flash;
	fail: Fail;
}) {
	const { opsRole, hasPermission } = useOpsAuth();
	const { setVisaStage, setVisaCounselorNote } = useCases();
	const [noteDraft, setNoteDraft] = useState("");
	const [editingNote, setEditingNote] = useState(false);
	const [refusing, setRefusing] = useState(false);
	const [refusalReason, setRefusalReason] = useState("");

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
	function advanceVisa() {
		const cur = app.visaStage ?? "locked";
		if (cur === "awaiting_handler") return;
		const next = VISA_ORDER[VISA_ORDER.indexOf(cur) + 1];
		if (next) {
			setVisaStage(app.appId, next)
				.then(() => flash(`Visa tracking advanced to ${next}.`))
				.catch((e) => fail(e, "Could not advance visa stage"));
		}
	}
	function saveNote() {
		if (noteDraft.trim()) {
			setVisaCounselorNote(app.appId, noteDraft.trim());
			setEditingNote(false);
			setNoteDraft("");
		}
	}
	return (
		<>
			<div className="card">
				<p className="eyebrow mb-1">Visa consent</p>
				<p className="text-sm">
					{app.visaConsent?.decision === "continue"
						? "The applicant has consented to visa processing."
						: app.visaConsent?.decision === "hold"
							? "The applicant put the visa stage on hold."
							: app.visaConsent?.decision === "opt_out"
								? "The applicant opted out of visa processing."
								: "Awaiting the applicant's decision to continue with visa processing."}
				</p>
			</div>
{/* Visa invoice — the same card as every other invoice */}
			<div className="card">
				{visaApiInvoice ? (
					<InvoiceCard
						title="Visa invoice"
						invoice={visaApiInvoice}
						hint={visaApiInvoice.status === "proforma" ? "The applicant cannot pay until this is reviewed and issued." : undefined}
						actions={
							canIssueInvoices ? (
								<Link to={`/invoices?open=${visaApiInvoice.id}`} className="btn btn--sm btn--ghost">
									{visaApiInvoice.status === "proforma" ? "Review & issue" : "Open in Invoices →"}
								</Link>
							) : undefined
						}
					/>
				) : (
					<>
						<p className="eyebrow mb-1">Visa invoice</p>
						<p className="muted text-sm">
							{app.visaInvoicePaid
								? "Recorded as paid — record the real invoice in Invoices."
								: "Issued automatically when the applicant consents to the visa stage and a specialist is assigned."}
						</p>
					</>
				)}
			</div>

			{/* Visa Tracking Steps */}
						<div className="card">
							<p className="eyebrow mb-3">Visa Tracking</p>
							{app.visaStage === "awaiting_handler" ? (
								(() => {
									const handoff = handoffs.find(
										(h) => h.applicationId === app.id && h.status === "pending" && h.stage === "visa_processing",
									);
									const canResolve = opsRole === "manager" || opsRole === "coordinator" || opsRole === "admin" || opsRole === "super_admin";
									return (
										<div className="card" style={{ padding: "0.75rem 1rem" }}>
											<p className="eyebrow mb-1">Awaiting visa specialist</p>
											<p className="muted text-sm">
												The applicant is ready for visa processing. Assign a specialist to open tracking.
											</p>
											{handoff && canResolve ? (
												<p className="muted mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}>Pending assignment — resolve from the action band above.</p>
											) : (
												<p className="muted mt-2 text-xs">A manager or coordinator assigns the specialist.</p>
											)}
										</div>
									);
								})()
							) : (
								<>
								<div className="cn-stack">
								{VISA_STEPS.map((s, i) => {
									const curIdx = app.visaStage ? VISA_ORDER.indexOf(app.visaStage) : -1;
									const stepIdx = VISA_ORDER.indexOf(s.id);
									const done = curIdx >= stepIdx && app.visaStage !== "locked";
									const current = app.visaStage === s.id;
									return (
										<div
											key={s.id}
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.75rem",
												padding: "0.6rem 0.75rem",
												border: "1px solid var(--border-light)",
												opacity: done ? 1 : 0.5,
											}}
										>
											<span style={{
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
												borderColor: done || current ? "var(--foreground)" : "var(--border)",
												color: done ? "var(--background)" : current ? "var(--foreground)" : "var(--muted-foreground)",
												background: done ? "var(--foreground)" : "transparent",
											}}>
												{done ? "\u2713" : i + 1}
											</span>
											<div style={{ flex: 1 }}>
												<p className="text-sm--strong">{s.label}</p>
											</div>
											{current && s.id === "decision" ? (
												app.visaOutcome === "refused" ? (
													<>
														<StatusPill tone="blocked" dot>
															Refused
														</StatusPill>
														<button
															type="button"
															onClick={() =>
																void setVisaStage(app.appId, "pending")
																	.then(() => flash("Visa case reopened for reapplication."))
																	.catch((e) => fail(e, "Could not reopen the visa case"))
															}
															className="btn btn--ghost btn--sm"
														>
															Reopen for reapplication
														</button>
													</>
												) : (
													<>
														<button
															type="button"
															onClick={() =>
																void setVisaStage(app.appId, "complete", undefined, "approved")
																	.then(() => flash("Visa approved — the applicant can continue."))
																	.catch((e) => fail(e, "Could not record the decision"))
															}
															className="btn btn--primary btn--sm"
														>
															Approved
														</button>
														<button
															type="button"
															onClick={() => setRefusing(true)}
															className="btn btn--ghost btn--sm"
														>
															Refused
														</button>
													</>
												)
											) : (
												current &&
												app.visaStage !== "complete" && (
													<button
														type="button"
														onClick={() => advanceVisa()}
														className="btn btn--ghost btn--sm"
													>
														→ {VISA_STEPS[i + 1]?.label ?? "next"}
													</button>
												)
											)}
										</div>
									);
								})}
							</div>
							{/* Recording a refusal asks for the reason — it lands on the
							    timeline so the next attempt can see why the last one failed. */}
							{refusing && app.visaStage === "decision" && (
								<div className="mt-3" style={{ border: "1px solid var(--foreground)", padding: "0.75rem" }}>
									<p className="muted text-xs mb-1">Refusal reason — kept on record for the next attempt</p>
									<textarea
										className="input"
										rows={2}
										maxLength={2000}
										value={refusalReason}
										onChange={(e) => setRefusalReason(e.target.value)}
										placeholder="e.g. Insufficient ties to home country; missing financial evidence"
										autoFocus
									/>
									<div className="cn-assign__row mt-2">
										<button
											type="button"
											className="btn btn--primary btn--sm"
											disabled={!refusalReason.trim()}
											onClick={() =>
												void setVisaStage(app.appId, "decision", refusalReason.trim(), "refused")
													.then(() => {
														flash("Visa refusal recorded.");
														setRefusing(false);
														setRefusalReason("");
													})
													.catch((e) => fail(e, "Could not record the decision"))
											}
										>
											Record refusal
										</button>
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => { setRefusing(false); setRefusalReason(""); }}>
											Cancel
										</button>
									</div>
								</div>
							)}
							{/* Prior decisions survive a reopen — refusals stay on record. */}
							{decisions.length > 0 && (
								<div className="mt-3">
									<p className="muted mb-1" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
										Visa attempts
									</p>
									<div className="cn-stack">
										{[...decisions].reverse().map((e, i) => {
											const attemptNo = decisions.length - i;
											const refused = e.detail!.startsWith("Visa refused");
											const reason = e.detail!.split(" — ").slice(1).join(" — ").trim();
											return (
												<div
													key={e.id}
													style={{
														display: "flex",
														justifyContent: "space-between",
														alignItems: "center",
														gap: "0.75rem",
														padding: "0.5rem 0.75rem",
														border: "1px solid var(--border-light)",
													}}
												>
													<div>
														<p className="text-sm--strong">Attempt {attemptNo}</p>
														<p className="muted text-xs">
															{new Date(e.at).toLocaleDateString(undefined, { dateStyle: "medium" })}
															{e.actorName ? ` · ${e.actorName}` : ""}
														</p>
														{reason && <p className="muted text-xs">{reason}</p>}
													</div>
													<StatusPill tone={refused ? "blocked" : "done"} dot>
														{refused ? "Refused" : "Approved"}
													</StatusPill>
												</div>
											);
										})}
									</div>
								</div>
							)}
							</>
							)}
						</div>

						{/* Official artifact — uploaded on the client's behalf, lands in their vault. */}
						<ArtifactCard
							ownerUserId={app.applicantUserId}
							documentType="visa_receipt"
							title="Visa application receipt"
							hint="The embassy or VFS submission receipt — shared with the client via their document vault."
							canUpload={hasPermission("documents")}
						/>

						{/* Counselor Note */}
						<div className="card">
							<p className="eyebrow mb-2">Counselor Note</p>
							{app.visaCounselorNote && !editingNote ? (
								<div>
									<p style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{app.visaCounselorNote}</p>
									<button
										onClick={() => { setEditingNote(true); setNoteDraft(app.visaCounselorNote ?? ""); }}
										className="btn btn--ghost btn--sm"
										style={{ marginTop: "0.5rem", fontSize: "var(--text-xs)" }}
									>
										Edit note
									</button>
								</div>
							) : (
								<div>
									<textarea
										value={noteDraft}
										onChange={(e) => setNoteDraft(e.target.value)}
										placeholder="Add a counselor note..."
										rows={3}
										className="input"
										style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
									/>
									<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
										<button
											onClick={saveNote}
											className="btn btn--primary btn--sm"
											disabled={!noteDraft.trim()}
										>
											Save note
										</button>
										{editingNote && (
											<button
												onClick={() => { setEditingNote(false); setNoteDraft(""); }}
												className="btn btn--ghost btn--sm"
											>
												Cancel
											</button>
										)}
									</div>
								</div>
							)}
						</div>
		</>
	);
}
