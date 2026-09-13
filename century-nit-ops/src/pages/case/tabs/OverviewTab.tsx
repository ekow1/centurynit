import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { applicantsApi } from "century-nit-core/api";
import { useCases } from "../../../hooks/useCases";

import type { MockApplication, MockConsultation } from "century-nit-core/ops";
import type { ApplicantProfile } from "century-nit-shared";

import type { Flash, Fail } from "./types";
import { branchName } from "century-nit-core/ops";
import { EditCaseSheet } from "../EditCaseSheet";

type Fact = { label: string; value: string };
type FactGroup = { title: string; facts: Fact[] };

const present = (v: string | null | undefined) => (v && v.trim() && v.trim() !== "-" ? v.trim() : null);
const fact = (label: string, value: string | null | undefined): Fact | null =>
	present(value) ? { label, value: present(value)! } : null;
const group = (title: string, facts: (Fact | null)[]): FactGroup | null => {
	const kept = facts.filter((f): f is Fact => f !== null);
	return kept.length ? { title, facts: kept } : null;
};

/** The applicant record's profile — the freshest copy of who the client is. */
function groupsFromProfile(p: ApplicantProfile): (FactGroup | null)[] {
	return [
		group("Identity", [
			fact("Nationality", p.nationality),
			fact("Residence", p.residence),
			fact("Date of birth", p.dob),
			fact("Gender", p.gender),
			fact("Address", p.address),
		]),
		group("Passport", [
			fact("Number", p.passportNumber),
			fact("Issuing country", p.passportCountry),
			fact("Issued", p.passportIssue),
			fact("Expiry", p.passportExpiry),
			fact("Previous refusals", p.previousRefusals),
		]),
		group("Academic", [
			fact("Degree", p.degree),
			fact("Institution", p.institution),
			fact("Field of study", p.fieldOfStudy),
			fact("GPA", p.gpa),
			fact("Graduated", p.gradYear),
		]),
		group("Work & language", [
			fact("Employment", p.employmentStatus),
			fact("Current role", p.currentRole),
			fact("Company", p.company),
			fact("Experience", p.experienceYears ? `${p.experienceYears} yrs` : null),
			fact("English test", p.englishTest),
			fact("English score", p.englishScore),
		]),
		group("Funding & sponsor", [
			fact("Funding source", p.fundingSource),
			fact("Budget", p.budget),
			fact("Sponsor", p.sponsorName),
			fact("Relationship", p.sponsorRelationship),
		]),
	];
}

/** Fallback when the applicant record isn't reachable — the consultation intake. */
function groupsFromConsultation(c: MockConsultation): (FactGroup | null)[] {
	return [
		group("Identity", [
			fact("Nationality", c.personal?.nationality),
			fact("Residence", c.personal?.residence),
			fact("Date of birth", c.personal?.dob),
		]),
		group("Passport", [
			fact("Number", c.passport?.number),
			fact("Expiry", c.passport?.expiry),
			fact("Previous refusals", c.passport?.previousRefusals),
		]),
		group("Academic", [
			fact("Degree", c.education?.degree),
			fact("Institution", c.education?.institution),
			fact("GPA", c.education?.gpa),
			fact("Graduated", c.education?.gradYear),
		]),
		group("Work & funding", [
			fact("Current role", c.employment?.currentRole),
			fact("Company", c.employment?.company),
			fact("Experience", c.employment?.experienceYears ? `${c.employment.experienceYears} yrs` : null),
			fact("Funding source", c.financial?.source),
			fact("Budget", c.financial?.budget),
		]),
	];
}


/** Overview — the case's facts, who the applicant is, and the staff handover notes. */
export function OverviewTab({ app, consultation, canWork, flash, fail }: { app: MockApplication; consultation: MockConsultation | null; canWork: boolean; flash: Flash; fail: Fail }) {
	const navigate = useNavigate();
	const { setApplicationNotes } = useCases();
	const [caseNotesDraft, setCaseNotesDraft] = useState("");
	const [editingCaseNotes, setEditingCaseNotes] = useState(false);
	const [savingCaseNotes, setSavingCaseNotes] = useState(false);
	const [editOpen, setEditOpen] = useState(false);

	// Who the client is. The applicant record is canonical; if the handler's
	// role can't reach it, the consultation intake carries the same fields.
	const [applicantRow, setApplicantRow] = useState<{ id: string; profile: ApplicantProfile | null } | null>(null);
	useEffect(() => {
		let alive = true;
		applicantsApi
			.get(app.applicantId)
			.then((row) => {
				if (alive) setApplicantRow({ id: app.applicantId, profile: row.profile ?? null });
			})
			.catch(() => {
				if (alive) setApplicantRow({ id: app.applicantId, profile: null });
			});
		return () => {
			alive = false;
		};
	}, [app.applicantId]);
	const profileLoading = applicantRow?.id !== app.applicantId;
	const apiGroups = applicantRow?.profile ? groupsFromProfile(applicantRow.profile) : [];
	const groups = (
		apiGroups.some(Boolean) || !consultation ? apiGroups : groupsFromConsultation(consultation)
	).filter((g): g is FactGroup => g !== null);
	return (
		<>
						{/* Target & Assignment */}
						<div className="card">
							<div className="cn-docs__head mb-3">
								<p className="eyebrow">Case facts</p>
								{canWork && (
									<button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditOpen(true)}>
										Edit case
									</button>
								)}
							</div>
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
							<EditCaseSheet app={app} open={editOpen} onClose={() => setEditOpen(false)} onDone={flash} />
						</div>
						{/* Who the client actually is — bio, passport, academic and sponsor facts. */}
						<div className="card">
							<p className="eyebrow mb-3">Applicant profile</p>
							{profileLoading ? (
								<p className="muted text-sm">Loading profile…</p>
							) : groups.length ? (
								<div className="cn-stack">
									{groups.map((g) => (
										<div key={g.title}>
											<p className="muted mb-1" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
												{g.title}
											</p>
											<div className="ops-grid cn-facts">
												{g.facts.map((f) => (
													<div key={f.label}>
														<p className="muted text-xs">{f.label}</p>
														<p>{f.value}</p>
													</div>
												))}
											</div>
										</div>
									))}
								</div>
							) : (
								<p className="muted text-sm">No profile details on file yet.</p>
							)}
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
