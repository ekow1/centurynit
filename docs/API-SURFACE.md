# API Surface

All routes are OpenAPI-documented via `@hono/zod-openapi` — the interactive
reference at `/api/docs` is generated from the same zod schemas that validate
requests, so it cannot drift. Raw document: `/api/openapi.json`. Better Auth
documents its own routes separately at `/api/auth/reference`; `/api/docs`
merges the two.

Prefixes:

- `/api/v1/*` — versioned resource API (`API_PREFIX`)
- `/api/auth/*` — Better Auth (unversioned)
- `/api/webhooks/*` — provider webhooks (unversioned)
- `/api/health` — liveness

Guard notation: `A` = requireAuth (any signed-in user) · `S` = requireStaff ·
`M:x` = requireModule("x") · `C:x` = requireCapability("x") · `MFA` = requireMfa.

## System

| Route | Guards | Purpose |
|---|---|---|
| `GET /api/health`, `GET /api/health/detail` | — | Liveness + dependency detail |
| `POST /api/webhooks/paystack` | signature | Payment settlement (server-side authority) |
| `POST /api/webhooks/resend` | Svix | Delivery/open/bounce/complaint events → recipients + suppressions |

## Client self-service — `/me` (`A`, client)

Identity, journey, money, and the client's own conversation. Key routes:

- `GET /me/identity` — who am I (profile + applicant)
- `GET /me/application` — current (newest) case; `PUT /me/application`
- `GET /me/journey` — **derived** journey: gathers facts → `deriveJourney()`
- `POST /me/application/consent`, `/me/application/visa/consent`,
  `/me/application/travel/consent`, `GET /me/application/consent/{stage}` —
  the stage-consent state machine (client side)
- `POST /me/application/package`, `/payment-plan`, `/stage-intake` —
  enrolment choices (transactional package selection)
- `GET/POST /me/application/continuation`, `…/withdraw` — continue past a
  reached stage
- `GET /me/invoices` (+ `/{id}/pdf`, `/{id}/accept`) — only the **current**
  case's invoices + the consultation invoice
- `POST /me/invoices/{id}/paystack/checkout`, `…/paystack/verify`,
  `GET /me/paystack/config` — Paystack checkout + verify
- `POST /me/invoices/{id}/momo`, `…/momo/otp`, `GET …/momo/{reference}` —
  mobile-money path
- `GET/PUT/DELETE /me/autopay` — stored-authorization instalment consent
- `GET /me/ledger`, `POST /me/application/agency-payment`
- `GET /me/application/post-arrival-schedule`, `POST /me/application/complete`
- `POST /me/application/pre-departure/{taskId}` — checklist evidence
- `GET/POST /me/application/travel-assistance`, `POST …/decision`
- `POST /me/application/consultation/respond` — reschedule-request response
- `GET/POST /me/change-email/*` — two-step verified email change
- `GET/PUT /me/notification-preferences`; `GET /me/notifications`,
  `PATCH /{id}/read`, `POST /read-all`
- `GET/POST /me/conversation`, `…/messages`, `POST …/attachments` — the
  client-side helpdesk thread
- `GET/PUT /me/portal-state` — per-account UI state sync
- `POST /me/avatar`, `/avatar/upload-url`, `/avatar/complete` — avatar pipeline

## Bookings & scheduling

`/bookings` (`S`): `GET /availability/days`, `/availability` ·
`POST /checkout`, `POST /verify-payment` (client) · `GET /` list ·
`GET /meetings/live` · `GET /employees` · `GET /{id}` ·
`POST /{id}/cancel|reschedule|assign|complete|no-show|resend-meeting-link` ·
`GET /{id}/meeting-url` · `POST /{id}/generate-meet`, `GET /{id}/join` ·
`POST/GET /{id}/reschedule-request`, `POST /{id}/reschedule-decision` —
staff approval of client reschedule requests.

`/scheduling` (`S M:scheduling`): branch slot config — per-weekday hours,
interval, daily cap, timezone.

`/calendar` (`S`): company calendar consent/callback/status/disconnect;
`GET/POST/DELETE /feeds/me`, `POST /feeds/sync` (inbound iCal);
`GET/PUT /working-hours`, `GET /working-hours/staff`, `GET /branch-slots`;
`GET /feeds/outbound/{token}` (public busy feed); `GET/POST/DELETE
/subscription` + `POST /subscription/regenerate`.

## Consultations — `/consultations` (`S M:consultations`)

`GET /` queue · `GET/POST /duty` (roster) · `GET /workload` · `GET /{id}` ·
`POST /{id}/assign`, `/refer` · `POST /{id}/confirm-slot` ·
`POST /{id}/start-assessment`, `/complete-assessment` ·
`GET/POST /{id}/comments` · `POST /{id}/request-documents` ·
`POST /{id}/cancel`, `/rebook-credit`, `/no-show`-adjacent via bookings ·
`POST/DELETE /{id}/delegate`, `POST /{id}/back-to-confirmed`, `/reclaim` —
the coordination-grant lifecycle · `GET /{id}/activity`.

## Cases — `/applications`, `/me/application`, `/cases`

`/applications` (`S M:applications`): `GET /` list+board · `GET /{id}` ·
`GET /{id}/activity` · `PUT /{id}` · `POST /{id}/package` ·
`POST /{id}/assign` (`C:assign_work`) · `GET /{id}/team` ·
`POST /{id}/seats/{seat}/release`, `POST /{id}/claim` ·
`POST /{id}/refer` · `GET /{id}/application-invoice-preview`,
`POST /{id}/raise-application-invoice` · same pair for visa ·
`POST /{id}/stage` (gate-checked) · `POST /{id}/continuations/{requestId}` ·
`GET/POST /{id}/meetings` · `GET /{id}/checklist`,
`POST /{id}/pre-departure/{taskId}` (verify/waive) ·
`POST /{id}/visa-stage`, `/{id}/visa-details` ·
`POST /{id}/release-override` (`C:issue_invoices`) ·
`POST /{id}/departure-details` · `POST /{id}/post-arrival-schedule` +
`/review` (`C:approve_schedules`) · `GET /{id}/ledger` ·
`GET/POST /{id}/comments` · `POST /{id}/request-documents`.

`/me/application` (`A`, client side — see Client section) and
`/cases` (`S`): `POST /quotation` · `POST /{id}/proceed`,
`/{id}/proceed/decline`, `/{id}/propose-stage`, `/{id}/proceed/reinvite`
— the ops side of the consent state machine; client side:
`POST /me/application/proceed`, `/proceed/decline`, `/proceed/hold`.

`/handoffs` (`S`): `GET /handoffs` open boundary gates ·
`GET /handoffs/{id}` · `POST /{id}/resolve` (`C:assign_work`) ·
`POST /{id}/defer`.

`/team` (`S`): `GET /assignments` — caseload matrix for managers.

`/tasks` (`S`): `GET/POST /`, `PATCH /{id}` — ops to-dos.

## Schools & admissions — `/me/schools`, `/schools`

Client (`A`): `GET /me/schools` choices · `POST /me/schools` add ·
`POST /me/schools/lock` · `POST /me/schools/{id}/accept` (accept an offer).

Staff (`S M:applications`): `GET/POST /schools` · `GET/PUT /schools/{id}` ·
`POST /schools/{id}/status` (track events) ·
`GET /schools/{applicantId}` · `GET/POST /schools/{applicantId}/scholarships`,
`DELETE …/scholarships/{scholarshipId}`.

## Money — `/invoices`, `/payments`, `/fees`, `/packages`, `/departure`

`/invoices` (`S M:invoices`): `GET/POST /` · `GET /{id}` ·
`GET /{id}/payments` · `POST /{id}/issue` (`C:issue_invoices`) ·
`POST /{id}/void`, `/{id}/credit`.

`/payments` (`S M:payments`): `POST /initialize` ·
`GET /verify/{reference}` · `GET /paystack/transactions` ·
`POST /reconcile-paystack` · `POST /send-receipt`.
(`POST /api/webhooks/paystack` is the settle authority, not this router.)

`/fees` (`S M:finance`): `GET /` fee schedule · `GET/POST /items` ·
`PUT /items/{key}` · `GET/PUT /destinations/{id}` tariffs.

`/packages` (`S M:packages`; `C:edit_packages` to write): `GET /`, `/all`,
`/{code}` · `POST /`, `PUT /{code}`, `DELETE /{code}`.

`/departure` (`S`): `GET/PUT /template` per-destination checklist ·
`GET/PUT /destinations/{id}`.

`/travelAssistance` (`S`): `GET /travel-assistance` ·
`GET /{id}/travel-assistance` · `POST /travel-assistance/{id}/assign`,
`…/invoice`, `…/booking`.

## CRM

`/leads` (`S M:leads`/`crm`): `GET/POST /` · `GET/PUT /{id}` ·
`GET /{id}/events`, `POST /{id}/touches`.

`/applicants` (`S M:applicants`): client records search/detail.

`/client-users` (`S M:users`): `GET /` accounts · `GET /{id}/context` ·
`POST /{id}/ban`, `/unban`, `/revoke-sessions` (`C:manage_clients`) ·
`GET /{id}`, `GET /sessions`.

## Chat & helpdesk — `/chat`, `/communication`, `/me/communication`

`/chat` (`S requireAnyModule("helpdesk","chat")`): `GET/POST /conversations` ·
`GET /conversations/{id}` · `GET/POST /{id}/messages` ·
`POST /{id}/status`, `/owner`, `/read` · `GET /{id}/context`,
`POST /{id}/attachments` · `GET/POST /{id}/participants` ·
`GET /unread` · `GET /staff-directory` ·
`PATCH/DELETE /messages/{messageId}` · `POST /{id}/reactions`, `/forward` ·
`POST /{id}/typing` · `GET /requests` (helpdesk queue) ·
`POST /{id}/waiting-on`, `/{id}/escalate` ·
`GET/POST /canned-replies`, `DELETE /{id}` · `GET /desk/stats`.

`/communication` (`S`): the Communication Hub — `GET /context` ·
`GET /conversations` · `POST /route` · `GET/POST /{id}/messages` ·
`POST /{id}/attachments`, `/read`, `/rate` · `GET /requests` ·
`GET /staff-directory` · `GET /presence`, `POST /heartbeat` ·
`GET/POST /stage-assignments`.

`/me/communication` (`A`): the client's side of the same thread system.

## Notifications & events — `/notifications`, `/push`, `/events`

`/notifications`: `GET /log`, `/catalogue`, `GET /log/{id}`,
`POST /log/{id}/resend` (ops) · `GET /health` ·
`GET/PUT /preferences` · `GET /ops`, `PATCH /ops/{id}/read`,
`POST /ops/read-all` (staff feed).

`/push` (`A`): `POST/DELETE /subscribe` · `GET /vapid-public-key`.

`/events` (`A`): `GET /stream` — **SSE domain-event stream** (stage,
assignment, invoice, visa events) driving the portal's push updates;
`GET /unread-count`, `GET /`, `PATCH /{id}/read`, `POST /read-all`.

## Marketing — `/marketing`, `/newsletter`

`/marketing` (`S M:marketing`):
- Campaigns: `GET/POST /campaigns` · `GET/PUT /campaigns/{id}` ·
  `POST /{id}/send` (list **or** segment audience) · `/preview` (body or
  blocks) · `/test` · `/schedule`, `/cancel` · `GET /{id}/recipients` ·
  `GET /{id}/report` (totals, top links, hourly timeline) ·
  `POST /{id}/retry-failed`, `/duplicate`.
- Audiences: `GET/POST /segments` · `PUT /segments/{id}` ·
  `POST /segments/preview` (live matched/opted-in/never-asked/suppressed +
  sample) · `DELETE /{id}`.
- Lists: `GET/POST /mailing-lists` (→ `{ mailingLists }`) ·
  `GET /{id}/contacts` · `POST /{id}/contacts`, `/import`, `/confirm` ·
  `POST /{id}/contacts/{contactId}/resend-confirmation`, `/unsubscribe`.
- Contacts (person-level): `GET /contacts` (+ `?email=` exists check) ·
  `GET /contacts/{email}` (detail + campaign history) · `POST /contacts`
  (add with consent door) · `POST /contacts/import` (CSV, dry-run report) ·
  `GET /contacts/export` (CSV) · `POST /contacts/{email}/optin`.
- Suppressions: `GET/POST /suppressions` · `DELETE /{id}`.
- Templates: `GET/POST /templates` · `GET/PUT/DELETE /{id}` (blocks,
  preheader, fromName, replyTo, usedFor persist).
- Automations: `GET/POST /automations` · `PUT /{id}`, `POST /{id}/status` ·
  `GET /{id}/sends` (firing log).

`/newsletter` (public): `POST /subscribe`, `GET /confirm` (double opt-in) ·
`GET /unsubscribe` (token **or** email+HMAC key — also writes a global
suppression) · `GET/POST /preferences` (email+key; lists memberships,
re-opt-in) · `GET /c/{campaignId}/{linkId}` click redirect.

## CMS — `/cms` + public content reads

Public (`contentRouter`, edge-cacheable, no auth):
`GET /api/v1/brand.json` · `GET /api/v1/content/{collection}[/{slug}]` ·
`GET /api/v1/nav/{surface}` (header|footer) · `GET /api/v1/copy?surface=` ·
`GET /api/v1/media/{key}` → 302 signed URL.

Admin (`/cms`, `S M:cms`): `GET/PUT /brand` · `POST /brand/publish`,
`/brand/revert` · `GET /brand/history` · `GET/POST /entries` ·
`POST /entries/{id}/status`, `/entries/{id}/revert` ·
`GET /entries/{collection}/{slug}/history` · `GET /media`,
`POST /media/upload-url`, `POST /media`, `PATCH /media/{id}` ·
`GET/PUT /nav/{surface}` · `GET/PUT /copy`.

## Administration — `/staff`, `/roles`, `/settings`, `/lookups`, `/catalog`, `/auth-settings`

`/staff` (`S`): `GET/POST /invitations`, `DELETE /{id}`,
`POST /{id}/resend`, `GET /preview`, `POST /accept` ·
`POST /bootstrap` (one-time, `BOOTSTRAP_TOKEN` — refuses once staff exist) ·
`GET /mfa` · `GET /`, `GET/PUT /{id}` · `GET /auth-stats`,
`GET /sessions`, `DELETE /sessions/{sessionId}` ·
`POST /{id}/revoke-sessions` · `GET/POST/DELETE /{id}/coordination-grant`.

`/roles` (`S M:users`, `C:manage_roles` to write): `GET/POST /` ·
`PUT/DELETE /{id}` — custom roles with permission lists + rank.

`/settings` (`S M:settings`): `GET/PUT /` platform config ·
`POST /step-up` · `GET /ops-config` · `GET /audit`, `/admin-audit`,
`/audit/events`, `/audit/export`, `/audit/related`, `/audit/verify`
(hash-chain check) · `GET/POST /alert-rules` · `GET /storage-check` ·
`GET/PUT /auth-policy` · `POST /auth/unlock`.

`/auth-settings` — client-facing read of enabled sign-in methods.

`/lookups` (`S M:lookups`): dynamic form dropdown values.
`/catalog` (public + staff): universities/programmes/scholarships/
destinations reads + staff edits (`C:edit_universities`).

## Error shape

Routes throw `HttpError(status, code, message)`; responses are
`{ error: { code, message } }`-style JSON. Validation failures are 400 with
zod issues. Unhandled errors are 500 `INTERNAL` and logged — the request
path never leaks stack traces.
