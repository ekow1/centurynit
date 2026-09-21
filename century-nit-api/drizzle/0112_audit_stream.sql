-- Audit stream: typed actor/target/severity + tamper-evident hash chain on
-- admin_audit, channel columns on notification_log, and a UNION view that
-- surfaces every event table the suite already writes as ONE feed.

ALTER TABLE "admin_audit" ADD COLUMN IF NOT EXISTS "actor_type" varchar(16) NOT NULL DEFAULT 'staff';
ALTER TABLE "admin_audit" ADD COLUMN IF NOT EXISTS "target_type" varchar(16) NOT NULL DEFAULT 'system';
ALTER TABLE "admin_audit" ADD COLUMN IF NOT EXISTS "severity" varchar(8) NOT NULL DEFAULT 'info';
ALTER TABLE "admin_audit" ADD COLUMN IF NOT EXISTS "prev_hash" varchar(64);
ALTER TABLE "admin_audit" ADD COLUMN IF NOT EXISTS "hash" varchar(64);
CREATE INDEX IF NOT EXISTS "admin_audit_actor_idx" ON "admin_audit" ("actor_email", "at");
CREATE INDEX IF NOT EXISTS "admin_audit_target_idx" ON "admin_audit" ("target", "at");
CREATE INDEX IF NOT EXISTS "admin_audit_severity_idx" ON "admin_audit" ("severity", "at");

ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "channel" varchar(16) NOT NULL DEFAULT 'email';
ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "event" varchar(80);
ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "queued_at" timestamp with time zone;
ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;
ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "body_html" text;
ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "body_text" text;
CREATE INDEX IF NOT EXISTS "notification_log_event_idx" ON "notification_log" ("event", "sent_at");

/*
 * audit_events — one feed over every trail the suite writes.
 *
 * Normalized columns:
 *   id, source, at, category, action,
 *   actor_label (email or name), actor_id, actor_type (staff|client|system),
 *   target_label, target_id, target_type (staff|client|case|invoice|setting|booking|lead|conversation|system),
 *   severity (info|warn|bad|good), detail, ip, user_agent,
 *   old_masked, new_masked (settings diffs), meta (source payload)
 *
 * UNION ALL (not a materialized view) so the feed is live — a settings write
 * or a case comment shows up on the next poll without a refresh job.
 */
CREATE OR REPLACE VIEW "audit_events" AS
SELECT
	a.id,
	'admin' AS source,
	a.at,
	a.category,
	a.action,
	COALESCE(a.actor_email, 'system') AS actor_label,
	a.actor_id::text AS actor_id,
	a.actor_type,
	a.target AS target_label,
	NULL::text AS target_id,
	a.target_type,
	a.severity,
	a.detail,
	a.ip,
	a.user_agent,
	NULL::text AS old_masked,
	NULL::text AS new_masked,
	NULL::jsonb AS meta
FROM "admin_audit" a

UNION ALL

SELECT
	s.id,
	'settings',
	s.at,
	CASE
		WHEN s.key LIKE 'role:%' THEN 'Roles & Access'
		WHEN s.key ~* 'PAYSTACK|PAYMENT|FEE|PRICE|CURRENCY|RATE' THEN 'Financials'
		WHEN s.key ~* 'AUTH|MFA|SESSION|GOOGLE_(CLIENT|AUTH)|OAUTH|TOTP' THEN 'Authentication'
		ELSE 'Configuration'
	END,
	COALESCE(s.action, 'Updated ' || s.key),
	COALESCE(s.actor_email, 'system'),
	s.actor_id::text,
	'staff',
	s.key,
	NULL::text,
	'setting',
	'info',
	NULL,
	s.actor_ip,
	NULL,
	s.old_value_masked,
	s.new_value_masked,
	NULL::jsonb
FROM "settings_audit" s

UNION ALL

SELECT
	e.id,
	'invoice',
	e.at,
	'Financials',
	e.action,
	COALESCE(e.actor, 'system'),
	NULL::text,
	CASE WHEN e.actor ~ '@' THEN 'staff' ELSE 'system' END,
	e.invoice_id::text,
	e.invoice_id::text,
	'invoice',
	CASE
		WHEN e.action ~* 'refund|void|declin|fail' THEN 'bad'
		WHEN e.action ~* 'manual|write.?off|waive|edit|adjust' THEN 'warn'
		WHEN e.action ~* 'paid|settled|receipt' THEN 'good'
		ELSE 'info'
	END,
	e.detail,
	NULL, NULL, NULL::text, NULL::text, NULL::jsonb
FROM "invoice_events" e

UNION ALL

SELECT
	b.id,
	'booking',
	b.at,
	'Booking',
	b.type,
	COALESCE(b.actor, 'system'),
	NULL::text,
	'staff',
	b.booking_id::text,
	b.booking_id::text,
	'booking',
	CASE WHEN b.type ~* 'cancel|no_show|fail' THEN 'warn' ELSE 'info' END,
	b.payload::text,
	NULL, NULL, NULL::text, NULL::text, b.payload
FROM "booking_events" b

UNION ALL

SELECT
	l.id,
	'lead',
	l.created_at,
	'Clients',
	l.type,
	COALESCE(l.actor_name, 'system'),
	NULL::text,
	'staff',
	l.lead_id::text,
	l.lead_id::text,
	'lead',
	'info',
	l.payload::text,
	NULL, NULL, NULL::text, NULL::text, l.payload
FROM "lead_events" l

UNION ALL

SELECT
	c.id,
	'communication',
	c.created_at,
	'Case',
	c.action,
	COALESCE(c.actor_ops_user_id::text, c.actor_user_id, 'system'),
	COALESCE(c.actor_ops_user_id::text, c.actor_user_id),
	CASE WHEN c.actor_ops_user_id IS NOT NULL THEN 'staff' ELSE 'client' END,
	COALESCE(c.application_id::text, c.conversation_id::text),
	c.conversation_id::text,
	CASE WHEN c.application_id IS NOT NULL THEN 'case' ELSE 'conversation' END,
	'info',
	c.metadata::text,
	NULL, NULL, NULL::text, NULL::text, c.metadata
FROM "communication_events" c

UNION ALL

SELECT
	k.id,
	'case',
	k.at,
	'Case',
	k.kind || ': ' || left(k.text, 160),
	k.author_name,
	k.author_ops_user_id::text,
	'staff',
	k.target_id::text,
	k.target_id::text,
	'case',
	'info',
	k.text,
	NULL, NULL, NULL::text, NULL::text,
	jsonb_build_object('kind', k.kind, 'targetType', k.target_type, 'visibility', k.visibility)
FROM "case_comments" k
WHERE k.kind <> 'comment'

UNION ALL

SELECT
	ca.id,
	'consultation',
	ca.created_at,
	'Case',
	ca.type,
	COALESCE(ca.actor_name, 'system'),
	ca.actor_ops_user_id::text,
	CASE WHEN ca.actor_ops_user_id IS NOT NULL THEN 'staff' ELSE 'system' END,
	ca.consultation_id::text,
	ca.consultation_id::text,
	'case',
	'info',
	ca.payload::text,
	NULL, NULL, NULL::text, NULL::text, ca.payload
FROM "consultation_activities" ca

UNION ALL

SELECT
	st.id,
	'school',
	st.at,
	'Case',
	st.status::text,
	'system',
	NULL::text,
	'system',
	st.school_application_id::text,
	st.school_application_id::text,
	'case',
	CASE WHEN st.outcome::text ~* 'reject|declin|fail' THEN 'warn' ELSE 'info' END,
	st.note,
	NULL, NULL, NULL::text, NULL::text,
	jsonb_build_object('outcome', st.outcome, 'financialNote', st.financial_note)
FROM "school_track_events" st;

CREATE INDEX IF NOT EXISTS "case_comments_kind_at_idx" ON "case_comments" ("kind", "at");
