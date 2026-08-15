import { useRef, useState } from "react";
import { useOpsState } from "./OpsStateContext";
import { useOpsAuth } from "./OpsAuthContext";
import { POST_ARRIVAL_SCHEDULES } from "century-nit-core";
import type { CustomSchedule } from "century-nit-core/ops";

export function EnterprisePaymentConfig() {
	const { directives, issueScheduleConfig } = useOpsState();
	const { opsUser, opsRole } = useOpsAuth();

	const canConfig = opsRole === "manager" || opsRole === "finance";
	const scheduleConfig = directives.scheduleConfig;
	const enabledIds = scheduleConfig?.enabledScheduleIds ?? POST_ARRIVAL_SCHEDULES.map((s) => s.id);
	const customSchedules = scheduleConfig?.customSchedules ?? [];
	const [scheduleDraft, setScheduleDraft] = useState<string[] | null>(null);
	const editing = scheduleDraft !== null;
	const [flash, setFlash] = useState<string | null>(null);

	// Custom schedule form state
	const [showCustomForm, setShowCustomForm] = useState(false);
	const [customDrafts, setCustomDrafts] = useState<CustomSchedule[]>(customSchedules);
	const [cLabel, setCLabel] = useState("");
	const [cPayments, setCPayments] = useState(2);
	const [cInterval, setCInterval] = useState(30);
	const [cGrace, setCGrace] = useState(14);
	const customIdCounter = useRef(0);

	const allSchedules = [...POST_ARRIVAL_SCHEDULES, ...customDrafts];

	function doSave() {
		if (!scheduleDraft || scheduleDraft.length === 0) return;
		issueScheduleConfig(scheduleDraft, opsUser?.name ?? "Finance", customDrafts);
		setScheduleDraft(null);
		setFlash("Payment schedule options saved.");
		setTimeout(() => setFlash(null), 3000);
	}

	function addCustomSchedule() {
		if (!cLabel.trim()) return;
		customIdCounter.current += 1;
		const id = `custom-${customIdCounter.current}`;
		const detail = `${cPayments} payment${cPayments === 1 ? "" : "s"} — every ${cInterval} day${cInterval === 1 ? "" : "s"}`;
		const newSchedule: CustomSchedule = { id, label: cLabel.trim(), detail, payments: cPayments, intervalDays: cInterval, graceDays: cGrace };
		setCustomDrafts([...customDrafts, newSchedule]);
		setScheduleDraft([...(scheduleDraft ?? enabledIds), id]);
		setCLabel("");
		setCPayments(2);
		setCInterval(30);
		setCGrace(14);
		setShowCustomForm(false);
	}

	function removeCustomSchedule(id: string) {
		setCustomDrafts(customDrafts.filter((s) => s.id !== id));
		if (scheduleDraft) setScheduleDraft(scheduleDraft.filter((sid) => sid !== id));
	}

	if (!canConfig) {
		return (
			<div className="page-content fade-in">
				<h1 className="page-title">Payment Configuration</h1>
				<p className="lead mt-2">You do not have permission to configure payment options.</p>
			</div>
		);
	}

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<h1 className="page-title">Payment Configuration</h1>
				<p className="lead mt-2">Control which recurring payment frequencies portal applicants can choose from for their post-arrival balance. Create custom schedules or toggle the built-in options.</p>
			</div>

			{flash ? (
				<div className="inv-flash" style={{ marginBottom: "1.5rem" }}>✓ {flash}</div>
			) : null}

			{/* Post-arrival schedule configuration */}
			<div className="card" style={{ marginBottom: "2rem" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
					<div>
						<h2 className="section-title">Post-Arrival Payment Schedules</h2>
						<p className="muted mt-1" style={{ fontSize: "var(--text-sm)" }}>
							Enable or disable payment frequency options. Applicants will only see enabled options when choosing a post-arrival payment plan.
						</p>
					</div>
					<div style={{ display: "flex", gap: "0.5rem" }}>
						{!editing && !showCustomForm ? (
							<>
								<button
									type="button"
									className="btn btn--ghost btn--sm"
									onClick={() => { setScheduleDraft([...enabledIds]); setCustomDrafts(customSchedules); }}
								>
									Edit options
								</button>
								<button
									type="button"
									className="btn btn--primary btn--sm"
									onClick={() => { setScheduleDraft([...enabledIds]); setCustomDrafts(customSchedules); setShowCustomForm(true); }}
								>
									+ New schedule
								</button>
							</>
						) : null}
					</div>
				</div>

				{!editing ? (
					<div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
						{allSchedules.map((s) => {
							const on = enabledIds.includes(s.id);
							const isCustom = customSchedules.some((c) => c.id === s.id);
							return (
								<div
									key={s.id}
									className="card"
									style={{
										padding: "1rem 1.25rem",
										border: on ? "1px solid var(--border)" : "1px solid var(--border-light)",
										opacity: on ? 1 : 0.4,
										minWidth: "180px",
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
										<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.label}</p>
										{isCustom ? (
											<span style={{ fontSize: "0.6rem", fontWeight: 700, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.05em" }}>Custom</span>
										) : null}
									</div>
									<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
										{s.detail}
									</p>
									<p className="mono" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem" }}>
										{s.payments} payments · {s.intervalDays}d interval · {s.graceDays}d grace
									</p>
									<span className="portal-pill" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem", display: "inline-block" }}>
										{on ? "Enabled" : "Disabled"}
									</span>
								</div>
							);
						})}
					</div>
				) : (
					<div>
						<div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
							{allSchedules.map((s) => {
								const on = scheduleDraft!.includes(s.id);
								const isCustom = customDrafts.some((c) => c.id === s.id);
								return (
									<label
										key={s.id}
										className="card"
										style={{
											padding: "1rem 1.25rem",
											border: on ? "1px solid var(--border)" : "1px solid var(--border-light)",
											minWidth: "180px",
											cursor: "pointer",
											position: "relative",
										}}
									>
										<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
											<input
												type="checkbox"
												checked={on}
												onChange={(e) => {
													if (e.target.checked) {
														setScheduleDraft([...scheduleDraft!, s.id]);
													} else {
														setScheduleDraft(scheduleDraft!.filter((id) => id !== s.id));
													}
												}}
											/>
											<span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.label}</span>
											{isCustom ? (
												<span style={{ fontSize: "0.6rem", fontWeight: 700, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.05em" }}>Custom</span>
											) : null}
										</div>
										<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
											{s.detail}
										</p>
										<p className="mono" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem" }}>
											{s.payments} payments · {s.intervalDays}d interval · {s.graceDays}d grace
										</p>
										{isCustom ? (
											<button
												type="button"
												style={{ position: "absolute", top: "0.5rem", right: "0.5rem", fontSize: "0.7rem", color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}
												onClick={(e) => { e.preventDefault(); removeCustomSchedule(s.id); }}
											>
												✕
											</button>
										) : null}
									</label>
								);
							})}
						</div>

						{/* Custom schedule creation form */}
						{showCustomForm ? (
							<div className="card" style={{ padding: "1.25rem", marginBottom: "1.25rem", borderLeft: "4px solid var(--primary)" }}>
								<h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>New Custom Schedule</h3>
								<div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
									<div>
										<label className="label">Label</label>
										<input type="text" className="input" placeholder="e.g. Semi-Annual" value={cLabel} onChange={(e) => setCLabel(e.target.value)} autoFocus />
									</div>
									<div>
										<label className="label">Payments</label>
										<input type="number" className="input" min={1} max={24} value={cPayments} onChange={(e) => setCPayments(Number(e.target.value))} />
									</div>
									<div>
										<label className="label">Interval (days)</label>
										<input type="number" className="input" min={1} value={cInterval} onChange={(e) => setCInterval(Number(e.target.value))} />
									</div>
									<div>
										<label className="label">Grace (days)</label>
										<input type="number" className="input" min={0} value={cGrace} onChange={(e) => setCGrace(Number(e.target.value))} />
									</div>
								</div>
								<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowCustomForm(false)}>Cancel</button>
									<button type="button" className="btn btn--primary btn--sm" disabled={!cLabel.trim()} onClick={addCustomSchedule}>Add schedule</button>
								</div>
							</div>
						) : (
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								style={{ marginBottom: "1.25rem" }}
								onClick={() => setShowCustomForm(true)}
							>
								+ Create custom schedule
							</button>
						)}

						<div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
							<button
								type="button"
								className="btn btn--primary btn--sm"
								disabled={scheduleDraft!.length === 0}
								onClick={doSave}
							>
								Save schedule options
							</button>
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={() => { setScheduleDraft(null); setCustomDrafts(customSchedules); setShowCustomForm(false); }}
							>
								Cancel
							</button>
							{scheduleDraft!.length === 0 ? (
								<span className="muted" style={{ fontSize: "var(--text-xs)" }}>At least one option must be enabled.</span>
							) : null}
						</div>
					</div>
				)}
			</div>

			{/* Current directive status */}
			{scheduleConfig ? (
				<div className="card">
					<p className="eyebrow">Last configuration</p>
					<p className="mt-1" style={{ fontSize: "var(--text-sm)" }}>
						Set by <strong>{scheduleConfig.by}</strong> · {new Date(scheduleConfig.at).toLocaleString()}
					</p>
					<p className="muted mt-1" style={{ fontSize: "var(--text-xs)" }}>
						{scheduleConfig.enabledScheduleIds.length} of {allSchedules.length} options enabled: {scheduleConfig.enabledScheduleIds.join(", ")}
						{customSchedules.length > 0 ? ` · ${customSchedules.length} custom schedule${customSchedules.length === 1 ? "" : "s"}` : ""}
					</p>
				</div>
			) : (
				<div className="card">
					<p className="eyebrow">Default state</p>
					<p className="mt-1" style={{ fontSize: "var(--text-sm)" }}>
						All {POST_ARRIVAL_SCHEDULES.length} schedule options are enabled. No configuration has been issued yet.
					</p>
				</div>
			)}
		</div>
	);
}
