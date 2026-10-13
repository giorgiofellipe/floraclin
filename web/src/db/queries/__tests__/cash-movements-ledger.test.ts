import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// A chainable, awaitable stand-in for drizzle's query builders, copied from
// financial-meta.test.ts.
function chain(result: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
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

function installmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-00000000i001',
    financialEntryId: '00000000-0000-0000-0000-00000000e001',
    amount: '750.00',
    dueDate: '2026-05-22',
    status: 'pending',
    appliedFineType: 'percentage',
    appliedFineValue: '2.00',
    appliedInterestRate: '1.00',
    appliedGracePeriodDays: 0,
    penaltyPauses: [],
    cancelledAt: null,
    // Snapshots last written at a payment, long stale by now.
    fineAmount: '0',
    interestAmount: '0',
    amountPaid: '0',
    ...overrides,
  }
}

describe('getLedgerSummary overdue receivables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T14:04:50.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sums what the engine prices now, not the stored fine and interest snapshots', async () => {
    const { getLedgerSummary } = await import('../cash-movements')

    dbMock.select.mockReturnValueOnce(chain([{ totalInflows: 0, totalOutflows: 0, netResult: 0 }]))
    dbMock.select.mockReturnValueOnce(
      chain([
        installmentRow(),
        // Past due on the calendar, but every day since was spent cancelled.
        installmentRow({
          id: '00000000-0000-0000-0000-00000000i002',
          penaltyPauses: [{ from: '2026-05-21T15:00:00.000Z', to: '2026-09-03T12:00:00.000Z' }],
        }),
      ]),
    ) // installments past due plus grace
    dbMock.select.mockReturnValueOnce(chain([])) // live payments

    const summary = await getLedgerSummary(TENANT, { dateFrom: '2026-09-01', dateTo: '2026-09-30' } as never)

    // 750 + 15 fine + 26 interest (104 days at 1%/month).
    expect(Number(summary.overdueReceivables)).toBe(791)
  })
})
