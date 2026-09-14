-- Coverage chosen when a consultation handler is placed: "rest of the
-- case" means the officer carries the application opened from this
-- consultation too — it starts with them as assignedStaffId instead of
-- parking on a school_submission handoff.
ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "handler_carries_case" boolean NOT NULL DEFAULT false;
