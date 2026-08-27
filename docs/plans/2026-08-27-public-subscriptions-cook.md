# Public Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger can go from the marketing site to a paid FloraClin account with no human intervention, and a clinic that stops paying keeps read access to its own records.

**Architecture:** Three changes that only make sense together. The manual approval gate is replaced by email confirmation, so self-serve does not also mean open season for bots. Subscription expiry becomes read-only, enforced by one method-based rule in middleware rather than 108 per-route guards. And a confirm endpoint closes the race between Stripe's redirect and its webhook, so nobody pays and stays locked out.

**Tech Stack:** Next.js 16 App Router, NextAuth v5 (JWT strategy, Drizzle adapter), Drizzle + Supabase Postgres, Stripe, Resend, vitest.

**Source spec:** `docs/superpowers/specs/2026-08-27-public-subscriptions-design.md`

---

## File Structure

New modules, and why each exists as its own file:

| File | Responsibility |
|---|---|
| `src/lib/write-access.ts` | The read-only policy: which paths and methods survive an expired subscription. Its own module so middleware and the coverage test share one source of truth instead of two drifting copies. |
| `src/lib/confirm-email.ts` | Issue, verify and consume confirmation tokens. Separate from `lib/email.ts` because the token lifecycle is logic worth testing without touching Resend. |
| `src/app/api/billing/confirm/route.ts` | Closes the Stripe redirect race. |
| `src/app/api/auth/confirm/route.ts` | Consumes a confirmation token. |
| `src/app/api/auth/confirm/resend/route.ts` | Re-issues one, rate limited. |
| `src/app/confirm-email/page.tsx` | Replaces `/pending-approval`. |
| `src/components/billing/subscription-banner.tsx` | The persistent read-only banner. |

**Critical ownership note:** `src/middleware.ts` is modified by exactly one task (B1) even though three separate concerns touch it. Splitting it across agents would conflict. Same for `src/actions/signup.ts`, owned only by B2.

---

## Group A (parallel — no shared files)

### Task A1: Stripe checkout confirmation

**Files:**
- Modify: `src/lib/stripe.ts`
- Create: `src/app/api/billing/confirm/route.ts`
- Test: `src/app/api/billing/__tests__/confirm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/billing/__tests__/confirm.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const retrieveCheckoutSessionMock = vi.fn()
const updateSubscriptionPlanMock = vi.fn()
const getPlanBySlugMock = vi.fn()

vi.mock('@/lib/stripe', () => ({
  retrieveCheckoutSession: (...a: unknown[]) => retrieveCheckoutSessionMock(...a),
}))
vi.mock('@/db/queries/subscriptions', () => ({
  updateSubscriptionPlan: (...a: unknown[]) => updateSubscriptionPlanMock(...a),
  getPlanBySlug: (...a: unknown[]) => getPlanBySlugMock(...a),
}))
vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(async () => ({ tenantId: 'tenant-1', role: 'owner', userId: 'u1' })),
}))

import { POST } from '../confirm/route'

function req(body: unknown) {
  return new Request('http://localhost/api/billing/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getPlanBySlugMock.mockResolvedValue({ id: 'plan-1', slug: 'starter', active: true })
})

describe('POST /api/billing/confirm', () => {
  it('activates the subscription when the session is paid', async () => {
    retrieveCheckoutSessionMock.mockResolvedValue({
      payment_status: 'paid',
      subscription: 'sub_123',
      customer: 'cus_123',
      metadata: { tenantId: 'tenant-1', planSlug: 'starter' },
    })

    const res = await POST(req({ sessionId: 'cs_1' }))

    expect(res.status).toBe(200)
    expect(updateSubscriptionPlanMock).toHaveBeenCalledWith(
      'tenant-1',
      'plan-1',
      'stripe',
      expect.objectContaining({ status: 'active', stripeSubscriptionId: 'sub_123' }),
    )
  })

  it('does not activate an unpaid session', async () => {
    retrieveCheckoutSessionMock.mockResolvedValue({
      payment_status: 'unpaid',
      metadata: { tenantId: 'tenant-1', planSlug: 'starter' },
    })

    const res = await POST(req({ sessionId: 'cs_1' }))

    expect(res.status).toBe(200)
    expect(updateSubscriptionPlanMock).not.toHaveBeenCalled()
  })

  it('refuses a session belonging to another tenant', async () => {
    // The session id travels in a URL the customer can edit. Without this
    // check, pasting someone else's session id would activate your account
    // on their payment.
    retrieveCheckoutSessionMock.mockResolvedValue({
      payment_status: 'paid',
      subscription: 'sub_123',
      metadata: { tenantId: 'someone-else', planSlug: 'starter' },
    })

    const res = await POST(req({ sessionId: 'cs_1' }))

    expect(res.status).toBe(403)
    expect(updateSubscriptionPlanMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm exec vitest run src/app/api/billing/__tests__/confirm.test.ts`
Expected: FAIL, cannot resolve `../confirm/route`.

- [ ] **Step 3: Add the Stripe helper**

Append to `src/lib/stripe.ts`:

```ts
/**
 * Reads a Checkout Session back from Stripe.
 *
 * Used to close the gap between Stripe redirecting the customer to
 * `success_url` and the webhook arriving. Without it a clinic pays, returns
 * to the app, and is still told to subscribe.
 */
export async function retrieveCheckoutSession(sessionId: string) {
  return getStripeClient().checkout.sessions.retrieve(sessionId)
}
```

- [ ] **Step 4: Write the route**

```ts
// src/app/api/billing/confirm/route.ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { retrieveCheckoutSession } from '@/lib/stripe'
import { getPlanBySlug, updateSubscriptionPlan } from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'

/**
 * Activates a subscription straight from a completed Checkout Session.
 *
 * Stripe redirects the customer back before the webhook necessarily lands,
 * and `subscriptionStatus` lives in a JWT that only refreshes on sign-in. So
 * the webhook alone is not enough: the customer would return from a
 * successful payment into a read-only app telling them to subscribe.
 *
 * Idempotent with the webhook by design. Whichever arrives first activates,
 * and the other is a no-op, because `updateSubscriptionPlan` writes the same
 * end state either way.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const sessionId = body.sessionId as string | undefined
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId é obrigatório' }, { status: 400 })
    }

    const session = await retrieveCheckoutSession(sessionId)

    // The session id arrives in a URL the customer controls. Binding it to
    // the caller's tenant stops one clinic activating itself on another's
    // payment.
    if (session.metadata?.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ activated: false })
    }

    const planSlug = session.metadata?.planSlug
    if (!planSlug) return NextResponse.json({ activated: false })

    const plan = await getPlanBySlug(planSlug)
    if (!plan) return NextResponse.json({ activated: false })

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id

    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id

    await updateSubscriptionPlan(ctx.tenantId, plan.id, 'stripe', {
      status: 'active',
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
    })

    return NextResponse.json({ activated: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm exec vitest run src/app/api/billing/__tests__/confirm.test.ts`

- [ ] **Step 6: Verify `updateSubscriptionPlan` accepts those option keys**

Read `src/db/queries/subscriptions.ts`. If its options type lacks `stripeSubscriptionId` or `stripeCustomerId`, extend it. Do not change its behaviour otherwise; the webhook depends on it.

---

### Task A2: Confirmation tokens and email

**Files:**
- Create: `src/lib/confirm-email.ts`
- Modify: `src/lib/email.ts`
- Test: `src/lib/__tests__/confirm-email.test.ts`

**Context you need:** `src/app/api/profile/reset-request/route.ts` already establishes the token pattern: 32 random bytes, sha256 hashed at rest, raw token in the email, `delete`-then-`insert` per identifier, one hour expiry.

**The trap:** that delete removes *every* row for an identifier. If confirmation tokens used the bare email as identifier, a password reset would silently destroy a pending confirmation and strand the account with no visible cause. Confirmation tokens are namespaced `confirm:<email>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/confirm-email.test.ts
import { describe, expect, it } from 'vitest'
import { confirmIdentifier, hashToken } from '@/lib/confirm-email'

describe('confirm-email tokens', () => {
  it('namespaces the identifier so a password reset cannot destroy it', () => {
    // reset-request deletes every verification_tokens row for an identifier.
    // Sharing the bare email would make a reset silently strand a signup.
    expect(confirmIdentifier('a@b.com')).toBe('confirm:a@b.com')
    expect(confirmIdentifier('A@B.com')).toBe('confirm:a@b.com')
  })

  it('hashes tokens so a database read cannot confirm an account', () => {
    const raw = 'abc123'
    expect(hashToken(raw)).not.toBe(raw)
    expect(hashToken(raw)).toBe(hashToken(raw))
    expect(hashToken(raw)).toHaveLength(64)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm exec vitest run src/lib/__tests__/confirm-email.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/confirm-email.ts
import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { users, verificationTokens } from '@/db/schema'

/** 24 hours, not the one hour a password reset gets. This is first contact
 *  and may well be read the next morning. */
const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Confirmation tokens share `verification_tokens` with password resets, and
 * `reset-request` deletes every row for an identifier before inserting. The
 * namespace is what stops a reset from silently destroying a pending
 * confirmation.
 */
export function confirmIdentifier(email: string): string {
  return `confirm:${email.toLowerCase()}`
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/** Issues a token and returns the raw value, which only ever leaves in an
 *  email. The database keeps the hash. */
export async function issueConfirmationToken(email: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex')
  const identifier = confirmIdentifier(email)

  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier))
  await db.insert(verificationTokens).values({
    identifier,
    token: hashToken(raw),
    expires: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS),
  })

  return raw
}

/**
 * Consumes a token. Returns the confirmed email, or null when the token is
 * unknown or expired. Deletes on success so a link cannot be replayed.
 */
export async function consumeConfirmationToken(
  email: string,
  rawToken: string,
): Promise<string | null> {
  const identifier = confirmIdentifier(email)

  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, hashToken(rawToken)),
      ),
    )
    .limit(1)

  if (!row) return null

  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier))

  if (row.expires.getTime() < Date.now()) return null

  return email.toLowerCase()
}

/** Marks the account verified. Also the join point for the Google path, so a
 *  linked Google sign-in satisfies a pending credentials confirmation. */
export async function markEmailVerified(email: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.email, email.toLowerCase()))
}
```

- [ ] **Step 4: Add the email**

Append to `src/lib/email.ts`, following the existing `sendPasswordResetEmail` shape and tone (Portuguese, same layout):

```ts
export async function sendConfirmationEmail(email: string, url: string, clinicName: string) {
  // Mirror sendPasswordResetEmail's structure exactly: same from address,
  // same wrapper markup, same Resend call. Subject: "Confirme seu e-mail".
  // Body: welcome the clinic by name, one primary button to `url`, and a note
  // that the link expires in 24 hours.
}
```

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/lib/confirm-email.ts src/lib/email.ts src/lib/__tests__/confirm-email.test.ts
git commit -m "feat(auth): confirmation token lifecycle"
```

---

### Task A3: Block public booking for expired clinics

**Files:**
- Modify: `src/app/api/book/[slug]/route.ts`
- Modify: `src/app/c/[slug]/page.tsx`
- Modify: `src/components/booking/booking-page.tsx`
- Test: `src/app/api/book/[slug]/__tests__/route.test.ts`

**Why this is not covered by middleware:** the booking route is unauthenticated, so middleware cannot know which tenant it concerns. It resolves the tenant by slug and checks for itself.

**Requirement:** a patient must never see an error. The page renders a closed message.

- [ ] **Step 1: Write the failing test**

Test that `POST /api/book/[slug]` returns 403 with a Portuguese message when the tenant's subscription is not `trialing` or `active`, and still creates the appointment when it is. Mock `isSubscriptionActive` from `@/lib/plans`.

- [ ] **Step 2: Run it, confirm it fails**

- [ ] **Step 3: Guard the route**

In `src/app/api/book/[slug]/route.ts`, after resolving the tenant from the slug and before creating anything:

```ts
// Unauthenticated, so middleware cannot identify the tenant. Checked here
// instead. A patient sees a closed-bookings message rather than an error;
// they have done nothing wrong.
if (!(await isSubscriptionActive(tenant.id))) {
  return NextResponse.json(
    { error: 'Esta clínica não está aceitando agendamentos online no momento.' },
    { status: 403 },
  )
}
```

- [ ] **Step 4: Render the closed state**

`src/app/c/[slug]/page.tsx` already loads the tenant. Also resolve `isSubscriptionActive(tenant.id)` and pass `acceptingBookings` into `BookingPage`. When false, `booking-page.tsx` renders the clinic header and a single message in place of the booking form: `Esta clínica não está aceitando agendamentos online no momento.` Keep the clinic's name and logo visible; only the form is replaced.

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

---

### Task A4: Read-only banner

**Files:**
- Create: `src/components/billing/subscription-banner.tsx`
- Modify: `src/app/(platform)/layout.tsx`
- Test: `src/components/billing/__tests__/subscription-banner.test.tsx`

- [ ] **Step 1: Write the failing test**

Assert: renders nothing for `trialing` and `active`; renders a message plus a link to `/configuracoes?tab=assinatura` for `expired`, `canceled` and `past_due`; is not dismissible (no close control).

- [ ] **Step 2: Run it, confirm it fails**

- [ ] **Step 3: Implement**

```tsx
// src/components/billing/subscription-banner.tsx
const ACTIVE_STATUSES = ['trialing', 'active']

/**
 * Persistent, not dismissible. An expired clinic can still read everything
 * it owns but cannot change any of it, and read-only should never be a
 * mystery: the banner is the only thing explaining why saving fails.
 */
export function SubscriptionBanner({ status }: { status: string | null }) {
  if (status && ACTIVE_STATUSES.includes(status)) return null
  // Render: amber bar, "Sua assinatura expirou. Você ainda pode consultar
  // seus dados, mas não fazer alterações.", link "Assinar agora" ->
  // /configuracoes?tab=assinatura
}
```

Wire into `src/app/(platform)/layout.tsx` above the main content, reading the status from the session. Follow how the layout already reads session values.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

---

### Task A5: Write-access policy and its coverage test

**Files:**
- Create: `src/lib/write-access.ts`
- Test: `src/lib/__tests__/write-access.test.ts`
- Test: `src/app/api/__tests__/write-access-coverage.test.ts`

This task owns the policy. B1 only wires it into middleware, so the rule and the test that guards it cannot drift apart.

- [ ] **Step 1: Write the failing unit test**

```ts
// src/lib/__tests__/write-access.test.ts
import { describe, expect, it } from 'vitest'
import { requiresActiveSubscription } from '@/lib/write-access'

describe('requiresActiveSubscription', () => {
  it('lets every read through', () => {
    expect(requiresActiveSubscription('/api/patients', 'GET')).toBe(false)
    expect(requiresActiveSubscription('/api/patients', 'HEAD')).toBe(false)
  })

  it('catches every write', () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(requiresActiveSubscription('/api/patients', m)).toBe(true)
    }
  })

  it('always allows the path out of the problem', () => {
    // Blocking billing would trap an expired clinic with no way to pay.
    expect(requiresActiveSubscription('/api/billing/checkout', 'POST')).toBe(false)
    expect(requiresActiveSubscription('/api/billing/confirm', 'POST')).toBe(false)
  })

  it('never blocks auth', () => {
    expect(requiresActiveSubscription('/api/auth/signout', 'POST')).toBe(false)
  })

  it('ignores paths outside /api', () => {
    expect(requiresActiveSubscription('/dashboard', 'POST')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

- [ ] **Step 3: Implement**

```ts
// src/lib/write-access.ts

/** Read methods. Everything else mutates and needs an active subscription. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Paths that must keep working while a subscription is expired.
 *
 * `/api/billing` is the way out: block it and an expired clinic can never
 * pay, which turns a soft lapse into a permanent one. `/api/auth` must stay
 * open or they cannot even sign out.
 *
 * Webhooks and crons are deliberately absent. They are unauthenticated, so
 * the middleware rule never reaches them, and listing them here would imply
 * a guarantee this module does not provide.
 */
export const WRITE_ACCESS_ALLOWLIST = ['/api/billing/', '/api/auth/'] as const

export function requiresActiveSubscription(pathname: string, method: string): boolean {
  if (!pathname.startsWith('/api/')) return false
  if (READ_METHODS.has(method.toUpperCase())) return false
  return !WRITE_ACCESS_ALLOWLIST.some((prefix) => pathname.startsWith(prefix))
}
```

- [ ] **Step 4: Write the coverage scanner**

```ts
// src/app/api/__tests__/write-access-coverage.test.ts
```

Walk `src/app/api` for files exporting `POST`, `PATCH`, `PUT` or `DELETE`. Derive each route's URL path from its directory. Assert every one is either caught by `requiresActiveSubscription(path, 'POST')` or appears in an explicit, commented list of intentional exceptions (the webhooks, the crons, the public booking and consent routes, the password reset routes).

Include a guard-the-guard fixture proving the walker actually finds routes, in the style of `src/db/queries/__tests__/no-date-in-raw-sql.test.ts`. Assert a non-trivial route count per directory rather than one total, so a moved directory fails loudly instead of silently shrinking the scan.

**Why this test exists:** the allowlist is a prefix list maintained by hand. When it rots, it fails *open*: a new mutating route silently becomes free. Nothing else in the codebase would notice.

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

---

### Task A6: Persist and expose email verification

**Files:**
- Modify: `src/lib/auth-config.ts`
- Test: `src/lib/__tests__/auth-config-verification.test.ts`

**Context:** the `signIn` callback at `src/lib/auth-config.ts:66` already refuses a Google profile whose `email_verified` is false. It never persists that fact, which is why both existing Google users show `emailVerified: null`. `allowDangerousEmailAccountLinking` is already true, justified by exactly that check.

- [ ] **Step 1: Write the failing test**

Assert the `signIn` callback still returns false for an unverified Google profile, returns true for a verified one, and calls `markEmailVerified` with the profile email in that case.

- [ ] **Step 2: Run it, confirm it fails**

- [ ] **Step 3: Stamp on Google sign-in**

```ts
async signIn({ account, profile }) {
  if (account?.provider === 'google') {
    if (!(profile as any)?.email_verified) return false

    // Google has asserted the address, so a Google sign-in also satisfies a
    // pending credentials confirmation for the same email. Account linking is
    // already on, which makes "entrar com Google" the escape hatch for a
    // confirmation email that never arrived.
    const email = (profile as any)?.email as string | undefined
    if (email) await markEmailVerified(email)
  }
  return true
}
```

- [ ] **Step 4: Expose it on the session**

In the `jwt` callback, alongside `tenantStatus` and `subscriptionStatus`, select `users.emailVerified` and set `token.emailVerified = <boolean>`. Surface it in the `session` callback the same way the neighbouring fields are. Middleware needs it, and middleware can only read the token.

Set it in **every** branch that already assigns `tenantStatus`, including the no-membership branch. A branch that forgets it leaves `emailVerified` undefined, which B1 must treat as unverified, which would lock the user out.

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

---

## Group B (depends on Group A)

### Task B1: The middleware rule

**Files:**
- Modify: `src/middleware.ts`
- Test: `src/__tests__/middleware.test.ts`

**This task exclusively owns `src/middleware.ts`.** Three separate concerns land here and splitting them across agents would conflict.

**Current shape:** lines 17 to 28 are one `if` whose arms include `pathname.startsWith('/api/')`, returning `NextResponse.next()` at line 28. That single arm is why middleware does nothing for API routes today.

**The `/api/` arm must be lifted out into its own branch placed before that condition.** Do not insert code above line 23 and leave the arm in place; the blanket allow would still fire. The other arms (`/c/`, `/a/`, `/sign/`, `/verify/`, `/_next/`, favicon, image extensions) keep their unconditional pass.

- [ ] **Step 1: Write the failing tests**

Cover, at minimum:
- authenticated + `subscriptionStatus: 'expired'` + `POST /api/patients` → 402
- same + `GET /api/patients` → passes
- same + `POST /api/billing/checkout` → passes
- authenticated + `'active'` + `POST /api/patients` → passes
- authenticated + `'trialing'` + `POST /api/patients` → passes
- **unauthenticated** + `POST /api/webhooks/whatsapp` → passes untouched
- authenticated + `emailVerified: false` + `GET /dashboard` → redirects to `/confirm-email`
- authenticated + `emailVerified: false` + `GET /confirm-email` → passes
- no reference to `/pending-approval` survives anywhere in the file

- [ ] **Step 2: Run them, confirm they fail**

- [ ] **Step 3: Implement**

```ts
// Replaces the `/api/` arm of the public-routes condition.
//
// Every mutating route in the app lives under /api (108 of them), and the
// only two 'use server' files are auth and signup, neither of which mutates
// tenant data. So one method-based rule here covers everything, including
// routes not yet written. Per-route guards would mean 108 edits and no
// guarantee for the 109th.
if (pathname.startsWith('/api/')) {
  const session = req.auth as any
  const subscriptionStatus = session?.subscriptionStatus as string | null

  if (
    isAuthenticated &&
    !['trialing', 'active'].includes(subscriptionStatus ?? '') &&
    requiresActiveSubscription(pathname, req.method)
  ) {
    return NextResponse.json(
      { error: 'Sua assinatura expirou. Reative para continuar editando.' },
      { status: 402 },
    )
  }

  // Unauthenticated requests fall through untouched. That is what keeps the
  // WhatsApp webhook writing while a clinic is expired: Meta gets a 200 and
  // never retries, so a dropped patient message is lost for good.
  return NextResponse.next()
}
```

Then, in the authenticated section: delete the `pending_approval` branches (both the auth-page redirect and the later guard), and add in their place:

```ts
if (isAuthenticated && session?.emailVerified === false) {
  if (pathname === '/confirm-email') return NextResponse.next()
  return NextResponse.redirect(new URL('/confirm-email', req.url))
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Run the full suite**

Run: `pnpm --filter @floraclin/web test:run`. The middleware change is the one that can break unrelated routes.

- [ ] **Step 6: Commit**

---

### Task B2: Signup creates active, unconfirmed tenants

**Files:**
- Modify: `src/actions/signup.ts`
- Modify: `src/db/queries/admin-tenants.ts`
- Test: `src/actions/__tests__/signup.test.ts`

**Two tenant-creation sites, both must change:**
- `src/actions/signup.ts:74` — the credentials path
- `src/db/queries/admin-tenants.ts:321`, inside `createSelfSignupTenant` — the OAuth path

- [ ] **Step 1: Write the failing tests**

Assert: the credentials path creates the tenant with `status: 'active'`; it issues a confirmation token and sends the email; it does **not** call `notifyDiscord`; it does **not** create a subscription; and it redirects to `/confirm-email` rather than `/pending-approval`.

- [ ] **Step 2: Run them, confirm they fail**

- [ ] **Step 3: Change both status assignments to `'active'`**

- [ ] **Step 4: Move the deferred work out of signup**

Remove the `notifyDiscord` and `createSubscription` calls from the credentials path. Both move to confirmation (Task B3).

**Why:** firing `clinic.created` at signup would notify on every bot that never confirms, which is exactly the noise the approval gate was absorbing. And a trial that starts at signup spends its first day on an account nobody has opened.

The OAuth path in `createClinicForOAuthUser` keeps both, because Google users are verified on arrival and never see the confirmation step.

- [ ] **Step 5: Issue the token and send the email**

After the transaction commits, call `issueConfirmationToken(email)` and `sendConfirmationEmail(...)` with a link to `/api/auth/confirm?email=<encoded>&token=<raw>`. Then redirect to `/confirm-email`.

- [ ] **Step 6: Run tests, expect PASS**

- [ ] **Step 7: Commit**

---

### Task B3: Confirmation endpoints and screen

**Files:**
- Create: `src/app/api/auth/confirm/route.ts`
- Create: `src/app/api/auth/confirm/resend/route.ts`
- Create: `src/app/confirm-email/page.tsx`
- Test: `src/app/api/auth/confirm/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Assert: a valid token marks the user verified, creates the subscription and fires `clinic.created`; an expired token does not and shows an error; a token cannot be replayed; and resend is refused within the cooldown window.

- [ ] **Step 2: Run them, confirm they fail**

- [ ] **Step 3: Implement `GET /api/auth/confirm`**

Reads `email` and `token` from the query string, calls `consumeConfirmationToken`. On success: `markEmailVerified`, create the free-plan subscription (the trial starts here, not at signup), fire `notifyDiscord({ kind: 'clinic.created', ... })` and `subscription.created`, then redirect to `/dashboard`. On failure, redirect to `/confirm-email?error=invalid`.

- [ ] **Step 4: Implement `POST /api/auth/confirm/resend`**

Re-issues a token and resends. Rate limit to one per 60 seconds per email, returning 429 otherwise. With double opt-in an undelivered email is a dead signup, so this path is load-bearing, but it is also an unauthenticated email trigger and must not become a spam relay.

- [ ] **Step 5: Build `/confirm-email`**

Shows the address the link went to, a resend button wired to the route above, and a **"Entrar com Google"** button. Account linking is already enabled and Google sign-in stamps `emailVerified` (Task A6), so that button retroactively satisfies the gate for a stuck credentials signup. It is the main recovery path and should be as prominent as resend.

Model the layout on the `/pending-approval` page being deleted; it already has the right shape.

- [ ] **Step 6: Run tests, expect PASS**

- [ ] **Step 7: Commit**

---

### Task B4: Billing page closes the payment race

**Files:**
- Modify: `src/components/settings/billing-settings.tsx`
- Test: `src/components/settings/__tests__/billing-settings.test.tsx`

- [ ] **Step 1: Write the failing test**

Assert that when the page mounts with `session_id` in the query string it calls `POST /api/billing/confirm` with that id, and calls `session.update()` afterwards.

- [ ] **Step 2: Run it, confirm it fails**

- [ ] **Step 3: Implement**

On mount, read `session_id` from the search params. If present, `POST /api/billing/confirm`, then call `update()` from `useSession()` so the JWT picks up the new status, then clear the parameter from the URL so a refresh does not re-post.

**Why:** without this the customer pays, returns, and sits in a read-only app being asked to subscribe, because the JWT still says expired and the webhook may not have landed.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

---

## Group C (depends on Group B)

### Task C1: Remove the approval gate's remains

**Files:**
- Delete: `src/app/pending-approval/page.tsx`
- Delete: `src/app/pending-approval/layout.tsx`
- Delete: `src/app/pending-approval/logout-button.tsx`

- [ ] **Step 1: Confirm nothing references it**

Run: `grep -rn "pending-approval\|pending_approval" src`

Expected: only `src/db/queries/admin-tenants.ts` (the admin reject/approve queries, which stay) and `src/components/admin/admin-tenant-list.tsx`. **No hits in `middleware.ts` or `actions/signup.ts`.** If there are, B1 or B2 is incomplete; stop and fix there.

- [ ] **Step 2: Delete the three files**

- [ ] **Step 3: Run the full suite**

- [ ] **Step 4: Commit**

---

## Self-Review

**Spec coverage:** Part 1 → B2, C1. Part 2 → A2, A6, B2, B3. Part 3 → A3, A4, A5, B1. Part 4 → A1, B4. Every spec section maps to at least one task.

**File ownership:** `middleware.ts` only in B1. `signup.ts` only in B2. `stripe.ts` only in A1. `email.ts` only in A2. `auth-config.ts` only in A6. `billing-settings.tsx` only in B4. No file appears in two tasks of the same group.

**Cross-group dependencies:** B1 needs A5 (`requiresActiveSubscription`) and A6 (`token.emailVerified`). B2 needs A2 (`issueConfirmationToken`). B3 needs A2. B4 needs A1. All flow forwards; no cycles.

**Type consistency:** `requiresActiveSubscription(pathname, method)` is used identically in A5's tests and B1's implementation. `markEmailVerified(email)` is defined in A2 and consumed in A6 and B3. `consumeConfirmationToken(email, raw)` is defined in A2 and consumed in B3.

**Known risk carried deliberately:** the allowlist in A5 is a hand-maintained prefix list, and when it rots it fails open. The coverage scanner is the mitigation, and it is the single most important test in this plan.
