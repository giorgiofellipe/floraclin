import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { chainCapturing, type Capture } from '@/tests/mocks/drizzle-tx'

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { select: selectMock } }))

import { getPatientFinancialSummary } from '../financial'

const row = (amount: string, amountPaid: string, dueDate: string) => ({ amount, amountPaid, dueDate })

beforeEach(() => {
  selectMock.mockReset()
  vi.useFakeTimers()
  // 23:00 BRT on 2026-11-01, already Nov 2 in UTC
  vi.setSystemTime(new Date('2026-11-02T02:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('getPatientFinancialSummary', () => {
  it('treats an installment due on the BR calendar day as not overdue on a UTC host', async () => {
    // Regression: comparing against the UTC date flipped the BR day and flagged today's installment overdue.
    selectMock.mockReturnValueOnce(
      chainCapturing(
        [row('100.00', '0', '2026-11-01'), row('50.00', '10.00', '2026-10-31'), row('30.00', '0', '2026-11-20')],
        {}
      )
    )

    const summary = await getPatientFinancialSummary('t1', 'p1')

    expect(summary).toEqual({ openAmount: 170, overdueAmount: 40, nextDueDate: '2026-11-01' })
  })

  it('has no next due date when nothing is open', async () => {
    selectMock.mockReturnValueOnce(chainCapturing([], {}))
    expect(await getPatientFinancialSummary('t1', 'p1')).toEqual({
      openAmount: 0,
      overdueAmount: 0,
      nextDueDate: null,
    })
  })

  it('filters by tenant and patient and leaves out paid and cancelled installments', async () => {
    // Regression: counting paid or cancelled installments would inflate what the patient owes.
    const capture: Capture = {}
    selectMock.mockReturnValueOnce(chainCapturing([], capture))

    await getPatientFinancialSummary('tenant-1', 'patient-1')

    const { params } = new PgDialect().sqlToQuery(capture.where as SQL)
    expect(params).toEqual(
      expect.arrayContaining(['tenant-1', 'patient-1', 'paid', 'cancelled'])
    )
  })
})
