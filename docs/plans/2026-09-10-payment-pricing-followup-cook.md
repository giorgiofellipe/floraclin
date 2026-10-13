# Payment pricing follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six decisions left open by the review of `fix/payment-pricing-and-uncancel` (PR #43), on the same branch.

**Architecture:** The replay engine in `penalties.ts` gets four semantic repairs (BR calendar-day arithmetic, an absolute fine gate, an explicit `asOf`, and a `recordedAt` tie-break) and one guard (no fine on a settled balance). Every remaining pricer that is not the engine (`getFinancialEntry`, renegotiation) is routed through `quoteInstallment` and its inline math deleted, along with `getDaysOverdue`. Overpayments are accepted and recorded at the amount received, with the excess derivable from the row and visible in the UI, never applied as a credit.

**Tech Stack:** Next.js 16.2.3 App Router, Drizzle ORM on Postgres (`floraclin` schema), Zod, TanStack Query, Vitest + Testing Library.

**Spec:** the decisions recorded in the session transcript, confirmed against `~/Work/revezza/api/src/services/fine-interest-calculation.service.ts`:

| # | Decision |
|---|---|
| 1 | `getFinancialEntry` and renegotiation price through `quoteInstallment` |
| 2 | Overpayments accepted and recorded at the amount received; excess derived, shown, never a credit |
| 3 | `replayPayments` takes `asOf` |
| 4 | Days are BR calendar days; the fine is gated on the absolute due date plus grace |
| 5 | Equal `paidAt` ties break on `recordedAt` |
| 6 | The quote refuses settled and cancelled installments; no fine on a settled balance |

**Review history:** v1 of this plan was REJECTED by adversarial review with three consensus high findings. This is v2. Sections marked **[AR2-n]** exist because of finding n; do not "simplify" them back.

## Global Constraints

- Branch: `fix/payment-pricing-and-uncancel`, worked in the worktree `.claude/worktrees/fix+payment-pricing-and-uncancel`. The main checkout has a merge in progress and must not be touched.
- **Implementation agents must not run `git add` or `git commit`.** The orchestrator commits per group.
- Never `new Date("YYYY-MM-DD")` bare, never `.toISOString().split('T')[0]`. Use `@/lib/dates`. See `AGENTS.md`.
- No em dashes. Comments only where a competent reader would get it wrong without one; see `CLAUDE.md`.
- Delete the path you replace. `getDaysOverdue`, `parseOverdueReference`, and the inline penalty math in `getFinancialEntry` and `renegotiation.ts` go away, they do not get a compatibility shim.
- Tests: `pnpm --filter @floraclin/web test:run`. Never hit Supabase; mock `@/db/client` with the `chain()` proxy from `web/src/db/queries/__tests__/financial-meta.test.ts`. Mock sequences are positional.
- Money figures in tests are computed by hand first, then asserted. A test that passes against the pre-change code pins nothing; its comment must say so.
- `payment_records.recorded_at` already exists (`NOT NULL DEFAULT now()`). No migration in this plan.
- **Two instants, never confused. [AR2-1]** A write path holds `paidAt` (what the operator typed, anchors the new payment's position and price) and `now` (captured once, after the installment lock, used for the persisted state and as the new row's `recordedAt`). The quote for the new payment uses `paidAt`. The replay that produces the state to persist uses `now`, because it includes payments dated after `paidAt`.

---

## Parallelization Groups

| Group | Tasks | Owner of `db/queries/financial.ts` |
|---|---|---|
| A | A1 | nobody |
| B | B1, B2, B3, B4 | B1 |
| C | C1, C2 | nobody |

Groups run in order. Tasks within a group own disjoint files.

---

## Group A

### Task A1: Engine repairs in `penalties.ts`

**Files:**
- Modify: `web/src/lib/financial/penalties.ts`
- Modify: `web/src/lib/dates.ts`
- Test: `web/src/lib/financial/__tests__/penalties.test.ts`
- Test: `web/src/lib/__tests__/dates.test.ts` (extend; create if absent, matching neighbouring test layout)

**Interfaces:**
- Consumes: `toBrYmd`, `shiftBrYmd` from `@/lib/dates`.
- Produces:
  - `export function brDayIndex(date: Date): number` and `export function ymdDayIndex(ymd: string): number` in `dates.ts`.
  - `PaymentInput.recordedAt: string` **required** (not optional). **[AR2-min3]**
  - `replayPayments(base, payments, asOf: Date)`: third argument required.
  - `getDaysOverdue` and `parseOverdueReference` are deleted from `penalties.ts`.

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/__tests__/dates.test.ts` (read the existing file first and extend it):

```ts
describe('brDayIndex', () => {
  it('resolves an instant to the BR calendar day containing it', () => {
    // 00:30 UTC on Sep 3 is 21:30 BRT on Sep 2.
    expect(brDayIndex(new Date('2026-09-03T00:30:00.000Z'))).toBe(ymdDayIndex('2026-09-02'))
    expect(brDayIndex(new Date('2026-09-03T03:30:00.000Z'))).toBe(ymdDayIndex('2026-09-03'))
  })

  it('counts whole calendar days between two instants regardless of clock time', () => {
    const noon = new Date('2026-05-22T15:00:00.000Z') // 12:00 BRT May 22
    const nextMorning = new Date('2026-05-23T13:00:00.000Z') // 10:00 BRT May 23
    expect(brDayIndex(nextMorning) - brDayIndex(noon)).toBe(1)
  })
})
```

In `web/src/lib/financial/__tests__/penalties.test.ts`:

1. Delete the whole `describe('getDaysOverdue', ...)` block. The function is going away.
2. Add a fixture helper at the top so `recordedAt` being required does not bloat every case:

```ts
function pay(
  id: string,
  amount: number,
  paidAt: string,
  recordedAt: string = paidAt,
): PaymentInput {
  return { id, amount, paidAt, recordedAt }
}
```

Rewrite every existing payment literal through it. Every existing `replayPayments(BASE, [...])` call (13 of them) gains a third argument, `new Date('2026-09-03T14:04:50.000Z')` unless the test's own comment implies a different instant. In `describe('replayPayments carried interest', ...)`, delete the `vi.useFakeTimers` / `vi.setSystemTime` setup and pass that instant as `asOf`; the wall clock is no longer read.
3. **[AR2-skep8]** Two existing comments teach the wrong timezone model and must be corrected while you are in the file: `2026-02-01T00:00:00Z` is January 31 in BR, not "31 days overdue" from Jan 1 (it is 30); `2026-09-03T00:00:00Z` is September 2 in BR, not "the same BR day" as `14:04:50Z`. Assertions stay; comments change to say what the instants actually are in BR.
4. Add:

```ts
describe('replayPayments asOf', () => {
  // The wall clock is frozen on a different day so this fails against an
  // implementation that ignores asOf and reads new Date().
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T14:04:50.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('prices the trailing interest at asOf, not at the wall clock', () => {
    const tiny = pay('p1', 1, '2026-09-03T14:04:50.000Z')
    const later = replayPayments(BASE, [tiny], new Date('2026-09-13T14:04:50.000Z'))
    // 25 carried plus ten more days on 750 at 1%/month.
    expect(later.installmentState.interestAmount).toBe(27.5)
  })
})

describe('fine gate on the absolute due date', () => {
  // Two payments under 24h apart used to floor to zero days each and dodge
  // the fine entirely. Calendar-day arithmetic fixes the count; the gate on
  // the absolute due date fixes the trigger.
  it('charges the fine on a payment the day after the due date even if a payment landed on the due date', () => {
    const onDueDay = pay('p1', 100, '2026-05-22T15:00:00.000Z') // 12:00 BRT May 22
    const q = quoteInstallment(BASE, [onDueDay], new Date('2026-05-23T13:00:00.000Z')) // 10:00 BRT May 23
    expect(q.fineAmount).toBe(15)
    expect(q.interestAmount).toBe(0.22) // 650 * 1%/30 * 1 day
  })

  // The next two also pass against the pre-change code; they characterise the
  // boundary so the calendar-day rewrite cannot move it.
  it('does not charge the fine on the due date itself', () => {
    const q = quoteInstallment(BASE, [], new Date('2026-05-22T23:00:00.000Z')) // 20:00 BRT May 22
    expect(q.fineAmount).toBe(0)
  })

  it('charges the fine the calendar day after grace ends', () => {
    const withGrace = { ...BASE, gracePeriodDays: 5 }
    expect(quoteInstallment(withGrace, [], new Date('2026-05-27T20:00:00.000Z')).fineAmount).toBe(0)
    expect(quoteInstallment(withGrace, [], new Date('2026-05-28T13:00:00.000Z')).fineAmount).toBe(15)
  })
})

describe('no fine on a settled balance', () => {
  it('quotes zero for an installment paid in full before the due date, months later', () => {
    const early = pay('p1', 750, '2026-05-01T15:00:00.000Z')
    const q = quoteInstallment(BASE, [early], new Date('2026-09-03T14:04:50.000Z'))
    expect(q.remainingPrincipal).toBe(0)
    expect(q.fineAmount).toBe(0)
    expect(q.interestAmount).toBe(0)
    expect(q.totalDue).toBe(0)
  })
})

describe('tie-break on recordedAt', () => {
  it('orders equal paidAt by recordedAt, and the in-flight payment last', () => {
    const t = '2026-09-03T15:00:00.000Z'
    const older = pay('zzz', 30, t, '2026-09-03T15:00:01.000Z')
    const inFlight = pay('__new__', 30, t, '2026-09-03T15:00:09.000Z')
    const result = replayPayments(BASE, [inFlight, older], new Date(t))
    expect(result.payments.map((p) => p.id)).toEqual(['zzz', '__new__'])
    // The older payment takes the interest; the in-flight one hits the fine.
    expect(result.payments[0].interestCovered).toBe(26)
    expect(result.payments[1].interestCovered).toBe(0)
  })

  it('is stable when the in-flight id is replaced by a uuid on a later replay', () => {
    const t = '2026-09-03T15:00:00.000Z'
    const a = pay('zzz', 30, t, '2026-09-03T15:00:01.000Z')
    const b = pay('00000000-0000-4000-8000-000000000001', 30, t, '2026-09-03T15:00:09.000Z')
    const result = replayPayments(BASE, [b, a], new Date(t))
    expect(result.payments.map((p) => p.id)).toEqual(['zzz', b.id])
  })
})
```

Hand-checked figures: due 2026-05-22, grace 0, 750 principal, 1%/month. May 23 vs May 22 is one BR calendar day; after a 100 payment on the due day (no fine, no interest, all principal), 650 remains; 650 × 0.01 / 30 × 1 = 0.2167 → 0.22. Ten more days on 750 = 2.50, so 25 + 2.50 = 27.50.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @floraclin/web test:run src/lib`

- [ ] **Step 3: Add the day-index helpers to `dates.ts`**

Append, next to `toBrYmd`:

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Days since epoch of a `YYYY-MM-DD` calendar day, for whole-day arithmetic. */
export function ymdDayIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

/**
 * Days since epoch of the BR calendar day containing `date`. Subtracting two
 * of these counts calendar days the way a person does: 21:00 and 10:00 the
 * next morning are one day apart, not 0.54 of one.
 */
export function brDayIndex(date: Date): number {
  return ymdDayIndex(toBrYmd(date))
}
```

If `MS_PER_DAY` already exists in the file under another name, reuse it. `ymdDayIndex` stays exported: the due date is a date-only value with no instant, so it is the honest primitive for it. **[AR2-min4]**

- [ ] **Step 4: Replace the day arithmetic in `penalties.ts`**

Delete `parseOverdueReference`, `getDaysOverdue`, `daysOfInterest`, and the `MS_PER_DAY` constant if nothing else uses it. Replace the import of `startOfBrDay` with `import { brDayIndex, shiftBrYmd, ymdDayIndex } from '@/lib/dates'`. Add exactly two helpers; there is no separate `overdueDays`, since it is `daysOfInterest(base, null, asOf)`. **[AR2-min4]**

```ts
/** Day index of the last day that is NOT overdue: the due date plus grace. */
function lastGraceDayIndex(base: InstallmentBase): number {
  return ymdDayIndex(shiftBrYmd(base.dueDate, base.gracePeriodDays))
}

/**
 * Whole BR calendar days of interest owed at `asOf`. The clock starts the day
 * after grace ends, or at the last payment, whichever is later. With no last
 * payment this is also the absolute overdue count from the due date, which is
 * what gates the fine: an interval that restarts at each payment can stay
 * under a day forever.
 */
function daysOfInterest(
  base: InstallmentBase,
  lastCalcAt: string | null,
  asOf: Date,
): number {
  const start = Math.max(
    lastGraceDayIndex(base),
    lastCalcAt ? brDayIndex(new Date(lastCalcAt)) : Number.NEGATIVE_INFINITY,
  )
  return Math.max(0, brDayIndex(asOf) - start)
}
```

- [ ] **Step 5: `PaymentInput`, the sort, the fine gate, `asOf`**

```ts
export interface PaymentInput {
  amount: number
  paidAt: string
  recordedAt: string
  id?: string
}
```

`replayPayments` signature becomes `(base: InstallmentBase, payments: PaymentInput[], asOf: Date): ReplayResult`. Inside:

```ts
  // paidAt is what the operator typed and is anchored to BR noon, so ties are
  // common. recordedAt is when the row was written, so it is the order the
  // payments actually happened in and it survives the in-flight sentinel being
  // replaced by a real id.
  const sorted = [...payments].sort((a, b) => {
    const byDate = new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()
    if (byDate !== 0) return byDate
    const byRecorded = a.recordedAt.localeCompare(b.recordedAt)
    if (byRecorded !== 0) return byRecorded
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
```

In the loop, replace the fine gate. `remainingPrincipal` moves above it:

```ts
    const remainingPrincipal = round2(base.amount - amountPaid)
    if (
      !fineApplied &&
      remainingPrincipal > 0 &&
      daysOfInterest(base, null, paymentDate) > 0
    ) {
      fineAmount = calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      fineApplied = true
    }
```

Interest for the payment keeps using `daysOfInterest(base, lastCalcAt, paymentDate)`. The trailing state uses the parameter:

```ts
  const currentInterest = round2(
    carriedInterest +
      calculateInterest(
        round2(base.amount - amountPaid),
        daysOfInterest(base, lastCalcAt, asOf),
        base.appliedInterestRate,
      ),
  )
```

- [ ] **Step 6: `quoteInstallment`**

Pass `asOf` through: `replayPayments(base, upToAsOf, asOf)`. Replace the fine expression, with `remainingPrincipal` moved above it:

```ts
  const remainingPrincipal = round2(Math.max(base.amount - amountPaid, 0))

  // No principal outstanding means nothing to be late on. A prepaid
  // installment must not grow a fine months after it was settled.
  const fineAmount =
    !replay.installmentState.fineApplied &&
    remainingPrincipal > 0 &&
    daysOfInterest(base, null, asOf) > 0
      ? calculateFine(base.amount, base.appliedFineType, base.appliedFineValue)
      : replay.installmentState.fineAmount
```

- [ ] **Step 7: Run and reconcile**

Run: `pnpm --filter @floraclin/web test:run src/lib`
Expected: PASS. The pre-existing expectations in `quoteInstallment`, `interest origin`, and `carried interest` were hand-checked to hold under calendar-day arithmetic (104, 103, 99, 31, 104 days; 25.65, 24.42, 25). If one moves, the day arithmetic is wrong, not the expectation. Then `pnpm typecheck` will fail on the callers in `financial.ts`, `financial-quote.ts` and `renegotiation.ts` until Group B lands. Report which, do not touch them.

`penalty-preview.tsx` imports only `calculateFine` and `calculateInterest`, which stay exported. Confirm with `rg -n "from '@/lib/financial/penalties'" web/src/components`.

- [ ] **Step 8: Report**

Do not commit.

---

## Group B

### Task B1: Write paths and the entry-detail projection

**Files:**
- Modify: `web/src/db/queries/financial.ts`
- Test: `web/src/db/queries/__tests__/financial-payment.test.ts`
- Test: `web/src/db/queries/__tests__/financial-bulk-pay.test.ts`
- Test: `web/src/db/queries/__tests__/financial-reverse.test.ts` (create) **[AR2-skep6]**
- Test: `web/src/db/queries/__tests__/financial-entry.test.ts` (create) **[AR2-3]**
- Test: `web/src/db/queries/__tests__/financial-meta.test.ts` (only if a mock sequence shifts)

**Interfaces:**
- Consumes: A1's `replayPayments(base, payments, asOf)`, `PaymentInput.recordedAt`, `quoteInstallment`.
- Produces: `recordPayment`'s returned `allocation` gains `excessAmount: number`. `PAYMENT_EXCEEDS_DUE` no longer exists.

- [ ] **Step 1: Update and add tests first**

`financial-payment.test.ts`:
- "790.77 exceeds … and is rejected" becomes "790.77 is accepted, recorded at 790.77, and allocated 790.75 with 0.02 excess". Assert the `paymentRecords` insert payload has `amount: '790.77'`, covered fields summing to 790.75, `recordedAt` set to the captured instant, and the `cashMovements` insert has `amount: '790.77'`. Assert the returned `allocation.excessAmount` is `0.02`.
- "790.76 is within the 0.01 tolerance … capped" becomes "790.76 is recorded at 790.76", `excessAmount` `0.01`.
- Remove every `PAYMENT_EXCEEDS_DUE` reference.
- Add "an overpayment still marks the installment paid": amount 900, the installment update carries `status: 'paid'` and `amountPaid: '750.00'`.
- Add **[AR2-1]** "a backdated partial payment persists interest as of now, not as of the payment date": freeze the clock at `2026-09-10T14:04:50.000Z`; prior record R$100 `paidAt` `2026-08-01T12:00:00.000Z`; new payment R$100 `paidAt` `2026-06-22T12:00:00.000Z`. Assert the installment update carries `interestAmount: '7.76'` and `lastFineInterestCalcAt` equal to the August date. Hand-checked: Jun 22 is 31 days past due → fine 15, interest 7.75, principal 77.25; Aug 1 is 40 days later on 672.75 → interest 8.97, principal 91.03; Sep 10 is 40 days after Aug 1 on 581.72 → 7.7563 → 7.76. Against the v1 plan this stored `'0.00'`.
- Add **[AR2-skep4]** "a backdated payment that is completed by a later existing payment stamps the later payment's date and method": prior record R$700 on Aug 1 via `pix`; new payment R$109 on Jun 22 via `cash` (frozen Sep 10). Replay settles on Aug 1. Assert the installment update carries `paidAt` equal to the August instant and `paymentMethod: 'pix'`.
- Every mocked `paymentRecords` row gains `recordedAt`.

`financial-bulk-pay.test.ts`: mock rows gain `recordedAt`. Assert the inserted record carries `recordedAt`. Nothing else changes.

`financial-reverse.test.ts` (new) **[AR2-skep6]**, with the `chain()` harness. Read `reversePayment` in full first to map its selects in order. Two cases:
1. Reversing a R$900 overpayment writes a R$900 outflow (`cashMovements` insert `amount: '900.00'`), not the R$791 it allocated.
2. Reversing the payment that triggered the fine leaves the installment with `fineAmount: '15.00'` and `fineApplied` semantics intact: the remaining later payment absorbs it on replay. Fixture: due May 22; p1 R$30 on Jun 22 (took the fine), p2 R$30 on Jul 22; reverse p1; assert the p2 allocation update carries `fineCovered` > 0.
If case 2 proves impractical against the mock, say so in the report rather than weakening it.

`financial-entry.test.ts` (new) **[AR2-3]**, with the `chain()` harness. Read `getFinancialEntry` in full first to map its selects. Two cases, clock frozen at `2026-09-13T14:04:50.000Z`:
1. A `pending` installment (750, due May 22) with one live payment of R$1 on Sep 3 (`recordedAt` set) reports `computedInterestAmount: 27.5` and `computedFineAmount: 15`. The v1 inline block reported 2.5 (carried 25 dropped).
2. An `overdue` installment with no payments reports the engine's figures (fine 15, interest for 114 days: 750 × 0.01 / 30 × 114 = 28.5), not the stored `interestAmount`.

- [ ] **Step 2: `recordPayment`** **[AR2-1] [AR2-2]**

Immediately after the `FOR UPDATE` lock resolves and the row checks pass, capture the write instant once:

```ts
    // Captured behind the lock so recordedAt reflects the order payments were
    // actually applied in, and reused for the persisted state so a backdated
    // payment does not freeze the installment's interest at its own date.
    const now = new Date()
```

Delete the guard and the `quote` line:

```ts
    const quote = quoteInstallment(base, priorPayments, paidAt)
    if (data.amount > quote.totalDue + 0.01) { ... }
```

`priorPayments` mapping gains `recordedAt: new Date(p.recordedAt).toISOString()`. The sentinel gains `recordedAt: now.toISOString()`. The state replay is:

```ts
    const replay = replayPayments(
      base,
      [...priorPayments, { id: NEW_PAYMENT_SENTINEL, amount: data.amount, paidAt: paidAt.toISOString(), recordedAt: now.toISOString() }],
      now,
    )
```

```ts
    const paymentAllocation = {
      interestCovered: newPayment.interestCovered,
      fineCovered: newPayment.fineCovered,
      principalCovered: newPayment.principalCovered,
      excessAmount: newPayment.excessAmount,
    }
```

Delete `const actualAmount = ...`. The payment record insert stores the cash received and the captured instant:

```ts
    // The row stores the cash received, not the cash allocated. Anything above
    // the total due is visible as the gap between the two and is not applied
    // to any other charge.
    const [paymentRecord] = await tx
      .insert(paymentRecords)
      .values({
        installmentId: data.installmentId,
        amount: data.amount.toFixed(2),
        ...
        paidAt,
        recordedAt: now,
        ...
```

The cash movement insert also uses `amount: data.amount.toFixed(2)`.

**[AR2-skep4]** The settlement metadata comes from the payment that completed the installment, which is the last one in replay order, not necessarily the new one:

```ts
    const settledBy = replay.payments[replay.payments.length - 1]
    const settledByExisting =
      settledBy.id === NEW_PAYMENT_SENTINEL
        ? null
        : existingPayments.find((ep) => ep.id === settledBy.id) ?? null
    const settledAt = settledByExisting ? new Date(settledByExisting.paidAt) : paidAt
    const settledMethod = settledByExisting
      ? (settledByExisting.paymentMethod as PaymentMethod)
      : data.paymentMethod
```

and in the installment update: `paidAt: isPaid ? settledAt : undefined`, `paymentMethod: isPaid ? settledMethod : undefined`.

- [ ] **Step 3: `bulkPayInstallments`** **[AR2-arch5]**

Add `ORDER BY id` to the `FOR UPDATE` select so bulk pay and renegotiation lock overlapping rows in one order. Capture `const now = new Date()` after the lock, once for the whole batch. Per installment: `priorPayments` gains `recordedAt`; the sentinel gains `recordedAt: now.toISOString()`; the replay call is `replayPayments(base, [...], now)`; the payment record insert gains `recordedAt: now`. Delete the comment "Bulk pay charges the full quote per installment, so there is no overpayment guard the way recordPayment has one"; there is no guard anywhere now.

- [ ] **Step 4: `reversePayment`** **[AR2-skep5]**

`allPayments` mapping gains `recordedAt`. The remaining-payments query orders by `paidAt` then `recordedAt`:

```ts
      .orderBy(paymentRecords.paidAt, paymentRecords.recordedAt)
```

The replay call becomes `replayPayments(base, allPayments, new Date())`. The denormalised final `paidAt` / `paymentMethod` come from the last element of `result.payments` (replay order), resolved back to its record by id, not from the raw array's last element.

- [ ] **Step 5: `getFinancialEntry` prices through the engine** **[AR2-3]**

Replace the raw settings select and the whole inline block that computes `currentInterest` / `currentFine` (from `const gracePeriodDays = settings?.gracePeriodDays ?? 0` through the end of the `if (inst.status === 'pending' ...)` block) with:

```ts
  const settings = await loadFinancialSettings(db, tenantId)
  const now = new Date()

  const installmentsWithDetails = entryInstallments.map((inst) => {
    const payments = paymentsByInstallment.get(inst.id) ?? []

    // Settled and cancelled rows keep what is stored. Everything else is
    // priced by the engine, which is the only thing the payment dialog reads.
    if (inst.status === 'paid' || inst.status === 'cancelled') {
      return {
        ...inst,
        computedInterestAmount: Number(inst.interestAmount ?? 0),
        computedFineAmount: Number(inst.fineAmount ?? 0),
        paymentRecords: payments,
      }
    }

    const base: InstallmentBase = {
      amount: Number(inst.amount),
      dueDate: inst.dueDate,
      appliedFineValue: Number(inst.appliedFineValue ?? settings.fineValue),
      appliedFineType: inst.appliedFineType ?? settings.fineType,
      appliedInterestRate: Number(inst.appliedInterestRate ?? settings.monthlyInterestPercent),
      gracePeriodDays: settings.gracePeriodDays,
    }
    const prior: PaymentInput[] = payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      paidAt: new Date(p.paidAt).toISOString(),
      recordedAt: new Date(p.recordedAt).toISOString(),
    }))
    const quote = quoteInstallment(base, prior, now)

    return {
      ...inst,
      computedInterestAmount: quote.interestAmount,
      computedFineAmount: quote.fineAmount,
      paymentRecords: payments,
    }
  })
```

The `financialSettings` select count is unchanged (one select replaced by one select), so positional mocks elsewhere keep their order. Remove `getDaysOverdue`, `calculateInterest`, `calculateFine` from this file's import if nothing else in the file uses them; check with `rg`.

- [ ] **Step 6: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/db/queries`. Then `pnpm typecheck`; the remaining errors must be only in `financial-quote.ts` and `renegotiation.ts`, which B2 and B3 own. Do not commit.

---

### Task B2: The quote refuses settled and cancelled installments

**Files:**
- Modify: `web/src/db/queries/financial-quote.ts`
- Test: `web/src/db/queries/__tests__/financial-quote.test.ts`
- Test: `web/src/app/api/financial/installments/[id]/quote/__tests__/route.test.ts` (only if a 409 case is missing)

**Interfaces:**
- Consumes: A1's `PaymentInput.recordedAt`.
- Produces: `getInstallmentQuote` throws `BusinessError` codes `INSTALLMENT_ALREADY_PAID` and `INSTALLMENT_CANCELLED`, the same codes and messages `recordPayment` uses.

- [ ] **Step 1: Tests**

Add to `financial-quote.test.ts`: a `paid` row throws `INSTALLMENT_ALREADY_PAID`; a `cancelled` row throws `INSTALLMENT_CANCELLED`; neither reaches the payments select (assert `dbMock.select` call count). Mock payment rows gain `recordedAt`.

- [ ] **Step 2: Implement**

After the `!inst` check:

```ts
  if (inst.status === 'paid') {
    throw new BusinessError('INSTALLMENT_ALREADY_PAID', 'Parcela já está totalmente paga')
  }
  if (inst.status === 'cancelled') {
    throw new BusinessError('INSTALLMENT_CANCELLED', 'Parcela cancelada não pode receber pagamento')
  }
```

The `prior` mapping gains `recordedAt: new Date(p.recordedAt).toISOString()`.

- [ ] **Step 3: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/db/queries/__tests__/financial-quote.test.ts src/app/api/financial`. Do not commit.

---

### Task B3: Renegotiation prices through the engine

**Files:**
- Modify: `web/src/db/queries/renegotiation.ts`
- Test: `web/src/db/queries/__tests__/renegotiation.test.ts` (create)

**Interfaces:**
- Consumes: `quoteInstallment`, `InstallmentBase`, `PaymentInput` from A1; `loadFinancialSettings` exported from `financial.ts`.
- Produces: no new exports. The per-entry `penalties` figure now equals what the payment dialog would quote.

- [ ] **Step 1: Read `renegotiation.ts` in full**

It locks installments with a raw `SELECT ... FOR UPDATE` and never loads payment records.

- [ ] **Step 2: Write the failing test**

Create `renegotiation.test.ts` with the `chain()` harness. One case: an entry with one pending installment, 750 due 2026-05-22, a prior payment of 1 on 2026-09-03 (`recordedAt` set), renegotiated at a frozen `2026-09-13T14:04:50.000Z`. Assert the breakdown's `penalties` for that entry is `15 + 27.50 = 42.50`, which is `quoteInstallment`'s answer. The old inline block produced `17.50` for the same rows: the stored `fine_amount` of 15 plus ten days of fresh accrual, with the carried 25 dropped. Hand-checked: prior payment of 1 on Sep 3 covers 1 of the 26 interest then owed, carrying 25; ten more days on 750 at 1%/month is 2.50; 25 + 2.50 = 27.50. Freeze the clock with `vi.setSystemTime` since the function reads `new Date()` for its `asOf`.

- [ ] **Step 3: Implement**

**[AR2-arch5]** Add `ORDER BY id` to the `FOR UPDATE` select. After the lock, load the live payment records for every locked installment in one select:

```ts
    const lockedIds = lockedInstallments.map((i) => String(i.id))
    const lockedPayments = lockedIds.length > 0
      ? await tx
          .select()
          .from(paymentRecords)
          .where(and(inArray(paymentRecords.installmentId, lockedIds), isNull(paymentRecords.reversedAt)))
          .orderBy(paymentRecords.paidAt, paymentRecords.recordedAt)
      : []
    const paymentsByInstallment = new Map<string, typeof lockedPayments>()
    for (const p of lockedPayments) {
      const list = paymentsByInstallment.get(p.installmentId) ?? []
      list.push(p)
      paymentsByInstallment.set(p.installmentId, list)
    }
```

Replace the raw settings select with `const settings = await loadFinancialSettings(tx, tenantId)` and delete `gracePeriodDays`, `fineType`, `fineValue`, `interestRate` and their fallbacks. Declare `const now = new Date()` once above the entry loop. Replace the per-installment block from `// Calculate penalties as of now` through `entryPenalties += fineAmount + interestAmount` with:

```ts
        const base: InstallmentBase = {
          amount,
          dueDate: String(inst.due_date),
          appliedFineValue: Number(inst.applied_fine_value ?? settings.fineValue),
          appliedFineType: (inst.applied_fine_type as string | null) ?? settings.fineType,
          appliedInterestRate: Number(inst.applied_interest_rate ?? settings.monthlyInterestPercent),
          gracePeriodDays: settings.gracePeriodDays,
        }
        const prior: PaymentInput[] = (paymentsByInstallment.get(String(inst.id)) ?? []).map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paidAt: new Date(p.paidAt).toISOString(),
          recordedAt: new Date(p.recordedAt).toISOString(),
        }))
        const quote = quoteInstallment(base, prior, now)

        entryPenalties += quote.fineAmount + quote.interestAmount
```

`entryRemainingPrincipal` keeps using `amount - amountPaid`. Fix the imports: add `quoteInstallment`, `InstallmentBase`, `PaymentInput`, `loadFinancialSettings`, `paymentRecords`, `inArray`, `isNull`; drop `getDaysOverdue`, `calculateFine`, `calculateInterest`, `financialSettings` if now unused.

- [ ] **Step 4: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/db/queries`. Then `pnpm typecheck` must be clean once B1 and B2 have landed. Do not commit.

---

### Task B4: Bound the payment amount to what the column can hold **[AR2-arch4]**

**Files:**
- Modify: `web/src/validations/financial.ts`
- Test: `web/src/validations/__tests__/financial.test.ts`

With the overpayment guard gone, `amount: z.number().positive()` is the only bound and `payment_records.amount` is `decimal(10,2)`. A request for R$100.000.000 would pass validation and fail inside the transaction with a numeric-overflow 500.

- [ ] **Step 1: Test**

`recordPaymentSchema` rejects `amount: 100_000_000` and accepts `99_999_999.99`. Message in pt-BR: `'Valor acima do limite permitido'`.

- [ ] **Step 2: Implement**

```ts
// payment_records.amount is decimal(10,2). Anything larger fails inside the
// transaction as a numeric overflow, which is a 500 for what is a bad input.
const MAX_PAYMENT_AMOUNT = 99_999_999.99
```

and `amount: z.number().positive('Valor deve ser positivo').max(MAX_PAYMENT_AMOUNT, 'Valor acima do limite permitido')`.

- [ ] **Step 3: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/validations`. Do not commit.

---

## Group C

### Task C1: The dialog warns on overpayment instead of blocking

**Files:**
- Modify: `web/src/components/financial/partial-payment-dialog.tsx`
- Test: `web/src/components/financial/__tests__/partial-payment-dialog.test.tsx`

- [ ] **Step 1: Tests**

- "blocks confirm above quote.totalDue + 0.01" becomes "warns above quote.totalDue and keeps confirm enabled": the warning text is present, the button is enabled, and confirming calls the mutation with the typed amount.
- The warning copy assertion changes to match the new string below.
- Add: no warning at exactly `quote.totalDue`.

- [ ] **Step 2: Implement**

`isOverpayment` stays as the predicate, with the tolerance gone:

```ts
  const isOverpayment = quote != null && parsedAmount > quote.totalDue
  const excess = isOverpayment && quote ? Math.round((parsedAmount - quote.totalDue) * 100) / 100 : 0
```

Remove `isOverpayment` from `handleConfirm`'s early return and from the button's `disabled`. Replace the red paragraph with an amber one:

```tsx
          {isOverpayment && (
            <p className="text-xs text-amber-700">
              Valor acima do total pendente. O excedente de {formatCurrency(excess)} será
              registrado, mas não gera crédito para próximas cobranças.
            </p>
          )}
```

- [ ] **Step 3: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/components/financial/__tests__/partial-payment-dialog.test.tsx`. Do not commit.

---

### Task C2: The payment row shows the excess

**Files:**
- Modify: `web/src/components/financial/installment-table.tsx`
- Test: `web/src/components/financial/__tests__/installment-table.test.tsx`

- [ ] **Step 1: Test**

Render an installment with one payment record where `amount: '800.00'`, `interestCovered: '26.00'`, `fineCovered: '15.00'`, `principalCovered: '750.00'`. Assert the row shows "Pago a mais R$ 9,00". Render another with the three covered fields summing to `amount` and assert the label is absent.

- [ ] **Step 2: Implement**

In the allocation breakdown of the payment row, after the `Multa` span:

```tsx
                          {excessOf(pr) > 0 && (
                            <span className="text-[10px] text-sky-700 tabular-nums">
                              Pago a mais {formatCurrency(excessOf(pr))}
                            </span>
                          )}
```

with a module-level helper next to `getProgressPercent`, typed against the file's existing `PaymentRecord` interface (line 31):

```ts
// Cash received above what the payment could cover. Recorded, never credited.
function excessOf(pr: PaymentRecord): number {
  const covered =
    Number(pr.interestCovered ?? 0) + Number(pr.fineCovered ?? 0) + Number(pr.principalCovered ?? 0)
  return Math.round((Number(pr.amount ?? 0) - covered) * 100) / 100
}
```

- [ ] **Step 3: Run and report**

Run: `pnpm --filter @floraclin/web test:run src/components/financial/__tests__/installment-table.test.tsx`. Do not commit.

---

## Final verification

- [ ] `pnpm ci:checks` (runs lint, typecheck and the full suite once) **[AR2-min5]**
- [ ] `rg 'getDaysOverdue|parseOverdueReference|PAYMENT_EXCEEDS_DUE|totalDue \+ 0\.01' web/src` returns nothing.
- [ ] `rg 'replayPayments\(' web/src -g '!__tests__'` shows every call with three arguments, and the only `paidAt` passed as `asOf` is inside `quoteInstallment`.
- [ ] `rg 'recordedAt' web/src/db/queries` shows every `PaymentInput` mapping and every `paymentRecords` insert carries it.

## Known gaps, deliberately not in scope

- **`listFinancialEntries` prices in raw SQL** (`financial.ts` `totalFineAmount` / `totalInterestAmount` subqueries): its own `2` / `1` defaults, `CURRENT_DATE - due_date`, no grace, no payment history, no carried interest. It feeds the entry-level badges on the list page, not the installment table or the dialog. Routing it through the engine means loading installments and payments for every listed entry; a separate change.
- **Business-day due dates.** Revezza shifts weekend and holiday due dates to the next business day (Lei 7.089/1983, CC Art. 132 §1º) with a holiday calendar in `@revezza/shared`. FloraClin has none. Legal compliance gap; separate change.
- **Grace period is not snapshotted per installment.** Unchanged from PR #43's known gaps.
- **A credit concept.** Excess is recorded and shown, and by decision never applied to another charge.
