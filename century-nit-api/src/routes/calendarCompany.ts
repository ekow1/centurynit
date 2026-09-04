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
import { getSetting, writeSettingSystem } from "../services/settings.js";
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

function signState(opsUserId: string, returnTo?: string): string {
	// Inline HMAC so this route has no dependency on the settings router's
	// step-up token helper. Short-lived, single-purpose.
	const expiresAtMs = Date.now() + STATE_TTL_MS;
	const safeReturn = returnTo ? Buffer.from(returnTo).toString("base64url") : "";
	const payload = `${opsUserId}:${expiresAtMs}:${safeReturn}`;
	const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(payload)
		.digest("base64url");
	return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

function renderCallbackHtml(options: {
	success: boolean;
	title: string;
	message: string;
	accountEmail?: string | null;
	technicalDetails?: string | null;
	returnUrl: string;
}): string {
	const { success, title, message, accountEmail, technicalDetails, returnUrl } = options;
	const iconColor = success ? "#10b981" : "#ef4444";
	const iconBg = success ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)";
	const iconSvg = success
		? `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
		: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Century NIT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
      background-color: #0b132b;
      color: #f1f5f9;
      padding: 1.5rem;
    }
    .card {
      max-width: 500px;
      width: 100%;
      background: #1c2541;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      padding: 2.25rem 2rem;
      text-align: center;
    }
    .icon-wrapper {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      background: ${iconBg};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem auto;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      color: #ffffff;
    }
    .message {
      font-size: 0.95rem;
      line-height: 1.55;
      color: #94a3b8;
      margin-bottom: 1.25rem;
    }
    .account-badge {
      display: inline-block;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      font-family: ui-monospace, monospace;
      font-size: 0.875rem;
      margin-bottom: 1.25rem;
    }
    .technical {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-family: ui-monospace, monospace;
      font-size: 0.8rem;
      color: #cbd5e1;
      text-align: left;
      word-break: break-all;
      margin-bottom: 1.25rem;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.75rem 1.25rem;
      font-size: 0.95rem;
      font-weight: 600;
      border-radius: 8px;
      text-decoration: none;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .btn-primary {
      background: #00b4d8;
      color: #0b132b;
    }
    .btn-primary:hover {
      background: #48cae4;
    }
    .redirect-note {
      margin-top: 1rem;
      font-size: 0.8rem;
      color: #64748b;
    }
  </style>
  ${success ? `<meta http-equiv="refresh" content="3;url=${returnUrl}">` : ""}
</head>
<body>
  <div class="card">
    <div class="icon-wrapper">
      ${iconSvg}
    </div>
    <h1>${title}</h1>
    <p class="message">${message}</p>
    ${accountEmail ? `<div class="account-badge">${accountEmail}</div>` : ""}
    ${technicalDetails ? `<div class="technical"><strong>Details:</strong> ${technicalDetails}</div>` : ""}
    <div class="actions">
      <a class="btn btn-primary" href="${returnUrl}">Return to Operations Console</a>
    </div>
    ${success ? `<p class="redirect-note">Redirecting back to settings in 3 seconds…</p>` : ""}
  </div>
</body>
</html>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderCallbackResponse(
	c: any,
	options: {
		success: boolean;
		status: 200 | 400 | 500;
		returnUrl: string;
		title: string;
		message: string;
		accountEmail?: string | null;
		technicalDetails?: string | null;
	},
) {
	const accept = c.req.header("accept") || "";
	const prefersJson = accept.includes("application/json") && !accept.includes("text/html");

	if (prefersJson) {
		return c.json(
			{
				success: options.success,
				title: options.title,
				message: options.message,
				accountEmail: options.accountEmail ?? null,
				technicalDetails: options.technicalDetails ?? null,
				returnUrl: options.returnUrl,
			},
			options.status,
		);
	}

	return c.html(renderCallbackHtml(options), options.status);
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

	const referer = c.req.header("referer") || c.req.header("origin");
	const fallbackReturn = `${env.CONSOLE_URL}/settings`;
	const returnTo = referer && referer.startsWith("http") ? referer : fallbackReturn;

	const state = signState(user.id, returnTo);
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
		400: { description: "Invalid state or OAuth error" },
		500: { description: "Database save error" },
	},
});

calendarCompanyRouter.openapi(callbackRoute, async (c) => {
	const { code, state, error } = c.req.valid("query");
	const defaultReturnUrl = `${env.CONSOLE_URL}/settings`;
	let returnUrl = defaultReturnUrl;

	if (error) {
		return renderCallbackResponse(c, {
			success: false,
			status: 400,
			returnUrl,
			title: "Google Access Not Granted",
			message: `Google returned an error: ${error}. The authorization was cancelled or access was declined.`,
			technicalDetails: `google_error: ${error}`,
		});
	}

	if (!code || !state) {
		return renderCallbackResponse(c, {
			success: false,
			status: 400,
			returnUrl,
			title: "Missing Parameters",
			message: "Missing authorization code or state in Google callback.",
			technicalDetails: "missing_code_or_state",
		});
	}

	// Verify state signature and expiration
	try {
		const [b64Payload, signature] = state.split(".");
		if (!b64Payload || !signature) {
			return renderCallbackResponse(c, {
				success: false,
				status: 400,
				returnUrl,
				title: "Invalid OAuth State",
				message: "The OAuth state parameter is malformed.",
				technicalDetails: "state_malformed",
			});
		}
		const payload = Buffer.from(b64Payload, "base64url").toString("utf8");
		const expectedSig = createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(payload)
			.digest("base64url");
		if (signature !== expectedSig) {
			return renderCallbackResponse(c, {
				success: false,
				status: 400,
				returnUrl,
				title: "Security Verification Failed",
				message: "OAuth state signature is invalid. Please restart the connect flow from Platform Settings.",
				technicalDetails: "state_signature_mismatch",
			});
		}
		const [, expiresAtMsStr, returnToB64] = payload.split(":");
		if (returnToB64) {
			try {
				const decoded = Buffer.from(returnToB64, "base64url").toString("utf8");
				if (decoded.startsWith("http")) returnUrl = decoded;
			} catch {
				// Ignore malformed returnTo and fallback to default
			}
		}
		const expiresAtMs = Number(expiresAtMsStr);
		if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
			return renderCallbackResponse(c, {
				success: false,
				status: 400,
				returnUrl,
				title: "Session Expired",
				message: "The Google connection request has expired (valid for 10 minutes). Please try connecting again.",
				technicalDetails: "state_expired",
			});
		}
	} catch (err: unknown) {
		return renderCallbackResponse(c, {
			success: false,
			status: 400,
			returnUrl,
			title: "Invalid State",
			message: "Could not parse OAuth state parameter.",
			technicalDetails: err instanceof Error ? err.message : String(err),
		});
	}

	const configured = await googleConfigured();
	if (!configured) {
		return renderCallbackResponse(c, {
			success: false,
			status: 400,
			returnUrl,
			title: "Google Meet Not Configured",
			message: "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in Platform Settings first.",
			technicalDetails: "google_not_configured",
		});
	}

	const client = await createOAuthClient();
	let tokens: {
		access_token?: string | null;
		refresh_token?: string | null;
		expiry_date?: number | null;
	};

	try {
		const tokenRes = await client.getToken(code);
		tokens = tokenRes.tokens;
	} catch (err: unknown) {
		const gErr = err as {
			message?: string;
			response?: { data?: { error?: string; error_description?: string } };
		};
		const oauthErr = gErr.response?.data?.error || gErr.message || "exchange_failed";
		const oauthDesc = gErr.response?.data?.error_description || "";
		console.error("[Google OAuth Callback] Token exchange failed:", {
			error: oauthErr,
			description: oauthDesc,
			cause: err,
		});

		let friendlyMsg = `Google token exchange failed (${oauthErr}).`;
		if (oauthErr === "redirect_uri_mismatch") {
			const redirectUri = (await getSetting("GOOGLE_REDIRECT_URI")) ?? env.GOOGLE_REDIRECT_URI;
			friendlyMsg = `Redirect URI mismatch. Please ensure '${redirectUri}' is added to Authorized redirect URIs in your Google Cloud Console OAuth Client settings.`;
		} else if (oauthErr === "invalid_grant") {
			friendlyMsg = "Authorization code expired or already used. Please return to Platform Settings and click Connect again.";
		} else if (oauthErr === "invalid_client") {
			friendlyMsg = "Google OAuth Client ID or Client Secret is invalid. Please verify the credentials saved in Platform Settings.";
		} else if (oauthDesc) {
			friendlyMsg += ` ${oauthDesc}`;
		}

		return renderCallbackResponse(c, {
			success: false,
			status: 400,
			returnUrl,
			title: "Google Authorization Failed",
			message: friendlyMsg,
			technicalDetails: `${oauthErr}${oauthDesc ? `: ${oauthDesc}` : ""}`,
		});
	}

	// Reconnect resilience: if Google didn't return a refresh token (user reconnected without revoking),
	// check if we already have one stored in platform settings.
	const existingRefreshToken = await getSetting("GOOGLE_COMPANY_REFRESH_TOKEN");
	const refreshToken = tokens.refresh_token || existingRefreshToken;

	if (!refreshToken) {
		return renderCallbackResponse(c, {
			success: false,
			status: 400,
			returnUrl,
			title: "Refresh Token Missing",
			message:
				"Google did not return a refresh token. If you previously connected this account, visit https://myaccount.google.com/permissions to revoke access for Century NIT, then try connecting again.",
			technicalDetails: "missing_refresh_token",
		});
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
		} catch (emailErr) {
			console.warn("[Google OAuth Callback] Could not fetch userinfo email:", emailErr);
		}
	}

	try {
		await writeCompanyTokens({
			accessToken: accessToken ?? "",
			expiresAt,
			refreshToken,
		});

		// Persist the account email and a default calendarId of "primary".
		if (accountEmail) {
			await writeSettingSystem("GOOGLE_COMPANY_ACCOUNT_EMAIL", accountEmail);
		}
		await writeSettingSystem("GOOGLE_COMPANY_CALENDAR_ID", "primary");
	} catch (saveErr: unknown) {
		console.error("[Google OAuth Callback] Failed to save tokens to platform settings:", saveErr);
		return renderCallbackResponse(c, {
			success: false,
			status: 500,
			returnUrl,
			title: "Database Save Failed",
			message: "Google granted access, but the server encountered an error while saving credentials to platform settings.",
			technicalDetails: saveErr instanceof Error ? saveErr.message : String(saveErr),
		});
	}

	let successReturnUrl = returnUrl;
	try {
		const targetUrl = new URL(returnUrl);
		targetUrl.searchParams.set("google_connected", "1");
		if (accountEmail) targetUrl.searchParams.set("email", accountEmail);
		successReturnUrl = targetUrl.toString();
	} catch {
		// Keep returnUrl as-is if URL constructor fails
	}

	return renderCallbackResponse(c, {
		success: true,
		status: 200,
		returnUrl: successReturnUrl,
		title: "Google Account Connected",
		message: `Successfully connected${accountEmail ? ` as ${accountEmail}` : ""}. All future consultations will now automatically generate Google Meet video conference links.`,
		accountEmail,
	});
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


