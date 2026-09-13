import { AssignControl, Sheet, type AssignableStaff } from "century-nit-core/ui";
import { useOpsAuth } from "../OpsAuthContext";

/**
 * The one place ops assigns a handler: the shared AssignControl in a sheet.
 *
 * Opened from the case header's "Assign / Change" and from the queue cards'
 * "Assign" chip, so triage from the list and a change from the detail are
 * the same control with the same words. When a stage handoff is pending,
 * the sheet resolves it (keep / reassign, with a reason); otherwise it sets
 * the whole-case handler. The caller decides which by what it passes in.
 */
export function AssignSheet({
	open,
	onClose,
	title,
	stage,
	staff,
	branch,
	currentName,
	keepName,
	withReason,
	why,
	onAssign,
	onKeep,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	/** Stage being staffed — filters the roster to roles that may own it. */
	stage: string;
	staff: AssignableStaff[];
	branch?: string | null;
	currentName?: string | null;
	/** Continuity candidate for a pending handoff. */
	keepName?: string | null;
	withReason?: boolean;
	/** One line of context above the control — why this assignment is needed. */
	why?: string | null;
	onAssign: (opsUserId: string, reason?: string) => Promise<unknown>;
	onKeep?: (reason?: string) => Promise<unknown>;
}) {
	// Who may own the stage comes from the live roles, so a custom role
	// given "own visa work" shows up in the visa picker.
	const { roleCatalog } = useOpsAuth();
	const permissions = Object.fromEntries(roleCatalog.map((r) => [r.id, r.permissions]));
	return (
		<Sheet open={open} onClose={onClose} title={title}>
			{why && (
				<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
					{why}
				</p>
			)}
			<AssignControl
				stage={stage}
				staff={staff}
				branch={branch}
				currentName={currentName}
				keepName={keepName}
				withReason={withReason}
				permissions={permissions}
				onAssign={async (opsUserId, reason) => {
					await onAssign(opsUserId, reason);
					onClose();
				}}
				onKeep={
					onKeep
						? async (reason) => {
								await onKeep(reason);
								onClose();
							}
						: undefined
				}
			/>
		</Sheet>
	);
}
