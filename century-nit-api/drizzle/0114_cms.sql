-- CMS foundation (migration 0114)
--
-- One identity record + one content store + one media library, consumed by
-- the site, the portal, the console and the emails.
--
--   cms_brand      — singleton: draft + published payloads side by side
--   cms_versions   — snapshots for every publish/revert across entities
--   media          — the library; keys point at document storage
--   cms_entries    — collections (pages/blog/faqs/testimonials/events/…)
--   cms_nav        — header + footer link lists
--   copy_keys      — portal/console/email strings, keyed
--
-- Catalog merge: destinations/universities/programs/scholarships gain seo +
-- hero_media_id so the public site and the Programmes page read one source.

CREATE TABLE IF NOT EXISTS "cms_brand" (
	"id" varchar(24) PRIMARY KEY DEFAULT 'brand',
	"draft" jsonb,
	"published" jsonb NOT NULL,
	"published_version" integer NOT NULL DEFAULT 1,
	"published_at" timestamp with time zone,
	"published_by" text,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_by" text
);

CREATE TABLE IF NOT EXISTS "cms_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"entity" varchar(32) NOT NULL,                 -- brand | entry | nav | copy
	"entity_key" varchar(160) NOT NULL,            -- 'brand' | 'collection:slug' | 'header' | copy key
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"editor_id" text,
	"editor_email" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "cms_versions_entity_idx" ON "cms_versions" ("entity", "entity_key", "version" DESC);

CREATE TABLE IF NOT EXISTS "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" text NOT NULL UNIQUE,                    -- storage object key
	"file_name" text NOT NULL,
	"mime" varchar(80) NOT NULL,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"alt" text NOT NULL DEFAULT '',
	"focal_x" integer NOT NULL DEFAULT 50,         -- percentage
	"focal_y" integer NOT NULL DEFAULT 50,
	"uploaded_by" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "cms_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"collection" varchar(48) NOT NULL,             -- pages | posts | faqs | testimonials | events | stories | services | team | branches
	"slug" varchar(160) NOT NULL,
	"status" varchar(16) NOT NULL DEFAULT 'draft', -- draft | review | published
	"payload" jsonb NOT NULL DEFAULT '{}',
	"seo" jsonb,                                   -- {title, description, ogImage, canonical, noindex}
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by" text,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_by" text,
	CONSTRAINT "cms_entries_collection_slug_uq" UNIQUE ("collection", "slug")
);
CREATE INDEX IF NOT EXISTS "cms_entries_collection_status_idx" ON "cms_entries" ("collection", "status");
CREATE INDEX IF NOT EXISTS "cms_entries_scheduled_idx" ON "cms_entries" ("status", "scheduled_at") WHERE "scheduled_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "cms_nav" (
	"surface" varchar(24) PRIMARY KEY,             -- header | footer
	"items" jsonb NOT NULL DEFAULT '[]',
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_by" text
);

CREATE TABLE IF NOT EXISTS "copy_keys" (
	"key" varchar(160) PRIMARY KEY,                -- e.g. portal.welcome, email.invoice.subject
	"value" text NOT NULL DEFAULT '',
	"surface" varchar(24) NOT NULL DEFAULT 'site', -- site | portal | console | email
	"status" varchar(16) NOT NULL DEFAULT 'published',
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_by" text
);

ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "seo" jsonb;
ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "hero_media_id" uuid;
ALTER TABLE "catalog_universities" ADD COLUMN IF NOT EXISTS "seo" jsonb;
ALTER TABLE "catalog_universities" ADD COLUMN IF NOT EXISTS "hero_media_id" uuid;
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "seo" jsonb;
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "hero_media_id" uuid;
-- Display fields the static content.ts rows carried — the public site renders
-- these, so the catalog tables grow them rather than the site keeping a second
-- source of truth.
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "format" text;
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "language_requirement" text;
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "entry_requirements" jsonb;
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "curriculum" jsonb;
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "career_outcomes" jsonb;
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "scholarships_available" jsonb;
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "facts" jsonb;
ALTER TABLE "catalog_scholarships" ADD COLUMN IF NOT EXISTS "seo" jsonb;
ALTER TABLE "catalog_scholarships" ADD COLUMN IF NOT EXISTS "hero_media_id" uuid;
ALTER TABLE "catalog_scholarships" ADD COLUMN IF NOT EXISTS "amount_usd" integer;
ALTER TABLE "catalog_scholarships" ADD COLUMN IF NOT EXISTS "amount_qualifier" text;
ALTER TABLE "catalog_scholarships" ADD COLUMN IF NOT EXISTS "amount_note" text;
ALTER TABLE "catalog_scholarships" ADD COLUMN IF NOT EXISTS "image" text;
ALTER TABLE "catalog_scholarships" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "catalog_scholarships" ADD COLUMN IF NOT EXISTS "criteria" jsonb;

-- Same lockdown as the rest of the public schema (0113 convention): RLS on,
-- the API reaches everything through the service role.
ALTER TABLE "cms_brand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cms_brand" FORCE ROW LEVEL SECURITY;
ALTER TABLE "cms_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cms_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media" FORCE ROW LEVEL SECURITY;
ALTER TABLE "cms_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cms_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "cms_nav" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cms_nav" FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_keys" FORCE ROW LEVEL SECURITY;

-- Seed the singleton from today's compiled brand so /brand.json is never
-- empty — the same values that live in content.ts' `company` block.
INSERT INTO "cms_brand" ("id", "published", "published_version", "published_at", "updated_by")
VALUES (
	'brand',
	$${
		"names": {
			"brand": "Century NIT Consult",
			"legal": "Century Nit Consult Limited",
			"short": "Century NIT",
			"console": "Century NIT · Ops",
			"tagline": "Your global education partner"
		},
		"domain": "centurynit.com",
		"contacts": {
			"info": "info@centurynit.com",
			"support": "support@centurynit.com",
			"admissions": "admissions@centurynit.com",
			"finance": "accounts@centurynit.com",
			"phoneAccra": "+233 30 274 0000",
			"phoneKumasi": "+233 32 200 0000",
			"address": "14 Liberation Road, Accra, Ghana",
			"hours": "Mon–Fri 08:00–17:00 GMT"
		},
		"socials": {},
		"logos": { "primary": null, "inverse": null, "mark": null, "favicon": null, "email": null, "appIcon": null },
		"colors": {
			"primary": "#17161A", "accent": "#B97A10", "ink": "#17161A",
			"surface": "#F5F4F0", "muted": "#6E6A60",
			"success": "#2E6B34", "warn": "#B97A10", "danger": "#A33B2E"
		},
		"fonts": { "display": "serif", "body": "sans", "mono": "mono" }
	}$$::jsonb,
	1,
	now(),
	'migration 0114'
) ON CONFLICT ("id") DO NOTHING;

-- Seed nav from navLinks.ts — MAIN_LINKS are kind 'top', SECONDARY_LINKS are
-- 'secondary' (mobile sheet + footer reach), the Journey CTA stays a component.
INSERT INTO "cms_nav" ("surface", "items", "updated_by")
VALUES
('header', $$[
	{ "label": "About",            "href": "/about",            "kind": "top" },
	{ "label": "Destinations",     "href": "/destinations",     "kind": "top" },
	{ "label": "Universities",     "href": "/universities",     "kind": "top" },
	{ "label": "Programs",         "href": "/programs",         "kind": "top" },
	{ "label": "Scholarships",     "href": "/scholarships",     "kind": "top" },
	{ "label": "Red Seat",         "href": "/red-seat",         "kind": "top" },
	{ "label": "FAQs",             "href": "/faqs",             "kind": "top" },
	{ "label": "Why Choose Us",    "href": "/why-choose-us",    "kind": "secondary" },
	{ "label": "Visa Services",    "href": "/visa-services",    "kind": "secondary" },
	{ "label": "Student Services", "href": "/student-services", "kind": "secondary" },
	{ "label": "Events",           "href": "/events",           "kind": "secondary" },
	{ "label": "Blog",             "href": "/blog",             "kind": "secondary" }
]$$::jsonb, 'migration 0114'),
('footer', $$[
	{ "label": "Study abroad",     "href": "/destinations",     "kind": "footer-link" },
	{ "label": "Visa services",    "href": "/visa-services",    "kind": "footer-link" },
	{ "label": "Student services", "href": "/student-services", "kind": "footer-link" },
	{ "label": "Red Seat",         "href": "/red-seat",         "kind": "footer-link" }
]$$::jsonb, 'migration 0114')
ON CONFLICT ("surface") DO NOTHING;
