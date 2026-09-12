import { useState, useEffect } from "react";
import { StatusPill } from "century-nit-core/ui";
import { meApi } from "century-nit-core/api";
import { DECISION_LABELS, decisionOf } from "century-nit-shared";
import { Button } from "./ui/Button";
import { useAppState } from "../context/AppState";

export type AssessmentResultData = {
	outcome?: string | null;
	notes?: string | null;
	recCountry?: string | null;
	recUniversity?: string | null;
	recProgram?: string | null;
	recPackage?: string | null;
};

type Props = {
	outcome?: string | null;
	notes?: string | null;
	recommendations?: {
		country?: string | null;
		university?: string | null;
		program?: string | null;
		package?: string | null;
	} | null;
	currentDecision?: "continue" | "hold" | "opt_out" | "pending" | null;
	/** Kept for callers; the decision is now taken on the Enrolment page. */
	onDecided?: () => void;
};

export function AssessmentOutcomeCard({
	outcome,
	notes,
	recommendations,
	currentDecision,
}: Props) {
	const { booking } = useAppState();

	const [serverRec, setServerRec] = useState<AssessmentResultData | null>(null);

	useEffect(() => {
		meApi.application()
			.then((res) => {
				if (res.consultation?.assessmentResult) {
					setServerRec(res.consultation.assessmentResult);
				}
			})
			.catch(() => {});
	}, []);

	const clean = (val?: string | null) => (val && val.trim().length > 0 ? val.trim() : null);

	const effectiveOutcome = clean(outcome) || clean(serverRec?.outcome) || clean(booking.eligibilityOutcome) || "Eligible";
	const effectiveNotes = clean(notes) || clean(serverRec?.notes) || clean(booking.eligibilityNote) || null;

	const effectiveCountry = clean(recommendations?.country) || clean(serverRec?.recCountry) || clean(booking.assessmentResult?.recCountry) || null;
	const effectiveUniversity = clean(recommendations?.university) || clean(serverRec?.recUniversity) || clean(booking.assessmentResult?.recUniversity) || null;
	const effectiveProgram = clean(recommendations?.program) || clean(serverRec?.recProgram) || clean(booking.assessmentResult?.recProgram) || null;
	const effectivePackage = clean(recommendations?.package) || clean(serverRec?.recPackage) || clean(booking.assessmentResult?.recPackage) || null;

	const isEligible =
		effectiveOutcome?.toLowerCase() === "eligible" ||
		effectiveOutcome?.toLowerCase().includes("conditional");

	const decision = decisionOf(currentDecision);

	const hasRecs = Boolean(effectiveCountry || effectiveUniversity || effectiveProgram || effectivePackage);

	const formatPkg = (pkg?: string | null) => {
		if (!pkg) return null;
		if (pkg === "scholarship") return "Scholarship Track";
		if (pkg === "hybrid") return "Hybrid Track (Partial Award)";
		if (pkg === "non_scholarship") return "Non-Scholarship Track";
		return pkg.charAt(0).toUpperCase() + pkg.slice(1).replace(/_/g, " ");
	};

	return (
		<div className={`card card--pad mb-4 cn-outcome${isEligible ? " cn-outcome--eligible" : ""}`}>
			<div className="cn-outcome__head">
				<div>
					<span className="eyebrow">Official assessment result</span>
					<h3 className="display mt-1 cn-outcome__title">Assessment outcome &amp; recommendation</h3>
				</div>
				<StatusPill tone={isEligible ? "done" : "current"} dot>
					{effectiveOutcome || "Eligible"}
				</StatusPill>
			</div>

			{effectiveNotes && (
				<div className="mt-3">
					<p className="eyebrow mb-1">Assessment notes</p>
					<p className="cn-outcome__notes">{effectiveNotes}</p>
				</div>
			)}

			{hasRecs && (
				<dl className="cn-outcome__recs">
					{effectiveCountry && (
						<div className="cn-outcome__rec">
							<dt>Destination</dt>
							<dd>{effectiveCountry}</dd>
						</div>
					)}
					{effectiveUniversity && (
						<div className="cn-outcome__rec">
							<dt>Institution</dt>
							<dd>{effectiveUniversity}</dd>
						</div>
					)}
					{effectiveProgram && (
						<div className="cn-outcome__rec">
							<dt>Programme</dt>
							<dd>{effectiveProgram}</dd>
						</div>
					)}
					{effectivePackage && (
						<div className="cn-outcome__rec cn-outcome__rec--package">
							<dt>Package</dt>
							<dd>{formatPkg(effectivePackage)}</dd>
						</div>
					)}
				</dl>
			)}

			{/* The decision itself is the first step of Enrolment — one place,
				one triple (Confirmed · On hold · Declined). Here: where it stands
				and the door to that chapter. */}
			<div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
				{!isEligible ? (
					<p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
						Your consultant will discuss the next options with you.
					</p>
				) : (
					<div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
						<div>
							{decision ? (
								<StatusPill tone={decision === "confirmed" ? "done" : decision === "on_hold" ? "waiting" : "void"} dot>
									Enrolment · {DECISION_LABELS[decision]}
								</StatusPill>
							) : (
								<StatusPill tone="current" dot>
									Next · Enrolment
								</StatusPill>
							)}
							<p className="muted mt-1" style={{ fontSize: "0.9rem", margin: 0 }}>
								{decision === "confirmed"
									? "You're enrolled. Continue with your package, plan and deposit."
									: decision === "on_hold"
										? "Your enrolment is on hold — resume whenever you're ready."
										: decision === "declined"
											? "You closed your enrolment for this cycle. You can reopen it any time."
											: "Confirm your enrolment, choose your package and payment plan, and pay the deposit — all on one page."}
							</p>
						</div>
						<Button to="/portal/package" arrow>
							{decision === "confirmed" ? "Continue enrolment →" : "Go to Enrolment →"}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
