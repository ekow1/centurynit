import { scopeLabel } from "century-nit-shared";
import { useNavigate } from "react-router-dom";

import type { MockApplication, MockConsultation } from "century-nit-core/ops";
import { useJoinMeeting } from "../ConsultationCall";


/** Consultation — the summary of the meeting this case was opened from, and the door to it. */
export function ConsultationTab({ app, consultation }: { app: MockApplication; consultation: MockConsultation }) {
	const navigate = useNavigate();
	const { join, joining, error: joinError, overlay } = useJoinMeeting();
	return (
		<>
			{overlay}
			<div className="card">
				<p className="eyebrow mb-2">Consultation {consultation.ref}</p>
				<div className="ops-grid cn-facts">
					<div><p className="muted text-xs">Officer</p><p>{consultation.assignedOfficer || "—"}</p></div>
					<div>
						<p className="muted text-xs">When</p>
						<p>
							{consultation.dateTime}
							{consultation.rescheduleRequestedAt && consultation.rescheduleRequestedStartsAt ? (
								<span className="muted">
									{" "}→ asked: {new Date(consultation.rescheduleRequestedStartsAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
								</span>
							) : null}
						</p>
					</div>
					<div><p className="muted text-xs">Type</p><p>{consultation.type}</p></div>
					<div><p className="muted text-xs">Status</p><p>{consultation.status}</p></div>
					<div><p className="muted text-xs">Target country</p><p>{consultation.targetCountry || "—"}</p></div>
					<div><p className="muted text-xs">Degree level</p><p>{consultation.goals?.degreeLevel || app.degreeLevel || "—"}</p></div>
					{consultation.meetingLink && (
						<div>
							<p className="muted text-xs">Meeting link</p>
							<p>
								{consultation.bookingId ? (
									<button type="button" className="link-arrow" disabled={joining} onClick={() => void join(consultation.bookingId!, `Consultation · ${consultation.ref}`)}>
										{joining ? "Joining…" : "Join meeting →"}
									</button>
								) : (
									<span className="muted">Saved on the case</span>
								)}
								{joinError && <span className="muted" style={{ marginLeft: "0.5rem" }}>{joinError}</span>}
							</p>
						</div>
					)}
				</div>
				<p style={{ fontSize: "var(--text-xs)", marginTop: "0.75rem" }}>
					<button type="button" className="link-arrow" onClick={() => navigate(`/consultations?id=${consultation.id}`)}>
						Open consultation →
					</button>
				</p>
			</div>
			<div className="card">
				<p className="eyebrow mb-2">Assessment & recommendation</p>
				{consultation.assessmentResult ? (
					<>
						<p className="text-sm--strong">{consultation.assessmentResult.outcome}</p>
						{consultation.assessmentResult.notes && (
							<p className="muted mt-1" style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{consultation.assessmentResult.notes}</p>
						)}
						<div className="ops-grid mt-3 cn-facts">
							<div><p className="muted text-xs">Recommended country</p><p>{consultation.assessmentResult.recCountry || "—"}</p></div>
							<div><p className="muted text-xs">Recommended university</p><p>{consultation.assessmentResult.recUniversity || "—"}</p></div>
							<div><p className="muted text-xs">Recommended programme</p><p>{consultation.assessmentResult.recProgram || "—"}</p></div>
							<div><p className="muted text-xs">Recommended package</p><p>{consultation.assessmentResult.recPackage || "—"}</p></div>
							<div><p className="muted text-xs">Recommended plan</p><p>{scopeLabel(consultation.assessmentResult.recStages?.length ? consultation.assessmentResult.recStages : null)}</p></div>
						</div>
					</>
				) : (
					<p className="muted text-sm">The assessment has not been completed yet.</p>
				)}
				{(consultation.requestedDocuments?.length ?? 0) > 0 && (
					<p className="muted mt-3 text-xs">
						Documents requested at consultation: {consultation.requestedDocuments!.join(", ")}
					</p>
				)}
			</div>
		</>
	);
}
