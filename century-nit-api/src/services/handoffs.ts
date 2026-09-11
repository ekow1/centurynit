import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
	JOURNEY_STAGE_LABELS,
	STAGE_OWNER_CLASS,
	isOwnerClassBoundary,
	type JourneyStage,
	type StageHandoff,
	type StageHandoffPreview,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	caseComments,
	opsUsers,
	stageAssignments,
	stageHandoffs,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { notify, notifyMany, getStaffUserId, getManagerAndCoordinatorUserIds } from "./notify.js";

// Owner classes and the boundary rule live in century-nit-shared (journey.ts)
// so the ops console applies the same rule when it offers "keep".
export { STAGE_OWNER_CLASS, isOwnerClassBoundary };

/**
 * Boundary stages that hard-gate on entry — the case stays parked at its
 * predecessor until the manager resolves the handoff, exactly like the visa
 * `awaiting_handler` gate. `visa_processing` is excluded: its gate is the
 * payment-triggered sub-state, and `completed` is terminal. The consultant-run
 * stages never gate (same owner continues).
 *
 * `document_verification` is NOT in this set — it's the first stage, so cases
 * start there rather than transitioning into it. Its handler-assignment handoff
 * is created by the 10% deposit payment (not a stage transition), and the
 * pending handoff itself is what signals "Pending Handler Assignment" to ops.
 */
export const AWAITING_ASSIGNMENT_STAGES: ReadonlySet<JourneyStage> = new Set([
	"payment_execution",
	"travel_assistance",
]);

export function isAwaitingAssignmentBoundary(stage: JourneyStage): boolean {
	return AWAITING_ASSIGNMENT_STAGES.has(stage);
}

type Actor = { opsUserId: string; name: string; email: string };
export type HandoffRow = typeof stageHandoffs.$inferSelect;

/**
 * Who handles `stage` on this application: the stage's specialist if one is
 * assigned, otherwise the whole-case owner. Those are the only two places
 * ownership lives (see caseOwnership.ts).
 */
export async function activeHandlerFor(
	applicationId: string,
	stage: string,
	tx: typeof db = db,
): Promise<{ opsUserId: string; name: string; email: string } | null> {
	const [stageRow] = await tx
		.select({ opsUserId: stageAssignments.opsUserId, name: opsUsers.name, email: opsUsers.email })
		.from(stageAssignments)
		.innerJoin(opsUsers, eq(stageAssignments.opsUserId, opsUsers.id))
		.where(
			and(
				eq(stageAssignments.applicationId, applicationId),
				eq(stageAssignments.stage, stage),
				eq(stageAssignments.status, "active"),
			),
		)
		.limit(1);
	if (stageRow) return stageRow;

	const [owner] = await tx
		.select({ opsUserId: opsUsers.id, name: opsUsers.name, email: opsUsers.email })
		.from(applications)
		.innerJoin(opsUsers, eq(applications.assignedStaffId, opsUsers.id))
		.where(eq(applications.id, applicationId))
		.limit(1);
	return owner ?? null;
}

/** True when the stage has a handler — a specialist or the case owner. */
export async function stageHasActiveHandler(
	applicationId: string,
	stage: string,
	tx: typeof db = db,
): Promise<boolean> {
	return Boolean(await activeHandlerFor(applicationId, stage, tx));
}

export async function createOrGetHandoff(input: {
	applicationId: string;
	stage: string;
	source: string;
	fromOpsUserId?: string | null;
	tx?: typeof db;
}): Promise<HandoffRow> {
	const txDb = input.tx ?? db;
	const existing = await txDb
		.select()
		.from(stageHandoffs)
		.where(
			and(
				eq(stageHandoffs.applicationId, input.applicationId),
				eq(stageHandoffs.stage, input.stage),
				eq(stageHandoffs.status, "pending"),
			),
		)
		.limit(1);
	if (existing[0]) {
		if (!existing[0].fromOpsUserId && input.fromOpsUserId) {
			const [updated] = await txDb
				.update(stageHandoffs)
				.set({ fromOpsUserId: input.fromOpsUserId, updatedAt: new Date() })
				.where(eq(stageHandoffs.id, existing[0].id))
				.returning();
			if (updated) return updated;
		}
		return existing[0];
	}
	try {
		const [created] = await txDb
			.insert(stageHandoffs)
			.values({
				applicationId: input.applicationId,
				stage: input.stage,
				source: input.source,
				fromOpsUserId: input.fromOpsUserId ?? null,
			})
			.returning();
		return created;
	} catch (err) {
		// Partial unique index race — a concurrent writer won; return theirs.
		const [winner] = await txDb
			.select()
			.from(stageHandoffs)
			.where(
				and(
					eq(stageHandoffs.applicationId, input.applicationId),
					eq(stageHandoffs.stage, input.stage),
					eq(stageHandoffs.status, "pending"),
				),
			)
			.limit(1);
		if (winner) return winner;
		throw err;
	}
}

/**
 * Visa payment handoff: after the visa invoice is paid the case moves to
 * `awaiting_handler`, so the portal shows "assigning your specialist" instead
 * of the case being open. The visa_officer boundary is what makes this
 * different from the applause-driven consultation stages — no continuity
 * candidate is presumed.
 */
export async function ensureVisaHandoffForApplication(input: {
	applicationId: string;
	tx?: typeof db;
}): Promise<HandoffRow> {
	const txDb = input.tx ?? db;
	const [app] = await txDb
		.select({ id: applications.id, stage: applications.stage })
		.from(applications)
		.where(eq(applications.id, input.applicationId))
		.limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	const handler = await activeHandlerFor(app.id, app.stage, txDb);
	return createOrGetHandoff({
		applicationId: app.id,
		stage: "visa_processing",
		source: "visa_payment",
		fromOpsUserId: handler?.opsUserId ?? null,
		tx: txDb,
	});
}

async function serializeHandoff(row: HandoffRow): Promise<StageHandoff> {
	const [app] = await db
		.select({ applicationNumber: applications.appNumber, applicantName: applicants.name })
		.from(applications)
		.innerJoin(applicants, eq(applicants.id, applications.applicantId))
		.where(eq(applications.id, row.applicationId))
		.limit(1);
	const [fromNameRow] = row.fromOpsUserId
		? await db.select({ name: opsUsers.name }).from(opsUsers).where(eq(opsUsers.id, row.fromOpsUserId)).limit(1)
		: [null];
	const [resolvedNameRow] = row.resolvedOpsUserId
		? await db.select({ name: opsUsers.name }).from(opsUsers).where(eq(opsUsers.id, row.resolvedOpsUserId)).limit(1)
		: [null];
	return {
		id: row.id,
		applicationId: row.applicationId,
		applicationNumber: app?.applicationNumber ?? null,
		applicantName: app?.applicantName ?? null,
		stage: row.stage,
		source: row.source,
		status: row.status,
		decision: row.decision,
		fromOpsUserId: row.fromOpsUserId,
		fromOpsUserName: fromNameRow?.name ?? null,
		resolvedOpsUserId: row.resolvedOpsUserId,
		resolvedOpsUserName: resolvedNameRow?.name ?? null,
		decidedBy: row.decidedBy,
		decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
		deferredAt: row.deferredAt ? row.deferredAt.toISOString() : null,
		deferCount: row.deferCount,
		reason: row.reason,
		createdAt: row.createdAt.toISOString(),
	};
}

async function getHandoffRow(handoffId: string): Promise<HandoffRow> {
	const [row] = await db.select().from(stageHandoffs).where(eq(stageHandoffs.id, handoffId)).limit(1);
	if (!row) throw new HttpError(404, "HANDOFF_NOT_FOUND", "Handoff not found");
	return row;
}

export async function listStageHandoffs(query: { status?: "pending" | "all" } = {}): Promise<StageHandoff[]> {
	const conds = query.status === "all" ? [] : [eq(stageHandoffs.status, "pending")];
	const rows = await db
		.select()
		.from(stageHandoffs)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(
			// Pending first; within a status, longest waiting surfaces first.
			desc(sql`CASE WHEN ${stageHandoffs.status} = 'pending' THEN 0 ELSE 1 END`),
			asc(stageHandoffs.createdAt),
		);
	return Promise.all(rows.map(serializeHandoff));
}

export async function getStageHandoff(handoffId: string): Promise<StageHandoff> {
	return serializeHandoff(await getHandoffRow(handoffId));
}

/**
 * The open gated assignment parked on an application, if any — surfaced on the
 * journey tracker and in the ops case view ("awaiting specialist assignment").
 */
export async function pendingHandoffForApplication(
	applicationId: string,
	tx: typeof db = db,
): Promise<StageHandoffPreview | null> {
	const [row] = await tx
		.select()
		.from(stageHandoffs)
		.where(and(eq(stageHandoffs.applicationId, applicationId), eq(stageHandoffs.status, "pending")))
		.orderBy(asc(stageHandoffs.createdAt))
		.limit(1);
	if (!row) return null;
	// Use the process-level db for the name lookup: tx may be a transaction for
	// the row itself, and read-only enrichment does not need to join it.
	const [fromNameRow] = row.fromOpsUserId
		? await db.select({ name: opsUsers.name }).from(opsUsers).where(eq(opsUsers.id, row.fromOpsUserId)).limit(1)
		: [null];
	return {
		id: row.id,
		stage: row.stage as JourneyStage,
		source: row.source,
		fromOpsUserId: row.fromOpsUserId,
		fromOpsUserName: fromNameRow?.name ?? null,
		reason: row.reason,
		deferCount: row.deferCount,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * Resolve the assignment decision. Writes the active stage assignment through
 * the existing assignStageOfficer flow (which ends any prior stage handler,
 * downgrades their conversation participant role, and keeps history), then
 * activates any stage gate that was waiting:
 *  - visa: `awaiting_handler` → `pending` (case opened, tracking live).
 * Notifies the chosen handler and, once the case is staffed, the applicant.
 */
export async function resolveStageHandoff(input: {
	handoffId: string;
	decision: "keep" | "assign";
	opsUserId?: string;
	reason?: string;
	actor: Actor;
}): Promise<StageHandoff> {
	const row = await getHandoffRow(input.handoffId);
	if (row.status !== "pending") {
		throw new HttpError(409, "HANDOFF_ALREADY_RESOLVED", "Handoff has already been resolved");
	}

	const resolvedOpsUserId =
		input.decision === "keep" ? row.fromOpsUserId : input.opsUserId ?? null;
	if (!resolvedOpsUserId) {
		throw new HttpError(
			409,
			"INVALID_DECISION",
			input.decision === "keep"
				? "This stage has no previous handler to keep — assign a specialist instead."
				: "opsUserId is required when assigning a handler.",
		);
	}

	// The chosen handler must hold a role that may own this stage — "keep"
	// included: a consultant carried across the visa boundary is only fine if
	// consultants may own visa work (see STAGE_ASSIGNABLE_ROLES).
	const { loadAssignableStaff } = await import("./cases.js");
	await loadAssignableStaff(resolvedOpsUserId, row.stage);

	// Claim the handoff atomically. Two managers resolving the same handoff at
	// once must not both proceed: a plain SELECT ... FOR UPDATE outside a
	// transaction releases its lock immediately, so the status check above is
	// only advisory — this conditional update is the real guard.
	const [resolved] = await db
		.update(stageHandoffs)
		.set({
			status: "resolved",
			decision: input.decision,
			resolvedOpsUserId,
			decidedBy: input.actor.opsUserId,
			decidedAt: new Date(),
			reason: input.reason ?? null,
			updatedAt: new Date(),
		})
		.where(and(eq(stageHandoffs.id, row.id), eq(stageHandoffs.status, "pending")))
		.returning();
	if (!resolved) {
		throw new HttpError(409, "HANDOFF_ALREADY_RESOLVED", "Handoff has already been resolved");
	}

	const { assignStageOfficer, recordEvent } = await import("./communication.js");
	await assignStageOfficer({
		applicationId: row.applicationId,
		stage: row.stage,
		opsUserId: resolvedOpsUserId,
		assignedBy: input.actor.opsUserId,
		reason: input.reason ?? (input.decision === "keep" ? "handoff: keep current handler" : "handoff: assign specialist"),
	});

	// The school_submission handoff establishes the case owner for the whole
	// application and unlocks school selection. Advance the stage from
	// document_verification to school_submission and write assignedStaffId.
	if (row.stage === "school_submission") {
		const { setCaseOwner } = await import("./caseOwnership.js");
		await setCaseOwner({
			applicationId: row.applicationId,
			opsUserId: resolvedOpsUserId,
			assignedBy: input.actor.opsUserId,
			note: input.reason ?? `handoff: ${input.decision}`,
		});
		await db
			.update(applications)
			.set({ stage: "school_submission", updatedAt: new Date() })
			.where(and(eq(applications.id, row.applicationId), eq(applications.stage, "document_verification")));

		await db.insert(caseComments).values({
			targetType: "application",
			targetId: row.applicationId,
			kind: "status",
			text: "Stage → school_submission (specialist assigned)",
			authorName: input.actor.name,
			authorOpsUserId: input.actor.opsUserId,
		});

		const { applicantUserIdOfApplication } = await import("./cases.js");
		const clientUserId = await applicantUserIdOfApplication(row.applicationId);
		if (clientUserId) {
			notify({
				recipientUserId: clientUserId,
				type: "stage.changed",
				title: "Your application handler has been assigned",
				body: "A handler has been assigned to your case. You can now select your schools and programmes.",
				link: "/portal/application",
			}).catch(() => {});
		}
	} else if (row.stage === "visa_processing") {
		// Visa gate is the `awaiting_handler` sub-state: opening the case makes
		// visa tracking live for the applicant once the invoice is issued and paid.
		await db
			.update(applications)
			.set({ visaStage: "pending", updatedAt: new Date() })
			.where(and(eq(applications.id, row.applicationId), eq(applications.visaStage, "awaiting_handler")));

		const { applicantUserIdOfApplication, ensureVisaInvoiceForApplication } = await import("./cases.js");
		const clientUserId = await applicantUserIdOfApplication(row.applicationId);
		if (clientUserId) {
			await ensureVisaInvoiceForApplication(clientUserId, {
				opsUserId: input.actor.opsUserId,
				name: input.actor.name,
				email: input.actor.email,
			}).catch(() => {});
		}
	} else {
		// Finance/travel boundary stages gate on entry: the case was parked at
		// its predecessor. It is staffed now, so complete the transition.
		const { applyHandoffResolvedTransition } = await import("./cases.js");
		await applyHandoffResolvedTransition({
			applicationId: row.applicationId,
			stage: row.stage as JourneyStage,
			actor: input.actor,
		});
	}

	const [officer] = await db
		.select({ name: opsUsers.name, email: opsUsers.email })
		.from(opsUsers)
		.where(eq(opsUsers.id, resolvedOpsUserId))
		.limit(1);

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.applicationId,
		kind: "assignment",
		text:
			input.decision === "keep"
				? `Handoff: kept ${officer?.name ?? resolvedOpsUserId} on ${row.stage} (confirmed by ${input.actor.name}).`
				: `Handoff: assigned ${officer?.name ?? resolvedOpsUserId} to ${row.stage} (by ${input.actor.name}).`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	await recordEvent({
		action: "handoff_resolved",
		actorOpsUserId: input.actor.opsUserId,
		applicationId: row.applicationId,
		stageKey: row.stage,
		metadata: { handoffId: row.id, decision: input.decision, officer: resolvedOpsUserId, reason: input.reason },
	});

	// Notify the chosen handler.
	const staffUserId = await getStaffUserId(resolvedOpsUserId);
	if (staffUserId) {
		await notify({
			recipientUserId: staffUserId,
			type: "assignment.handoff_resolved",
			title: "New case handler",
			body: `You are the handler for ${JOURNEY_STAGE_LABELS[row.stage as JourneyStage] ?? row.stage}.`,
			link: "/applications",
		}).catch(() => {});
	}

	// Notify the applicant that their specialist is confirmed. Visa tracking
	// specifically turns live at this point; other gated stages announce the
	// move itself inside applyHandoffResolvedTransition.
	const { applicantUserIdOfApplication } = await import("./cases.js");
	const clientUserId = await applicantUserIdOfApplication(row.applicationId);
	if (clientUserId && row.stage === "visa_processing") {
		await notify({
			recipientUserId: clientUserId,
			type: "visa.stage_changed",
			title: "Your visa specialist is confirmed",
			body: `Your case handler is ${officer?.name ?? "confirmed"}. Visa tracking is now live.`,
			link: "/portal/visa/tracking",
		}).catch(() => {});
	}

	return serializeHandoff(resolved);
}

/** Requeue — leaves the handoff pending and re-alerts management. */
export async function deferStageHandoff(input: {
	handoffId: string;
	reason?: string;
	actor: Actor;
}): Promise<StageHandoff> {
	const [row] = await db
		.select()
		.from(stageHandoffs)
		.where(eq(stageHandoffs.id, input.handoffId))
		.limit(1)
		.for("update");
	if (!row) throw new HttpError(404, "HANDOFF_NOT_FOUND", "Handoff not found");
	if (row.status !== "pending") {
		throw new HttpError(409, "HANDOFF_ALREADY_RESOLVED", "Handoff has already been resolved");
	}

	const [updated] = await db
		.update(stageHandoffs)
		.set({
			deferredBy: input.actor.opsUserId,
			deferredAt: new Date(),
			deferCount: row.deferCount + 1,
			reason: input.reason ?? row.reason,
			updatedAt: new Date(),
		})
		.where(eq(stageHandoffs.id, row.id))
		.returning();

	const { recordEvent } = await import("./communication.js");
	await recordEvent({
		action: "handoff_deferred",
		actorOpsUserId: input.actor.opsUserId,
		applicationId: row.applicationId,
		stageKey: row.stage,
		metadata: { handoffId: row.id, deferCount: row.deferCount + 1, reason: input.reason },
	});

	const recipients = await getManagerAndCoordinatorUserIds();
	await notifyMany(
		recipients.map((r) => ({
			recipientUserId: r.userId,
			type: "stage.needs_handler",
			title: "Case still needs a handler",
			body: `Application ${row.applicationId} still awaits a ${JOURNEY_STAGE_LABELS[row.stage as JourneyStage] ?? row.stage} assignment.`,
			link: "/applications",
			entityType: "case",
			entityId: row.applicationId,
			caseId: row.applicationId,
		})),
	).catch(() => {});

	return serializeHandoff(updated);
}