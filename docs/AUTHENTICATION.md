# Authentication & Access

One identity system — **Better Auth** — serves both audiences. A staff
member is a `users` row that additionally has an `ops_users` row (role +
branch). There is no separate staff identity store.

## Client authentication

Self-registration is open to clients. Methods, per `auth_settings` policy:

| Method | Flow |
|---|---|
| Email + password | Sign-up → verify email → sign in. Password reset via emailed link. |
| Google OAuth | Separate client config in Ops → Platform Settings → Google Sign-In. Callback must end `/api/auth/callback/google` and be registered on the **public web origin**, not the API host. |
| Phone + SMS code | Only when an SMS provider is configured — without one the flow refuses rather than pretending to send. |
| Email one-time code | Passwordless sign-in via emailed OTP. |
| MFA | TOTP (any RFC 6238 app) and/or email OTP. Available to clients, never required — an applicant is not forced to install an authenticator before booking. OAuth users get the email-code path. |

Sessions are Better Auth cookie sessions — `Secure`, `SameSite`, first-party
thanks to the same-origin Worker proxy. Session list, per-session revoke,
ban enforcement (`banned` flag on `users`) apply to clients from
`/client-users`.

## Staff authentication

**Staff never self-register** — there is no staff sign-up endpoint anywhere
in the API. Accounts exist only because someone with `invite_staff` invited
them; the invitee sets their own password (nobody else ever knows it).

- **MFA is required for every staff role** — `requireMfa` enforces it
  server-side (TOTP or email OTP enrolled), not just in the UI. The
  per-role policy lives in `auth_settings`.
- First-run chicken-and-egg: `POST /api/v1/staff/bootstrap` with
  `BOOTSTRAP_TOKEN` creates the first super admin and then refuses forever
  (any staff row disables it). Alternatively `npm run seed:staff`.

## Authorization: roles, modules, capabilities

Defined once in `packages/shared/src/schemas/ops.ts` — the React app uses
it to hide UI, the API's middleware is the **authority**.

### Roles

Built-in `SYSTEM_ROLES` with ranks (invite/edit requires strictly lower
rank; `super_admin` passes everything):

| Role | Rank | Default posture |
|---|---|---|
| `super_admin` | 100 | All modules, all capabilities |
| `admin` | 90 | Platform administration (users, auth, CMS, settings, notifications) + read casework — no case-file work |
| `manager` | 70 | All operational modules + assign work, invite staff, issue invoices, own any chapter |
| `coordinator` | 50 | All cases/branches, assign work, own any chapter — front-desk routing |
| `customer_service` | 40 | Cases (own branch), leads, helpdesk, assign work |
| `consultant` | 30 | Own caseload, chapter ownership (`own:*`), raise proformas |
| `finance` | 30 | Finance suite, issue/void/credit invoices, edit packages, approve schedules |

Custom roles live in `ops_roles` (name, rank, `permissions[]`); a custom
role takes the rank its creator gives it, never above their own. The
built-in matrix in `ROLE_PERMISSIONS`/`ROLE_CAPABILITIES` is the fallback
when no `ops_roles` row exists.

### Modules — what a role can *see* (`requireModule`)

33 modules (`opsModuleSchema`) grouped as in the ops navigation:

- **Core operations**: dashboard, applications, consultations, applicants,
  leads, crm, helpdesk, chat, marketing, appointments, reports
- **Financials**: finance, invoices, ledger, payments, payment-config,
  packages
- **Admissions/visa/travel**: universities, programs, documents, workflow,
  visa, travel
- **Platform admin**: system, users, auth, cms, lookups, site,
  notifications, settings, scheduling

`requireAnyModule("helpdesk","chat")` exists for shared surfaces (the chat
backend serves both the helpdesk page and staff Communication Hub).

### Capabilities — what a role can *do* (`requireCapability`)

`assign_work` · `see_all_cases` · `see_all_branches` · `invite_staff` ·
`manage_roles` · `manage_settings` · `manage_clients` · `edit_packages` ·
`edit_universities` · `issue_invoices` · `approve_schedules` · chapter
ownership: `own:consult`, `own:apply`, `own:visa`, `own:depart`.

Modules and capabilities sit **side by side in one `permissions[]` list** on
a role, so the role editor governs both.

`ownershipCapabilityFor(stage)` maps a case stage to its ownership
capability — the assign-control for each chapter only offers staff holding
the matching `own:*`.

### Branch scoping

`see_all_branches` separates "my branch" from global roles; the API
enforces it via `assertBranchScope` (a staff member without it is
constrained to `ops_users.branch`).

## Middleware chain (`middleware/auth.ts`)

```
requireAuth        session cookie → users row (any signed-in user)
requireStaff       + ops_users row → staff { opsUserId, role, branch }
requireMfa         + TOTP or email-OTP enrolled (per-role policy)
requireModule(m)   + permission list grants module m
requireCapability(c) + permission list grants capability c
requireRole(...r)  + literal role name match (legacy/edge cases)
assertBranchScope  + see_all_branches or own-branch constraint
```

The permission check reads the **live `ops_roles` table** (so role edits
take effect without deploy) and falls back to the built-in matrix.

## Delivery of credentials

- Staff invitation links and one-time codes are emailed via the `email`
  queue — never returned in API responses.
- In development both channels print to the API console instead.
- `BOOTSTRAP_TOKEN`: ≥16 chars, rate-limited (5 failures → 15 min lock),
  and should be removed from the environment after first use.
