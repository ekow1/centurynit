-- The post-arrival remainder of the service fee becomes dated instalments:
-- the client's chosen schedule on the application, and a due date on the
-- invoice lines that carry each instalment.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "post_arrival_months" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "post_arrival_frequency" varchar(16);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "post_arrival_chosen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "due_at" timestamp with time zone;
