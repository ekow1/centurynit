import { useEffect, useState } from "react";
import { Sheet } from "century-nit-core/ui";
import { useCases } from "../../hooks/useCases";
import type { MockConsultation } from "century-nit-core/ops";

/**
 * One sheet for every delegation verb — case handover, whole-journey
 * delegation, reassignment, take-back. Managers reach it from the Worklist
 * toolbar, the Coverage card, or a caseload client card; the case and
 * consultation detail pages stay free of steering controls.
 *
 * Scope: a consultation delegates one case ("case") or, when the applicant's
 * journey is the target, every case they open ("journey"). An applicant
 * without a consultation in hand delegates the journey directly.
 */
export function DelegateSheet({
	open,
	onClose,
	consultation,
	applicant,
	onToast,
}: {
	open: boolean;
	onClose: () => void;
	/** The case being steered — case scope, reassign, take back. */
	consultation?: MockConsultation | null;
	/** Journey-scope target — a caseload client without a case in hand. */
	applicant?: { id: string; name: string; journeyCoordinatorName?: string | null } | null;
	onToast: (type: "error" | "success", message: string) => void;
}) {
	const {
		getWorkload,
		delegateCoordinator,
		reassignCoordinator,
		reclaimCoordination,
		delegateJourney,
		releaseJourney,
		refresh,
	} = useCases();
	const [workload, setWorkload] = useState<Awaited<ReturnType<typeof getWorkload>> | null>(null);
	const [scope, setScope] = useState<"case" | "journey">("case");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setScope("case");
		setNote("");
		setWorkload(null);
		let on = true;
		getWorkload()
			.then((w) => { if (on) setWorkload(w); })
			.catch(() => undefined);
		return () => { on = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps -- reload each time the sheet opens
	}, [open]);

	const journeyApplicantId = applicant?.id ?? consultation?.applicantId ?? null;
	const journeyApplicantName = applicant?.name ?? consultation?.applicantName ?? null;
	const journeyHolder = applicant?.journeyCoordinatorName ?? null;
	const caseCoordinator = consultation?.coordinatorId ? consultation : null;
	// Journey scope is offered when an applicant is in hand — always true on a
	// consultation (its applicantId), and the only mode for a bare applicant.
	const journeyOnly = !consultation && Boolean(applicant);
	const effectiveScope = journeyOnly ? "journey" : scope;

	const title = consultation
		? `${consultation.ref} · ${consultation.applicantName}`
		: applicant
			? `${applicant.name}'s journey`
			: "Delegate";

	const pick = async (opsUserId: string, name: string) => {
		setBusy(true);
		try {
			if (caseCoordinator) {
				await reassignCoordinator(caseCoordinator.id, opsUserId, note || undefined);
				onToast("success", `${name} now steers ${caseCoordinator.ref}.`);
			} else if (consultation) {
				await delegateCoordinator(consultation.id, opsUserId, note || undefined, effectiveScope);
				onToast(
					"success",
					effectiveScope === "journey"
						? `${name} steers ${journeyApplicantName}'s journey — every case routes to them.`
						: `${name} steers ${consultation.ref}.`,
				);
			} else if (applicant) {
				await delegateJourney(applicant.id, opsUserId);
				onToast("success", `${name} steers ${applicant.name}'s journey — every case routes to them.`);
			}
			void refresh();
			onClose();
		} catch (err: unknown) {
			onToast("error", err instanceof Error ? err.message : "Delegation failed");
		} finally {
			setBusy(false);
		}
	};

	const takeBack = async () => {
		if (!consultation) return;
		setBusy(true);
		try {
			await reclaimCoordination(consultation.id);
			void refresh();
			onToast("success", `You steer ${consultation.ref} again.`);
			onClose();
		} catch (err: unknown) {
			onToast("error", err instanceof Error ? err.message : "Take-back failed");
		} finally {
			setBusy(false);
		}
	};

	const release = async () => {
		if (!journeyApplicantId) return;
		setBusy(true);
		try {
			await releaseJourney(journeyApplicantId);
			void refresh();
			onToast("success", "Journey released — in-flight cases keep their coordinator; new cases stop routing.");
			onClose();
		} catch (err: unknown) {
			onToast("error", err instanceof Error ? err.message : "Release failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Sheet open={open} onClose={onClose} title={title} size="tall">
			<p className="lead" style={{ fontSize: "var(--text-sm)", marginTop: 0 }}>
				They get the steering verbs — place the handler, move the branch — and the case lands in their queue.
				You keep oversight.
			</p>

			{caseCoordinator && (
				<p style={{ fontSize: "var(--text-xs)", margin: "0 0 0.75rem" }}>
					Steered by <strong>{caseCoordinator.coordinatorName}</strong>
					{caseCoordinator.coordinatedVia === "applicant" ? " · via the journey" : caseCoordinator.coordinatedVia === "duty" ? " · via duty" : ""}
				</p>
			)}
			{journeyHolder && (
				<p style={{ fontSize: "var(--text-xs)", margin: "0 0 0.75rem" }}>
					Journey held by <strong>{journeyHolder}</strong> — every case routes to them.
				</p>
			)}

			{!caseCoordinator && consultation && (
				<div style={{ display: "flex", gap: "1rem", fontSize: "var(--text-xs)", marginBottom: "0.9rem" }}>
					<label style={{ display: "inline-flex", alignItems: "flex-start", gap: "0.35rem" }}>
						<input type="radio" checked={scope === "case"} onChange={() => setScope("case")} />
						<span><strong>This case</strong><br /><span className="muted">{consultation.ref} only</span></span>
					</label>
					<label style={{ display: "inline-flex", alignItems: "flex-start", gap: "0.35rem" }}>
						<input type="radio" checked={scope === "journey"} onChange={() => setScope("journey")} />
						<span><strong>Whole journey</strong><br /><span className="muted">Every case {journeyApplicantName} opens, until released</span></span>
					</label>
				</div>
			)}

			<p className="cn-detail__eyebrow" style={{ marginBottom: "0.4rem" }}>
				{caseCoordinator ? "Hand to" : "Coordinator"}
			</p>
			{workload ? (
				<div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.9rem" }}>
					{workload.coordinators.map((c) => (
						<button
							key={c.opsUserId}
							type="button"
							disabled={busy}
							onClick={() => void pick(c.opsUserId, c.name)}
							className="btn btn--sm btn--ghost"
							style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.75rem", textAlign: "left" }}
						>
							<span>
								<strong>{c.name}</strong>
								<br />
								<span className="muted" style={{ fontSize: "10px" }}>{c.role}</span>
							</span>
							<span style={{ fontSize: "10px", textAlign: "right" }}>
								{c.activeCases}/{c.maxCapacity} cases
								{c.overdueCases > 0 && <span style={{ color: "var(--danger)" }}> · {c.overdueCases} overdue</span>}
							</span>
						</button>
					))}
					{workload.coordinators.length === 0 && (
						<p className="muted" style={{ fontSize: "var(--text-xs)" }}>No coordinator-capable staff — grant case oversight first.</p>
					)}
				</div>
			) : (
				<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.9rem" }}>Loading workload…</p>
			)}

			<input
				value={note}
				onChange={(e) => setNote(e.target.value)}
				placeholder="Handover note (optional)"
				style={{ width: "100%", fontSize: "var(--text-xs)", padding: "0.4rem 0.55rem", border: "1px solid var(--border)", marginBottom: "0.9rem" }}
			/>

			<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
				{caseCoordinator && (
					<button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void takeBack()}>
						Take back coordination
					</button>
				)}
				{journeyHolder && journeyApplicantId && (
					<button type="button" className="btn btn--sm btn--ghost" style={{ color: "var(--danger)" }} disabled={busy} onClick={() => void release()}>
						Release journey
					</button>
				)}
			</div>
		</Sheet>
	);
}
