import { and, desc, eq } from "drizzle-orm";
import {
	type ContinuationRequest,
	entryJourneyStage,
	normaliseScope,
	requestableStageFor,
	SERVICE_STAGE_LABELS,
	STAGE_INTAKE,
	type ServiceStage,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { applications, caseComments, stageContinuationRequests } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { notify } from "./notify.js";
import { emitDomain } from "../worker/pubsub.js";
import { getApplication, type Actor } from "./cases.js";
import { setApplicationPackage } from "./cases.js";
import { getApplicationForClientUser, upsertStageConsent } from "./stageConsents.js";

/**
 * Stage continuation — the "door swings both ways" half of completion.
 *
 * A client whose journey was completed (at the plan's exit, or early where
 * they stopped) can ask for the stage beyond it. The request waits on the
 * office; approving it extends the plan through the ordinary package
 * machinery — scope grows, the entry milestone bills, the stage's consent
 * is written from the request itself — and the case reopens at the new
 * stage's journey step. Declining needs a reason and tells the client.
 */

export type ContinuationRow = typeof stageContinuationRequests.$inferSelect;

function serialize(row: ContinuationRow): ContinuationRequest {
	return {
		id: row.id,
		applicationId: row.applicationId,
		stage: row.stage,
		note: row.note,
		status: row.status,
		decisionNote: row.decisionNote,
		decidedByName: row.decidedByName,
		decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
	};
}

/** The live request on a case, if one is waiting on the office. */
export async function pendingContinuationFor(applicationId: string): Promise<ContinuationRequest | null> {
	const [row] = await db
		.select()
		.from(stageContinuationRequests)
		.where(and(eq(stageContinuationRequests.applicationId, applicationId), eq(stageContinuationRequests.status, "pending")))
		.orderBy(desc(stageContinuationRequests.createdAt))
		.limit(1);
	return row ? serialize(row) : null;
}

/** The most recent request of any status — a declined one carries the reason. */
export async function lastContinuationFor(applicationId: string): Promise<ContinuationRequest | null> {
	const [row] = await db
		.select()
		.from(stageContinuationRequests)
		.where(eq(stageContinuationRequests.applicationId, applicationId))
		.orderBy(desc(stageContinuationRequests.createdAt))
		.limit(1);
	return row ? serialize(row) : null;
}

/** The client asks for the stage beyond their plan's exit. */
export async function requestContinuation(input: {
	applicantUserId: string;
	note?: string;
}): Promise<ContinuationRequest> {
	const { application } = await getApplicationForClientUser(input.applicantUserId);
	if (application.stage !== "completed") {
		throw new HttpError(409, "NOT_COMPLETED", "A stage can be requested once the journey is complete.");
	}
	const stage = requestableStageFor(application.scopeStages);
	if (!stage) throw new HttpError(409, "NOTHING_TO_ADD", "The plan already covers the whole journey.");
	const existing = await pendingContinuationFor(application.id);
	if (existing) return existing;

	const [row] = await db
		.insert(stageContinuationRequests)
		.values({ applicationId: application.id, stage, note: input.note?.trim() || null })
		.returning();

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: application.id,
		kind: "status",
		text: `Client requested the ${SERVICE_STAGE_LABELS[stage]} stage${input.note ? ` — "${input.note.trim()}"` : ""}`,
		authorName: "Applicant",
		authorOpsUserId: null,
	});
	emitDomain(
		"case.updated",
		{ caseId: application.id, targetType: "application", continuation: true },
		{ ops: true, userId: input.applicantUserId },
	);
	return serialize(row);
}

/** The client takes the request back before the office decides. */
export async function withdrawContinuation(input: { applicantUserId: string }): Promise<ContinuationRequest> {
	const { application } = await getApplicationForClientUser(input.applicantUserId);
	const pending = await pendingContinuationFor(application.id);
	if (!pending) throw new HttpError(404, "CONTINUATION_NOT_FOUND", "No pending request to withdraw.");
	const [row] = await db
		.update(stageContinuationRequests)
		.set({ status: "withdrawn", updatedAt: new Date() })
		.where(eq(stageContinuationRequests.id, pending.id))
		.returning();
	emitDomain("case.updated", { caseId: application.id, targetType: "application", continuation: true }, { ops: true });
	return serialize(row);
}

/**
 * The office decides. Approving extends the plan (new stage lines on the
 * agency invoice), records the stage's consent — the request is the
 * consent — and reopens the case into the stage's journey step, which
 * fires its due trigger and asks for the stage's handler.
 */
export async function decideContinuation(input: {
	requestId: string;
	applicationId?: string;
	decision: "approved" | "declined";
	note?: string;
	actor: Actor;
}): Promise<{ request: ContinuationRequest; applicationId: string }> {
	const [req] = await db.select().from(stageContinuationRequests).where(eq(stageContinuationRequests.id, input.requestId)).limit(1);
	if (!req || (input.applicationId && req.applicationId !== input.applicationId)) {
		throw new HttpError(404, "CONTINUATION_NOT_FOUND", "Continuation request not found");
	}
	if (req.status !== "pending") throw new HttpError(409, "CONTINUATION_DECIDED", `This request is already ${req.status}.`);

	const row = await getApplication(req.applicationId);
	if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");

	if (input.decision === "declined") {
		if (!input.note?.trim()) {
			throw new HttpError(400, "NOTE_REQUIRED", "Declining a continuation needs a reason the client can read.");
		}
		const [updated] = await db
			.update(stageContinuationRequests)
			.set({ status: "declined", decisionNote: input.note.trim(), decidedByOpsUserId: input.actor.opsUserId, decidedByName: input.actor.name, decidedAt: new Date(), updatedAt: new Date() })
			.where(eq(stageContinuationRequests.id, req.id))
			.returning();
		await db.insert(caseComments).values({
			targetType: "application",
			targetId: row.id,
			kind: "status",
			text: `Continuation declined: ${SERVICE_STAGE_LABELS[req.stage as ServiceStage]} — ${input.note.trim()}`,
			authorName: input.actor.name,
			authorOpsUserId: input.actor.opsUserId,
		});
		const declinedClientUserId = await applicantUserIdFor(row.applicantId);
		if (declinedClientUserId) {
			notify({
				recipientUserId: declinedClientUserId,
				type: "stage.changed",
				title: "Your request was declined",
				body: `The ${SERVICE_STAGE_LABELS[req.stage as ServiceStage]} stage was not added: ${input.note.trim()}`,
				link: "/portal/complete",
			}).catch(() => {});
		}
		emitDomain("case.updated", { caseId: row.id, targetType: "application", continuation: true }, { ops: true });
		return { request: serialize(updated), applicationId: row.id };
	}

	// Approved: the plan grows — the stage's lines land on the agency
	// invoice through the ordinary machinery.
	if (row.stage !== "completed") {
		throw new HttpError(409, "NOT_COMPLETED", "The case is no longer completed — it may already have reopened.");
	}
	const extended = normaliseScope([...(row.scopeStages ?? []), req.stage]);
	if (!(row.scopeStages ? normaliseScope(row.scopeStages) : []).includes(req.stage as ServiceStage)) {
		await setApplicationPackage({
			id: row.id,
			packageCode: row.fundingTrack,
			degreeLevel: row.degreeLevel,
			stages: extended,
			actor: { name: input.actor.name, opsUserId: input.actor.opsUserId, reason: `Continuation approved — ${SERVICE_STAGE_LABELS[req.stage as ServiceStage]} requested by the client` },
			internal: true,
		});
	}

	// The request is the stage's consent — written, not implied.
	const clientUserId = await applicantUserIdFor(row.applicantId);
	await upsertStageConsent({
		applicationId: row.id,
		stage: req.stage === "departure" ? "travel" : "visa",
		decision: "continue",
		decidedByClientUserId: clientUserId ?? undefined,
	});

	const resumeStage = entryJourneyStage([req.stage]);
	const [reopened] = await db
		.update(applications)
		.set({ stage: resumeStage, completedAtStage: null, completionNote: null, updatedAt: new Date() })
		.where(and(eq(applications.id, row.id), eq(applications.stage, "completed")))
		.returning();
	if (!reopened) throw new HttpError(409, "NOT_COMPLETED", "The case already left completed state.");

	if (resumeStage === "travel_assistance") {
		const { seedPreDepartureTasks } = await import("./preDeparture.js");
		await seedPreDepartureTasks(row.id);
	}
	// The stage's milestone fires with its file opening.
	if (resumeStage === "visa_processing") {
		const { fireDueTrigger } = await import("./serviceFee.js");
		await fireDueTrigger(row.id, "visa_open");
	}
	if (resumeStage === "travel_assistance") {
		const { fireDueTrigger } = await import("./serviceFee.js");
		await fireDueTrigger(row.id, "visa_approved");
	}

	const [decided] = await db
		.update(stageContinuationRequests)
		.set({ status: "approved", decisionNote: input.note?.trim() || null, decidedByOpsUserId: input.actor.opsUserId, decidedByName: input.actor.name, decidedAt: new Date(), updatedAt: new Date() })
		.where(eq(stageContinuationRequests.id, req.id))
		.returning();

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "status",
		text: `Continuation approved: ${SERVICE_STAGE_LABELS[req.stage as ServiceStage]} added · case reopened at ${resumeStage.replace(/_/g, " ")}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	// The reopened stage needs its specialist — the ordinary handoff asks.
	const { createOrGetHandoff } = await import("./handoffs.js");
	await createOrGetHandoff({ applicationId: row.id, stage: resumeStage, source: "stage_transition", fromOpsUserId: null });

	if (clientUserId) {
		notify({
			recipientUserId: clientUserId,
			type: "stage.changed",
			title: `${SERVICE_STAGE_LABELS[req.stage as ServiceStage]} added to your plan`,
			body: "Your request was approved — the stage is open, and its invoice and intake are on your portal.",
			link: "/portal/journey",
		}).catch(() => {});
	}
	emitDomain("case.updated", { caseId: row.id, targetType: "application", continuation: true }, { ops: true, userId: clientUserId });
	return { request: serialize(decided), applicationId: row.id };
}

async function applicantUserIdFor(applicantId: string): Promise<string | null> {
	const { getApplicant } = await import("./cases.js");
	const applicant = await getApplicant(applicantId);
	return applicant?.userId ?? null;
}

/**
 * The stage's intake pack — the questions and answers an entrant would have
 * given at assessment, collected at the stage that actually needs them.
 * Stored under the stage's key on `applications.stageIntake`; resubmitting
 * the same stage overwrites its answers.
 */
export async function submitStageIntake(input: {
	applicantUserId: string;
	stage: ServiceStage;
	answers: Record<string, string>;
}): Promise<Record<string, Record<string, string>>> {
	const { application } = await getApplicationForClientUser(input.applicantUserId);
	if (input.stage === "admissions") {
		throw new HttpError(400, "INTAKE_STAGE_INVALID", "Admissions intake is collected at assessment.");
	}
	if (!(application.scopeStages ?? []).includes(input.stage)) {
		throw new HttpError(409, "STAGE_NOT_IN_PLAN", `The ${SERVICE_STAGE_LABELS[input.stage]} stage is not on the plan.`);
	}
	const allowed = new Set(STAGE_INTAKE[input.stage].fields.map((f) => f.id));
	const answers: Record<string, string> = {};
	for (const [k, v] of Object.entries(input.answers)) {
		const value = typeof v === "string" ? v.trim() : "";
		if (allowed.has(k) && value) answers[k] = value;
	}
	const merged = { ...(application.stageIntake as Record<string, Record<string, string>> | null), [input.stage]: answers };
	await db.update(applications).set({ stageIntake: merged, updatedAt: new Date() }).where(eq(applications.id, application.id));

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: application.id,
		kind: "status",
		text: `Client submitted the ${SERVICE_STAGE_LABELS[input.stage]} intake`,
		authorName: "Applicant",
		authorOpsUserId: null,
	});
	emitDomain("case.updated", { caseId: application.id, targetType: "application", intake: true }, { ops: true });
	return merged as Record<string, Record<string, string>>;
}
