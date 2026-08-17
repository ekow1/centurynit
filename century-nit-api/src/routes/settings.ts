import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
	listSettingsForDisplay,
	writeSetting,
	getAuditLog,
	SETTING_DEFS,
	mask,
	type SettingKey,
} from "../services/settings.js";
import { getAuthInstance } from "./auth.js";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireMfa,
	requireModule,
	type AuthVariables,
} from "../middleware/auth.js";

/**
 * Platform settings — integration credentials managed from the ops UI.
 *
 * Security:
 *   - Requires the `settings` module permission (typically `super_admin` / `admin`).
 *   - Every write requires a fresh TOTP code from the caller's authenticator.
 *     A stolen session (an unattended laptop) cannot rotate API keys without
 *     the physical second factor.
 *   - Values are never returned in plaintext. Secrets are masked; non-secrets
 *     (URLs, bucket names) are shown in full since they are not credentials.
 *   - Every change is recorded in `settings_audit` with masked old/new values.
 */

import { createHmac } from "node:crypto";
import { env } from "../env.js";

const STEP_UP_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function createStepUpToken(opsUserId: string, email: string): { stepUpToken: string; expiresAt: string } {
	const expiresAtMs = Date.now() + STEP_UP_TTL_MS;
	const payload = `${opsUserId}:${email}:${expiresAtMs}`;
	const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(payload)
		.digest("base64url");
	const stepUpToken = `${Buffer.from(payload).toString("base64url")}.${signature}`;
	return { stepUpToken, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function verifyStepUpToken(token: string, expectedOpsUserId: string): boolean {
	try {
		const [b64Payload, signature] = token.split(".");
		if (!b64Payload || !signature) return false;
		const payload = Buffer.from(b64Payload, "base64url").toString("utf8");
		const expectedSig = createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(payload)
			.digest("base64url");
		if (signature !== expectedSig) return false;
		const [opsUserId, , expiresAtMsStr] = payload.split(":");
		if (opsUserId !== expectedOpsUserId) return false;
		const expiresAtMs = Number(expiresAtMsStr);
		if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
		return true;
	} catch {
		return false;
	}
}

const settingsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const settingKeySchema = z.enum(
	Object.keys(SETTING_DEFS) as [SettingKey, ...SettingKey[]],
);

const stepUpBodySchema = z.object({
	totpCode: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator"),
});

const updateBodySchema = z.object({
	key: settingKeySchema,
	/** Plaintext value to store. Pass null to clear (revert to env fallback). */
	value: z.string().nullable(),
	/** 6-digit code from authenticator app (if unlocking on save). */
	totpCode: z.string().regex(/^\d{6}$/).optional(),
	/** Active 15-minute step-up token from prior unlock. */
	stepUpToken: z.string().optional(),
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
	stepUpToken: z.string().optional(),
	expiresAt: z.string().optional(),
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

/* ── POST /api/v1/settings/step-up ────────────────────────────────────────── */

settingsRouter.openapi(
	createRoute({
		method: "post",
		path: "/step-up",
		tags: ["Settings"],
		summary: "Unlock settings session for 15 minutes with TOTP",
		middleware: [requireAuth, requireMfa, requireModule("settings")] as const,
		request: {
			body: {
				content: { "application/json": { schema: stepUpBodySchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							ok: z.boolean(),
							stepUpToken: z.string(),
							expiresAt: z.string(),
						}),
					},
				},
				description: "Step-up session token valid for 15 minutes",
			},
			403: { description: "Invalid authenticator code" },
		},
	}),
	async (c) => {
		const body = c.req.valid("json" as never) as z.infer<typeof stepUpBodySchema>;
		const staff = c.get("staff");
		if (!staff) throw new HttpError(403, "FORBIDDEN", "Staff access required");

		try {
			const authInstance = await getAuthInstance();
			const verifyRes = await authInstance.api.verifyTOTP({
				body: { code: body.totpCode },
				headers: c.req.raw.headers,
			});
			if (verifyRes && typeof verifyRes === "object" && "error" in verifyRes && (verifyRes as { error?: { message?: string } }).error) {
				throw new Error((verifyRes as { error?: { message?: string } }).error?.message || "Invalid code");
			}
		} catch (totpErr) {
			console.error("[Settings] Step-up TOTP verification failed:", totpErr);
			throw new HttpError(
				403,
				"MFA_REQUIRED",
				"That code was not accepted. Use the current code from your authenticator.",
			);
		}

		const stepUp = createStepUpToken(staff.opsUserId, staff.email);
		return c.json({ ok: true, ...stepUp });
	},
);

/* ── GET /api/v1/settings ──────────────────────────────────────────────────── */

settingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Settings"],
		summary: "List all platform settings (masked)",
		middleware: [requireAuth, requireMfa, requireModule("settings")] as const,
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
		middleware: [requireAuth, requireMfa, requireModule("settings")] as const,
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

		let activeStepUp = false;
		if (body.stepUpToken && verifyStepUpToken(body.stepUpToken, staff.opsUserId)) {
			activeStepUp = true;
		}

		let refreshedStepUp: { stepUpToken: string; expiresAt: string } | null = null;

		if (!activeStepUp) {
			if (!body.totpCode) {
				throw new HttpError(
					403,
					"MFA_REQUIRED",
					"Settings session locked. Enter your 6-digit authenticator code to proceed.",
				);
			}

			try {
				const authInstance = await getAuthInstance();
				const verifyRes = await authInstance.api.verifyTOTP({
					body: { code: body.totpCode },
					headers: c.req.raw.headers,
				});
				if (verifyRes && typeof verifyRes === "object" && "error" in verifyRes && (verifyRes as { error?: { message?: string } }).error) {
					throw new Error((verifyRes as { error?: { message?: string } }).error?.message || "Invalid code");
				}
			} catch (totpErr) {
				console.error("[Settings] TOTP verification failed:", totpErr);
				throw new HttpError(
					403,
					"MFA_REQUIRED",
					"That code was not accepted. Use the current code from your authenticator.",
				);
			}

			refreshedStepUp = createStepUpToken(staff.opsUserId, staff.email);
		}

		try {
			await writeSetting(body.key, body.value, {
				opsUserId: staff.opsUserId,
				email: staff.email,
			});
		} catch (err) {
			if (err instanceof HttpError) throw err;
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				err instanceof Error ? err.message : "Could not save this setting",
			);
		}

		const all = await listSettingsForDisplay();
		const updated = all.find((s) => s.key === body.key);
		const baseResponse = updated ?? {
			key: body.key,
			label: SETTING_DEFS[body.key]?.label ?? body.key,
			group: SETTING_DEFS[body.key]?.group ?? "Other",
			secret: SETTING_DEFS[body.key]?.secret ?? false,
			description: SETTING_DEFS[body.key]?.description ?? "",
			valueMasked: body.value ? mask(body.value, SETTING_DEFS[body.key]?.secret ?? false) : null,
			source: body.value ? ("database" as const) : ("unset" as const),
			updatedAt: new Date().toISOString(),
		};

		return c.json({
			...baseResponse,
			...(refreshedStepUp ? refreshedStepUp : {}),
		});
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
		middleware: [requireAuth, requireMfa, requireModule("settings")] as const,
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
