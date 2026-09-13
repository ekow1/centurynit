-- One audit row per logical email: a retry updates the same row instead of
-- adding a second "sent"/"failed" entry. `attempts` records how many tries
-- the row reflects. Keyed on the queue's idempotency key; sends without one
-- (OTP, test mail) still get a plain row each — Postgres treats NULLs as
-- distinct, so they never conflict.
ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 1;

-- Rows written before the upsert existed can already duplicate a key
-- (attempt-1 "failed" + attempt-2 "sent" was the normal shape). Collapse
-- each key to one row so the index can build: keep the most informative
-- survivor — a "sent" beats a "failed", then the latest attempt — and fold
-- the discarded rows' attempts into it so the count stays truthful.
WITH ranked AS (
	SELECT "id",
		ROW_NUMBER() OVER (
			PARTITION BY "idempotency_key"
			ORDER BY ("status" = 'sent') DESC, "sent_at" DESC
		) AS rn
	FROM "notification_log"
	WHERE "idempotency_key" IS NOT NULL
),
survivors AS (
	SELECT "id", "idempotency_key" FROM ranked WHERE rn = 1
),
dead AS (
	SELECT "id" FROM ranked WHERE rn > 1
),
fold AS (
	UPDATE "notification_log" nl
	SET "attempts" = COALESCE((
		SELECT SUM(r."attempts") FROM "notification_log" r
		WHERE r."idempotency_key" = (SELECT s."idempotency_key" FROM survivors s WHERE s."id" = nl."id")
	), nl."attempts")
	WHERE nl."id" IN (SELECT "id" FROM survivors)
	RETURNING nl."id"
)
DELETE FROM "notification_log" WHERE "id" IN (SELECT "id" FROM dead);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_log_idempotency_key_idx" ON "notification_log" ("idempotency_key");
