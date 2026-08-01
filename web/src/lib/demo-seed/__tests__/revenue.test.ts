import { describe, it, expect } from 'vitest'
import { buildCurrentMonth, buildHistory } from '../revenue'
import { CATALOGUE, TARGETS, SIX_MONTH_RECEIVED, PATIENT_COUNT } from '../config'
import { parseBrDate, toBrYmd } from '@/lib/dates'

const PATIENT_TOTAL = PATIENT_COUNT

/** Fixed reference point so assertions are reproducible. */
const TODAY = parseBrDate('2026-07-27', '12:00:00')

function categoryOf(procedureName: string): string {
  const item = CATALOGUE.find((c) => c.name === procedureName)
  if (!item) throw new Error(`unknown catalogue item: ${procedureName}`)
  return item.category
}

function sumByStatus(entries: ReturnType<typeof buildCurrentMonth>, status: 'paid' | 'pending'): number {
  let total = 0
  for (const entry of entries) {
    for (const installment of entry.installments) {
      if (installment.status === status) total += installment.amount
    }
  }
  return total
}

describe('buildCurrentMonth', () => {
  const entries = buildCurrentMonth(TODAY, PATIENT_TOTAL)

  it('produces exactly 23 procedures', () => {
    expect(entries).toHaveLength(TARGETS.proceduresThisMonth)
  })

  it('paid installments sum to receivedThisMonth exactly', () => {
    expect(sumByStatus(entries, 'paid')).toBe(TARGETS.receivedThisMonth)
  })

  it('pending installments sum to pendingThisMonth exactly', () => {
    expect(sumByStatus(entries, 'pending')).toBe(TARGETS.pendingThisMonth)
  })

  it('gross (paid + pending) equals grossThisMonth exactly', () => {
    expect(sumByStatus(entries, 'paid') + sumByStatus(entries, 'pending')).toBe(TARGETS.grossThisMonth)
  })

  it('every pending installment has a due date after today', () => {
    const todayYmd = toBrYmd(TODAY)
    for (const entry of entries) {
      for (const installment of entry.installments) {
        if (installment.status === 'pending') {
          expect(installment.dueDate > todayYmd).toBe(true)
        }
      }
    }
  })

  it('every pending due date falls in the month after today', () => {
    const todayYmd = toBrYmd(TODAY)
    const [todayYear, todayMonth] = todayYmd.split('-').map(Number)
    for (const entry of entries) {
      for (const installment of entry.installments) {
        if (installment.status !== 'pending') continue
        const [dueYear, dueMonth] = installment.dueDate.split('-').map(Number)
        const isNextMonth =
          (dueYear === todayYear && dueMonth === todayMonth + 1) ||
          (todayMonth === 12 && dueYear === todayYear + 1 && dueMonth === 1)
        expect(isNextMonth).toBe(true)
      }
    }
  })

  it('paid installments carry a paidAt within the current month and a payment method', () => {
    for (const entry of entries) {
      for (const installment of entry.installments) {
        if (installment.status !== 'paid') continue
        expect(installment.paidAt).toBeTruthy()
        expect(installment.paymentMethod).toBeTruthy()
      }
    }
  })

  it('counts exactly 9 toxina sessions and 6 preenchimento sessions', () => {
    const toxina = entries.filter((e) => categoryOf(e.procedure.procedureName) === 'toxina').length
    const preenchimento = entries.filter((e) => categoryOf(e.procedure.procedureName) === 'preenchimento').length
    expect(toxina).toBe(9)
    expect(preenchimento).toBe(6)
  })

  it('exactly one Harmonização facial completa is sold at the package price', () => {
    const harmonizacoes = entries.filter((e) => e.procedure.procedureName === 'Harmonização facial completa')
    expect(harmonizacoes).toHaveLength(2)
    const listPrice = CATALOGUE.find((c) => c.name === 'Harmonização facial completa')!.price
    const atPackagePrice = harmonizacoes.filter((e) => e.totalAmount !== listPrice)
    expect(atPackagePrice).toHaveLength(1)
  })

  it('never places a procedure after today', () => {
    const todayYmd = toBrYmd(TODAY)
    for (const entry of entries) {
      expect(entry.procedure.date <= todayYmd).toBe(true)
    }
  })

  it('has no zero or negative amounts anywhere', () => {
    for (const entry of entries) {
      expect(entry.totalAmount).toBeGreaterThan(0)
      for (const installment of entry.installments) {
        expect(installment.amount).toBeGreaterThan(0)
      }
    }
  })

  it('is deterministic for the same inputs', () => {
    const again = buildCurrentMonth(TODAY, PATIENT_TOTAL)
    expect(again).toEqual(entries)
  })

  it('works when today is the 1st of the month', () => {
    const firstOfMonth = parseBrDate('2026-08-01', '12:00:00')
    const result = buildCurrentMonth(firstOfMonth, PATIENT_TOTAL)
    expect(result).toHaveLength(TARGETS.proceduresThisMonth)
    expect(sumByStatus(result, 'paid')).toBe(TARGETS.receivedThisMonth)
    expect(sumByStatus(result, 'pending')).toBe(TARGETS.pendingThisMonth)
    for (const entry of result) {
      expect(entry.procedure.date).toBe('2026-08-01')
    }
  })

  it('works when today is the 31st of the month', () => {
    const lastOfMonth = parseBrDate('2026-07-31', '12:00:00')
    const result = buildCurrentMonth(lastOfMonth, PATIENT_TOTAL)
    expect(result).toHaveLength(TARGETS.proceduresThisMonth)
    expect(sumByStatus(result, 'paid')).toBe(TARGETS.receivedThisMonth)
    expect(sumByStatus(result, 'pending')).toBe(TARGETS.pendingThisMonth)
    const todayYmd = toBrYmd(lastOfMonth)
    for (const entry of result) {
      expect(entry.procedure.date <= todayYmd).toBe(true)
    }
  })
})

describe('buildHistory', () => {
  const entries = buildHistory(TODAY, PATIENT_TOTAL)
  const priorTargets = SIX_MONTH_RECEIVED.slice(0, 5)

  function monthKey(ymdDate: string): string {
    return ymdDate.slice(0, 7)
  }

  it('groups into exactly five distinct months', () => {
    const months = new Set(entries.map((e) => monthKey(e.procedure.date)))
    expect(months.size).toBe(5)
  })

  it('every history month paid sum equals its SIX_MONTH_RECEIVED target exactly', () => {
    const byMonth = new Map<string, number>()
    for (const entry of entries) {
      const key = monthKey(entry.procedure.date)
      const paid = entry.installments
        .filter((i) => i.status === 'paid')
        .reduce((sum, i) => sum + i.amount, 0)
      byMonth.set(key, (byMonth.get(key) ?? 0) + paid)
    }

    const orderedMonths = [...byMonth.keys()].sort()
    expect(orderedMonths).toHaveLength(5)
    orderedMonths.forEach((key, i) => {
      expect(byMonth.get(key)).toBe(priorTargets[i])
    })
  })

  it('every installment is paid, with paidAt inside its own month', () => {
    for (const entry of entries) {
      for (const installment of entry.installments) {
        expect(installment.status).toBe('paid')
        expect(installment.paidAt).toBeTruthy()
        expect(monthKey(installment.paidAt!)).toBe(monthKey(entry.procedure.date))
      }
    }
  })

  it('has no zero or negative amounts anywhere', () => {
    for (const entry of entries) {
      expect(entry.totalAmount).toBeGreaterThan(0)
      for (const installment of entry.installments) {
        expect(installment.amount).toBeGreaterThan(0)
      }
    }
  })

  it('is deterministic for the same inputs', () => {
    const again = buildHistory(TODAY, PATIENT_TOTAL)
    expect(again).toEqual(entries)
  })

  it('works when today is the 1st of the month', () => {
    const firstOfMonth = parseBrDate('2026-08-01', '12:00:00')
    const result = buildHistory(firstOfMonth, PATIENT_TOTAL)
    const byMonth = new Map<string, number>()
    for (const entry of result) {
      const key = monthKey(entry.procedure.date)
      const paid = entry.installments.reduce((sum, i) => sum + i.amount, 0)
      byMonth.set(key, (byMonth.get(key) ?? 0) + paid)
    }
    const orderedMonths = [...byMonth.keys()].sort()
    expect(orderedMonths).toHaveLength(5)
    orderedMonths.forEach((key, i) => {
      expect(byMonth.get(key)).toBe(priorTargets[i])
    })
  })

  it('works when today is the 31st of the month', () => {
    const lastOfMonth = parseBrDate('2026-07-31', '12:00:00')
    const result = buildHistory(lastOfMonth, PATIENT_TOTAL)
    const byMonth = new Map<string, number>()
    for (const entry of result) {
      const key = monthKey(entry.procedure.date)
      const paid = entry.installments.reduce((sum, i) => sum + i.amount, 0)
      byMonth.set(key, (byMonth.get(key) ?? 0) + paid)
    }
    const orderedMonths = [...byMonth.keys()].sort()
    expect(orderedMonths).toHaveLength(5)
    orderedMonths.forEach((key, i) => {
      expect(byMonth.get(key)).toBe(priorTargets[i])
    })
  })
})
