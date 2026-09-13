import { eq } from "drizzle-orm";
import { PRE_DEPARTURE_TASKS } from "century-nit-core/content";
import type { PreDepartureTask } from "century-nit-shared";
import { db } from "../db/index.js";
import { applications, caseComments } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";

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
