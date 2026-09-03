ALTER TABLE "bookings" ADD COLUMN "meeting_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "meeting_participants" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "meeting_checked_at" timestamp with time zone;