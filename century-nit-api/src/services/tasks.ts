import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { applications, leads, opsTasks, opsUsers } from "../db/schema.js";
import { notifyMany } from "./notify.js";
import { emitDomain } from "../worker/pubsub.js";
import { HttpError } from "../middleware/error.js";
import type { ApiOpsTask, CreateOpsTask, UpdateOpsTask } from "century-nit-shared";

/**
 * Staff tasks — the follow-ups people actually write down.
 *
 * `PendingTasks` on the console derives work from record state; this service
 * is the other half — intent with a due date. A task can point at a lead, an
 * application, or neither (a personal reminder). Due tasks notify their
 * assignee once through the normal notification pipe (`remindedAt` makes the
 * sweep idempotent).
 */

type TaskRow = typeof opsTasks.$inferSelect;

function serializeTask(
	t: TaskRow,
	names: { assignee?: string | null; creator?: string | null; lead?: string | null; appRef?: string | null },
): ApiOpsTask {
	return {
		id: t.id,
		title: t.title,
		note: t.note,
		dueAt: t.dueAt.toISOString(),
		assigneeOpsUserId: t.assigneeOpsUserId,
		assigneeName: names.assignee ?? null,
		createdByOpsUserId: t.createdByOpsUserId,
		createdByName: names.creator ?? null,
		leadId: t.leadId,
		leadName: names.lead ?? null,
		applicationId: t.applicationId,
		applicationRef: names.appRef ?? null,
		doneAt: t.doneAt?.toISOString() ?? null,
		createdAt: t.createdAt.toISOString(),
		updatedAt: t.updatedAt.toISOString(),
	};
}

async function nameMaps(rows: TaskRow[]) {
	const staffIds = new Set<string>();
	const leadIds = new Set<string>();
	const appIds = new Set<string>();
	for (const t of rows) {
		if (t.assigneeOpsUserId) staffIds.add(t.assigneeOpsUserId);
		if (t.createdByOpsUserId) staffIds.add(t.createdByOpsUserId);
		if (t.leadId) leadIds.add(t.leadId);
		if (t.applicationId) appIds.add(t.applicationId);
	}
	const staff = staffIds.size
		? await db.query.opsUsers.findMany({ where: (o, { inArray }) => inArray(o.id, [...staffIds]) })
		: [];
	const leadRows = leadIds.size
		? await db.query.leads.findMany({ where: (l, { inArray }) => inArray(l.id, [...leadIds]) })
		: [];
	const appRows = appIds.size
		? await db.query.applications.findMany({
				where: (a, { inArray }) => inArray(a.id, [...appIds]),
				columns: { id: true, appNumber: true },
			})
		: [];
	return {
		staff: new Map(staff.map((s) => [s.id, s.name])),
		leads: new Map(leadRows.map((l) => [l.id, l.name])),
		apps: new Map(appRows.map((a) => [a.id, a.appNumber ?? a.id])),
	};
}

/** Open tasks first, soonest due on top; done tasks sink to the bottom. */
export async function listTasks(opts: { assigneeOpsUserId?: string; includeDone?: boolean } = {}): Promise<ApiOpsTask[]> {
	const conds = [];
	if (opts.assigneeOpsUserId) {
		conds.push(or(eq(opsTasks.assigneeOpsUserId, opts.assigneeOpsUserId), isNull(opsTasks.assigneeOpsUserId)));
	}
	if (!opts.includeDone) conds.push(isNull(opsTasks.doneAt));

	const rows = await db.query.opsTasks.findMany({
		where: conds.length ? and(...conds) : undefined,
		orderBy: [asc(opsTasks.doneAt), asc(opsTasks.dueAt), desc(opsTasks.createdAt)],
		limit: 500,
	});
	const maps = await nameMaps(rows);
	return rows.map((t) =>
		serializeTask(t, {
			assignee: t.assigneeOpsUserId ? (maps.staff.get(t.assigneeOpsUserId) ?? null) : null,
			creator: t.createdByOpsUserId ? (maps.staff.get(t.createdByOpsUserId) ?? null) : null,
			lead: t.leadId ? (maps.leads.get(t.leadId) ?? null) : null,
			appRef: t.applicationId ? (maps.apps.get(t.applicationId) ?? null) : null,
		}),
	);
}

/** The next open task on a lead — the "follow up Tue" strip on the lead card. */
export async function nextOpenTaskForLead(leadId: string): Promise<{ id: string; title: string; dueAt: string } | null> {
	const [t] = await db
		.select({ id: opsTasks.id, title: opsTasks.title, dueAt: opsTasks.dueAt })
		.from(opsTasks)
		.where(and(eq(opsTasks.leadId, leadId), isNull(opsTasks.doneAt)))
		.orderBy(asc(opsTasks.dueAt))
		.limit(1);
	return t ? { id: t.id, title: t.title, dueAt: t.dueAt.toISOString() } : null;
}

export async function nextOpenTasksForLeads(leadIds: string[]): Promise<Map<string, { id: string; title: string; dueAt: string }>> {
	if (!leadIds.length) return new Map();
	const rows = await db
		.select({ id: opsTasks.id, leadId: opsTasks.leadId, title: opsTasks.title, dueAt: opsTasks.dueAt })
		.from(opsTasks)
		.where(and(isNull(opsTasks.doneAt), or(...leadIds.map((id) => eq(opsTasks.leadId, id)))))
		.orderBy(asc(opsTasks.dueAt));
	const map = new Map<string, { id: string; title: string; dueAt: string }>();
	for (const r of rows) {
		if (r.leadId && !map.has(r.leadId)) {
			map.set(r.leadId, { id: r.id, title: r.title, dueAt: r.dueAt.toISOString() });
		}
	}
	return map;
}

export async function createTask(input: CreateOpsTask, createdByOpsUserId: string | null): Promise<ApiOpsTask> {
	const dueAt = new Date(input.dueAt);
	if (Number.isNaN(dueAt.getTime())) {
		throw new HttpError(400, "VALIDATION_ERROR", "dueAt must be a valid date");
	}
	if (input.leadId) {
		const lead = await db.query.leads.findFirst({ where: eq(leads.id, input.leadId) });
		if (!lead) throw new HttpError(404, "NOT_FOUND", "Lead not found");
	}
	if (input.applicationId) {
		const app = await db.query.applications.findFirst({ where: eq(applications.id, input.applicationId) });
		if (!app) throw new HttpError(404, "NOT_FOUND", "Case not found");
	}
	if (input.assigneeOpsUserId) {
		const assignee = await db.query.opsUsers.findFirst({ where: eq(opsUsers.id, input.assigneeOpsUserId) });
		if (!assignee) throw new HttpError(404, "NOT_FOUND", "Assignee not found");
	}

	const [created] = await db
		.insert(opsTasks)
		.values({
			title: input.title.trim(),
			note: input.note?.trim() || null,
			dueAt,
			assigneeOpsUserId: input.assigneeOpsUserId ?? null,
			createdByOpsUserId,
			leadId: input.leadId ?? null,
			applicationId: input.applicationId ?? null,
		})
		.returning();

	emitDomain("task.created", { taskId: created.id, leadId: created.leadId }, { ops: true });

	if (created.assigneeOpsUserId && created.assigneeOpsUserId !== createdByOpsUserId) {
		const assignee = await db.query.opsUsers.findFirst({ where: eq(opsUsers.id, created.assigneeOpsUserId) });
		if (assignee?.userId) {
			await notifyMany([
				{
					recipientUserId: assignee.userId,
					type: "task.assigned",
					title: "Follow-up assigned",
					body: `${created.title} — due ${dueAt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`,
					link: created.leadId ? `/leads?id=${created.leadId}` : "/workspace",
				},
			]).catch(() => {});
		}
	}

	const maps = await nameMaps([created]);
	return serializeTask(created, {
		assignee: created.assigneeOpsUserId ? (maps.staff.get(created.assigneeOpsUserId) ?? null) : null,
		creator: createdByOpsUserId ? (maps.staff.get(createdByOpsUserId) ?? null) : null,
		lead: created.leadId ? (maps.leads.get(created.leadId) ?? null) : null,
		appRef: created.applicationId ? (maps.apps.get(created.applicationId) ?? null) : null,
	});
}

export async function updateTask(id: string, patch: UpdateOpsTask): Promise<ApiOpsTask> {
	const current = await db.query.opsTasks.findFirst({ where: eq(opsTasks.id, id) });
	if (!current) throw new HttpError(404, "NOT_FOUND", "Task not found");

	const set: Record<string, unknown> = { updatedAt: new Date() };
	if (patch.title !== undefined) set.title = patch.title.trim();
	if (patch.note !== undefined) set.note = patch.note?.trim() || null;
	if (patch.dueAt !== undefined) {
		const d = new Date(patch.dueAt);
		if (Number.isNaN(d.getTime())) throw new HttpError(400, "VALIDATION_ERROR", "dueAt must be a valid date");
		set.dueAt = d;
		// A rescheduled task deserves a fresh reminder.
		set.remindedAt = null;
	}
	if (patch.assigneeOpsUserId !== undefined) {
		if (patch.assigneeOpsUserId) {
			const assignee = await db.query.opsUsers.findFirst({ where: eq(opsUsers.id, patch.assigneeOpsUserId) });
			if (!assignee) throw new HttpError(404, "NOT_FOUND", "Assignee not found");
		}
		set.assigneeOpsUserId = patch.assigneeOpsUserId;
	}
	if (patch.done !== undefined) set.doneAt = patch.done ? new Date() : null;

	const [updated] = await db.update(opsTasks).set(set).where(eq(opsTasks.id, id)).returning();
	emitDomain("task.updated", { taskId: id, done: Boolean(updated.doneAt) }, { ops: true });

	const maps = await nameMaps([updated]);
	return serializeTask(updated, {
		assignee: updated.assigneeOpsUserId ? (maps.staff.get(updated.assigneeOpsUserId) ?? null) : null,
		creator: updated.createdByOpsUserId ? (maps.staff.get(updated.createdByOpsUserId) ?? null) : null,
		lead: updated.leadId ? (maps.leads.get(updated.leadId) ?? null) : null,
		appRef: updated.applicationId ? (maps.apps.get(updated.applicationId) ?? null) : null,
	});
}

/**
 * The reminder sweep — due, open, unreminded tasks notify their assignee
 * once. Called on an interval from index.ts; `remindedAt` keeps it
 * idempotent across restarts and overlapping ticks.
 */
export async function remindDueTasks(): Promise<number> {
	const due = await db
		.select()
		.from(opsTasks)
		.where(and(lte(opsTasks.dueAt, new Date()), isNull(opsTasks.doneAt), isNull(opsTasks.remindedAt)))
		.limit(100);
	if (!due.length) return 0;

	const maps = await nameMaps(due);
	// ops_users.id → users.id: notifyMany speaks Better Auth ids.
	const staffRows = await db.query.opsUsers.findMany();
	const authIdByOpsId = new Map(staffRows.map((s) => [s.id, s.userId]));
	for (const t of due) {
		const authId = t.assigneeOpsUserId ? authIdByOpsId.get(t.assigneeOpsUserId) : null;
		// Unassigned tasks don't spam everyone — they sit in the queue.
		if (authId) {
			const on = t.leadId ? ` — ${maps.leads.get(t.leadId) ?? "lead"}` : t.applicationId ? ` — ${maps.apps.get(t.applicationId) ?? "case"}` : "";
			await notifyMany([
				{
					recipientUserId: authId,
					type: "task.due",
					title: "Follow-up due",
					body: `${t.title}${on}`,
					link: t.leadId ? `/leads?id=${t.leadId}` : t.applicationId ? "/applications" : "/workspace",
				},
			]).catch(() => {});
		}
		await db.update(opsTasks).set({ remindedAt: new Date() }).where(eq(opsTasks.id, t.id));
	}
	return due.length;
}
