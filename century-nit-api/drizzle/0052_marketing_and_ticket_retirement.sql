DROP TABLE "ticket_messages" CASCADE;--> statement-breakpoint
DROP TABLE "tickets" CASCADE;--> statement-breakpoint
DROP TYPE "public"."ticket_sender_type";--> statement-breakpoint
DROP TYPE "public"."ticket_priority";--> statement-breakpoint
DROP TYPE "public"."ticket_status";--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_mailing_list_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."mailing_list_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_idx" ON "campaign_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_status_idx" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
DROP INDEX IF EXISTS "leads_email_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "leads_email_uniq" ON "leads" USING btree ("email");