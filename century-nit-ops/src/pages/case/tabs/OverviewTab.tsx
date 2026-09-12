import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCases } from "../../../hooks/useCases";

import type { MockApplication } from "century-nit-core/ops";

import type { Flash, Fail } from "./types";
import { branchName } from "century-nit-core/ops";


/** Overview — the case's facts and the staff handover notes. */
export function OverviewTab({ app, flash, fail }: { app: MockApplication; flash: Flash; fail: Fail }) {
	const navigate = useNavigate();
	const { setApplicationNotes } = useCases();
	const [caseNotesDraft, setCaseNotesDraft] = useState("");
	const [editingCaseNotes, setEditingCaseNotes] = useState(false);
	const [savingCaseNotes, setSavingCaseNotes] = useState(false);
	return (
		<>
						{/* Target & Assignment */}
						<div className="card">
							<p className="eyebrow mb-3">Case facts</p>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<div><p className="muted text-xs">Branch</p><p>{branchName(app.branch)}</p></div>
								<div><p className="muted text-xs">Funding Track</p><p>{app.fundingTrack || "Not specified"}</p></div>
								<div><p className="muted text-xs">Target Schools</p><p>{app.targetSchoolCount ? `${app.targetSchoolCount} institution${app.targetSchoolCount === 1 ? "" : "s"}` : "Not specified"}</p></div>
								<div><p className="muted text-xs">Submitted Date</p><p>{app.submittedDate}</p></div>
								{app.applicationConsent && <div><p className="muted text-xs">Application Consent</p><p>{app.applicationConsent.decision === "continue" ? "✓ Continuing" : app.applicationConsent.decision}</p></div>}
								{app.visaConsent && <div><p className="muted text-xs">Visa Consent</p><p>{app.visaConsent.decision === "continue" ? "✓ Continuing" : app.visaConsent.decision}</p></div>}
							</div>
							{app.consultationId ? (
								<p style={{ fontSize: "var(--text-xs)", marginTop: "0.75rem" }}>
									<button
										type="button"
										className="link-arrow"
										onClick={() => navigate(`/consultations?id=${app.consultationId}`)}
									>
										← Opened from consultation {app.consultationNumber || app.consultationId.slice(0, 8).toUpperCase()}
									</button>
								</p>
							) : null}
						</div>
						{/* Staff notes — editable in place; the next handler reads these first. */}
						<div className="card">
							<div className="cn-docs__head">
								<p className="eyebrow">Staff case notes</p>
								{!editingCaseNotes && (
									<button
										type="button"
										className="btn btn--sm btn--ghost"
										onClick={() => {
											setCaseNotesDraft(app.notes ?? "");
											setEditingCaseNotes(true);
										}}
									>
										{app.notes ? "Edit" : "Add notes"}
									</button>
								)}
							</div>
							{editingCaseNotes ? (
								<form
									className="cn-assign"
									onSubmit={(e) => {
										e.preventDefault();
										setSavingCaseNotes(true);
										void setApplicationNotes(app.appId, caseNotesDraft.trim())
											.then(() => {
												setEditingCaseNotes(false);
												flash("Case notes saved.");
											})
											.catch((err) => fail(err, "Could not save notes"))
											.finally(() => setSavingCaseNotes(false));
									}}
								>
									<textarea
										className="input"
										rows={5}
										maxLength={4000}
										value={caseNotesDraft}
										onChange={(e) => setCaseNotesDraft(e.target.value)}
										placeholder="Context for whoever picks this case up next — what was agreed, what to watch for."
										autoFocus
									/>
									<div className="cn-assign__row">
										<button type="submit" className="btn btn--sm btn--primary" disabled={savingCaseNotes}>
											{savingCaseNotes ? "Saving…" : "Save notes"}
										</button>
										<button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditingCaseNotes(false)} disabled={savingCaseNotes}>
											Cancel
										</button>
									</div>
								</form>
							) : app.notes ? (
								<p className="cn-timeline__detail">{app.notes}</p>
							) : (
								<p className="muted cn-docs__meta">No notes yet.</p>
							)}
						</div>
		</>
	);
}
