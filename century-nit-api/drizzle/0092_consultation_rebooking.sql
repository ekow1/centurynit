-- Cancellation recovery: a free-rebooking credit on the applicant (issued by
-- ops when we cancelled on the client) and a self-link on consultations so a
-- rebooked case points back at the cancelled one.
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "free_rebooking" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "rebooked_from_id" uuid;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_rebooked_from_id_consultations_id_fk" FOREIGN KEY ("rebooked_from_id") REFERENCES "public"."consultations"("id") ON DELETE set null ON UPDATE no action;
