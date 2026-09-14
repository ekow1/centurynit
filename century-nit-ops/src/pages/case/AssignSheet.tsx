import { useEffect, useMemo, useState } from "react";
import { Sheet, type AssignableStaff } from "century-nit-core/ui";
import { canOwnStage, JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";
import { OPS_BRANCHES, branchId } from "century-nit-core/ops";
import { useOpsAuth } from "../OpsAuthContext";

/** The offices a file can be referred to — the ops branches that have a real
 * handling desk in the catalogue (accra-hq, kumasi, takoradi, tamale). */
const HANDLING_BRANCHES = OPS_BRANCHES.filter((b) =>
	["accra", "kumasi", "takoradi", "tamale"].includes(b.id),
);

export type HandlerPlacement = {
	opsUserId: string;
	reason?: string;
	/** `stage` seats them on this stage only; `all` carries the rest of the case. */
	scope?: "stage" | "all";
	/** Referral — the handling branch the file moves to with this placement. */
	branch?: string;
};

/**
 * The one place ops places a handler: branch → handler → coverage.
 *
 * The branch is the office that owns the file — a referral moves it without
 * touching who the client is. The handler list is scoped to the chosen
 * branch. Coverage decides whether the seat re-opens at the next chapter
 * (`stage`) or the handler carries the case end-to-end (`all`). Leaving the
 * handler open refers the file to the branch's own queue.
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
	keepOpsUserId,
	withReason,
	why,
	coverage = false,
	coverageDefault = "stage",
	onAssign,
	onKeep,
	onLeaveOpen,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	/** Stage being staffed — filters the roster to roles that may own it. */
	stage: string;
	staff: AssignableStaff[];
	/** The file's current handling branch. */
	branch?: string | null;
	currentName?: string | null;
	/** Continuity candidate for a pending handoff — shown first when eligible. */
	keepName?: string | null;
	keepOpsUserId?: string | null;
	withReason?: boolean;
	/** One line of context above the control — why this placement is needed. */
	why?: string | null;
	/** Offer the coverage choice — applications, consultations and handoffs. */
	coverage?: boolean;
	coverageDefault?: "stage" | "all";
	onAssign: (placement: HandlerPlacement) => Promise<unknown>;
	onKeep?: (reason?: string) => Promise<unknown>;
	/** "Leave it open" — refer the file to the chosen branch without a handler. */
	onLeaveOpen?: (branch: string) => Promise<unknown>;
}) {
	const { roleCatalog } = useOpsAuth();
	const permissions = useMemo(
		() => Object.fromEntries(roleCatalog.map((r) => [r.id, r.permissions])),
		[roleCatalog],
	);

	const currentBranch = branchId(branch ?? "") || "";
	const [pickBranch, setPickBranch] = useState(currentBranch);
	// null = nothing picked yet — "Leave it open" only highlights once clicked.
	const [pickHandler, setPickHandler] = useState<string | null>(null);
	const [branchListOpen, setBranchListOpen] = useState(false);
	const [scope, setScope] = useState<"stage" | "all">(coverageDefault);
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Re-seed the picks each time the sheet opens on a different case.
	useEffect(() => {
		if (open) {
			setPickBranch(currentBranch);
			setPickHandler(null);
			setBranchListOpen(false);
			setScope(coverageDefault);
			setReason("");
			setError(null);
		}
	}, [open, currentBranch, coverageDefault]);

	const eligible = useMemo(() => {
		const allowed = staff.filter((s) => s.opsUserId && canOwnStage(s.role, stage, permissions));
		const atBranch = allowed.filter((s) => branchId(s.branch ?? "") === pickBranch);
		// The previous handler is pinned first only where keeping them is a real
		// option (keepName is set) — otherwise they're just another row.
		const keep = keepOpsUserId && keepName ? atBranch.find((s) => s.opsUserId === keepOpsUserId) : undefined;
		const rest = keep ? atBranch.filter((s) => s.opsUserId !== keepOpsUserId) : atBranch;
		return { keep, rest };
	}, [staff, stage, pickBranch, permissions, keepOpsUserId, keepName]);

	const referred = pickBranch !== currentBranch;
	const stageLabel = JOURNEY_STAGE_LABELS[stage as JourneyStage] ?? stage;

	async function run(fn: () => Promise<unknown>) {
		setPending(true);
		setError(null);
		try {
			await fn();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not place the handler");
		} finally {
			setPending(false);
		}
	}

	const canReferOpen = referred && Boolean(onLeaveOpen);
	const canSubmit = pickHandler !== null && (Boolean(pickHandler) || canReferOpen);

	return (
		<Sheet open={open} onClose={onClose} title={title} size="tall">
			{why && (
				<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
					{why}
				</p>
			)}

			{/* 1 · Handling branch — collapsed to the current office until a
			   referral is asked for; the full list only expands on Refer. */}
			<p className="hsheet__eyebrow">1 · Handling branch</p>
			{branchListOpen || referred ? (
				<div className="hsheet__list" role="radiogroup" aria-label="Handling branch">
					{HANDLING_BRANCHES.map((b) => (
						<button
							key={b.id}
							type="button"
							role="radio"
							aria-checked={pickBranch === b.id}
							className={`hsheet__row${pickBranch === b.id ? " hsheet__row--on" : ""}`}
							onClick={() => setPickBranch(b.id)}
						>
							<span>{b.name}</span>
							{b.id === currentBranch ? (
								<span className="hsheet__hint">current</span>
							) : referred && pickBranch === b.id ? (
								<span className="hsheet__hint">referred from {OPS_BRANCHES.find((x) => x.id === currentBranch)?.name ?? currentBranch}</span>
							) : null}
						</button>
					))}
				</div>
			) : (
				<div className="hsheet__list">
					<button type="button" className="hsheet__row" onClick={() => setBranchListOpen(true)}>
						<span>{OPS_BRANCHES.find((b) => b.id === currentBranch)?.name ?? currentBranch ?? "—"}</span>
						<span className="hsheet__hint">holds the file · refer…</span>
					</button>
				</div>
			)}

			{/* 2 · Handler */}
			<p className="hsheet__eyebrow">2 · Handler</p>
			<div className="hsheet__list" role="radiogroup" aria-label="Handler">
				{eligible.keep && (
					<button
						type="button"
						role="radio"
						aria-checked={pickHandler === eligible.keep.opsUserId}
						className={`hsheet__row${pickHandler === eligible.keep.opsUserId ? " hsheet__row--on" : ""}`}
						onClick={() => setPickHandler(eligible.keep!.opsUserId!)}
					>
						<span>{eligible.keep.name}</span>
						<span className="hsheet__hint">was handler here</span>
					</button>
				)}
				{eligible.rest.map((s) => (
					<button
						key={s.opsUserId}
						type="button"
						role="radio"
						aria-checked={pickHandler === s.opsUserId}
						className={`hsheet__row${pickHandler === s.opsUserId ? " hsheet__row--on" : ""}`}
						onClick={() => setPickHandler(s.opsUserId!)}
					>
						<span>{s.name}</span>
						<span className="hsheet__hint">{s.role ?? ""}</span>
					</button>
				))}
				{eligible.rest.length === 0 && !eligible.keep && (
					<p className="hsheet__empty">Nobody at {OPS_BRANCHES.find((b) => b.id === pickBranch)?.name ?? "this branch"} can take {stageLabel}.</p>
				)}
				{onLeaveOpen && (
					<button
						type="button"
						role="radio"
						aria-checked={pickHandler === ""}
						className={`hsheet__row hsheet__row--open${pickHandler === "" ? " hsheet__row--on" : ""}`}
						onClick={() => setPickHandler("")}
					>
						<span>— Leave it open</span>
						<span className="hsheet__hint">{referred ? "lands in that branch's queue" : "stays in the queue"}</span>
					</button>
				)}
			</div>

			{/* 3 · Coverage */}
			{coverage && pickHandler && (
				<>
					<p className="hsheet__eyebrow">3 · Coverage</p>
					<div className="hsheet__list" role="radiogroup" aria-label="Coverage">
						<button
							type="button"
							role="radio"
							aria-checked={scope === "stage"}
							className={`hsheet__row hsheet__row--stack${scope === "stage" ? " hsheet__row--on" : ""}`}
							onClick={() => setScope("stage")}
						>
							<span>This stage only</span>
							<span className="hsheet__hint">Seat re-opens at the next chapter — a new needs-handler task appears for it.</span>
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={scope === "all"}
							className={`hsheet__row hsheet__row--stack${scope === "all" ? " hsheet__row--on" : ""}`}
							onClick={() => setScope("all")}
						>
							<span>Rest of the case</span>
							<span className="hsheet__hint">They carry every remaining chapter — no placement task appears again.</span>
						</button>
					</div>
				</>
			)}

			{withReason && (
				<input
					className="input mt-3"
					placeholder="Reason (optional)"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={pending}
					aria-label="Reason"
				/>
			)}

			{error && <p className="cn-assign__error mt-2">{error}</p>}

			<div className="hsheet__foot">
				{onKeep && keepName && (
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						disabled={pending}
						onClick={() => void run(() => onKeep(reason || undefined))}
					>
						Keep {keepName}
					</button>
				)}
				<button
					type="button"
					className="btn btn--primary btn--sm"
					disabled={pending || !canSubmit}
					onClick={() =>
						void run(async () => {
							if (!pickHandler && canReferOpen) {
								await onLeaveOpen!(pickBranch);
								return;
							}
							if (!pickHandler) return;
							await onAssign({
								opsUserId: pickHandler,
								reason: reason || undefined,
								scope: coverage ? scope : undefined,
								branch: referred ? pickBranch : undefined,
							});
						})
					}
				>
					{pending
						? "Placing…"
						: pickHandler === "" && referred
							? `Refer to ${OPS_BRANCHES.find((b) => b.id === pickBranch)?.name ?? pickBranch} — leave open`
							: currentName
								? "Change handler"
								: "Set handler"}
				</button>
			</div>
		</Sheet>
	);
}
