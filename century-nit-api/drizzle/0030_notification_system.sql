-- Notification system enhancements: add columns for idempotency, priority,
-- entity linking, and audit. Add push_subscriptions for Web Push.

ALTER TABLE notifications ADD COLUMN event_id VARCHAR(200);
ALTER TABLE notifications ADD COLUMN priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE notifications ADD COLUMN entity_type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN entity_id VARCHAR(100);
ALTER TABLE notifications ADD COLUMN case_id VARCHAR(100);
ALTER TABLE notifications ADD COLUMN read_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN delivered_at TIMESTAMPTZ;

-- Idempotency: one in-app notification per (event_id, user_id).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_user_idx
  ON notifications (event_id, user_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_case_idx
  ON notifications (case_id)
  WHERE case_id IS NOT NULL;

-- Web Push subscriptions (one user can have multiple devices).
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE(user_id, endpoint)
);
