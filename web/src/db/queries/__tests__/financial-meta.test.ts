import { describe, it, expect, vi, beforeEach } from 'vitest'

// A chainable, awaitable stand-in for drizzle's query builders, copied from
// meta-events.test.ts. Every method call returns the same proxy so any chain
// shape resolves to `result` when awaited.
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

const dbMock = { transaction: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const enqueueMetaEventMock = vi.fn()
vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: (...args: unknown[]) => enqueueMetaEventMock(...args),
}))

const resolveProspectForPatientMock = vi.fn()
vi.mock('@/lib/meta/resolve-prospect', () => ({
  resolveProspectForPatient: (...args: unknown[]) => resolveProspectForPatientMock(...args),
}))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const PATIENT_ID = '00000000-0000-0000-0000-00000000p001'
const ENTRY_ID = '00000000-0000-0000-0000-00000000e001'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'

const FUTURE_DUE_DATE = '2099-01-01' // never overdue, keeps fine/interest at zero

function makeTx() {
  return {
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }
}

// Raw SQL FOR UPDATE lock result: snake_case, already fine/interest-snapshotted
// so recordPayment skips the settings-snapshot branch (fewer calls to mock).
function lockedInstallmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    status: 'pending',
    amount: '600.00',
    amount_paid: '0',
    fine_amount: '0',
    due_date: FUTURE_DUE_DATE,
    financial_entry_id: ENTRY_ID,
    applied_fine_type: 'percentage',
    applied_fine_value: '2.00',
    applied_interest_rate: '1.00',
    last_fine_interest_calc_at: null,
    ...overrides,
  }
}

// Typed drizzle select row used inside bulkPayInstallments' loop: camelCase.
function typedInstallmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    status: 'pending',
    amount: '600.00',
    amountPaid: '0',
    fineAmount: '0',
    dueDate: FUTURE_DUE_DATE,
    financialEntryId: ENTRY_ID,
    appliedFineType: 'percentage',
    appliedFineValue: '2.00',
    appliedInterestRate: '1.00',
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

const patientContactRow = {
  phone: '+5511999999999',
  email: 'jane@example.com',
  fullName: 'Jane Doe',
}

/**
 * Queues the three selects emitPurchaseEventForEntry issues after
 * updateEntryStatus: the entry status/totalAmount/patientId recheck, the
 * renegotiation-link check, and (only reached when both gates pass) the
 * patient's contact data.
 */
function queueGateSelects(
  tx: ReturnType<typeof makeTx>,
  opts: {
    entryStatus: string
    totalAmount?: string
    patientId?: string
    renegotiated?: boolean
    contact?: Record<string, unknown> | null
  },
) {
  tx.select.mockReturnValueOnce(
    chain([{ status: opts.entryStatus, totalAmount: opts.totalAmount ?? '600.00', patientId: opts.patientId ?? PATIENT_ID }]),
  )
  if (opts.entryStatus !== 'paid' && opts.entryStatus !== 'partial') return

  tx.select.mockReturnValueOnce(chain(opts.renegotiated ? [{ id: 'link-1' }] : []))
  if (opts.renegotiated) return

  tx.select.mockReturnValueOnce(chain(opts.contact === null ? [] : [opts.contact ?? patientContactRow]))
}

describe('financial.ts meta conversions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recordPayment', () => {
    it('paying installment 1 of 6 emits one Purchase carrying the full totalAmount, not the installment amount', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays
      tx.select.mockReturnValueOnce(chain([])) // existingPayments (not backdated)
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'Preenchimento labial' }])) // entryInfo
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }])) // updateEntryStatus's installments (1 of 6 paid, rest not in this stub since only this one matters for allPaid=false via extra pending rows)
      queueGateSelects(tx, { entryStatus: 'partial', totalAmount: '600.00' })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }])) // paymentRecords
      tx.insert.mockReturnValueOnce(chain(undefined)) // cashMovements
      tx.update.mockReturnValueOnce(chain(undefined)) // installments
      tx.update.mockReturnValueOnce(chain(undefined)) // financialEntries (updateEntryStatus)

      resolveProspectForPatientMock.mockResolvedValueOnce({ id: 'prospect-1' })

      await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 600,
        paymentMethod: 'pix',
      } as never)

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
      const call = enqueueMetaEventMock.mock.calls[0][0] as Record<string, unknown>
      expect(call.eventName).toBe('Purchase')
      expect(call.eventId).toBe(`purchase:${ENTRY_ID}`)
      expect(call.value).toBe('600.00')
      expect(call.actionSource).toBe('system_generated')
      expect(call.prospectId).toBe('prospect-1')
      expect(call.patientId).toBe(PATIENT_ID)
      expect(call.contact).toEqual(patientContactRow)
    })

    it('paying installment 2 of 6 also calls enqueueMetaEvent, with the identical eventId (the outbox unique index is the only dedup)', async () => {
      const { recordPayment } = await import('../financial')

      for (const installmentId of [INSTALLMENT_ID, 'i-2']) {
        const tx = makeTx()
        dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

        tx.execute.mockResolvedValueOnce([lockedInstallmentRow({ id: installmentId })])
        tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
        tx.select.mockReturnValueOnce(chain([]))
        tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'Preenchimento labial' }]))
        tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
        queueGateSelects(tx, { entryStatus: 'partial', totalAmount: '600.00' })

        tx.insert.mockReturnValueOnce(chain([{ id: `pay-${installmentId}` }]))
        tx.insert.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))

        resolveProspectForPatientMock.mockResolvedValueOnce({ id: 'prospect-1' })

        await recordPayment(TENANT, USER_ID, { installmentId, amount: 600, paymentMethod: 'pix' } as never)
      }

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(2)
      const eventIds = enqueueMetaEventMock.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventId)
      expect(eventIds).toEqual([`purchase:${ENTRY_ID}`, `purchase:${ENTRY_ID}`])
    })

    it('never calls postEvents from inside the payment transaction: enqueueMetaEvent always receives the tx handle', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00' })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      resolveProspectForPatientMock.mockResolvedValueOnce({ id: 'prospect-1' })

      await recordPayment(TENANT, USER_ID, { installmentId: INSTALLMENT_ID, amount: 600, paymentMethod: 'pix' } as never)

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
      const call = enqueueMetaEventMock.mock.calls[0][0] as Record<string, unknown>
      expect(call.tx).toBe(tx)
    })

    it('a payment for a patient with no originating prospect still emits, with prospectId null', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00' })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      resolveProspectForPatientMock.mockResolvedValueOnce(null) // walk-in, never a lead

      await recordPayment(TENANT, USER_ID, { installmentId: INSTALLMENT_ID, amount: 600, paymentMethod: 'pix' } as never)

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
      const call = enqueueMetaEventMock.mock.calls[0][0] as Record<string, unknown>
      expect(call.prospectId).toBeNull()
      expect(call.contact).toEqual(patientContactRow)
    })

    it('a short payment that leaves the entry pending emits nothing', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'pending', amountPaid: '0' }])) // updateEntryStatus's installments
      queueGateSelects(tx, { entryStatus: 'pending' }) // gate 1 fails: only this one select is issued

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      await recordPayment(TENANT, USER_ID, { installmentId: INSTALLMENT_ID, amount: 1, paymentMethod: 'pix' } as never)

      expect(enqueueMetaEventMock).not.toHaveBeenCalled()
      expect(resolveProspectForPatientMock).not.toHaveBeenCalled()
    })

    it('a renegotiated entry emits nothing', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00', renegotiated: true })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      await recordPayment(TENANT, USER_ID, { installmentId: INSTALLMENT_ID, amount: 600, paymentMethod: 'pix' } as never)

      expect(enqueueMetaEventMock).not.toHaveBeenCalled()
      expect(resolveProspectForPatientMock).not.toHaveBeenCalled()
    })
  })

  describe('bulkPayInstallments', () => {
    it('emits exactly two Purchase events across two entries', async () => {
      const { bulkPayInstallments } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      const INSTALLMENT_A = 'installment-a'
      const INSTALLMENT_B = 'installment-b'
      const ENTRY_A = 'entry-a'
      const ENTRY_B = 'entry-b'
      const PATIENT_A = 'patient-a'
      const PATIENT_B = 'patient-b'

      tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_A }, { id: INSTALLMENT_B }]) // FOR UPDATE lock
      tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays, before the loop

      // Iteration 1: installment A / entry A
      tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ id: INSTALLMENT_A, financialEntryId: ENTRY_A })])) // row
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_A, description: 'x' }])) // entryInfo
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }])) // updateEntryStatus
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00', patientId: PATIENT_A, contact: { phone: '+5511900000001', email: 'a@example.com', fullName: 'Patient A' } })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-a' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      resolveProspectForPatientMock.mockResolvedValueOnce({ id: 'prospect-a' })

      // Iteration 2: installment B / entry B
      tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ id: INSTALLMENT_B, financialEntryId: ENTRY_B })])) // row
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_B, description: 'y' }])) // entryInfo
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '400.00' }])) // updateEntryStatus
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '400.00', patientId: PATIENT_B, contact: { phone: '+5511900000002', email: 'b@example.com', fullName: 'Patient B' } })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-b' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      resolveProspectForPatientMock.mockResolvedValueOnce({ id: 'prospect-b' })

      await bulkPayInstallments(TENANT, USER_ID, {
        installmentIds: [INSTALLMENT_A, INSTALLMENT_B],
        paymentMethod: 'pix',
      })

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(2)
      const calls = enqueueMetaEventMock.mock.calls.map((c) => c[0] as Record<string, unknown>)
      expect(calls.map((c) => c.eventId)).toEqual([`purchase:${ENTRY_A}`, `purchase:${ENTRY_B}`])
      expect(calls.map((c) => c.value)).toEqual(['600.00', '400.00'])
      expect(calls.every((c) => c.tx === tx)).toBe(true)
    })
  })
})
