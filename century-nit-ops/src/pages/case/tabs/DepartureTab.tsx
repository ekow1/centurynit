import { useCases } from "../../../hooks/useCases";
import { useOpsAuth } from "../../OpsAuthContext";

import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";

import { useState } from "react";
import type { PreDepartureTask } from "century-nit-core/ops";
import { DOCUMENT_TYPES } from "century-nit-core/content";
import { PAYMENT_PLAN_LABELS, preDepartureChecklistDone, type TravelAssistanceRequest } from "century-nit-shared";
import type { Flash, Fail } from "./types";
import { TravelCard } from "../TravelCard";


/** Departure — the fee milestone, the flight, the pre-departure checklist. */
export function DepartureTab({
	app,
	selectedTa,
	caseInvoices,
	canWork,
	canIssueInvoices,
	feeBlock,
	travelOpen,
	onInvoicesChanged,
}: {
	app: MockApplication;
	selectedTa: TravelAssistanceRequest | null;
	caseInvoices: ApiInvoice[];
	canWork: boolean;
	canIssueInvoices: boolean;
	/** Why the ticket cannot be invoiced yet (the pre-departure fee milestone), or null. */
	feeBlock: string | null;
	travelOpen: boolean;
	onInvoicesChanged: () => void;
	flash: Flash;
	fail: Fail;
}) {
	const { setPreDepartureTask, refresh } = useCases();
	const { hasPermission } = useOpsAuth();
	const tasks: PreDepartureTask[] = app.preDepartureTasks ?? [];
	const required = tasks.filter((t) => t.required !== false);
	const requiredTotal = required.length;
	const requiredDone = required.filter((t) => t.done || Boolean(t.waivedReason)).length;
	const pdProg = tasks.length === 0 ? 0 : Math.round((tasks.filter((t) => t.done || Boolean(t.waivedReason)).length / tasks.length) * 100);
	const checklistDone = tasks.length > 0 && preDepartureChecklistDone(tasks);
	const canTick = canWork && app.stage === "travel_assistance";
	const [busy, setBusy] = useState<string | null>(null);
	const [waiving, setWaiving] = useState<string | null>(null);
	const [waiveReason, setWaiveReason] = useState("");

	async function toggle(task: PreDepartureTask) {
		setBusy(task.id);
		try {
			await setPreDepartureTask(app.appId, task.id, { done: !task.done });
			flash(task.done ? `${task.label} — reopened` : `${task.label} — done`);
		} catch (e) {
			fail(e, "Could not update the item");
		} finally {
			setBusy(null);
		}
	}
	async function waive(task: PreDepartureTask) {
		setBusy(task.id);
		try {
			await setPreDepartureTask(app.appId, task.id, { done: false, waivedReason: waiveReason.trim() });
			flash(`${task.label} — waived`);
			setWaiving(null);
			setWaiveReason("");
		} catch (e) {
			fail(e, "Could not waive the item");
		} finally {
			setBusy(null);
		}
	}
	return (
		<>
			{/* The pre-departure fee milestone comes first: due once the visa
			    is approved, before the ticket is issued. */}
			<div className="card">
				<p className="eyebrow mb-1">Pre-departure fee milestone</p>
				<p className="text-sm">
					{feeBlock
						? feeBlock.replace(/^The ticket cannot be invoiced yet: /, "")
						: app.paymentPlanId === "installment"
							? "Pre-departure instalment paid — the ticket can be invoiced."
							: "Service fee balance paid — the ticket can be invoiced."}
				</p>
				<p className="muted mt-1 text-xs">
					Plan: {PAYMENT_PLAN_LABELS[app.paymentPlanId ?? ""] ?? "not chosen"} · {app.agencyStageIndex ?? 0} milestone{(app.agencyStageIndex ?? 0) === 1 ? "" : "s"} paid
					{app.agencySettled ? " · settled" : ""}
				</p>
			</div>

			{/* Flight — status, the flight, the one next action. Departure is
			    the last chapter; completion is recorded from the Money tab or
			    by the client. */}
			<div className="card">
				<p className="eyebrow mb-2">Flight</p>
				{selectedTa ? (
					<TravelCard
						ta={selectedTa}
						invoice={caseInvoices.find((i) => i.type === "travel") ?? null}
						canWork={canWork}
						canIssueInvoices={canIssueInvoices}
						canUploadArtifacts={hasPermission("documents")}
						ownerUserId={app.applicantUserId}
						feeBlock={feeBlock}
						onChanged={() => {
							void refresh();
							onInvoicesChanged();
						}}
					/>
				) : (
					<p className="muted text-sm">
						{app.visaStage === "complete"
							? "Waiting for the applicant to decide how they want to book their flight."
							: "Opens once the visa is complete."}
					</p>
				)}
				{selectedTa?.decision && (
					<p className="muted mt-2 text-xs">
						Decided {new Date(selectedTa.updatedAt).toLocaleDateString()} · {selectedTa.decision === "yes" ? "asked us to book" : selectedTa.decision === "hold" ? "on hold" : "booking their own"}
						{selectedTa.applicantNote ? ` · "${selectedTa.applicantNote}"` : ""}
					</p>
				)}
			</div>

			{/* Pre-departure checklist — one list, two owners. The client ticks
			    theirs in the portal (with proof where it says so); the officer
			    ticks Century's here, can tick a client's item on their word, and
			    can waive a required one with a reason. */}
			{travelOpen && (
				<div className="card">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
						<p className="eyebrow" style={{ margin: 0 }}>
							Pre-departure checklist
						</p>
						<span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
							{requiredDone}/{requiredTotal} required · {pdProg}%
						</span>
					</div>
					<div style={{ height: "6px", background: "var(--muted)", overflow: "hidden", marginBottom: "0.75rem" }}>
						<div style={{ width: `${pdProg}%`, height: "100%", background: "var(--foreground)", transition: "width 0.4s ease" }} />
					</div>
					<p className="text-sm mb-3">
						<span className="muted">Next · </span>
						{checklistDone ? "Every required item is closed — the case can be completed from Money." : `${requiredTotal - requiredDone} required item${requiredTotal - requiredDone === 1 ? "" : "s"} open.`}
					</p>

					{tasks.length === 0 ? (
						<p className="muted text-sm">No checklist yet — it is seeded when the visa is approved.</p>
					) : (
						<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
							{(["century", "client"] as const).map((owner) => {
								const rows = tasks.filter((t) => (t.owner ?? "client") === owner);
								if (rows.length === 0) return null;
								return (
									<div key={owner} style={{ border: "1px solid var(--border-light)", padding: "0.75rem" }}>
										<p className="text-sm--strong">{owner === "century" ? "Century's items" : "Client's items"}</p>
										<p className="muted text-xs mb-2">
											{owner === "century" ? "The departure officer closes these." : "The client ticks these in the portal; tick on their word, or waive with a reason."}
										</p>
										<div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
											{rows.map((task) => {
												const waived = !task.done && Boolean(task.waivedReason);
												const closed = task.done || waived;
												return (
													<div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.4rem", border: "1px solid var(--border-light)", opacity: task.required === false && !closed ? 0.75 : 1 }}>
														<button
															type="button"
															onClick={() => canTick && void toggle(task)}
															disabled={!canTick || busy === task.id}
															title={canTick ? (task.done ? "Untick" : "Tick as done") : undefined}
															style={{
																width: "18px",
																height: "18px",
																flexShrink: 0,
																display: "flex",
																alignItems: "center",
																justifyContent: "center",
																fontSize: "0.65rem",
																fontWeight: 700,
																border: "2px solid",
																borderColor: closed ? "var(--foreground)" : "var(--border)",
																color: closed ? "var(--background)" : "transparent",
																background: closed ? "var(--foreground)" : "transparent",
																cursor: canTick ? "pointer" : "default",
																padding: 0,
															}}
														>
															{task.done ? "✓" : waived ? "–" : ""}
														</button>
														<div style={{ flex: 1, minWidth: 0 }}>
															<p style={{ fontWeight: closed ? 400 : 500, fontSize: "var(--text-xs)", textDecoration: task.done ? "line-through" : "none", opacity: closed ? 0.7 : 1 }}>
																{task.label}
																{task.required === false && <span className="muted"> · optional</span>}
															</p>
															{task.detail && <p className="muted" style={{ fontSize: "0.68rem" }}>{task.detail}</p>}
															{task.evidence && (
																<p className="muted" style={{ fontSize: "0.68rem" }}>
																	Proof: {DOCUMENT_TYPES.find((d) => d.id === task.evidence)?.name ?? task.evidence}
																	{task.done ? "" : " — verify in Documents once uploaded"}
																</p>
															)}
															{task.done && task.doneBy && (
																<p className="muted" style={{ fontSize: "0.68rem" }}>
																	Done by {task.doneBy === "client" ? "the client" : task.doneBy}
																	{task.doneAt ? ` · ${new Date(task.doneAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : ""}
																</p>
															)}
															{waived && <p className="muted" style={{ fontSize: "0.68rem" }}>Waived — {task.waivedReason}</p>}
															{canTick && !closed && task.required !== false && waiving !== task.id && (
																<button type="button" className="btn btn--ghost btn--sm" style={{ padding: "0 0.3rem", fontSize: "0.68rem" }} onClick={() => setWaiving(task.id)}>
																	Waive…
																</button>
															)}
															{waiving === task.id && (
																<div style={{ display: "flex", gap: "0.3rem", marginTop: "0.3rem" }}>
																	<input className="input input--sm" value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="Why this item does not apply" autoFocus />
																	<button type="button" className="btn btn--sm btn--primary" disabled={!waiveReason.trim() || busy === task.id} onClick={() => void waive(task)}>
																		Waive
																	</button>
																	<button
																		type="button"
																		className="btn btn--sm btn--ghost"
																		onClick={() => {
																			setWaiving(null);
																			setWaiveReason("");
																		}}
																	>
																		Cancel
																	</button>
																</div>
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}

		</>
	);
}
