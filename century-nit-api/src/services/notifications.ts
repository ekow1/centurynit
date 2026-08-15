import { formatInZone } from "../lib/time.js";

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
};

function layout(title: string, lines: string[], meetingUrl?: string | null): string {
	const body = lines.map((l) => `<p style="margin:0 0 8px">${l}</p>`).join("");
	const cta = meetingUrl
		? `<p style="margin:24px 0"><a href="${meetingUrl}" style="background:#000;color:#fff;padding:12px 20px;text-decoration:none;display:inline-block">Join the meeting</a></p>
		   <p style="margin:0;font-size:12px;color:#666">Or paste this link: ${meetingUrl}</p>`
		: "";
	return `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5">
	<h2 style="margin:0 0 16px">${title}</h2>${body}${cta}
	<hr style="margin:24px 0;border:none;border-top:1px solid #e5e5e5" />
	<p style="margin:0;font-size:12px;color:#666">Century NIT Consult</p>
</div>`;
}

function plain(title: string, lines: string[], meetingUrl?: string | null): string {
	const stripped = lines.map((l) => l.replace(/<[^>]+>/g, ""));
	return [title, "", ...stripped, ...(meetingUrl ? ["", `Join: ${meetingUrl}`] : [])].join("\n");
}

/* ── Message builders ────────────────────────────────────────────────────── */

/**
 * Booking received. Goes to the client, and deliberately does NOT claim an
 * employee has been assigned (§1) — nobody has been at this point.
 */
export function bookingCreatedForClient(ctx: BookingNotificationContext): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.clientTimezone);
	const lines = [
		`Hi ${ctx.clientName},`,
		`We have received your booking for <strong>${ctx.serviceName}</strong>.`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>Reference:</strong> ${ctx.reference}`,
		"A team member will be assigned to your appointment and you will receive the meeting details once that is done.",
	];
	return {
		to: ctx.clientEmail,
		subject: `Booking received · ${ctx.reference}`,
		html: layout("Your appointment has been received", lines),
		text: plain("Your appointment has been received", lines),
		idempotencyKey: `notify:created:client:${ctx.reference}`,
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
	return {
		to: managerEmail,
		subject: `Unassigned booking · ${ctx.reference}`,
		html: layout("New booking awaiting assignment", lines),
		text: plain("New booking awaiting assignment", lines),
		idempotencyKey: `notify:created:manager:${ctx.reference}:${managerEmail}`,
	};
}

/** Employee assigned — the message that carries the Meet link. */
export function bookingAssignedForClient(ctx: BookingNotificationContext): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.clientTimezone);
	const lines = [
		`Hi ${ctx.clientName},`,
		`Your appointment is confirmed.`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>With:</strong> ${ctx.employeeName ?? "your consultant"}`,
		`<strong>Reference:</strong> ${ctx.reference}`,
	];
	return {
		to: ctx.clientEmail,
		subject: `Appointment confirmed · ${ctx.reference}`,
		html: layout("Your appointment is confirmed", lines, ctx.meetingUrl),
		text: plain("Your appointment is confirmed", lines, ctx.meetingUrl),
		idempotencyKey: `notify:assigned:client:${ctx.reference}:${ctx.employeeEmail ?? ""}`,
	};
}

export function bookingAssignedForEmployee(ctx: BookingNotificationContext): QueuedEmail {
	const when = formatInZone(ctx.startsAt, ctx.employeeTimezone);
	const lines = [
		`Hi ${ctx.employeeName ?? "there"},`,
		`You have been assigned a consultation.`,
		`<strong>Client:</strong> ${ctx.clientName} (${ctx.clientEmail})`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>When:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		`<strong>Reference:</strong> ${ctx.reference}`,
	];
	return {
		to: ctx.employeeEmail ?? "",
		subject: `New consultation assigned · ${ctx.reference}`,
		html: layout("A consultation has been assigned to you", lines, ctx.meetingUrl),
		text: plain("A consultation has been assigned to you", lines, ctx.meetingUrl),
		idempotencyKey: `notify:assigned:employee:${ctx.reference}:${ctx.employeeEmail ?? ""}`,
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
		isClient ? `Hi ${ctx.clientName},` : `Hi ${ctx.employeeName ?? "there"},`,
		`This appointment has been moved.`,
		`<strong>New time:</strong> ${when} (${ctx.durationMinutes} minutes)`,
		...(ctx.reason ? [`<strong>Reason:</strong> ${ctx.reason}`] : []),
		`<strong>Reference:</strong> ${ctx.reference}`,
		"The meeting link below is unchanged.",
	];
	return {
		to,
		subject: `Appointment rescheduled · ${ctx.reference}`,
		html: layout("Your appointment has moved", lines, ctx.meetingUrl),
		text: plain("Your appointment has moved", lines, ctx.meetingUrl),
		// Keyed on the new time, so each distinct reschedule notifies once.
		idempotencyKey: `notify:rescheduled:${recipient}:${ctx.reference}:${ctx.startsAt.toISOString()}`,
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
		isClient ? `Hi ${ctx.clientName},` : `Hi ${ctx.employeeName ?? "there"},`,
		`The appointment on <strong>${formatInZone(ctx.startsAt, zone)}</strong> has been cancelled.`,
		...(ctx.reason ? [`<strong>Reason:</strong> ${ctx.reason}`] : []),
		`<strong>Reference:</strong> ${ctx.reference}`,
		"The meeting link is no longer valid.",
	];
	return {
		to,
		subject: `Appointment cancelled · ${ctx.reference}`,
		html: layout("Appointment cancelled", lines),
		text: plain("Appointment cancelled", lines),
		idempotencyKey: `notify:cancelled:${recipient}:${ctx.reference}`,
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
		isClient ? `Hi ${ctx.clientName},` : `Hi ${ctx.employeeName ?? "there"},`,
		`A reminder about your appointment tomorrow.`,
		`<strong>When:</strong> ${formatInZone(ctx.startsAt, zone)}`,
		`<strong>Service:</strong> ${ctx.serviceName}`,
		`<strong>Reference:</strong> ${ctx.reference}`,
	];
	return {
		to,
		subject: `Reminder · ${ctx.serviceName} tomorrow`,
		html: layout("Your appointment is tomorrow", lines, ctx.meetingUrl),
		text: plain("Your appointment is tomorrow", lines, ctx.meetingUrl),
		idempotencyKey: `notify:reminder:${recipient}:${ctx.reference}`,
	};
}
