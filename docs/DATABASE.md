# Database

PostgreSQL via Drizzle ORM. The whole schema lives in one file —
`century-nit-api/src/db/schema.ts` — ordered by domain. 84 tables.

## Posture

- **RLS on everything.** Every table has `ENABLE` + `FORCE` row-level
  security with no permissive policies. The API connects as the table owner
  and bypasses it; the point is that any future non-owner path (Supabase
  data API, BI tool, another service) is denied by default rather than
  silently open. A suite test (`db/rls.test.ts`) sweeps `pg_tables` and
  fails if any table lacks RLS — new tables are caught by CI.
- **Append-only where it's evidence.** `admin_audit`, `invoice_events`,
  `booking_events`, `case_assignments`, `lead_events`,
  `school_track_events`, `consultation_activities`, `settings_audit`,
  `cms_versions`, `automation_sends`, `campaign_recipients` are written and
  never updated. Corrections append a new row.
- **Integer cents** for money (`amount_cents` etc.); `timestamptz` for time;
  `uuid` PKs throughout.
- **Cascade discipline**: references into `users`/`ops_users` are
  `onDelete: "set null"` where history must survive a deleted account, and
  `cascade` where a child row is meaningless alone (line items, recipients).

## Tables by domain

### Identity & access

| Table | Holds |
|---|---|
| `users` | Every login — clients and staff (Better Auth). Email, phone, MFA flags (`twoFactorEnabled`, `mfaEnrolled`, `mfaMethod`), ban state, avatar. |
| `sessions` | Better Auth sessions (cookie token → user, expiry, IP/UA). |
| `accounts` | OAuth + credential accounts (Google link, password hash). |
| `verifications` | OTP/verification tokens (email codes, phone codes, resets). |
| `two_factors` | TOTP secrets + backup codes. |
| `auth_settings` | Platform auth policy: enabled methods, session TTL, per-role MFA policy. |
| `ops_users` | The staff record — `user_id` → role, branch, active flag. A user without this row is a client. |
| `ops_roles` | Custom roles: name, rank, `permissions[]` (modules + capabilities side by side). Built-in roles fall back to the shared matrix when no row exists. |
| `staff_invitations` | Pending staff invites: email, role, branch, token, expiry, inviter. |
| `staff_presence` | Last-seen heartbeat for staff chat presence. |

### The applicant journey & casework

| Table | Holds |
|---|---|
| `applicants` | Client profile (extends `users`): passport data, education history, preferences, marketing opt-in stamp. |
| `applications` | One engagement — a case. `stage` (7 coarse stages), `proceedStatus` (client consent), package/plan, branch, handler, current application pointer logic lives on the newest row per client. |
| `consultations` | A consultation booking's lifecycle: mode (online/in-person), branch, consultant, assessment outcome, reschedule state, no-show/rebook credit. |
| `bookings` | The slot itself: staff, time, branch, meeting provider/URL, join window, status. |
| `booking_events` | Append-only booking lifecycle log. |
| `consultation_activities` | Append-only activity feed on a consultation. |
| `case_assignments` | Append-only ownership history — who owns the case *now* is the un-ended row. Denormalized name fields are display cache. |
| `case_comments` | Staff comments on a case. |
| `stage_assignments` | Per-chapter ownership: consultant / visa officer / travel officer seats on a case. |
| `stage_consents` | The client's Confirmed / On hold / Declined per stage — gates stage entry. |
| `stage_handoffs` | Hard boundary gates (deposit → handler assignment; into travel/payment stages) — parked until a manager resolves or defers. |
| `stage_continuation_requests` | Client request to continue past a reached stage (entry-point-aware plans). |
| `school_applications` | Per-school submission inside a case: preparing → submitted → decision (admitted/waitlisted/unsuccessful). |
| `school_track_events` | Append-only per-school status timeline. |
| `travel_assistance_requests` | Departure help: Century-books vs own-booking, flight details, officer. |
| `leads` | CRM pipeline: enquiry source, stage, branch, contact data. |
| `lead_events` | Append-only lead touches/stage moves. |
| `ops_tasks` | Staff to-dos (manual + system-raised). |
| `coordinator_duty` | Duty-coordinator roster: which coordinator is on point per branch per day. |
| `coordination_grants` | Temporary delegation of a consultation to a colleague (reclaimable). |

### Money

| Table | Holds |
|---|---|
| `invoices` | Proforma → issued → (partially) paid → settled/voided/credited. Number sequences, due dates, payer, linked case/booking. |
| `invoice_lines` | Line items (fee key, description, qty, cents). |
| `invoice_payments` | Payment records against an invoice (gateway ref, method, cents). |
| `invoice_events` | Append-only invoice lifecycle (raised, issued, voided, credited, settled…). |
| `payment_transactions` | Gateway-level record (Paystack reference, channel, status, raw meta). |
| `payment_authorizations` | Stored reusable Paystack authorizations for instalment autopay. |
| `autopay_attempts` | Append-only autopay charge attempts per instalment. |
| `service_packages` | DB-backed service packages: stage-priced, entry-point-aware, per-destination pricing. |
| `fee_definitions` | The service-fee catalogue (what a fee line *is*). |
| `fee_items` | Third-party fee items (visa fees, school app fees) with amounts. |
| `destinations` | Country catalogue: tariffs, departure checklist template, images, SEO. |

### Documents

| Table | Holds |
|---|---|
| `applicant_documents` | Document records: storage key, type, status (uploaded → verified/rejected + note), requested-by name, linked case/task. |

### Scheduling

| Table | Holds |
|---|---|
| `staff_working_hours` | Per-weekday availability windows per staff member — drives what clients can book. |
| `staff_calendar_feeds` | Inbound iCal feed URLs per staff member (busy mirroring). |
| `staff_calendar_accounts` | Outbound company-calendar consent records. |
| `calendar_busy_blocks` | Mirrored busy intervals from feeds — availability subtracts these. |

### Chat & helpdesk

| Table | Holds |
|---|---|
| `conversations` | One thread — client↔staff (helpdesk, scoped to case/stage) or staff↔staff (DM/group). Subject, category, priority, waiting-on, audience, first-response/resolved stamps, CSAT. |
| `conversation_participants` | Membership + per-user read cursor. |
| `messages` | Chat messages (body, sender, reply-to, forward-of, edited/deleted flags). |
| `message_attachments` | File refs on messages. |
| `message_mentions` | @mention links for notifications. |
| `message_reactions` | Emoji reactions. |
| `communication_events` | Append-only conversation lifecycle (routed, assigned, escalated, resolved, rated). |
| `canned_replies` | Staff quick-replies (RLS-locked, migration 0113). |

### Notifications

| Table | Holds |
|---|---|
| `notifications` | In-app notification rows (kind, payload, read flag, audience: staff vs client-safe). |
| `notification_log` | Delivery log — every channel attempt per notification (email/push/in-app, status, provider id). |
| `notification_preferences` | Per-user opt matrix (event kind × channel). |
| `push_subscriptions` | Web-push endpoints per user agent. |

### Marketing

| Table | Holds |
|---|---|
| `mailing_lists` | Named lists (one is the newsletter list). |
| `mailing_list_contacts` | Membership: email, name, consent status (pending/confirmed/unsubscribed), confirm token, source. |
| `marketing_optins` | Consent ledger per address — opt-in state, source, when, note (the audit trail for offline consent). |
| `marketing_suppressions` | Global suppression: unsubscribed / bounced / complained — checked at snapshot **and** at send time. |
| `marketing_segments` | Saved live filters `[{field, op, value}]` over applicants/leads/contacts — evaluated at send, never copied. |
| `marketing_campaigns` | Campaign: audience (list xor segment), subject, blocks, preheader, from-name, reply-to, status, schedule, counters. |
| `campaign_recipients` | Snapshot ledger — one row per person per campaign, per-recipient outcome + provider id + open/click stamps. |
| `campaign_links` | Tracked links per campaign → original URL, click count. |
| `email_templates` | Templates: block JSON, preheader, from/reply, used-for (campaigns/automations), preset flag. |
| `marketing_automations` | Event → segment → template → delay rules; live/draft status. |
| `automation_sends` | Append-only automation firing log (recipient, skipped reason or sent). |

### CMS (migration 0114)

| Table | Holds |
|---|---|
| `cms_brand` | Singleton identity record: `draft` + `published` JSON, version, publisher. |
| `cms_entries` | Content entries per collection+slug: status (draft/review/published), payload JSON, SEO, schedule. |
| `cms_nav` | Header/footer link lists per surface. |
| `copy_keys` | Fine-grained copy strings keyed by `key` per surface (site/portal/console/email). |
| `media` | Media library metadata — storage key, mime, size, dimensions, alt, focal point. |
| `cms_versions` | Append-only version history for brand and entries (revert source). |

### Catalogue & configuration

| Table | Holds |
|---|---|
| `catalog_universities` | University directory (destination, image, SEO, hero media). |
| `catalog_programs` | Programmes per university: intake, fees, entry requirements, curriculum, career outcomes, scholarships, SEO. |
| `catalog_scholarships` | Scholarship entries: amount, criteria, deadline, SEO. |
| `student_scholarships` | Scholarship awarded to a specific applicant. |
| `lookup_values` | Dynamic dropdown values for forms (grouped by key). |
| `platform_settings` | Singleton-ish key config: integrations, exchange rate, toggles. |
| `settings_audit` | Append-only config-change trail. |
| `admin_audit` | **Hash-chained** admin audit — every row seals the previous row's hash over its canonical content; `verify` endpoint replays the chain to prove nothing was edited or deleted. |

## Migrations

`century-nit-api/drizzle/` holds numbered `.sql` files + `drizzle/meta/_journal.json`.
The chain was grown by hand and generator side by side and **does not replay
from zero** — use `npm run db:fresh` on a new database (builds from
`schema.ts` + the pieces Drizzle can't express: `btree_gist`, the
double-booking exclusion constraint, the RLS sweep, trigger migrations) and
`npm run db:migrate` on a database with data.

Hard rules:

- Never `ALTER TYPE … ADD VALUE` and use the new value in the same migrate
  run — Drizzle applies pending files in one transaction and Postgres
  refuses. Recreate the type instead.
- Journal `when` values must strictly increase — Drizzle skips any entry not
  newer than the last applied.
- New tables must ship RLS in the same migration — the sweep test enforces it.
- Migrations that touch prod should be idempotent (`IF NOT EXISTS`,
  `ON CONFLICT`) — prod has drifted before and re-runs must be safe.
