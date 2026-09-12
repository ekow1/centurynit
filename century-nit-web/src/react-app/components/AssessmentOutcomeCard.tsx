import { useState, useEffect } from "react";
import { StatusPill } from "century-nit-core/ui";
import { useNavigate } from "react-router-dom";
import { meApi, ApiError } from "century-nit-core/api";
import { Button } from "./ui/Button";
import { useAppState } from "../context/AppState";
import { useNotifier } from "./notifier/Notifier";

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
	onDecided?: () => void;
};

export function AssessmentOutcomeCard({
	outcome,
	notes,
	recommendations,
	currentDecision,
	onDecided,
}: Props) {
	const { updateApplication, syncFromServer, refreshJourney, booking } = useAppState();
	const { toast } = useNotifier();
	const navigate = useNavigate();

	const [serverRec, setServerRec] = useState<AssessmentResultData | null>(null);
	const [busy, setBusy] = useState(false);
	const [showReason, setShowReason] = useState<"hold" | "opt_out" | null>(null);
	const [reason, setReason] = useState("");

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

	const effectiveDecision = currentDecision ?? null;

	async function submitDecision(decision: "continue" | "hold" | "opt_out", optionalReason?: string) {
		setBusy(true);
		try {
			await meApi.consent("application", {
				decision,
				reason: optionalReason || reason || undefined,
			});

			if (decision === "continue") {
				// `consent("application", continue)` already opens the
				// application server-side (proceedStatus → accepted); there is
				// no separate "proceed" call to make.
				const mappedTrack = effectivePackage
					? effectivePackage.toLowerCase().includes("non")
						? "non_scholarship"
						: effectivePackage.toLowerCase().includes("hybrid")
							? "hybrid"
							: effectivePackage.toLowerCase().includes("scholarship")
								? "scholarship"
								: undefined
					: undefined;
				updateApplication({
					proceedStatus: "accepted",
					applicationConsent: {
						decision: "continue",
					},
					...(mappedTrack ? { schoolFundingTrack: mappedTrack as any } : {}),
				});
				toast.success("Decision recorded! Opening your school package…");
				setShowReason(null);
				setReason("");
				if (onDecided) onDecided();
				void Promise.all([syncFromServer(), refreshJourney()]);
				navigate("/portal/package");
				return;
			} else if (decision === "hold") {
				updateApplication({
					proceedStatus: "paused",
					applicationConsent: {
						decision: "hold",
					},
				});
				toast.success("Application placed on hold. Take all the time you need.");
			} else if (decision === "opt_out") {
				updateApplication({
					proceedStatus: "declined",
					applicationConsent: {
						decision: "opt_out",
					},
				});
				toast.success("You have opted out of this application cycle.");
			}

			setShowReason(null);
			setReason("");
			if (onDecided) onDecided();
			void Promise.all([syncFromServer(), refreshJourney()]);
		} catch (err) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Could not save your decision. Please try again.";
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	}

	const hasRecs = Boolean(
		effectiveCountry ||
		effectiveUniversity ||
		effectiveProgram ||
		effectivePackage,
	);

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

			{/* Decision & Action Buttons Section beneath recommendations */}
			<div
				className="mt-4 pt-3"
				style={{ borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "0.75rem" }}
			>
				{showReason ? (
					<div className="card card--pad" style={{ background: "rgba(0,0,0,0.02)" }}>
						<p className="eyebrow">
							{showReason === "hold" ? "Hold on — reason (optional)" : "Opt out — reason (optional)"}
						</p>
						<p className="muted mt-1" style={{ fontSize: "0.85rem" }}>
							{showReason === "hold"
								? "Let us know if there's anything specific you need time for (e.g. exams, finances, family discussion)."
								: "Please let us know why you are choosing to close your application for this cycle."}
						</p>
						<textarea
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							rows={2}
							className="input mt-2"
							placeholder="Optional notes…"
							style={{ width: "100%", fontSize: "0.9rem" }}
						/>
						<div className="row mt-3" style={{ gap: "0.5rem" }}>
							<Button
								type="button"
								variant={showReason === "hold" ? "primary" : "secondary"}
								disabled={busy}
								onClick={() => submitDecision(showReason)}
							>
								{busy ? "Saving…" : showReason === "hold" ? "Confirm Hold" : "Confirm Opt Out"}
							</Button>
							<Button
								type="button"
								variant="ghost"
								disabled={busy}
								onClick={() => {
									setShowReason(null);
									setReason("");
								}}
							>
								Cancel
							</Button>
						</div>
					</div>
				) : effectiveDecision === "continue" ? (
					<div>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								flexWrap: "wrap",
								gap: "0.75rem",
							}}
						>
							<div>
								<span
									className="portal-pill portal-pill--verified mb-1"
									style={{ fontSize: "0.75rem", display: "inline-block" }}
								>
									✓ Application Confirmed
								</span>
								<p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
									You have decided to proceed with your application. Proceed to select your school package.
								</p>
							</div>
							<div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
								<Button to="/portal/package" arrow>
									Next · School Package →
								</Button>
								<Button
									type="button"
									variant="ghost"
									disabled={busy}
									onClick={() => setShowReason("hold")}
									style={{ fontSize: "0.85rem" }}
								>
									Need time? Put on hold
								</Button>
							</div>
						</div>
					</div>
				) : effectiveDecision === "hold" ? (
					<div style={{ background: "rgba(245, 158, 11, 0.05)", padding: "0.85rem", borderRadius: "8px" }}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								flexWrap: "wrap",
								gap: "0.75rem",
							}}
						>
							<div>
								<span
									className="portal-pill portal-pill--needs_info mb-1"
									style={{ fontSize: "0.75rem", display: "inline-block" }}
								>
									Application on Hold
								</span>
								<p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
									Your application is currently on hold. Take all the time you need. When you are ready, continue below.
								</p>
							</div>
							<div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
								<Button
									type="button"
									arrow
									disabled={busy}
									onClick={() => submitDecision("continue")}
								>
									{busy ? "Continuing…" : "Resume & Continue to Package →"}
								</Button>
								<Button
									type="button"
									variant="ghost"
									disabled={busy}
									onClick={() => setShowReason("opt_out")}
								>
									Opt Out
								</Button>
							</div>
						</div>
					</div>
				) : effectiveDecision === "opt_out" ? (
					<div style={{ background: "rgba(107, 114, 128, 0.05)", padding: "0.85rem", borderRadius: "8px" }}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								flexWrap: "wrap",
								gap: "0.75rem",
							}}
						>
							<div>
								<span className="portal-pill mb-1" style={{ fontSize: "0.75rem", display: "inline-block" }}>
									Application Closed for This Cycle
								</span>
								<p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
									You chose to opt out of this cycle. If your plans change, you can resume at any time.
								</p>
							</div>
							<Button
								type="button"
								variant="secondary"
								disabled={busy}
								onClick={() => submitDecision("continue")}
							>
								{busy ? "Resuming…" : "Change Mind & Resume"}
							</Button>
						</div>
					</div>
				) : (
					<div>
						<p className="muted mb-3" style={{ fontSize: "0.9rem" }}>
							Confirm whether you want to proceed with your application to configure your school package:
						</p>
						<div
							style={{
								display: "flex",
								gap: "0.75rem",
								flexWrap: "wrap",
								alignItems: "center",
							}}
						>
							<Button
								type="button"
								arrow
								disabled={busy}
								onClick={() => submitDecision("continue")}
							>
								{busy ? "Saving…" : "Continue to School Package →"}
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={busy}
								onClick={() => setShowReason("hold")}
							>
								Hold on / Need time
							</Button>
							<Button
								type="button"
								variant="ghost"
								disabled={busy}
								onClick={() => setShowReason("opt_out")}
							>
								Opt out
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
