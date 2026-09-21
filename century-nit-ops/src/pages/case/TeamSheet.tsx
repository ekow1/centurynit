import { useEffect, useState } from "react";
import { JOURNEY_STAGE_LABELS, normaliseScope, serviceStageForJourney, type CaseSeat, type CaseTeam, type JourneyStage } from "century-nit-shared";
import { Sheet } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import { useCases } from "../../hooks/useCases";
import { handoffWait, timeAgo } from "../../lib/pendingTasks";

const PRESENCE_LABEL: Record<string, string> = {
	available: "online",
	busy: "busy",
	on_leave: "on leave",
	offline: "offline",
};

function stageLabel(stage: string | null): string {
	return stage ? (JOURNEY_STAGE_LABELS[stage as JourneyStage] ?? stage) : "—";
}

/**
 * The case's staffing picture — who holds each seat right now, which seats
 * are open ahead, and who held them before. Managers get Replace (opens the
 * assign sheet) and Release (returns the seat to the queue as a
 * `manual_release` handoff). Opened from the case header.
 */
export function TeamSheet({
	app,
	open,
	onClose,
	canManage,
	onReplace,
	onChanged,
}: {
	app: MockApplication;
	open: boolean;
	onClose: () => void;
	/** assign_work — seat changes are manager work. */
	canManage: boolean;
	/** Open the assign sheet — "Replace" delegates the placement to it. */
	onReplace: () => void;
	/** Fired after a release so the detail + queue refresh. */
	onChanged?: (message: string) => void;
}) {
	const { getCaseTeam, releaseSeat } = useCases();
	const [team, setTeam] = useState<CaseTeam | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The seat a release is being written for — the note lands on the handoff.
	const [releasing, setReleasing] = useState<string | null>(null);
	const [releaseNote, setReleaseNote] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setLoading(true);
		setError(null);
		setReleasing(null);
		getCaseTeam(app.id)
			.then(setTeam)
			.catch((e) => setError(e instanceof Error ? e.message : "Could not load the team"))
			.finally(() => setLoading(false));
	}, [open, app.id, app.assignedStaffId]);

	async function release(seat: string) {
		setBusy(true);
		setError(null);
		try {
			await releaseSeat(app.id, seat, releaseNote || undefined);
			setReleasing(null);
			setReleaseNote("");
			onChanged?.("Seat returned to queue.");
			// Refresh the sheet's own picture too.
			setTeam(await getCaseTeam(app.id));
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not release the seat");
		} finally {
			setBusy(false);
		}
	}

	// The plan decides which stages can hold a seat — a stage the client
	// skipped never opens one, so it isn't listed as "open ahead".
	const scope = app.scopeStages ? normaliseScope(app.scopeStages) : null;
	const onPlan = (stage: string) => {
		if (scope == null) return true;
		const svc = serviceStageForJourney(stage);
		return svc == null || scope.includes(svc);
	};

	const seatRows: { seat: CaseSeat; key: string }[] = [
		...(team?.owner ? [{ seat: team.owner, key: "owner" }] : []),
		...(team?.coordinator ? [{ seat: team.coordinator, key: "coordinator" }] : []),
		...(team?.seats ?? []).map((s) => ({ seat: s, key: `stage:${s.stage}` })),
	];

	return (
		<Sheet open={open} onClose={onClose} title="Team" size="tall">
			{loading && <p className="hsheet__empty">Loading…</p>}
			{error && <p className="cn-assign__error">{error}</p>}

			{team?.pendingHandoff && (
				<div className="hsheet__list mb-3">
					<div className="hsheet__row hsheet__row--open">
						<span>Awaiting handler — {stageLabel(team.pendingHandoff.stage)}</span>
						<span className="hsheet__hint">
							{handoffWait(team.pendingHandoff)}
							{team.pendingHandoff.deferCount ? ` · deferred ${team.pendingHandoff.deferCount}×` : ""}
							{team.pendingHandoff.escalatedAt ? " · escalated" : ""}
						</span>
					</div>
				</div>
			)}

			{team && (
				<>
					<p className="hsheet__eyebrow">Current</p>
					<div className="hsheet__list">
						{seatRows.map(({ seat, key }) => (
							<div key={key} className="hsheet__row">
								<span>
									<span className="hsheet__presence" data-presence={seat.presence ?? "offline"} aria-hidden="true" />
									{seat.name ?? "—"}
									<span className="hsheet__hint" style={{ marginLeft: "0.5rem" }}>
										{seat.seat === "owner" ? "handler" : seat.seat === "coordinator" ? "coordinator" : stageLabel(seat.stage)}
									</span>
								</span>
								<span className="hsheet__hint">
									{seat.presence ? PRESENCE_LABEL[seat.presence] ?? seat.presence : ""}
									{seat.since ? ` · since ${timeAgo(seat.since)}` : ""}
								</span>
							</div>
						))}
						{seatRows.length === 0 && <p className="hsheet__empty">Nobody is seated on this case yet.</p>}

						{(team.openStages ?? []).map((s) =>
							onPlan(s) ? (
								<div key={`open-${s}`} className="hsheet__row hsheet__row--open">
									<span>— open · {stageLabel(s)}</span>
									<span className="hsheet__hint">seats when the stage opens</span>
								</div>
							) : (
								<div key={`open-${s}`} className="hsheet__row" style={{ opacity: 0.45 }}>
									<span style={{ textDecoration: "line-through" }}>— {stageLabel(s)}</span>
									<span className="hsheet__hint">not on this plan</span>
								</div>
							),
						)}
					</div>

					{canManage && (
						<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
							<button type="button" className="btn btn--ghost btn--sm" onClick={onReplace}>
								Place handler…
							</button>
							{team.owner && (
								<button
									type="button"
									className="btn btn--ghost btn--sm"
									onClick={() => setReleasing(releasing === "owner" ? null : "owner")}
								>
									Return to queue
								</button>
							)}
						</div>
					)}

					{releasing && (
						<div className="mt-3" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
							<input
								className="input"
								placeholder="Why is the seat going back? (optional)"
								value={releaseNote}
								onChange={(e) => setReleaseNote(e.target.value)}
								disabled={busy}
							/>
							<div style={{ display: "flex", gap: "0.5rem" }}>
								<button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void release(releasing)}>
									{busy ? "Releasing…" : "Release seat"}
								</button>
								<button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setReleasing(null)}>
									Cancel
								</button>
							</div>
						</div>
					)}

					{team.pastSeats.length > 0 && (
						<>
							<p className="hsheet__eyebrow" style={{ marginTop: "1.25rem" }}>Past</p>
							<div className="hsheet__list">
								{team.pastSeats.map((s, i) => (
									<div key={`past-${i}`} className="hsheet__row">
										<span>
											{s.name ?? "—"}
											<span className="hsheet__hint" style={{ marginLeft: "0.5rem" }}>
												{s.seat === "owner" ? "handler" : stageLabel(s.stage)}
											</span>
										</span>
										<span className="hsheet__hint">
											{s.endReason ?? "ended"}
											{s.endedAt ? ` · ${timeAgo(s.endedAt)}` : ""}
											{s.endedByName ? ` · by ${s.endedByName}` : ""}
										</span>
									</div>
								))}
							</div>
						</>
					)}
				</>
			)}
		</Sheet>
	);
}
