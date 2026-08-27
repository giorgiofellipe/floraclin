# Public Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger can go from the marketing site to a paid FloraClin account with no human intervention, and a clinic that stops paying keeps read access to its own records.

**Architecture:** Enforcement extends the mechanism this repo already has. `subscriptionGate` in `src/lib/plans.ts` is DB-backed, resolves the caller's *active* tenant, exempts platform admins, and already honours the "canceled and past_due keep access until `currentPeriodEnd`" promise. Eight routes use it. This plan adds `requireWrite`, a thin wrapper pairing the existing role check with that gate, and applies it to every mutating route. Middleware is touched only for the email-confirmation redirect.

**Tech Stack:** Next.js 16 App Router, NextAuth v5 (JWT strategy, Drizzle adapter), Drizzle + Postgres, Stripe, Resend, vitest.

**Source spec:** `docs/superpowers/specs/2026-08-27-public-subscriptions-design.md`

---

## Why this differs from the spec

An adversarial review rejected the spec's middleware design. Three findings, all verified against the code:

**The JWT cannot enforce expiry.** `auth-config.ts:80` refreshes subscription state only on sign-in or an explicit `session.update()`. The expiry cron and the Stripe webhook write the DB, so an already-logged-in user keeps `trialing` in their token and keeps writing indefinitely. A middleware rule reading that claim enforces nothing.

**The JWT's subscription belongs to the wrong tenant.** `auth-config.ts:83` takes an arbitrary first membership with `.limit(1)`, while routes resolve the active tenant from the `floraclin_tenant_id` cookie (`lib/auth.ts:58`). A user with two clinics would be judged against the wrong one. Middleware would also block platform admins, who `subscriptionGate` explicitly exempts.

**The banner already exists.** `components/layout/subscription-banner.tsx` is rendered by `(platform)/layout.tsx:14`, which reads `getSubscription(auth.tenantId)` from the DB. Creating a second one would duplicate it and downgrade it to stale JWT state.

Two spec decisions are also dropped as no longer justified:

**Trial still starts at signup, not confirmation.** The spec moved it because manual approval could take days. Confirmation takes seconds, so the problem is gone. Keeping `createSubscription` at signup also avoids colliding with the JWT self-heal at `auth-config.ts:132`, which mints a trial for any signed-in user lacking a subscription row.

**`canceled` and `past_due` keep access until `currentPeriodEnd`.** `plans.ts:54`, its tests, and the banner copy all promise this today. Using `subscriptionGate` preserves it rather than silently changing the product.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/write-access.ts` | `requireWrite`: role check plus `subscriptionGate`, one call per mutating route. |
| `src/lib/confirm-email.ts` | Issue and atomically consume confirmation tokens. |
| `src/app/api/billing/confirm/route.ts` | Closes the Stripe redirect race. |
| `src/app/api/auth/confirm/route.ts` | GET renders; POST consumes. |
| `src/app/api/auth/confirm/resend/route.ts` | Re-issues, durably rate limited. |
| `src/app/confirm-email/page.tsx` | Replaces `/pending-approval`. |
| `src/db/migrations/0023_email_confirmation.sql` | Backfills existing users, adds resend throttling columns. |

**Exclusive ownership:** `src/middleware.ts` only in C1. `src/actions/signup.ts` only in B2. `src/lib/auth-config.ts` only in B3.

---

## Group A (parallel — independent files)

### Task A0: Migration — backfill and throttling columns

**Files:** Create `src/db/migrations/0023_email_confirmation.sql`

**This is the task that prevents a production lockout.** 13 users exist; 12 have `email_verified` null, including four paying clinics. Migrations here are applied **manually** (no `db:migrate` script, not in build, not in CI), so this cannot be left implicit.

- [ ] **Step 1: Write the migration**

```sql
-- Existing accounts were vetted by a human through the approval gate that
-- this change removes. Treating them as unverified would lock every current
-- customer out of production the moment the confirmation gate ships.
UPDATE floraclin.users SET email_verified = now() WHERE email_verified IS NULL;

-- Durable resend throttling. An in-memory limiter does not survive Vercel's
-- multiple instances, and this endpoint sends email to an address supplied
-- by an unauthenticated caller.
ALTER TABLE floraclin.verification_tokens
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
```

- [ ] **Step 2: Mirror the columns in `src/db/schema.ts`**

Add `lastSentAt` to `verificationTokens`. Do not change any other column.

- [ ] **Step 3: Verification query for the deploy runbook**

```sql
SELECT count(*) FROM floraclin.users WHERE email_verified IS NULL;
```

Must return 0 before C1 ships. Record this in the task's commit message.

- [ ] **Step 4: Commit**

---

### Task A1: Stripe checkout confirmation

**Files:** Modify `src/lib/stripe.ts`; create `src/app/api/billing/confirm/route.ts`; test `src/app/api/billing/__tests__/confirm.test.ts`

`getPlanBySlug` and `updateSubscriptionPlan`'s options already exist (`subscriptions.ts:36`, `:216`). No changes needed there.

- [ ] **Step 1: Write the failing tests**

Cover: a paid session for the caller's tenant activates; an unpaid session does not; a session whose `metadata.tenantId` is another tenant returns 403; **a paid session whose Stripe subscription is now `canceled` does not reactivate**; an inactive plan is refused; and calling twice produces one active subscription.

- [ ] **Step 2: Run them, confirm they fail**

- [ ] **Step 3: Add the helper to `src/lib/stripe.ts`**

```ts
/** Reads a Checkout Session back, expanding the subscription so the caller
 *  can check its *current* state rather than trusting the session snapshot. */
export async function retrieveCheckoutSession(sessionId: string) {
  return getStripeClient().checkout.sessions.retrieve(sessionId, {
    expand: ['subscription'],
  })
}
```

- [ ] **Step 4: Write the route**

Requirements, each guarding a specific failure the review identified:

- `getAuthContext`, owner only.
- Refuse when `session.metadata.tenantId !== ctx.tenantId`. The session id travels in a URL the customer controls; without this, pasting another clinic's id activates yours on their payment.
- Refuse unless `session.payment_status === 'paid'`.
- **Refuse unless the expanded `session.subscription.status` is currently `active` or `trialing`.** A `cs_…` stays paid forever, so replaying an old one after a cancellation would otherwise resurrect the subscription.
- Refuse when the plan is missing or `active === false`.
- Then `updateSubscriptionPlan(ctx.tenantId, plan.id, 'stripe', { status: 'active', stripeSubscriptionId, stripeCustomerId })`.

- [ ] **Step 5: Run tests, expect PASS. Commit.**

---

### Task A2: Confirmation tokens

**Files:** Create `src/lib/confirm-email.ts`; modify `src/lib/email.ts`; test `src/lib/__tests__/confirm-email.test.ts`

**Two traps, both already solved elsewhere in this repo:**

`reset-request/route.ts:34` deletes *every* token for an identifier. Confirmation tokens must be namespaced `confirm:<email>` or a password reset silently destroys a pending confirmation.

`reset-confirm/route.ts:24` consumes atomically with `DELETE … RETURNING`. A `SELECT` then `DELETE` lets two concurrent clicks both succeed and fire side effects twice. Reuse the atomic pattern.

- [ ] **Step 1: Write the failing tests**

Cover: identifier namespacing and lowercasing; tokens hashed at rest; an expired token is rejected *and* consumed; a token cannot be replayed; two concurrent consumptions yield exactly one success.

- [ ] **Step 2: Run them, confirm they fail**

- [ ] **Step 3: Implement**

`confirmIdentifier`, `hashToken`, `issueConfirmationToken` (24h TTL, sets `lastSentAt`), `consumeConfirmationToken` using `db.delete(...).where(...).returning()` and checking expiry on the returned row, and `markEmailVerified`.

- [ ] **Step 4: Add `sendConfirmationEmail` to `src/lib/email.ts`**

Mirror `sendPasswordResetEmail` exactly: same from address, wrapper, Resend call. Subject "Confirme seu e-mail". Link points at the GET confirmation page.

- [ ] **Step 5: Run tests, expect PASS. Commit.**

---

### Task A3: Booking and slots blocked for expired clinics

**Files:** Modify `src/app/api/book/[slug]/route.ts`, `src/app/api/book/[slug]/slots/route.ts`, `src/app/c/[slug]/page.tsx`, `src/components/booking/booking-page.tsx`; test `src/app/api/book/[slug]/__tests__/route.test.ts`

Unauthenticated, so no middleware or `getAuthContext` gate applies. Each resolves its tenant by slug and checks `isSubscriptionActive` itself.

- [ ] **Step 1: Write the failing tests**

Both `POST /api/book/[slug]` and the slots endpoint return 403 for an expired tenant and behave normally otherwise.

- [ ] **Step 2: Run them, confirm they fail**

- [ ] **Step 3: Guard both routes**

Use `isSubscriptionActive(tenant.id)` so `canceled`/`past_due` retain access until period end, matching everywhere else.

- [ ] **Step 4: Render the closed state**

`page.tsx` passes `acceptingBookings` into `BookingPage`, which renders the clinic header plus "Esta clínica não está aceitando agendamentos online no momento." in place of the form.

**Also handle the late 403.** If the page loaded while active and the subscription lapses before submit, `booking-page.tsx:203` currently shows a generic error. Map a 403 from the booking POST to the same closed state, so a patient never sees a raw error for something they did not cause.

- [ ] **Step 5: Run tests, expect PASS. Commit.**

---

### Task A4: `requireWrite`

**Files:** Create `src/lib/write-access.ts`; test `src/lib/__tests__/write-access.test.ts`

Wraps the two checks every mutating route already performs separately, so applying it is a one-line change per route.

- [ ] **Step 1: Write the failing tests**

Cover: forbidden role throws before the subscription is consulted; an active subscription returns the context; an inactive one returns the 402 response; a platform admin is never blocked; `canceled` within `currentPeriodEnd` passes.

- [ ] **Step 2: Run them, confirm they fail**

- [ ] **Step 3: Implement**

```ts
// src/lib/write-access.ts
import type { NextResponse } from 'next/server'
import { requireRole, type AuthContext, type Role } from '@/lib/auth'
import { subscriptionGate } from '@/lib/plans'

/**
 * Role plus subscription, for any route that mutates tenant data.
 *
 * Deliberately not middleware. Middleware can only see the JWT, which
 * refreshes on sign-in (auth-config.ts:80) and carries an arbitrary first
 * membership (auth-config.ts:83). It would enforce nothing for existing
 * sessions and judge multi-clinic users against the wrong tenant.
 * `subscriptionGate` reads the DB for the caller's active tenant and exempts
 * platform admins.
 *
 * Returns either a context to proceed with, or a response to return.
 */
export async function requireWrite(
  ...roles: Role[]
): Promise<{ ctx: AuthContext; blocked: null } | { ctx: null; blocked: NextResponse }> {
  const ctx = await requireRole(...roles)
  const blocked = await subscriptionGate(ctx)
  return blocked ? { ctx: null, blocked } : { ctx, blocked: null }
}
```

- [ ] **Step 4: Run tests, expect PASS. Commit.**

---

### Task A5: Write-coverage scanner

**Files:** Test `src/app/api/__tests__/write-access-coverage.test.ts`

Depends on A4 existing only by name; write it against the intended API.

- [ ] **Step 1: Write the scanner**

Walk `src/app/api` for files exporting `POST`, `PATCH`, `PUT` or `DELETE`. Assert each either calls `requireWrite`, or appears in an explicit commented exemption list.

Exemptions, each with a stated reason: webhooks (`stripe`, `whatsapp`, `calendar`) and crons are unauthenticated machine callers; `book/[slug]`, `consent/sign`, `anamnesis/token/[token]` are public capability-token routes gated internally; `profile/reset-request` and `reset-confirm` must work while expired; `billing/*` is the way out; `admin/*` is platform-admin only.

**Also scan GET handlers** against a second list. `calendar/auth/callback/route.ts:42` and `whatsapp/templates/[id]/route.ts:46` mutate on GET. The scanner must assert that list is exhaustive, so a new mutating GET fails the build rather than slipping past a method-based rule.

Include a guard-the-guard fixture and per-directory count assertions, in the style of `src/db/queries/__tests__/no-date-in-raw-sql.test.ts`.

**Why this matters most:** the exemption list is maintained by hand and, when it rots, it fails *open*. Nothing else would notice.

- [ ] **Step 2: Run it. It will fail, listing every unguarded route. Record that list; it is B1's worklist.**

- [ ] **Step 3: Commit the scanner as skipped (`describe.skip`) with a comment pointing at B1.**

---

### Task A6: Public capability-token writes

**Files:** Modify `src/app/api/consent/sign/route.ts`, `src/app/api/anamnesis/token/[token]/route.ts`; tests alongside each

Both resolve a tenant from a capability token and mutate records while unauthenticated, so no gate reaches them today.

- [ ] **Step 1: Write failing tests** — each returns 403 when its resolved tenant's subscription is inactive.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Add `isSubscriptionActive(resolvedTenantId)` after token resolution.**

Gate on the tenant the *token* resolves to, never on the caller's session. A logged-in user from an expired clinic must still be able to sign a consent for a different, active clinic.

- [ ] **Step 4: Run tests, expect PASS. Commit.**

---

## Group B (depends on Group A)

### Task B1: Apply `requireWrite` across mutating routes

**Files:** Every route on A5's failing list. **No other task touches these files.**

- [ ] **Step 1: Take the list from A5**

- [ ] **Step 2: Convert each route**

Replace `const ctx = await requireRole(...)` (or the inline role check plus `getAuthContext`) with:

```ts
const { ctx, blocked } = await requireWrite('owner', 'practitioner')
if (blocked) return blocked
```

Mechanical. Do not change any other logic. The eight routes already calling `subscriptionGate` directly convert to the same shape for consistency.

- [ ] **Step 3: Un-skip the A5 scanner and run it. Expect PASS.**

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @floraclin/web test:run`. This touches ~100 files; existing route tests will need their mocks updated to stub `requireWrite`.

- [ ] **Step 5: Commit**

---

### Task B2: Signup creates active, unconfirmed tenants

**Files:** Modify `src/actions/signup.ts`, `src/db/queries/admin-tenants.ts`; test `src/actions/__tests__/signup.test.ts`

Both tenant-creation sites change: `signup.ts:74` and `createSelfSignupTenant` at `admin-tenants.ts:321`.

- [ ] **Step 1: Write failing tests** — credentials signup creates `status: 'active'`, issues a token, sends the email, and redirects to `/confirm-email`.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Set both statuses to `'active'`.**

- [ ] **Step 4: Issue the token and send the email**

Keep `createSubscription` and `notifyDiscord` where they are. Trial-at-signup stays, for the reasons in "Why this differs from the spec".

**Delivery must not strand the account.** The row is already committed and the auto sign-in at `signup.ts:116` follows. Wrap the send so a Resend failure still completes sign-in and still redirects to `/confirm-email`, where the user can resend. A thrown send would otherwise leave an account that exists, cannot be re-registered, and has no session to reach the resend screen.

- [ ] **Step 5: Run tests, expect PASS. Commit.**

---

### Task B3: Confirmation endpoints, screen, and Google stamping

**Files:** Create `src/app/api/auth/confirm/route.ts`, `src/app/api/auth/confirm/resend/route.ts`, `src/app/confirm-email/page.tsx`; modify `src/lib/auth-config.ts`; tests alongside

- [ ] **Step 1: Write failing tests**

Cover: GET does not consume; POST with a valid token verifies; an expired token fails; replay fails; resend inside the cooldown returns 429; resend for an unknown or already-verified address sends nothing but does not reveal which; a new Google user ends up with `emailVerified` set; a Google sign-in linking an existing unconfirmed credentials account satisfies the gate.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: `GET /api/auth/confirm` renders, it does not consume**

Corporate mail scanners follow links before the recipient does. A GET that verifies would be consumed in transit. GET renders a page with a "Confirmar e-mail" button that POSTs the token.

- [ ] **Step 4: `POST` consumes**

`consumeConfirmationToken`, then `markEmailVerified`, then **`session.update()` on the client before navigating**. The JWT still holds `emailVerified: false`; redirecting straight to `/dashboard` would bounce them back to `/confirm-email` forever (`auth-config.ts:80` does not reload without `trigger === 'update'`).

- [ ] **Step 5: Resend, durably throttled**

Use `verification_tokens.last_sent_at` from A0. One send per 60s per identifier, enforced by a conditional UPDATE rather than a read-then-write. Return the same response whether or not the account exists.

- [ ] **Step 6: `/confirm-email` page**

Shows the address, a resend button, and **"Entrar com Google"** given equal prominence. Account linking is already enabled, so Google is the reliable escape from an undelivered email.

- [ ] **Step 7: Stamp Google verification after the user exists**

**Not in the `signIn` callback.** It runs before the adapter creates a new user, so `markEmailVerified` would update zero rows on a first Google sign-in. Stamp in the `jwt` callback on the sign-in pass (where `user` is present) or in an `events.signIn` handler, after persistence. Keep the existing `signIn` rejection of unverified Google profiles exactly as is.

- [ ] **Step 8: Run tests, expect PASS. Commit.**

---

### Task B4: Billing page closes the payment race

**Files:** Modify `src/components/settings/billing-settings.tsx`; test alongside

- [ ] **Step 1: Write failing test** — mounting with `session_id` present POSTs to `/api/billing/confirm`, then calls `update()`, then clears the parameter.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement.** Clearing the parameter matters: a refresh would otherwise re-post the same session id.
- [ ] **Step 4: Run tests, expect PASS. Commit.**

---

## Group C (depends on Group B)

### Task C1: Middleware and the gate's remains

**Files:** Modify `src/middleware.ts`; test `src/__tests__/middleware.test.ts`; delete `src/app/pending-approval/*`

**Middleware changes only for email confirmation.** The `/api/` blanket allow at line 23 stays exactly as it is; write enforcement lives in `requireWrite`.

- [ ] **Step 1: Verify A0's backfill has been applied**

Run the verification query. **If it returns anything other than 0, stop.** Shipping this step first would lock those users out.

- [ ] **Step 2: Write failing tests**

Authenticated with `emailVerified: false` on `/dashboard` redirects to `/confirm-email`; on `/confirm-email` passes; `emailVerified: true` passes; **`emailVerified` absent from the token passes** (a stale token must not lock anyone out); no reference to `/pending-approval` remains.

- [ ] **Step 3: Implement**

Add `emailVerified` to the JWT and session in `auth-config.ts`'s **every** branch that sets `tenantStatus`, including the no-membership branch. Bump `token.v` to 3 so existing tokens are re-minted rather than treated as unverified.

Place the confirmation branch **after** the stale-token check at `middleware.ts:31`, and gate on `=== false` only, never on falsy, so a missing claim fails open.

Delete both `pending_approval` branches.

- [ ] **Step 4: Delete `src/app/pending-approval/*`**

Confirm `grep -rn "pending-approval" src` leaves only the admin list and queries.

- [ ] **Step 5: Run the full suite. Commit.**

---

## Deploy runbook

Order matters; two steps are not reversible in a hurry.

1. Apply `0023_email_confirmation.sql` **manually** against production. Migrations are not automated in this repo.
2. Verify `SELECT count(*) FROM floraclin.users WHERE email_verified IS NULL` returns 0.
3. Deploy.
4. Confirm the Stripe webhook endpoint is trimmed to the five handled events.
5. Sign up as a real stranger, end to end, including payment.

---

## Self-Review

**Spec coverage:** gate removal → B2, C1. Confirmation → A0, A2, B2, B3. Read-only → A3, A4, A5, A6, B1. Payment race → A1, B4.

**File ownership:** `middleware.ts` only C1. `signup.ts` only B2. `auth-config.ts` only B3. `stripe.ts` only A1. `email.ts` only A2. `plans.ts` unmodified.

**Dependencies:** all forward. A5 is written against A4's API and committed skipped, so the two do not block each other. B1 consumes A5's failure list.

**Known risk carried deliberately:** the scanner's exemption lists are hand-maintained and fail open when they rot. That is why A5 asserts per-directory counts and carries a guard-the-guard fixture.
