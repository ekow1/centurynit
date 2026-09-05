import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { caseAssignments, caseAssignmentTypeEnum, stageAssignments } from "../db/schema.js";

/* ── Case assignment history ────────────────────────────────────────────────
 *
 * Append-only record of who was assigned to a case (consultation, application,
 * or booking) and when. Reassignment ends the previous row and inserts a new
 * one; nothing is ever deleted or overwritten.
 *
 * `status = 'active'` is the single source of truth for "who currently owns
 * this case". The denormalized columns on the parent tables
 * (`assignedOfficerId`, `assignedStaffId`, `employeeId`) are display cache
 * only — never query them for access control.
 */

export type AssignmentTargetType = (typeof caseAssignmentTypeEnum.enumValues)[number];

export interface StartAssignmentInput {
	targetType: AssignmentTargetType;
	targetId: string;
	opsUserId: string;
	role?: "primary" | "secondary" | "reviewer";
	assignedBy: string | null;
	note?: string;
}

export interface EndAssignmentInput {
	targetType: AssignmentTargetType;
	targetId: string;
	endedBy: string | null;
	endReason: "reassigned" | "completed" | "cancelled" | "offboarded" | "unassigned";
	role?: "primary" | "secondary" | "reviewer";
}

/**
 * End the active assignment (if any) on a target, then insert a new active
 * row for the new officer. Returns the new assignment row.
 *
 * This is the only function that should write to case_assignments for
 * reassignment — it preserves the history by ending, not overwriting.
 */
export async function startAssignment(input: StartAssignmentInput) {
	await endAssignment({
		targetType: input.targetType,
		targetId: input.targetId,
		endedBy: input.assignedBy,
		endReason: "reassigned",
		role: input.role ?? "primary",
	});

	const [row] = await db
		.insert(caseAssignments)
		.values({
			targetType: input.targetType,
			targetId: input.targetId,
			opsUserId: input.opsUserId,
			role: input.role ?? "primary",
			status: "active",
			assignedBy: input.assignedBy,
			note: input.note ?? null,
		})
		.returning();
	return row;
}

/**
 * End the active assignment on a target without starting a new one.
 * No-op if there is no active assignment.
 */
export async function endAssignment(input: EndAssignmentInput): Promise<void> {
	await db
		.update(caseAssignments)
		.set({
			status: "ended",
			endedAt: new Date(),
			endedBy: input.endedBy,
			endReason: input.endReason,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(caseAssignments.targetType, input.targetType),
				eq(caseAssignments.targetId, input.targetId),
				eq(caseAssignments.role, input.role ?? "primary"),
				eq(caseAssignments.status, "active"),
			),
		);
}

/**
 * The ops user ids with an active assignment on a target.
 */
export async function activeAssigneesFor(
	targetType: AssignmentTargetType,
	targetId: string,
): Promise<string[]> {
	const rows = await db
		.select({ opsUserId: caseAssignments.opsUserId })
		.from(caseAssignments)
		.where(
			and(
				eq(caseAssignments.targetType, targetType),
				eq(caseAssignments.targetId, targetId),
				eq(caseAssignments.status, "active"),
			),
		);
	return rows.map((r) => r.opsUserId);
}

/**
 * Every applicant user id reachable by an officer through an active
 * assignment on any of their cases (consultations or applications).
 *
 * This replaces the three-table union in `reachableOwnerIds` and
 * `assignedApplicantUserIds` with a single query against case_assignments.
 * Bookings are not included here because the booking's client is already
 * covered by the linked consultation — including bookings would double-count.
 *
 * Per-stage officers (stage_assignments) are unioned in as well: a specialist
 * on the visa stage must still see the applicant's documents, even though
 * their work is narrower than whole-case ownership.
 */
export async function activeApplicantUserIdsForOfficer(opsUserId: string): Promise<string[]> {
	const rows = await db.execute<{
		userId: string | null;
	}>(sql`
		SELECT DISTINCT a.user_id AS "userId"
		FROM case_assignments ca
		JOIN consultations c ON ca.target_type = 'consultation' AND ca.target_id = c.id
		JOIN applicants a ON a.id = c.applicant_id
		WHERE ca.ops_user_id = ${opsUserId} AND ca.status = 'active'
		UNION
		SELECT DISTINCT a.user_id AS "userId"
		FROM case_assignments ca
		JOIN applications ap ON ca.target_type = 'application' AND ca.target_id = ap.id
		JOIN applicants a ON a.id = ap.applicant_id
		WHERE ca.ops_user_id = ${opsUserId} AND ca.status = 'active'
		UNION
		SELECT DISTINCT a.user_id AS "userId"
		FROM ${stageAssignments} sa
		JOIN applications ap ON ap.id = sa.application_id
		JOIN applicants a ON a.id = ap.applicant_id
		WHERE sa.ops_user_id = ${opsUserId} AND sa.status = 'active'
	`);
	return rows.rows
		.map((r) => r.userId)
		.filter((id): id is string => Boolean(id));
}

/**
 * End every active assignment held by an officer — used when they are
 * offboarded (leave the company or change role). Returns the count ended.
 */
export async function endAllActiveForOfficer(
	opsUserId: string,
	endedBy: string | null,
	endReason: "offboarded" | "unassigned" = "offboarded",
): Promise<number> {
	const result = await db
		.update(caseAssignments)
		.set({
			status: "ended",
			endedAt: new Date(),
			endedBy,
			endReason,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(caseAssignments.opsUserId, opsUserId),
				eq(caseAssignments.status, "active"),
			),
		)
		.returning({ id: caseAssignments.id });
	return result.length;
}

/**
 * Full history for a target — newest first. Used by the "previously assigned"
 * UI and audit views.
 */
export async function assignmentHistoryFor(
	targetType: AssignmentTargetType,
	targetId: string,
) {
	return db
		.select()
		.from(caseAssignments)
		.where(
			and(
				eq(caseAssignments.targetType, targetType),
				eq(caseAssignments.targetId, targetId),
			),
		)
		.orderBy(sql`${caseAssignments.assignedAt} DESC`);
}

/**
 * Backfill helper: insert an active assignment row for a target that already
 * has a denormalized assignment column. Used during migration to populate
 * case_assignments from the existing columns without changing behavior.
 */
export async function backfillAssignment(
	targetType: AssignmentTargetType,
	targetId: string,
	opsUserId: string,
	assignedAt: Date | null,
	assignedBy: string | null,
) {
	// Skip if there is already an active assignment for this target+role.
	const [existing] = await db
		.select({ id: caseAssignments.id })
		.from(caseAssignments)
		.where(
			and(
				eq(caseAssignments.targetType, targetType),
				eq(caseAssignments.targetId, targetId),
				eq(caseAssignments.opsUserId, opsUserId),
				eq(caseAssignments.status, "active"),
			),
		)
		.limit(1);
	if (existing) return;

	await db.insert(caseAssignments).values({
		targetType,
		targetId,
		opsUserId,
		role: "primary",
		status: "active",
		assignedAt: assignedAt ?? new Date(),
		assignedBy,
	});
}

/**
 * Whether an officer has an active assignment on a specific target.
 */
export async function hasActiveAssignment(
	targetType: AssignmentTargetType,
	targetId: string,
	opsUserId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ id: caseAssignments.id })
		.from(caseAssignments)
		.where(
			and(
				eq(caseAssignments.targetType, targetType),
				eq(caseAssignments.targetId, targetId),
				eq(caseAssignments.opsUserId, opsUserId),
				eq(caseAssignments.status, "active"),
			),
		)
		.limit(1);
	return Boolean(row);
}

/**
 * The ops user ids that have ever been assigned to a target, active or ended.
 * Used for audit ("who has ever handled this applicant?").
 */
export async function allAssigneesFor(
	targetType: AssignmentTargetType,
	targetId: string,
): Promise<{ opsUserId: string; status: string; assignedAt: Date; endedAt: Date | null }[]> {
	const rows = await db
		.select({
			opsUserId: caseAssignments.opsUserId,
			status: caseAssignments.status,
			assignedAt: caseAssignments.assignedAt,
			endedAt: caseAssignments.endedAt,
		})
		.from(caseAssignments)
		.where(
			and(
				eq(caseAssignments.targetType, targetType),
				eq(caseAssignments.targetId, targetId),
			),
		)
		.orderBy(sql`${caseAssignments.assignedAt} DESC`);
	return rows;
}

// Re-export for callers that want the enum values
export { caseAssignments };
export const ASSIGNMENT_TARGET_TYPES = caseAssignmentTypeEnum.enumValues;
export const ASSIGNMENT_END_REASONS = [
	"reassigned",
	"completed",
	"cancelled",
	"offboarded",
	"unassigned",
] as const;
