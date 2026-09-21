# Century NIT: The Platform, End to End

*Part one is the story: what happens from the first website visit to
arrival abroad. Part two is the map: every surface, and every action that
can be performed on it. A companion to `FEATURES.md`, the technical
version.*

# Part one · Ama's file, start to finish

*A true-to-life walk through the system. Ama is a client buying the full
journey. Behind her is the office: Nana the coordinator, Efua her
consultant, Adjoa at the finance desk, Yaw the visa officer, Selorm the
travel officer, and Kwame the manager. Every beat below is a real feature;
part two lists them all.*

## Sunday night · Ama finds the site

Ama wants a master's in the UK. On the website she browses destinations,
searches the university catalogue, reads a scholarship page, and halfway
down the homepage finds the journey drawn as a route: a consultation,
then Admissions, Visa, Departure. She clicks "visa only" on the picker
just to see, and the route redraws itself: Admissions fades, a note says
it is skipped for clients who already hold an offer, the document list
reshapes. She asks the chat widget a question and the AI assistant
answers (it cannot see anyone's account and says so). She drops her
email in the newsletter box, which will only count once she clicks the
confirm link it sends. Then she books the consultation.

## Monday, 9:14 · She buys a seat, not a promise

On the booking page Ama picks online, picks her branch, and picks Tuesday
at 10:00. Days with no free slots are greyed out because the calendar is
built from real staff working hours. She pays the consultation fee by
mobile money through Paystack, and a confirmation email arrives with her
portal login.

At the same minute, in the ops console, her booking lands on Nana's work
queue marked unassigned. Nana assigns it to Efua; the system already
knows Efua is free, because a slot cannot be sold twice or outside
someone's hours.

## Tuesday, 10:00 · The call inside the page

Ama opens her portal and presses Join. The video call runs inside the
page in the built-in room, each person on their own token, no app to
install. (Had she needed to move it, she would have requested a new slot
and Nana would approve it against live availability. Had she booked in
person, her email would simply carry the branch address. Had she not
shown up, the office could issue a credit and she would rebook once for
free.)

After the call Efua writes the assessment: eligible. Then she makes the
decision that shapes everything, the scope: Ama is buying the full
journey. The booking becomes a case.

## That evening · Her plan arrives

Ama's portal now shows her own route: Stage 0 done, three stages ahead.
Before anything binds she picks her package, sees a quotation of exactly
what the stages cost under it, and chooses how she will pay: "full
payment" or "instalments." She picks instalments: a deposit now, a
pre-departure amount after her visa, the rest after she lands on a
schedule she will pick then. She accepts the quotation, and her consent
card for the first stage follows. The office can propose stages and
re-invite her if she goes quiet, but only her yes moves the plan, and
each stage asks her consent before it begins.

## Wednesday · Two hands on the money

Efua drafts Ama's service-fee invoice from the plan she accepted: the
full-journey bundle on instalments, with the discount shown next to what
the stages would cost one by one. Adjoa at the finance desk approves and
issues it, because every invoice is touched by two people. Ama accepts
it in the portal and pays the deposit by mobile money, confirms the OTP
on her phone, and the moment Paystack phones the server the milestone
settles and the next stage unlocks by itself.

Her payments page already reads like a bank statement: the paid deposit
above the divider, the scheduled charges below, each line with a running
balance, a channel, a reference, and a receipt to print.

## The documents week

The vault asks for what her scope needs: passport, transcripts,
certificates. She uploads them straight to storage. One comes back
rejected with the reason written underneath: "blurry, please rescan."
She fixes it. When Efua needs something specific, she requests it by
name and it appears in the vault as a requested item. Both sides preview
files inside the page, PDFs and images with zoom and rotate, never a
bare download.

## Weeks three to six · The admissions stage

Ama fills her intake sections, chooses five schools, and locks the
list. The office raises the universities' own application fees as a
separate invoice, pass-through money that never counts as Century's
revenue; she pays it the same way, and only then do the submissions go
out. She watches each line move: preparing, submitted, decision. When
Leeds admits her, an offer card appears and she accepts it, a fact on
the case the visa stage will build on.

Midway, Efua books a check-in on the live case: purpose "offer decision
call," online, thirty minutes, a note that lands in Ama's email. Ama
gets the email and a portal notification, sees it on Appointments next
to her old consultation labelled Check-in, and joins from there. It is
free, part of the plan, and it is written into the case history.

## The visa file

The offer is in hand, and on the full journey no new fee gates this
stage: her deposit already covers it. Yaw, the visa officer, takes the
seat and opens the file; the case header now shows the whole team. Ama
signs the visa consent card and answers the visa intake questions. The
embassy's own costs come to her as a visa invoice, pass-through like the
application fees; she pays it and the work proceeds. She follows the
tracker: opened, biometrics, decision. Weeks later the decision reads
approved. (Had it been refused, the page would lay out the
reapplication path rather than dead-ending at a red cross.)

## Getting on the plane

The case stops at the border until Kwame formally hands it to Selorm,
the travel officer; no case crosses a stage unowned. Ama signs the
departure consent, pays the pre-departure milestone, and chooses "Book
with us." Selorm takes the request, raises a ticket invoice with the
flight details, and once Ama pays it the booking lands on the file with
its confirmation code.

The departure page runs four parts: your flight, your papers, before you
fly, finish. Ama uploads proof per checklist item; Selorm waives one
with a written reason. The officer also records the arrival side: when
to report to the school, orientation, accommodation, emergency contacts.
Paying the milestone released her travel papers; when the checklist
clears, the vault releases the final set of official documents:
admission letter, visa papers, e-ticket.

## After she lands

For the balance still owed, Ama proposes an eight-month plan. Adjoa sets
the start date and approves it; the instalments compute with the
interest spelled out and the schedule locks. Ama switches on auto-pay.
Mobile money cannot be saved for recurring debits, so she adds a bank
card, which is saved with her consent and charged on each due date. If a
charge ever declines, it retries, emails her, warns her in the portal,
and escalates to the office; nothing fails silently.

She flies. The case completes. The instalments keep running quietly as
aftercare, and the whole file, every payment, meeting, document, and
handoff, stays readable forever.

## Meanwhile, Kofi

Kofi already holds an offer from a university in Toronto, so his
consultation ends with scope set to visa only. His file opens directly
at Stage II. His route shows Admissions struck through with "not on
this plan." He is never asked for an admissions document, never
invoiced for admissions work; his whole service fee is one line due on
acceptance, because his entry stage is the visa file itself, and the
embassy's costs still come to him as their own pass-through invoice.
Same rails, different stops: the system draws each client their own
map.



# Part two · The surfaces and their actions

## Signing in and your account

One sign-in system for everyone.

**A client can:**

- Sign in with email or phone (numbers are normalised so a local and an
  international format cannot become two accounts)
- Verify their email, reset a password, change email through a
  request-then-confirm flow
- Enrol a second factor (authenticator app or email code) from the portal
- Upload a profile photo, review sessions, delete their own account

**A staff member can:**

- Sign in with email or Google
- Enrol a second factor, which is required before they can work

Nobody creates a staff account. The first admin is seeded from a secret
server token, everyone else arrives by invitation, and you can only
invite someone to a role below your own.

**An admin can:**

- Preview exactly what an invitation says before sending, resend or
  revoke it
- List every live session and revoke any of them
- Set a staff account inactive, blocking sign-in without deleting the
  record
- Ban or reinstate a client, revoke a client's sessions
- Read sign-in statistics

Nobody can modify their own role, and sensitive actions can demand a
step-up: a fresh second-factor check at the moment of the action, not
just at sign-in.

## The client portal, page by page

**Home**: the whole situation in one glance:

- Case reference and the single action waiting on the client, or
  "nothing waiting on you, the file is moving"
- Next appointment, position on the route, what unlocks next
- Schools, invoices due, money paid versus due now
- The people on the case

**Updates**: a feed of progress notes the office posts:

- Grouped as "new since your last visit"
- Author names on each update, repeats collapsed

**Journey pages** (Consultation, Enrolment, Applications, Visa,
Departure, Complete): the stage-by-stage workspace:

- Consent cards and intake forms per stage
- School selection and locking, offer acceptance
- The visa tracker and the refusal guidance
- The departure page described in the story
- The completion state

**Documents**: the vault:

- Upload, preview in the built-in viewer, download, remove
- Read rejection reasons and answer requests

**Payments:**

- The statement ledger and invoices with PDF download
- Pay online by card or by mobile money with OTP
- Pick the payment plan, propose the post-arrival schedule
- Switch auto-pay on or off, print receipts, read decline reasons

**Appointments:**

- Every consultation and check-in with its purpose and type
- Join the room, request a move, cancel
- See the branch address for in-person meetings

**Messages**: threads with the team tied to the case and stage:

- Typing indicators, read receipts, reactions
- Attachments, forwarding, edit and delete
- Helpdesk requests run on the same threads

**Profile:**

- The intake sections: identity, passport, education, employment,
  English test, preferences, funding and sponsor
- Account settings including MFA and photo

## The ops console, page by page

**Workspace**: the morning page:

- Work the auto-filled queue: unassigned consultations, ownerless cases,
  invoices to raise, documents to review, reschedule requests, payments
  needing a hand
- Create tasks by hand for anything the system did not raise
- Assign work right from the row; keep the current item in the "now" pane
- Caseload view: who carries what, what is unowned, what went quiet
- Dashboard above it: the office's totals and trends

**Cases**: the fleet view, list or board:

- Filter by stage, status, mine or everyone; sort; search
- Each row and card carries the scope route, next action, gate, owner,
  quiet days
- Drag a card forward only when the case's own facts allow it

**Case detail**: the whole file on tabs (overview, consultation,
enrolment, applications, visa, departure, billing, documents):

- Book a check-in, comment, propose the next stage
- Claim the case, refer it, hand it off or defer the handoff
- Release a seat, grant or revoke coordination
- Complete the case early with a written reason
- Review documents inline, request documents by name
- Work the billing tab: invoices, payments, plans, ledger
- Read the "client sees" hint that mirrors the portal

**Consultations**: the Stage 0 desk:

- Duty roster and workload view
- Assign or confirm a booking; delegate it (reclaim or send back to
  confirmed); refer it; issue a rebook credit
- Generate the meeting room or paste a link; resend the link email
- Run the call; record verdict, intake, and scope
- Request documents; comment; mark no-shows
- Approve or decline the client's reschedule requests

**Documents**: the review desk:

- Search by client, file, or case; filter by status and category
- Verify, or reject with a required reason the client will read
- Preview inline in the built-in viewer

**Clients, Leads, Applicants**: the people directories:

- Read each client's scope; look up context; revoke sessions; suspend or
  reinstate accounts
- Work leads through the pipeline with logged touches and an event
  timeline
- Delegate and release case coordination on applicants

**Appointments and Live meetings:**

- The week's bookings with urgent states first: live now, unassigned,
  no-show, needs a consultant
- Filter per consultant; watch rooms in progress

**Invoices:**

- Draft, issue, void with a reason, credit, raise custom bills
- Record a payment line by line: cash, bank wire, cheque, POS terminal,
  bank transfer, card, mobile money, direct debit, each with a reference
- Preview pass-through invoices before they go out

**Client ledger, Payments, Fee schedule, Packages, Payment plans,
Finance reports:**

- The statement view of every client's money
- Every payment attempt with channel, gateway fee, net to Century, and
  unmatched flags; produce the official receipt
- Edit stage and milestone prices; define the service bundles
- Approve or decline post-arrival proposals
- Report per period: billed, collected, outstanding, collection rate,
  by branch, by charge type, by package, gateway fees, and the milestones
  the daily sweep had to catch

**Catalogue** (Universities, Programmes, Packages, Departure checklist,
Lookups):

- Create, edit, delete destinations, universities, programs,
  scholarships, all feeding the website and the cases
- Edit per-destination departure checklist templates
- Manage the lookup values that fill form dropdowns

**Marketing:**

- Build mailing lists; import leads or applicants; confirm or
  unsubscribe contacts
- Write email templates
- Run campaigns by email or SMS: draft, preview, test-send, send, cancel
  mid-flight, retry the failures
- Analytics: revenue, conversion, scope mix, pipeline

**Communication** (Helpdesk, staff chat, Inbox):

- Claim client conversations from a queue ordered by longest wait:
  awaiting reply, unclaimed, unread
- Answer with the client's context beside the thread: member since,
  journey, money, next appointment
- Direct-message colleagues with presence (online, on leave, offline)
  and a staff directory
- Read the typed inbox: assignments, cases, bookings, documents,
  payments

**Scheduling and My availability:**

- Admins set branch working hours and slot rules
- Each staff member manages their own hours and exceptions
- One engine powers every slot picker on both sides

**Administration:**

- Manage staff and roles through the dynamic permission matrix
- Grant or revoke case coordination per staff member
- Run invitations with preview, resend, and expiry
- Configure branches, authentication, site and UI, notifications,
  payments, system config
- Read the notification delivery log and the two append-only audit views
- Check storage health; connect the company Google Calendar
- Jump anywhere with the command palette

## Conversations, notifications, and calendars

Chat on both sides is a real messenger: instant send, typing, read
receipts, reactions, attachments, forwarding, edit and delete. Case
threads route to the stage's seat, so a visa question reaches the visa
officer. Helpdesk conversations run on the same threads with a claim
queue. Staff chat adds presence and mentions.

Notifications reach the right person through the in-app bell, email, and
push. Every meaningful event notifies: booking confirmed, payment
received, verdict recorded, document verified, check-in scheduled. The
mail provider reports delivery back, so a bounced email is visible, and
admin keeps a delivery log of every message by recipient and template.

Calendars sync both ways: anyone can subscribe to a feed that drops
appointments into their own calendar app, staff can connect a personal
Google Calendar, and the office can connect a shared company calendar
through Google's consent screen. SMS exists too: it delivers phone
verification codes and carries SMS campaigns.

## Who is allowed through which door

Roles are not hardcoded: the permission matrix builds custom roles and
toggles modules and actions per role, ordered by rank. A consultant sees
their own clients; a coordinator sees the queues; finance sees the
money; IT sees settings but deliberately not case files. Staff are also
scoped to a branch, so views filter to their office. The menu hides what
a role cannot use and the server refuses it anyway. Row-level security
in the database refuses the wrong person's data before the application
even runs. Self-assignment by managers and admins, step-up checks,
inactive accounts, and the invite-only model are all recorded in the
audit trail.

## Why nothing ever needs a refresh

One database, and the client's position is derived from facts (bookings,
payments, offers, documents), never stored as a hand-ticked label, so
portal and console cannot disagree. Each signed-in user holds a private
live stream; staff streams also carry the office broadcast channel. Any
event (payment cleared, check-in booked, document verified, message
sent) publishes and pushes to open pages: boards update, chats update,
bells ring, next actions change, all without a reload. A heartbeat
detects dead connections, and if the stream fails the pages fall back to
quiet polling.

Behind it: Paystack webhooks confirm money (with a reconciliation sweep
for anything missed), Resend webhooks confirm email delivery, a queue
sends mail without duplicating, scheduled jobs run the auto-pay sweep
and reminders, files upload on one-time tickets, and the audit log is
append-only.

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

Two kinds of money, never mixed: the service fee is Century's; external
costs are collected and passed on, and reports keep them apart.

Two hands on money: one person drafts an invoice, another issues it;
voids and credits stay on the record forever.

No orphans: a case cannot cross into a stage without a named owner in
that seat.

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
| Service fee | Century's own fee for the stages a client bought |
| Pass-through invoice | Money collected for someone else: university fees, embassy costs, the airfare |
| Proforma | A draft invoice, a quote, not yet payable |
| Milestone | A payment tied to a point in the journey, like deposit or pre-departure |
| Auto-pay | Charging a saved card on each due date, with the client's consent |
| MoMo OTP | Paying by mobile money: enter the number, confirm with the code on your phone |
| MFA, 2FA | A second proof of identity, an app code or an email code |
| Step-up | A fresh second-factor check demanded at a sensitive action, not just at login |
| Webhook | Paystack or Resend phoning our server to say "it happened" |
| Presigned upload | Files go straight to storage with a one-time ticket |
| Signed link | A short-lived private URL that lets a document preview in the page |
| LiveKit | The video-call engine, so meetings happen inside our own page |
| Turnstile | The invisible bot check on public forms |
| SSE, the stream | The live channel that pushes updates to open pages without a refresh |
| Heartbeat | The stream's keep-alive pulse, so a dead connection is noticed |
| BullMQ, the sweep | The scheduled jobs, including the daily auto-pay and reconciliation runs |
| Append-only | A log you can add to but never edit; the audit trail cannot be rewritten |
| RLS | The database itself refusing to show the wrong person's data |

*Companion to `FEATURES.md` (the technical version). Both describe the
same system; this one leaves out the wiring.*
