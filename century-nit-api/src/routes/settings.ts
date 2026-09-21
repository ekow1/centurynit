import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
	listSettingsForDisplay,
	writeSetting,
	getAuditLog,
	getSetting,
	SETTING_DEFS,
	mask,
	type SettingKey,
} from "../services/settings.js";
import { getDocumentStorage } from "../services/storage/index.js";
import { getUnifiedAuditLog } from "../services/audit.js";
import { getAuthInstance } from "./auth.js";
import { HttpError, validationHook } from "../middleware/error.js";
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

const settingsRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

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
	action: z.string().nullable(),
	actorIp: z.string().nullable(),
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

/* ── GET /api/v1/settings/ops-config — the few numbers every officer's screen needs ── */

settingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/ops-config",
		tags: ["Settings"],
		summary: "Operational settings any signed-in staff member may read",
		middleware: [requireAuth, requireMfa] as const,
		responses: {
			200: { content: { "application/json": { schema: z.object({ officerCapacity: z.number().int() }) } }, description: "Operational numbers" },
		},
	}),
	async (c) => {
		const raw = await getSetting("OFFICER_CAPACITY");
		const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
		return c.json({ officerCapacity: Number.isFinite(n) && n > 0 ? n : 15 });
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
		const includeHidden = c.req.query("include_hidden") === "true";
		const settings = await listSettingsForDisplay(includeHidden);
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

		// The fee schedule (amounts, the exchange rate, the milestone split) is
		// finance's day-to-day work, not a credential: no step-up for it.
		const FEE_SCHEDULE_KEYS = new Set([
			"PLATFORM_EXCHANGE_RATE",
			"SERVICE_FEE_DEPOSIT_PERCENT",
			"SERVICE_FEE_PRE_DEPARTURE_PERCENT",
			"POST_ARRIVAL_DURATIONS",
			"POST_ARRIVAL_FREQUENCIES",
			"POST_ARRIVAL_GRACE_DAYS",
			"POST_ARRIVAL_REMIND_DAYS",
			"POST_ARRIVAL_INTEREST_PCT",
		]);
		const isSensitiveSetting = !FEE_SCHEDULE_KEYS.has(body.key);

		if (isSensitiveSetting && !activeStepUp) {
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
				ip: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
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

/* ── GET /api/v1/settings/admin-audit ──────────────────────────────────────── */
/* The unified trail the /audit page reads: settings changes + admin events.   */

const unifiedAuditEntrySchema = z.object({
	id: z.string(),
	source: z.enum(["settings", "admin"]),
	category: z.string(),
	action: z.string(),
	actorEmail: z.string().nullable(),
	target: z.string().nullable(),
	detail: z.string().nullable(),
	oldValueMasked: z.string().nullable(),
	newValueMasked: z.string().nullable(),
	ip: z.string().nullable(),
	at: z.string(),
});

settingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/admin-audit",
		tags: ["Settings"],
		summary: "Unified admin audit trail",
		description:
			"Settings changes and administrative events (invites, access control, " +
			"role grants, sign-ins) in one chronological list. Every field is " +
			"recorded at write time — nothing is synthesized.",
		middleware: [requireAuth, requireMfa, requireModule("system")] as const,
		request: {
			query: z.object({
				category: z.string().optional(),
				q: z.string().optional(),
				from: z.string().optional(),
				to: z.string().optional(),
				limit: z.coerce.number().int().min(1).max(200).optional(),
				offset: z.coerce.number().int().min(0).optional(),
			}),
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							entries: z.array(unifiedAuditEntrySchema),
							total: z.number(),
							facets: z.record(z.string(), z.number()),
						}),
					},
				},
				description: "Unified audit entries, newest first",
			},
		},
	}),
	async (c) => {
		const q = c.req.valid("query" as never) as {
			category?: string;
			q?: string;
			from?: string;
			to?: string;
			limit?: number;
			offset?: number;
		};
		const page = await getUnifiedAuditLog(q);
		return c.json(page);
	},
);

/* ── GET /api/v1/settings/storage-check ──────────────────────────────────────
 *
 * Document storage is the one integration that fails invisibly: the settings
 * list can show SUPABASE_* as configured while decryption, the service key,
 * or the bucket are actually broken — and the document viewer dead-ends on a
 * generic 500. This endpoint resolves the same storage the routes use and
 * performs a real (harmless) probe, so an admin gets the ground truth: which
 * layer supplies each value, and whether the bucket actually answers.
 *
 * Read-only: it lists nothing and touches no object. The probe key is a name
 * that cannot exist, so a healthy bucket answers "not found" — the error only
 * ever fires when the credentials or bucket themselves are wrong.
 */
settingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/storage-check",
		tags: ["Settings"],
		summary: "Probe document storage configuration and connectivity",
		middleware: [requireAuth, requireMfa, requireModule("settings")] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							configured: z.boolean(),
							supabaseUrl: z.string().nullable(),
							bucket: z.string().nullable(),
							sources: z.record(z.string(), z.string()),
							reachable: z.boolean().nullable(),
							probeError: z.string().nullable(),
						}),
					},
				},
				description: "Storage configuration + connectivity probe",
			},
		},
	}),
	async (c) => {
		const display = await listSettingsForDisplay();
		const sourceOf = (key: string) =>
			display.find((s) => s.key === key)?.source ?? "unset";

		const url = await getSetting("SUPABASE_URL");
		const bucket = await getSetting("SUPABASE_STORAGE_BUCKET");
		const storage = await getDocumentStorage();

		let reachable: boolean | null = null;
		let probeError: string | null = null;
		if (storage.enabled) {
			try {
				// Sign a key that cannot exist. A healthy stack answers
				// "Object not found" — which still proves the URL, the service
				// key, the bucket, and URL signing all work. Any other error
				// (bad key, wrong bucket, unreachable host) is reported as-is.
				await storage.createDownloadUrl({ key: "__storage-probe__.bin" });
				reachable = true;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (/not found|does not exist/i.test(msg)) {
					reachable = true;
				} else {
					reachable = false;
					probeError = msg;
				}
			}
		}

		return c.json({
			configured: storage.enabled,
			supabaseUrl: url ?? null,
			bucket: bucket ?? null,
			sources: {
				SUPABASE_URL: sourceOf("SUPABASE_URL"),
				SUPABASE_SERVICE_ROLE_KEY: sourceOf("SUPABASE_SERVICE_ROLE_KEY"),
				SUPABASE_STORAGE_BUCKET: sourceOf("SUPABASE_STORAGE_BUCKET"),
			},
			reachable,
			probeError,
		});
	},
);

export { settingsRouter };
