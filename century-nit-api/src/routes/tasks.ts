import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	createOpsTaskSchema,
	opsTaskListSchema,
	opsTaskSchema,
	updateOpsTaskSchema,
} from "century-nit-shared";
import { requireAnyModule, requireAuth, type AuthVariables } from "../middleware/auth.js";
import { validationHook } from "../middleware/error.js";
import { createTask, listTasks, updateTask } from "../services/tasks.js";

/**
 * Staff tasks — real follow-ups with due dates, next to the derived queue.
 *
 * Cross-cutting by nature (a task can sit on a lead, a case, or nothing), so
 * the guard is any-module staff who can work records at all, not one page's
 * permission.
 */
export const tasksRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

const TASK_MODULES = ["leads", "crm", "applications", "consultations", "dashboard"] as const;

/* ── GET /api/v1/tasks ─────────────────────────────────────────────────────── */

tasksRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Tasks"],
		middleware: [requireAuth, requireAnyModule(...TASK_MODULES)] as const,
		request: {
			query: z.object({
				scope: z.enum(["mine", "all"]).optional(),
				done: z.enum(["open", "all"]).optional(),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: opsTaskListSchema } },
				description: "Open tasks — mine + unassigned by default, everything for ?scope=all",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		const { scope, done } = c.req.valid("query");
		const tasks = await listTasks({
			assigneeOpsUserId: scope === "all" ? undefined : staff?.opsUserId,
			includeDone: done === "all",
		});
		return c.json({ tasks });
	},
);

/* ── POST /api/v1/tasks ────────────────────────────────────────────────────── */

tasksRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["Tasks"],
		middleware: [requireAuth, requireAnyModule(...TASK_MODULES)] as const,
		request: {
			body: {
				content: { "application/json": { schema: createOpsTaskSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: opsTaskSchema } },
				description: "Task created",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const staff = c.get("staff");
		const created = await createTask(body, staff?.opsUserId ?? null);
		return c.json(created, 201);
	},
);

/* ── PATCH /api/v1/tasks/:id ───────────────────────────────────────────────── */

tasksRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}",
		tags: ["Tasks"],
		middleware: [requireAuth, requireAnyModule(...TASK_MODULES)] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
			body: {
				content: { "application/json": { schema: updateOpsTaskSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: opsTaskSchema } },
				description: "Task updated — done toggle, reschedule, reassign",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await updateTask(id, body);
		return c.json(updated);
	},
);
