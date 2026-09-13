import { useEffect, useState } from "react";

import { packagesApi } from "century-nit-core/api";
import { SCHOOL_DEGREE_LEVELS } from "century-nit-core";
import { PAYMENT_PLAN_LABELS, type PackageCode, type ServicePackage } from "century-nit-shared";
import { Sheet } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";

import { useCases } from "../../hooks/useCases";

/**
 * Select the client's service package on their behalf. Goes through the same
 * server flow the portal uses — eligibility and consent gates apply, prior
 * unpaid proformas are voided and a fresh one is raised. The payment plan is
 * optional here; it patches on after the package binds so the
 * "Package & plan" milestone completes in one step.
 */
export function PackageSheet({
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
	const { selectPackage, updateCaseFacts } = useCases();
	const [packages, setPackages] = useState<ServicePackage[] | null>(null);
	const [packageCode, setPackageCode] = useState<PackageCode | "">("");
	const [degreeLevel, setDegreeLevel] = useState("");
	const [schools, setSchools] = useState("");
	const [plan, setPlan] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		let alive = true;
		packagesApi
			.list()
			.then((res) => {
				if (alive) setPackages(res.packages.filter((p) => p.active));
			})
			.catch(() => {
				if (alive) setPackages([]);
			});
		return () => {
			alive = false;
		};
	}, [open]);

	// Re-seed the form each time the sheet opens on a case.
	useEffect(() => {
		if (!open) return;
		setPackageCode((app.fundingTrack as PackageCode) || "");
		setDegreeLevel(
			SCHOOL_DEGREE_LEVELS.some((d) => d.id === app.degreeLevel) ? app.degreeLevel : "",
		);
		setSchools(app.targetSchoolCount ? String(app.targetSchoolCount) : "");
		setPlan(app.paymentPlanId || "");
		setError(null);
	}, [open, app.fundingTrack, app.degreeLevel, app.targetSchoolCount, app.paymentPlanId]);

	const selected = packages?.find((p) => p.code === packageCode) ?? null;

	async function submit() {
		if (!packageCode || !degreeLevel) return;
		setBusy(true);
		setError(null);
		try {
			await selectPackage(app.appId, {
				packageCode,
				degreeLevel,
				targetSchoolCount: schools ? Number(schools) : undefined,
			});
			if (plan && plan !== app.paymentPlanId) {
				await updateCaseFacts(app.appId, { paymentPlanId: plan });
			}
			onDone?.("Package recorded — a fresh service fee proforma was raised.");
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not select the package");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onClose={onClose} title="Select package">
			<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
				Bind the client's service package. This sets the funding track and school allowance, and
				re-prices the service fee invoice — the same as if the client chose it themselves.
			</p>
			{packages === null ? (
				<p className="muted text-sm">Loading packages…</p>
			) : (
				<div className="cn-stack">
					<div>
						<p className="muted text-xs mb-1">Package</p>
						<select className="input" value={packageCode} onChange={(e) => setPackageCode(e.target.value as PackageCode | "")}>
							<option value="">Choose…</option>
							{packages.map((p) => (
								<option key={p.code} value={p.code}>
									{p.name}{p.maxSchools ? ` · up to ${p.maxSchools} schools` : ""}
								</option>
							))}
						</select>
						{selected?.tagline && <p className="muted mt-1 text-xs">{selected.tagline}</p>}
					</div>
					<div>
						<p className="muted text-xs mb-1">Degree level</p>
						<select className="input" value={degreeLevel} onChange={(e) => setDegreeLevel(e.target.value)}>
							<option value="">Choose…</option>
							{SCHOOL_DEGREE_LEVELS.map((d) => (
								<option key={d.id} value={d.id}>
									{d.name}
								</option>
							))}
						</select>
					</div>
					<div>
						<p className="muted text-xs mb-1">Target schools</p>
						<input
							className="input"
							type="number"
							min={1}
							max={10}
							placeholder={selected?.maxSchools ? String(selected.maxSchools) : "3"}
							value={schools}
							onChange={(e) => setSchools(e.target.value)}
						/>
						{selected != null && selected.maxSchools > 0 && Number(schools) > selected.maxSchools && (
							<p className="muted mt-1 text-xs" style={{ fontWeight: 600 }}>
								Above the {selected.name} allowance of {selected.maxSchools} — confirm before saving.
							</p>
						)}
					</div>
					<div>
						<p className="muted text-xs mb-1">Payment plan (optional)</p>
						<select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
							<option value="">Decide later</option>
							{Object.entries(PAYMENT_PLAN_LABELS).map(([id, label]) => (
								<option key={id} value={id}>
									{label}
								</option>
							))}
						</select>
					</div>
					{error && <p className="cn-assign__error">{error}</p>}
					<div className="cn-assign__row">
						<button
							type="button"
							className="btn btn--sm btn--primary"
							disabled={busy || !packageCode || !degreeLevel}
							onClick={() => void submit()}
						>
							{busy ? "Saving…" : "Select package"}
						</button>
						<button type="button" className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
							Cancel
						</button>
					</div>
				</div>
			)}
		</Sheet>
	);
}
