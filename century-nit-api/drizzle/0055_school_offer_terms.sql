ALTER TABLE "school_applications" ADD COLUMN "offer_tuition_usd" integer;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_tuition_label" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_deposit_usd" integer;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_deposit_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_deposit_paid_at" timestamp with time zone;
