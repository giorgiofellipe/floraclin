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

const dbMock = { transaction: vi.fn(), select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const enqueueMetaEventMock = vi.fn()
const resolveMetaEventPrerequisitesMock = vi.fn()
const claimAndSendPendingEventMock = vi.fn()
vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: (...args: unknown[]) => enqueueMetaEventMock(...args),
  resolveMetaEventPrerequisites: (...args: unknown[]) => resolveMetaEventPrerequisitesMock(...args),
  claimAndSendPendingEvent: (...args: unknown[]) => claimAndSendPendingEventMock(...args),
}))

const resolveProspectForPatientMock = vi.fn()
vi.mock('@/lib/meta/resolve-prospect', () => ({
  resolveProspectForPatient: (...args: unknown[]) => resolveProspectForPatientMock(...args),
}))

const reportSideEffectFailureMock = vi.fn()
vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: (...args: unknown[]) => reportSideEffectFailureMock(...args),
}))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'
const PATIENT_ID = '00000000-0000-0000-0000-00000000p001'
const ENTRY_ID = '00000000-0000-0000-0000-00000000e001'
const INSTALLMENT_ID = '00000000-0000-0000-0000-00000000i001'

const FUTURE_DUE_DATE = '2099-01-01' // never overdue, keeps fine/interest at zero

const PREREQUISITES = {
  optedOut: false,
  connection: {
    datasetId: 'dataset-1',
    accessToken: 'tok-1',
    testEventCode: null,
    advancedMatchingEnabled: true,
  },
  attribution: null,
}

/**
 * `transaction` is drizzle's nested transaction, which the postgres-js driver
 * issues as SAVEPOINT / ROLLBACK TO SAVEPOINT: a throw inside the callback
 * comes back out, and the outer handle keeps working afterwards. `savepoint`
 * is the handle that callback receives.
 */
function makeTx() {
  const savepoint = { insert: vi.fn(), select: vi.fn() }
  return {
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    savepoint,
    transaction: vi.fn(async (cb: (sp: unknown) => unknown) => cb(savepoint)),
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
 * The single pre-transaction join that carries the entry, its patient and the
 * contact data into the payment, so nothing inside the transaction has to
 * check out a second pooled connection.
 */
function queuePrepareRows(
  rows: Array<{ financialEntryId: string; patientId: string } & Record<string, unknown>> = [
    { financialEntryId: ENTRY_ID, patientId: PATIENT_ID, ...patientContactRow },
  ],
) {
  dbMock.select.mockReturnValueOnce(chain(rows))
}

/** The outbox row emitPurchaseEventForEntry re-reads after the enqueue. */
function queuedPurchaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-1',
    prospectId: null,
    patientId: PATIENT_ID,
    eventId: `purchase:${ENTRY_ID}`,
    eventTime: new Date('2026-01-01T12:00:00.000Z'),
    value: '600.00',
    payload: null,
    status: 'pending',
    ...overrides,
  }
}

/**
 * Queues the selects emitPurchaseEventForEntry issues after
 * updateEntryStatus: the entry status/totalAmount recheck, the
 * renegotiation-link check, and the outbox re-read that decides what the
 * caller sends once the transaction commits. `queued: null` stands for an
 * outbox row that is not there at all.
 */
function queueGateSelects(
  tx: ReturnType<typeof makeTx>,
  opts: {
    entryStatus: string
    totalAmount?: string
    renegotiated?: boolean
    /** The enqueue throws, so the re-read that follows it never runs. */
    enqueueFails?: boolean
    queued?: Record<string, unknown> | null
  },
) {
  tx.select.mockReturnValueOnce(
    chain([{ status: opts.entryStatus, totalAmount: opts.totalAmount ?? '600.00' }]),
  )
  if (opts.entryStatus !== 'paid' && opts.entryStatus !== 'partial') return

  tx.select.mockReturnValueOnce(chain(opts.renegotiated ? [{ id: 'link-1' }] : []))
  if (opts.renegotiated || opts.enqueueFails) return

  const queued = opts.queued === undefined ? queuedPurchaseRow() : opts.queued
  tx.select.mockReturnValueOnce(chain(queued ? [queued] : []))
}

/**
 * Stands in for `withTransaction` and fires `onCommit` once the callback has
 * resolved, so a test can prove a send happened outside the transaction.
 */
function transactionCommittingWith(tx: ReturnType<typeof makeTx>, onCommit: () => void) {
  return async (cb: (tx: unknown) => unknown) => {
    const out = await cb(tx)
    onCommit()
    return out
  }
}

/** Walks a drizzle SQL fragment looking for a bound parameter value. */
function carriesValue(node: unknown, target: string, seen = new Set<unknown>()): boolean {
  if (node === target) return true
  if (typeof node !== 'object' || node === null || seen.has(node)) return false
  seen.add(node)
  return Object.values(node as Record<string, unknown>).some((child) =>
    carriesValue(child, target, seen),
  )
}

describe('financial.ts meta conversions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMetaEventPrerequisitesMock.mockResolvedValue(PREREQUISITES)
    resolveProspectForPatientMock.mockResolvedValue(null)
    enqueueMetaEventMock.mockResolvedValue({ inserted: true })
  })

  describe('recordPayment', () => {
    it('paying installment 1 of 6 emits one Purchase carrying the full totalAmount, not the installment amount', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays
      tx.select.mockReturnValueOnce(chain([])) // existingPayments (not backdated)
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'Preenchimento labial' }])) // entryInfo
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }])) // updateEntryStatus's installments
      queueGateSelects(tx, { entryStatus: 'partial', totalAmount: '3600.00' })

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
      expect(call.value).toBe('3600.00')
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
        queuePrepareRows()

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

    // Fix 2: the re-read finds the row an earlier installment (or the
    // reconciler, mid-send) left behind, and delivering it here posts the same
    // Purchase to Meta twice.
    it('a second payment on the same entry does not deliver the row it did not insert', async () => {
      const { recordPayment } = await import('../financial')

      for (const installmentId of [INSTALLMENT_ID, 'i-2']) {
        const tx = makeTx()
        dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
        queuePrepareRows()

        tx.execute.mockResolvedValueOnce([lockedInstallmentRow({ id: installmentId })])
        tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
        tx.select.mockReturnValueOnce(chain([]))
        tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
        tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
        queueGateSelects(tx, { entryStatus: 'partial', totalAmount: '600.00' })

        tx.insert.mockReturnValueOnce(chain([{ id: `pay-${installmentId}` }]))
        tx.insert.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))

        // The second call conflicts on (tenant_id, event_id): the row exists
        // and belongs to whoever wrote it.
        enqueueMetaEventMock.mockResolvedValueOnce({
          inserted: installmentId === INSTALLMENT_ID,
        })

        await recordPayment(TENANT, USER_ID, { installmentId, amount: 600, paymentMethod: 'pix' } as never)
      }

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(2)
      expect(claimAndSendPendingEventMock).toHaveBeenCalledTimes(1)
    })

    // The enqueue holds the caller's tx and deliberately posts nothing, so the
    // send has to happen out here or the daily cron becomes the only delivery.
    it('sends the Purchase after the transaction commits, never inside it', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      const commit = vi.fn()
      dbMock.transaction.mockImplementationOnce(transactionCommittingWith(tx, commit))
      queuePrepareRows()

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
      expect((enqueueMetaEventMock.mock.calls[0][0] as Record<string, unknown>).tx).toBe(tx.savepoint)

      expect(claimAndSendPendingEventMock).toHaveBeenCalledTimes(1)
      expect(enqueueMetaEventMock.mock.invocationCallOrder[0]).toBeLessThan(
        commit.mock.invocationCallOrder[0],
      )
      expect(commit.mock.invocationCallOrder[0]).toBeLessThan(
        claimAndSendPendingEventMock.mock.invocationCallOrder[0],
      )

      expect(claimAndSendPendingEventMock).toHaveBeenCalledWith({
        id: 'outbox-1',
        tenantId: TENANT,
        prospectId: null,
        patientId: PATIENT_ID,
        eventName: 'Purchase',
        eventId: `purchase:${ENTRY_ID}`,
        eventTime: new Date('2026-01-01T12:00:00.000Z'),
        value: '600.00',
        payload: null,
      })
    })

    it('a failing post-commit send neither fails the payment nor touches the row, which stays pending for the cron', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

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

      claimAndSendPendingEventMock.mockRejectedValueOnce(new Error('graph.facebook.com unreachable'))

      const result = await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 600,
        paymentMethod: 'pix',
      } as never)

      expect(result.installmentPaid).toBe(true)
      expect(result.paymentRecord).toEqual({ id: 'pay-1' })
      expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1)
      expect(reportSideEffectFailureMock.mock.calls[0][1]).toEqual(
        expect.objectContaining({ area: 'meta-capi', step: 'purchase_event_send' }),
      )
      // Only sendPendingEvent moves an outbox row off `pending`, and it threw:
      // the two updates here are the installment and its parent entry.
      expect(tx.update).toHaveBeenCalledTimes(2)
    })

    it('does not resend a Purchase an earlier installment already delivered', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      queueGateSelects(tx, {
        entryStatus: 'paid',
        totalAmount: '600.00',
        queued: queuedPurchaseRow({ status: 'sent' }),
      })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      await recordPayment(TENANT, USER_ID, { installmentId: INSTALLMENT_ID, amount: 600, paymentMethod: 'pix' } as never)

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
      expect(claimAndSendPendingEventMock).not.toHaveBeenCalled()
    })

    it('a payment for a patient with no originating prospect still emits, with prospectId null', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

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
      queuePrepareRows()

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
    })

    it('a renegotiated entry emits nothing', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

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
    })
  })

  // ─── Pool safety: no meta read may run on the global handle under a lock ───

  describe('pool safety', () => {
    it('resolves the prospect and the meta prerequisites before the transaction opens', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

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

      const transactionOrder = dbMock.transaction.mock.invocationCallOrder[0]
      expect(dbMock.select.mock.invocationCallOrder[0]).toBeLessThan(transactionOrder)
      expect(resolveProspectForPatientMock.mock.invocationCallOrder[0]).toBeLessThan(transactionOrder)
      expect(resolveMetaEventPrerequisitesMock.mock.invocationCallOrder[0]).toBeLessThan(transactionOrder)

      const call = enqueueMetaEventMock.mock.calls[0][0] as Record<string, unknown>
      expect(call.prerequisites).toEqual(PREREQUISITES)
    })

    it('resolves once per financial entry, not once per installment, for a twelve-installment payment', async () => {
      const { bulkPayInstallments } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      const installmentIds = Array.from({ length: 12 }, (_, i) => `installment-${i}`)
      queuePrepareRows(
        installmentIds.map(() => ({
          financialEntryId: ENTRY_ID,
          patientId: PATIENT_ID,
          ...patientContactRow,
        })),
      )

      tx.execute.mockResolvedValueOnce(installmentIds.map((id) => ({ id })))
      tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays

      for (const id of installmentIds) {
        tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ id })]))
        tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
        tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
        queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00' })

        tx.insert.mockReturnValueOnce(chain([{ id: `pay-${id}` }]))
        tx.insert.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))
      }

      await bulkPayInstallments(TENANT, USER_ID, { installmentIds, paymentMethod: 'pix' })

      expect(dbMock.select).toHaveBeenCalledTimes(1)
      expect(resolveProspectForPatientMock).toHaveBeenCalledTimes(1)
      expect(resolveMetaEventPrerequisitesMock).toHaveBeenCalledTimes(1)
      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(12)
    })

    // A prepare that never ran must still leave an outbox row behind, so the
    // payment is not silently dropped before the cron can reconcile it.
    it('a failure while preparing the meta context still writes the Purchase, bare', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      dbMock.select.mockImplementationOnce(() => {
        throw new Error('pool exhausted')
      })

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

      const result = await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 600,
        paymentMethod: 'pix',
      } as never)

      expect(result.installmentPaid).toBe(true)
      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
      const call = enqueueMetaEventMock.mock.calls[0][0] as Record<string, unknown>
      expect(call.eventId).toBe(`purchase:${ENTRY_ID}`)
      expect(call.value).toBe('600.00')
      expect(call.prospectId).toBeNull()
      expect(call.patientId).toBeNull()
      expect(call.prerequisites).toBeUndefined()
      expect(call.tx).toBe(tx.savepoint)
      expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1)
      expect(reportSideEffectFailureMock.mock.calls[0][1]).toEqual(
        expect.objectContaining({ area: 'meta-capi', step: 'prepare_purchase_context' }),
      )
    })

    it('one unresolvable patient degrades only its own entry', async () => {
      const { bulkPayInstallments } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      const CONTACT_A = { phone: '+5511900000001', email: 'a@example.com', fullName: 'Patient A' }
      const CONTACT_B = { phone: '+5511900000002', email: 'b@example.com', fullName: 'Patient B' }

      queuePrepareRows([
        { financialEntryId: 'entry-a', patientId: 'patient-a', ...CONTACT_A },
        { financialEntryId: 'entry-b', patientId: 'patient-b', ...CONTACT_B },
      ])
      resolveProspectForPatientMock.mockRejectedValueOnce(new Error('prospect lookup failed'))
      resolveProspectForPatientMock.mockResolvedValueOnce({ id: 'prospect-b' })

      tx.execute.mockResolvedValueOnce([{ id: 'installment-a' }, { id: 'installment-b' }])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))

      for (const [id, entryId] of [
        ['installment-a', 'entry-a'],
        ['installment-b', 'entry-b'],
      ]) {
        tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ id, financialEntryId: entryId })]))
        tx.select.mockReturnValueOnce(chain([{ patientId: 'patient-x', description: 'x' }]))
        tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
        queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00' })

        tx.insert.mockReturnValueOnce(chain([{ id: `pay-${id}` }]))
        tx.insert.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))
      }

      await bulkPayInstallments(TENANT, USER_ID, {
        installmentIds: ['installment-a', 'installment-b'],
        paymentMethod: 'pix',
      })

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(2)
      const [degraded, intact] = enqueueMetaEventMock.mock.calls.map(
        (c) => c[0] as Record<string, unknown>,
      )
      expect(degraded.prospectId).toBeNull()
      expect(degraded.prerequisites).toBeUndefined()
      expect(degraded.patientId).toBe('patient-a')
      expect(degraded.contact).toEqual(CONTACT_A)
      expect(intact.prospectId).toBe('prospect-b')
      expect(intact.prerequisites).toEqual(PREREQUISITES)
      expect(intact.contact).toEqual(CONTACT_B)
    })

    it('a failed prerequisite resolution degrades to a bare row rather than dropping the event', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()
      resolveMetaEventPrerequisitesMock.mockRejectedValueOnce(new Error('connection read failed'))

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

      await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 600,
        paymentMethod: 'pix',
      } as never)

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
      const call = enqueueMetaEventMock.mock.calls[0][0] as Record<string, unknown>
      expect(call.prerequisites).toBeUndefined()
      expect(call.patientId).toBe(PATIENT_ID)
      expect(call.contact).toEqual(patientContactRow)
    })

    it('passes the patient phone to the prerequisite resolution so the opt-out can match on it', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

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

      await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 600,
        paymentMethod: 'pix',
      } as never)

      expect(resolveMetaEventPrerequisitesMock).toHaveBeenCalledWith(TENANT, {
        prospectId: null,
        patientId: PATIENT_ID,
        phone: patientContactRow.phone,
      })
    })
  })

  // ─── An outbox failure costs the advertising event, never the money ───

  describe('outbox failure inside the payment transaction', () => {
    it('leaves the payment committed and successful, and reports the failure', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      const commit = vi.fn()
      dbMock.transaction.mockImplementationOnce(transactionCommittingWith(tx, commit))
      queuePrepareRows()

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00', enqueueFails: true })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      // An oversized event id, a missing migration, a constraint violation:
      // none of them is a reason to discard a patient's payment.
      enqueueMetaEventMock.mockRejectedValueOnce(
        new Error('value too long for type character varying(120)'),
      )

      const result = await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 600,
        paymentMethod: 'pix',
      } as never)

      expect(result.installmentPaid).toBe(true)
      expect(result.paymentRecord).toEqual({ id: 'pay-1' })
      expect(commit).toHaveBeenCalledTimes(1)
      expect(claimAndSendPendingEventMock).not.toHaveBeenCalled()
      expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1)
      expect(reportSideEffectFailureMock.mock.calls[0][1]).toEqual(
        expect.objectContaining({ area: 'meta-capi', step: 'purchase_event_outbox' }),
      )
    })

    it('runs the insert in a savepoint, so the outer transaction keeps the payment writes', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      const commit = vi.fn()
      dbMock.transaction.mockImplementationOnce(transactionCommittingWith(tx, commit))
      queuePrepareRows()

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00', enqueueFails: true })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      enqueueMetaEventMock.mockRejectedValueOnce(new Error('relation does not exist'))

      await recordPayment(TENANT, USER_ID, {
        installmentId: INSTALLMENT_ID,
        amount: 600,
        paymentMethod: 'pix',
      } as never)

      // The failing statement was handed the savepoint handle, not the
      // transaction the payment record and the cash movement were written on.
      expect(tx.transaction).toHaveBeenCalledTimes(1)
      expect((enqueueMetaEventMock.mock.calls[0][0] as Record<string, unknown>).tx).toBe(tx.savepoint)
      expect(tx.insert).toHaveBeenCalledTimes(2)
      expect(tx.update).toHaveBeenCalledTimes(2)
      expect(commit).toHaveBeenCalledTimes(1)
    })

    it('costs one entry its Purchase without rolling back the rest of a bulk payment', async () => {
      const { bulkPayInstallments } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      const ENTRY_A = 'entry-a'
      const ENTRY_B = 'entry-b'

      queuePrepareRows([
        { financialEntryId: ENTRY_A, patientId: 'patient-a', ...patientContactRow },
        { financialEntryId: ENTRY_B, patientId: 'patient-b', ...patientContactRow },
      ])

      tx.execute.mockResolvedValueOnce([{ id: 'installment-a' }, { id: 'installment-b' }])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays

      // Entry A: its outbox insert is the one that fails.
      tx.select.mockReturnValueOnce(
        chain([typedInstallmentRow({ id: 'installment-a', financialEntryId: ENTRY_A })]),
      )
      tx.select.mockReturnValueOnce(chain([{ patientId: 'patient-a', description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00', enqueueFails: true })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-a' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      // Entry B: untouched by A's failure.
      tx.select.mockReturnValueOnce(
        chain([typedInstallmentRow({ id: 'installment-b', financialEntryId: ENTRY_B })]),
      )
      tx.select.mockReturnValueOnce(chain([{ patientId: 'patient-b', description: 'y' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      queueGateSelects(tx, {
        entryStatus: 'paid',
        totalAmount: '600.00',
        queued: queuedPurchaseRow({ id: 'outbox-b', eventId: `purchase:${ENTRY_B}` }),
      })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-b' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      enqueueMetaEventMock.mockRejectedValueOnce(new Error('unique index does not exist'))

      const results = await bulkPayInstallments(TENANT, USER_ID, {
        installmentIds: ['installment-a', 'installment-b'],
        paymentMethod: 'pix',
      })

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.paymentRecord)).toEqual([{ id: 'pay-a' }, { id: 'pay-b' }])
      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(2)
      expect(claimAndSendPendingEventMock).toHaveBeenCalledTimes(1)
      expect((claimAndSendPendingEventMock.mock.calls[0][0] as Record<string, unknown>).eventId).toBe(
        `purchase:${ENTRY_B}`,
      )
      expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1)
    })

    it('still propagates a failure outside the savepoint, which really has aborted the block', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
      queuePrepareRows()

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      // The entry-status gate, read straight off the caller's transaction.
      tx.select.mockImplementationOnce(() => {
        throw new Error('current transaction is aborted')
      })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      await expect(
        recordPayment(TENANT, USER_ID, {
          installmentId: INSTALLMENT_ID,
          amount: 600,
          paymentMethod: 'pix',
        } as never),
      ).rejects.toThrow('current transaction is aborted')

      expect(tx.transaction).not.toHaveBeenCalled()
      expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1)
      expect(reportSideEffectFailureMock.mock.calls[0][1]).toEqual(
        expect.objectContaining({ area: 'meta-capi', step: 'purchase_event' }),
      )
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
      const CONTACT_A = { phone: '+5511900000001', email: 'a@example.com', fullName: 'Patient A' }
      const CONTACT_B = { phone: '+5511900000002', email: 'b@example.com', fullName: 'Patient B' }

      queuePrepareRows([
        { financialEntryId: ENTRY_A, patientId: PATIENT_A, ...CONTACT_A },
        { financialEntryId: ENTRY_B, patientId: PATIENT_B, ...CONTACT_B },
      ])
      resolveProspectForPatientMock.mockResolvedValueOnce({ id: 'prospect-a' })
      resolveProspectForPatientMock.mockResolvedValueOnce({ id: 'prospect-b' })

      tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_A }, { id: INSTALLMENT_B }]) // FOR UPDATE lock
      tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays, before the loop

      // Iteration 1: installment A / entry A
      tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ id: INSTALLMENT_A, financialEntryId: ENTRY_A })])) // row
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_A, description: 'x' }])) // entryInfo
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }])) // updateEntryStatus
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '600.00' })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-a' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      // Iteration 2: installment B / entry B
      tx.select.mockReturnValueOnce(chain([typedInstallmentRow({ id: INSTALLMENT_B, financialEntryId: ENTRY_B })])) // row
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_B, description: 'y' }])) // entryInfo
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '400.00' }])) // updateEntryStatus
      queueGateSelects(tx, { entryStatus: 'paid', totalAmount: '400.00' })

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-b' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      await bulkPayInstallments(TENANT, USER_ID, {
        installmentIds: [INSTALLMENT_A, INSTALLMENT_B],
        paymentMethod: 'pix',
      })

      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(2)
      const calls = enqueueMetaEventMock.mock.calls.map((c) => c[0] as Record<string, unknown>)
      expect(calls.map((c) => c.eventId)).toEqual([`purchase:${ENTRY_A}`, `purchase:${ENTRY_B}`])
      expect(calls.map((c) => c.value)).toEqual(['600.00', '400.00'])
      expect(calls.map((c) => c.prospectId)).toEqual(['prospect-a', 'prospect-b'])
      expect(calls.map((c) => c.contact)).toEqual([CONTACT_A, CONTACT_B])
      expect(calls.every((c) => c.tx === tx.savepoint)).toBe(true)
    })

    it('sends both Purchase events after the single transaction commits', async () => {
      const { bulkPayInstallments } = await import('../financial')
      const tx = makeTx()
      const commit = vi.fn()
      dbMock.transaction.mockImplementationOnce(transactionCommittingWith(tx, commit))

      const INSTALLMENT_A = 'installment-a'
      const INSTALLMENT_B = 'installment-b'
      const ENTRY_A = 'entry-a'
      const ENTRY_B = 'entry-b'

      queuePrepareRows([
        { financialEntryId: ENTRY_A, patientId: 'patient-a', ...patientContactRow },
        { financialEntryId: ENTRY_B, patientId: 'patient-b', ...patientContactRow },
      ])

      tx.execute.mockResolvedValueOnce([{ id: INSTALLMENT_A }, { id: INSTALLMENT_B }])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow])) // getGracePeriodDays

      for (const [installmentId, entryId, outboxId] of [
        [INSTALLMENT_A, ENTRY_A, 'outbox-a'],
        [INSTALLMENT_B, ENTRY_B, 'outbox-b'],
      ]) {
        tx.select.mockReturnValueOnce(
          chain([typedInstallmentRow({ id: installmentId, financialEntryId: entryId })]),
        )
        tx.select.mockReturnValueOnce(chain([{ patientId: 'patient-a', description: 'x' }]))
        tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
        queueGateSelects(tx, {
          entryStatus: 'paid',
          totalAmount: '600.00',
          queued: queuedPurchaseRow({ id: outboxId, eventId: `purchase:${entryId}` }),
        })

        tx.insert.mockReturnValueOnce(chain([{ id: `pay-${installmentId}` }]))
        tx.insert.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))
        tx.update.mockReturnValueOnce(chain(undefined))
      }

      const results = await bulkPayInstallments(TENANT, USER_ID, {
        installmentIds: [INSTALLMENT_A, INSTALLMENT_B],
        paymentMethod: 'pix',
      })

      expect(results).toHaveLength(2)
      expect(dbMock.transaction).toHaveBeenCalledTimes(1)
      expect(claimAndSendPendingEventMock).toHaveBeenCalledTimes(2)
      expect(
        claimAndSendPendingEventMock.mock.calls.map((c) => (c[0] as Record<string, unknown>).id),
      ).toEqual(['outbox-a', 'outbox-b'])
      expect(
        claimAndSendPendingEventMock.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventId),
      ).toEqual([`purchase:${ENTRY_A}`, `purchase:${ENTRY_B}`])

      for (const order of claimAndSendPendingEventMock.mock.invocationCallOrder) {
        expect(commit.mock.invocationCallOrder[0]).toBeLessThan(order)
      }
    })
  })

  // ─── Tenant scoping: application filtering is the boundary ──────────

  describe('tenant scoping', () => {
    it('scopes every meta lookup by tenant', async () => {
      const { recordPayment } = await import('../financial')
      const tx = makeTx()
      dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))

      const whereArgs: unknown[] = []
      const recordingChain = (result: unknown) => {
        const proxy: unknown = new Proxy(
          {},
          {
            get(_t, prop: string) {
              if (prop === 'then') {
                return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
              }
              return (...args: unknown[]) => {
                if (prop === 'where' || prop === 'innerJoin') whereArgs.push(...args)
                return proxy
              }
            },
          },
        )
        return proxy
      }

      dbMock.select.mockReturnValueOnce(
        recordingChain([{ financialEntryId: ENTRY_ID, patientId: PATIENT_ID, ...patientContactRow }]),
      )

      tx.execute.mockResolvedValueOnce([lockedInstallmentRow()])
      tx.select.mockReturnValueOnce(chain([financialSettingsRow]))
      tx.select.mockReturnValueOnce(chain([]))
      tx.select.mockReturnValueOnce(chain([{ patientId: PATIENT_ID, description: 'x' }]))
      tx.select.mockReturnValueOnce(chain([{ status: 'paid', amountPaid: '600.00' }]))
      tx.select.mockReturnValueOnce(
        recordingChain([{ status: 'paid', totalAmount: '600.00' }]),
      )
      tx.select.mockReturnValueOnce(recordingChain([]))
      tx.select.mockReturnValueOnce(recordingChain([queuedPurchaseRow()]))

      tx.insert.mockReturnValueOnce(chain([{ id: 'pay-1' }]))
      tx.insert.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))
      tx.update.mockReturnValueOnce(chain(undefined))

      await recordPayment(TENANT, USER_ID, { installmentId: INSTALLMENT_ID, amount: 600, paymentMethod: 'pix' } as never)

      // Five scoped predicates: the prepare join (installments, entries,
      // patients), both gate selects inside the transaction, and the outbox
      // re-read that decides what is sent after the commit.
      expect(whereArgs.length).toBeGreaterThanOrEqual(5)
      expect(whereArgs.filter((arg) => carriesValue(arg, TENANT)).length).toBeGreaterThanOrEqual(5)
      expect(enqueueMetaEventMock).toHaveBeenCalledTimes(1)
      expect(claimAndSendPendingEventMock).toHaveBeenCalledTimes(1)
    })
  })
})
