import { useState } from "react";
import { STAGE_INTAKE, SERVICE_STAGE_LABELS, type ServiceStage } from "century-nit-shared";
import { meApi } from "century-nit-core/api";
import { useAppState } from "../../context/AppState";
import { useNotifier } from "../notifier/Notifier";
import { Button } from "../ui/Button";

/**
 * The questions a stage asks when the client continued into it after
 * completion — the same fields an entrant gave at assessment, replayed
 * where the work actually needs them. Renders only when this stage was
 * added by an approved continuation and its answers aren't on file.
 */
export function StageIntakeCard({ stage }: { stage: Exclude<ServiceStage, "admissions"> }) {
	const { application, syncFromServer } = useAppState();
	const { toast } = useNotifier();
	const pack = STAGE_INTAKE[stage];
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);

	const continued = application.lastContinuation?.status === "approved" && application.lastContinuation.stage === stage;
	const answered = Boolean(application.stageIntake?.[stage] && Object.keys(application.stageIntake[stage]).length > 0);
	if (!continued || answered) return null;

	const visible = pack.fields.filter((f) => !f.showIf || answers[f.showIf.id] === f.showIf.equals);

	async function submit() {
		setBusy(true);
		try {
			await meApi.submitStageIntake({ stage, answers });
			toast.success("Sent — your officer has the details.");
			await syncFromServer();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Could not send the intake");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="sharp-card">
			<p className="eyebrow">Your {SERVICE_STAGE_LABELS[stage]} intake</p>
			<p className="lead mt-2" style={{ fontSize: "var(--text-sm)" }}>
				You joined this stage after your file closed, so we never asked these at booking. A few answers now — your
				documents sit in the checklist as usual.
			</p>
			<div className="mt-4" style={{ display: "grid", gap: "0.9rem" }}>
				{visible.map((f) => (
					<div key={f.id}>
						<label className="mono" style={{ fontSize: "0.7rem", display: "block", marginBottom: "0.35rem" }}>
							{f.label.toUpperCase()}
						</label>
						{f.kind === "yesno" ? (
							<div className="row" style={{ gap: "0.5rem" }}>
								{["yes", "no"].map((v) => (
									<button
										key={v}
										type="button"
										className={`btn btn--sm ${answers[f.id] === v ? "btn--primary" : "btn--ghost"}`}
										onClick={() => setAnswers((a) => ({ ...a, [f.id]: v }))}
									>
										{v === "yes" ? "Yes" : "No"}
									</button>
								))}
							</div>
						) : (
							<input
								className="input"
								type={f.kind === "number" ? "number" : "text"}
								value={answers[f.id] ?? ""}
								onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
							/>
						)}
						{f.hint ? <p className="mono muted" style={{ fontSize: "0.65rem", marginTop: "0.25rem" }}>{f.hint}</p> : null}
					</div>
				))}
			</div>
			<div className="row mt-4">
				<Button onClick={() => void submit()} disabled={busy}>
					{busy ? "Sending…" : "Send to your officer"}
				</Button>
			</div>
		</div>
	);
}
