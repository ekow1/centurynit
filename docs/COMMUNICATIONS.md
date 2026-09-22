# Communications — Chat, Helpdesk, Notifications, Audit

## The conversation substrate

One thread model (`conversations` + `conversation_participants` +
`messages` + `message_attachments` + `message_mentions` +
`message_reactions`) serves three surfaces:

| Surface | Audience | Route group |
|---|---|---|
| **Helpdesk** | client ↔ staff, scoped to case/stage | `/chat` (`requireAnyModule("helpdesk","chat")`) + client side via `/me/conversation` |
| **Communication Hub** | staff ↔ staff (DMs, groups) + escalations | `/communication` (`S`) |
| **Client Communication Center** | the portal's threaded chat + AI assistant | `/me/communication` (`A`) |

`conversations` carries the helpdesk lifecycle (migration 0110): `subject`,
`category`, `priority`, `waiting_on`, `audience`, `first_response_at`,
`resolved_at`, `csat_score`, `csat_note`. `communication_events` is the
append-only lifecycle log (routed → assigned → escalated → resolved →
rated).

- **Escalations** — `POST /conversations/{id}/escalate` raises a thread to
  manager attention; `waiting_on` tracks who's blocking.
- **Canned replies** — staff quick-replies (`/chat/canned-replies` CRUD),
  RLS-locked since migration 0113.
- **Requests queue** — `GET /chat/requests` + `GET /chat/desk/stats` power
  the helpdesk desk view.
- **Presence** — `GET /communication/presence`, `POST /heartbeat`,
  `POST /{id}/typing` — live indicators; `staff_presence` is the table.
- **Offline replies** — the `chatReplyEmail` worker emails a reply to a
  client who's offline; **inbound email threading** lands replies back on
  the conversation by token.

The shared React components (`century-nit-chat-ui`: message list, composer,
reactions, mentions, typing indicator, forward dialog) are reused by both
front ends.

## Notifications

`services/notify.ts` — `notify(event)` is the single entry point; it fans
out to channels and writes the evidence:

- **`notifications`** — in-app rows (kind, payload, read flag). Clients see
  only **client-safe event kinds** — staff-only kinds never reach the
  portal feed.
- **`notification_log`** — every channel attempt (in-app / email / push)
  per notification with status + provider id; `POST /log/{id}/resend`
  retries a failed delivery.
- **`notification_preferences`** — per-user opt matrix (event kind ×
  channel); both portal and ops have preferences surfaces.
- **`push_subscriptions`** + `push` worker — web-push delivery (VAPID;
  `GET /push/vapid-public-key` for subscribe).
- **Catalogue** — `GET /notifications/catalogue` lists every event kind,
  its default channel set and audience; `GET /notifications/health`
  reports channel health.

Recipient resolvers (`getManagerAndCoordinatorUserIds`,
`getInvoiceApproverContacts`, `getCustomerServiceContacts`,
`getStaffUserIdByEmail`) turn "notify the right role" into user ids.

Email goes through the `email` queue — idempotency-keyed so a duplicate
job id is a no-op and a failed send can never roll back a booking.

## Realtime events — SSE

`GET /api/v1/events/stream` — server-sent events for domain moments (stage
change, assignment, invoice issued/settled, visa update, message). The
portal's `syncFromServer` is push-driven; 20–30 s polling is only a
fallback for a dropped stream.

## Audit — the hash-chained trail

`admin_audit` (services/audit.ts) records every administrative action:
category, action, actor, target, detail, IP. Every row **seals the
previous row's hash** — `hash = sha256(prevHash | category | action |
actor | target | detail | ip)` — so an UPDATE or DELETE anywhere breaks
the chain.

- `GET /settings/audit` — the feed (URL-filterable, day-grouped).
- `GET /settings/audit/verify` — replays the chain; proves nothing was
  edited or deleted. The ops Audit page shows the chain badge.
- `GET /settings/audit/export`, `/audit/events`, `/audit/related` —
  compliance export, kind filtering, "everything touching this record".
- `GET /settings/admin-audit` — the broader admin trail.
- `settings_audit` — config changes specifically.
- `requestIp(c)` stamps the actor's IP on every audited write.

Alert rules (`/settings/alert-rules`) watch the stream and notify on
matching events (e.g. failed sign-in bursts, role changes).
