# Marketing

Production-backed email marketing: person-centric contacts, live segments,
consent + global suppression, block-composed campaigns, event/date-driven
automations. Ops UI is five URL-addressable tabs at
`/marketing?tab=campaigns|audiences|contacts|templates|automations`.

## The person model

The **person** is the record; a list is a membership.
`GET /marketing/contacts` aggregates people across mailing-list contacts,
applicants and leads — each row carries "in the suite as" identity
(applicant + case ref + chapter, or lead + stage), aggregated consent,
list/segment memberships, last engagement. `GET /contacts/{email}` is the
person page: suite identity, memberships split into lists (you put them
there) vs segments (live match), every campaign received with open/click.

**Duplicates**: one person with two memberships shows once — never two rows.

## Consent — earned, never fabricated

`marketing_optins` is the consent ledger per address: state, source
(`confirm_link`, `offline`, `import`…), timestamp, and the **required note**
for offline consent ("signed form at Kumasi fair · logged by E.F.").

Add-contact has exactly two doors — no silent "confirmed":

1. **Send a confirmation email** → `pending` → `opted_in` on click
   (double opt-in, token on `mailing_list_contacts`).
2. **They consented offline** → requires the audit note → `opted_in`.

CSV import is file → column mapping → **dry-run report** (`new · dupes
merged · invalid`) → the same consent decision applied to the batch.

## Suppression — global and send-time-checked

`marketing_suppressions` — one global list by address (unsubscribed /
bounced / complained). Unsubscribe on any channel writes it; the Resend
webhook writes it on `bounced`/`complained`. It's consulted **twice**:

- At **snapshot** (enqueue): only opted-in, unsuppressed contacts become
  pending recipients; others land as `skipped` rows with the reason.
- At **send time** (worker): consent is rechecked per row — someone who
  unsubscribes between schedule and send is skipped, not mailed.

## Segments — live audiences

`marketing_segments` holds `[{field, op, value}]` filters evaluated over the
suite's own data at **send time**, never copied:

- **Applicants**: chapter, branch, country, offer state, unpaid milestone,
  departure window, last activity
- **Leads**: stage, source, branch, booked/no-show
- **Contacts**: list membership, consent state

`POST /segments/preview` returns `matched · opted_in · never_asked ·
suppressed` + an 8-row sample — consent shown as *read*, never written.
A campaign's audience is a mailing list **or** a segment (never both);
`POST /campaigns/{id}/send` accepts either.

## Campaigns

`marketing_campaigns`: audience, subject, **block JSON** (heading ·
paragraph · button · divider · two-column), preheader, from-name, reply-to,
status (draft → scheduled → sending → sent / paused / cancelled),
counters derived from the ledger.

Pipeline:

1. **Snapshot** — `enqueueCampaignSend` freezes the audience into
   `campaign_recipients` (pending/skipped with reasons) and queues the job
   (delayed when scheduled).
2. **Send** — the `campaign` worker walks **pending rows only** (a retry
   never re-mails delivered recipients), merges fields, wraps links for
   click tracking, records outcome + `providerMessageId`.
3. **Signals** — the Resend webhook (Svix-signed) stamps `openedAt`,
   `bouncedAt`, complaint on the recipient row; `GET /c/{campaign}/{link}`
   redirects tracked clicks onto `campaign_links`.
4. **Report** — `GET /campaigns/{id}/report`: delivered/open/click/bounce/
   unsub rates, hourly timeline, top links, per-recipient ledger with
   sent/failed/pending filter + retry-failed.

Merge fields: `{{name}} {{first_name}} {{email}} {{date}} {{case_ref}}
{{stage}} {{officer}} {{branch}} {{next_due}} {{arrival_window}}
{{portal_link}} {{preferences_link}}` — built per recipient from real case
data. Every footer carries working per-contact unsubscribe + preferences
links (token minted lazily, or email+HMAC `key` from `BETTER_AUTH_SECRET`).

## Templates

`email_templates`: block JSON, preheader, from-name, reply-to, `usedFor`
(campaigns / automations / both), preset flag. Presets are read-only
starters — fork to customize. Header/footer are shared branded blocks with
the real unsubscribe/preferences links. One `emailLayout` renders
everything — campaigns look like transactional mail.

## Automations

`marketing_automations` — `event → segment → template → delay`:

- **Event intake** — `emitAutomationEvent` from domain moments: visa
  approved, offer received, assessment complete, consultation no-show,
  milestone overdue.
- **Date triggers** — the `automationSweep` worker scans daily (e.g.
  departure −30 days).
- **Firing log** — `automation_sends` rows: recipient, sent or skipped
  (with reason — unsubscribed, suppressed, already-sent).
- Seven seeded starters ship as **drafts** (no-show follow-up,
  assessment-done-not-enrolled day 3/10, offer received, visa approved
  pre-departure guide, departure −30, milestone overdue day 3) — staff
  flip them live deliberately.

## Newsletter (public)

`POST /newsletter/subscribe` → `GET /confirm` (double opt-in) ·
`GET /unsubscribe` (contact token or email+HMAC key — writes the global
suppression) · `GET/POST /preferences` (email+key: list memberships,
re-opt-in). Portal surfaces: `/newsletter/confirm`, `/unsubscribe`,
`/preferences`.

## Ops surfaces

- **Campaigns** — queue + filters + per-row open/click rates, report pane
  (tiles, hourly bars, top links, recipient ledger), compose sheet
  (audience → template → subject → blocks → server preview → test send →
  send/schedule with timezone).
- **Audiences** — segment builder (entity pick, condition rows, live
  preview), mailing lists, suppression table.
- **Contacts** — person table, duplicates view, detail/history, add-contact
  sheet, CSV import/export.
- **Templates** — miniature-rendering cards, fork/duplicate, new-template
  flow, the same block composer, warning when a live automation uses it.
- **Automations** — table + starters, draft→live, edit sheet, send log.
