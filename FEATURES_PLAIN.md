# Century NIT: The Platform, Explained

*A guided tour of everything the system does, in plain words. Read top to
bottom, or jump to the part you care about.*

## 1. What is this, in one breath?

Century NIT is a consultancy that helps people study abroad. This software is
the **entire business in one system**: the public shop window, the customer's
personal journey page, and the back-office where staff do the work, all
connected, all always up to date.

It has three parts, all sharing the same records:

- **The shop window**: the public website. Anyone can visit: read about
  schools, services, prices and destinations.
- **The customer's room**: the client portal. Each client gets their own
  page showing exactly where they are and what to do next.
- **The staff office**: the ops console. Staff only. Every client, case,
  payment and task lives here. This is where the work gets done.

Because there is **one** record of truth, nothing needs to be "synced". When
a consultant marks a document as checked, the client's page updates instantly.
When a client pays an invoice, the staff side knows at once.

## 2. The customer's journey: the heart of the product

Every client walks the same six-chapter road. The website shows it as a
step-by-step ladder; the client always knows **where they are** and **what's
next**.

| Chapter | Plain name | What happens |
|---|---|---|
| **I. Consultation** | "Meet us" | Client pays for and attends a one-on-one meeting with a consultant, online or in person at a branch, who assesses whether they qualify |
| **II. Enrolment** | "Sign up" | Client says yes, picks a service package and payment plan, pays a deposit |
| **III. Applications** | "Apply to schools" | Client picks schools, pays the application fee, staff submit and track offers |
| **IV. Visa** | "Get the visa" | Client pays the visa fee, staff file the paperwork and track the decision |
| **V. Departure** | "Get ready to fly" | Flight sorted, final fee milestone paid, checklist done, official papers released |
| **VI. Complete** | "Arrived" | Client has departed; any remaining instalments continue as aftercare |

Inside the chapters are smaller steps the client sees one at a time:
"Confirm your enrolment", "A consultant is being assigned", "Pay the visa
fee", "Track your flight". A step only counts as done when it's *actually*
done (money received, offer in hand, document verified), never because
someone ticked a box early.

### The golden rule of the journey

The client's position is worked out from **real facts**: a booking exists, a
payment landed, an offer arrived. Staff can nudge a client *forward* but never
*backward*: if a university already admitted the student, nobody can
accidentally drag them back to an earlier step.

## 3. The Shop Window (public website: no sign-in needed)

| Feature | What a visitor sees and does |
|---|---|
| **Marketing pages** | Home, About, Why Choose Us, Success Stories ("Red Seat"), FAQs, Blog, Events: the usual brochure site |
| **Catalogue browsing** | Destinations, universities, programmes, scholarships: searchable, each with its own detail page, all pulled live from the same catalogue staff maintain |
| **Enquiry widget** | A visitor leaves their name and question → it lands in the staff CRM as a lead |
| **AI assistant** | A chat bubble that answers general questions instantly, day or night (runs on Cloudflare's AI, no staff needed) |
| **Newsletter** | Subscribe box with a confirm-your-email step (double opt-in, so the list stays clean) |
| **Bot protection** | First-time public actions pass a quiet Cloudflare Turnstile check, invisible to humans, hostile to bots |

## 4. The Customer's Room (the client portal)

After signing up, every client gets a personal portal at `/portal`.

### 4.1 Signing in and staying safe

- **Ways in**: email + password, **Google sign-in**, or a **code sent to
  their email or phone**: no password needed for the last two.
- **Second factor (MFA)**: clients can add an authenticator app or email
  codes; the portal gently prompts until they set one up, because their
  documents and payment history live here.
- **Housekeeping**: change email (verified twice), reset password, upload a
  photo (with a crop tool), see active sessions, sign out everywhere.

### 4.2 What the client sees and does, chapter by chapter

**The dashboard** opens with their journey ladder, current step highlighted,
next step named, everything else ticked or locked. It's impossible to get
lost: the page literally says what happens next.

**Chapter I: Consultation**
- Chooses how to meet: **online video call** or **in person at a branch**.
- Picks a branch and a meeting slot from *real live availability*: days with
  no open slots are greyed out on the calendar, and the slot list uses the
  same rule, so the two can never disagree. Before a consultant is assigned,
  a slot is open while the branch still has capacity; after assignment, the
  consultant's own working hours and existing bookings are what count.
  No double-booking, ever.
- Pays the consultation fee online (Paystack, card or mobile money).
- When it's time: online bookings **join the video call inside the portal
  itself** (no Zoom link, no app to install); in-person bookings simply show
  up at the branch, the booking holds the details.
- Can reschedule or cancel within the rules; big changes ask staff to
  approve first.

**Chapter II: Enrolment**
- Sees the consultant's verdict: eligible / conditionally eligible / not
  eligible, with a personal note.
- Answers the one big question: **Confirmed · On hold · Declined**.
- Picks a service package and a payment plan (pay in full or instalments).
- Pays the **10% deposit** online.

**Chapter III: Applications**
- Chooses target schools (how many depends on the package).
- An **application fee invoice** appears: drafted by her consultant, approved
  by the finance desk, paid online by the client.
- Watches each school's file move: *preparing → submitted → decision reached*
  (admitted, waitlisted or unsuccessful; the word "rejected" is never shown
  to the client).
- Accepts the offer they want.

**Chapter IV: Visa**
- Presses "start my visa" (an explicit yes, nothing moves without it).
- Pays the visa invoice.
- Follows the tracker: opened → biometrics → decision. If the answer is a
  refusal, the page explains the reapplication path instead of dead-ending.

**Chapter V: Departure**
- Chooses how the flight gets booked (Century handles it vs they'll book
  their own).
- Pays the **pre-departure fee milestone** (the balance on a full plan, or
  the second milestone on instalments).
- Works through a **pre-departure checklist**: upload proof per item; staff
  can waive an item with a reason.
- When everything's done, the vault unlocks their **official documents**:
  admission letter, visa papers, e-ticket download.

**Chapter VI: Complete**
- Post-arrival instalment schedule: aftercare payments, never a blocker.

### 4.3 Everyday tools inside the portal

- **Document Vault**: upload any requested file (the picker shows upload
  progress like a familiar file dialog). Each document shows its status,
  *uploaded → verified*, or *rejected* with the reason, so the client always
  knows what to fix.
- **Financial page**: every invoice ever raised, what was paid, what's left,
  and a **printable receipt** for each payment, formatted like a real paper
  invoice they can keep with their file.
- **Appointments**: every booking, past and future; reschedule or join a
  call from here.
- **Messages (Communication Center)**: a chat thread straight to the staff
  handling their case, tied to the stage they're in, plus the AI
  assistant for general questions. Staff replies can also arrive by email,
  and the client's email reply lands back in the same thread.
- **Notifications**: a bell with unread counts, plus push notifications on
  their phone/desktop and email for the important moments (invoice raised,
  document verified, decision made).
- **Profile & Security**: personal details, MFA setup, photo.

## 5. The Staff Office (Operations Center at `/ops`)

Staff get a completely separate console. **Nobody can create a staff
account**: the very first administrator is created with a secret server
token; everyone after that arrives **by invitation only**. Staff sign in with
email and password (a reset link covers forgotten passwords), and roles can
be required to use MFA.

### 5.1 The people (roles explained like real jobs)

| Role | In plain words | What they see | What they can do |
|---|---|---|---|
| **Super Admin** | The owner's master key | Everything | Everything |
| **Manager** | The branch/general manager | Every client, every branch | Assign work to anyone, invite staff, edit packages & the university catalogue, issue invoices, step in and own any stage personally |
| **Coordinator** | The dispatcher | Every case, every branch | Route and assign work day to day; can own stages too |
| **Customer Service** | The front desk | Cases at their branch | Assign work, answer questions, first line of support |
| **Consultant** | The caseworker | *Only their own* assigned clients | Run consultations, assess, comment, request documents, update progress, reschedule meetings |
| **Finance Officer** | The accounts desk | Invoices, ledger, payments, packages | Issue, void and credit invoices; edit service packages |
| **Admin** | The IT administrator | Platform settings plus the client account list: **deliberately no case files** | Manage staff accounts, roles, sign-in policy, website content, integrations; can ban or sign out a client account |

Two extra safety nets run underneath:

- **Permissions are checked twice**: the menu hides what a role can't use,
  *and* the server refuses the action anyway, so a clever URL can't sneak
  past.
- **Branches**: most roles see every branch; where a role is limited to one branch,
  the server enforces it.
- **Seniority**: a staff member can only hand out roles *below their own
  rank*: a coordinator can't create a manager.

### 5.2 The Workspace: today's to-do list

The first screen most staff see is a **work queue built automatically from
real records**:

- Every pending task, *unassigned consultation, case waiting for an owner,
  invoice to raise, document to review, reschedule request*, lands here
  grouped as **overdue / due today / later**.
- Filters: mine, unassigned, coordinated, invoicing… plus search.
- **Assign right from the row**: no need to open the record first.
- A **"Now" pane** shows live meetings in progress, and a **Caseload** tab
  shows who's carrying how much.
- Notifications deep-link into the exact task, click, land, act.
- A personal **Inbox** collects every notification meant for them, and a
  **Dashboard** screen gives the numbers at a glance: what needs attention
  today, and how the whole workflow is moving.

### 5.3 Consultations desk

The queue of every booked session. On a booking staff can:

- **Assign or reassign** the consultant; **refer** it to another branch.
- **Delegate**: lend the session to a colleague temporarily, and
  **reclaim** it later. There's also a **duty-coordinator roster** per branch
  per day, so someone is always formally on point.
- **Confirm the slot**, then after the call **complete the assessment**.
  The verdict + note is exactly what the client sees on their outcome card.
- Handle the awkward bits: reschedule approvals, cancellations, **no-show**,
  and **rebook credit** (a missed session becomes credit, not a lost fee).
- Comment, request documents, and read the full activity history of the
  booking.

### 5.4 The case file (Applications)

Once a client enrols, their whole engagement is a **case**: one file with
tabs for each chapter. The case owner can:

- **Move the case between stages**: with hard gates (e.g. the visa stage
  won't open before the visa fee is paid).
- **Assign chapter owners**: the consultant for applications, a **visa
  officer** for the visa chapter, a **travel officer** for departure; each
  picker only offers staff qualified for that chapter.
- Comment, request documents, tick checklist items, record visa details
  (embassy, biometrics, decision), departure details (flight, ticket), and
  the post-arrival payment schedule.
- **Release documents early** (manager and finance only): the override for exceptional
  cases.
- Refer the whole case to another branch.
- View the whole caseload as a **board**: every case as a card in its stage
  column, so the pipeline is visible at a glance.

Two directories sit beside the cases: the **applicant directory** (every
person who has entered the journey) and the **client directory** (every
portal account, where admins can ban or sign someone out). People are looked
up here; their *work* lives in the case file.

The **departure checklist** itself is also configurable: staff decide which
items need the client's proof, which are handled internally, and in what
order they appear.

### 5.5 The money desk

- **Invoices**: two people touch every invoice: the **chapter owner drafts
  it** (a *proforma*, an estimate, not yet payable), then the **finance desk
  approves and issues it**. Only an issued invoice can be paid. Voiding and
  credits exist, and every event is logged forever.
- **The ledger**: a record book that can't be changed: every transaction, every invoice,
  nothing deletable.
- **Payments log**: every gateway record (Paystack and Stripe) with its
  status.
- **Payment config**: which gateways are switched on, and currencies.
- **Fee schedule & packages**: destination tariffs, fee items, package
  tiers, editable by the manager and finance only; everyone else sees
  read-only.
- **Reports**: revenue and operational analytics.

### 5.6 Pipeline & support

- **Leads / CRM**: every enquiry from the website widget (plus manual
  entries) becomes a lead with a pipeline stage and history.
- **Helpdesk**: support tickets, same thread system as client messages.
- **Documents**: the review queue; staff verify or reject each upload with
  a note, and the client's checklist updates instantly.
- **Communication Hub**: staff↔client threads (tied to a case and stage,
  with a way to **escalate** to a senior colleague) plus staff↔staff chat, groups, mentions, reactions,
  attachments, and presence (who's online).

### 5.7 Catalogue & scheduling

- **Universities, programmes, scholarships**: the catalogue the public site
  shows, manager-only editing.
- **Appointments & live meetings**: the bookings diary, online sessions
  have a video-call room staff join from the console; in-person sessions
  are handled at the branch.
- **Scheduling config**: the template that generates every bookable slot.
  Managers and admins set the timezone, general opening hours, slot length
  in minutes, and a cap on slots per day; any weekday can override the
  general hours (e.g. half-day Saturdays). A live preview shows the exact
  slots the settings produce before saving.
- **Staff working hours**: each consultant sets their own weekly hours on a
  **My Calendar** screen; a slot outside their hours, or one they're already
  booked for, simply never appears to clients. Their bookings can also be
  subscribed to from their own calendar app via a personal feed.
- **Live meetings**: a screen listing every video call in progress right
  now, so staff can see what's happening live.
- **Marketing**: email campaigns to mailing lists, with templates and
  recipient tracking.

### 5.8 The engine room (Admin only)

- **System Overview** (health) and **Audit Logs** (who did what, when).
- **Users & Roles**: invite staff, edit roles, a visual **permissions
  matrix**: admins can build custom roles by ticking boxes.
- **Auth settings**: sign-in methods and MFA policy per role.
- **CMS & Site**: the public website's content and branding.
- **Lookups**: the dropdown options in forms.
- **Notifications**: message templates and channels.
- **Settings**: integrations, keys, fee schedule.

## 6. How sign-in works, on both sides

The two apps use the same sign-in engine, but the rules around *who can get
in* are deliberately different.

### The client portal

- **Ways in**: create an account with email + password, sign in with
  **Google**, or get a **code sent to their email or phone**: no password
  at all for the last two.
- **Second factor (MFA)**: clients can add an authenticator app or email
  codes. The portal nudges them until they set one up, because their
  documents and payment history live there. If someone signed up with
  Google (so they have no password), the email code is their second factor.
- **Everyday housekeeping**: reset a forgotten password by email link,
  change email (verified on both the old and the new address), upload a
  photo, see where they're signed in, and sign out everywhere.
- **Bot check**: public pages pass an invisible Turnstile check on first
  use, so sign-up and enquiry forms can't be farmed.

### The staff office (ops and admin)

- **There is no "create account" button.** Staff can't sign themselves up.
  The very first administrator is created once with a secret server token
  (a bootstrap); every account after that arrives **by email invitation**.
- **Rank controls invitations.** Whoever invites picks the role, and can
  only hand out roles *below their own*: a coordinator can invite a
  consultant, never a manager. The invitee sets their own password on the
  invite link; nobody else ever knows it.
- **Sign-in is email + password** at `/ops/login`, deliberately no social
  sign-in for staff. Forgotten passwords reset by email link.
- **MFA is policy, not just a choice**: an admin can require it per role:
  "managers must use MFA", and the console won't let that role past
  without it.
- **Three checks on every request**: is the session valid; has MFA been
  passed if the role needs it; does the role's permissions cover this
  action. The sidebar hides what a role can't use, and the server refuses
  it anyway: the hiding is convenience, the refusal is the security.
- **Every sign-in is recorded** in the audit trail, and admins can ban,
  unban, or sign out a client account from the console.

## 7. How the two sides stay in step: no manual syncing

People often ask "how does the portal know what ops did?" The honest answer:
**there's nothing to sync, it's one system with two faces.** The interesting
part is the *rules* that keep work orderly:

| Mechanism | In plain words |
|---|---|
| **One record of truth** | Client and staff read and write the same records. No copy-paste between systems, ever. |
| **Case assignment** | A permanent log of *who owns what, since when*. Reassigning closes the old entry and opens a new one, the history is never erased. |
| **Chapter owners** | Different specialists can own different chapters of the same case: consultant for applications, visa officer for visa, travel officer for departure. |
| **Handing the case over** | When a case reaches Departure, it *stops at the border* until a manager formally passes it to a travel officer, nothing slips through unowned. |
| **Delegation** | A consultant can lend a consultation to a colleague and take it back, plus a daily duty roster so someone is always on point. |
| **Client consent** | Big steps need the client's own yes (enrolment, visa start, travel choices). Staff can't drag a client past a consent they haven't given. |
| **Payment gates** | Stages open when invoices are *paid*, not when staff say so; Paystack confirms money automatically. |
| **Documents** | Client uploads → staff verify/reject → the journey moves. Both sides always see the same status. |
| **Notifications** | Every meaningful event notifies the right person: in-app, email, and phone push. |
| **Audit trail** | Assignments, invoices, bookings, comments, settings changes, all append-only. Nothing is ever silently overwritten. |

## 8. A day in the life: the whole flow, end to end

Here's the same story you'll demo:

1. **Ama** visits the website, browses universities, and books a
   consultation. She chooses **online**, picks a slot and pays online.
2. In the staff office, her booking appears on the **work queue** marked
   *unassigned*. The **coordinator** assigns her to consultant **Efua**.
3. Ama joins the video call **inside her portal** (had she booked in person,
   she'd simply come to the branch). Afterwards Efua completes
   the assessment: *Eligible*. Ama's page updates instantly with the verdict
   and Efua's note.
4. Ama confirms her enrolment, picks a package and instalment plan, and pays
   the deposit. That payment flags her case as **ready for a consultant**: the manager
   assigns her a case consultant.
5. Ama chooses her schools. Her **consultant drafts the invoice** (an
   estimate), the **finance officer approves it**, and Ama pays it online.
   Staff submit her applications, and she watches the offers come in on her
   tracker, then accepts one.
6. She consents to the visa stage. The **visa officer drafts the invoice**,
   **finance approves it**, Ama pays, and the visa officer takes over while
   she follows opened → biometrics → decision live.
7. The case hits the **Departure gate**: it can't move until the manager
   hands it to a **travel officer**. Flight booked, fee milestone paid,
   checklist ticked off, and her official documents unlock in the vault.
8. Complete. Her post-arrival instalments keep running quietly in the
   background.

Every one of those steps is a real feature you can click during the demo;
nothing is mocked.

## 9. Small glossary for the tech words you'll hear

| You might hear | What it actually means |
|---|---|
| "The API" | The one brain, the server both apps talk to |
| "Derived journey" | The client's position is *calculated from facts*, not stored as a guess |
| "Proforma" | A draft invoice, a quote, not yet payable |
| "RLS / row-level security" | The database itself refuses to show the wrong person's data |
| "MFA / 2FA" | A second proof of identity, app code or email code |
| "Webhook" | Paystack phones our server to say "the money arrived" |
| "Presigned upload" | Files go straight to storage with a one-time ticket, fast and safe |
| "LiveKit" | The video-call engine, the meeting happens inside our own page |
| "Turnstile" | Invisible bot check on public forms |
| "Append-only" | A log you can add to but never edit; the audit trail can't be rewritten |

*Companion to `FEATURES.md` (the technical version). Both describe the same
system; this one just leaves out the wiring.*
