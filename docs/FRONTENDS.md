# Frontends

Two React 19 + Vite + React Router apps, each deployed as its own
Cloudflare Worker with static assets + an `/api/*` reverse proxy. Both are
**thin clients** — the API is authoritative; the portal keeps only
per-browser convenience state (drafts, dismissed hints) in `localStorage`.

Shared sources: `century-nit-shared` (labels, schemas, `deriveJourney`,
permission matrix, CMS types) and `century-nit-core` (typed `apiFetch`,
`API_PREFIX`, UI primitives), `century-nit-chat-ui` (chat components).

Design language: **monochrome brutalist** — square edges (no
`border-radius`), black/white/gray palette, no color leaks; state shown by
weight, border style, inversion, not hue.

## Operations Center (`century-nit-ops`)

Served on its own Worker (`console.*`). Entry `src/main.tsx` →
`EnterpriseLayout` (auth gate, nav, command palette, notification bell).
Every surface's view state lives in the **URL** (`?tab=`, `?id=`) — deep
links survive refresh and notifications deep-link into a task's preview.

### Page map (nav groups)

| Route | Module | Surface |
|---|---|---|
| `/workspace` | dashboard | Worklist triage — pending tasks banded overdue/today/later, inline assignment |
| `/inbox` | dashboard | What happened (ops feed) |
| `/dashboard` | dashboard | The numbers |
| `/helpdesk` | helpdesk | Client conversations — queue, lifecycle, canned replies, CSAT |
| `/chat` | chat | Staff Communication Hub — DMs, groups, mentions, presence |
| `/documents` | documents | Review queue — verify/reject with notes |
| `/consultations` | consultations | Booked sessions — assign, refer, delegate, assess, no-show, credit |
| `/applications` | applications | Cases — list + board + full case file |
| `/applicants` | applicants | Client records |
| `/crm` | crm/leads | Enquiry pipeline, touches, stages |
| `/appointments` | appointments | The week's consultations |
| `/live-meetings` | appointments | Video rooms in progress |
| `/universities`, `/programs` | universities/programs | Catalogue editors |
| `/packages` | packages | Service packages & fees |
| `/departure-checklist` | applications | Per-destination checklist templates |
| `/invoices` | invoices | Raise/proforma → issue → void/credit |
| `/ledger` | ledger | Per-client journal & instalments |
| `/payments` | payments | All incoming payments, reconcile |
| `/fee-schedule` | finance | Service & third-party fees |
| `/payment-config` | payment-config | Gateways, instalment schedules |
| `/finance`, `/reports` | finance/reports | Revenue & operations analytics |
| `/scheduling` | scheduling | Branch slot config |
| `/my-calendar` | dashboard | Working hours + feed connections |
| `/marketing?tab=` | marketing | campaigns · audiences · contacts · templates · automations |
| `/system` | system | Platform health |
| `/users`, `/clients` | users | Staff directory & permission matrix · client accounts & ban |
| `/auth` | auth | Sign-in methods, sessions, MFA policy, auth events |
| `/audit` | system | Hash-chained audit feed + verify + export |
| `/cms` | cms | Brand, entries, media, nav, copy |
| `/notifications` | notifications | Catalogue, preferences, log, health |
| `/settings` | settings | Integrations & platform config |

Supporting chrome: `OpsCommandPalette`, `OpsNotificationBell`,
`BranchScopeFilter`, `StaffChatBadge`, `NowPane` (live meetings),
`PendingTasks`, `DocPreviewInline`/`OpsDocPreviewModal`.

The React permission copy (`OpsAuthContext.hasPermission`) only hides UI —
`requireModule`/`requireCapability` server-side is the authority.

## Portal + public site (`century-nit-web`)

Served on its own Worker. Entry `src/react-app/App.tsx` → `PortalLayout`
(sidebar = the six-chapter journey spine: done / current / locked).

### Public surfaces (no auth)

Marketing pages (home, about, services, visa, success stories, FAQs, blog,
events), catalogue browsing (destinations/universities/programmes/
scholarships detail), newsletter subscribe/confirm/unsubscribe/preferences,
the AI assistant widget (Workers AI, Turnstile-gated), enquiry widget →
CRM lead, CMS-driven content pages (`ContentPages`).

### Portal surfaces (`RequireAuth`)

| Route | Surface |
|---|---|
| `/portal/home` | Dashboard — journey spine, current step, next unlock, chapter cards |
| `/portal/journey` | The journey hub — all six chapters |
| `/portal/consultation` | Book online/in-person, live slots, Paystack, join LiveKit call, reschedule/cancel |
| `/portal/enrolment` | Assessment outcome, confirm/hold/decline, package + plan, deposit |
| `/portal/applications` | School picks, application invoice, per-school tracking, accept offer |
| `/portal/visa` | Visa consent → invoice → tracking (filed → biometrics → decision) |
| `/portal/departure` | Travel choice, fee milestone, checklist, document release |
| `/portal/complete` | Post-arrival instalment schedule |
| `/portal/appointments` | All bookings, reschedule/cancel, join calls |
| `/portal/documents` | Document Vault — presigned uploads, verify states, staff requests |
| `/portal/fees` | Invoices, receipts (PDF), payment plan, agency milestones |
| `/portal/messages` | Communication Center — staff thread + AI assistant |
| `/portal/security` | Profile, MFA, sessions, avatar |
| `/newsletter/{confirm,unsubscribe,preferences}` | Marketing consent surfaces |

Portal data is **push-driven**: `GET /events/stream` (SSE) triggers
`syncFromServer`; the 20–30 s polls are a fallback for a dropped stream.

`MfaPrompt` + `OnboardingModal` mount inside `PortalLayout`; `useBrand()`
applies the CMS identity to the portal chrome (logo, names) without a
deploy.

## Deploy

Each builds into its own `dist/client/`:

```bash
npm run build:frontend           # packages → web → ops
cd century-nit-web && npx wrangler deploy
cd century-nit-ops && npx wrangler deploy
```

Chunk-split per page — e.g. the marketing suite is one lazy chunk, the case
file another — so no page pays for another's code.
