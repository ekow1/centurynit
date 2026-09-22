-- Human-facing ticket refs on conversations (REQ-2026-0142) — quotable over
-- the phone and searchable in the helpdesk queue. The UUID stays the
-- join/deep-link key; this is only what humans read.
ALTER TABLE "conversations" ADD COLUMN "reference" varchar(24);--> statement-breakpoint
-- Backfill existing threads: REQ-<created year>-<seq within that year>,
-- ordered by creation so the sequence reads chronologically.
WITH numbered AS (
	SELECT id,
		'REQ-' || yr || '-' || lpad(rn::text, 4, '0') AS ref
	FROM (
		SELECT id,
			to_char(created_at AT TIME ZONE 'UTC', 'YYYY') AS yr,
			row_number() OVER (
				PARTITION BY to_char(created_at AT TIME ZONE 'UTC', 'YYYY')
				ORDER BY created_at, id
			) AS rn
		FROM conversations
		WHERE reference IS NULL
	) s
)
UPDATE conversations c SET reference = n.ref FROM numbered n WHERE c.id = n.id;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_reference_key" ON "conversations" ("reference");
