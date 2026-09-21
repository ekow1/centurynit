# Century NIT: The Platform, End to End

*Everything the platform does, explained in the order a client actually
meets it. Each chapter says what the client does, what the office does, and
what the system does on its own. A companion to `FEATURES.md`, the
technical version.*

## The three rooms

Century NIT runs the whole consultancy in one system with three rooms that
share a single record of truth.

The public website is the shop window. The client portal is the personal
page every client gets when they book. The ops console is the staff-only
back office where every client, case, payment, and task lives.

All three read the same data. When a consultant marks something done the
client's page already knows, and when a client pays the office sees it the
moment it lands. There is nothing to sync and nothing to copy.

## 1 · Before someone becomes a client: the website

A prospective client lands on a full content site: home, about, why choose
us, destinations, a catalogue of more than a hundred universities,
programs, scholarships, visa services, student services, events, a blog,
FAQs, and a contact page. Every page is live content the office edits
through its CMS, so nothing on the site goes stale by accident.

On the homepage the journey is drawn as a route: a consultation first,
then three stages, Admissions, Visa, Departure. Under it sits a picker with
four options: full journey, admissions only, admissions plus visa, visa
only. Picking "visa only" redraws the route in place: Admissions fades, a
note explains it is skipped because the client already holds an offer, and
the document list reshapes. A visitor can see their exact road before they
pay anything.

Actions a visitor can take: browse and search the catalogue, ask the AI
chat assistant questions at any hour, subscribe to the newsletter (a
confirmation link must be clicked before the address is added, and every
email carries an unsubscribe link that works), fill the enquiry form,
browse events and success stories, and start a booking. All public forms
are guarded by an invisible bot check so the lead list never fills with
spam.

On the office side, every enquiry lands as a lead in a pipeline (new,
contacted, qualified, converted) that staff work, assign, and convert into
clients. Newsletter subscribers become a managed list for campaigns.

## 2 · The door in: the Stage 0 consultation booking

The consultation is Stage 0 and it is the only way a case begins. The
client chooses online or in person, chooses a branch, then picks a day and
time from a calendar built from real staff working hours. Days with no
open slots are greyed out. They pay the consultation fee by card or mobile
money through Paystack, and a confirmation email arrives with their portal
login. They did not request a callback; they bought a real seat in a real
calendar.

What the system does on its own: creates the portal account, holds the slot
so it cannot be sold twice (enforced at the database level, not just in
the interface), sends the confirmation, and places the booking on the
office work queue marked unassigned.

What the office does: a coordinator opens the queue, sees the new booking,
and assigns a consultant. The availability engine already knows who is
free, because slots can only be sold inside someone's working hours and
never twice to the same host.

## 3 · The consultation itself

When the appointment arrives the client opens the portal and presses Join.
The call runs inside the page in the built-in meeting room; there is no
external app to install and each person joins with their own token, so a
forwarded link cannot let a stranger in. If the office prefers, they can
paste a Zoom, Meet, or Teams link on the booking instead, and change it
later. An in-person booking simply carries the branch address in the
confirmation email.

Rescheduling and cancellation are built in rather than handled over the
phone. The client asks to move the slot from the portal; the office
approves the new time against live availability. Cancelling releases the
slot. A no-show is recorded and the fee becomes credit on the client's
file rather than being lost.

During or after the call the consultant completes the consultation record:
the verdict (eligible or not, with notes), the intake answers, and the
scope decision, which stages the client is buying. The intake questions
are shaped by that selection, so a visa-only client answers a different
form from a full-journey client. Completing the consultation turns the
booking into a case.

## 4 · Scope: the plan that shapes everything

Scope is the spine of the whole product. A case is the set of stages the
client paid for, and the stages they did not buy are not greyed-out work;
they are simply not on the plan. A visa-only client's file opens directly
at Stage II, shows Admissions struck through with "not on this plan," and
never asks for a document, a form answer, or a payment that belongs to a
stage they did not buy.

The client's portal shows their own route with the current position, the
next action, and whose move it is. The office can propose a stage when they
believe the client is ready, but a proposal is only a suggestion; only the
client's own yes moves the plan. In the other direction, a client on a
short plan can ask to continue past what they bought; the office approves
or declines, and on approval the plan extends and the new stage's intake
questions are asked at that point, not before. Major transitions also ask
for explicit client consent.

## 5 · Money: milestones, invoices, and a statement that reads like a bank's

Clients do not pay one giant fee. The service fee splits into milestones
tied to the journey: a deposit, a pre-departure amount, and the rest after
arrival in instalments.

The billing flow has two hands on every invoice: the case owner drafts it,
the finance desk approves and issues it, then the client pays online by
card or mobile money. The moment Paystack confirms the payment, the
milestone settles and the stage it gates unlocks by itself. That is the
gate rule: stages open when money actually lands. If a handler raises an
invoice, stage actions wait for it.

The client's payments page reads like a bank statement. Payments that
really happened sit above a divider; scheduled charges still to come sit
below it, quieter. Each entry carries a running balance, a human channel
name (Card, MoMo, Office) instead of a raw code, a reference, and who
recorded it. A declined attempt shows its reason and its retry date. Every
settled payment has a printable receipt.

Staff can also issue custom invoices for anything unusual, apply credits or
refunds, and void an invoice. None of it rewrites history: corrections are
new entries on an append-only record.

## 6 · Stage I: Admissions

For clients on the full journey or admissions scope, Stage I is where the
file becomes applications.

The client chooses schools and programs from the catalogue (the ops side
can also add applications on their behalf), fills the profile and intake
sections in the portal (identity, passport, education, employment, English
test, preferences, funding and sponsor details), and uploads documents to
the vault.

The document vault has a visible lifecycle per file: requested, uploaded,
verified, or rejected with the reason written underneath so the client
knows what to fix. The requested list comes from the client's scope, and a
document already on file is never asked for again. Uploads go straight to
storage on one-time tickets.

The office submits the applications and records each one's status:
preparing, submitted, decision. Offers appear to the client as cards, and
the client accepts one. That accepted offer is a fact on the case that the
visa stage builds on.

At any point in an active case a handler can book a check-in: a free
meeting, part of the plan, never priced. The handler picks a purpose
(offer decision call, visa mock interview, document review, pre-departure
briefing, or general), chooses online or in person at a branch, picks a
host and a slot from the same availability engine, and adds a note that
goes into the client's email. The client gets the email plus a portal
notification, sees it on the Appointments page labelled Check-in, and can
join, request a move, or cancel. Every check-in lands on the case history.

## 7 · Stage II: Visa

When the plan includes visa work, the stage opens after its milestone is
settled, and a visa officer takes that seat on the case. A case is a relay:
the consultant owns admissions, the visa officer owns the visa chapter, a
travel officer owns departure, and the case header shows the whole team at
a glance. Every seat change is recorded with its note, so the file always
remembers who carried it and when.

The client answers the visa intake questions and then follows the tracker
as the file moves through opened, biometrics, decision. If a decision
comes back as a refusal, the portal explains the reapplication path
instead of dead-ending.

## 8 · Stage III: Departure

Departure sits behind a formal border: the case stops until a manager
hands it to a travel officer. No case crosses into a stage unowned.

The client pays the pre-departure milestone, which releases their papers.
They choose how the flight gets booked: Century can issue a ticket invoice
that carries the flight details and confirmation code, or the client books
their own and records the details.

Both sides then work a shared pre-departure checklist organised as your
flight, your papers, before you fly, and finish. Each item has a named
owner, client or office. The client uploads proof per item; the office can
waive an item, but only with a written reason. When everything is done,
the vault unlocks the official documents: admission letter, visa papers,
e-ticket. Ops also has a dedicated departure-checklist view across all
cases.

## 9 · Post-arrival money: instalment plans and auto-pay

For the balance owed after arrival, the client proposes a payment plan:
how many months and how often. The finance desk sets the start date,
approves or declines it, and the instalments compute themselves with the
interest spelled out in the open. Once approved the schedule locks, and
the portal shows the plan's state the whole way.

The client can also switch on auto-pay. With their consent, their card is
saved as a reusable Paystack authorization, and a daily sweep charges each
instalment on its due date. If a charge declines, the system retries,
emails the client, shows a warning banner in the portal, and escalates the
instalment to the office. The sweep stops after the final instalment.
Mobile money cannot auto-debit, so those payments ask the client each
time.

## 10 · Completion and aftercare

When the client flies, the case completes. Instalments keep running in the
background; they never block completion. The whole file stays readable:
every payment and receipt, every meeting, every verified document, every
comment and handoff, forever.

## 11 · Staying in touch: conversations and notifications

Communication runs through the whole journey on both sides.

Client and staff talk in threads tied to the case and its stage, with
typing indicators, read state, and reactions. Clients can also open
helpdesk tickets, which run on the same thread system, so support,
billing questions, and case messages are all conversations rather than
inboxes. Staff have their own internal chat with mentions and presence,
plus an inbox for the messages routed to them.

Every meaningful event notifies the right people: booking confirmed,
payment received, verdict recorded, document verified, check-in scheduled.
Notifications arrive in the in-app bell on both apps, by email, and by
push. Clients and staff can also subscribe to calendar feeds so
appointments appear in their own calendar apps, and the office can attach
a shared company calendar.

## 12 · The office, page by page

The ops console is organised around the same journey. What each surface
does:

Workspace is the morning page. The work queue fills itself with pending
tasks (unassigned consultations, cases needing an owner, invoices to
raise, documents to review, reschedule requests, payments needing a hand),
ordered overdue, today, later, each row carrying its scope. Staff assign
work right from the row. The caseload view shows who is carrying what,
which records are unowned, and which cases have gone quiet, so a stalled
file or an overloaded officer is visible before a client feels it.

Cases is the fleet view, as a list or a board. Every row and card carries
the scope route so a visa-only file is never mistaken for a full journey,
the single next action, the gate, the owner, and quiet days. Filters cover
stage, status, mine/everyone, and sort. On the board a card can only be
dragged forward when the case's own facts allow it.

Case detail is the whole file: the route with the current chapter, the
plan and status, the team seats, a meetings strip, and tabs for overview,
consultation, enrolment, applications, visa, departure, billing, and
documents. From here a handler can book a check-in, comment, propose the
next stage, hand the case off, complete it early with a written reason,
record or review documents, and work the money tab (invoices, payments,
plans, the ledger). A "client sees" hint always shows what the client's
portal is currently telling them.

Consultations is the Stage 0 desk: assign consultants, confirm slots,
generate the meeting room or paste a link, resend the link email, run the
call, record the verdict and intake and scope, mark no-shows, approve
reschedules.

Clients, Leads, Applicants are the people directories: every client with
their scope, every lead in its pipeline stage, every applicant record.

Appointments lists every booking across the office; Live meetings shows
rooms in progress.

The money pages are a set: Invoices (draft, issue, void, credit, custom),
Client ledger (the statement view), Payments log, Fee schedule, Payment
plans (the approval queue for post-arrival proposals), and Finance
reports.

The catalogue pages feed everything else: Universities, Programmes,
Packages, and the Departure checklist template.

Marketing covers campaigns, newsletter lists, and the CMS for site
content. Analytics answers the commercial questions: revenue, conversion,
scope mix, pipeline.

Scheduling and My availability are the two halves of the availability
engine: admins set branch working hours and rules; each staff member
manages their own hours and exceptions.

Administration is its own area: staff and roles, the dynamic permission
matrix, branches, authentication settings, audit logs (append-only), site
and UI settings, notification settings, payment configuration, storage
checks, and system config. A command palette jumps anywhere by keyboard.

## 13 · Who is allowed through which door

Nobody creates a staff account. The first admin is seeded from a secret
server token; everyone else arrives by invitation, and you can only invite
someone to a role below your own rank, so privilege only ever flows
downward.

Roles are not hardcoded. The permission matrix lets admins build custom
roles and toggle which modules each sees and what each may do. A
consultant sees only their own clients; a coordinator sees the queues;
finance sees the money; the IT admin sees settings and accounts but
deliberately not case files. The menu hides what a role cannot use, and
the server refuses it anyway if someone tries the URL directly. A manager
or admin who wants to carry a case personally can self-assign it, which is
recorded like any other assignment.

Sign-in is one system for everyone. Clients sign in with email or phone,
with numbers normalised so a local format and the international format
cannot become two accounts. Email addresses are verified, passwords can be
reset, sessions can be reviewed, and a banned account is refused
everywhere at once. Staff must enrol a second factor, choosing an
authenticator app or an email code; clients can opt in. The database
itself enforces row-level security, so the wrong person's data is refused
even before the application logic runs.

## 14 · Why nothing ever needs a refresh

Under all three rooms runs one engine. There is a single database, and a
client's position is derived from facts (bookings, payments, offers,
documents), never stored as a hand-ticked label, so the portal and the
console cannot disagree.

When anything happens (a payment clears, a check-in is booked, a document
is verified, a message is sent), an event is published and pushed to open
pages over a live stream: boards update, chats update, notifications
arrive, the client's next action changes, all without a reload. If the
stream drops, pages fall back to quiet polling, so the answer is always
fresh either way.

The plumbing behind that: Paystack webhooks confirm money, a queue sends
emails without ever duplicating one, scheduled jobs run the auto-pay
sweep and the reminders, files upload on one-time tickets, and the audit
log records who did what in an append-only trail.

## The promises, in plain words

One record: the portal and the console read the same data, so nothing is
ever out of sync.

Scope is the plan: the client sees only the stages they bought; a skipped
stage is not missing work.

Facts move the journey: position comes from payments, offers, and
bookings, not from boxes ticked early.

The client consents: big moves need the client's own yes. The office
proposes; the client decides.

Money opens doors: stages unlock when payments actually clear.

Two hands on money: one person drafts an invoice, another issues it; voids
and credits stay on the record forever.

No orphans: a case cannot cross into a stage without a named owner in that
seat.

Everything is remembered: assignments, invoices, bookings, comments, and
waivers are append-only, never silently overwritten.

## A few tech words, translated

| You might hear | What it actually means |
|---|---|
| The API | The one brain, the server both apps talk to |
| Derived journey | The client's position is calculated from facts, not stored as a guess |
| Scope | Which stages a client's plan covers: Admissions, Visa, Departure |
| Stage 0 | The paid consultation, the only door into a case |
| Check-in | A free meeting a handler books on a live case, not a paid consultation |
| Proforma | A draft invoice, a quote, not yet payable |
| Milestone | A payment tied to a point in the journey, like deposit or pre-departure |
| Auto-pay | Charging a saved card on each due date, with the client's consent |
| MFA, 2FA | A second proof of identity, an app code or an email code |
| Webhook | Paystack phoning our server to say "the money arrived" |
| Presigned upload | Files go straight to storage with a one-time ticket |
| LiveKit | The video-call engine, so meetings happen inside our own page |
| Turnstile | The invisible bot check on public forms |
| SSE, events | How pages update live without a refresh |
| BullMQ, the sweep | The scheduled jobs, including the daily auto-pay run |
| Append-only | A log you can add to but never edit; the audit trail cannot be rewritten |
| RLS | The database itself refusing to show the wrong person's data |

*Companion to `FEATURES.md` (the technical version). Both describe the
same system; this one leaves out the wiring.*
