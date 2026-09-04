# Payment pricing and un-cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one replay engine the only pricer of an installment payment, make backdated payments work, and make a cancelled charge reversible.

**Architecture:** `replayPayments` becomes the single pricing engine, with three correctness repairs it needs before it can carry that load: interest may not start before the due date plus grace, interest a payment does not cover must be carried forward, and equal timestamps must sort stably. A new pure `quoteInstallment` prices an installment at an instant by replaying only the payments at or before that instant. `recordPayment` and `bulkPayInstallments` both drop their ad-hoc blocks and call it. A read-only quote endpoint gives the dialog the same number the write path will compute.

**Tech Stack:** Next.js 16.2.3 App Router, Drizzle ORM on Postgres (`floraclin` schema), Zod, TanStack Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-03-payment-pricing-and-uncancel-design.md`

**Review history:** v1 of this plan was REJECTED by adversarial review with seven high-severity findings. This is v2. Sections marked **[AR-n]** exist because of finding n; do not "simplify" them back.

## Global Constraints

- Branch: `fix/payment-pricing-and-uncancel`, based on `feat/meta-conversions`. The Meta code in Task B1 exists only on that branch.
- **Implementation agents must not run `git add` or `git commit`.** Parallel tasks share one `.git` index; concurrent staging corrupts commits and races on `index.lock`. Finish your files, report, and let the orchestrator commit the group. **[AR-exec]**
- Never `new Date("YYYY-MM-DD")` bare, never `.toISOString().split('T')[0]`. Use `@/lib/dates`. See `AGENTS.md`.
- `parseBrDate` throws on anything that is not `YYYY-MM-DD`, including `''`. Never call it on an optional field without guarding. **[AR-4]**
- No em dashes anywhere. Comments only where a competent reader would get it wrong without one; see `CLAUDE.md`.
- Do not preserve backward compatibility. Delete the path you replace.
- User-facing strings are Brazilian Portuguese.
- Tests are Vitest: `pnpm --filter @floraclin/web test:run`. Never hit Supabase; mock `@/db/client` with the `chain()` proxy from `web/src/db/queries/__tests__/financial-meta.test.ts`.
- Money tolerance is 0.01, never 0.02.

---

## Parallelization Groups

| Group | Tasks | Owner of `db/queries/financial.ts` |
|---|---|---|
| A | A1, A2, A3 | nobody |
| B | B1, B2 | B1 |
| C | C1, C2 | C1 |
| D | D1, D2 | D1 |
| E | E1 | nobody |

`web/src/db/queries/financial.ts` is the bottleneck: exactly one task per group may own it. Groups run in order; a file touched in an earlier group may be touched again later. The orchestrator commits after each group.

---

## Group A

### Task A1: Repair and generalise the replay engine

**Files:**
- Modify: `web/src/lib/financial/penalties.ts`
- Test: `web/src/lib/financial/__tests__/penalties.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ReplayResult['installmentState']` gains `fineApplied: boolean` and `carriedInterest: number`.
  - `export interface InstallmentQuote { remainingPrincipal: number; fineAmount: number; interestAmount: number; totalDue: number }`
  - `export function quoteInstallment(base: InstallmentBase, existingPayments: PaymentInput[], asOf: Date): InstallmentQuote`

Four changes to one function plus one new function. They ship together because each of the first three is a precondition for `replayPayments` being safe as the universal pricer.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/financial/__tests__/penalties.test.ts`. Extend the existing import from `../penalties` with `quoteInstallment`, and the `vitest` import with `vi`, `beforeEach` and `afterEach`.

```ts
const BASE = {
  amount: 750,
  dueDate: '2026-05-22',
  appliedFineValue: 2,
  appliedFineType: 'percentage',
  appliedInterestRate: 1,
  gracePeriodDays: 0,
}

describe('quoteInstallment', () => {
  it('prices an unpaid overdue installment as of now', () => {
    const q = quoteInstallment(BASE, [], new Date('2026-09-03T14:04:50.000Z'))
    expect(q.remainingPrincipal).toBe(750)
    expect(q.fineAmount).toBe(15)
    expect(q.interestAmount).toBe(26)
    expect(q.totalDue).toBe(791)
  })

  it('prices one day cheaper at UTC midnight of the same BR day', () => {
    const q = quoteInstallment(BASE, [], new Date('2026-09-03T00:00:00.000Z'))
    expect(q.interestAmount).toBe(25.75)
    expect(q.totalDue).toBe(790.75)
  })

  it('charges nothing extra before the due date', () => {
    const q = quoteInstallment(BASE, [], new Date('2026-05-01T12:00:00.000Z'))
    expect(q.fineAmount).toBe(0)
    expect(q.interestAmount).toBe(0)
    expect(q.totalDue).toBe(750)
  })

  it('honours the grace period', () => {
    const q = quoteInstallment(
      { ...BASE, gracePeriodDays: 5 },
      [],
      new Date('2026-09-03T14:04:50.000Z'),
    )
    expect(q.interestAmount).toBe(24.75)
  })

  // AR-1: the headline backdating case. A later payment already exists; the
  // quote must price the earlier date, not the state after that later payment.
  it('ignores payments dated after the quote instant', () => {
    const later = { id: 'p2', amount: 500, paidAt: '2026-08-01T12:00:00.000Z' }
    const q = quoteInstallment(BASE, [later], new Date('2026-06-22T12:00:00.000Z'))
    expect(q.remainingPrincipal).toBe(750)
    expect(q.fineAmount).toBe(15)
    expect(q.interestAmount).toBe(7.75)
    expect(q.totalDue).toBe(772.75)
  })

  it('agrees with replayPayments inserting the same payment chronologically', () => {
    const later = { id: 'p2', amount: 500, paidAt: '2026-08-01T12:00:00.000Z' }
    const asOf = new Date('2026-06-22T12:00:00.000Z')
    const q = quoteInstallment(BASE, [later], asOf)
    const replayed = replayPayments(BASE, [
      later,
      { id: 'new', amount: q.totalDue, paidAt: asOf.toISOString() },
    ])
    const inserted = replayed.payments.find((p) => p.id === 'new')!
    expect(inserted.excessAmount).toBe(0)
    const covered =
      inserted.interestCovered + inserted.fineCovered + inserted.principalCovered
    expect(Math.round(covered * 100) / 100).toBe(q.totalDue)
  })

  it('does not charge the fine twice when an earlier payment took it', () => {
    const first = { id: 'p1', amount: 100, paidAt: '2026-06-22T12:00:00.000Z' }
    expect(quoteInstallment(BASE, [first], new Date('2026-07-22T12:00:00.000Z')).fineAmount).toBe(0)
  })

  it('charges the fine when every earlier payment was on time', () => {
    const onTime = { id: 'p1', amount: 100, paidAt: '2026-05-01T12:00:00.000Z' }
    expect(
      quoteInstallment(BASE, [onTime], new Date('2026-09-03T14:04:50.000Z')).fineAmount,
    ).toBe(15)
  })

  it('quotes zero once everything is settled', () => {
    const settled = { id: 'p1', amount: 791, paidAt: '2026-09-03T14:04:50.000Z' }
    const q = quoteInstallment(BASE, [settled], new Date('2026-09-03T14:04:50.000Z'))
    expect(q.totalDue).toBe(0)
  })
})

describe('replayPayments interest origin', () => {
  // AR-6: an on-time payment must not start the interest clock early.
  it('starts interest at the due date, not at an earlier on-time payment', () => {
    const onTime = { id: 'p1', amount: 10, paidAt: '2026-05-01T12:00:00.000Z' }
    const q = quoteInstallment(BASE, [onTime], new Date('2026-09-03T14:04:50.000Z'))
    // 104 days from 2026-05-22, on a principal of 740, not 125 days from 2026-05-01.
    expect(q.interestAmount).toBe(25.65)
  })

  it('keeps the grace period after an on-time payment', () => {
    const onTime = { id: 'p1', amount: 10, paidAt: '2026-05-01T12:00:00.000Z' }
    const q = quoteInstallment(
      { ...BASE, gracePeriodDays: 5 },
      [onTime],
      new Date('2026-09-03T14:04:50.000Z'),
    )
    expect(q.interestAmount).toBe(24.42)
  })
})

describe('replayPayments carried interest', () => {
  // `replayPayments` computes its trailing `interestAmount` against the wall
  // clock, so any assertion on that field has to freeze time. See AGENTS.md
  // gotcha 4.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T14:04:50.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // AR-2: interest a payment does not cover stays owed.
  it('carries interest a payment could not cover', () => {
    const tiny = { id: 'p1', amount: 1, paidAt: '2026-09-03T14:04:50.000Z' }
    const result = replayPayments(BASE, [tiny])
    expect(result.installmentState.carriedInterest).toBe(25)
    expect(result.installmentState.amountPaid).toBe(0)
    // 25 carried, plus zero elapsed since the payment instant.
    expect(result.installmentState.interestAmount).toBe(25)
  })

  it('a later payment must still cover the carried interest', () => {
    const tiny = { id: 'p1', amount: 1, paidAt: '2026-09-03T14:04:50.000Z' }
    const q = quoteInstallment(BASE, [tiny], new Date('2026-09-03T14:04:50.000Z'))
    expect(q.interestAmount).toBe(25)
    expect(q.fineAmount).toBe(15)
    expect(q.totalDue).toBe(790)
  })

  it('carries nothing when the payment covers all interest', () => {
    const big = { id: 'p1', amount: 100, paidAt: '2026-09-03T14:04:50.000Z' }
    expect(replayPayments(BASE, [big]).installmentState.carriedInterest).toBe(0)
  })
})

describe('replayPayments ordering', () => {
  // AR-medium: BR-noon anchoring makes same-instant payments common.
  it('orders equal timestamps stably by id', () => {
    const a = { id: 'aaa', amount: 30, paidAt: '2026-09-03T15:00:00.000Z' }
    const b = { id: 'bbb', amount: 30, paidAt: '2026-09-03T15:00:00.000Z' }
    const forward = replayPayments(BASE, [a, b])
    const backward = replayPayments(BASE, [b, a])
    expect(forward.payments.map((p) => p.id)).toEqual(['aaa', 'bbb'])
    expect(backward.payments.map((p) => p.id)).toEqual(['aaa', 'bbb'])
    expect(forward.installmentState).toEqual(backward.installmentState)
  })
})

describe('replayPayments fineApplied', () => {
  it('is false when no payment was overdue', () => {
    expect(
      replayPayments(BASE, [{ amount: 100, paidAt: '2026-05-01T12:00:00.000Z' }])
        .installmentState.fineApplied,
    ).toBe(false)
  })

  it('is true once an overdue payment took the fine', () => {
    expect(
      replayPayments(BASE, [{ amount: 100, paidAt: '2026-06-22T12:00:00.000Z' }])
        .installmentState.fineApplied,
    ).toBe(true)
  })

  it('is false with no payments', () => {
    expect(replayPayments(BASE, []).installmentState.fineApplied).toBe(false)
  })
})
```

`round2` is module-private. Export it from `penalties.ts` so the agreement test can use it, or inline `Math.round(x * 100) / 100` in that one assertion. Prefer inlining; do not widen the module's public surface for a test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @floraclin/web test:run src/lib/financial/__tests__/penalties.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the interest-window helper**

`replayPayments` currently derives the interest origin inline as `lastCalcAt ? lastCalcAt : base.dueDate`, with grace applied only when `lastCalcAt` is null. Both halves are wrong once replay is universal: a payment made *before* the due date sets `lastCalcAt` to a date earlier than the due date, which starts the interest clock early and simultaneously discards the grace period.

Add above `replayPayments` in `web/src/lib/financial/penalties.ts`:

```ts
const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Days of interest owed at `asOf`. The clock starts when the grace period ends
 * or at the last payment, whichever is later: a payment made before the due
 * date must not start it early, and must not forfeit the grace period.
 */
function daysOfInterest(
  base: InstallmentBase,
  lastCalcAt: string | null,
  asOf: Date,
): number {
  const graceEnd =
    parseOverdueReference(base.dueDate).getTime() + base.gracePeriodDays * MS_PER_DAY
  const start = Math.max(graceEnd, lastCalcAt ? new Date(lastCalcAt).getTime() : 0)
  return Math.max(0, Math.floor((asOf.getTime() - start) / MS_PER_DAY))
}
```

`getDaysOverdue` stays exported and unchanged; other callers still use it.

- [ ] **Step 4: Rewrite `replayPayments`**

Replace the whole function body. The changes against the current version are the stable sort, `daysOfInterest`, `carriedInterest`, and the two new `installmentState` fields.

```ts
export function replayPayments(
  base: InstallmentBase,
  payments: PaymentInput[],
): ReplayResult {
  // Equal timestamps are common: the UI anchors every picked calendar day to
  // BR noon. Without the id tiebreak, database row order decides which payment
  // covers the interest.
  const sorted = [...payments].sort((a, b) => {
    const byDate = new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()
    if (byDate !== 0) return byDate
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })

  let amountPaid = 0
  let fineAmount = 0
  let fineApplied = false
  let carriedInterest = 0
  let lastCalcAt: string | null = null
  const replayedPayments: ReplayedPayment[] = []

  for (const payment of sorted) {
    const paymentDate = new Date(payment.paidAt)
    const daysOverdue = daysOfInterest(base, lastCalcAt, paymentDate)

    if (!fineApplied && daysOverdue > 0) {
      fineAmount = calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      fineApplied = true
    }

    const remainingPrincipal = round2(base.amount - amountPaid)
    // Interest a previous payment could not cover stays owed; it does not
    // vanish when the clock restarts at that payment's date.
    const interestAmount = round2(
      carriedInterest +
        calculateInterest(remainingPrincipal, daysOverdue, base.appliedInterestRate),
    )

    const allocation = allocatePayment(
      { amount: base.amount, amountPaid, fineAmount, interestAmount },
      payment.amount,
    )

    carriedInterest = round2(interestAmount - allocation.interestCovered)
    fineAmount = round2(fineAmount - allocation.fineCovered)
    amountPaid = round2(amountPaid + allocation.principalCovered)
    lastCalcAt = payment.paidAt

    replayedPayments.push({
      ...allocation,
      amount: payment.amount,
      paidAt: payment.paidAt,
      ...(payment.id != null ? { id: payment.id } : {}),
    })
  }

  const currentInterest = round2(
    carriedInterest +
      calculateInterest(
        round2(base.amount - amountPaid),
        daysOfInterest(base, lastCalcAt, new Date()),
        base.appliedInterestRate,
      ),
  )

  return {
    payments: replayedPayments,
    installmentState: {
      amountPaid,
      fineAmount,
      interestAmount: currentInterest,
      lastFineInterestCalcAt: lastCalcAt,
      fineApplied,
      carriedInterest,
    },
  }
}
```

Extend `ReplayResult`:

```ts
export interface ReplayResult {
  payments: ReplayedPayment[]
  installmentState: {
    amountPaid: number
    fineAmount: number
    interestAmount: number
    lastFineInterestCalcAt: string | null
    fineApplied: boolean
    carriedInterest: number
  }
}
```

- [ ] **Step 5: Add `quoteInstallment`**

```ts
export interface InstallmentQuote {
  remainingPrincipal: number
  fineAmount: number
  interestAmount: number
  totalDue: number
}

/**
 * What one installment owes at a given instant. Only the payments at or before
 * that instant count: a payment being recorded for a past date is inserted
 * chronologically by `replayPayments`, so pricing it against later payments
 * would quote a debt that had not been reduced yet.
 */
export function quoteInstallment(
  base: InstallmentBase,
  existingPayments: PaymentInput[],
  asOf: Date,
): InstallmentQuote {
  const upToAsOf = existingPayments.filter(
    (p) => new Date(p.paidAt).getTime() <= asOf.getTime(),
  )
  const replay = replayPayments(base, upToAsOf)
  const { amountPaid, lastFineInterestCalcAt, carriedInterest } = replay.installmentState

  const daysOverdue = daysOfInterest(base, lastFineInterestCalcAt, asOf)

  const fineAmount =
    !replay.installmentState.fineApplied && daysOverdue > 0
      ? calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      : replay.installmentState.fineAmount

  const remainingPrincipal = round2(Math.max(base.amount - amountPaid, 0))
  const interestAmount = round2(
    carriedInterest +
      calculateInterest(remainingPrincipal, daysOverdue, base.appliedInterestRate),
  )

  return {
    remainingPrincipal,
    fineAmount,
    interestAmount,
    totalDue: round2(remainingPrincipal + fineAmount + interestAmount),
  }
}
```

- [ ] **Step 6: Run the whole penalties suite and reconcile**

Run: `pnpm --filter @floraclin/web test:run src/lib/financial`
Expected: PASS. The pre-existing `replayPayments` tests in this file may fail on the interest-origin change. For each failure, decide whether the old expectation encoded the bug (an on-time payment starting the clock early, or forgiven interest) and update it, or whether the new code is wrong and fix the code. Do not delete a failing test. Record each changed expectation in your report to the orchestrator.

- [ ] **Step 7: Report to the orchestrator**

Do not commit. Report which pre-existing expectations changed and why.

---

### Task A2: Bound the payment date to the current BR day

**Files:**
- Modify: `web/src/validations/financial.ts`
- Test: `web/src/validations/__tests__/financial.test.ts`

**Interfaces:**
- Consumes: `endOfBrDay`, `brToday` from `@/lib/dates`.
- Produces: `recordPaymentSchema` and `bulkPaySchema` reject a `paidAt` after the end of the current BR day.

**[AR-3]** The obvious bound, `<= Date.now()`, is wrong. The UI anchors a picked calendar day to BR noon, so at 09:00 BRT selecting *today* yields an instant three hours ahead and the payment is rejected as future. The field is a BR calendar day, so the ceiling has to be a BR calendar day too.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/validations/__tests__/financial.test.ts`, importing `recordPaymentSchema` and `bulkPaySchema` from `../financial` and `parseBrDate`, `brToday`, `endOfBrDay` from `@/lib/dates`.

```ts
describe('paidAt bounds', () => {
  const base = {
    installmentId: '00000000-0000-4000-8000-000000000001',
    amount: 100,
    paymentMethod: 'pix',
  }

  it('accepts a past date', () => {
    expect(
      recordPaymentSchema.safeParse({ ...base, paidAt: '2020-01-01T12:00:00.000Z' }).success,
    ).toBe(true)
  })

  it('accepts an omitted date', () => {
    expect(recordPaymentSchema.safeParse(base).success).toBe(true)
  })

  // AR-3: BR noon today is "in the future" every morning before 09:00 UTC-3.
  it('accepts BR noon of the current BR day', () => {
    const paidAt = parseBrDate(brToday(), '12:00:00').toISOString()
    expect(recordPaymentSchema.safeParse({ ...base, paidAt }).success).toBe(true)
  })

  it('accepts the last instant of the current BR day', () => {
    const paidAt = endOfBrDay(brToday()).toISOString()
    expect(recordPaymentSchema.safeParse({ ...base, paidAt }).success).toBe(true)
  })

  it('rejects tomorrow', () => {
    const paidAt = new Date(endOfBrDay(brToday()).getTime() + 1000).toISOString()
    expect(recordPaymentSchema.safeParse({ ...base, paidAt }).success).toBe(false)
  })

  it('rejects tomorrow on the bulk schema', () => {
    const paidAt = new Date(endOfBrDay(brToday()).getTime() + 1000).toISOString()
    expect(
      bulkPaySchema.safeParse({
        installmentIds: ['00000000-0000-4000-8000-000000000001'],
        paymentMethod: 'pix',
        paidAt,
      }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @floraclin/web test:run src/validations/__tests__/financial.test.ts`

- [ ] **Step 3: Add the bound**

In `web/src/validations/financial.ts`, import `brToday` and `endOfBrDay` from `@/lib/dates` and add above `recordPaymentSchema`:

```ts
// A payment date is a BR calendar day, so the ceiling is the end of today in
// BR, not `Date.now()`. The UI anchors a picked day to BR noon, which is ahead
// of the wall clock every morning.
const paidAtField = z
  .string()
  .datetime({ offset: true })
  .refine((value) => new Date(value).getTime() <= endOfBrDay(brToday()).getTime(), {
    message: 'Data do pagamento não pode ser no futuro',
  })
  .optional()
```

Replace the `paidAt` line in both `recordPaymentSchema` and `bulkPaySchema` with `paidAt: paidAtField,`. Read `bulkPaySchema` first to match its current line exactly.

- [ ] **Step 4: Run to verify they pass, then report**

Run: `pnpm --filter @floraclin/web test:run src/validations`. Do not commit.

---

### Task A3: Delete the table's client-side interest fallback

**Files:**
- Modify: `web/src/components/financial/installment-table.tsx`
- Test: `web/src/components/financial/__tests__/installment-table.test.tsx`

**Interfaces:**
- Produces: `getComputedInterest` is gone.

`getComputedInterest` (lines 76 to 86) is a third pricer, and broken: line 83 reads `getDaysOverdue(startDate, inst.lastFineInterestCalcAt ? 0 : 0)`, so both branches pass `0` and the grace period is ignored. It cannot be repaired in place, because the grace period is not available in this component tree: `financial-list.tsx:546` renders `<InstallmentTable entryId={entry.id} />` with no settings. It is also unreachable, because `/api/financial/[id]` sets `computedInterestAmount` on every installment (`web/src/db/queries/financial.ts:1458`).

- [ ] **Step 1: Read `installment-table.tsx` lines 40 to 145 and the whole existing test file**

- [ ] **Step 2: Write the failing test**

Append to the test file, following its fetch-mocking and render helpers. Render one pending installment with `computedInterestAmount: 1.67`, `computedFineAmount: 20`, `interestAmount: '99.99'`, `appliedInterestRate: '1'`, `lastFineInterestCalcAt: null`, `amount: '1000'`, and a due date 10 days in the past. Assert the row shows a penalty total of 21.67 and never 99.99.

- [ ] **Step 3: Delete the fallback**

Remove `getComputedInterest` entirely. At line 140, mirror the line above it:

```ts
          const fineAmt = inst.computedFineAmount ?? Number(inst.fineAmount ?? 0)
          const interestAmt = inst.computedInterestAmount ?? Number(inst.interestAmount ?? 0)
```

At the second call site, inside the `PartialPaymentDialog` props, substitute the same expression so the file compiles. Task C2 deletes that prop entirely.

Run `rg 'getDaysOverdue|calculateInterest' web/src/components/financial/installment-table.tsx` and drop any import that is now unused.

- [ ] **Step 4: Run the tests, then report**

Run: `pnpm --filter @floraclin/web test:run src/components/financial/__tests__/installment-table.test.tsx`. Do not commit.

---

## Group B

### Task B1: Route `recordPayment` through the replay engine

**Files:**
- Modify: `web/src/db/queries/financial.ts`
- Modify: `web/src/app/api/financial/installments/[id]/pay/route.ts`
- Test: `web/src/db/queries/__tests__/financial-payment.test.ts` (create)

**Interfaces:**
- Consumes: `quoteInstallment`, `replayPayments`, `PaymentInput`, `InstallmentBase` from A1.
- Produces: `recordPayment` throws `BusinessError` with codes `INSTALLMENT_NOT_FOUND`, `INSTALLMENT_ALREADY_PAID`, `INSTALLMENT_CANCELLED`, `PAYMENT_EXCEEDS_DUE`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/db/queries/__tests__/financial-payment.test.ts`. Copy the `chain()` proxy and the `vi.mock('@/db/client', ...)` block from `financial-meta.test.ts` verbatim.

Fixture unless a case says otherwise: R$750, due `2026-05-22`, no prior payments, fine 2% percentage, interest 1%/month, grace 0.

1. `paidAt` `2026-09-03T00:00:00.000Z`, amount `790.75` succeeds.
2. Same, amount `790.77` throws `BusinessError` code `PAYMENT_EXCEEDS_DUE`.
3. Same, amount `790.76` succeeds, inside the 0.01 tolerance.
4. **[AR-1]** A prior payment of 500 dated `2026-08-01T12:00:00.000Z` exists; a new payment dated `2026-06-22T12:00:00.000Z` of `772.75` succeeds, and the prior record's allocation columns are rewritten.
5. A payment record with `reversedAt` set is excluded from the replay: `amountPaid` reflects only the live record.
6. Status `paid` throws `INSTALLMENT_ALREADY_PAID`; status `cancelled` throws `INSTALLMENT_CANCELLED`.
7. **[AR-2]** A payment of 1 against 25 of accrued interest stores `interest_amount` of 25, not 0.
8. `emitPurchaseEventForEntry` does not enqueue when `paidAt` is older than 7 days, and does when it is inside the window. Assert through the `enqueueMetaEvent` mock, as `financial-meta.test.ts` does.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Exclude reversed payments from the replay**

`recordPayment`'s select at `financial.ts:425-428` has no `reversedAt` filter, so it replays payments that were already reversed. `reversePayment` filters them. Make them agree:

```ts
    const existingPayments = await tx
      .select()
      .from(paymentRecords)
      .where(
        and(
          eq(paymentRecords.installmentId, data.installmentId),
          isNull(paymentRecords.reversedAt)
        )
      )
      .orderBy(paymentRecords.paidAt)
```

`and` and `isNull` are already imported.

- [ ] **Step 4: Replace the `isBackdated` fork**

Delete the `isBackdated` computation, the whole `if (isBackdated) { ... } else { ... }` block, and the five `let` declarations that preceded it. Replace with:

```ts
    const base: InstallmentBase = {
      amount: installmentAmount,
      dueDate,
      appliedFineValue: appliedFineValue!,
      appliedFineType: appliedFineType!,
      appliedInterestRate: appliedInterestRate!,
      gracePeriodDays,
    }

    const priorPayments: PaymentInput[] = existingPayments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      paidAt: new Date(p.paidAt).toISOString(),
    }))

    const quote = quoteInstallment(base, priorPayments, paidAt)
    if (data.amount > quote.totalDue + 0.01) {
      throw new BusinessError('PAYMENT_EXCEEDS_DUE', 'Valor do pagamento excede o total devido')
    }

    const NEW_PAYMENT_SENTINEL = '__new__'
    const replay = replayPayments(base, [
      ...priorPayments,
      { id: NEW_PAYMENT_SENTINEL, amount: data.amount, paidAt: paidAt.toISOString() },
    ])

    const newPayment = replay.payments.find((p) => p.id === NEW_PAYMENT_SENTINEL)!
    const paymentAllocation = {
      interestCovered: newPayment.interestCovered,
      fineCovered: newPayment.fineCovered,
      principalCovered: newPayment.principalCovered,
    }

    // Art. 354 splits each payment against the interest and fine standing at
    // its own date, so inserting one payment re-splits the ones around it.
    for (const replayed of replay.payments) {
      if (replayed.id === NEW_PAYMENT_SENTINEL) continue
      const existing = existingPayments.find((ep) => ep.id === replayed.id)
      if (!existing) continue
      await tx
        .update(paymentRecords)
        .set({
          interestCovered: replayed.interestCovered.toFixed(2),
          fineCovered: replayed.fineCovered.toFixed(2),
          principalCovered: replayed.principalCovered.toFixed(2),
        })
        .where(eq(paymentRecords.id, existing.id))
    }

    const finalAmountPaid = replay.installmentState.amountPaid
    const finalFineAmount = replay.installmentState.fineAmount
    const finalInterestAmount = replay.installmentState.interestAmount
    const finalLastCalcAt = replay.installmentState.lastFineInterestCalcAt
      ? new Date(replay.installmentState.lastFineInterestCalcAt)
      : paidAt
```

Add `quoteInstallment`, `replayPayments`, `PaymentInput`, `InstallmentBase` to the import from `@/lib/financial/penalties`, and `BusinessError` from `@/lib/errors`.

- [ ] **Step 5: Convert the three early throws**

```ts
    if (!row) {
      throw new BusinessError('INSTALLMENT_NOT_FOUND', 'Parcela não encontrada ou não pertence a esta clínica')
    }
    if (row.status === 'paid') {
      throw new BusinessError('INSTALLMENT_ALREADY_PAID', 'Parcela já está totalmente paga')
    }
    if (row.status === 'cancelled') {
      throw new BusinessError('INSTALLMENT_CANCELLED', 'Parcela cancelada não pode receber pagamento')
    }
```

- [ ] **Step 6: Lock the installment in `reversePayment` [AR-7]**

`recordPayment` locks the installment row then rewrites payment records; `reversePayment` rewrites a payment record and only later updates the installment, taking no lock. Making the rewrite universal broadens that race into the common path. In `reversePayment`, after loading `pr` and before marking it reversed, take the same lock `recordPayment` takes:

```ts
    await tx.execute(
      sql`SELECT 1 FROM floraclin.installments
          WHERE id = ${pr.installmentId}
          AND tenant_id = ${tenantId}
          FOR UPDATE`
    )
```

Both paths now acquire the installment lock first, so they serialize instead of deadlocking.

- [ ] **Step 7: Gate stale Purchase events**

In `emitPurchaseEventForEntry`, after the `renegotiated` early return and before `const eventId`:

```ts
    // Meta rejects an event_time outside its window, and eventTime is the
    // payment's own date. A payment recorded months late has no attribution
    // left to send, so no row is written rather than one written to fail.
    if (Date.now() - eventTime.getTime() > META_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      return null
    }
```

Import `META_EVENT_WINDOW_DAYS` from `@/db/queries/meta-events`.

- [ ] **Step 8: Return 409 from the pay route**

Replace the substring-matching catch in `web/src/app/api/financial/installments/[id]/pay/route.ts`:

```ts
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
```

Import `BusinessError` from `@/lib/errors`.

- [ ] **Step 9: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/db/queries src/lib/financial`. Do not commit.

---

### Task B2: The quote endpoint

**Files:**
- Create: `web/src/db/queries/financial-quote.ts`
- Create: `web/src/app/api/financial/installments/[id]/quote/route.ts`
- Test: `web/src/db/queries/__tests__/financial-quote.test.ts` (create)

**Interfaces:**
- Consumes: `quoteInstallment`, `InstallmentQuote`, `PaymentInput`, `InstallmentBase` from A1.
- Produces:
  - `export interface InstallmentQuoteResult extends InstallmentQuote { asOf: string }`
  - `export async function getInstallmentQuote(tenantId: string, installmentId: string, asOf: Date): Promise<InstallmentQuoteResult>`
  - `GET /api/financial/installments/:id/quote?paidAt=<ISO>`

A separate file from `financial.ts`: B1 owns that file this group, and this is a read path that must not be mistaken for the write path. The write path prices the row it locked; this one prices a fresh read.

- [ ] **Step 1: Write the failing tests**

Create the test file with the `chain()` proxy from `financial-meta.test.ts`. Cover:

1. R$750 due `2026-05-22`, fine 2%, interest 1%/month, grace 0, `asOf` `2026-09-03T14:04:50.000Z` gives `totalDue` 791.
2. Falls back to tenant settings when the row's `appliedFineValue` and `appliedInterestRate` are null, which is the state before the first payment snapshots them.
3. Excludes reversed payment records.
4. An installment in another tenant throws `BusinessError` code `INSTALLMENT_NOT_FOUND`.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Write `getInstallmentQuote`**

```ts
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { installments, paymentRecords, financialSettings } from '@/db/schema'
import { BusinessError } from '@/lib/errors'
import {
  quoteInstallment,
  type InstallmentBase,
  type InstallmentQuote,
  type PaymentInput,
} from '@/lib/financial/penalties'

export interface InstallmentQuoteResult extends InstallmentQuote {
  asOf: string
}

/**
 * Read-only pricing for the payment dialog. The write path prices the row it
 * locked instead; both call the same `quoteInstallment`, which is what keeps
 * the prefilled amount and the amount the server accepts in agreement.
 */
export async function getInstallmentQuote(
  tenantId: string,
  installmentId: string,
  asOf: Date,
): Promise<InstallmentQuoteResult> {
  const [inst] = await db
    .select()
    .from(installments)
    .where(and(eq(installments.id, installmentId), eq(installments.tenantId, tenantId)))
    .limit(1)

  if (!inst) {
    throw new BusinessError(
      'INSTALLMENT_NOT_FOUND',
      'Parcela não encontrada ou não pertence a esta clínica',
    )
  }

  const [settings] = await db
    .select()
    .from(financialSettings)
    .where(eq(financialSettings.tenantId, tenantId))
    .limit(1)

  const payments = await db
    .select()
    .from(paymentRecords)
    .where(
      and(eq(paymentRecords.installmentId, installmentId), isNull(paymentRecords.reversedAt)),
    )
    .orderBy(paymentRecords.paidAt)

  const base: InstallmentBase = {
    amount: Number(inst.amount),
    dueDate: inst.dueDate,
    appliedFineValue: Number(inst.appliedFineValue ?? settings?.fineValue ?? 0),
    appliedFineType: inst.appliedFineType ?? settings?.fineType ?? 'percentage',
    appliedInterestRate: Number(inst.appliedInterestRate ?? settings?.monthlyInterestPercent ?? 0),
    gracePeriodDays: settings?.gracePeriodDays ?? 0,
  }

  const prior: PaymentInput[] = payments.map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    paidAt: new Date(p.paidAt).toISOString(),
  }))

  return { ...quoteInstallment(base, prior, asOf), asOf: asOf.toISOString() }
}
```

- [ ] **Step 4: Write the route**

Read `web/src/app/api/financial/installments/[id]/pay/route.ts` first and mirror its auth and role check exactly (`owner`, `receptionist`, `financial`).

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getInstallmentQuote } from '@/db/queries/financial-quote'
import { BusinessError } from '@/lib/errors'
import { handleApiError } from '@/lib/api-error'
import { brToday, endOfBrDay } from '@/lib/dates'

const querySchema = z.object({
  paidAt: z
    .string()
    .datetime({ offset: true })
    .refine((value) => new Date(value).getTime() <= endOfBrDay(brToday()).getTime(), {
      message: 'Data do pagamento não pode ser no futuro',
    })
    .optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'receptionist', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const parsed = querySchema.safeParse({
      paidAt: new URL(request.url).searchParams.get('paidAt') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const asOf = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date()
    const quote = await getInstallmentQuote(ctx.tenantId, id, asOf)

    return NextResponse.json({ success: true, data: quote })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
```

- [ ] **Step 5: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/db/queries/__tests__/financial-quote.test.ts`. Do not commit.

---

## Group C

### Task C1: Route `bulkPayInstallments` through the replay engine

**Files:**
- Modify: `web/src/db/queries/financial.ts`
- Test: `web/src/db/queries/__tests__/financial-bulk-pay.test.ts` (create)

**Interfaces:**
- Consumes: `quoteInstallment`, `replayPayments` from A1; the conventions B1 established in `recordPayment`.
- Produces: no new exports. `bulkPayInstallments` keeps its signature.

**[AR-5]** `bulkPayInstallments` at `financial.ts:896-923` duplicates the exact ad-hoc block B1 deletes from `recordPayment`. Left alone it becomes a second pricer that charges different totals: after an overdue payment that covered the fine but no principal, `amountPaid` and `fineAmount` are both zero, so bulk pay applies the fine a second time while `quoteInstallment` sees `fineApplied` and does not. It also never reallocates existing records, so a backdated bulk payment corrupts Art. 354 ordering.

- [ ] **Step 1: Read `bulkPayInstallments` in full**

Read `web/src/db/queries/financial.ts` from the `export async function bulkPayInstallments` line to the end of the function. Note that it pays the full remaining balance per installment: `totalDue` is both the amount charged and the amount allocated. That behaviour stays.

- [ ] **Step 2: Write the failing tests**

Create `web/src/db/queries/__tests__/financial-bulk-pay.test.ts` with the `chain()` proxy. Cover:

1. The amount charged for a single unpaid overdue installment equals `quoteInstallment(base, [], paidAt).totalDue`.
2. **[AR-5]** After a prior overdue payment that covered the fine and interest but no principal, the fine is not charged again.
3. A backdated bulk payment with a later payment already on record rewrites that later record's allocation columns.
4. Reversed payment records are excluded.

- [ ] **Step 3: Load the payment history per installment**

Inside the per-installment loop, load its live payment records the way B1 did in `recordPayment`, filtered on `isNull(paymentRecords.reversedAt)` and ordered by `paidAt`.

- [ ] **Step 4: Replace the ad-hoc pricing block**

Delete the block that computes `daysOverdue`, `fineAmount`, `remainingPrincipal`, `interestAmount`, `totalDue`, `state` and `allocation` (currently `financial.ts:896-923`). Replace it with the same shape B1 used, with the difference that bulk pay charges the full quote rather than a caller-supplied amount, so there is no overpayment guard:

```ts
      const base: InstallmentBase = {
        amount: installmentAmount,
        dueDate: row.dueDate,
        appliedFineValue: appliedFineValue!,
        appliedFineType: appliedFineType!,
        appliedInterestRate: appliedInterestRate!,
        gracePeriodDays,
      }

      const priorPayments: PaymentInput[] = existingPayments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paidAt: new Date(p.paidAt).toISOString(),
      }))

      const totalDue = quoteInstallment(base, priorPayments, paidAt).totalDue

      const BULK_PAYMENT_SENTINEL = '__bulk__'
      const replay = replayPayments(base, [
        ...priorPayments,
        { id: BULK_PAYMENT_SENTINEL, amount: totalDue, paidAt: paidAt.toISOString() },
      ])

      const newPayment = replay.payments.find((p) => p.id === BULK_PAYMENT_SENTINEL)!
      const allocation = {
        interestCovered: newPayment.interestCovered,
        fineCovered: newPayment.fineCovered,
        principalCovered: newPayment.principalCovered,
      }

      for (const replayed of replay.payments) {
        if (replayed.id === BULK_PAYMENT_SENTINEL) continue
        const existing = existingPayments.find((ep) => ep.id === replayed.id)
        if (!existing) continue
        await tx
          .update(paymentRecords)
          .set({
            interestCovered: replayed.interestCovered.toFixed(2),
            fineCovered: replayed.fineCovered.toFixed(2),
            principalCovered: replayed.principalCovered.toFixed(2),
          })
          .where(eq(paymentRecords.id, existing.id))
      }

      const finalAmountPaid = replay.installmentState.amountPaid
```

Then update the installment write below to use `replay.installmentState` for `fineAmount`, `interestAmount` and `lastFineInterestCalcAt`, matching what B1 did in `recordPayment`. Read B1's finished `recordPayment` before writing this, and keep the two shapes identical.

If `totalDue` is 0, skip the installment: creating a zero payment record and a zero cash movement is noise. Keep whatever the current code does for an installment that is already settled.

- [ ] **Step 5: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/db/queries`. Do not commit.

---

### Task C2: The dialog reads the server's price

**Files:**
- Create: `web/src/hooks/queries/use-installment-quote.ts`
- Modify: `web/src/components/financial/partial-payment-dialog.tsx`
- Modify: `web/src/components/financial/installment-table.tsx`
- Modify: `web/src/hooks/queries/query-keys.ts`
- Test: `web/src/components/financial/__tests__/partial-payment-dialog.test.tsx`

**Interfaces:**
- Consumes: the quote endpoint from B2.
- Produces: `PartialPaymentDialog`'s `installment` prop narrows to `{ id: string; amount: number }`.

- [ ] **Step 1: Read the current files**

Read `partial-payment-dialog.tsx` in full, `query-keys.ts` in full, and one existing hook under `web/src/hooks/queries/` to match its shape.

- [ ] **Step 2: Add the query key and the hook**

Add to the `financial` group in `query-keys.ts`:

```ts
    installmentQuote: (id: string, paidAt?: string) =>
      ['financial', 'installmentQuote', id, paidAt ?? 'now'] as const,
```

Create `web/src/hooks/queries/use-installment-quote.ts`:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { InstallmentQuoteResult } from '@/db/queries/financial-quote'

export function useInstallmentQuote(installmentId: string, paidAt?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.financial.installmentQuote(installmentId, paidAt),
    enabled,
    queryFn: async (): Promise<InstallmentQuoteResult> => {
      const url = paidAt
        ? `/api/financial/installments/${installmentId}/quote?paidAt=${encodeURIComponent(paidAt)}`
        : `/api/financial/installments/${installmentId}/quote`
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      return (await res.json()).data
    },
  })
}
```

The type import is `import type`, so it is erased at build time and no server module reaches the browser bundle.

- [ ] **Step 3: Rewire the dialog**

- Narrow the prop to `installment: { id: string; amount: number }`.
- Delete `remainingPrincipal`, the local `totalDue`, and the `useState` initialiser that masked it.
- Derive the payment instant once, and use it for both the quote and the mutation:

```ts
  // A picked day equal to today is sent as "no date" so the server uses the
  // real instant. BR noon on today is ahead of the wall clock all morning, and
  // the API rejects a future payment date.
  const paidAtIso = useMemo(() => {
    if (!paidAt || paidAt === brToday()) return undefined
    return parseBrDate(paidAt, '12:00:00').toISOString()
  }, [paidAt])

  const {
    data: quote,
    isFetching: isQuoting,
    error: quoteError,
  } = useInstallmentQuote(installment.id, paidAtIso, open)
```

Import `parseBrDate` and `brToday` from `@/lib/dates`. **[AR-3]** The `paidAt === brToday()` branch is load-bearing; do not remove it.

- Prefill from the quote, and reprefill on every new quote unless the user has edited the field:

```ts
  const [amountStr, setAmountStr] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)

  useEffect(() => {
    if (!quote || amountTouched) return
    setAmountStr(maskCurrency(String(Math.round(quote.totalDue * 100))))
  }, [quote, amountTouched])
```

Call `setAmountTouched(true)` in the `MaskedInput` `onChange` beside `setAmountStr`.

- Feed the Art. 354 preview from the quote:

```ts
  const allocation = useMemo(() => {
    if (!quote || parsedAmount <= 0) return null
    return allocatePayment(
      {
        amount: installment.amount,
        amountPaid: installment.amount - quote.remainingPrincipal,
        fineAmount: quote.fineAmount,
        interestAmount: quote.interestAmount,
      },
      parsedAmount,
    )
  }, [parsedAmount, quote, installment.amount])
```

- Guard against the server's number, with the 0.01 tolerance:

```ts
  const isOverpayment = quote != null && parsedAmount > quote.totalDue + 0.01
```

- Render "Total pendente" from `quote.remainingPrincipal`, `quote.fineAmount` and `quote.interestAmount`. While `isQuoting` is true, render "Calculando...". **[AR-medium]** `isFetching`, not `isLoading`: a cached quote from a previous date would otherwise look settled while a new one is in flight.
- **[AR-medium]** When `quoteError` is set, render its message and a retry button. Without it a failed quote leaves the dialog silently unusable.
- Send `paidAtIso` in the mutation call, replacing `paidAt ? new Date(paidAt).toISOString() : undefined`.
- Disable confirm while `isQuoting` is true, while `quote` is undefined, or while `quoteError` is set, in addition to the existing conditions.

- [ ] **Step 4: Narrow what the table passes**

In `installment-table.tsx`:

```tsx
          installment={{
            id: payDialogInstallment.id,
            amount: Number(payDialogInstallment.amount),
          }}
```

Task A3 already deleted `getComputedInterest` and left an inline expression at this call site; this removes it along with the rest of the prop. The row-rendering site at line 140 stays as A3 left it.

- [ ] **Step 5: Rewrite the dialog tests**

Mock `@/hooks/queries/use-installment-quote` beside the existing mutations mock. Cover:

1. Prefills from `quote.totalDue`.
2. Renders the breakdown from the quote, not from any prop.
3. **[AR-3]** Picking today sends `undefined` as `paidAt`, both to the hook and to the mutation. Mock `brToday` or freeze the clock with `vi.setSystemTime`.
4. Picking a past date sends BR noon of that day. For `2026-08-15` that is `2026-08-15T15:00:00.000Z`, and never `2026-08-15T00:00:00.000Z`.
5. Blocks confirm above `quote.totalDue + 0.01`, allows it at exactly `quote.totalDue`.
6. Does not overwrite an amount the user edited when the quote refetches.
7. Shows the error and disables confirm when the hook returns an error.

- [ ] **Step 6: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/components/financial`. Do not commit.

---

## Group D

### Task D1: `uncancelEntries`

**Files:**
- Modify: `web/src/db/queries/financial.ts`
- Test: `web/src/db/queries/__tests__/financial-uncancel.test.ts` (create)

**Interfaces:**
- Consumes: `BusinessError`, brought into this file by B1.
- Produces: `export async function uncancelEntries(tenantId: string, userId: string, data: { entryIds: string[]; reason: string }): Promise<{ uncancelledCount: number }>`

**[AR-5]** Renegotiation eligibility must come from `renegotiation_links` and the entry's own creation audit log, never from the cancel audit log. `bulkCancelEntries` writes the batch's `revertedOriginals` array into *every* selected entry's log (`financial.ts:1133-1150`), so an ordinary charge cancelled beside a renegotiated one would be falsely refused forever. And cancelling the *original* side of a renegotiation writes no marker at all, so reactivating it would resurrect a debt whose replacement is still live and collectible.

Two separate refusals are needed:

- The entry is a **replacement** whose links were deleted on cancel. Its creation log records `type: 'renegotiation'` (`web/src/db/queries/renegotiation.ts:272-285`), which is per-entry and written once.
- The entry is an **original** whose replacement still exists. A live `renegotiation_links` row has it as `originalEntryId`.

- [ ] **Step 1: Read the neighbours**

Read `bulkCancelEntries` in full, and `web/src/db/queries/renegotiation.ts` lines 170 to 290.

- [ ] **Step 2: Write the failing tests**

Create `web/src/db/queries/__tests__/financial-uncancel.test.ts` with the `chain()` proxy. Cover:

1. Restores a cancelled entry: its `cancelled` installments go to `pending` and `updateEntryStatus` is called.
2. `BusinessError` code `ENTRY_NOT_CANCELLED` when any selected entry is not `cancelled`.
3. `BusinessError` code `ENTRY_NOT_FOUND` when an id belongs to another tenant.
4. **[AR-5]** `BusinessError` code `ENTRY_FROM_RENEGOTIATION` when the entry's creation log has `changes.type.new === 'renegotiation'`.
5. **[AR-5]** `BusinessError` code `ENTRY_HAS_REPLACEMENT` when a `renegotiation_links` row has the entry as `originalEntryId`.
6. **[AR-5]** An ordinary entry whose cancel log carries a batch-wide `revertedOriginals` array is **allowed**, because that marker is not per-entry. This test is the regression guard for the v1 mistake.
7. Writes one audit log per entry, carrying the reason.

- [ ] **Step 3: Run to verify they fail**

- [ ] **Step 4: Write `uncancelEntries`**

Insert directly after `bulkCancelEntries`:

```ts
/**
 * Reverses `bulkCancelEntries`. Statuses are recomputed by `updateEntryStatus`
 * rather than restored from a stored value, so a charge that had a payment
 * before it was cancelled comes back `partial`, not `pending`.
 */
export async function uncancelEntries(
  tenantId: string,
  userId: string,
  data: { entryIds: string[]; reason: string }
) {
  return withTransaction(async (tx) => {
    const entries = await tx
      .select({ id: financialEntries.id, status: financialEntries.status })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          inArray(financialEntries.id, data.entryIds),
          isNull(financialEntries.deletedAt)
        )
      )

    if (entries.length !== data.entryIds.length) {
      const foundIds = entries.map((e) => e.id)
      const missing = data.entryIds.filter((id) => !foundIds.includes(id))
      throw new BusinessError(
        'ENTRY_NOT_FOUND',
        `Cobranças não encontradas: ${missing.join(', ')}`
      )
    }

    if (entries.some((e) => e.status !== 'cancelled')) {
      throw new BusinessError(
        'ENTRY_NOT_CANCELLED',
        'Apenas cobranças canceladas podem ser reativadas'
      )
    }

    // Reactivating an original whose replacement is still live would make the
    // same debt collectible twice.
    const liveReplacements = await tx
      .select({ originalEntryId: renegotiationLinks.originalEntryId })
      .from(renegotiationLinks)
      .where(inArray(renegotiationLinks.originalEntryId, data.entryIds))

    if (liveReplacements.length > 0) {
      throw new BusinessError(
        'ENTRY_HAS_REPLACEMENT',
        'Esta cobrança foi renegociada e a cobrança substituta continua ativa. Cancele a substituta primeiro.'
      )
    }

    // A replacement charge loses its renegotiation_links rows when it is
    // cancelled, so its own creation log is the only per-entry record that it
    // was one. The cancel log's `revertedOriginals` is written for the whole
    // batch and must not be used here.
    const creationLogs = await tx
      .select({ entityId: auditLogs.entityId, changes: auditLogs.changes })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'financial_entry'),
          eq(auditLogs.action, 'create'),
          inArray(auditLogs.entityId, data.entryIds)
        )
      )

    const isReplacement = creationLogs.some((log) => {
      const changes = log.changes as { type?: { new?: unknown } } | null
      return changes?.type?.new === 'renegotiation'
    })
    if (isReplacement) {
      throw new BusinessError(
        'ENTRY_FROM_RENEGOTIATION',
        'Esta cobrança veio de uma renegociação cancelada. Refaça a renegociação.'
      )
    }

    const now = new Date()

    await tx
      .update(installments)
      .set({ status: 'pending', updatedAt: now })
      .where(
        and(
          eq(installments.tenantId, tenantId),
          inArray(installments.financialEntryId, data.entryIds),
          eq(installments.status, 'cancelled')
        )
      )

    for (const entryId of data.entryIds) {
      await updateEntryStatus(tx, tenantId, entryId)

      await createAuditLog(
        {
          tenantId,
          userId,
          action: 'update',
          entityType: 'financial_entry',
          entityId: entryId,
          changes: {
            status: { old: 'cancelled', new: 'reactivated' },
            reason: { old: null, new: data.reason },
          },
        },
        tx
      )
    }

    return { uncancelledCount: data.entryIds.length }
  })
}
```

Add `auditLogs` to the `@/db/schema` import if absent. `renegotiationLinks` is already imported.

- [ ] **Step 5: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/db/queries`. Do not commit.

---

### Task D2: The un-cancel route

**Files:**
- Create: `web/src/app/api/financial/bulk/uncancel/route.ts`
- Modify: `web/src/validations/financial.ts`
- Test: `web/src/validations/__tests__/financial.test.ts`

**Interfaces:**
- Consumes: `uncancelEntries` from D1.
- Produces: `bulkUncancelSchema`, `BulkUncancelInput`, `POST /api/financial/bulk/uncancel`.

- [ ] **Step 1: Add the schema and its test**

Read `bulkCancelSchema` and mirror it:

```ts
export const bulkUncancelSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma cobrança'),
  reason: z.string().min(1, 'Motivo é obrigatório'),
})
```

Add `export type BulkUncancelInput = z.infer<typeof bulkUncancelSchema>` beside the other exported types. Test that an empty `entryIds` and an empty `reason` are both rejected.

- [ ] **Step 2: Write the route**

Read `web/src/app/api/financial/bulk/cancel/route.ts` and mirror it, including its role check of `['owner', 'financial']`, calling `uncancelEntries`. Use the `BusinessError` catch:

```ts
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
```

If the cancel route writes an audit log at the route level, write the matching one here.

- [ ] **Step 3: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/validations`. Do not commit.

---

## Group E

### Task E1: The Reativar action

**Files:**
- Modify: `web/src/hooks/mutations/use-financial-mutations.ts`
- Modify: `web/src/components/financial/bulk-action-bar.tsx`
- Modify: `web/src/components/financial/financial-list.tsx`
- Test: `web/src/components/financial/__tests__/bulk-action-bar.test.tsx`

**Interfaces:**
- Consumes: `POST /api/financial/bulk/uncancel` from D2.
- Produces: `useBulkUncancel`, and a `canUncancel` prop on `BulkActionBar`.

- [ ] **Step 1: Add the mutation hook**

In `use-financial-mutations.ts`, add `useBulkUncancel` as a copy of `useBulkCancel` with the URL `/api/financial/bulk/uncancel`. The invalidation list is identical.

- [ ] **Step 2: Fix the bulk pay date**

**[AR-4]** In `handleBulkPay`, the current expression is `paidAt: paidAt ? new Date(paidAt).toISOString() : undefined`. `paidAt` starts as `''` and the field is optional, so the guard must stay. `parseBrDate('')` throws. Replace it with, and only with:

```ts
        paidAt:
          paidAt && paidAt !== brToday()
            ? parseBrDate(paidAt, '12:00:00').toISOString()
            : undefined,
```

Import `parseBrDate` and `brToday` from `@/lib/dates`. The `brToday()` branch is the same one the dialog needs: BR noon on today is ahead of the wall clock all morning and the API would reject it.

- [ ] **Step 3: Add the Reativar action**

In `bulk-action-bar.tsx`:

- Add `canUncancel = false` to the props type and destructuring.
- Add `uncancelDialogOpen` and `uncancelReason` state and a `handleBulkUncancel` mirroring `handleBulkCancel`.
- Render a "Reativar" button only when `canUncancel` is true, using `RefreshCwIcon`, already imported.
- Add its confirmation dialog with a required reason field, mirroring the cancel dialog.
- Correct the cancel dialog copy: replace "Esta ação não pode ser desfeita." with "Cobranças canceladas podem ser reativadas depois."

- [ ] **Step 4: Compute `canUncancel`**

In `financial-list.tsx`, beside the `canRenegotiate` memo:

```ts
  const canUncancel = useMemo(
    () => selectedEntries.length > 0 && selectedEntries.every((e) => e.status === 'cancelled'),
    [selectedEntries],
  )
```

Pass `canUncancel={canUncancel}` to `BulkActionBar`.

- [ ] **Step 5: Write the tests**

Extend `bulk-action-bar.test.tsx`, mocking `useBulkUncancel` beside the existing mocks. Cover:

1. Reativar is absent when `canUncancel` is false, present when true.
2. Confirming calls the mutation with the selected entry ids and the typed reason.
3. Confirm stays disabled while the reason is empty.
4. **[AR-4]** Bulk pay with no date selected sends `paidAt: undefined` and does not throw. This is the regression guard for the v1 mistake.
5. **[AR-3]** Bulk pay with today selected sends `paidAt: undefined`.
6. Bulk pay with a past date sends BR noon of that day.

- [ ] **Step 6: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/components/financial`. Do not commit.

---

## Final verification

- [ ] `pnpm --filter @floraclin/web test:run`
- [ ] `pnpm ci:checks`
- [ ] `rg 'new Date\(paidAt\)' web/src` returns nothing.
- [ ] `rg 'excede o total devido' web/src` shows the throw only in `financial.ts` and tests, never client-side.
- [ ] `rg 'revertedOriginals' web/src` shows it only in `bulkCancelEntries` and tests, never in un-cancel logic.
- [ ] `rg 'parseBrDate\(' web/src/components` shows every call guarded against an empty string.

## Known gaps, deliberately not in scope

- **Grace period is not snapshotted per installment** (`financial.ts:399-421` snapshots fine and rate but reads the tenant's current grace). Changing grace retroactively repricess old payments on replay. Pre-existing; a separate change.
- **`getFinancialEntry` re-applies a covered fine for display** (`financial.ts:1430-1452`), so the table can show a fine `quoteInstallment` says is zero. Display-only divergence; a separate change.
- Expense installment payments share none of this code.
- Rebuilding a renegotiation after its replacement was cancelled.
- Per-installment cancel and un-cancel.

## Spec coverage

| Spec section | Tasks |
|---|---|
| Part 1, one pricer | A1, B1, C1 |
| Part 2, quote endpoint and dialog | B2, C2 |
| Part 3, backdate rules and Meta | A2, B1 |
| Part 4, un-cancel | D1, D2, E1 |
| Part 5.1, timezone | C2, E1 |
| Part 5.2, dual pricing | B2, C1, C2 |
| Part 5.3, the 500 | B1 |
| Part 5.4, grace typo | A3 |
