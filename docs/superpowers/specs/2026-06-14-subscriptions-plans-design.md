# Subscriptions & Plans

## Goal

Add a subscription and plan system so FloraClin can gate features (WhatsApp shared number, user limits, patient limits) behind paid tiers, with a 14-day free trial for new tenants and Stripe Checkout for payment.

## Context

FloraClin is moving from a free-for-all model to a tiered subscription model. The immediate driver is the WhatsApp shared-number feature (Spec 2), which needs a way to track monthly conversation credits and gate the "own number" option behind a paid plan. But the subscription system is foundational — it will gate other features over time.

Currently there is no billing, subscription, or plan infrastructure in the codebase. Every tenant has full access to all features.

## Architecture

### Approach: Full custom tables + Stripe Checkout

- **Custom tables** define plans, track subscription state, and enforce limits at runtime.
- **Stripe Checkout** handles payment collection — no custom payment UI beyond a "Subscribe" button.
- **Stripe Webhooks** sync payment events (renewal, failure, cancellation) back to the local subscription record.
- **No custom invoicing** — Stripe handles invoices, receipts, and payment retries.

---

## Data Model

### `plans` table

Defines what each tier includes. Seeded via migration, editable by platform admins.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | varchar(50) unique | `free`, `starter`, `pro` |
| `name` | varchar(100) | Display name: "Gratuito", "Starter", "Pro" |
| `priceCents` | integer | Monthly price in BRL cents. 0 for free. |
| `billingInterval` | varchar(20) | `month` (only monthly for now) |
| `trialDays` | integer nullable | 14 for free plan, null for paid plans |
| `stripePriceId` | varchar(255) nullable | Stripe Price ID. Null for free plan. |
| `limits` | jsonb | `{ "whatsapp_conversations": 50, "users": 2, "patients": 100 }` |
| `features` | jsonb | `{ "own_whatsapp_number": false, "custom_domain": false }` |
| `displayOrder` | integer | For UI sorting |
| `active` | boolean | Soft-disable plans without deleting |
| `createdAt` | timestamptz | |
| `updatedAt` | timestamptz | |

### `tenant_subscriptions` table

One active row per tenant. Created automatically when a tenant is created (with the `free` plan).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid FK → tenants, unique | One subscription per tenant |
| `planId` | uuid FK → plans | Current plan |
| `status` | varchar(20) | `trialing`, `active`, `past_due`, `canceled`, `expired` |
| `stripeCustomerId` | varchar(255) nullable | Created on first checkout |
| `stripeSubscriptionId` | varchar(255) nullable | Null for free/trial |
| `currentPeriodStart` | timestamptz | Start of current billing period |
| `currentPeriodEnd` | timestamptz | End of current billing period / trial expiry |
| `canceledAt` | timestamptz nullable | When the user canceled |
| `createdAt` | timestamptz | |
| `updatedAt` | timestamptz | |

### Initial plan tiers (seed data)

| | Free | Starter (R$99/mo) | Pro (R$199/mo) |
|---|---|---|---|
| `slug` | `free` | `starter` | `pro` |
| `trialDays` | 14 | null | null |
| `whatsapp_conversations` | 50 | 300 | 1000 |
| `own_whatsapp_number` | false | true | true |
| `users` | 2 | 5 | -1 (unlimited) |
| `patients` | 100 | -1 (unlimited) | -1 (unlimited) |

Convention: `-1` in limits means unlimited. Features are boolean.

---

## Subscription Lifecycle

### Status transitions

```
trialing  → expired    (auto: currentPeriodEnd passes, no paid plan)
trialing  → active     (Stripe Checkout completed)
active    → past_due   (Stripe invoice.payment_failed)
active    → canceled   (user cancels or Stripe subscription deleted)
past_due  → active     (Stripe invoice.paid after retry)
past_due  → canceled   (all retries exhausted)
expired   → active     (user subscribes after trial expired)
canceled  → active     (user re-subscribes)
```

### Trial mechanics

- New tenants get a `tenant_subscriptions` row with `planId` → `free`, `status: 'trialing'`, `currentPeriodEnd` = now + 14 days.
- A daily cron job (or middleware check) flips `trialing` → `expired` when `currentPeriodEnd` has passed.
- Expired tenants: gated features (WhatsApp, etc.) are blocked. Core app (agenda, patients, financeiro, photos) remains fully accessible.

### Expiry check strategy

The middleware already reads tenant info from the JWT. Add `subscriptionStatus` and `planSlug` to the JWT token (populated in the `jwt` callback alongside `tenantId`, `role`, etc.). This avoids a DB query on every request.

For feature-gating at the API level, a helper function checks the subscription:

```ts
async function checkPlanLimit(tenantId: string, limitKey: string): Promise<{
  allowed: boolean
  used: number
  limit: number
}>
```

And for boolean feature gates:

```ts
async function checkPlanFeature(tenantId: string, featureKey: string): Promise<boolean>
```

These read from `tenant_subscriptions` JOIN `plans` and count usage from the relevant table (e.g. `whatsapp_conversations` opened this period, `tenant_users` count, `patients` count).

---

## Stripe Integration

### Checkout flow

1. Tenant clicks "Assinar" on a plan card in the settings/billing page.
2. Server action creates a Stripe Checkout Session:
   - `mode: 'subscription'`
   - `line_items: [{ price: plan.stripePriceId, quantity: 1 }]`
   - `customer`: reuse existing `stripeCustomerId` or let Stripe create one
   - `metadata: { tenantId, planSlug }`
   - `success_url`: `/settings/billing?session_id={CHECKOUT_SESSION_ID}`
   - `cancel_url`: `/settings/billing`
3. Stripe handles the payment page (card input, 3DS, etc.).
4. On success, Stripe fires `checkout.session.completed` webhook.

### Webhook events to handle

| Event | Action |
|---|---|
| `checkout.session.completed` | Create/update `tenant_subscriptions` with plan, status `active`, Stripe IDs, period dates. If tenant had no `stripeCustomerId`, save it. |
| `invoice.paid` | Update `currentPeriodStart`/`currentPeriodEnd` for the new billing cycle. Confirm `status: 'active'`. |
| `invoice.payment_failed` | Set `status: 'past_due'`. |
| `customer.subscription.updated` | Handle plan changes (upgrade/downgrade). Update `planId` and limits. |
| `customer.subscription.deleted` | Set `status: 'canceled'`, record `canceledAt`. |

### Webhook endpoint

`POST /api/webhooks/stripe` — verifies signature with `STRIPE_WEBHOOK_SECRET`, dispatches by event type.

### Environment variables

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side Stripe API calls |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-side (if needed for Stripe.js, but Checkout redirect doesn't need it) |

---

## UI

### Billing page (`/settings/billing`)

New settings tab or section. Shows:

1. **Current plan card** — plan name, status badge (`Teste gratuito · 8 dias restantes`, `Ativo`, `Pagamento pendente`, `Expirado`), current period dates.
2. **Usage summary** — bar charts or simple counters: "WhatsApp: 32/50 conversas", "Usuários: 2/2", "Pacientes: 45/100".
3. **Plan cards** — side-by-side comparison of available plans with "Atual" badge on the active one, "Assinar" button on others. Disabled if already on that plan.
4. **Cancel subscription** — link at the bottom for paid plans. Confirms with a dialog. Calls Stripe to cancel at period end.

### Trial banner (app-wide)

When `status === 'trialing'`:
- Subtle banner: "Teste gratuito · X dias restantes. [Ver planos]"
- Shows on all pages, dismissible per session.

When `status === 'expired'`:
- Prominent banner (not dismissible): "Seu período de teste expirou. [Assinar agora] para continuar usando WhatsApp e outros recursos."

When `status === 'past_due'`:
- Warning banner: "Pagamento pendente. Atualize seu método de pagamento para evitar interrupção do serviço."

### Feature gating in UI

Components that depend on gated features check the plan from the session:
- WhatsApp settings: if `own_whatsapp_number` feature is false, Option B is disabled with "Disponível no plano Starter".
- User invite: if at user limit, show "Limite de usuários atingido. [Fazer upgrade]".
- Patient creation: if at patient limit, same pattern.

---

## Admin Panel

Platform admins (`isPlatformAdmin`) get a full subscription management interface at `/admin/subscriptions`.

### Subscription list view

A searchable, filterable table showing all tenants and their subscription state:

| Column | Content |
|---|---|
| Clínica | Tenant name (link to tenant detail) |
| Plano | Plan name + badge (free/starter/pro) |
| Status | Status badge with color: trialing (blue), active (green), past_due (amber), expired (red), canceled (gray) |
| Período | `currentPeriodStart` → `currentPeriodEnd` formatted |
| Dias restantes | Countdown for trialing, days until renewal for active |
| Stripe | Link to Stripe dashboard if `stripeSubscriptionId` exists, "Manual" badge if not |

**Filters:** by status (trialing, active, past_due, expired, canceled), by plan, search by tenant name.

### Tenant subscription detail (click row or action menu)

Opens a detail panel/dialog with:

1. **Current subscription info** — plan, status, period, Stripe IDs, created date.
2. **Usage summary** — current usage vs limits (WhatsApp conversations, users, patients).
3. **Action buttons:**

| Action | What it does |
|---|---|
| **Alterar plano** | Dropdown to select a different plan. Updates `planId` and `status: 'active'` immediately. No Stripe involved (manual override). Useful for partnerships, beta testers. |
| **Presentear plano** | Gift a paid plan for N months. Sets plan, `status: 'active'`, `currentPeriodEnd` = now + N months, `stripeSubscriptionId: null`. A "gifted" flag or `source: 'gift'` column distinguishes from paid subscriptions. |
| **Estender teste** | Extends trial by N days. Only available when `status === 'trialing'`. Pushes `currentPeriodEnd` forward. |
| **Cancelar assinatura** | Force-cancel. Sets `status: 'canceled'`, `canceledAt: now`. If Stripe subscription exists, cancels it via API too. |
| **Reativar** | For canceled/expired tenants. Sets status back to `trialing` or `active` with a new period. |

4. **Audit log** — chronological list of subscription changes (plan changes, status transitions, admin overrides) with who did it and when. Uses the existing `audit_logs` table with `action` values like `subscription_created`, `plan_changed`, `trial_extended`, `subscription_gifted`, `subscription_canceled`, `subscription_reactivated`.

### Additional schema for admin features

**`tenant_subscriptions` additions:**

| Column | Type | Notes |
|---|---|---|
| `source` | varchar(20) | `stripe`, `admin`, `gift`, `trial` — how the subscription was created/modified |
| `giftedBy` | uuid nullable FK → users | Admin who gifted the plan |
| `giftedMonths` | integer nullable | How many months were gifted |
| `notes` | text nullable | Admin notes (e.g. "Partnership with Dr. X") |

These fields enable the admin panel to show context about why a subscription is in its current state.

---

## Migration & Existing Tenants

- Migration creates `plans` and `tenant_subscriptions` tables.
- Seed script inserts the three plan rows (`free`, `starter`, `pro`).
- A data migration creates a `tenant_subscriptions` row for every existing tenant:
  - `planId` → `free`
  - `status` → `trialing`
  - `currentPeriodStart` → now
  - `currentPeriodEnd` → now + 14 days
- Existing tenants with WhatsApp already configured (own credentials) should get a grace period or be auto-assigned to `starter` — platform admin decision at migration time.

---

## Scope Boundaries

### In scope
- `plans` and `tenant_subscriptions` tables + queries
- Stripe Checkout integration (create session, handle webhooks)
- Runtime limit/feature check helpers
- Billing settings page with plan cards and usage
- Trial banner and expiry banner
- Admin panel: subscription list, detail view, plan override, gift plans, extend trial, cancel, reactivate, audit log
- JWT enrichment with subscription status

### Out of scope (future)
- Annual billing intervals
- Coupon/discount codes
- Usage-based billing (pay per conversation overage)
- Custom payment methods (Pix, boleto) — Stripe Checkout supports these natively if enabled in the Stripe dashboard
- Plan migration wizard (bulk upgrade existing tenants)
- Invoice history page (Stripe's hosted portal handles this)

---

## Relationship to Spec 2 (WhatsApp Shared Config)

This spec provides the infrastructure that Spec 2 depends on:
- `checkPlanLimit(tenantId, 'whatsapp_conversations')` — called before sending messages on the shared number
- `checkPlanFeature(tenantId, 'own_whatsapp_number')` — gates Option B in WhatsApp settings
- `subscriptionStatus` in session — used to show/hide WhatsApp UI elements

Spec 2 will be designed and implemented after this spec ships.
