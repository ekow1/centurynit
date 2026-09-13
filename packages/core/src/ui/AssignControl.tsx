import { useMemo, useState } from "react";
import { canOwnStage } from "century-nit-shared";

export type AssignableStaff = {
	opsUserId?: string;
	name: string;
	email?: string;
	branch?: string;
	role?: string;
};

/**
 * The one way ops assigns a person to a piece of work.
 *
 * Every assignment surface used to build its own: a modal here, an inline
 * <select> that fired on change there, a form with a button elsewhere, each
 * with different words. This is the single control: who currently has it,
 * who may take it (role must be allowed to own the stage — the same rule the
 * server enforces — same branch preferred), an optional "keep {name}" where
 * continuity is the norm, an optional reason, and one explicit confirm.
 */
export function AssignControl({
	stage,
	staff,
	branch,
	currentName,
	keepName,
	onAssign,
	onKeep,
	withReason = false,
	busy = false,
	label,
	permissions,
}: {
	/** The stage being staffed — decides which roles are offered. */
	stage: string;
	staff: AssignableStaff[];
	/** The case's branch; matching staff are listed first. */
	branch?: string | null;
	/** Who has it now, if anyone. */
	currentName?: string | null;
	/** Offer a one-click "keep" for this person (continuity candidate). */
	keepName?: string | null;
	onAssign: (opsUserId: string, reason?: string) => Promise<unknown> | unknown;
	onKeep?: (reason?: string) => Promise<unknown> | unknown;
	withReason?: boolean;
	busy?: boolean;
	/** Button copy; defaults to Assign / Reassign. */
	label?: string;
	/** The live role → permissions map; without it the built-in defaults decide who may own the stage. */
	permissions?: Record<string, readonly string[]>;
}) {
	const [choice, setChoice] = useState("");
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const eligible = useMemo(() => {
		const allowed = staff.filter((s) => s.opsUserId && canOwnStage(s.role, stage, permissions));
		const same = branch ? allowed.filter((s) => s.branch === branch) : [];
		const rest = allowed.filter((s) => !same.includes(s));
		return { same, rest };
	}, [staff, stage, branch, permissions]);

	async function run(fn: () => Promise<unknown> | unknown) {
		setPending(true);
		setError(null);
		try {
			await fn();
			setChoice("");
			setReason("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not assign");
		} finally {
			setPending(false);
		}
	}

	const disabled = busy || pending;
	const nobody = eligible.same.length + eligible.rest.length === 0;

	return (
		<div className="cn-assign">
			{currentName ? (
				<p className="cn-assign__current">Handler: <strong>{currentName}</strong></p>
			) : (
				<p className="cn-assign__current muted">No handler yet</p>
			)}

			{nobody ? (
				<p className="cn-assign__empty">No active staff member has a role that can own this stage.</p>
			) : (
				<div className="cn-assign__row">
					<select className="select input" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={disabled} aria-label="Assign to">
						<option value="">{currentName ? "Reassign to…" : "Assign to…"}</option>
						{eligible.same.length > 0 && (
							<optgroup label="Same branch">
								{eligible.same.map((s) => (
									<option key={s.opsUserId} value={s.opsUserId}>{s.name}</option>
								))}
							</optgroup>
						)}
						{eligible.rest.length > 0 && (
							<optgroup label={eligible.same.length > 0 ? "Other branches" : "Staff"}>
								{eligible.rest.map((s) => (
									<option key={s.opsUserId} value={s.opsUserId}>{s.name}{s.branch ? ` · ${s.branch}` : ""}</option>
								))}
							</optgroup>
						)}
					</select>
					<button
						type="button"
						className="btn btn--primary btn--sm"
						disabled={disabled || !choice}
						onClick={() => void run(() => onAssign(choice, reason || undefined))}
					>
						{pending ? "Assigning…" : label ?? (currentName ? "Reassign" : "Assign")}
					</button>
					{onKeep && keepName && (
						<button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => void run(() => onKeep(reason || undefined))}>
							Keep {keepName}
						</button>
					)}
				</div>
			)}

			{withReason && !nobody && (
				<input
					className="input"
					placeholder="Reason (optional)"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={disabled}
					aria-label="Reason"
				/>
			)}

			{error && <p className="cn-assign__error">{error}</p>}
		</div>
	);
}
