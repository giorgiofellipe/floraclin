import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// A chainable, awaitable stand-in for drizzle's query builders, copied from
// financial-meta.test.ts. Every method call returns the same proxy so any
// chain shape resolves to `result` when awaited.
function chain(result: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject)
        }
        if (prop === 'catch') {
          return (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject)
        }
        return () => proxy
      },
    },
  )
  return proxy
}

const dbMock = { select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const PATIENT_ID = '00000000-0000-0000-0000-00000000p001'
const ENTRY_ID = '00000000-0000-0000-0000-00000000e001'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'

// Fixture unless a test says otherwise: R$750, due 2026-05-22, fine 2%
// percentage, interest 1%/month, grace 0. Matches BASE in penalties.test.ts.
const DUE_DATE = '2026-05-22'

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    patientId: PATIENT_ID,
    patientName: 'Paciente Teste',
    procedureRecordId: null,
    appointmentId: null,
    description: 'Procedimento',
    totalAmount: '750.00',
    installmentCount: 1,
    status: 'pending',
    notes: null,
    renegotiatedAt: null,
    createdAt: new Date('2026-05-01T12:00:00.000Z'),
    ...overrides,
  }
}

function installmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    tenantId: TENANT,
    financialEntryId: ENTRY_ID,
    installmentNumber: 1,
    amount: '750.00',
    amountPaid: '0',
    dueDate: DUE_DATE,
    status: 'pending',
    appliedFineType: 'percentage',
    appliedFineValue: '2.00',
    appliedInterestRate: '1.00',
    appliedGracePeriodDays: 0,
    penaltyPauses: [],
    cancelledAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  dbMock.select.mockReset()
})

/**
 * Queues the five selects `getFinancialEntry` issues, in order: entry,
 * installments, payment records, renegotiatedTo, renegotiatedFrom.
 */
function queueEntrySelects(opts: {
  entry: Record<string, unknown>[]
  installments: Record<string, unknown>[]
  payments?: Record<string, unknown>[]
}) {
  dbMock.select.mockReturnValueOnce(chain(opts.entry))
  dbMock.select.mockReturnValueOnce(chain(opts.installments))
  dbMock.select.mockReturnValueOnce(chain(opts.payments ?? []))
  dbMock.select.mockReturnValueOnce(chain([])) // renegotiatedTo
  dbMock.select.mockReturnValueOnce(chain([])) // renegotiatedFrom
}

describe('getFinancialEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T14:04:50.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The R$1 covers 1 of the 26 then owed, carrying 25, plus ten more days on
  // 750 through Sep 13 = 27.50.
  it('a pending installment with one live payment reports the engine carried-interest figure, not a fresh one', async () => {
    const { getFinancialEntry } = await import('../financial')

    queueEntrySelects({
      entry: [entryRow()],
      installments: [installmentRow()],
      payments: [
        {
          id: 'p1',
          installmentId: INSTALLMENT_ID,
          amount: '1.00',
          paidAt: '2026-09-03T14:04:50.000Z',
          recordedAt: '2026-09-03T14:04:50.000Z',
        },
      ],
    })

    const result = await getFinancialEntry(TENANT, ENTRY_ID)

    expect(result?.installments[0].computedInterestAmount).toBe(27.5)
    expect(result?.installments[0].computedFineAmount).toBe(15)
  })

  // An overdue installment with no payments at all: the engine's absolute
  // day count from the due date (114 days at Sep 13), not the row's stale
  // stored interestAmount.
  it('an overdue installment with no payments reports the engine figures, not the stored interestAmount', async () => {
    const { getFinancialEntry } = await import('../financial')

    queueEntrySelects({
      entry: [entryRow({ status: 'overdue' })],
      installments: [installmentRow({ status: 'overdue', interestAmount: '999.99' })],
      payments: [],
    })

    const result = await getFinancialEntry(TENANT, ENTRY_ID)

    // 750 * 0.01/30 * 114 = 28.5
    expect(result?.installments[0].computedInterestAmount).toBe(28.5)
    expect(result?.installments[0].computedFineAmount).toBe(15)
  })
})

describe('getFinancialEntry on rows out of collection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T14:04:50.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Cancelled Jul 1, 40 days after the May 22 due date: interest 750 * 1%/30 * 40
  // = 10 and the fine of 15, frozen there. A paid row owes nothing.
  it('prices a cancelled installment through the engine up to its cancel date and a paid one at zero, whatever is stored', async () => {
    const { getFinancialEntry } = await import('../financial')

    queueEntrySelects({
      entry: [entryRow({ status: 'cancelled' })],
      installments: [
        installmentRow({
          status: 'cancelled',
          cancelledAt: new Date('2026-07-01T15:00:00.000Z'),
          fineAmount: '999.00',
          interestAmount: '888.00',
        }),
        installmentRow({ id: 'i-paid', installmentNumber: 2, status: 'paid', amountPaid: '750.00', fineAmount: '5.00', interestAmount: '3.00' }),
      ],
    })

    const result = await getFinancialEntry(TENANT, ENTRY_ID)

    expect(
      result?.installments.map((i) => [i.status, i.computedFineAmount, i.computedInterestAmount]),
    ).toEqual([
      ['cancelled', 15, 10],
      ['paid', 0, 0],
    ])
  })
})

describe('listFinancialEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T15:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prices each entry\'s fine and interest through the engine: grace and a fixed fine are honoured', async () => {
    const { listFinancialEntries } = await import('../financial')
    const IN_GRACE = '00000000-0000-0000-0000-00000000e00a'
    const FIXED_FINE = '00000000-0000-0000-0000-00000000e00b'

    dbMock.select.mockReturnValueOnce(chain([{ count: 2 }]))
    dbMock.select.mockReturnValueOnce(
      chain([entryRow({ id: IN_GRACE }), entryRow({ id: FIXED_FINE })]),
    )
    dbMock.select.mockReturnValueOnce(
      chain([
        // Three days past due with five days of grace.
        installmentRow({
          id: 'i-a',
          financialEntryId: IN_GRACE,
          dueDate: '2026-05-22',
          appliedGracePeriodDays: 5,
        }),
        installmentRow({
          id: 'i-b',
          financialEntryId: FIXED_FINE,
          dueDate: '2026-05-01',
          appliedFineType: 'fixed',
          appliedFineValue: '10.00',
          appliedGracePeriodDays: 5,
        }),
      ]),
    ) // open installments
    dbMock.select.mockReturnValueOnce(chain([])) // live payments

    const result = await listFinancialEntries(TENANT, { page: 1, limit: 20 })

    // Grace ends May 6, so 19 days of interest on 750: 4.75.
    expect(result.data.map((e) => [e.id, e.totalFineAmount, e.totalInterestAmount])).toEqual([
      [IN_GRACE, 0, 0],
      [FIXED_FINE, 10, 4.75],
    ])
  })
})

// Like chain(), but records the payload passed to .values().
function chainCapturing(result: unknown, capture: { value?: unknown }) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
        }
        if (prop === 'values') {
          return (payload: unknown) => {
            capture.value = payload
            return proxy
          }
        }
        return () => proxy
      },
    },
  )
  return proxy
}

describe('createFinancialEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      name: 'the tenant settings',
      settings: [{ fineType: 'fixed', fineValue: '5.00', monthlyInterestPercent: '0.50', gracePeriodDays: 3 }],
      terms: { appliedFineType: 'fixed', appliedFineValue: '5.00', appliedInterestRate: '0.50', appliedGracePeriodDays: 3 },
    },
    {
      name: 'the defaults when the tenant has no settings row',
      settings: [],
      terms: { appliedFineType: 'percentage', appliedFineValue: '2.00', appliedInterestRate: '1.00', appliedGracePeriodDays: 0 },
    },
  ])('writes every installment with the fine, interest and grace terms of $name at creation', async ({ settings, terms }) => {
    const { createFinancialEntry } = await import('../financial')
    dbMock.select.mockReturnValueOnce(chain([{ id: PATIENT_ID }])) // patient ownership

    const installmentsInsert: { value?: unknown } = {}
    const tx = { select: vi.fn(), insert: vi.fn() }
    tx.insert.mockReturnValueOnce(chain([{ id: ENTRY_ID }])) // entry
    tx.select.mockReturnValueOnce(chain(settings)) // financial settings
    tx.insert.mockReturnValueOnce(chainCapturing(undefined, installmentsInsert))

    await createFinancialEntry(
      TENANT,
      'user-1',
      { patientId: PATIENT_ID, description: 'Procedimento', totalAmount: 300, installmentCount: 2 },
      tx as never,
    )

    expect(installmentsInsert.value).toEqual([
      expect.objectContaining(terms),
      expect.objectContaining(terms),
    ])
  })
})

describe('listFinancialEntries overdue flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The flag comes from the engine, on the BR day and net of grace, whatever
  // the row says.
  it.each([
    {
      name: 'an installment due today is not overdue at 22:00 BRT, already the next day in UTC',
      now: '2026-05-23T01:00:00.000Z',
      installment: { dueDate: '2026-05-22', appliedGracePeriodDays: 0 },
      overdue: false,
    },
    {
      name: 'an installment 3 days late with 5 days of grace is not overdue',
      now: '2026-05-25T15:00:00.000Z',
      installment: { dueDate: '2026-05-22', appliedGracePeriodDays: 5 },
      overdue: false,
    },
    {
      name: 'an installment past its grace is overdue',
      now: '2026-05-28T15:00:00.000Z',
      installment: { dueDate: '2026-05-22', appliedGracePeriodDays: 5 },
      overdue: true,
    },
  ])('$name', async ({ now, installment, overdue }) => {
    vi.setSystemTime(new Date(now))
    const { listFinancialEntries } = await import('../financial')

    dbMock.select.mockReturnValueOnce(chain([{ count: 1 }]))
    dbMock.select.mockReturnValueOnce(chain([entryRow({ isOverdue: false })]))
    dbMock.select.mockReturnValueOnce(chain([installmentRow(installment)])) // open installments
    dbMock.select.mockReturnValueOnce(chain([])) // live payments

    const result = await listFinancialEntries(TENANT, { page: 1, limit: 20 })

    expect(result.data[0].isOverdue).toBe(overdue)
  })
})

describe('getRevenueOverview pending and overdue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // 22:00 BRT on May 22, already May 23 in UTC.
    vi.setSystemTime(new Date('2026-05-23T01:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts an installment due today, and one inside its grace, as pending rather than overdue', async () => {
    const { getRevenueOverview } = await import('../financial')

    // What Postgres computed with CURRENT_DATE on a UTC host and no grace.
    dbMock.select.mockReturnValueOnce(chain([{ totalReceived: 0, totalPending: 0, totalOverdue: 1500 }]))
    dbMock.select.mockReturnValueOnce(chain([])) // monthly
    dbMock.select.mockReturnValueOnce(chain([])) // by procedure type
    dbMock.select.mockReturnValueOnce(chain([])) // by payment method
    dbMock.select.mockReturnValueOnce(chain([{ totalExpenses: 0, totalPendingExpenses: 0 }]))
    dbMock.select.mockReturnValueOnce(
      chain([
        installmentRow({ id: 'i-today', dueDate: '2026-05-22' }),
        installmentRow({ id: 'i-grace', dueDate: '2026-05-19', appliedGracePeriodDays: 5 }),
      ]),
    ) // pending installments

    const result = await getRevenueOverview(TENANT, '2026-05-01', '2026-05-31')

    expect([result.summary.totalPending, result.summary.totalOverdue]).toEqual([1500, 0])
  })
})

describe('getRevenueOverview overdue amount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T14:04:50.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // p1 paid 100 of principal on the due date. 650 left, 114 days late on Sep
  // 13: fine 15 on the installment, interest 650 * 1%/30 * 114 = 24.70.
  it('counts a partly paid overdue installment at what the engine says is owed, as the ledger does', async () => {
    const { getRevenueOverview } = await import('../financial')

    dbMock.select.mockReturnValueOnce(chain([{ totalReceived: 0 }]))
    dbMock.select.mockReturnValueOnce(chain([])) // monthly
    dbMock.select.mockReturnValueOnce(chain([])) // by procedure type
    dbMock.select.mockReturnValueOnce(chain([])) // by payment method
    dbMock.select.mockReturnValueOnce(chain([{ totalExpenses: 0, totalPendingExpenses: 0 }]))
    dbMock.select.mockReturnValueOnce(chain([installmentRow({ amountPaid: '100.00' })])) // pending installments
    dbMock.select.mockReturnValueOnce(
      chain([
        {
          id: 'p1',
          installmentId: INSTALLMENT_ID,
          amount: '100.00',
          paidAt: '2026-05-22T15:00:00.000Z',
          recordedAt: '2026-05-22T15:00:00.000Z',
        },
      ]),
    ) // live payments

    const result = await getRevenueOverview(TENANT, '2026-05-01', '2026-09-30')

    expect(result.summary.totalOverdue).toBe(689.7)
  })
})
