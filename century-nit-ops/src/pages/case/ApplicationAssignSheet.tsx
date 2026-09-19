import { JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";
import type { MockApplication } from "century-nit-core/ops";
import type { StageHandoff } from "century-nit-shared";
import { useCases } from "../../hooks/useCases";
import { caseHandlerName, handoffOffersKeep } from "../../lib/pendingTasks";
import { AssignSheet } from "./AssignSheet";

/**
 * What an application is waiting on, handler-wise: a pending stage
 * handoff (the next chapter asking for a handler), or no handler on the
 * current stage at all. Null when nobody needs to act — the chip on the
 * queue card and the header's button both read this so they agree.
 */
export function assignmentNeeded(
	app: MockApplication,
	handoffs: StageHandoff[],
): { kind: "handoff"; handoff: StageHandoff } | { kind: "handler" } | null {
	// A closed case needs nobody — even a stale pending handoff is ignored.
	if (app.stage === "completed" || app.status === "Rejected") return null;
	const handoff = handoffs.find((h) => h.applicationId === app.id && h.status === "pending");
	if (handoff) return { kind: "handoff", handoff };
	// The seat is filled by the whole-case handler or a stage-scoped seat on
	// the chapter the case is actually in.
	const stageSeated = (app.stageHandlers ?? []).some((h) => h.stage === app.stage);
	if (!app.assignedStaff && !stageSeated) return { kind: "handler" };
	return null;
}

function whyHandoff(h: StageHandoff): string {
	const stageLabel = JOURNEY_STAGE_LABELS[h.stage as JourneyStage] ?? h.stage;
	return h.source === "deposit_payment"
		? "Deposit received — this case needs a handler before school selection can proceed."
		: h.source === "visa_payment" || h.source === "visa_consent_continue"
			? "The client is ready for their visa — place a handler."
			: h.source === "offboarding"
				? "The previous handler has left — this chapter needs a new one."
				: `This case needs a handler for ${stageLabel}.`;
}

/**
 * The handler sheet for an application. A pending stage handoff is the
 * next chapter asking for a handler — resolved by the same placement
 * (keep the previous handler, or place a new one). Coverage decides
 * whether the seat re-opens at the next chapter or the handler carries
 * the case end-to-end; a branch change refers the file to that office.
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
	const { assignees, handoffs, resolveHandoff, assignApplication, referApplication } = useCases();
	const need = assignmentNeeded(app, handoffs);
	const handoff = need?.kind === "handoff" ? need.handoff : null;
	const stage = handoff ? handoff.stage : app.stage;
	const stageLabel = JOURNEY_STAGE_LABELS[stage as JourneyStage] ?? stage;

	return (
		<AssignSheet
			open={open}
			onClose={onClose}
			title={
				handoff
					? `Handler · ${stageLabel}`
					: app.assignedStaff
						? "Change handler"
						: `Handler · ${stageLabel}`
			}
			stage={stage}
			staff={assignees}
			branch={app.branch}
			currentName={handoff ? null : caseHandlerName(app) || null}
			keepName={handoff && handoffOffersKeep(handoff) ? handoff.fromOpsUserName : null}
			keepOpsUserId={handoff && handoffOffersKeep(handoff) ? handoff.fromOpsUserId : null}
			withReason={Boolean(handoff) || Boolean(app.assignedStaff)}
			/* Replacing a seated handler demands the note — the API enforces it. */
			reasonRequired={!handoff && Boolean(app.assignedStaff)}
			why={handoff ? whyHandoff(handoff) : null}
			coverage
			onAssign={async ({ opsUserId, reason, scope, branch }) => {
				if (handoff) {
					await resolveHandoff(handoff.id, "assign", { opsUserId, reason, scope, branch });
				} else {
					const to = assignees.find((a) => a.opsUserId === opsUserId);
					if (!to) throw new Error("That staff member is no longer available");
					await assignApplication(app.id, to, { scope, branch, reason });
				}
				onDone?.("Handler placed.");
			}}
			onKeep={
				handoff
					? async (reason) => {
							await resolveHandoff(handoff.id, "keep", { reason });
							onDone?.("Handler kept.");
						}
					: undefined
			}
			onLeaveOpen={async (branch) => {
				await referApplication(app.id, branch);
				onDone?.("Referred — left open for the branch to staff.");
			}}
		/>
	);
}

/**
 * The "Handler…" chip on a queue card — present only when the case is
 * waiting on a placement and the viewer may make one. Stops the click so
 * the row underneath does not also open.
 */
export function AssignChip({ label = "Handler…", onClick }: { label?: string; onClick: () => void }) {
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
