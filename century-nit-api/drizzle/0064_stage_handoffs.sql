DO $$ BEGIN
 CREATE TYPE "public"."stage_handoff_status" AS ENUM('pending', 'resolved', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "public"."stage_handoff_decision" AS ENUM('keep', 'assign');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TYPE "public"."visa_stage" ADD VALUE IF NOT EXISTS 'awaiting_handler';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stage_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"stage" varchar(80) NOT NULL,
	"from_ops_user_id" uuid,
	"source" varchar(40) DEFAULT 'stage_transition' NOT NULL,
	"status" "public"."stage_handoff_status" DEFAULT 'pending' NOT NULL,
	"decision" "public"."stage_handoff_decision",
	"resolved_ops_user_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp(3) with time zone,
	"deferred_by" uuid,
	"deferred_at" timestamp(3) with time zone,
	"defer_count" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_from_ops_user_id_ops_users_id_fk" FOREIGN KEY ("from_ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_resolved_ops_user_id_ops_users_id_fk" FOREIGN KEY ("resolved_ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_decided_by_ops_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_deferred_by_ops_users_id_fk" FOREIGN KEY ("deferred_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "stage_handoffs_application_idx" ON "stage_handoffs" USING btree ("application_id","stage");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "stage_handoffs_ops_user_idx" ON "stage_handoffs" USING btree ("from_ops_user_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "stage_handoffs_open_uniq" ON "stage_handoffs" USING btree ("application_id","stage") WHERE (status = 'pending');
--> statement-breakpoint