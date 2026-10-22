# Referral program: "Indique e Ganhe FloraClin"

Date: 2026-10-21
Status: design, open questions answered by Giorgio, pending an implementation plan
Scope: `web` (billing, signup, settings, admin) and `site` (public rules page, referral landing)

Labels used in this doc:

- **Giorgio's decision**: settled by Giorgio in the 2026-10-21 brainstorm. Do not reopen.
- **Agent call**: decided while writing this doc. Giorgio can override any of them.
- **Builder call**: left to whoever builds it. Pick something reasonable and note it in the PR.

## 1. Intent

Most HOF (harmonização orofacial) professionals already act as influencers. They post their work every day to a following made up of patients and colleagues. FloraClin wants to give something back when they bring colleagues in.

The program is for **clinics that already use FloraClin** and would like to use it for free. It is not an affiliate network for outside influencers. It has two jobs:

1. **Acquisition.** Each referral link brings in new clinics, and those clinics get a better entry price.
2. **Retention.** A clinic with referrals pays less, or nothing, and loses that benefit if it leaves. Its reason to keep paying grows with every colleague it brings in.

The whole program fits in one sentence: **"Cada clínica indicada que está pagando vale 20% de desconto na sua assinatura. Com 5, o FloraClin sai de graça."**

### Research basis

- **Simples Dental, "Convide e Ganhe"** (https://ajuda.simplesdental.com/pt-BR/articles/9562813-programa-convide-e-ganhe-simples-dental) and **Clinicorp, "Programa de Indicação"** (https://www.clinicorp.com/programa-indicacao) are the closest Brazilian clinic-software peers. In both, each referred clinic that is currently paying takes a percentage off the referrer's monthly fee. The percentages stack up to 100%, and a referral stops counting when its clinic cancels. Simples Dental adds an uncapped consumable reward on top.
- **Fresha** (https://www.fresha.com/help-center/knowledge-base/wallets/101295-track-fresha-referrals) shows a referral list with a status for each referral, and pays a reward only once the referred business has gone live and paid. That is the model for our dashboard and for our "counts only after paying" rule.
- **Conta Azul, partner terms** (https://contaazul.com/termos/parceiros-v2/) is the cautionary case for cash. Paying individuals in Brazil means RPA receipts, tax withholding and partner contracts. This is one reason we pay no cash.
- **CONAR, Guia de Publicidade por Influenciadores Digitais** (http://conar.org.br/pdf/260525_GUIA_INFLUENCIADORES_CONAR_v6.pdf) says that a post bringing the author a benefit must disclose it clearly, for example with `#publi`, and that affiliate links must be identified.

Across the programs reviewed, no one keeps an ongoing discount for lifetime referrals. Only currently paying referrals count, rewards already given are never taken back, and a referral counts only after a waiting period or a real payment.

## 2. Goals, non-goals, anti-goals

**Goals**

- A paying clinic can find its referral link and share text in under a minute, from inside the product.
- Referred clinics get a visible, automatic entry discount with no code to type.
- The referrer's discount and WhatsApp bonus are applied with **no manual work by the FloraClin team**, every month, indefinitely.
- Every rule a clinic needs to understand is on one public page and is mirrored by the in-app dashboard. The dashboard always explains the current discount.
- Fake signups earn nothing.

**Success signals** (measure after 90 days; these are not launch gates): the share of new paying clinics that came from a referral, the share of paying clinics with at least one counting referral, and churn of clinics with referrals compared with clinics without.

**Non-goals**

- Outside affiliates or influencers who don't use FloraClin.
- Cash, Pix or any payout. Rewards never turn into money, store credit or account balance.
- Multi-level rewards. If A refers B and B refers C, A gets nothing for C.
- Verifying or rewarding social posts. Only the link is tracked.
- Named tiers, badges, leaderboards, Instagram or site features, or any other perk that someone has to maintain by hand.

**Anti-goals** (things the design must actively avoid)

- Rewarding a signup or a trial.
- Hidden or discretionary rules ("a critério da FloraClin" as the main mechanism).
- Clawing back a discount that was already applied.
- Anything that needs a monthly manual run.

## 3. Constraints from the codebase

- **Billing is Stripe Checkout with app-side trials.** The 14-day trial is a `tenant_subscriptions` row with `source='trial'`. It is not a Stripe trial. Checkout (`/api/billing/checkout`) reuses the row's `stripe_customer_id` when there is one. A trial row has none, so a clinic's first checkout creates its Stripe customer. Each checkout creates a **new** subscription, and its first invoice is paid at checkout (`billing_reason='subscription_create'`). Plan switches for live subscriptions go through `updateSubscriptionPrice` with proration.
- **The webhook re-reads Stripe.** `/api/webhooks/stripe` handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` and `customer.subscription.deleted`. Each handler re-reads the subscription with `retrieveSubscription` rather than trusting the event snapshot, because delivery order is not guaranteed. There is no event-id dedup table, so **every new handler must be an idempotent recompute from current state.** Only rows with `source='stripe'` follow Stripe (`findSubscriptionByStripeId`).
- **Local status mapping.** `localStatus()` maps Stripe `active` + `cancel_at_period_end` to our `canceled`, and maps `past_due`, `unpaid` and `paused` to `past_due`. A scheduled cancellation therefore already reads as `canceled` locally, even though the period is still paid.
- **There is a coupon precedent.** VOLTA30 (PR #94, `7b4ba81`) is a live Stripe coupon `POaAulps` (30%, repeating 3 months, `applies_to` Starter and Pro) with promotion code `STRIPE_WINBACK_PROMOTION_CODE_ID`. Checkout sets `discounts: [{ promotion_code }]` and falls back to full price on a promo error (`isPromotionCodeError`). The paywall, checkout and emails all get eligibility and copy from `getValidatedWinbackOffer` (`lib/winback-offer.ts`), so the clinic never sees a price that checkout won't honour.
- **Only the first discount is displayed.** `getSubscriptionDiscount` (`lib/stripe.ts`) shows only the **first** active subscription discount. It must learn to combine several (see §6.4).
- **WhatsApp credits are calendar-month periods.** `whatsapp_credits` has one row per tenant per BRT month. `getOrCreateCurrentPeriod` **overwrites** `credits_total` with `plans.limits->>'whatsapp_credits'` on every call (free 20, starter 300, pro 1000; `-1` means unlimited). A bonus therefore cannot just be added to `credits_total`. It needs its own column (see §7). `whatsapp_credit_ledger` records spends and refunds only.
- **Signup data.** Signup (`actions/signup.ts`) collects full name, email, password, clinic name and phone, both by password and by Google OAuth (`createClinicForOAuthUser`). There is **no CPF or CNPJ** anywhere on tenants or users. Users can carry a professional registry (`registry_type`, `registry_number`, `registry_state`). `tenants.signup_attribution` (jsonb) holds the first-touch UTMs from the `floraclin_ft` cookie, which the site and app set on `.floraclin.com.br`.
- **Admin guards.** Since PR #94, admin gift, manual status changes, "Estender teste" and cancel are blocked on Stripe-driven rows. Gifted rows have `source='gift'` or `'admin'`.
- **Schema changes are manual.** Adding the tables and columns is a DB change, so the PR is **not** eligible for auto-merge and Giorgio applies the migration in prod (repo pattern: `web/src/db/migrations/NNNN_*.sql`).

## 4. Giorgio's decisions

1. **Purpose:** both acquisition and retention. The users are existing FloraClin clinics (HOF professionals who are also influencers) who want to use FloraClin for free. They are not outside affiliates.
2. **Fake signups are the main fear.** A signup or trial earns nothing, a paid subscription is the real conversion, and the program is fully transparent.
3. **Dead simple, with no named tiers.** There is one rule plus a progress bar: "3 de 5 clínicas pagantes, faltam 2 para FloraClin grátis".
4. **No manual perks** such as Instagram or site features or badges. Every reward is automatic and inside the product.
5. **Referrer reward:** 20% off its own subscription for each referred clinic that is **currently paying**, up to 100% (free) at 5. A referral **counts once its 2nd invoice is paid** and **stops counting when that clinic cancels or becomes overdue**. Discounts already applied are **never clawed back**.
6. **Past the cap:** each extra currently paying referral gives **+100 WhatsApp credits per month**.
7. **Referred clinic:** the normal 14-day trial plus **20% off its first 2 paid months**, applied automatically at checkout through the referral link.
8. **No reward for social posts on their own.** Only the link is tracked. **No cash payouts.**
9. **Only clinics paying through Stripe can refer** (PR #96 review). Gifted clinics, such as Dra. Micaela's, get no link (§5.1).
10. **If the program ends** (PR #96 review): FloraClin gives 30 days' notice. New referrals stop immediately. Existing discounts keep following the count until the end date, then drop to 0% from the next invoice. Past invoices are never touched (§6.1).

## 5. Rules as the clinic sees them

### 5.1 Who can refer (Giorgio's decision)

A clinic can refer only while it is **paying through Stripe**: `tenant_subscriptions.source='stripe'` and local `status='active'`. Trial clinics, expired clinics and gifted or admin clinics (`source='gift'|'admin'`) don't get an active link. This includes gifted influencer clinics such as Dra. Micaela's. Their "Indique e Ganhe" page explains: "Seu link de indicação fica ativo quando sua clínica tem uma assinatura paga."

If the referrer stops paying, its code goes inactive. Signups that arrive through an inactive code are **not attributed**, and the visitor sees the normal site with no discount. Referrals captured while the code was active stay attributed.

### 5.2 What counts as a referral

- **Attribution to the link used at signup** (agent call). The clinic is attributed to the code it carried when it **created its account**: the `floraclin_ref` cookie from the link, or the code field on the signup form. A clinic with no code at signup can enter one on the billing page **before its first payment**. After the first payment the attribution is locked and can never change. Checkout always uses the stored attribution, never the cookie.
- **Only clinics new to FloraClin qualify** (agent call). The referred clinic is ineligible if its owner's email, owner or clinic phone, any professional registry (type, number and state) of its users, or (at qualification) its card fingerprint matches **another tenant that had a trial, gifted or paid subscription in the 6 months before the referred signup**. This includes deleted tenants.
- **No self-referral** (agent call). The referral is ineligible if the referred clinic and the referrer share any of: owner email, a non-public email domain (anything outside a list of webmail providers such as gmail.com, hotmail.com, outlook.com, yahoo.com.br, icloud.com, uol.com.br, bol.com.br), owner or clinic phone, a professional registry of any user, a user (the same `users.id` in both tenants), or a card fingerprint on any paid invoice. **CPF and CNPJ are not collected today, so they are not used.** Adding a document field to signup adds friction for every clinic just to catch a rare case, and the card and registry checks already cover it. If Stripe tax-ID collection is turned on later, add the document to both lists.
- **Rewards never become cash** (agent call). The referrer's reward exists only as a discount on its own FloraClin subscription and as WhatsApp credits. It is lost if the referrer has no subscription. It can't be transferred, refunded, paid out or carried over.

### 5.3 Referral lifecycle

| Internal status | Dashboard label (pt-BR) | Meaning | Counts? |
|---|---|---|---|
| `trial` | **em teste** | Signed up, has not paid yet (trial running) | No |
| `trial_ended` | **teste encerrado** | Trial ended without paying (it can still subscribe later) | No |
| `first_paid` | **pagante** · "conta a partir da 2ª mensalidade" | 1st invoice paid, waiting for the 2nd | No |
| `counting` | **pagante** | 2nd invoice paid, subscription active | **Yes** |
| `paused` | **pagante** · "pagamento pendente" or "cancelamento agendado" | Overdue (`past_due`), or cancellation scheduled | No |
| `canceled` | **cancelada** | Stripe subscription deleted. **Terminal**: if the clinic comes back it does not count again | No |
| `ineligible` | **não elegível** · short reason | Failed the new-clinic or self-referral check, a chargeback, or marked by a platform admin | No |

Giorgio named three statuses: em teste, pagante and cancelada. The extra labels (agent call) are sublabels of those three or plain facts. Without them the dashboard would contradict the rules, for example by showing "pagante" for a clinic that doesn't count yet.

Transition rules:

- **Qualifying ("2nd invoice paid").** The referred subscription's first invoice with `billing_reason='subscription_cycle'` reaches `paid` with `amount_paid > 0`. Proration invoices (`subscription_update`) never qualify. This is about one month after checkout. The referred clinic's own 20%-off coupon is still running then, so the amount is above zero.
- **Overdue** (local `past_due`) moves `counting` to `paused`. Recovery (back to local `active`) moves `paused` back to `counting` **without** waiting again. A clinic that was overdue is still the same clinic (agent call: "stops counting while overdue" is read as a pause, not an end).
- **Scheduled cancellation** (local `canceled` while the period is open) moves `counting` to `paused`. Reactivation moves it back to `counting`. **Subscription deleted** (`customer.subscription.deleted`, or local `canceled` with the period closed) moves the referral to `canceled`, which is terminal (agent call: "a clinic that cancels and comes back does not count again").
- A referral that never qualified and is canceled goes to `canceled` as well.
- **Chargeback** (`charge.dispute.created` on any invoice of the referred subscription) moves the referral to `ineligible` permanently (agent call).
- **Refunds** have no effect on their own (agent call). Counting follows the subscription status. A full-refund-then-cancel trick needs two real paid invoices first, and the discounts already applied stay (Giorgio's no-clawback rule).

### 5.4 Monthly plans only (agent call, from the builder check)

Every plan on sale today is monthly (Starter R$ 99, Pro R$ 199). The `plans.billing_interval` column and the `/ano` label exist, but no yearly plan is sold. The program is **monthly-only**:

- Checkout applies the welcome coupon only to a plan with `billing_interval='month'`.
- `syncReferrerReward` applies a referrer discount only to a monthly subscription.
- A referred clinic on a yearly plan is recorded but stays at `first_paid` and never counts.

All three checks read one `isReferralEligiblePlan(plan)` helper. **Before any yearly plan launches**, this doc must get annual rules: the qualifying moment, the welcome coupon (20% of a whole year), and the timing of the referrer's discount.

### 5.5 Rewards

- **Discount:** `percent = 20 × min(counting, 5)`.
- **WhatsApp bonus:** `100 × max(counting − 5, 0)` extra credits per BRT calendar month, on top of the plan's credits. Plans with unlimited credits (`-1`) get no bonus.
- **No multi-level rewards.** Only direct referrals count.

## 6. Stripe mechanics

### 6.1 Coupons (created once)

| Coupon id | Terms | Used by |
|---|---|---|
| `floraclin_referral_new_20x2` + promotion code `STRIPE_REFERRAL_PROMOTION_CODE_ID` | 20% off, `repeating`, 2 months, `first_time_transaction`, metadata `{purpose: referral_welcome, app: floraclin}` | Referred clinic at checkout |
| `floraclin_referrer_20`, `_40`, `_60`, `_80`, `_100` | 20/40/60/80/100% off, `forever`, metadata `{purpose: referral_reward, app: floraclin, percent}` | Referrer subscription |

Neither set uses `applies_to` (agent call). A coupon's `applies_to` can't be edited after it is created, so a future plan or product would otherwise need a whole new coupon set. Our Stripe account sells only these subscriptions. Coupons are created by a one-off script, first in test mode and then in the live account `acct_1TiQxzEZFziZ0c3G`. **The live creation needs Giorgio's explicit OK**, as VOLTA30 did. All ids come from env vars (`STRIPE_REFERRAL_PROMOTION_CODE_ID`, `STRIPE_REFERRER_COUPON_IDS` as a comma list or five vars, builder call). The program is **off until they are set**, mirroring `STRIPE_WINBACK_PROMOTION_CODE_ID`.

**Two switches** (agent call, from the builder check). These do different things, and confusing them would silently freeze or wipe rewards:

- `REFERRAL_ENROLLMENT_ENABLED` controls **new** activity: active links, new attributions and the welcome coupon at checkout. Turning it off stops the program growing.
- **The reward sync never reads that switch.** As long as the coupon ids are configured, `syncReferrerReward`, the webhooks and the daily cron keep each referrer's discount equal to its current count. So when enrollment is off, the discounts wind down naturally as referrals churn. They are never frozen at their last value.
- **Ending the program (Giorgio's decision, §4.10)** is a separate, explicit operation. With 30 days' notice, enrollment is switched off at once, so no new links, attributions or welcome coupons. `REFERRAL_REWARDS_END_AT` is set to the end date. Until that date the sync keeps each discount following the current count. From the first invoice created after it, the sync writes 0% and no bonus. Invoices already issued are never touched.

### 6.2 Referred clinic at checkout

`/api/billing/checkout` decides the coupon on the server from the stored attribution:

- **Exactly one coupon** (agent call, no stacking with VOLTA30). If the clinic is eligible for VOLTA30 (`getValidatedWinbackOffer` returns an offer), **VOLTA30 wins**. Otherwise, if it has an active referral attribution and passes the new-clinic check, the referral promotion code applies.
- **Why VOLTA30 wins:** it is the better deal for the clinic (30% × 3 against 20% × 2). The paywall has already promised it to exactly that clinic, and showing a smaller discount at checkout would break trust. **The referrer still gets credit**, because attribution is independent of the coupon. Stripe rejects the second code anyway because of `first_time_transaction`.
- The paywall, plan cards and billing page use a `getValidatedReferralOffer` that mirrors `getValidatedWinbackOffer` (validated against Stripe, label built from the coupon, cached). The prices shown always match checkout. Paywall copy: "Indicação de {nome da clínica}: 20% de desconto nos 2 primeiros meses."
- On a promotion error, fall back to full price and report it, using the same `isPromotionCodeError` path. A referred clinic is never blocked from paying.
- The Checkout Session metadata gets `referralId` for traceability.

### 6.3 Referrer discount: apply and recompute

The rule is "Stripe holds exactly one `floraclin_referrer_*` discount on the referrer's subscription, matching its current count". **This is a recompute, not an increment.**

`syncReferrerReward(referrerTenantId)`:

1. Count the referrer's referrals in `counting` (DB).
2. Load the referrer's row. If it isn't Stripe-driven or has no live subscription, there is nothing to apply in Stripe. Record the state and stop.
3. Retrieve the subscription with `discounts` expanded. Keep every discount whose coupon is **not** `purpose=referral_reward` (for example its own VOLTA30 or referral welcome coupon) by passing `{ discount: di_… }`. Replace or remove the referral one with `floraclin_referrer_{percent}`, or drop it at 0.
4. Call `subscriptions.update(sub, { discounts: [...kept, ...referral], proration_behavior: 'none' })` only when the percent differs. Use an idempotency key `referral:{subId}:{percent}:{referralStateVersion}`. Stripe documents that updating `discounts` creates no proration and no invoice, and that **the new discount applies the next time the subscription creates an invoice**.
5. Recompute the WhatsApp bonus for the current month (§7).
6. Write a `referral_reward_events` row when the percent or bonus changed, for the dashboard history and the email.

**When it runs:**

- **Webhook triggers** (existing events, plus new subscriptions in the Stripe dashboard). Every event on a **referred** subscription first updates that referral's status, then calls `syncReferrerReward(referrer)`. Every event on a **referrer** subscription calls `syncReferrerReward(self)`, which covers a resubscribe or plan switch.
  - `invoice.paid` → qualification, recovery.
  - `invoice.payment_failed` / `customer.subscription.updated` → `past_due`, scheduled cancellation, reactivation, plan change.
  - `customer.subscription.deleted` → terminal `canceled`.
  - **New:** `invoice.created` → safety net for the referrer's renewal draft (below).
  - **New:** `charge.dispute.created` → `ineligible`.
- **`invoice.created` safety net.** Renewal invoices sit in `draft` for about an hour, and they take the discounts the subscription had when the draft was created. When a draft `subscription_cycle` invoice of a referrer is created, recompute the count. If the draft's referral discount differs, update the **draft invoice's** `discounts` before it finalizes (keep the non-referral ones). This closes the race where a referral changes status minutes before the referrer's renewal.
- **Daily reconcile cron** (`vercel.json`, about 04:30 BRT). Run `syncReferrerReward` for every referrer with any referral not in `canceled`/`ineligible`, plus `trial → trial_ended`. This catches lost webhooks. It is idempotent.

**Timing the clinic sees:** a change counts on the **next** invoice. Mid-cycle changes never prorate. A discount already on a finalized invoice stays (no clawback).

**Stacking on the referrer's own entry coupon** (agent call). A referrer in its own first months can still carry VOLTA30 or the welcome 20%. Both discounts stay, and Stripe applies them **in sequence**: with 20% + 30%, the clinic pays 0.8 × 0.7 = 56%. That window is at most 3 months, and the referrer always pays at most `(100 − percent)%`. This keeps the sync simple: never remove a discount we don't own.

**100% case.** The invoice totals R$ 0,00, Stripe marks it paid without charging the card, and the subscription stays `active`. The referrer keeps counting as "paying" for its own referrer, if any, and for §5.1. A referral it makes still needs `amount_paid > 0` on **that** referral's 2nd invoice.

### 6.4 Display

`getSubscriptionDiscount` (`lib/stripe.ts`) currently returns only the first active discount. It must combine every active discount in Stripe's order and expose a separate `referral` part. That way Configurações › Assinatura shows, for example: "R$ 99,00 → R$ 59,40/mês · 40% de desconto por 2 indicações pagantes", and "até dd/MM" for the entry coupon when it applies.

## 7. WhatsApp bonus

- Add `whatsapp_credits.bonus_credits integer not null default 0` and `bonus_source varchar` (`'referral'`).
- `getOrCreateCurrentPeriod` sets `credits_total = plan_limit + bonus_credits`. If `plan_limit = -1`, it stays `-1`. This keeps the "credits_total follows the plan" overwrite intact.
- `syncReferrerReward` sets `bonus_credits = GREATEST(bonus_credits, 100 × max(counting − 5, 0))` on the **current** month's row, so the bonus only rises within a month (no clawback). The next month's row starts from the count at its creation and is raised by later syncs.
- No ledger lines for the bonus, since the ledger records spends and refunds. The credit-usage UI shows "inclui +{n} créditos de indicação".

## 8. Data model sketch

```text
tenants
  + referral_code varchar(12) unique null   -- e.g. "MICA7K"; random, A–Z/2–9 without ambiguous chars; created on first visit to the page
                                            -- the clinic can replace it with its own (4–12 A–Z/0–9, e.g. DRAMICAELA)
floraclin.referral_code_aliases (0044)      -- retired codes: (code pk, tenant_id, retired_at). An old code keeps
                                            -- resolving to the same clinic forever and no other clinic can claim it;
                                            -- after 5 old codes the clinic can only switch back to one of them.

tenant_referrals                              -- one row per referred clinic
  id uuid pk
  referrer_tenant_id uuid not null fk tenants
  referred_tenant_id uuid not null unique fk tenants
  code varchar(12) not null                   -- the code used
  captured_via varchar(12) not null           -- 'link' | 'signup_field' | 'billing_page'
  captured_at timestamptz not null
  status varchar(16) not null                 -- trial | trial_ended | first_paid | counting | paused | canceled | ineligible
  ineligible_reason varchar(32) null          -- self_referral | not_new | chargeback | admin
  checks jsonb not null default '{}'          -- which signals matched (never shown raw to the referrer)
  stripe_subscription_id varchar(255) null    -- the referred clinic's first Stripe subscription
  first_paid_at timestamptz null
  qualified_at timestamptz null               -- 2nd invoice paid
  qualifying_invoice_id varchar(255) null
  ended_at timestamptz null
  created_at, updated_at
  index (referrer_tenant_id, status)

referral_reward_events                        -- append-only history behind the dashboard and emails
  id uuid pk
  referrer_tenant_id uuid not null fk tenants
  counting int not null
  discount_percent int not null
  bonus_credits int not null
  stripe_subscription_id varchar(255) null
  reason varchar(32) not null                 -- referral_counting | referral_paused | referral_canceled | reconcile | invoice_draft
  referral_id uuid null fk tenant_referrals
  created_at timestamptz not null default now()

whatsapp_credits
  + bonus_credits int not null default 0
  + bonus_source varchar(16) null
```

Attribution capture: the site and app middleware read `?ref=CODE`, or the landing `/indicacao/{CODE}`, and set `floraclin_ref` on `.floraclin.com.br` (httpOnly, 60 days). **The last link clicked before signup wins.** It is a separate cookie from `floraclin_ft`. Agent call: it is a functional cookie, because it carries the discount the visitor came for. The legal review should confirm this. Signup (password and Google) reads the cookie, or the code field, and creates the `tenant_referrals` row when the code is active. The row is created in `trial` or `ineligible`.

## 9. Product surfaces (pt-BR copy)

### 9.1 In-app: Configurações › Indique e Ganhe (owner only)

- Link: `https://floraclin.com.br/indicacao/{CODE}`, with "Copiar link", "Compartilhar no WhatsApp" and "Copiar texto para Instagram".
- Progress bar: **"3 de 5 clínicas pagantes, faltam 2 para FloraClin grátis"**. At 5: **"5 de 5: seu FloraClin está grátis 🎉"**. Above 5: **"+200 créditos de WhatsApp por mês com 7 clínicas pagantes"**.
- Current discount: **"Seu desconto atual: 60% (R$ 59,40 de R$ 99,00) a partir da próxima fatura, em dd/MM."**
- Referral list: clinic name, signup date and the status label from §5.3. A "não elegível" referral shows a generic reason ("mesma clínica ou profissional", "clínica já usou o FloraClin", "contestação de pagamento"), never the matched data.
- History of the last discount changes, from `referral_reward_events`.
- Link to the rules page.
- When the clinic isn't paying, the page shows the explanation from §5.1 and no link.

### 9.2 Share text (agent call)

It discloses the benefit (CONAR), makes no clinical-result claims, and is framed between professionals:

> Uso o FloraClin na minha clínica para agenda, prontuário e lembretes por WhatsApp. Se você também é profissional da saúde estética e quer testar, pelo meu link você ganha 14 dias grátis e 20% de desconto nos 2 primeiros meses: {link}
> Ganho desconto na minha assinatura se você assinar. #publi #linkafiliado

Rules for any variant: no before and after photos, no patient images, no promise of results, and no "melhor/único" superlatives. The text recommends a management tool to colleagues and doesn't advertise a clinical service to patients. That framing matters under **CFM Resolução 2.336/2023** and **CFO Resolução 196/2019**, which restrict publicity by doctors and dentists.

### 9.3 Public rules page: `floraclin.com.br/indique`

It sits alongside `/termos` in `site`. In pt-BR it covers who can refer, what the referred clinic gets, how the discount is calculated (with a 5-row table), when a referral counts, pauses and ends, the WhatsApp bonus, the eligibility rules (new clinic, no self-referral), no cash, chargebacks, the required disclosure (#publi #linkafiliado), and the ending terms from §4.10 (30 days' notice, new referrals stop at once, discounts follow the count until the end date and then drop to 0% from the next invoice, and past invoices are never touched). The dashboard links here, and both use the same numbers from one shared constants module.

### 9.4 Referral landing `/indicacao/{CODE}`

The normal homepage hero, plus a banner: "{Nome da clínica} indicou o FloraClin para você: 14 dias grátis + 20% de desconto nos 2 primeiros meses." The CTA goes to signup. An inactive or unknown code shows the normal page with no banner.

### 9.5 Emails (agent call: only when the reward changes)

- To the referrer, when its discount or bonus changes: "Sua indicação {clínica} começou a contar: seu desconto agora é de 40% a partir da próxima fatura." The same goes for a pause or an end, without blame: "deixou de contar".
- No email to the referrer when someone signs up (a trial earns nothing, and the email would only invite gaming).

### 9.6 Admin

The platform admin tenant page shows the referrer, the referrals and the reward history. It has one action: "Marcar indicação como não elegível" with a reason, which moves the referral to `ineligible` and runs a sync. It has no way to grant discounts by hand.

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Referrer on a gift or admin plan, or in trial | No active link (§5.1). Its "Indique e Ganhe" page explains why. No rewards. |
| Referrer churns (subscription deleted) | Its code goes inactive. Its referrals keep their own status. When it subscribes again, checkout runs as normal and its new subscription gets the discount at the next sync (from its 2nd invoice; the first is charged at the price shown at checkout). |
| Referrer on scheduled cancel or `past_due` | The code goes inactive while the local status isn't `active`. The discount stays on the Stripe subscription, which keeps billing until it ends. |
| Referred clinic upgrades or downgrades | It still counts as one clinic (20% each, regardless of plan). Its welcome coupon has no `applies_to`, so it carries over. |
| Referrer upgrades or downgrades | The percentage scales with the new price. `updateSubscriptionPrice` doesn't touch discounts. |
| Plan price change | The percentage coupons need no change. The next invoice uses the new price. |
| Refund of a referred invoice | No status change by itself (§5.3). |
| Chargeback on a referred invoice | `ineligible`, permanent. |
| Referred clinic cancels before its 2nd invoice | `canceled`, never counted. |
| Referred clinic comes back after `canceled` | Doesn't count again. Its new subscription gets no welcome coupon (`first_time_transaction` and a used attribution). |
| Referred clinic is also eligible for VOLTA30 | VOLTA30 applies, and the referral still counts for the referrer (§6.2). |
| A referrer that was itself referred | Both discounts apply in sequence while its entry coupon lasts (§6.3). It counts for its own referrer as normal. |
| Referrer at 100% | The R$ 0 invoice is paid automatically and the subscription stays active (§6.3). |
| More than 5 counting, then some pause | The discount stays at 100% as long as 5 or more are counting. The bonus drops at the next month's period (never within the month). |
| Two tenants owned by the same user | Self-referral (the same `users.id`). |
| Referred clinic is deleted by an admin | Treated like `canceled` at the next reconcile. |
| Stripe unavailable during sync | The handler throws, the webhook returns 500, and Stripe redelivers. The daily cron catches the rest. |

## 11. Rollout

1. Migration (manual, by Giorgio): `tenants.referral_code`, `tenant_referrals`, `referral_reward_events`, and `whatsapp_credits.bonus_credits` and `bonus_source`.
2. Test-mode coupons and an E2E run on the local test setup (as in PR #94): A refers B, B pays twice, A's next invoice shows 20%. Also test pause and recovery, cancel, 100%, and the bonus.
3. **Legal review** of the rules page and the share text (CONAR, CFM 2.336/2023, CFO 196/2019, LGPD for the cookie) before turning it on. Recommended, not a blocker for building.
4. Live coupons (with Giorgio's OK), then set the env vars. The program turns on when they are set. Enable `invoice.created` and `charge.dispute.created` on the live webhook endpoint.

## 12. Left to the builder

Builder calls:

- Code alphabet and length, and how a clinic name is shortened in the landing banner.
- Env var shape for the five referrer coupons.
- The cron time, and batching for the reconcile job.
- Exact page layout. Follow the PR #94 paywall style (Starter-first and so on doesn't apply here).
- Where the shared constants module lives (`20`, `5`, `100`, the 6-month window, the 60-day cookie) so that `site` and `web` read the same numbers.
- Test structure. Unit-test the status machine and `syncReferrerReward` with the Stripe calls injected, following the `WinbackDeps` pattern.

## 13. Open questions for Giorgio

None. Giorgio answered both questions on PR #96 (2026-10-21), and his answers are recorded as decisions 9 and 10 in §4.

## 14. Builder check log (2026-10-21)

A fresh reviewer (Claude Code, `claude -p`) read this doc and the codebase, and raised:

- **Checkout "always creates a new Stripe customer" was wrong.** It reuses the stored customer. *Fixed in §3.* The `first_time_transaction` reasoning still holds, because a trial row has no customer.
- **Annual plans: are they in scope, and under what rules?** *Settled as an agent call (§5.4):* monthly-only, gated by one helper, and the doc must be revisited before any yearly plan is sold.
- **Kill switch: freeze or wind down existing discounts?** *Split.* The mechanics are an agent call (§6.1: enrollment switch, with the sync always running). The ending promise was decided by Giorgio (§4.10).
