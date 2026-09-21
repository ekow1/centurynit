-- Marketing audience layer: consent keyed by person (email), global
-- suppression, live segments, tracked links, and automations.

-- People-level opt-in — the legal state for an address across every list.
CREATE TABLE IF NOT EXISTS "marketing_optins" (
	"email" varchar(255) PRIMARY KEY,
	"source" varchar(40) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Global suppression — an address that must never be mailed again.
CREATE TABLE IF NOT EXISTS "marketing_suppressions" (
	"email" varchar(255) PRIMARY KEY,
	"reason" varchar(24) NOT NULL,
	"detail" text,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "marketing_suppressions" ADD CONSTRAINT "marketing_suppressions_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Saved live audiences — filters over the suite's own data, evaluated at send.
CREATE TABLE IF NOT EXISTS "marketing_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"entity" varchar(24) NOT NULL,
	"filters" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "marketing_segments" ADD CONSTRAINT "marketing_segments_created_by_ops_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Tracked links per campaign — the report's "top links" without reparsing.
CREATE TABLE IF NOT EXISTS "campaign_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campaign_id" uuid NOT NULL,
	"url" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_links_campaign_idx" ON "campaign_links" ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_links_url_uniq" ON "campaign_links" ("campaign_id", "url");--> statement-breakpoint

-- Automations: domain event → segment → template → delay.
CREATE TABLE IF NOT EXISTS "marketing_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"event" varchar(80) NOT NULL,
	"segment_id" uuid,
	"template_id" uuid,
	"subject" varchar(500),
	"body" text,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "marketing_automations" ADD CONSTRAINT "marketing_automations_segment_id_marketing_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."marketing_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_automations" ADD CONSTRAINT "marketing_automations_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_automations" ADD CONSTRAINT "marketing_automations_created_by_ops_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Per-recipient automation ledger — deduped on (automation, trigger, email).
CREATE TABLE IF NOT EXISTS "automation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"automation_id" uuid NOT NULL,
	"trigger_key" varchar(128) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"provider_message_id" varchar(128),
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "automation_sends" ADD CONSTRAINT "automation_sends_automation_id_marketing_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."marketing_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_sends_auto_idx" ON "automation_sends" ("automation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_sends_status_idx" ON "automation_sends" ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_sends_provider_idx" ON "automation_sends" ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_sends_fire_uniq" ON "automation_sends" ("automation_id","trigger_key","email");--> statement-breakpoint

-- Campaign: live-segment audience, sender identity, composer tree.
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "segment_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_segment_id_marketing_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."marketing_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "preheader" varchar(500);--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "from_name" varchar(255);--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "reply_to" varchar(255);--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "blocks" jsonb;--> statement-breakpoint

-- Recipient: the click lands on the row, and `skipped` is now honoured.
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "clicked_url" text;--> statement-breakpoint

-- Contact rows record where consent came from.
ALTER TABLE "mailing_list_contacts" ADD COLUMN IF NOT EXISTS "consent_source" varchar(40);--> statement-breakpoint
ALTER TABLE "mailing_list_contacts" ADD COLUMN IF NOT EXISTS "consent_note" text;--> statement-breakpoint

-- Templates: composer tree, sender identity, usage hint, preset flag.
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "blocks" jsonb;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "preheader" varchar(500);--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "from_name" varchar(255);--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "reply_to" varchar(255);--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "used_for" varchar(24) DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "is_preset" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Grandfather everyone already confirmed on a list — they were already being
-- mailed; the new model records that consent honestly instead of dropping it.
INSERT INTO "marketing_optins" ("email", "source", "note")
SELECT DISTINCT lower("email"), 'grandfathered', 'pre-existing confirmed contact at audience-model migration'
FROM "mailing_list_contacts"
WHERE "status" = 'confirmed'
ON CONFLICT ("email") DO NOTHING;--> statement-breakpoint
UPDATE "mailing_list_contacts" SET "consent_source" = 'grandfathered'
WHERE "status" = 'confirmed' AND "consent_source" IS NULL;--> statement-breakpoint

-- Newsletter double opt-ins count as real consent too — pending stays pending.
INSERT INTO "marketing_optins" ("email", "source")
SELECT DISTINCT lower("email"), 'confirm_link'
FROM "mailing_list_contacts"
WHERE "status" = 'confirmed' AND "confirmed_at" IS NOT NULL
ON CONFLICT ("email") DO NOTHING;--> statement-breakpoint

-- Seed suppression from history: unsubscribed rows and bounced addresses.
INSERT INTO "marketing_suppressions" ("email", "reason", "detail")
SELECT DISTINCT lower("email"), 'unsubscribed', 'unsubscribed before the audience model'
FROM "mailing_list_contacts"
WHERE "status" = 'unsubscribed'
ON CONFLICT ("email") DO NOTHING;--> statement-breakpoint
INSERT INTO "marketing_suppressions" ("email", "reason", "detail", "campaign_id")
SELECT DISTINCT lower("email"), 'bounced', 'provider bounce before the audience model', "campaign_id"
FROM "campaign_recipients"
WHERE "bounced_at" IS NOT NULL
ON CONFLICT ("email") DO NOTHING;--> statement-breakpoint

-- The suite's RLS sweep: every public table carries row-level security.
ALTER TABLE "marketing_optins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_optins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_suppressions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_segments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_segments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_automations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_sends" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
