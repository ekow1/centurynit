import { formatInZone } from "../lib/time.js";
import { renderBookingEmail } from "../lib/email-templates.js";

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
	branchName?: string;
	reason?: string | null;
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
};

function formatEmail(title: string, lines: string[], meetingUrl?: string | null, reference?: string): { html: string; text: string } {
	return renderBookingEmail({ title, lines, meetingUrl, reference });
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
		idempotencyKey: `notify:created:client:${ctx.reference}`,
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
		idempotencyKey: `notify:created:manager:${ctx.reference}:${managerEmail}`,
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
	];
	const { html, text } = formatEmail("Your appointment is confirmed", lines, ctx.meetingUrl, ctx.reference);
	return {
		to: ctx.clientEmail,
		subject: `Appointment confirmed · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:assigned:client:${ctx.reference}:${ctx.employeeEmail ?? ""}`,
		template: "Appointment confirmed",
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
	const { html, text } = formatEmail("A consultation has been assigned to you", lines, ctx.meetingUrl, ctx.reference);
	return {
		to: ctx.employeeEmail ?? "",
		subject: `New consultation assigned · ${ctx.reference}`,
		html,
		text,
		idempotencyKey: `notify:assigned:employee:${ctx.reference}:${ctx.employeeEmail ?? ""}`,
		template: "Consultation assigned",
		reference: ctx.reference,
	};
}

/** Consultation assigned without a booking (no scheduled time yet). */
export function consultationAssigned(ctx: {
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
		idempotencyKey: `notify:consultation:assigned:${ctx.reference}:${ctx.employeeEmail}`,
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
	const { html, text } = formatEmail("Your appointment has moved", lines, ctx.meetingUrl, ctx.reference);
	return {
		to,
		subject: `Appointment rescheduled · ${ctx.reference}`,
		html,
		text,
		// Keyed on the new time, so each distinct reschedule notifies once.
		idempotencyKey: `notify:rescheduled:${recipient}:${ctx.reference}:${ctx.startsAt.toISOString()}`,
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
		idempotencyKey: `notify:cancelled:${recipient}:${ctx.reference}`,
		template: "Appointment cancelled",
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
	const { html, text } = formatEmail("Your appointment is tomorrow", lines, ctx.meetingUrl, ctx.reference);
	return {
		to,
		subject: `Reminder · ${ctx.serviceName} tomorrow`,
		html,
		text,
		idempotencyKey: `notify:reminder:${recipient}:${ctx.reference}`,
		template: "Appointment reminder",
		reference: ctx.reference,
	};
}

export function assessmentCompleteForClient(ctx: {
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
		idempotencyKey: `notify:assessment_complete:${ctx.reference}`,
		template: "Assessment complete",
		reference: ctx.reference,
	};
}
