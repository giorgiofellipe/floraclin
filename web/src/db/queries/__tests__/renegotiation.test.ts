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

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

function makeTx() {
  return {
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }
}

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const PATIENT_ID = '00000000-0000-0000-0000-00000000p001'
const ENTRY_ID = '00000000-0000-0000-0000-00000000e001'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'
const NEW_ENTRY_ID = '00000000-0000-0000-0000-00000000e002'

const financialSettingsRow = {
  fineType: 'percentage',
  fineValue: '2.00',
  monthlyInterestPercent: '1.00',
  gracePeriodDays: 0,
}

describe('renegotiateCharges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T14:04:50.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prices penalties through the engine, matching what the payment dialog would quote', async () => {
    const { renegotiateCharges } = await import('../renegotiation')
    const tx = makeTx()
    dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

    // 1. Eligibility select
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: ENTRY_ID,
          patientId: PATIENT_ID,
          description: 'Tratamento X',
          totalAmount: '750.00',
          status: 'pending',
        },
      ]),
    )

    // 2. FOR UPDATE lock, raw SQL result: snake_case column names
    tx.execute.mockResolvedValueOnce([
      {
        id: INSTALLMENT_ID,
        financial_entry_id: ENTRY_ID,
        status: 'pending',
        amount: '750.00',
        amount_paid: '0',
        fine_amount: '0',
        due_date: '2026-05-22',
        applied_fine_type: 'percentage',
        applied_fine_value: '2.00',
        applied_interest_rate: '1.00',
        last_fine_interest_calc_at: null,
      },
    ])

    // 3. Live payment records for the locked installments
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: 'pay-1',
          installmentId: INSTALLMENT_ID,
          amount: '1.00',
          paidAt: new Date('2026-09-03T14:04:50.000Z'),
          recordedAt: new Date('2026-09-03T14:04:50.000Z'),
        },
      ]),
    )

    // 4. loadFinancialSettings
    tx.select.mockReturnValueOnce(chain([financialSettingsRow]))

    tx.update.mockReturnValueOnce(chain(undefined)) // cancel unpaid installments
    tx.update.mockReturnValueOnce(chain(undefined)) // mark original entries renegotiated

    tx.insert.mockReturnValueOnce(chain([{ id: NEW_ENTRY_ID }])) // new financial entry
    tx.insert.mockReturnValueOnce(chain(undefined)) // renegotiation link
    tx.insert.mockReturnValueOnce(chain(undefined)) // new installments
    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log: original entry
    tx.insert.mockReturnValueOnce(chain(undefined)) // audit log: new entry

    const result = await renegotiateCharges(TENANT, USER_ID, {
      entryIds: [ENTRY_ID],
      newInstallmentCount: 1,
      description: 'Renegociação',
      waivePenalties: false,
      waiveAmount: 0,
    } as never)

    // Hand-checked: the payment of 1 on Sep 3 covers 1 of the 26 interest then
    // owed, carrying 25 and setting the fine at 15; ten more days on 750 at
    // 1%/month is 2.50, so 25 + 2.50 = 27.50 interest at renegotiation time.
    // The old inline block never loaded payment records, so with this row's
    // null last_fine_interest_calc_at it priced 114 days on the full 750 from
    // the due date: 15 + 28.50 = 43.50. Neither figure knows about the R$1.
    expect(result.breakdown).toEqual([
      { entryId: ENTRY_ID, remainingPrincipal: 750, penalties: 42.5 },
    ])
    expect(result.penaltiesIncluded).toBe(42.5)
  })
})
