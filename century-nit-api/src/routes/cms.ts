import { Hono } from "hono";
import { z } from "zod";
import { brandSchema, CMS_COLLECTIONS, navItemSchema, type Brand } from "century-nit-shared";
import { requireAuth, requireModule, requireStaff } from "../middleware/auth.js";
import {
	brandHistory,
	entryHistory,
	getBrand,
	getBrandForEdit,
	getEntry,
	getNav,
	getPublishedCopy,
	listCopy,
	listEntries,
	listMedia,
	publishBrand,
	putCopy,
	putNav,
	registerMedia,
	revertEntry,
	seedCompiledContent,
	saveBrandDraft,
	setEntryStatus,
	updateMedia,
	upsertEntry,
} from "../services/cms.js";
import { requestIp } from "../services/audit.js";
import { getDocumentStorage } from "../services/storage/index.js";
import { mediaPublicKey } from "../services/cms.js";
import type { AuthVariables } from "../middleware/auth.js";

/**
 * CMS — public reads + staff writes.
 *
 * Public (site / portal / console chrome / edge cache):
 *   GET /brand.json                 — the published identity record
 *   GET /content/{collection}       — published entries
 *   GET /content/{collection}/{slug} — one published entry
 *   GET /nav/{surface}              — header | footer link list
 *   GET /copy?surface=              — published copy keys
 *
 * Admin (ops module "cms"):
 *   GET  /cms/brand                 — draft + published + version
 *   PUT  /cms/brand                 — save draft
 *   POST /cms/brand/publish         — publish draft (audited, versioned)
 *   POST /cms/brand/revert          — draft := published
 *   GET  /cms/brand/history
 *   GET/POST/PUT /cms/entries…      — collections CRUD + status + revert + history
 *   GET/POST/PATCH /cms/media…      — library
 *   GET/PUT /cms/nav/{surface}
 *   GET/PUT /cms/copy…
 */
export const cmsRouter = new Hono<{ Variables: AuthVariables }>();
export const contentRouter = new Hono();

/*
 * requireAuth populates c.get("staff") — without it every requireStaff below
 * saw null and denied even a valid admin session with STAFF_ACCESS_REQUIRED,
 * which the console reads as a foreign session and signs out. Sibling routers
 * list it per-route; a router-level use() covers all nineteen at once and
 * can't be dropped when a route is added. contentRouter stays public.
 */
cmsRouter.use(requireAuth);

function editor(c: { get: (k: "staff") => { opsUserId?: string; userId?: string; email?: string } | undefined }) {
	const s = c.get("staff");
	return { id: s?.opsUserId ?? s?.userId ?? null, email: s?.email ?? null };
}

/* ══ Public reads ══════════════════════════════════════════════════════════ */

contentRouter.get("/brand.json", async (c) => {
	const brand = await getBrand();
	c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
	return c.json({ brand });
});

contentRouter.get("/content/:collection", async (c) => {
	const collection = c.req.param("collection");
	if (!CMS_COLLECTIONS.includes(collection as never)) return c.json({ error: "unknown collection" }, 404);
	const rows = await listEntries(collection, false);
	c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
	return c.json({ entries: rows });
});

contentRouter.get("/content/:collection/:slug", async (c) => {
	const row = await getEntry(c.req.param("collection"), c.req.param("slug"), true);
	if (!row) return c.json({ error: "not found" }, 404);
	c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
	return c.json({ entry: row });
});

contentRouter.get("/nav/:surface", async (c) => {
	const surface = c.req.param("surface");
	if (surface !== "header" && surface !== "footer") return c.json({ error: "unknown surface" }, 404);
	c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
	return c.json({ surface, items: await getNav(surface) });
});

contentRouter.get("/copy", async (c) => {
	c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
	return c.json({ copy: await getPublishedCopy(c.req.query("surface") || undefined) });
});

/**
 * Public media read. The bucket is private, so this is the public face of the
 * media library: the key must exist as a `media` row (that's the authorization
 * — a random document key 404s), then we 302 to a signed download URL. The
 * redirect itself is edge-cacheable for just under the signed URL's TTL, so
 * hot images don't re-sign on every hit.
 */
contentRouter.get("/media/:key{.+}", async (c) => {
	const key = c.req.param("key");
	const row = await mediaPublicKey(key);
	if (!row) return c.json({ error: "not found" }, 404);
	const storage = await getDocumentStorage();
	if (!storage.enabled) return c.json({ error: "storage not configured" }, 503);
	const ttl = 3500;
	const signed = await storage.createDownloadUrl({ key, expiresInSeconds: ttl });
	c.header("Cache-Control", `public, max-age=${ttl - 600}, stale-while-revalidate=600`);
	return c.redirect(signed.url, 302);
});

/* ══ Brand ═════════════════════════════════════════════════════════════════ */

cmsRouter.get("/brand", requireStaff, requireModule("cms"), async (c) => {
	return c.json(await getBrandForEdit());
});

cmsRouter.put("/brand", requireStaff, requireModule("cms"), async (c) => {
	const parsed = brandSchema.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: "invalid brand payload", issues: parsed.error.issues }, 400);
	await saveBrandDraft(parsed.data, editor(c));
	return c.json({ ok: true });
});

cmsRouter.post("/brand/publish", requireStaff, requireModule("cms"), async (c) => {
	const brand = await publishBrand(editor(c), requestIp(c));
	return c.json({ brand });
});

cmsRouter.post("/brand/revert", requireStaff, requireModule("cms"), async (c) => {
	// Draft := published — the working copy goes back to what's live.
	const { published } = await getBrandForEdit();
	await saveBrandDraft(published, editor(c));
	return c.json({ ok: true });
});

cmsRouter.get("/brand/history", requireStaff, requireModule("cms"), async (c) => {
	return c.json({ versions: await brandHistory() });
});

/* ══ Entries ═══════════════════════════════════════════════════════════════ */

/**
 * Seed published pages/* entries from the compiled copy. Inserts only
 * missing rows — never overwrites an entry staff may have edited, so it is
 * safe to run repeatedly.
 */
cmsRouter.post("/seed", requireStaff, requireModule("cms"), async (c) => {
	return c.json(await seedCompiledContent(editor(c)));
});

cmsRouter.get("/entries", requireStaff, requireModule("cms"), async (c) => {
	return c.json({ entries: await listEntries(c.req.query("collection") || undefined) });
});

const entryBody = z.object({
	id: z.string().optional(),
	collection: z.string(),
	slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
	payload: z.record(z.string(), z.unknown()),
	seo: z.record(z.string(), z.unknown()).nullable().optional(),
	scheduledAt: z.string().nullable().optional(),
});

cmsRouter.post("/entries", requireStaff, requireModule("cms"), async (c) => {
	const parsed = entryBody.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: "invalid entry", issues: parsed.error.issues }, 400);
	const row = await upsertEntry(parsed.data, editor(c));
	return c.json({ entry: row });
});

cmsRouter.post("/entries/:id/status", requireStaff, requireModule("cms"), async (c) => {
	const { status } = z.object({ status: z.enum(["draft", "review", "published"]) }).parse(await c.req.json());
	const row = await setEntryStatus(c.req.param("id"), status, editor(c));
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json({ entry: row });
});

cmsRouter.get("/entries/:collection/:slug/history", requireStaff, requireModule("cms"), async (c) => {
	return c.json({ versions: await entryHistory(c.req.param("collection"), c.req.param("slug")) });
});

cmsRouter.post("/entries/:id/revert", requireStaff, requireModule("cms"), async (c) => {
	const { versionId } = z.object({ versionId: z.string().uuid() }).parse(await c.req.json());
	const row = await revertEntry(c.req.param("id"), versionId, editor(c));
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json({ entry: row });
});

/* ══ Media ═════════════════════════════════════════════════════════════════ */

cmsRouter.get("/media", requireStaff, requireModule("cms"), async (c) => {
	return c.json({ media: await listMedia() });
});

/** Signed upload — the browser PUTs straight to storage under media/. */
cmsRouter.post("/media/upload-url", requireStaff, requireModule("cms"), async (c) => {
	const { fileName, mime } = z.object({
		fileName: z.string().min(1),
		mime: z.string().min(1),
	}).parse(await c.req.json());
	// CMS media is imagery + film only — the storage bucket's own MIME
	// allowlist would reject anything else with a bare 400 anyway, so gate it
	// here with a message the console can actually show.
	if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
		return c.json({ error: "Only image and video uploads are allowed in the CMS media library" }, 400);
	}
	const storage = await getDocumentStorage();
	if (!storage.enabled) return c.json({ error: "storage not configured" }, 503);
	const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
	const key = `media/${crypto.randomUUID()}-${safe}`;
	const upload = await storage.createUploadUrl({ key, contentType: mime, expiresInSeconds: 600 });
	return c.json({ key, url: upload.url, headers: upload.headers ?? {}, expiresAt: upload.expiresAt });
});

cmsRouter.post("/media", requireStaff, requireModule("cms"), async (c) => {
	const body = z.object({
		key: z.string().min(1),
		fileName: z.string().min(1),
		mime: z.string().min(1),
		sizeBytes: z.number().optional(),
		width: z.number().optional(),
		height: z.number().optional(),
		alt: z.string().optional(),
	}).parse(await c.req.json());
	return c.json({ media: await registerMedia(body, editor(c)) });
});

cmsRouter.patch("/media/:id", requireStaff, requireModule("cms"), async (c) => {
	const body = z.object({
		alt: z.string().optional(),
		focalX: z.number().min(0).max(100).optional(),
		focalY: z.number().min(0).max(100).optional(),
	}).parse(await c.req.json());
	const row = await updateMedia(c.req.param("id"), body);
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json({ media: row });
});

/* ══ Navigation ════════════════════════════════════════════════════════════ */

cmsRouter.get("/nav/:surface", requireStaff, requireModule("cms"), async (c) => {
	const surface = c.req.param("surface");
	if (surface !== "header" && surface !== "footer") return c.json({ error: "unknown surface" }, 404);
	return c.json({ surface, items: await getNav(surface) });
});

cmsRouter.put("/nav/:surface", requireStaff, requireModule("cms"), async (c) => {
	const surface = c.req.param("surface");
	if (surface !== "header" && surface !== "footer") return c.json({ error: "unknown surface" }, 404);
	const { items } = z.object({ items: z.array(navItemSchema) }).parse(await c.req.json());
	await putNav(surface, items, editor(c));
	return c.json({ ok: true });
});

/* ══ Copy ══════════════════════════════════════════════════════════════════ */

cmsRouter.get("/copy", requireStaff, requireModule("cms"), async (c) => {
	return c.json({ copy: await listCopy(c.req.query("surface") || undefined) });
});

cmsRouter.put("/copy", requireStaff, requireModule("cms"), async (c) => {
	const body = z.object({
		key: z.string().min(1),
		value: z.string(),
		surface: z.enum(["site", "portal", "console", "email"]),
		status: z.enum(["draft", "published"]).optional(),
	}).parse(await c.req.json());
	await putCopy(body, editor(c));
	return c.json({ ok: true });
});

export type { Brand };
