import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { cmsBrand, cmsEntries, cmsNav, cmsVersions, copyKeys, media } from "../db/schema.js";
import { brandSchema, DEFAULT_BRAND, type Brand, type NavItem } from "century-nit-shared";
import { HOME_COPY, PAGE_COPY, company } from "century-nit-core";
import { recordAdminEvent } from "./audit.js";

/**
 * CMS — one identity + one content store + one media library.
 *
 * Brand is a singleton with draft + published side by side; every save and
 * publish snapshots into cms_versions so history and revert work the same for
 * entries and nav. Public readers never see a draft: /brand.json and
 * /content/* serve published rows only.
 */

type Editor = { id?: string | null; email?: string | null };

async function snapshot(
	entity: string,
	entityKey: string,
	payload: unknown,
	editor?: Editor,
	note?: string,
): Promise<void> {
	const [latest] = await db
		.select({ v: cmsVersions.version })
		.from(cmsVersions)
		.where(and(eq(cmsVersions.entity, entity), eq(cmsVersions.entityKey, entityKey)))
		.orderBy(desc(cmsVersions.version))
		.limit(1);
	await db.insert(cmsVersions).values({
		entity,
		entityKey,
		version: (latest?.v ?? 0) + 1,
		payload: payload as Record<string, unknown>,
		editorId: editor?.id ?? null,
		editorEmail: editor?.email ?? null,
		note: note ?? null,
	});
}

/* ── Brand ───────────────────────────────────────────────────────────────── */

export async function getBrand(): Promise<Brand> {
	const [row] = await db.select().from(cmsBrand).where(eq(cmsBrand.id, "brand")).limit(1);
	if (!row) return DEFAULT_BRAND;
	const parsed = brandSchema.safeParse(row.published);
	return parsed.success ? parsed.data : DEFAULT_BRAND;
}

export async function getBrandForEdit(): Promise<{ draft: Brand; published: Brand; version: number; publishedAt: string | null }> {
	const [row] = await db.select().from(cmsBrand).where(eq(cmsBrand.id, "brand")).limit(1);
	const published = row ? brandSchema.safeParse(row.published) : null;
	const pub = published?.success ? published.data : DEFAULT_BRAND;
	const draft = row?.draft ? brandSchema.safeParse(row.draft) : null;
	return {
		draft: draft?.success ? draft.data : pub,
		published: pub,
		version: row?.publishedVersion ?? 1,
		publishedAt: row?.publishedAt?.toISOString() ?? null,
	};
}

export async function saveBrandDraft(payload: Brand, editor: Editor): Promise<void> {
	await db
		.insert(cmsBrand)
		.values({ id: "brand", draft: payload, published: payload, updatedBy: editor.email ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: cmsBrand.id,
			set: { draft: payload, updatedBy: editor.email ?? null, updatedAt: new Date() },
		});
	await snapshot("brand", "brand", payload, editor, "draft saved");
}

export async function publishBrand(editor: Editor, ip?: string | null): Promise<Brand> {
	const [row] = await db.select().from(cmsBrand).where(eq(cmsBrand.id, "brand")).limit(1);
	const payload = (row?.draft ?? row?.published) as Brand;
	await db
		.update(cmsBrand)
		.set({
			published: payload,
			draft: payload,
			publishedVersion: (row?.publishedVersion ?? 0) + 1,
			publishedAt: new Date(),
			publishedBy: editor.email ?? null,
			updatedAt: new Date(),
			updatedBy: editor.email ?? null,
		})
		.where(eq(cmsBrand.id, "brand"));
	await snapshot("brand", "brand", payload, editor, `published v${(row?.publishedVersion ?? 0) + 1}`);
	await recordAdminEvent({
		category: "Configuration",
		action: "Published brand identity",
		actorId: editor.id,
		actorEmail: editor.email,
		target: "brand",
		targetType: "setting",
		severity: "warn",
		detail: `names.brand → ${payload.names.brand} · domain ${payload.domain}`,
		ip,
	});
	brandCache = { brand: payload, at: Date.now() };
	return payload;
}

export async function brandHistory(limit = 20) {
	return db
		.select()
		.from(cmsVersions)
		.where(and(eq(cmsVersions.entity, "brand"), eq(cmsVersions.entityKey, "brand")))
		.orderBy(desc(cmsVersions.version))
		.limit(limit);
}

/**
 * The email-layout reader: cached for 60s so a notification burst doesn't
 * hit the DB per send, and never throws — a broken lookup just renders the
 * previous (or default) brand.
 */
let brandCache: { brand: Brand; at: number } | null = null;
export async function getBrandCached(): Promise<Brand> {
	if (brandCache && Date.now() - brandCache.at < 60_000) return brandCache.brand;
	try {
		const brand = await getBrand();
		brandCache = { brand, at: Date.now() };
		return brand;
	} catch {
		return brandCache?.brand ?? DEFAULT_BRAND;
	}
}

/* ── Entries ─────────────────────────────────────────────────────────────── */

export async function listEntries(collection?: string, includeDrafts = true) {
	const rows = await db
		.select()
		.from(cmsEntries)
		.where(
			and(
				collection ? eq(cmsEntries.collection, collection) : undefined,
				includeDrafts ? undefined : eq(cmsEntries.status, "published"),
			),
		)
		.orderBy(desc(cmsEntries.updatedAt));
	return rows;
}

export async function getEntry(collection: string, slug: string, publishedOnly = false) {
	const [row] = await db
		.select()
		.from(cmsEntries)
		.where(
			and(
				eq(cmsEntries.collection, collection),
				eq(cmsEntries.slug, slug),
				publishedOnly ? eq(cmsEntries.status, "published") : undefined,
			),
		)
		.limit(1);
	return row ?? null;
}

export async function upsertEntry(input: {
	id?: string;
	collection: string;
	slug: string;
	payload: Record<string, unknown>;
	seo?: Record<string, unknown> | null;
	scheduledAt?: string | null;
}, editor: Editor) {
	const now = new Date();
	if (input.id) {
		const [row] = await db
			.update(cmsEntries)
			.set({
				payload: input.payload,
				seo: input.seo ?? null,
				scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
				updatedAt: now,
				updatedBy: editor.email ?? null,
			})
			.where(eq(cmsEntries.id, input.id))
			.returning();
		await snapshot("entry", `${input.collection}:${input.slug}`, input.payload, editor, "saved");
		return row;
	}
	const [row] = await db
		.insert(cmsEntries)
		.values({
			collection: input.collection,
			slug: input.slug,
			payload: input.payload,
			seo: input.seo ?? null,
			scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
			updatedBy: editor.email ?? null,
		})
		.returning();
	await snapshot("entry", `${input.collection}:${input.slug}`, input.payload, editor, "created");
	return row;
}

export async function setEntryStatus(id: string, status: "draft" | "review" | "published", editor: Editor) {
	const [row] = await db
		.update(cmsEntries)
		.set({
			status,
			publishedAt: status === "published" ? new Date() : undefined,
			publishedBy: status === "published" ? (editor.email ?? null) : undefined,
			updatedAt: new Date(),
			updatedBy: editor.email ?? null,
		})
		.where(eq(cmsEntries.id, id))
		.returning();
	if (row) await snapshot("entry", `${row.collection}:${row.slug}`, row.payload, editor, `→ ${status}`);
	return row ?? null;
}

export async function entryHistory(collection: string, slug: string, limit = 20) {
	return db
		.select()
		.from(cmsVersions)
		.where(and(eq(cmsVersions.entity, "entry"), eq(cmsVersions.entityKey, `${collection}:${slug}`)))
		.orderBy(desc(cmsVersions.version))
		.limit(limit);
}

export async function revertEntry(id: string, versionId: string, editor: Editor) {
	const [entry] = await db.select().from(cmsEntries).where(eq(cmsEntries.id, id)).limit(1);
	const [ver] = await db.select().from(cmsVersions).where(eq(cmsVersions.id, versionId)).limit(1);
	if (!entry || !ver) return null;
	const [row] = await db
		.update(cmsEntries)
		.set({ payload: ver.payload as Record<string, unknown>, status: "draft", updatedAt: new Date(), updatedBy: editor.email ?? null })
		.where(eq(cmsEntries.id, id))
		.returning();
	await snapshot("entry", `${entry.collection}:${entry.slug}`, ver.payload, editor, `reverted to v${ver.version}`);
	return row;
}

/** Scheduled entries due to go live — called by the publish sweep. */
/**
 * Seed published pages/* entries from the compiled copy in century-nit-core.
 * Inserts only missing (collection, slug) pairs — existing entries are never
 * touched, so re-running after staff edits is safe. The live site merges the
 * entry over the same compiled source, so a seeded row renders identically
 * until someone edits it.
 */
export async function seedCompiledContent(editor: Editor): Promise<{ created: number; skipped: number }> {
	const seeds: { collection: string; slug: string; payload: Record<string, unknown>; seo: Record<string, unknown> }[] = [
		{
			collection: "pages",
			slug: "home",
			payload: { ...HOME_COPY } as Record<string, unknown>,
			seo: {
				title: `Study abroad consultants in Ghana | ${company.brandName}`,
				description: "Admission, visa & travel support for Ghanaian students — UK, Canada, Germany, USA. Accra & Kumasi offices.",
			},
		},
		...Object.entries(PAGE_COPY).map(([slug, c]) => ({
			collection: "pages",
			slug,
			payload: { eyebrow: c.eyebrow, title: c.title, lead: c.lead },
			seo: {
				title: `${c.title} | ${company.brandName}`,
				description: c.lead.slice(0, 155),
			},
		})),
	];

	const now = new Date();
	let created = 0;
	let skipped = 0;
	for (const s of seeds) {
		const [existing] = await db
			.select({ id: cmsEntries.id })
			.from(cmsEntries)
			.where(and(eq(cmsEntries.collection, s.collection), eq(cmsEntries.slug, s.slug)))
			.limit(1);
		if (existing) {
			skipped += 1;
			continue;
		}
		await db.insert(cmsEntries).values({
			collection: s.collection,
			slug: s.slug,
			status: "published",
			payload: s.payload,
			seo: s.seo,
			publishedAt: now,
			publishedBy: editor.email ?? null,
			updatedBy: editor.email ?? null,
		});
		await snapshot("entry", `${s.collection}:${s.slug}`, s.payload, editor, "seeded from compiled copy");
		created += 1;
	}
	return { created, skipped };
}

export async function publishDueEntries(): Promise<number> {
	const rows = await db
		.update(cmsEntries)
		.set({ status: "published", publishedAt: new Date() })
		.where(
			and(
				eq(cmsEntries.status, "review"),
				isNotNull(cmsEntries.scheduledAt),
				lte(cmsEntries.scheduledAt, new Date()),
			),
		)
		.returning({ id: cmsEntries.id });
	return rows.length;
}

/* ── Media ───────────────────────────────────────────────────────────────── */

export async function listMedia() {
	return db.select().from(media).orderBy(desc(media.createdAt));
}

export async function registerMedia(input: {
	key: string;
	fileName: string;
	mime: string;
	sizeBytes?: number;
	width?: number;
	height?: number;
	alt?: string;
}, editor: Editor) {
	const [row] = await db
		.insert(media)
		.values({ ...input, alt: input.alt ?? "", uploadedBy: editor.email ?? null })
		.onConflictDoUpdate({ target: media.key, set: { fileName: input.fileName, mime: input.mime } })
		.returning();
	return row;
}

export async function updateMedia(id: string, patch: { alt?: string; focalX?: number; focalY?: number }) {
	const [row] = await db.update(media).set(patch).where(eq(media.id, id)).returning();
	return row ?? null;
}

/**
 * Authorization for the public /media/{key} redirect: a storage key is only
 * publicly readable once it exists as a media row. This is what stops the
 * endpoint from becoming an open proxy into the private document bucket.
 */
export async function mediaPublicKey(key: string) {
	const [row] = await db
		.select({ id: media.id, key: media.key })
		.from(media)
		.where(eq(media.key, key))
		.limit(1);
	return row ?? null;
}

/* ── Navigation ──────────────────────────────────────────────────────────── */

export async function getNav(surface: "header" | "footer"): Promise<NavItem[]> {
	const [row] = await db.select().from(cmsNav).where(eq(cmsNav.surface, surface)).limit(1);
	return (row?.items as NavItem[]) ?? [];
}

export async function putNav(surface: "header" | "footer", items: NavItem[], editor: Editor) {
	await db
		.insert(cmsNav)
		.values({ surface, items, updatedBy: editor.email ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({ target: cmsNav.surface, set: { items, updatedBy: editor.email ?? null, updatedAt: new Date() } });
	await snapshot("nav", surface, items, editor, "nav saved");
}

/* ── Copy keys ───────────────────────────────────────────────────────────── */

export async function listCopy(surface?: string) {
	return db
		.select()
		.from(copyKeys)
		.where(surface ? eq(copyKeys.surface, surface) : undefined)
		.orderBy(copyKeys.key);
}

export async function putCopy(input: { key: string; value: string; surface: string; status?: string }, editor: Editor) {
	await db
		.insert(copyKeys)
		.values({ ...input, status: input.status ?? "published", updatedBy: editor.email ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: copyKeys.key,
			set: { value: input.value, surface: input.surface, status: input.status ?? "published", updatedBy: editor.email ?? null, updatedAt: new Date() },
		});
	await snapshot("copy", input.key, { value: input.value, surface: input.surface }, editor, "copy saved");
}

/** Public copy lookup — published keys only, for the site/portal to read. */
export async function getPublishedCopy(surface?: string) {
	const rows = await db
		.select({ key: copyKeys.key, value: copyKeys.value })
		.from(copyKeys)
		.where(and(eq(copyKeys.status, "published"), surface ? eq(copyKeys.surface, surface) : undefined));
	return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
