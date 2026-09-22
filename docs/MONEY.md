# Money — Invoices, Ledger, Payments

Money is **integer cents** everywhere. The invoice pipeline is a two-step
approval chain that drives the journey ladder.

## The invoice lifecycle

```
proforma ──(finance issues)──► issued ──(client pays)──► settled
    │                            │
    └── chapter owner raises ────┴──► void / credit (append-only events)
```

1. **Proforma** — the chapter owner (consultant, visa officer) raises a
   draft estimate on the case (`POST /applications/{id}/raise-*-invoice`
   with a `…-preview` dry-run first). Numbered by `nextProformaNumber`.
2. **Issue** — finance approves and issues (`POST /invoices/{id}/issue`,
   `C:issue_invoices`). Now payable; numbered by `nextInvoiceNumber`.
3. **Settle** — client pays; `paidCentsOf` accumulates `invoice_payments`
   until balance is zero → `settled`. Partial payments are first-class.
4. **Void / credit** — corrections, each appended to `invoice_events`.
   Events are never edited.

`services/invoice.ts` is the single authority: `createInvoice`,
`createConsultationInvoice`, `createProforma`, `recordPayment`,
`voidInvoice`, `creditInvoice`, `applicationFeeLinesFor`,
`nextUncoveredDueAt`, `serializeInvoice`. Routes and the ledger read
through it.

## Payment rails — Paystack only (client side)

- **Checkout** — `POST /me/invoices/{id}/paystack/checkout` initializes a
  transaction (`services/paystack.ts`); the client completes on Paystack,
  then `…/paystack/verify` confirms.
- **Webhook** — `POST /api/webhooks/paystack` (signature-verified) is the
  **settlement authority**: `processPaystackWebhook` marks the transaction,
  writes `invoice_payments`, appends `invoice_events`, fires journey +
  notification side effects. Client-side verify is a fast path; the webhook
  is what must eventually settle.
- **MoMo** — `POST /me/invoices/{id}/momo` + OTP confirm for mobile-money
  charge flows.
- **Reconcile** — `POST /payments/reconcile-paystack` pulls gateway state
  for drift checks; `GET /payments/verify/{reference}` and
  `GET /paystack/transactions` support the ops payments log.
- There is deliberately **no applicant-side "record a payment"** route —
  cash/bank payments are recorded by staff via `recordPayment`.

## Instalments & autopay

- Payment plans live on the invoice/application (full vs instalments);
  post-arrival schedules are client-proposed, staff-approved
  (`C:approve_schedules`).
- `payment_authorizations` stores reusable Paystack authorizations the
  client consented to (`/me/autopay` get/put/delete).
- The `autopay` worker charges due instalments; every attempt appends to
  `autopay_attempts` — failures are visible, never silent.

## Fee structure

- **`fee_definitions`** — the service-fee catalogue (what a fee line *is*).
- **`fee_items`** — third-party fees (embassy, school application) with
  amounts; `/fees/items` CRUD.
- **`destinations`** — per-country tariffs.
- **`service_packages`** — stage-priced packages; clients can enter at
  different stages and select only needed services.
- **`PLATFORM_EXCHANGE_RATE`** — display currency conversion (GHS ↔ USD).

## The ledger

Two views of the same truth:

- **Per-case** — `GET /applications/{id}/ledger`: chapter-numbered journal
  of that case's invoices + payments.
- **Per-client** — `GET /me/ledger` + the ops Client ledger page: the
  client's full account history.
- **`invoice_events`** — the immutable substrate; the ledger is a *view*,
  never a store.

Receipts: `POST /payments/send-receipt` + printable PDFs
(`GET /me/invoices/{id}/pdf`, generated via pdfmake in
`services/pdfEngine.ts`).

## Invariants the code enforces

- A paid invoice cannot be voided — credit instead.
- `recordPayment`/`verifyAndSettlePayment` are idempotent by gateway
  reference (`paymentWithReferenceExists`) — webhook replays and verify
  retries cannot double-settle.
- Deposits trigger journey side effects exactly once (the handler handoff
  fires on the *first* settlement).
- `nextInvoiceNumber`/`nextProformaNumber` allocate inside the same
  transaction as the insert — no gaps from abandoned drafts, no duplicates
  under concurrency.
