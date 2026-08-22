import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { mailingLists, mailingListContacts, leads } from "../db/schema.js";
import { sendEmail } from "../lib/resend.js";
import { env } from "../env.js";

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Public newsletter subscription — double opt-in.
 *
 * Mounted at /api/v1/newsletter. No auth: visitors subscribe from the public
 * site's popup. Subscribers are stored as `mailing_list_contacts` against a
 * designated "Website Newsletter" mailing list, so staff campaigns already
 * reach them without a separate broadcast pipeline.
 *
 * Flow:
 *   1. POST /subscribe  → insert pending row + send confirmation email
 *   2. GET  /confirm    → flip to confirmed
 *   3. GET  /unsubscribe → flip to unsubscribed
 *
 * Staff-imported contacts default to `confirmed` so they're sendable
 * immediately; only this public route creates `pending` rows.
 */

const NEWSLETTER_LIST_NAME = "Website Newsletter";

export { NEWSLETTER_LIST_NAME, sendConfirmationEmail };

const subscribeBody = z.object({
	email: z.string().email("Valid email required"),
	name: z.string().max(255).optional(),
});

export const newsletterRouter = new OpenAPIHono();

/* ── POST /api/v1/newsletter/subscribe ──────────────────────────────────── */

newsletterRouter.openapi(
	createRoute({
		method: "post",
		path: "/subscribe",
		tags: ["Newsletter"],
		request: {
			body: { content: { "application/json": { schema: subscribeBody } }, required: true },
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							ok: z.boolean(),
							message: z.string(),
						}),
					},
				},
				description: "Confirmation email sent (or already subscribed)",
			},
		},
	}),
	async (c) => {
		const { email, name } = c.req.valid("json");
		const normalized = email.trim().toLowerCase();

		const list = await ensureNewsletterList();
		const [existing] = await db
			.select()
			.from(mailingListContacts)
			.where(
				and(
					eq(mailingListContacts.mailingListId, list.id),
					eq(mailingListContacts.email, normalized),
				),
			)
			.limit(1);

		// Already confirmed — idempotent, don't leak status to a stranger.
		if (existing?.status === "confirmed") {
			return c.json({
				ok: true,
				message: "You're already subscribed. Watch your inbox for our next issue.",
			});
		}

		// Already unsubscribed — let them re-subscribe by sending a fresh confirm.
		// (We don't auto-resubscribe; they must click the new link.)
		const token = randomUUID();

		if (existing) {
			await db
				.update(mailingListContacts)
				.set({
					status: "pending",
					confirmToken: token,
					confirmedAt: null,
					unsubscribedAt: null,
					name: name ?? existing.name,
				})
				.where(eq(mailingListContacts.id, existing.id));
		} else {
			await db.insert(mailingListContacts).values({
				mailingListId: list.id,
				email: normalized,
				name: name ?? null,
				status: "pending",
				confirmToken: token,
				confirmedAt: null,
			});
		}

		// Fire-and-forget the confirmation email — a Resend hiccup must not
		// turn a successful subscribe into a 500. The row exists; they can
		// retry from the popup, and staff can see the pending contact.
		const confirmUrl = `${env.FRONTEND_URL}/newsletter/confirm?token=${token}`;
		void sendConfirmationEmail(normalized, confirmUrl).catch((err) => {
			console.error(`[newsletter] confirmation email failed for ${normalized}:`, err);
		});

		return c.json({
			ok: true,
			message:
				"Thanks! Check your inbox for a confirmation link to finish subscribing.",
		});
	},
);

/* ── GET /api/v1/newsletter/confirm?token=... ───────────────────────────── */

newsletterRouter.openapi(
	createRoute({
		method: "get",
		path: "/confirm",
		tags: ["Newsletter"],
		request: { query: z.object({ token: z.string().uuid() }) },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							ok: z.boolean(),
							status: z.enum(["confirmed", "already_confirmed", "not_found"]),
						}),
					},
				},
				description: "Subscription confirmed",
			},
		},
	}),
	async (c) => {
		const { token } = c.req.valid("query");

		const [row] = await db
			.select()
			.from(mailingListContacts)
			.where(eq(mailingListContacts.confirmToken, token))
			.limit(1);

		if (!row) {
			return c.json({ ok: false, status: "not_found" } as const);
		}

		if (row.status === "confirmed") {
			return c.json({ ok: true, status: "already_confirmed" } as const);
		}

		await db
			.update(mailingListContacts)
			.set({
				status: "confirmed",
				confirmedAt: new Date(),
				unsubscribedAt: null,
			})
			.where(eq(mailingListContacts.id, row.id));

		return c.json({ ok: true, status: "confirmed" } as const);
	},
);

/* ── GET /api/v1/newsletter/unsubscribe?token=... ──────────────────────── */

newsletterRouter.openapi(
	createRoute({
		method: "get",
		path: "/unsubscribe",
		tags: ["Newsletter"],
		request: { query: z.object({ token: z.string().uuid() }) },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							ok: z.boolean(),
							status: z.enum(["unsubscribed", "already_unsubscribed", "not_found"]),
						}),
					},
				},
				description: "Unsubscribed",
			},
		},
	}),
	async (c) => {
		const { token } = c.req.valid("query");

		// Unsubscribe by confirm_token (the credential included in campaign
		// emails). We don't expose the contact id publicly.
		const [row] = await db
			.select()
			.from(mailingListContacts)
			.where(eq(mailingListContacts.confirmToken, token))
			.limit(1);

		if (!row) {
			return c.json({ ok: false, status: "not_found" } as const);
		}

		if (row.status === "unsubscribed") {
			return c.json({ ok: true, status: "already_unsubscribed" } as const);
		}

		await db
			.update(mailingListContacts)
			.set({
				status: "unsubscribed",
				unsubscribedAt: new Date(),
			})
			.where(eq(mailingListContacts.id, row.id));

		return c.json({ ok: true, status: "unsubscribed" } as const);
	},
);

/* ── helpers ────────────────────────────────────────────────────────────── */

async function ensureNewsletterList(): Promise<{ id: string }> {
	const [existing] = await db
		.select({ id: mailingLists.id })
		.from(mailingLists)
		.where(eq(mailingLists.name, NEWSLETTER_LIST_NAME))
		.limit(1);

	if (existing) return existing;

	const [created] = await db
		.insert(mailingLists)
		.values({
			name: NEWSLETTER_LIST_NAME,
			description: "Public website newsletter subscribers (double opt-in)",
		})
		.returning({ id: mailingLists.id });
	return created;
}

async function sendConfirmationEmail(email: string, confirmUrl: string): Promise<void> {
	const bodyHtml = `
		<p style="margin:0 0 16px 0;">You're one step away from receiving the Century NIT newsletter — intake deadlines, scholarship alerts, and visa updates, straight to your inbox.</p>
		<p style="margin:0 0 24px 0;">Confirm your subscription by clicking the button below:</p>
		<p style="margin:0 0 24px 0;text-align:center;">
			<a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background-color:#000000;color:#ffffff;text-decoration:none;padding:14px 28px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;font-size:13px;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;border:2px solid #000000;">Confirm Subscription</a>
		</p>
		<p style="margin:0 0 8px 0;color:#666666;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:</p>
		<p style="margin:0 0 24px 0;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:12px;color:#999999;word-break:break-all;">${escapeHtml(confirmUrl)}</p>
		<p style="margin:0;color:#666666;font-size:13px;">If you didn't subscribe, you can safely ignore this email — we won't send you anything else.</p>
	`;

	await sendEmail({
		to: email,
		subject: "Confirm your Century NIT newsletter subscription",
		html: newsletterEmailLayout("Confirm your subscription", bodyHtml),
		text: `Confirm your Century NIT newsletter subscription by visiting this link: ${confirmUrl}`,
	});
}

function newsletterEmailLayout(title: string, bodyHtml: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Georgia,'Times New Roman',Times,serif;-webkit-font-smoothing:antialiased;color:#000000;">
	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f5f5f5;padding:32px 16px;">
		<tr>
			<td align="center">
				<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#ffffff;border:4px solid #000000;">
					<tr>
						<td style="background-color:#000000;padding:28px 36px;text-align:left;">
							<span style="display:inline-block;padding:3px 8px;border:1px solid #ffffff;margin-bottom:8px;color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">Century NIT</span>
							<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;line-height:1.3;">${escapeHtml(title)}</h1>
						</td>
					</tr>
					<tr>
						<td style="padding:36px;font-size:15px;line-height:1.65;color:#000000;">
							${bodyHtml}
						</td>
					</tr>
					<tr>
						<td style="background-color:#f5f5f5;padding:24px 36px;border-top:2px solid #000000;text-align:center;font-size:12px;line-height:1.6;color:#666666;">
							<p style="margin:0;font-weight:600;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:11px;letter-spacing:0.5px;">Century NIT Consult</p>
							<p style="margin:4px 0 0 0;color:#999999;">Accra, Ghana &bull; London, UK &bull; support@centurynit.com</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>`;
}
