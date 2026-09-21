import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	campaignLinks,
	campaignRecipients,
	leads,
	mailingListContacts,
	mailingLists,
	marketingAutomations,
	marketingCampaigns,
	marketingOptins,
	marketingSegments,
	marketingSuppressions,
	automationSends,
} from "../db/schema.js";
import { requireAuth, requireStaff, type AuthVariables } from "../middleware/auth.js";
import { HttpError, validationHook } from "../middleware/error.js";
import { env } from "../env.js";
import {
	consentStatesFor,
	evaluateSegment,
	recordOptIn,
	removeOptIn,
	suppressEmail,
	unsuppressEmail,
} from "../services/marketing.js";
import { sendConfirmationEmail } from "./newsletter.js";

/**
 * Marketing audience surfaces — mounted at /api/v1/marketing alongside
 * marketing.ts. Everything here is staff-only: segments, the person-level
 * contact model, the suppression list, campaign reports, and automations.
 */

export const marketingAudienceRouter = new OpenAPIHono<{ Variables: AuthVariables }>({
	defaultHook: validationHook,
});

const norm = (e: string) => e.trim().toLowerCase();

/* ══════════════════════════════════════════════════════════════════════════
 * Segments
 * ══════════════════════════════════════════════════════════════════════════ */

const filterSchema = z.object({ field: z.string(), op: z.string(), value: z.unknown() });

const segmentSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	entity: z.string(),
	filters: z.array(filterSchema),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const segmentBody = z.object({
	name: z.string().min(1),
	entity: z.enum(["applicants", "leads", "contacts"]),
	filters: z.array(filterSchema),
});

const serializeSegment = (r: typeof marketingSegments.$inferSelect) => ({
	id: r.id,
	name: r.name,
	entity: r.entity,
	filters: r.filters,
	createdAt: r.createdAt.toISOString(),
	updatedAt: r.updatedAt.toISOString(),
});

/* ── GET /segments ───────────────────────────────────────────────────────── */

marketingAudienceRouter.openapi(
	createRoute({
		method: "get",
		path: "/segments",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ segments: z.array(segmentSchema) }) } },
				description: "Saved segments",
			},
		},
	}),
	async (c) => {
		const rows = await db.select().from(marketingSegments).orderBy(desc(marketingSegments.updatedAt));
		return c.json({ segments: rows.map(serializeSegment) });
	},
);

/* ── POST /segments/preview — live count + consent breakdown ─────────────── */

marketingAudienceRouter.openapi(
	createRoute({
		method: "post",
		path: "/segments/preview",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({ entity: z.enum(["applicants", "leads", "contacts"]), filters: z.array(filterSchema) }),
					},
				},
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							matched: z.number(),
							optedIn: z.number(),
							neverAsked: z.number(),
							suppressed: z.number(),
							sample: z.array(z.object({ email: z.string(), name: z.string().nullable(), state: z.string() })),
						}),
					},
				},
				description: "Live segment estimate",
			},
		},
	}),
	async (c) => {
		const { entity, filters } = c.req.valid("json");
		const rows = await evaluateSegment({ entity, filters });
		const consent = await consentStatesFor(rows.map((r) => r.email));
		let optedIn = 0;
		let neverAsked = 0;
		let suppressed = 0;
		for (const r of rows) {
			const s = consent.get(norm(r.email)) ?? "never_asked";
			if (s === "opted_in") optedIn++;
			else if (s === "never_asked") neverAsked++;
			else suppressed++;
		}
		return c.json({
			matched: rows.length,
			optedIn,
			neverAsked,
			suppressed,
			sample: rows.slice(0, 8).map((r) => ({ email: r.email, name: r.name, state: consent.get(norm(r.email)) ?? "never_asked" })),
		});
	},
);

/* ── POST /segments ──────────────────────────────────────────────────────── */

marketingAudienceRouter.openapi(
	createRoute({
		method: "post",
		path: "/segments",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { body: { content: { "application/json": { schema: segmentBody } }, required: true } },
		responses: {
			201: {
				content: { "application/json": { schema: z.object({ segment: segmentSchema }) } },
				description: "Segment created",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const staff = c.get("staff");
		const [row] = await db
			.insert(marketingSegments)
			.values({ name: body.name, entity: body.entity, filters: body.filters, createdBy: staff?.opsUserId ?? null })
			.returning();
		return c.json({ segment: serializeSegment(row) }, 201);
	},
);

/* ── PUT /segments/:id ───────────────────────────────────────────────────── */

marketingAudienceRouter.openapi(
	createRoute({
		method: "put",
		path: "/segments/{id}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
			body: { content: { "application/json": { schema: segmentBody.partial() } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ segment: segmentSchema }) } },
				description: "Segment updated",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const [row] = await db
			.update(marketingSegments)
			.set({ ...body, updatedAt: new Date() })
			.where(eq(marketingSegments.id, id))
			.returning();
		if (!row) throw new HttpError(404, "NOT_FOUND", "Segment not found");
		return c.json({ segment: serializeSegment(row) });
	},
);

/* ── DELETE /segments/:id ────────────────────────────────────────────────── */

marketingAudienceRouter.openapi(
	createRoute({
		method: "delete",
		path: "/segments/{id}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Deleted" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		await db.delete(marketingSegments).where(eq(marketingSegments.id, id));
		return c.json({ ok: true });
	},
);

/* ══════════════════════════════════════════════════════════════════════════
 * Contacts — the person, not the list row
 * ══════════════════════════════════════════════════════════════════════════ */

const personSchema = z.object({
	email: z.string(),
	name: z.string().nullable(),
	identity: z.string(), // applicant | lead | contact
	caseRef: z.string().nullable(),
	chapter: z.string().nullable(),
	branch: z.string().nullable(),
	consent: z.string(),
	consentSource: z.string().nullable(),
	lists: z.array(z.string()),
	lastEngagement: z.string().nullable(),
	rowCount: z.number(),
});

/** Resolve the people behind a set of addresses: suite identity + lists. */
async function peopleFor(emails: string[]): Promise<Map<string, {
	email: string;
	name: string | null;
	identity: string;
	caseRef: string | null;
	chapter: string | null;
	branch: string | null;
	lists: string[];
	lastEngagement: string | null;
	rowCount: number;
	consentSource: string | null;
}>> {
	const out = new Map<string, {
		email: string; name: string | null; identity: string; caseRef: string | null;
		chapter: string | null; branch: string | null; lists: string[];
		lastEngagement: string | null; rowCount: number; consentSource: string | null;
	}>();
	if (emails.length === 0) return out;
	const normed = [...new Set(emails.map(norm))];

	const contacts = await db
		.select({ email: mailingListContacts.email, name: mailingListContacts.name, list: mailingLists.name, source: mailingListContacts.consentSource })
		.from(mailingListContacts)
		.innerJoin(mailingLists, eq(mailingListContacts.mailingListId, mailingLists.id))
		.where(inArray(sql`lower(${mailingListContacts.email})`, normed));
	for (const r of contacts) {
		const key = norm(r.email);
		const p = out.get(key) ?? { email: key, name: r.name, identity: "contact", caseRef: null, chapter: null, branch: null, lists: [], lastEngagement: null, rowCount: 0, consentSource: r.source };
		p.rowCount++;
		if (!p.lists.includes(r.list)) p.lists.push(r.list);
		if (!p.name && r.name) p.name = r.name;
		if (r.source) p.consentSource = r.source;
		out.set(key, p);
	}

	const appRows = await db
		.selectDistinctOn([sql`lower(${applicants.email})`], {
			email: applicants.email, name: applicants.name, appNumber: applications.appNumber,
			stage: applications.stage, branch: applications.branch,
		})
		.from(applicants)
		.innerJoin(applications, eq(applications.applicantId, applicants.id))
		.where(inArray(sql`lower(${applicants.email})`, normed))
		.orderBy(sql`lower(${applicants.email})`, desc(applications.createdAt));
	for (const r of appRows) {
		const key = norm(r.email);
		const p = out.get(key) ?? { email: key, name: r.name, identity: "applicant", caseRef: null, chapter: null, branch: null, lists: [], lastEngagement: null, rowCount: 0, consentSource: null };
		p.identity = "applicant";
		p.caseRef = r.appNumber;
		p.chapter = r.stage;
		p.branch = r.branch;
		p.name = p.name ?? r.name;
		out.set(key, p);
	}

	const leadRows = await db
		.select({ email: leads.email, name: leads.name, stage: leads.stage })
		.from(leads)
		.where(inArray(sql`lower(${leads.email})`, normed));
	for (const r of leadRows) {
		const key = norm(r.email);
		const p = out.get(key);
		if (!p) {
			out.set(key, { email: key, name: r.name, identity: "lead", caseRef: null, chapter: r.stage, branch: null, lists: [], lastEngagement: null, rowCount: 0, consentSource: null });
		} else if (p.identity !== "applicant") {
			p.identity = "lead";
			p.chapter = p.chapter ?? r.stage;
		}
	}

	const engagement = await db
		.select({ email: campaignRecipients.email, last: sql<string>`max(greatest(coalesce(${campaignRecipients.clickedAt}, '-infinity'), coalesce(${campaignRecipients.openedAt}, '-infinity'), coalesce(${campaignRecipients.sentAt}, '-infinity')))` })
		.from(campaignRecipients)
		.where(inArray(sql`lower(${campaignRecipients.email})`, normed))
		.groupBy(sql`lower(${campaignRecipients.email})`);
	for (const r of engagement) {
		const p = out.get(norm(r.email));
		if (p) p.lastEngagement = r.last;
	}

	return out;
}

/* ── GET /contacts — person list with consent + identity filters ─────────── */

marketingAudienceRouter.openapi(
	createRoute({
		method: "get",
		path: "/contacts",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			query: z.object({
				q: z.string().optional(),
				consent: z.enum(["opted_in", "never_asked", "unsubscribed", "suppressed"]).optional(),
				duplicates: z.coerce.boolean().optional(),
				limit: z.coerce.number().int().min(1).max(500).optional().default(100),
				offset: z.coerce.number().int().min(0).optional().default(0),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ contacts: z.array(personSchema), total: z.number(), breakdown: z.record(z.number()) }) } },
				description: "Person-level contact list",
			},
		},
	}),
	async (c) => {
		const { q, consent, duplicates, limit, offset } = c.req.valid("query");

		// The union of every address the suite knows: list contacts + applicants + leads.
		const contactEmails = db.select({ email: sql<string>`lower(${mailingListContacts.email})`, name: mailingListContacts.name }).from(mailingListContacts);
		const applicantEmails = db.select({ email: sql<string>`lower(${applicants.email})`, name: applicants.name }).from(applicants);
		const leadEmails = db.select({ email: sql<string>`lower(${leads.email})`, name: leads.name }).from(leads);
		const all = await contactEmails.union(applicantEmails).union(leadEmails);

		let filtered = all.map((r) => ({ email: norm(r.email), name: r.name }));
		if (q) {
			const needle = q.toLowerCase();
			filtered = filtered.filter((r) => r.email.includes(needle) || (r.name ?? "").toLowerCase().includes(needle));
		}
		const dedup = new Map<string, { email: string; name: string | null }>();
		for (const r of filtered) if (!dedup.has(r.email)) dedup.set(r.email, r);
		const people = [...dedup.values()];

		const consentMap = await consentStatesFor(people.map((p) => p.email));
		const breakdown: Record<string, number> = { opted_in: 0, never_asked: 0, unsubscribed: 0, suppressed: 0 };
		for (const p of people) breakdown[consentMap.get(p.email) ?? "never_asked"]++;

		const identities = await peopleFor(people.map((p) => p.email));

		let list = people.map((p) => {
			const id = identities.get(p.email);
			return {
				email: p.email,
				name: id?.name ?? p.name,
				identity: id?.identity ?? "contact",
				caseRef: id?.caseRef ?? null,
				chapter: id?.chapter ?? null,
				branch: id?.branch ?? null,
				consent: consentMap.get(p.email) ?? "never_asked",
				consentSource: id?.consentSource ?? null,
				lists: id?.lists ?? [],
				lastEngagement: id?.lastEngagement ?? null,
				rowCount: id?.rowCount ?? 0,
			};
		});
		if (consent) list = list.filter((p) => p.consent === consent);
		if (duplicates) list = list.filter((p) => p.rowCount > 1);

		return c.json({ contacts: list.slice(offset, offset + limit), total: list.length, breakdown });
	},
);

/* ── GET /contacts/:email — the person page ──────────────────────────────── */

marketingAudienceRouter.openapi(
	createRoute({
		method: "get",
		path: "/contacts/{email}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { params: z.object({ email: z.string() }) },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							person: personSchema,
							campaigns: z.array(z.object({
								campaignId: z.string().uuid(), name: z.string(), status: z.string(),
								sentAt: z.string().nullable(), openedAt: z.string().nullable(),
								clickedAt: z.string().nullable(), bouncedAt: z.string().nullable(),
							})),
							suppression: z.object({ reason: z.string(), detail: z.string().nullable(), createdAt: z.string() }).nullable(),
							optin: z.object({ source: z.string(), note: z.string().nullable(), createdAt: z.string() }).nullable(),
						}),
					},
				},
				description: "Contact detail and history",
			},
		},
	}),
	async (c) => {
		const { email } = c.req.valid("param");
		const key = norm(decodeURIComponent(email));
		const identities = await peopleFor([key]);
		const person = identities.get(key);
		if (!person) throw new HttpError(404, "NOT_FOUND", "No contact with that address");

		const consent = (await consentStatesFor([key])).get(key) ?? "never_asked";
		const campaigns = await db
			.select({
				campaignId: marketingCampaigns.id, name: marketingCampaigns.name,
				status: campaignRecipients.status, sentAt: campaignRecipients.sentAt,
				openedAt: campaignRecipients.openedAt, clickedAt: campaignRecipients.clickedAt,
				bouncedAt: campaignRecipients.bouncedAt,
			})
			.from(campaignRecipients)
			.innerJoin(marketingCampaigns, eq(campaignRecipients.campaignId, marketingCampaigns.id))
			.where(sql`lower(${campaignRecipients.email}) = ${key}`)
			.orderBy(desc(campaignRecipients.createdAt));

		const [suppression] = await db.select().from(marketingSuppressions).where(eq(marketingSuppressions.email, key)).limit(1);
		const [optin] = await db.select().from(marketingOptins).where(eq(marketingOptins.email, key)).limit(1);

		return c.json({
			person: { ...person, consent, consentSource: person.consentSource },
			campaigns: campaigns.map((r) => ({
				campaignId: r.campaignId, name: r.name, status: r.status,
				sentAt: r.sentAt?.toISOString() ?? null, openedAt: r.openedAt?.toISOString() ?? null,
				clickedAt: r.clickedAt?.toISOString() ?? null, bouncedAt: r.bouncedAt?.toISOString() ?? null,
			})),
			suppression: suppression ? { reason: suppression.reason, detail: suppression.detail, createdAt: suppression.createdAt.toISOString() } : null,
			optin: optin ? { source: optin.source, note: optin.note, createdAt: optin.createdAt.toISOString() } : null,
		});
	},
);

/* ── POST /contacts — add contact with an honest consent door ────────────── */

const addContactBody = z.object({
	name: z.string().optional().nullable(),
	email: z.string().email(),
	listIds: z.array(z.string().uuid()).optional().default([]),
	consent: z.discriminatedUnion("method", [
		z.object({ method: z.literal("confirm_email") }),
		z.object({ method: z.literal("offline"), note: z.string().min(5, "An audit note is required for offline consent") }),
	]),
});

marketingAudienceRouter.openapi(
	createRoute({
		method: "post",
		path: "/contacts",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { body: { content: { "application/json": { schema: addContactBody } }, required: true } },
		responses: {
			201: {
				content: { "application/json": { schema: z.object({ email: z.string(), outcome: z.string(), existing: z.boolean() }) } },
				description: "Contact added (or membership added to the existing person)",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const email = norm(body.email);
		const staff = c.get("staff");

		const existing = await db
			.select({ id: mailingListContacts.id })
			.from(mailingListContacts)
			.where(sql`lower(${mailingListContacts.email}) = ${email}`)
			.limit(1);

		for (const listId of body.listIds) {
			await db
				.insert(mailingListContacts)
				.values({
					mailingListId: listId,
					email,
					name: body.name ?? null,
					status: body.consent.method === "offline" ? "confirmed" : "pending",
					confirmedAt: body.consent.method === "offline" ? new Date() : null,
					consentSource: body.consent.method === "offline" ? "offline_note" : "confirm_link",
					consentNote: body.consent.method === "offline" ? `${body.consent.note} · logged by ${staff?.name ?? "staff"}` : null,
				})
				.onConflictDoNothing();
		}

		if (body.consent.method === "offline") {
			await recordOptIn(email, "offline_note", `${body.consent.note} · logged by ${staff?.name ?? "staff"}`);
		} else {
			// The confirm email carries the person's token — mint one on whichever
			// row exists so the link resolves even before a list row landed.
			let [contact] = await db
				.select({ id: mailingListContacts.id, confirmToken: mailingListContacts.confirmToken })
				.from(mailingListContacts)
				.where(sql`lower(${mailingListContacts.email}) = ${email}`)
				.limit(1);
			if (!contact && body.listIds.length === 0) {
				// Added to no list — the person still needs a row to confirm against.
				const [newsletter] = await db.select({ id: mailingLists.id }).from(mailingLists).where(eq(mailingLists.name, "Website Newsletter")).limit(1);
				if (newsletter) {
					[contact] = await db
						.insert(mailingListContacts)
						.values({ mailingListId: newsletter.id, email, name: body.name ?? null, status: "pending", consentSource: "confirm_link" })
						.onConflictDoNothing()
						.returning({ id: mailingListContacts.id, confirmToken: mailingListContacts.confirmToken });
					contact ??= (await db.select({ id: mailingListContacts.id, confirmToken: mailingListContacts.confirmToken }).from(mailingListContacts).where(sql`lower(${mailingListContacts.email}) = ${email}`).limit(1))[0];
				}
			}
			if (contact) {
				const token = contact.confirmToken ?? randomUUID();
				if (!contact.confirmToken) {
					await db.update(mailingListContacts).set({ confirmToken: token }).where(eq(mailingListContacts.id, contact.id));
				}
				await sendConfirmationEmail(email, `${env.FRONTEND_URL}/newsletter/confirm?token=${token}`);
			}
		}

		return c.json({ email, outcome: body.consent.method === "offline" ? "opted_in" : "pending", existing: existing.length > 0 }, 201);
	},
);

/* ── POST /contacts/import — CSV rows through the same consent door ──────── */

marketingAudienceRouter.openapi(
	createRoute({
		method: "post",
		path: "/contacts/import",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							listId: z.string().uuid(),
							rows: z.array(z.object({ email: z.string(), name: z.string().optional().nullable() })),
							consent: z.discriminatedUnion("method", [
								z.object({ method: z.literal("confirm_email") }),
								z.object({ method: z.literal("offline"), note: z.string().min(5) }),
							]),
						}),
					},
				},
				required: true,
			},
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ added: z.number(), duplicates: z.number(), invalid: z.number() }),
					},
				},
				description: "Import report",
			},
		},
	}),
	async (c) => {
		const { listId, rows, consent } = c.req.valid("json");
		const staff = c.get("staff");
		const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

		const existing = new Set(
			(await db.select({ email: mailingListContacts.email }).from(mailingListContacts).where(eq(mailingListContacts.mailingListId, listId)))
				.map((r) => norm(r.email)),
		);
		let added = 0;
		let duplicates = 0;
		let invalid = 0;
		for (const row of rows) {
			const email = norm(row.email ?? "");
			if (!emailRe.test(email)) { invalid++; continue; }
			if (existing.has(email)) { duplicates++; continue; }
			await db.insert(mailingListContacts).values({
				mailingListId: listId, email, name: row.name ?? null,
				status: consent.method === "offline" ? "confirmed" : "pending",
				confirmedAt: consent.method === "offline" ? new Date() : null,
				consentSource: consent.method === "offline" ? "offline_note" : "confirm_link",
				consentNote: consent.method === "offline" ? `${consent.note} · imported by ${staff?.name ?? "staff"}` : null,
			}).onConflictDoNothing();
			existing.add(email);
			added++;
			if (consent.method === "offline") await recordOptIn(email, "offline_note", `${consent.note} · imported by ${staff?.name ?? "staff"}`);
		}
		return c.json({ added, duplicates, invalid });
	},
);

/* ── GET /contacts-export — CSV of the person list ───────────────────────── */

marketingAudienceRouter.get("/contacts-export", requireAuth, requireStaff, async (c) => {
	const all = await peopleFor(
		(await db.select({ email: mailingListContacts.email }).from(mailingListContacts)).map((r) => r.email),
	);
	const consent = await consentStatesFor([...all.keys()]);
	const lines = ["email,name,identity,case_ref,chapter,consent,lists"];
	for (const [email, p] of all) {
		const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
		lines.push([email, esc(p.name), p.identity, p.caseRef ?? "", p.chapter ?? "", consent.get(email) ?? "never_asked", esc(p.lists.join("; "))].join(","));
	}
	c.header("Content-Type", "text/csv");
	c.header("Content-Disposition", `attachment; filename="contacts.csv"`);
	return c.body(lines.join("\n"));
});

/* ══════════════════════════════════════════════════════════════════════════
 * Suppression list
 * ══════════════════════════════════════════════════════════════════════════ */

marketingAudienceRouter.openapi(
	createRoute({
		method: "get",
		path: "/suppressions",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							suppressions: z.array(z.object({ email: z.string(), reason: z.string(), detail: z.string().nullable(), createdAt: z.string() })),
						}),
					},
				},
				description: "Suppressed addresses",
			},
		},
	}),
	async (c) => {
		const rows = await db.select().from(marketingSuppressions).orderBy(desc(marketingSuppressions.createdAt)).limit(500);
		return c.json({ suppressions: rows.map((r) => ({ email: r.email, reason: r.reason, detail: r.detail, createdAt: r.createdAt.toISOString() })) });
	},
);

marketingAudienceRouter.openapi(
	createRoute({
		method: "post",
		path: "/suppressions",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			body: {
				content: { "application/json": { schema: z.object({ email: z.string().email(), detail: z.string().optional() }) } },
				required: true,
			},
		},
		responses: {
			200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Suppressed" },
		},
	}),
	async (c) => {
		const { email, detail } = c.req.valid("json");
		await suppressEmail(email, "manual", detail);
		await removeOptIn(email);
		return c.json({ ok: true });
	},
);

marketingAudienceRouter.openapi(
	createRoute({
		method: "delete",
		path: "/suppressions/{email}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { params: z.object({ email: z.string() }) },
		responses: {
			200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Unsuppressed" },
		},
	}),
	async (c) => {
		await unsuppressEmail(decodeURIComponent(c.req.valid("param").email));
		return c.json({ ok: true });
	},
);

/* ══════════════════════════════════════════════════════════════════════════
 * Campaign report — rates, top links, engagement timeline
 * ══════════════════════════════════════════════════════════════════════════ */

marketingAudienceRouter.openapi(
	createRoute({
		method: "get",
		path: "/campaigns/{id}/report",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { params: z.object({ id: z.string().uuid() }) },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							totals: z.object({
								recipients: z.number(), sent: z.number(), failed: z.number(), skipped: z.number(),
								pending: z.number(), opened: z.number(), clicked: z.number(), bounced: z.number(),
							}),
							topLinks: z.array(z.object({ url: z.string(), clicks: z.number() })),
							timeline: z.array(z.object({ hour: z.string(), sent: z.number(), opened: z.number(), clicked: z.number() })),
						}),
					},
				},
				description: "Campaign engagement report",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const [totals] = await db
			.select({
				recipients: sql<number>`count(*)::int`,
				sent: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'sent')::int`,
				failed: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'failed')::int`,
				skipped: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'skipped')::int`,
				pending: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'pending')::int`,
				opened: sql<number>`count(${campaignRecipients.openedAt})::int`,
				clicked: sql<number>`count(${campaignRecipients.clickedAt})::int`,
				bounced: sql<number>`count(${campaignRecipients.bouncedAt})::int`,
			})
			.from(campaignRecipients)
			.where(eq(campaignRecipients.campaignId, id));

		const topLinks = await db
			.select({ url: campaignLinks.url, clicks: campaignLinks.clicks })
			.from(campaignLinks)
			.where(eq(campaignLinks.campaignId, id))
			.orderBy(desc(campaignLinks.clicks))
			.limit(10);

		const timeline = await db
			.select({
				hour: sql<string>`date_trunc('hour', coalesce(${campaignRecipients.sentAt}, ${campaignRecipients.createdAt}))::text`,
				sent: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'sent')::int`,
				opened: sql<number>`count(${campaignRecipients.openedAt})::int`,
				clicked: sql<number>`count(${campaignRecipients.clickedAt})::int`,
			})
			.from(campaignRecipients)
			.where(eq(campaignRecipients.campaignId, id))
			.groupBy(sql`date_trunc('hour', coalesce(${campaignRecipients.sentAt}, ${campaignRecipients.createdAt}))`)
			.orderBy(sql`1`);

		return c.json({ totals, topLinks, timeline });
	},
);

/* ══════════════════════════════════════════════════════════════════════════
 * Automations
 * ══════════════════════════════════════════════════════════════════════════ */

const automationSchema = z.object({
	id: z.string().uuid(), name: z.string(), event: z.string(),
	segmentId: z.string().uuid().nullable(), templateId: z.string().uuid().nullable(),
	subject: z.string().nullable(), delayMinutes: z.number(), status: z.string(),
	sends: z.number(), sentCount: z.number(),
	createdAt: z.string(), updatedAt: z.string(),
});

const automationBody = z.object({
	name: z.string().min(1),
	event: z.string().min(1),
	segmentId: z.string().uuid().optional().nullable(),
	templateId: z.string().uuid().optional().nullable(),
	subject: z.string().optional().nullable(),
	body: z.string().optional().nullable(),
	delayMinutes: z.number().int().min(0).optional().default(0),
	status: z.enum(["draft", "live", "paused"]).optional().default("draft"),
});

const serializeAutomation = async (r: typeof marketingAutomations.$inferSelect) => {
	const [agg] = await db
		.select({ sends: sql<number>`count(*)::int`, sent: sql<number>`count(*) filter (where ${automationSends.status} = 'sent')::int` })
		.from(automationSends)
		.where(eq(automationSends.automationId, r.id));
	return {
		id: r.id, name: r.name, event: r.event, segmentId: r.segmentId, templateId: r.templateId,
		subject: r.subject, delayMinutes: r.delayMinutes, status: r.status,
		sends: agg.sends, sentCount: agg.sent,
		createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
	};
};

marketingAudienceRouter.openapi(
	createRoute({
		method: "get",
		path: "/automations",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: { content: { "application/json": { schema: z.object({ automations: z.array(automationSchema) }) } }, description: "Automations" },
		},
	}),
	async (c) => {
		const rows = await db.select().from(marketingAutomations).orderBy(desc(marketingAutomations.updatedAt));
		return c.json({ automations: await Promise.all(rows.map(serializeAutomation)) });
	},
);

marketingAudienceRouter.openapi(
	createRoute({
		method: "post",
		path: "/automations",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: { body: { content: { "application/json": { schema: automationBody } }, required: true } },
		responses: {
			201: { content: { "application/json": { schema: z.object({ automation: automationSchema }) } }, description: "Created" },
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const staff = c.get("staff");
		const [row] = await db
			.insert(marketingAutomations)
			.values({ ...body, createdBy: staff?.opsUserId ?? null })
			.returning();
		return c.json({ automation: await serializeAutomation(row) }, 201);
	},
);

marketingAudienceRouter.openapi(
	createRoute({
		method: "put",
		path: "/automations/{id}",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
			body: { content: { "application/json": { schema: automationBody.partial() } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: z.object({ automation: automationSchema }) } }, description: "Updated" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const [row] = await db.update(marketingAutomations).set({ ...body, updatedAt: new Date() }).where(eq(marketingAutomations.id, id)).returning();
		if (!row) throw new HttpError(404, "NOT_FOUND", "Automation not found");
		return c.json({ automation: await serializeAutomation(row) });
	},
);

marketingAudienceRouter.openapi(
	createRoute({
		method: "get",
		path: "/automations/{id}/sends",
		tags: ["Marketing"],
		middleware: [requireAuth, requireStaff] as const,
		request: {
			params: z.object({ id: z.string().uuid() }),
			query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional().default(100) }),
		},
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({
							sends: z.array(z.object({
								email: z.string(), name: z.string().nullable(), status: z.string(),
								scheduledFor: z.string(), sentAt: z.string().nullable(), error: z.string().nullable(),
							})),
						}),
					},
				},
				description: "Automation send log",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const { limit } = c.req.valid("query");
		const rows = await db
			.select()
			.from(automationSends)
			.where(eq(automationSends.automationId, id))
			.orderBy(desc(automationSends.createdAt))
			.limit(limit);
		return c.json({
			sends: rows.map((r) => ({
				email: r.email, name: r.name, status: r.status,
				scheduledFor: r.scheduledFor.toISOString(), sentAt: r.sentAt?.toISOString() ?? null, error: r.error,
			})),
		});
	},
);
