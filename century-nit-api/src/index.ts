import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { assertDatabaseReachable } from "./db/index.js";
import { env } from "./env.js";
import { allowedOrigins, warnAboutInsecureOrigins } from "./lib/origins.js";

/*
 * Refuse to serve without a database.
 *
 * Every route worth calling reads Postgres, so a process that starts without it
 * is not a degraded API, it is a 500 generator that looks healthy from the
 * outside. Failing here makes a bad DATABASE_URL a failed deploy — loud, at the
 * moment it is introduced — instead of a 500 the first person to click
 * something has to report.
 */
await assertDatabaseReachable();
await (await import("./services/roles.js")).seedSystemRoles().catch((err) => {
	console.error("[roles] Failed to seed system roles on boot:", err);
});

const app = createApp();

/*
 * The follow-up reminder sweep — due tasks notify their assignee once,
 * through the same bell/push pipe every other notification uses.
 * `reminded_at` on the row keeps a restart from re-firing.
 */
const { remindDueTasks } = await import("./services/tasks.js");
void remindDueTasks().catch(() => {});
setInterval(() => void remindDueTasks().catch(() => {}), 5 * 60_000).unref();

/*
 * The handoff escalation sweep — a pending handoff that waits 5 days or is
 * deferred a 3rd time gets `escalated_at` stamped once and management is
 * re-alerted. Same cadence as the task sweep.
 */
const { escalateAgedHandoffs } = await import("./services/handoffs.js");
void escalateAgedHandoffs().catch(() => {});
setInterval(() => void escalateAgedHandoffs().catch(() => {}), 5 * 60_000).unref();

serve({
	fetch: app.fetch,
	port: Number(env.PORT),
});

console.log(`Century NIT API running on http://localhost:${env.PORT}`);

/*
 * Print the origin list at startup.
 *
 * A CORS rejection reaches the browser as an opaque network failure with no
 * server-side trace — nothing is logged, because refusing is the correct
 * behaviour. Naming the accepted origins once, on boot, turns "the console
 * cannot reach the API" into a line somebody can read off against the domain
 * they are actually using.
 */
console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
warnAboutInsecureOrigins();
