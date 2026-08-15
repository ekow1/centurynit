import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
	listSettingsForDisplay,
	writeSetting,
	getAuditLog,
	SETTING_DEFS,
	type SettingKey,
} from "../services/settings.js";
import { authInstance } from "./auth.js";
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
 *   - Every write requires the caller's current password, re-verified against
 *     Better Auth. A stolen session (e.g. an unattended laptop) cannot change
 *     API keys without the password.
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
	/** Caller's current password, re-verified before the write is accepted. */
	password: z.string().min(1),
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

/* ── GET /api/settings ──────────────────────────────────────────────────── */

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

/* ── PUT /api/settings ──────────────────────────────────────────────────── */

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
			403: { description: "Not super_admin or wrong password" },
		},
	}),
	async (c) => {
		const body = c.req.valid("json" as never) as z.infer<typeof updateBodySchema>;
		const user = c.get("user");
		const staff = c.get("staff");

		if (!staff) {
			throw new HttpError(403, "FORBIDDEN", "Staff access required");
		}

		// Re-verify the caller's password before accepting any change.
		// A session cookie alone is not enough — an unattended browser should
		// not be able to rotate API keys.
		try {
			await authInstance.api.signInEmail({
				body: { email: user.email, password: body.password },
			});
		} catch {
			throw new HttpError(403, "PASSWORD_REQUIRED", "Current password is incorrect");
		}

		await writeSetting(body.key, body.value, {
			opsUserId: staff.opsUserId,
			email: staff.email,
		});

		const all = await listSettingsForDisplay();
		const updated = all.find((s) => s.key === body.key)!;
		return c.json(updated);
	},
);

/* ── GET /api/settings/audit ────────────────────────────────────────────── */

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
