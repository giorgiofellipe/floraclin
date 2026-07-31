/**
 * Revenue generator for the Clínica Lumé demo seed.
 *
 * Solves two constrained problems so the financial screens land on exact,
 * pre-agreed numbers instead of "close enough":
 *
 * 1. `buildCurrentMonth` expands `MONTH_MIX` into 23 procedures, applies
 *    `PACKAGE_PRICE` to exactly one Harmonização so the gross hits
 *    `TARGETS.grossThisMonth`, then splits installments into paid/pending so
 *    each side lands on its own target exactly.
 * 2. `buildHistory` picks a rotating slice of `CATALOGUE` per prior month,
 *    letting the last item absorb whatever remainder is needed to hit that
 *    month's `SIX_MONTH_RECEIVED` figure exactly.
 *
 * Every date is derived from the `today` parameter through `@/lib/dates` or
 * pure calendar arithmetic on `YYYY-MM-DD` components -- never from
 * `new Date()` with no arguments and never by parsing a `YYYY-MM-DD` string
 * with the bare `Date` constructor. That keeps the output identical no
 * matter which day of the month the seed is run on, or which TZ the host
 * process runs in.
 */

import { toBrYmd, parseBrDate } from '@/lib/dates'
import { CATALOGUE, MONTH_MIX, PACKAGE_PRICE, TARGETS, SIX_MONTH_RECEIVED, type CatalogueItem } from './config'
import type { PlannedEntry, PlannedProcedure } from './types'

type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'transfer'

/** Rotates through payment methods so paid installments aren't all identical. */
const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']

// ─── Pure calendar helpers (no Date parsing, no host-TZ dependence) ──────

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function ymdParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Days in a given calendar month, computed without constructing a `Date`. */
function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}

/** Shifts a `{ year, month }` pair by `delta` months (can be negative). */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = month - 1 + delta
  const shiftedYear = year + Math.floor(zeroBased / 12)
  const shiftedMonth = ((zeroBased % 12) + 12) % 12 + 1
  return { year: shiftedYear, month: shiftedMonth }
}

/**
 * Sunday is the only excluded day -- Clínica Lumé, like most HOF clinics,
 * works Saturdays. Reads the weekday off a BR-noon anchor (`parseBrDate`)
 * so the result never depends on the host process's TZ.
 */
function isBusinessDay(day: string): boolean {
  return parseBrDate(day, '12:00:00').getDay() !== 0
}

/** Every business day in `year`/`month` from day 1 up to (and including) `upToDay`. */
function businessDaysUpTo(year: number, month: number, upToDay: number): string[] {
  const days: string[] = []
  for (let d = 1; d <= upToDay; d++) {
    const candidate = ymd(year, month, d)
    if (isBusinessDay(candidate)) days.push(candidate)
  }
  // Safety net: a month can't be entirely Sundays, but a single-day window
  // (today is the 1st and it's a Sunday) could be. Fall back to that day
  // itself so callers always have somewhere to place a procedure.
  if (days.length === 0) days.push(ymd(year, month, upToDay))
  return days
}

function minutesToHHMM(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Deterministic start/end time for the `slotIndex`-th procedure of a day.
 * Cadence is 45 minutes starting at 09:00, wrapped back into a 09:00-20:00
 * window so a day with many procedures still produces well-formed times
 * instead of drifting past midnight.
 */
function timeSlot(slotIndex: number, durationMin: number): { startTime: string; endTime: string } {
  const windowStart = 9 * 60
  const windowSpan = 11 * 60 // 09:00 -> 20:00
  const startMinutes = windowStart + ((slotIndex * 45) % windowSpan)
  return {
    startTime: minutesToHHMM(startMinutes),
    endTime: minutesToHHMM(startMinutes + durationMin),
  }
}

function catalogueItem(name: string): CatalogueItem {
  const item = CATALOGUE.find((c) => c.name === name)
  if (!item) throw new Error(`demo-seed revenue: unknown catalogue item "${name}"`)
  return item
}

/**
 * Places `count` procedures across `businessDays`, round-robin, tracking a
 * per-day slot counter so times within a day never collide.
 */
function assignDatesAndTimes(
  items: Array<{ name: string; price: number; durationMin: number }>,
  businessDays: string[],
  patientCount: number,
): PlannedProcedure[] {
  const slotsUsedForDay = new Map<string, number>()

  return items.map((item, index) => {
    const date = businessDays[index % businessDays.length]
    const slotIndex = slotsUsedForDay.get(date) ?? 0
    slotsUsedForDay.set(date, slotIndex + 1)
    const { startTime, endTime } = timeSlot(slotIndex, item.durationMin)

    return {
      procedureName: item.name,
      price: item.price,
      date,
      startTime,
      endTime,
      patientIndex: index % patientCount,
    }
  })
}

// ─── Current month ────────────────────────────────────────────────────

/**
 * Expands `MONTH_MIX` into 23 individual procedures. Exactly one
 * Harmonização facial completa is sold at `PACKAGE_PRICE` (the package
 * deal); the other keeps the catalogue list price. Together with the rest
 * of the mix this totals `TARGETS.grossThisMonth` -- proven by
 * `config.test.ts`, reproduced here.
 */
function expandMonthMix(): Array<{ name: string; price: number; durationMin: number }> {
  const items: Array<{ name: string; price: number; durationMin: number }> = []
  let packageApplied = false

  for (const mix of MONTH_MIX) {
    const catalogue = catalogueItem(mix.name)
    for (let i = 0; i < mix.qty; i++) {
      const usePackagePrice = mix.name === 'Harmonização facial completa' && !packageApplied
      if (usePackagePrice) packageApplied = true
      items.push({
        name: mix.name,
        price: usePackagePrice ? PACKAGE_PRICE : catalogue.price,
        durationMin: catalogue.durationMin,
      })
    }
  }

  return items
}

function buildInstallment(
  number: number,
  amount: number,
  dueDate: string,
  status: 'paid' | 'pending',
  paidAt: string | undefined,
  methodIndex: number,
): PlannedEntry['installments'][number] {
  return {
    number,
    amount,
    dueDate,
    status,
    ...(status === 'paid' && paidAt ? { paidAt, paymentMethod: PAYMENT_METHODS[methodIndex % PAYMENT_METHODS.length] } : {}),
  }
}

/**
 * Splits chronologically-sorted procedures into paid/pending installments so
 * paid totals `TARGETS.receivedThisMonth` and pending totals
 * `TARGETS.pendingThisMonth` exactly. Walks the list in date order, marking
 * whole procedures paid until the paid budget runs out; the procedure that
 * straddles the boundary is split into a paid installment (whatever budget
 * remains) and a pending installment (the rest), so both totals land exact
 * with no zero-amount installment ever created. Pending due dates always
 * land in `nextMonthDueDates` (next calendar month), never the current one,
 * so `getRevenueOverview` classifies them as pending rather than overdue.
 */
function splitPaidPending(
  procedures: PlannedProcedure[],
  paidTarget: number,
  nextMonthDueDates: string[],
): PlannedEntry[] {
  let remainingPaidBudget = paidTarget
  let pendingCount = 0
  let paidCount = 0

  return procedures.map((procedure) => {
    const amount = procedure.price
    const installments: PlannedEntry['installments'] = []

    if (remainingPaidBudget >= amount) {
      installments.push(buildInstallment(1, amount, procedure.date, 'paid', procedure.date, paidCount))
      paidCount += 1
      remainingPaidBudget -= amount
    } else if (remainingPaidBudget > 0) {
      const paidPortion = remainingPaidBudget
      const pendingPortion = amount - paidPortion
      const dueDate = nextMonthDueDates[pendingCount % nextMonthDueDates.length]
      pendingCount += 1
      installments.push(buildInstallment(1, paidPortion, procedure.date, 'paid', procedure.date, paidCount))
      paidCount += 1
      installments.push(buildInstallment(2, pendingPortion, dueDate, 'pending', undefined, 0))
      remainingPaidBudget = 0
    } else {
      const dueDate = nextMonthDueDates[pendingCount % nextMonthDueDates.length]
      pendingCount += 1
      installments.push(buildInstallment(1, amount, dueDate, 'pending', undefined, 0))
    }

    return { procedure, totalAmount: amount, installments }
  })
}

/**
 * Builds this month's 23 procedures, spread across business days from the
 * 1st up to (and including) `today`, gross exactly `TARGETS.grossThisMonth`,
 * split so paid installments total `TARGETS.receivedThisMonth` and pending
 * installments total `TARGETS.pendingThisMonth` with every pending due date
 * in the following month.
 */
export function buildCurrentMonth(today: Date, patientCount: number): PlannedEntry[] {
  const todayYmd = toBrYmd(today)
  const { year, month, day } = ymdParts(todayYmd)

  const businessDays = businessDaysUpTo(year, month, day)
  const items = expandMonthMix()
  const procedures = assignDatesAndTimes(items, businessDays, patientCount)

  // Chronological order so early-month procedures are the ones already
  // paid and the most recent ones are the ones still owed -- how a real
  // clinic's receivables actually look mid-month.
  const sorted = [...procedures].sort((a, b) => a.date.localeCompare(b.date))

  const { year: nextYear, month: nextMonth } = shiftMonth(year, month, 1)
  const nextMonthLength = daysInMonth(nextYear, nextMonth)
  const nextMonthDueDates = Array.from({ length: Math.min(10, nextMonthLength) }, (_, i) =>
    ymd(nextYear, nextMonth, Math.min(5 + i * 2, nextMonthLength)),
  )

  return splitPaidPending(sorted, TARGETS.receivedThisMonth, nextMonthDueDates)
}

// ─── History (prior five months) ─────────────────────────────────────

/**
 * Picks a rotating slice of `CATALOGUE`, adding whole items at list price
 * until the next item would meet or exceed the remaining target, then lets
 * that final item absorb whatever remains as a one-off discounted amount
 * (always <= its own list price, so it always reads as a discount, never a
 * markup). Guarantees an exact, strictly-positive total.
 */
function pickMonthItems(
  target: number,
  rotationOffset: number,
): Array<{ name: string; price: number; durationMin: number }> {
  const items: Array<{ name: string; price: number; durationMin: number }> = []
  let remaining = target
  let rotation = rotationOffset

  // Generous upper bound so a bug in the math fails loudly (an obviously
  // wrong item count) instead of looping forever; never reached by the
  // real target values (largest is ~2.5x a full catalogue rotation).
  const MAX_ITEMS = 60

  while (items.length < MAX_ITEMS) {
    const catalogue = CATALOGUE[rotation % CATALOGUE.length]
    rotation += 1

    if (remaining - catalogue.price <= 0) {
      // This item would meet or overshoot the target: it becomes the final,
      // discounted entry instead, absorbing exactly what's left.
      items.push({ name: catalogue.name, price: remaining, durationMin: catalogue.durationMin })
      remaining = 0
      break
    }

    items.push({ name: catalogue.name, price: catalogue.price, durationMin: catalogue.durationMin })
    remaining -= catalogue.price
  }

  return items
}

/** Builds one prior month's fully-paid history, totalling `target` exactly. */
function buildHistoryMonth(
  target: number,
  year: number,
  month: number,
  patientCount: number,
  rotationOffset: number,
): PlannedEntry[] {
  const businessDays = businessDaysUpTo(year, month, daysInMonth(year, month))
  const items = pickMonthItems(target, rotationOffset)
  const procedures = assignDatesAndTimes(items, businessDays, patientCount)

  return procedures.map((procedure, index) => ({
    procedure,
    totalAmount: procedure.price,
    installments: [buildInstallment(1, procedure.price, procedure.date, 'paid', procedure.date, index)],
  }))
}

/**
 * Builds the five prior months of fully-paid history. `SIX_MONTH_RECEIVED`
 * holds six values oldest-first with the current month last; this consumes
 * only the first five, since `buildCurrentMonth` owns the sixth.
 */
export function buildHistory(today: Date, patientCount: number): PlannedEntry[] {
  const todayYmd = toBrYmd(today)
  const { year: currentYear, month: currentMonth } = ymdParts(todayYmd)
  const priorTargets = SIX_MONTH_RECEIVED.slice(0, 5)

  const entries: PlannedEntry[] = []
  priorTargets.forEach((target, indexFromOldest) => {
    const monthsBack = priorTargets.length - indexFromOldest
    const { year, month } = shiftMonth(currentYear, currentMonth, -monthsBack)
    entries.push(...buildHistoryMonth(target, year, month, patientCount, indexFromOldest))
  })

  return entries
}
