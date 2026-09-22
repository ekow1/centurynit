# Century NIT — Technical Documentation

This directory is the engineering reference for the suite. It documents how
the system is built and how the pieces fit together — the counterpart of
`FEATURES.md` (what the product does) and the root `README.md` (how to run
it). Read those first for product context; come here when you need the
mechanism.

| Document | Covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Deployables, topology, request flow, shared packages, workers, storage, external services |
| [DATABASE.md](DATABASE.md) | All tables grouped by domain, RLS posture, migration discipline |
| [API-SURFACE.md](API-SURFACE.md) | Every mounted route group and its endpoints |
| [AUTHENTICATION.md](AUTHENTICATION.md) | Better Auth, client sign-in methods, staff roles/modules/capabilities, MFA, invitations |
| [JOURNEY-AND-CASES.md](JOURNEY-AND-CASES.md) | The applicant journey, case stages, handoffs, consents, assignments, documents |
| [MONEY.md](MONEY.md) | Invoices (proforma → issue → settle), ledger, Paystack, instalment plans, autopay |
| [COMMUNICATIONS.md](COMMUNICATIONS.md) | Chat, helpdesk, email threading, notifications, push, SSE, audit stream |
| [MARKETING.md](MARKETING.md) | Campaigns, segments, consent, suppressions, automations, newsletter |
| [CMS.md](CMS.md) | Brand identity, content entries, media library, navigation, copy keys |
| [SCHEDULING-AND-MEETINGS.md](SCHEDULING-AND-MEETINGS.md) | Availability, bookings, video rooms, calendar feeds, working hours |
| [FRONTENDS.md](FRONTENDS.md) | Operations Center page map, portal page map, URL conventions |
| [OPERATIONS.md](OPERATIONS.md) | Environment variables, deployment, worker runbook, testing |

## Conventions used throughout

- `API_PREFIX` is `/api/v1`. Better Auth lives at `/api/auth` (unversioned).
  Webhooks live at `/api/webhooks` (unversioned).
- "Client", "applicant", "user" — the study-abroad customer (a `users` row
  reached through the portal). "Staff", "ops user" — a `users` row that also
  has an `ops_users` row (role + branch).
- Money is stored in **integer cents** (`amount_cents`, `*_cents`) unless a
  column explicitly says otherwise. Display formatting is a UI concern.
- Every staff-facing route states its guard chain in-line:
  `requireAuth → requireStaff → requireModule("…") → requireCapability("…")`.
  `requireModule` is "may see", `requireCapability` is "may do".
- Append-only is the default for anything that is evidence: audit, invoice
  events, booking events, case assignments, lead events, school track events.
  Corrections happen by appending, never by editing history.

## Reading order for a new engineer

1. `ARCHITECTURE.md` — where code runs and how a request flows.
2. `JOURNEY-AND-CASES.md` — the domain spine everything else hangs off.
3. `AUTHENTICATION.md` — who can do what.
4. The domain file for whatever you're changing (MONEY, MARKETING, CMS…).
5. `DATABASE.md` + `API-SURFACE.md` as lookups while you work.
