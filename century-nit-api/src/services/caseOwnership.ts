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

/**
 * Release everything an officer holds — called when they are deactivated.
 *
 * Without this, deactivating someone only removes them from the assignee
 * picker: their cases keep pointing at them, nobody is told, and applicants
 * keep messaging a person who has left. Each open case they owned or worked
 * a stage of becomes a pending handoff (source "offboarding", no continuity
 * candidate), so it lands in the managers' queue to be reassigned.
 */
export async function releaseOfficerCases(input: {
	opsUserId: string;
	actor: { opsUserId: string; name: string };
}): Promise<{ applications: number; stages: number; consultations: number }> {
	const { and: andOp, eq: eqOp, inArray, ne } = await import("drizzle-orm");
	const { caseComments, consultations, stageAssignments, travelAssistanceRequests } = await import("../db/schema.js");
	const { createOrGetHandoff } = await import("./handoffs.js");
	const { endAllActiveForOfficer } = await import("./caseAssignments.js");
	const { getManagerAndCoordinatorUserIds, notifyMany } = await import("./notify.js");
	const now = new Date();

	// Which handoff a case at a given coarse stage needs.
	const handoffStageFor = (stage: string): string | null =>
		stage === "document_verification" || stage === "school_submission" || stage === "offer_letter_review"
			? "school_submission"
			: stage === "completed"
				? null
				: stage;

	// 1. Cases they own outright.
	const owned = await db
		.select({ id: applications.id, stage: applications.stage, appNumber: applications.appNumber })
		.from(applications)
		.where(andOp(eqOp(applications.assignedStaffId, input.opsUserId), ne(applications.stage, "completed")));
	for (const app of owned) {
		await db
			.update(applications)
			.set({ assignedStaffId: null, updatedAt: now })
			.where(eqOp(applications.id, app.id));
		const stage = handoffStageFor(app.stage);
		if (stage) {
			await createOrGetHandoff({ applicationId: app.id, stage, source: "offboarding", fromOpsUserId: null });
		}
		await db.insert(caseComments).values({
			targetType: "application",
			targetId: app.id,
			kind: "assignment",
			text: `Handler released — staff member deactivated by ${input.actor.name}. Awaiting reassignment.`,
			authorName: input.actor.name,
			authorOpsUserId: input.actor.opsUserId,
		});
	}

	// 2. Stages they were the specialist for.
	const stages = await db
		.select({ id: stageAssignments.id, applicationId: stageAssignments.applicationId, stage: stageAssignments.stage })
		.from(stageAssignments)
		.where(andOp(eqOp(stageAssignments.opsUserId, input.opsUserId), eqOp(stageAssignments.status, "active")));
	if (stages.length) {
		await db
			.update(stageAssignments)
			.set({ status: "reassigned", endedAt: now, endedReason: "offboarded" })
			.where(inArray(stageAssignments.id, stages.map((s) => s.id)));
		for (const s of stages) {
			await createOrGetHandoff({ applicationId: s.applicationId, stage: s.stage, source: "offboarding", fromOpsUserId: null });
		}
		await db
			.update(travelAssistanceRequests)
			.set({ assignedOpsUserId: null, updatedAt: now })
			.where(eqOp(travelAssistanceRequests.assignedOpsUserId, input.opsUserId));
	}

	// 3. Consultations still in flight, and the applicants who had them as contact.
	const open = await db
		.update(consultations)
		.set({ assignedOfficerId: null, updatedAt: now })
		.where(
			andOp(
				eqOp(consultations.assignedOfficerId, input.opsUserId),
				inArray(consultations.status, ["UNDER_REVIEW", "ASSIGNED", "CONFIRMED", "IN_ASSESSMENT"]),
			),
		)
		.returning({ id: consultations.id });
	await db
		.update(applicants)
		.set({ assignedOfficerId: null, updatedAt: now })
		.where(eqOp(applicants.assignedOfficerId, input.opsUserId));

	// 4. History.
	await endAllActiveForOfficer(input.opsUserId, input.actor.opsUserId, "offboarded");

	// 5. Tell the people who reassign.
	const total = owned.length + stages.length + open.length;
	if (total > 0) {
		const recipients = await getManagerAndCoordinatorUserIds();
		await notifyMany(
			recipients.map((r) => ({
				recipientUserId: r.userId,
				type: "assignment.released",
				title: "Cases need reassignment",
				body: `${total} item${total === 1 ? "" : "s"} (${owned.length} case${owned.length === 1 ? "" : "s"}, ${stages.length} stage${stages.length === 1 ? "" : "s"}, ${open.length} consultation${open.length === 1 ? "" : "s"}) were released when a staff member was deactivated.`,
				link: "/pending",
			})),
		).catch(() => {});
	}

	return { applications: owned.length, stages: stages.length, consultations: open.length };
}
