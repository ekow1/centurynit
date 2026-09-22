# Architecture

## System shape

Century NIT is an npm-workspace monorepo producing **three deployables**:

```
century-nit-web.*.workers.dev        console.*.workers.dev        api.*  (VPS/Dokploy)
┌──────────────────────┐            ┌──────────────────────┐     ┌─────────────────────┐
│ Web Worker           │            │ Console Worker       │     │ century-nit-api     │
│  · static assets     │            │  · static assets     │     │  Hono on Node       │
│  · /api/* → API_BASE │            │  · /api/* → API_BASE │     │  + BullMQ worker    │
└─────────┬────────────┘            └──────────┬───────────┘     │    process          │
          │                                    │                └──────┬──────┬───────┘
   public site + applicant portal      Operations Center (staff)       │      │
          │                                    │                  Postgres  Redis
          └──────────────── same-origin /api/* ┴──────────────────────►│
```

- **`century-nit-web`** — public marketing site + client portal. React 19 +
  Vite SPA, deployed as a Cloudflare Worker serving static assets.
- **`century-nit-ops`** — Operations Center ("the console"). Separate React
  SPA, separate Cloudflare Worker. A public visitor never downloads a byte of
  it.
- **`century-nit-api`** — Hono + Drizzle + Better Auth on Node (Docker image,
  Dokploy on EC2). One long-running API process plus a **separate BullMQ
  worker process** (`npm run worker:start`).

Both Workers reverse-proxy `/api/*` to `API_BASE_URL`
(`https://api.softclicksolutions.com` in production). Consequences:

- The browser sees one origin per app — session cookies are first-party and
  ordinary traffic never preflights.
- CORS still matters for genuinely cross-origin callers (the `/api/docs`
  "Test request" button, local dev pointed at prod). The allowed-origins list
  is built once in `src/lib/origins.ts` from `BETTER_AUTH_URL`,
  `FRONTEND_URL`, `CONSOLE_URL`, `ALLOWED_ORIGINS`, and feeds **both** the
  CORS middleware and Better Auth `trustedOrigins` so they cannot drift.
  Exact-match only — no wildcard or suffix matching.

## Shared packages

| Package | Purpose |
|---|---|
| `packages/shared` (`century-nit-shared`) | The single vocabulary: chapter/stage labels, zod schemas per resource, the **role permission matrix** (`ops.ts`), `deriveJourney`, CMS types. Imported by all three apps so wording and rules can't drift. |
| `packages/core` (`century-nit-core`) | Typed API client (`apiFetch`, `API_PREFIX`), shared UI primitives, content helpers, ops types. |
| `packages/chat-ui` (`century-nit-chat-ui`) | Message list, composer, reactions, typing indicator — reused by the portal Communication Center and the ops Communication Hub. |

Build them before anything else (`npm run build:packages`) — every app
imports their *emitted* types, so a clean checkout fails to typecheck without
them.

## API application structure

`century-nit-api/src/`:

- `app.ts` — assembles the Hono app: middleware (security headers, CORS,
  rate limit, request log), Better Auth handler, every router mount,
  OpenAPI doc + Scalar reference at `/api/docs` (`/api/openapi.json` raw).
- `routes/` — one file per resource area, written with
  `@hono/zod-openapi` `createRoute` so the OpenAPI document is generated
  from the same schemas that validate requests.
- `services/` — business logic; routes stay thin.
- `middleware/auth.ts` — `requireAuth`, `requireStaff`, `requireMfa`,
  `requireRole`, `requireModule`, `requireAnyModule`, `requireCapability`,
  `assertBranchScope`.
- `db/schema.ts` — the entire Drizzle schema (~84 tables) in one file,
  ordered by domain; `db/index.ts` is the `pg` pool connection.
- `worker/` — BullMQ producers (`queues.ts`) and consumers (`main.ts` +
  one file per queue).
- `lib/` — `resend.ts` (email send + layout), `sms.ts`, `push.ts` (web-push),
  `crypto.ts`, `origins.ts`, `time.ts`, `email-templates.ts`.
- `env.ts` — zod-validated environment; production refuses to boot without
  `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `FRONTEND_URL`.

## Request flow

1. Browser hits the SPA's Worker → static asset or `/api/*` proxy.
2. API: security headers → CORS → rate limit → route.
3. Auth: Better Auth session cookie resolves a `users` row; `requireStaff`
   joins `ops_users` for role/branch; `requireMfa` checks enrolment;
   `requireModule`/`requireCapability` consult the live `ops_roles`
   permission list (falls back to the built-in matrix).
4. Route validates input with the OpenAPI zod schema, calls a service,
   serializes the row → response.
5. Side effects never happen inline: notifications, campaign sends, feed
   syncs are **enqueued** to BullMQ so a failed send can't roll back a
   booking.

## Background workers

`npm run worker --workspace=century-nit-api` (dev) /
`npm run worker:start` (prod) runs all consumers in one process:

| Queue | Job |
|---|---|
| `email` | Notification + transactional email (idempotency-keyed; a duplicate job id is a no-op) |
| `campaign` | Marketing campaign send — walks the `campaign_recipients` ledger row by row |
| `push` | Web-push deliveries (VAPID) |
| `autopay` | Scheduled instalment charges on stored Paystack authorizations |
| `chatReplyEmail` | Offline-reply email for chat/helpdesk messages |
| `helpdeskSweep` | SLA checks on open helpdesk conversations |
| `automationSweep` | Daily date-trigger scan for marketing automations |
| `meetingStatus` | 60-second poll marking live/ended video meetings |
| `feeds` | Recurring iCal feed mirroring (inbound busy feeds) |
| `documentCleanup` | Daily TTL purge of rejected document uploads |

Until this process runs, jobs accumulate in Redis and nothing consumes
them — the API stays healthy, but no email sends and no meeting links land.

## Data stores

- **PostgreSQL** (Neon-compatible; local via docker-compose on :5433) —
  system of record for everything. RLS enabled and forced on every table;
  the app connects as owner and bypasses it, the policies exist so any
  future non-owner access (Supabase surface, BI tool) is still safe.
- **Redis** — BullMQ queues only. Not used as a cache.
- **Supabase Storage** — private bucket for applicant documents, avatars and
  the CMS media library. All access is presigned URLs minted by the API
  (`services/storage/`); public media reads go through
  `GET /api/v1/media/{key}` which 302s to a signed URL (edge-cacheable).
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`.

## External services

| Service | Used for | Config |
|---|---|---|
| **Paystack** | All client payments: consultation checkout, invoices, instalments, autopay authorizations | `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, webhook at `/api/webhooks/paystack` |
| **Resend** | All outbound email: OTPs, invitations, receipts, notifications, campaigns. Delivery/open/bounce/complaint events via Svix-signed webhook | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET` |
| **LiveKit** | Online consultation video rooms (join in-app) | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| **Daily** | Alternative video provider (legacy path) | `DAILY_API_KEY`, `DAILY_DOMAIN` |
| **Google** | Client sign-in OAuth; staff calendar feeds (iCal) | `GOOGLE_AUTH_*`, `GOOGLE_CLIENT_*` |
| **Web Push** | Browser push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| SMS provider | Phone OTP — **pluggable and unconfigured**; without one, phone sign-in refuses rather than pretending | `lib/sms.ts` |

In development, email and SMS print to the console instead of sending — every
flow is completable locally with no provider accounts.

## Realtime

- **SSE** — `GET /api/v1/events/stream` pushes domain events (stage changes,
  assignments, invoices, visa updates) to the portal; the 20–30 s polls are
  a fallback for a dropped stream, not the mechanism.
- **Heartbeat/presence** — staff presence for chat (`/communication/presence`,
  `/heartbeat`), typing indicators per conversation.
