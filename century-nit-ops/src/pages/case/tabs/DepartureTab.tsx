import { useCases } from "../../../hooks/useCases";
import { useOpsAuth } from "../../OpsAuthContext";

import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";

import { useEffect, useRef, useState } from "react";
import type { PreDepartureTask } from "century-nit-core/ops";
import { documentsApi } from "century-nit-core/api";
import { documentsReleased, isTravelResolved, type TravelAssistanceRequest } from "century-nit-shared";
import { formatMoney } from "century-nit-core/ui";
import type { Flash, Fail, TabId } from "./types";
import { Sheet } from "century-nit-core/ui";
import type { DepartureDetails } from "century-nit-shared";
import { TravelCard, flightLine } from "../TravelCard";

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
	const released = documentsReleased({ paymentPlanId: app.paymentPlanId, agencyStageIndex: app.agencyStageIndex, agencySettled: app.agencySettled, preDepartureFeePaid: app.preDepartureFeePaid, departureDetails: dd });
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
	// The pre-departure milestone as the ledger carries it, plan-aware: every
	// line that falls due before arrival must be covered. The line to name is
	// the one due on visa approval (the balance on a full plan, the Departure
	// stage on a stage-lined one); post-arrival lines never gate.
	const agencyInv = caseInvoices.filter((i) => i.type === "agency" && i.status !== "void").sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0] ?? null;
	const milestone = (() => {
		if (!agencyInv || agencyInv.lines.length === 0) return null;
		const preArrival = agencyInv.lines.filter((l) => l.dueOn !== "arrival" && l.dueOn !== "scheduled");
		if (preArrival.length === 0) return null;
		const line = preArrival.find((l) => l.dueOn === "visa_approved") ?? preArrival[preArrival.length - 1];
		const cum = preArrival.reduce((sum, l) => sum + l.amountCents, 0);
		const paid = typeof app.preDepartureFeePaid === "boolean" ? app.preDepartureFeePaid : agencyInv.paidCents >= cum;
		const issued = new Date(agencyInv.createdAt);
		const ageDays = paid ? null : Math.max(0, Math.floor((new Date().getTime() - issued.getTime()) / 86_400_000));
		const lastPayment = [...(agencyInv.payments ?? [])].sort((x, y) => (x.at < y.at ? 1 : -1))[0];
		return {
			label: line.label.replace(/^Service fee · /, "").replace(/^\w/, (ch) => ch.toUpperCase()),
			dueLabel: line.dueOn === "visa_approved" ? "due on visa approval" : line.dueOn === "acceptance" ? "due on acceptance" : line.dueOn === "offer" ? "due on the offer" : line.dueOn === "visa_open" ? "due when the visa opens" : "due before departure",
			amountCents: line.amountCents,
			remainingCents: Math.max(0, cum - agencyInv.paidCents),
			invoiceNumber: agencyInv.invoiceNumber,
			issuedAt: agencyInv.createdAt,
			paid,
			paidAt: paid ? (lastPayment?.at ?? null) : null,
			ageDays,
		};
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
	const openDeliverables = deliverables.filter((t) => !t.done && !t.waivedReason);
	const doneDeliverables = deliverables.filter((t) => t.done || Boolean(t.waivedReason));
	const canTick = canWork && app.stage === "travel_assistance";
	const [busy, setBusy] = useState<string | null>(null);
	const [waiving, setWaiving] = useState<string | null>(null);
	const [waiveReason, setWaiveReason] = useState("");
	const [clientOpen, setClientOpen] = useState(false);
	const [doneOpen, setDoneOpen] = useState(false);
	// The flight, once booked, folds to one line; the steps open on demand.
	const [flightOpen, setFlightOpen] = useState(false);
	const flightRef = useRef<HTMLDivElement>(null);
	const booked = selectedTa?.status === "booked";
	const travelResolved = selectedTa ? isTravelResolved(selectedTa.status) : false;

	// What is actually in the vault — the one truth for "on file". The
	// checklist on the case carries the client's own uploads; the agency's
	// artifacts (visa receipt, e-ticket) live only in the vault.
	const [vault, setVault] = useState<Record<string, string> | null>(null);
	useEffect(() => {
		const owner = app.applicantUserId;
		if (!owner) return;
		let alive = true;
		documentsApi
			.list({ ownerUserId: owner })
			.then((res) => {
				if (!alive) return;
				const best: Record<string, string> = {};
				const rank: Record<string, number> = { VERIFIED: 3, UPLOADED: 2, REJECTED: 1, PENDING_UPLOAD: 0 };
				for (const d of res.documents) {
					if ((rank[d.status] ?? 0) > (rank[best[d.documentType] ?? ""] ?? -1)) best[d.documentType] = d.status;
				}
				setVault(best);
			})
			.catch(() => {
				if (alive) setVault(null);
			});
		return () => {
			alive = false;
		};
	}, [app.applicantUserId, app.updatedAt, selectedTa?.status]);
	const onFile = (type: string): boolean => {
		const st = vault?.[type] ?? (app.documentChecklist ?? []).find((d) => d.id === type)?.status ?? null;
		return st === "UPLOADED" || st === "VERIFIED";
	};
	const letterOnFile = Boolean(acceptedSchool?.offerLetterStorageKey) || onFile("admission_letter");
	const visaPapersOnFile = onFile("visa_grant") || onFile("visa_receipt");
	const eTicketOnFile = onFile("flight_receipt");
	// One truth per paper: released only when the milestone is paid *and* it is on file.
	const paperState = (present: boolean): { label: string; on: boolean } =>
		released && present ? { label: dd.releaseOverrideAt ? "released early" : "released", on: true }
		: released ? { label: "needs upload", on: false }
		: present ? { label: "held · milestone unpaid", on: false }
		: { label: "not on file yet", on: false };

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
	function showFlight() {
		setFlightOpen(true);
		requestAnimationFrame(() => flightRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
	}

	/** How a deliverable closes, and the one control that moves it. */
	function deliverableRow(task: PreDepartureTask): { how: string; action: React.ReactNode; byFact: boolean } {
		const waived = !task.done && Boolean(task.waivedReason);
		const isBusy = busy === task.id;
		const doneAt = fmtDate(task.doneAt);
		const byFact = task.id === "pd-flights" || task.id === "pd-briefing" || Boolean(task.evidence);
		if (task.id === "pd-flights") {
			return {
				byFact,
				how: task.done
					? `closed by the booking${selectedTa?.booking?.confirmationCode ? ` · ${selectedTa.booking.confirmationCode}` : ""}${task.doneBy === "client" ? " · booked by the client" : ""}${doneAt ? ` · ${doneAt}` : ""}`
					: "closes when the booking is recorded",
				action: !task.done && !waived ? <button type="button" className="btn btn--sm btn--ghost" onClick={showFlight}>Flight ↓</button> : null,
			};
		}
		if (task.id === "pd-briefing") {
			return {
				byFact,
				how: task.done ? `recorded${dd.briefingAt ? ` · ${fmtDateTime(dd.briefingAt)}` : doneAt ? ` · ${doneAt}` : ""}` : "closes when the briefing is recorded — arrival, the first week, who to call",
				action: !task.done && !waived && canWork ? <button type="button" className="btn btn--sm btn--primary" onClick={openFacts}>Record briefing…</button> : null,
			};
		}
		if (task.evidence) {
			return {
				byFact,
				how: task.done
					? `closed by the vault${task.doneBy ? ` · verified by ${task.doneBy}` : ""}${doneAt ? ` · ${doneAt}` : ""}`
					: task.proofStatus === "UPLOADED"
						? "uploaded — verify it on the Documents tab to close this"
						: task.proofStatus === "REJECTED"
							? "the upload was rejected — the client re-uploads in the portal"
							: "closes when the document is in the vault and verified",
				action: !task.done && !waived ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => setTab("documents")}>Documents →</button> : null,
			};
		}
		return {
			byFact,
			how: task.done ? `done${task.doneBy ? ` by ${task.doneBy}` : ""}${doneAt ? ` · ${doneAt}` : ""}` : (task.detail ?? "closed by the officer"),
			action: canTick && !waived ? (
				<button type="button" className="btn btn--sm btn--ghost" disabled={isBusy} onClick={() => void toggle(task)}>
					{task.done ? "Reopen" : "Mark done"}
				</button>
			) : null,
		};
	}

	// What this chapter still needs, in the order it needs it — the same
	// items the gate reads, so the first one here is the Next up top.
	type OpenItem = { key: string; title: string; how: string; action: React.ReactNode; task?: PreDepartureTask };
	const openItems: OpenItem[] = [];
	if (travelOpen && selectedTa && !travelResolved) {
		openItems.push({
			key: "flight",
			title: selectedTa.decision ? "Get the flight booked" : "Waiting for the client's flight decision",
			how: selectedTa.decision ? "quote, issue, the client pays, then record the booking — the steps are below" : "they choose on their Departure page: Century books, they book their own, or hold",
			action: <button type="button" className="btn btn--sm btn--ghost" onClick={showFlight}>Flight ↓</button>,
		});
	}
	for (const task of openDeliverables) {
		if (task.id === "pd-flights" && openItems.some((o) => o.key === "flight")) continue;
		const r = deliverableRow(task);
		openItems.push({ key: task.id, title: task.label, how: task.required === false ? `${r.how} · optional` : r.how, action: r.action, task });
	}
	if (booked && !eTicketOnFile) {
		openItems.push({
			key: "eticket",
			title: "File the e-ticket",
			how: `${selectedTa?.booking?.confirmationCode ? `${selectedTa.booking.confirmationCode} · ` : ""}the ticket is handed over with the papers`,
			action: <button type="button" className="btn btn--sm btn--ghost" onClick={showFlight}>Upload ↓</button>,
		});
	}
	if (milestone && !milestone.paid && !released) {
		openItems.push({
			key: "milestone",
			title: "Pre-departure milestone unpaid — the papers are held",
			how: `${milestone.invoiceNumber} · ${fmtGhs(milestone.remainingCents)} to go · the client pays in the portal; record a transfer from Billing`,
			action: <button type="button" className="btn btn--sm btn--ghost" onClick={() => setTab("payments")}>Billing →</button>,
		});
	}

	const flyLine =
		flyDays !== null ? (flyDays > 0 ? `flies in ${flyDays} day${flyDays === 1 ? "" : "s"}` : flyDays === 0 ? "flies today" : `flew ${-flyDays} day${flyDays === -1 ? "" : "s"} ago`) : null;
	const factsRecorded = Boolean(dd.reportBy || dd.orientationAt || dd.accommodationAddress || dd.emergencyContactName || dd.arrivedAt);

	return (
		<>
			{/* Open — what the chapter still needs, first. Done work is folded. */}
			{travelOpen && (
				<div className="card">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
						<p className="eyebrow" style={{ margin: 0 }}>Open · {openItems.length}</p>
						<p className="text-xs mono muted" style={{ margin: 0, display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
							{flyLine && <span style={{ color: "var(--foreground)", fontWeight: 700 }}>{flyLine}</span>}
							{reportDays !== null && (
								<span style={reportDays < 0 && !dd.arrivedAt ? { color: "var(--foreground)", fontWeight: 700 } : undefined}>
									{reportDays >= 0 ? `report by ${fmtDate(dd.reportBy)}` : `report-by passed ${-reportDays} day${reportDays === -1 ? "" : "s"} ago`}
								</span>
							)}
							<span>
								<b style={{ color: "var(--foreground)" }}>{doneDeliverables.length} of {deliverables.length}</b> deliverables closed
							</span>
						</p>
					</div>
					{openItems.length === 0 ? (
						<p className="muted text-sm" style={{ padding: "0.25rem 0" }}>
							Nothing open in this chapter — {app.stage === "completed" ? "the case is closed." : "completion is offered in the Next band above."}
						</p>
					) : (
						<div className="cn-dl">
							{openItems.map((item, i) => {
								const task = item.task;
								return (
									<div key={item.key} className="cn-dl__r">
										<span className="cn-dl__m" aria-hidden>{i + 1}</span>
										<span className="cn-dl__t">
											{item.title}
											<small>{item.how}</small>
										</span>
										<span className="cn-dl__a">
											{task && waiving === task.id ? (
												<>
													<input className="input input--sm" value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="Why it will not happen" style={{ minWidth: "14rem" }} autoFocus />
													<button type="button" className="btn btn--sm btn--primary" disabled={busy === task.id || !waiveReason.trim()} onClick={() => void waive(task)}>
														{busy === task.id ? "Saving…" : "Waive"}
													</button>
													<button type="button" className="btn btn--sm btn--ghost" onClick={() => { setWaiving(null); setWaiveReason(""); }}>Cancel</button>
												</>
											) : (
												<>
													{item.action}
													{task && canTick && task.required !== false && deliverableRow(task).byFact && (
														<button type="button" className="plnk plnk--dim" onClick={() => { setWaiving(task.id); setWaiveReason(""); }}>waive…</button>
													)}
												</>
											)}
										</span>
									</div>
								);
							})}
						</div>
					)}
					{doneDeliverables.length > 0 && (
						<div className="cn-fold mt-3">
							<div className="cn-fold__h">
								<span>
									<b>Done · {doneDeliverables.length}</b>
									<span className="text-xs mono muted" style={{ marginLeft: "0.6rem" }}>closed by their facts, not by a tick</span>
								</span>
								<button type="button" className="plnk plnk--dim" onClick={() => setDoneOpen((v) => !v)}>
									{doneOpen ? "hide" : "show"}
								</button>
							</div>
							{doneOpen && (
								<div className="cn-fold__b">
									<div className="cn-dl" style={{ borderTop: 0 }}>
										{doneDeliverables.map((task) => {
											const waived = !task.done && Boolean(task.waivedReason);
											const r = deliverableRow(task);
											return (
												<div key={task.id} className={`cn-dl__r cn-dl__r--${waived ? "waived" : "done"}`}>
													<span className="cn-dl__m" aria-hidden>{task.done ? "✓" : "–"}</span>
													<span className="cn-dl__t">
														{task.label}
														<small>{waived ? `waived — ${task.waivedReason}` : r.how}</small>
													</span>
													<span className="cn-dl__a">
														{task.done ? r.action : null}
														{waived && canTick && (
															<button type="button" className="plnk plnk--dim" disabled={busy === task.id} onClick={() => void unwaive(task)}>undo</button>
														)}
													</span>
												</div>
											);
										})}
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Papers before they fly — released only when the milestone is paid
			    and the paper is on file. The milestone row names the actual line. */}
			<div className="card">
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
					<p className="eyebrow" style={{ margin: 0 }}>Papers before they fly</p>
					<span className="text-xs mono muted">
						{released ? (dd.releaseOverrideAt ? "released early" : "released — the client can download what is on file") : "held until the pre-departure milestone is paid"}
					</span>
				</div>
				{milestone ? (
					<div className={`cn-paper-ms${milestone.paid ? " cn-paper-ms--done" : ""}`}>
						<div>
							<b>Pre-departure milestone · {milestone.label} · {milestone.paid ? fmtGhs(milestone.amountCents) : `${fmtGhs(milestone.remainingCents)} to go`}</b>
							<small>
								{milestone.invoiceNumber} · {milestone.dueLabel} · {milestone.paid ? `paid${milestone.paidAt ? ` ${fmtDate(milestone.paidAt)}` : ""}` : `issued ${fmtDate(milestone.issuedAt) ?? "—"} · unpaid${milestone.ageDays != null ? ` · ${milestone.ageDays} day${milestone.ageDays === 1 ? "" : "s"}` : ""}`}
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
						{ label: "Admission letter", sub: acceptedSchool ? `${acceptedSchool.universityName ?? "University"}${letterOnFile ? " · on file" : " · not in the vault"}` : "no accepted offer yet", present: letterOnFile },
						{ label: "Visa documents", sub: `visa grant · visa receipt${visaPapersOnFile ? " · filed on the Visa tab" : " — uploaded on the Visa tab"}`, present: visaPapersOnFile },
						{ label: "E-ticket", sub: booked ? `${selectedTa?.booking?.confirmationCode ? `${selectedTa.booking.confirmationCode} · ` : ""}${eTicketOnFile ? "on file" : "booked · not filed yet"}` : "lands here once the ticket is paid and booked", present: eTicketOnFile },
					].map((p) => {
						const st = paperState(p.present);
						return (
							<div key={p.label} className="cn-papers__r">
								<div>
									{p.label}
									<small>{p.sub}</small>
								</div>
								<span className={`cn-papers__st${st.on ? " cn-papers__st--on" : ""}`}>{st.label}</span>
							</div>
						);
					})}
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

			{/* Flight — the steps in full while it is being worked; one line once
			    it is resolved, the steps behind a disclosure. */}
			<div className="card" ref={flightRef}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
					<p className="eyebrow" style={{ margin: 0 }}>Flight{travelResolved ? " · done ✓" : ""}</p>
					{travelResolved && (
						<button type="button" className="plnk plnk--dim" onClick={() => setFlightOpen((v) => !v)} aria-expanded={flightOpen}>
							{flightOpen ? "hide steps" : "steps ▸"}
						</button>
					)}
				</div>
				{selectedTa ? (
					<>
						{travelResolved && (
							<p className="text-sm" style={{ margin: flightOpen ? "0 0 0.75rem" : 0 }}>
								<b>
									{booked
										? `${flightLine(selectedTa.booking ?? selectedTa.flight)}${selectedTa.booking?.confirmationCode ? ` · PNR ${selectedTa.booking.confirmationCode}` : ""}`
										: selectedTa.status === "declined"
											? "Booking their own flight"
											: "On hold — they can resume from the portal"}
								</b>
								<span className="muted" style={{ display: "block", fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>
									{selectedTa.decision === "yes" ? "asked us to book" : selectedTa.decision === "no" ? "booking their own" : selectedTa.decision === "hold" ? "on hold" : "decided"}
									{fmtDate(selectedTa.updatedAt) ? ` · ${fmtDate(selectedTa.updatedAt)}` : ""}
									{booked && caseInvoices.find((i) => i.type === "travel") ? ` · ticket ${fmtGhs(caseInvoices.find((i) => i.type === "travel")!.subtotalCents)} · ${caseInvoices.find((i) => i.type === "travel")!.invoiceNumber}` : ""}
									{selectedTa.applicantNote ? ` · "${selectedTa.applicantNote}"` : ""}
								</span>
							</p>
						)}
						{(!travelResolved || flightOpen) && (
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
								onOpenBilling={() => setTab("payments")}
							/>
						)}
					</>
				) : (
					<p className="muted text-sm">
						{app.visaStage === "complete"
							? "Waiting for the applicant to decide how they want to book their flight."
							: "Opens once the visa is complete."}
					</p>
				)}
			</div>

			{/* Arrival — one list: Century's items and the client's, each tagged. */}
			{travelOpen && (
				<div className="card">
					<p className="eyebrow mb-2">Arrival · once they land</p>
					<div className="cn-dl">
						<div className="cn-dl__r">
							<span className="cn-dl__m" aria-hidden style={{ width: "auto", padding: "0 0.3rem", fontSize: "0.55rem", letterSpacing: "0.06em" }}>us</span>
							<span className="cn-dl__t">
								Arrival facts
								<small>{factsRecorded ? "the client sees these on their pre-departure page" : "report-to-school by · orientation · accommodation · emergency contact"}</small>
							</span>
							<span className="cn-dl__a">
								{canWork && (
									<button type="button" className="btn btn--sm btn--ghost" onClick={openFacts}>
										{factsRecorded ? "Edit…" : "Record…"}
									</button>
								)}
							</span>
						</div>
						{factsRecorded && (
							<div className="cn-facts" style={{ padding: "0.5rem 0 0.6rem", borderBottom: "1px solid var(--border-light)" }}>
								<div><p className="muted text-xs">Report to the school by</p><p className="text-sm">{fmtDate(dd.reportBy) ?? <span className="muted">—</span>}</p></div>
								<div><p className="muted text-xs">Orientation</p><p className="text-sm">{fmtDate(dd.orientationAt) ?? <span className="muted">—</span>}</p></div>
								<div><p className="muted text-xs">Accommodation</p><p className="text-sm">{dd.accommodationAddress ? `${dd.accommodationAddress}${dd.accommodationMoveInAt ? ` · from ${fmtDate(dd.accommodationMoveInAt)}` : ""}` : <span className="muted">—</span>}</p></div>
								<div><p className="muted text-xs">Emergency contact abroad</p><p className="text-sm">{dd.emergencyContactName ? `${dd.emergencyContactName}${dd.emergencyContactRelation ? ` (${dd.emergencyContactRelation})` : ""}${dd.emergencyContactPhone ? ` · ${dd.emergencyContactPhone}` : ""}` : <span className="muted">—</span>}</p></div>
								<div><p className="muted text-xs">Arrived</p><p className="text-sm">{fmtDate(dd.arrivedAt) ?? <span className="muted">—</span>}</p></div>
							</div>
						)}
						{clientTasks.length > 0 && (
							<div className="cn-dl__r">
								<span className="cn-dl__m" aria-hidden style={{ width: "auto", padding: "0 0.3rem", fontSize: "0.55rem", letterSpacing: "0.06em", borderStyle: "dashed" }}>client</span>
								<span className="cn-dl__t">
									Their own list · {clientTasks.filter((t) => t.done).length} of {clientTasks.length}
									<small>reminders ticked in the portal — never a gate</small>
								</span>
								<span className="cn-dl__a">
									<button type="button" className="plnk plnk--dim" onClick={() => setClientOpen((v) => !v)}>
										{clientOpen ? "hide" : "show"}
									</button>
								</span>
							</div>
						)}
						{clientOpen && (
							<div className="cn-fold__b" style={{ paddingTop: "0.4rem" }}>
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
