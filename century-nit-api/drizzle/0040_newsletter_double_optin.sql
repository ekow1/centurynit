ALTER TABLE "mailing_list_contacts" ADD COLUMN "status" varchar(16) DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailing_list_contacts" ADD COLUMN "confirm_token" uuid;--> statement-breakpoint
ALTER TABLE "mailing_list_contacts" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailing_list_contacts" ADD COLUMN "unsubscribed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "mlc_confirm_token_idx" ON "mailing_list_contacts" USING btree ("confirm_token");--> statement-breakpoint
CREATE UNIQUE INDEX "mlc_list_email_uniq" ON "mailing_list_contacts" USING btree ("mailing_list_id","email");