ALTER TYPE "public"."consultation_status" ADD VALUE 'CONFIRMED' BEFORE 'IN_ASSESSMENT';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "app_fee_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" DROP COLUMN "slot_confirmed";