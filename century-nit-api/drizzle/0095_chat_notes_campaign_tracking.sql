-- Staff-only message notes + Resend delivery tracking on campaign recipients.
-- `messages.visibility` gates notes out of every client-facing read path.
-- `provider_message_id` joins Resend webhook events (delivered/opened/bounced)
-- back to the recipient row they belong to.
DO $$ BEGIN
	CREATE TYPE "public"."message_visibility" AS ENUM('public', 'internal');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "visibility" "public"."message_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "provider_message_id" varchar(128);--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "bounced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_recipients_provider_idx" ON "campaign_recipients" ("provider_message_id");
