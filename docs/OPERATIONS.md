# Operations

## Environment variables

Validated in `century-nit-api/src/env.ts`. Development has working defaults
for everything; **production refuses to boot** without `DATABASE_URL`,
`REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL` — and
rejects a placeholder `BETTER_AUTH_SECRET` (`openssl rand -base64 48`).

### Required in production

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (`postgres://…`) |
| `REDIS_URL` | BullMQ queues |
| `BETTER_AUTH_SECRET` | Session/OTP signing + marketing HMAC keys (unsubscribe/preferences links) |
| `BETTER_AUTH_URL` | The **browser-facing** URL — builds OAuth callbacks + email links. Must be `https` in prod or the `Secure` cookie is refused. |
| `FRONTEND_URL` | Portal origin (CORS + trusted origins) |
| `CONSOLE_URL` | Ops origin (CORS + trusted origins) |

### Integrations

| Var | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | Payments; webhook at `/api/webhooks/paystack` |
| `RESEND_API_KEY` / `RESEND_FROM` / `RESEND_WEBHOOK_SECRET` | Email delivery + Svix-verified events webhook |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` | Private document + media storage (presigned URLs) |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Video consultation rooms |
| `DAILY_API_KEY` / `DAILY_DOMAIN` | Alternative video provider |
| `GOOGLE_AUTH_CLIENT_ID` / `GOOGLE_AUTH_CLIENT_SECRET` / `GOOGLE_AUTH_REDIRECT_URI` | Client Google sign-in |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Staff company-calendar OAuth |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web push |
| `ALLOWED_ORIGINS` | Extra exact-match CORS origins (comma-separated origins, never paths) |
| `BOOTSTRAP_TOKEN` | One-time first-super-admin secret — remove after use |
| `ENCRYPTION_KEY` | Field-level encryption (`lib/crypto.ts`) |

### Behaviour tuning (defaults exist)

`PORT` · `NODE_ENV` · `DEFAULT_TIMEZONE` · `BRANCH_OPEN_START` /
`BRANCH_OPEN_END` · `SLOTS_PER_DAY` · `BOOKING_BUFFER_MINUTES` ·
`PLATFORM_EXCHANGE_RATE` · `REJECTED_DOCUMENT_TTL_DAYS` ·
`STAFF_SEED_PASSWORD` (seed script) · `GOOGLE_WEBHOOK_TOKEN` /
`GOOGLE_WEBHOOK_URL` (legacy) · `HTTPS` (local TLS dev).

### Front-end (Wrangler)

`API_BASE_URL` in each `wrangler.json` — the origin `/api/*` proxies to
(`https://api.softclicksolutions.com` in prod).

## Local development

```bash
docker compose up -d                 # Postgres :5433 + Redis
npm install                          # from the ROOT — npm workspaces
npm run build:packages               # shared → core → chat-ui (required first)
npm run db:fresh --workspace=century-nit-api   # new DB; db:migrate if it has data
npm run dev                          # API on :3000 (+ compose)
npm run dev:web                      # portal on :5173
npm run dev:ops                      # console on :5174
```

Copy `century-nit-api/.env.example` → `.env` to override defaults. Email
and SMS print to the API console in dev — every flow completes locally.

## Testing

```bash
npm run test --workspace=century-nit-api    # Vitest — needs Postgres + Redis
```

Integration-first: booking, handoffs, RLS, document access, the e2e journey
walk run against a real database — the guarantees that matter (no double
booking, application scoping, paid flags following the ledger) are enforced
by Postgres. Suites self-skip with no DB; **CI fails if any suite skipped**.
Pure rules (`deriveJourney`, stage guards, fees, crypto, origins) are unit
tests without a DB. Typecheck: `npm run lint --workspace=century-nit-api`
(`tsc --noEmit` both configs); frontends `pnpm build` runs `tsc -b`.

## Deployment

| Piece | Where | How |
|---|---|---|
| API | VPS/Dokploy (EC2) | `docker build -f century-nit-api/Dockerfile -t century-nit-api .` — context is the **repo root** (workspace deps + lockfile). Rolls on push. |
| Worker | Same VPS, separate process | `npm run worker:start --workspace=century-nit-api` — **not optional**; nothing consumes queues without it. |
| Web | Cloudflare Worker | `cd century-nit-web && npx wrangler deploy` |
| Console | Cloudflare Worker | `cd century-nit-ops && npx wrangler deploy` |
| Postgres | VPS or Neon | Nightly backups to R2 |
| Redis | VPS | Queues only |

Preflight: `npm run build:all` then `wrangler deploy --dry-run` per app
(`pnpm check` in ops does typecheck + build + dry-run).

## Database migrations

- New DB → `db:fresh`; existing DB → `db:migrate`. The journal chain
  doesn't replay from zero (see DATABASE.md).
- **Prod has drifted before** — verify applied-vs-journal rather than
  assuming: compare `__drizzle_migrations` rows against
  `drizzle/meta/_journal.json`, and spot-check the actual columns, not just
  recorded hashes (a file edited after apply hashes differently but content
  may have landed). Only apply genuinely-missing files, idempotently, with
  a recorded hash (`sha256` of file bytes) so `drizzle-kit migrate` stays
  consistent.

## Runbook — common checks

| Symptom | Check |
|---|---|
| "Cannot reach the API" from a frontend | Startup log prints the accepted origins — a rejected origin fails as an opaque network error. |
| Bookings succeed but no email/links | The **worker process** isn't running — jobs accumulate in Redis. |
| Sign-in loop / cookie rejected | `BETTER_AUTH_URL` isn't the browser-facing https URL. |
| Staff can't see a module | `ops_roles` permission list — `requireModule` is the authority, UI just hides. |
| Marketing sends skip recipients | `marketing_suppressions` / `marketing_optins` — consent is rechecked at send time. |
| Payment "paid" but invoice open | Webhook hadn't settled — `POST /payments/reconcile-paystack`; verify is a fast path, webhook is authority. |
| Audit verify fails | A row in `admin_audit` was edited/deleted — the hash chain is tamper-evidence, not a bug. |
| A `.map`/undefined crash in a frontend chunk | Almost always a response-key mismatch — check the API's actual JSON keys against the client read (e.g. `{ mailingLists }` vs `.lists`). |

## Observability

- Request log + structured `[service]` console lines (searchable by tag:
  `[marketing]`, `[feeds]`, `[queues]`, `[cms]`).
- `GET /api/health` (liveness) and `/api/health/detail` (dependency
  detail) — the ops System Overview reads them.
- `GET /notifications/health` — delivery-channel health.
- BullMQ job retention: `removeOnComplete: 1000`, `removeOnFail: 5000` —
  failed jobs are inspectable in Redis before expiry.
