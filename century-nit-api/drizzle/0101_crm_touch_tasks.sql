-- CRM gap work: real last-client-touch clock, lost reasons, and staff tasks.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_client_touch_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason VARCHAR(32);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_note TEXT;

-- Backfill: the best existing proxy for "last touch" is the lead's own
-- updated_at — imperfect (any edit bumps it) but strictly better than null,
-- and only until the first real touch overwrites it.
UPDATE leads SET last_client_touch_at = updated_at WHERE last_client_touch_at IS NULL;

CREATE TABLE IF NOT EXISTS ops_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    note TEXT,
    due_at TIMESTAMPTZ NOT NULL,
    assignee_ops_user_id UUID REFERENCES ops_users(id) ON DELETE CASCADE,
    created_by_ops_user_id UUID REFERENCES ops_users(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    done_at TIMESTAMPTZ,
    reminded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_tasks_assignee_idx ON ops_tasks(assignee_ops_user_id, due_at);
CREATE INDEX IF NOT EXISTS ops_tasks_lead_idx ON ops_tasks(lead_id);
CREATE INDEX IF NOT EXISTS ops_tasks_application_idx ON ops_tasks(application_id);
CREATE INDEX IF NOT EXISTS ops_tasks_due_idx ON ops_tasks(due_at, done_at);
