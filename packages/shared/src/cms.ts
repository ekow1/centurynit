import { z } from "zod";

/**
 * CMS — one identity record, one content store, one media library.
 *
 * The brand record is the single source of truth for names, domains, contacts,
 * logos, colours and fonts across the site, the portal, the console and the
 * email layout. The site reads it via GET /api/v1/brand.json (edge-cached);
 * the email layout reads the cached row server-side; the ops CMS edits the
 * draft and publishes.
 */

export const brandSchema = z.object({
	names: z.object({
		brand: z.string().min(1),
		legal: z.string().min(1),
		short: z.string().min(1),
		console: z.string().min(1),
		tagline: z.string(),
	}),
	domain: z.string().min(3),
	contacts: z.object({
		info: z.string().email(),
		support: z.string().email(),
		admissions: z.string().email().or(z.literal("")),
		finance: z.string().email().or(z.literal("")),
		phoneAccra: z.string(),
		phoneKumasi: z.string(),
		address: z.string(),
		hours: z.string(),
	}),
	socials: z.record(z.string(), z.string()),
	/** Storage object keys — null means the text wordmark fallback. */
	logos: z.object({
		primary: z.string().nullable(),
		inverse: z.string().nullable(),
		mark: z.string().nullable(),
		favicon: z.string().nullable(),
		email: z.string().nullable(),
		appIcon: z.string().nullable(),
	}),
	colors: z.object({
		primary: z.string(),
		accent: z.string(),
		ink: z.string(),
		surface: z.string(),
		muted: z.string(),
		success: z.string(),
		warn: z.string(),
		danger: z.string(),
	}),
	fonts: z.object({
		display: z.string(),
		body: z.string(),
		mono: z.string(),
	}),
});

export type Brand = z.infer<typeof brandSchema>;

/**
 * The compiled-in brand — what every surface showed before the CMS existed.
 * Used as the migration seed and the fallback when /brand.json can't load.
 */
export const DEFAULT_BRAND: Brand = {
	names: {
		brand: "Century NIT Consult",
		legal: "Century Nit Consult Limited",
		short: "Century NIT",
		console: "Century NIT · Ops",
		tagline: "Your global education partner",
	},
	domain: "centurynit.com",
	contacts: {
		info: "info@centurynit.com",
		support: "support@centurynit.com",
		admissions: "admissions@centurynit.com",
		finance: "accounts@centurynit.com",
		phoneAccra: "+233 30 274 0000",
		phoneKumasi: "+233 32 200 0000",
		address: "14 Liberation Road, Accra, Ghana",
		hours: "Mon–Fri 08:00–17:00 GMT",
	},
	socials: {},
	logos: { primary: null, inverse: null, mark: null, favicon: null, email: null, appIcon: null },
	colors: {
		primary: "#17161A",
		accent: "#B97A10",
		ink: "#17161A",
		surface: "#F5F4F0",
		muted: "#6E6A60",
		success: "#2E6B34",
		warn: "#B97A10",
		danger: "#A33B2E",
	},
	fonts: { display: "serif", body: "sans", mono: "mono" },
};

/* ── Collections ─────────────────────────────────────────────────────────── */

export const CMS_COLLECTIONS = [
	"pages",
	"posts",
	"faqs",
	"testimonials",
	"events",
	"stories",
	"services",
	"films",
	"team",
	"branches",
] as const;
export type CmsCollection = (typeof CMS_COLLECTIONS)[number];

export const cmsEntryStatus = ["draft", "review", "published"] as const;
export type CmsEntryStatus = (typeof cmsEntryStatus)[number];

export const cmsSeoSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	ogImage: z.string().optional(),
	canonical: z.string().optional(),
	noindex: z.boolean().optional(),
});
export type CmsSeo = z.infer<typeof cmsSeoSchema>;

export const cmsEntrySchema = z.object({
	id: z.string(),
	collection: z.string(),
	slug: z.string(),
	status: z.enum(cmsEntryStatus),
	payload: z.record(z.string(), z.unknown()),
	seo: cmsSeoSchema.nullable(),
	scheduledAt: z.string().nullable(),
	publishedAt: z.string().nullable(),
	publishedBy: z.string().nullable(),
	updatedAt: z.string(),
	updatedBy: z.string().nullable(),
});
export type CmsEntry = z.infer<typeof cmsEntrySchema>;

/* ── Media ───────────────────────────────────────────────────────────────── */

export const mediaItemSchema = z.object({
	id: z.string(),
	key: z.string(),
	fileName: z.string(),
	mime: z.string(),
	sizeBytes: z.number().nullable(),
	width: z.number().nullable(),
	height: z.number().nullable(),
	alt: z.string(),
	focalX: z.number(),
	focalY: z.number(),
	uploadedBy: z.string().nullable(),
	createdAt: z.string(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

/* ── Navigation ──────────────────────────────────────────────────────────── */

export const navItemSchema = z.object({
	label: z.string(),
	href: z.string(),
	/** top (desktop nav) | secondary (mobile sheet + footer reach) | footer-link | footer-col */
	kind: z.string().default("top"),
	children: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
	visible: z.boolean().default(true),
});
export type NavItem = z.infer<typeof navItemSchema>;

export const navSchema = z.object({
	surface: z.enum(["header", "footer"]),
	items: z.array(navItemSchema),
});
export type CmsNav = z.infer<typeof navSchema>;

/* ── Copy keys ───────────────────────────────────────────────────────────── */

export const copyKeySchema = z.object({
	key: z.string(),
	value: z.string(),
	surface: z.enum(["site", "portal", "console", "email"]),
	status: z.enum(["draft", "published"]),
	updatedAt: z.string().optional(),
	updatedBy: z.string().nullable().optional(),
});
export type CopyKey = z.infer<typeof copyKeySchema>;
