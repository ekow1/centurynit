DO $$ BEGIN
 CREATE TYPE "public"."school_outcome" AS ENUM('Offer Received', 'Waitlisted', 'Application Rejected', 'Withdrawn');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TYPE "public"."school_track_status" ADD VALUE IF NOT EXISTS 'Preparing Application';
--> statement-breakpoint
ALTER TYPE "public"."school_track_status" ADD VALUE IF NOT EXISTS 'Submitted';
--> statement-breakpoint
ALTER TYPE "public"."school_track_status" ADD VALUE IF NOT EXISTS 'Decision Reached';
--> statement-breakpoint

ALTER TABLE "school_applications" ADD COLUMN IF NOT EXISTS "outcome" "school_outcome";
--> statement-breakpoint
ALTER TABLE "school_track_events" ADD COLUMN IF NOT EXISTS "outcome" "school_outcome";
--> statement-breakpoint

ALTER TABLE "school_applications" ALTER COLUMN "status" SET DEFAULT 'Preparing Application';