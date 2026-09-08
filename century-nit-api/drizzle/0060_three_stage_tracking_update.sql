UPDATE "school_applications" SET "status" = 'Preparing Application' WHERE "status" = 'Draft' OR "status" = 'Documents under review';
--> statement-breakpoint
UPDATE "school_applications" SET "status" = 'Submitted' WHERE "status" = 'Submitted to University';
--> statement-breakpoint
UPDATE "school_applications" SET "outcome" = 'Offer Received', "status" = 'Decision Reached' WHERE "status" IN ('Conditional Offer Received', 'Unconditional Offer', 'Offer Accepted');
--> statement-breakpoint
UPDATE "school_applications" SET "outcome" = 'Withdrawn', "status" = 'Decision Reached' WHERE "status" = 'Offer Declined';
--> statement-breakpoint
UPDATE "school_applications" SET "outcome" = 'Application Rejected', "status" = 'Decision Reached' WHERE "status" = 'Application Rejected';
--> statement-breakpoint
UPDATE "school_applications" SET "outcome" = 'Waitlisted', "status" = 'Decision Reached' WHERE "status" = 'Waitlisted';
--> statement-breakpoint
UPDATE "school_applications" SET "outcome" = 'Withdrawn', "status" = 'Decision Reached' WHERE "status" = 'Withdrawn';
--> statement-breakpoint

UPDATE "school_track_events" SET "status" = 'Preparing Application' WHERE "status" = 'Draft' OR "status" = 'Documents under review';
--> statement-breakpoint
UPDATE "school_track_events" SET "status" = 'Submitted' WHERE "status" = 'Submitted to University';
--> statement-breakpoint
UPDATE "school_track_events" SET "outcome" = 'Offer Received', "status" = 'Decision Reached' WHERE "status" IN ('Conditional Offer Received', 'Unconditional Offer', 'Offer Accepted');
--> statement-breakpoint
UPDATE "school_track_events" SET "outcome" = 'Withdrawn', "status" = 'Decision Reached' WHERE "status" = 'Offer Declined';
--> statement-breakpoint
UPDATE "school_track_events" SET "outcome" = 'Application Rejected', "status" = 'Decision Reached' WHERE "status" = 'Application Rejected';
--> statement-breakpoint
UPDATE "school_track_events" SET "outcome" = 'Waitlisted', "status" = 'Decision Reached' WHERE "status" = 'Waitlisted';
--> statement-breakpoint
UPDATE "school_track_events" SET "outcome" = 'Withdrawn', "status" = 'Decision Reached' WHERE "status" = 'Withdrawn';