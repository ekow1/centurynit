import { LEAD_STAGE_LABELS, type Lead } from "century-nit-core";
import { applicationsApi } from "century-nit-core/api";
import type {
	MockConsultation,
	MockApplication,
	MockApplicant,
	Invoice,
	InvoiceStatus,
	Assignee,
} from "century-nit-core/ops";
import type { HandlerPlacement } from "../pages/case/AssignSheet";
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
			action: "advance" | "issue" | "chase" | "invoice";
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

export type PendingTask = (BaseTask | BookingTask) & {
	isLive?: boolean;
	/** When the task is dated — the record's last change, or the moment it asked
	 * for something (a reschedule, a due date). Shown in the queue's When column. */
	at?: string;
	/**
	 * A real deadline, where the work has one: the consultation slot, the
	 * invoice due date. Most tasks have none — they are due when they land.
	 * "Today" and "Overdue" read this, never `at`.
	 */
	due?: string | null;
	/** Itemised detail for the preview pane — label left, status note right;
	 * the table never shows it. */
	details?: { label: string; note?: string }[];
};

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

/** The consultation's slot as an instant, when the record carries one. */
function slotIso(c: { slotDate?: string; slotTime?: string }): string | null {
	if (!c.slotDate) return null;
	const d = new Date(`${c.slotDate}T${c.slotTime || "09:00"}:00`);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ── The day's cuts ──────────────────────────────────────────────────────── */

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Due today: a deadline that falls today, or a meeting live right now. */
export function isDueToday(task: PendingTask, now = new Date()): boolean {
	if (task.isLive) return true;
	if (!task.due) return false;
	const d = new Date(task.due);
	return !Number.isNaN(d.getTime()) && sameDay(d, now);
}

/** Overdue: a deadline that has passed and the work is still open. */
export function isOverdue(task: PendingTask, now = new Date()): boolean {
	if (!task.due || task.isLive) return false;
	const d = new Date(task.due);
	if (Number.isNaN(d.getTime())) return false;
	// A slot earlier today is missed, not merely "today".
	return d.getTime() < now.getTime() && !(sameDay(d, now) && d.getTime() > now.getTime() - 60 * 60_000);
}

/**
 * The queue's ordering made legible: three notches from the task's priority
 * rank (1 = assign a consultation … 11 = follow up a lead). Ink density,
 * not colour — ●●● urgent, ●●○ soon, ●○○ routine.
 */
export function priorityNotches(priority: number): 1 | 2 | 3 {
	if (priority <= 3) return 3;
	if (priority <= 7) return 2;
	return 1;
}

/**
 * The queue read as a day: what is due today, what has slipped, and the
 * rest. Overdue wins over today — a slot missed this morning is a miss,
 * not an item on the day's list.
 */
export type QueueBand = "today" | "overdue" | "rest";
export const QUEUE_BAND_LABEL: Record<QueueBand, string> = {
	today: "Today",
	overdue: "Overdue",
	rest: "Everything else",
};
export function queueBand(task: PendingTask, now = new Date()): QueueBand {
	if (isOverdue(task, now)) return "overdue";
	if (isDueToday(task, now)) return "today";
	return "rest";
}

/** The queue's When column: a short absolute stamp; the year only when it isn't this one. */
export function whenLabel(iso?: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (isNaN(d.getTime())) return "—";
	const thisYear = d.getFullYear() === new Date().getFullYear();
	return d.toLocaleString(undefined, { day: "numeric", month: "short", ...(thisYear ? {} : { year: "numeric" }), hour: "2-digit", minute: "2-digit" });
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

/** The when-cell label from a due date: what it actually is, not task age. */
export function dueLabel(due: string | null): string {
	if (!due) return "—";
	const days = Math.floor((Date.now() - new Date(due).getTime()) / 86_400_000);
	if (days > 1) return `${days}d overdue`;
	if (days === 1) return "overdue yesterday";
	if (days === 0) return "due today";
	return `due in ${Math.abs(days)}d`;
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
	// Staffing asks — a handoff is just the next chapter asking for a
	// handler, not a separate kind of work.
	if (task.action === "assign" || task.action === "resolve") return "Needs handler";
	if (task.action === "assess") return "Assess";
	if (task.action === "reschedule") return "Reschedule";
	if (task.action === "review") return "Review";
	if (task.action === "checklist") return "Checklist";
	if (task.action === "advance") return "Advance visa";
	if (task.action === "docs") return "Documents";
	if (task.action === "invoice") return task.kind === "travel" ? "Raise ticket invoice" : task.kind === "visa" ? "Raise visa invoice" : "Invoice";
	if (task.action === "issue") return "Issue invoice";
	if (task.action === "book") return "Record booking";
	if (task.action === "chase") return "Chase payment";
	if (task.action === "followup") return "Follow up";
	return task.action;
}

/** Who currently holds the seat — the case owner, else the stage-scoped handler. */
export function caseHandlerName(a: MockApplication): string {
	if (a.assignedStaff) return a.assignedStaff;
	const stageSeat = (a.stageHandlers ?? []).find((h) => h.stage === a.stage);
	return stageSeat?.opsUserName ?? "";
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
	handoff: "Stage",
};

/** The kind label with the handoff folded into the stage it asks to staff. */
export function taskKindLabel(task: PendingTask): string {
	if (task.kind !== "handoff") return TASK_KIND_LABEL[task.kind];
	return JOURNEY_STAGE_LABELS[task.record.stage as JourneyStage] ??
		task.record.stage.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

/**
 * A task's own reference — used in place of the client name when the row
 * already sits under a client separator, so the title stops repeating it.
 */
export function taskRef(task: PendingTask): string {
	switch (task.kind) {
		case "invoice":
			return task.record.invoiceNumber;
		case "application":
		case "visa":
			return task.record.appId ?? task.record.id;
		case "consultation":
			return task.record.ref ?? task.record.id;
		case "handoff":
			return task.record.applicationNumber ?? task.record.applicationId;
		case "travel":
			return task.record.applicationReference ?? task.record.applicationId;
		case "booking":
			return task.record.reference;
		default:
			// applicant, lead — no human reference exists; the subtitle is what
			// tells these tasks apart under a client separator, never a uuid.
			return task.subtitle;
	}
}

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
				owner: "— open",
				linkTo: `/consultations?id=${c.id}`,
				at: c.updatedAt,
				due: slotIso(c),
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
				at: c.updatedAt,
				due: slotIso(c),
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
				at: c.rescheduleRequestedAt ?? c.updatedAt,
				due: slotIso(c),
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
		// The seat is filled by either the whole-case owner or a stage-scoped
		// handler covering the chapter the case is actually in.
		const stageSeated = (a.stageHandlers ?? []).some((h) => h.stage === a.stage);
		if (!a.assignedStaff && !stageSeated) {
			q.push({
				id: `a-assign-${a.id}`,
				category: "needs_assignment",
				kind: "application",
				action: "assign",
				record: a,
				title: `${a.applicantName}`,
				subtitle: `Needs handler · ${JOURNEY_STAGE_LABELS[a.stage as JourneyStage] || a.stage} · ${a.country || "—"}`,
				meta: stageMeta(a),
				branch: a.branch,
				owner: "— open",
				linkTo: `/applications?id=${a.id}`,
				at: a.updatedAt,
				priority: PRIORITY.assign_application,
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
				owner: caseHandlerName(a),
				linkTo: `/applications?id=${a.id}`,
				at: a.updatedAt,
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
			subtitle: `Application invoice needed · ${a.schoolApplications?.length ?? 0} ${(a.schoolApplications?.length ?? 0) === 1 ? "school" : "schools"} selected`,
			meta: `App ${a.appId}`,
			branch: a.branch,
			owner: caseHandlerName(a) || "—",
			linkTo: `/applications?id=${a.id}`,
			at: a.updatedAt,
			priority: PRIORITY.issue,
		});
	}

	for (const a of applications) {
		const visaInv = visaInvoiceFor(invoices, a);
		const stage = a.visaStage ?? "locked";
		// The chapter is open but no live visa invoice exists — the auto-raise
		// missed it, or it was declined. Someone has to raise it before the
		// embassy work can be paid for.
		const liveVisaInv = visaInv && visaInv.status !== "void" ? visaInv : undefined;
		if (stage !== "locked" && stage !== "complete" && !a.visaInvoicePaid && !liveVisaInv && !handoffAppIds.has(a.id)) {
			q.push({
				id: `visa-raise-${a.id}`,
				category: "needs_invoice",
				kind: "visa",
				action: "invoice",
				record: a,
				title: a.applicantName,
				subtitle: `Visa invoice to raise · the destination's fees at cost · ${a.university || a.country || "—"}`,
				meta: `App ${a.appId}`,
				branch: a.branch,
				owner: caseHandlerName(a) || "—",
				linkTo: `/applications?chapter=visa&id=${a.id}`,
				at: a.updatedAt,
				priority: PRIORITY.issue,
			});
		}
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
				owner: caseHandlerName(a) || "—",
				linkTo: `/applications?chapter=visa&id=${a.id}`,
				at: a.updatedAt,
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
				owner: caseHandlerName(a) || "—",
				linkTo: `/applications?chapter=visa&id=${a.id}`,
				at: a.updatedAt,
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
					owner: visaInv.issuedBy || caseHandlerName(a) || "—",
					linkTo: `/applications?chapter=visa&id=${a.id}`,
					at: a.updatedAt,
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
					owner: visaInv.issuedBy || caseHandlerName(a) || "—",
					linkTo: `/applications?chapter=visa&id=${a.id}`,
					at: a.updatedAt,
					priority: PRIORITY.chase,
				});
			}
		}
	}

	for (const h of handoffs) {
		if (h.status !== "pending") continue;
		// A pending handoff is not a separate kind of work — it is the next
		// chapter asking for a handler. The kicker reads "Needs handler ·
		// {stage}" like any other placement row; the previous handler and the
		// reason it parked are context on the fact line, and the seat is open.
		const stageLabel =
			h.stage === "visa_processing"
				? "Visa processing"
				: h.stage
						.split("_")
						.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
						.join(" ");
		const handoffApp = h.applicationId ? appById.get(h.applicationId) : undefined;
		const was = h.fromOpsUserName ? `was ${h.fromOpsUserName}` : "no previous handler";
		q.push({
			id: `handoff-${h.id}`,
			category: "needs_assignment",
			kind: "handoff",
			action: "resolve",
			record: h,
			title: h.applicantName ?? "Applicant",
			subtitle: `${stageLabel}${h.source === "visa_payment" ? " · payment received" : ""}${h.source === "deposit_payment" ? " · 10% deposit received" : ""} · ${was}${h.source === "offboarding" ? " — left" : ""}${h.reason ? ` · “${h.reason}”` : ""}`,
			meta: h.deferCount > 0 ? `deferred ${h.deferCount}×` : "awaiting decision",
			branch: handoffApp?.branch ?? "",
			owner: "— open",
			linkTo: h.stage === "visa_processing" ? `/applications?chapter=visa&id=${h.applicationId}` : `/applications?id=${h.applicationId}`,
			at: h.deferredAt ?? h.createdAt,
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
		const base = { record: ta, title, branch: app?.branch ?? "", linkTo: `/applications?chapter=depart&id=${ta.applicationId}`, at: ta.updatedAt } as const;
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
				owner: "— open",
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
				meta: "Quote approved — client is waiting for their ticket invoice",
				owner: ta.assignedOpsUserName ?? "—",
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
					subtitle: `Ticket invoice awaiting approval · ${ref}`,
					meta: "Approve on the case — the client cannot see it until it is issued",
					owner: "Finance",
					linkTo: `/applications?id=${ta.applicationId}&tab=travel`,
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
				owner: ta.assignedOpsUserName ?? "—",
				priority: PRIORITY.review_application,
			});
		}
	}

	// The standard documents are collected at consultation and verified
	// before anything is invoiced. An enrolled case with any outstanding is
	// a task for its consultant, ahead of the invoice it is holding up.
	for (const a of applications) {
		if (a.proceedStatus !== "accepted") continue;
		const outstanding = (a.documentChecklist ?? []).filter((d) => d.status !== "VERIFIED");
		if (outstanding.length === 0) continue;
		const toReview = outstanding.filter((d) => d.status === "UPLOADED").length;
		q.push({
			id: `a-docs-${a.id}`,
			category: toReview > 0 ? "needs_action" : "needs_followup",
			kind: "application",
			action: "checklist",
			record: a,
			title: a.applicantName,
			subtitle:
				toReview > 0
					? `${toReview} document${toReview === 1 ? "" : "s"} to verify · ${outstanding.length} outstanding`
					: `${outstanding.length} document${outstanding.length === 1 ? "" : "s"} not uploaded yet`,
			// One line for the table (clamped there); the pane gets the list.
			meta: `${outstanding.length} outstanding: ${outstanding.map((d) => d.name).join(", ")}`,
			details: outstanding.map((d) => ({
				label: d.name,
				note:
					d.status === "UPLOADED"
						? "To verify"
						: d.status === "REJECTED"
							? "Re-upload needed"
							: "Not uploaded",
			})),
			branch: a.branch,
			owner: caseHandlerName(a) || "—",
			linkTo: `/applications?id=${a.id}&tab=documents`,
			at: a.updatedAt,
			priority: toReview > 0 ? PRIORITY.review_application : PRIORITY.chase,
		});
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
				at: app.updatedAt,
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
					at: app.updatedAt,
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
				subtitle: `Awaiting approval · ${fmtGhs(r.inv.subtotal)}`,
				meta: `${r.inv.invoiceNumber} · raised by ${r.inv.issuedBy || "—"}`,
				branch: "",
				owner: "Finance",
				// Approval happens on the case; only an invoice with no case is approved from the ledger.
				linkTo: r.inv.applicationId ? `/applications?id=${r.inv.applicationId}&tab=payments` : `/invoices?open=${r.inv.id}`,
				at: r.inv.issuedAt,
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
				subtitle: `Balance ${fmtGhs(r.balance)}`,
				meta: r.inv.dueAt
					? `due ${new Date(r.inv.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
					: "no due date",
				branch: "",
				owner: r.inv.issuedBy || "—",
				linkTo: `/invoices`,
				at: r.inv.dueAt ?? r.inv.issuedAt,
				due: r.inv.dueAt ?? null,
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
				owner: lead.assignedTo || "— open",
				linkTo: `/leads`,
				at: lead.lastContactAt,
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
	// A completed or rejected case is closed — no task may be raised on it,
	// including a stale pending handoff.
	if (app.stage === "completed" || app.status === "Rejected") return [];
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

/** What placing a handler can call — the useCases() verbs. The queue row,
 * the preview pane and the caseload card all dispatch through this so the
 * kind-switch can't drift between copies. */
export type AssignActions = {
	assignConsultation: (id: string, to: Assignee, opts?: { scope?: "stage" | "all"; branch?: string }) => Promise<unknown>;
	assignApplication: (id: string, to: Assignee, opts?: { scope?: "stage" | "all"; branch?: string }) => Promise<unknown>;
	resolveHandoff: (
		handoffId: string,
		decision: "keep" | "assign",
		opts?: { opsUserId?: string; reason?: string; scope?: "stage" | "all"; branch?: string },
	) => Promise<unknown>;
};

export async function assignPendingTask(
	task: PendingTask,
	to: Assignee,
	placement: HandlerPlacement,
	actions: AssignActions,
): Promise<void> {
	if (task.kind === "consultation") {
		await actions.assignConsultation(task.record.id, to, { scope: placement.scope, branch: placement.branch });
		return;
	}
	if (task.kind === "application") {
		await actions.assignApplication(task.record.id, to, { scope: placement.scope, branch: placement.branch });
		return;
	}
	if (task.kind === "handoff" && task.action === "resolve") {
		await actions.resolveHandoff(task.record.id, "assign", {
			opsUserId: to.opsUserId,
			reason: placement.reason,
			scope: placement.scope,
			branch: placement.branch,
		});
		return;
	}
	if (task.kind === "travel" && to.opsUserId) {
		await applicationsApi.assignTravelHandler(task.record.id, to.opsUserId);
		return;
	}
	throw new Error("This task cannot be assigned from here.");
}
