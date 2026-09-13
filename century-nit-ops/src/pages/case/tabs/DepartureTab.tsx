import { useCases } from "../../../hooks/useCases";
import { useOpsAuth } from "../../OpsAuthContext";

import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";

import { useState } from "react";
import type { PreDepartureTask } from "century-nit-core/ops";
import { DOCUMENT_TYPES } from "century-nit-core/content";
import { PAYMENT_PLAN_LABELS, documentsReleased, preDepartureChecklistDone, type TravelAssistanceRequest } from "century-nit-shared";
import type { Flash, Fail, TabId } from "./types";
import { Sheet, StatusPill } from "century-nit-core/ui";
import type { DepartureDetails } from "century-nit-shared";
import { TravelCard } from "../TravelCard";

function fmtDate(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}
function fmtDateTime(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function dateInputValue(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function dateTimeInputValue(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const dateToIso = (v: string): string | null => (v ? new Date(`${v}T12:00:00Z`).toISOString() : null);
const dateTimeToIso = (v: string): string | null => {
	if (!v) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
/** Whole days from now to `iso`, negative once passed. */
function daysUntil(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const t = new Date(iso).getTime();
	return Number.isNaN(t) ? null : Math.ceil((t - Date.now()) / 86_400_000);
}


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
	setTab,
	flash,
	fail,
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
	setTab: (t: TabId) => void;
	flash: Flash;
	fail: Fail;
}) {
	const { setPreDepartureTask, setDepartureDetails, setReleaseOverride, refresh } = useCases();
	const { hasPermission } = useOpsAuth();
	const dd: DepartureDetails = app.departureDetails ?? {};
	const released = documentsReleased({ paymentPlanId: app.paymentPlanId, agencyStageIndex: app.agencyStageIndex, agencySettled: app.agencySettled, departureDetails: dd });
	const [releasing, setReleasing] = useState(false);
	const [releaseReason, setReleaseReason] = useState("");
	async function release() {
		setBusy("release");
		try {
			await setReleaseOverride(app.appId, dd.releaseOverrideAt ? { revoke: true } : { reason: releaseReason.trim() });
			flash(dd.releaseOverrideAt ? "Early release withdrawn — documents held again" : "Documents released — the client can download them now");
			setReleasing(false);
			setReleaseReason("");
		} catch (e) {
			fail(e, "Could not change the release");
		} finally {
			setBusy(null);
		}
	}
	const flightAt = selectedTa?.booking?.departAt ?? selectedTa?.flight?.departAt ?? null;
	const flyDays = daysUntil(flightAt);
	const reportDays = daysUntil(dd.reportBy);

	// ── Arrival facts sheet ─────────────────────────────────────────────
	const [factsOpen, setFactsOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [f, setF] = useState({ reportBy: "", orientationAt: "", briefingAt: "", pickupBy: "", pickupNote: "", accommodationAddress: "", accommodationMoveInAt: "", emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelation: "", arrivedAt: "" });
	function openFacts() {
		setF({
			reportBy: dateInputValue(dd.reportBy),
			orientationAt: dateInputValue(dd.orientationAt),
			briefingAt: dateTimeInputValue(dd.briefingAt),
			pickupBy: dd.pickupBy ?? "",
			pickupNote: dd.pickupNote ?? "",
			accommodationAddress: dd.accommodationAddress ?? "",
			accommodationMoveInAt: dateInputValue(dd.accommodationMoveInAt),
			emergencyContactName: dd.emergencyContactName ?? "",
			emergencyContactPhone: dd.emergencyContactPhone ?? "",
			emergencyContactRelation: dd.emergencyContactRelation ?? "",
			arrivedAt: dateInputValue(dd.arrivedAt),
		});
		setFactsOpen(true);
	}
	async function saveFacts() {
		setSaving(true);
		try {
			await setDepartureDetails(app.appId, {
				reportBy: dateToIso(f.reportBy),
				orientationAt: dateToIso(f.orientationAt),
				briefingAt: dateTimeToIso(f.briefingAt),
				pickupBy: f.pickupBy.trim() || null,
				pickupNote: f.pickupNote.trim() || null,
				accommodationAddress: f.accommodationAddress.trim() || null,
				accommodationMoveInAt: dateToIso(f.accommodationMoveInAt),
				emergencyContactName: f.emergencyContactName.trim() || null,
				emergencyContactPhone: f.emergencyContactPhone.trim() || null,
				emergencyContactRelation: f.emergencyContactRelation.trim() || null,
				arrivedAt: dateToIso(f.arrivedAt),
			});
			flash("Arrival facts recorded — the client sees them on their pre-departure page");
			setFactsOpen(false);
		} catch (e) {
			fail(e, "Could not record the facts");
		} finally {
			setSaving(false);
		}
	}
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
				{/* What the milestone holds: the letter and the visa documents in the
				    client's vault. A manager can release early with a reason. */}
				<div className="mt-3" style={{ borderTop: "1px solid var(--border-light)", paddingTop: "0.6rem" }}>
					<p className="text-sm">
						<span className="muted">Admission letter & visa documents · </span>
						{released ? (
							dd.releaseOverrideAt ? (
								<>
									released early by {dd.releaseOverrideBy ?? "a manager"}
									{dd.releaseOverrideAt ? ` on ${fmtDate(dd.releaseOverrideAt)}` : ""} — {dd.releaseOverrideReason}
								</>
							) : (
								"released — the milestone is paid"
							)
						) : (
							"held in the client's vault until the milestone is paid"
						)}
					</p>
					{canIssueInvoices && !releasing && (
						<button type="button" className="btn btn--sm btn--ghost mt-2" onClick={() => setReleasing(true)}>
							{dd.releaseOverrideAt ? "Withdraw early release…" : !released ? "Release early…" : null}
						</button>
					)}
					{releasing && (
						<div className="mt-2" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
							{!dd.releaseOverrideAt && (
								<input className="input input--sm" style={{ flex: "1 1 18rem" }} value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} placeholder="Why — e.g. bank transfer received, finance records it Monday" autoFocus />
							)}
							<button
								type="button"
								className="btn btn--sm btn--primary"
								disabled={busy === "release" || (!dd.releaseOverrideAt && !releaseReason.trim())}
								onClick={() => void release()}
							>
								{busy === "release" ? "Saving…" : dd.releaseOverrideAt ? "Withdraw" : "Release now"}
							</button>
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => { setReleasing(false); setReleaseReason(""); }}>
								Cancel
							</button>
						</div>
					)}
				</div>
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

			{/* Arrival — the facts the client flies with. Recording the briefing
			    and the pickup closes those checklist items; the fact is the tick. */}
			{travelOpen && (
				<div className="card">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
						<p className="eyebrow" style={{ margin: 0 }}>
							Arrival
						</p>
						<p className="text-xs" style={{ margin: 0, display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
							{flyDays !== null && (
								<span style={{ fontWeight: 700 }}>{flyDays > 0 ? `Flies in ${flyDays} day${flyDays === 1 ? "" : "s"}` : flyDays === 0 ? "Flies today" : `Flew ${-flyDays} day${flyDays === -1 ? "" : "s"} ago`}</span>
							)}
							{reportDays !== null && (
								<span className={reportDays < 0 && !dd.arrivedAt ? "" : "muted"} style={reportDays < 0 && !dd.arrivedAt ? { color: "var(--danger, #b91c1c)", fontWeight: 600 } : undefined}>
									{reportDays >= 0 ? `Report by ${fmtDate(dd.reportBy)} · ${reportDays} day${reportDays === 1 ? "" : "s"}` : `Report-by date passed ${-reportDays} day${reportDays === -1 ? "" : "s"} ago`}
								</span>
							)}
						</p>
					</div>
					<div className="cn-facts">
						<div><p className="muted text-xs">Report to the school by</p><p className="text-sm">{fmtDate(dd.reportBy) ?? <span className="muted">—</span>}</p></div>
						<div><p className="muted text-xs">Orientation</p><p className="text-sm">{fmtDate(dd.orientationAt) ?? <span className="muted">—</span>}</p></div>
						<div><p className="muted text-xs">Pre-departure briefing</p><p className="text-sm">{fmtDateTime(dd.briefingAt) ?? <span className="muted">not held</span>}</p></div>
						<div><p className="muted text-xs">Airport pickup</p><p className="text-sm">{dd.pickupBy ? `${dd.pickupBy}${dd.pickupNote ? ` · ${dd.pickupNote}` : ""}` : <span className="muted">not arranged</span>}</p></div>
						<div><p className="muted text-xs">Accommodation</p><p className="text-sm">{dd.accommodationAddress ? `${dd.accommodationAddress}${dd.accommodationMoveInAt ? ` · from ${fmtDate(dd.accommodationMoveInAt)}` : ""}` : <span className="muted">—</span>}</p></div>
						<div><p className="muted text-xs">Emergency contact abroad</p><p className="text-sm">{dd.emergencyContactName ? `${dd.emergencyContactName}${dd.emergencyContactRelation ? ` (${dd.emergencyContactRelation})` : ""}${dd.emergencyContactPhone ? ` · ${dd.emergencyContactPhone}` : ""}` : <span className="muted">—</span>}</p></div>
						{dd.arrivedAt && <div><p className="muted text-xs">Arrived</p><p className="text-sm">{fmtDate(dd.arrivedAt)}</p></div>}
					</div>
					{canWork && (
						<button type="button" className="btn btn--sm btn--ghost mt-3" onClick={openFacts}>
							{Object.keys(dd).length ? "Edit arrival facts" : "Record arrival facts"}
						</button>
					)}
				</div>
			)}

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
						{checklistDone ? "Century's deliverables are all closed — the case can be completed from Money." : `${requiredTotal - requiredDone} of Century's deliverable${requiredTotal - requiredDone === 1 ? "" : "s"} still open.`}
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
											{owner === "century" ? "Century's deliverables — the only items that gate completion. Closed by the officer, or by the fact (booking, briefing, pickup)." : "The client's own arrangements with the school and for the move — reminders they tick in the portal, never a gate."}
										</p>
										<div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
											{rows.map((task) => {
												const waived = !task.done && Boolean(task.waivedReason);
												const closed = task.done || waived;
												return (
													<div key={task.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.4rem", border: "1px solid var(--border-light)", opacity: task.required === false && !closed ? 0.75 : 1 }}>
														<button
															type="button"
															onClick={() => canTick && !task.evidence && void toggle(task)}
															disabled={!canTick || Boolean(task.evidence) || busy === task.id}
															title={task.evidence ? "Closes when the proof is verified on the Documents tab" : canTick ? (task.done ? "Untick" : "Tick as done") : undefined}
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
																<div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.2rem" }}>
																	<span className="muted" style={{ fontSize: "0.68rem" }}>
																		Proof: {DOCUMENT_TYPES.find((d) => d.id === task.evidence)?.name ?? task.evidence}
																	</span>
																	<StatusPill tone={task.proofStatus === "VERIFIED" ? "done" : task.proofStatus === "UPLOADED" ? "waiting" : task.proofStatus === "REJECTED" ? "blocked" : "neutral"}>
																		{task.proofStatus === "VERIFIED" ? "Verified" : task.proofStatus === "UPLOADED" ? "To review" : task.proofStatus === "REJECTED" ? "Rejected" : "Not uploaded"}
																	</StatusPill>
																	{task.proofStatus === "UPLOADED" && (
																		<button type="button" className="btn btn--ghost btn--sm" style={{ padding: "0 0.3rem", fontSize: "0.68rem" }} onClick={() => setTab("documents")}>
																			Verify in Documents →
																		</button>
																	)}
																</div>
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

			<Sheet open={factsOpen} onClose={() => setFactsOpen(false)} title="Arrival facts">
				<div className="cn-stack">
					<p className="muted text-sm">What the client flies with. Recording the briefing closes "Pre-departure briefing"; recording the pickup closes "Airport pickup arranged".</p>
					<div className="cn-facts">
						<label><span className="muted text-xs">Report to the school by</span><input className="input input--sm" type="date" value={f.reportBy} onChange={(e) => setF({ ...f, reportBy: e.target.value })} /></label>
						<label><span className="muted text-xs">Orientation</span><input className="input input--sm" type="date" value={f.orientationAt} onChange={(e) => setF({ ...f, orientationAt: e.target.value })} /></label>
						<label className="cn-facts__full"><span className="muted text-xs">Pre-departure briefing held on</span><input className="input input--sm" type="datetime-local" value={f.briefingAt} onChange={(e) => setF({ ...f, briefingAt: e.target.value })} /></label>
						<label><span className="muted text-xs">Airport pickup by</span><input className="input input--sm" value={f.pickupBy} onChange={(e) => setF({ ...f, pickupBy: e.target.value })} placeholder="University shuttle · Century driver · family" /></label>
						<label><span className="muted text-xs">Pickup details</span><input className="input input--sm" value={f.pickupNote} onChange={(e) => setF({ ...f, pickupNote: e.target.value })} placeholder="Meeting point, contact, time" /></label>
						<label className="cn-facts__full"><span className="muted text-xs">Accommodation address</span><input className="input input--sm" value={f.accommodationAddress} onChange={(e) => setF({ ...f, accommodationAddress: e.target.value })} /></label>
						<label><span className="muted text-xs">Move in from</span><input className="input input--sm" type="date" value={f.accommodationMoveInAt} onChange={(e) => setF({ ...f, accommodationMoveInAt: e.target.value })} /></label>
						<div />
						<label><span className="muted text-xs">Emergency contact abroad — name</span><input className="input input--sm" value={f.emergencyContactName} onChange={(e) => setF({ ...f, emergencyContactName: e.target.value })} /></label>
						<label><span className="muted text-xs">Relation</span><input className="input input--sm" value={f.emergencyContactRelation} onChange={(e) => setF({ ...f, emergencyContactRelation: e.target.value })} placeholder="Aunt · friend · host" /></label>
						<label><span className="muted text-xs">Phone</span><input className="input input--sm" value={f.emergencyContactPhone} onChange={(e) => setF({ ...f, emergencyContactPhone: e.target.value })} /></label>
						<label><span className="muted text-xs">Arrived on (once they land)</span><input className="input input--sm" type="date" value={f.arrivedAt} onChange={(e) => setF({ ...f, arrivedAt: e.target.value })} /></label>
					</div>
					<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setFactsOpen(false)} disabled={saving}>Cancel</button>
						<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveFacts()} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
					</div>
				</div>
			</Sheet>
		</>
	);
}
