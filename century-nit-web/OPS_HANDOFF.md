# Ops ↔ Portal simulation — handoff

Both halves are wired. `npm run build:frontend` is green.

## The two halves are two applications

The Operations Center lives in its own workspace, **`century-nit-ops`**, with
its own build. This document sits in `century-nit-web` because the two are
designed as a pair, but no ops source remains here.

| | Public app | Operations Center |
|---|---|---|
| Workspace | `century-nit-web` | `century-nit-ops` |
| Dev server | `npm run dev:web` (:5173) | `npm run dev:ops` (:5174) |
| Build output | `dist/client/` | `dist/client/ops/` |
| Served at | `/` | `/ops` |

Both are served from **one origin** by the Worker in
`century-nit-web/src/worker/index.ts`. That is not a deployment convenience —
it is what keeps everything below working. Every link between the halves is a
`localStorage` handshake and `localStorage` is per-origin, so a separate
hostname for ops breaks the live case, directives, the CMS overlay and shared
tickets, all at once.

> **In dev the two ports are two origins**, so the bridge is dead between
> `:5173` and `:5174`. For the two-window demo, run
> `npm run build:frontend` then `npx wrangler dev` from `century-nit-web`, and
> use `:8787` and `:8787/ops`.

Anything genuinely common lives in **`packages/core`**: the seed catalogue and
pricing (`content`), the record shapes both sides read (`opsTypes`,
`siteContent`), the guarded storage helpers, and the shared stylesheets.

## How the two halves talk

Neither store imports the other. They communicate through `localStorage`, which
means it also works **across browser tabs** — put the portal in one window and
the Operations Center in another and changes appear live. That two-window setup
is the demo.

```
  PORTAL                                   OPS
  ──────                                   ───
  AppState  ──writes──▶ century-nit-*  ──read──▶  useLivePortalCase()
  (unchanged)           (its own keys)             └─▶ live case in Consultations,
                                                       Applications, Applicants,
                                                       Finance, Workflow, Dashboard

  AppState  ◀──applies──  OpsDirectiveBridge  ◀──reads──  century-nit-ops-state
                                                           └─ written by ops actions
```

- **Portal → Ops.** `useLivePortalCase()` reads the portal's existing storage
  keys (`century-nit-application`, `-booking`, `-auth`, `-school-apps`,
  `-portal-docs`), derives the current stage, and publishes a snapshot into the
  ops store. Mounted via `<LiveCaseSync />` in `EnterpriseLayout`.

  ⚠️ **`century-nit-auth` is load-bearing.** `buildSnapshot()` returns `null`
  the moment that key has no `email`, which switches off the live case on every
  ops screen at once. It went missing once already — the key was read here and
  cleared on sign-out, but never actually written, so `liveCase` was permanently
  `null` and the whole two-window demo below silently did nothing. `AppState`
  now persists the signed-in applicant to it. If the LIVE badge ever disappears,
  check this key first.

- **Ops → Portal** goes through *directives*: ops never mutates portal state
  directly, it records an intent (`eligibility`, `appInvoice`, `visaInvoice`)
  with an `at` timestamp used as an idempotency key.

## Roles

**Five** seats, defined in `OpsAuthContext.tsx`. Operations and platform access
are deliberately **disjoint** — the administrator manages the software, not the
business, and never sees applicant data.

| Role | Persona | Sees | Can edit packages | Can assign work |
|---|---|---|---|---|
| **Manager** | Adjoa Mensah-Bonsu | Every lead, consultation, application, and applicant across all branches | ✅ | ✅ |
| **Coordinator** | Kojo Asante | Same operational modules, scoped to their own branch. Routes work day to day | ✗ | ✅ |
| **Consultant** | Efua Owusu | Only what is assigned to them, plus documents, appointments, and the catalogue | ✗ | ✗ |
| **Finance Officer** | Ama Serwaa Boateng | All invoices, balances, and revenue, plus **full control of service packages** | ✅ | ✗ |
| **System Administrator** | Kwabena Osei | Platform only: System Overview, Users & Roles, Auth, CMS, Site & UI, Notifications, Config. **No case data at all** | ✗ | ✗ |

Universities and programmes are editable by the **manager only**
(`EDIT_UNIVERSITIES`).

The sidebar splits into **Operations** and **Platform** headings and shows only
what the current role can reach. Each role has its own landing page
(`ROLE_HOME`) — `/ops` redirects accordingly, so an admin never lands on the
operational dashboard.

Since the route table also runs `OpsRequireModule` on every `/ops/*` path, a
role that types a URL for a module it lacks gets a "Not available to your role"
panel rather than the page. This is still a client-side check: it is honest UI,
not a security boundary, and stays that way until the same matrix runs as server
middleware (see `docs/API_MIGRATION_PLAN.md` §5).

Switch seats from the **View as** dropdown in the ops topbar, or from
`/ops/login`.

## Who does what

**Nobody in ops creates a consultation.** Clients book through the portal and the
booking lands in the manager's queue. Those create buttons are gone from
Consultations and Applications entirely.

**Manager and coordinator** — route work and monitor it (`ASSIGN_WORK`):
- Assign or reassign any consultation or case to a consultant, from the drawer
- "Awaiting assignment" KPI on the dashboard and a pill on each module header
- An **Unassigned** filter tab on Consultations

The manager sees every branch; the coordinator is scoped to their own
(`canSeeAllBranches`).

**Consultant** — works only their own caseload. On an assigned case they can:
- Add comments, recommendations, and status updates
- Request further documents from the applicant
- Reschedule an assigned consultation
- Update stage and progress

On a case that is not theirs the panel reads *"Read-only — this case is not
assigned to you"* and the controls disappear. `canAssignWork` and
`canEditPackages` in `OpsAuthContext` are the single source of truth for this.

**Finance** — owns money and the catalogue. Issues stage invoices to the live
applicant, and shares package editing with the manager (`EDIT_PACKAGES`).
Coordinators, consultants and the admin see the catalogue behind a "Read only"
badge.

Seed data is balanced so the scoping is visible: the manager sees 3
consultations (1 unassigned) and 4 applications; the consultant sees 2 and 2.
The live portal applicant also arrives **unassigned**, so the manager has to
route them before the consultant can act — that is the demo.

## What ops can now do

| Action | Where | Effect on the applicant |
|---|---|---|
| Submit assessment → outcome | Consultations → drawer → Assessment tab | Sets their eligibility + note, unlocks the next stage |
| Issue application invoice | Finance → live applicant card | Invoice appears as `raised` with finance's amount and line items |
| Issue visa invoice | Finance → live applicant card | Same, for the visa stage |
| Drag a case between stages | Workflow board | Updates the case record (Applications table + dashboard follow) |
| Approve / reject a document | Documents queue | Logged to the activity feed |

Invoices and packages are the Finance Officer's; assignment is the Manager's;
assessments and case work belong to the assigned Consultant.

Ops state persists to `century-nit-ops-state` and survives refresh. Every
cross-screen action is appended to an activity log, shown on the manager
dashboard and on the admin's System Overview.

## Portal side — done

**1. Directive bridge mounted.** `<OpsDirectiveBridge />` sits inside
`AppStateProvider` in `src/react-app/App.tsx`. Ops decisions now reach the
applicant.

**2. Autopilot flag.** `simAutopilot` on `useAppState()` (persisted to
`century-nit-sim-autopilot`, default **on**):

- **Autopilot** — timers stand in for staff; the portal demos end to end alone.
- **Ops-driven** — those timers are disabled and the Operations Center issues
  eligibility and invoices for real. The applicant's "Simulate other outcomes"
  controls are hidden, since the consultant owns that call.

Switch modes in the **DEMO** panel (bottom-right tab, `src/react-app/components/DemoControls.tsx`),
which also shows the current portal stage, whether ops can see the live case,
how many ops actions have been logged, and a reset for the whole demo.

## Running the two-window demo

1. Open the portal in window 1, the Operations Center (`/ops/login`) in window 2.
2. Set the DEMO panel to **Ops-driven**, and sign into ops as the **Manager**.
3. Applicant books and pays for the consultation → they appear in
   `/ops/consultations` marked **LIVE** and **unassigned**.
4. Manager opens the drawer and assigns them to Efua Owusu.
5. Switch to **Consultant** — the case is now in their list. Open it, post a
   recommendation, request a document, then submit the assessment outcome →
   the portal flips to that outcome with the consultant's note.
6. Switch to **Finance Officer** → "Live applicant · awaiting billing" →
   **Issue application invoice** → it appears in the portal at finance's amount.
   Show `/ops/packages` being editable here, then read-only as the consultant.
7. Back to **Manager** to drag the case across the Workflow board.
8. Switch to **System Administrator** to show the platform console — the sidebar
   swaps entirely to Users, Auth, CMS, Site & UI, and config, with no case data.

## Notes

- `npm run build:frontend` is green. Build **web before ops** — ops emits into
  the web app's `dist/client/ops/`, and the web build empties that directory.
  The script does this in the right order.
- `wrangler.json` sets `run_worker_first: ["/api/*", "/ops", "/ops/*"]`. Two
  SPAs share one assets directory, so the built-in single-page-application
  fallback is not enough on its own: for an unmatched path it would serve the
  *public* `index.html` to a staff member. The Worker picks the right shell.
- The record types (`MockConsultation`, `MockApplication`, `MockApplicant`) live
  in `packages/core/src/opsTypes.ts`, imported as `century-nit-core/ops`.
- `PaymentPlanId` and `ServicePackage` exist in **both** vocabularies with
  different shapes — the portal's in `century-nit-core`, the ops one in
  `century-nit-core/ops`. That is why ops types are a subpath rather than
  flattened into the main barrel. Do not "fix" it by making one assignable to
  the other; `OpsDirectiveBridge` translates between them on purpose.
- Reset the ops side with `resetOpsState()` from `useOpsState()` mid-demo. The
  DEMO panel's reset lives in the public app and clears the key directly, so an
  Operations Center window that is already open needs a refresh to notice.
- Route chunks are lazy-loaded in both apps, so the first click into a section
  fetches its chunk and briefly shows a spinner.
- The service worker is registered by the public app and never touches `/api/*`
  **or `/ops/*`** — it must not cache another app's routes, or staff get a stale
  admin bundle after an ops-only deploy.
- Both apps load the same two stylesheets from `packages/core/styles/`. Splitting
  the CSS per app is still open: the token layer, resets and several component
  classes are genuinely common, and getting it wrong is a visual regression with
  no type checker to catch it.
