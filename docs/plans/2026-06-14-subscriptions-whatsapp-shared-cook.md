# Subscriptions & Plans + WhatsApp Shared Config — Cook Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subscription/plan system with Stripe Checkout and a WhatsApp shared-number mode with monthly conversation credits.

**Architecture:** Two new tables (`plans`, `tenant_subscriptions`) for billing, one new table (`whatsapp_credits`) for credit tracking. Stripe Checkout handles payment. `getCredentials()` refactored for dual-mode (shared FloraClin number vs own number). JWT enriched with subscription status. Admin panel for subscription management.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (floraclin schema), Stripe SDK, React Hook Form, Zod.

---

## Group A (parallel) — Schema & Foundation Libraries

### Task 1: Schema tables + migration SQL

**Files:**
- Modify: `web/src/db/schema.ts`
- Create: `web/src/db/migrations/0022_subscriptions_plans.sql`

- [ ] **Step 1: Add plans table to schema.ts**

Add after the existing tables (before indexes section if applicable):

```ts
export const plans = floraclinSchema.table('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  priceCents: integer('price_cents').notNull().default(0),
  billingInterval: varchar('billing_interval', { length: 20 }).notNull().default('month'),
  trialDays: integer('trial_days'),
  stripePriceId: varchar('stripe_price_id', { length: 255 }),
  limits: jsonb('limits').notNull().default({}),
  features: jsonb('features').notNull().default({}),
  displayOrder: integer('display_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 2: Add tenant_subscriptions table to schema.ts**

```ts
export const tenantSubscriptions = floraclinSchema.table('tenant_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  status: varchar('status', { length: 20 }).notNull().default('trialing'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull().defaultNow(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  source: varchar('source', { length: 20 }).notNull().default('trial'),
  giftedBy: uuid('gifted_by').references(() => users.id),
  giftedMonths: integer('gifted_months'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 3: Add whatsapp_credits table to schema.ts**

```ts
export const whatsappCredits = floraclinSchema.table('whatsapp_credits', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  creditsTotal: integer('credits_total').notNull(),
  creditsUsed: integer('credits_used').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_whatsapp_credits_tenant_period').on(table.tenantId, table.periodStart),
])
```

- [ ] **Step 4: Add systemTemplate column to whatsappTemplates**

Add to the existing `whatsappTemplates` table definition:

```ts
systemTemplate: boolean('system_template').notNull().default(false),
```

- [ ] **Step 5: Write migration SQL**

Create `web/src/db/migrations/0022_subscriptions_plans.sql`:

```sql
-- Plans
CREATE TABLE IF NOT EXISTS "floraclin"."plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" varchar(50) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "price_cents" integer NOT NULL DEFAULT 0,
  "billing_interval" varchar(20) NOT NULL DEFAULT 'month',
  "trial_days" integer,
  "stripe_price_id" varchar(255),
  "limits" jsonb NOT NULL DEFAULT '{}',
  "features" jsonb NOT NULL DEFAULT '{}',
  "display_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seed plans
INSERT INTO "floraclin"."plans" ("slug", "name", "price_cents", "trial_days", "limits", "features", "display_order") VALUES
  ('free', 'Gratuito', 0, 14, '{"whatsapp_conversations": 50, "users": 2, "patients": 100}', '{"own_whatsapp_number": false}', 0),
  ('starter', 'Starter', 9900, NULL, '{"whatsapp_conversations": 300, "users": 5, "patients": -1}', '{"own_whatsapp_number": true}', 1),
  ('pro', 'Pro', 19900, NULL, '{"whatsapp_conversations": 1000, "users": -1, "patients": -1}', '{"own_whatsapp_number": true}', 2)
ON CONFLICT ("slug") DO NOTHING;

-- Tenant subscriptions
CREATE TABLE IF NOT EXISTS "floraclin"."tenant_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id") UNIQUE,
  "plan_id" uuid NOT NULL REFERENCES "floraclin"."plans"("id"),
  "status" varchar(20) NOT NULL DEFAULT 'trialing',
  "stripe_customer_id" varchar(255),
  "stripe_subscription_id" varchar(255),
  "current_period_start" timestamptz NOT NULL DEFAULT now(),
  "current_period_end" timestamptz NOT NULL,
  "canceled_at" timestamptz,
  "source" varchar(20) NOT NULL DEFAULT 'trial',
  "gifted_by" uuid REFERENCES "floraclin"."users"("id"),
  "gifted_months" integer,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seed subscriptions for existing tenants (14-day trial)
INSERT INTO "floraclin"."tenant_subscriptions" ("tenant_id", "plan_id", "status", "current_period_start", "current_period_end", "source")
SELECT t."id", p."id", 'trialing', now(), now() + interval '14 days', 'trial'
FROM "floraclin"."tenants" t
CROSS JOIN "floraclin"."plans" p
WHERE p."slug" = 'free'
  AND t."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "floraclin"."tenant_subscriptions" ts WHERE ts."tenant_id" = t."id"
  );

-- WhatsApp credits
CREATE TABLE IF NOT EXISTS "floraclin"."whatsapp_credits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "floraclin"."tenants"("id"),
  "period_start" timestamptz NOT NULL,
  "period_end" timestamptz NOT NULL,
  "credits_total" integer NOT NULL,
  "credits_used" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "period_start")
);

-- System template flag
ALTER TABLE "floraclin"."whatsapp_templates"
  ADD COLUMN IF NOT EXISTS "system_template" boolean NOT NULL DEFAULT false;
```

- [ ] **Step 6: Commit**

```bash
git add web/src/db/schema.ts web/src/db/migrations/0022_subscriptions_plans.sql
git commit -m "feat(schema): add plans, tenant_subscriptions, whatsapp_credits tables"
```

---

### Task 2: Subscription queries + plan check helpers

**Files:**
- Create: `web/src/db/queries/subscriptions.ts`
- Create: `web/src/lib/plans.ts`
- Create: `web/src/db/queries/__tests__/subscriptions.test.ts`

- [ ] **Step 1: Create subscription queries**

`web/src/db/queries/subscriptions.ts` — CRUD for tenant_subscriptions:
- `getSubscription(tenantId)` — returns subscription with joined plan data
- `getSubscriptionWithPlan(tenantId)` — full join with plan details
- `createSubscription(tenantId, planId, opts)` — creates with trial period
- `updateSubscriptionStatus(tenantId, status)` — status transitions
- `updateSubscriptionPlan(tenantId, planId, source, opts)` — plan changes
- `giftSubscription(tenantId, planId, months, giftedBy, notes)` — admin gift
- `extendTrial(tenantId, days)` — push currentPeriodEnd forward
- `listAllSubscriptions(filters)` — admin list with tenant name join
- `getExpiredTrials()` — for cron: trialing + currentPeriodEnd < now()
- `listPlans(activeOnly)` — returns all plans ordered by displayOrder

- [ ] **Step 2: Create plan check helpers**

`web/src/lib/plans.ts`:
- `checkPlanLimit(tenantId, limitKey)` — returns `{ allowed, used, limit }`
- `checkPlanFeature(tenantId, featureKey)` — returns boolean
- `isSubscriptionActive(tenantId)` — returns true if status in ('trialing', 'active')
- Count functions for each limit key (users, patients, whatsapp_conversations)

- [ ] **Step 3: Write tests**

Test `getSubscription`, `createSubscription`, `checkPlanLimit`, `checkPlanFeature` with mocked DB.

- [ ] **Step 4: Commit**

---

### Task 3: Stripe library

**Files:**
- Create: `web/src/lib/stripe.ts`
- Create: `web/src/lib/__tests__/stripe.test.ts`

- [ ] **Step 1: Create Stripe helper library**

`web/src/lib/stripe.ts`:
- `getStripeClient()` — lazy singleton Stripe instance
- `createCheckoutSession(tenantId, planSlug, successUrl, cancelUrl)` — creates Stripe Checkout Session
- `cancelStripeSubscription(stripeSubscriptionId)` — cancels at period end
- `constructWebhookEvent(body, signature)` — verifies Stripe webhook signature
- Type definitions for the webhook event payloads we handle

- [ ] **Step 2: Write tests**

Test `createCheckoutSession` and `constructWebhookEvent` with mocked Stripe.

- [ ] **Step 3: Commit**

---

### Task 4: WhatsApp credit queries

**Files:**
- Create: `web/src/db/queries/whatsapp-credits.ts`
- Create: `web/src/db/queries/__tests__/whatsapp-credits.test.ts`

- [ ] **Step 1: Create credit queries**

`web/src/db/queries/whatsapp-credits.ts`:
- `getOrCreateCurrentPeriod(tenantId)` — lazy create for current month, reads creditsTotal from plan
- `consumeCredit(tenantId, recipientPhone)` — checks open conversation, increments if new
- `getCreditUsage(tenantId)` — returns current period's used/total for UI
- `findOpenConversation(tenantId, phone)` — checks outbound message within 24h

- [ ] **Step 2: Write tests**

Test credit consumption, open conversation detection, period creation.

- [ ] **Step 3: Commit**

---

## Group B (depends on A) — API Routes

### Task 5: Stripe webhook endpoint

**Files:**
- Create: `web/src/app/api/webhooks/stripe/route.ts`
- Create: `web/src/app/api/webhooks/stripe/__tests__/route.test.ts`

- [ ] **Step 1: Create webhook handler**

Handle events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.

Each event maps to a subscription query call. Verify signature, parse event, dispatch.

- [ ] **Step 2: Write tests**

- [ ] **Step 3: Commit**

---

### Task 6: Billing API routes

**Files:**
- Create: `web/src/app/api/billing/checkout/route.ts`
- Create: `web/src/app/api/billing/cancel/route.ts`
- Create: `web/src/app/api/billing/usage/route.ts`
- Create: `web/src/app/api/billing/plans/route.ts`

- [ ] **Step 1: Create checkout route**

POST `/api/billing/checkout` — accepts `{ planSlug }`, creates Stripe Checkout Session, returns `{ url }`.

- [ ] **Step 2: Create cancel route**

POST `/api/billing/cancel` — cancels the current Stripe subscription at period end.

- [ ] **Step 3: Create usage route**

GET `/api/billing/usage` — returns current plan limits vs usage (users, patients, whatsapp conversations).

- [ ] **Step 4: Create plans route**

GET `/api/billing/plans` — returns all active plans for the pricing cards.

- [ ] **Step 5: Commit**

---

### Task 7: Admin subscription API routes

**Files:**
- Create: `web/src/app/api/admin/subscriptions/route.ts`
- Create: `web/src/app/api/admin/subscriptions/[tenantId]/route.ts`
- Create: `web/src/app/api/admin/subscriptions/[tenantId]/gift/route.ts`
- Create: `web/src/app/api/admin/subscriptions/[tenantId]/extend-trial/route.ts`

- [ ] **Step 1: Create list endpoint**

GET `/api/admin/subscriptions` — returns all subscriptions with tenant info, filterable by status/plan.

- [ ] **Step 2: Create detail/update endpoint**

GET/PATCH `/api/admin/subscriptions/[tenantId]` — get detail, update plan/status.

- [ ] **Step 3: Create gift endpoint**

POST `/api/admin/subscriptions/[tenantId]/gift` — `{ planSlug, months, notes }`.

- [ ] **Step 4: Create extend-trial endpoint**

POST `/api/admin/subscriptions/[tenantId]/extend-trial` — `{ days }`.

- [ ] **Step 5: Commit**

---

### Task 8: Refactor getCredentials for dual-mode + cron credit check

**Files:**
- Modify: `web/src/lib/whatsapp.ts`
- Modify: `web/src/app/api/cron/whatsapp-automations/route.ts`
- Modify: `web/src/app/api/webhooks/whatsapp/route.ts`

- [ ] **Step 1: Refactor getCredentials**

Update to check `whatsapp_mode` setting. If `'floraclin'`, return env var credentials. If `'own'`, existing behavior. Add credit consumption for floraclin mode.

- [ ] **Step 2: Update cron to check credits**

Before sending each confirmation, call `consumeCredit`. If `allowed: false`, skip with log.

- [ ] **Step 3: Update webhook routing for shared number**

When `phone_number_id` matches `FLORACLIN_WA_PHONE_NUMBER_ID`, route inbound by conversation lookup instead of tenant settings lookup.

- [ ] **Step 4: Update template resolution**

Modify `getTemplateByPurpose` to return system templates when mode is `'floraclin'`.

- [ ] **Step 5: Commit**

---

## Group C (depends on B) — UI Components

### Task 9: Billing settings page

**Files:**
- Create: `web/src/components/settings/billing-settings.tsx`
- Modify: `web/src/app/(platform)/configuracoes/settings-page-client.tsx` (add billing tab)

- [ ] **Step 1: Create billing settings component**

Shows: current plan card with status badge, usage summary bars (WhatsApp conversations, users, patients), plan comparison cards with "Assinar"/"Atual" buttons, cancel subscription link.

- [ ] **Step 2: Add billing tab to settings page**

Add a "Plano" or "Assinatura" tab to the existing settings page client.

- [ ] **Step 3: Commit**

---

### Task 10: Subscription banners

**Files:**
- Create: `web/src/components/layout/subscription-banner.tsx`
- Modify: `web/src/app/(platform)/layout.tsx` (render banner)

- [ ] **Step 1: Create banner component**

Three variants based on subscription status:
- `trialing`: subtle, dismissible, shows days remaining
- `expired`: prominent, not dismissible, CTA to subscribe
- `past_due`: warning, payment method update prompt

- [ ] **Step 2: Add to platform layout**

Render `<SubscriptionBanner />` at the top of the platform layout, reading status from session.

- [ ] **Step 3: Commit**

---

### Task 11: WhatsApp settings redesign

**Files:**
- Modify: `web/src/components/settings/whatsapp-settings-form.tsx`
- Create: `web/src/components/settings/whatsapp-credit-bar.tsx`

- [ ] **Step 1: Create credit usage bar component**

Progress bar with color coding (green/amber/red), credits text, renewal date. Exhausted state with upgrade CTA.

- [ ] **Step 2: Redesign settings form with mode selector**

Add radio card selector for Option A (FloraClin) vs Option B (Próprio número). Conditionally show credential form (Option B only) or credit bar (Option A only). Disable Option B if plan doesn't include `own_whatsapp_number` feature.

- [ ] **Step 3: Commit**

---

### Task 12: Admin subscriptions page

**Files:**
- Create: `web/src/app/(platform)/admin/assinaturas/page.tsx`
- Create: `web/src/components/admin/subscription-list.tsx`
- Create: `web/src/components/admin/subscription-detail-dialog.tsx`

- [ ] **Step 1: Create subscription list component**

Searchable, filterable table with status badges, plan badges, period dates, Stripe links.

- [ ] **Step 2: Create detail dialog**

Shows subscription info, usage summary, action buttons (change plan, gift, extend trial, cancel, reactivate), audit log entries.

- [ ] **Step 3: Create page**

Server component that renders the admin layout + subscription list.

- [ ] **Step 4: Add to admin sidebar**

Add "Assinaturas" link to the admin layout sidebar navigation.

- [ ] **Step 5: Commit**

---

## Group D (depends on C) — Integration & Wiring

### Task 13: JWT enrichment + middleware gating

**Files:**
- Modify: `web/src/lib/auth-config.ts`
- Modify: `web/src/middleware.ts`

- [ ] **Step 1: Enrich JWT with subscription data**

In the `jwt` callback (when `user || trigger === 'update'`), query `tenant_subscriptions` + `plans` and add to token:
- `subscriptionStatus` (trialing, active, past_due, expired, canceled)
- `planSlug` (free, starter, pro)
- `planFeatures` (the features jsonb)

- [ ] **Step 2: Pass to session**

In the `session` callback, copy `subscriptionStatus`, `planSlug`, `planFeatures` to the session object.

- [ ] **Step 3: Middleware feature gating**

In middleware, when `subscriptionStatus === 'expired'`:
- Allow core routes (agenda, patients, financeiro, photos, settings, billing)
- Block gated routes (whatsapp send actions) — or handle at API level only

- [ ] **Step 4: Commit**

---

### Task 14: Auto-create subscription on tenant creation

**Files:**
- Modify: `web/src/actions/signup.ts`
- Modify: `web/src/db/queries/admin-tenants.ts` (if admin creates tenants)

- [ ] **Step 1: Update signup flow**

After creating tenant + tenant_user, create a `tenant_subscriptions` row with `planId` → free plan, `status: 'trialing'`, `currentPeriodEnd` = now + 14 days.

- [ ] **Step 2: Update admin tenant creation**

Same: auto-create subscription when admin creates a new tenant.

- [ ] **Step 3: Commit**

---

### Task 15: Trial expiry cron job

**Files:**
- Create: `web/src/app/api/cron/subscription-expiry/route.ts`
- Modify: `web/vercel.json` (add cron schedule)

- [ ] **Step 1: Create expiry cron endpoint**

GET `/api/cron/subscription-expiry` — queries `getExpiredTrials()`, flips status to `expired`, logs to audit.

- [ ] **Step 2: Add to vercel.json**

Add daily cron at e.g. `0 3 * * *` (midnight BRT).

- [ ] **Step 3: Commit**

---

### Task 16: Seed system WhatsApp templates

**Files:**
- Modify: `web/src/db/migrations/0022_subscriptions_plans.sql` (or new migration file)
- Modify: `web/src/lib/whatsapp-blueprints.ts` (if system templates need blueprints)

- [ ] **Step 1: Add system template seed data**

Insert system templates into `whatsapp_templates` with `system_template = true`, `tenant_id = NULL` (or handled via a flag). Templates for: appointment_confirmation, anamnese_link — using `{{2}}` for clinic name.

- [ ] **Step 2: Commit**
