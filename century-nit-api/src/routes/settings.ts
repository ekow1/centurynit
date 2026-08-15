import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
	listSettingsForDisplay,
	writeSetting,
	getAuditLog,
	SETTING_DEFS,
	type SettingKey,
} from "../services/settings.js";
import { getAuthInstance } from "./auth.js";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireRole,
	type AuthVariables,
} from "../middleware/auth.js";

/**
 * Platform settings — integration credentials managed from the ops UI.
 *
 * Strict security:
 *   - `super_admin` only. Not even `admin` can change these.
 *   - Every write requires a fresh TOTP code from the caller's authenticator.
 *     A stolen session (an unattended laptop) cannot rotate API keys without
 *     the physical second factor.
 *   - Values are never returned in plaintext. Secrets are masked; non-secrets
 *     (URLs, bucket names) are shown in full since they are not credentials.
 *   - Every change is recorded in `settings_audit` with masked old/new values.
 */

const settingsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const settingKeySchema = z.enum(
	Object.keys(SETTING_DEFS) as [SettingKey, ...SettingKey[]],
);

const updateBodySchema = z.object({
	key: settingKeySchema,
	/** Plaintext value to store. Pass null to clear (revert to env fallback). */
	value: z.string().nullable(),
	/**
	 * A current code from the caller's authenticator.
	 *
	 * Step-up authentication: a session cookie alone must not be enough to
	 * rotate an API key, so the caller proves possession of their second factor
	 * at the moment of the change. Every staff role already has TOTP enrolled
	 * (`requireMfa`), so this asks for something they always have.
	 */
	totpCode: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator"),
});

const settingResponseSchema = z.object({
	key: z.string(),
	label: z.string(),
	group: z.string(),
	secret: z.boolean(),
	description: z.string(),
	valueMasked: z.string().nullable(),
	source: z.enum(["database", "env", "unset"]),
	updatedAt: z.string().nullable(),
});

const listResponseSchema = z.object({
	settings: z.array(settingResponseSchema),
});

const auditEntrySchema = z.object({
	id: z.string(),
	key: z.string(),
	actorEmail: z.string().nullable(),
	oldValueMasked: z.string().nullable(),
	newValueMasked: z.string().nullable(),
	at: z.string(),
});

const auditResponseSchema = z.object({
	entries: z.array(auditEntrySchema),
});

/* ── GET /api/v1/settings ──────────────────────────────────────────────────── */

settingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Settings"],
		summary: "List all platform settings (masked)",
		description:
			"Returns every integration setting with masked values. " +
			"Secrets show first 3 + last 4 chars; non-secrets show in full. " +
			"Requires super_admin.",
		middleware: [requireAuth, requireRole("super_admin")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: listResponseSchema } },
				description: "All settings with masked values",
			},
			403: { description: "Not super_admin" },
		},
	}),
	async (c) => {
		const settings = await listSettingsForDisplay();
		return c.json({ settings });
	},
);

/* ── PUT /api/v1/settings ──────────────────────────────────────────────────── */

settingsRouter.openapi(
	createRoute({
		method: "put",
		path: "/",
		tags: ["Settings"],
		summary: "Update a platform setting",
		description:
			"Encrypts and stores a setting value. Requires the caller's current " +
			"password. Pass null to clear (revert to env fallback). Requires super_admin.",
		middleware: [requireAuth, requireRole("super_admin")] as const,
		request: {
			body: {
				content: { "application/json": { schema: updateBodySchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: settingResponseSchema } },
				description: "The updated setting (masked)",
			},
			403: { description: "Not super_admin, or the authenticator code was rejected" },
		},
	}),
	async (c) => {
		const body = c.req.valid("json" as never) as z.infer<typeof updateBodySchema>;
		const staff = c.get("staff");

		if (!staff) {
			throw new HttpError(403, "FORBIDDEN", "Staff access required");
		}

		/*
		 * Step up before accepting the change.
		 *
		 * Deliberately NOT a password re-check via `signInEmail`. That is a full
		 * sign-in used as a comparison: it writes a session row per settings save,
		 * and — the real problem — failed attempts count against Better Auth's
		 * sign-in rate limiter, so an admin who mistypes while editing settings can
		 * lock themselves out of signing in at all.
		 *
		 * A TOTP code is the right primitive here: it proves possession, it is
		 * inherently fresh and single-use, and every staff role already has one
		 * enrolled.
		 */
		try {
			const authInstance = await getAuthInstance();
			await authInstance.api.verifyTOTP({
				body: { code: body.totpCode },
				headers: c.req.raw.headers,
			});
		} catch {
			throw new HttpError(
				403,
				"MFA_REQUIRED",
				"That code was not accepted. Use the current code from your authenticator.",
			);
		}

		try {
			await writeSetting(body.key, body.value, {
				opsUserId: staff.opsUserId,
				email: staff.email,
			});
		} catch (err) {
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				err instanceof Error ? err.message : "Could not save this setting",
			);
		}

		const all = await listSettingsForDisplay();
		const updated = all.find((s) => s.key === body.key)!;
		return c.json(updated);
	},
);

/* ── GET /api/v1/settings/audit ────────────────────────────────────────────── */

settingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/audit",
		tags: ["Settings"],
		summary: "Settings audit log",
		description:
			"Recent settings changes, newest first. Values are masked. Requires super_admin.",
		middleware: [requireAuth, requireRole("super_admin")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: auditResponseSchema } },
				description: "Recent settings changes, newest first",
			},
			403: { description: "Not super_admin" },
		},
	}),
	async (c) => {
		const entries = await getAuditLog(50);
		return c.json({ entries });
	},
);

export { settingsRouter };
