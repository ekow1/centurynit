import { LEAD_STAGE_LABELS, type Lead } from "century-nit-core";
import type {
	MockConsultation,
	MockApplication,
	MockApplicant,
	Invoice,
	InvoiceStatus,
} from "century-nit-core/ops";
import { invoiceBalance, invoiceAgeDays } from "century-nit-core/ops";
import {
	JOURNEY_STAGE_LABELS,
	type JourneyStage,
	type StageHandoff,
	type Booking,
	type TravelAssistanceRequest,
	VISA_STAGE_LABELS,
	isOwnerClassBoundary,
} from "century-nit-shared";
import { fmtGhs, money } from "../pages/currency";

/**
 * Shared "pending task" model.
 *
 * Every open item the ops team can work on — an unassigned booking, a
 * consultation to assess, a case to assign, a visa to advance, a document to
 * review, a proforma to issue, an overdue invoice to chase, a lead to follow
 * up, a stage handoff to resolve — is normalized into one `PendingTask` row so
 * the Dashboard and Workspace render the identical tabular triage surface with
 * the same inline assignment behavior.
 */

export const PRIORITY: Record<string, number> = {
	assign_consultation: 1,
	assign_application: 2,
	reschedule: 3,
	assess: 4,
	review_application: 5,
	checklist: 6,
	docs: 7,
	invoice: 8,
	issue: 9,
	chase: 10,
	followup: 11,
};

export type BaseTask =
	| {
			id: string;
			category: string;
			kind: "consultation";
			action: "assign" | "assess" | "reschedule";
			record: MockConsultation;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "application";
			action: "assign" | "review" | "checklist";
			record: MockApplication;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "visa";
			action: "advance" | "issue" | "chase";
			record: MockApplication;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "applicant";
			action: "docs" | "invoice";
			record: MockApplicant;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "invoice";
			action: "issue" | "chase";
			record: Invoice;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "lead";
			action: "followup";
			record: Lead;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "travel";
			action: "assign" | "invoice" | "issue" | "book";
			record: TravelAssistanceRequest;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  }
	| {
			id: string;
			category: string;
			kind: "handoff";
			action: "resolve";
			record: StageHandoff;
			title: string;
			subtitle: string;
			meta: string;
			branch: string;
			owner: string;
			linkTo: string;
			priority: number;
	  };

/** An unassigned calendar booking — the raw triage record behind a consultation. */
export type BookingTask = {
	id: string;
	category: "needs_assignment";
	kind: "booking";
	action: "assign";
	record: Booking;
	title: string;
	subtitle: string;
	meta: string;
	branch: string;
	owner: string;
	linkTo: string;
	priority: number;
};

export type PendingTask = (BaseTask | BookingTask) & { isLive?: boolean };

/** Visa sub-stage names — the one vocabulary, shared with the portal. */
export const VISA_STEP_LABELS = VISA_STAGE_LABELS;

/**
 * What the applicant sees, when the API supplied it, so the queue names the
 * same step as the portal; the coarse ops stage otherwise.
 */
export function stageMeta(a: MockApplication): string {
	return a.journey
		? `Client sees: ${a.journey.label}`
		: `Stage: ${JOURNEY_STAGE_LABELS[a.stage as JourneyStage] || a.stage}`;
}

export function visaInvoiceFor(invoices: Invoice[], app: MockApplication): Invoice | undefined {
	return invoices.find(
		(i) => i.type === "Visa" && i.applicationId != null && i.applicationId === app.id,
	);
}

export function timeAgo(iso?: string | null) {
	if (!iso) return "Just now";
	const timestamp = new Date(iso).getTime();
	if (isNaN(timestamp)) return "Just now";
	const diff = Date.now() - timestamp;
	if (diff < 0) return "Just now";
	const hours = Math.floor(diff / 3_600_000);
	if (hours < 1) return "Just now";
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function derivedStatus(inv: Invoice): InvoiceStatus {
	const age = invoiceAgeDays(inv);
	if (inv.status === "overdue") return "overdue";
	if ((inv.status === "issued" || inv.status === "partial") && age !== null && age > 0) return "overdue";
	return inv.status;
}

export function buildInvoiceRows(invoices: Invoice[]) {
	return invoices.map((inv) => {
		const status = derivedStatus(inv);
		const balance = invoiceBalance(inv);
		const age = invoiceAgeDays(inv);
		return { inv, status, balance, age };
	});
}

/** Human-readable slot for a calendar booking. */
export function formatBookingWhen(booking: Booking): { date: string; time: string } {
	const at = new Date(booking.startsAt);
	return {
		date: at.toLocaleDateString(undefined, {
			weekday: "long",
			day: "numeric",
			month: "long",
			year: "numeric",
			timeZone: booking.timezone,
		}),
		time: at.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
			timeZone: booking.timezone,
		}),
	};
}

export function taskActionLabel(task: PendingTask): string {
	if (task.action === "assign") return "Assign";
	if (task.action === "assess") return "Assess";
	if (task.action === "reschedule") return "Reschedule";
	if (task.action === "review") return "Review";
	if (task.action === "checklist") return "Checklist";
	if (task.action === "advance") return "Advance visa";
	if (task.action === "docs") return "Documents";
	if (task.action === "invoice") return task.kind === "travel" ? "Raise ticket invoice" : "Invoice";
	if (task.action === "issue") return "Issue invoice";
	if (task.action === "book") return "Record booking";
	if (task.action === "chase") return "Chase payment";
	if (task.action === "followup") return "Follow up";
	if (task.action === "resolve") return "Resolve";
	return task.action;
}

/**
 * Whether the "keep previous handler" shortcut makes sense for a handoff:
 * only where the previous handler's role may own the new stage and the
 * stage is not an owner-class boundary (school handler → visa specialist is
 * a deliberate choice, not a default).
 */
export function handoffOffersKeep(h: StageHandoff, previousStage?: string | null): boolean {
	if (!h.fromOpsUserId) return false;
	if (h.source === "offboarding") return false;
	if (previousStage && isOwnerClassBoundary(previousStage as never, h.stage as never)) return false;
	return h.stage === "school_submission";
}

export const TASK_KIND_LABEL: Record<PendingTask["kind"], string> = {
	booking: "Booking",
	travel: "Travel",
	consultation: "Consultation",
	application: "Application",
	visa: "Visa",
	applicant: "Applicant",
	invoice: "Invoice",
	lead: "Lead",
	handoff: "Handoff",
};

const COMPACT_WHEN =
	typeof Intl !== "undefined"
		? new Intl.DateTimeFormat(undefined, {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
			})
		: null;

/** One-line slot the table can fit in a cell. */
export function formatBookingWhenCompact(booking: Booking): string {
	if (COMPACT_WHEN) {
		try {
			return COMPACT_WHEN.format(new Date(booking.startsAt));
		} catch {
			/* fall through to verbose */
		}
	}
	const w = formatBookingWhen(booking);
	return `${w.date} at ${w.time}`;
}

export type PendingTaskInputs = {
	consultations: MockConsultation[];
	applications: MockApplication[];
	applicants: MockApplicant[];
	handoffs: StageHandoff[];
	/** Travel requests; those in review with no handler need assigning. */
	travelRequests?: TravelAssistanceRequest[];
	/** Derived rows from `buildInvoiceRows`. */
	invoiceRows: ReturnType<typeof buildInvoiceRows>;
	/** Raw invoices, needed for the visa filter. */
	invoices: Invoice[];
	leads: Lead[];
	liveBookingIds: Set<string>;
	/** Booking ids already surfaced as raw booking rows — skip the duplicate consultation row. */
	excludeBookingIds?: Set<string>;
};

export function sortTasks(tasks: PendingTask[]): PendingTask[] {
	return [...tasks].sort((a, b) => {
		if (a.isLive && !b.isLive) return -1;
		if (!a.isLive && b.isLive) return 1;
		return a.priority - b.priority || a.title.localeCompare(b.title);
	});
}

/**
 * Assemble every pending item from the shared cases store into one flat,
 * priority-sorted queue. This is the single source of truth for both the
 * Dashboard "Pending Tasks" panel and the Workspace work queue.
 */
export function buildPendingTasks(inputs: PendingTaskInputs): PendingTask[] {
	const {
		consultations,
		applications,
		applicants,
		handoffs,
		travelRequests = [],
		invoiceRows,
		invoices,
		leads,
		liveBookingIds,
		excludeBookingIds,
	} = inputs;
	const q: PendingTask[] = [];
	const appById = new Map(applications.map((a) => [a.id, a]));
	const excluded = excludeBookingIds ?? new Set<string>();

	for (const c of consultations) {
		const isLive = liveBookingIds.has(c.bookingId || "");
		if (c.status === "Under Review" && !c.assignedOfficer) {
			if (c.bookingId && excluded.has(c.bookingId)) continue;
			q.push({
				id: `c-assign-${c.id}`,
				category: "needs_assignment",
				kind: "consultation",
				action: "assign",
				record: c,
				title: c.applicantName,
				subtitle: `Consultation · ${c.type} · ${c.targetCountry || "—"}`,
				meta: c.dateTime,
				branch: c.branch,
				owner: "Unassigned",
				linkTo: `/consultations?id=${c.id}`,
				priority: PRIORITY.assign_consultation,
				isLive,
			});
		} else if (c.status === "Assigned" || c.status === "Confirmed" || c.status === "In Assessment") {
			q.push({
				id: `c-assess-${c.id}`,
				category: "needs_action",
				kind: "consultation",
				action: "assess",
				record: c,
				title: c.applicantName,
				subtitle: `Ready for assessment · ${c.type} · ${c.targetCountry || "—"}`,
				meta: c.dateTime,
				branch: c.branch,
				owner: c.assignedOfficer || "—",
				linkTo: `/consultations?id=${c.id}`,
				priority: PRIORITY.assess,
				isLive,
			});
		} else if (c.rescheduleRequestedAt) {
			q.push({
				id: `c-res-${c.id}`,
				category: "needs_action",
				kind: "consultation",
				action: "reschedule",
				record: c,
				title: c.applicantName,
				subtitle: `Reschedule requested · ${c.type}`,
				meta: `Requested ${timeAgo(c.rescheduleRequestedAt)}`,
				branch: c.branch,
				owner: c.assignedOfficer || "—",
				linkTo: `/consultations?id=${c.id}`,
				priority: PRIORITY.reschedule,
				isLive,
			});
		}
	}

	// Applications with a pending handoff are already surfaced as handoff tasks
	// (with "Assign" + "Keep previous handler"). Suppress the duplicate
	// `a-assign` task so the manager doesn't see two rows for the same case and
	// accidentally click the one that lacks the "Keep" button.
	const handoffAppIds = new Set(
		handoffs.filter((h) => h.status === "pending" && h.applicationId).map((h) => h.applicationId),
	);

	for (const a of applications) {
		// If there's a pending handoff for this application, ONLY the handoff
		// task should show. The application can't be reviewed, checked, or
		// invoiced until a handler is assigned. Without this, the dashboard
		// shows two conflicting cards for the same case.
		if (handoffAppIds.has(a.id)) continue;
		// A case only needs a handler once the applicant has said yes. Before
		// that (invited / on hold / declined) there is nothing to work on, and
		// assigning someone would only create noise for both sides.
		if (a.proceedStatus && a.proceedStatus !== "accepted") continue;
		if (!a.assignedStaff) {
			q.push({
				id: `a-assign-${a.id}`,
				category: "needs_assignment",
				kind: "application",
				action: "assign",
				record: a,
				title: `${a.applicantName}`,
				subtitle: `Application ${a.appId} · Stage: ${JOURNEY_STAGE_LABELS[a.stage as JourneyStage] || a.stage} · ${a.country || "—"}`,
				meta: stageMeta(a),
				branch: a.branch,
				owner: "Unassigned",
				linkTo: `/applications?id=${a.id}`,
				priority: PRIORITY.assign_application,
			});
		} else if (a.status === "Under Review") {
			q.push({
				id: `a-review-${a.id}`,
				category: "needs_action",
				kind: "application",
				action: "review",
				record: a,
				title: `${a.applicantName}`,
				subtitle: `Application under review · ${a.university || a.country || "—"}`,
				meta: stageMeta(a),
				branch: a.branch,
				owner: a.assignedStaff,
				linkTo: `/applications?id=${a.id}`,
				priority: PRIORITY.review_application,
			});
		} else if (a.checklist.some((i) => !i.checked)) {
			const open = a.checklist.filter((i) => !i.checked).length;
			q.push({
				id: `a-check-${a.id}`,
				category: "needs_action",
				kind: "application",
				action: "checklist",
				record: a,
				title: `${a.applicantName}`,
				subtitle: `${open} open checklist item${open === 1 ? "" : "s"}`,
				meta: stageMeta(a),
				branch: a.branch,
				owner: a.assignedStaff,
				linkTo: `/applications?id=${a.id}`,
				priority: PRIORITY.checklist,
			});
		}
	}

	// Application invoice issuance: if the application has schools selected
	// but the app fee hasn't been paid, the handler needs to issue the invoice.
	// This is independent of the invoice list — it's derived from the application
	// state itself so it shows up even if invoices aren't loaded.
	for (const a of applications) {
		// Skip if there's a pending handoff — the handler hasn't been assigned yet.
		if (handoffAppIds.has(a.id)) continue;
		const hasSchools = (a.schoolApplications?.length ?? 0) > 0;
		if (!hasSchools || a.appFeePaid) continue;
		// Check if there's already a proforma or issued invoice for this application
		// in the invoice list. If there's a proforma, the invoice-level task below
		// will handle it. If there's an issued one, no task needed. If none, we
		// surface an application-level task.
		const appInvoices = invoices.filter(
			(i) => i.type === "Application" && i.applicationId === a.id,
		);
		const hasProforma = appInvoices.some((i) => i.status === "proforma");
		const hasIssued = appInvoices.some((i) => i.status === "issued" || i.status === "partial" || i.status === "paid" || i.status === "overdue");
		if (hasProforma || hasIssued) continue;
		q.push({
			id: `a-invoice-${a.id}`,
			category: "needs_invoice",
			kind: "application",
			action: "review",
			record: a,
			title: `${a.applicantName}`,
			subtitle: `Application invoice needed · ${a.schoolApplications?.length ?? 0} school(s) selected`,
			meta: `App ${a.appId}`,
			branch: a.branch,
			owner: a.assignedStaff || "—",
			linkTo: `/applications?id=${a.id}`,
			priority: PRIORITY.issue,
		});
	}

	for (const a of applications) {
		const visaInv = visaInvoiceFor(invoices, a);
		const stage = a.visaStage ?? "locked";
		if (stage === "decision" && a.visaOutcome === "refused") {
			q.push({
				id: `v-refused-${a.id}`,
				category: "needs_action",
				kind: "visa",
				action: "advance",
				record: a,
				title: a.applicantName,
				subtitle: `Visa refused · advise the applicant, then reopen for reapplication or close · ${a.university || a.country || "—"}`,
				meta: a.appId,
				branch: a.branch,
				owner: a.assignedStaff || "—",
				linkTo: `/visa?id=${a.id}`,
				priority: PRIORITY.review_application,
			});
		} else if (stage === "pending" || stage === "biometrics" || stage === "decision") {
			q.push({
				id: `visa-adv-${a.id}`,
				category: "needs_action",
				kind: "visa",
				action: "advance",
				record: a,
				title: a.applicantName,
				subtitle: `Visa processing · ${VISA_STEP_LABELS[stage] ?? stage} · ${a.university || a.country || "—"}`,
				meta: `App ${a.appId}`,
				branch: a.branch,
				owner: a.assignedStaff || "—",
				linkTo: `/visa?id=${a.id}`,
				priority: PRIORITY.review_application,
			});
		} else if (stage === "locked" && visaInv && visaInv.status !== "void") {
			const balance = invoiceBalance(visaInv);
			if (visaInv.status === "proforma" && balance > 0) {
				q.push({
					id: `visa-inv-${a.id}`,
					category: "needs_invoice",
					kind: "visa",
					action: "issue",
					record: a,
					title: a.applicantName,
					subtitle: `Visa proforma to issue · ${fmtGhs(visaInv.subtotal)}`,
					meta: visaInv.invoiceNumber,
					branch: a.branch,
					owner: visaInv.issuedBy || a.assignedStaff || "—",
					linkTo: `/visa?id=${a.id}`,
					priority: PRIORITY.issue,
				});
			} else if (balance > 0) {
				q.push({
					id: `visa-chase-${a.id}`,
					category: "needs_invoice",
					kind: "visa",
					action: "chase",
					record: a,
					title: a.applicantName,
					subtitle: `Visa invoice ${visaInv.invoiceNumber} · ${fmtGhs(balance)} due`,
					meta: `App ${a.appId}`,
					branch: a.branch,
					owner: visaInv.issuedBy || a.assignedStaff || "—",
					linkTo: `/visa?id=${a.id}`,
					priority: PRIORITY.chase,
				});
			}
		}
	}

	for (const h of handoffs) {
		if (h.status !== "pending") continue;
		const stageLabel =
			h.stage === "visa_processing"
				? "Visa specialist"
				: h.stage
						.split("_")
						.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
						.join(" ");
		const handoffApp = h.applicationId ? appById.get(h.applicationId) : undefined;
		q.push({
			id: `handoff-${h.id}`,
			category: "needs_assignment",
			kind: "handoff",
			action: "resolve",
			record: h,
			title: h.applicantName ?? "Applicant",
			subtitle: `Assignment required · ${stageLabel}${h.source === "visa_payment" ? " · payment received" : ""}${h.source === "deposit_payment" ? " · 10% deposit received" : ""}${h.source === "offboarding" ? " · previous handler left" : ""}`,
			meta: `${h.stage === "visa_processing" ? "Visa processing" : h.stage} · ${h.deferCount > 0 ? `deferred ${h.deferCount}×` : "awaiting decision"}`,
			branch: handoffApp?.branch ?? "",
			owner: h.fromOpsUserName ?? "No previous handler",
			linkTo: h.stage === "visa_processing" ? `/visa?id=${h.applicationId}` : `/applications?id=${h.applicationId}`,
			priority: PRIORITY.assign_consultation,
		});
	}

	// Travel requests, each step of the way. The applicant said "yes, help me
	// book"; from there the work moves handler → manager → applicant and
	// every ops step is a task here, not just a card on the Travel page:
	//   review, no handler   → assign one (unless a handoff already asks)
	//   review, handler      → the handler raises the ticket invoice
	//   invoiced (proforma)  → finance issues it (a task for whoever holds invoices)
	//   ticket_paid          → the handler records the booking
	for (const ta of travelRequests) {
		const app = appById.get(ta.applicationId);
		const title = ta.applicantName ?? app?.applicantName ?? "Applicant";
		const ref = ta.applicationReference ?? app?.appId ?? "";
		const base = { record: ta, title, branch: app?.branch ?? "", linkTo: `/travel?id=${ta.applicationId}` } as const;
		if (ta.status === "review" && !ta.assignedOpsUserId) {
			if (handoffAppIds.has(ta.applicationId)) continue;
			q.push({
				...base,
				id: `travel-${ta.id}`,
				category: "needs_assignment",
				kind: "travel",
				action: "assign",
				subtitle: `Travel officer needed · ${ref}`,
				meta: "Client asked us to book their flight",
				owner: "Unassigned",
				priority: PRIORITY.assign_application,
			});
		} else if (ta.status === "review" && ta.assignedOpsUserId && !ta.invoiceId) {
			q.push({
				...base,
				id: `travel-invoice-${ta.id}`,
				category: "needs_invoice",
				kind: "travel",
				action: "invoice",
				subtitle: `Ticket invoice to raise · ${ref}`,
				meta: "Client is waiting for their ticket invoice",
				owner: ta.assignedOpsUserName ?? "Owner",
				priority: PRIORITY.issue,
			});
		} else if (ta.status === "invoiced" && ta.invoiceId) {
			const inv = invoices.find((i) => i.id === ta.invoiceId);
			if (inv?.status === "proforma") {
				q.push({
					...base,
					id: `travel-issue-${ta.id}`,
					category: "needs_invoice",
					kind: "travel",
					action: "issue",
					subtitle: `Ticket invoice to issue · ${ref}`,
					meta: "Client cannot pay until finance issues it",
					owner: "Finance",
					linkTo: `/invoices?open=${ta.invoiceId}`,
					priority: PRIORITY.issue,
				});
			}
		} else if (ta.status === "ticket_paid") {
			q.push({
				...base,
				id: `travel-book-${ta.id}`,
				category: "needs_action",
				kind: "travel",
				action: "book",
				subtitle: `Flight to book · ${ref}`,
				meta: "Ticket paid — record the booking once the airline confirms",
				owner: ta.assignedOpsUserName ?? "Owner",
				priority: PRIORITY.review_application,
			});
		}
	}

	for (const app of applicants) {
		const pendingDocs = app.documents.filter((d) => d.status === "Pending Review").length;
		if (pendingDocs > 0) {
			q.push({
				id: `app-docs-${app.id}`,
				category: "needs_action",
				kind: "applicant",
				action: "docs",
				record: app,
				title: app.name,
				subtitle: `${pendingDocs} document${pendingDocs === 1 ? "" : "s"} pending review`,
				meta: `Stage: ${app.currentStage}`,
				branch: app.branch,
				owner: app.assignedOfficer || "—",
				linkTo: `/applicants?id=${app.id}`,
				priority: PRIORITY.docs,
			});
		}

		const outstanding = money(app.financials.outstanding);
		if (outstanding > 0) {
			const hasOpenInvoice = invoiceRows.some(
				(r) => r.inv.applicantName === app.name && r.status !== "paid" && r.status !== "void",
			);
			if (!hasOpenInvoice) {
				q.push({
					id: `app-inv-${app.id}`,
					category: "needs_invoice",
					kind: "applicant",
					action: "invoice",
					record: app,
					title: app.name,
					subtitle: `Outstanding balance · ${fmtGhs(outstanding)}`,
					meta: `Plan: ${app.financials.plan || "—"}`,
					branch: app.branch,
					owner: app.assignedOfficer || "—",
					linkTo: `/invoices`,
					priority: PRIORITY.invoice,
				});
			}
		}
	}

	for (const r of invoiceRows) {
		if (r.status === "proforma") {
			q.push({
				id: `inv-issue-${r.inv.id}`,
				category: "needs_invoice",
				kind: "invoice",
				action: "issue",
				record: r.inv,
				title: r.inv.applicantName,
				subtitle: `Proforma invoice · ${fmtGhs(r.inv.subtotal)}`,
				meta: r.inv.invoiceNumber,
				branch: "",
				owner: r.inv.issuedBy || "—",
				linkTo: `/invoices`,
				priority: PRIORITY.issue,
			});
		}
		if (r.status === "overdue") {
			q.push({
				id: `inv-chase-${r.inv.id}`,
				category: "needs_invoice",
				kind: "invoice",
				action: "chase",
				record: r.inv,
				title: r.inv.applicantName,
				subtitle: `Overdue · balance ${fmtGhs(r.balance)}`,
				meta: `Due ${r.age ?? "?"} day${r.age === 1 ? "" : "s"} ago`,
				branch: "",
				owner: r.inv.issuedBy || "—",
				linkTo: `/invoices`,
				priority: PRIORITY.chase,
			});
		}
	}

	for (const lead of leads) {
		if (lead.stage === "new" || lead.stage === "contacted") {
			q.push({
				id: `lead-${lead.id}`,
				category: "needs_followup",
				kind: "lead",
				action: "followup",
				record: lead,
				title: lead.name,
				subtitle: `${LEAD_STAGE_LABELS[lead.stage] ?? lead.stage} · ${lead.country || "Ghana"}`,
				meta: `Last contact ${timeAgo(lead.lastContactAt)}`,
				branch: "",
				owner: lead.assignedTo || "Unassigned",
				linkTo: `/leads`,
				priority: PRIORITY.followup,
			});
		}
	}

	return sortTasks(q);
}

/**
 * The pending tasks for one application — the same rules as the dashboard,
 * scoped to one case, so a handler who opens the case from a task sees the
 * same next step they were sent to do. Consultation, applicant and lead
 * tasks are not case-scoped and are left out.
 */
export function tasksForApplication(
	app: MockApplication,
	inputs: Pick<PendingTaskInputs, "handoffs" | "travelRequests" | "invoices">,
): PendingTask[] {
	const all = buildPendingTasks({
		consultations: [],
		applications: [app],
		applicants: [],
		handoffs: inputs.handoffs.filter((h) => h.applicationId === app.id),
		travelRequests: (inputs.travelRequests ?? []).filter((t) => t.applicationId === app.id),
		invoiceRows: buildInvoiceRows(inputs.invoices.filter((i) => i.applicationId === app.id)),
		invoices: inputs.invoices,
		leads: [],
		liveBookingIds: new Set(),
	});
	return all.filter((t) => {
		switch (t.kind) {
			case "application":
			case "visa":
				return t.record.id === app.id;
			case "handoff":
			case "travel":
			case "invoice":
				return t.record.applicationId === app.id;
			default:
				return false;
		}
	});
}
