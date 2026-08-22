CREATE TABLE "staff_calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"ics_url_encrypted" text NOT NULL,
	"label" varchar(120),
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_calendar_feeds_ops_user_id_unique" UNIQUE("ops_user_id")
);
--> statement-breakpoint
DROP INDEX "bookings_branch_slot_unique";--> statement-breakpoint
ALTER TABLE "staff_calendar_feeds" ADD CONSTRAINT "staff_calendar_feeds_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_branch_consultant_slot_unique" ON "bookings" USING btree ("branch_id","employee_id","starts_at") WHERE status NOT IN ('CANCELLED', 'NO_SHOW');--> statement-breakpoint
--> The Google Calendar integration has been removed. Any busy blocks it
--> wrote are now stale and will never be refreshed, so they would permanently
--> (and wrongly) block slots. Clear them; the iCal mirror repopulates this
--> table for staff who set up a feed.
DELETE FROM "calendar_busy_blocks";