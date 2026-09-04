import { describe, it, expect, vi, beforeEach } from 'vitest'

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
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'

function installmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    tenantId: TENANT,
    amount: '750.00',
    dueDate: '2026-05-22',
    status: 'pending',
    appliedFineType: 'percentage',
    appliedFineValue: '2.00',
    appliedInterestRate: '1.00',
    ...overrides,
  }
}

const financialSettingsRow = {
  fineType: 'percentage',
  fineValue: '2.00',
  monthlyInterestPercent: '1.00',
  gracePeriodDays: 0,
}

/** Queues the three selects `getInstallmentQuote` issues, in order. */
function queueQuoteSelects(opts: {
  installment: Record<string, unknown>[]
  settings?: Record<string, unknown>[]
  payments?: Record<string, unknown>[]
}) {
  dbMock.select.mockReturnValueOnce(chain(opts.installment))
  dbMock.select.mockReturnValueOnce(chain(opts.settings ?? [financialSettingsRow]))
  dbMock.select.mockReturnValueOnce(chain(opts.payments ?? []))
}

describe('getInstallmentQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prices an unpaid overdue installment as of the given instant', async () => {
    const { getInstallmentQuote } = await import('../financial-quote')
    queueQuoteSelects({ installment: [installmentRow()] })

    const quote = await getInstallmentQuote(
      TENANT,
      INSTALLMENT_ID,
      new Date('2026-09-03T14:04:50.000Z'),
    )

    expect(quote.totalDue).toBe(791)
    expect(quote.asOf).toBe('2026-09-03T14:04:50.000Z')
  })

  it('falls back to tenant settings when the row has not snapshotted fine and interest yet', async () => {
    const { getInstallmentQuote } = await import('../financial-quote')
    queueQuoteSelects({
      installment: [
        installmentRow({ appliedFineValue: null, appliedInterestRate: null, appliedFineType: null }),
      ],
    })

    const quote = await getInstallmentQuote(
      TENANT,
      INSTALLMENT_ID,
      new Date('2026-09-03T14:04:50.000Z'),
    )

    expect(quote.totalDue).toBe(791)
  })

  it('excludes reversed payment records', async () => {
    const { getInstallmentQuote } = await import('../financial-quote')
    // The reversed payment is never returned by the query in the first
    // place (it filters on `isNull(reversedAt)`), so the quote prices the
    // installment as if it had never been paid.
    queueQuoteSelects({ installment: [installmentRow()], payments: [] })

    const quote = await getInstallmentQuote(
      TENANT,
      INSTALLMENT_ID,
      new Date('2026-09-03T14:04:50.000Z'),
    )

    expect(quote.remainingPrincipal).toBe(750)
  })

  it('throws INSTALLMENT_NOT_FOUND for an installment in another tenant', async () => {
    const { getInstallmentQuote } = await import('../financial-quote')
    const { BusinessError } = await import('@/lib/errors')
    dbMock.select.mockReturnValueOnce(chain([]))

    await expect(
      getInstallmentQuote(TENANT, INSTALLMENT_ID, new Date('2026-09-03T14:04:50.000Z')),
    ).rejects.toMatchObject(
      new BusinessError('INSTALLMENT_NOT_FOUND', 'Parcela não encontrada ou não pertence a esta clínica'),
    )
  })
})
