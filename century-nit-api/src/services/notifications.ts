import { formatInZone } from "../lib/time.js";
import { env } from "../env.js";
import {
	renderBookingEmail,
	renderConsultantAssignedEmail,
	renderDocumentReviewedEmail,
	renderInvoiceRaisedEmail,
	renderWelcomeEmail,
} from "../lib/email-templates.js";


/**
 * Scheduling notifications.
 *
 * Reuses the existing Resend wrapper and the existing BullMQ `emailQueue` — no
 * second notification system (§17). Until now nothing enqueued anything, so this
 * is the first producer for a worker that was already wired and idle.
 *
 * Everything is queued rather than sent inline. §13 is explicit that a failed
 * email must not roll back a successful booking, and a queue is what makes that
 * true: the booking commits, the email retries on its own schedule.
 */

export type BookingNotificationContext = {
	/**
	 * Booking row id — keys every idempotencyKey. References recycle when
	 * rows are deleted and the sequence restarts (CNS-2026-0001 twice); the
	 * UUID never does, so a ghost job can't suppress a new booking's emails.
	 */
	id: string;
	reference: string;
	serviceName: string;
	startsAt: Date;
	/** Rendered per recipient, so each sees their own local time (§15). */
	clientTimezone: string;
	employeeTimezone: string;
	durationMinutes: number;
	clientName: string;
	clientEmail: string;
	employeeName?: string | null;
	employeeEmail?: string | null;
	meetingUrl?: string | null;
	/** "daily" | "google_meet" | null — decides what the email's join button points at. */
	meetingProvider?: string | null;
	branchName?: string;
	reason?: string | null;
	/** The note a handler wrote on a check-in — shown to the client verbatim. */
	note?: string | null;
	/** iCal feed URL for the employee's personal calendar subscription (optional). */
	calendarSubscriptionUrl?: string | null;
};

export type QueuedEmail = {
	to: string;
	subject: string;
	text: string;
	html: string;
	/** §14 — the queue drops a duplicate rather than sending twice. */
	idempotencyKey: string;
	/** Human-readable template name for the notification log (e.g. "Booking created"). */
	template?: string;
	/** Business reference (booking ref, consultation ref) for the notification log. */
	reference?: string;
	/**
	 * Attachments for the worker. `path` is sent as-is; `key` is a document-
	 * storage object key the worker resolves to a fresh download URL at send
	 * time. `content` is a Base64-encoded string representing a file buffer.
	 */
	attachments?: Array<{ filename: string; path?: string; key?: string; content?: string }>;
};

function formatEmail(title: string, lines: string[], meetingUrl?: string | null, reference?: string): { html: string; text: string } {
	return renderBookingEmail({ title, lines, meetingUrl, reference });
}

/**
 * Where an email's "Join" button should send this recipient.
 *
 * Daily rooms are private — the bare room URL opens "This meeting is not
 * available yet" for everyone, because entry needs a token minted by
 * /bookings/:id/join. Putting a token in an email would be worse (a forwarded
 * email is a forwarded identity). So for Daily bookings the button goes to
 * the portal/console page whose Join button mints a fresh token for the
 * signed-in person — always works, never leaks.
 *
 * Google Meet and manual links work directly, so they pass through unchanged.
 */
function joinCtaUrl(ctx: BookingNotificationContext, recipient: "client" | "employee"): string | null {
	if (!ctx.meetingUrl) return null;
	if (ctx.meetingProvider === "daily" || ctx.meetingProvider === "livekit") {
		return recipient === "client"
			? `${env.FRONTEND_URL}/portal/consultation`
			: `${env.CONSOLE_URL}/consultations`;
	}
	return ctx.meetingUrl;
}

/** The join instruction line that matches the CTA above. */
function joinHint(ctx: BookingNotificationContext): string {
	return ctx.meetingProvider === "daily" || ctx.meetingProvider === "livekit"
		? "Open the link below and press Join — the meeting room opens 15 minutes before your slot."
		: "Please use the link below to join the video session at your scheduled time.";
}

/* ── Message builders ────────────────────────────────────────────────────── */

/**
 * Booking received. Goes to the client, and deliberately does NOT claim an
 * employee has been assigned (§1) — nobody has been at this point.
 */
export function bookingCreatedForClient(ctx: BookingNotificationContext): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.clientTimezone);
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`We have received your booking for <strong>${ctx.serviceName}</strong>.`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		"A team member will be assigned to your appointment and you will receive the meeting details once that is done.",
	];
	const { html, text } = formatEmail("Your appointment has been received", lines, null, ctx.reference);
	return {
		to: ctx.clientEmail,
		subject: `Booking received · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:created:client:${ctx.id}`,
		template: "Booking received",
		reference: ctx.reference,
	};
}

/** Booking received. Goes to whoever triages the unassigned queue. */
export function bookingCreatedForManagers(
	ctx: BookingNotificationContext,
	managerEmail: string,
): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.employeeTimezone);
	const lines = [
		`A new booking is waiting to be assigned.`,
		`<strong>Client:</strong> ${ctx.clientName} (${ctx.clientEmail})`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>Reference:</strong> ${ctx.reference}`,
	];
	const { html, text } = formatEmail("New booking awaiting assignment", lines, null, ctx.reference);
	return {
		to: managerEmail,
		subject: `Unassigned booking · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:created:manager:${ctx.id}:${managerEmail}`,
		template: "New booking awaiting assignment",
		reference: ctx.reference,
	};
}

/** Employee assigned — the message that carries the Meet link. */
export function bookingAssignedForClient(ctx: BookingNotificationContext): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.clientTimezone);
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`Your appointment is confirmed.`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>With:</strong> ${ctx.employeeName ?? "your consultant"}`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		...(ctx.note ? [`<strong>Note from your team:</strong> ${ctx.note}`] : []),
	];
	const { html, text } = formatEmail("Your appointment is confirmed", lines, joinCtaUrl(ctx, "client"), ctx.reference);
	return {
		to: ctx.clientEmail,
		subject: `Appointment confirmed · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:assigned:client:${ctx.id}:${ctx.employeeEmail ?? ""}`,
		template: "Appointment confirmed",
		reference: ctx.reference,
	};
}

/** Meeting URL added or updated by operations staff. */
export function bookingMeetingUrlSetForClient(ctx: BookingNotificationContext): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.clientTimezone);
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`The video meeting link for your consultation has been updated.`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>With:</strong> ${ctx.employeeName ?? "your consultant"}`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		joinHint(ctx),
	];
	const { html, text } = formatEmail("Your consultation meeting link is ready", lines, joinCtaUrl(ctx, "client"), ctx.reference);
	return {
		to: ctx.clientEmail,
		subject: `Meeting link ready · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:meeting_url:${ctx.id}:${Date.now()}`,
		template: "Meeting link ready",
		reference: ctx.reference,
	};
}

/** Landed at slot confirmation — the moment the time is actually locked in. */
export function bookingSlotConfirmedForClient(ctx: BookingNotificationContext): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.clientTimezone);
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`Your consultation slot has been confirmed.`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>With:</strong> ${ctx.employeeName ?? "your consultant"}`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		...(ctx.meetingUrl
			? [joinHint(ctx)]
			: ["We will share the meeting link closer to the time."]),
	];
	const { html, text } = formatEmail("Consultation slot confirmed", lines, joinCtaUrl(ctx, "client"), ctx.reference);
	return {
		to: ctx.clientEmail,
		subject: `Consultation slot confirmed · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:confirmed:client:${ctx.id}`,
		template: "Consultation slot confirmed",
		reference: ctx.reference,
	};
}

export function bookingAssignedForEmployee(ctx: BookingNotificationContext): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.employeeTimezone);
	const lines = [
		`Hi <strong>${ctx.employeeName ?? "there"}</strong>,`,
		`You have been assigned a consultation.`,
		`<strong>Client:</strong> ${ctx.clientName} (${ctx.clientEmail})`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>Reference:</strong> ${ctx.reference}`,
	];
	const { html, text } = formatEmail("A consultation has been assigned to you", lines, joinCtaUrl(ctx, "employee"), ctx.reference);
	return {
		to: ctx.employeeEmail ?? "",
		subject: `New consultation assigned · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:assigned:employee:${ctx.id}:${ctx.employeeEmail ?? ""}`,
		template: "Consultation assigned",
		reference: ctx.reference,
	};
}

/** Consultation assigned without a booking (no scheduled time yet). */
export function consultationAssigned(ctx: {
	/** Consultation row id — keys the dedup; references recycle. */
	entityId?: string;
	reference: string;
	clientName: string;
	clientEmail: string;
	employeeName: string;
	employeeEmail: string;
}): QueuedEmail {
	const lines = [
		`Hi <strong>${ctx.employeeName}</strong>,`,
		`A consultation has been assigned to you.`,
		`<strong>Client:</strong> ${ctx.clientName} (${ctx.clientEmail})`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		`Log in to the Operations Center to review the case and schedule a slot.`,
	];
	const { html, text } = formatEmail("A consultation has been assigned to you", lines, null, ctx.reference);
	return {
		to: ctx.employeeEmail,
		subject: `New consultation assigned · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:consultation:assigned:${ctx.entityId ?? ctx.reference}:${ctx.employeeEmail}`,
		template: "Consultation assigned",
		reference: ctx.reference,
	};
}

export function bookingRescheduled(
	ctx: BookingNotificationContext,
	recipient: "client" | "employee",
): QueuedEmail {
	const isClient = recipient === "client";
	const to = isClient ? ctx.clientEmail : (ctx.employeeEmail ?? "");
	const zone = isClient ? ctx.clientTimezone : ctx.employeeTimezone;
	const when = formatInZone(ctx.startsAt, zone);
	const lines = [
		isClient ? `Hi <strong>${ctx.clientName}</strong>,` : `Hi <strong>${ctx.employeeName ?? "there"}</strong>,`,
		`This appointment has been moved.`,
		`<strong>New time:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		...(ctx.reason ? [`<strong>Reason:</strong> ${ctx.reason}`] : []),
		`<strong>Reference:</strong> ${ctx.reference}`,
		"The meeting link below is unchanged.",
	];
	const { html, text } = formatEmail("Your appointment has moved", lines, joinCtaUrl(ctx, isClient ? "client" : "employee"), ctx.reference);
	return {
		to,
		subject: `Appointment rescheduled · ${ctx.reference}`,
		html,
		text,
		// Keyed on the new time, so each distinct reschedule notifies once.
		idempotencyKey: `notify:rescheduled:${recipient}:${ctx.id}:${ctx.startsAt.toISOString()}`,
		template: "Appointment rescheduled",
		reference: ctx.reference,
	};
}

export function bookingCancelled(
	ctx: BookingNotificationContext,
	recipient: "client" | "employee",
): QueuedEmail {
	const isClient = recipient === "client";
	const to = isClient ? ctx.clientEmail : (ctx.employeeEmail ?? "");
	const zone = isClient ? ctx.clientTimezone : ctx.employeeTimezone;
	const lines = [
		isClient ? `Hi <strong>${ctx.clientName}</strong>,` : `Hi <strong>${ctx.employeeName ?? "there"}</strong>,`,
		`The appointment on <strong>${formatInZone(ctx.startsAt, zone)}</strong> has been cancelled.`,
		...(ctx.reason ? [`<strong>Reason:</strong> ${ctx.reason}`] : []),
		`<strong>Reference:</strong> ${ctx.reference}`,
		"The meeting link is no longer valid.",
	];
	const { html, text } = formatEmail("Appointment cancelled", lines, null, ctx.reference);
	return {
		to,
		subject: `Appointment cancelled · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:cancelled:${recipient}:${ctx.id}`,
		template: "Appointment cancelled",
		reference: ctx.reference,
	};
}

/** Free rebooking issued — sent to the applicant (client). */
export function rebookingCreditForClient(ctx: {
	/** Consultation row id — keys the dedup; references recycle. */
	entityId?: string;
	reference: string;
	clientName: string;
	clientEmail: string;
}): QueuedEmail {
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`Your consultation <strong>${ctx.reference}</strong> was cancelled on our side, so we've covered the fee for a new slot.`,
		`Your assessment and documents carry over — only the appointment is new.`,
		`Log in to your portal and pick a new slot — no payment is needed.`,
		`<strong>Reference:</strong> ${ctx.reference}`,
	];
	const { html, text } = formatEmail("You can rebook — free", lines, null, ctx.reference);
	return {
		to: ctx.clientEmail,
		subject: `Your rebooking is covered · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:rebook_credit:${ctx.entityId ?? ctx.reference}`,
		template: "Free rebooking issued",
		reference: ctx.reference,
	};
}

export function bookingReminder(
	ctx: BookingNotificationContext,
	recipient: "client" | "employee",
): QueuedEmail {
	const isClient = recipient === "client";
	const to = isClient ? ctx.clientEmail : (ctx.employeeEmail ?? "");
	const zone = isClient ? ctx.clientTimezone : ctx.employeeTimezone;
	const lines = [
		isClient ? `Hi <strong>${ctx.clientName}</strong>,` : `Hi <strong>${ctx.employeeName ?? "there"}</strong>,`,
		`A reminder about your appointment tomorrow.`,
		`<strong>When:</strong> ${formatInZone(ctx.startsAt, zone)}`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>Reference:</strong> ${ctx.reference}`,
	];
	const { html, text } = formatEmail("Your appointment is tomorrow", lines, joinCtaUrl(ctx, isClient ? "client" : "employee"), ctx.reference);
	return {
		to,
		subject: `Reminder · ${ctx.serviceName} tomorrow`,
		html,
		text,
		idempotencyKey: `notify:reminder:${recipient}:${ctx.id}`,
		template: "Appointment reminder",
		reference: ctx.reference,
	};
}

export function assessmentCompleteForClient(ctx: {
	/** Consultation row id — keys the dedup; references recycle. */
	entityId?: string;
	reference: string;
	clientName: string;
	clientEmail: string;
}): QueuedEmail {
	const to = ctx.clientEmail;
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`Your eligibility assessment for the consultation case is now complete.`,
		`Please log in to your portal to view the outcome and your consultant's notes.`,
		`<strong>Reference:</strong> ${ctx.reference}`,
	];
	const { html, text } = formatEmail("Assessment Complete", lines, null, ctx.reference);
	return {
		to,
		subject: `Assessment Complete · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:assessment_complete:${ctx.entityId ?? ctx.reference}`,
	};
}

/** Application/case assigned to a staff member. */
/** Travel handler assigned — sent to the handler (ops staff). */
export function travelHandlerAssigned(ctx: {
	/** Travel request row id — keys the dedup; references recycle. */
	entityId?: string;
	reference: string;
	clientName: string;
	clientEmail: string;
	handlerName: string;
	handlerEmail: string;
}): QueuedEmail {
	const lines = [
		`Hi <strong>${ctx.handlerName}</strong>,`,
		`A travel assistance request has been assigned to you.`,
		`<strong>Client:</strong> ${ctx.clientName} (${ctx.clientEmail})`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		`Log in to the Operations Center to review the request and issue the airline ticket invoice when ready.`,
	];
	const { html, text } = formatEmail("A travel assistance request has been assigned to you", lines, null, ctx.reference);
	return {
		to: ctx.handlerEmail,
		subject: `Travel assistance assigned · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:travel:assigned:handler:${ctx.entityId ?? ctx.reference}:${ctx.handlerEmail}`,
		template: "Travel assistance assigned",
		reference: ctx.reference,
	};
}

/** Travel handler assigned — sent to the applicant (client). */
export function travelHandlerAssignedForClient(ctx: {
	/** Travel request row id — keys the dedup; references recycle. */
	entityId?: string;
	clientName: string;
	clientEmail: string;
	handlerName: string;
	handlerEmail?: string | null;
	reference: string;
	portalUrl: string;
}): QueuedEmail {
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`Your travel assistance request has been assigned to <strong>${ctx.handlerName}</strong>.`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		`Your handler will review your request and issue the airline ticket invoice shortly. You will be notified once the invoice is ready for payment.`,
		`Track the progress in your portal at ${ctx.portalUrl}.`,
	];
	const { html, text } = formatEmail("Your travel handler has been assigned", lines, null, ctx.reference);
	return {
		to: ctx.clientEmail,
		subject: `Your travel handler · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:travel:assigned:client:${ctx.clientEmail}:${ctx.entityId ?? ctx.reference}`,
		template: "Travel handler assigned",
		reference: ctx.reference,
	};
}

export function caseAssigned(ctx: {
	/** Application row id — keys the dedup; app numbers recycle. */
	entityId?: string;
	reference: string;
	clientName: string;
	clientEmail: string;
	employeeName: string;
	employeeEmail: string;
}): QueuedEmail {
	const lines = [
		`Hi <strong>${ctx.employeeName}</strong>,`,
		`A case has been assigned to you.`,
		`<strong>Client:</strong> ${ctx.clientName} (${ctx.clientEmail})`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		`Log in to the Operations Center to review the application and begin working with the client.`,
	];
	const { html, text } = formatEmail("A case has been assigned to you", lines, null, ctx.reference);
	return {
		to: ctx.employeeEmail,
		subject: `New case assigned · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:case:assigned:${ctx.entityId ?? ctx.reference}:${ctx.employeeEmail}`,
		template: "Case assigned",
		reference: ctx.reference,
	};
}

/** A new lead has been captured — sent to the manager for triage. */
export function leadCreatedForManager(
	ctx: { name: string; source: string; leadId: string },
	managerEmail: string,
): QueuedEmail {
	const lines = [
		`A new lead has been captured.`,
		`<strong>Name:</strong> ${ctx.name}`,
		`<strong>Source:</strong> ${ctx.source}`,
		`Log in to the Operations Center to review and assign this lead.`,
	];
	const { html, text } = formatEmail("New lead received", lines, null, ctx.leadId);
	return {
		to: managerEmail,
		subject: `New lead · ${ctx.name}`,
		html,
		text,
		idempotencyKey: `notify:lead:new:${ctx.leadId}:${managerEmail}`,
		template: "New lead received",
		reference: ctx.leadId,
	};
}

/* ── Client transactional emails ─────────────────────────────────────────── */

export function welcomeEmail(ctx: {
	name?: string;
	email: string;
	portalUrl: string;
}): QueuedEmail {
	const { html, text } = renderWelcomeEmail({ name: ctx.name, portalUrl: ctx.portalUrl });
	return {
		to: ctx.email,
		subject: "Welcome to Century NIT",
		html,
		text,
		idempotencyKey: `welcome:${ctx.email}`,
		template: "Welcome",
	};
}

export function consultantAssignedForClient(ctx: {
	/** Application row id — keys the dedup; app numbers recycle. */
	entityId?: string;
	clientName: string;
	clientEmail: string;
	consultantName: string;
	consultantEmail?: string | null;
	appNumber?: string | null;
	portalUrl: string;
}): QueuedEmail {
	const { html, text } = renderConsultantAssignedEmail({
		clientName: ctx.clientName,
		consultantName: ctx.consultantName,
		consultantEmail: ctx.consultantEmail,
		appNumber: ctx.appNumber,
		portalUrl: ctx.portalUrl,
	});
	return {
		to: ctx.clientEmail,
		subject: ctx.appNumber
			? `Your consultant · ${ctx.appNumber}`
			: "Your Century NIT consultant",
		html,
		text,
		// Keyed on the consultant too — a reassignment must reach the client.
		idempotencyKey: `consultant:client:${ctx.clientEmail}:${ctx.entityId ?? ctx.appNumber ?? "case"}:${ctx.consultantEmail ?? ctx.consultantName}`,
		template: "Consultant assigned",
		reference: ctx.appNumber ?? undefined,
	};
}

/** A post-arrival instalment falls due soon — queued ahead of its date. */
export function instalmentDueForClient(ctx: {
	idempotencyKey: string;
	clientName: string;
	clientEmail: string;
	invoiceNumber: string;
	lineLabel: string;
	amountGhsFormatted: string;
	dueAtFormatted: string;
	payUrl: string;
}): QueuedEmail {
	const { html, text } = renderInvoiceRaisedEmail({
		clientName: ctx.clientName,
		invoiceNumber: ctx.invoiceNumber,
		invoiceType: ctx.lineLabel,
		amountFormatted: ctx.amountGhsFormatted,
		amountGhsFormatted: ctx.amountGhsFormatted,
		dueAtFormatted: ctx.dueAtFormatted,
		payUrl: ctx.payUrl,
	});
	return {
		to: ctx.clientEmail,
		subject: `Instalment due ${ctx.dueAtFormatted} · ${ctx.amountGhsFormatted}`,
		html,
		text,
		idempotencyKey: ctx.idempotencyKey,
		template: "Instalment due",
		reference: ctx.invoiceNumber,
	};
}

export function invoiceRaisedForClient(ctx: {
	/** Invoice row id — keys the dedup; invoice numbers recycle. */
	entityId?: string;
	clientName: string;
	clientEmail: string;
	invoiceNumber: string;
	invoiceType: string;
	amountFormatted: string;
	amountGhsFormatted: string;
	dueAtFormatted?: string | null;
	payUrl: string;
}): QueuedEmail {
	const { html, text } = renderInvoiceRaisedEmail({
		clientName: ctx.clientName,
		invoiceNumber: ctx.invoiceNumber,
		invoiceType: ctx.invoiceType,
		amountFormatted: ctx.amountFormatted,
		amountGhsFormatted: ctx.amountGhsFormatted,
		dueAtFormatted: ctx.dueAtFormatted,
		payUrl: ctx.payUrl,
	});
	return {
		to: ctx.clientEmail,
		subject: `Invoice ready · ${ctx.invoiceNumber}`,
		html,
		text,
		idempotencyKey: `invoice:raised:${ctx.entityId ?? ctx.invoiceNumber}:${ctx.clientEmail}`,
		template: "Invoice raised",
		reference: ctx.invoiceNumber,
	};
}

export function documentReviewedForClient(ctx: {
	clientName: string;
	clientEmail: string;
	documentType: string;
	status: "approved" | "rejected";
	reviewNote?: string | null;
	portalUrl: string;
	/** The document row's id — keys the dedup so a re-upload's next review still sends. */
	documentId?: string;
}): QueuedEmail {
	const { html, text } = renderDocumentReviewedEmail({
		clientName: ctx.clientName,
		documentType: ctx.documentType,
		status: ctx.status,
		reviewNote: ctx.reviewNote,
		portalUrl: ctx.portalUrl,
	});
	return {
		to: ctx.clientEmail,
		subject: `Document ${ctx.status === "approved" ? "approved" : "rejected"} · ${ctx.documentType}`,
		html,
		text,
		// Keyed on the document row, not just the type — a re-uploaded passport's
		// second rejection is a different event the client must still hear about.
		idempotencyKey: `document:reviewed:${ctx.documentId ?? ctx.clientEmail}:${ctx.documentType}:${ctx.status}`,
		template: "Document reviewed",
	};
}

/** Application advanced to the next journey stage — sent to the client. */
/** The office recorded, extended or reduced the client's plan on their behalf. */
export function planUpdatedForClient(ctx: {
	entityId: string;
	clientName: string;
	clientEmail: string;
	appNumber: string;
	/** "recorded" | "extended" | "reduced" */
	change: string;
	planLabel: string;
	byName: string;
	reason?: string | null;
}): QueuedEmail {
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`${ctx.byName} has ${ctx.change} your plan on your behalf. It now reads: <strong>${ctx.planLabel}</strong>.${ctx.reason ? ` Their note: “${ctx.reason}”.` : ""}`,
		`Your service-fee invoice reflects the change. Log in to your portal to see the plan, its milestones and anything now due — and reply to your consultant if this is not what you agreed.`,
	];
	const { html, text } = formatEmail("Your plan was updated", lines, null, ctx.appNumber);
	return {
		to: ctx.clientEmail,
		subject: `Your plan · ${ctx.planLabel} · ${ctx.appNumber}`,
		html,
		text,
		idempotencyKey: `notify:plan_updated:${ctx.entityId}:${Date.now()}`,
		template: "Plan updated",
		reference: ctx.appNumber,
	};
}

/** The office suggests the next stage; the client decides from their plan page. */
export function stageProposedForClient(ctx: { entityId: string; clientName: string; clientEmail: string; appNumber: string; stageLabel: string; byName: string; note?: string | null }): QueuedEmail {
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`${ctx.byName} suggests adding the <strong>${ctx.stageLabel}</strong> stage to your plan.${ctx.note ? ` Their note: “${ctx.note}”.` : ""}`,
		`Nothing changes until you say so. Open your plan on the portal to see what the stage covers and what it costs, and ask to add it from there.`,
	];
	const { html, text } = formatEmail("A suggestion for your plan", lines, null, ctx.appNumber);
	return {
		to: ctx.clientEmail,
		subject: `Suggested for your plan · ${ctx.stageLabel} · ${ctx.appNumber}`,
		html,
		text,
		idempotencyKey: `notify:stage_proposed:${ctx.entityId}:${ctx.stageLabel}:${Date.now()}`,
		template: "Stage proposed",
		reference: ctx.appNumber,
	};
}

/** A service-fee milestone fell due — its case event just happened. */
export function milestoneDueForClient(ctx: {
	idempotencyKey: string;
	clientName: string;
	clientEmail: string;
	invoiceNumber: string;
	lineLabel: string;
	amountGhsFormatted: string;
	/** What happened to make it due, in the client's words. */
	because: string;
	payUrl: string;
}): QueuedEmail {
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`${ctx.because} — so the next part of your service fee is now due: <strong>${ctx.lineLabel}</strong>, <strong>${ctx.amountGhsFormatted}</strong>.`,
		`Pay it from your portal whenever you are ready: <a href="${ctx.payUrl}">${ctx.payUrl}</a>`,
	];
	const { html, text } = formatEmail("A milestone is now due", lines, null, ctx.invoiceNumber);
	return {
		to: ctx.clientEmail,
		subject: `Now due · ${ctx.lineLabel} · ${ctx.amountGhsFormatted}`,
		html,
		text,
		idempotencyKey: ctx.idempotencyKey,
		template: "Milestone due",
		reference: ctx.invoiceNumber,
	};
}

export function stageAdvancedForClient(ctx: {
	/** Application row id — keys the dedup; app numbers recycle. */
	entityId?: string;
	clientName: string;
	clientEmail: string;
	stageLabel: string;
	appNumber: string;
}): QueuedEmail {
	const to = ctx.clientEmail;
	const lines = [
		`Hi <strong>${ctx.clientName}</strong>,`,
		`Your application <strong>${ctx.appNumber}</strong> has advanced to the next stage: <strong>${ctx.stageLabel}</strong>.`,
		`Log in to your portal to view the latest progress and any actions required from you.`,
	];
	const { html, text } = formatEmail("Your case has moved to the next stage", lines, null, ctx.appNumber);
	return {
		to,
		subject: `Case Update · ${ctx.appNumber} → ${ctx.stageLabel}`,
		html,
		text,
		idempotencyKey: `notify:stage_advanced:${ctx.entityId ?? ctx.appNumber}:${ctx.stageLabel}`,
		template: "Stage advanced",
		reference: ctx.appNumber,
	};
}
