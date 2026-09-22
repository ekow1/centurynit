# Century NIT: Complete Documentation

Everything about the platform in one document, in plain language. It covers
what the system is, how it's built, what each part does, how the client
journey works end to end, and how it runs in production.

---

## Part 1: What the platform is

Century NIT is a study-abroad consultancy platform. A client signs up,
books a paid consultation, and is then guided step by step, by real staff,
through enrolment, university applications, visa processing, and departure.
Staff run the whole operation from a separate console.

The product is **three deployable pieces**:

1. **The public website and client portal**, where visitors browse and
   where clients live their journey.
2. **The Operations Center**, the staff-only console for consultations,
   cases, finance, marketing, content, and administration.
3. **The API**, the single backend that both front ends talk to. It holds
   all data and all business rules.

A visitor to the website never downloads a byte of the staff console. They
are separate applications with separate builds.

### How the pieces connect

Each front end sits behind its own Cloudflare Worker. The Worker serves the
app's files and forwards every API call to the backend. Because of that
forwarding, the browser sees one origin per app, the login cookie is
first-party, and sign-in just works. The API keeps a strict list of allowed
origins for the rare calls that are genuinely cross-origin; the same list
feeds both the browser security layer and the sign-in system so they can
never drift apart.

### Where the truth lives

Everything of record is in one PostgreSQL database: cases, invoices,
documents, messages, marketing, content. Both front ends are thin clients.
They show what the API says and send back what the user does. The portal
keeps a little per-browser convenience state (drafts, dismissed hints), but
nothing there is authoritative.

---

## Part 2: Signing in

One identity system serves both audiences. A staff member is simply a user
account that also has a staff record attached; that record is where their
role and branch live.

### Clients

Clients register themselves. They can sign in with:

- Email and password (with email verification and password reset)
- Google
- Phone number with a texted code (only when a text provider is configured;
  without one the option refuses rather than pretending)
- A one-time code emailed to them (passwordless)

Clients can add two-factor protection, an authenticator app or emailed
codes, but it's never required. An applicant is not made to install an
authenticator before they can book a consultation.

### Staff

**Staff can never register themselves.** There is no staff sign-up
anywhere. An account exists only because someone senior invited it, and the
invitee sets their own password; nobody else ever knows it. Invitations and
one-time codes go out by email; in development they print to the server
console instead so everything can be tested without email accounts.

Two-factor is **required for every staff role**, enforced by the server:
either an authenticator app or enrolled email codes. The very first
administrator is created once with a server-side setup token; the moment
any staff member exists, that door closes permanently.

---

## Part 3: Who can do what

Two separate ideas, both checked on the server (the console interface only
hides buttons; the backend is the real authority):

- **Modules** decide what a role can *see*: which pages and API areas open
  to them.
- **Capabilities** decide what a role can *do*: assign work, issue
  invoices, invite staff, own a chapter of a case.

Both live in one shared definition used by the console and the API, so they
can never disagree. Administrators can build custom roles in a permission
matrix; a custom role gets a rank, and you can only grant roles ranked
below your own.

### The built-in roles

| Role | Sees | Can do |
|---|---|---|
| **Super Admin** | Everything | Everything |
| **Admin** | Platform administration (staff, sign-in policy, content, settings) plus read access to casework | Invite and manage staff, manage roles and client accounts, change platform settings; does not work case files |
| **Manager** | All branches, all cases | Assign work, invite staff, issue invoices, approve payment schedules, own any chapter, edit packages and the university catalogue |
| **Coordinator** | All cases and branches | Assign and route work, own any chapter; the front-desk role |
| **Customer Service** | Cases at their branch, leads, helpdesk | Route work, first-line support |
| **Consultant** | Their own caseload | Own chapters (consultations, applications, visa, departure), comment, request documents, update stages, raise draft invoices |
| **Finance** | Invoices, ledger, payments, packages | Issue, void and credit invoices, edit packages, approve payment schedules |

Branch scoping is real: a role without "see every branch" is confined to
its own branch, enforced by the API.

---

## Part 4: The client journey

Everything hangs off one ladder: **six chapters**.

| Chapter | What happens |
|---|---|
| **1: Consultation** | Client books online or in-person, picks a real slot, pays, meets the consultant, gets an eligibility assessment |
| **2: Enrolment** | Client confirms they want to proceed (or pauses or declines), picks a service package and payment plan, pays the deposit |
| **3: Applications** | Client chooses schools, pays the application fee, staff submit and track offers, client accepts one |
| **4: Visa** | Client consents to start, pays the visa fee, the officer files and tracks it to a decision |
| **5: Departure** | Travel help, the pre-departure fee milestone, a checklist, then official documents released |
| **6: Complete** | Client departed; post-arrival instalments run as aftercare |

Inside the chapters the portal walks the client through about fourteen
finer steps. A step is never silently skipped: if later evidence exists
(an admission, a paid visa), earlier un-ticked steps show as "skipped",
not done.

### How "where the client is" is decided

Two representations, deliberately different:

- **A coarse stage stored on the case**, set by staff and checked against
  gate rules (you can't enter visa work before the fees settle). It acts
  as a floor: it can push a client forward, never backward.
- **A fine step computed from facts.** The API gathers what actually
  exists (a booking, a paid deposit, an offer, a consent) and derives the
  step the portal shows. It is never stored, so it can't disagree with
  reality, and both apps use the same shared logic and the same words.

Everything is scoped to the client's **current case**. A returning client's
earlier case can never leak paid invoices or admissions into the new one;
schools and invoices are read per case, never per person.

### Consent is a gate, not a suggestion

The client's Confirmed / On hold / Declined is recorded and gates stage
entry. Staff cannot push a client past a consent they haven't given. The
visa chapter in particular opens only on explicit consent.

### Who owns the work

Ownership history is append-only. Who owns a case now is the open record;
reassignment closes the old one, never overwrites. Each chapter has its own
seat (consultant, visa officer, travel officer), and the assignment picker
for each chapter only offers staff holding the matching ownership
permission. A consultant can delegate a session to a colleague and reclaim
it, and a daily duty-coordinator roster covers each branch.

### Hard boundaries

Some moments stop the case until a manager acts. Paying the deposit raises
a "pending handler assignment" handoff; that payment is the only trigger
for the school-submission handler. Entering departure or the final payment
stage hard-gates the same way until a manager resolves the handoff or
defers it.

### Flexible entry and exit

Service packages are priced per stage. A client can enter at different
service stages, select only what they need, stop after any reached stage,
and later request to continue. Staff approve the continuation.

---

## Part 5: Consultations, scheduling and meetings

What a client can book comes from three inputs: the branch's weekly hours
and slot settings, each consultant's own working hours, and everything
already booked, including busy times mirrored in from staff personal
calendars. A database-level rule makes double-booking impossible even if
two people click at the same instant.

Bookings have a full lifecycle (cancel, reschedule, reassign, confirm,
complete, no-show, rebook credit), and every transition is written to an
append-only history. Reschedules a client requests go to staff for
approval; staff-side reschedules are direct.

Online sessions run in video rooms the client joins **inside the portal**,
no external link needed. A join window is enforced (opens a few minutes
early, closes after). A background check every minute marks meetings live
or ended, feeding the console's "what's happening now" view.

Staff calendars connect both ways: they can pull their personal calendar's
busy times in so clients can't book over them, and publish their Century
bookings out to their personal calendar as a subscribeable feed.

---

## Part 6: Money

All amounts are stored as integer cents. The invoice pipeline is a two-step
approval chain that drives the journey:

1. The **chapter owner** (the consultant or visa officer doing the work)
   raises a draft estimate, a proforma, on the case.
2. **Finance** approves and issues it. Now it's a real, payable invoice.
3. The client pays; partial payments count; when the balance reaches zero
   the invoice settles.
4. Corrections happen by voiding or crediting. Every action lands in the
   invoice's permanent event history, never by editing the past.

### How clients pay

Paystack is the only client-side rail: checkout, then verification, then a
signed webhook settles the payment on the server. The webhook is the
authority; if it's slow, staff can reconcile against the gateway. There is
deliberately no way for a client to claim "I paid"; cash and bank payments
are recorded by staff. Mobile-money charges with an OTP step are also
supported. Receipts and invoices print as PDFs.

### Instalments

Clients can pay in instalments: full payment or a plan at enrolment, and a
post-arrival schedule they propose and a manager or finance approves. With
the client's consent, a saved payment authorization lets the system charge
each instalment automatically; every attempt is logged so failures are
visible, never silent.

### Fees and packages

The fee catalogue defines what each charge is (agency service fees, plus
third-party fees like embassy and school application charges), with tariffs
per destination. Service packages are priced per stage so clients buy only
the chapters they need.

### The ledger

Every case and every client has a ledger view: a chapter-numbered journal
of invoices and payments. Underneath sits the invoice event history,
immutable and append-only, the substrate the views are built from. A paid
invoice can't be voided (it must be credited), and settlement is idempotent,
so a replayed webhook or retried verification can never charge twice.

---

## Part 7: Documents

Clients upload through a vault: the file goes straight to private storage
via a temporary signed link, then staff verify it or reject it with a
note. Verification progress feeds the client's checklist and the journey on
both sides. Staff can request a specific document by name ("passport data
page"), which appears as a task in the portal. Rejected files are purged
after a retention period. Nothing is publicly reachable; every download
goes through a short-lived signed link the API mints.

---

## Part 8: Communication

### One conversation system, three surfaces

A single thread model (conversations, members, messages, attachments,
mentions, reactions) serves:

- **The helpdesk**: client-to-staff threads, scoped to a case and chapter,
  with subject, category, priority, who it's waiting on, first-response
  and resolution times, and a satisfaction rating when it closes.
- **The staff Communication Hub**: direct messages, group chats,
  mentions, reactions, attachments, presence, typing indicators.
- **The client's Communication Center**: the portal's thread with their
  assigned staff plus the AI assistant.

Threads can be escalated to managers, and staff keep a library of canned
replies. When a client is offline, a reply is emailed to them, and their
email reply lands back on the same conversation. Staff presence and typing
are shown live as they happen.

### Notifications

One notification service fans out to three channels (in-app, email, and
browser push) and logs every delivery attempt so a failure can be retried.
Clients only ever see client-appropriate event kinds; staff-only signals
never reach the portal. Each user controls their own matrix of which
events arrive on which channels. Email never sends inside a web request;
it's queued, so a failed send can never roll back a booking.

The portal is push-driven: a live event stream tells it when stages,
assignments, invoices or visa states change, so the client sees updates
without refreshing. Polling exists only as a fallback for a dropped stream.

### The audit trail

Administrative actions land in an append-only audit trail: who, what, on
which record, from which address. Every entry seals the previous entry's
fingerprint, so altering or deleting any row breaks the chain and a
verification check proves it. The trail is browsable by day, filterable,
exportable, and alert rules can watch it (for example, a burst of failed
sign-ins or a role change). Settings changes have their own parallel trail.

---

## Part 9: Marketing

Production email marketing built on the suite's own data, in five console
tabs: Campaigns, Audiences, Contacts, Templates, Automations.

### People, not address books

The **person** is the record; a list is a membership. The contacts view
gathers everyone the suite knows (mailing-list subscribers, applicants,
leads), each with their real identity (an applicant shows their case and
chapter, a lead their stage), their consent state, and their memberships.
One person with two memberships appears once, never as two rows.

### Consent is earned, never fabricated

Adding a contact has exactly two doors: send them a confirmation email
(they become opted-in when they click), or record that they consented
offline, which requires a written note as the audit trail. There is no
silent "confirmed". CSV imports run a dry run first (how many are new,
how many duplicates merged, how many invalid), then apply the same consent
decision to the batch.

### Suppression

One global do-not-contact list, checked twice: when a campaign's audience
is frozen (only opted-in, unsuppressed people become recipients; everyone
else is recorded as skipped with the reason) and again at the instant each
email is sent. Someone who unsubscribes between scheduling and sending is
skipped, not mailed. Bounces and spam complaints from the email provider
suppress automatically.

### Segments: live audiences

Saved filters over the suite's real data (applicants by chapter, branch,
country, offer state, unpaid milestone, departure window; leads by stage,
source, no-show), evaluated at send time, never copied. A preview shows how
many match, how many are opted in, never asked, or suppressed. A campaign
targets a list or a segment, never both.

### Campaigns

Composed from blocks (headings, paragraphs, buttons, dividers, two columns)
with merge fields that pull real data: the person's name, case
reference, stage, officer, branch, next due date, portal link. Senders get
a preheader, a from-name, and a reply-to (the branch mailbox by default).
Preview is the actual server-rendered email, and a test send goes through
the real pipeline. Reports show delivered, open, click, bounce and
unsubscribe rates, an hourly timeline, top links, and the per-recipient
ledger with retry for failures. Every footer carries working unsubscribe
and preferences links.

### Templates and automations

Templates render as live miniatures; presets are read-only starters you
fork. Automations are rules (when this happens, to people matching this
segment, send this template after this delay) covering moments like a
no-show follow-up, an assessment completed but no enrolment, an offer
received, a visa approval, thirty days to departure, or an overdue
milestone. Starters ship as drafts; staff turn them on deliberately. Every
firing is logged, including why a person was skipped.

---

## Part 10: Content management

One identity record, one content store, one media library, read by the
website, the portal, the console, and the email layout.

- **Brand**: the identity record (names, logos, colours, contacts,
  socials) has a draft and a published copy. Edits save to the draft;
  publishing makes it live and records who published, with full version
  history and revert.
- **Entries**: content collections keyed by name and slug, moving through
  draft, review, then published; schedulable and fully versioned.
- **Navigation**: the site's header and footer link lists.
- **Copy**: every label that's content rather than code, per surface
  (site, portal, console, email).
- **Media**: the image library. Uploads go straight to private storage,
  alt text and focal points are editable, and public reads pass through a
  short-lived signed link so nothing is openly reachable.

Public content reads are edge-cached: fast for visitors, fresh within a
minute of publishing.

---

## Part 11: The Operations Center, page by page

Every view keeps its state in the address bar (filters, tabs, open
records), so links survive refresh and notifications deep-link to the
exact task.

- **Workspace**: the day's triage. Unassigned consultations, cases
  awaiting a handler, invoices to raise, documents to review, reschedule
  requests, banded overdue / today / later, with inline assignment.
- **Inbox, Dashboard, Now**: what happened, the numbers, what's live.
- **Helpdesk**: the client conversation queue with its full lifecycle.
- **Chat**: staff messaging.
- **Consultations**: booked sessions. Assign, refer, delegate, assess,
  reschedule approvals, no-show and credit.
- **Cases**: every engagement, list or board, with the full case file:
  stages, chapter owners, package and plan, invoices, comments, documents,
  visa and departure details, release override, post-arrival schedule.
- **Clients, Leads**: records and the enquiry pipeline.
- **Appointments, Live meetings**: the week and rooms in progress.
- **Universities, Programmes, Packages, Departure checklist**: the
  catalogue editors.
- **Invoices, Ledger, Payments, Fee schedule, Payment plans**: the
  finance suite.
- **Reports**: revenue and operations analytics.
- **Scheduling, My availability**: the week the branch offers, and each
  person's own hours and calendar connections.
- **Marketing**: campaigns, audiences, contacts, templates, automations.
- **System, Staff & roles, Clients directory, Authentication, Audit,
  Content (CMS), Lookups, Notifications, Settings**: platform
  administration. Health, the permission matrix, sign-in policy, the audit
  feed, content, form dropdowns, notification templates and integrations.

---

## Part 12: The portal, page by page

The sidebar is the journey itself, the six chapters as the spine, showing
done, current and locked.

- **Home / Journey**: the spine, the current step, the next unlock.
- **Consultation**: choose online or in-person, pick a live slot, pay,
  join the call in-app, reschedule or cancel within policy.
- **Enrolment**: the assessment outcome, the decision, package and plan,
  the deposit.
- **Applications**: school choices, the fee invoice, per-school tracking,
  accepting an offer.
- **Visa**: consent, the invoice, live tracking to the decision (a
  refusal parks the case with a reapplication path).
- **Departure**: travel choice, the fee milestone, the checklist,
  document release.
- **Complete**: the post-arrival instalment schedule.
- **Appointments, Documents, Fees, Messages, Security**: bookings, the
  vault, the ledger and receipts, the staff thread plus AI assistant, and
  profile/MFA/sessions.
- **Newsletter pages**: confirm, unsubscribe, and preferences.

---

## Part 13: Data, security and the background engine

### Data posture

Every table is behind row-level security. The app connects as owner, but
any future non-owner path is denied by default rather than silently open.
Anything that's evidence is append-only: audit entries, invoice events,
booking events, assignment history, activity feeds. Corrections append;
history is never edited.

### Background jobs

Work that shouldn't block a request runs on a separate worker process:
emails, campaign sends, push notifications, instalment charges, offline
chat replies, helpdesk SLA checks, automation date-triggers, meeting status
polls, calendar feed syncs, and document cleanup. Until that process runs,
jobs simply wait. Bookings still succeed, but no email sends. It is not
optional in production.

### External services

Paystack for all payments, Resend for all email (delivery, open, bounce and
complaint events flow back through a signed webhook), LiveKit for video
rooms, Supabase for private file storage, Google for client sign-in and
staff calendars, web push for browser notifications, and a pluggable text
provider for phone sign-in (unconfigured by default; the feature refuses
rather than pretending).

### Configuration and deployment

Production refuses to boot without its database, queue, signing secret and
the browser-facing addresses. Misconfiguration fails loudly at startup,
not silently at runtime. The API ships as a Docker image; the front ends
deploy as Cloudflare Workers. The database is migrated by numbered files;
new databases are built directly from the schema because the historical
migration chain doesn't replay cleanly from zero. The rules and the
reasons are written down in the migration discipline notes.

---

*Covers the three deployables (public site + portal, Operations Center,
API + worker) and the shared packages, as of the current codebase.*
