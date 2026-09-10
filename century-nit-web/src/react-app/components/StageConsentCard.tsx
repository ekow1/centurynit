import { useState } from "react";
import { meApi } from "century-nit-core/api";
import { ApiError } from "century-nit-core/api";
import { useNotifier } from "../components/notifier/Notifier";

type StageConsentDecision = "pending" | "continue" | "hold" | "opt_out";

type Props = {
	/** Which stage this consent card is for. */
	stage: "application" | "visa" | "travel";
	/** Current consent decision (null when no record exists yet). */
	currentDecision: StageConsentDecision | null;
	/** Title shown in the card header. */
	title: string;
	/** Lead paragraph explaining what this stage is about. */
	lead: string;
	/** What happens if the applicant continues. */
	continueDetail: string;
	/** What happens if the applicant holds. */
	holdDetail: string;
	/** What happens if the applicant opts out. */
	optOutDetail: string;
	/** Callback after a successful consent submission (to refresh state). */
	onDecided?: () => void;
};

/**
 * Stage consent card — the applicant's explicit decision to start, hold, or
 * opt out of a major journey stage. Only "continue" sends the case to Ops for
 * handler assignment.
 */
export function StageConsentCard({
	stage,
	currentDecision,
	title,
	lead,
	continueDetail,
	holdDetail,
	optOutDetail,
	onDecided,
}: Props) {
	const { toast } = useNotifier();
	const [busy, setBusy] = useState(false);
	const [showReason, setShowReason] = useState<"hold" | "opt_out" | null>(null);
	const [reason, setReason] = useState("");

	// If the applicant has already decided, show the outcome instead of the
	// choice buttons.
	if (currentDecision === "continue") {
		return (
			<div className="card card--pad mb-4">
				<p className="display" style={{ fontSize: "1.25rem" }}>
					{title} — sent to Ops
				</p>
				<p className="muted mt-2">
					Your case has been sent to our team for handler assignment. You'll be notified
					when a handler is assigned and the invoice is ready for payment.
				</p>
			</div>
		);
	}

	if (currentDecision === "hold") {
		return (
			<div className="card card--pad mb-4">
				<p className="display" style={{ fontSize: "1.25rem" }}>
					{title} — on hold
				</p>
				<p className="muted mt-2">
					You've put this stage on hold. You can continue whenever you're ready.
				</p>
				<button
					type="button"
					className="btn btn--primary mt-3"
					disabled={busy}
					onClick={() => submit("continue")}
				>
					{busy ? "Resuming…" : "Resume now"}
				</button>
			</div>
		);
	}

	if (currentDecision === "opt_out") {
		return (
			<div className="card card--pad mb-4">
				<p className="display" style={{ fontSize: "1.25rem" }}>
					{title} — opted out
				</p>
				<p className="muted mt-2">
					You've opted out of this stage. Contact us if you change your mind.
				</p>
				<button
					type="button"
					className="btn btn--ghost mt-3"
					disabled={busy}
					onClick={() => submit("continue")}
				>
					{busy ? "Resuming…" : "Continue with this stage"}
				</button>
			</div>
		);
	}

	// No decision yet — show the choice buttons.
	async function submit(decision: "continue" | "hold" | "opt_out") {
		setBusy(true);
		try {
			await meApi.consent(stage, { decision, reason: reason || undefined });
			toast.success(
				decision === "continue"
					? "Your case has been sent to our team."
					: decision === "hold"
						? "This stage is on hold."
						: "You've opted out of this stage.",
			);
			setShowReason(null);
			setReason("");
			onDecided?.();
		} catch (err) {
			toast.error(
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: "Could not submit your decision. Please try again.",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="card card--pad mb-4">
			<p className="eyebrow">Your decision</p>
			<h2 className="page-title mt-1">{title}</h2>
			<p className="lead mt-2">{lead}</p>

			<div className="portal-grid portal-grid--3 mt-3">
				<div className="card card--pad card--bordered">
					<p className="display" style={{ fontSize: "1.05rem" }}>
						Continue
					</p>
					<p className="muted mt-1" style={{ fontSize: "0.875rem" }}>
						{continueDetail}
					</p>
					<button
						type="button"
						className="btn btn--primary mt-3"
						disabled={busy}
						onClick={() => submit("continue")}
					>
						{busy ? "Sending…" : "Yes, continue"}
					</button>
				</div>

				<div className="card card--pad card--bordered">
					<p className="display" style={{ fontSize: "1.05rem" }}>
						Hold on
					</p>
					<p className="muted mt-1" style={{ fontSize: "0.875rem" }}>
						{holdDetail}
					</p>
					<button
						type="button"
						className="btn btn--ghost mt-3"
						disabled={busy}
						onClick={() => setShowReason("hold")}
					>
						Hold on
					</button>
				</div>

				<div className="card card--pad card--bordered">
					<p className="display" style={{ fontSize: "1.05rem" }}>
						Opt out
					</p>
					<p className="muted mt-1" style={{ fontSize: "0.875rem" }}>
						{optOutDetail}
					</p>
					<button
						type="button"
						className="btn btn--ghost btn--danger mt-3"
						disabled={busy}
						onClick={() => setShowReason("opt_out")}
					>
						Opt out
					</button>
				</div>
			</div>

			{showReason && (
				<div className="card card--pad card--bordered mt-3">
					<label className="field">
						<span className="field-label">
							{showReason === "hold" ? "Reason for holding (optional)" : "Reason for opting out (optional)"}
						</span>
						<textarea
							className="input"
							rows={3}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder={
								showReason === "hold"
									? "Tell us why you're holding (optional)"
									: "Tell us why you're opting out (optional)"
							}
						/>
					</label>
					<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
						<button
							type="button"
							className="btn btn--primary btn--sm"
							disabled={busy}
							onClick={() => submit(showReason)}
						>
							{busy ? "Submitting…" : `Confirm ${showReason === "hold" ? "hold" : "opt out"}`}
						</button>
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							disabled={busy}
							onClick={() => {
								setShowReason(null);
								setReason("");
							}}
						>
							Cancel
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
