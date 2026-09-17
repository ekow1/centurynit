import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { fmtGhs, fmtUsd, money } from "./currency";
import type {
	MockConsultation,
	MockApplication,
	MockApplicant,
	Invoice,
	Assignee,
} from "century-nit-core/ops";
import { invoiceBalance, invoiceAgeDays, branchName } from "century-nit-core/ops";
import { LEAD_STAGE_LABELS, type Lead, type LeadStage } from "century-nit-core";
import { ApiError, getInvoice, type ApiInvoice } from "../lib/api";
import { ApproveInvoiceSheet } from "./case/ApproveInvoiceSheet";
import { DelegateSheet } from "./case/DelegateSheet";
import { useJoinMeeting } from "./case/ConsultationCall";
import { AssignSheet, type HandlerPlacement } from "./case/AssignSheet";
import { JOURNEY_STAGE_LABELS, type Booking, type JourneyStage, type StageHandoff, type TravelAssistanceRequest } from "century-nit-shared";
import {
	assignPendingTask,
	handoffOffersKeep,
	taskActionLabel,
	TASK_KIND_LABEL,
	timeAgo,
	VISA_STEP_LABELS,
	type PendingTask,
} from "../lib/pendingTasks";

/** The one primary action for a task — where it opens. Every case-flavoured
 * task lands on the unified Cases queue; the label names the destination. */
function openLabel(item: PendingTask): string {
	if (item.kind === "booking" || item.kind === "consultation") return "Open consultation";
	if (item.kind === "applicant") return "Open client";
	if (item.kind === "invoice") return "Open invoice";
	if (item.kind === "lead") return "Open leads";
	return "Open case";
}

/** One fact — the same key/value row the officer record uses. */
function Fact({ k, children }: { k: string; children: ReactNode }) {
	return (
		<div className="ops-dkv">
			<span className="ops-dkv__k">{k}</span>
			<span style={{ textAlign: "right" }}>{children}</span>
		</div>
	);
}

/**
 * The task's detail — shown in the worklist's detail pane and in the
 * caseload's preview sheet, so a task looks the same wherever it is opened.
 */
export function PreviewPane({
	item,
	assignees,
	canAssignWork,
	onAssigned,
	onAssignConsultation,
	onAssignApplication,
	onReferConsultation,
	onReferApplication,
	onResolveHandoff,
	onDeferHandoff,
}: {
	item: PendingTask;
	assignees: Assignee[];
	canAssignWork: boolean;
	onAssigned: () => void | Promise<void>;
	onAssignConsultation: (id: string, to: Assignee, opts?: { scope?: "stage" | "all"; branch?: string }) => Promise<unknown>;
	onAssignApplication: (id: string, to: Assignee, opts?: { scope?: "stage" | "all"; branch?: string }) => Promise<unknown>;
	onReferConsultation: (id: string, branch: string, note?: string) => Promise<unknown>;
	onReferApplication: (id: string, branch: string, note?: string) => Promise<unknown>;
	onResolveHandoff: (handoffId: string, decision: "keep" | "assign", opts?: { opsUserId?: string; reason?: string; scope?: "stage" | "all"; branch?: string }) => Promise<unknown>;
	onDeferHandoff: (handoffId: string, reason?: string) => Promise<unknown>;
}) {
	const [deferring, setDeferring] = useState(false);
	const [deferError, setDeferError] = useState<string | null>(null);
	// An invoice awaiting approval is approved here, with the sheet the case tabs use.
	const { canIssueInvoices } = useOpsAuth();
	const approvable =
		canIssueInvoices && item.action === "issue"
			? item.kind === "invoice"
				? item.record.id
				: item.kind === "travel"
					? (item.record.invoiceId ?? null)
					: null
			: null;
	const [approving, setApproving] = useState<ApiInvoice | null>(null);
	const [loadingInvoice, setLoadingInvoice] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionOk, setActionOk] = useState<string | null>(null);
	// Delegation lives on the record being steered — the toolbar button was
	// a row action pretending to be a page control.
	const [delegateOpen, setDelegateOpen] = useState(false);

	// Which stage the picker is staffing — decides which roles are offered.
	const stageForRoles =
		item.kind === "handoff"
			? item.record.stage
			: item.kind === "travel"
				? "travel_assistance"
				: item.kind === "application"
					? "school_submission"
					: "consultation";

	const byId = (opsUserId: string) => assignees.find((a) => a.opsUserId === opsUserId);
	const [handlerSheet, setHandlerSheet] = useState(false);

	async function placeHandler(placement: HandlerPlacement) {
		const to = byId(placement.opsUserId);
		if (!to || !item.record) throw new Error("Staff member not found");
		await assignPendingTask(item, to, placement, {
			assignConsultation: onAssignConsultation,
			assignApplication: onAssignApplication,
			resolveHandoff: onResolveHandoff,
		});
		await onAssigned();
	}

	async function leaveOpen(branch: string) {
		if (item.kind === "consultation") await onReferConsultation(item.record.id, branch);
		else if (item.kind === "application" || item.kind === "visa") await onReferApplication(item.record.id, branch);
		else if (item.kind === "handoff" && item.record.applicationId) await onReferApplication(item.record.applicationId, branch);
		else if (item.kind === "travel") await onReferApplication(item.record.applicationId, branch);
		await onAssigned();
	}

	async function keepHandler(reason?: string) {
		if (item.kind !== "handoff") return;
		await onResolveHandoff(item.record.id, "keep", { reason });
		await onAssigned();
	}

	async function defer() {
		if (item.kind !== "handoff") return;
		setDeferring(true);
		setDeferError(null);
		try {
			await onDeferHandoff(item.record.id);
			await onAssigned();
		} catch (err) {
			setDeferError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not defer");
		} finally {
			setDeferring(false);
		}
	}

	return (
		<div className="cn-detail">
			{/* The "open" action lives in the scaffold bar beside Close, not here. */}
			<div className="card" style={{ padding: "1.25rem", borderBottom: "none" }}>
				<span className="cn-detailhead__kicker">{TASK_KIND_LABEL[item.kind]} · {taskActionLabel(item)}</span>
				<h3 className="cn-detailhead__title" style={{ fontSize: "1.25rem", margin: "0.25rem 0" }}>{item.title}</h3>
				<p className="cn-detailhead__sub">{item.subtitle}</p>
				{/* `meta` is prose or a reference, never shouted; the mono line below is for facts. */}
				{!item.details && item.meta && <p className="cn-detailhead__sub">{item.meta}</p>}
				<p className="cn-detailhead__meta">
					{item.branch ? `${branchName(item.branch)} · ` : ""}Handler: {item.owner}
				</p>
			</div>

			{item.details && (
				<div className="card" style={{ padding: "1.25rem" }}>
					<p className="cn-detail__eyebrow" style={{ marginBottom: "0.75rem" }}>Needs action</p>
					<ul style={{ listStyleType: "disc", paddingLeft: "1.25rem", margin: "0" }}>
						{item.details.map((d) => (
							<li key={d.label} style={{ marginBottom: "0.5rem" }}>
								<span className="ops-panel__muted">{d.label}</span>
								{d.note && <span className="cn-detail__row-note" style={{ marginLeft: "0.75rem", background: "var(--muted)", padding: "0.15rem 0.45rem", color: "var(--foreground)" }}>{d.note}</span>}
							</li>
						))}
					</ul>
				</div>
			)}

			<div className="card" style={{ padding: "1.25rem" }}>
				<p className="cn-detail__eyebrow" style={{ marginBottom: "0.75rem" }}>Record Details</p>
				<div style={{ display: "flex", flexDirection: "column" }}>
					{item.kind === "consultation" && <ConsultationDetails c={item.record} />}
					{item.kind === "application" && <ApplicationDetails a={item.record} />}
					{item.kind === "visa" && <VisaDetails a={item.record} />}
					{item.kind === "handoff" && <HandoffDetails h={item.record} />}
					{item.kind === "applicant" && <ApplicantDetails app={item.record} />}
					{item.kind === "invoice" && <InvoiceDetails inv={item.record} />}
					{item.kind === "travel" && <TravelDetails ta={item.record} />}
					{item.kind === "booking" && <BookingDetails b={item.record} />}
					{item.kind === "lead" && <LeadDetails lead={item.record} />}
				</div>
			</div>

			{(item.action === "assign" || item.action === "resolve") && canAssignWork && (
				<div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border-light)" }}>
					<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
						{item.action === "resolve"
							? "This stage needs a handler before it can start."
							: "This seat is open — place a handler."}
					</p>
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
						<button type="button" className="btn btn--primary btn--sm" onClick={() => setHandlerSheet(true)}>
							Handler…
						</button>
						{item.kind === "handoff" && handoffOffersKeep(item.record) && (
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => void keepHandler()}>
								Keep {item.record.fromOpsUserName}
							</button>
						)}
						{item.kind === "handoff" && (
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => void defer()} disabled={deferring}>
								{deferring ? "Deferring…" : "Later"}
							</button>
						)}
					</div>
					{deferError && <p className="ops-modal__error" style={{ marginTop: "0.5rem" }}>{deferError}</p>}
				</div>
			)}

			{/* Bottom actions — the thing the task exists for, then the door to the record.
			    Delegation is a steering action on this case — it sits on the
			    record it steers, not on the queue's toolbar. */}
			<div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid var(--border-light)", display: "flex", justifyContent: "flex-end", gap: "0.5rem", flexWrap: "wrap" }}>
				{item.kind === "consultation" && canAssignWork && (
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setDelegateOpen(true)}>
						{item.record.coordinatorId ? "Reassign coordinator…" : "Delegate…"}
					</button>
				)}
				{approvable && (
					<button
						type="button"
						className="btn btn--primary btn--sm"
						disabled={loadingInvoice}
						onClick={() => {
							setLoadingInvoice(true);
							getInvoice(approvable)
								.then(setApproving)
								.catch((e) => setActionError(e instanceof Error ? e.message : "Could not load the invoice"))
								.finally(() => setLoadingInvoice(false));
						}}
					>
						{loadingInvoice ? "Loading…" : "Approve & issue"}
					</button>
				)}
				<Link to={item.linkTo} className={`btn btn--sm ${approvable ? "btn--ghost" : "btn--primary"}`}>
					{openLabel(item)}
				</Link>
			</div>
			{actionError && <p className="cn-assign__error">{actionError}</p>}
			<ApproveInvoiceSheet
				invoice={approving}
				onClose={() => setApproving(null)}
				onIssued={(updated) => {
					setActionOk(`${updated.invoiceNumber} issued — the client can now pay.`);
					void onAssigned();
				}}
				onDeclined={(voided) => {
					setActionOk(`${voided.invoiceNumber} declined and voided.`);
					void onAssigned();
				}}
			/>
			{actionOk && <p className="ops-panel__ok mt-2">{actionOk}</p>}
			{item.kind === "consultation" && (
				<DelegateSheet
					open={delegateOpen}
					onClose={() => setDelegateOpen(false)}
					consultation={item.record}
					onToast={(type, message) => {
						if (type === "success") {
							setActionOk(message);
							void onAssigned();
						} else {
							setActionError(message);
						}
					}}
				/>
			)}
			<AssignSheet
				open={handlerSheet}
				onClose={() => setHandlerSheet(false)}
				title={item.action === "resolve" ? `Handler for ${JOURNEY_STAGE_LABELS[item.record.stage as JourneyStage] ?? item.record.stage}` : `Handler for ${item.title}`}
				stage={stageForRoles}
				staff={assignees}
				branch={item.branch}
				currentName={item.owner && item.owner !== "— open" ? item.owner : null}
				keepName={item.kind === "handoff" && handoffOffersKeep(item.record) ? item.record.fromOpsUserName : null}
				keepOpsUserId={item.kind === "handoff" && handoffOffersKeep(item.record) ? item.record.fromOpsUserId : null}
				withReason={item.action === "resolve"}
				coverage
				coverageDefault={item.action === "resolve" ? "stage" : "all"}
				onAssign={placeHandler}
				onLeaveOpen={leaveOpen}
			/>
		</div>
	);
}

function ConsultationDetails({ c }: { c: MockConsultation }) {
	const { join, joining, error: joinError, overlay } = useJoinMeeting();
	return (
		<div style={{ fontSize: "var(--text-sm)" }}>
			{overlay}
			<Fact k="Status">{c.status}</Fact>
			<Fact k="Type">{c.type}</Fact>
			<Fact k="When">{c.dateTime}</Fact>
			<Fact k="Target country">{c.targetCountry || "—"}</Fact>
			<Fact k="Handler">{c.assignedOfficer || "— open"}</Fact>
			{c.meetingLink && (
				<Fact k="Meeting">
					{c.bookingId ? (
						<button type="button" className="link" disabled={joining} onClick={() => void join(c.bookingId!, `Consultation · ${c.ref}`)}>
							{joining ? "Joining…" : "Join meeting"}
						</button>
					) : (
						<span className="link" style={{ wordBreak: "break-all" }}>{c.meetingLink}</span>
					)}
					{joinError && <span className="muted"> · {joinError}</span>}
				</Fact>
			)}
		</div>
	);
}

function ApplicationDetails({ a }: { a: MockApplication }) {
	const open = a.checklist.filter((i) => !i.checked).length;
	return (
		<>
			<Fact k="Application">{a.appId}</Fact>
			<Fact k="Status">{a.status}</Fact>
			<Fact k="Stage">{JOURNEY_STAGE_LABELS[a.stage as JourneyStage] || a.stage}</Fact>
			<Fact k="University">{a.university || "—"}</Fact>
			<Fact k="Handler">{a.assignedStaff || "— open"}</Fact>
			<Fact k="Application tasks open">{open}</Fact>
		</>
	);
}

function VisaDetails({ a }: { a: MockApplication }) {
	const step = a.visaStage ? (VISA_STEP_LABELS[a.visaStage] ?? a.visaStage) : "Awaiting payment";
	return (
		<>
			<Fact k="Application">{a.appId}</Fact>
			<Fact k="Visa stage">{step}</Fact>
			<Fact k="University">{a.university || "—"}</Fact>
			<Fact k="Invoice paid">{a.visaInvoicePaid ? "Yes" : "No"}</Fact>
			<Fact k="Handler">{a.assignedStaff || "— open"}</Fact>
		</>
	);
}

function HandoffDetails({ h }: { h: StageHandoff }) {
	return (
		<>
			<Fact k="Application">{h.applicationNumber ?? h.applicationId}</Fact>
			<Fact k="Stage">{h.stage === "visa_processing" ? "Visa processing" : h.stage}</Fact>
			<Fact k="Source">{h.source === "visa_payment" ? "Visa payment received" : h.source === "migration" ? "Existing case setup" : "Stage transition"}</Fact>
			<Fact k="Previous handler">{h.fromOpsUserName ?? "None"}</Fact>
			{h.deferCount > 0 && (
				<Fact k="Deferred">{h.deferCount}×{h.deferredAt ? ` · last ${timeAgo(h.deferredAt)}` : ""}</Fact>
			)}
			{h.reason && <Fact k="Reason">{h.reason}</Fact>}
		</>
	);
}

function ApplicantDetails({ app }: { app: MockApplicant }) {
	const pendingDocs = app.documents.filter((d) => d.status === "Pending Review").length;
	const outstanding = money(app.financials.outstanding);
	return (
		<>
			<Fact k="Applicant ID">{app.applicantId}</Fact>
			<Fact k="Stage">{app.currentStage}</Fact>
			<Fact k="Pending documents">{pendingDocs}</Fact>
			<Fact k="Outstanding">{fmtGhs(outstanding)} · {fmtUsd(outstanding)}</Fact>
			<Fact k="Plan">{app.financials.plan || "—"}</Fact>
			<Fact k="Assigned">{app.assignedOfficer || "—"}</Fact>
		</>
	);
}

function InvoiceDetails({ inv }: { inv: Invoice }) {
	const balance = invoiceBalance(inv);
	const age = invoiceAgeDays(inv);
	return (
		<>
			<Fact k="Invoice">{inv.invoiceNumber}</Fact>
			<Fact k="Type">{inv.type}</Fact>
			<Fact k="Total">{fmtGhs(inv.subtotal)}</Fact>
			<Fact k="Balance">{fmtGhs(balance)}</Fact>
			<Fact k="Status">{inv.status}</Fact>
			{age !== null && <Fact k="Age">{age} day{age === 1 ? "" : "s"}</Fact>}
		</>
	);
}

function BookingDetails({ b }: { b: Booking }) {
	return (
		<>
			<Fact k="Reference">{b.reference}</Fact>
			<Fact k="Service">{b.serviceName}</Fact>
			<Fact k="When">
				{new Date(b.startsAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
				{" · "}{b.durationMinutes} min · {b.type === "online" ? "Online" : "In person"}
			</Fact>
			<Fact k="With">{b.employeeName ?? "—"}</Fact>
			<Fact k="Status">{b.status}</Fact>
		</>
	);
}

function TravelDetails({ ta }: { ta: TravelAssistanceRequest }) {
	const flight = ta.flight;
	const route = flight ? [flight.from, flight.to].filter(Boolean).join(" → ") : "";
	return (
		<>
			<Fact k="Case">{ta.applicationReference ?? ta.applicationId}</Fact>
			<Fact k="Status">{ta.status}</Fact>
			<Fact k="Handler">{ta.assignedOpsUserName ?? "— open"}</Fact>
			{ta.university ? <Fact k="University">{ta.university}</Fact> : null}
			{flight ? (
				<Fact k="Flight">
					{[flight.carrier, flight.flightNumber].filter(Boolean).join(" ") || "—"}
					{route ? ` · ${route}` : ""}
					{flight.departAt ? ` · departs ${new Date(flight.departAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
				</Fact>
			) : null}
			{ta.booking?.confirmationCode ? <Fact k="PNR">{ta.booking.confirmationCode}</Fact> : null}
			{ta.applicantNote ? <Fact k="Note"><i>{ta.applicantNote}</i></Fact> : null}
		</>
	);
}

function LeadDetails({ lead }: { lead: Lead }) {
	return (
		<>
			<Fact k="Email">{lead.email}</Fact>
			<Fact k="Phone">{lead.phone || "—"}</Fact>
			<Fact k="Stage">{LEAD_STAGE_LABELS[lead.stage as LeadStage] ?? lead.stage}</Fact>
			<Fact k="Source">{lead.source || "—"}</Fact>
			<Fact k="Handler">{lead.assignedTo || "— open"}</Fact>
			<Fact k="Last contact">{timeAgo(lead.lastContactAt)}</Fact>
			{lead.notes && <Fact k="Notes"><i>{lead.notes}</i></Fact>}
		</>
	);
}
