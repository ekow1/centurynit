ALTER TABLE applications ADD COLUMN IF NOT EXISTS post_arrival_status VARCHAR(16);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS post_arrival_start_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS post_arrival_reviewed_by TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS post_arrival_reviewed_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS post_arrival_decline_reason TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS post_arrival_interest_pct INTEGER;

-- Schedules live before the approval flow stay live: already agreed, no interest.
UPDATE applications SET post_arrival_status = 'approved'
WHERE post_arrival_months IS NOT NULL AND post_arrival_status IS NULL;

CREATE INDEX IF NOT EXISTS applications_post_arrival_status_idx ON applications(post_arrival_status) WHERE post_arrival_status = 'pending';

-- Approval sits with finance and managers (super_admin holds every grant).
UPDATE "ops_roles"
SET "permissions" = "permissions" || '"approve_schedules"'::jsonb, "updated_at" = now()
WHERE "id" IN ('manager', 'finance')
  AND NOT "permissions" @> '"approve_schedules"'::jsonb;
