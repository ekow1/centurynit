-- Admin audit: settings_audit gains the request IP + human action, and a new
-- admin_audit table records non-settings events (staff invites, client access
-- control, role grants, sign-ins). Previously the console fabricated both
-- fields at render time.

ALTER TABLE "settings_audit" ADD COLUMN "actor_ip" text;
ALTER TABLE "settings_audit" ADD COLUMN "action" text;

CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(32) NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid REFERENCES "ops_users"("id") ON DELETE SET NULL,
	"actor_email" varchar(255),
	"target" text,
	"detail" text,
	"ip" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_at_idx" ON "admin_audit" USING btree ("at" DESC);
--> statement-breakpoint
CREATE INDEX "admin_audit_category_idx" ON "admin_audit" USING btree ("category", "at" DESC);
