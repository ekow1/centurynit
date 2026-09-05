ALTER TABLE "applications" ADD COLUMN "proceed_status" varchar(16) DEFAULT 'invited' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "proceeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "declined_reason" text;--> statement-breakpoint
UPDATE "applications" SET "proceed_status" = 'accepted', "proceeded_at" = "created_at";--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "university_name" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "program_name" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "country_name" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "tuition_usd" integer;