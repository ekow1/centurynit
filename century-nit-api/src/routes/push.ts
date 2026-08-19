import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { pushSubscriptions } from "../db/schema.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import { getVapidPublicKey } from "../lib/push.js";

/**
 * Web Push (browser push notification) endpoints.
 *
 * The flow is the standard Web Push dance:
 *
 *   1. The browser asks for the VAPID public key (`GET /vapid-public-key`).
 *   2. It calls `pushManager.subscribe({ applicationServerKey })` and gets a
 *      `PushSubscription` (an endpoint + p256dh/auth keys).
 *   3. It POSTs that subscription to `/subscribe`; the server stores it.
 *   4. The push worker fans notifications out to every stored subscription.
 *   5. When the user opts out, the browser calls `DELETE /subscribe`.
 *
 * One user may have several subscriptions (one per browser/device), keyed by
 * `endpoint` which is globally unique per push service.
 */

export const pushRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const keysSchema = z.object({
	p256dh: z.string().min(1),
	auth: z.string().min(1),
});

const subscribeBodySchema = z.object({
	endpoint: z.string().url(),
	keys: keysSchema,
	userAgent: z.string().max(500).optional(),
});

const unsubscribeBodySchema = z.object({
	endpoint: z.string().min(1),
});

/* ── POST /subscribe ──────────────────────────────────────────────────────── */

pushRouter.openapi(
	createRoute({
		method: "post",
		path: "/subscribe",
		tags: ["Web Push"],
		summary: "Register a browser push subscription for the signed-in user",
		description:
			"Upserts the subscription keyed by `endpoint`. Re-subscribing the same " +
			"browser updates the keys and refreshes `lastUsedAt` rather than " +
			"accumulating duplicate rows.",
		middleware: [requireAuth] as const,
		request: {
			body: { content: { "application/json": { schema: subscribeBodySchema } }, required: true },
		},
		responses: {
			200: {
				description: "Subscription stored",
				content: { "application/json": { schema: z.object({ success: z.literal(true) }) } },
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		await db
			.insert(pushSubscriptions)
			.values({
				userId: user.id,
				endpoint: body.endpoint,
				keys: body.keys,
				userAgent: body.userAgent ?? null,
				lastUsedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: pushSubscriptions.endpoint,
				set: {
					keys: body.keys,
					userAgent: body.userAgent ?? null,
					lastUsedAt: new Date(),
				},
			});

		return c.json({ success: true as const });
	},
);

/* ── DELETE /subscribe ────────────────────────────────────────────────────── */

pushRouter.openapi(
	createRoute({
		method: "delete",
		path: "/subscribe",
		tags: ["Web Push"],
		summary: "Remove a browser push subscription for the signed-in user",
		description:
			"Deletes the subscription matching this `endpoint` for the signed-in " +
			"user. Idempotent — a missing endpoint returns success.",
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: unsubscribeBodySchema } },
				required: true,
			},
		},
		responses: {
			200: {
				description: "Subscription removed",
				content: { "application/json": { schema: z.object({ success: z.literal(true) }) } },
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		await db
			.delete(pushSubscriptions)
			.where(
				and(
					eq(pushSubscriptions.userId, user.id),
					eq(pushSubscriptions.endpoint, body.endpoint),
				),
			);

		return c.json({ success: true as const });
	},
);

/* ── GET /vapid-public-key ─────────────────────────────────────────────────── */

pushRouter.openapi(
	createRoute({
		method: "get",
		path: "/vapid-public-key",
		tags: ["Web Push"],
		summary: "The VAPID public key clients pass to pushManager.subscribe()",
		description:
			"Returns the URL-safe base64 public key. Auto-generates a VAPID key " +
			"pair on first call if none is configured.",
		middleware: [requireAuth] as const,
		responses: {
			200: {
				description: "VAPID public key",
				content: {
					"application/json": {
						schema: z.object({ publicKey: z.string() }),
					},
				},
			},
		},
	}),
	async (c) => {
		const publicKey = await getVapidPublicKey();
		return c.json({ publicKey });
	},
);
