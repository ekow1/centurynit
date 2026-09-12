import { JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";
import type { MockApplication } from "century-nit-core/ops";
import type { StageHandoff } from "century-nit-shared";
import { useCases } from "../../hooks/useCases";
import { handoffOffersKeep } from "../../lib/pendingTasks";
import { AssignSheet } from "./AssignSheet";

/**
 * What an application is waiting on, assignment-wise: a pending stage
 * handoff (resolved by keep / reassign), or no whole-case handler at all.
 * Null when nobody needs to act — the chip on the queue card and the
 * header's button both read this so they agree.
 */
export function assignmentNeeded(
	app: MockApplication,
	handoffs: StageHandoff[],
): { kind: "handoff"; handoff: StageHandoff } | { kind: "owner" } | null {
	const handoff = handoffs.find((h) => h.applicationId === app.id && h.status === "pending");
	if (handoff) return { kind: "handoff", handoff };
	if (!app.assignedStaff) return { kind: "owner" };
	return null;
}

function whyHandoff(h: StageHandoff): string {
	const stageLabel = JOURNEY_STAGE_LABELS[h.stage as JourneyStage] ?? h.stage;
	return h.source === "deposit_payment"
		? "10% deposit received — this case needs a handler before school selection can proceed."
		: h.source === "visa_payment" || h.source === "visa_consent_continue"
			? "The applicant is ready for visa processing — assign a visa specialist."
			: h.source === "offboarding"
				? "The previous handler has left — this stage needs a new owner."
				: `This case needs a handler for ${stageLabel}.`;
}

/**
 * The assignment sheet for an application. Resolves the pending stage
 * handoff when there is one (visa specialist, travel desk, a replacement
 * after offboarding), otherwise sets or changes the whole-case handler.
 * Opened from the case header and from the queue cards.
 */
export function ApplicationAssignSheet({
	app,
	open,
	onClose,
	onDone,
}: {
	app: MockApplication;
	open: boolean;
	onClose: () => void;
	/** Called with a one-line confirmation after a successful change. */
	onDone?: (message: string) => void;
}) {
	const { assignees, handoffs, resolveHandoff, assignApplication } = useCases();
	const need = assignmentNeeded(app, handoffs);
	const handoff = need?.kind === "handoff" ? need.handoff : null;

	return (
		<AssignSheet
			open={open}
			onClose={onClose}
			title={
				handoff
					? `Assign · ${JOURNEY_STAGE_LABELS[handoff.stage as JourneyStage] ?? handoff.stage}`
					: app.assignedStaff
						? "Change handler"
						: "Assign handler"
			}
			stage={handoff ? handoff.stage : "school_submission"}
			staff={assignees}
			branch={app.branch}
			currentName={handoff ? null : app.assignedStaff || null}
			keepName={handoff && handoffOffersKeep(handoff) ? handoff.fromOpsUserName : null}
			withReason={Boolean(handoff)}
			why={handoff ? whyHandoff(handoff) : null}
			onAssign={async (opsUserId, reason) => {
				if (handoff) {
					await resolveHandoff(handoff.id, "assign", { opsUserId, reason });
				} else {
					const to = assignees.find((a) => a.opsUserId === opsUserId);
					if (!to) throw new Error("That staff member is no longer available");
					await assignApplication(app.id, to);
				}
				onDone?.("Handler assigned.");
			}}
			onKeep={
				handoff
					? async (reason) => {
							await resolveHandoff(handoff.id, "keep", { reason });
							onDone?.("Handler kept.");
						}
					: undefined
			}
		/>
	);
}

/**
 * The "Assign" chip on a queue card — present only when the case is
 * waiting on an assignment and the viewer may make one. Stops the click so
 * the row underneath does not also open.
 */
export function AssignChip({ label = "Assign", onClick }: { label?: string; onClick: () => void }) {
	return (
		<button
			type="button"
			className="cn-row__assign"
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			onKeyDown={(e) => e.stopPropagation()}
		>
			{label}
		</button>
	);
}
