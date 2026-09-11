import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { applicants, applications } from "../db/schema.js";
import { startAssignment } from "./caseAssignments.js";

/**
 * Who owns a case — written in exactly one place.
 *
 * Ownership used to be recorded in five columns/tables by different paths
 * (`applications.assignedStaffId`, `case_assignments`, `stage_assignments`,
 * `applicants.assignedOfficerId`, `consultations.assignedOfficerId`), each
 * assignment path updating a different subset. The portal, the ops queue,
 * document access and chat routing then each read a different one, and
 * disagreed.
 *
 * The model is now two things:
 *
 *   - **Whole-case owner** — `applications.assignedStaffId`. The authoritative
 *     answer to "who handles this application". Set only through
 *     `setCaseOwner`, which also keeps the two derived pointers in step: the
 *     applicant's current point of contact (`applicants.assignedOfficerId`,
 *     read by document notifications, chat routing and the consultant's
 *     applicant list) and the append-only `case_assignments` history.
 *   - **Per-stage specialist** — `stage_assignments`. A visa, travel or
 *     finance officer who owns one stage without owning the case. Written by
 *     `assignStageOfficer` (communication.ts) when a handoff is resolved.
 *
 * `activeHandlerFor` (handoffs.ts) reads those two, in that order, and
 * nothing else.
 */
export async function setCaseOwner(input: {
	applicationId: string;
	opsUserId: string;
	assignedBy: string | null;
	note?: string;
	tx?: typeof db;
}): Promise<void> {
	const txDb = input.tx ?? db;
	const now = new Date();

	const [app] = await txDb
		.update(applications)
		.set({ assignedStaffId: input.opsUserId, updatedAt: now })
		.where(eq(applications.id, input.applicationId))
		.returning({ applicantId: applications.applicantId });
	if (!app) return;

	await txDb
		.update(applicants)
		.set({ assignedOfficerId: input.opsUserId, updatedAt: now })
		.where(eq(applicants.id, app.applicantId));

	await startAssignment({
		targetType: "application",
		targetId: input.applicationId,
		opsUserId: input.opsUserId,
		assignedBy: input.assignedBy,
		note: input.note,
		tx: txDb,
	});
}
