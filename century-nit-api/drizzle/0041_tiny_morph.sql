CREATE TYPE "public"."package_code" AS ENUM('non_scholarship', 'scholarship', 'hybrid', 'undecided');--> statement-breakpoint
CREATE TABLE "service_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "package_code" NOT NULL,
	"name" varchar(120) NOT NULL,
	"tagline" text,
	"price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"included_fee_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_schools" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_packages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "push_subscriptions" CASCADE;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "package_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "package_selected_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "service_packages_active_idx" ON "service_packages" USING btree ("active","sort_order");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_package_id_service_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."service_packages"("id") ON DELETE set null ON UPDATE no action;