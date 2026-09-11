# Century NIT Suite

Monorepo for Century NIT Consult.

```
century-nit-suite/
├── century-nit-web/     Public site + applicant portal (React + Vite)
│                        Deployed as its own Cloudflare Worker
├── century-nit-ops/     Operations Center — staff admin (React + Vite)
│                        Deployed as a separate Cloudflare Worker ("console")
├── century-nit-api/     Hono + Drizzle + Better Auth backend (Node)
└── packages/
    ├── core/            Domain data, types and UI shared by web and ops
    └── shared/          Zod schemas shared by web and api
```

## Two front-end apps, two origins

The public app and the Operations Center are **separate applications with
separate builds, deployed as separate Cloudflare Workers**. A visitor to the
marketing site never downloads a byte of the admin app.

```
  century-nit-web.*.workers.dev          console.*.workers.dev
          │                                      │
  ┌───────┴────────┐                ┌─────────────┴────────────┐
  │  Web Worker    │                │  Console Worker          │
  │  (ASSETS)      │                │  (ASSETS)                │
  └───────┬────────┘                └─────────────┬────────────┘
          │                                       │
   /api/* │ everything else                SPA routes
          ▼                                       │
   century-nit-api (EC2/Dokploy)                  ▼
                                          React Router
```

Both Workers reverse-proxy `/api/*` to the API on `API_BASE_URL`, so each SPA
shares an origin with the API as far as the browser is concerned, and the
session cookie is first-party on both.

### Allowed origins (CORS)

Because of that proxy, ordinary app traffic is same-origin and never triggers a
preflight. CORS still matters for the requests that are genuinely cross-origin —
the API reference's "Test request" button, and local development pointed at a
deployed API.

One list serves both the CORS middleware and Better Auth's `trustedOrigins`, so
the two cannot drift ([lib/origins.ts](century-nit-api/src/lib/origins.ts)). It
is built from `BETTER_AUTH_URL`, `FRONTEND_URL` and `CONSOLE_URL`, plus anything
in `ALLOWED_ORIGINS`:

```bash
ALLOWED_ORIGINS=https://centurynit.com,https://www.centurynit.com
```

Origins only — scheme, host and port, never a path. Apex and `www` are different
origins and both need naming. Matching is exact: no wildcards and no suffix
matching, because `endsWith(".example.com")` is how an allowlist quietly starts
trusting `evil-example.com`. localhost origins are added automatically outside
production and are not present in a production build.

A rejected origin reaches the browser as an opaque network error with nothing
logged server-side, so the accepted list is printed at startup — check it there
first when a frontend "cannot reach the API".

`BETTER_AUTH_URL` must be the URL a **browser** uses, not the container's own
address. Better Auth builds the Google callback and every password-reset and
verification link from it, and in production it must be `https` or the browser
will refuse the `Secure` cookie the session depends on.

## Where the product lives

In the API. Cases (consultations, applications, school tracks, handoffs, stage
consents), invoices and payments, documents, scheduling, chat and
notifications are all Postgres-backed and served by `century-nit-api`; both
front ends are thin clients over it. The portal keeps a small amount of
per-browser convenience state in `localStorage` (drafts, dismissed hints) and
an offline fallback for the journey, but nothing there is authoritative.

### The applicant journey

One case moves through these coarse stages, stored on `applications.stage`:

```
document_verification → school_submission → offer_letter_review
  → visa_processing → travel_assistance → payment_execution → completed
```

The portal shows a finer-grained step. It is **derived**, never stored:
`GET /api/v1/me/journey` gathers the facts about the applicant's current
application (consent, deposit, handler, locked schools, invoice status,
admissions, visa, travel assistance, plan) and hands them to
`deriveJourney()` in `packages/shared/src/journey.ts`. That function is pure
and table-tested (`century-nit-api/src/services/journey.test.ts`); read it
before touching anything that decides "where is this applicant".

The rules worth knowing:

- **Everything is scoped to the current (newest) application.** Schools and
  invoices are read by `application_id`, never by applicant or client user, so
  a returning client's earlier case cannot leak paid invoices or admissions
  into the new one. `GET /me/invoices` returns only the current case's
  invoices (plus the consultation invoice).
- **Consent has one state machine**, `applications.proceedStatus`, changed
  only by `accept/pause/declineProceedForApplication`. The applicant reaches
  it through `POST /me/application/consent`.
- **The 10% deposit is the only trigger for the school-submission handler.**
  Paying it either raises a `stage_handoffs` row for a manager to resolve or,
  if a handler was assigned ahead of time, opens the stage directly.
- **Applicants pay only through Paystack** (checkout → verify → webhook).
  There is deliberately no applicant-side "record a payment" route.
- **The portal is push-driven.** Stage, assignment, invoice and visa events
  arrive over SSE (`/api/v1/events/stream`) and trigger a `syncFromServer`;
  the 20–30 s polls are a fallback for a dropped stream, not the mechanism.

`century-nit-web/docs/API_MIGRATION_PLAN.md` records how the API was grown
out of the original browser-only prototype and is mostly historical now.

## Local development

1. Start Postgres and Redis:

   ```bash
   docker compose up -d
   ```

2. Install dependencies from the root (npm workspaces — always from the root):

   ```bash
   npm install
   ```

3. Build the shared packages first. Every app imports their emitted types, so a
   clean checkout fails to typecheck without this:

   ```bash
   npm run build:packages
   ```

4. Build the database. On a **new** database:

   ```bash
   DATABASE_URL=postgres://century:century@localhost:5433/century_nit      npm run db:fresh --workspace=century-nit-api
   ```

   On a database that already has data, apply what is pending instead:

   ```bash
   npm run db:migrate
   ```

   Why two commands: the migration chain in `century-nit-api/drizzle/` was
   grown by hand and by generator side by side and no longer replays from
   zero (generated files re-create objects hand-written ones already made,
   and journal timestamps were edited out of order). `db:fresh` builds the
   schema from `schema.ts` — what the code actually expects — plus the
   pieces Drizzle cannot express (the `btree_gist` extension, the
   double-booking exclusion constraint, the RLS sweep, and the trigger
   migrations listed in `src/scripts/db-fresh.ts`), then stamps the journal
   so `db:migrate` picks up from there. CI uses it. If your local database
   is old and `db:migrate` fails on it, drop it and use `db:fresh`; local
   data is disposable.

   Two rules for new migrations, learned the hard way:
   - Never `ALTER TYPE … ADD VALUE` and use the new value in the same
     `db:migrate` run — Drizzle applies all pending files in one transaction
     and Postgres refuses. Recreate the type instead.
   - Journal `when` values must increase. Drizzle skips any entry whose
     timestamp is not greater than the last applied one.

5. Run the dev servers — one per terminal:

   ```bash
   npm run dev       # docker compose + API on :3000
   npm run dev:web   # public site + portal on :5173
   npm run dev:ops   # Operations Center on :5174
   ```

   The two front ends talk to each other only through the API, so running
   them on different ports is fine. To exercise the production layout (each
   SPA behind its own Worker proxying `/api/*`):

   ```bash
   npm run build:frontend
   cd century-nit-web && npx wrangler dev   # http://localhost:8787/
   cd century-nit-ops  && npx wrangler dev   # http://localhost:8787/ (separate)
   ```

Copy `century-nit-api/.env.example` to `century-nit-api/.env` to override
defaults. It is loaded automatically via `dotenv/config`.

## Tests

```bash
npm run test --workspace=century-nit-api      # needs Postgres + Redis from docker compose
```

The API suite is integration-first: booking, handoffs, RLS, document access
and the end-to-end journey walk (`src/services/journey.e2e.test.ts`) run
against a real database, because the guarantees that matter — no double
booking, application scoping, the paid flags following the ledger — are
enforced by Postgres, and a mocked database would pass without them. Each
suite skips itself when no database is reachable; CI fails the run if any
test skipped, so a green build always means the integration suites ran.
The pure derivation rules (`deriveJourney`, stage guards) are unit-tested
without a database.

## Environment

Development has working defaults for everything, so no `.env` is required to
start. **Production has no defaults** for `DATABASE_URL`, `REDIS_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` or `FRONTEND_URL` — the API refuses to
boot without them, and rejects a `BETTER_AUTH_SECRET` still set to a
placeholder. Generate one with:

```bash
openssl rand -base64 48
```

## Building the API image

The Docker build context is the **monorepo root**, not `century-nit-api/` —
the API depends on the `century-nit-shared` workspace and the only lockfile is
at the root:

```bash
docker build -f century-nit-api/Dockerfile -t century-nit-api .
```

## Deployment

- Frontend: Cloudflare Workers static assets; the Worker reverse-proxies
  `/api/*` to `API_BASE_URL` so the SPA and API share an origin for cookies
- API: VPS/Dokploy running the image above
- Postgres: VPS (with nightly backups to R2) or managed Neon
- Redis: VPS
- Queues: a **separate worker process**, `npm run worker:start --workspace=century-nit-api`
  (dev: `npm run worker --workspace=century-nit-api`)

> The worker is not optional. Notifications and calendar retries are queued
> rather than run in the request, so a failed email can never roll back a
> booking. Nothing consumes those jobs until this process runs: bookings still
> succeed, but no email is sent and no meeting link ever arrives.

### Scheduling and Google Calendar

Meeting links come from Google Calendar — a Calendar event is created with a
conference request and Google returns the Meet URL. There is no direct Meet API.

The feature works before Google is configured. An assignment is saved with
`calendarSyncStatus = FAILED` and the applicant is told the link is being
prepared, rather than being shown a link that does not work. In Operations
Center → Platform Settings, enter the **Google Calendar** client ID, client
secret and callback URL (`/api/v1/calendar/callback`). Each employee then
connects their own calendar at `/ops/my-calendar`, and connecting re-queues
any of their bookings that are still missing a link.

## Authentication

One system — Better Auth — for both audiences. A staff member is simply a user
who also has an `ops_users` row linked by `user_id`, which is where their role
and branch live.

**Clients** self-register and may sign in by email + password, phone + SMS code,
a one-time email code, or Google. MFA is available to them but never required —
an applicant is not made to install an authenticator app before booking.

Configure Google applicant sign-in separately in Operations Center → Platform
Settings → **Google Sign-In**. Its callback URL must end in
`/api/auth/callback/google`; register that exact public Web Worker URL in Google
Cloud Console. The sign-in and Calendar integrations can use separate OAuth
clients, or one client with both callback URLs registered.

**Staff never self-register.** There is no staff sign-up endpoint anywhere in
the API. An account exists only because somebody with the authority invited it,
and the invitee sets their own password; nobody else ever knows it. Nobody can
invite a role above their own, and only a `super_admin` may create an `admin` or
another `super_admin`.

**MFA is required for every staff role** (TOTP — Google Authenticator, Authy,
1Password, any RFC 6238 app). `requireMfa` enforces it server-side, not just in
the UI.

### First run

The first super administrator is a chicken-and-egg problem: invitations need an
inviter. Either way works:

```bash
# Option A — seed the whole demo roster
npm run seed:staff --workspace=century-nit-api

# Option B — one-time bootstrap, under "Staff" in the API reference at /api/docs
#   set BOOTSTRAP_TOKEN first, then:
curl -X POST http://localhost:3000/api/v1/staff/bootstrap   -H 'Content-Type: application/json'   -d '{"token":"<BOOTSTRAP_TOKEN>","email":"you@example.com","name":"Your Name","password":"at-least-12-chars"}'
```

`bootstrap` refuses as soon as any staff member exists, so it cannot be replayed.
Remove `BOOTSTRAP_TOKEN` from the environment afterwards.

`BOOTSTRAP_TOKEN` is the developer's setup secret — it is only ever typed by a
person, so a passphrase you will remember works as well as `openssl rand -hex 16`.
Anything 16 characters or longer is accepted; five wrong attempts lock the
endpoint for fifteen minutes. It is a different thing from the `password` in the
same request body, which is the login password for the administrator being
created.

### API reference

`/api/docs` is one page covering the whole surface. Better Auth serves its routes
and its schema separately, so the reference merges the two at request time: sign-in,
sign-up, email and phone one-time codes and two-factor enrolment appear under
**Authentication** alongside the versioned resource routes, each with a working
"Test request". The raw document is at `/api/openapi.json`.

Both paths create the Better Auth login, link it to `ops_users`, and seed
Mon–Fri 09:00–17:00 working hours — without which nobody is assignable.
`seed:staff` prints a unique password per account unless `STAFF_SEED_PASSWORD`
is set.

### Delivery

Email goes through Resend; **SMS is pluggable and unconfigured**. Without a
provider, phone sign-in refuses rather than pretending to send a code. In
development both channels print to the console instead — including invitation
links and one-time codes — so every flow is completable locally with no provider
account. That console output is suppressed in production.

Better Auth serves its own routes outside the app's OpenAPI document, so they
are documented separately at `/api/auth/reference`.

`API_BASE_URL` in `century-nit-web/wrangler.json` is set to
`https://api.softclicksolutions.com` — the API behind Dokploy on EC2. The web
Worker proxies all `/api/*` requests there.

### Build order

Each frontend builds into its own `dist/client/` directory, so the order no
longer matters. `npm run build:frontend` builds both. Deploy each separately:

```bash
npm run build:frontend
cd century-nit-web && npx wrangler deploy   # public site
cd century-nit-ops  && npx wrangler deploy   # console
```

Verify a build before deploying:

```bash
npm run build:all                                   # packages -> api -> web -> ops
cd century-nit-web && npx wrangler deploy --dry-run # worker + assets
cd century-nit-ops  && npx wrangler deploy --dry-run # worker + assets
```
