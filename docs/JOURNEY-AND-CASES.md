# Journey & Cases

The applicant journey is the domain spine — every other subsystem
(payments, documents, chat, notifications, marketing) hangs off it.

## Two representations of "where the client is"

### The coarse stage — stored

`applications.stage`, seven values:

```
document_verification → school_submission → offer_letter_review
  → visa_processing → travel_assistance → payment_execution → completed
```

Written by staff through `POST /applications/{id}/stage`, which checks the
gate rules (e.g. cannot enter `visa_processing` before fees settle). The
stage acts as a **floor**: it can push a client forward, never backward.

### The fine step — derived, never stored

`GET /me/journey` gathers the facts about the applicant's **current**
application — consent, deposit, handler, locked schools, invoice statuses,
admissions, visa, travel assistance, plan — and hands them to
`deriveJourney()` in `packages/shared/src/journey.ts`. That function is pure
and table-tested (`services/journey.test.ts`); read it before touching
anything that decides where an applicant stands.

A step is never skipped silently: if later evidence exists (an admission, a
paid visa) earlier un-ticked steps render as "skipped", not done.

## Scoping: the current application

A client may have several `applications` rows (returning clients). Almost
everything reads by `application_id`, never by applicant or client user —
a returning client's earlier case cannot leak paid invoices, admissions, or
documents into the new one. `GET /me/invoices` returns only the current
case's invoices plus the consultation invoice.

## Consent — one state machine

`applications.proceedStatus`, changed only by
`accept/pause/declineProceedForApplication`. The client reaches it via
`POST /me/application/consent`; the ops side via `/cases/{id}/proceed*`.
Staff cannot push a client past a consent they haven't given. Per-stage
consents (`stage_consents`) gate individual chapters — the visa chapter
opens only after the client's explicit visa consent.

## Assignments — append-only ownership

- **`case_assignments`** — who owns the case now is the un-ended row;
  reassignment ends the old row, never overwrites. Denormalized name fields
  are display cache only.
- **`stage_assignments`** — per-chapter seats (consultant, visa officer,
  travel officer). Each chapter's assign control only offers staff with the
  matching `own:*` capability (`ownershipCapabilityFor(stage)`).
- **`case_comments`** — staff comments on the file.
- **`coordination_grants` + `coordinator_duty`** — a consultant can
  delegate a consultation to a colleague and reclaim it; a daily duty-coordinator
  roster exists per branch.

## Handoffs — hard boundary gates

`stage_handoffs` parks a case at a boundary until a manager resolves
(`C:assign_work`) or defers it. Crossing into `travel_assistance` or
`payment_execution` hard-gates. The 10% deposit auto-creates the first
handoff — "Pending Handler Assignment" — so deposit payment is the trigger
for the school-submission handler.

## Stage pricing & entry points

Service packages (`service_packages`) are DB-backed and stage-priced: a
client can enter at different service stages, select only needed services,
stop after any reached stage, and later request continuation
(`stage_continuation_requests` → ops decision via
`POST /applications/{id}/continuations/{requestId}`). Package selection is
transactional — `POST /me/application/package` writes package + plan
atomically.

## Per-school tracking

`school_applications` rows move preparing → submitted → decision
(admitted / waitlisted / unsuccessful), each transition appended to
`school_track_events`. The client locks school choices, watches live
tracking, and accepts one offer (`POST /me/schools/{id}/accept`) — the
moment that feeds marketing automations and the journey.

## Documents

`applicant_documents`: client uploads via presigned URLs → staff verify or
reject with a note → checklist progress updates the journey on both sides.
Staff can request specific documents by name (`request-documents`).
Rejected uploads are purged on a TTL by the `documentCleanup` worker
(`REJECTED_DOCUMENT_TTL_DAYS`). Storage is a private Supabase bucket —
access only via API-minted signed URLs (`GET /documents/{id}/download`).

## Pre-departure & release

- **Checklist** — per-destination template (`departure` routes); the client
  uploads evidence per task, staff verify or waive with a reason.
- **Release** — official documents (admission letter, visa papers,
  e-ticket) unlock when the checklist + fee milestone complete.
  `POST /{id}/release-override` is the emergency unlock (manager + finance,
  `C:issue_invoices`).
- **Travel assistance** — `travel_assistance_requests`: Century-books vs
  own-booking, flight details, assigned officer, its own invoice.

## Post-arrival

Post-arrival instalment schedule is aftercare, never a gate — the client
proposes dates (`POST /me/application/post-arrival-schedule`), a manager
or finance reviews (`C:approve_schedules`), and autopay charges on the
stored authorization.

## Continuations

`stage_continuation_requests` — when a client who stopped after a reached
stage asks to continue. The portal raises it, ops decides; language
throughout reflects the real business model (branch, handler, coverage,
handoff).
