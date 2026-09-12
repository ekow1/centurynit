import { useEffect, useRef } from "react";
import { PORTAL_STAGE_ORDER, PORTAL_STEP, type PortalStepId } from "century-nit-shared";

export type JourneyStepStatus = "done" | "current" | "locked" | "skipped";

/**
 * The applicant's ladder, one step per portal stage, rendered from the
 * `stageStatuses` that `deriveJourney` returns. It is the spine of a case:
 * the portal shows it on the Journey page, the console shows it above every
 * case tab, and both read the same statuses, so the two screens never
 * disagree about where the applicant is.
 *
 * Fifteen steps do not fit a narrow pane, so the strip scrolls sideways and
 * keeps the current step in view. Steps use the short vocabulary; the full
 * label is the tooltip.
 */
export function JourneyStepper({
	stageStatuses,
	nextUnlock,
	onStep,
	compact = false,
}: {
	stageStatuses: Record<string, JourneyStepStatus>;
	/** What opens the next step, when the case is waiting on something. */
	nextUnlock?: string | null;
	/** Makes open steps clickable — the console jumps to that chapter's tab. */
	onStep?: (stage: PortalStepId) => void;
	/** Smaller markers and no unlock line, for list rows. */
	compact?: boolean;
}) {
	const currentRef = useRef<HTMLLIElement | null>(null);
	const steps = PORTAL_STAGE_ORDER.filter((id) => id !== "new") as PortalStepId[];
	const currentId = steps.find((id) => stageStatuses[id] === "current");

	useEffect(() => {
		currentRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
	}, [currentId]);

	return (
		<div className={`cn-stepper${compact ? " cn-stepper--compact" : ""}`}>
			<ol className="cn-stepper__track" aria-label="Applicant journey">
				{steps.map((id, i) => {
					const status = stageStatuses[id] ?? "locked";
					const clickable = Boolean(onStep) && status !== "locked";
					const label = PORTAL_STEP[id];
					return (
						<li
							key={id}
							ref={status === "current" ? currentRef : undefined}
							className={`cn-step cn-step--${status}${clickable ? " cn-step--clickable" : ""}`}
							aria-current={status === "current" ? "step" : undefined}
							title={`${label.label}${status === "skipped" ? " (skipped)" : status === "locked" ? " (locked)" : ""}`}
							onClick={clickable ? () => onStep?.(id) : undefined}
						>
							<span className="cn-step__marker" aria-hidden>
								{status === "done" ? "✓" : status === "skipped" ? "↷" : i + 1}
							</span>
							<span className="cn-step__label">{label.short}</span>
						</li>
					);
				})}
			</ol>
			{!compact && nextUnlock && (
				<p className="cn-stepper__next">
					<span className="cn-stepper__next-key">Next</span> {nextUnlock}
				</p>
			)}
		</div>
	);
}
