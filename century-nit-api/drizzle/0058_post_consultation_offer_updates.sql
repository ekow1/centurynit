ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "target_school_count" integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN IF NOT EXISTS "offer_letter_url" text;
