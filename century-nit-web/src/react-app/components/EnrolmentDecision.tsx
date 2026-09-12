import { useState } from "react";
import { meApi, ApiError } from "century-nit-core/api";
import { DECISION_LABELS, decisionOf } from "century-nit-shared";
import { StatusPill } from "century-nit-core/ui";
import { Button } from "./ui/Button";
import { useAppState } from "../context/AppState";
import { useNotifier } from "./notifier/Notifier";

/**
 * The first step of Enrolment: the client's one answer — Confirmed, On
 * hold, or Declined. Recorded as the application consent and mirrored on
 * the application (`proceedStatus`), which is what opens the case for a
 * consultant. Hold and decline take an optional reason; both can be
 * changed later from the same card.
 */
export function EnrolmentDecision({ onDecided }: { onDecided?: () => void }) {
	const { application, updateApplication, syncFromServer, refreshJourney } = useAppState();
	const { toast } = useNotifier();
	const [busy, setBusy] = useState(false);
	const [reasonFor, setReasonFor] = useState<"hold" | "opt_out" | null>(null);
	const [reason, setReason] = useState("");

	const current = decisionOf(application.applicationConsent?.decision ?? application.proceedStatus);

	async function decide(decision: "continue" | "hold" | "opt_out") {
		if (busy) return;
		setBusy(true);
		try {
			await meApi.consent("application", { decision, reason: reason.trim() || undefined });
			updateApplication({
				proceedStatus: decision === "continue" ? "accepted" : decision === "hold" ? "paused" : "declined",
				applicationConsent: { decision },
			});
			toast.success(
				decision === "continue"
					? "Enrolment confirmed. Choose your package and plan below."
					: decision === "hold"
						? "Your enrolment is on hold. Come back whenever you're ready."
						: "Noted — your enrolment is closed for this cycle. You can reopen it any time.",
			);
			setReasonFor(null);
			setReason("");
			onDecided?.();
			void Promise.all([syncFromServer(), refreshJourney()]);
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not record your decision. Please try again.");
		} finally {
			setBusy(false);
		}
	}

	if (current === "confirmed") {
		return (
			<div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
				<div>
					<StatusPill tone="done" dot>
						{DECISION_LABELS.confirmed}
					</StatusPill>
					<p className="muted mt-1" style={{ fontSize: "0.9rem", margin: 0 }}>
						You're enrolling with us. Choose your package and payment plan below.
					</p>
				</div>
				<Button type="button" variant="ghost" disabled={busy} onClick={() => setReasonFor("hold")}>
					Need time? Put on hold
				</Button>
				{reasonFor && <ReasonBox kind={reasonFor} reason={reason} setReason={setReason} busy={busy} onConfirm={() => decide(reasonFor)} onCancel={() => setReasonFor(null)} />}
			</div>
		);
	}

	if (current === "on_hold" || current === "declined") {
		return (
			<div>
				<div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
					<div>
						<StatusPill tone={current === "on_hold" ? "waiting" : "void"} dot>
							{DECISION_LABELS[current]}
						</StatusPill>
						<p className="muted mt-1" style={{ fontSize: "0.9rem", margin: 0 }}>
							{current === "on_hold"
								? "Your enrolment is on hold. Confirm when you're ready and we'll pick up where you left off."
								: "You closed your enrolment for this cycle. Confirm below if your plans change."}
						</p>
					</div>
					<div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
						<Button type="button" arrow disabled={busy} onClick={() => void decide("continue")}>
							{busy ? "Saving…" : "Confirm enrolment"}
						</Button>
						{current === "on_hold" && (
							<Button type="button" variant="ghost" disabled={busy} onClick={() => setReasonFor("opt_out")}>
								Decline
							</Button>
						)}
					</div>
				</div>
				{reasonFor && <ReasonBox kind={reasonFor} reason={reason} setReason={setReason} busy={busy} onConfirm={() => decide(reasonFor)} onCancel={() => setReasonFor(null)} />}
			</div>
		);
	}

	return (
		<div>
			<p className="muted" style={{ fontSize: "0.9rem" }}>
				Confirm that you're enrolling with Century NIT. This opens your case for a consultant; the package, plan and deposit follow below.
			</p>
			<div className="row mt-3" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
				<Button type="button" arrow disabled={busy} onClick={() => void decide("continue")}>
					{busy ? "Saving…" : "Confirm enrolment"}
				</Button>
				<Button type="button" variant="secondary" disabled={busy} onClick={() => setReasonFor("hold")}>
					Not now — put on hold
				</Button>
				<Button type="button" variant="ghost" disabled={busy} onClick={() => setReasonFor("opt_out")}>
					Decline
				</Button>
			</div>
			{reasonFor && <ReasonBox kind={reasonFor} reason={reason} setReason={setReason} busy={busy} onConfirm={() => decide(reasonFor)} onCancel={() => setReasonFor(null)} />}
		</div>
	);
}

function ReasonBox({
	kind,
	reason,
	setReason,
	busy,
	onConfirm,
	onCancel,
}: {
	kind: "hold" | "opt_out";
	reason: string;
	setReason: (v: string) => void;
	busy: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="card card--pad mt-3" style={{ width: "100%" }}>
			<p className="eyebrow">{kind === "hold" ? "On hold — reason (optional)" : "Decline — reason (optional)"}</p>
			<p className="muted mt-1" style={{ fontSize: "0.85rem" }}>
				{kind === "hold"
					? "Anything you need time for — exams, finances, a family discussion."
					: "Why you're closing your enrolment for this cycle."}
			</p>
			<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="input mt-2" placeholder="Optional…" style={{ width: "100%" }} />
			<div className="row mt-3" style={{ gap: "0.5rem" }}>
				<Button type="button" variant={kind === "hold" ? "primary" : "secondary"} disabled={busy} onClick={onConfirm}>
					{busy ? "Saving…" : kind === "hold" ? "Confirm hold" : "Confirm decline"}
				</Button>
				<Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}
