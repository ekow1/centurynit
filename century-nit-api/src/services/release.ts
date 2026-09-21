import { desc, eq } from "drizzle-orm";
import { documentReleaseHoldReason, RELEASE_GATED_DOCUMENT_TYPES } from "century-nit-shared";
import { db } from "../db/index.js";
import { applicants, applications, caseComments, schoolApplications } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";

/**
 * The release hold: the admission letter and the visa documents the agency
 * holds as the client's agent stay in the vault, visible but not
 * downloadable by the client, until the pre-departure fee milestone is paid
 * — or a manager releases them early with a reason. Enforced here, on the
 * download paths; the portal's lock is the presentation of this refusal.
 */

type HoldRow = { paymentPlanId: string | null; agencyStageIndex: number; agencySettled: boolean; preDepartureFeePaid: boolean; departureDetails: unknown };

const HOLD_COLUMNS = {
	paymentPlanId: applications.paymentPlanId,
	agencyStageIndex: applications.agencyStageIndex,
	agencySettled: applications.agencySettled,
	preDepartureFeePaid: applications.preDepartureFeePaid,
	departureDetails: applications.departureDetails,
};

function holdReason(row: HoldRow | undefined): string | null {
	if (!row) return null;
	return documentReleaseHoldReason({ ...row, departureDetails: row.departureDetails as { releaseOverrideAt?: string | null } | null });
}

/** Refuse a client's download of a held document type until the milestone; staff are never held. */
export async function assertReleasedForOwner(ownerUserId: string, documentType: string): Promise<void> {
	if (!RELEASE_GATED_DOCUMENT_TYPES.includes(documentType)) return;
	const [row] = await db
		.select(HOLD_COLUMNS)
		.from(applications)
		.innerJoin(applicants, eq(applicants.id, applications.applicantId))
		.where(eq(applicants.userId, ownerUserId))
		.orderBy(desc(applications.createdAt))
		.limit(1);
	const reason = holdReason(row);
	if (reason) throw new HttpError(402, "RELEASE_HELD", reason);
}

/** The offer letter on a school row is held the same way. */
export async function assertOfferLetterReleased(schoolId: string): Promise<void> {
	const [row] = await db
		.select(HOLD_COLUMNS)
		.from(schoolApplications)
		.innerJoin(applications, eq(applications.id, schoolApplications.applicationId))
		.where(eq(schoolApplications.id, schoolId))
		.limit(1);
	const reason = holdReason(row);
	if (reason) throw new HttpError(402, "RELEASE_HELD", reason);
}

/**
 * A manager releases the held documents ahead of the milestone — the bank
 * transfer finance has not recorded yet — or takes that release back. The
 * reason goes on the case, the way a proceed override does.
 */
export async function setReleaseOverride(
	applicationId: string,
	input: { reason?: string; revoke?: boolean },
	actor: { opsUserId?: string | null; name: string },
): Promise<typeof applications.$inferSelect> {
	const [row] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
	if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	const current = (row.departureDetails ?? {}) as Record<string, unknown>;
	let next: Record<string, unknown>;
	let text: string;
	if (input.revoke) {
		const { releaseOverrideAt: _a, releaseOverrideBy: _b, releaseOverrideReason: _c, ...rest } = current;
		next = rest;
		text = `Early release of the admission letter and visa documents withdrawn by ${actor.name}.`;
	} else {
		if (!input.reason?.trim()) throw new HttpError(400, "REASON_REQUIRED", "Give the reason for releasing ahead of the milestone.");
		next = { ...current, releaseOverrideAt: new Date().toISOString(), releaseOverrideBy: actor.name, releaseOverrideReason: input.reason.trim() };
		text = `Admission letter and visa documents released ahead of the fee milestone by ${actor.name}. Reason: ${input.reason.trim()}`;
	}
	const [updated] = await db
		.update(applications)
		.set({ departureDetails: next as typeof row.departureDetails, updatedAt: new Date() })
		.where(eq(applications.id, applicationId))
		.returning();
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: applicationId,
		kind: "status",
		text,
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId ?? null,
	});
	return updated;
}
