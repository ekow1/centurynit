import { z } from "zod";
import { HttpError } from "../middleware/error.js";
import type { StaffContext } from "../middleware/auth.js";
import { canAccessApplication } from "../services/cases.js";

/** What the case routers share: the id param, the access check, the actor shape. */

export const STAFF_ONLY_NOTIFICATION_TYPES = [
	"lead.new",
	"booking.new",
	"booking.assigned",
	"consultation.assigned",
	"document.uploaded",
	"chat.message",
] as const;

export const idParams = z.object({ id: z.string().uuid() });

/**
 * Every read and write of one application goes through this. Access is the
 * same on both sides: the applicant, anyone who sees all cases, the case
 * owner, an active stage specialist, or the travel handler.
 */
export async function assertApplicationAccess(
	c: { get(key: "user"): { id: string }; get(key: "staff"): StaffContext | null | undefined },
	applicationId: string,
	what = "work on",
): Promise<void> {
	if (!(await canAccessApplication(applicationId, c.get("user").id, c.get("staff") ?? null))) {
		throw new HttpError(403, "FORBIDDEN", `Not allowed to ${what} this application`);
	}
}

export function actorFrom(staff: StaffContext) {
	return { opsUserId: staff.opsUserId, name: staff.name, email: staff.email };
}

