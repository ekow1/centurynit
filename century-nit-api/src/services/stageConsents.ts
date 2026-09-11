import { and, desc, eq } from "drizzle-orm";
import type {
	StageConsent,
	StageConsentDecision,
	StageConsentStage,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { applications, stageConsents, applicants } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";

/**
 * Stage consent — the applicant's explicit decision to start, hold, or opt
 * out of a major journey stage (application, visa, travel).
 *
 * The consent card appears on the portal before each stage begins. Only
 * "continue" sends the case to Ops for handler assignment. "hold" pauses the
 * stage; "opt_out" cancels it.
 */

export type StageConsentRow = typeof stageConsents.$inferSelect;

/** Serialize a DB row to the API shape (dates → ISO strings). */
function serialize(row: StageConsentRow): StageConsent {
	return {
		id: row.id,
		applicationId: row.applicationId,
		stage: row.stage as StageConsentStage,
		decision: row.decision as StageConsentDecision,
		reason: row.reason,
		decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
		decidedByClientUserId: row.decidedByClientUserId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** Get the consent record for a specific application + stage, if any. */
export async function getStageConsent(
	applicationId: string,
	stage: StageConsentStage,
): Promise<StageConsent | null> {
	const [row] = await db
		.select()
		.from(stageConsents)
		.where(and(eq(stageConsents.applicationId, applicationId), eq(stageConsents.stage, stage)))
		.limit(1);
	return row ? serialize(row) : null;
}

/** List all consent records for an application. */
export async function listStageConsentsForApplication(applicationId: string): Promise<StageConsent[]> {
	const rows = await db
		.select()
		.from(stageConsents)
		.where(eq(stageConsents.applicationId, applicationId));
	return rows.map(serialize);
}

/**
 * Upsert the applicant's consent decision for a stage. Creates the record if
 * it doesn't exist; updates it if it does. Returns the serialized consent.
 */
export async function upsertStageConsent(input: {
	applicationId: string;
	stage: StageConsentStage;
	decision: StageConsentDecision;
	reason?: string;
	decidedByClientUserId?: string;
}): Promise<StageConsent> {
	const [existing] = await db
		.select()
		.from(stageConsents)
		.where(and(eq(stageConsents.applicationId, input.applicationId), eq(stageConsents.stage, input.stage)))
		.limit(1);

	const now = new Date();
	const reason = input.decision === "continue" ? null : (input.reason ?? null);

	if (existing) {
		const [updated] = await db
			.update(stageConsents)
			.set({
				decision: input.decision,
				reason,
				decidedAt: now,
				decidedByClientUserId: input.decidedByClientUserId ?? null,
				updatedAt: now,
			})
			.where(eq(stageConsents.id, existing.id))
			.returning();
		return serialize(updated);
	}

	const [created] = await db
		.insert(stageConsents)
		.values({
			applicationId: input.applicationId,
			stage: input.stage,
			decision: input.decision,
			reason,
			decidedAt: now,
			decidedByClientUserId: input.decidedByClientUserId ?? null,
		})
		.returning();
	return serialize(created);
}

/**
 * Resolve the application for a client user — used by the consent endpoints
 * to find the application the consent applies to.
 */
export async function getApplicationForClientUser(userId: string) {
	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.userId, userId))
		.limit(1);
	if (!applicant) throw new HttpError(404, "APPLICANT_NOT_FOUND", "Applicant not found");

	const [app] = await db
		.select()
		.from(applications)
		.where(eq(applications.applicantId, applicant.id))
		.orderBy(desc(applications.createdAt))
		.limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	return { applicant, application: app };
}
