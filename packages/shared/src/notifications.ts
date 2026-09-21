/**
 * The notification event registry — every event the suite emits, its default
 * channels, audience and timing. The ops Catalogue page is generated from
 * this list, `notify()` reads user preferences against it, and the event key
 * is what lands on `notification_log.event`.
 *
 * Adding an event here is the contract: a notify() call whose `type` isn't in
 * the registry still sends, but the catalogue can't describe it — keep the
 * list complete.
 */

export type NotificationChannel = "inApp" | "push" | "email" | "sms";
export type NotificationAudience = "client" | "staff" | "both";

export interface NotificationEventDef {
	/** The `type` string passed to notify()/queued emails, e.g. "chat.reply". */
	key: string;
	/** Short label for the catalogue row. */
	label: string;
	/** One line — when it fires. */
	description: string;
	/** Domain grouping for the catalogue filter chips. */
	domain: "case" | "money" | "booking" | "chat" | "auth" | "documents" | "marketing" | "system";
	/** Default channels — user preferences can only reduce, never add. */
	channels: NotificationChannel[];
	audience: NotificationAudience;
	/** Timing note shown in the catalogue ("delayed 5min if unseen"). */
	timing?: string;
	/** If true the user cannot mute it (security + receipts). */
	required?: boolean;
}

export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
	/* ── Case ── */
	{ key: "case.assigned", label: "Case assigned", description: "A handler was assigned to a case or picked up a booking", domain: "case", channels: ["inApp", "email"], audience: "both" },
	{ key: "stage.changed", label: "Stage changed", description: "The case moved to a new journey stage", domain: "case", channels: ["inApp", "push", "email"], audience: "client" },
	{ key: "stage.proposed", label: "Stage proposed", description: "Staff proposed starting the next stage — needs consent", domain: "case", channels: ["inApp", "email"], audience: "client" },
	{ key: "document.requested", label: "Document requested", description: "The office asked for a new document", domain: "documents", channels: ["inApp", "push", "email"], audience: "client" },
	{ key: "document.reviewed", label: "Document reviewed", description: "An upload was accepted or rejected", domain: "documents", channels: ["inApp", "push", "email"], audience: "client" },
	{ key: "checkin.scheduled", label: "Check-in scheduled", description: "A case check-in was booked or changed", domain: "case", channels: ["inApp", "email"], audience: "both" },
	{ key: "school.offer", label: "School offer received", description: "A school returned an offer on the file", domain: "case", channels: ["inApp", "push", "email"], audience: "client" },
	{ key: "visa.update", label: "Visa update", description: "The visa file changed state", domain: "case", channels: ["inApp", "push", "email"], audience: "client" },
	{ key: "departure.update", label: "Departure update", description: "Pre-departure checklist or travel state changed", domain: "case", channels: ["inApp", "email"], audience: "client" },

	/* ── Money ── */
	{ key: "invoice.raised", label: "Invoice raised", description: "A new invoice was issued", domain: "money", channels: ["inApp", "email"], audience: "client" },
	{ key: "invoice.milestone_due", label: "Instalment due", description: "A payment-plan instalment is coming due", domain: "money", channels: ["inApp", "push", "email"], audience: "client", timing: "3 days before due" },
	{ key: "payment.receipt", label: "Payment receipt", description: "A payment was received and receipted", domain: "money", channels: ["inApp", "email"], audience: "client", required: true },
	{ key: "plan.proposed", label: "Payment plan proposed", description: "The office proposed a payment plan — needs a decision", domain: "money", channels: ["inApp", "email"], audience: "client" },
	{ key: "plan.updated", label: "Payment plan updated", description: "The instalment schedule changed", domain: "money", channels: ["inApp", "email"], audience: "client" },
	{ key: "autopay.failed", label: "Auto-pay failed", description: "A saved-card debit failed — card needs attention", domain: "money", channels: ["inApp", "push", "email"], audience: "client" },
	{ key: "refund.due", label: "Refund due", description: "A refund was approved and queued", domain: "money", channels: ["inApp", "email"], audience: "client" },

	/* ── Booking ── */
	{ key: "booking.received", label: "Booking received", description: "A consultation booking was created", domain: "booking", channels: ["inApp", "email"], audience: "client" },
	{ key: "booking.assigned", label: "Booking assigned", description: "An unassigned booking needs a handler", domain: "booking", channels: ["inApp", "push", "email"], audience: "staff" },
	{ key: "appointment.confirmed", label: "Appointment confirmed", description: "The booking got a confirmed slot and link", domain: "booking", channels: ["inApp", "email"], audience: "client" },
	{ key: "appointment.rescheduled", label: "Appointment rescheduled", description: "The appointment time changed", domain: "booking", channels: ["inApp", "email"], audience: "both" },
	{ key: "appointment.cancelled", label: "Appointment cancelled", description: "The booking or consultation was cancelled", domain: "booking", channels: ["inApp", "email"], audience: "both" },
	{ key: "appointment.reminder", label: "Appointment reminder", description: "An appointment is coming up", domain: "booking", channels: ["inApp", "email"], audience: "both", timing: "configurable — default 24h before" },

	/* ── Chat / requests ── */
	{ key: "chat.reply", label: "Chat reply", description: "A new message arrived in a conversation", domain: "chat", channels: ["inApp", "push", "email"], audience: "both", timing: "email delayed 5min, skipped if seen" },
	{ key: "chat.assigned", label: "Request assigned", description: "A request was routed to an agent (claim, assign or sweep)", domain: "chat", channels: ["inApp"], audience: "staff" },
	{ key: "request.escalated", label: "Request escalated", description: "A request was escalated to a manager", domain: "chat", channels: ["inApp", "push"], audience: "staff" },

	/* ── Auth / account ── */
	{ key: "auth.welcome", label: "Welcome email", description: "Account created — sign-in details and first steps", domain: "auth", channels: ["email"], audience: "client", required: true },
	{ key: "auth.reset", label: "Password reset", description: "A password reset link was requested", domain: "auth", channels: ["email"], audience: "both", required: true },
	{ key: "auth.verify", label: "Verify email", description: "Email verification link or code", domain: "auth", channels: ["email"], audience: "both", required: true },
	{ key: "auth.locked", label: "Account locked", description: "Too many failed sign-ins — account locked", domain: "auth", channels: ["email"], audience: "both", required: true },
	{ key: "staff.invited", label: "Staff invitation", description: "Invited to the ops console", domain: "auth", channels: ["email"], audience: "staff", required: true },
	{ key: "mfa.reminder", label: "MFA reminder", description: "Reminder to enrol before the grace period ends", domain: "auth", channels: ["inApp", "email"], audience: "staff" },

	/* ── Marketing ── */
	{ key: "marketing.campaign", label: "Campaign email", description: "Newsletters and campaigns — global unsubscribe applies", domain: "marketing", channels: ["email"], audience: "client" },
];

const byKey = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

/** Registry lookup — undefined means the caller emits an unregistered event. */
export function notificationEventDef(key: string): NotificationEventDef | undefined {
	return byKey.get(key);
}

/**
 * Channels an event is allowed to use. Preferences can remove a channel but
 * never add one the event doesn't support; `required` events ignore prefs.
 */
export function channelsFor(key: string): NotificationChannel[] {
	return notificationEventDef(key)?.channels ?? ["inApp"];
}
