import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
	JOURNEY_STAGES,
	JOURNEY_STAGE_LABELS,
	STAGE_OWNER_CLASS,
	isOwnerClassBoundary,
	type CaseSeat,
	type CaseTeam,
	type JourneyStage,
	type StageHandoff,
	type StageHandoffPreview,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	caseAssignments,
	caseComments,
	conversations,
	conversationParticipants,
	opsUsers,
	staffPresence,
	stageAssignments,
	stageHandoffs,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { notify, notifyMany, getStaffUserId, getManagerAndCoordinatorUserIds } from "./notify.js";
import { emitDomain } from "../worker/pubsub.js";

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
		// A new item in the handoff queue — every console refetches. When this
		// runs inside a transaction (the deposit/visa payment paths) the event
		// may land a beat early; the caller's own committed event (e.g.
		// payment.recorded) covers the refresh either way.
		emitDomain(
			"handoff.opened",
			{ handoffId: created.id, applicationId: input.applicationId, stage: input.stage, source: input.source },
			{ ops: true },
		);
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
}): Promise<HandoffRow | null> {
	const txDb = input.tx ?? db;
	const [app] = await txDb
		.select({ id: applications.id, stage: applications.stage, assignedStaffId: applications.assignedStaffId })
		.from(applications)
		.where(eq(applications.id, input.applicationId))
		.limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");

	// Carry-through: a whole-case owner (assignedStaffId, coverage "all")
	// continues into the visa chapter without a placement decision — the seat
	// is theirs until a manager reassigns. Only a stage-only or empty seat
	// parks the case on a handoff.
	if (app.assignedStaffId) {
		await txDb
			.update(applications)
			.set({ visaStage: "pending", updatedAt: new Date() })
			.where(and(eq(applications.id, app.id), eq(applications.visaStage, "awaiting_handler")));
		// Write goes through the outer db — it can outlive this transaction.
		// A failure still leaves the owner as the stage's handler via
		// activeHandlerFor's assignedStaffId fallback, so it is best-effort.
		const { assignStageOfficer } = await import("./communication.js");
		await assignStageOfficer({
			applicationId: app.id,
			stage: "visa_processing",
			opsUserId: app.assignedStaffId,
			assignedBy: app.assignedStaffId,
			reason: "carry-through: whole-case handler",
			scope: "stage",
		}).catch(() => {});
		return null;
	}

	const handler = await activeHandlerFor(app.id, app.stage, txDb);
	return createOrGetHandoff({
		applicationId: app.id,
		stage: "visa_processing",
		source: "visa_payment",
		fromOpsUserId: handler?.opsUserId ?? null,
		tx: txDb,
	});
}

/**
 * Travel assistance handoff — mirrors the visa handoff. When the applicant says
 * "yes" to travel assistance, a `travel_assistance` handoff is created so the
 * case appears in the same Workspace "Needs assignment" queue and on the Cases
 * board handoff column as application and visa. The manager resolves it (keep
 * or assign) exactly like the other stages; `assignHandler` in travelAssistance
 * resolves any pending travel handoff when a handler is assigned directly.
 */
export async function ensureTravelHandoffForApplication(input: {
	applicationId: string;
	tx?: typeof db;
}): Promise<HandoffRow | null> {
	const txDb = input.tx ?? db;
	const [app] = await txDb
		.select({ id: applications.id, stage: applications.stage, assignedStaffId: applications.assignedStaffId })
		.from(applications)
		.where(eq(applications.id, input.applicationId))
		.limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");

	// Carry-through — same rule as the visa handoff above.
	if (app.assignedStaffId) {
		const { assignStageOfficer } = await import("./communication.js");
		await assignStageOfficer({
			applicationId: app.id,
			stage: "travel_assistance",
			opsUserId: app.assignedStaffId,
			assignedBy: app.assignedStaffId,
			reason: "carry-through: whole-case handler",
			scope: "stage",
		}).catch(() => {});
		return null;
	}

	const handler = await activeHandlerFor(app.id, app.stage, txDb);
	return createOrGetHandoff({
		applicationId: app.id,
		stage: "travel_assistance",
		source: "travel_consent_continue",
		fromOpsUserId: handler?.opsUserId ?? null,
		tx: txDb,
	});
}

/**
 * Resolve any pending `travel_assistance` handoff for an application after a
 * handler is assigned directly on the travel request. Mirrors the resolution
 * that `resolveStageHandoff` performs for the other stages, so the handoff
 * disappears from the Workspace queue once the case is staffed.
 */
export async function resolveTravelHandoffForApplication(input: {
	applicationId: string;
	opsUserId: string;
	actor: Actor;
}): Promise<void> {
	const [pending] = await db
		.select()
		.from(stageHandoffs)
		.where(
			and(
				eq(stageHandoffs.applicationId, input.applicationId),
				eq(stageHandoffs.stage, "travel_assistance"),
				eq(stageHandoffs.status, "pending"),
			),
		)
		.limit(1);
	if (!pending) return;
	await db
		.update(stageHandoffs)
		.set({
			status: "resolved",
			decision: "assign",
			resolvedOpsUserId: input.opsUserId,
			decidedBy: input.actor.opsUserId,
			decidedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(stageHandoffs.id, pending.id));
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
		escalatedAt: row.escalatedAt ? row.escalatedAt.toISOString() : null,
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
		escalatedAt: row.escalatedAt ? row.escalatedAt.toISOString() : null,
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
	/**
	 * Coverage — `stage` seats the handler on this stage only (the seat
	 * re-opens at the next chapter); `all` makes them carry the rest of the
	 * case. Keep resolutions always seat the stage only.
	 */
	scope?: "stage" | "all";
	/** Referral — the branch the case is owned by after this resolution. */
	branch?: string;
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
	// Coverage defaults to this stage only — carry-through is an explicit
	// choice, never the silent default. "keep" is always stage-scoped.
	const scope = input.decision === "keep" ? "stage" : (input.scope ?? "stage");
	await assignStageOfficer({
		applicationId: row.applicationId,
		stage: row.stage,
		opsUserId: resolvedOpsUserId,
		assignedBy: input.actor.opsUserId,
		reason: input.reason ?? (input.decision === "keep" ? "handoff: keep current handler" : "handoff: assign specialist"),
		scope,
	});

	// A referral moves the file's owning office — recorded on the case, not
	// the applicant: the client's location is not the branch that handles them.
	let referredBranch: string | null = null;
	if (input.branch) {
		const { canonicalBranchId } = await import("./availability.js");
		referredBranch = canonicalBranchId(input.branch);
		if (!referredBranch) throw new HttpError(400, "BRANCH_NOT_FOUND", `Unknown branch: ${input.branch}`);
		await db
			.update(applications)
			.set({ branch: referredBranch, updatedAt: new Date() })
			.where(eq(applications.id, row.applicationId));
	}

	// The school_submission handoff opens school selection once staffed.
	// Whole-case ownership follows coverage — `scope === "all"` already wrote
	// it through assignStageOfficer above; a stage-scoped seat leaves the
	// case-owner seat open so the next chapter asks for a handler again.
	if (row.stage === "school_submission") {
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
				title: "Your consultant has been assigned",
				body: "Your consultant is now on your case. You can now choose your schools and programmes.",
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

		// The seated officer raises the visa invoice from the case; the
		// Workspace carries it as a task until they do.
	} else if (row.stage === "travel_assistance") {
		// Travel handoff resolved from the Workspace queue: mirror the
		// assignment onto the travel assistance request so the Travel page
		// (which reads `assignedOpsUserId`) stays in sync. The stage_assignment
		// written by assignStageOfficer above is the source of truth.
		const { travelAssistanceRequests } = await import("../db/schema.js");
		await db
			.update(travelAssistanceRequests)
			.set({ assignedOpsUserId: resolvedOpsUserId, updatedAt: new Date() })
			.where(
				and(
					eq(travelAssistanceRequests.applicationId, row.applicationId),
					eq(travelAssistanceRequests.status, "review"),
				),
			);
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

	const coverageNote =
		input.decision === "keep"
			? ""
			: input.scope === "all"
				? " — carries the rest of the case"
				: " — this stage only";
	const branchNote = referredBranch ? ` · file referred to ${referredBranch}` : "";
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.applicationId,
		kind: "assignment",
		text:
			input.decision === "keep"
				? `Handoff: kept ${officer?.name ?? resolvedOpsUserId} on ${row.stage} (confirmed by ${input.actor.name}).${branchNote}`
				: `Handoff: assigned ${officer?.name ?? resolvedOpsUserId} to ${row.stage}${coverageNote}${branchNote} (by ${input.actor.name}).`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	await recordEvent({
		action: "handoff_resolved",
		actorOpsUserId: input.actor.opsUserId,
		applicationId: row.applicationId,
		stageKey: row.stage,
		metadata: { handoffId: row.id, decision: input.decision, officer: resolvedOpsUserId, reason: input.reason, scope: input.scope, branch: input.branch },
	});

	// Notify the chosen handler.
	const staffUserId = await getStaffUserId(resolvedOpsUserId);
	if (staffUserId) {
		await notify({
			recipientUserId: staffUserId,
			type: "assignment.handoff_resolved",
			title: "You handle a chapter",
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
			title: "Your visa officer is confirmed",
			body: `Your visa officer is ${officer?.name ?? "confirmed"}. Visa tracking is now open.`,
			link: "/portal/visa/tracking",
		}).catch(() => {});
	}

	// Every console's handoff queue + case list and the portal's journey all
	// follow this resolution — a domain event, not a bell row.
	emitDomain(
		"handoff.resolved",
		{ handoffId: row.id, applicationId: row.applicationId, stage: row.stage, officerId: resolvedOpsUserId },
		{ ops: true, userId: clientUserId },
	);

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

	emitDomain(
		"handoff.updated",
		{ handoffId: row.id, applicationId: row.applicationId, stage: row.stage, deferred: true },
		{ ops: true },
	);

	return serializeHandoff(updated);
}
/* ── Return to queue ─────────────────────────────────────────────────────────
 *
 * Release a seat back to the staffing queue — the whole-case owner ("owner")
 * or a stage specialist. The assignment row ends (history kept) and a
 * `manual_release` handoff opens on the case's current stage, so the case
 * resurfaces in the Workspace queue for re-staffing. Managers only — the
 * route gates on `assign_work`.
 */
export async function releaseApplicationSeat(input: {
	applicationId: string;
	/** `"owner"` for the whole-case handler, else a journey stage seat. */
	seat: string;
	note?: string;
	actor: Actor;
}): Promise<StageHandoff> {
	const [app] = await db
		.select()
		.from(applications)
		.where(eq(applications.id, input.applicationId))
		.limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");

	let releasedOpsUserId: string | null = null;

	if (input.seat === "owner") {
		if (!app.assignedStaffId) {
			throw new HttpError(409, "SEAT_ALREADY_OPEN", "This case has no whole-case handler to release.");
		}
		releasedOpsUserId = app.assignedStaffId;
		const { endAssignment } = await import("./caseAssignments.js");
		await endAssignment({
			targetType: "application",
			targetId: app.id,
			endedBy: input.actor.opsUserId,
			endReason: "unassigned",
		});
		await db
			.update(applications)
			.set({ assignedStaffId: null, updatedAt: new Date() })
			.where(eq(applications.id, app.id));
		await db
			.update(applicants)
			.set({ assignedOfficerId: null, updatedAt: new Date() })
			.where(eq(applicants.id, app.applicantId));
	} else {
		const [seat] = await db
			.select()
			.from(stageAssignments)
			.where(
				and(
					eq(stageAssignments.applicationId, app.id),
					eq(stageAssignments.stage, input.seat),
					eq(stageAssignments.status, "active"),
				),
			)
			.limit(1);
		if (!seat) {
			throw new HttpError(409, "SEAT_ALREADY_OPEN", `No active ${input.seat} seat to release.`);
		}
		releasedOpsUserId = seat.opsUserId;
		await db
			.update(stageAssignments)
			.set({
				status: "released",
				endedAt: new Date(),
				endedReason: input.note ?? "released to queue",
			})
			.where(eq(stageAssignments.id, seat.id));
		// Same demotion reassignment applies — the released officer becomes a
		// `former` participant on the stage conversation.
		const [stageConv] = await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(
				and(
					eq(conversations.linkedEntityType, "application"),
					eq(conversations.linkedEntityId, app.id),
					eq(conversations.stageKey, input.seat),
					eq(conversations.type, "stage"),
				),
			)
			.limit(1);
		if (stageConv) {
			await db
				.update(conversationParticipants)
				.set({ role: "former" })
				.where(
					and(
						eq(conversationParticipants.conversationId, stageConv.id),
						eq(conversationParticipants.opsUserId, seat.opsUserId),
					),
				);
		}
	}

	// The released seat becomes a manual_release handoff on the case's current
	// stage — the queue picks it up from there.
	const handoff = await createOrGetHandoff({
		applicationId: app.id,
		stage: app.stage,
		source: "manual_release",
		fromOpsUserId: releasedOpsUserId,
	});
	if (input.note) {
		await db
			.update(stageHandoffs)
			.set({ reason: input.note, updatedAt: new Date() })
			.where(eq(stageHandoffs.id, handoff.id));
	}

	const seatLabel =
		input.seat === "owner"
			? "whole-case handler"
			: (JOURNEY_STAGE_LABELS[input.seat as JourneyStage] ?? input.seat);
	const [released] = releasedOpsUserId
		? await db.select({ name: opsUsers.name }).from(opsUsers).where(eq(opsUsers.id, releasedOpsUserId)).limit(1)
		: [null];

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: app.id,
		kind: "assignment",
		text: `Released ${released?.name ?? "handler"} from ${seatLabel} — seat returned to queue (by ${input.actor.name}).${input.note ? ` ${input.note}` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	const { recordEvent } = await import("./communication.js");
	await recordEvent({
		action: "seat_released",
		actorOpsUserId: input.actor.opsUserId,
		applicationId: app.id,
		stageKey: app.stage,
		metadata: { seat: input.seat, releasedOpsUserId, handoffId: handoff.id, note: input.note },
	});

	// The released officer hears about it — a seat should never just vanish.
	if (releasedOpsUserId) {
		const releasedUserId = await getStaffUserId(releasedOpsUserId);
		if (releasedUserId) {
			await notify({
				recipientUserId: releasedUserId,
				type: "assignment.released",
				title: "Seat returned to queue",
				body: `Your ${seatLabel} seat was returned to the queue.${input.note ? ` ${input.note}` : ""}`,
				link: "/applications",
				entityType: "case",
				entityId: app.id,
				caseId: app.id,
			}).catch(() => {});
		}
	}

	const recipients = await getManagerAndCoordinatorUserIds();
	await notifyMany(
		recipients.map((r) => ({
			recipientUserId: r.userId,
			type: "stage.needs_handler",
			title: "Seat released — case needs a handler",
			body: `${released?.name ?? "A handler"} was released from ${seatLabel}; the case is back in the queue.`,
			link: "/applications",
			entityType: "case",
			entityId: app.id,
			caseId: app.id,
		})),
	).catch(() => {});

	emitDomain(
		"handoff.updated",
		{ handoffId: handoff.id, applicationId: app.id, stage: app.stage, released: true },
		{ ops: true },
	);

	return serializeHandoff(handoff);
}

/**
 * Self-serve staffing — the claimant takes the case's open handoff. Their role
 * must be able to own the stage and their branch must hold the file; the
 * resolution runs through the normal path so the claim stays race-safe.
 */
export async function claimPendingHandoff(input: {
	applicationId: string;
	actor: Actor;
}): Promise<StageHandoff> {
	const [row] = await db
		.select()
		.from(stageHandoffs)
		.where(
			and(
				eq(stageHandoffs.applicationId, input.applicationId),
				eq(stageHandoffs.status, "pending"),
			),
		)
		.limit(1);
	if (!row) throw new HttpError(404, "NO_OPEN_HANDOFF", "This case is not waiting on a handler.");

	// Role eligibility is the same gate direct assignment applies.
	const { loadAssignableStaff } = await import("./cases.js");
	const claimant = await loadAssignableStaff(input.actor.opsUserId, row.stage);

	const [app] = await db
		.select({ branch: applications.branch })
		.from(applications)
		.where(eq(applications.id, input.applicationId))
		.limit(1);
	const { canonicalBranchId } = await import("./availability.js");
	if (claimant.branch && app && canonicalBranchId(claimant.branch) !== canonicalBranchId(app.branch)) {
		throw new HttpError(
			409,
			"CASE_OTHER_BRANCH",
			`This file belongs to ${app.branch ?? "another office"}; only that office's staff can claim it.`,
		);
	}

	return resolveStageHandoff({
		handoffId: row.id,
		decision: "assign",
		opsUserId: input.actor.opsUserId,
		reason: "self-claimed from queue",
		scope: "stage",
		actor: input.actor,
	});
}

/* ── Escalation sweep ─────────────────────────────────────────────────────── */

/** A pending handoff escalates after 5 days waiting or its 3rd defer. */
const HANDOFF_ESCALATION_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const HANDOFF_ESCALATION_DEFERS = 3;

/**
 * Stamps `escalatedAt` once on handoffs that have waited too long and
 * re-alerts management. Idempotent — runs on the API's periodic sweep
 * alongside the task reminders.
 */
export async function escalateAgedHandoffs(): Promise<number> {
	const cutoff = new Date(Date.now() - HANDOFF_ESCALATION_AGE_MS);
	const aged = await db
		.select({
			id: stageHandoffs.id,
			applicationId: stageHandoffs.applicationId,
			stage: stageHandoffs.stage,
			deferCount: stageHandoffs.deferCount,
			createdAt: stageHandoffs.createdAt,
			appNumber: applications.appNumber,
		})
		.from(stageHandoffs)
		.innerJoin(applications, eq(applications.id, stageHandoffs.applicationId))
		.where(
			and(
				eq(stageHandoffs.status, "pending"),
				isNull(stageHandoffs.escalatedAt),
				or(
					lte(stageHandoffs.createdAt, cutoff),
					gte(stageHandoffs.deferCount, HANDOFF_ESCALATION_DEFERS),
				),
			),
		);
	if (!aged.length) return 0;
	const recipients = await getManagerAndCoordinatorUserIds();
	let stamped = 0;
	for (const row of aged) {
		const [stampedRow] = await db
			.update(stageHandoffs)
			.set({ escalatedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(stageHandoffs.id, row.id), isNull(stageHandoffs.escalatedAt)))
			.returning();
		if (!stampedRow) continue;
		stamped += 1;
		const stageLabel = JOURNEY_STAGE_LABELS[row.stage as JourneyStage] ?? row.stage;
		const waitedDays = Math.max(0, Math.floor((Date.now() - row.createdAt.getTime()) / (24 * 60 * 60 * 1000)));
		await notifyMany(
			recipients.map((r) => ({
				recipientUserId: r.userId,
				type: "stage.needs_handler",
				title: "Escalated — case still waiting on a handler",
				body: `${row.appNumber ?? "A case"} has waited ${waitedDays}d for a ${stageLabel} handler${row.deferCount ? ` (deferred ×${row.deferCount})` : ""}.`,
				link: "/applications",
				entityType: "case",
				entityId: row.applicationId,
				caseId: row.applicationId,
			})),
		).catch(() => {});
		emitDomain(
			"handoff.updated",
			{ handoffId: row.id, applicationId: row.applicationId, stage: row.stage, escalated: true },
			{ ops: true },
		);
	}
	return stamped;
}

/* ── Team sheet ───────────────────────────────────────────────────────────── */

/**
 * The case's staffing picture — every live seat, the seats that ended, and the
 * stages still ahead with nobody on them. Reads only; the caller gates access.
 */
export async function getCaseTeam(applicationId: string): Promise<CaseTeam> {
	const [app] = await db
		.select({
			id: applications.id,
			stage: applications.stage,
			assignedStaffId: applications.assignedStaffId,
			applicantId: applications.applicantId,
		})
		.from(applications)
		.where(eq(applications.id, applicationId))
		.limit(1);
	if (!app) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");

	const [applicant] = await db
		.select({ coordinatorId: applicants.coordinatorId })
		.from(applicants)
		.where(eq(applicants.id, app.applicantId))
		.limit(1);

	const seatRows = await db
		.select({
			id: stageAssignments.id,
			stage: stageAssignments.stage,
			status: stageAssignments.status,
			opsUserId: stageAssignments.opsUserId,
			assignedAt: stageAssignments.assignedAt,
			endedAt: stageAssignments.endedAt,
			endedReason: stageAssignments.endedReason,
			name: opsUsers.name,
			email: opsUsers.email,
			role: opsUsers.role,
		})
		.from(stageAssignments)
		.innerJoin(opsUsers, eq(stageAssignments.opsUserId, opsUsers.id))
		.where(eq(stageAssignments.applicationId, applicationId))
		.orderBy(desc(stageAssignments.assignedAt));

	const ownerRows = await db
		.select({
			opsUserId: caseAssignments.opsUserId,
			status: caseAssignments.status,
			assignedAt: caseAssignments.assignedAt,
			endedAt: caseAssignments.endedAt,
			endReason: caseAssignments.endReason,
			endedBy: caseAssignments.endedBy,
			note: caseAssignments.note,
			name: opsUsers.name,
			email: opsUsers.email,
			role: opsUsers.role,
		})
		.from(caseAssignments)
		.innerJoin(opsUsers, eq(caseAssignments.opsUserId, opsUsers.id))
		.where(
			and(
				eq(caseAssignments.targetType, "application"),
				eq(caseAssignments.targetId, applicationId),
				eq(caseAssignments.role, "primary"),
			),
		)
		.orderBy(desc(caseAssignments.assignedAt));

	// One presence query for everyone named on the team — decays to offline
	// after 15 minutes without a heartbeat, same as the staff directory.
	const ids = new Set<string>();
	if (app.assignedStaffId) ids.add(app.assignedStaffId);
	if (applicant?.coordinatorId) ids.add(applicant.coordinatorId);
	for (const r of seatRows) ids.add(r.opsUserId);
	const presenceRows = ids.size
		? await db
				.select({ opsUserId: staffPresence.opsUserId, status: staffPresence.status, lastSeenAt: staffPresence.lastSeenAt })
				.from(staffPresence)
				.where(inArray(staffPresence.opsUserId, [...ids]))
		: [];
	const presenceBy = new Map(
		presenceRows.map((r) => {
			let status = r.status as "available" | "busy" | "on_leave" | "offline";
			if (status !== "offline" && (!r.lastSeenAt || Date.now() - r.lastSeenAt.getTime() > 15 * 60 * 1000)) {
				status = "offline";
			}
			return [r.opsUserId, { status, lastSeenAt: r.lastSeenAt }] as const;
		}),
	);
	const presenceOf = (opsUserId: string) => {
		const p = presenceBy.get(opsUserId);
		return {
			presence: (p?.status ?? null) as CaseSeat["presence"],
			lastSeenAt: p?.lastSeenAt ? p.lastSeenAt.toISOString() : null,
		};
	};

	const staffInfo = async (opsUserId: string) => {
		const [row] = await db
			.select({ name: opsUsers.name, email: opsUsers.email, role: opsUsers.role })
			.from(opsUsers)
			.where(eq(opsUsers.id, opsUserId))
			.limit(1);
		return row ?? null;
	};

	const activeOwnerRow = ownerRows.find((r) => r.status === "active") ?? null;
	const owner: CaseSeat | null = app.assignedStaffId
		? await (async () => {
				const info = activeOwnerRow ?? (await staffInfo(app.assignedStaffId!));
				return {
					seat: "owner" as const,
					stage: null,
					opsUserId: app.assignedStaffId,
					name: info?.name ?? null,
					email: info?.email ?? null,
					role: info?.role ?? null,
					...presenceOf(app.assignedStaffId!),
					since: activeOwnerRow?.assignedAt ? activeOwnerRow.assignedAt.toISOString() : null,
					note: activeOwnerRow?.note ?? null,
				};
			})()
		: null;

	const coordinator: CaseSeat | null = applicant?.coordinatorId
		? await (async () => {
				const coordinatorId = applicant.coordinatorId!;
				const info = await staffInfo(coordinatorId);
				return {
					seat: "coordinator" as const,
					stage: null,
					opsUserId: coordinatorId,
					name: info?.name ?? null,
					email: info?.email ?? null,
					role: info?.role ?? null,
					...presenceOf(coordinatorId),
					since: null,
					note: null,
				};
			})()
		: null;

	const seats: CaseSeat[] = seatRows
		.filter((r) => r.status === "active")
		.map((r) => ({
			seat: "stage" as const,
			stage: r.stage,
			opsUserId: r.opsUserId,
			name: r.name,
			email: r.email,
			role: r.role,
			...presenceOf(r.opsUserId),
			since: r.assignedAt ? r.assignedAt.toISOString() : null,
			note: null,
		}));

	// Past seats — ended stage seats plus ended owner assignments, newest first.
	const endedByIds = [...new Set(ownerRows.map((r) => r.endedBy).filter((x): x is string => Boolean(x)))];
	const endedByRows = endedByIds.length
		? await db
				.select({ id: opsUsers.id, name: opsUsers.name })
				.from(opsUsers)
				.where(inArray(opsUsers.id, endedByIds))
		: [];
	const endedByName = new Map(endedByRows.map((r) => [r.id, r.name]));

	const pastSeats: CaseSeat[] = [
		...seatRows
			.filter((r) => r.status !== "active")
			.map((r): CaseSeat => ({
				seat: "stage" as const,
				stage: r.stage,
				opsUserId: r.opsUserId,
				name: r.name,
				email: r.email,
				role: r.role,
				presence: null,
				lastSeenAt: null,
				since: r.assignedAt ? r.assignedAt.toISOString() : null,
				note: null,
				endedAt: r.endedAt ? r.endedAt.toISOString() : null,
				endReason: r.endedReason ?? r.status,
				endedByName: null,
			})),
		...ownerRows
			.filter((r) => r.status !== "active")
			.map((r): CaseSeat => ({
				seat: "owner" as const,
				stage: null,
				opsUserId: r.opsUserId,
				name: r.name,
				email: r.email,
				role: r.role,
				presence: null,
				lastSeenAt: null,
				since: r.assignedAt ? r.assignedAt.toISOString() : null,
				note: r.note ?? null,
				endedAt: r.endedAt ? r.endedAt.toISOString() : null,
				endReason: r.endReason ?? null,
				endedByName: r.endedBy ? (endedByName.get(r.endedBy) ?? null) : null,
			})),
	].sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));

	// Open seats — stages from the current one onward with no specialist seated
	// and no whole-case owner to carry through.
	const stageIdx = JOURNEY_STAGES.indexOf(app.stage as JourneyStage);
	const seatedStages = new Set(seatRows.filter((r) => r.status === "active").map((r) => r.stage));
	const openStages = app.assignedStaffId
		? []
		: JOURNEY_STAGES.slice(Math.max(0, stageIdx)).filter(
				(s) => s !== "completed" && !seatedStages.has(s),
			);

	return {
		owner,
		coordinator,
		seats,
		pastSeats,
		openStages,
		pendingHandoff: await pendingHandoffForApplication(applicationId),
	};
}
