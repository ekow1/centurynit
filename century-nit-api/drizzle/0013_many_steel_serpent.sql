ALTER TYPE "public"."invoice_status" ADD VALUE 'proforma' BEFORE 'issued';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reviewed_by_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reviewed_by_ops_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;