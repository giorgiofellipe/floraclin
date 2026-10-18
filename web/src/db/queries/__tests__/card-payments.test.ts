import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { routedTx, tableOf, isLock, whereParams, type LoggedQuery } from '@/tests/mocks/drizzle-tx'
import { cardPayments, cardRepasses, cardTerminals, cashMovements } from '@/db/schema'
import { parseBrDate } from '@/lib/dates'
import { BusinessError } from '@/lib/errors'

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const createAuditLogMock = vi.fn()
vi.mock('@/lib/audit', () => ({
  createAuditLog: (...args: unknown[]) => createAuditLogMock(...args),
}))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const PATIENT_ID = '00000000-0000-0000-0000-00000000p001'
const TERMINAL_ID = '00000000-0000-0000-0000-00000000t001'
const PAYMENT_ID = '00000000-0000-0000-0000-00000000c001'
const REPASSE_ID = '00000000-0000-0000-0000-00000000r001'
const TODAY = '2026-10-18'

const TERMINAL_ROW = {
  id: TERMINAL_ID,
  name: 'Stone',
  debitRate: '1.50',
  debitPayoutDays: 1,
  creditRates: ['3.00', '4.00', '5.00', '6.00', '7.00', '8.99', '9.00', '9.50', '10.00', '10.50', '11.00', '11.50'],
  creditPayoutMode: 'per_installment',
  creditLumpSumDays: 1,
}

function inserts(log: LoggedQuery[], table: unknown) {
  return log.filter((q) => q.op === 'insert' && tableOf(q) === table)
}
function updates(log: LoggedQuery[], table: unknown) {
  return log.filter((q) => q.op === 'update' && tableOf(q) === table)
}
function isCount(q: LoggedQuery) {
  return q.op === 'select' && !!q.fields && 'total' in (q.fields as object)
}
function valuesOf(q: LoggedQuery) {
  return q.capture.value as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-18T15:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('getCardTerminalTerms', () => {
  it('maps the numeric columns and scopes the read to tenant and live terminals', async () => {
    const { getCardTerminalTerms } = await import('../card-payments')
    const { tx, log } = routedTx(() => [TERMINAL_ROW])

    const result = await getCardTerminalTerms(tx as never, TENANT, TERMINAL_ID)

    expect(result.terms.debitRate).toBe(1.5)
    expect(result.terms.creditRates[5]).toBe(8.99)
    expect(result.name).toBe('Stone')
    expect(whereParams(log[0].capture)).toEqual(expect.arrayContaining([TENANT, TERMINAL_ID]))
  })

  it('throws CARD_TERMINAL_NOT_FOUND when the terminal is missing, deleted or from another tenant', async () => {
    const { getCardTerminalTerms } = await import('../card-payments')
    const { tx } = routedTx(() => [])

    await expect(getCardTerminalTerms(tx as never, TENANT, TERMINAL_ID)).rejects.toMatchObject({
      code: 'CARD_TERMINAL_NOT_FOUND',
    })
  })
})

describe('repasseLedgerDescription', () => {
  it('truncates to the 255 char column with an ellipsis', async () => {
    const { repasseLedgerDescription } = await import('../card-payments')
    const prefix = `Repasse ${'T'.repeat(100)} 1/6: `

    const result = repasseLedgerDescription(prefix, 'd'.repeat(255))

    expect(result).toHaveLength(255)
    expect(result.endsWith('…')).toBe(true)
  })
})

/** A card payment whose repasses live in `state`, emulating only the row filters the queries rely on. */
function createPaymentTx() {
  const inserted: Record<string, unknown>[] = []
  let movementSeq = 0
  const { tx, log } = routedTx((q) => {
    const table = tableOf(q)
    if (q.op === 'select' && table === cardTerminals) return [TERMINAL_ROW]
    if (q.op === 'insert' && table === cardPayments) return [{ id: PAYMENT_ID }]
    if (q.op === 'insert' && table === cardRepasses) {
      inserted.push(...(valuesOf(q) as unknown as Record<string, unknown>[]))
      return undefined
    }
    if (isCount(q)) return [{ cardPaymentId: PAYMENT_ID, total: inserted.length }]
    if (q.op === 'select' && table === cardRepasses) {
      const params = whereParams(q.capture)
      const today = params.find((p) => p === TODAY)
      return inserted
        .filter((r) => today && String(r.expectedDate) <= TODAY)
        .map((r, i) => ({
          id: `rep-${i + 1}`,
          cardPaymentId: PAYMENT_ID,
          sequence: r.sequence,
          expectedDate: r.expectedDate,
          netAmount: String(r.netAmount),
          patientId: PATIENT_ID,
          createdBy: USER_ID,
          description: 'Procedimento',
          method: 'credit_card',
          terminalName: 'Stone',
        }))
    }
    if (q.op === 'insert' && table === cashMovements) return [{ id: `mov-${++movementSeq}` }]
    if (q.op === 'update' && table === cardRepasses) return [{ id: 'claimed' }]
    return undefined
  })
  return { tx, log }
}

describe('createCardPaymentTx', () => {
  const baseInput = {
    terminalId: TERMINAL_ID,
    method: 'credit_card' as const,
    installmentCount: 6,
    gross: 3000,
    patientId: PATIENT_ID,
    description: 'Procedimento',
  }

  it('freezes the terminal rate, plans 6 repasses and writes no ledger row while all are in the future', async () => {
    const { createCardPaymentTx } = await import('../card-payments')
    const { tx, log } = createPaymentTx()

    const result = await createCardPaymentTx(tx as never, TENANT, USER_ID, {
      ...baseInput,
      paidAt: parseBrDate(TODAY, '12:00:00'),
    })

    expect(result).toEqual({ cardPaymentId: PAYMENT_ID })
    const [payment] = inserts(log, cardPayments)
    expect(valuesOf(payment)).toMatchObject({
      tenantId: TENANT,
      cardTerminalId: TERMINAL_ID,
      rate: '8.99',
      payoutMode: 'per_installment',
      installmentCount: 6,
      grossAmount: '3000.00',
      feeAmount: '269.70',
      netAmount: '2730.30',
      createdBy: USER_ID,
    })
    const [repasses] = inserts(log, cardRepasses)
    expect(valuesOf(repasses)).toHaveLength(6)
    expect(inserts(log, cashMovements)).toHaveLength(0)
  })

  it('posts only the repasses already due for a backdated payment, each on its own BR day', async () => {
    const { createCardPaymentTx } = await import('../card-payments')
    const { tx, log } = createPaymentTx()

    await createCardPaymentTx(tx as never, TENANT, USER_ID, {
      ...baseInput,
      paidAt: parseBrDate('2026-08-19', '12:00:00'),
    })

    const movements = inserts(log, cashMovements).map(valuesOf)
    expect(movements).toHaveLength(2)
    expect(movements.map((m) => m.movementDate)).toEqual([
      parseBrDate('2026-09-18', '12:00:00'),
      parseBrDate('2026-10-18', '12:00:00'),
    ])
    expect(movements[0]).toMatchObject({
      type: 'inflow',
      paymentMethod: 'credit_card',
      patientId: PATIENT_ID,
      recordedBy: USER_ID,
      cardRepasseId: 'rep-1',
      description: 'Repasse Stone 1/6: Procedimento',
    })
    const claims = updates(log, cardRepasses).map(valuesOf)
    expect(claims).toHaveLength(2)
    expect(claims[0]).toMatchObject({ status: 'received', cashMovementId: 'mov-1' })
  })
})

describe('postDueRepassesTx', () => {
  function stateful() {
    const repasse = {
      id: REPASSE_ID,
      cardPaymentId: PAYMENT_ID,
      sequence: 1,
      expectedDate: '2026-10-10',
      netAmount: '455.05',
      patientId: PATIENT_ID,
      createdBy: USER_ID,
      description: 'Procedimento',
      method: 'credit_card',
      terminalName: 'Stone',
      status: 'pending',
    }
    return routedTx((q) => {
      const table = tableOf(q)
      if (isCount(q)) return [{ cardPaymentId: PAYMENT_ID, total: 6 }]
      if (q.op === 'select' && table === cardRepasses) return repasse.status === 'pending' ? [repasse] : []
      if (q.op === 'insert' && table === cashMovements) return [{ id: 'mov-1' }]
      if (q.op === 'update' && table === cardRepasses) {
        repasse.status = valuesOf(q).status as string
        return [{ id: REPASSE_ID }]
      }
      return undefined
    })
  }

  it('posts each repasse exactly once when the job runs twice', async () => {
    const { postDueRepassesTx } = await import('../card-payments')
    const { tx, log } = stateful()

    const first = await postDueRepassesTx(tx as never, TENANT, { todayYmd: TODAY })
    const second = await postDueRepassesTx(tx as never, TENANT, { todayYmd: TODAY })

    expect([first, second]).toEqual([1, 0])
    expect(inserts(log, cashMovements)).toHaveLength(1)
  })

  it('claims rows of the given tenant only, with a row lock that skips concurrent reversals', async () => {
    const { postDueRepassesTx } = await import('../card-payments')
    const { tx, log } = stateful()

    await postDueRepassesTx(tx as never, TENANT, { todayYmd: TODAY })

    const select = log.find((q) => q.op === 'select' && tableOf(q) === cardRepasses)!
    expect(whereParams(select.capture)).toEqual(expect.arrayContaining([TENANT, 'pending', TODAY]))
    expect(isLock(select)).toBe(true)
    const lockArgs = select.capture.calls!.find(([m]) => m === 'for')![1]
    expect(lockArgs[1]).toMatchObject({ skipLocked: true })
    const claim = updates(log, cardRepasses)[0]
    expect(whereParams(claim.capture)).toEqual(expect.arrayContaining([TENANT, REPASSE_ID, 'pending']))
  })
})

describe('cancelCardPaymentTx', () => {
  it('cancels only the pending repasses and leaves the ledger alone', async () => {
    const { cancelCardPaymentTx } = await import('../card-payments')
    const rows = [
      ...[1, 2].map((n) => ({ id: `rep-${n}`, status: 'received' })),
      ...[3, 4, 5, 6].map((n) => ({ id: `rep-${n}`, status: 'pending' })),
    ]
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (q.op === 'select' && table === cardPayments) return [{ id: PAYMENT_ID, reversedAt: null }]
      if (q.op === 'select' && table === cardRepasses) return rows
      return undefined
    })

    const result = await cancelCardPaymentTx(tx as never, TENANT, USER_ID, PAYMENT_ID)

    expect(result).toEqual({ cancelledRepasses: 4, receivedRepasses: 2 })
    const lockOrder = log.filter(isLock).map(tableOf)
    expect(lockOrder).toEqual([cardPayments, cardRepasses])
    expect(valuesOf(updates(log, cardPayments)[0])).toMatchObject({ reversedBy: USER_ID })
    const cancel = updates(log, cardRepasses)[0]
    expect(valuesOf(cancel)).toMatchObject({ status: 'cancelled' })
    expect(whereParams(cancel.capture)).toEqual(expect.arrayContaining([TENANT, PAYMENT_ID, 'pending']))
    expect(inserts(log, cashMovements)).toHaveLength(0)
  })
})

describe('adjustCardRepasse', () => {
  function adjustTx(initial: Record<string, unknown>, payment: Record<string, unknown> = { id: PAYMENT_ID, reversedAt: null, createdBy: USER_ID, patientId: PATIENT_ID, description: 'Procedimento', method: 'credit_card' }) {
    const repasse: Record<string, unknown> = {
      id: REPASSE_ID,
      cardPaymentId: PAYMENT_ID,
      sequence: 1,
      grossAmount: '500.00',
      netAmount: '455.05',
      expectedDate: '2026-10-10',
      status: 'received',
      cashMovementId: 'mov-0',
      ...initial,
    }
    const movements: Record<string, Record<string, unknown>> = {
      'mov-0': {
        id: 'mov-0',
        amount: '455.05',
        description: 'Repasse Stone 1/6: Procedimento',
        movementDate: parseBrDate('2026-10-10', '12:00:00'),
        paymentMethod: 'credit_card',
        patientId: PATIENT_ID,
      },
    }
    let seq = 0
    const { tx, log } = routedTx((q) => {
      const table = tableOf(q)
      if (isCount(q)) return [{ cardPaymentId: PAYMENT_ID, total: 6 }]
      if (q.op === 'select' && table === cardRepasses) return [repasse]
      if (q.op === 'select' && table === cardPayments) return [payment]
      if (q.op === 'select' && table === cashMovements) {
        const id = whereParams(q.capture).find((p) => typeof p === 'string' && p in movements) as string
        return [movements[id]]
      }
      if (q.op === 'insert' && table === cashMovements) {
        const id = `mov-${++seq}`
        movements[id] = { id, ...valuesOf(q) }
        return [{ id }]
      }
      if (q.op === 'update' && table === cardRepasses) {
        Object.assign(repasse, valuesOf(q))
        return [{ id: REPASSE_ID }]
      }
      return undefined
    })
    dbMock.transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))
    return { log, repasse }
  }

  it('on a received repasse writes a counter outflow at the original date, marks the original reversed, then posts the new inflow', async () => {
    const { adjustCardRepasse } = await import('../card-payments')
    const { log, repasse } = adjustTx({})

    await adjustCardRepasse(TENANT, USER_ID, REPASSE_ID, { netAmount: 440, expectedDate: '2026-10-12' })

    const movementOps = log.filter(
      (q) => (q.op === 'insert' || q.op === 'update') && tableOf(q) === cashMovements,
    )
    expect(movementOps.map((q) => q.op)).toEqual(['insert', 'update', 'insert'])
    expect(valuesOf(movementOps[0])).toMatchObject({
      type: 'outflow',
      amount: '455.05',
      paymentMethod: null,
      cardRepasseId: REPASSE_ID,
      movementDate: parseBrDate('2026-10-10', '12:00:00'),
      description: 'Ajuste de repasse: Repasse Stone 1/6: Procedimento',
    })
    expect(valuesOf(movementOps[1])).toEqual({ reversedByMovementId: 'mov-1' })
    expect(whereParams(movementOps[1].capture)).toContain('mov-0')
    expect(valuesOf(movementOps[2])).toMatchObject({
      type: 'inflow',
      amount: '440.00',
      movementDate: parseBrDate('2026-10-12', '12:00:00'),
      cardRepasseId: REPASSE_ID,
    })
    expect(repasse).toMatchObject({
      netAmount: '440.00',
      feeAmount: '60.00',
      expectedDate: '2026-10-12',
      cashMovementId: 'mov-2',
    })
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'card_repasse', entityId: REPASSE_ID }),
      expect.anything(),
    )
  })

  it('reverses the replacement, not the original, on a second adjustment', async () => {
    const { adjustCardRepasse } = await import('../card-payments')
    const { log } = adjustTx({})

    await adjustCardRepasse(TENANT, USER_ID, REPASSE_ID, { netAmount: 440, expectedDate: '2026-10-12' })
    await adjustCardRepasse(TENANT, USER_ID, REPASSE_ID, { netAmount: 430, expectedDate: '2026-10-13' })

    const reversals = log.filter((q) => q.op === 'update' && tableOf(q) === cashMovements)
    expect(reversals).toHaveLength(2)
    expect(whereParams(reversals[1].capture)).toContain('mov-2')
    expect(whereParams(reversals[1].capture)).not.toContain('mov-0')
  })

  it('edits a pending repasse in place without touching the ledger when the date stays in the future', async () => {
    const { adjustCardRepasse } = await import('../card-payments')
    const { log, repasse } = adjustTx({ status: 'pending', cashMovementId: null, expectedDate: '2026-11-17' })

    await adjustCardRepasse(TENANT, USER_ID, REPASSE_ID, { netAmount: 450, expectedDate: '2026-11-20' })

    expect(repasse).toMatchObject({ netAmount: '450.00', feeAmount: '50.00', expectedDate: '2026-11-20', status: 'pending' })
    expect(inserts(log, cashMovements)).toHaveLength(0)
  })

  it.each([
    ['net is zero', {}, { netAmount: 0, expectedDate: '2026-10-12' }, 'INVALID_REPASSE_AMOUNT'],
    ['net exceeds the gross', {}, { netAmount: 500.01, expectedDate: '2026-10-12' }, 'INVALID_REPASSE_AMOUNT'],
    ['repasse is cancelled', { status: 'cancelled', cashMovementId: null }, { netAmount: 400, expectedDate: '2026-10-12' }, 'REPASSE_CANCELLED'],
    ['received repasse gets a future date', {}, { netAmount: 400, expectedDate: '2026-10-19' }, 'REPASSE_DATE_IN_FUTURE'],
  ])('rejects when %s', async (_name, initial, data, code) => {
    const { adjustCardRepasse } = await import('../card-payments')
    const { log } = adjustTx(initial)

    const error = await adjustCardRepasse(TENANT, USER_ID, REPASSE_ID, data).catch((e) => e)

    expect(error).toBeInstanceOf(BusinessError)
    expect(error.code).toBe(code)
    expect(inserts(log, cashMovements)).toHaveLength(0)
  })
})
