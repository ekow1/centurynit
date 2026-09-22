# Scheduling & Meetings

## Availability — what a client can book

Three inputs decide the slots `GET /bookings/availability` returns:

1. **Branch slot config** (`/scheduling`) — per-weekday open hours
   (`BRANCH_OPEN_START`/`BRANCH_OPEN_END` defaults), slot interval,
   `SLOTS_PER_DAY` cap, `DEFAULT_TIMEZONE`.
2. **Staff working hours** (`staff_working_hours`, `/calendar/working-hours`)
   — a consultant with no hours is not assignable.
3. **Existing bookings + busy blocks** — `calendar_busy_blocks` mirrors
   inbound iCal feeds; availability subtracts both.

`BOOKING_BUFFER_MINUTES` pads around meetings. The double-booking guarantee
is a Postgres **exclusion constraint** (`btree_gist`) — a race can't create
overlapping bookings, which is why the booking tests run on a real database.

## The booking lifecycle (`bookings` + `booking_events`)

`POST /bookings/checkout` → Paystack → `verify-payment` → booking +
consultation rows + invoice + queued notifications. Every transition
(cancel, reschedule, assign, confirm-slot, complete, no-show,
rebook-credit) appends a `booking_events` row — the append-only lifecycle.

**Reschedule requests** are two-sided: a client requests
(`POST /{id}/reschedule-request`), staff approve or decline
(`/{id}/reschedule-decision`); staff-side reschedules are direct.

**No-show & credit** — `POST /{id}/no-show` parks the session;
`POST /consultations/{id}/rebook-credit` issues a rebooking credit.

## Video meetings

- **Provider**: LiveKit rooms for online consultations (`LIVEKIT_*` env);
  Daily is the legacy/alternative (`DAILY_*`). Clients **join inside the
  portal** — no external link needed.
- **Join window** — enforced server-side (`GET /{id}/join`): opens a few
  minutes early, closes after the session.
- **`meetingStatus` worker** — 60-second poll flips meetings to
  live/ended; `GET /bookings/meetings/live` feeds the ops "Now" pane and
  Live Meetings page.
- **Meeting links** — staff set them manually (`POST
  /{id}/meeting-url`, `/generate-meet`, `/resend-meeting-link`); the
  Google-Calendar-conference path was removed — outbound sync is now
  consent-based company calendar (`/calendar/company/*`).

## Calendar feeds — two directions

- **Inbound** — staff paste an iCal URL (`POST /calendar/feeds/me`); the
  `feeds` worker mirrors events into `calendar_busy_blocks` on a recurring
  sync (`POST /feeds/sync` forces one).
- **Outbound** — `GET /calendar/feeds/outbound/{token}` serves the staff
  member's Century bookings as an iCal feed for their personal calendar;
  `/subscription` manages the token (regenerate revokes the old URL).

## Duty & delegation

`coordinator_duty` — which coordinator is on point per branch per day
(`GET/POST /consultations/duty`). `coordination_grants` — a consultant
delegates a session to a colleague (`POST /{id}/delegate`), who can return
it (`/back-to-confirmed`), or the owner reclaims (`/reclaim`).

## Ops surfaces

- **Scheduling** page — the week the branch offers (slot config editor).
- **My availability** (`/my-calendar`) — personal working hours + feed
  connections.
- **Appointments** — the week's consultations; **Live meetings** — rooms
  in progress.
