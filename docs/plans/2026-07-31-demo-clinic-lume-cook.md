# Clínica Lumé demo seed: implementation plan

> **For agentic workers:** implement task-by-task. Steps use `- [ ]` for tracking.

**Goal:** a re-runnable script that seeds a fictional tenant, Clínica Lumé, with
six months of believable history, so every screen is worth screenshotting.

**Architecture:** pure generators in `web/src/lib/demo-seed/` (unit-testable with
the existing vitest setup), thin DB runners in `web/scripts/demo-clinic/`. All
dates are relative to the run date. All writes are direct DB inserts, never
through the app's API, so no automation, WhatsApp send or email can fire.

**Tech stack:** TypeScript, Drizzle, Postgres. Tests run against local Docker
Postgres only, never Supabase.

**Out of scope for this pipeline:** running the seed against production. That is
a manual, human-authorised step.

---

## Design constraints, verified against the code

These are facts checked in the source, not assumptions. Violating any of them
produces a wrong screen.

1. `getQuickStats` shows only: distinct patients with appointments this ISO week,
   count of `procedure_records` by `performed_at` this month, and sum of
   `installments.amount` where `status='paid'` and `paid_at` this month.
   No goal, no ticket médio, no new-vs-returning. Those are not seeded.
2. `getRevenueOverview` summary filters on `financial_entries.created_at`; the
   monthly chart groups by `installments.paid_at`. **Both must be back-dated.**
3. `totalPending` counts only `status='pending' AND due_date >= CURRENT_DATE`.
   Anything earlier lands in `totalOverdue`. The R$ 7.800 must be due next month.
4. `netProfit = totalReceived - totalExpenses`, cash based.
5. `expense_installments` has **no `tenant_id`**; it joins through `expenses`,
   and the overview filters `expenses.created_at`. Back-date the expense, not
   just the installment.
6. `users.id` has **no default** (it mirrors Supabase auth ids). Generate it.
7. `tenant_subscriptions.plan_id` references an existing row in `plans`. Look it
   up, never create one.
8. The WhatsApp cron keeps a tenant when `settings.whatsapp_mode` is unset or
   `'floraclin'`. Must be set to `'own'` with `whatsapp_enabled: false`.
9. `procedure_types.category` is `NOT NULL`.
10. `patients.phone` is `NOT NULL`.

---

## File structure

| File | Responsibility |
|---|---|
| `web/src/lib/demo-seed/config.ts` | Every constant: clinic identity, catalogue, targets, safety values |
| `web/src/lib/demo-seed/types.ts` | Shared shapes passed between generators and the runner |
| `web/src/lib/demo-seed/identity.ts` | CPF, phone, email, name generation |
| `web/src/lib/demo-seed/revenue.ts` | Solves the procedure mix and installment split to the targets |
| `web/src/lib/demo-seed/schedule.ts` | History slots and the forward 15-day window |
| `web/src/lib/demo-seed/clinical.ts` | Anamnesis, procedure notes and face-diagram content |
| `web/scripts/demo-clinic/seed.ts` | Orchestrates all DB writes in FK order |
| `web/scripts/demo-clinic/teardown.ts` | Deletes the tenant and everything keyed to it |
| `web/scripts/demo-clinic/verify.ts` | Asserts targets through the real queries; `--safety-only` mode |

---

## Group A: shared contracts

Everything else imports from these, so they land first and alone.

### Task A1: config and types

**Files:**
- Create: `web/src/lib/demo-seed/config.ts`
- Create: `web/src/lib/demo-seed/types.ts`
- Test: `web/src/lib/demo-seed/__tests__/config.test.ts`

- [ ] **Step 1: Write `config.ts`**

```ts
/**
 * Clínica Lumé: a fictional tenant used to produce marketing screenshots.
 *
 * Every value here is deliberate. The financial targets are reproduced by
 * `revenue.ts` and asserted by `verify.ts`, so changing one without the other
 * makes the seed fail loudly rather than produce a wrong screenshot.
 */

/** Fixed so re-runs replace the same tenant instead of accumulating copies. */
export const DEMO_TENANT_ID = '00000000-0000-4000-8000-00000000d3m0'
export const DEMO_SLUG = 'clinica-lume'

export const CLINIC = {
  name: 'Clínica Lumé',
  city: 'São Paulo',
  state: 'SP',
  email: 'contato@example.com',
  phone: '(11) 90000-0100',
} as const

export const PRACTITIONER = {
  fullName: 'Dra. Camila Ferreira',
  email: 'camila.ferreira@example.com',
  professionalTitle: 'Cirurgiã-dentista',
  registryType: 'CRO',
  registryNumber: '12.847',
  registryState: 'SP',
} as const

/**
 * Keeps the tenant out of the WhatsApp automations cron. The cron keeps a
 * tenant when the mode is unset or 'floraclin', so both fields are required:
 * the mode alone would still pass if whatsapp_enabled were truthy.
 */
export const SAFETY_SETTINGS = {
  whatsapp_mode: 'own',
  whatsapp_enabled: false,
  is_demo: true,
} as const

/** RFC 2606 reserves example.com, so no address can receive real mail. */
export const EMAIL_DOMAIN = 'example.com'
/** Prefix chosen so a leaked send cannot reach a real subscriber. */
export const PHONE_PREFIX = '(11) 90000-0'

export const PATIENT_COUNT = 50

export interface CatalogueItem {
  name: string
  category: string
  price: number
  durationMin: number
}

export const CATALOGUE: CatalogueItem[] = [
  { name: 'Harmonização facial completa', category: 'harmonizacao', price: 4500, durationMin: 120 },
  { name: 'Bioestimulador de colágeno (Sculptra)', category: 'bioestimulador', price: 2200, durationMin: 60 },
  { name: 'Toxina botulínica completa', category: 'toxina', price: 1800, durationMin: 45 },
  { name: 'Toxina botulínica parcial (glabela/testa)', category: 'toxina', price: 900, durationMin: 30 },
  { name: 'Preenchimento de olheiras', category: 'preenchimento', price: 1600, durationMin: 60 },
  { name: 'Preenchimento malar', category: 'preenchimento', price: 1500, durationMin: 60 },
  { name: 'Preenchimento labial', category: 'preenchimento', price: 1400, durationMin: 45 },
  { name: 'Skinbooster', category: 'skinbooster', price: 1200, durationMin: 45 },
  { name: 'Limpeza de pele profunda', category: 'estetica', price: 350, durationMin: 60 },
]

/** Current-month targets, all reproduced by revenue.ts. */
export const TARGETS = {
  proceduresThisMonth: 23,
  grossThisMonth: 42000,
  receivedThisMonth: 34200,
  pendingThisMonth: 7800,
  expensesThisMonth: 8400,
  /** receivedThisMonth - expensesThisMonth, computed by the app. */
  netProfitThisMonth: 25800,
} as const

/**
 * The catalogue admits no combination of 23 items totalling exactly 42.000.
 * The closest natural mix lands on 40.850, so one Harmonização is sold as a
 * package at PACKAGE_PRICE, which is how a clinic actually closes that gap.
 */
export const MONTH_MIX: Array<{ name: string; qty: number }> = [
  { name: 'Harmonização facial completa', qty: 2 },
  { name: 'Bioestimulador de colágeno (Sculptra)', qty: 3 },
  { name: 'Toxina botulínica completa', qty: 6 },
  { name: 'Toxina botulínica parcial (glabela/testa)', qty: 3 },
  { name: 'Preenchimento de olheiras', qty: 2 },
  { name: 'Preenchimento malar', qty: 2 },
  { name: 'Preenchimento labial', qty: 2 },
  { name: 'Skinbooster', qty: 2 },
  { name: 'Limpeza de pele profunda', qty: 1 },
]
export const PACKAGE_PRICE = 5650

/** Received per month, oldest first; the last entry is the current month. */
export const SIX_MONTH_RECEIVED = [18200, 22500, 26800, 29400, 37100, 34200] as const

export const MONTHLY_EXPENSES = [
  { description: 'Aluguel da clínica', category: 'Aluguel', amount: 4500 },
  { description: 'Materiais e insumos', category: 'Materiais', amount: 2600 },
  { description: 'Plataformas e sistemas', category: 'Plataformas', amount: 1300 },
]

export const FORWARD_DAYS = 15
export const MIN_PER_DAY = 3
export const MAX_PER_DAY = 5
export const TODAY_APPOINTMENTS = 4
```

- [ ] **Step 2: Write `types.ts`**

```ts
export interface SeededPatient {
  id: string
  fullName: string
  cpf: string
  birthDate: string
  gender: 'feminino' | 'masculino'
  email: string
  phone: string
  referralSource: string
}

export interface PlannedProcedure {
  procedureName: string
  price: number
  /** BR calendar day, YYYY-MM-DD. */
  date: string
  startTime: string
  endTime: string
  patientIndex: number
}

export interface PlannedEntry {
  procedure: PlannedProcedure
  totalAmount: number
  installments: Array<{
    number: number
    amount: number
    dueDate: string
    status: 'paid' | 'pending'
    /** Only set when paid. */
    paidAt?: string
    paymentMethod?: string
  }>
}
```

- [ ] **Step 3: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { CATALOGUE, MONTH_MIX, TARGETS, PACKAGE_PRICE, SIX_MONTH_RECEIVED, SAFETY_SETTINGS } from '../config'

describe('demo-seed config', () => {
  it('mixes exactly the targeted number of procedures', () => {
    expect(MONTH_MIX.reduce((n, m) => n + m.qty, 0)).toBe(TARGETS.proceduresThisMonth)
  })

  it('reaches the gross target once the package price is applied', () => {
    const priceOf = (name: string) => CATALOGUE.find((c) => c.name === name)!.price
    const listTotal = MONTH_MIX.reduce((sum, m) => sum + priceOf(m.name) * m.qty, 0)
    const uplift = PACKAGE_PRICE - priceOf('Harmonização facial completa')
    expect(listTotal + uplift).toBe(TARGETS.grossThisMonth)
  })

  it('splits gross into received and pending', () => {
    expect(TARGETS.receivedThisMonth + TARGETS.pendingThisMonth).toBe(TARGETS.grossThisMonth)
  })

  it('derives net profit the way the app does', () => {
    expect(TARGETS.receivedThisMonth - TARGETS.expensesThisMonth).toBe(TARGETS.netProfitThisMonth)
  })

  it('ends the six-month series on the current month received figure', () => {
    expect(SIX_MONTH_RECEIVED.at(-1)).toBe(TARGETS.receivedThisMonth)
  })

  it('keeps the tenant out of the WhatsApp automations cron', () => {
    // The cron keeps a tenant when mode is unset or 'floraclin', else when
    // whatsapp_enabled is truthy. Both conditions must fail.
    expect(SAFETY_SETTINGS.whatsapp_mode).not.toBe('floraclin')
    expect(SAFETY_SETTINGS.whatsapp_enabled).toBe(false)
  })

  it('every catalogue entry has a non-null category', () => {
    for (const item of CATALOGUE) expect(item.category).toBeTruthy()
  })
})
```

- [ ] **Step 4: Run** `pnpm --filter @floraclin/web test:run demo-seed` → all pass.
- [ ] **Step 5: Commit** `feat(demo-seed): clinic constants and financial targets`

---

## Group B: pure generators (4 agents in parallel)

All four import only from `config.ts` and `types.ts`. No shared files.

### Task B1: identity

**Files:**
- Create: `web/src/lib/demo-seed/identity.ts`
- Test: `web/src/lib/demo-seed/__tests__/identity.test.ts`

Exports:
- `generateCpf(seed: number): string` — formatted `000.000.000-00`, **valid check
  digits** (the app may validate), derived from `seed` so runs are reproducible.
- `generatePhone(index: number): string` — `` `${PHONE_PREFIX}${index}` `` zero-padded
  to 3 digits, so every number is unroutable by construction.
- `generateEmail(fullName: string): string` — `nome.sobrenome@example.com`, accents
  stripped, deduped by a numeric suffix when two patients collide.
- `buildPatients(count: number): SeededPatient[]` — name pools of at least 40
  female and 15 male Brazilian names, ages 24–45 as `birthDate` strings built with
  `@/lib/dates` helpers (never bare `new Date('YYYY-MM-DD')`), referral split
  roughly 45% Instagram, 35% indicação, 20% Google.

Tests must cover: check digits validate under the standard CPF algorithm; every
phone starts with the safe prefix; every email ends `@example.com`; no duplicate
CPF, phone or email across 50 patients; ages fall in range; the gender split is
majority female.

### Task B2: revenue

**Files:**
- Create: `web/src/lib/demo-seed/revenue.ts`
- Test: `web/src/lib/demo-seed/__tests__/revenue.test.ts`

Exports:
- `buildCurrentMonth(today: Date, patientCount: number): PlannedEntry[]` — expands
  `MONTH_MIX`, applies `PACKAGE_PRICE` to exactly one Harmonização, spreads the
  procedures across business days of the current month up to today, then splits
  entries into paid and pending so paid totals `receivedThisMonth` and pending
  totals `pendingThisMonth`. **Pending due dates land next month** so they read as
  pending, not overdue.
- `buildHistory(today: Date, patientCount: number): PlannedEntry[]` — for each of
  the five prior months, generates entries whose paid installments total the
  corresponding `SIX_MONTH_RECEIVED` value. Quantities derive from the target
  divided by a rotating catalogue selection; the last item absorbs the remainder
  so the month total is exact.

All dates via `@/lib/dates` (`brToday`, `toBrYmd`, `parseBrDate`). Accepts `today`
as a parameter so tests are deterministic, never calling `new Date()` internally.

Tests: current-month paid sum equals 34200; pending sum equals 7800; every pending
due date is after today; procedure count equals 23; toxina sessions equal 9 and
preenchimento equal 6; each historical month's paid sum equals its target exactly;
no entry has a zero or negative amount.

### Task B3: schedule

**Files:**
- Create: `web/src/lib/demo-seed/schedule.ts`
- Test: `web/src/lib/demo-seed/__tests__/schedule.test.ts`

Exports:
- `buildTodaySlots(today: Date)` — exactly 4, between 09:00 and 17:00, mixed
  procedures, 3 `confirmed` and 1 `scheduled`.
- `buildForwardSlots(today: Date)` — the next 15 days, **Monday to Saturday only**,
  3 to 5 per day, no day within that set empty, two of them marked as encaixes
  (`notes` says so) in the current week, some flagged as returns.
- Times sit off the hour where a real book would (09:30, 11:15), never a uniform grid.

Tests: today has 4 with the right status split; no Sunday appears; every Mon–Sat
day in the window has between 3 and 5; start times fall in working hours; end time
always exceeds start; exactly 2 encaixes; slots never overlap for one practitioner.

### Task B4: clinical

**Files:**
- Create: `web/src/lib/demo-seed/clinical.ts`
- Test: `web/src/lib/demo-seed/__tests__/clinical.test.ts`

Exports:
- `buildAnamnesis(patient: SeededPatient)` — allergies, current medications and
  history, varied per patient, plausible for HOF.
- `buildProcedureNotes(procedureName: string)` — technique, product, quantity and
  post-procedure observations matching the procedure.
- `buildFaceDiagramPoints(procedureName: string)` — points with product and dose
  in the shape `diagram_points` expects, anatomically sensible for the procedure
  (toxina on testa/glabela/pés de galinha, preenchimento on lábios/malar/olheiras).
- `FEATURED_PATIENT_COUNT = 6`.

Tests: every anamnesis has all three sections non-empty; notes mention the product;
toxina diagrams carry U doses and preenchimento diagrams carry ml; no two featured
patients get identical text; point coordinates fall inside the diagram bounds.

### Task B5: CRM and inbox content

> **Review finding MEDIUM-6.** Nothing in the first draft seeded prospects,
> WhatsApp conversations or photo assets, so the CRM board, the WhatsApp inbox
> and the antes/depois screen would all render **empty** after a successful run.
> The design doc promises antes/depois via the repo's illustration templates, but
> no task created `photo_assets` rows.

**Files:**
- Create: `web/src/lib/demo-seed/engagement.ts`
- Test: `web/src/lib/demo-seed/__tests__/engagement.test.ts`

Exports:
- `buildProspects(today: Date)` — a lead pipeline spread across `novo`,
  `contatado`, `qualificado` and `agendado`, with activity history, matching the
  stages the CRM board renders.
- `buildConversations(patients: SeededPatient[])` — WhatsApp conversation and
  message rows written **directly as data**, so the inbox looks alive without any
  send ever occurring. Messages must be marked as already delivered/read, and
  must not create `whatsapp_queued_messages` rows.
- `buildPhotoPairs()` — `photo_assets` and `photo_annotations` for the featured
  patients, referencing the repo's illustration templates so the before/after
  comparison has something to compare.

Tests: stage distribution covers all four; no conversation implies an outbound
send; every photo pair has both a before and an after; prospect timestamps are
ordered.

> **Review finding MEDIUM-5.** `web/src/db/schema.ts` carries `// CHECK in
> migration` comments on `appointments.status`, `installments.status` and
> `tenant_users.role`, but no matching CHECK constraint is present in
> `web/src/db/migrations`. Inserts are therefore unlikely to be rejected, which
> makes it *more* important that the seed uses the exact status strings the UI
> branches on. Every task writing a status column must read the accepted values
> from the application code rather than inventing them.

---

## Group C: runners that do not depend on the generators (2 agents in parallel)

### Task C1: teardown

**Files:**
- Create: `web/scripts/demo-clinic/teardown.ts`

> **Review finding CRITICAL-1.** The first draft of this task hand-listed 16
> tables. The schema has **47 tables carrying `tenant_id`**, plus child tables
> that reach the tenant only through a parent (`expense_installments`,
> `anamnesis_tokens`, `payment_records`, `renegotiation_links`,
> `expense_attachments`, `package_template_lines`, and the NextAuth `sessions`
> and `accounts` rows belonging to the seeded users). A hand-written list will
> rot the moment someone adds a table, and the failure mode is orphaned rows in
> production. So teardown is **derived, then asserted**, never hand-listed.

Implementation:

1. Build the tenant-scoped table list **from the Drizzle schema at runtime**, by
   inspecting which exported tables have a `tenant_id` column, rather than
   transcribing names into this file.
2. Delete child-through-parent tables explicitly, since they carry no
   `tenant_id`: `expense_installments` via `expenses`, `anamnesis_tokens` via
   `anamneses`, `payment_records` and `renegotiation_links` via
   `financial_entries`, `expense_attachments` via `expenses`,
   `package_template_lines` via `package_templates`, `sessions` and `accounts`
   via the seeded `users`.
3. Delete in reverse FK order, inside one transaction.
4. **Assert zero rows remain** for the tenant across every one of the 47 tables.
   A non-zero count fails the run rather than leaving orphans behind.

Guard rails, all three required before a single delete runs:
- refuses to run unless the tenant's `slug` is `DEMO_SLUG`
- refuses if `settings.is_demo` is not `true`
- prints the row count per table and requires `--yes` to proceed

### Task C2: verify

**Files:**
- Create: `web/scripts/demo-clinic/verify.ts`

> **Review finding HIGH-2.** `web/vercel.json` schedules
> `/api/cron/whatsapp-automations` at `0 11 * * *`, i.e. **08:00 BRT every day**.
> The exclusion is not theoretical: it gets exercised the morning after any seed.
> So `--safety-only` runs **before** seeding and again **after**, and it is the
> gate on the whole operation.
>
> **Review finding CONFIRMED-3.** `getExpiredTrials` filters
> `status = 'trialing'` (`web/src/db/queries/subscriptions.ts`), so an `active`
> subscription is never expired by the nightly job. The plan's claim holds.
>
> **Review finding CONFIRMED-4.** `/api/cron/calendar-renew` iterates calendar
> connections. The tenant will have none, so it is inert, but verify asserts
> `calendar_connections` is empty so that connecting Google mid-shoot cannot
> start outbound sync unnoticed.

Two modes:
- `--safety-only`: asserts the tenant is excluded from the WhatsApp cron
  (`whatsapp_mode !== 'floraclin'`, `whatsapp_enabled` falsy), and that
  `whatsapp_automations`, `whatsapp_credits`, `whatsapp_queued_messages`,
  `whatsapp_conversations` and `calendar_connections` all have **zero rows** for
  the tenant; that every patient phone starts with `PHONE_PREFIX`; and that every
  email ends `@example.com`. **Safe to run against production before seeding
  anything.**
- default: additionally calls `getQuickStats` and `getRevenueOverview` for the
  tenant and asserts every target in `TARGETS`, the six-month series, and
  `totalOverdue === 0`.

Exits non-zero listing each failed assertion.

---

## Group D: orchestration (2 agents in parallel)

### Task D1: seed

**Files:**
- Create: `web/scripts/demo-clinic/seed.ts`

Order: tenant (with `SAFETY_SETTINGS`) → users and `tenant_users` → subscription
(status `active`, `currentPeriodEnd` +1 year, plan looked up by name, **fails if
no plan row exists**) → expense categories → procedure types → patients →
history → current month → expenses → forward schedule → clinical records.

Requirements:
- idempotent: runs `teardown` for the tenant first, inside one transaction
- `--dry-run` prints the planned counts and totals without writing
- refuses to run if `DATABASE_URL` is unset
- prints a summary table at the end and then runs the `verify` assertions

### Task D2: scripts and runbook

**Files:**
- Modify: `web/package.json`
- Create: `docs/runbooks/demo-clinic.md`

Adds `demo:seed`, `demo:verify`, `demo:safety` and `demo:teardown`, each wrapped
in `dotenv -e .env.local`. The runbook covers the pre-flight safety check, the
seeding order, what to re-run before a screenshot session, and teardown.

It must state plainly that `demo:safety` is run against production **before**
`demo:seed`, and that the seed is executed by a human, never by automation.

---

## Self-review focus

- Any bare `new Date('YYYY-MM-DD')` or `.toISOString().split('T')[0]`
- Any code path that could reach the WhatsApp or email senders
- Whether teardown misses a table, leaving orphans behind
- Whether the totals are asserted rather than assumed
