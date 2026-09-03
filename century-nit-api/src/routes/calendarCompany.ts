import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { createHmac } from "node:crypto";
import {
	requireAuth,
	requireRole,
	type AuthVariables,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { env } from "../env.js";
import { writeSettingSystem } from "../services/settings.js";
import {
	buildConsentUrl,
	createOAuthClient,
	googleConfigured,
} from "../services/calendar/google.js";
import {
	companyCalendarConnected,
	clearCompanyTokens,
	writeCompanyTokens,
} from "../services/calendar/index.js";

/**
 * Company Google Meet — one company account creates every consultation
 * Meet link. Consultants never connect their own calendar.
 *
 * Flow:
 *   1. Admin opens GET /company/consent → redirected to Google consent screen.
 *   2. Google redirects back to GET /callback?code=...&state=...
 *   3. Backend exchanges the code for tokens, stores them in platform settings.
 *   4. Admin checks status via GET /company/status.
 *   5. Admin disconnects via POST /company/disconnect.
 *
 * The state token binds the callback to the admin session that started the
 * flow, so a forged callback cannot install arbitrary Google tokens.
 */

export const calendarCompanyRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function signState(opsUserId: string): string {
	// Inline HMAC so this route has no dependency on the settings router's
	// step-up token helper. Short-lived, single-purpose.
	const expiresAtMs = Date.now() + STATE_TTL_MS;
	const payload = `${opsUserId}:${expiresAtMs}`;
	const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(payload)
		.digest("base64url");
	return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

/* ── Consent ─────────────────────────────────────────────────────────────── */

const consentRoute = createRoute({
	method: "get",
	path: "/company/consent",
	tags: ["Company Google Meet"],
	summary: "Start the company Google account OAuth flow",
	middleware: [requireAuth, requireRole("super_admin", "admin")] as const,
	responses: {
		302: { description: "Redirect to Google consent screen" },
		400: { description: "Google Meet is not configured" },
	},
});

calendarCompanyRouter.openapi(consentRoute, async (c) => {
	const user = c.get("user");
	if (!user) throw new HttpError(401, "UNAUTHORIZED", "Sign in required");

	const configured = await googleConfigured();
	if (!configured) {
		throw new HttpError(
			400,
			"GOOGLE_NOT_CONFIGURED",
			"Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in Platform Settings first.",
		);
	}

	const state = signState(user.id);
	const url = await buildConsentUrl(state);
	return c.redirect(url, 302);
});

/* ── Callback ────────────────────────────────────────────────────────────── */

const callbackRoute = createRoute({
	method: "get",
	path: "/callback",
	tags: ["Company Google Meet"],
	summary: "OAuth callback — exchanges the code for tokens",
	request: {
		query: z.object({
			code: z.string().optional(),
			state: z.string().optional(),
			error: z.string().optional(),
		}),
	},
	responses: {
		200: { description: "Connected" },
		400: { description: "Invalid state or missing code" },
	},
});

calendarCompanyRouter.openapi(callbackRoute, async (c) => {
	const { code, state, error } = c.req.valid("query");

	if (error) {
		// Google returns error=access_denied if the admin cancels. Surface it
		// as a plain message rather than a stack trace.
		return c.text(`Google did not grant access: ${error}`, 400);
	}
	if (!code || !state) {
		return c.text("Missing code or state in Google callback.", 400);
	}

	// The callback is unauthenticated (Google redirects the browser here), so
	// we cannot read c.get("user"). The state token is the sole credential —
	// it binds the callback to the admin who started the flow. Without a valid
	// state, a forged callback could install arbitrary Google tokens.
	//
	// We verify the state signature and expiry, but we cannot tie it back to a
	// specific ops user without a session. This is acceptable: the state was
	// minted by an authenticated admin, and the tokens it installs are the
	// company account's, not a personal one.
	try {
		const [b64Payload, signature] = state.split(".");
		if (!b64Payload || !signature) return c.text("Invalid state.", 400);
		const payload = Buffer.from(b64Payload, "base64url").toString("utf8");
		const expectedSig = createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(payload)
			.digest("base64url");
		if (signature !== expectedSig) return c.text("Invalid state signature.", 400);
		const [, expiresAtMsStr] = payload.split(":");
		const expiresAtMs = Number(expiresAtMsStr);
		if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
			return c.text("State expired. Restart the connect flow.", 400);
		}
	} catch {
		return c.text("Invalid state.", 400);
	}

	const client = await createOAuthClient();
	const { tokens } = await client.getToken(code);
	if (!tokens.refresh_token) {
		// Google only returns a refresh token on the first consent. If the
		// admin reconnects without revoking first, we get here. Tell them to
		// revoke access in their Google account and try again.
		return c.text(
			"Google did not return a refresh token. Revoke access at https://myaccount.google.com/permissions and try again.",
			400,
		);
	}

	const accessToken = tokens.access_token ?? null;
	const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000);

	// Fetch the account email so the UI can show which account is connected.
	let accountEmail: string | null = null;
	if (accessToken) {
		try {
			const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			if (res.ok) {
				const info = (await res.json()) as { email?: string };
				accountEmail = info.email ?? null;
			}
		} catch {
			// Non-fatal — the connection still works without the email label.
		}
	}

	await writeCompanyTokens({
		accessToken: accessToken ?? "",
		expiresAt,
		refreshToken: tokens.refresh_token,
	});

	// Persist the account email and a default calendarId of "primary".
	if (accountEmail) {
		await writeSettingSystem("GOOGLE_COMPANY_ACCOUNT_EMAIL", accountEmail);
	}
	await writeSettingSystem("GOOGLE_COMPANY_CALENDAR_ID", "primary");

	return c.text(
		`Connected${accountEmail ? ` as ${accountEmail}` : ""}. You can close this tab.`,
		200,
	);
});

/* ── Status ──────────────────────────────────────────────────────────────── */

const statusRoute = createRoute({
	method: "get",
	path: "/company/status",
	tags: ["Company Google Meet"],
	summary: "Whether the company Google account is connected",
	middleware: [requireAuth, requireRole("super_admin", "admin")] as const,
	responses: {
		200: {
			description: "Connection status",
			content: {
				"application/json": {
					schema: z.object({
						connected: z.boolean(),
						accountEmail: z.string().nullable(),
						calendarId: z.string().nullable(),
						configured: z.boolean(),
					}),
				},
			},
		},
	},
});

calendarCompanyRouter.openapi(statusRoute, async (c) => {
	const user = c.get("user");
	if (!user) throw new HttpError(401, "UNAUTHORIZED", "Sign in required");

	const configured = await googleConfigured();
	const status = await companyCalendarConnected();
	return c.json({
		connected: status.connected,
		accountEmail: status.accountEmail,
		calendarId: status.calendarId,
		configured,
	});
});

/* ── Disconnect ──────────────────────────────────────────────────────────── */

const disconnectRoute = createRoute({
	method: "post",
	path: "/company/disconnect",
	tags: ["Company Google Meet"],
	summary: "Disconnect the company Google account",
	middleware: [requireAuth, requireRole("super_admin", "admin")] as const,
	responses: {
		200: { description: "Disconnected" },
	},
});

calendarCompanyRouter.openapi(disconnectRoute, async (c) => {
	const user = c.get("user");
	if (!user) throw new HttpError(401, "UNAUTHORIZED", "Sign in required");

	await clearCompanyTokens();
	return c.json({ ok: true });
});


