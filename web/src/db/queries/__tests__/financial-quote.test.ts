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
    financialEntryId: '00000000-0000-0000-0000-00000000e001',
    installmentNumber: 2,
    amount: '750.00',
    dueDate: '2026-05-22',
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

function livePayment(paidAt: string) {
  return { id: 'p1', amount: '100.00', paidAt, recordedAt: paidAt }
}

const financialSettingsRow = {
  fineType: 'percentage',
  fineValue: '2.00',
  monthlyInterestPercent: '1.00',
  gracePeriodDays: 0,
}

/** Queues the two selects `getInstallmentQuote` issues, in order. */
function queueQuoteSelects(opts: {
  installment: Record<string, unknown>[]
  payments?: Record<string, unknown>[]
}) {
  dbMock.select.mockReturnValueOnce(chain(opts.installment))
  dbMock.select.mockReturnValueOnce(chain(opts.payments ?? []))
}

describe('getInstallmentQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.select.mockReset()
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

  // CDC art. 51 X: the clinic changing its settings must not reprice a charge
  // already issued. Rows are served by table so a settings read anywhere in
  // the path would see the new, harsher terms.
  it('prices with the terms written at creation, not the tenant settings changed since', async () => {
    const { getInstallmentQuote } = await import('../financial-quote')
    const { financialSettings, installments, paymentRecords } = await import('@/db/schema')
    const byTable = new Map<unknown, unknown[]>([
      [installments, [installmentRow({ appliedGracePeriodDays: 0 })]],
      [financialSettings, [{ ...financialSettingsRow, fineValue: '1.00', gracePeriodDays: 10 }]],
      [paymentRecords, []],
    ])
    dbMock.select.mockImplementation(() => ({ from: (table: unknown) => chain(byTable.get(table)) }))

    const quote = await getInstallmentQuote(
      TENANT,
      INSTALLMENT_ID,
      new Date('2026-05-25T15:00:00.000Z'),
    )

    // Fine 2% of 750 and three days of 1%/month, both from the row.
    expect([quote.fineAmount, quote.interestAmount]).toEqual([15, 0.75])
  })

  it('refuses to price an installment that has no terms written, naming it', async () => {
    const { getInstallmentQuote } = await import('../financial-quote')
    queueQuoteSelects({ installment: [installmentRow({ appliedGracePeriodDays: null })] })

    await expect(
      getInstallmentQuote(TENANT, INSTALLMENT_ID, new Date('2026-09-03T14:04:50.000Z')),
    ).rejects.toThrow(INSTALLMENT_ID)
  })

  it('refuses a date before an existing payment and names the installment and the later date', async () => {
    const { getInstallmentQuote } = await import('../financial-quote')
    queueQuoteSelects({
      installment: [installmentRow()],
      payments: [livePayment('2026-08-01T15:00:00.000Z')],
    })
    dbMock.select.mockReturnValueOnce(chain([{ description: 'Botox', patientName: 'Maria Silva' }]))

    await expect(
      getInstallmentQuote(TENANT, INSTALLMENT_ID, new Date('2026-06-22T15:00:00.000Z')),
    ).rejects.toMatchObject({
      code: 'PAYMENT_BEFORE_LATER_PAYMENT',
      message:
        'Já existe um pagamento em 01/08/2026 na parcela 2 de Botox (Maria Silva). Registre pagamentos a partir dessa data.',
    })
  })

  // A date picked in the UI is anchored to BR noon, so on the morning of a day
  // that already has a payment it sorts before it.
  it('prices an earlier instant on the latest payment\'s own BR day after that payment', async () => {
    const { getInstallmentQuote } = await import('../financial-quote')
    queueQuoteSelects({
      installment: [installmentRow()],
      payments: [livePayment('2026-09-03T15:00:00.000Z')],
    })

    const quote = await getInstallmentQuote(
      TENANT,
      INSTALLMENT_ID,
      new Date('2026-09-03T13:00:00.000Z'),
    )

    // The R$100 covers 26 of interest and the 15 fine, leaving 691 of principal.
    expect(quote.totalDue).toBe(691)
  })

  it.each([
    { status: 'paid', error: ['INSTALLMENT_ALREADY_PAID', 'Parcela já está totalmente paga'] },
    { status: 'cancelled', error: ['INSTALLMENT_CANCELLED', 'Parcela cancelada não pode receber pagamento'] },
  ])('throws $error.0 for a $status installment without reaching the payments select', async ({ status, error }) => {
    const { getInstallmentQuote } = await import('../financial-quote')
    const { BusinessError } = await import('@/lib/errors')
    dbMock.select.mockReturnValueOnce(chain([installmentRow({ status })]))

    await expect(
      getInstallmentQuote(TENANT, INSTALLMENT_ID, new Date('2026-09-03T14:04:50.000Z')),
    ).rejects.toMatchObject(new BusinessError(error[0], error[1]))
    expect(dbMock.select).toHaveBeenCalledTimes(1)
  })

  it('throws INSTALLMENT_NOT_FOUND when the installment is not found', async () => {
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
