/**
 * Live-test browser push notifications against a real environment.
 *
 * Usage:
 *   npx tsx src/scripts/test-push.ts --env .env.production --list
 *   npx tsx src/scripts/test-push.ts --env .env.production --email you@x.com [--direct]
 *
 * --list   print recent push subscriptions (who, browser, when) and exit.
 * --email  send a test notification to that user's account through the real
 *          notify() pipeline: DB row + SSE publish + BullMQ push job, which
 *          the running worker delivers to every registered browser.
 * --direct additionally send each subscription a push straight from this
 *          script (skips the queue/worker) — isolates VAPID + browser
 *          delivery from the worker half of the pipeline.
 */

import { config } from "dotenv";
import { eq, desc } from "drizzle-orm";

const args = process.argv.slice(2);
function argValue(flag: string): string | null {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] ?? null : null;
}
const envFile = argValue("--env") ?? ".env.production";
const email = argValue("--email");
const list = args.includes("--list");
const direct = args.includes("--direct");

config({ path: envFile, override: true });

// .env.production is a template — any value still carrying a [PLACEHOLDER]
// bracket would fail env.ts validation before we even reach the DB. Replace
// placeholders with syntactically valid dummies (they're never dialed for
// --list / --direct; the queued path needs the real Redis on the VPS anyway).
// .env.supabase's DATABASE_URL keeps a [REGION] placeholder; the migrations
// URL carries the concrete host — same database, fine for reads.
if (process.env.DATABASE_URL?.includes("[") && process.env.DATABASE_URL_MIGRATIONS) {
	process.env.DATABASE_URL = process.env.DATABASE_URL_MIGRATIONS;
}
for (const [k, v] of Object.entries(process.env)) {
	if (typeof v !== "string" || !v.includes("[")) continue;
	// Whole-value placeholders get a syntactically valid dummy; bracketed
	// segments inside a real URL (e.g. :[PASSWORD]@host) are swapped in place
	// so a template URL still points at the real host if the secret is real.
	if (/^\[.*\]$/.test(v.trim())) {
		process.env[k] = k.endsWith("_URL") ? "https://placeholder.invalid" : "x".repeat(64);
	} else {
		process.env[k] = v.replace(/\[[^\]]*\]/g, "x".repeat(16));
	}
}
// Drop empty optionals (z.string().url() rejects "") and give URL-typed
// vars that still don't parse a syntactically valid dummy.
for (const [k, v] of Object.entries(process.env)) {
	if (v === "") delete process.env[k];
}
for (const k of ["REDIS_URL", "GOOGLE_WEBHOOK_URL", "GOOGLE_REDIRECT_URI", "GOOGLE_AUTH_REDIRECT_URI"]) {
	const v = process.env[k];
	if (v) {
		try {
			new URL(v);
		} catch {
			process.env[k] = k === "REDIS_URL" ? "redis://localhost:6379" : "https://placeholder.invalid";
		}
	}
}


async function main() {
	const { db } = await import("../db/index.js");
	const { pushSubscriptions, users } = await import("../db/schema.js");

	const rows = await db
		.select({
			endpoint: pushSubscriptions.endpoint,
			userId: pushSubscriptions.userId,
			userAgent: pushSubscriptions.userAgent,
			lastUsedAt: pushSubscriptions.lastUsedAt,
			createdAt: pushSubscriptions.createdAt,
			email: users.email,
			name: users.name,
		})
		.from(pushSubscriptions)
		.innerJoin(users, eq(users.id, pushSubscriptions.userId))
		.orderBy(desc(pushSubscriptions.createdAt));

	if (list || !email) {
		if (rows.length === 0) {
			console.log("No push subscriptions stored. Turn on browser alerts first (ops bell → Turn on).");
		}
		for (const r of rows) {
			console.log(
				`${r.email ?? r.userId}  ·  ${(r.userAgent ?? "").slice(0, 60)}  ·  ${r.createdAt?.toISOString()}`,
			);
		}
		if (!email) return;
	}

	const targets = email ? rows.filter((r) => r.email === email) : [];
	if (email && targets.length === 0) {
		console.error(`No push subscription for ${email}. Turn on browser alerts first.`);
		process.exit(1);
	}
	if (!email) return;

	const [account] = await db
		.select({ id: users.id, email: users.email })
		.from(users)
		.where(eq(users.email, email))
		.limit(1);
	if (!account) {
		console.error(`No user account for ${email}.`);
		process.exit(1);
	}

	// 1. The real pipeline — notification row, SSE publish, queued push job.
	const { notify } = await import("../services/notify.js");
	await notify({
		recipientUserId: account.id,
		type: "test.push",
		title: "Test notification",
		body: `Sent ${new Date().toLocaleTimeString()} — if you can read this in the OS notification shade, push is live.`,
		link: "/",
		priority: "high",
	});
	console.log(`[pipeline] notify() queued for ${email} — watch the bell (SSE) and the OS notification (worker push).`);

	// 2. Optional direct send — bypasses queue + worker, isolates VAPID +
	//    browser delivery.
	if (direct) {
		const { sendPushNotification } = await import("../lib/push.js");
		const subsRows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, account.id));
		for (const sub of subsRows) {
			const res = await sendPushNotification(
				{ endpoint: sub.endpoint, keys: sub.keys },
				JSON.stringify({
					title: "Direct push test",
					body: "This one skipped the queue — sent straight from the script.",
					link: "/",
				}),
			);
			console.log(`[direct] ${sub.endpoint.slice(0, 60)}… →`, res);
		}
	}
}

main()
	.then(() => {
		console.log("Done.");
		process.exit(0);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
