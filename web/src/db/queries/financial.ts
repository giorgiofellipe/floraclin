import { db } from '@/db/client'
import {
  financialEntries,
  installments,
  patients,
  procedureRecords,
  procedureTypes,
  appointments,
  paymentRecords,
  cashMovements,
  financialSettings,
  renegotiationLinks,
  expenses,
  expenseInstallments,
  metaConversionEvents,
} from '@/db/schema'
import { eq, and, isNull, sql, count, sum, desc, inArray, notInArray, or, gte, lte } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { startOfBrDay, endOfBrDay, toBrYmd, brToday, shiftBrYmd } from '@/lib/dates'
import { formatCurrency, formatDate } from '@/lib/utils'
import { createAuditLog } from '@/lib/audit'
import {
  replayPayments,
  quoteInstallment,
  isInstallmentOverdue,
  round2,
  type InstallmentBase,
  type ReplayResult,
  type PaymentAllocation,
  type PaymentInput,
} from '@/lib/financial/penalties'
import { BusinessError } from '@/lib/errors'
import type { CreateFinancialEntryInput, FinancialFilterInput, RecordPaymentInput } from '@/validations/financial'
import type { PaymentMethod, FinancialStatus } from '@/types'
import { verifyTenantOwnership } from './helpers'
import {
  cancelCardPaymentTx,
  createCardPaymentTx,
  getCardPaymentSummaries,
  sumCardFeesForPeriod,
} from './card-payments'
import { cardInstallmentCountFor, isCardMethod } from '@/lib/financial/card-repasses'
import {
  claimAndSendPendingEvent,
  enqueueMetaEvent,
  resolveMetaEventPrerequisites,
  type MetaEventPrerequisites,
  type PendingMetaEventRow,
} from '@/lib/meta/events'
import { META_EVENT_MAX_AGE_MS } from '@/db/queries/meta-events'
import { resolveProspectForPatient } from '@/lib/meta/resolve-prospect'
import type { MetaActionSource } from '@/lib/meta/types'
import { reportSideEffectFailure } from '@/lib/observability'

function requireCard(card: RecordPaymentInput['card']): NonNullable<RecordPaymentInput['card']> {
  if (!card) throw new BusinessError('CARD_TERMINAL_REQUIRED', 'Selecione a maquininha')
  return card
}

// ─── CREATE FINANCIAL ENTRY ─────────────────────────────────────────

export async function createFinancialEntry(
  tenantId: string,
  userId: string,
  data: CreateFinancialEntryInput & { cardInstallmentCount?: number },
  txDb?: typeof db
) {
  // Verify foreign IDs belong to this tenant
  await Promise.all([
    verifyTenantOwnership(tenantId, patients, data.patientId, 'Patient'),
    ...(data.procedureRecordId
      ? [verifyTenantOwnership(tenantId, procedureRecords, data.procedureRecordId, 'Procedure record')]
      : []),
    ...(data.appointmentId
      ? [verifyTenantOwnership(tenantId, appointments, data.appointmentId, 'Appointment')]
      : []),
  ])

  const execute = async (tx: typeof db) => {
    const [entry] = await tx
      .insert(financialEntries)
      .values({
        tenantId,
        patientId: data.patientId,
        procedureRecordId: data.procedureRecordId,
        appointmentId: data.appointmentId,
        description: data.description,
        totalAmount: data.totalAmount.toFixed(2),
        installmentCount: data.installmentCount,
        status: 'pending',
        notes: data.notes,
        paymentMethod: data.paymentMethod,
        cardInstallmentCount:
          data.cardInstallmentCount ??
          (data.card && isCardMethod(data.paymentMethod)
            ? cardInstallmentCountFor(data.paymentMethod, data.card.installmentCount)
            : null),
        createdBy: userId,
      })
      .returning()

    const terms = await loadInstallmentTerms(tx, tenantId)
    const installmentAmount = Math.floor((data.totalAmount * 100) / data.installmentCount) / 100
    const remainder = Math.round((data.totalAmount - installmentAmount * data.installmentCount) * 100) / 100
    const today = brToday()

    const installmentRows = Array.from({ length: data.installmentCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      const dueDate = data.customDueDates?.[i] ?? shiftBrYmd(today, i * 30)
      return {
        tenantId,
        financialEntryId: entry.id,
        installmentNumber: i + 1,
        amount: amount.toFixed(2),
        dueDate,
        status: 'pending' as const,
        ...terms,
      }
    })

    const created = await tx
      .insert(installments)
      .values(installmentRows)
      .returning({ id: installments.id, installmentNumber: installments.installmentNumber })

    return {
      ...entry,
      installmentIds: [...created].sort((a, b) => a.installmentNumber - b.installmentNumber).map((r) => r.id),
    }
  }

  if (txDb) {
    return execute(txDb)
  }
  return withTransaction(execute)
}

// ─── META CONVERSIONS: Purchase on payment ──────────────────────────

/**
 * Everything a Purchase event needs that cannot be read from the payment
 * transaction. `prerequisites` is null when the pre-transaction resolution
 * failed: the event still goes to the outbox, just without a payload.
 */
interface MetaPurchaseContext {
  patientId: string
  contact: { phone: string | null; email: string | null; fullName: string | null }
  prospectId: string | null
  prerequisites: MetaEventPrerequisites | null
}

/**
 * Resolved before the payment transaction opens, keyed by financial entry.
 * Every read here runs on the global pool handle, and the pool holds 5
 * connections: five concurrent payments each waiting on a sixth checkout
 * while holding a locked installment row would deadlock the pool outright.
 *
 * Purely an optimisation. Nothing here is allowed to decide whether the event
 * happens, only how much of it can be built up front.
 */
async function prepareMetaPurchaseContexts(
  tenantId: string,
  installmentIds: string[]
): Promise<Map<string, MetaPurchaseContext>> {
  const contexts = new Map<string, MetaPurchaseContext>()
  if (installmentIds.length === 0) return contexts

  try {
    const rows = await db
      .select({
        financialEntryId: installments.financialEntryId,
        patientId: financialEntries.patientId,
        phone: patients.phone,
        email: patients.email,
        fullName: patients.fullName,
      })
      .from(installments)
      .innerJoin(
        financialEntries,
        and(
          eq(financialEntries.id, installments.financialEntryId),
          eq(financialEntries.tenantId, tenantId)
        )
      )
      .innerJoin(
        patients,
        and(eq(patients.id, financialEntries.patientId), eq(patients.tenantId, tenantId))
      )
      .where(and(inArray(installments.id, installmentIds), eq(installments.tenantId, tenantId)))

    for (const row of rows) {
      if (contexts.has(row.financialEntryId)) continue

      const contact = {
        phone: row.phone ?? null,
        email: row.email ?? null,
        fullName: row.fullName ?? null,
      }

      // Per row, so one unresolvable patient costs its own payload and not
      // every other entry in the same bulk payment.
      try {
        const prospect = await resolveProspectForPatient(tenantId, {
          patientId: row.patientId,
          phone: row.phone,
        })
        const prospectId = prospect?.id ?? null

        contexts.set(row.financialEntryId, {
          patientId: row.patientId,
          contact,
          prospectId,
          prerequisites: await resolveMetaEventPrerequisites(tenantId, {
            prospectId,
            patientId: row.patientId,
            phone: row.phone,
          }),
        })
      } catch (error) {
        reportSideEffectFailure(error, { area: 'meta-capi', step: 'prepare_purchase_context' })
        contexts.set(row.financialEntryId, {
          patientId: row.patientId,
          contact,
          prospectId: null,
          prerequisites: null,
        })
      }
    }
  } catch (error) {
    reportSideEffectFailure(error, { area: 'meta-capi', step: 'prepare_purchase_context' })
  }

  return contexts
}

/**
 * Gate 1: only when money actually arrived (entry now paid or partial, not
 * left pending by a short payment). Gate 2: skip a renegotiated entry, since
 * its balance is money already reported as Purchase on the original entry.
 * No "first payment" check: eventId is stable per financial entry, and the
 * outbox's unique index on (tenant_id, event_id) is the once-only guarantee.
 *
 * A missing context is not a reason to skip: without one the row goes in bare
 * and is enriched when it is sent.
 *
 * Returns the outbox row the caller owes a send once its transaction commits,
 * or null when there is nothing to deliver.
 */
async function emitPurchaseEventForEntry(
  tx: typeof db,
  tenantId: string,
  financialEntryId: string,
  eventTime: Date,
  context: MetaPurchaseContext | undefined
): Promise<PendingMetaEventRow | null> {
  try {
    const [entry] = await tx
      .select({
        status: financialEntries.status,
        totalAmount: financialEntries.totalAmount,
      })
      .from(financialEntries)
      .where(and(eq(financialEntries.id, financialEntryId), eq(financialEntries.tenantId, tenantId)))
      .limit(1)

    if (!entry || (entry.status !== 'paid' && entry.status !== 'partial')) {
      return null
    }

    // renegotiation_links has no tenant_id of its own, so the entry it points
    // at is what scopes the lookup.
    const [renegotiated] = await tx
      .select({ id: renegotiationLinks.id })
      .from(renegotiationLinks)
      .innerJoin(
        financialEntries,
        and(
          eq(financialEntries.id, renegotiationLinks.newEntryId),
          eq(financialEntries.tenantId, tenantId)
        )
      )
      .where(eq(renegotiationLinks.newEntryId, financialEntryId))
      .limit(1)

    if (renegotiated) {
      return null
    }

    // eventTime is the payment's own date, and the outbox holds one Purchase
    // per entry: a row Meta will refuse on age would take the slot from the
    // next on-time payment on the same entry.
    if (Date.now() - eventTime.getTime() > META_EVENT_MAX_AGE_MS) {
      return null
    }

    const eventId = `purchase:${financialEntryId}`

    // The outbox insert gets a SAVEPOINT of its own: raised on the caller's
    // transaction instead, a failure here would abort the payment and every
    // other installment in a bulk payment with it.
    let inserted = false
    try {
      await tx.transaction(async (savepoint) => {
        const outcome = await enqueueMetaEvent({
          tenantId,
          eventName: 'Purchase',
          eventId,
          eventTime,
          prospectId: context?.prospectId ?? null,
          patientId: context?.patientId ?? null,
          contact: context?.contact ?? { phone: null, email: null, fullName: null },
          actionSource: 'system_generated',
          value: entry.totalAmount,
          tx: savepoint as unknown as typeof db,
          prerequisites: context?.prerequisites ?? undefined,
        })
        inserted = outcome.inserted
      })
    } catch (error) {
      reportSideEffectFailure(error, { area: 'meta-capi', step: 'purchase_event_outbox' })
      return null
    }

    // The row was already there, so it belongs to whoever wrote it: an
    // earlier installment on the same entry, or the reconciler that may be
    // sending it right now. Picking it up here posts the same Purchase twice.
    if (!inserted) {
      return null
    }

    // Re-read rather than threaded out of the enqueue, which does not return
    // the row: `pending` is the only status that owes a send, and anything
    // else means the insert resolved to skipped on the spot.
    const [queued] = await tx
      .select({
        id: metaConversionEvents.id,
        prospectId: metaConversionEvents.prospectId,
        patientId: metaConversionEvents.patientId,
        eventId: metaConversionEvents.eventId,
        eventTime: metaConversionEvents.eventTime,
        value: metaConversionEvents.value,
        actionSource: metaConversionEvents.actionSource,
        payload: metaConversionEvents.payload,
        status: metaConversionEvents.status,
      })
      .from(metaConversionEvents)
      .where(
        and(eq(metaConversionEvents.tenantId, tenantId), eq(metaConversionEvents.eventId, eventId))
      )
      .limit(1)

    if (!queued || queued.status !== 'pending') {
      return null
    }

    return {
      id: queued.id,
      tenantId,
      prospectId: queued.prospectId,
      patientId: queued.patientId,
      eventName: 'Purchase',
      eventId: queued.eventId,
      eventTime: queued.eventTime,
      value: queued.value,
      actionSource: queued.actionSource as MetaActionSource | null,
      payload: queued.payload,
    }
  } catch (error) {
    // Postgres has already aborted the caller's transaction, so swallowing
    // this would answer 201 for a payment that silently rolled back.
    reportSideEffectFailure(error, { area: 'meta-capi', step: 'purchase_event' })
    throw error
  }
}

/**
 * Sends the Purchase rows a payment just wrote, after its transaction has
 * committed. Inline delivery is what keeps a Purchase off the once-a-day
 * meta-events cron, and `enqueueMetaEvent` deliberately refuses to post while
 * it holds the caller's `tx`, so this is the only place the send can happen.
 *
 * Nothing here may surface: the money is already durable. A failed send
 * leaves the row `pending` and the cron delivers it.
 */
async function deliverPurchaseEvents(rows: PendingMetaEventRow[]): Promise<void> {
  for (const row of rows) {
    try {
      await claimAndSendPendingEvent(row)
    } catch (error) {
      reportSideEffectFailure(error, { area: 'meta-capi', step: 'purchase_event_send' })
    }
  }
}

// ─── RECORD PAYMENT ────────────────────────────────────────────────

type LivePaymentRow = typeof paymentRecords.$inferSelect
type LivePayments = Awaited<ReturnType<typeof loadLivePayments>>

export async function loadLivePayments(tx: typeof db, installmentId: string) {
  const rows = await tx
    .select()
    .from(paymentRecords)
    .where(
      and(
        eq(paymentRecords.installmentId, installmentId),
        isNull(paymentRecords.reversedAt)
      )
    )
    .orderBy(paymentRecords.paidAt, paymentRecords.recordedAt)

  return { rows, inputs: toPaymentInputs(rows) }
}

/**
 * Payments on an installment are recorded in date order: one dated before a
 * later payment would re-split what that payment already settled. Interest
 * accrues per BR day, so a payment on the latest payment's own day is moved to
 * that payment's instant and replays after it.
 */
export async function paymentDateAfterLivePayments(
  tx: typeof db,
  tenantId: string,
  installment: { installmentNumber: number; financialEntryId: string },
  rows: Pick<LivePaymentRow, 'paidAt'>[],
  paidAt: Date,
): Promise<Date> {
  const latest = rows[rows.length - 1]
  if (!latest) return paidAt

  const latestPaidAt = new Date(latest.paidAt)
  if (paidAt.getTime() >= latestPaidAt.getTime()) return paidAt
  if (toBrYmd(paidAt) === toBrYmd(latestPaidAt)) return latestPaidAt

  const [entry] = await tx
    .select({ description: financialEntries.description, patientName: patients.fullName })
    .from(financialEntries)
    .innerJoin(patients, eq(patients.id, financialEntries.patientId))
    .where(
      and(
        eq(financialEntries.id, installment.financialEntryId),
        eq(financialEntries.tenantId, tenantId)
      )
    )
    .limit(1)

  const which = entry
    ? `parcela ${installment.installmentNumber} de ${entry.description} (${entry.patientName})`
    : `parcela ${installment.installmentNumber}`
  throw new BusinessError(
    'PAYMENT_BEFORE_LATER_PAYMENT',
    `Já existe um pagamento em ${formatDate(toBrYmd(latestPaidAt))} na ${which}. Registre pagamentos a partir dessa data.`,
  )
}

const NEW_PAYMENT_ID = '__new__'

/** Replays the installment with the new payment last. */
function priceNewPayment(input: {
  base: InstallmentBase
  livePayments: LivePayments
  amount: number
  paidAt: Date
  now: Date
}) {
  const { base, livePayments, amount, paidAt, now } = input

  const replay = replayPayments(
    base,
    [
      ...livePayments.inputs,
      { id: NEW_PAYMENT_ID, amount, paidAt: paidAt.toISOString(), recordedAt: now.toISOString() },
    ],
    now,
  )

  const newPayment = replay.payments.find((p) => p.id === NEW_PAYMENT_ID)!
  const allocation: PaymentAllocation = {
    interestCovered: newPayment.interestCovered,
    fineCovered: newPayment.fineCovered,
    principalCovered: newPayment.principalCovered,
    excessAmount: newPayment.excessAmount,
  }

  return { allocation, replay }
}

interface PaymentSplit {
  interestCovered: number
  fineCovered: number
  principalCovered: number
}

interface SplitChange {
  id: string
  old: PaymentSplit
  new: PaymentSplit
}

type PersistCause =
  | { cause: 'payment'; newPayment: { paidAt: Date; paymentMethod: string } }
  | { cause: 'reversal'; keepCancelled: boolean }

function sameSplit(a: PaymentSplit, b: PaymentSplit): boolean {
  return (
    toCents(a.interestCovered) === toCents(b.interestCovered) &&
    toCents(a.fineCovered) === toCents(b.fineCovered) &&
    toCents(a.principalCovered) === toCents(b.principalCovered)
  )
}

/** The audit entry for the stored splits a write changed, if it changed any. */
function splitChangesAudit(changes: SplitChange[]): Record<string, { old: unknown; new: unknown }> {
  if (changes.length === 0) return {}
  return {
    paymentSplits: {
      old: changes.map((c) => ({ id: c.id, ...c.old })),
      new: changes.map((c) => ({ id: c.id, ...c.new })),
    },
  }
}

/**
 * A renegotiation or a cancel took the entry out of collection. A payment or a
 * reversal on one of its installments corrects the cash record, not that
 * decision, so the entry status is left alone.
 */
function isOutOfCollection(entryStatus: string | undefined): boolean {
  return entryStatus === 'renegotiated' || entryStatus === 'cancelled'
}

/**
 * Writes what a replay of an installment's live payments concluded: the split
 * of every stored payment the replay disagrees with, the installment, then the
 * entry status. A new payment leaves an open installment's settlement fields
 * alone; a reversal clears them and keeps a cancel in place.
 */
async function persistReplay(
  tx: typeof db,
  tenantId: string,
  input: {
    installment: { id: string; financialEntryId: string; amount: number }
    replay: ReplayResult
    storedPayments: LivePaymentRow[]
    updateEntryStatus: boolean
  } & PersistCause,
): Promise<{ isPaid: boolean; splitChanges: SplitChange[] }> {
  const { installment, replay, storedPayments } = input

  const splitChanges: SplitChange[] = []
  for (const replayed of replay.payments) {
    const stored = storedPayments.find((p) => p.id === replayed.id)
    if (!stored) continue
    const before: PaymentSplit = {
      interestCovered: Number(stored.interestCovered),
      fineCovered: Number(stored.fineCovered),
      principalCovered: Number(stored.principalCovered),
    }
    const after: PaymentSplit = {
      interestCovered: replayed.interestCovered,
      fineCovered: replayed.fineCovered,
      principalCovered: replayed.principalCovered,
    }
    if (sameSplit(before, after)) continue
    await tx
      .update(paymentRecords)
      .set({
        interestCovered: after.interestCovered.toFixed(2),
        fineCovered: after.fineCovered.toFixed(2),
        principalCovered: after.principalCovered.toFixed(2),
      })
      .where(eq(paymentRecords.id, stored.id))
    splitChanges.push({ id: stored.id, old: before, new: after })
  }

  const state = replay.installmentState
  const isPaid =
    replay.payments.length > 0 &&
    state.amountPaid >= installment.amount &&
    state.fineAmount <= 0 &&
    state.interestAmount <= 0

  // The settling payment is the last one that allocated anything: once the
  // debt is settled every later payment allocates nothing.
  const settledBy = isPaid
    ? ([...replay.payments]
        .reverse()
        .find((p) => p.interestCovered + p.fineCovered + p.principalCovered > 0) ??
      replay.payments[replay.payments.length - 1])
    : undefined
  const settledByRow =
    settledBy &&
    (settledBy.id === NEW_PAYMENT_ID && input.cause === 'payment'
      ? input.newPayment
      : storedPayments.find((p) => p.id === settledBy.id))
  const openSettlement = input.cause === 'reversal' ? null : undefined

  const keepCancelled = input.cause === 'reversal' && input.keepCancelled
  const status = keepCancelled ? 'cancelled' : isPaid ? 'paid' : 'pending'

  await tx
    .update(installments)
    .set({
      amountPaid: replay.payments.length === 0 ? '0' : state.amountPaid.toFixed(2),
      status,
      paidAt: settledByRow ? new Date(settledByRow.paidAt) : openSettlement,
      paymentMethod: settledByRow ? (settledByRow.paymentMethod as PaymentMethod) : openSettlement,
      updatedAt: new Date(),
    })
    .where(eq(installments.id, installment.id))

  if (input.updateEntryStatus) {
    await updateEntryStatus(tx, tenantId, installment.financialEntryId)
  }

  return { isPaid, splitChanges }
}

export async function recordPayment(
  tenantId: string,
  userId: string,
  data: RecordPaymentInput
) {
  const metaContexts = await prepareMetaPurchaseContexts(tenantId, [data.installmentId])

  const { purchase, ...result } = await withTransaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(installments)
      .where(and(eq(installments.id, data.installmentId), eq(installments.tenantId, tenantId)))
      .for('update')

    if (!row) {
      throw new BusinessError('INSTALLMENT_NOT_FOUND', 'Parcela não encontrada ou não pertence a esta clínica')
    }

    if (row.status === 'paid') {
      throw new BusinessError('INSTALLMENT_ALREADY_PAID', 'Parcela já está totalmente paga')
    }

    if (row.status === 'cancelled') {
      throw new BusinessError('INSTALLMENT_CANCELLED', 'Parcela cancelada não pode receber pagamento')
    }

    const financialEntryId = row.financialEntryId
    const [entry] = await tx
      .select({
        status: financialEntries.status,
        patientId: financialEntries.patientId,
        description: financialEntries.description,
      })
      .from(financialEntries)
      .where(and(eq(financialEntries.id, financialEntryId), eq(financialEntries.tenantId, tenantId)))
      .for('update')

    // Captured behind the lock so recordedAt reflects the order payments were
    // actually applied in, and reused for the persisted state so a backdated
    // payment does not freeze the installment's interest at its own date. A
    // payment cannot have happened after it was recorded, so paidAt is capped.
    const now = new Date()
    const requestedPaidAt = data.paidAt
      ? new Date(Math.min(new Date(data.paidAt).getTime(), now.getTime()))
      : now
    const livePayments = await loadLivePayments(tx, data.installmentId)
    const paidAt = await paymentDateAfterLivePayments(
      tx,
      tenantId,
      row,
      livePayments.rows,
      requestedPaidAt,
    )

    const base = toInstallmentBase(row)

    // Same pricer as the quote endpoint, so an unchanged balance always
    // matches what the dialog prefilled from.
    const totalDue = quoteInstallment(base, livePayments.inputs, paidAt).totalDue
    if (toCents(totalDue) !== toCents(data.expectedTotalDue)) {
      throw new BusinessError(
        'QUOTE_CHANGED',
        'O total pendente mudou desde que a tela foi aberta. Confira o novo valor e confirme novamente.',
      )
    }
    if (toCents(data.amount) > toCents(totalDue) && data.acceptOverpayment !== true) {
      throw new BusinessError(
        'OVERPAYMENT_NOT_CONFIRMED',
        `O valor informado é maior que o total pendente de ${formatCurrency(totalDue)}. Confirme o pagamento acima do devido para registrá-lo.`,
      )
    }

    const { allocation: paymentAllocation, replay } = priceNewPayment({
      base,
      livePayments,
      amount: data.amount,
      paidAt,
      now,
    })

    // The row stores the cash received, not the cash allocated. Anything above
    // the total due is visible as the gap between the two and is not applied
    // to any other charge.
    const [paymentRecord] = await tx
      .insert(paymentRecords)
      .values({
        installmentId: data.installmentId,
        amount: data.amount.toFixed(2),
        paymentMethod: data.paymentMethod,
        interestCovered: paymentAllocation.interestCovered.toFixed(2),
        fineCovered: paymentAllocation.fineCovered.toFixed(2),
        principalCovered: paymentAllocation.principalCovered.toFixed(2),
        paidAt,
        recordedAt: now,
        recordedBy: userId,
        notes: data.notes,
      })
      .returning()

    if (isCardMethod(data.paymentMethod)) {
      const card = requireCard(data.card)
      const { cardPaymentId } = await createCardPaymentTx(tx, tenantId, userId, {
        terminalId: card.terminalId,
        method: data.paymentMethod,
        installmentCount: card.installmentCount,
        expectedRate: card.expectedRate,
        gross: data.amount,
        paidAt,
        patientId: entry.patientId,
        description: entry.description,
      })
      await tx.update(paymentRecords).set({ cardPaymentId }).where(eq(paymentRecords.id, paymentRecord.id))
    } else {
      await tx.insert(cashMovements).values({
        tenantId,
        type: 'inflow',
        amount: data.amount.toFixed(2),
        description: `Pagamento: ${entry?.description ?? 'Cobranca'}`,
        paymentMethod: data.paymentMethod,
        movementDate: paidAt,
        paymentRecordId: paymentRecord.id,
        patientId: entry?.patientId,
        recordedBy: userId,
      })
    }

    const { isPaid, splitChanges } = await persistReplay(tx, tenantId, {
      cause: 'payment',
      newPayment: { paidAt, paymentMethod: data.paymentMethod },
      installment: { id: data.installmentId, financialEntryId, amount: base.amount },
      replay,
      storedPayments: livePayments.rows,
      updateEntryStatus: !isOutOfCollection(entry?.status),
    })

    const purchase = await emitPurchaseEventForEntry(
      tx,
      tenantId,
      financialEntryId,
      paidAt,
      metaContexts.get(financialEntryId)
    )

    await createAuditLog({
      tenantId,
      userId,
      action: 'update',
      entityType: 'installment',
      entityId: data.installmentId,
      changes: {
        payment: {
          old: null,
          new: {
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            requestedPaidAt: data.paidAt ?? null,
            paidAt: paidAt.toISOString(),
            allocation: paymentAllocation,
          },
        },
        ...splitChangesAudit(splitChanges),
      },
    }, tx)

    return {
      paymentRecord,
      allocation: paymentAllocation,
      installmentPaid: isPaid,
      purchase,
    }
  })

  await deliverPurchaseEvents(purchase ? [purchase] : [])

  return result
}

// ─── REVERSE PAYMENT ───────────────────────────────────────────────

export async function reversePayment(
  tenantId: string,
  userId: string,
  paymentRecordId: string,
  reason?: string
) {
  return withTransaction(async (tx) => {
    const [pr] = await tx
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.id, paymentRecordId))
      .limit(1)

    if (!pr) {
      throw new BusinessError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado')
    }

    // A card payment may group several records (bulk pay). The card is one
    // transaction, so reversing any of them reverses all of them.
    const records = pr.cardPaymentId
      ? await tx.select().from(paymentRecords).where(eq(paymentRecords.cardPaymentId, pr.cardPaymentId))
      : [pr]

    // Both recordPayment and reversePayment rewrite payment records behind
    // this lock, so taking it here too serializes the two paths instead of
    // letting them deadlock on each other's row updates. It is also the
    // tenant check: the payment record carries no tenant of its own. Ordered
    // by id, like bulkPayInstallments, so overlapping batches lock in one order.
    const lockedInstallments = await tx
      .select({
        id: installments.id,
        financialEntryId: installments.financialEntryId,
        status: installments.status,
        amount: installments.amount,
        dueDate: installments.dueDate,
        appliedFineType: installments.appliedFineType,
        appliedFineValue: installments.appliedFineValue,
        appliedInterestRate: installments.appliedInterestRate,
        appliedGracePeriodDays: installments.appliedGracePeriodDays,
        penaltyPauses: installments.penaltyPauses,
        cancelledAt: installments.cancelledAt,
      })
      .from(installments)
      .where(
        and(
          inArray(installments.id, [...new Set(records.map((r) => r.installmentId))]),
          eq(installments.tenantId, tenantId),
        ),
      )
      .orderBy(installments.id)
      .for('update')
    const installmentById = new Map(lockedInstallments.map((i) => [i.id, i]))

    if (records.some((r) => !installmentById.has(r.installmentId))) {
      // Same message as a missing record: a distinct one would let a caller
      // probe whether a payment id exists in another clinic.
      throw new BusinessError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado')
    }

    const lockedEntries = await tx
      .select({
        id: financialEntries.id,
        status: financialEntries.status,
        patientId: financialEntries.patientId,
        description: financialEntries.description,
      })
      .from(financialEntries)
      .where(
        and(
          inArray(financialEntries.id, [...new Set(lockedInstallments.map((i) => i.financialEntryId))]),
          eq(financialEntries.tenantId, tenantId),
        ),
      )
      .orderBy(financialEntries.id)
      .for('update')
    const entryById = new Map(lockedEntries.map((e) => [e.id, e]))

    const card = pr.cardPaymentId ? await cancelCardPaymentTx(tx, tenantId, userId, pr.cardPaymentId) : undefined

    for (const record of records) {
      const inst = installmentById.get(record.installmentId)!
      const entry = entryById.get(inst.financialEntryId)

      // Re-read behind the lock rather than trusting the copy loaded above: two
      // concurrent reversals both read an active payment, and the loser would
      // otherwise go on to write a second outflow for the same money.
      const [locked] = await tx
        .select({ reversedAt: paymentRecords.reversedAt })
        .from(paymentRecords)
        .where(eq(paymentRecords.id, record.id))
        .limit(1)

      if (locked?.reversedAt) {
        if (record.id === paymentRecordId) {
          throw new BusinessError('PAYMENT_ALREADY_REVERSED', 'Pagamento já foi estornado')
        }
        continue
      }

      await tx
        .update(paymentRecords)
        .set({
          reversedAt: new Date(),
          reversedBy: userId,
          reversalReason: reason ?? null,
        })
        .where(eq(paymentRecords.id, record.id))

      if (!card) {
        const [outflow] = await tx
          .insert(cashMovements)
          .values({
            tenantId,
            type: 'outflow',
            amount: record.amount,
            description: `Estorno: ${entry?.description ?? 'Pagamento'}${reason ? ` — ${reason}` : ''}`,
            paymentMethod: record.paymentMethod as PaymentMethod,
            movementDate: new Date(),
            patientId: entry?.patientId,
            recordedBy: userId,
          })
          .returning({ id: cashMovements.id })

        await tx
          .update(cashMovements)
          .set({ reversedByMovementId: outflow.id })
          .where(
            and(
              eq(cashMovements.tenantId, tenantId),
              eq(cashMovements.paymentRecordId, record.id),
              eq(cashMovements.type, 'inflow'),
            ),
          )
      }

      const remaining = await loadLivePayments(tx, inst.id)
      // Captured behind the lock, the same way the write paths do it.
      const now = new Date()
      const base = toInstallmentBase(inst)

      const { splitChanges } = await persistReplay(tx, tenantId, {
        cause: 'reversal',
        // A renegotiation or a cancel already took this installment out of
        // collection. Reversing corrects the cash record, not that decision.
        keepCancelled: inst.status === 'cancelled',
        updateEntryStatus: !isOutOfCollection(entry?.status),
        installment: { id: inst.id, financialEntryId: inst.financialEntryId, amount: base.amount },
        replay: replayPayments(base, remaining.inputs, now),
        storedPayments: remaining.rows,
      })

      await createAuditLog({
        tenantId,
        userId,
        action: 'update',
        entityType: 'payment_record',
        entityId: record.id,
        changes: {
          action: { old: 'active', new: 'reversed' },
          amount: { old: record.amount, new: '0' },
          reason: { old: null, new: reason ?? null },
          ...splitChangesAudit(splitChanges),
        },
      }, tx)
    }

    return card ? { success: true, card } : { success: true }
  })
}

// ─── BULK PAY INSTALLMENTS ──────────────────────────────────────────

export async function bulkPayInstallments(
  tenantId: string,
  userId: string,
  data: { installmentIds: string[]; paymentMethod: string; paidAt?: string; card?: RecordPaymentInput['card'] }
) {
  const metaContexts = await prepareMetaPurchaseContexts(tenantId, data.installmentIds)

  const { results, purchases } = await withTransaction(async (tx) => {
    // ORDER BY id so this and renegotiation acquire overlapping rows in one
    // order instead of deadlocking on each other.
    const lockedRows = await tx
      .select({ id: installments.id, financialEntryId: installments.financialEntryId })
      .from(installments)
      .where(
        and(
          inArray(installments.id, data.installmentIds),
          eq(installments.tenantId, tenantId),
          notInArray(installments.status, ['paid', 'cancelled'])
        )
      )
      .orderBy(installments.id)
      .for('update')

    const lockedIds = lockedRows.map((r) => r.id)
    const missingIds = data.installmentIds.filter((id) => !lockedIds.includes(id))
    if (missingIds.length > 0) {
      throw new BusinessError(
        'INSTALLMENTS_NOT_PAYABLE',
        `Parcelas não encontradas ou já pagas/canceladas: ${missingIds.join(', ')}`
      )
    }

    // The loop writes each entry once per installment, in the order the
    // caller listed them. Two batches over the same entries in different
    // orders would each hold one entry row while waiting for the other.
    const entries = await tx
      .select({
        id: financialEntries.id,
        status: financialEntries.status,
        patientId: financialEntries.patientId,
        description: financialEntries.description,
      })
      .from(financialEntries)
      .where(
        and(
          inArray(financialEntries.id, [...new Set(lockedRows.map((r) => r.financialEntryId))]),
          eq(financialEntries.tenantId, tenantId)
        )
      )
      .orderBy(financialEntries.id)
      .for('update')
    const entryById = new Map(entries.map((e) => [e.id, e]))

    const cardMethod = isCardMethod(data.paymentMethod) ? data.paymentMethod : undefined
    const card = cardMethod ? requireCard(data.card) : undefined
    if (card && new Set(entries.map((e) => e.patientId)).size > 1) {
      throw new BusinessError(
        'CARD_BULK_MULTIPLE_PATIENTS',
        'Pagamento em cartão deve ser de um único paciente',
      )
    }

    // One instant for the whole batch, behind the lock; see recordPayment.
    const now = new Date()
    const requestedPaidAt = data.paidAt
      ? new Date(Math.min(new Date(data.paidAt).getTime(), now.getTime()))
      : now

    const results = []
    const purchases: PendingMetaEventRow[] = []
    const cardRecords: { id: string; amountCents: number; paidAt: Date }[] = []
    for (const installmentId of data.installmentIds) {
      const [row] = await tx
        .select()
        .from(installments)
        .where(
          and(
            eq(installments.id, installmentId),
            eq(installments.tenantId, tenantId)
          )
        )
        .limit(1)

      if (!row) continue

      const livePayments = await loadLivePayments(tx, installmentId)
      const paidAt = await paymentDateAfterLivePayments(
        tx,
        tenantId,
        row,
        livePayments.rows,
        requestedPaidAt,
      )

      const base = toInstallmentBase(row)
      const totalDue = quoteInstallment(base, livePayments.inputs, paidAt).totalDue
      if (totalDue <= 0) continue

      const { allocation: applied, replay } = priceNewPayment({
        base,
        livePayments,
        amount: totalDue,
        paidAt,
        now,
      })
      const { excessAmount: _excess, ...allocation } = applied

      const [paymentRecord] = await tx
        .insert(paymentRecords)
        .values({
          installmentId,
          amount: totalDue.toFixed(2),
          paymentMethod: data.paymentMethod,
          interestCovered: allocation.interestCovered.toFixed(2),
          fineCovered: allocation.fineCovered.toFixed(2),
          principalCovered: allocation.principalCovered.toFixed(2),
          paidAt,
          recordedAt: now,
          recordedBy: userId,
        })
        .returning()

      const entry = entryById.get(row.financialEntryId)
      if (card) {
        cardRecords.push({ id: paymentRecord.id, amountCents: toCents(totalDue), paidAt })
      } else {
        await tx.insert(cashMovements).values({
          tenantId,
          type: 'inflow',
          amount: totalDue.toFixed(2),
          description: `Pagamento: ${entry?.description ?? 'Cobranca'}`,
          paymentMethod: data.paymentMethod,
          movementDate: paidAt,
          paymentRecordId: paymentRecord.id,
          patientId: entry?.patientId,
          recordedBy: userId,
        })
      }

      const { splitChanges } = await persistReplay(tx, tenantId, {
        cause: 'payment',
        newPayment: { paidAt, paymentMethod: data.paymentMethod },
        installment: { id: installmentId, financialEntryId: row.financialEntryId, amount: base.amount },
        replay,
        storedPayments: livePayments.rows,
        updateEntryStatus: !isOutOfCollection(entry?.status),
      })

      const purchase = await emitPurchaseEventForEntry(
        tx,
        tenantId,
        row.financialEntryId,
        paidAt,
        metaContexts.get(row.financialEntryId)
      )
      if (purchase) purchases.push(purchase)

      await createAuditLog({
        tenantId,
        userId,
        action: 'update',
        entityType: 'installment',
        entityId: installmentId,
        changes: {
          payment: {
            old: null,
            new: {
              amount: totalDue,
              paymentMethod: data.paymentMethod,
              requestedPaidAt: data.paidAt ?? null,
              paidAt: paidAt.toISOString(),
              allocation,
            },
          },
          bulkPay: { old: null, new: { installmentIds: data.installmentIds } },
          ...splitChangesAudit(splitChanges),
        },
      }, tx)

      results.push({ installmentId, paymentRecord, allocation })
    }

    if (card && cardMethod && cardRecords.length > 0) {
      const { cardPaymentId } = await createCardPaymentTx(tx, tenantId, userId, {
        terminalId: card.terminalId,
        method: cardMethod,
        installmentCount: card.installmentCount,
        expectedRate: card.expectedRate,
        gross: cardRecords.reduce((sum, r) => sum + r.amountCents, 0) / 100,
        paidAt: new Date(Math.max(...cardRecords.map((r) => r.paidAt.getTime()))),
        patientId: entries[0].patientId,
        description: entries.length === 1 ? entries[0].description : `Pagamento de ${cardRecords.length} parcelas`,
      })
      await tx
        .update(paymentRecords)
        .set({ cardPaymentId })
        .where(inArray(paymentRecords.id, cardRecords.map((r) => r.id)))
    }

    return { results, purchases }
  })

  await deliverPurchaseEvents(purchases)

  return results
}

// ─── BULK CANCEL ENTRIES ────────────────────────────────────────────

export async function bulkCancelEntries(
  tenantId: string,
  userId: string,
  data: { entryIds: string[]; reason: string }
) {
  return withTransaction(async (tx) => {
    // Verify all entries belong to tenant
    const entries = await tx
      .select({ id: financialEntries.id, status: financialEntries.status })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          inArray(financialEntries.id, data.entryIds),
          isNull(financialEntries.deletedAt)
        )
      )

    if (entries.length !== data.entryIds.length) {
      const foundIds = entries.map((e) => e.id)
      const missing = data.entryIds.filter((id) => !foundIds.includes(id))
      throw new BusinessError('ENTRY_NOT_FOUND', `Cobranças não encontradas: ${missing.join(', ')}`)
    }

    const now = new Date()

    // Check if any entries are from renegotiation — need to revert originals
    const renegLinks = await tx
      .select()
      .from(renegotiationLinks)
      .where(inArray(renegotiationLinks.newEntryId, data.entryIds))

    // Group links by the renegotiated entry being cancelled
    const linksByNewEntry = new Map<string, typeof renegLinks>()
    for (const link of renegLinks) {
      const list = linksByNewEntry.get(link.newEntryId) ?? []
      list.push(link)
      linksByNewEntry.set(link.newEntryId, list)
    }

    // Installments first, ORDER BY id: the order recordPayment and
    // renegotiateCharges lock in. Taking the entry rows first here would let a
    // concurrent payment and this cancel each hold one row while waiting for
    // the other. The originals' installments are restored below, so they are
    // part of the same lock.
    const lockedEntryIds = [...new Set([...data.entryIds, ...renegLinks.map((l) => l.originalEntryId)])]
    await lockInstallmentsOfEntries(tx, tenantId, lockedEntryIds)

    // Revert original entries that were renegotiated into the entries being cancelled
    if (renegLinks.length > 0) {
      const originalEntryIds = [...new Set(renegLinks.map((l) => l.originalEntryId))]

      // Restore original entries: renegotiated → pending (or partial if they had payments)
      for (const originalId of originalEntryIds) {
        // Check if original has any paid installments
        const originalInstallments = await tx
          .select({ status: installments.status, amountPaid: installments.amountPaid })
          .from(installments)
          .where(eq(installments.financialEntryId, originalId))

        const hasPaidInstallments = originalInstallments.some((i) => i.status === 'paid')
        const hasPartialPayments = originalInstallments.some((i) => Number(i.amountPaid ?? 0) > 0)

        await reactivateCancelledInstallments(tx, tenantId, [originalId], now)

        // Determine correct status for original entry
        let restoredStatus: string = 'pending'
        if (hasPaidInstallments && !originalInstallments.every((i) => i.status === 'paid')) {
          restoredStatus = 'partial'
        } else if (hasPaidInstallments) {
          restoredStatus = 'paid'
        } else if (hasPartialPayments) {
          restoredStatus = 'partial'
        }

        await tx
          .update(financialEntries)
          .set({
            status: restoredStatus,
            renegotiatedAt: null,
            updatedAt: now,
          })
          .where(eq(financialEntries.id, originalId))

        await createAuditLog({
          tenantId,
          userId,
          action: 'update',
          entityType: 'financial_entry',
          entityId: originalId,
          changes: {
            status: { old: 'renegotiated', new: restoredStatus },
            reason: { old: null, new: `Renegociação cancelada: ${data.reason}` },
          },
        }, tx)
      }

      // Clean up renegotiation links
      await tx
        .delete(renegotiationLinks)
        .where(inArray(renegotiationLinks.newEntryId, data.entryIds))
    }

    // Cancel the entries themselves
    await tx
      .update(financialEntries)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          inArray(financialEntries.id, data.entryIds)
        )
      )

    // Cancel only unpaid installments (preserve paid ones)
    await tx
      .update(installments)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(installments.tenantId, tenantId),
          inArray(installments.financialEntryId, data.entryIds),
          inArray(installments.status, ['pending'])
        )
      )

    // Create audit logs for cancelled entries
    for (const entryId of data.entryIds) {
      await createAuditLog(
        {
          tenantId,
          userId,
          action: 'update',
          entityType: 'financial_entry',
          entityId: entryId,
          changes: {
            status: { old: entries.find((e) => e.id === entryId)?.status ?? 'pending', new: 'cancelled' },
            reason: { old: null, new: data.reason },
            revertedOriginals: {
              old: null,
              new: renegLinks.length > 0
                ? renegLinks.map((l) => l.originalEntryId)
                : null,
            },
          },
        },
        tx
      )
    }

    return {
      cancelledCount: data.entryIds.length,
      revertedCount: renegLinks.length > 0 ? [...new Set(renegLinks.map((l) => l.originalEntryId))].length : 0,
    }
  })
}

/**
 * Cancels the live financial entries of a procedure and their pending
 * installments. An entry already cancelled or renegotiated is left as it is.
 */
export async function cancelLinkedFinancials(
  tx: typeof db,
  tenantId: string,
  userId: string,
  procedureRecordId: string,
  reason: string,
): Promise<void> {
  const linked = await tx
    .select({ id: financialEntries.id })
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.procedureRecordId, procedureRecordId),
        eq(financialEntries.tenantId, tenantId),
        isNull(financialEntries.deletedAt),
      ),
    )
  if (linked.length === 0) return
  const linkedIds = linked.map((e) => e.id)

  // Installments first, then the entry status read: a payment or renegotiation
  // committing in between would otherwise be overwritten from a stale read.
  const lockedInstallments = await lockInstallmentsOfEntries(tx, tenantId, linkedIds)

  const entries = await tx
    .select({ id: financialEntries.id, status: financialEntries.status })
    .from(financialEntries)
    .where(and(inArray(financialEntries.id, linkedIds), eq(financialEntries.tenantId, tenantId)))

  const cancelled = entries.filter((e) => !isOutOfCollection(e.status))
  if (cancelled.length === 0) return

  const cancelledIds = new Set(cancelled.map((e) => e.id))
  const pendingInstallmentIds = lockedInstallments
    .filter((i) => cancelledIds.has(i.financialEntryId) && i.status === 'pending')
    .map((i) => i.id)
  const now = new Date()

  await tx
    .update(financialEntries)
    .set({ status: 'cancelled', updatedAt: now })
    .where(and(inArray(financialEntries.id, [...cancelledIds]), eq(financialEntries.tenantId, tenantId)))

  if (pendingInstallmentIds.length > 0) {
    await tx
      .update(installments)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(and(inArray(installments.id, pendingInstallmentIds), eq(installments.tenantId, tenantId)))
  }

  for (const entry of cancelled) {
    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'update',
        entityType: 'financial_entry',
        entityId: entry.id,
        changes: {
          status: { old: entry.status, new: 'cancelled' },
          reason: { old: null, new: reason },
        },
      },
      tx
    )
  }
}

/**
 * Reverses `bulkCancelEntries`. Statuses are recomputed by `updateEntryStatus`
 * rather than restored from a stored value, so a charge that had a payment
 * before it was cancelled comes back `partial`, not `pending`.
 */
export async function uncancelEntries(
  tenantId: string,
  userId: string,
  data: { entryIds: string[]; reason: string }
) {
  return withTransaction(async (tx) => {
    // The same installment lock, in the same order, as bulkCancelEntries and
    // the payment paths, taken before the status read: a cancel or payment
    // committing in between would otherwise be overwritten from a stale read.
    await lockInstallmentsOfEntries(tx, tenantId, data.entryIds)

    const entries = await tx
      .select({
        id: financialEntries.id,
        status: financialEntries.status,
        createdFromRenegotiation: financialEntries.createdFromRenegotiation,
      })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          inArray(financialEntries.id, data.entryIds),
          isNull(financialEntries.deletedAt)
        )
      )

    if (entries.length !== data.entryIds.length) {
      const foundIds = entries.map((e) => e.id)
      const missing = data.entryIds.filter((id) => !foundIds.includes(id))
      throw new BusinessError(
        'ENTRY_NOT_FOUND',
        `Cobranças não encontradas: ${missing.join(', ')}`
      )
    }

    if (entries.some((e) => e.status !== 'cancelled')) {
      throw new BusinessError(
        'ENTRY_NOT_CANCELLED',
        'Apenas cobranças canceladas podem ser reativadas'
      )
    }

    // Reactivating an original whose replacement is still live would make the
    // same debt collectible twice.
    const liveReplacements = await tx
      .select({ originalEntryId: renegotiationLinks.originalEntryId })
      .from(renegotiationLinks)
      .where(inArray(renegotiationLinks.originalEntryId, data.entryIds))

    if (liveReplacements.length > 0) {
      throw new BusinessError(
        'ENTRY_HAS_REPLACEMENT',
        'Esta cobrança foi renegociada e a cobrança substituta continua ativa. Cancele a substituta primeiro.'
      )
    }

    if (entries.some((e) => e.createdFromRenegotiation)) {
      throw new BusinessError(
        'ENTRY_FROM_RENEGOTIATION',
        'Esta cobrança veio de uma renegociação cancelada. Refaça a renegociação.'
      )
    }

    const pausesByEntry = await reactivateCancelledInstallments(tx, tenantId, data.entryIds, new Date())

    for (const entryId of data.entryIds) {
      const status = await updateEntryStatus(tx, tenantId, entryId)

      await createAuditLog(
        {
          tenantId,
          userId,
          action: 'update',
          entityType: 'financial_entry',
          entityId: entryId,
          changes: {
            status: { old: 'cancelled', new: status },
            reason: { old: null, new: data.reason },
            penaltyPauses: { old: null, new: pausesByEntry.get(entryId) ?? [] },
          },
        },
        tx
      )
    }

    return { uncancelledCount: data.entryIds.length }
  })
}

/**
 * Back to collection, with the time spent cancelled kept as a penalty pause so
 * no fine or interest accrues for it. A row whose live payments already settle
 * its principal goes back to paid, not pending. Returns each entry's restored
 * installments with the pause they got.
 */
async function reactivateCancelledInstallments(
  tx: typeof db,
  tenantId: string,
  entryIds: string[],
  now: Date
) {
  const cancelled = await tx
    .select({
      id: installments.id,
      financialEntryId: installments.financialEntryId,
      amount: installments.amount,
      dueDate: installments.dueDate,
      appliedFineType: installments.appliedFineType,
      appliedFineValue: installments.appliedFineValue,
      appliedInterestRate: installments.appliedInterestRate,
      appliedGracePeriodDays: installments.appliedGracePeriodDays,
      cancelledAt: installments.cancelledAt,
      penaltyPauses: installments.penaltyPauses,
    })
    .from(installments)
    .where(
      and(
        eq(installments.tenantId, tenantId),
        inArray(installments.financialEntryId, entryIds),
        eq(installments.status, 'cancelled')
      )
    )

  const paymentsByInstallment = await loadLivePaymentsByInstallment(
    tx,
    cancelled.map((row) => row.id),
  )

  const pausesByEntry = new Map<string, { installmentId: string; from: string; to: string }[]>()
  for (const row of cancelled) {
    if (!row.cancelledAt) {
      throw new Error(
        `Installment ${row.id} is cancelled without cancelled_at; run the 0034 manual backfill`,
      )
    }
    const pause = { from: new Date(row.cancelledAt).toISOString(), to: now.toISOString() }
    const penaltyPauses = [...row.penaltyPauses, pause]
    const base = toInstallmentBase({ ...row, penaltyPauses, cancelledAt: null })
    const replay = replayPayments(
      base,
      toPaymentInputs(paymentsByInstallment.get(row.id) ?? []),
      now,
    )

    await tx
      .update(installments)
      .set({
        status: replay.installmentState.amountPaid >= base.amount ? 'paid' : 'pending',
        cancelledAt: null,
        penaltyPauses,
        updatedAt: now,
      })
      .where(eq(installments.id, row.id))

    const pauses = pausesByEntry.get(row.financialEntryId) ?? []
    pauses.push({ installmentId: row.id, ...pause })
    pausesByEntry.set(row.financialEntryId, pauses)
  }
  return pausesByEntry
}

/**
 * Locks the installments of the given entries in id order, the order every
 * write path takes them in, so two paths over overlapping rows queue instead
 * of deadlocking.
 */
async function lockInstallmentsOfEntries(tx: typeof db, tenantId: string, entryIds: string[]) {
  return tx
    .select({
      id: installments.id,
      financialEntryId: installments.financialEntryId,
      status: installments.status,
    })
    .from(installments)
    .where(and(inArray(installments.financialEntryId, entryIds), eq(installments.tenantId, tenantId)))
    .orderBy(installments.id)
    .for('update')
}

// ─── LIST FINANCIAL ENTRIES (enhanced) ──────────────────────────────

export async function listFinancialEntries(
  tenantId: string,
  filters: FinancialFilterInput
) {
  const conditions = [
    eq(financialEntries.tenantId, tenantId),
    isNull(financialEntries.deletedAt),
  ]

  if (filters.patientId) {
    conditions.push(eq(financialEntries.patientId, filters.patientId))
  }

  if (filters.status) {
    conditions.push(eq(financialEntries.status, filters.status))
  }

  if (filters.dateFrom) {
    conditions.push(gte(financialEntries.createdAt, startOfBrDay(filters.dateFrom)))
  }

  if (filters.dateTo) {
    conditions.push(lte(financialEntries.createdAt, endOfBrDay(filters.dateTo)))
  }

  // Payment method filter: entries that have at least one installment with this method
  if (filters.paymentMethod) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM floraclin.installments i
        WHERE i.financial_entry_id = ${financialEntries.id}
        AND i.payment_method = ${filters.paymentMethod}
      )`
    )
  }

  const offset = ((filters.page ?? 1) - 1) * (filters.limit ?? 20)

  // Build having clauses for computed filters
  const havingClause = sql`1=1`

  const now = new Date()

  if (filters.isOverdue) {
    const overdue = await loadOverdueInstallments(tenantId, now)
    const overdueEntryIds = [...new Set(overdue.map((i) => i.financialEntryId))]
    conditions.push(overdueEntryIds.length > 0 ? inArray(financialEntries.id, overdueEntryIds) : sql`false`)
  }

  if (filters.isPartial) {
    // Has at least one paid installment but entry is not fully paid
    conditions.push(
      sql`${financialEntries.status} != 'paid'
      AND EXISTS (
        SELECT 1 FROM floraclin.installments i
        WHERE i.financial_entry_id = ${financialEntries.id}
        AND i.amount_paid::numeric > 0
      )`
    )
  }

  const [totalResult, entries] = await Promise.all([
    db
      .select({ count: count() })
      .from(financialEntries)
      .where(and(...conditions)),
    db
      .select({
        id: financialEntries.id,
        patientId: financialEntries.patientId,
        patientName: patients.fullName,
        description: financialEntries.description,
        totalAmount: financialEntries.totalAmount,
        installmentCount: financialEntries.installmentCount,
        status: financialEntries.status,
        notes: financialEntries.notes,
        renegotiatedAt: financialEntries.renegotiatedAt,
        createdAt: financialEntries.createdAt,
        paidInstallments: sql<number>`(
          SELECT COUNT(*)::int FROM floraclin.installments i
          WHERE i.financial_entry_id = ${financialEntries.id}
          AND i.status = 'paid'
        )`,
        isPartial: sql<boolean>`(
          ${financialEntries.status} != 'paid'
          AND EXISTS (
            SELECT 1 FROM floraclin.installments i
            WHERE i.financial_entry_id = ${financialEntries.id}
            AND i.amount_paid::numeric > 0
          )
        )`,
        totalAmountPaid: sql<number>`COALESCE((
          SELECT SUM(i.amount_paid::numeric)
          FROM floraclin.installments i
          WHERE i.financial_entry_id = ${financialEntries.id}
        ), 0)`,
        remainingPrincipal: sql<number>`COALESCE((
          SELECT SUM(i.amount::numeric - i.amount_paid::numeric)
          FROM floraclin.installments i
          WHERE i.financial_entry_id = ${financialEntries.id}
          AND i.status != 'paid'
        ), 0)`,
        pendingInstallmentIds: sql<string[]>`COALESCE((
          SELECT ARRAY_AGG(i.id)
          FROM floraclin.installments i
          WHERE i.financial_entry_id = ${financialEntries.id}
          AND i.status = 'pending'
        ), ARRAY[]::uuid[])`,
        renegotiatedToEntryId: sql<string | null>`(
          SELECT rl.new_entry_id FROM floraclin.renegotiation_links rl
          WHERE rl.original_entry_id = ${financialEntries.id}
          LIMIT 1
        )`,
        renegotiatedFromEntryIds: sql<string[] | null>`(
          SELECT ARRAY_AGG(rl.original_entry_id)
          FROM floraclin.renegotiation_links rl
          WHERE rl.new_entry_id = ${financialEntries.id}
        )`,
      })
      .from(financialEntries)
      .innerJoin(patients, eq(patients.id, financialEntries.patientId))
      .where(and(...conditions))
      .orderBy(desc(financialEntries.createdAt))
      .limit(filters.limit ?? 20)
      .offset(offset),
  ])

  const total = totalResult[0]?.count ?? 0
  const limit = filters.limit ?? 20
  const open = await priceOpenInstallmentsByEntry(tenantId, entries.map((e) => e.id), now)

  return {
    data: entries.map((entry) => ({
      ...entry,
      isOverdue: open.get(entry.id)?.isOverdue ?? false,
      totalFineAmount: open.get(entry.id)?.fine ?? 0,
      totalInterestAmount: open.get(entry.id)?.interest ?? 0,
    })),
    total,
    page: filters.page ?? 1,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

/**
 * Pending installments late at `now`, net of grace and penalty pauses. The SQL
 * bound only narrows the rows: a pause can move the real limit later, never
 * earlier.
 */
export async function loadOverdueInstallments(tenantId: string, now: Date) {
  const rows = await db
    .select()
    .from(installments)
    .where(
      and(
        eq(installments.tenantId, tenantId),
        eq(installments.status, 'pending'),
        sql`${installments.dueDate} + ${installments.appliedGracePeriodDays} < ${toBrYmd(now)}::date`
      )
    )
  return rows.filter((row) => isInstallmentOverdue(toInstallmentBase(row), now))
}

/** Fine and interest due at `now` on each entry's open installments, and whether any is late. */
async function priceOpenInstallmentsByEntry(tenantId: string, entryIds: string[], now: Date) {
  const byEntry = new Map<string, { fine: number; interest: number; isOverdue: boolean }>()
  if (entryIds.length === 0) return byEntry

  const openInstallments = await db
    .select({
      id: installments.id,
      financialEntryId: installments.financialEntryId,
      status: installments.status,
      amount: installments.amount,
      dueDate: installments.dueDate,
      appliedFineType: installments.appliedFineType,
      appliedFineValue: installments.appliedFineValue,
      appliedInterestRate: installments.appliedInterestRate,
      appliedGracePeriodDays: installments.appliedGracePeriodDays,
      penaltyPauses: installments.penaltyPauses,
      cancelledAt: installments.cancelledAt,
    })
    .from(installments)
    .where(
      and(
        eq(installments.tenantId, tenantId),
        inArray(installments.financialEntryId, entryIds),
        notInArray(installments.status, ['paid', 'cancelled'])
      )
    )
  if (openInstallments.length === 0) return byEntry

  const paymentsByInstallment = await loadLivePaymentsByInstallment(
    db,
    openInstallments.map((i) => i.id),
  )

  for (const inst of openInstallments) {
    const base = toInstallmentBase(inst)
    const quote = quoteInstallment(
      base,
      toPaymentInputs(paymentsByInstallment.get(inst.id) ?? []),
      now,
    )
    const sums = byEntry.get(inst.financialEntryId) ?? { fine: 0, interest: 0, isOverdue: false }
    byEntry.set(inst.financialEntryId, {
      fine: round2(sums.fine + quote.fineAmount),
      interest: round2(sums.interest + quote.interestAmount),
      isOverdue:
        sums.isOverdue || (inst.status === 'pending' && isInstallmentOverdue(base, now)),
    })
  }
  return byEntry
}

// ─── GET FINANCIAL ENTRY (enhanced) ─────────────────────────────────

export async function getFinancialEntry(tenantId: string, entryId: string) {
  const [entry] = await db
    .select({
      id: financialEntries.id,
      patientId: financialEntries.patientId,
      patientName: patients.fullName,
      procedureRecordId: financialEntries.procedureRecordId,
      appointmentId: financialEntries.appointmentId,
      description: financialEntries.description,
      totalAmount: financialEntries.totalAmount,
      installmentCount: financialEntries.installmentCount,
      paymentMethod: financialEntries.paymentMethod,
      cardInstallmentCount: financialEntries.cardInstallmentCount,
      status: financialEntries.status,
      notes: financialEntries.notes,
      renegotiatedAt: financialEntries.renegotiatedAt,
      createdAt: financialEntries.createdAt,
    })
    .from(financialEntries)
    .innerJoin(patients, eq(patients.id, financialEntries.patientId))
    .where(
      and(
        eq(financialEntries.tenantId, tenantId),
        eq(financialEntries.id, entryId),
        isNull(financialEntries.deletedAt)
      )
    )
    .limit(1)

  if (!entry) return null

  // Get installments
  const entryInstallments = await db
    .select()
    .from(installments)
    .where(
      and(
        eq(installments.tenantId, tenantId),
        eq(installments.financialEntryId, entryId)
      )
    )
    .orderBy(installments.installmentNumber)

  const paymentsByInstallment = await loadLivePaymentsByInstallment(
    db,
    entryInstallments.map((i) => i.id),
  )

  const cardSummaries = await getCardPaymentSummaries(db, tenantId, [
    ...new Set(
      [...paymentsByInstallment.values()].flat().flatMap((p) => (p.cardPaymentId ? [p.cardPaymentId] : [])),
    ),
  ])
  const withCard = (payments: (typeof paymentRecords.$inferSelect)[]) =>
    payments.map((p) => ({ ...p, card: (p.cardPaymentId && cardSummaries.get(p.cardPaymentId)) || null }))

  const now = new Date()

  // A paid row owes nothing. A cancelled one is frozen by the open pause from
  // its cancel instant, so the engine prices it as of then.
  const installmentsWithDetails = entryInstallments.map((inst) => {
    const payments = paymentsByInstallment.get(inst.id) ?? []

    if (inst.status === 'paid') {
      return {
        ...inst,
        computedInterestAmount: 0,
        computedFineAmount: 0,
        paymentRecords: withCard(payments),
      }
    }

    const quote = quoteInstallment(toInstallmentBase(inst), toPaymentInputs(payments), now)

    return {
      ...inst,
      computedInterestAmount: quote.interestAmount,
      computedFineAmount: quote.fineAmount,
      paymentRecords: withCard(payments),
    }
  })

  // Get renegotiation links
  const [renegotiatedTo] = await db
    .select()
    .from(renegotiationLinks)
    .where(eq(renegotiationLinks.originalEntryId, entryId))
    .limit(1)

  const renegotiatedFrom = await db
    .select()
    .from(renegotiationLinks)
    .where(eq(renegotiationLinks.newEntryId, entryId))

  return {
    ...entry,
    installments: installmentsWithDetails,
    renegotiation: {
      renegotiatedTo: renegotiatedTo ?? null,
      renegotiatedFrom: renegotiatedFrom.length > 0 ? renegotiatedFrom : null,
    },
  }
}

// ─── GET REVENUE OVERVIEW (enhanced with expenses) ──────────────────

export async function getRevenueOverview(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  // BR-local day boundaries so the filter covers the full calendar day even on UTC hosts.
  const rangeStart = startOfBrDay(dateFrom)
  const rangeEnd = endOfBrDay(dateTo)

  // Base conditions for installments
  const installmentConditions = [
    eq(installments.tenantId, tenantId),
  ]

  // For filtering by practitioner, we need to join through financialEntries -> procedureRecords
  const entryConditions = [
    eq(financialEntries.tenantId, tenantId),
    isNull(financialEntries.deletedAt),
    gte(financialEntries.createdAt, rangeStart),
    lte(financialEntries.createdAt, rangeEnd),
  ]

  // Gross is cash received: live payment records paid inside the period,
  // whenever the charge itself was created.
  const receivedConditions = [
    eq(installments.tenantId, tenantId),
    eq(financialEntries.tenantId, tenantId),
    isNull(financialEntries.deletedAt),
    isNull(paymentRecords.reversedAt),
    gte(paymentRecords.paidAt, rangeStart),
    lte(paymentRecords.paidAt, rangeEnd),
  ]

  const summaryQuery = db
    .select({
      totalReceived: sql<number>`COALESCE(SUM(${paymentRecords.amount}::numeric), 0)`,
    })
    .from(paymentRecords)
    .innerJoin(installments, eq(installments.id, paymentRecords.installmentId))
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .where(and(...receivedConditions))

  const monthExpr = sql`TO_CHAR(${paymentRecords.paidAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`
  const monthlyQuery = db
    .select({
      month: sql<string>`${monthExpr}`,
      total: sql<number>`COALESCE(SUM(${paymentRecords.amount}::numeric), 0)`,
    })
    .from(paymentRecords)
    .innerJoin(installments, eq(installments.id, paymentRecords.installmentId))
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .where(and(...receivedConditions))
    .groupBy(monthExpr)
    .orderBy(monthExpr)

  // Revenue by procedure type
  const byProcedureTypeQuery = db
    .select({
      procedureTypeName: sql<string>`COALESCE(${procedureTypes.name}, 'Outros')`,
      total: sql<number>`COALESCE(SUM(${financialEntries.totalAmount}::numeric), 0)`,
    })
    .from(financialEntries)
    .leftJoin(procedureRecords, eq(procedureRecords.id, financialEntries.procedureRecordId))
    .leftJoin(procedureTypes, eq(procedureTypes.id, procedureRecords.procedureTypeId))
    .where(and(...entryConditions))
    .groupBy(procedureTypes.name)

  const byPaymentMethodQuery = db
    .select({
      paymentMethod: paymentRecords.paymentMethod,
      total: sql<number>`COALESCE(SUM(${paymentRecords.amount}::numeric), 0)`,
    })
    .from(paymentRecords)
    .innerJoin(installments, eq(installments.id, paymentRecords.installmentId))
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .where(and(...receivedConditions))
    .groupBy(paymentRecords.paymentMethod)

  // Expense totals
  const expenseTotalsQuery = db
    .select({
      totalExpenses: sql<number>`COALESCE(SUM(CASE WHEN ${expenseInstallments.status} = 'paid' THEN ${expenseInstallments.amount}::numeric ELSE 0 END), 0)`,
      totalPendingExpenses: sql<number>`COALESCE(SUM(CASE WHEN ${expenseInstallments.status} = 'pending' THEN ${expenseInstallments.amount}::numeric ELSE 0 END), 0)`,
    })
    .from(expenseInstallments)
    .innerJoin(expenses, eq(expenses.id, expenseInstallments.expenseId))
    .where(
      and(
        eq(expenses.tenantId, tenantId),
        isNull(expenses.deletedAt),
        gte(expenses.createdAt, rangeStart),
        lte(expenses.createdAt, rangeEnd)
      )
    )

  // Overdue is the engine's call, net of each installment's grace and pauses.
  const pendingQuery = db
    .select({
      id: installments.id,
      amount: installments.amount,
      dueDate: installments.dueDate,
      appliedFineType: installments.appliedFineType,
      appliedFineValue: installments.appliedFineValue,
      appliedInterestRate: installments.appliedInterestRate,
      appliedGracePeriodDays: installments.appliedGracePeriodDays,
      penaltyPauses: installments.penaltyPauses,
      cancelledAt: installments.cancelledAt,
    })
    .from(installments)
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .where(and(...entryConditions, ...installmentConditions, eq(installments.status, 'pending')))

  const [
    summaryResult,
    monthlyResult,
    byProcedureTypeResult,
    byPaymentMethodResult,
    expenseTotalsResult,
    pendingInstallments,
    totalCardFees,
  ] = await Promise.all([
    summaryQuery,
    monthlyQuery,
    byProcedureTypeQuery,
    byPaymentMethodQuery,
    expenseTotalsQuery,
    pendingQuery,
    sumCardFeesForPeriod(tenantId, rangeStart, rangeEnd),
  ])

  const now = new Date()
  let totalPending = 0
  const overdue = []
  for (const inst of pendingInstallments) {
    if (isInstallmentOverdue(toInstallmentBase(inst), now)) {
      overdue.push(inst)
    } else {
      totalPending = round2(totalPending + Number(inst.amount))
    }
  }

  // What is owed today, as the ledger's overdueReceivables counts it.
  const overduePayments = await loadLivePaymentsByInstallment(db, overdue.map((i) => i.id))
  let totalOverdue = 0
  for (const inst of overdue) {
    const quote = quoteInstallment(
      toInstallmentBase(inst),
      toPaymentInputs(overduePayments.get(inst.id) ?? []),
      now,
    )
    totalOverdue = round2(totalOverdue + quote.totalDue)
  }

  const totalReceived = Number(summaryResult[0]?.totalReceived ?? 0)
  const totalExpenses = Number(expenseTotalsResult[0]?.totalExpenses ?? 0)

  return {
    summary: {
      totalReceived,
      totalPending,
      totalOverdue,
      totalExpenses,
      totalPendingExpenses: Number(expenseTotalsResult[0]?.totalPendingExpenses ?? 0),
      totalCardFees,
      netProfit: totalReceived - totalExpenses - totalCardFees,
    },
    monthly: monthlyResult,
    byProcedureType: byProcedureTypeResult,
    byPaymentMethod: byPaymentMethodResult,
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────

/** Terms for a tenant without a financial_settings row. */
export const DEFAULT_INSTALLMENT_TERMS = {
  appliedFineType: 'percentage',
  appliedFineValue: '2.00',
  appliedInterestRate: '1.00',
  appliedGracePeriodDays: 0,
}

/**
 * The fine, interest and grace an installment is priced with for its whole
 * life, read from the tenant's settings when it is created. CDC art. 51 X
 * forbids pricing an issued charge at terms changed afterwards.
 */
export async function loadInstallmentTerms(tx: Pick<typeof db, 'select'>, tenantId: string) {
  const [settings] = await tx
    .select()
    .from(financialSettings)
    .where(eq(financialSettings.tenantId, tenantId))
    .limit(1)

  return {
    appliedFineType: settings?.fineType ?? DEFAULT_INSTALLMENT_TERMS.appliedFineType,
    appliedFineValue: settings?.fineValue ?? DEFAULT_INSTALLMENT_TERMS.appliedFineValue,
    appliedInterestRate: settings?.monthlyInterestPercent ?? DEFAULT_INSTALLMENT_TERMS.appliedInterestRate,
    appliedGracePeriodDays: settings?.gracePeriodDays ?? DEFAULT_INSTALLMENT_TERMS.appliedGracePeriodDays,
  }
}

type InstallmentPricingRow = Pick<
  typeof installments.$inferSelect,
  | 'amount'
  | 'dueDate'
  | 'appliedFineType'
  | 'appliedFineValue'
  | 'appliedInterestRate'
  | 'appliedGracePeriodDays'
  | 'penaltyPauses'
  | 'cancelledAt'
>

/**
 * The engine's view of an installment, priced only with the terms written on
 * the row. A row still cancelled has an open pause from its cancel instant.
 */
export function toInstallmentBase(row: InstallmentPricingRow): InstallmentBase {
  return {
    amount: Number(row.amount),
    dueDate: row.dueDate,
    appliedFineValue: Number(row.appliedFineValue),
    appliedFineType: row.appliedFineType,
    appliedInterestRate: Number(row.appliedInterestRate),
    gracePeriodDays: row.appliedGracePeriodDays,
    penaltyPauses: [
      ...row.penaltyPauses,
      ...(row.cancelledAt ? [{ from: new Date(row.cancelledAt).toISOString(), to: null }] : []),
    ],
  }
}

export function toPaymentInputs(
  rows: Pick<typeof paymentRecords.$inferSelect, 'id' | 'amount' | 'paidAt' | 'recordedAt'>[],
): PaymentInput[] {
  return rows.map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    paidAt: new Date(p.paidAt).toISOString(),
    recordedAt: new Date(p.recordedAt).toISOString(),
  }))
}

/** Live payments of every given installment, grouped by installment id. */
export async function loadLivePaymentsByInstallment(tx: typeof db, installmentIds: string[]) {
  const byInstallment = new Map<string, (typeof paymentRecords.$inferSelect)[]>()
  if (installmentIds.length === 0) return byInstallment

  const rows = await tx
    .select()
    .from(paymentRecords)
    .where(
      and(
        inArray(paymentRecords.installmentId, installmentIds),
        isNull(paymentRecords.reversedAt)
      )
    )
    .orderBy(paymentRecords.paidAt, paymentRecords.recordedAt)

  for (const row of rows) {
    const list = byInstallment.get(row.installmentId) ?? []
    list.push(row)
    byInstallment.set(row.installmentId, list)
  }
  return byInstallment
}

function toCents(value: number): number {
  return Math.round(value * 100)
}

/** Recomputes the entry status from its installments and returns what it wrote. */
async function updateEntryStatus(
  tx: typeof db,
  tenantId: string,
  financialEntryId: string
): Promise<FinancialStatus> {
  const allInstallments = await tx
    .select({ status: installments.status, amountPaid: installments.amountPaid })
    .from(installments)
    .where(
      and(
        eq(installments.tenantId, tenantId),
        eq(installments.financialEntryId, financialEntryId)
      )
    )

  const payable = allInstallments.filter((i) => i.status !== 'cancelled')
  if (payable.length === 0) {
    await tx
      .update(financialEntries)
      .set({
        status: 'cancelled' as FinancialStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          eq(financialEntries.id, financialEntryId),
          isNull(financialEntries.deletedAt)
        )
      )
    return 'cancelled'
  }

  const allPaid = payable.every((i) => i.status === 'paid')
  const someProgress = payable.some(
    (i) => i.status === 'paid' || Number(i.amountPaid ?? 0) > 0
  )

  let newStatus: FinancialStatus = 'pending'
  if (allPaid) {
    newStatus = 'paid'
  } else if (someProgress) {
    newStatus = 'partial'
  }

  await tx
    .update(financialEntries)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(financialEntries.tenantId, tenantId),
        eq(financialEntries.id, financialEntryId),
        isNull(financialEntries.deletedAt)
      )
    )

  return newStatus
}
