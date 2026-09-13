import { useEffect, useState } from "react";

import { PAYMENT_PLAN_LABELS, PACKAGE_CODE_LABELS, type PackageCode } from "century-nit-shared";
import { Sheet } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";

import { useCases } from "../../hooks/useCases";

/**
 * Correct patchable case facts — the school allowance and the payment plan.
 * The package itself is read-only here on purpose: changing it re-prices the
 * service fee and must go through Enrolment → Select package.
 */
export function EditCaseSheet({
	app,
	open,
	onClose,
	onDone,
}: {
	app: MockApplication;
	open: boolean;
	onClose: () => void;
	onDone?: (message: string) => void;
}) {
	const { updateCaseFacts } = useCases();
	const [schools, setSchools] = useState("");
	const [plan, setPlan] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setSchools(app.targetSchoolCount ? String(app.targetSchoolCount) : "");
		setPlan(app.paymentPlanId || "");
		setError(null);
	}, [open, app.targetSchoolCount, app.paymentPlanId]);

	async function submit() {
		setBusy(true);
		setError(null);
		try {
			await updateCaseFacts(app.appId, {
				targetSchoolCount: schools ? Number(schools) : null,
				paymentPlanId: plan,
			});
			onDone?.("Case facts updated.");
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not update the case");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onClose={onClose} title="Edit case">
			<div className="cn-stack">
				<div>
					<p className="muted text-xs mb-1">Package</p>
					<p className="text-sm">
						{app.fundingTrack ? PACKAGE_CODE_LABELS[app.fundingTrack as PackageCode] ?? app.fundingTrack : "Not chosen"}
						<span className="muted text-xs"> — change via Enrolment → Select package</span>
					</p>
				</div>
				<div>
					<p className="muted text-xs mb-1">Target schools</p>
					<input
						className="input"
						type="number"
						min={1}
						max={10}
						placeholder="e.g. 3"
						value={schools}
						onChange={(e) => setSchools(e.target.value)}
					/>
				</div>
				<div>
					<p className="muted text-xs mb-1">Payment plan</p>
					<select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
						<option value="">Not chosen</option>
						{Object.entries(PAYMENT_PLAN_LABELS).map(([id, label]) => (
							<option key={id} value={id}>
								{label}
							</option>
						))}
					</select>
				</div>
				{error && <p className="cn-assign__error">{error}</p>}
				<div className="cn-assign__row">
					<button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => void submit()}>
						{busy ? "Saving…" : "Save changes"}
					</button>
					<button type="button" className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
						Cancel
					</button>
				</div>
			</div>
		</Sheet>
	);
}
