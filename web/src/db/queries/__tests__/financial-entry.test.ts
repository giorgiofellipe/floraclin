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
    fineAmount: '0',
    interestAmount: '0',
    lastFineInterestCalcAt: null,
    ...overrides,
  }
}

const financialSettingsRow = {
  fineType: 'percentage',
  fineValue: '2.00',
  monthlyInterestPercent: '1.00',
  gracePeriodDays: 0,
}

/**
 * Queues the six selects `getFinancialEntry` issues, in order: entry,
 * installments, payment records, financial settings (loadFinancialSettings),
 * renegotiatedTo, renegotiatedFrom.
 */
function queueEntrySelects(opts: {
  entry: Record<string, unknown>[]
  installments: Record<string, unknown>[]
  payments?: Record<string, unknown>[]
  settings?: Record<string, unknown>[]
}) {
  dbMock.select.mockReturnValueOnce(chain(opts.entry))
  dbMock.select.mockReturnValueOnce(chain(opts.installments))
  dbMock.select.mockReturnValueOnce(chain(opts.payments ?? []))
  dbMock.select.mockReturnValueOnce(chain(opts.settings ?? [financialSettingsRow]))
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

  // AR2-3: the v1 inline block read only the stored interestAmount and a
  // fresh few days of accrual, dropping whatever a prior payment had not
  // covered. The engine carries it forward: a tiny R$1 payment on Sep 3
  // leaves 25 carried, plus ten more days on 750 through Sep 13 = 27.50.
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
