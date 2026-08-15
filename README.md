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

The web Worker reverse-proxies `/api/*` to the API on `API_BASE_URL`, so the
public SPA and the API share an origin for cookies. The console Worker is
standalone — it has no `/api` proxy, so ops-side API calls go directly to the
API origin (CORS must allow it).

> **Note on the `localStorage` bridge.** The live applicant case, ops
directives, the CMS overlay and shared support tickets were originally
`localStorage` handshakes, which are scoped per origin. With the two apps now
on separate origins, those bridges do not work cross-origin. They will need to
be replaced with an API-based channel; until then, those features only work
when both apps share an origin (e.g., local dev through a single Worker).

## Where the product actually lives

Most of it is still in the browser. Both front-end apps are complete working
products backed by `localStorage` rather than by the API.

**Scheduling is the exception, and the pattern to follow.** Appointments live in
Postgres because they have to be visible to staff, survive a browser, and be
protected from double-booking. `century-nit-api` serves health, authentication
(applicant *and* staff), and the whole booking lifecycle: availability, booking,
manager assignment, Google Calendar/Meet, rescheduling, cancellation, and the
notification and calendar-retry queues.

Everything else — cases, invoices, documents, tickets, CMS — is still
browser-only.

`century-nit-web/docs/API_MIGRATION_PLAN.md` is the plan for closing that gap
and tracks progress per phase. Read it before adding endpoints.

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

4. Run migrations:

   ```bash
   npm run db:migrate
   ```

5. Run the dev servers — one per terminal:

   ```bash
   npm run dev       # docker compose + API on :3000
   npm run dev:web   # public site + portal on :5173
   npm run dev:ops   # Operations Center on :5174
   ```

   In development the two front ends are on different ports (different
   origins), so the `localStorage` bridge between them does not work. To
   exercise the two-window demo, build and serve each through its own Worker:

   ```bash
   npm run build:frontend
   cd century-nit-web && npx wrangler dev   # http://localhost:8787/
   cd century-nit-ops  && npx wrangler dev   # http://localhost:8787/ (separate)
   ```

Copy `century-nit-api/.env.example` to `century-nit-api/.env` to override
defaults. It is loaded automatically via `dotenv/config`.

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
prepared, rather than being shown a link that does not work. Once you set
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`, each
employee connects their own calendar at `/ops/my-calendar`, and connecting
re-queues any of their bookings that are still missing a link.

## Authentication

One system — Better Auth — for both audiences. A staff member is simply a user
who also has an `ops_users` row linked by `user_id`, which is where their role
and branch live.

**Clients** self-register and may sign in by email + password, phone + SMS code,
a one-time email code, or Google. MFA is available to them but never required —
an applicant is not made to install an authenticator app before booking.

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
