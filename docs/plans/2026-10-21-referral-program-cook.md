# Referral program ("Indique e Ganhe FloraClin"): implementation plan

Date: 2026-10-21
Spec: `docs/superpowers/specs/2026-10-21-referral-program-design.md` (the "doc"; § numbers below refer to it)
Branch: `feat/referral-program`

## 0. Read this first (every agent)

- Read `AGENTS.md` (date/timezone rules, "never push without checks", Next.js version notes). `web` is **Next 16.2** (`node_modules/next/dist/docs/`), `site` is **Next 15.5**. `web/src/middleware.ts` still uses the deprecated `middleware` convention; **do not** rename it to `proxy.ts` in this work (out of scope, noted for a follow-up).
- Read the doc's §5–§9. Copy in quotes below is **exact pt-BR copy**; do not paraphrase it.
- Dates: calendar days through `@/lib/dates` (`toBrYmd`, `formatBrDayMonth`, `formatBrDate`, `brToday`, `parseBrDate`). Instants are plain `Date`. Raw `sql` fragments must interpolate `date.toISOString()`, never a `Date` (`db/queries/__tests__/no-date-in-raw-sql.test.ts` scans for it).
- Tests: vitest, `src/**/*.test.{ts,tsx}`. **No test may need a real DB or Stripe.** Inject dependencies through a `deps` object with production defaults, like `WinbackDeps` in `web/src/lib/winback-offer.ts` (last positional parameter, default = real implementation). Route tests mock modules with `vi.mock` like `app/api/billing/__tests__/checkout.test.ts`.
- Only touch files your task owns. If you find you need a change in a file you don't own, stop and report it rather than editing.
- No new dependencies.
- Run `pnpm --filter @floraclin/web lint`, `pnpm --filter @floraclin/web typecheck` and the relevant `vitest run <paths>` before declaring done (site tasks: `pnpm --filter @floraclin/site test:run`). Do not commit or push unless the orchestrator says so.

### Settled decisions (override the doc where they differ)

1. **Ending the program:** 30 days' notice, then existing discounts drop to 0% from the next invoice. Implemented by `REFERRAL_REWARDS_END_AT`. Discounts on invoices already issued are never taken back. The public rules page states this.
2. **Who can refer:** only clinics paying through Stripe (`tenant_subscriptions.source = 'stripe'` and local `status = 'active'`). Gifted, admin, trial and expired clinics get no link.

### Hard constraints

- Everything new sits behind `REFERRAL_ENROLLMENT_ENABLED`, which is off by default (only the literal `"true"` turns it on). With it off there are no active links, no attribution capture (cookie or DB), no welcome coupon at checkout, no in-app tab, and no site banner. The reward sync ignores the switch but does nothing unless the referrer coupon ids are configured (§6.1).
- The program also stays off until the Stripe ids are set.
- Runtime code never creates Stripe objects. Coupons and the promotion code come from a one-off script that refuses a live key without `--live` and refuses live mode under CI or Vercel.
- One additive migration, `0043_referral_program.sql`, plus the matching `schema.ts` changes.
- Webhook handlers recompute from current Stripe and DB state, so they are idempotent. There is no event-dedup table.

---

## 1. Builder calls (doc §12) and other calls made in this plan

| # | Call | Decision | Why |
|---|---|---|---|
| B-1 | Code alphabet / length | `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 chars, no `0 O 1 I L`), length **6** (≈ 887 M codes). Column stays `varchar(12)`. `normalizeReferralCode` accepts 4–12 chars of the alphabet, case-insensitive, so the length can grow later without breaking old links. | Readable aloud and on Instagram stories; collisions retried on the unique index. |
| B-2 | Clinic name in the landing banner | `shortClinicName(name, 40)`: trim, collapse whitespace, and if longer than 40 cut at the last word boundary ≤ 39 and append `…` (hard cut when there is no space). | Keeps the banner on one or two lines on mobile. |
| B-3 | Env shape for the five referrer coupons | One var: `STRIPE_REFERRER_COUPON_IDS="id20,id40,id60,id80,id100"`. It needs exactly 5 non-empty comma-separated ids in ascending percent order. Anything else counts as **unconfigured**, so rewards are off and a warning is logged once per process. | One var is harder to half-configure than five. |
| B-4 | Cron time and batching | `/api/cron/referral-reconcile` runs at `30 7 * * *` UTC, which is **04:30 BRT** (no other cron at 07:30 UTC). Work is sequential in per-referrer units (P-23) with per-item try/catch, `maxDuration = 300`, and a soft deadline of 240 s checked before each unit. Units left over are counted as skipped and run first tomorrow because they are the least recently reconciled. | Small volume, Stripe rate limits are nowhere near, and the job is idempotent. |
| B-5 | Page layout | A new settings tab, **"Indique e Ganhe"** (`tab=indique`, `GiftIcon`), in the "Sistema" group, owner-only. Cards follow the PR #94 paywall style (`rounded-[3px] border-[#E8ECEF]`, forest/sage). | Reuses the settings shell and its role filter. |
| B-6 | Shared constants module | `web/src/lib/referral/rules.ts` is the source. `site/src/lib/referral-rules.ts` is a **byte-identical copy below the header comment**. A site test reads both files and fails on drift. | `site` and `web` are separate Next apps with no shared package. A new workspace package means new build wiring on two Vercel projects, which costs more than a drift test. |
| B-7 | Test structure | Pure modules get plain unit tests. Orchestrators (`syncReferrerReward`, `refreshReferral`, `attributeReferral`, `getValidatedReferralOffer`, `handleReferralStripeEvent`, `reconcileReferrals`) take a `deps` object with production defaults. | Same pattern as `WinbackDeps`. |
| P-1 | **In-app page when the switch is off** | **Hidden from nav** (the tab doesn't exist; `?tab=indique` falls back to the default tab; `GET /api/referral` returns 404). Not an "em breve" teaser. | Merging must change nothing a clinic can see. An "em breve" card would announce a program whose rules page hasn't had legal review (§11.3), and clinics would ask support about it. |
| P-2 | Card fingerprints | New table `billing_card_fingerprints`, written on every `invoice.paid` while rewards are configured, plus a one-off backfill script. The fingerprints of the referrer and the referred clinic are also fetched live at qualification. | The doc's not-new and self-referral checks need fingerprints across tenants, and nothing stores them today. |
| P-3 | Pause sublabel | New column `tenant_referrals.paused_reason` (`past_due` or `cancel_scheduled`). | The dashboard has to tell "pagamento pendente" from "cancelamento agendado" (§5.3). |
| P-4 | Code field vs cookie | When both are present at signup, the **typed field wins** over the `floraclin_ref` cookie. The field is pre-filled from the cookie or `?ref=`. | Typing is the more deliberate act. |
| P-5 | Site rules page `/indique` | Published only when the **site's** `REFERRAL_ENROLLMENT_ENABLED === 'true'` **or** `REFERRAL_REWARDS_END_AT` is set (wind-down). Otherwise it returns `notFound()` and is left out of the sitemap. `/indicacao/{CODE}` always renders the normal home and only adds the banner when the app API says the code is active. | Legal copy stays unpublished before legal review, but stays up while referrers' discounts wind down. |
| P-6 | Site cookie switch | The site middleware sets `floraclin_ref` only when the site's own `REFERRAL_ENROLLMENT_ENABLED === 'true'`. **web is authoritative**: signup ignores the cookie whenever web's switch is off. | Defence in depth across the two Vercel projects. |
| P-7 | Cookie consent | `floraclin_ref` is a **functional** cookie (doc agent call): it is set without marketing consent. Legal review should confirm (§11.3). | It carries the discount the visitor came for. |
| P-8 | Welcome coupon with `applies_to` | If the welcome promotion code's coupon ever has `applies_to` (`terms.productIds !== null`), the referral offer is treated as misconfigured: no offer, plus a report. | The doc says that coupon never uses `applies_to`, so this keeps the referral offer code small. |
| P-9 | Yearly after qualifying | A referral counts only while the referred subscription is monthly. If it moves to a yearly price it shows `first_paid` (keeping `qualified_at`) and stops counting. | §5.4, "yearly never counts". |
| P-10 | Stripe `trialing` | Treated like `active` (healthy). | The app doesn't use Stripe trials. If one ever appears, it is a live subscription. |
| P-11 | Chargeback → tenant | `charge.dispute.created` resolves the dispute's charge to its customer, then the customer to `tenant_subscriptions.stripe_customer_id`, then the referral by `referred_tenant_id`. | Each tenant has one customer, so this is simpler than mapping the dispute through invoice payments. |
| P-12 | "Not new" window (revised after review, M3) | Identity signals (owner email, phone, registry) are evaluated **at attribution time** (signup or billing-page attach) and **snapshotted** in `checks.atSignup`: another tenant matches when its `tenant_subscriptions` row has `created_at ≤ referredSignupAt` **and** `current_period_end ≥ referredSignupAt − 6 months`, read at that moment. They are re-run once more at checkout (M2, same rule, close to signup). At **qualification** only self-referral (all six signals) and the **card** not-new check run, and the card check uses `billing_card_fingerprints.first_seen_at ≤ referredSignupAt` and `last_seen_at ≥ referredSignupAt − 6 months` (Stripe charge times, not the mutable subscription row). Deleted tenants are included. **Known limitation:** the subscription row is one mutable row per tenant (renewals, gifts and resubscriptions overwrite its period), so the identity check is only as good as the row at attribution time; we accept that rather than add subscription history. | Re-reading the mutable row at qualification could retroactively flip an eligible clinic (a gift granted after signup extends another tenant's period) or hide a real match. Card evidence carries its own timestamps. |
| P-13 | Generic reason for `admin` | "não atende às regras do programa" | The doc only gives copy for three of the four reasons. |
| P-14 | Discount line copy | In "Seu desconto atual: 60% (R$ 59,40 de R$ 99,00)…" the parenthetical is the **amount saved** out of the full price (60% of R$ 99,00 is R$ 59,40). | This is the only reading under which the doc's numbers are consistent. |
| P-15 | Reward-event reasons | `referral_counting`, `referral_paused`, `referral_canceled`, `reconcile`, `invoice_draft`, plus **`admin`** and **`subscription`** (the referrer's own subscription changed). No CHECK constraint on `reason`. | The doc's five reasons don't cover admin marks or the referrer's own subscription changes. |
| P-16 | Reward emails | Sent only when a new `referral_reward_events` row is inserted and the percent or bonus differs from the previous row. No email for the very first all-zero row. Sent **after** the reward lock is released. | Webhook redeliveries can't send duplicates: the **whole** `syncReferrerReward` runs under one per-referrer advisory lock (P-18). |
| P-17 | Referral cookie cleared after use | After a successful attribution at signup, the action deletes `floraclin_ref`. | A second clinic created from the same browser starts clean. |
| P-18 | Reward serialization (review H1) | `syncReferrerReward` runs entirely inside `withReferrerRewardLock(referrerId, fn)` (B3): one transaction holding `pg_advisory_xact_lock(hashtext('referral_reward:' \|\| id))` with `SET LOCAL lock_timeout = '15s'`, and **every** DB read/write of the sync goes through that `tx` (count, billing, bonus raise, history insert), so a sync uses one pooled connection (prod pool is `max: 5`; a second connection per sync could deadlock the pool). Stripe reads/writes (subscription and open drafts) happen inside the lock. Emails go out after commit. A lock timeout throws, so the webhook answers 500 and Stripe redelivers. | Count → Stripe read → Stripe write → history are only correct as one unit. Every status change is followed by a sync, so the last sync to take the lock always applies the latest count. |
| P-19 | Referrer liveness comes from Stripe (review H2, H3) | The reward sync decides from the Stripe subscription it retrieves, never from local `current_period_end` (which lags renewals; same reason as `subscription-access.ts`). `updatable` = Stripe sub exists and status ∉ {`canceled`, `incomplete_expired`, `incomplete`}. `eligible` = updatable **and** local `source = 'stripe'` **and** status ∈ {`active`, `trialing`, `past_due`} **and** the sub's price is monthly. An updatable but ineligible sub (yearly, `unpaid`, a gift row over a lingering sub) gets target 0, i.e. **our coupon is removed**. | Monthly-only must also mean "a referrer that moves to yearly loses the coupon". |
| P-20 | Program end is judged per invoice (review H4) | The subscription-level target uses `now`. Each open draft is judged by **its own `invoice.created`** instant: `areReferralRewardsActive(env, invoiceCreatedAt)`. A draft created before `REFERRAL_REWARDS_END_AT` keeps the count-based percent even when the webhook is delivered after the end. | Doc §6.1: 0% starts with invoices **created after** the end instant. |
| P-21 | First-subscription binding (review M4) | `tenant_referrals.stripe_subscription_id` is bound on `checkout.session.completed` (`bindReferralSubscription`: `SET … WHERE stripe_subscription_id IS NULL`, atomic). If it is still null at refresh, the **earliest** subscription of the referred customer (Stripe `subscriptions.list({ customer, status: 'all' })`, min `created`) is bound the same way. The tenant's current subscription id is **never** used. | The tenant row is overwritten on resubscribe; using it could count a canceled-and-returned clinic. |
| P-22 | Optimistic writes use a version (review M1) | `tenant_referrals.version integer` is incremented by every write; `updateReferralState` compares `version`, not `status`. | Status-only comparison passes an ABA (counting → paused → counting) with a stale write. |
| P-23 | Reconcile rotation (review M7) | The cron processes **per-referrer units** (refresh that referrer's non-terminal referrals, then sync that referrer), ordered by least-recently-reconciled (`min(tenant_referrals.reconciled_at)` of the unit, nulls first). Each attempted referral gets `reconciled_at = now` whether it succeeded or failed. | A deadline-limited run can no longer starve reward syncs or always restart on the same prefix. |

---

## 2. Shared contracts (pinned names every group relies on)

### 2.1 Module map

```
web/src/lib/referral/
  rules.ts          (A2)  constants + pure math, mirrored to site/src/lib/referral-rules.ts
  types.ts          (A2)  shared TS types only
  config.ts         (A2)  env parsing / switches
  code.ts           (A2)  code generation
  subscription-state.ts (A2) pure: Stripe sub → { updatable, eligible }, monthly check (P-19)
  offer-copy.ts     (A2)  CLIENT-SAFE: PublicReferralOffer type + referralOfferHeadline (H7)
  status.ts         (B1)  status machine + pt-BR labels
  eligibility.ts    (B2)  new-clinic & self-referral signal matching + runEligibilityChecks
  cookie.ts         (B6)  floraclin_ref capture for web middleware
  coupon-setup.ts   (B8)  coupon/promo spec + guarded creator (used by the script)
  reward.ts         (C1)  syncReferrerReward (incl. open-draft repair), planReferralDiscounts
  emails.ts         (C1)  reward-change emails
  lifecycle.ts      (C2)  refreshReferral, markReferralChargeback, fingerprints
  offer.ts          (C3)  SERVER-ONLY: getValidatedReferralOffer, chooseCheckoutDiscount
  attribution.ts    (C4)  attributeReferral, pickSignupCode
  dashboard.ts      (C5)  pure view-model for the in-app page
  events.ts         (D1)  handleReferralStripeEvent, reconcileReferrals
web/src/db/queries/referrals.ts   (B3) all referral DB access
```

### 2.2 Public HTTP contracts

| Route | Owner | Contract |
|---|---|---|
| `GET /api/referral/codes/{code}` (public, no auth) | C4 | `200 { active: true, clinicName: string }` or `200 { active: false }` (unknown, inactive, malformed or switch off are indistinguishable). Header `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`. |
| `POST /api/referral/attach` (owner) | C4 | Body `{ code: string }`. `200 { status: 'trial' \| 'ineligible' }`, or `400 { error: <pt-BR> }`, or `404` when the switch is off. |
| `GET /api/referral` (owner) | C5 | `200 ReferralDashboardResponse` (§C5), or `404` when the switch is off. |
| `GET /api/admin/tenants/{id}/referrals` (platform admin) | D4 | `200 { data: AdminReferralView }` |
| `POST /api/admin/referrals/{id}/ineligible` (platform admin) | D4 | Body `{ note?: string }`. `200 { data: { status: 'ineligible' } }` |
| `GET /api/cron/referral-reconcile` (Bearer `CRON_SECRET`) | D1 | `200 { ok: true, refreshed, synced, failed, skipped }` |

---

## Group A: foundations (2 tasks, parallel)

### Task A1: Migration 0043 + Drizzle schema

**File ownership:** `web/src/db/migrations/0043_referral_program.sql` (create), `web/src/db/schema.ts` (modify).

**Note for the PR and the plan:** the migration is **additive only**: two nullable columns on existing tables (`tenants.referral_code`, `whatsapp_credits.bonus_source`), one column with a constant default (`whatsapp_credits.bonus_credits`) (Postgres 11+ adds them without a table rewrite), three new tables and indexes. The deployed code ignores all of it, so **Giorgio applies it in prod before the deploy**. The PR is not eligible for auto-merge.

**SQL (write verbatim; keep the `--> statement-breakpoint` style of 0040/0042):**

```sql
-- Referral program ("Indique e Ganhe"). Additive only: safe to apply before
-- the deploy that uses it; the running code ignores every object below.
ALTER TABLE "floraclin"."tenants" ADD COLUMN IF NOT EXISTS "referral_code" varchar(12);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenants_referral_code" ON "floraclin"."tenants" USING btree ("referral_code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."tenant_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_tenant_id" uuid NOT NULL,
	"referred_tenant_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"captured_via" varchar(12) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"status" varchar(16) NOT NULL,
	"paused_reason" varchar(16),
	"ineligible_reason" varchar(32),
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stripe_subscription_id" varchar(255),
	"first_paid_at" timestamp with time zone,
	"qualified_at" timestamp with time zone,
	"qualifying_invoice_id" varchar(255),
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_referrals_referrer_tenant_id_tenants_id_fk" FOREIGN KEY ("referrer_tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "tenant_referrals_referred_tenant_id_tenants_id_fk" FOREIGN KEY ("referred_tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "tenant_referrals_referred_unique" UNIQUE ("referred_tenant_id"),
	CONSTRAINT "tenant_referrals_not_self_check" CHECK ("referrer_tenant_id" <> "referred_tenant_id"),
	CONSTRAINT "tenant_referrals_status_check" CHECK ("status" IN ('trial','trial_ended','first_paid','counting','paused','canceled','ineligible')),
	CONSTRAINT "tenant_referrals_captured_via_check" CHECK ("captured_via" IN ('link','signup_field','billing_page')),
	CONSTRAINT "tenant_referrals_paused_reason_check" CHECK ("paused_reason" IS NULL OR "paused_reason" IN ('past_due','cancel_scheduled')),
	CONSTRAINT "tenant_referrals_ineligible_reason_check" CHECK ("ineligible_reason" IS NULL OR "ineligible_reason" IN ('self_referral','not_new','chargeback','admin'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_referrals_referrer_status" ON "floraclin"."tenant_referrals" USING btree ("referrer_tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_referrals_stripe_sub" ON "floraclin"."tenant_referrals" USING btree ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."referral_reward_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_tenant_id" uuid NOT NULL,
	"counting" integer NOT NULL,
	"discount_percent" integer NOT NULL,
	"bonus_credits" integer NOT NULL,
	"stripe_subscription_id" varchar(255),
	"reason" varchar(32) NOT NULL,
	"referral_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_reward_events_referrer_tenant_id_tenants_id_fk" FOREIGN KEY ("referrer_tenant_id") REFERENCES "floraclin"."tenants"("id"),
	CONSTRAINT "referral_reward_events_referral_id_fk" FOREIGN KEY ("referral_id") REFERENCES "floraclin"."tenant_referrals"("id"),
	CONSTRAINT "referral_reward_events_percent_check" CHECK ("discount_percent" IN (0,20,40,60,80,100))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referral_reward_events_referrer_created" ON "floraclin"."referral_reward_events" USING btree ("referrer_tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "floraclin"."referral_reward_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floraclin"."billing_card_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_card_fingerprints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_card_fingerprints_tenant_fp" ON "floraclin"."billing_card_fingerprints" USING btree ("tenant_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_card_fingerprints_fp" ON "floraclin"."billing_card_fingerprints" USING btree ("fingerprint");--> statement-breakpoint
ALTER TABLE "floraclin"."billing_card_fingerprints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credits" ADD COLUMN IF NOT EXISTS "bonus_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "floraclin"."whatsapp_credits" ADD COLUMN IF NOT EXISTS "bonus_source" varchar(16);
```

(A plain unique index on `referral_code` lets any number of NULLs through in Postgres, so no partial index is needed.)

**schema.ts changes (exact property names; other tasks import these):**

```ts
// tenants: add column + table config
referralCode: varchar('referral_code', { length: 12 }),
// third arg:  (table) => [uniqueIndex('uq_tenants_referral_code').on(table.referralCode)]

// whatsappCredits: add
bonusCredits: integer('bonus_credits').notNull().default(0),
bonusSource: varchar('bonus_source', { length: 16 }),

// new, in the "SUBSCRIPTIONS & PLANS" section after tenantSubscriptions:
export const tenantReferrals = floraclinSchema.table('tenant_referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  referrerTenantId: uuid('referrer_tenant_id').notNull().references(() => tenants.id),
  referredTenantId: uuid('referred_tenant_id').notNull().references(() => tenants.id).unique('tenant_referrals_referred_unique'),
  code: varchar('code', { length: 12 }).notNull(),
  capturedVia: varchar('captured_via', { length: 12 }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  pausedReason: varchar('paused_reason', { length: 16 }),
  ineligibleReason: varchar('ineligible_reason', { length: 32 }),
  checks: jsonb('checks').$type<Record<string, unknown>>().notNull().default({}),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  firstPaidAt: timestamp('first_paid_at', { withTimezone: true }),
  qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
  qualifyingInvoiceId: varchar('qualifying_invoice_id', { length: 255 }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),           // P-22: bumped by every write
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }), // P-23: cron rotation
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_tenant_referrals_referrer_status').on(table.referrerTenantId, table.status),
  index('idx_tenant_referrals_stripe_sub').on(table.stripeSubscriptionId),
])

export const referralRewardEvents = floraclinSchema.table('referral_reward_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  referrerTenantId: uuid('referrer_tenant_id').notNull().references(() => tenants.id),
  counting: integer('counting').notNull(),
  discountPercent: integer('discount_percent').notNull(),
  bonusCredits: integer('bonus_credits').notNull(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  reason: varchar('reason', { length: 32 }).notNull(),
  referralId: uuid('referral_id').references(() => tenantReferrals.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_referral_reward_events_referrer_created').on(table.referrerTenantId, table.createdAt),
])

export const billingCardFingerprints = floraclinSchema.table('billing_card_fingerprints', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),   // earliest succeeded charge with this card (Stripe time)
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),     // latest succeeded charge with this card (Stripe time)
}, (table) => [
  uniqueIndex('uq_billing_card_fingerprints_tenant_fp').on(table.tenantId, table.fingerprint),
  index('idx_billing_card_fingerprints_fp').on(table.fingerprint),
])
```

**Tests:** no new tests (schema only). Acceptance: `pnpm --filter @floraclin/web typecheck` and the full `test:run` stay green, because adding columns must not break the existing mocks of `@/db/schema`.

---

### Task A2: Rules, types, config, code generation (pure)

**File ownership (create all):**
- `web/src/lib/referral/rules.ts`
- `site/src/lib/referral-rules.ts` (mirror)
- `web/src/lib/referral/types.ts`
- `web/src/lib/referral/config.ts`
- `web/src/lib/referral/code.ts`
- `web/src/lib/referral/subscription-state.ts` (review H2/H3)
- `web/src/lib/referral/offer-copy.ts` (review H7; client-safe)
- `web/src/lib/referral/__tests__/rules.test.ts`
- `web/src/lib/referral/__tests__/config.test.ts`
- `web/src/lib/referral/__tests__/code.test.ts`
- `web/src/lib/referral/__tests__/subscription-state.test.ts`
- `web/src/lib/referral/__tests__/offer-copy.test.ts`
- `site/src/lib/__tests__/referral-rules.test.ts`

**`rules.ts` has no imports and is shared verbatim with site.** The header comment differs between the copies. The body starts at a marker line, `// ── shared body ──`, and the drift test compares the text after it.

```ts
// ── shared body ──
export const REFERRAL_PERCENT_PER_REFERRAL = 20
export const REFERRAL_MAX_COUNTING_FOR_DISCOUNT = 5          // 5 × 20% = grátis
export const REFERRAL_BONUS_CREDITS_PER_EXTRA = 100          // per counting referral past 5, per BRT month
export const REFERRAL_WELCOME_PERCENT = 20
export const REFERRAL_WELCOME_MONTHS = 2
export const REFERRAL_TRIAL_DAYS = 14
export const REFERRAL_NEW_CLINIC_WINDOW_MONTHS = 6
export const REFERRAL_END_NOTICE_DAYS = 30
export const REFERRAL_COOKIE_NAME = 'floraclin_ref'
export const REFERRAL_COOKIE_MAX_AGE_DAYS = 60
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const REFERRAL_CODE_LENGTH = 6
export const REFERRAL_SITE_ORIGIN = 'https://floraclin.com.br'

export type ReferralPercent = 0 | 20 | 40 | 60 | 80 | 100

/** 20 × min(counting, 5). Negative / non-integer input is floored at 0. */
export function referralDiscountPercent(counting: number): ReferralPercent
/** 100 × max(counting − 5, 0); 0 when the plan's credit limit is -1 (unlimited). */
export function referralBonusCredits(counting: number, planCreditLimit: number): number
/** Trim + uppercase; null unless 4–12 chars, all in REFERRAL_CODE_ALPHABET. */
export function normalizeReferralCode(raw: unknown): string | null
/** See builder call B-2. */
export function shortClinicName(name: string, max?: number): string
/** Rows 1..5 for the public table: [{ counting: 1, percent: 20 }, …, { counting: 5, percent: 100 }]. */
export function referralDiscountTable(): Array<{ counting: number; percent: ReferralPercent }>
/** `${origin}/indicacao/${code}` */
export function referralLink(code: string, origin?: string): string
/** §5.4 — the one helper every monthly-only check reads. */
export function isReferralEligiblePlan(plan: { billingInterval: string | null | undefined }): boolean // === 'month'
```

**`types.ts` (types only):**

```ts
export type { ReferralPercent } from './rules'
export type ReferralStatus = 'trial' | 'trial_ended' | 'first_paid' | 'counting' | 'paused' | 'canceled' | 'ineligible'
export type IneligibleReason = 'self_referral' | 'not_new' | 'chargeback' | 'admin'
export type PausedReason = 'past_due' | 'cancel_scheduled'
export type CapturedVia = 'link' | 'signup_field' | 'billing_page'
export type RewardEventReason =
  | 'referral_counting' | 'referral_paused' | 'referral_canceled'
  | 'reconcile' | 'invoice_draft' | 'admin' | 'subscription'
export type SignalKind = 'owner_email' | 'email_domain' | 'phone' | 'registry' | 'shared_user' | 'card'
export type NotNewSignalKind = 'owner_email' | 'phone' | 'registry' | 'card'

/** The persisted state of one referral; the contract between B1 (machine), B3 (storage) and C2 (refresh). Lives here so no Group B task duplicates it (review L2). */
export interface ReferralState {
  status: ReferralStatus
  pausedReason: PausedReason | null
  ineligibleReason: IneligibleReason | null
  stripeSubscriptionId: string | null
  firstPaidAt: Date | null
  qualifiedAt: Date | null
  qualifyingInvoiceId: string | null
  endedAt: Date | null
}

/** One card seen on a tenant, with Stripe charge times (P-12). */
export interface CardSighting { fingerprint: string; firstSeenAt: Date; lastSeenAt: Date }

/** Identity signals of one tenant, already normalised. */
export interface TenantSignals {
  tenantId: string
  ownerEmails: string[]       // lower-cased, trimmed
  phones: string[]            // normalizeBrPhone() digits; tenant phone + owner users' phones
  registries: string[]        // `${TYPE}:${digitsOnlyNumber}:${UF}` for every active user with all 3 set
  userIds: string[]           // every tenant_users.user_id (any role)
  cardFingerprints: string[]
}
/** A tenant that might make the referred clinic "not new" (doc §5.2). */
export interface CandidateTenant extends TenantSignals {
  subscriptionCreatedAt: Date
  subscriptionEndsAt: Date    // tenant_subscriptions.current_period_end, read at attribution time only (P-12)
  cards: CardSighting[]       // billing_card_fingerprints rows of this tenant
}
export interface CheckResult { selfReferral: SignalKind[]; notNew: Array<{ tenantId: string; signals: SignalKind[] }> }
/** Persisted in tenant_referrals.checks; never shown raw to the referrer. */
export interface ReferralChecks {
  atSignup?: CheckResult          // identity snapshot (P-12)
  atCheckout?: CheckResult        // M2 re-check before the welcome coupon
  atQualification?: CheckResult   // self-referral (all signals) + card-only not-new
  adminNote?: string
}
```

**`config.ts`:**

```ts
type Env = Record<string, string | undefined>
export type ReferrerCouponIds = Readonly<Record<20 | 40 | 60 | 80 | 100, string>>

export function referralPromotionCodeId(env?: Env): string | null            // STRIPE_REFERRAL_PROMOTION_CODE_ID trimmed
export function referrerCouponIds(env?: Env): ReferrerCouponIds | null       // STRIPE_REFERRER_COUPON_IDS, B-3
export function referralRewardsEndAt(env?: Env): Date | null                 // REFERRAL_REWARDS_END_AT; full ISO with offset or 'Z' only (like META_EVENTS_START_AT); bare YYYY-MM-DD / invalid → null + console.warn
/** Rewards keep syncing: coupon ids configured AND not past the end date. */
export function areReferralRewardsActive(env?: Env, now?: Date): boolean
/** New activity: REFERRAL_ENROLLMENT_ENABLED === 'true' AND promo id AND coupon ids AND not past the end date. */
export function isReferralEnrollmentEnabled(env?: Env, now?: Date): boolean
export function couponIdForPercent(percent: number, ids: ReferrerCouponIds): string | null   // 0 → null
/** Ours when the id is one of the five, or metadata.purpose === 'referral_reward'. */
export function isReferrerCoupon(coupon: { id: string; metadata?: Record<string, string> | null }, ids: ReferrerCouponIds | null): boolean
/** Whether a tenant may hold an active link (settled decision 2). */
export function canRefer(row: { source?: string | null; status: string } | null | undefined): boolean // source==='stripe' && status==='active'
```

All functions default `env = process.env` and `now = new Date()`. There is deliberately **no** helper that decides referrer liveness from the local row's `current_period_end` (review H2): the reward sync decides from Stripe (`subscription-state.ts`).

**`subscription-state.ts`** (pure; `import type Stripe from 'stripe'` only):

```ts
type SubLike = Pick<Stripe.Subscription, 'status'> & { items: { data: Array<{ price: { recurring: { interval: string; interval_count: number } | null } }> } }
/** items.data[0].price.recurring is month × 1, via isReferralEligiblePlan. */
export function stripeSubscriptionIsMonthly(sub: SubLike): boolean
/**
 * P-19. updatable: status ∉ {canceled, incomplete_expired, incomplete} ('missing' → false).
 * eligible: updatable && localSource === 'stripe' && status ∈ {active, trialing, past_due} && monthly.
 * cancel_at_period_end does not change either flag (the sub is still open per Stripe).
 */
export function referrerSubscriptionState(sub: SubLike | 'missing' | null, localSource: string | null | undefined): { updatable: boolean; eligible: boolean }
```

**`offer-copy.ts`** (client-safe, review H7). It may import only `./rules`, `./types` and **type-only** imports (`import type { PromotionCodeTerms } from '@/lib/stripe'`, erased at build, same as `winback.ts`). It must never import `@/db`, `@/lib/stripe` values, `./offer` or anything server-side, because `plan-checkout.tsx` (a `'use client'` module) imports it.

```ts
export interface PublicReferralOffer {
  kind: 'referral'
  referrerName: string
  label: string                         // "20% de desconto nos 2 primeiros meses"
  percentOff: number | null; amountOffCents: number | null
  duration: PromotionCodeTerms['duration']; durationInMonths: number | null
  planSlugs: string[]
}
/** "Indicação de {shortClinicName(nome)}: {label}." */
export function referralOfferHeadline(o: Pick<PublicReferralOffer, 'referrerName' | 'label'>): string
```

**`code.ts`:**

```ts
/** Rejection sampling over REFERRAL_CODE_ALPHABET (31 chars): bytes ≥ 248 are discarded so every char is uniform. */
export function generateReferralCode(randomBytes?: (n: number) => Uint8Array): string
```
The default is `(n) => crypto.getRandomValues(new Uint8Array(n))`.

**Tests:**
- `rules.test.ts`:
  - The percent is 0, 20, 40, 60, 80, 100, 100 for counts 0, 1, 2, 3, 4, 5, 9, and 0 for −1 and NaN.
  - The bonus is 0 for counts 0–5, 100 at 6 and 300 at 8. It is 0 when the plan limit is −1, whatever the count.
  - `normalizeReferralCode`: `' meca7k '` gives `'MECA7K'`. `null` comes back for `'ME0A7K'` (has 0), `'MICA7K'` (has I), `'ABC'`, a 13-char code, a number, and `undefined`. **Every code fixture in this plan uses only alphabet characters** (review L1).
  - `shortClinicName`: a short name is unchanged, whitespace is collapsed, a long name is cut at a word boundary with `…` and its length is ≤ 40, and a long single word is hard-cut.
  - `referralLink('ABC234')` is `https://floraclin.com.br/indicacao/ABC234`.
  - `isReferralEligiblePlan`: `'month'` gives true; `'year'`, `null` and `undefined` give false.
  - `referralDiscountTable()` has 5 rows ending at 100.
- `config.test.ts`:
  - The coupon list must hold exactly 5 ids in order. 4 ids, 6 ids or an empty item count as unconfigured.
  - Enrollment is off with the var unset, `'1'`, `'TRUE '` or `'false'`. It is on only with `'true'` **and** the promo id **and** the coupons.
  - Enrollment is off at or after the end date. `areReferralRewardsActive` is false after the end date and true before it.
  - An end date as a bare `2026-12-01` is rejected (null).
  - `isReferrerCoupon` recognises a coupon by its id or by its metadata.
  - `canRefer` holds only for stripe+active: false for gift+active, trial, stripe+past_due and stripe+canceled.
- `code.test.ts`:
  - A code has 6 chars, all from the alphabet.
  - With a deterministic byte source the output is fixed: injecting `[248, 0, 30, …]` shows 248 being skipped and 30 mapping to `'9'`.
  - 10 000 generated codes contain no `0 O 1 I L`.
- `subscription-state.test.ts`:
  - `active` monthly + source stripe → updatable and eligible; `trialing` and `past_due` too.
  - `active` with `cancel_at_period_end` (a sub still open per Stripe) → eligible.
  - `active` **yearly** → updatable, **not** eligible (H3: the coupon must be removed).
  - `active` monthly but local source `gift` → updatable, not eligible.
  - `unpaid` → updatable, not eligible. `canceled`, `incomplete_expired`, `incomplete`, `'missing'`, `null` → neither.
  - `stripeSubscriptionIsMonthly`: month×1 true; month×3, year, null recurring false.
- `offer-copy.test.ts`:
  - `referralOfferHeadline({ referrerName: 'Clínica Bela', label: '20% de desconto nos 2 primeiros meses' })` is "Indicação de Clínica Bela: 20% de desconto nos 2 primeiros meses."; a long name is shortened.
  - **Import boundary:** reads `offer-copy.ts` source and asserts every non-`import type` import specifier is `./rules` or `./types` (fails on `@/db`, `@/lib/stripe` value imports, `./offer`, `./config`).
- `site/src/lib/__tests__/referral-rules.test.ts`:
  - Reads `path.resolve(__dirname, '../../../../web/src/lib/referral/rules.ts')` and `../referral-rules.ts`, splits each at `// ── shared body ──`, and asserts the two bodies are equal.
  - Plus a smoke test of `referralDiscountPercent` through the site copy.

---

## Group B: core modules (8 tasks, parallel; depend on A only)

### Task B1: Status machine + labels

**File ownership:** `web/src/lib/referral/status.ts`, `web/src/lib/referral/__tests__/status.test.ts`.

```ts
import type Stripe from 'stripe'
import type { IneligibleReason, PausedReason, ReferralState, ReferralStatus } from './types'
export type { ReferralState } from './types'   // defined in A2 (review L2); re-exported for convenience

/** Everything the machine reads, gathered fresh by refreshReferral (C2). */
export interface ReferredSnapshot {
  now: Date
  /** tenants.deleted_at set (admin removed the clinic). */
  tenantDeleted: boolean
  /** No Stripe subscription yet and the local trial/grant row is past its end. */
  localTrialEnded: boolean
  /** The referral's subscription (first one the clinic ever opened); null when it never checked out. */
  stripe: null | {
    subscriptionId: string
    status: Stripe.Subscription.Status | 'missing'   // 'missing' = Stripe says resource_missing
    cancelAtPeriodEnd: boolean
    /** Price recurring interval is month × 1 (isReferralEligiblePlan). */
    monthly: boolean
    /** Earliest paid invoice of this subscription, from a fully paginated list (B4). */
    firstPaidAt: Date | null
    /** Earliest invoice with billing_reason 'subscription_cycle', status paid, amount_paid > 0. */
    qualifyingInvoice: { id: string; paidAt: Date } | null
  }
  /** Decided by the caller: failed checks, chargeback, admin mark. */
  ineligible: IneligibleReason | null
}

export function computeReferralStatus(prev: ReferralState, snap: ReferredSnapshot): ReferralState
export function isCountingStatus(s: ReferralStatus): boolean           // === 'counting'
export function isTerminalStatus(s: ReferralStatus): boolean           // canceled | ineligible

/** Dashboard label + optional sublabel (doc §5.3, exact pt-BR). */
export function referralStatusLabel(r: { status: ReferralStatus; pausedReason: PausedReason | null; ineligibleReason: IneligibleReason | null }): { label: string; sublabel: string | null }
```

**Rules, evaluated in order. The first rule that matches wins.**

| # | Condition | Result |
|---|---|---|
| R0 | `prev.status === 'ineligible'` | unchanged (terminal) |
| R1 | `snap.ineligible` | `ineligible`, `ineligibleReason = snap.ineligible`, `pausedReason = null`, `endedAt = prev.endedAt ?? now` |
| R2 | `prev.status === 'canceled'` | unchanged (terminal: a clinic that comes back never counts again) |
| R3 | `snap.tenantDeleted` | `canceled`, `endedAt = now` |
| R4 | `snap.stripe === null` | `localTrialEnded ? 'trial_ended' : 'trial'`. **Only** when prev is `trial` or `trial_ended`; otherwise prev is returned unchanged (defensive: a paid referral always has its sub id stored). |
| R5 | `stripe.status ∈ {canceled, incomplete_expired, missing}` | `canceled`, `endedAt = now`, `pausedReason = null` |
| R6 | `stripe.status === 'incomplete'` **or** (`prev.firstPaidAt == null` **and** `prev.qualifiedAt == null` **and** `stripe.firstPaidAt == null`) | prev unchanged, except `stripeSubscriptionId` gets stamped (a checkout still in flight). Persisted `firstPaidAt` / `qualifiedAt` on prev are **sufficient** to go on to R7 even when the snapshot has no paid invoice (review H8). |
| R7 | — | stamp `stripeSubscriptionId` and `firstPaidAt = prev.firstPaidAt ?? stripe.firstPaidAt`. `qualified = prev.qualifiedAt != null \|\| (stripe.qualifyingInvoice != null && stripe.monthly)`. When newly qualified, stamp `qualifiedAt = qualifyingInvoice.paidAt` and `qualifyingInvoiceId`. |
| R7a | `!qualified \|\| !stripe.monthly` | `first_paid` (P-9), `pausedReason = null` |
| R7b | `stripe.status ∈ {past_due, unpaid, paused}` | `paused`, `pausedReason = 'past_due'` |
| R7c | `stripe.cancelAtPeriodEnd` | `paused`, `pausedReason = 'cancel_scheduled'` |
| R7d | `stripe.status ∈ {active, trialing}` | `counting`, `pausedReason = null` |

The function is pure: `now` comes from `snap.now`. It returns a **new** object and never mutates `prev`. When nothing changes, the result must be deep-equal to `prev`, which callers rely on for idempotence.

**Transition matrix (for reviewers; it follows from the rules above):**

| from \ to | trial | trial_ended | first_paid | counting | paused | canceled | ineligible |
|---|---|---|---|---|---|---|---|
| trial | — | trial over, no checkout | 1st invoice paid | (1st+2nd paid before a webhook ran) | — | sub deleted, tenant deleted | checks, admin |
| trial_ended | admin extended trial | — | paid | (same) | — | deleted | checks, admin |
| first_paid | — | — | — | 2nd cycle invoice paid, monthly | 2nd paid while overdue or cancel scheduled | deleted | checks at qualification, chargeback, admin |
| counting | — | — | moved to a yearly price | — | past_due, cancel scheduled | deleted | chargeback, admin |
| paused | — | — | yearly | recovered, reactivated | (switch of reason) | deleted | chargeback, admin |
| canceled | — | — | — | — | — | — | chargeback, admin |
| ineligible | — | — | — | — | — | — | — |

**Labels (exact copy):**
- `trial` → "em teste"
- `trial_ended` → "teste encerrado"
- `first_paid` → "pagante" + "conta a partir da 2ª mensalidade"
- `counting` → "pagante"
- `paused` → "pagante" + "pagamento pendente" (`past_due`) or "cancelamento agendado" (`cancel_scheduled`)
- `canceled` → "cancelada"
- `ineligible` → "não elegível" + `self_referral` "mesma clínica ou profissional", `not_new` "clínica já usou o FloraClin", `chargeback` "contestação de pagamento", `admin` "não atende às regras do programa" (P-13)

**Tests (`status.test.ts`):** a table-driven case for every row R0–R7d, plus:
- `trial` with no sub and the trial over gives `trial_ended`. `trial_ended` whose trial was extended goes back to `trial`.
- `trial` with an active sub, a paid first invoice and no cycle invoice gives `first_paid`, with `firstPaidAt` and `stripeSubscriptionId` stamped.
- `first_paid` with a paid cycle invoice of `amount_paid > 0` (the snapshot only carries qualifying invoices) gives `counting`, with `qualifiedAt` and `qualifyingInvoiceId` set.
- A qualifying invoice on a **yearly** sub stays `first_paid` (P-9).
- `counting` with past_due gives `paused/past_due`. Recovery to active returns to `counting` and keeps the original `qualifiedAt` (no second wait).
- `counting` with `cancelAtPeriodEnd` gives `paused/cancel_scheduled`. Reactivation returns to `counting`.
- Any non-terminal status gives `canceled` when the sub is `canceled`, `incomplete_expired` or `missing`, with `endedAt` set.
- `canceled` plus a new active snapshot stays `canceled`.
- `canceled` plus a chargeback gives `ineligible`.
- `ineligible` stays put whatever comes in.
- Tenant deleted gives `canceled`.
- `incomplete` checkout from `trial` stays `trial`.
- Idempotence: applying the same snapshot twice equals applying it once (deep-equal).
- H8: prev `counting` with persisted `firstPaidAt` and `qualifiedAt`, snapshot with `firstPaidAt: null`, `qualifyingInvoice: null` and status `past_due` gives `paused/past_due` (not "prev unchanged"); same with `cancelAtPeriodEnd` gives `paused/cancel_scheduled`.
- The labels match the copy above exactly.

---

### Task B2: Eligibility (new-clinic and self-referral)

**File ownership:** `web/src/lib/referral/eligibility.ts`, `web/src/lib/referral/__tests__/eligibility.test.ts`.

```ts
import type { CandidateTenant, CheckResult, NotNewSignalKind, SignalKind, TenantSignals } from './types'

/** Webmail domains: a shared domain here is never evidence (doc §5.2). */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string>
// at least: gmail.com googlemail.com hotmail.com hotmail.com.br outlook.com outlook.com.br live.com msn.com
// yahoo.com yahoo.com.br icloud.com me.com uol.com.br bol.com.br terra.com.br ig.com.br globo.com globomail.com
// protonmail.com proton.me zoho.com aol.com

export function emailDomain(email: string): string | null

/** Signals shared by the referred clinic and its referrer (all six kinds). Sorted, unique. */
export function selfReferralMatches(referred: TenantSignals, referrer: TenantSignals): SignalKind[]

/**
 * Other tenants that make the referred clinic not new (P-12). The referrer and the
 * referred tenant themselves are excluded by the caller and again here.
 * - owner_email / phone / registry: match with a tenant whose subscription row has
 *   createdAt ≤ signupAt and subscriptionEndsAt ≥ signupAt − 6 months.
 * - card: match with a candidate CardSighting whose firstSeenAt ≤ signupAt and
 *   lastSeenAt ≥ signupAt − 6 months (the subscription row is NOT consulted).
 * `kinds` restricts the signal kinds checked (default: all four).
 */
export function notNewMatches(
  referred: TenantSignals,
  candidates: CandidateTenant[],
  referredSignupAt: Date,
  excludeTenantIds: string[],
  kinds?: NotNewSignalKind[],
): Array<{ tenantId: string; signals: SignalKind[] }>

/** Verdict: self_referral beats not_new; null = eligible. */
export function eligibilityVerdict(self: SignalKind[], notNew: Array<{ tenantId: string; signals: SignalKind[] }>): 'self_referral' | 'not_new' | null

/**
 * The one place that runs the checks (shared by C2, C3 and C4 so they can't diverge).
 * Loaders are injected (the caller passes B3's loadTenantSignals / loadCandidateTenants),
 * so this file still imports nothing from Group B.
 *   'attribution'   self-referral: all signals except card; not-new: owner_email, phone, registry (+ card when the referred tenant has any)
 *   'checkout'      same as 'attribution' (M2)
 *   'qualification' self-referral: all six signals; not-new: card only (P-12, M3)
 */
export async function runEligibilityChecks(
  input: { referredTenantId: string; referrerTenantId: string; referredSignupAt: Date; stage: 'attribution' | 'checkout' | 'qualification' },
  loaders: { loadSignals(tenantId: string): Promise<TenantSignals>; loadCandidates(referred: TenantSignals, exclude: string[]): Promise<CandidateTenant[]> },
): Promise<CheckResult & { verdict: 'self_referral' | 'not_new' | null }>
```

What counts as a match:
- `owner_email`: a lower-cased owner email in common.
- `email_domain`: an owner email domain in common that is **not** in `PUBLIC_EMAIL_DOMAINS`. Self-referral only.
- `phone`: an exact match after both sides were normalised by the loader. Empty strings are ignored.
- `registry`: an exact `TYPE:NUMBER:UF` string match.
- `shared_user`: a user id in common. Self-referral only.
- `card`: a fingerprint in common.
- not-new uses `owner_email`, `phone`, `registry` and `card` only.

The window uses `subMonths(referredSignupAt, REFERRAL_NEW_CLINIC_WINDOW_MONTHS)` from date-fns. These are instants, so there is no BR calendar concern.

**Tests:**
- One self-referral case per signal kind.
- A `gmail.com` domain alone is not a match, while `clinicabela.com.br` is.
- Empty arrays never match.
- not-new: a candidate whose subscription ended 7 months before the signup doesn't match; one that ended 5 months before does; one created after the signup doesn't.
- not-new card window: a candidate card last seen 7 months before signup doesn't match; last seen 5 months before does; first seen after signup doesn't. The card rule ignores `subscriptionEndsAt` entirely (a candidate whose row was extended by a later gift does not change the card verdict).
- `kinds: ['card']` ignores an owner-email match.
- `runEligibilityChecks`: `qualification` stage reports a shared phone as self-referral but never as not-new; `attribution` stage reports a phone match with a candidate in the window as not-new; loaders are called with the exclude list `[referrer, referred]`.
- The excluded ids (referrer, self) are skipped.
- Deleted tenants are just candidates, with nothing special about them.
- The verdict prefers `self_referral`.
- The outputs are deterministic (sorted).

---

### Task B3: Referral data access

**File ownership:** `web/src/db/queries/referrals.ts`, `web/src/db/queries/__tests__/referrals.test.ts` (create).

Every write to `tenant_referrals` sets `updated_at = now()` **and** `version = version + 1` (P-22). Raw `sql` must interpolate `.toISOString()`. Use `isUniqueViolation` from `@/lib/errors` for retries. Export these **exact** signatures:

```ts
// imports: db, schema tables (A1), types incl. ReferralState (A2), config.canRefer / generateReferralCode (A2)
/** Same convention as consent.ts (`tx: typeof db`). Functions that take `exec` default to `db`. */
export type DbExecutor = typeof db
export type TenantReferral = typeof tenantReferrals.$inferSelect
export type ReferralRewardEvent = typeof referralRewardEvents.$inferSelect

// ── codes ──
/** Returns the tenant's code, creating it on first call (generateReferralCode, up to 5 retries on uq_tenants_referral_code). */
export async function getOrCreateReferralCode(tenantId: string): Promise<string>
/** By normalised code. canRefer = config.canRefer(row) && tenant not deleted. Null when no tenant has the code. */
export async function findReferrerByCode(code: string): Promise<{ tenantId: string; name: string; canRefer: boolean } | null>

// ── referral rows ──
export async function getReferralById(id: string): Promise<TenantReferral | null>
/** For reward emails (C1): referred clinic name, even when that tenant is deleted. */
export async function getReferralSummary(id: string): Promise<{ id: string; referredName: string; status: ReferralStatus } | null>
export async function getReferralByReferredTenant(referredTenantId: string): Promise<TenantReferral | null>
export async function findReferralByStripeSubscription(stripeSubscriptionId: string): Promise<TenantReferral | null>
/** INSERT … ON CONFLICT (referred_tenant_id) DO NOTHING RETURNING *; null when one already existed. */
export async function insertReferral(input: {
  referrerTenantId: string; referredTenantId: string; code: string; capturedVia: CapturedVia; capturedAt: Date
  status: 'trial' | 'ineligible'; ineligibleReason: IneligibleReason | null; checks: ReferralChecks
}): Promise<TenantReferral | null>
/** Optimistic write (P-22): UPDATE … SET …, version = version + 1 WHERE id = $id AND version = $expectedVersion. Returns whether a row changed. `checks` is merged (jsonb ||). */
export async function updateReferralState(id: string, expectedVersion: number, next: ReferralState, checks?: ReferralChecks): Promise<boolean>
/** Sets ineligible/admin|chargeback|self_referral|not_new from any non-ineligible status (bumps version); merges `checks`; returns the updated row or null. */
export async function markReferralIneligible(id: string, reason: IneligibleReason, note?: string, checks?: ReferralChecks): Promise<TenantReferral | null>
/** P-21: UPDATE … SET stripe_subscription_id = $sub, version + 1 WHERE id = $id AND stripe_subscription_id IS NULL. Returns the bound id afterwards (the existing one when already bound). */
export async function bindReferralSubscription(id: string, stripeSubscriptionId: string): Promise<string | null>

// ── snapshot inputs for refreshReferral ──
export interface ReferralContext {
  referral: TenantReferral
  referredDeleted: boolean
  referredSignupAt: Date                    // tenants.created_at
  referredSub: null | { source: string; status: string; stripeSubscriptionId: string | null; stripeCustomerId: string | null; currentPeriodEnd: Date }
  // referredSub.stripeSubscriptionId is for localTrialEnded only; it is NEVER used as the referral's subscription (P-21)
  referrerCustomerId: string | null         // referrer's tenant_subscriptions.stripe_customer_id
}
export async function getReferralContext(referralId: string): Promise<ReferralContext | null>

// ── signals ──
export async function loadTenantSignals(tenantId: string): Promise<TenantSignals>   // see TenantSignals docs; uses normalizeBrPhone (try/catch → skip unparsable)
/** Pre-filter in SQL by any owner_email / phone / registry / fingerprint overlap, then load full signals + subscription window + card sightings for those tenants (deleted included). */
export async function loadCandidateTenants(referred: TenantSignals, excludeTenantIds: string[]): Promise<CandidateTenant[]>
/** Upsert: ON CONFLICT (tenant_id, fingerprint) DO UPDATE SET first_seen_at = LEAST(…), last_seen_at = GREATEST(…). */
export async function recordCardFingerprints(tenantId: string, sightings: CardSighting[]): Promise<void>

// ── reward inputs ──
export interface ReferrerBilling {
  tenantId: string; source: string; status: string; stripeSubscriptionId: string | null; stripeCustomerId: string | null
  currentPeriodEnd: Date; planId: string; billingInterval: string; priceCents: number; whatsappLimit: number
}
export async function getReferrerBilling(tenantId: string, exec?: DbExecutor): Promise<ReferrerBilling | null>
/** count(status='counting') of the referrer's referrals. */
export async function countCountingReferrals(referrerTenantId: string, exec?: DbExecutor): Promise<number>
export async function isReferrer(tenantId: string): Promise<boolean>     // has ≥1 referral row (any status) or ≥1 reward event
/**
 * P-18. db.transaction(async (tx) => { SET LOCAL lock_timeout = '15s';
 *   select pg_advisory_xact_lock(hashtext('referral_reward:' || referrerTenantId)); return fn(tx) }).
 * fn must do ALL its DB access through tx (one pooled connection per sync). Lock timeout → throws.
 */
export async function withReferrerRewardLock<T>(referrerTenantId: string, fn: (tx: DbExecutor) => Promise<T>): Promise<T>
/**
 * Called inside withReferrerRewardLock with its tx (no lock of its own any more): read the latest event,
 * insert only if (counting, discountPercent, bonusCredits, stripeSubscriptionId) differs. Returns the previous row.
 */
export async function recordRewardStateIfChanged(input: {
  referrerTenantId: string; counting: number; discountPercent: number; bonusCredits: number
  stripeSubscriptionId: string | null; reason: RewardEventReason; referralId: string | null
}, exec: DbExecutor): Promise<{ inserted: boolean; previous: ReferralRewardEvent | null }>
export async function listRewardEvents(referrerTenantId: string, limit?: number): Promise<ReferralRewardEvent[]>  // newest first, default 10

// ── dashboard / admin ──
export async function listReferralsForReferrer(referrerTenantId: string): Promise<Array<{
  id: string; referredName: string; capturedAt: Date; status: ReferralStatus
  pausedReason: PausedReason | null; ineligibleReason: IneligibleReason | null
}>>   // newest first; referred tenant name even if deleted
export async function getReferralAttribution(referredTenantId: string): Promise<{
  id: string; status: ReferralStatus; stripeSubscriptionId: string | null; referrerTenantId: string; referrerName: string
} | null>
export async function getTenantReferralAdminView(tenantId: string): Promise<{
  code: string | null
  referredBy: (TenantReferral & { referrerName: string }) | null
  referrals: Array<TenantReferral & { referredName: string }>
  events: ReferralRewardEvent[]
}>

// ── reconcile / webhook lookups ──
/**
 * P-23. One unit per referrer: referrers with a non-terminal referral (referralIds = those referrals),
 * plus referrers whose latest event has discount_percent > 0 or bonus_credits > 0 (referralIds may be []).
 * Ordered by min(reconciled_at) of the unit's referrals ASC NULLS FIRST (event-only units have NULL → first), then referrer id.
 */
export async function listReconcileUnits(): Promise<Array<{ referrerTenantId: string; referralIds: string[] }>>
/** UPDATE tenant_referrals SET reconciled_at = $at WHERE id = ANY($ids). Does NOT bump version (not a state write). */
export async function markReferralsReconciled(ids: string[], at: Date): Promise<void>
export async function getTenantIdByStripeCustomer(customerId: string): Promise<string | null>     // any source
export async function getTenantIdByStripeSubscription(subscriptionId: string): Promise<string | null> // any source
export async function getOwnerContact(tenantId: string): Promise<{ email: string; ownerName: string; clinicName: string } | null>
```

**Tests:** create `web/src/db/queries/__tests__/referrals.test.ts` using the existing `describeIntegration` pattern (skipped without `DATABASE_URL_TEST`); it is yours. The concurrency semantics live here, so they get integration tests even though CI skips them:
- `updateReferralState` with a stale `version` returns false after an ABA (counting → paused → counting by another writer), and succeeds with the fresh version.
- `bindReferralSubscription` twice with different ids keeps the first.
- `withReferrerRewardLock`: two concurrent calls for the same referrer run their callbacks one after the other (the second starts after the first resolves); different referrers don't block each other.
- `recordCardFingerprints` keeps the earliest `first_seen_at` and the latest `last_seen_at`.
- `listReconcileUnits` orders a never-reconciled unit before a reconciled one.
The static `no-date-in-raw-sql` test must stay green.

---

### Task B4: Stripe helpers and combined discount display

**File ownership:** `web/src/lib/stripe.ts` (modify), `web/src/lib/__tests__/stripe-checkout-winback.test.ts` (modify only where the `getSubscriptionDiscount` shape changes), `web/src/lib/__tests__/stripe-referral.test.ts` (create).

1. **`createCheckoutSession` opts** (backwards compatible):
   ```ts
   opts?: { promotionCodeId?: string | null; discountKind?: 'winback' | 'referral'; referralId?: string | null }
   ```
   - The metadata always carries `referralId` when one is given, even with no discount.
   - With a promotion code, the kind defaults to `'winback'`. The metadata flag is `winback: 'true'` or `referral: 'true'`, and the fallback report step is `${kind}_discount`.
   - The fallback to full price keeps the `referralId` metadata.
2. **New I/O helpers.** Each is a thin wrapper and is allowed to throw:
   ```ts
   /** Retrieve that maps resource_missing → 'missing' (other errors throw). expand: ['discounts.source.coupon'] (item prices come expanded by default). */
   export async function retrieveSubscriptionOrMissing(id: string): Promise<Stripe.Subscription | 'missing'>
   /** { discounts, proration_behavior: 'none' }. NO explicit idempotency key (review H6): the body is the absolute
    *  desired discount list, so a repeat is naturally idempotent, while a fixed key would replay a stale request
    *  for 20 → 40 → 20. The SDK's own per-request retry key still covers network retries. */
   export async function updateSubscriptionDiscounts(id: string, discounts: Stripe.SubscriptionUpdateParams.Discount[]): Promise<Stripe.Subscription>
   /** Open drafts of a subscription: invoices.list({ subscription, status: 'draft', limit: 5, expand: ['data.discounts.source.coupon'] }),
    *  filtered to billing_reason === 'subscription_cycle'. One page is enough (a sub has at most one open cycle draft). */
   export async function listOpenCycleDrafts(subscriptionId: string): Promise<Stripe.Invoice[]>
   export async function retrieveInvoiceWithDiscounts(id: string): Promise<Stripe.Invoice>   // expand ['discounts.source.coupon']
   /** Same rule as updateSubscriptionDiscounts: no explicit idempotency key (H6). */
   export async function updateInvoiceDiscounts(id: string, discounts: Stripe.InvoiceUpdateParams.Discount[]): Promise<Stripe.Invoice>
   export interface PaidInvoiceSummary { id: string; billingReason: string | null; amountPaid: number; paidAt: Date | null }
   /** Review H8: invoices.list({ subscription, status: 'paid', limit: 100 }).autoPagingToArray({ limit: STRIPE_LIST_CAP })
    *  (STRIPE_LIST_CAP = 1000, exported). Hitting the cap calls reportSideEffectFailure (step 'stripe_list_cap') and returns
    *  what it has. paidAt from status_transitions.paid_at; oldest first. */
   export async function listPaidSubscriptionInvoices(subscriptionId: string): Promise<PaidInvoiceSummary[]>
   /** Review H8 + P-12: charges.list({ customer, limit: 100 }).autoPagingToArray({ limit: STRIPE_LIST_CAP }) → status 'succeeded'
    *  → payment_method_details.card.fingerprint, grouped: firstSeenAt = min(created), lastSeenAt = max(created). */
   export async function listCustomerCardSightings(customerId: string): Promise<CardSighting[]>
   /** P-21: subscriptions.list({ customer, status: 'all', limit: 100 }).autoPagingToArray({ limit: STRIPE_LIST_CAP }); id with min `created`, or null. */
   export async function findEarliestSubscriptionId(customerId: string): Promise<string | null>
   export async function retrieveDisputeCustomerId(dispute: Stripe.Dispute): Promise<string | null>
   export function discountCouponOf(d: string | Stripe.Discount | Stripe.DeletedDiscount): Stripe.Coupon | null // exported version of discountCoupon
   ```
3. **Combined display** (§6.4). Extend `SubscriptionDiscount`; the existing fields keep their meaning for the billing page:
   ```ts
   export type DiscountPurpose = 'referral_reward' | 'referral_welcome' | 'winback' | 'other'
   export interface SubscriptionDiscountPart {
     couponId: string; purpose: DiscountPurpose
     percentOff: number | null; amountOffCents: number | null
     duration: 'repeating' | 'forever'; endsAt: string | null
   }
   export interface SubscriptionDiscount {
     discountedCents: number            // all active parts, in Stripe's order
     fullCents: number
     duration: 'repeating' | 'forever'  // 'repeating' if any part repeats
     endsAt: string | null              // earliest end among repeating parts
     afterEndsCents: number | null      // price once that earliest part ends (other parts still applied); null when no repeating part
     parts: SubscriptionDiscountPart[]
     referralPercent: number | null     // percent of the referral_reward part, if any
   }
   /** Sequential: for each part, amount -= percent ? round(amount × p / 100) : amountOff; clamp ≥ 0. */
   export function combineDiscounts(fullCents: number, parts: Array<Pick<SubscriptionDiscountPart, 'percentOff' | 'amountOffCents'>>): number
   ```
   - `purpose` comes from `coupon.metadata.purpose` (`referral_reward` or `referral_welcome`). The coupon id of `STRIPE_WINBACK_PROMOTION_CODE_ID` can't be cheaply known, so anything else is `'other'`, except a coupon in the old `applies_to` coupon set, which stays `'other'` too. The UI only needs `referral_reward` versus the rest.
   - The rules that skip a coupon still apply: `once`, an `applies_to` mismatch, and a non-BRL amount. The cache expiry is the minimum of the parts' `end` values.
   - `getSubscriptionDiscount` returns `null` when no part applies.

**Tests (`stripe-referral.test.ts`; mock `stripe` like `stripe-checkout-winback.test.ts`):**
- `combineDiscounts`: 9900 at 20% then 30% gives 5544 (0.8 × 0.7 × 9900 = 5544). 100% gives 0. Amount-off then percent works. Clamping keeps the result at ≥ 0.
- `getSubscriptionDiscount`:
  - With a referral 40% `forever` and a welcome 20% `repeating` ending 21/12, the result is `discountedCents = 4752`, `afterEndsCents = 5940`, `referralPercent = 40`, `endsAt` set, and two parts.
  - A `once` part is ignored.
  - A part restricted to other products is ignored.
  - An expired part (`end` ≤ now) is ignored.
- `createCheckoutSession`:
  - `discountKind: 'referral'` sets `metadata.referral = 'true'` and `metadata.referralId`.
  - A promo error falls back with the `referralId` kept, and the report step is `referral_discount`.
  - The existing winback expectations stay unchanged.
- `listPaidSubscriptionInvoices` maps and sorts, and **consumes every page** (the mocked list returns two pages through `autoPagingToArray`; the oldest invoice is on page 2 and comes back first). Hitting the cap reports.
- `listCustomerCardSightings` dedups, skips failed charges, reads all pages, and returns min/max `created` per fingerprint.
- `findEarliestSubscriptionId` picks the min `created` across pages and passes `status: 'all'`.
- `listOpenCycleDrafts` filters out non-`subscription_cycle` drafts.
- `updateSubscriptionDiscounts` / `updateInvoiceDiscounts` pass **no** `idempotencyKey` request option (H6).
- `retrieveSubscriptionOrMissing` maps resource_missing.
- In `stripe-checkout-winback.test.ts`, update only the `getSubscriptionDiscount` assertions that now carry `parts`, `afterEndsCents` and `referralPercent`, with the same numbers as before.

---

### Task B5: WhatsApp referral bonus

**File ownership:** `web/src/lib/whatsapp-credits.ts`, `web/src/db/queries/whatsapp-credits.ts`, `web/src/lib/__tests__/whatsapp-credits-bonus.test.ts` (create).

1. `lib/whatsapp-credits.ts`:
   ```ts
   /** plan + bonus; -1 stays -1 (unlimited never gets a bonus). */
   export function periodCreditsTotal(planLimit: number, bonusCredits: number): number
   ```
2. `db/queries/whatsapp-credits.ts`:
   - `CreditPeriod` gains `bonusCredits: number`. `CreditUsage` gains `bonus: number`, and `getCreditUsage` returns it.
   - `getOrCreateCurrentPeriod`:
     - On the **existing** path (review M5), the total is computed **in SQL from the stored bonus**, never from the previously read row:
       `UPDATE whatsapp_credits SET credits_total = CASE WHEN $limit = -1 THEN -1 ELSE $limit + bonus_credits END, updated_at = now() WHERE id = $id AND credits_total IS DISTINCT FROM (CASE WHEN $limit = -1 THEN -1 ELSE $limit + bonus_credits END) RETURNING credits_total, bonus_credits`.
       When a row comes back, return its values; otherwise the stored total was already right, so return `periodCreditsTotal(limit, existing.bonusCredits)` / `existing.bonusCredits`. A concurrent `raiseReferralBonus` can therefore never be undone.
     - On the **insert** path, `bonus_credits = await initialReferralBonus(tenantId)`, `bonus_source = bonus > 0 ? 'referral' : null`, and `credits_total = periodCreditsTotal(limit, bonus)`.
   - `initialReferralBonus(tenantId, now = new Date(), env = process.env)` is not exported, and it must never throw: on error it returns 0 and calls `reportSideEffectFailure`. It returns 0 unless `areReferralRewardsActive(env, now)`. Otherwise it is the `bonus_credits` of the tenant's **latest `referral_reward_events` row** (inline query on `referralRewardEvents` from A1; 0 when none). That row was written by `syncReferrerReward` and already encodes every eligibility rule (Stripe-live, monthly-only per P-19 / review H3, unlimited plan → 0), so this task duplicates no referral business rule and imports nothing from B3 (review L2). The next sync (the referrer's own `invoice.paid`, any referral change, or the 04:30 BRT cron) corrects it if the plan changed.
   - New export:
     ```ts
     /** §7: bonus only rises within a month. Ensures the current period exists, then
      *  UPDATE SET bonus_credits = GREATEST(bonus_credits, $target), bonus_source = CASE WHEN … > 0 THEN 'referral' ELSE bonus_source END,
      *  credits_total = CASE WHEN credits_total = -1 THEN -1 ELSE credits_total - bonus_credits + GREATEST(bonus_credits, $target) END
      *  `exec` is the reward lock's tx (P-18); defaults to db. */
     export async function raiseReferralBonus(tenantId: string, target: number, exec?: typeof db): Promise<{ bonusCredits: number; creditsTotal: number }>
     ```
     A `target` ≤ 0 is a no-op that returns the current values.

**Tests (`whatsapp-credits-bonus.test.ts`):**
- `periodCreditsTotal`: (300, 0) gives 300, (300, 200) gives 500, (−1, 200) gives −1, and (0, 100) gives 100.
- A mocked-db test of `getOrCreateCurrentPeriod` mirrors the chain-mock style of `app/api/webhooks/stripe/__tests__/subscription-updated.test.ts`:
  - On the existing row, the update's `credits_total` is the SQL expression over `bonus_credits` (assert the `set` argument is a `sql` fragment referencing the column, not a number computed from the read row), and the returned values come from `RETURNING`.
  - M5 interleaving: the read row has `bonusCredits: 0`, the mocked `RETURNING` yields `{ credits_total: 500, bonus_credits: 200 }` (a raise happened in between) → the period returned has total 500 and bonus 200.
  - Plan change to unlimited: `RETURNING` −1 is passed through.
  - On the insert path with an unconfigured env, the bonus is 0 and no reward-event query runs.
  - On the insert path with rewards active, the bonus is the latest event's `bonus_credits` (200), and 0 when there is no event.
  - The insert path's lookup throwing returns bonus 0 and reports.
- `raiseReferralBonus(…, 0)` issues no update; with an `exec` it uses that executor.

---

### Task B6: Referral cookie capture (web + site middleware)

**File ownership:** `web/src/lib/referral/cookie.ts`, `web/src/middleware.ts`, `web/src/lib/referral/__tests__/cookie.test.ts`, `site/src/lib/referral-cookie.ts`, `site/src/middleware.ts`, `site/src/lib/__tests__/referral-cookie.test.ts`.

The same shape in both apps (as with `first-touch.ts`). The site file imports from `@/lib/referral-rules`, the web file from `@/lib/referral/rules`.

```ts
/** Code from `?ref=` or, on the site, a `/indicacao/{CODE}` path. Normalised; null when absent/malformed. */
export function referralCodeFromUrl(url: URL): string | null
/**
 * On a GET document request (same isDocumentRequest rule as first-touch), when the switch is on
 * and the URL carries a valid code, set floraclin_ref = CODE (last link wins: overwrite always,
 * skip the write only if the stored value is identical).
 * Options: maxAge 60 days, path '/', sameSite 'lax', secure on https, httpOnly,
 * domain '.floraclin.com.br' on own hosts.
 */
export function captureReferralCode(request: NextRequest, response: NextResponse, env?: Record<string, string | undefined>): void
```

- Web switch: `isReferralEnrollmentEnabled(env)` from `@/lib/referral/config`. It's pure env reading, safe in middleware.
- Site switch: `env.REFERRAL_ENROLLMENT_ENABLED === 'true'` (P-6).
- `web/src/middleware.ts`: in the `/signup` branch, next to `captureFirstTouch`, call `captureReferralCode(req, response)`. No other change.
- `site/src/middleware.ts`: call it after `captureFirstTouch`.
- `isOwnHost` is duplicated locally in both files. **Do not** edit the `first-touch.ts` files.

**Tests (both files, same cases):**
- `?ref=meca7k` sets `MECA7K` with the right options.
- A malformed code sets nothing.
- With the switch off, nothing is set.
- A non-document request (RSC header or `sec-fetch-dest: image`) sets nothing.
- An existing cookie with a different code is overwritten (last wins); one with the same value isn't rewritten.
- `domain` is set only for `*.floraclin.com.br`.
- Site only: the path `/indicacao/ABC234` sets `ABC234`.

---

### Task B7: Site pages (public rules + referral landing)

**File ownership:**
- `site/src/app/indique/page.tsx` (create)
- `site/src/app/indicacao/[code]/page.tsx` (create)
- `site/src/components/referral-banner.tsx` (create)
- `site/src/components/home-sections.tsx` (create)
- `site/src/lib/referral-lookup.ts` (create)
- `site/src/app/page.tsx` (modify)
- `site/src/app/sitemap.ts` (modify)
- `site/src/lib/__tests__/referral-lookup.test.ts` (create)
- `site/src/components/__tests__/referral-banner.test.tsx` (create)
- `site/src/app/__tests__/indique-page.test.tsx` (create)

1. `home-sections.tsx` exports `HomeSections({ banner }: { banner?: ReactNode })`, which renders the current home body (`Navigation`, `main` with Hero…Contact, `Footer`) with `banner` placed right after `<Navigation />`. `app/page.tsx` becomes `return <HomeSections />`, with identical markup.
2. `referral-lookup.ts`:
   ```ts
   export const APP_ORIGIN_DEFAULT = 'https://app.floraclin.com.br'
   /** fetch(`${origin}/api/referral/codes/${code}`, { next: { revalidate: 300 } }); any failure → { active: false }. */
   export async function lookupReferralCode(code: string, opts?: { origin?: string; fetchImpl?: typeof fetch }): Promise<{ active: true; clinicName: string } | { active: false }>
   ```
   The origin comes from `process.env.FLORACLIN_APP_ORIGIN || APP_ORIGIN_DEFAULT`. The code is normalised first, and a malformed code returns inactive without calling fetch.
3. `/indicacao/[code]/page.tsx` (Next 15: `params: Promise<{ code: string }>`):
   - `metadata.robots = { index: false, follow: true }`.
   - When the site switch is on and the lookup says active, it renders `HomeSections` with `<ReferralBanner clinicName code />`. Otherwise it renders plain `HomeSections`.
4. `ReferralBanner` copy (exact): "**{shortClinicName(clinicName)}** indicou o FloraClin para você: 14 dias grátis + 20% de desconto nos 2 primeiros meses."
   - Build the numbers from the rules constants: `REFERRAL_TRIAL_DAYS`, `REFERRAL_WELCOME_PERCENT` and `REFERRAL_WELCOME_MONTHS`.
   - CTA "Começar teste grátis" → `https://app.floraclin.com.br/signup?ref={CODE}`, sharing the base with `SIGNUP_URL`.
   - Style: a sage band in the site palette.
5. `/indique/page.tsx`: the public rules page, laid out like `/termos`, with `notFound()` unless the site switch is on or `REFERRAL_REWARDS_END_AT` is set (P-5).
   - Title "Indique e Ganhe FloraClin — Regras".
   - All numbers come from `referral-rules`.
   - Sections (pt-BR):
     1. The one-sentence rule: "Cada clínica indicada que está pagando vale 20% de desconto na sua assinatura. Com 5, o FloraClin sai de graça."
     2. **Quem pode indicar**: clinics with an active paid FloraClin subscription (paid by card through our payment system). Clinics on a free trial, on a courtesy plan or with an ended subscription have no active link. Valid for monthly plans.
     3. **O que a clínica indicada ganha**: the normal 14-day trial plus 20% off the first 2 paid monthly fees, applied automatically through the link. It doesn't stack with other entry offers; the better one applies.
     4. **Como o desconto é calculado**: a 5-row table (1 → 20%, …, 5 → 100% "grátis") plus "6 ou mais: 100% + 100 créditos de WhatsApp por mês para cada clínica além da 5ª" (the bonus month is the calendar month in Brasília time; unlimited plans don't get it).
     5. **Quando uma indicação conta**: from the referred clinic's 2nd paid monthly fee. It pauses while a payment is pending or a cancellation is scheduled, and stops counting when the subscription is canceled. A clinic that cancels and comes back doesn't count again. A discount change takes effect on the **next** invoice, never prorated. Discounts already applied are never taken back.
     6. **Quem não conta**: only clinics new to FloraClin (no use in the 6 months before signup, by email, phone, professional registry or card). No self-referral (same clinic or professional, email, company domain, phone, registry, user or card). Payment disputes (chargebacks) make the referral ineligible.
     7. **Sem dinheiro**: rewards are only a discount on the clinic's own FloraClin subscription and WhatsApp credits. No cash, Pix, credit or transfer, and they're lost without a subscription.
     8. **Como divulgar**: always identify the benefit with **#publi #linkafiliado** (CONAR). No before-and-after photos, patient images, promises of results or superlatives. It's a recommendation of a management tool to colleagues.
     9. **Encerramento do programa** (settled decision 1, exact meaning): "Se a FloraClin decidir encerrar o programa, avisaremos com pelo menos 30 dias de antecedência. A partir do aviso, novas indicações deixam de ser aceitas. Os descontos existentes continuam seguindo a contagem até a data de encerramento e passam a 0% a partir da fatura seguinte. Descontos já aplicados em faturas emitidas nunca são cobrados de volta."
     10. "Última atualização: 21 de outubro de 2026."
   - When `REFERRAL_REWARDS_END_AT` is set, a notice at the top: "O programa será encerrado em {dd/MM/yyyy}." Format it in `America/Sao_Paulo` with `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' })`.
6. `sitemap.ts`: add `/indique` only when the page is published (same condition). Leave the footer unchanged, because `footer.test.tsx` and a public link before launch are both reasons to wait. The in-app page and the banner link to the rules page.

**Tests:**
- `referral-lookup`:
  - A malformed code never fetches.
  - A 200 active response maps; a 200 inactive one maps.
  - A non-200 response, a thrown fetch and a JSON shape error all give inactive.
  - It uses `FLORACLIN_APP_ORIGIN`.
- `referral-banner`: the exact copy, the CTA href carrying `?ref=CODE`, and a long name being shortened.
- `indique-page`:
  - With the switch off and no end date, it calls `notFound`.
  - With the switch on, it renders the table with 20/40/60/80/100 and the ending section text.
  - With an end date, it shows the notice.

---

### Task B8: Coupon setup script, env docs

**File ownership:** `web/src/lib/referral/coupon-setup.ts`, `web/src/lib/referral/__tests__/coupon-setup.test.ts`, `web/scripts/create-referral-coupons.ts`, `web/package.json` (scripts entry only), `web/.env.example`.

```ts
export const WELCOME_COUPON_ID = 'floraclin_referral_new_20x2'
export const WELCOME_PROMOTION_CODE = 'INDICA20'          // never typed by clinics; Stripe requires a code string
export const REFERRER_COUPON_IDS = ['floraclin_referrer_20', 'floraclin_referrer_40', 'floraclin_referrer_60', 'floraclin_referrer_80', 'floraclin_referrer_100'] as const

export interface CouponSpec { id: string; percent_off: number; duration: 'repeating' | 'forever'; duration_in_months?: number; name: string; metadata: Record<string, string> }
export function couponSpecs(): CouponSpec[]
// welcome: 20%, repeating, 2 months, name 'Indicação: 20% nos 2 primeiros meses', metadata { purpose: 'referral_welcome', app: 'floraclin' }
// referrer N: N%, forever, name `Indique e Ganhe: ${N}%`, metadata { purpose: 'referral_reward', app: 'floraclin', percent: String(N) }
// NO applies_to on any of them (doc §6.1).

export type KeyMode = 'test' | 'live'
export function keyMode(secretKey: string): KeyMode            // sk_live_/rk_live_ → live; sk_test_/rk_test_ → test; else throw
/** Throws unless allowed: live needs `--live` in argv AND no CI / VERCEL / GITHUB_ACTIONS env. */
export function assertRunAllowed(mode: KeyMode, argv: string[], env: Record<string, string | undefined>): void

export interface CouponSetupDeps {
  retrieveCoupon(id: string): Promise<Stripe.Coupon | null>          // null on resource_missing
  createCoupon(spec: CouponSpec): Promise<Stripe.Coupon>
  findPromotionCode(couponId: string, code: string): Promise<Stripe.PromotionCode | null>  // active, same coupon
  createPromotionCode(params: { couponId: string; code: string }): Promise<Stripe.PromotionCode>
  // promotion: { type: 'coupon', coupon }, code, restrictions: { first_time_transaction: true }, metadata { purpose: 'referral_welcome', app: 'floraclin' }
  log(line: string): void
}
/** Idempotent: existing coupons are verified (percent/duration/months match, else throw "coupon X exists with different terms"), missing ones created. Returns the env lines to set. */
export async function setupReferralCoupons(deps: CouponSetupDeps): Promise<{ promotionCodeId: string; referrerCouponIds: string[]; envLines: string[] }>
```

- `web/scripts/create-referral-coupons.ts` is a thin CLI. It reads `STRIPE_SECRET_KEY`, calls `assertRunAllowed(keyMode(key), process.argv, process.env)`, builds the deps from `new Stripe(key)` and prints the env lines:
  ```
  STRIPE_REFERRAL_PROMOTION_CODE_ID=promo_…
  STRIPE_REFERRER_COUPON_IDS=floraclin_referrer_20,floraclin_referrer_40,floraclin_referrer_60,floraclin_referrer_80,floraclin_referrer_100
  ```
  In live mode it prints a banner reading "LIVE MODE — account …" (from `stripe.accounts.retrieve()`) and waits 5 s before writing.
- `web/package.json` gets the script `"referral:create-coupons": "pnpm exec dotenv -e .env.local -- tsx scripts/create-referral-coupons.ts"`. It is never referenced by CI or vercel.
- `web/.env.example` gets a "Referral program" block with a comment for each var:
  - `REFERRAL_ENROLLMENT_ENABLED=` (off unless `true`)
  - `STRIPE_REFERRAL_PROMOTION_CODE_ID=`
  - `STRIPE_REFERRER_COUPON_IDS=` (exactly 5 ids, ascending)
  - `REFERRAL_REWARDS_END_AT=` (full ISO with offset; only to end the program; announce 30 days earlier)

**Tests:**
- `keyMode` handles all four prefixes and throws on garbage.
- `assertRunAllowed`:
  - Test mode is always allowed.
  - Live mode without `--live` throws.
  - Live mode with `--live` and `CI=true` throws, as it does with `VERCEL=1`.
  - Live mode with `--live` and a clean env passes.
- `couponSpecs` matches the terms above, with no `applies_to` key anywhere.
- `setupReferralCoupons`:
  - Creates the missing coupons and skips the existing matching ones.
  - Throws on an existing coupon with different terms.
  - Reuses an existing promo code.
  - Creates the promo with `first_time_transaction: true`.
  - Returns the env lines in order.

---

## Group C: orchestration (5 tasks, parallel; depend on A and B)

### Task C1: `syncReferrerReward` + reward emails

**File ownership:** `web/src/lib/referral/reward.ts`, `web/src/lib/referral/emails.ts`, `web/src/lib/referral/__tests__/reward.test.ts`, `web/src/lib/referral/__tests__/emails.test.ts`.

```ts
export interface RewardDeps {
  now(): Date
  env: Record<string, string | undefined>
  /** B3 withReferrerRewardLock. The whole sync body runs inside it (P-18, review H1). */
  withLock<T>(referrerTenantId: string, fn: (tx: DbExecutor) => Promise<T>): Promise<T>
  countCounting(referrerTenantId: string, tx: DbExecutor): Promise<number>                        // B3 countCountingReferrals
  getBilling(tenantId: string, tx: DbExecutor): Promise<ReferrerBilling | null>                   // B3 getReferrerBilling
  retrieveSubscription(subId: string): Promise<Stripe.Subscription | 'missing'>                   // B4 retrieveSubscriptionOrMissing
  updateSubscriptionDiscounts(subId: string, discounts: Stripe.SubscriptionUpdateParams.Discount[]): Promise<unknown>   // B4, no idempotency key (H6)
  listOpenDrafts(subId: string): Promise<Stripe.Invoice[]>                                        // B4 listOpenCycleDrafts
  retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice>                                     // B4 retrieveInvoiceWithDiscounts
  updateInvoiceDiscounts(invoiceId: string, discounts: Stripe.InvoiceUpdateParams.Discount[]): Promise<unknown>         // B4, no idempotency key (H6)
  raiseBonus(tenantId: string, target: number, tx: DbExecutor): Promise<{ bonusCredits: number }> // B5 raiseReferralBonus
  recordState(input: Parameters<typeof recordRewardStateIfChanged>[0], tx: DbExecutor): ReturnType<typeof recordRewardStateIfChanged>
  notify(input: RewardEmailInput): Promise<void>                                                  // emails.ts sendReferralRewardEmail
  getReferral(id: string): Promise<{ id: string; referredName: string; status: ReferralStatus } | null>  // B3 getReferralSummary (after the lock)
  report: typeof reportSideEffectFailure
}

export interface SyncTrigger {
  reason: RewardEventReason
  referralId?: string | null
  /** invoice.created (D1): this draft is repaired even if the draft list hasn't caught up yet. */
  draftInvoiceId?: string | null
}
export type RewardSyncResult =
  | { skipped: 'not_configured' }
  | { skipped?: undefined; counting: number; targetPercent: ReferralPercent; targetCouponId: string | null
      updatable: boolean; eligible: boolean
      stripeUpdated: boolean; draftsUpdated: string[]; bonusTarget: number; eventRecorded: boolean; subscriptionId: string | null }

export async function syncReferrerReward(referrerTenantId: string, trigger: SyncTrigger, deps?: Partial<RewardDeps>): Promise<RewardSyncResult>

/** Pure: keep every discount we don't own (as { discount: id }), replace/remove ours. */
export function planReferralDiscounts(
  current: Array<string | Stripe.Discount | Stripe.DeletedDiscount>,
  targetCouponId: string | null,
  ids: ReferrerCouponIds,
): { changed: boolean; discounts: Array<{ discount: string } | { coupon: string }>; currentReferralCouponId: string | null }

/** Pure (P-20, review H4): the percent a given invoice instant is entitled to. */
export function percentAt(at: Date, input: { eligible: boolean; counting: number }, env: Record<string, string | undefined>): ReferralPercent
// = areReferralRewardsActive(env, at) && eligible ? referralDiscountPercent(counting) : 0
```

There is no separate `fixDraftInvoiceDiscount` export any more: draft repair is part of every sync (review H5), under the same lock.

`syncReferrerReward` steps (doc §6.3, settled decision 1, P-18 – P-20):

1. `ids = referrerCouponIds(env)`. If it is `null`, return `{ skipped: 'not_configured' }` (no lock taken). **Do not** read `REFERRAL_ENROLLMENT_ENABLED`.
2. Everything below runs inside `withLock(referrerTenantId, async (tx) => …)`. Every DB call passes `tx`. Stripe errors and DB errors **throw** out of the lock (the transaction rolls back, the webhook returns 500, Stripe retries).
3. `counting = countCounting(id, tx)`, `billing = getBilling(id, tx)`. These are read **after** the lock is held, so they include every status change committed before it.
4. `sub = billing?.stripeSubscriptionId ? retrieveSubscription(billing.stripeSubscriptionId) : null` (any `source`: a gift row over a lingering Stripe sub must also lose our coupon). `{ updatable, eligible } = referrerSubscriptionState(sub, billing?.source)` from A2 (P-19). Liveness and monthly come from **Stripe**, never from local `current_period_end` (review H2) or the local plan (review H3).
5. `now = deps.now()`. `targetPercent = percentAt(now, { eligible, counting }, env)` and `targetCouponId = couponIdForPercent(targetPercent, ids)`. After `REFERRAL_REWARDS_END_AT` this is 0, so the subscription stops carrying our coupon from the next invoice.
6. If `updatable` (whether or not `eligible`: an ineligible live sub, e.g. yearly, gets target 0, which **removes** our coupon, review H3):
   - `plan = planReferralDiscounts(sub.discounts, targetCouponId, ids)`. If `plan.changed`, `updateSubscriptionDiscounts(sub.id, plan.discounts)`. Stripe applies it from the next invoice, with no proration.
   - **Open drafts (review H5):** `drafts = listOpenDrafts(sub.id)`, plus `retrieveInvoice(trigger.draftInvoiceId)` when given and not in the list. For each draft with `status === 'draft'`, `billing_reason === 'subscription_cycle'` and `subscription === sub.id`:
     - `draftPercent = percentAt(new Date(draft.created * 1000), { eligible, counting }, env)` (P-20: a draft created before the end instant keeps the count-based percent even when processed after it, review H4).
     - `dplan = planReferralDiscounts(draft.discounts, couponIdForPercent(draftPercent, ids), ids)`; if changed, `updateInvoiceDiscounts(draft.id, dplan.discounts)`.
     - A Stripe error saying the invoice is no longer editable (finalized meanwhile) is swallowed and reported (`report(err, { area: 'referral', step: 'draft_not_editable' })`); any other error throws.
   - No explicit idempotency keys on either update (review H6): each call sends the absolute desired list, so a replay or a 20 → 40 → 20 sequence always converges on the latest target.
7. `bonusTarget = eligible && areReferralRewardsActive(env, now) ? referralBonusCredits(counting, billing.whatsappLimit) : 0`. If `bonusTarget > 0`, `raiseBonus(id, bonusTarget, tx)`; it only rises within the month.
8. `recorded = recordState({ referrerTenantId: id, counting, discountPercent: targetPercent, bonusCredits: bonusTarget, stripeSubscriptionId: updatable ? sub.id : null, reason: trigger.reason, referralId: trigger.referralId ?? null }, tx)`.
9. The lock is released (transaction commits). **Then**, if `recorded.inserted` and the previous row's percent or bonus differs (or there was no previous row and either value > 0), load `getReferral(trigger.referralId)` when given and call `notify(...)`. A notification failure is reported, not thrown.

**Tests (`reward.test.ts`; every dep is a `vi.fn`; `withLock` defaults to `(id, fn) => fn(fakeTx)`):**
- Not configured: returns `skipped`, `withLock` is not called, and no other dep is called.
- 2 counting, Stripe sub `active` monthly with no discounts: the update is called with `[{ coupon: id40 }]` and **no third argument**. An event is recorded and notify is called after `withLock` resolved.
- Every DB dep (`countCounting`, `getBilling`, `raiseBonus`, `recordState`) receives the `tx` passed by `withLock`.
- Already holding id40: no update call (`changed=false`), the event isn't inserted (the mocked `recordState` returns `inserted:false`), and there's no notify.
- Keeps foreign discounts: the subscription has VOLTA30 `di_w` plus id20, the target is 60, and the update gets `[{ discount: 'di_w' }, { coupon: id60 }]` with the order preserved and ours last.
- 0 counting while holding id40: the update gets the foreign discounts only (`[]` when there are none).
- 7 counting: target 100, bonus 200, so `raiseBonus(…, 200, tx)` is called.
- Unlimited plan (`whatsappLimit -1`): the bonus is 0 and `raiseBonus` isn't called.
- **H2 renewal:** local billing row has `currentPeriodEnd` in the past (renewal webhook not processed yet), Stripe sub `active` monthly, 2 counting → target 40, the coupon is kept, and an open draft carrying id40 is **not** touched.
- **H3 monthly → yearly:** Stripe sub `active` with a **yearly** price, holding id40, 2 counting → the update removes our coupon (`[]`), an open draft carrying id40 is rewritten without it, and the event is recorded with 0 and the sub id. (This replaces the old "yearly: no Stripe call" expectation, which asserted the bug.)
- Gift row over a live Stripe sub holding id20 → coupon removed. Local `stripe` + `expired` with Stripe `canceled` → no Stripe update, event recorded with 0 and `stripeSubscriptionId: null`. Stripe `'missing'` → same.
- **H4 program end:** `REFERRAL_REWARDS_END_AT` = T. Sync runs at T+1h with 2 counting: the subscription update removes our coupon; an open draft with `created` = T−10min carrying id40 is **left as is**; another draft with `created` = T+5min carrying id40 is rewritten without it. No bonus.
- **H5 change during the draft window:** the draft already carries id20; sync runs because a second referral started counting (reason `referral_counting`, no `draftInvoiceId`) → `listOpenDrafts` finds it and `updateInvoiceDiscounts(draft, [{ coupon: id40 }])` is called.
- `trigger.draftInvoiceId` not present in `listOpenDrafts` → retrieved and repaired. A non-cycle or non-draft invoice is ignored. A "not editable" error is swallowed and reported; another Stripe error rejects.
- **H6 20 → 40 → 20:** three consecutive syncs (counting 1, 2, 1) issue three subscription updates `[id20]`, `[id40]`, `[id20]`, none carrying an idempotency key.
- **H1 interleaving:** `withLock` is a real in-memory per-referrer mutex. Sync A starts with `countCounting` → 2 and its `updateSubscriptionDiscounts` held on a deferred promise; sync B is started while A is blocked (its `countCounting` would return 3). Assert B's `countCounting` is not called until A's update resolves and A's `recordState` ran, and that the last update applied is `[{ coupon: id60 }]` (the stale 40% can never land after 60%). Then the reversed order: B first, A second → final update still reflects the count read last.
- `updateSubscriptionDiscounts` throws: `syncReferrerReward` rejects, `recordState` isn't called, `notify` isn't called.
- notify throws: the sync resolves and the failure is reported.
- **Enrollment switch off but coupons configured: the sync still runs** (asserts the doc's "two switches").
- `planReferralDiscounts`: string ids are kept as `{discount}`, a deleted discount is dropped, a discount whose coupon has `purpose: referral_reward` but an unknown id is recognised as ours and replaced, and an unchanged target gives `changed=false`.
- `percentAt`: before/after the end instant, ineligible → 0.

**`emails.ts`:**

```ts
export interface RewardEmailInput {
  referrerTenantId: string
  previous: { discountPercent: number; bonusCredits: number } | null
  current: { discountPercent: number; bonusCredits: number; counting: number }
  referral: { referredName: string; nowCounting: boolean } | null   // null for reconcile/admin/subscription triggers
}
/** Pure. Null when nothing user-visible changed. */
export function referralRewardEmailContent(input: RewardEmailInput, appUrl: string): { subject: string; content: EmailContent } | null
export async function sendReferralRewardEmail(input: RewardEmailInput, deps?: { owner: typeof getOwnerContact; send: typeof sendLifecycleEmail; appUrl: () => string }): Promise<void>
```

Copy (exact where the doc gives it):
- A referral starts counting and the percent rose: subject "Indique e Ganhe: sua indicação começou a contar". Paragraph: "Sua indicação {clínica} começou a contar: seu desconto agora é de {p}% a partir da próxima fatura."
- A referral stopped counting: subject "Indique e Ganhe: seu desconto mudou". Paragraph: "Sua indicação {clínica} deixou de contar: seu desconto agora é de {p}% a partir da próxima fatura." At p = 0 the paragraph is "Sua indicação {clínica} deixou de contar: a partir da próxima fatura, sua assinatura não tem mais desconto de indicação."
- A bonus-only rise (counting > 5): "Sua indicação {clínica} começou a contar: você ganha +{bonus} créditos de WhatsApp por mês."
- No referral context: "Seu desconto de indicação agora é de {p}% a partir da próxima fatura."
- Button "Ver minhas indicações" → `${appUrl}/configuracoes?tab=indique`.

**`emails.test.ts`:** each branch's exact text, null when nothing changed, and that `sendReferralRewardEmail` skips silently when there is no owner contact.

---

### Task C2: Referral lifecycle (refresh, chargeback, fingerprints)

**File ownership:** `web/src/lib/referral/lifecycle.ts`, `web/src/lib/referral/__tests__/lifecycle.test.ts`, `web/scripts/backfill-card-fingerprints.ts`, and `web/package.json`, but only to add the line `"referral:backfill-fingerprints": "pnpm exec dotenv -e .env.local -- tsx scripts/backfill-card-fingerprints.ts"`. B8 touches `package.json` in Group B and C2 runs after it. C2 is the only Group C task that touches `web/package.json`.

```ts
export interface LifecycleDeps {
  now(): Date
  getContext(referralId: string): Promise<ReferralContext | null>                     // B3
  retrieveSubscription(id: string): Promise<Stripe.Subscription | 'missing'>         // B4 retrieveSubscriptionOrMissing
  listPaidInvoices(subscriptionId: string): Promise<PaidInvoiceSummary[]>             // B4 (fully paginated, H8)
  listCardSightings(customerId: string): Promise<CardSighting[]>                      // B4 listCustomerCardSightings
  findEarliestSubscription(customerId: string): Promise<string | null>                // B4 findEarliestSubscriptionId (P-21)
  bindSubscription(referralId: string, subId: string): Promise<string | null>         // B3 bindReferralSubscription (P-21)
  recordCardFingerprints(tenantId: string, sightings: CardSighting[]): Promise<void>  // B3
  loadSignals(tenantId: string): Promise<TenantSignals>                               // B3
  loadCandidates(referred: TenantSignals, exclude: string[]): Promise<CandidateTenant[]> // B3
  runChecks: typeof runEligibilityChecks                                              // B2 (called with loadSignals/loadCandidates above)
  saveState(id: string, expectedVersion: number, next: ReferralState, checks?: ReferralChecks): Promise<boolean> // B3 updateReferralState (P-22)
  findByReferredTenant(tenantId: string): Promise<TenantReferral | null>             // B3
  markIneligible(id: string, reason: IneligibleReason, note?: string, checks?: ReferralChecks): Promise<TenantReferral | null> // B3
}

export interface RefreshResult {
  referralId: string; referrerTenantId: string
  previous: ReferralStatus; next: ReferralStatus; changed: boolean
  rewardReason: RewardEventReason | null   // what D1 passes to syncReferrerReward
}
export async function refreshReferral(referralId: string, deps?: Partial<LifecycleDeps>): Promise<RefreshResult | null>
export async function markReferralChargeback(referredTenantId: string, deps?: Partial<LifecycleDeps>): Promise<RefreshResult | null>
export async function recordTenantCardFingerprints(tenantId: string, customerId: string, deps?: Partial<LifecycleDeps>): Promise<void>
/** Pure: snapshot from Stripe objects. */
export function buildStripeSnapshotPart(sub: Stripe.Subscription | 'missing', subscriptionId: string, invoices: PaidInvoiceSummary[]): NonNullable<ReferredSnapshot['stripe']>
/** Pure: status change → reward-event reason (null when the change can't move the count). */
export function rewardReasonFor(previous: ReferralStatus, next: ReferralStatus): RewardEventReason | null
```

`refreshReferral` steps:

1. Load the context. Return null when it is missing. A terminal status returns `changed:false` with no Stripe calls (chargeback is handled separately). Remember `referral.version` for step 6.
2. **Subscription binding (P-21, review M4).** `subId = referral.stripeSubscriptionId`. When it is null and `referredSub?.stripeCustomerId` is set: `earliest = findEarliestSubscription(customerId)`; if found, `subId = bindSubscription(id, earliest)` (atomic "set only if null"; the returned value wins, so a concurrent checkout binding is respected), then reload the context so `version` is current. **Never** fall back to `referredSub.stripeSubscriptionId` (the tenant row is overwritten on resubscribe).
3. `localTrialEnded` is true when there is no `subId` and `effectiveSubscriptionStatus(referredSub, now) === 'expired'` (from `@/lib/subscription-access`).
4. With a `subId`: retrieve the subscription and list its paid invoices (all pages, H8), then call `buildStripeSnapshotPart`.
   - `monthly` is `stripeSubscriptionIsMonthly(sub)` (A2), so C1 and C2 share one definition.
   - `firstPaidAt` is the earliest `paidAt`.
   - `qualifyingInvoice` is the earliest invoice with `billingReason === 'subscription_cycle'` and `amountPaid > 0`.
5. **Qualification re-check.** This runs when `prev.qualifiedAt == null` and the snapshot has a qualifying invoice, and only then, to keep it cheap:
   - Fetch the card sightings of the referred clinic's customer and the referrer's customer, and record both.
   - `res = runChecks({ referredTenantId, referrerTenantId, referredSignupAt, stage: 'qualification' }, { loadSignals, loadCandidates })`: self-referral on all six signals, not-new on **cards only** against the card-sighting window (P-12, review M3). Owner-email/phone/registry not-new is **not** re-evaluated here; the attribution snapshot (`checks.atSignup`) and the checkout re-check (`checks.atCheckout`) stand.
   - Put `res.verdict` in `snap.ineligible` and store `checks.atQualification`.
6. Compute `next = computeReferralStatus(prev, snap)`. If it differs from prev (deep compare of the `ReferralState` fields), `saveState(id, referral.version, next, checks)` (P-22: compares `version`, so an ABA by another writer is detected, review M1). If that returns false (a concurrent writer), re-run once from step 1 with a fresh context; if the retry also loses, return the latest stored status with `changed: false` (the other writer's own sync covers it).
7. Return the result with `rewardReason = rewardReasonFor(prev.status, next.status)`:
   - Anything to `counting` gives `referral_counting`.
   - `counting` to `paused` or `first_paid` gives `referral_paused`.
   - `counting` or `paused` to `canceled` or `ineligible` gives `referral_canceled`.
   - Everything else gives null. The caller still syncs, because a sync is cheap and idempotent.

`markReferralChargeback`: find the referral by referred tenant and `markIneligible(id, 'chargeback')`. It returns a result with `next: 'ineligible'` and `rewardReason: 'referral_canceled'` when the previous status was `counting` or `paused`.

`web/scripts/backfill-card-fingerprints.ts`:
- For every `tenant_subscriptions` row with a `stripe_customer_id`, call `listCustomerCardSightings` (all pages) and then `recordCardFingerprints`, so `first_seen_at` / `last_seen_at` are the real charge times, not the backfill time.
- Read-only on Stripe. Sequential, logs progress, and supports `--dry-run`.

**Tests (`lifecycle.test.ts`; all deps mocked):**
- No sub, trial row expired: saved as `trial_ended`. A second run saves nothing (idempotent).
- A sub with one paid `subscription_create` invoice: `first_paid`, with `stripe_subscription_id` stamped.
- A second invoice `subscription_cycle`, paid, `amount_paid > 0`, with clean signals: `counting`, and `rewardReason` is `referral_counting`. The fingerprints are recorded for both customers.
- Same, but the referrer shares a card fingerprint: `ineligible/self_referral`, with `checks.atQualification.selfReferral` containing `card`.
- A cycle invoice with `amount_paid = 0` doesn't qualify.
- A `subscription_update` (proration) paid invoice doesn't qualify.
- Stripe `missing`: `canceled`.
- Counting and Stripe `past_due`: `paused/past_due`, with `rewardReason` `referral_paused`.
- `saveState` is called with the context's `version`. It returns false once (another writer bumped the version, e.g. counting → paused → counting): the retry reloads the context and saves with the **new** version. Two losses in a row → no third attempt, `changed: false`.
- **H8:** a `counting` referral with persisted `firstPaidAt`/`qualifiedAt`, `listPaidInvoices` returning `[]`, Stripe `past_due` → saved as `paused/past_due`.
- **M4 binding:** referral with no sub id, tenant row's current sub is `sub_2`, the customer's earliest sub is `sub_1` (canceled): `bindSubscription(id, 'sub_1')` is called, the snapshot uses `sub_1`, and the result is `canceled` (a returning clinic never counts). `bindSubscription` returning an already-bound `sub_0` → `sub_0` is used. No customer → no binding, `trial`/`trial_ended` logic.
- **M3:** at qualification `runChecks` is called with `stage: 'qualification'`; a phone shared with a third tenant (not the referrer) does **not** make it ineligible; a card of the referred customer seen on a third tenant 2 months before signup gives `ineligible/not_new`.
- A terminal status makes no Stripe call.
- `markReferralChargeback` on a counting referral returns `referral_canceled`.
- `buildStripeSnapshotPart` and `rewardReasonFor` table tests.

---

### Task C3: Referral offer + checkout coupon choice

**File ownership:** `web/src/lib/referral/offer.ts`, `web/src/lib/referral/__tests__/offer.test.ts`, `web/src/app/api/billing/checkout/route.ts`, `web/src/app/api/billing/__tests__/checkout.test.ts`.

```ts
export interface ReferralOfferRow {
  tenantId: string; source?: string | null; firstPaidAt?: Date | string | null
  stripeSubscriptionId?: string | null; stripeCustomerId?: string | null
}
export interface ReferralOfferPlan { slug: string; name: string; priceCents: number; billingInterval: string; stripePriceId: string | null }
// offer.ts is SERVER-ONLY (DB + Stripe). The client-safe pieces live in A2's offer-copy.ts (review H7):
import type { PublicReferralOffer } from './offer-copy'
export interface ValidatedReferralOffer extends PublicReferralOffer {
  promotionCodeId: string; referralId: string
  // label: winbackOfferLabel(terms) → "20% de desconto nos 2 primeiros meses"; planSlugs: monthly plans with a Stripe price
}
type Attribution = Awaited<ReturnType<typeof getReferralAttribution>>
export interface ReferralOfferDeps {
  attribution(tenantId: string): Promise<Attribution>                                  // B3 getReferralAttribution
  signupAt(tenantId: string): Promise<Date>                                           // tenants.created_at (inline query)
  runChecks: typeof runEligibilityChecks                                              // B2
  loadSignals: typeof loadTenantSignals; loadCandidates: typeof loadCandidateTenants  // B3, passed to runChecks
  markIneligible: typeof markReferralIneligible                                       // B3
  check: (promotionCodeId: string, now: Date) => Promise<PromotionCodeTerms | null>   // checkPromotionCode
  priorPurchase: (customerId: string, now: Date) => Promise<boolean>                  // customerHasPriorPurchase
  report: typeof reportSideEffectFailure
}
/** `opts.attribution`: a pre-fetched result (checkout route, M8) so the attribution is read once. */
export async function getValidatedReferralOffer(row: ReferralOfferRow | null | undefined, plans: ReferralOfferPlan[], now?: Date, env?: Record<string, string | undefined>, deps?: Partial<ReferralOfferDeps>, opts?: { attribution?: Attribution }): Promise<ValidatedReferralOffer | null>
export function publicReferralOffer(o: ValidatedReferralOffer | null): PublicReferralOffer | null

export type CheckoutDiscountChoice =
  | { kind: 'winback'; promotionCodeId: string }
  | { kind: 'referral'; promotionCodeId: string }
  | { kind: null; promotionCodeId: null }
/** §6.2: exactly one coupon; VOLTA30 wins. */
export function chooseCheckoutDiscount(winback: { promotionCodeId: string } | null, referral: { promotionCodeId: string } | null): CheckoutDiscountChoice
```

`getValidatedReferralOffer` returns null unless **all** of these hold, checked in order with the cheapest first:
1. `isReferralEnrollmentEnabled(env, now)`.
2. A row with a tenantId, `!firstPaidAt` and `!stripeSubscriptionId`.
3. An attribution (`opts.attribution` when provided, else `attribution(tenantId)`) with status `trial` or `trial_ended` and no `stripeSubscriptionId`. This excludes self-referral and not-new cases already found (`ineligible`) and attributions already used.
4. At least one plan that is monthly and has a `stripePriceId`.
5. **Identity re-check (review M2).** `res = runChecks({ referredTenantId, referrerTenantId, referredSignupAt: signupAt(tenantId), stage: 'checkout' }, { loadSignals, loadCandidates })`: the same non-card self-referral and not-new identity rules as at attribution (a phone, owner, or registry added during the trial is caught here). If `res.verdict` is set: `markIneligible(attribution.id, res.verdict, undefined, { atCheckout: res })` and return null (no coupon, and later calls stop at step 3). A loader error is **reported** and returns null (fail closed: no welcome coupon, checkout continues at full price).
6. `terms = check(promoId)` is not null.
7. `terms.productIds === null`. Otherwise call `report(…, step 'referral_promo_misconfigured')` and return null (P-8).
8. If `terms.firstTimeTransaction` and the row has a `stripeCustomerId`, then `!priorPurchase(customerId)`.

The headline comes from `referralOfferHeadline` in `offer-copy.ts` (A2); `offer.ts` does not define or re-export it, so no client module has a reason to import `offer.ts`.

**Checkout route** (`app/api/billing/checkout/route.ts`), new-subscription branch only:

```ts
// Review M8: with the switch off, no referral DB call happens at all; when on, the attribution is read once.
const referralOn = isReferralEnrollmentEnabled()
const attribution = referralOn ? await getReferralAttribution(ctx.tenantId) : null
const winback = await getValidatedWinbackOffer(subscription, [plan])
const referral = winback || !attribution
  ? null
  : await getValidatedReferralOffer(subscription ?? null, [plan], undefined, undefined, undefined, { attribution })
const choice = chooseCheckoutDiscount(winback, referral)
const { url } = await createCheckoutSession(ctx.tenantId, planSlug, subscription?.stripeCustomerId ?? null, {
  promotionCodeId: choice.promotionCodeId,
  discountKind: choice.kind ?? undefined,
  referralId: attribution?.id ?? null,
})
```

The plan-switch branch is unchanged. It never applies a welcome coupon, because the clinic is already paying.

**Tests:**
- `offer.test.ts` (the `deps()` factory mirrors `winback-offer.test.ts`):
  - The happy path gives the label "20% de desconto nos 2 primeiros meses", `referrerName` "Clínica Bela", and planSlugs for monthly plans only; `runChecks` was called with `stage: 'checkout'`.
  - The switch being off makes no dep call.
  - **M2:** the referred clinic added the referrer's phone during the trial → `runChecks` returns `self_referral` → `markIneligible(id, 'self_referral', undefined, { atCheckout })` is called and the result is null; `check` (Stripe) is not called. Same for a `not_new` verdict.
  - `runChecks` throwing → null and reported; `markIneligible` not called.
  - `opts.attribution` given → `attribution` dep not called.
  - A row that already paid gives null. So does one with a sub id.
  - An attribution that is ineligible, canceled, or already has a sub id gives null.
  - Only yearly plans gives null.
  - An unusable promo gives null.
  - `productIds` set gives null and reports.
  - `firstTimeTransaction` with a customer that purchased before gives null. Without a customer, `priorPurchase` isn't called.
  - `chooseCheckoutDiscount`: winback alone, referral alone, both (winback wins), neither.
- `checkout.test.ts`: keep all existing cases. Add `vi.mock('@/db/queries/referrals', …)` and `vi.mock('@/lib/referral/offer', async (orig) => …)` as needed, and stub the env for the switch. New cases:
  - A referred clinic eligible for winback gets the winback code with `discountKind 'winback'` and `referralId` in the opts.
  - A referred clinic not eligible for winback gets the referral code with `discountKind 'referral'`.
  - **M8:** with the switch off: `getReferralAttribution` and `getValidatedReferralOffer` are **not called**, no referral code, and `referralId: null`.
  - With the switch on, `getReferralAttribution` is called exactly once, and its result is passed to `getValidatedReferralOffer` as `opts.attribution`.
  - A plan switch never calls the offer functions.

---

### Task C4: Attribution at signup, billing-page code entry, public code lookup

**File ownership:**
- `web/src/lib/referral/attribution.ts`
- `web/src/lib/referral/__tests__/attribution.test.ts`
- `web/src/actions/signup.ts`
- `web/src/actions/__tests__/signup.test.ts`
- `web/src/actions/__tests__/oauth-clinic-details-loop.test.ts` (only to add mocks)
- `web/src/app/(auth)/signup/page.tsx` (becomes a server component)
- `web/src/app/(auth)/signup/signup-form.tsx` (create; the moved client code)
- `web/src/app/(auth)/signup/clinic-details/page.tsx` (becomes a server component)
- `web/src/app/(auth)/signup/clinic-details/clinic-details-form.tsx` (create; moved client code)
- `web/src/components/referral/referral-code-field.tsx` (create)
- `web/src/app/api/referral/attach/route.ts` (create)
- `web/src/app/api/referral/codes/[code]/route.ts` (create)
- `web/src/app/api/referral/__tests__/attach.test.ts` (create)
- `web/src/app/api/referral/__tests__/codes.test.ts` (create)

```ts
export interface AttributionDeps {
  now(): Date
  env: Record<string, string | undefined>
  findReferrer: typeof findReferrerByCode
  existing: typeof getReferralByReferredTenant
  signupAt(tenantId: string): Promise<Date>                   // tenants.created_at (small inline query or B3 getReferralContext-free helper; implement inline here via db)
  loadSignals: typeof loadTenantSignals
  loadCandidates: typeof loadCandidateTenants
  runChecks: typeof runEligibilityChecks       // B2, called with loadSignals/loadCandidates
  insert: typeof insertReferral
}
export type AttributionResult =
  | { outcome: 'created'; referralId: string; status: 'trial' | 'ineligible' }
  | { outcome: 'skipped'; reason: 'disabled' | 'no_code' | 'invalid_code' | 'unknown_or_inactive' | 'already_attributed' | 'same_tenant' }
export async function attributeReferral(input: { referredTenantId: string; rawCode: unknown; capturedVia: CapturedVia }, deps?: Partial<AttributionDeps>): Promise<AttributionResult>
/** P-4: typed field wins over the cookie. */
export function pickSignupCode(input: { field: unknown; cookie: unknown }): { code: string; via: CapturedVia } | null  // field → 'signup_field', cookie → 'link'
```

`attributeReferral`, in order:
1. If the switch is off, `disabled`.
2. `normalizeReferralCode`; on failure, `invalid_code`.
3. `findReferrer`, which must have `canRefer`; otherwise `unknown_or_inactive`.
4. If the referrer is the referred tenant, `same_tenant`.
5. If a referral already exists, `already_attributed`.
6. `res = runChecks({ referredTenantId, referrerTenantId, referredSignupAt: signupAt(referredTenantId), stage: 'attribution' }, { loadSignals, loadCandidates })`. This is the **identity snapshot** of P-12 (review M3): owner email, phone and registry not-new are decided here, against the subscription rows as they are now, and not re-evaluated at qualification.
7. Insert with status `trial` (or `ineligible` + `res.verdict`) and `checks.atSignup = { selfReferral, notNew }`. A null insert (race) gives `already_attributed`.

**Signup action** (`actions/signup.ts`), in both `signUp` and `createClinicForOAuthUser`:
- After the tenant is created (after `persistSignupAttribution`), compute `pickSignupCode({ field: formData.get('referralCode'), cookie: cookieStore.get(REFERRAL_COOKIE_NAME)?.value })`.
- If it picks a code, `await attributeReferral(...)` inside try/catch, calling `reportSideEffectFailure(err, { area: 'referral', step: 'attribute_signup' })` on failure. **Attribution must never block signup.**
- On `created`, delete the cookie (P-17) with the same domain rule. The domain logic is a small local helper, or a `referralCookieDeleteOptions(hostname)` exported from `@/lib/referral/cookie`. B6 owns that file, so use the local helper.

**Signup pages:**
- Move the current client components verbatim into `signup-form.tsx` and `clinic-details-form.tsx`, adding the props `referralEnabled: boolean` and `defaultReferralCode: string | null`.
- The `page.tsx` files become server components. They read `isReferralEnrollmentEnabled()`, plus the default code from `searchParams.ref` (Next 16: `searchParams: Promise<…>`) or the `floraclin_ref` cookie (`cookies()`), normalised.
- When `referralEnabled`, the form renders `<ReferralCodeField defaultCode />`:
  - A link-style toggle, "Tem um código de indicação?", that opens an `Input name="referralCode"` labelled "Código de indicação" with `maxLength 12`, `autoCapitalize characters` and the placeholder "Ex.: MECA7K".
  - It starts open and pre-filled when `defaultCode` is set.
  - It shows no discount promise; the paywall and billing page do that after validation.

**`POST /api/referral/attach`** (owner only, otherwise 403):
- 404 if the switch is off.
- Loads `getSubscription(ctx.tenantId)`. If `firstPaidAt` or `stripeSubscriptionId` is set: 400 "O código de indicação só pode ser informado antes do primeiro pagamento."
- Calls `attributeReferral({ capturedVia: 'billing_page' })` and maps the result:
  - `created`/`trial` → 200 `{ status: 'trial' }`
  - `created`/`ineligible` → 200 `{ status: 'ineligible' }`. The UI shows "Esta indicação não é elegível pelas regras do programa."
  - `invalid_code` or `unknown_or_inactive` → 400 "Código de indicação inválido ou inativo."
  - `already_attributed` → 400 "Sua clínica já tem uma indicação registrada."
  - `same_tenant` → 400 "Você não pode usar o código da sua própria clínica."

**`GET /api/referral/codes/[code]`** (public):
- `normalizeReferralCode`, then the switch, then `findReferrerByCode` and `canRefer`.
- Returns `{ active: true, clinicName: shortClinicName(name) }` or `{ active: false }`, with the cache header from §2.2.
- Never a 404 or 500 body that distinguishes cases: on error it reports and returns `{ active: false }`.

**Tests:**
- `attribution.test.ts`: every skip reason; `runChecks` is called with `stage: 'attribution'` and the referred tenant's `signupAt`; a self-referral by `shared_user` creates `ineligible/self_referral`; a not-new match creates `ineligible/not_new`; a clean case creates `trial` with `checks.atSignup`; an insert race gives `already_attributed`; `pickSignupCode` precedence and normalisation.
- `signup.test.ts` (extend; mock `@/lib/referral/attribution`):
  - With a cookie, `attributeReferral` is called with `via: 'link'`.
  - A field overrides the cookie.
  - `attributeReferral` throwing doesn't break signup (redirect still happens).
  - No code means no call.
- `oauth-clinic-details-loop.test.ts`: add the mock only, so it stays green.
- `attach.test.ts`: 403 for a non-owner, 404 with the switch off, 400 after the first payment, and each result mapping and message.
- `codes.test.ts`: active, inactive, malformed (no DB call), switch off (no DB call), a DB throw giving `{active:false}` with the report called, and the cache header present.

---

### Task C5: In-app "Indique e Ganhe" page

**File ownership:**
- `web/src/lib/referral/dashboard.ts`
- `web/src/lib/referral/__tests__/dashboard.test.ts`
- `web/src/app/api/referral/route.ts`
- `web/src/app/api/referral/__tests__/route.test.ts`
- `web/src/components/settings/referral-settings.tsx`
- `web/src/components/settings/__tests__/referral-settings.test.tsx`
- `web/src/app/(platform)/configuracoes/page.tsx`
- `web/src/app/(platform)/configuracoes/configuracoes-page-client.tsx`
- `web/src/app/(platform)/configuracoes/settings-page-client.tsx`
- `web/src/app/(platform)/configuracoes/__tests__/settings-page-client.test.tsx`

**`dashboard.ts` (pure):**

```ts
export interface DashboardInput {
  canRefer: boolean; code: string | null; rewardsActive: boolean
  counting: number
  planPriceCents: number | null          // referrer's plan price (null when no paid plan)
  planEligible: boolean                  // isReferralEligiblePlan(plan): yearly referrers see 0% (P-19 / review H3)
  nextInvoiceAt: Date | null             // currentPeriodEnd when canRefer (display only; may lag a renewal by hours)
  referrals: Array<{ id: string; referredName: string; capturedAt: Date; status: ReferralStatus; pausedReason: PausedReason | null; ineligibleReason: IneligibleReason | null }>
  events: Array<{ createdAt: Date; counting: number; discountPercent: number; bonusCredits: number }>
}
export interface ReferralDashboardResponse {
  canRefer: boolean
  inactiveMessage: string | null       // "Seu link de indicação fica ativo quando sua clínica tem uma assinatura paga."
  link: string | null                  // referralLink(code) only when canRefer
  shareText: string | null             // §9.2 exact, {link} filled
  whatsappShareUrl: string | null      // https://wa.me/?text=<encodeURIComponent(shareText)>
  progress: { counting: number; target: 5; percent: number; label: string; bonusLabel: string | null }
  discountLine: string
  referrals: Array<{ id: string; name: string; signupDate: string /* dd/MM/yyyy */; label: string; sublabel: string | null }>
  history: Array<{ date: string; text: string }>
  rulesUrl: 'https://floraclin.com.br/indique'
}
export function buildReferralDashboard(input: DashboardInput): ReferralDashboardResponse
export function referralShareText(link: string): string
```

Copy (exact):
- Share text, as two lines joined by `\n`:
  - "Uso o FloraClin na minha clínica para agenda, prontuário e lembretes por WhatsApp. Se você também é profissional da saúde estética e quer testar, pelo meu link você ganha 14 dias grátis e 20% de desconto nos 2 primeiros meses: {link}"
  - "Ganho desconto na minha assinatura se você assinar. #publi #linkafiliado"
- Progress label:
  - counting < 5: "{c} de 5 clínicas pagantes, faltam {5−c} para FloraClin grátis". At 4 it reads "falta 1"; that pluralisation is a builder call.
  - counting = 5: "5 de 5: seu FloraClin está grátis 🎉"
  - counting > 5: label "5 de 5: seu FloraClin está grátis 🎉", plus the bonus label "+{100×(c−5)} créditos de WhatsApp por mês com {c} clínicas pagantes".
- Discount line (P-14):
  - percent > 0 with a price and a date: "Seu desconto atual: {p}% ({brl(round(price×p/100))} de {brl(price)}) a partir da próxima fatura, em {dd/MM}."
  - percent = 0: "Cada clínica indicada que está pagando vale 20% de desconto na sua assinatura. Com 5, o FloraClin sai de graça."
  - `percent = rewardsActive && canRefer && planEligible ? referralDiscountPercent(counting) : 0`. (Display mirror of the sync rule; the authoritative value is what `syncReferrerReward` writes to Stripe.)
- History row: "{dd/MM/yyyy}: desconto de {p}% com {n} clínica(s) pagante(s)", plus " · +{b} créditos de WhatsApp/mês" when b > 0.
- Use `formatBrDayMonth` and `formatBrDate` from `@/lib/dates`. The BRL format is `R$ 59,40`; mirror the `brl()` helper used in billing-settings.

**`GET /api/referral`:**
- Owner only (403 otherwise). 404 when `!isReferralEnrollmentEnabled()`.
- Loads `getSubscription` (with its plan) → `canRefer`, `planEligible = isReferralEligiblePlan(plan)`, and `nextInvoiceAt = canRefer ? currentPeriodEnd : null`.
- Loads the code with `getOrCreateReferralCode` **only when canRefer** (the code is created on first visit, §8).
- Loads `countCountingReferrals`, `listReferralsForReferrer` and `listRewardEvents(…, 10)`, then `buildReferralDashboard`.

**`referral-settings.tsx`:** React Query `['referral']` → `/api/referral`. Cards:
1. Link, with "Copiar link", "Compartilhar no WhatsApp" (opens `whatsappShareUrl`) and "Copiar texto para Instagram" (copies `shareText`), or the inactive message.
2. Progress bar (`percent = min(counting, 5) / 5`), the label, and the bonus label.
3. The discount line.
4. The referral list: name, date and label, with the sublabel in muted text.
5. History.
6. The link "Ver regras do programa" → `rulesUrl` (new tab).

Toasts with `sonner`: "Link copiado", "Texto copiado".

**Settings wiring:**
- `configuracoes/page.tsx` (server) computes `referralEnabled = isReferralEnrollmentEnabled()` and passes it through `ConfiguracoesPageClientWrapper` to `SettingsPageClient`.
- `settings-page-client.tsx`:
  - Add `TabKey 'indique'` and the item `{ key: 'indique', label: 'Indique e Ganhe', icon: GiftIcon }` in "Sistema", right after "Assinatura".
  - It is owner-only through the existing default.
  - Filter it out of `visibleTabs` when `!referralEnabled` (P-1).
  - Render `<ReferralSettings />` for `effectiveTab === 'indique'`.

**Tests:**
- `dashboard.test.ts`:
  - The exact progress copy at 0, 3, 4, 5 and 7.
  - The discount line at 3 counting with R$ 99,00 and a 10/11 date: "Seu desconto atual: 60% (R$ 59,40 de R$ 99,00) a partir da próxima fatura, em 10/11." Use a BR-safe instant such as `parseBrDate('2026-11-10')`.
  - The 0% line.
  - Rewards inactive gives 0%. `planEligible=false` (yearly) gives 0% even with 3 counting.
  - `canRefer=false` gives no link, the inactive message, and the list still shown.
  - The share text is exact and the WhatsApp URL is encoded.
  - The labels come from B1.
- `route.test.ts`: 403 for a non-owner; 404 with the switch off; for a non-paying clinic, no code is created (`getOrCreateReferralCode` not called); for a paying one, it is called.
- `referral-settings.test.tsx`: renders the link and buttons (the copy calls `navigator.clipboard.writeText` with `shareText`), and the inactive state.
- `settings-page-client.test.tsx`: the tab is hidden when `referralEnabled=false`, visible for an owner when true, and hidden for a non-owner.

---

## Group D: wiring and surfaces (4 tasks, parallel; depend on C)

### Task D1: Webhook + reconcile cron

**File ownership:**
- `web/src/lib/referral/events.ts`
- `web/src/lib/referral/__tests__/events.test.ts`
- `web/src/app/api/webhooks/stripe/route.ts`
- `web/src/app/api/webhooks/stripe/__tests__/subscription-updated.test.ts` (only to add the `@/lib/referral/events` mock)
- `web/src/app/api/webhooks/stripe/__tests__/referral-events.test.ts` (create)
- `web/src/app/api/cron/referral-reconcile/route.ts`
- `web/src/app/api/cron/referral-reconcile/__tests__/route.test.ts`
- `web/vercel.json`

```ts
export interface ReferralEventDeps {
  env: Record<string, string | undefined>
  refresh: typeof refreshReferral; chargeback: typeof markReferralChargeback; fingerprints: typeof recordTenantCardFingerprints
  sync: typeof syncReferrerReward
  findByStripeSub: typeof findReferralByStripeSubscription; findByReferred: typeof getReferralByReferredTenant
  bindSubscription: typeof bindReferralSubscription                                   // P-21
  tenantBySub: typeof getTenantIdByStripeSubscription; tenantByCustomer: typeof getTenantIdByStripeCustomer
  isReferrer: typeof isReferrer; disputeCustomer: typeof retrieveDisputeCustomerId
  listUnits: typeof listReconcileUnits; markReconciled: typeof markReferralsReconciled // P-23
  report: typeof reportSideEffectFailure
}
export async function handleReferralStripeEvent(event: Stripe.Event, deps?: Partial<ReferralEventDeps>): Promise<void>
export async function reconcileReferrals(opts?: { now?: Date; deadlineAt?: number }, deps?: Partial<ReferralEventDeps>): Promise<{ refreshed: number; synced: number; failed: number; skipped: number }>
```

`handleReferralStripeEvent`:
- Returns immediately when `referrerCouponIds(env) === null`, so the webhook is unchanged until launch config exists.
- Every branch **re-reads state** through refresh and sync. Nothing is taken from the event payload except ids.

| Event | Steps |
|---|---|
| `checkout.session.completed` | `tenantId = session.metadata.tenantId`. If the tenant has a referral (`findByReferred`): when `session.mode === 'subscription'` and `session.subscription` is set, `bindSubscription(referral.id, subscriptionId)` **first** (P-21, atomic set-only-if-null, review M4), then `r = refresh(id)` and `sync(r.referrerTenantId, { reason: r.rewardReason ?? 'reconcile', referralId: id })`. If `isReferrer(tenantId)`, `sync(tenantId, { reason: 'subscription' })`. |
| `invoice.paid` | `subId` from `invoice.parent.subscription_details.subscription`. Record fingerprints: `tenantBySub(subId)` with the invoice's customer → `fingerprints(tenantId, customerId)`. Then the **common subscription path** (below). |
| `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` | The common subscription path, with `subId` from the invoice or `subscription.id`. |
| `invoice.created` | Only if `invoice.status === 'draft'` and `billing_reason === 'subscription_cycle'`. `tenantId = tenantBySub(subId)`. If `isReferrer(tenantId)`: `sync(tenantId, { reason: 'invoice_draft', draftInvoiceId: invoice.id })`. The sync repairs this draft (judged by its own `created`, P-20) and any other open draft under the reward lock. Every **other** sync also repairs open drafts (review H5), so a change after this event still reaches the draft. |
| `charge.dispute.created` | `customerId = disputeCustomer(dispute)`, `tenantId = tenantByCustomer(customerId)`, `r = chargeback(tenantId)`. If `r`, `sync(r.referrerTenantId, { reason: 'referral_canceled', referralId: r.referralId })`. |

The **common subscription path**:
1. `referral = findByStripeSub(subId) ?? (tenantId = tenantBySub(subId)) && findByReferred(tenantId)`.
2. If there is a referral: `r = refresh(id)` and then `sync(r.referrerTenantId, { reason: r.rewardReason ?? 'reconcile', referralId: id })`.
3. If the subscription's tenant `isReferrer`: `sync(tenant, { reason: 'subscription' })`.

Errors propagate, so the route answers 500 and Stripe redelivers.

**Webhook route:**
- Add `case 'invoice.created':` and `case 'charge.dispute.created':` as no-op cases for the existing local-row logic.
- After the `switch`, still inside the same `try`, call `await handleReferralStripeEvent(event)`. Existing handlers run **first**, so the local row is current when referral code reads it.
- Nothing else changes.

**Cron route** `/api/cron/referral-reconcile`:
- Copy the `subscription-expiry` route shape: Bearer `CRON_SECRET`, and `withCronMonitor('referral-reconcile', '30 7 * * *', …)`.
- `export const maxDuration = 300`, and `deadlineAt = Date.now() + 240_000`.
- `reconcileReferrals` (P-23, review M7):
  1. `units = listUnits()` (least-recently-reconciled first).
  2. For each unit, **check the deadline first**; past it, this and every remaining unit count as `skipped` (one per unit).
  3. Otherwise, for each `referralId` of the unit, `refresh(id)` in a per-item try/catch (failure reported, counted as failed). Then `sync(unit.referrerTenantId, { reason: 'reconcile' })` in its own try/catch. The sync runs even if a refresh failed (it recomputes from stored state), so reward cleanup (e.g. program end) is never starved by refresh work.
  4. `markReconciled(unit.referralIds, now)` after the unit, success or failure, so the next run starts with the units this one didn't reach.
  5. Counts: `refreshed` = successful refreshes, `synced` = successful syncs, `failed`, `skipped` = units not reached.
- No-op (all zeros) when `referrerCouponIds` is null.

**`vercel.json`:** add `{ "path": "/api/cron/referral-reconcile", "schedule": "30 7 * * *" }`.

**Tests:**
- `events.test.ts` (all deps mocked):
  - Not configured: no dep is called for any event type.
  - `invoice.paid` on a referred sub: fingerprints, then refresh, then sync with `reason referral_counting` and the referralId, in that order.
  - `invoice.paid` on a referrer's own sub: sync with `subscription`.
  - A tenant that is both referred and a referrer: two syncs (its referrer, then itself).
  - `customer.subscription.deleted` on a referred sub: refresh, then sync.
  - `invoice.created` draft cycle for a referrer: `sync(tenant, { reason: 'invoice_draft', draftInvoiceId })`. A non-draft or `subscription_create` invoice does nothing.
  - `checkout.session.completed` for a referred tenant: `bindSubscription(referralId, 'sub_new')` is called **before** `refresh`; a `payment`-mode session (no subscription) skips binding.
  - `charge.dispute.created`: chargeback, then sync.
  - A refresh throwing propagates.
  - Unrelated events are ignored.
  - `reconcileReferrals`: counts, per-item failure isolation, a failed refresh still followed by its unit's sync, and no-op when not configured.
  - **M7 rotation, two consecutive deadline-limited runs:** an in-memory fake for `listUnits`/`markReconciled` orders units by their stamp. Three units A, B, C; the clock passes the deadline after one unit. Run 1 processes A only (refresh(es) **and** sync of A), skipped = 2. Run 2 processes B (not A again). Run 3 processes C. Every unit got its sync within its own run.
- `referral-events.test.ts` (route level; mock `@/lib/referral/events`):
  - It is called after the existing handlers, for every event type including the two new ones.
  - If it throws, the route returns 500.
  - With the module returning normally, the existing behaviour is unchanged.
- `subscription-updated.test.ts`: add `vi.mock('@/lib/referral/events', () => ({ handleReferralStripeEvent: vi.fn() }))` only.
- The cron route test: 401 without the secret, 200 with the result body, and `withCronMonitor` mocked to call through.

---

### Task D2: Billing page (combined discount display, referral offer, code field, bonus note)

**File ownership:**
- `web/src/app/api/billing/usage/route.ts`
- `web/src/app/api/billing/__tests__/usage.test.ts` (create)
- `web/src/components/settings/billing-settings.tsx`
- `web/src/components/settings/__tests__/billing-settings.test.tsx`
- `web/src/lib/billing-discount-copy.ts` (create)
- `web/src/lib/__tests__/billing-discount-copy.test.ts` (create)

**Usage route additions:**
- `discount` already uses the new `SubscriptionDiscount` shape from B4, so pass it through.
- `usage.whatsapp.bonus = whatsappUsage.bonus`.
- `referral`: `{ offer: PublicReferralOffer & { headline: string } | null, canEnterCode: boolean }`.
  - When the switch is on, read `attribution = getReferralAttribution(tenantId)` **once** and reuse it below (M8 pattern). With the switch off, no referral DB call.
  - `offer` comes from `getValidatedReferralOffer(subscription, sellable monthly plans from listPlans(true), undefined, undefined, undefined, { attribution })` with `headline = referralOfferHeadline(offer)` (imported from `@/lib/referral/offer-copy`), but only when the winback offer is null (`getValidatedWinbackOffer(subscription, plans)`), so the page agrees with checkout.
  - `canEnterCode = isReferralEnrollmentEnabled() && role === 'owner' && !subscription.firstPaidAt && !subscription.stripeSubscriptionId && !attribution`.
- With the switch off, `referral = { offer: null, canEnterCode: false }`.

**`billing-discount-copy.ts` (pure, the §6.4 display):**

```ts
/** "R$ 99,00 → R$ 59,40/mês · 40% de desconto por 2 indicações pagantes" (+ " · R$ 47,52/mês até 21/12" when an entry coupon is running). */
export function discountSummaryLine(d: SubscriptionDiscountLike, opts: { cancelPending: boolean; now?: Date }): string
export function referralCountFromPercent(percent: number): number   // percent / 20
```

Rules:
- Referral part only: "{brl(full)} → {brl(full×(1−p))}/mês · {p}% de desconto por {n} indicação(ões) pagante(s)". It is singular at n = 1 ("1 indicação pagante").
- Referral plus an entry coupon: "{brl(full)} → {brl(discounted)}/mês até {dd/MM}, depois {brl(afterEnds)} · {p}% de desconto por {n} indicações pagantes".
- No referral part: keep the existing `discountedPriceLine` behaviour, moved here unchanged (same strings), so that existing tests keep passing.
- `cancelPending` drops the "depois" clause, as today.

**`billing-settings.tsx`:**
- Use `discountSummaryLine`.
- WhatsApp `UsageBar`: when `bonus > 0`, a note under it: "inclui +{n} créditos de indicação".
- When `referral.offer`: a sage banner with `headline`. Plan cards for `offer.planSlugs` show the struck price → discounted price, using `winbackPriceCents(plan, offer)`, which works because the shapes are compatible, plus "nos 2 primeiros meses".
- When `referral.canEnterCode`: a small card, "Tem um código de indicação?", with an input and the button "Aplicar código" posting to `/api/referral/attach`.
  - On success, toast "Indicação registrada" and `queryClient.invalidateQueries({ queryKey: ['billing', 'usage'] })`. The real key is `['billing', 'usage']` (`billing-settings.tsx:380`); `['billing-usage']` matches nothing (review M6).
  - On `ineligible`, toast "Esta indicação não é elegível pelas regras do programa."
  - On 400, toast the server message.

**Tests:**
- `billing-discount-copy.test.ts`:
  - The exact doc example "R$ 99,00 → R$ 59,40/mês · 40% de desconto por 2 indicações pagantes".
  - Singular at 20%.
  - Combined with the entry coupon (shows "até dd/MM").
  - A winback-only line is identical to the previous output.
  - `cancelPending`.
- `usage.test.ts`:
  - The bonus is passed through.
  - With the switch off, there's no referral offer, `canEnterCode` is false, and `getReferralAttribution` is not called.
  - With the switch on, `getReferralAttribution` is called once.
  - When the winback offer exists, the referral offer is null.
  - `canEnterCode` is false after the first payment, false with an existing attribution, and false for a non-owner.
- `billing-settings.test.tsx`: keep the existing cases. Add the bonus note, the referral banner headline, the code card posting to attach, and the referral discount line rendering. **M6:** after a successful attach, `/api/billing/usage` is fetched again (the fetch mock is called a second time) and the code card disappears when the refetched payload has `canEnterCode: false`.

---

### Task D3: Paywall, trial-ending modal, platform layout

**File ownership:**
- `web/src/app/(platform)/layout.tsx`
- `web/src/components/layout/subscription-access.tsx`
- `web/src/components/layout/plan-checkout.tsx`
- `web/src/components/layout/expired-paywall.tsx`
- `web/src/components/layout/trial-ending-modal.tsx`
- `web/src/components/layout/__tests__/expired-paywall.test.tsx`
- `web/src/components/layout/__tests__/trial-ending-modal.test.tsx`
- `web/src/components/layout/__tests__/client-import-boundary.test.ts` (create; review H7)

- **Import rule (review H7):** `subscription-access.tsx`, `plan-checkout.tsx`, `expired-paywall.tsx` and `trial-ending-modal.tsx` are client modules. They import `PublicReferralOffer` and `referralOfferHeadline` **only** from `@/lib/referral/offer-copy` (A2). Only the server `layout.tsx` imports `@/lib/referral/offer`.
- **Context:** add `referral: PublicReferralOffer | null` to `SubscriptionAccess` (default null) and to the provider props.
- **Layout:**
  - When `readOnly && recovery === 'checkout' && !validatedWinback`, **or** `trialEndsAt !== null`, compute `getValidatedReferralOffer(subscription, paidPlans, now)`.
  - Pass `publicReferralOffer(...)`. It must be **null whenever the winback is non-null**: exactly one offer, and VOLTA30 wins (§6.2).
- **`plan-checkout.tsx`:**
  - Widen the `offer` props of `PlanCard`, `PlanCards` and `entryPriceLine` to `EntryOffer = PublicWinbackOffer | PublicReferralOffer`. They read only `percentOff`, `amountOffCents`, `planSlugs`, `duration` and `durationInMonths`.
  - Add `ReferralBadge({ offer })`, which renders `referralOfferHeadline(offer)` and "Aplicado automaticamente no pagamento." with `data-testid="referral-offer"`.
- **`expired-paywall.tsx`:** `const offer = winback ?? referral`. Pass it to `entryPriceLine` and `PlanCards`. Show `WinbackBadge` when `winback`, otherwise `ReferralBadge` when `referral`.
- **`trial-ending-modal.tsx`:** currently `offer={null}`. Pass `referral` and show `ReferralBadge` when present. The winback can't apply during a trial.

**Tests:**
- `expired-paywall.test.tsx`: keep all existing cases. Add:
  - A referral offer renders the badge "Indicação de Clínica Bela: 20% de desconto nos 2 primeiros meses." and the struck prices.
  - Winback and referral are never shown together (when the context has a winback, there's no referral badge).
- `trial-ending-modal.test.tsx`: the referral badge and discounted price when present; unchanged when null.
- `client-import-boundary.test.ts`: reads the four client files above and asserts none imports `@/lib/referral/offer`, `@/db/…`, `@/lib/stripe` (value import) or `@/lib/referral/config`; and that each file that mentions `referralOfferHeadline` imports it from `@/lib/referral/offer-copy`. (A production build would also catch this but needs env, so it is not a required check; this static test is.)

---

### Task D4: Platform admin

**File ownership:**
- `web/src/app/api/admin/tenants/[id]/referrals/route.ts`
- `web/src/app/api/admin/referrals/[id]/ineligible/route.ts`
- `web/src/app/api/admin/tenants/[id]/referrals/__tests__/route.test.ts`
- `web/src/app/api/admin/referrals/[id]/ineligible/__tests__/route.test.ts`
- `web/src/components/admin/tenant-referrals-panel.tsx`
- `web/src/components/admin/subscription-detail-dialog.tsx`
- `web/src/components/admin/__tests__/subscription-detail-dialog-stripe.test.tsx` (only to mock the panel)
- `web/src/components/admin/__tests__/tenant-referrals-panel.test.tsx`

- **GET** (`requirePlatformAdmin`): `getTenantReferralAdminView(id)`. Admins **do** see `checks` and the raw reasons.
- **POST ineligible** (`requirePlatformAdmin`):
  - Body `{ note?: string }`, trimmed and capped at 500 chars.
  - `markReferralIneligible(id, 'admin', note)`. If null (not found, or already ineligible), 404 or 409 with a pt-BR message.
  - `createAuditLog({ tenantId: referral.referredTenantId, userId: ctx.userId, action: <existing update action>, entityType: 'tenant_referral', entityId: id, changes: { status: { old, new: 'ineligible' } } })`
  - `syncReferrerReward(referral.referrerTenantId, { reason: 'admin', referralId: id })`. Not skipped when unconfigured: the result is ignored.
  - Returns 200.
  - **There is no endpoint that grants discounts** (§9.6).
- **Panel** in `SubscriptionDetailDialog` (a new section, "Indique e Ganhe"):
  - The code.
  - "Indicada por {clínica}" with status.
  - The table of referrals (name, status label via B1, captured_via, dates, checks summary), each non-terminal row with the button "Marcar indicação como não elegível". It opens a confirm dialog with a "Motivo" textarea.
  - The reward history (date, counting, %, bonus, reason).
  - The panel fetches lazily (React Query) when the dialog opens.

**Tests:**
- Route tests: non-admin rejected; GET shape.
- POST: marks, audits and syncs in order; a missing row gives 404; an already-ineligible one gives 409; a sync throwing gives 500 (`handleApiError`) with the mark persisted (Stripe redelivery and cron fix the discount).
- Panel test: renders rows and labels, and the confirm calls the POST with the note.
- Dialog test: mock the panel module only.

---

## 3. Group/ownership matrix (conflict check)

| Group | Task | Shared-risk files (unique within the group) |
|---|---|---|
| A | A1 | `schema.ts`, `0043_referral_program.sql` |
| A | A2 | `lib/referral/{rules,types,config,code,subscription-state,offer-copy}.ts`, `site/src/lib/referral-rules.ts` |
| B | B1 | `lib/referral/status.ts` |
| B | B2 | `lib/referral/eligibility.ts` |
| B | B3 | `db/queries/referrals.ts`, `db/queries/__tests__/referrals.test.ts` |
| B | B4 | `lib/stripe.ts`, `stripe-checkout-winback.test.ts` |
| B | B5 | `lib/whatsapp-credits.ts`, `db/queries/whatsapp-credits.ts` (reads `referral_reward_events` via A1 schema; imports nothing from B3) |
| B | B6 | `web/src/middleware.ts`, `site/src/middleware.ts`, cookie libs |
| B | B7 | `site/src/app/page.tsx`, `sitemap.ts`, new site pages |
| B | B8 | `web/package.json`, `web/.env.example`, coupon script |
| C | C1 | `lib/referral/{reward,emails}.ts` (draft repair lives here now) |
| C | C2 | `lib/referral/lifecycle.ts`, backfill script, `web/package.json` (only C-group toucher) |
| C | C3 | `lib/referral/offer.ts`, checkout route + test |
| C | C4 | `actions/signup.ts`, signup pages, attach/codes routes |
| C | C5 | settings page/client, `lib/referral/dashboard.ts`, `/api/referral` |
| D | D1 | webhook route, cron route, `vercel.json`, `lib/referral/events.ts` |
| D | D2 | usage route, `billing-settings.tsx`, `lib/billing-discount-copy.ts` |
| D | D3 | platform layout, paywall components, `client-import-boundary.test.ts` |
| D | D4 | admin routes + dialog |

Cross-group dependencies only point backwards (D→C→B→A). Within a group, no task imports a module created by a sibling task. After the review changes, the new shared pieces were placed so this still holds:
- `ReferralState`, `CardSighting`, `CheckResult` → A2 `types.ts` (used by B1, B3, C2).
- `referrerSubscriptionState` / `stripeSubscriptionIsMonthly` → A2 `subscription-state.ts` (used by C1, C2).
- `PublicReferralOffer` / `referralOfferHeadline` → A2 `offer-copy.ts` (used by C3, D2, D3; no client module imports C3's `offer.ts`).
- `runEligibilityChecks` → B2 with **injected** loaders (B3 functions are passed in by C2/C3/C4, so B2 does not import B3).
- B5's initial bonus reads the reward-event table directly (A1 schema) instead of a B3 query.
- `withReferrerRewardLock`, `bindReferralSubscription`, `listReconcileUnits`, `markReferralsReconciled` → B3; `listOpenCycleDrafts`, `findEarliestSubscriptionId`, `listCustomerCardSightings` → B4; all consumed only in Group C/D.

---

## 4. Integration & verification

### 4.1 After each group (orchestrator)

```bash
pnpm install                       # no new deps expected; keeps hooks registered
pnpm --filter @floraclin/web lint
pnpm --filter @floraclin/web typecheck
pnpm --filter @floraclin/web test:run
pnpm --filter @floraclin/site test:run
```

### 4.2 Final

```bash
pnpm ci:checks                     # lint + typecheck + web tests + site tests (same as CI / pre-push)
pnpm build:web && pnpm build:site  # recommended: catches server/client boundary and Next 15/16 page-prop issues
```

Then the doc's §11.2 E2E on the local test setup, in **Stripe test mode**:
1. `pnpm --filter @floraclin/web referral:create-coupons` with an `sk_test_` key, then put the printed env lines in `.env.local`, along with `REFERRAL_ENROLLMENT_ENABLED=true`.
2. Forward webhooks with `stripe listen --forward-to localhost:3000/api/webhooks/stripe --events checkout.session.completed,invoice.paid,invoice.payment_failed,invoice.created,customer.subscription.updated,customer.subscription.deleted,charge.dispute.created`.
3. Clinic A subscribes (a Stripe customer, a card). Its settings show the link.
4. Open `/signup?ref=CODE` in a clean browser; clinic B signs up. The billing page shows "Indicação de A: 20% de desconto nos 2 primeiros meses." Checkout shows 20% off.
5. Advance B's subscription to its second invoice with a Stripe **test clock**. The referral becomes `counting`. A's subscription gets `floraclin_referrer_20`, and A's next invoice shows 20%. A gets the email.
6. Pause: B fails a payment (test card `4000000000000341`), so `paused/past_due`, then recovers. Schedule cancellation, then `paused/cancel_scheduled`, then reactivate. Cancel, then `canceled`, and A's discount is removed at the next invoice.
7. 100%: five counting referrals give an invoice of R$ 0,00, paid, with A still `active`. Seven give a WhatsApp total of plan + 200 on the current month.
8. Draft safety net: with A's renewal draft already created (test clock), make a second referral start counting **after** `invoice.created` was processed, and check that the draft's discounts were rewritten to the new percent (H5). Move A to a yearly price: its referral coupon disappears from the subscription and from any open draft (H3).
9. Chargeback: test card `4000000000000259` on B gives `ineligible/chargeback`.
10. Switch off (`REFERRAL_ENROLLMENT_ENABLED` unset):
    - No tab and no cookie.
    - `/api/referral/codes/X` returns `{active:false}`.
    - No welcome coupon at checkout.
    - The webhook and cron still sync A's discount while the coupon ids are set.
11. End: set `REFERRAL_REWARDS_END_AT` in the past, run the cron, and A's referral discount is removed. Already-finalized invoices keep theirs, and an open draft created **before** the end instant keeps its discount (H4).

### 4.3 Environment variables

| Var | Project | Value at merge | Value at launch | Notes |
|---|---|---|---|---|
| `REFERRAL_ENROLLMENT_ENABLED` | web | unset | `true` | Only `"true"` enables. |
| `REFERRAL_ENROLLMENT_ENABLED` | site | unset | `true` | Gates the cookie and the `/indique` page (P-5, P-6). |
| `STRIPE_REFERRAL_PROMOTION_CODE_ID` | web | unset | `promo_…` (live) | From the coupon script. |
| `STRIPE_REFERRER_COUPON_IDS` | web | unset | `floraclin_referrer_20,…_40,…_60,…_80,…_100` | Exactly 5, ascending (B-3). **Turns on reward sync, webhook referral handling and the cron.** |
| `REFERRAL_REWARDS_END_AT` | web + site | unset | unset | Only to end the program: a full ISO instant with an offset, at least 30 days after the notice. |
| `FLORACLIN_APP_ORIGIN` | site | unset | unset | Optional override for the code-lookup API (default `https://app.floraclin.com.br`). |
| `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY` | web | existing | existing | Unchanged. |

### 4.4 Stripe objects needed at launch (live account `acct_1TiQxzEZFziZ0c3G`, **only with Giorgio's explicit OK**)

Created by `pnpm --filter @floraclin/web referral:create-coupons -- --live` from a developer machine. The script refuses to run without `--live`, and refuses live mode under CI, Vercel or GitHub Actions.

| Object | Terms |
|---|---|
| Coupon `floraclin_referral_new_20x2` | 20% off, `repeating`, 2 months, no `applies_to`, metadata `{purpose: referral_welcome, app: floraclin}` |
| Promotion code `INDICA20` on it | `restrictions.first_time_transaction: true`, metadata `{purpose: referral_welcome, app: floraclin}`. Its id goes in `STRIPE_REFERRAL_PROMOTION_CODE_ID`. |
| Coupons `floraclin_referrer_20/40/60/80/100` | 20/40/60/80/100% off, `forever`, no `applies_to`, metadata `{purpose: referral_reward, app: floraclin, percent}` |

### 4.5 Webhook events to enable on the live endpoint

The existing ones: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
**New:** `invoice.created` (the draft safety net) and `charge.dispute.created` (chargebacks). Enable them **before** setting `STRIPE_REFERRER_COUPON_IDS`.

### 4.6 Rollout order

1. **Migration first.** Giorgio applies `web/src/db/migrations/0043_referral_program.sql` in prod. It is additive only, so it is safe before the deploy, and the old code ignores it. The PR is **not** eligible for auto-merge.
2. Merge and deploy with every referral var unset. Nothing changes for clinics. The webhook's referral hook and the cron return immediately because no coupon ids are configured.
3. Run the test-mode coupons and the §4.2 E2E on the local or test setup.
4. Legal review of `/indique`, the share text and the cookie (recommended, not a build blocker).
5. With Giorgio's OK: create the live coupons with the script, and enable the two new webhook events.
6. Run `pnpm --filter @floraclin/web referral:backfill-fingerprints` against prod (read-only on Stripe; it fills `billing_card_fingerprints` so not-new checks see existing customers).
7. Set `STRIPE_REFERRAL_PROMOTION_CODE_ID` and `STRIPE_REFERRER_COUPON_IDS` (web), then `REFERRAL_ENROLLMENT_ENABLED=true` in **web and site**, and redeploy both.
8. Day after: check the Sentry monitor `referral-reconcile` for a successful check-in.

### 4.7 Ending the program (runbook; settled decision 1)

1. Announce the end with ≥ 30 days' notice (email to referrers).
2. On the notice day, unset `REFERRAL_ENROLLMENT_ENABLED` (web + site), so new referrals stop at once. Set `REFERRAL_REWARDS_END_AT` (web + site) to the end instant. The `/indique` page stays published (P-5) and shows the end date.
3. Until the end date, discounts keep following the count. After it, the next sync (webhook, cron or draft safety net) writes 0% and no bonus, effective from the next invoice. Invoices already issued keep their discounts.

---

## 5. Plan review (adversarial, codex) — changes made

Review: 3 codex lenses (skeptic, architect, minimalist), synthesized verdict "REJECT as written → fix in plan". Every accepted finding is addressed below; no finding was rejected. Code facts the findings relied on were re-checked: `subscription-access.ts` ignores `current_period_end` for Stripe `active`; the billing query key is `['billing', 'usage']` (`billing-settings.tsx:380`); `getOrCreateCurrentPeriod` reads then writes an absolute total (`db/queries/whatsapp-credits.ts`); the checkout webhook overwrites the tenant's `stripe_subscription_id`; `winback.ts` (pure) vs `winback-offer.ts` (server) is the existing split; the prod DB pool is `max: 5` (`db/client.ts`), which drove the "one connection per sync" shape of the lock.

| ID | Finding | How it was addressed |
|---|---|---|
| H1 | Reward recompute not serialized; lock only covered the history insert | P-18. B3 `withReferrerRewardLock` (tx + `pg_advisory_xact_lock` + `lock_timeout`) wraps the **whole** `syncReferrerReward` (count, billing, Stripe sub + draft writes, bonus, history); all DB access in the sync goes through the lock's `tx` so a sync never needs a second pooled connection. `recordRewardStateIfChanged` no longer locks on its own. Emails after commit. C1 test with an in-memory mutex and deliberately interleaved / reversed syncs; B3 integration test for the lock. |
| H2 | Liveness from local `current_period_end` removes the discount at renewal | P-19. `hasLiveStripeSubscription` removed from A2. New A2 `subscription-state.ts` (`referrerSubscriptionState`) decides from the Stripe subscription the sync retrieves (active/trialing/past_due; cancel-at-period-end still open), mirroring `subscription-access.ts`. C1 test: expired local boundary + Stripe active keeps the coupon and doesn't touch the draft. C5 uses `canRefer` for the display-only next-invoice date. |
| H3 | Yearly referrer keeps its coupon; B5 bonus ignores monthly | P-19 splits `updatable` from `eligible`; updatable-but-ineligible (yearly, unpaid, gift row over a live sub) gets target 0 → our coupon removed from the sub and open drafts. The old C1 test asserting "yearly: no Stripe call" was replaced. B5 copies the bonus from the latest reward event (already eligibility-aware) instead of recomputing. C5 shows 0% for yearly. |
| H4 | Program end judged by delivery time | P-20. C1 `percentAt(at, …)`; each open draft is judged by its own `invoice.created`. Test: drafts created just before vs after the end instant, processed after it. |
| H5 | Changes after `invoice.created` never reach the draft | Every sync lists open `subscription_cycle` drafts (B4 `listOpenCycleDrafts`) and repairs them under the lock; `invoice.created` passes `draftInvoiceId` so that draft is covered even if the list lags. `fixDraftInvoiceDiscount` as a separate export removed. Test: second referral counts after the draft was processed → draft rewritten. |
| H6 | Fixed idempotency keys replay stale requests (20→40→20) | Dropped explicit idempotency keys for subscription and invoice discount updates (absolute-state bodies are naturally idempotent; SDK retry keys remain). `stateVersion` removed from `countCountingReferrals`. Tests in B4 (no key option) and C1 (20→40→20 issues three updates). |
| H7 | `referralOfferHeadline` in server `offer.ts` imported by a client component | New client-safe A2 `offer-copy.ts` (type-only server imports, like `winback.ts`) holds `PublicReferralOffer` + `referralOfferHeadline`; `offer.ts` is server-only and no longer defines/re-exports the headline. A2 import-allowlist test; D3 `client-import-boundary.test.ts`. Build stays recommended (needs env), per the verdict. |
| H8 | `limit: 100` lists lose evidence; R6 needs a paid invoice in the page | B4 list helpers auto-paginate (`autoPagingToArray`, cap 1000, cap hit → report). B1 R6 now lets persisted `firstPaidAt`/`qualifiedAt` carry the referral into R7. Tests: multi-page lists; counting referral with an empty invoice snapshot goes to `paused`. |
| M1 | ABA in status-only optimistic check | P-22. `tenant_referrals.version` (A1); every write bumps it; `updateReferralState` compares version. C2 saves with the context version and retries once with a fresh context. B3 integration test for the ABA. |
| M2 | Welcome coupon not re-validated at checkout | C3 step 5 runs `runEligibilityChecks(stage 'checkout')` (non-card identity) before any Stripe call; a verdict marks the referral ineligible with `checks.atCheckout` and returns no offer; loader errors fail closed (no coupon, full-price checkout). Tests for a phone added during the trial. |
| M3 | P-12 reads the mutable subscription row at qualification | P-12 rewritten: identity not-new is snapshotted at attribution (`checks.atSignup`) and re-run at checkout; at qualification only self-referral (all signals) + card not-new, with card evidence windowed by Stripe charge times (`billing_card_fingerprints.first_seen_at/last_seen_at`, new `last_seen_at` column, backfill uses real charge times). Limitation documented in P-12. Shared logic centralized in B2 `runEligibilityChecks`. |
| M4 | Binding falls back to the tenant's current sub id | P-21. B3 `bindReferralSubscription` (set only if null); D1 binds on `checkout.session.completed` before refresh; C2 binds the customer's **earliest** subscription (B4 `findEarliestSubscriptionId`, `status: 'all'`) and never uses the tenant row's id. Tests for cancel + resubscribe before the first refresh. |
| M5 | B5 stale read-then-overwrite of `credits_total` | B5 existing path computes `credits_total` in SQL from the stored `bonus_credits` (`CASE WHEN limit = -1 …`) with `RETURNING`; interleaving and plan-change tests. |
| M6 | Wrong React Query key | D2 invalidates `['billing', 'usage']`; test asserts the refetch. |
| M7 | Reconcile can starve reward syncs | P-23. Per-referrer units (refresh its referrals, then sync it), ordered by least-recently-reconciled (`tenant_referrals.reconciled_at`, A1), deadline checked per unit, stamps on attempt. B3 `listReconcileUnits` / `markReferralsReconciled`. Test: three consecutive deadline-limited runs rotate A → B → C. |
| M8 | Checkout awaits attribution with the switch off | C3 checkout route gates on `isReferralEnrollmentEnabled()` before any referral DB call and passes the single attribution result into `getValidatedReferralOffer` (`opts.attribution`); D2 usage route does the same. Tests assert no referral DB call when off and exactly one when on. |
| L1 | `MICA7K` contains excluded `I` | All fixtures/copy use `MECA7K` / `ME0A7K`; A2 test adds `'MICA7K'` → null. |
| L2 | `ReferralState` duplicated; B5 duplicated B3 access for parallelism | `ReferralState` moved to A2 `types.ts` (B1 re-exports it, B3 imports it). B5 no longer counts referrals or reads billing; it reads only the latest reward event (its own credits query). Groups unchanged in membership; see the note under §3. |

**Parallelization impact.** No task moved between groups. New files were assigned to existing owners (A2: `subscription-state.ts`, `offer-copy.ts` + tests; B3: integration test; D3: boundary test), and every new cross-module dependency points to an earlier group (§3 note). The A1 migration grew by three columns (`tenant_referrals.version`, `tenant_referrals.reconciled_at`, `billing_card_fingerprints.last_seen_at`) and stays additive only.

