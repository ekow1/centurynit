# Century NIT — Product & Feature Overview

A stakeholder walkthrough of the whole platform: what it does, who uses each
part, and how the client portal and the staff console stay in sync.

---

## 1. What the product is

Century NIT is a **study-abroad consultancy platform**. A client signs up,
books a paid consultation, and is then guided — step by step, by real staff —
through enrolment, university applications, visa processing, and departure.

The platform is **three deployables** on **one origin**:

| Piece | Workspace | What it is |
|---|---|---|
| **Client portal + public website** | `century-nit-web` | Marketing site, client sign-up, the guided journey. React SPA served by a Cloudflare Worker. |
| **Operations Center** | `century-nit-ops` | The staff console. Own React app, served at `/ops` on the same origin. |
| **API** | `century-nit-api` | Hono (Node) backend on a VPS. OpenAPI-documented, versioned under `/api/v1/*`; Better Auth lives at `/api/auth/*`. |

Shared code lives in `packages/`:

- **`century-nit-shared`** — the single vocabulary (chapter names, stage
  labels, role definitions, zod schemas). Both apps read from here so the
  words can never drift apart.
- **`century-nit-core`** — the typed API client, catalogue content, shared
  UI primitives, stylesheets.
- **`century-nit-chat-ui`** — the chat components both apps reuse.

Data: **Neon PostgreSQL** via **Drizzle ORM** (~66 tables, row-level
security), **Better Auth** for identity, **Paystack** for payments,
**LiveKit/Daily** for video consultations, **Supabase Storage** for
documents, **Resend** for email, **Workers AI** for the edge assistant.

---

## 2. The client journey — the spine of everything

Everything hangs off one ladder: **six chapters**, each with steps. The same
chapters appear in the portal navigation, the ops case tabs, and the stepper.

| # | Chapter | What happens |
|---|---|---|
| I | **Consultation** | Client books and pays for a session (online video or in person at a branch), meets a consultant, gets an eligibility assessment |
| II | **Enrolment** | Client confirms they want to proceed, picks a service package and payment plan, pays the 10% agency deposit |
| III | **Applications** | Client chooses target schools, pays the application fee, staff submit and track offers, client accepts one |
| IV | **Visa** | Client consents to start, pays the visa fee, officer files and tracks biometrics → decision |
| V | **Departure** | Flight/travel handled, pre-departure fee milestone paid, checklist completed, official documents released |
| VI | **Complete** | Client departed; post-arrival instalment plan runs as aftercare |

Inside those chapters the portal walks the client through **14 fine steps**
(e.g. "Confirm your enrolment", "Consultant being assigned", "Pay the visa
fee", "Flight & pre-departure"). A step is never skipped silently — if later
evidence exists (an admission, a paid visa) earlier un-ticked steps show as
"skipped", not done.

**The rule that keeps the two sides in sync:** the journey is *derived from
facts* (a booking exists, the deposit is paid, an offer is admitted), computed
server-side by `/me/journey` — a pure function both apps share. Ops also keeps
a coarse 7-stage field on the case (`document_verification` →
`school_submission` → `offer_letter_review` → `visa_processing` →
`travel_assistance` → `payment_execution` → `completed`) which acts only as a
**floor**: it can push a client forward, never backward.

---

## 3. The client portal (`century-nit-web`)

### 3.1 Public website (no sign-in)

- **Marketing pages**: Home, About, Why Choose Us, Services, Visa Services,
  Student Services, Success Stories ("Red Seat"), FAQs, Blog, Events.
- **Catalogue browsing**: Destinations, Universities, Programmes,
  Scholarships — each with detail pages, served from the API catalogue.
- **Newsletter**: double opt-in subscribe/confirm/unsubscribe.
- **AI assistant**: public chat widget (enquiry + general questions) running
  on Workers AI at the edge; **Cloudflare Turnstile** gates first-time public
  use for bot protection.
- **Enquiry widget**: prospective clients leave contact details → becomes a
  CRM lead.

### 3.2 Authentication (clients)

- **Sign-up / sign-in**: email + password, **Google OAuth**, **phone OTP**,
  **email OTP** (passwordless).
- **MFA**: authenticator-app TOTP and/or email code; prompted at sign-in and
  manageable in `/portal/security`. OAuth users get email-code MFA.
- **Sessions**: cookie sessions issued by Better Auth; password reset,
  change-email (two-step verified), avatar upload with crop.
- **Account safety**: session list, secure sign-out, ban enforcement.

### 3.3 The guided journey (`/portal/*`)

Dashboard shows the journey spine, the current step, the next unlock, and
chapter cards. Per chapter:

- **Consultation**: choose **online or in-person**, pick a slot from live
  availability (branch schedules), Paystack checkout, then for online
  bookings **join the video call inside the portal** (LiveKit — no external
  link needed); in-person bookings attend at the branch. Reschedule or
  cancel within policy; reschedule requests go to staff for approval.
  Join-window rules enforced (opens a few minutes early, closes after).
- **Enrolment**: assessment outcome card → the client decision
  **Confirmed / On hold / Declined** (stage consent recorded). Then package +
  payment plan (full or instalments), and **10% deposit** via Paystack.
- **Applications**: choose schools, view the raised application invoice, pay,
  watch **per-school tracking** (preparing → submitted → decision reached;
  outcome admitted / waitlisted / "unsuccessful"), accept an offer.
- **Visa**: explicit consent to start → visa invoice → pay → live visa
  tracking (opened, biometrics, decision). A **refusal** parks the case at the
  decision step with a reapplication path.
- **Departure**: travel-assistance choice (Century books the flight vs own
  booking) → **pre-departure fee milestone** → checklist (upload evidence per
  task; staff can waive with a reason) → **official documents released**
  (admission letter, visa papers, e-ticket download).
- **Complete**: post-arrival instalment schedule — aftercare, never a gate.

### 3.4 Portal utilities

- **Document Vault**: upload pipeline (presigned URLs, progress modal),
  verification states (uploaded → verified / rejected with note), staff can
  request specific documents by name.
- **Financial**: full invoice ledger, Paystack checkout per invoice,
  printable receipt/invoice PDFs, payment-plan view, agency milestone view.
- **Appointments**: all bookings, reschedule/cancel, join calls.
- **Communication Center**: threaded chat with the assigned staff — scoped to
  the current stage, plus the AI assistant. Replies arrive by email too
  (inbound email threading per conversation token).
- **Notifications**: bell with unread counts, web-push subscriptions, email
  digests; client-facing events filter out staff-only kinds.
- **Profile & Security**: profile fields, MFA setup, avatar.

---

## 4. The Operations Center (`century-nit-ops`)

Staff-only console at `/ops`. **No self sign-up** — the first super admin is
bootstrapped with a server token; every later account arrives **by
invitation**. Staff sign-in supports password, password reset, and MFA (with
per-role MFA policy).

### 4.1 Roles & permissions

Two layers: **modules** (what you can *see* — enforced server-side on every
`/api/*` route via `requireModule`) and **capabilities** (what you can *do* —
`requireCapability`). A permission matrix in the admin UI lets admins build
custom roles; **rank** controls who may invite/edit whom (you can only grant
roles below your own rank).

| Role | Sees | Can do |
|---|---|---|
| **Super Admin** | Everything | Everything |
| **Manager** | All branches, all cases | Assign work, invite staff, edit packages & universities, issue invoices, own any chapter, manage clients |
| **Coordinator** | All cases, all branches | Assign work, route cases, own any chapter |
| **Customer Service** | Branch cases, all branches | Assign work (routing), front-line support |
| **Consultant** | Their assigned caseload | Own chapters (consult/apply/visa/depart), comments, doc requests, stage updates, reschedules |
| **Finance** | Invoices, ledger, payments, packages | Issue/void/credit invoices, edit packages |
| **Admin** | Platform + client accounts — **no case files** | Users & roles, auth policy, CMS, site, notifications, settings, ban/sign-out client accounts |

**Branch scoping**: `see_all_branches` separates "my branch" roles from
global ones; the API enforces it (`assertBranchScope`).

### 4.2 Workspace (mission control)

- **Worklist**: a triage queue of pending tasks built from live records —
  unassigned consultations, cases awaiting handler, invoices to raise,
  documents to review, reschedule requests. Banded **overdue / today /
  later**, filterable (mine, unassigned, coordinated, invoicing…), with
  **inline assignment** in the row.
- **Caseload**: who is carrying what, per staff member.
- **Now pane**: what's live right now (meetings in progress).
- Every view state lives in the URL — notifications deep-link straight into a
  task's preview pane.

### 4.3 Consultations module

Queue of booked sessions with filters (unassigned, today, awaiting
assessment). On a booking staff can:

- **Assign/reassign** a consultant, **refer** to another branch.
- **Delegate** a session (temporary hand to a colleague) and **reclaim** it;
  **duty coordinator** roster per branch per day.
- **Confirm slot**, start + **complete the assessment** (eligible /
  conditional / not eligible + recommendation note → unlocks the client's
  next step).
- Reschedule (with reschedule-request approvals), cancel, mark **no-show**,
  issue **rebook credit**, join the LiveKit room, resend meeting link.
- Comment, request documents, view full activity history.

### 4.4 Applications / Cases

The case file (board + detail) tracks the whole engagement. On a case the
owner can:

- Move the case between stages (with gate rules — e.g. can't enter
  visa_processing before fees settle).
- **Assign chapter owners** per stage (consultant for enrolment/applications,
  visa officer, travel officer) — each chapter's assign-control only offers
  staff with the matching `own:*` capability.
- Edit package/plan, add comments, request documents, update checklist items,
  record visa details (embassy, biometrics, decision) and departure details
  (flight, ticket), set post-arrival schedule.
- **Release override**: unlock official documents early (manager + finance —
  needs `issue_invoices`).
- Refer the case to another branch.

### 4.5 Finance suite

- **Invoices**: two-step approval — the **chapter owner** (consultant / visa
  officer) raises a **proforma** (draft estimate) on the case, then
  **finance** approves and **issues** it (becomes payable) → client pays →
  settled. Void and credit supported; invoice events are append-only.
- **Ledger**: immutable accounting history of every transaction and invoice.
- **Payments log**: Paystack and Stripe records with statuses.
- **Payment config**: gateway toggles and currency configuration.
- **Fee schedule & packages**: destination tariffs, fee items, service
  package tiers/pricing (editable by manager + finance only).
- **Reports**: revenue and operational analytics.

### 4.6 Pipeline & support

- **Leads / CRM**: inbound enquiry pipeline (from the website widget and
  manual entry), stage progression, lead events.
- **Helpdesk**: support tickets — backed by the same conversation system.
- **Documents**: review queue — verify or reject with notes; feeds the
  client's checklist and vault.
- **Communication Hub**: staff↔client threads scoped to case/stage,
  **escalations**, plus staff↔staff chat (groups, mentions, reactions,
  attachments, presence/heartbeat).

### 4.7 Catalogue & scheduling

- **Universities / Programmes / Scholarships** editors (manager only).
- **Appointments & Live Meetings**, **scheduling config** (per-weekday
  branch hours, slot interval, daily slot cap, timezone), and per-staff
  working hours that drive the booking availability the client sees.

### 4.8 Marketing

Campaigns over mailing lists with email templates and recipient tracking.

### 4.9 Platform administration (Admin role)

- **System Overview** (health/metrics), **Audit Logs**.
- **Users & Roles**: invite staff, edit roles, the permissions matrix.
- **Auth settings**: sign-in methods, session and per-role MFA policy.
- **CMS**: public site content; **Site & UI**: branding/navigation;
  **Lookups**: dynamic form dropdowns; **Notifications**: templates/channels;
  **Settings**: integrations, API keys, fee schedule.

---

## 5. How portal ↔ ops stay in sync

There is **no sync layer to maintain** — one API, one database. The
coordination is in the *rules*:

| Mechanism | What it does |
|---|---|
| **Derived journey** | `/me/journey` computes the client's step from facts; ops's coarse stage is a floor that can't regress them. Both apps render the same labels from `century-nit-shared`. |
| **Case assignments** | Append-only `case_assignments` history — who owns a consultation/case *now*; reassignment ends the old row, never overwrites. Denormalised name fields are display cache only. |
| **Stage assignments** | Per-chapter ownership (consultant / visa officer / travel officer) via `own:*` capabilities. |
| **Handoffs** | Crossing into `travel_assistance` or `payment_execution` **hard-gates**: the case parks at the boundary until a manager resolves the handoff. The 10% deposit auto-creates the first handler handoff ("Pending Handler Assignment"). |
| **Delegation** | A consultant can delegate a consultation to a colleague and reclaim it; a daily **duty coordinator** roster exists per branch. |
| **Stage consents** | The client's Confirmed / On hold / Declined is recorded and gates stage entry — staff can't push a client past a consent they haven't given. |
| **Invoice gate** | Chapter owner raises proforma → finance issues → client pays — that chain drives the ladder (application fee, visa fee, deposit, fee milestone). Paystack webhooks settle server-side. |
| **Documents** | Client uploads → staff verify/reject → checklist progress updates the journey on both sides. |
| **Notifications** | `notify` service writes in-app notifications + emails + web-push; clients see only client-safe event kinds. |
| **Audit trail** | Admin actions, settings changes, invoice/booking events, lead events, case comments, assignment history — append-only everywhere. |

**Typical end-to-end flow:**

1. Client books + pays for consultation → appears **unassigned** in the ops
   worklist.
2. Manager/coordinator assigns a consultant (or consultant is on duty
   roster). Consultant holds the session (video in-app, or in person at the
   branch), completes the assessment
   → client's portal flips to the outcome.
3. Client confirms enrolment, picks package, pays deposit → **handler
   handoff** fires → manager assigns a case consultant.
4. Client picks schools → the chapter owner raises a **proforma** → finance
   approves and **issues** the application invoice → client pays → staff
   submit applications → offers tracked per school → client accepts.
5. Client consents to visa → visa officer raises the **visa proforma** →
   finance issues it → client pays → visa officer owns the stage, tracks to
   decision.
6. **Handoff gate** into Departure → manager assigns travel officer → flight
   booked → **fee milestone** → checklist → documents released → complete,
   post-arrival instalments continue.

---

## 6. Action checklist — who does what, when

| Moment | Actor | Action | Client sees |
|---|---|---|---|
| Booking lands | Coordinator / Manager | Assign consultant (or duty roster covers it) | "Consultant being assigned" |
| Session held | Consultant | Complete assessment (eligible/conditional/not) | Assessment outcome + note |
| Enrolment open | Client | Confirm / hold / decline; pick package + plan; pay deposit | Journey advances |
| Deposit settled | Manager | Resolve handler handoff → assign case consultant | "Consultant being assigned" → named consultant |
| Schools chosen | Chapter owner, then Finance | Raise proforma → approve & issue invoice | "Application fee being prepared" → payable invoice |
| Offers in | Consultant | Record per-school outcomes | Live tracking; client accepts offer |
| Visa start | Client + Visa officer + Finance | Client consents; officer raises proforma, finance issues, client pays | "Pay the visa fee" |
| Visa work | Visa officer | Embassy filing, biometrics, decision | Visa tracking |
| Departure boundary | Manager | Resolve handoff → travel officer | Departure chapter opens |
| Travel settled | Client + Finance | Flight choice; fee milestone paid | Documents unlock path |
| Pre-departure | Client + staff | Checklist items verified/waived | Official documents released |
| Any time | Finance | Issue/void/credit invoices; edit packages | Ledger, receipts |
| Any time | Admin | Staff invites, roles, auth policy, CMS | — |

---

## 7. Supporting systems worth naming

- **Consultation sessions**: online or in-person bookings; in-app LiveKit
  rooms for online (Daily as alt provider), join-window rules,
  no-show/rebook-credit handling.
- **AI assistant**: edge Workers AI (Llama 3.1) streaming SSE; portal +
  public surfaces; Turnstile-gated.
- **Email**: Resend templates (OTP, receipts, invitations, campaigns);
  inbound email threading into conversations.
- **Availability**: per-weekday slot configuration plus per-staff working
  hours and existing bookings drive what clients can book.
- **Security**: RLS on every table, rate limiting, secure headers, origin
  allowlist, Turnstile on public forms, MFA enforcement middleware,
  append-only audit.

---

*Generated from the codebase: `century-nit-web`, `century-nit-ops`,
`century-nit-api`, `packages/*` — September 2026.*
