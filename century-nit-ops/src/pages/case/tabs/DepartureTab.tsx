import { useCases } from "../../../hooks/useCases";
import { useOpsAuth } from "../../OpsAuthContext";

import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";

import { useState } from "react";
import type { PreDepartureTask } from "century-nit-core/ops";
import { documentsReleased, type TravelAssistanceRequest } from "century-nit-shared";
import { formatMoney } from "century-nit-core/ui";
import type { Flash, Fail, TabId } from "./types";
import { Sheet } from "century-nit-core/ui";
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
const fmtGhs = (cents: number) => formatMoney(cents, "ghs");

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
	// The pre-departure milestone as the ledger carries it: the second line of
	// the live agency invoice (the balance on a full plan), covered or not.
	const agencyInv = caseInvoices.filter((i) => i.type === "agency" && i.status !== "void").sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0] ?? null;
	const milestone = (() => {
		if (!agencyInv || agencyInv.lines.length < 2) return null;
		const line = agencyInv.lines[1];
		const cum = agencyInv.lines[0].amountCents + line.amountCents;
		const paid = agencyInv.paidCents >= cum;
		const issued = new Date(agencyInv.createdAt);
		const ageDays = paid ? null : Math.max(0, Math.floor((new Date().getTime() - issued.getTime()) / 86_400_000));
		const lastPayment = [...(agencyInv.payments ?? [])].sort((x, y) => (x.at < y.at ? 1 : -1))[0];
		return { label: line.label.replace(/^Service fee · /, "").replace(/^\w/, (ch) => ch.toUpperCase()), amountCents: line.amountCents, invoiceNumber: agencyInv.invoiceNumber, issuedAt: agencyInv.createdAt, paid, paidAt: paid ? (lastPayment?.at ?? null) : null, ageDays };
	})();
	const acceptedSchool = (app.schoolApplications ?? []).find((sa) => sa.id === app.acceptedSchoolId) ?? (app.schoolApplications ?? []).find((sa) => sa.outcome === "Admitted") ?? null;
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
	// Century's deliverables gate completion; the client's items are reminders.
	const deliverables = tasks.filter((t) => t.owner === "century");
	const clientTasks = tasks.filter((t) => t.owner !== "century");
	const closedCount = deliverables.filter((t) => t.done || Boolean(t.waivedReason)).length;
	const canTick = canWork && app.stage === "travel_assistance";
	const [busy, setBusy] = useState<string | null>(null);
	const [waiving, setWaiving] = useState<string | null>(null);
	const [waiveReason, setWaiveReason] = useState("");
	const [clientOpen, setClientOpen] = useState(false);
	async function unwaive(task: PreDepartureTask) {
		setBusy(task.id);
		try {
			await setPreDepartureTask(app.appId, task.id, { done: false, waivedReason: null });
			flash(`${task.label} — waiver withdrawn`);
		} catch (e) {
			fail(e, "Could not withdraw the waiver");
		} finally {
			setBusy(null);
		}
	}

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
			{/* Flight — status, the flight, the one next action. Departure is
			    the last chapter; completion is recorded from the Billing tab or
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

			{/* Papers before they fly — what the pre-departure milestone holds:
			    the letter, the visa documents, the e-ticket handover. The
			    milestone invoice sits above them; a manager can release early. */}
			<div className="card">
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
					<p className="eyebrow" style={{ margin: 0 }}>Papers before they fly</p>
					<span className="text-xs mono muted">
						{released ? (dd.releaseOverrideAt ? "released early" : "released") : `held until the ${milestone?.label ? `service fee · ${milestone.label.toLowerCase()}` : "service-fee instalment"} is paid`}
					</span>
				</div>
				{milestone ? (
					<div className={`cn-paper-ms${milestone.paid ? " cn-paper-ms--done" : ""}`}>
						<div>
							<b>Service fee · {milestone.label} · {fmtGhs(milestone.amountCents)}</b>
							<small>
								{milestone.invoiceNumber} · {milestone.paid ? `paid${milestone.paidAt ? ` ${fmtDate(milestone.paidAt)}` : ""} · released the papers` : `issued ${fmtDate(milestone.issuedAt) ?? "—"} · unpaid${milestone.ageDays != null ? ` · ${milestone.ageDays} day${milestone.ageDays === 1 ? "" : "s"}` : ""}`}
							</small>
						</div>
						{!milestone.paid && (
							<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
								<button type="button" className="btn btn--sm btn--secondary" onClick={() => setTab("payments")}>Record payment</button>
							</div>
						)}
					</div>
				) : (
					<p className="muted text-sm">
						{app.paymentPlanId ? "No service-fee invoice on this case yet." : "The client has not chosen a payment plan — the milestone is raised once they do."}
					</p>
				)}
				<div className="cn-papers">
					{[
						{ label: "Admission letter", sub: acceptedSchool ? `${acceptedSchool.universityName ?? "University"}${acceptedSchool.offerLetterStorageKey ? " · on file" : " · not uploaded yet"}` : "no accepted offer yet" },
						{ label: "Visa documents", sub: "visa grant · visa receipt — uploaded on the Visa tab" },
						{ label: "E-ticket", sub: selectedTa?.status === "booked" ? `${selectedTa.booking?.confirmationCode ? `${selectedTa.booking.confirmationCode} · ` : ""}booked` : "lands here once the ticket is paid and booked" },
					].map((p) => (
						<div key={p.label} className="cn-papers__r">
							<div>
								{p.label}
								<small>{p.sub}</small>
							</div>
							<span className={`cn-papers__st${released ? " cn-papers__st--on" : ""}`}>
								{released ? (dd.releaseOverrideAt ? "released early" : "released") : "held"}
							</span>
						</div>
					))}
				</div>
				{released && dd.releaseOverrideAt && (
					<p className="text-sm mt-2">
						Released early by <b>{dd.releaseOverrideBy ?? "a manager"}</b>
						{dd.releaseOverrideAt ? ` on ${fmtDate(dd.releaseOverrideAt)}` : ""} — {dd.releaseOverrideReason}
					</p>
				)}
				{canIssueInvoices && !releasing && (
					<div className="mt-2" style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
						{(dd.releaseOverrideAt || !released) && (
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setReleasing(true)}>
								{dd.releaseOverrideAt ? "Withdraw early release…" : "Release early…"}
							</button>
						)}
						{!released && <span className="muted text-xs">A manager can release the papers before the milestone lands — the reason goes on the record.</span>}
					</div>
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

			{/* Before they fly — Century's deliverables closed by their facts, the
			    arrival facts under them, the client's own list folded. Waive
			    only what will not happen, with the reason on the record. */}
			{travelOpen && (
				<div className="card">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
						<p className="eyebrow" style={{ margin: 0 }}>Before they fly</p>
						<p className="text-xs mono muted" style={{ margin: 0, display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
							{flyDays !== null && <span style={{ color: "var(--foreground)", fontWeight: 700 }}>{flyDays > 0 ? `flies in ${flyDays} day${flyDays === 1 ? "" : "s"}` : flyDays === 0 ? "flies today" : `flew ${-flyDays} day${flyDays === -1 ? "" : "s"} ago`}</span>}
							{reportDays !== null && (
								<span style={reportDays < 0 && !dd.arrivedAt ? { color: "var(--foreground)", fontWeight: 700 } : undefined}>
									{reportDays >= 0 ? `report by ${fmtDate(dd.reportBy)}` : `report-by passed ${-reportDays} day${reportDays === -1 ? "" : "s"} ago`}
								</span>
							)}
							<span>
								<b style={{ color: "var(--foreground)" }}>{closedCount} of {deliverables.length}</b> deliverables closed
							</span>
						</p>
					</div>
					<p className="muted text-xs" style={{ margin: "0 0 0.5rem" }}>
						Century's deliverables close by their facts — the booking, the briefing, the copies in the vault — not by a tick.
					</p>
					<div className="cn-dl">
						{deliverables.map((task) => {
							const waived = !task.done && Boolean(task.waivedReason);
							const state = task.done ? "done" : waived ? "waived" : "open";
							const isBusy = busy === task.id;
							const doneAt = fmtDate(task.doneAt);
							const byFact = task.id === "pd-flights" || task.id === "pd-briefing" || Boolean(task.evidence);
							let how: string;
							let action: React.ReactNode = null;
							if (task.id === "pd-flights") {
								how = task.done
									? `closed by the booking${selectedTa?.booking?.confirmationCode ? ` · ${selectedTa.booking.confirmationCode}` : ""}${task.doneBy === "client" ? " · booked by the client" : ""}${doneAt ? ` · ${doneAt}` : ""}`
									: "closes when the booking is recorded — milestone 5 above";
								action = !task.done && !waived ? <span className="text-xs mono muted">milestone 5</span> : null;
							} else if (task.id === "pd-briefing") {
								how = task.done ? `recorded${dd.briefingAt ? ` · ${fmtDateTime(dd.briefingAt)}` : doneAt ? ` · ${doneAt}` : ""}` : "closes when the briefing is recorded — arrival, the first week, who to call";
								action = !task.done && !waived && canWork ? <button type="button" className="btn btn--sm btn--secondary" onClick={openFacts}>Record briefing…</button> : null;
							} else if (task.evidence) {
								how = task.done
									? `closed by the vault${task.doneBy ? ` · verified by ${task.doneBy}` : ""}${doneAt ? ` · ${doneAt}` : ""}`
									: task.proofStatus === "UPLOADED"
										? "uploaded — verify it on the Documents tab to close this"
										: task.proofStatus === "REJECTED"
											? "the upload was rejected — the client re-uploads in the portal"
											: "closes when the document is in the vault and verified";
								action = !task.done && !waived ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => setTab("documents")}>Documents →</button> : null;
							} else {
								how = task.done ? `done${task.doneBy ? ` by ${task.doneBy}` : ""}${doneAt ? ` · ${doneAt}` : ""}` : (task.detail ?? "closed by the officer");
								action = canTick && !waived ? (
									<button type="button" className="btn btn--sm btn--ghost" disabled={isBusy} onClick={() => void toggle(task)}>
										{task.done ? "Reopen" : "Mark done"}
									</button>
								) : null;
							}
							return (
								<div key={task.id} className={`cn-dl__r cn-dl__r--${state}`}>
									<span className="cn-dl__m" aria-hidden>
										{task.done ? "✓" : waived ? "–" : ""}
									</span>
									<span className="cn-dl__t">
										{task.label}
										<small>{waived ? `waived — ${task.waivedReason}` : how}</small>
									</span>
									<span className="cn-dl__a">
										{waiving === task.id ? (
											<>
												<input className="input input--sm" value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="Why it will not happen" style={{ minWidth: "14rem" }} autoFocus />
												<button type="button" className="btn btn--sm btn--primary" disabled={isBusy || !waiveReason.trim()} onClick={() => void waive(task)}>
													{isBusy ? "Saving…" : "Waive"}
												</button>
												<button type="button" className="btn btn--sm btn--ghost" onClick={() => { setWaiving(null); setWaiveReason(""); }}>Cancel</button>
											</>
										) : (
											<>
												{action}
												{waived && canTick && (
													<button type="button" className="plnk plnk--dim" disabled={isBusy} onClick={() => void unwaive(task)}>undo</button>
												)}
												{!task.done && !waived && canTick && task.required !== false && byFact && (
													<button type="button" className="plnk plnk--dim" onClick={() => { setWaiving(task.id); setWaiveReason(""); }}>waive…</button>
												)}
											</>
										)}
									</span>
								</div>
							);
						})}
						{deliverables.length === 0 && <p className="muted text-sm" style={{ padding: "0.5rem 0" }}>No deliverables are seeded on this case yet.</p>}
					</div>

					<div className="cn-facts mt-3">
						<div><p className="muted text-xs">Report to the school by</p><p className="text-sm">{fmtDate(dd.reportBy) ?? <span className="muted">—</span>}</p></div>
						<div><p className="muted text-xs">Orientation</p><p className="text-sm">{fmtDate(dd.orientationAt) ?? <span className="muted">—</span>}</p></div>
						<div><p className="muted text-xs">Accommodation</p><p className="text-sm">{dd.accommodationAddress ? `${dd.accommodationAddress}${dd.accommodationMoveInAt ? ` · from ${fmtDate(dd.accommodationMoveInAt)}` : ""}` : <span className="muted">—</span>}</p></div>
						<div><p className="muted text-xs">Emergency contact abroad</p><p className="text-sm">{dd.emergencyContactName ? `${dd.emergencyContactName}${dd.emergencyContactRelation ? ` (${dd.emergencyContactRelation})` : ""}${dd.emergencyContactPhone ? ` · ${dd.emergencyContactPhone}` : ""}` : <span className="muted">—</span>}</p></div>
						<div><p className="muted text-xs">Arrived</p><p className="text-sm">{fmtDate(dd.arrivedAt) ?? <span className="muted">—</span>}</p></div>
						{canWork && (
							<div style={{ alignSelf: "end" }}>
								<button type="button" className="btn btn--sm btn--ghost" onClick={openFacts}>
									{Object.keys(dd).length ? "Edit arrival facts" : "Record arrival facts"}
								</button>
							</div>
						)}
					</div>

					{clientTasks.length > 0 && (
						<div className="cn-fold mt-3">
							<div className="cn-fold__h">
								<span>
									<b>The client's own list</b>
									<span className="text-xs mono muted" style={{ marginLeft: "0.6rem" }}>
										{clientTasks.filter((t) => t.done).length} of {clientTasks.length} ticked in the portal · reminders, never a gate
									</span>
								</span>
								<button type="button" className="plnk plnk--dim" onClick={() => setClientOpen((v) => !v)}>
									{clientOpen ? "hide" : "show"}
								</button>
							</div>
							{clientOpen && (
								<div className="cn-fold__b">
									{clientTasks.map((task) => (
										<div key={task.id} className={`cn-fold__it${task.done ? " cn-fold__it--on" : ""}`}>
											<span className="cn-fold__bx" aria-hidden />
											<span>
												{task.label}
												{task.done && fmtDate(task.doneAt) ? <span className="muted"> · {fmtDate(task.doneAt)}</span> : null}
											</span>
											{canTick && (
												<button type="button" className="plnk plnk--dim" disabled={busy === task.id} onClick={() => void toggle(task)} title={task.done ? "Reopen" : "Mark on their word"}>
													{task.done ? "reopen" : "mark…"}
												</button>
											)}
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			<Sheet open={factsOpen} onClose={() => setFactsOpen(false)} title="Arrival facts">
				<div className="cn-stack">
					<p className="muted text-sm">What the client flies with. Recording the briefing closes "Pre-departure briefing".</p>
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
