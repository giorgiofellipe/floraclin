# Opening subscriptions to the public: design

**Status:** approved, ready for planning

## Problem

FloraClin cannot be advertised today. A stranger who follows a CTA from the
marketing site reaches a working signup form, fills it in, and lands on a
screen telling them to wait. Nothing tells them how long, because nothing
tells them anything: signup sends no email at all. The only signal is a
Discord message in an internal channel, and the only way through is a human
clicking approve in `/admin/clinicas`.

If they get through that, they still cannot pay. The Stripe integration is
complete in code but was unconfigured in production until this week.

Underneath both is a third problem that neither reveals: nothing enforces the
subscription. `checkPlanLimit` has zero callers, middleware reads
`subscriptionStatus` and never uses it, and only three files call
`isSubscriptionActive`. A clinic that never pays keeps the entire product
forever, capped only at 20 WhatsApp conversations a month.

So "open subscriptions to the public" is three pieces of work, and shipping
the first without the third would advertise a free product with a WhatsApp
upsell.

## Decisions

| Decision | Choice | Consequence |
|---|---|---|
| Approval gate | Removed, replaced by email confirmation | Self-serve. The wait becomes seconds, not days. |
| Email verification | Double opt-in, before access | Strongest spam filter. An undelivered email is a dead signup, so resend and the Google fallback are load-bearing, not nice-to-have. |
| Google sign-in | Skips confirmation entirely | Google already asserts the address, and the `signIn` callback already refuses unverified ones. |
| Trial expiry | Read-only, with a persistent banner | Clinics keep access to their own records. Nobody loses patient data over a lapsed card. |
| Read-only enforcement | Middleware, method-based | One choke point covers all 108 mutating routes and every future one. |
| Public booking when expired | Blocked | Chosen deliberately: it makes expiry visible to the clinic. Degrades to a message, never an error. |
| Inbound WhatsApp when expired | Always allowed | Meta gets a 200 and never retries, so a dropped message is lost permanently. Not recoverable, so not blockable. |

## What already exists and gets reused

- `verification_tokens` and the token pattern in
  `api/profile/reset-request`: 32 random bytes, sha256 at rest, raw token in
  the email, delete-then-insert per identifier.
- `users.emailVerified`, a column nothing currently writes or reads.
- `sendApprovalEmail` and the Resend setup in `lib/email.ts`.
- `allowDangerousEmailAccountLinking: true`, already justified by a `signIn`
  callback that rejects Google profiles without `email_verified`.
- The whole Stripe path: checkout, cancel, and a webhook handler that already
  guards every branch on `metadata.tenantId` or `findSubscriptionByStripeId`.

## Part 1: Removing the approval gate

`actions/signup.ts:74` creates tenants with `status: 'pending_approval'`. It
becomes `active`. The `/pending-approval` page and its middleware branch are
deleted.

The admin approve and reject routes stay. They stop being on the happy path
but remain the tool for removing a tenant that should not exist.

`clinic.created` moves from signup to confirmation. Firing it at signup would
notify on every bot that never confirms, which is precisely the noise the
approval gate was absorbing.

## Part 2: Email confirmation

The gate does not disappear; it swaps. `/pending-approval` becomes
`/confirm-email`, and the wait changes from "until Giorgio sees Discord" to
"until you open your inbox".

**Token.** Same construction as password reset, with two differences: a 24
hour expiry rather than one hour, because this is first contact and may be
read the next morning; and an identifier namespaced as `confirm:<email>`.
The namespace is not cosmetic. `reset-request` deletes every token for an
identifier before inserting, so an unnamespaced confirmation token would be
silently destroyed by a password reset, stranding the account with no
indication why.

**Gate.** Middleware gains a branch mirroring the one being deleted: an
authenticated user whose `emailVerified` is null goes to `/confirm-email`.

**Trial start.** The trial starts at confirmation, not signup. While access
began at signup the two were the same moment; now a signup left unconfirmed
overnight would spend a day of trial on an account nobody has opened.

**Recovery.** Double opt-in's failure mode is an email that never arrives,
and the user cannot tell whether it was slow, filtered, or mistyped. Two
escapes, both on `/confirm-email`:

- Resend, rate-limited.
- "Entrar com Google". Account linking is already enabled and already gated
  on Google's own verification, so signing in with Google for the same
  address links the accounts, stamps `emailVerified`, and retroactively
  satisfies the gate. The stuck signup unsticks itself without support.

**Google.** The `signIn` callback already refuses a Google profile whose
`email_verified` is false. It just never persists that. Stamping
`users.emailVerified` there marks new Google users verified and powers the
recovery path above.

Unconfirmed signups still create tenant, membership and subscription rows.
Pruning them is a real concern and deliberately out of scope: build the
reaper once the junk volume is known, not before.

## Part 3: Read-only after expiry

**Where.** `middleware.ts:23` lists `/api/` as one arm of the shared "public
routes" condition that returns `NextResponse.next()` at line 28. That is why
the webhooks work, and why middleware does nothing for API routes today.

The `/api/` arm has to be lifted out of that condition into its own branch,
placed before it, rather than having code inserted above line 23. The other
arms (`/c/`, `/a/`, `/sign/`, `/verify/`, static assets) keep their existing
unconditional pass. The new branch reads:

> authenticated, and `subscriptionStatus` is not `trialing` or `active`, and
> the method is not GET, and the path is not allowlisted → 402.

Allowlist: `/api/billing/*`, so they can pay their way out, and `/api/auth/*`.

Unauthenticated requests fall through untouched, which is what preserves
inbound WhatsApp: the webhook has no session, so the rule never sees it.

**Why middleware rather than per-route.** All 108 mutating routes live under
`/api`; the only two `'use server'` files are auth and signup, neither of
which mutates tenant data. Per-route guards would mean 108 edits, no
guarantee for route 109, and `getAuthContext` cannot see the HTTP method
anyway. One rule covers everything, including code not yet written.

**Drift.** A scanner test, in the shape of `no-date-in-raw-sql`, enumerates
every mutating route under `src/app/api` and asserts each is either covered
by the rule or explicitly allowlisted. Without it the allowlist rots
silently, and a rotted allowlist fails open.

**Booking.** `/api/book/[slug]` is unauthenticated, so middleware cannot
identify the tenant. It checks the subscription itself, by slug. The public
page renders "esta clínica não está aceitando agendamentos online no
momento" rather than surfacing an error to a patient who has done nothing
wrong.

**Confirmation cron.** Already gated by `isSubscriptionActive`. No change.

**Banner.** Rendered in the platform layout whenever the status is not
`trialing` or `active`, linking to billing. Always visible, not dismissible:
the point is that read-only should never be mysterious.

## Part 4: The payment race

This is the part most likely to produce a bad first impression, because it
fails at the exact moment someone has just paid.

`subscriptionStatus` lives in the JWT and is refreshed only on sign-in or an
explicit `session.update()`. Separately, Stripe redirects the customer back
to `success_url` without waiting for the webhook. Left alone, a clinic pays,
returns, and is still in read-only with a banner asking them to subscribe.

`success_url` already carries `session_id`. A new `POST /api/billing/confirm`
retrieves that Checkout Session from Stripe directly and, if
`payment_status` is `paid`, activates the subscription immediately. It is
idempotent with the webhook, so whichever arrives first wins and the other
is a no-op. The billing page then calls `session.update()` to refresh the
JWT.

The webhook remains the source of truth for everything after the first
payment: renewals, failures, cancellations. This route exists only to close
the redirect race.

## Out of scope

**Plan limits.** `checkPlanLimit` has no callers, the `users` limit is not
checked on invite, and `own_whatsapp_number` is enforced only by a `disabled`
prop in the UI while `PATCH /api/tenant` accepts `whatsapp_mode` from anyone.
These are real holes, but they decide *which* paid plan you are on, not
*whether* you have paid. Fixing them alongside launch would tangle two
changes with different risk profiles.

**Orphaned `auth.users`.** Supabase Auth holds 42 rows from an earlier
iteration, disconnected from the 13 in `floraclin.users` that actually log
in. Harmless, but anyone reading Supabase's Authentication tab would draw the
wrong conclusion about where auth lives. Worth cleaning up separately.

**Pruning unconfirmed signups.** See Part 2.

## Testing

- Middleware: a GET passes while expired; a POST is refused; `/api/billing/*`
  is allowed while expired; an unauthenticated POST to the WhatsApp webhook
  is untouched.
- The scanner: every mutating route is covered or allowlisted, and the test
  fails when a new unlisted mutating route is added.
- Confirmation: a valid token verifies and starts the trial; an expired one
  does not; a password reset for the same address does not destroy a pending
  confirmation token; Google sign-in stamps `emailVerified` and satisfies the
  gate for an existing unconfirmed credentials account.
- Billing confirm: an unpaid session does not activate; a paid one does; and
  running it twice, or alongside the webhook, produces one active
  subscription rather than two.
- Booking: an expired tenant's slug renders the closed message rather than
  creating an appointment.

The middleware tests matter most. Everything else fails loudly; a hole in the
middleware rule fails open and silently.

## Build order

1. Part 3, read-only enforcement. It is the piece that makes the others safe
   to ship, and it can land while the gate is still up.
2. Part 4, the payment race. Small, and independently verifiable against a
   real Stripe checkout.
3. Parts 1 and 2 together. Removing the gate and adding confirmation are one
   change: the second is what makes the first safe.
