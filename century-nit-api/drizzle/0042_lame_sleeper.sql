CREATE TABLE "fee_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"category" varchar(120) NOT NULL,
	"description" text,
	"billing_stage" varchar(120) NOT NULL,
	"badge" varchar(60) NOT NULL,
	"default_cents" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_definitions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "staff_invitations" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "meeting_provider" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "meeting_space" text;--> statement-breakpoint
ALTER TABLE "fee_definitions" ADD CONSTRAINT "fee_definitions_created_by_ops_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_definitions_category_idx" ON "fee_definitions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "fee_definitions_active_idx" ON "fee_definitions" USING btree ("active");