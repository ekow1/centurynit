# Century NIT — Backend API Migration Plan

**Status:** partially started · **Audience:** whoever implements this, in any
order the phases allow

> **The target in this document is out of date.** It was written for Hono +
> Zod/OpenAPI on **Cloudflare Workers with Neon and Hyperdrive**. What was
> actually built in `century-nit-api/` is **Node + `@hono/node-server`, Docker
> Postgres, Drizzle, Better Auth, BullMQ and Resend**, deployed as a container.
> The phasing, data model and endpoint inventory below all still apply — read
> §2's diagram as intent, not as the deployment.

### Progress against the phases

| Phase | State |
|---|---|
| 0 — Repository seam | **Not started.** The UI still mutates context state directly, except appointments (server-backed via `packages/core/src/api.ts`). |
| 1 — zod-openapi + Scalar | **Done.** `@hono/zod-openapi` drives every route; spec at `/api/openapi.json`, error envelope + request IDs in place. |
| 2 — Auth *(gate)* | **Partial.** Better Auth covers applicants *and* staff (`seed:staff` links `ops_users` to logins). Role middleware exists for bookings (`requireAuth`/`requireStaff`/role checks + row scoping). Still missing: a generalized server-side `ROLE_PERMISSIONS` module guard for future endpoints. |
| 3 — Content | Not started. |
| 4 — Invoices & payments | Not started. No tables, no endpoints, no payment provider. |
| 5 — Consultations & applications | **Partial — scheduling is done.** Bookings, availability, manager assignment, Google Calendar/Meet, reschedule/cancel, notifications and calendar-retry queues all live in Postgres behind the API, wired into both frontends. Applications/school tracks remain browser-only. |
| 6 — Tickets, notifications, documents | Not started. `lib/r2.ts` builds an S3 client that nothing uses. Booking *email* notifications are real (Resend + BullMQ). |
| 7 — Retire the simulation | Correctly blocked on the above. |

**Data model:** 10 tables exist — the 5 identity tables (`users`, `sessions`,
`accounts`, `verifications`, `ops_users`) plus the scheduling slice
(`bookings`, `booking_events`, `staff_calendar_accounts`,
`staff_working_hours`, `calendar_busy_blocks`). Double-booking is enforced in
the database (partial unique index + GiST exclusion constraint).

**Endpoints:** ~15 of ~70 — `/api/health`, `/api/auth/*`, the full
`/api/bookings/*` lifecycle and `/api/calendar/*` (Google OAuth connect,
webhook, status).

**Workers:** `worker/main.ts` runs the email + calendar BullMQ workers
(`npm run worker --workspace=century-nit-api`). They are not optional — see the
root README.

---

## 1. Where we are

The application is a complete, working product with **no server**. Every piece of
state lives in the browser.

| | Today |
|---|---|
| Worker | Reverse-proxies `/api/*` to the Node API (`redirect: "manual"`, Location rewritten, client IP forwarded) |
| Hono | already a dependency (4.11.1) |
| API routing | `wrangler.json` already sets `run_worker_first: ["/api/*"]` |
| Persistence | 18 `localStorage` keys, all writes guarded via `lib/storage.ts` |
| Mutations | **104** — 62 ops, 42 portal |
| Domain types | **~70** exported TypeScript types |
| Applicant auth | Better Auth, real — email/password, optional Google |
| Staff auth | **none** — `/ops/login` is a role picker with no password |
| Cross-tab sync | `OpsDirectiveBridge` polls `localStorage` and dedupes by timestamp |

**The schema already exists.** `Invoice`, `SchoolApplicationTrack`, `Lead`,
`MockConsultation`, `InternalTicket` and ~65 other types are fully specified and
proven through the UI. This is a persistence and authorization exercise, not a
data-modelling one.

### The one thing that is not a migration task

`ROLE_PERMISSIONS` is enforced **in React only**. Anyone can open devtools and
grant themselves `admin`. That is acceptable for a prototype and unacceptable the
moment a server holds real data. Phase 2 exists to close this, and no phase that
exposes applicant data should ship before it.

Since this was written, every `/ops/*` route runs `OpsRequireModule` so the
matrix at least gates navigation rather than only the sidebar. That closes the
accidental case — a consultant typing `/ops/system` — and nothing more. The
sentence above still stands in full.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React SPA (unchanged UI)                                   │
│    repositories/  ← seam: localStorage today, fetch later   │
└───────────────────────────┬─────────────────────────────────┘
                            │  /api/*
┌───────────────────────────▼─────────────────────────────────┐
│  Cloudflare Worker — Hono                                   │
│    @hono/zod-openapi   routes + validation + spec           │
│    Scalar              /api/docs                            │
│    middleware          JWT · role guard · audit             │
└───────────────────────────┬─────────────────────────────────┘
                            │  Hyperdrive (pooling)
┌───────────────────────────▼─────────────────────────────────┐
│  Neon Postgres          ~14 tables                          │
│  Cloudflare R2          document uploads                    │
└─────────────────────────────────────────────────────────────┘
```

### Swagger is generated, never written

One Zod schema per resource produces four artefacts:

```
Zod schema ──┬─→ runtime request/response validation
             ├─→ TypeScript types (z.infer)
             ├─→ OpenAPI 3.1 at /api/openapi.json
             └─→ Scalar docs at /api/docs
```

Hand-written OpenAPI is a second source of truth that nobody updates. Generated
OpenAPI cannot drift, because the object serving the request is the object
describing it.

Schemas live in **`src/shared/schemas/`** and are imported by *both* the worker
and the React app. A breaking API change then surfaces as a TypeScript error at
build time rather than a runtime bug in production.

---

## 3. Data model

Fourteen tables. Types in brackets are the existing TypeScript definitions they
derive from.

### Identity & staff

| Table | Notes |
|---|---|
| `users` | Both audiences. `kind: 'applicant' \| 'staff'`, email, password hash |
| `staff_profiles` | `[Assignee]` role, branch. Role drives the permission matrix |
| `sessions` | Refresh tokens, revocation, device/IP for audit |

### Applicant journey

| Table | From |
|---|---|
| `applicants` | `[MockApplicant]` — profile, branch, target country |
| `consultations` | `[MockConsultation]` — booking, assignment, assessment, slot |
| `applications` | `[ApplicationData]` — stage, package, funding track, plan |
| `school_applications` | `[SchoolApplicationTrack]` — one row per school, plus offer terms |
| `school_track_events` | `[SchoolTrackEvent]` — the per-school timeline |
| `documents` | `[PortalDocument]` — R2 object key, verification verdict |
| `pre_departure_tasks` | `[PreDepartureTask]` — the travel checklist |

### Money

| Table | From |
|---|---|
| `invoices` | `[Invoice]` — subtotal, due date, status, credited amount |
| `invoice_lines` | `[OpsInvoiceLine]` |
| `invoice_payments` | `[InvoicePayment]` — part-payments |
| `invoice_events` | `[InvoiceEvent]` — audit trail |

### Operations

| Table | From |
|---|---|
| `leads` | `[Lead]` — CRM pipeline |
| `tickets` + `ticket_messages` | `[InternalTicket]` — internal + external |
| `activity_log` | `[OpsActivityEntry]` — append-only |
| `cms_overrides` | `[CmsOverlay]` — keyed `collection:id` |

### Decisions worth stating

**Money is integer cents in USD.** `GHS_RATE` stays a presentation concern.
Never store a formatted string — that mistake already caused the
`"GH₵45,000 / $3,000"` → `450003000` bug that inflated every finance total into
the billions.

**Enums become Postgres enums**, not free text:
`ApplicationStatus`, `VisaStage`, `InvoiceStatus`, `DocUploadStatus`,
`ProcessStageId`, `SchoolTrackStatus`, `LeadStage`, `TicketStatus`.

**Seed content stays in `content.ts` for now.** Destinations, universities,
programmes and scholarships are read-mostly. The CMS overlay pattern already
anticipates the swap — `resolveRecord()` reads `override ?? seed`, so moving the
seed into tables later changes one function, not every page.

**`OpsDirectives` and `liveOverlay` do not become tables.** They are artefacts of
the localStorage simulation bridge. Once ops and portal read the same database,
they disappear entirely.

---

## 4. Endpoint inventory

104 mutations do **not** become 104 endpoints. Grouped by resource, with state
transitions modelled as commands rather than generic `PATCH`.

### Why commands, not CRUD

`voidInvoice`, `recordInvoicePayment`, `assignConsultation` and
`rescheduleConsultation` each carry intent, validation rules and an audit entry.
`PATCH /invoices/:id { status: "void" }` throws all of that away and lets any
client write any state. Commands keep the invariants on the server.

**Rule:** CRUD for records, commands for transitions.

### Auth
```
POST   /api/auth/login                 applicant + staff
POST   /api/auth/refresh
POST   /api/auth/logout
GET    /api/auth/me
```

### Applicant portal
```
GET    /api/me/application
PATCH  /api/me/application             profile fields only
POST   /api/me/application/package     chooseSchoolPackage + choosePaymentPlan
GET    /api/me/schools
POST   /api/me/schools                 addSchoolApplication
DELETE /api/me/schools/:id
POST   /api/me/schools/lock            lockSchoolSelection → raises invoice
GET    /api/me/documents
POST   /api/me/documents               presigned R2 upload
DELETE /api/me/documents/:id
GET    /api/me/invoices
POST   /api/me/invoices/:id/pay        payment intent
GET    /api/me/pre-departure
POST   /api/me/pre-departure/:id/toggle
GET    /api/me/notifications
POST   /api/me/notifications/read
GET    /api/me/tickets
POST   /api/me/tickets
POST   /api/me/tickets/:id/reply
```

### Consultations (ops)
```
GET    /api/consultations              role-scoped
GET    /api/consultations/:id
POST   /api/consultations/:id/assign
POST   /api/consultations/:id/confirm-slot
POST   /api/consultations/:id/reschedule
POST   /api/consultations/:id/start-assessment
POST   /api/consultations/:id/complete-assessment
POST   /api/consultations/:id/comments
POST   /api/consultations/:id/request-documents
```

### Applications (ops)
```
GET    /api/applications
POST   /api/applications/:id/assign
POST   /api/applications/:id/stage
POST   /api/applications/:id/accept
POST   /api/applications/:id/checklist/:item
POST   /api/applications/:id/eligibility
POST   /api/applications/:id/visa-stage
POST   /api/applications/:id/travel-clearance
```

### Invoices
```
GET    /api/invoices                   ?status= &applicantId=
POST   /api/invoices
GET    /api/invoices/:id
POST   /api/invoices/:id/payments      recordInvoicePayment
POST   /api/invoices/:id/void
POST   /api/invoices/:id/credit
POST   /api/invoices/:id/resend
GET    /api/accounts                   per-applicant roll-up
```

### Documents · Tickets · Leads · CMS · Reports
```
GET    /api/documents                  review queue
POST   /api/documents/:id/verdict
GET    /api/tickets                    ?source=internal|external
POST   /api/tickets · :id/assign · :id/status · :id/escalate · :id/reply
GET    /api/leads
POST   /api/leads · :id/move
GET    /api/cms/:collection
PUT    /api/cms/:collection/:id
POST   /api/cms/:collection/:id/status
GET    /api/reports/revenue            ?from= &to= &branch=
GET    /api/reports/operations
GET    /api/activity
```

**≈ 70 endpoints.** Roughly 30 are pure reads and can ship before auth hardening
if they expose no applicant data.

---

## 5. Authentication & authorization

### Tokens
Short-lived access JWT (15 min) + refresh token, both in `HttpOnly; Secure;
SameSite=Lax` cookies. **Not** localStorage — an XSS there is a total compromise.

### Two audiences
`applicant` tokens are scoped to their own rows and can only reach `/api/me/*`.
`staff` tokens carry a role and are checked against the permission matrix.

### Reuse the existing matrix
`ROLE_PERMISSIONS` moves from `OpsAuthContext.tsx` into shared code and becomes
Hono middleware. Its structure is already correct — five roles, explicit module
lists, deliberately disjoint so admin has no window into applicant data. It only
needs to run where the user cannot reach it.

```ts
app.use("/api/invoices/*", requireStaff, requireModule("invoices"));
```

The React copy stays, but only to hide UI. The server becomes the authority.

### Row-level scoping
Consultants see only cases assigned to them; managers and coordinators see all.
That predicate exists today in `roleScopedConsultations` and must be reimplemented
as a SQL `WHERE`, not a client filter.

---

## 6. Phasing

Each phase is independently shippable. Phase 2 gates everything that touches
applicant data.

### Phase 0 — Repository seam *(frontend only, no backend)*
Introduce interfaces the UI calls instead of touching context state directly.
Backed by localStorage on day one, swapped to `fetch` per module later.
**Ships nothing visible. Makes every later phase a small diff.**

### Phase 1 — Foundation
`@hono/zod-openapi` + Scalar, `src/shared/schemas/`, `/api/health`,
error envelope, request IDs, CI step that publishes the spec.
*Exit: `/api/docs` renders, one real endpoint validated end to end.*

### Phase 2 — Auth ← **gate**
Neon schema for `users` / `sessions`, login, refresh, JWT middleware,
`ROLE_PERMISSIONS` server-side, row scoping.
*Exit: a staff token cannot read a module its role lacks.*

### Phase 3 — Content
CMS overlay + published content. Read-mostly, lowest risk, proves the whole
pattern including the overlay resolution.

### Phase 4 — Invoices & payments
Highest business value, cleanest boundaries, and freshly refactored so the
command surface is already correct.

### Phase 5 — Consultations & applications
Largest surface. Includes the school-application tracks and offer terms.

### Phase 6 — Tickets, notifications, documents
Documents need R2 and presigned uploads — today `updateAssessmentDoc` only
stores `file.name`, so no real file has ever been uploaded.

### Phase 7 — Retire the simulation
Delete `OpsDirectiveBridge`, the autopilot timers, `resetOpsState`, and the
`OPS_STATE_VERSION` migration guard. Replace cross-tab sync with SSE or polling
against the real source of truth.

---

## 7. Risks

**The simulation timers are load-bearing.** `AppState` advances consultations and
school tracks on `setInterval`. Real backends do not self-advance. Phase 5 must
replace them with genuine ops actions, or the demo silently stops working.

**Two naming conventions already disagree.** `OpsDirectiveBridge` translates
`"installments"` ↔ `"installment"` and `VisaStage` ↔ `VisaStatus`. Reconcile these
in the shared schemas rather than porting the translation layer.

**`content.ts` is 2,500 lines of seed.** Do not migrate it wholesale in one pass.

**Version-bump resets.** `OPS_STATE_VERSION` currently discards saved state on
shape change. Postgres migrations must be additive instead — there is no
equivalent escape hatch once data is real.

---

## 8. First commit

```
src/shared/schemas/{invoice,consultation,application,common}.ts
src/worker/index.ts            mount /api/docs + /api/openapi.json
src/worker/routes/health.ts
src/worker/middleware/{error,request-id}.ts
package.json                   +@hono/zod-openapi +@scalar/hono-api-reference +zod
```

Small, reviewable, and it makes the documentation URL real before a single table
exists.
