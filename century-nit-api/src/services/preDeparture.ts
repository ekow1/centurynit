import { and, eq, inArray } from "drizzle-orm";
import { PRE_DEPARTURE_TASKS } from "century-nit-core/content";
import type { PreDepartureTask } from "century-nit-shared";
import { db } from "../db/index.js";
import { applicantDocuments, applicants, applications, caseComments, opsUsers } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";

const RANK: Record<string, number> = { VERIFIED: 3, UPLOADED: 2, REJECTED: 1, PENDING_UPLOAD: 0 };

/**
 * The list as it should be read: items asking for proof take their state
 * from the client's vault — uploaded, verified, rejected — and are done
 * when the officer has verified the document. A manual tick or a waiver
 * still closes an item; verification is the normal way.
 */
export async function resolvePreDepartureTasks(row: {
	applicantId: string;
	preDepartureTasks: unknown;
}): Promise<PreDepartureTask[]> {
	const raw = (Array.isArray(row.preDepartureTasks) ? row.preDepartureTasks : []) as Partial<PreDepartureTask>[];
	const tasks: PreDepartureTask[] = raw.map((t) => ({
		id: t.id ?? "",
		category: t.category,
		label: t.label ?? "",
		detail: t.detail,
		owner: t.owner ?? "client",
		evidence: t.evidence ?? null,
		required: t.required ?? true,
		done: Boolean(t.done),
		doneBy: t.doneBy ?? null,
		doneAt: t.doneAt ?? null,
		waivedReason: t.waivedReason ?? null,
		proofStatus: null,
		proofDocumentId: null,
	}));
	const types = tasks.map((t) => t.evidence).filter((e): e is string => Boolean(e));
	if (types.length === 0) return tasks;
	const [applicant] = await db.select({ userId: applicants.userId }).from(applicants).where(eq(applicants.id, row.applicantId)).limit(1);
	if (!applicant?.userId) return tasks.map((t) => (t.evidence ? { ...t, proofStatus: "PENDING_UPLOAD" as const } : t));
	const docs = await db
		.select({
			id: applicantDocuments.id,
			documentType: applicantDocuments.documentType,
			status: applicantDocuments.status,
			reviewedAt: applicantDocuments.reviewedAt,
			reviewerName: opsUsers.name,
		})
		.from(applicantDocuments)
		.leftJoin(opsUsers, eq(opsUsers.id, applicantDocuments.reviewedBy))
		.where(and(eq(applicantDocuments.ownerUserId, applicant.userId), inArray(applicantDocuments.documentType, types)));
	const best = new Map<string, (typeof docs)[number]>();
	for (const d of docs) {
		const cur = best.get(d.documentType);
		if (!cur || (RANK[d.status] ?? 0) > (RANK[cur.status] ?? 0)) best.set(d.documentType, d);
	}
	return tasks.map((t) => {
		if (!t.evidence) return t;
		const doc = best.get(t.evidence);
		const status = (doc?.status ?? "PENDING_UPLOAD") as NonNullable<PreDepartureTask["proofStatus"]>;
		const verified = status === "VERIFIED";
		return {
			...t,
			proofStatus: status,
			proofDocumentId: doc?.id ?? null,
			done: t.done || verified,
			doneBy: t.done ? t.doneBy : verified ? (doc?.reviewerName ?? "verified") : null,
			doneAt: t.done ? t.doneAt : verified ? (doc?.reviewedAt?.toISOString() ?? null) : null,
		};
	});
}

/**
 * The pre-departure checklist lives on the case — one list the client and
 * the departure officer both read. It is seeded from the template when
 * Departure opens (the visa approved, or the stage moved), never earlier,
 * so a case that has not got there shows nothing to do yet.
 */

export async function seedPreDepartureTasks(applicationId: string): Promise<boolean> {
	const [row] = await db.select({ tasks: applications.preDepartureTasks }).from(applications).where(eq(applications.id, applicationId)).limit(1);
	if (!row || (Array.isArray(row.tasks) && row.tasks.length > 0)) return false;
	const seeded: PreDepartureTask[] = PRE_DEPARTURE_TASKS.map((t) => ({
		id: t.id,
		category: t.category,
		label: t.label,
		detail: t.detail,
		owner: t.owner,
		evidence: t.evidence ?? null,
		required: t.required,
		done: false,
		doneBy: null,
		doneAt: null,
		waivedReason: null,
	}));
	await db.update(applications).set({ preDepartureTasks: seeded, updatedAt: new Date() }).where(eq(applications.id, applicationId));
	return true;
}

/**
 * Tick or untick one item. The client may only touch their own items; staff
 * may touch any (a phone-confirmed item is ticked on the client's behalf,
 * and the record says who). A required item can be waived by staff with a
 * reason instead of being done.
 */
export async function setPreDepartureTask(
	applicationId: string,
	taskId: string,
	input: { done: boolean; waivedReason?: string | null },
	actor: { kind: "client" | "staff"; name: string; opsUserId?: string | null },
): Promise<typeof applications.$inferSelect> {
	const [row] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
	if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
	const tasks = (row.preDepartureTasks ?? []) as PreDepartureTask[];
	const task = tasks.find((t) => t.id === taskId);
	if (!task) throw new HttpError(404, "TASK_NOT_FOUND", "No such pre-departure item");
	if (actor.kind === "client" && task.owner === "century") {
		throw new HttpError(403, "NOT_YOUR_ITEM", "Century NIT closes this item — your consultant will tick it when it is done.");
	}
	if (actor.kind === "client" && task.evidence) {
		throw new HttpError(403, "PROOF_REQUIRED", "This item closes when your consultant verifies your upload — add the document to your vault.");
	}
	if (actor.kind === "client" && input.waivedReason) {
		throw new HttpError(403, "CANNOT_WAIVE", "Only your consultant can waive an item.");
	}
	const now = new Date().toISOString();
	const next = tasks.map((t) =>
		t.id === taskId
			? {
					...t,
					done: input.done,
					doneBy: input.done ? (actor.kind === "client" ? "client" : actor.name) : null,
					doneAt: input.done ? now : null,
					waivedReason: input.done ? null : (input.waivedReason?.trim() || null),
				}
			: t,
	);
	const [updated] = await db
		.update(applications)
		.set({ preDepartureTasks: next, updatedAt: new Date() })
		.where(eq(applications.id, applicationId))
		.returning();
	if (actor.kind === "staff" && input.waivedReason && !input.done) {
		await db.insert(caseComments).values({
			targetType: "application",
			targetId: applicationId,
			kind: "status",
			text: `Pre-departure item waived: ${task.label} — ${input.waivedReason.trim()}`,
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId ?? null,
		});
	}
	return updated;
}
