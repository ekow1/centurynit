import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { eq, sql, and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
	marketingCampaigns,
	mailingLists,
	mailingListContacts,
	emailTemplate,
	leads,
} from "../db/schema.js";
import { requireAuth, requireStaff, type AuthVariables } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { sendEmail } from "../lib/resend.js";
import { env } from "../env.js";
import { NEWSLETTER_LIST_NAME, sendConfirmationEmail } from "./newsletter.js";

/* ── Schemas ─────────────────────────────────────────────────────────────── */

const campaignSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	type: z.string(),
	status: z.string(),
	channel: z.string(),
	audience: z.string().nullable(),
	subject: z.string().nullable(),
	body: z.string(),
	templateId: z.string().uuid().nullable(),
	mailingListId: z.string().uuid().nullable(),
	sentBy: z.string().nullable(),
	sentAt: z.string().nullable(),
	recipientCount: z.number(),
	deliveredCount: z.number(),
	failedCount: z.number(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const mailingListSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	contactCount: z.number(),
	pendingCount: z.number(),
	confirmedCount: z.number(),
	unsubscribedCount: z.number(),
	isNewsletter: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const contactStatusSchema = z.enum(["pending", "confirmed", "unsubscribed"]);

const mailingListContactSchema = z.object({
	id: z.string().uuid(),
	mailingListId: z.string().uuid(),
	name: z.string().nullable(),
	email: z.string(),
	status: contactStatusSchema,
	confirmedAt: z.string().nullable(),
	unsubscribedAt: z.string().nullable(),
	createdAt: z.string(),
});

const templateSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	type: z.string(),
	subject: z.string().nullable(),
	header: z.string().nullable(),
	body: z.string(),
	footer: z.string().nullable(),
	isCustom: z.boolean(),
	createdBy: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const idParams = z.object({
	id: z.string().uuid(),
});

type ContactStatus = z.infer<typeof contactStatusSchema>;

function serializeContact(r: typeof mailingListContacts.$inferSelect) {
	return {
		id: r.id,
		mailingListId: r.mailingListId,
		name: r.name,
		email: r.email,
		status: r.status as ContactStatus,
		confirmedAt: r.confirmedAt?.toISOString() ?? null,
		unsubscribedAt: r.unsubscribedAt?.toISOString() ?? null,
		createdAt: r.createdAt.toISOString(),
	};
}

const campaignIdParams = z.object({
	id: z.string().uuid(),
});

const contactIdParams = z.object({
	id: z.string().uuid(),
	contactId: z.string().uuid(),
});

const createCampaignBodySchema = z.object({
	name: z.string().min(1, "Name is required"),
	type: z.string().min(1, "Type is required"),
	channel: z.string().optional().default("email"),
	audience: z.string().optional().nullable(),
	subject: z.string().optional().nullable(),
	body: z.string().min(1, "Body is required"),
	templateId: z.string().uuid().optional().nullable(),
	mailingListId: z.string().uuid().optional().nullable(),
});

const createMailingListBodySchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional().nullable(),
});

const updateMailingListBodySchema = z.object({
	name: z.string().min(1).optional(),
	description: z.string().optional().nullable(),
});

const addContactBodySchema = z.object({
	name: z.string().optional().nullable(),
	email: z.string().email("Valid email required"),
});

const createTemplateBodySchema = z.object({
	name: z.string().min(1, "Name is required"),
	type: z.string().optional().default("email"),
	subject: z.string().optional().nullable(),
	header: z.string().optional().nullable(),
	body: z.string().min(1, "Body is required"),
	footer: z.string().optional().nullable(),
});

const updateTemplateBodySchema = z.object({
	name: z.string().min(1).optional(),
	type: z.string().optional(),
	subject: z.string().optional().nullable(),
	header: z.string().optional().nullable(),
	body: z.string().min(1).optional(),
	footer: z.string().optional().nullable(),
});

/* ── Email layout helper ─────────────────────────────────────────────────── */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function emailLayout({
	title,
	bodyHtml,
	footerNote,
}: {
	title: string;
	bodyHtml: string;
	footerNote?: string;
}): string {
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
						<td style="background-color:#000000;padding:28px 36px;text-align:left;border-bottom:4px solid #000000;">
							<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
								<tr>
									<td>
										<div style="display:inline-block;padding:3px 8px;border:1px solid #ffffff;margin-bottom:8px;">
											<span style="color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">Century NIT</span>
										</div>
										<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;line-height:1.3;font-family:Georgia,'Times New Roman',Times,serif;">
											${escapeHtml(title)}
										</h1>
									</td>
								</tr>
							</table>
						</td>
					</tr>
					<tr>
						<td style="padding:36px 36px 28px 36px;font-size:15px;line-height:1.65;color:#000000;">
							${bodyHtml}
						</td>
					</tr>
					<tr>
						<td style="background-color:#f5f5f5;padding:24px 36px;border-top:2px solid #000000;text-align:center;font-size:12px;line-height:1.6;color:#666666;">
							${footerNote ? `<p style="margin:0 0 8px 0;color:#999999;">${footerNote}</p>` : ""}
							<p style="margin:0;font-weight:600;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:11px;letter-spacing:0.5px;">
								Century NIT Consult
							</p>
							<p style="margin:4px 0 0 0;color:#999999;">
								Accra, Ghana &bull; London, UK &bull; support@centurynit.com
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>`;
}

/* ── Router ──────────────────────────────────────────────────────────────── */

export const marketingRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ══════════════════════════════════════════════════════════════════════════
 * Campaigns
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── GET /campaigns ──────────────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "get",
		path: "/campaigns",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ campaigns: z.array(campaignSchema) }),
					},
				},
				description: "List of marketing campaigns",
			},
		},
	}),
	async (c) => {
		try {
			const rows = await db
				.select()
				.from(marketingCampaigns)
				.orderBy(sql`${marketingCampaigns.createdAt} desc`);

			const campaigns = rows.map((r) => ({
				...r,
				sentAt: r.sentAt?.toISOString() ?? null,
				createdAt: r.createdAt.toISOString(),
				updatedAt: r.updatedAt.toISOString(),
			}));

			return c.json({ campaigns });
		} catch (err) {
			console.error("[marketing] GET /campaigns error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to list campaigns");
		}
	},
);

/* ── POST /campaigns ─────────────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/campaigns",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			body: {
				content: { "application/json": { schema: createCampaignBodySchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: {
					"application/json": {
						schema: z.object({ campaign: campaignSchema }),
					},
				},
				description: "Campaign created",
			},
		},
	}),
	async (c) => {
		try {
			const body = c.req.valid("json");
			const staff = c.get("staff");

			const [inserted] = await db
				.insert(marketingCampaigns)
				.values({
					name: body.name,
					type: body.type,
					channel: body.channel,
					audience: body.audience ?? null,
					subject: body.subject ?? null,
					body: body.body,
					templateId: body.templateId ?? null,
					mailingListId: body.mailingListId ?? null,
					sentBy: staff?.opsUserId ?? null,
				})
				.returning();

			const campaign = {
				...inserted,
				sentAt: inserted.sentAt?.toISOString() ?? null,
				createdAt: inserted.createdAt.toISOString(),
				updatedAt: inserted.updatedAt.toISOString(),
			};

			return c.json({ campaign }, 201);
		} catch (err) {
			console.error("[marketing] POST /campaigns error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to create campaign");
		}
	},
);

/* ── POST /campaigns/:id/send ────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/campaigns/{id}/send",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: campaignIdParams,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							campaign: campaignSchema,
							delivered: z.number(),
							failed: z.number(),
						}),
					},
				},
				description: "Campaign sent",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");
			const staff = c.get("staff");

			const [campaign] = await db
				.select()
				.from(marketingCampaigns)
				.where(eq(marketingCampaigns.id, id))
				.limit(1);

			if (!campaign) {
				throw new HttpError(404, "NOT_FOUND", "Campaign not found");
			}

			if (campaign.status === "sent") {
				throw new HttpError(400, "ALREADY_SENT", "Campaign has already been sent");
			}

			if (!campaign.mailingListId) {
				throw new HttpError(
					400,
					"NO_MAILING_LIST",
					" Campaign has no mailing list assigned",
				);
			}

			if (!campaign.subject) {
				throw new HttpError(400, "NO_SUBJECT", "Campaign has no subject line");
			}

			const contacts = await db
				.select()
				.from(mailingListContacts)
				.where(
					and(
						eq(mailingListContacts.mailingListId, campaign.mailingListId),
						eq(mailingListContacts.status, "confirmed"),
					),
				);

			if (contacts.length === 0) {
				throw new HttpError(400, "EMPTY_LIST", "Mailing list has no confirmed subscribers");
			}

			let delivered = 0;
			let failed = 0;

			for (const contact of contacts) {
				const contactName = contact.name ?? "there";
				const personalizedSubject = campaign.subject
					.replace(/\{\{name\}\}/g, contactName)
					.replace(/\{\{Name\}\}/g, contactName);
				const personalizedBody = campaign.body
					.replace(/\{\{name\}\}/g, contactName)
					.replace(/\{\{Name\}\}/g, contactName);

				const unsubscribeUrl = contact.confirmToken
					? `${env.FRONTEND_URL}/newsletter/unsubscribe?token=${contact.confirmToken}`
					: null;
				const footerNote = unsubscribeUrl
					? `You're receiving this because you subscribed to Century NIT updates. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#000000;text-decoration:underline;">Unsubscribe</a>.`
					: undefined;

				const html = emailLayout({
					title: personalizedSubject,
					bodyHtml: personalizedBody,
					footerNote,
				});

				try {
					await sendEmail({
						to: contact.email,
						subject: personalizedSubject,
						html,
					});
					delivered++;
				} catch (err) {
					console.error(`[marketing] Failed to send to ${contact.email}:`, err);
					failed++;
				}
			}

			const [updated] = await db
				.update(marketingCampaigns)
				.set({
					status: "sent",
					sentAt: new Date(),
					sentBy: staff?.opsUserId ?? null,
					recipientCount: contacts.length,
					deliveredCount: delivered,
					failedCount: failed,
					updatedAt: new Date(),
				})
				.where(eq(marketingCampaigns.id, id))
				.returning();

			const result = {
				...updated,
				sentAt: updated.sentAt?.toISOString() ?? null,
				createdAt: updated.createdAt.toISOString(),
				updatedAt: updated.updatedAt.toISOString(),
			};

			return c.json({ campaign: result, delivered, failed });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] POST /campaigns/:id/send error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to send campaign");
		}
	},
);

/* ══════════════════════════════════════════════════════════════════════════
 * Mailing Lists
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── GET /mailing-lists ──────────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "get",
		path: "/mailing-lists",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ mailingLists: z.array(mailingListSchema) }),
					},
				},
				description: "List of mailing lists with contact counts",
			},
		},
	}),
	async (c) => {
		try {
			const countsSubquery = db
				.select({
					mailingListId: mailingListContacts.mailingListId,
					contactCount: sql<number>`count(*)::int`.as("contact_count"),
					pendingCount: sql<number>`count(*) filter (where ${mailingListContacts.status} = 'pending')::int`.as("pending_count"),
					confirmedCount: sql<number>`count(*) filter (where ${mailingListContacts.status} = 'confirmed')::int`.as("confirmed_count"),
					unsubscribedCount: sql<number>`count(*) filter (where ${mailingListContacts.status} = 'unsubscribed')::int`.as("unsubscribed_count"),
				})
				.from(mailingListContacts)
				.groupBy(mailingListContacts.mailingListId)
				.as("contact_counts");

			const rows = await db
				.select({
					id: mailingLists.id,
					name: mailingLists.name,
					description: mailingLists.description,
					contactCount: sql<number>`coalesce(${countsSubquery.contactCount}, 0)`,
					pendingCount: sql<number>`coalesce(${countsSubquery.pendingCount}, 0)`,
					confirmedCount: sql<number>`coalesce(${countsSubquery.confirmedCount}, 0)`,
					unsubscribedCount: sql<number>`coalesce(${countsSubquery.unsubscribedCount}, 0)`,
					createdAt: mailingLists.createdAt,
					updatedAt: mailingLists.updatedAt,
				})
				.from(mailingLists)
				.leftJoin(countsSubquery, eq(mailingLists.id, countsSubquery.mailingListId))
				.orderBy(sql`${mailingLists.createdAt} desc`);

			const mailingListsResult = rows.map((r) => ({
				...r,
				isNewsletter: r.name === NEWSLETTER_LIST_NAME,
				createdAt: r.createdAt.toISOString(),
				updatedAt: r.updatedAt.toISOString(),
			}));

			return c.json({ mailingLists: mailingListsResult });
		} catch (err) {
			console.error("[marketing] GET /mailing-lists error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to list mailing lists");
		}
	},
);

/* ── POST /mailing-lists ─────────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/mailing-lists",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			body: {
				content: {
					"application/json": { schema: createMailingListBodySchema },
				},
				required: true,
			},
		},
		responses: {
			201: {
				content: {
					"application/json": {
						schema: z.object({ mailingList: mailingListSchema }),
					},
				},
				description: "Mailing list created",
			},
		},
	}),
	async (c) => {
		try {
			const body = c.req.valid("json");

			const [inserted] = await db
				.insert(mailingLists)
				.values({
					name: body.name,
					description: body.description ?? null,
				})
				.returning();

		const mailingList = {
			...inserted,
			contactCount: 0,
			pendingCount: 0,
			confirmedCount: 0,
			unsubscribedCount: 0,
			isNewsletter: inserted.name === NEWSLETTER_LIST_NAME,
			createdAt: inserted.createdAt.toISOString(),
			updatedAt: inserted.updatedAt.toISOString(),
		};

		return c.json({ mailingList }, 201);
		} catch (err) {
			console.error("[marketing] POST /mailing-lists error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to create mailing list");
		}
	},
);

/* ── PUT /mailing-lists/:id ──────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "put",
		path: "/mailing-lists/{id}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": { schema: updateMailingListBodySchema },
				},
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ mailingList: mailingListSchema }),
					},
				},
				description: "Mailing list updated",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");

		const [existing] = await db
			.select()
			.from(mailingLists)
			.where(eq(mailingLists.id, id))
			.limit(1);

		if (!existing) {
			throw new HttpError(404, "NOT_FOUND", "Mailing list not found");
		}

		if (existing.name === NEWSLETTER_LIST_NAME && body.name !== undefined && body.name !== NEWSLETTER_LIST_NAME) {
			throw new HttpError(
				400,
				"NEWSLETTER_LIST_PROTECTED",
				"The Website Newsletter list cannot be renamed",
			);
		}

		const updateData: Record<string, unknown> = { updatedAt: new Date() };
		if (body.name !== undefined) updateData.name = body.name;
		if (body.description !== undefined) updateData.description = body.description;

		const [updated] = await db
			.update(mailingLists)
			.set(updateData)
			.where(eq(mailingLists.id, id))
			.returning();

		const [counts] = await db
			.select({
				contactCount: sql<number>`count(*)::int`,
				pendingCount: sql<number>`count(*) filter (where ${mailingListContacts.status} = 'pending')::int`,
				confirmedCount: sql<number>`count(*) filter (where ${mailingListContacts.status} = 'confirmed')::int`,
				unsubscribedCount: sql<number>`count(*) filter (where ${mailingListContacts.status} = 'unsubscribed')::int`,
			})
			.from(mailingListContacts)
			.where(eq(mailingListContacts.mailingListId, id));

		const mailingList = {
			...updated,
			contactCount: counts?.contactCount ?? 0,
			pendingCount: counts?.pendingCount ?? 0,
			confirmedCount: counts?.confirmedCount ?? 0,
			unsubscribedCount: counts?.unsubscribedCount ?? 0,
			isNewsletter: updated.name === NEWSLETTER_LIST_NAME,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
		};

		return c.json({ mailingList });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] PUT /mailing-lists/:id error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to update mailing list");
		}
	},
);

/* ── DELETE /mailing-lists/:id ───────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "delete",
		path: "/mailing-lists/{id}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: idParams,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ success: z.boolean() }),
					},
				},
				description: "Mailing list deleted",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");

		const [existing] = await db
			.select()
			.from(mailingLists)
			.where(eq(mailingLists.id, id))
			.limit(1);

		if (!existing) {
			throw new HttpError(404, "NOT_FOUND", "Mailing list not found");
		}

		if (existing.name === NEWSLETTER_LIST_NAME) {
			throw new HttpError(
				400,
				"NEWSLETTER_LIST_PROTECTED",
				"The Website Newsletter list cannot be deleted (it powers public subscriptions)",
			);
		}

		await db
			.delete(mailingListContacts)
			.where(eq(mailingListContacts.mailingListId, id));

		await db.delete(mailingLists).where(eq(mailingLists.id, id));

		return c.json({ success: true });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] DELETE /mailing-lists/:id error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to delete mailing list");
		}
	},
);

/* ── POST /mailing-lists/:id/contacts ────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/mailing-lists/{id}/contacts",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": { schema: addContactBodySchema },
				},
				required: true,
			},
		},
		responses: {
			201: {
				content: {
					"application/json": {
						schema: z.object({ contact: mailingListContactSchema }),
					},
				},
				description: "Contact added",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			const normalizedEmail = body.email.trim().toLowerCase();

			const [existing] = await db
				.select()
				.from(mailingLists)
				.where(eq(mailingLists.id, id))
				.limit(1);

			if (!existing) {
				throw new HttpError(404, "NOT_FOUND", "Mailing list not found");
			}

			const [dupe] = await db
				.select()
				.from(mailingListContacts)
				.where(
					and(
						eq(mailingListContacts.mailingListId, id),
						eq(mailingListContacts.email, normalizedEmail),
					),
				)
				.limit(1);

			if (dupe) {
				// Re-subscribe an unsubscribed contact instead of 409 — staff are
				// explicitly opting them back in. Confirmed/pending rows stay as-is.
				if (dupe.status === "unsubscribed") {
					const token = randomUUID();
					const [updated] = await db
						.update(mailingListContacts)
						.set({
							status: "confirmed",
							confirmToken: token,
							confirmedAt: new Date(),
							unsubscribedAt: null,
							name: body.name ?? dupe.name,
						})
						.where(eq(mailingListContacts.id, dupe.id))
						.returning();

					return c.json({ contact: serializeContact(updated) }, 201);
				}

				throw new HttpError(
					409,
					"DUPLICATE",
					"Contact with this email already exists in the list",
				);
			}

			// Staff-added contacts start confirmed (sendable immediately) and get a
			// confirmToken so campaign emails can include an unsubscribe link.
			const token = randomUUID();
			const [inserted] = await db
				.insert(mailingListContacts)
				.values({
					mailingListId: id,
					name: body.name ?? null,
					email: normalizedEmail,
					status: "confirmed",
					confirmToken: token,
					confirmedAt: new Date(),
				})
				.returning();

			return c.json({ contact: serializeContact(inserted) }, 201);
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] POST /mailing-lists/:id/contacts error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to add contact");
		}
	},
);

/* ── DELETE /mailing-lists/:id/contacts/:contactId ───────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "delete",
		path: "/mailing-lists/{id}/contacts/{contactId}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: contactIdParams,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ success: z.boolean() }),
					},
				},
				description: "Contact removed",
			},
		},
	}),
	async (c) => {
		try {
			const { id, contactId } = c.req.valid("param");

			const [existing] = await db
				.select()
				.from(mailingListContacts)
				.where(
					and(
						eq(mailingListContacts.id, contactId),
						eq(mailingListContacts.mailingListId, id),
					),
				)
				.limit(1);

			if (!existing) {
				throw new HttpError(404, "NOT_FOUND", "Contact not found in this list");
			}

			await db.delete(mailingListContacts).where(eq(mailingListContacts.id, contactId));

			return c.json({ success: true });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error(
				"[marketing] DELETE /mailing-lists/:id/contacts/:contactId error:",
				err,
			);
			throw new HttpError(500, "INTERNAL", "Failed to remove contact");
		}
	},
);

/* ── GET /mailing-lists/:id/contacts ─────────────────────────────────────── */

const listContactsQuery = z.object({
	status: contactStatusSchema.optional(),
	q: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(500).optional().default(100),
	offset: z.coerce.number().int().min(0).optional().default(0),
});

marketingRouter.openapi(
	createRoute({
		method: "get",
		path: "/mailing-lists/{id}/contacts",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: idParams,
			query: listContactsQuery,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							contacts: z.array(mailingListContactSchema),
							total: z.number(),
						}),
					},
				},
				description: "Contacts in the mailing list",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");
			const { status, q, limit, offset } = c.req.valid("query");

			const [list] = await db
				.select({ id: mailingLists.id })
				.from(mailingLists)
				.where(eq(mailingLists.id, id))
				.limit(1);

			if (!list) {
				throw new HttpError(404, "NOT_FOUND", "Mailing list not found");
			}

			const conditions = [eq(mailingListContacts.mailingListId, id)];
			if (status) conditions.push(eq(mailingListContacts.status, status));
			if (q) {
				const like = `%${q.toLowerCase()}%`;
				conditions.push(
					sql`(lower(${mailingListContacts.email}) like ${like} or lower(coalesce(${mailingListContacts.name}, '')) like ${like})`,
				);
			}

			const where = and(...conditions);

			const [countRow] = await db
				.select({ total: sql<number>`count(*)::int` })
				.from(mailingListContacts)
				.where(where);

			const rows = await db
				.select()
				.from(mailingListContacts)
				.where(where)
				.orderBy(sql`${mailingListContacts.createdAt} desc`)
				.limit(limit)
				.offset(offset);

			const contacts = rows.map(serializeContact);

			return c.json({ contacts, total: countRow?.total ?? 0 });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] GET /mailing-lists/:id/contacts error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to list contacts");
		}
	},
);

/* ── POST /mailing-lists/:id/contacts/:contactId/confirm ─────────────────── */
/* Manually confirm a pending contact or re-subscribe an unsubscribed one.   */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/mailing-lists/{id}/contacts/{contactId}/confirm",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { params: contactIdParams },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ contact: mailingListContactSchema }),
					},
				},
				description: "Contact confirmed",
			},
		},
	}),
	async (c) => {
		try {
			const { id, contactId } = c.req.valid("param");

			const [existing] = await db
				.select()
				.from(mailingListContacts)
				.where(
					and(
						eq(mailingListContacts.id, contactId),
						eq(mailingListContacts.mailingListId, id),
					),
				)
				.limit(1);

			if (!existing) {
				throw new HttpError(404, "NOT_FOUND", "Contact not found in this list");
			}

			if (existing.status === "confirmed") {
				throw new HttpError(400, "ALREADY_CONFIRMED", "Contact is already confirmed");
			}

			const token = existing.confirmToken ?? randomUUID();
			const [updated] = await db
				.update(mailingListContacts)
				.set({
					status: "confirmed",
					confirmToken: token,
					confirmedAt: new Date(),
					unsubscribedAt: null,
				})
				.where(eq(mailingListContacts.id, contactId))
				.returning();

			return c.json({ contact: serializeContact(updated) });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] POST .../contacts/:contactId/confirm error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to confirm contact");
		}
	},
);

/* ── POST /mailing-lists/:id/contacts/:contactId/resend-confirmation ──────── */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/mailing-lists/{id}/contacts/{contactId}/resend-confirmation",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { params: contactIdParams },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ ok: z.boolean() }),
					},
				},
				description: "Confirmation email re-sent",
			},
		},
	}),
	async (c) => {
		try {
			const { id, contactId } = c.req.valid("param");

			const [existing] = await db
				.select()
				.from(mailingListContacts)
				.where(
					and(
						eq(mailingListContacts.id, contactId),
						eq(mailingListContacts.mailingListId, id),
					),
				)
				.limit(1);

			if (!existing) {
				throw new HttpError(404, "NOT_FOUND", "Contact not found in this list");
			}

			if (existing.status !== "pending") {
				throw new HttpError(
					400,
					"NOT_PENDING",
					"Only pending contacts can be sent a confirmation email",
				);
			}

			const token = randomUUID();
			await db
				.update(mailingListContacts)
				.set({ confirmToken: token, confirmedAt: null })
				.where(eq(mailingListContacts.id, contactId));

			const confirmUrl = `${env.FRONTEND_URL}/newsletter/confirm?token=${token}`;
			void sendConfirmationEmail(existing.email, confirmUrl).catch((err) => {
				console.error(`[marketing] resend confirmation to ${existing.email} failed:`, err);
			});

			return c.json({ ok: true });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] POST .../resend-confirmation error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to resend confirmation");
		}
	},
);

/* ── POST /mailing-lists/:id/contacts/:contactId/unsubscribe ──────────────── */
/* Staff-initiated unsubscribe (e.g. recipient asked via phone/email).        */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/mailing-lists/{id}/contacts/{contactId}/unsubscribe",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { params: contactIdParams },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ contact: mailingListContactSchema }),
					},
				},
				description: "Contact unsubscribed",
			},
		},
	}),
	async (c) => {
		try {
			const { id, contactId } = c.req.valid("param");

			const [existing] = await db
				.select()
				.from(mailingListContacts)
				.where(
					and(
						eq(mailingListContacts.id, contactId),
						eq(mailingListContacts.mailingListId, id),
					),
				)
				.limit(1);

			if (!existing) {
				throw new HttpError(404, "NOT_FOUND", "Contact not found in this list");
			}

			if (existing.status === "unsubscribed") {
				throw new HttpError(400, "ALREADY_UNSUBSCRIBED", "Contact is already unsubscribed");
			}

			const [updated] = await db
				.update(mailingListContacts)
				.set({
					status: "unsubscribed",
					unsubscribedAt: new Date(),
				})
				.where(eq(mailingListContacts.id, contactId))
				.returning();

			return c.json({ contact: serializeContact(updated) });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] POST .../unsubscribe error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to unsubscribe contact");
		}
	},
);

/* ── POST /mailing-lists/:id/import-leads ────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/mailing-lists/{id}/import-leads",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: idParams,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							imported: z.number(),
							skipped: z.number(),
						}),
					},
				},
				description: "Leads imported into mailing list",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");

			const [list] = await db
				.select()
				.from(mailingLists)
				.where(eq(mailingLists.id, id))
				.limit(1);

			if (!list) {
				throw new HttpError(404, "NOT_FOUND", "Mailing list not found");
			}

		const allLeads = await db
			.select({ email: leads.email, name: leads.name })
			.from(leads);

		const existingContacts = await db
			.select({ email: mailingListContacts.email })
			.from(mailingListContacts)
			.where(eq(mailingListContacts.mailingListId, id));

		const existingEmails = new Set(existingContacts.map((c) => c.email.toLowerCase()));

		let imported = 0;
		let skipped = 0;

		for (const lead of allLeads) {
			const normalizedEmail = lead.email.trim().toLowerCase();
			if (existingEmails.has(normalizedEmail)) {
				skipped++;
				continue;
			}

			await db.insert(mailingListContacts).values({
				mailingListId: id,
				name: lead.name,
				email: normalizedEmail,
				status: "confirmed",
				confirmToken: randomUUID(),
				confirmedAt: new Date(),
			});
			existingEmails.add(normalizedEmail);
			imported++;
		}

		return c.json({ imported, skipped });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] POST /mailing-lists/:id/import-leads error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to import leads");
		}
	},
);

/* ── POST /mailing-lists/:id/import-applicants ───────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/mailing-lists/{id}/import-applicants",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: idParams,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							imported: z.number(),
							skipped: z.number(),
						}),
					},
				},
				description: "Applicants imported into mailing list",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");

			const [list] = await db
				.select()
				.from(mailingLists)
				.where(eq(mailingLists.id, id))
				.limit(1);

			if (!list) {
				throw new HttpError(404, "NOT_FOUND", "Mailing list not found");
			}

		const applicants = await db
			.select({ email: leads.email, name: leads.name })
			.from(leads)
			.where(
				inArray(leads.stage, ["Assessment Complete", "Enrolled"]),
			);

		const existingContacts = await db
			.select({ email: mailingListContacts.email })
			.from(mailingListContacts)
			.where(eq(mailingListContacts.mailingListId, id));

		const existingEmails = new Set(existingContacts.map((c) => c.email.toLowerCase()));

		let imported = 0;
		let skipped = 0;

		for (const lead of applicants) {
			const normalizedEmail = lead.email.trim().toLowerCase();
			if (existingEmails.has(normalizedEmail)) {
				skipped++;
				continue;
			}

			await db.insert(mailingListContacts).values({
				mailingListId: id,
				name: lead.name,
				email: normalizedEmail,
				status: "confirmed",
				confirmToken: randomUUID(),
				confirmedAt: new Date(),
			});
			existingEmails.add(normalizedEmail);
			imported++;
		}

		return c.json({ imported, skipped });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error(
				"[marketing] POST /mailing-lists/:id/import-applicants error:",
				err,
			);
			throw new HttpError(500, "INTERNAL", "Failed to import applicants");
		}
	},
);

/* ══════════════════════════════════════════════════════════════════════════
 * Email Templates
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── GET /templates ──────────────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "get",
		path: "/templates",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ templates: z.array(templateSchema) }),
					},
				},
				description: "List of email templates",
			},
		},
	}),
	async (c) => {
		try {
			const rows = await db
				.select()
				.from(emailTemplate)
				.orderBy(sql`${emailTemplate.createdAt} desc`);

			const templates = rows.map((r) => ({
				...r,
				createdAt: r.createdAt.toISOString(),
				updatedAt: r.updatedAt.toISOString(),
			}));

			return c.json({ templates });
		} catch (err) {
			console.error("[marketing] GET /templates error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to list templates");
		}
	},
);

/* ── POST /templates ─────────────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "post",
		path: "/templates",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			body: {
				content: {
					"application/json": { schema: createTemplateBodySchema },
				},
				required: true,
			},
		},
		responses: {
			201: {
				content: {
					"application/json": {
						schema: z.object({ template: templateSchema }),
					},
				},
				description: "Template created",
			},
		},
	}),
	async (c) => {
		try {
			const body = c.req.valid("json");
			const staff = c.get("staff");

			const [inserted] = await db
				.insert(emailTemplate)
				.values({
					name: body.name,
					type: body.type,
					subject: body.subject ?? null,
					header: body.header ?? null,
					body: body.body,
					footer: body.footer ?? null,
					isCustom: true,
					createdBy: staff?.opsUserId ?? null,
				})
				.returning();

			const template = {
				...inserted,
				createdAt: inserted.createdAt.toISOString(),
				updatedAt: inserted.updatedAt.toISOString(),
			};

			return c.json({ template }, 201);
		} catch (err) {
			console.error("[marketing] POST /templates error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to create template");
		}
	},
);

/* ── PUT /templates/:id ──────────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "put",
		path: "/templates/{id}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: idParams,
			body: {
				content: {
					"application/json": { schema: updateTemplateBodySchema },
				},
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ template: templateSchema }),
					},
				},
				description: "Template updated",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");

			const [existing] = await db
				.select()
				.from(emailTemplate)
				.where(eq(emailTemplate.id, id))
				.limit(1);

			if (!existing) {
				throw new HttpError(404, "NOT_FOUND", "Template not found");
			}

			const updateData: Record<string, unknown> = { updatedAt: new Date() };
			if (body.name !== undefined) updateData.name = body.name;
			if (body.type !== undefined) updateData.type = body.type;
			if (body.subject !== undefined) updateData.subject = body.subject;
			if (body.header !== undefined) updateData.header = body.header;
			if (body.body !== undefined) updateData.body = body.body;
			if (body.footer !== undefined) updateData.footer = body.footer;

			const [updated] = await db
				.update(emailTemplate)
				.set(updateData)
				.where(eq(emailTemplate.id, id))
				.returning();

			const template = {
				...updated,
				createdAt: updated.createdAt.toISOString(),
				updatedAt: updated.updatedAt.toISOString(),
			};

			return c.json({ template });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] PUT /templates/:id error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to update template");
		}
	},
);

/* ── DELETE /templates/:id ───────────────────────────────────────────────── */

marketingRouter.openapi(
	createRoute({
		method: "delete",
		path: "/templates/{id}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: idParams,
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ success: z.boolean() }),
					},
				},
				description: "Template deleted",
			},
		},
	}),
	async (c) => {
		try {
			const { id } = c.req.valid("param");

			const [existing] = await db
				.select()
				.from(emailTemplate)
				.where(eq(emailTemplate.id, id))
				.limit(1);

			if (!existing) {
				throw new HttpError(404, "NOT_FOUND", "Template not found");
			}

			if (!existing.isCustom) {
				throw new HttpError(
					400,
					"NOT_CUSTOM",
					"Only custom templates can be deleted",
				);
			}

			await db.delete(emailTemplate).where(eq(emailTemplate.id, id));

			return c.json({ success: true });
		} catch (err) {
			if (err instanceof HttpError) throw err;
			console.error("[marketing] DELETE /templates/:id error:", err);
			throw new HttpError(500, "INTERNAL", "Failed to delete template");
		}
	},
);
