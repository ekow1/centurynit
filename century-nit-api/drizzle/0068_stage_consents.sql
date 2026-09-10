DO $$ BEGIN
 CREATE TYPE "public"."stage_consent_stage" AS ENUM('application', 'visa', 'travel');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "public"."stage_consent_decision" AS ENUM('pending', 'continue', 'hold', 'opt_out');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stage_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"stage" "public"."stage_consent_stage" NOT NULL,
	"decision" "public"."stage_consent_decision" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_at" timestamp(3) with time zone,
	"decided_by_client_user_id" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stage_consents" ADD CONSTRAINT "stage_consents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "stage_consents_application_idx" ON "stage_consents" USING btree ("application_id","stage");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "stage_consents_app_stage_uniq" ON "stage_consents" USING btree ("application_id","stage");
