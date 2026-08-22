/**
 * Notification `type` values that are only ever addressed to staff (managers,
 * coordinators, consultants, officers). They never belong in the client portal's
 * bell, so the portal excludes them from its `/me/notifications` list and from
 * the SSE stream.
 *
 * Keep this list in sync with every new staff-only notification added via
 * `notify()` in the API. Types that go to BOTH a client and a staff member
 * (e.g. `booking.cancelled`, `booking.rescheduled`, `chat.message`) must NOT be
 * added here — the client legitimately receives their own copy.
 */
export const STAFF_ONLY_NOTIFICATION_TYPES = [
	"lead.new",
	"booking.new",
	"booking.assigned",
	"consultation.assigned",
	"document.uploaded",
	"ticket.new",
] as const;

export type StaffOnlyNotificationType = (typeof STAFF_ONLY_NOTIFICATION_TYPES)[number];

/** True if a notification `type` is staff-only and must not surface in the client portal. */
export function isStaffOnlyNotification(type: string): boolean {
	return (STAFF_ONLY_NOTIFICATION_TYPES as readonly string[]).includes(type);
}
