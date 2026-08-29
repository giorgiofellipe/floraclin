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
import { eq, and, isNull, sql, count, sum, desc, inArray, or, gte, lte } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { startOfBrDay, endOfBrDay, toLocalYmd } from '@/lib/dates'
import { createAuditLog } from '@/lib/audit'
import {
  calculateFine,
  calculateInterest,
  getDaysOverdue,
  allocatePayment,
  replayPayments,
  type InstallmentState,
  type InstallmentBase,
  type PaymentInput,
} from '@/lib/financial/penalties'
import type { CreateFinancialEntryInput, FinancialFilterInput, RecordPaymentInput } from '@/validations/financial'
import type { PaymentMethod, FinancialStatus } from '@/types'
import { addDays } from 'date-fns'
import { verifyTenantOwnership } from './helpers'
import {
  enqueueMetaEvent,
  resolveMetaEventPrerequisites,
  sendPendingEvent,
  type MetaEventPrerequisites,
  type PendingMetaEventRow,
} from '@/lib/meta/events'
import { resolveProspectForPatient } from '@/lib/meta/resolve-prospect'
import type { MetaActionSource } from '@/lib/meta/types'
import { reportSideEffectFailure } from '@/lib/observability'

// ─── CREATE FINANCIAL ENTRY (unchanged) ─────────────────────────────

export async function createFinancialEntry(
  tenantId: string,
  userId: string,
  data: CreateFinancialEntryInput,
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
        createdBy: userId,
      })
      .returning()

    const installmentAmount = Math.floor((data.totalAmount * 100) / data.installmentCount) / 100
    const remainder = Math.round((data.totalAmount - installmentAmount * data.installmentCount) * 100) / 100
    const today = new Date()

    const installmentRows = Array.from({ length: data.installmentCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      const dueDate = data.customDueDates?.[i]
        ?? toLocalYmd(addDays(today, i * 30))
      return {
        tenantId,
        financialEntryId: entry.id,
        installmentNumber: i + 1,
        amount: amount.toFixed(2),
        dueDate,
        status: 'pending' as const,
      }
    })

    await tx.insert(installments).values(installmentRows)

    return entry
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

    const eventId = `purchase:${financialEntryId}`

    // The outbox insert gets a SAVEPOINT of its own: raised on the caller's
    // transaction instead, a failure here would abort the payment and every
    // other installment in a bulk payment with it.
    try {
      await tx.transaction(async (savepoint) => {
        await enqueueMetaEvent({
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
      })
    } catch (error) {
      reportSideEffectFailure(error, { area: 'meta-capi', step: 'purchase_event_outbox' })
      return null
    }

    // Re-read rather than threaded out of the enqueue, which returns nothing:
    // this is either the row just written or the one an earlier installment
    // on the same entry left behind. Any status but `pending` was already
    // delivered, skipped or given up on, so only `pending` owes a send.
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
      await sendPendingEvent(row)
    } catch (error) {
      reportSideEffectFailure(error, { area: 'meta-capi', step: 'purchase_event_send' })
    }
  }
}

// ─── RECORD PAYMENT (replaces payInstallment) ───────────────────────

export async function recordPayment(
  tenantId: string,
  userId: string,
  data: RecordPaymentInput
) {
  const metaContexts = await prepareMetaPurchaseContexts(tenantId, [data.installmentId])

  const { purchase, ...result } = await withTransaction(async (tx) => {
    // 1. Lock installment row with FOR UPDATE
    const lockResult = await tx.execute(
      sql`SELECT * FROM floraclin.installments
          WHERE id = ${data.installmentId}
          AND tenant_id = ${tenantId}
          FOR UPDATE`
    )

    const rows = (Array.isArray(lockResult) ? lockResult : (lockResult as Record<string, unknown>).rows ?? lockResult) as Record<string, unknown>[]
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) {
      throw new Error('Parcela não encontrada ou não pertence a esta clínica')
    }

    if (row.status === 'paid') {
      throw new Error('Parcela já está totalmente paga')
    }

    if (row.status === 'cancelled') {
      throw new Error('Parcela cancelada não pode receber pagamento')
    }

    const installmentAmount = Number(row.amount)
    const currentAmountPaid = Number(row.amount_paid ?? 0)
    const currentFineAmount = Number(row.fine_amount ?? 0)
    const dueDate = String(row.due_date)
    const financialEntryId = String(row.financial_entry_id)

    // 2. If first delinquency (appliedFineValue is null), snapshot settings
    let appliedFineType = row.applied_fine_type as string | null
    let appliedFineValue = row.applied_fine_value != null ? Number(row.applied_fine_value) : null
    let appliedInterestRate = row.applied_interest_rate != null ? Number(row.applied_interest_rate) : null

    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date()
    const gracePeriodDays = await getGracePeriodDays(tx, tenantId)

    if (appliedFineValue === null) {
      // Load settings and snapshot
      const settings = await loadFinancialSettings(tx, tenantId)
      appliedFineType = settings.fineType
      appliedFineValue = Number(settings.fineValue)
      appliedInterestRate = Number(settings.monthlyInterestPercent)

      await tx
        .update(installments)
        .set({
          appliedFineType,
          appliedFineValue: String(appliedFineValue),
          appliedInterestRate: String(appliedInterestRate),
        })
        .where(eq(installments.id, data.installmentId))
    }

    // 3. Check for backdated payment — if paidAt is before existing payments
    const existingPayments = await tx
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.installmentId, data.installmentId))
      .orderBy(paymentRecords.paidAt)

    const isBackdated = existingPayments.length > 0 &&
      paidAt < new Date(existingPayments[0].paidAt)

    let paymentAllocation: { interestCovered: number; fineCovered: number; principalCovered: number }
    let finalAmountPaid: number
    let finalFineAmount: number
    let finalInterestAmount: number
    let finalLastCalcAt: Date

    if (isBackdated) {
      // Replay all payments including the new one
      const NEW_PAYMENT_SENTINEL = '__new__'
      const allPayments: PaymentInput[] = [
        ...existingPayments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paidAt: new Date(p.paidAt).toISOString(),
        })),
        { id: NEW_PAYMENT_SENTINEL, amount: data.amount, paidAt: paidAt.toISOString() },
      ]

      const base: InstallmentBase = {
        amount: installmentAmount,
        dueDate,
        appliedFineValue: appliedFineValue!,
        appliedFineType: appliedFineType!,
        appliedInterestRate: appliedInterestRate!,
        gracePeriodDays,
      }

      const result = replayPayments(base, allPayments)

      // Find this new payment's allocation in the replay
      const newPaymentIdx = result.payments.findIndex(
        (p) => p.id === NEW_PAYMENT_SENTINEL
      )
      paymentAllocation = newPaymentIdx >= 0
        ? {
            interestCovered: result.payments[newPaymentIdx].interestCovered,
            fineCovered: result.payments[newPaymentIdx].fineCovered,
            principalCovered: result.payments[newPaymentIdx].principalCovered,
          }
        : { interestCovered: 0, fineCovered: 0, principalCovered: data.amount }

      finalAmountPaid = result.installmentState.amountPaid
      finalFineAmount = result.installmentState.fineAmount
      finalInterestAmount = result.installmentState.interestAmount
      finalLastCalcAt = result.installmentState.lastFineInterestCalcAt
        ? new Date(result.installmentState.lastFineInterestCalcAt)
        : paidAt

      // Update existing payment records with recalculated allocations
      for (let i = 0; i < result.payments.length; i++) {
        const replayedPayment = result.payments[i]
        if (replayedPayment.id === NEW_PAYMENT_SENTINEL) continue
        // Find matching existing payment record by ID
        const existingRecord = replayedPayment.id
          ? existingPayments.find((ep) => ep.id === replayedPayment.id)
          : undefined
        if (existingRecord) {
          await tx
            .update(paymentRecords)
            .set({
              interestCovered: replayedPayment.interestCovered.toFixed(2),
              fineCovered: replayedPayment.fineCovered.toFixed(2),
              principalCovered: replayedPayment.principalCovered.toFixed(2),
            })
            .where(eq(paymentRecords.id, existingRecord.id))
        }
      }
    } else {
      // Normal flow: calculate penalties as of paidAt
      const daysOverdue = getDaysOverdue(
        row.last_fine_interest_calc_at
          ? new Date(row.last_fine_interest_calc_at as string).toISOString()
          : dueDate,
        row.last_fine_interest_calc_at ? 0 : gracePeriodDays,
        paidAt
      )

      // Apply fine once on first overdue payment if not yet applied
      let fineAmount = currentFineAmount
      if (daysOverdue > 0 && currentAmountPaid === 0 && currentFineAmount === 0) {
        fineAmount = calculateFine(installmentAmount, appliedFineType!, appliedFineValue!)
      }

      const remainingPrincipal = installmentAmount - currentAmountPaid
      const interestAmount = calculateInterest(
        remainingPrincipal,
        daysOverdue,
        appliedInterestRate!
      )

      const state: InstallmentState = {
        amount: installmentAmount,
        amountPaid: currentAmountPaid,
        fineAmount,
        interestAmount,
      }

      const totalDue = Math.round(((installmentAmount - currentAmountPaid) + fineAmount + interestAmount) * 100) / 100
      if (data.amount > totalDue + 0.02) {
        throw new Error('Valor do pagamento excede o total devido')
      }

      paymentAllocation = allocatePayment(state, data.amount)

      finalAmountPaid = currentAmountPaid + paymentAllocation.principalCovered
      finalFineAmount = fineAmount - paymentAllocation.fineCovered
      finalInterestAmount = interestAmount - paymentAllocation.interestCovered
      finalLastCalcAt = paidAt
    }

    const actualAmount = paymentAllocation.interestCovered + paymentAllocation.fineCovered + paymentAllocation.principalCovered

    // 4. Create payment_records row
    const [paymentRecord] = await tx
      .insert(paymentRecords)
      .values({
        installmentId: data.installmentId,
        amount: actualAmount.toFixed(2),
        paymentMethod: data.paymentMethod,
        interestCovered: paymentAllocation.interestCovered.toFixed(2),
        fineCovered: paymentAllocation.fineCovered.toFixed(2),
        principalCovered: paymentAllocation.principalCovered.toFixed(2),
        paidAt,
        recordedBy: userId,
        notes: data.notes,
      })
      .returning()

    // 5. Create cash_movements inflow row
    // Get patient from financial entry
    const [entryInfo] = await tx
      .select({
        patientId: financialEntries.patientId,
        description: financialEntries.description,
      })
      .from(financialEntries)
      .where(eq(financialEntries.id, financialEntryId))
      .limit(1)

    await tx.insert(cashMovements).values({
      tenantId,
      type: 'inflow',
      amount: actualAmount.toFixed(2),
      description: `Pagamento: ${entryInfo?.description ?? 'Cobranca'}`,
      paymentMethod: data.paymentMethod,
      movementDate: paidAt,
      paymentRecordId: paymentRecord.id,
      patientId: entryInfo?.patientId,
      recordedBy: userId,
    })

    // 6. Update installment
    const isPaid =
      finalAmountPaid >= installmentAmount &&
      finalFineAmount <= 0 &&
      finalInterestAmount <= 0

    await tx
      .update(installments)
      .set({
        amountPaid: finalAmountPaid.toFixed(2),
        fineAmount: Math.max(0, finalFineAmount).toFixed(2),
        interestAmount: Math.max(0, finalInterestAmount).toFixed(2),
        lastFineInterestCalcAt: finalLastCalcAt,
        status: isPaid ? 'paid' : 'pending',
        paidAt: isPaid ? paidAt : undefined,
        paymentMethod: isPaid ? data.paymentMethod : undefined,
        updatedAt: new Date(),
      })
      .where(eq(installments.id, data.installmentId))

    // 7. Update parent financial_entries status
    await updateEntryStatus(tx, tenantId, financialEntryId)

    const purchase = await emitPurchaseEventForEntry(
      tx,
      tenantId,
      financialEntryId,
      paidAt,
      metaContexts.get(financialEntryId)
    )

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
    // 1. Load payment record + verify ownership via installment → financial_entry
    const [pr] = await tx
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.id, paymentRecordId))
      .limit(1)

    if (!pr) {
      throw new Error('Pagamento não encontrado')
    }

    // Verify tenant ownership through installment chain
    const [inst] = await tx
      .select({
        id: installments.id,
        tenantId: installments.tenantId,
        financialEntryId: installments.financialEntryId,
        amount: installments.amount,
        dueDate: installments.dueDate,
        appliedFineType: installments.appliedFineType,
        appliedFineValue: installments.appliedFineValue,
        appliedInterestRate: installments.appliedInterestRate,
      })
      .from(installments)
      .where(
        and(
          eq(installments.id, pr.installmentId),
          eq(installments.tenantId, tenantId)
        )
      )
      .limit(1)

    if (!inst) {
      throw new Error('Parcela não pertence a esta clínica')
    }

    // 2. Check if already reversed
    if (pr.reversedAt) {
      throw new Error('Pagamento já foi estornado')
    }

    // 3. Mark payment as reversed (soft-delete)
    await tx
      .update(paymentRecords)
      .set({
        reversedAt: new Date(),
        reversedBy: userId,
        reversalReason: reason ?? null,
      })
      .where(eq(paymentRecords.id, paymentRecordId))

    // 4. Create reversal cash_movement (outflow)
    const [entryInfo] = await tx
      .select({
        patientId: financialEntries.patientId,
        description: financialEntries.description,
      })
      .from(financialEntries)
      .where(eq(financialEntries.id, inst.financialEntryId))
      .limit(1)

    await tx.insert(cashMovements).values({
      tenantId,
      type: 'outflow',
      amount: pr.amount,
      description: `Estorno: ${entryInfo?.description ?? 'Pagamento'}${reason ? ` — ${reason}` : ''}`,
      paymentMethod: pr.paymentMethod as PaymentMethod,
      movementDate: new Date(),
      patientId: entryInfo?.patientId,
      recordedBy: userId,
    })

    // 5. Replay remaining (non-reversed) payments to recalculate installment state
    const remainingPayments = await tx
      .select()
      .from(paymentRecords)
      .where(
        and(
          eq(paymentRecords.installmentId, inst.id),
          isNull(paymentRecords.reversedAt)
        )
      )
      .orderBy(paymentRecords.paidAt)

    const gracePeriodDays = await getGracePeriodDays(tx, tenantId)

    if (remainingPayments.length === 0) {
      // No payments left — reset installment
      await tx
        .update(installments)
        .set({
          amountPaid: '0',
          fineAmount: '0',
          interestAmount: '0',
          lastFineInterestCalcAt: null,
          status: 'pending',
          paidAt: null,
          paymentMethod: null,
          updatedAt: new Date(),
        })
        .where(eq(installments.id, inst.id))
    } else {
      // Replay remaining payments
      const base: InstallmentBase = {
        amount: Number(inst.amount),
        dueDate: inst.dueDate,
        appliedFineValue: Number(inst.appliedFineValue ?? 0),
        appliedFineType: inst.appliedFineType ?? 'percentage',
        appliedInterestRate: Number(inst.appliedInterestRate ?? 0),
        gracePeriodDays,
      }

      const allPayments: PaymentInput[] = remainingPayments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paidAt: new Date(p.paidAt).toISOString(),
      }))

      const result = replayPayments(base, allPayments)

      // Update each payment record with recalculated allocations
      for (let i = 0; i < result.payments.length; i++) {
        const replayed = result.payments[i]
        const existing = replayed.id
          ? remainingPayments.find((ep) => ep.id === replayed.id)
          : undefined
        if (existing) {
          await tx
            .update(paymentRecords)
            .set({
              interestCovered: replayed.interestCovered.toFixed(2),
              fineCovered: replayed.fineCovered.toFixed(2),
              principalCovered: replayed.principalCovered.toFixed(2),
            })
            .where(eq(paymentRecords.id, existing.id))
        }
      }

      const isPaid = result.installmentState.amountPaid >= Number(inst.amount) &&
        result.installmentState.fineAmount <= 0 &&
        result.installmentState.interestAmount <= 0

      await tx
        .update(installments)
        .set({
          amountPaid: result.installmentState.amountPaid.toFixed(2),
          fineAmount: Math.max(0, result.installmentState.fineAmount).toFixed(2),
          interestAmount: Math.max(0, result.installmentState.interestAmount).toFixed(2),
          lastFineInterestCalcAt: result.installmentState.lastFineInterestCalcAt
            ? new Date(result.installmentState.lastFineInterestCalcAt)
            : null,
          status: isPaid ? 'paid' : 'pending',
          paidAt: isPaid ? new Date(remainingPayments[remainingPayments.length - 1].paidAt) : null,
          paymentMethod: isPaid ? remainingPayments[remainingPayments.length - 1].paymentMethod as PaymentMethod : null,
          updatedAt: new Date(),
        })
        .where(eq(installments.id, inst.id))
    }

    // 6. Update parent entry status
    await updateEntryStatus(tx, tenantId, inst.financialEntryId)

    // 7. Audit log
    await createAuditLog({
      tenantId,
      userId,
      action: 'update',
      entityType: 'payment_record',
      entityId: paymentRecordId,
      changes: {
        action: { old: 'active', new: 'reversed' },
        amount: { old: pr.amount, new: '0' },
        reason: { old: null, new: reason ?? null },
      },
    }, tx)

    return { success: true }
  })
}

// ─── BULK PAY INSTALLMENTS ──────────────────────────────────────────

export async function bulkPayInstallments(
  tenantId: string,
  userId: string,
  data: { installmentIds: string[]; paymentMethod: string; paidAt?: string }
) {
  const metaContexts = await prepareMetaPurchaseContexts(tenantId, data.installmentIds)

  const { results, purchases } = await withTransaction(async (tx) => {
    // Lock all target installments
    const installmentIdArray = `{${data.installmentIds.join(',')}}`
    const lockResult = await tx.execute(
      sql`SELECT id FROM floraclin.installments
          WHERE id = ANY(${installmentIdArray}::uuid[])
          AND tenant_id = ${tenantId}
          AND status NOT IN ('paid', 'cancelled')
          FOR UPDATE`
    )

    const lockedRows = (Array.isArray(lockResult) ? lockResult : (lockResult as Record<string, unknown>).rows ?? lockResult) as Record<string, unknown>[]
    const lockedIds = lockedRows.map((r) => String(r.id))

    // Validate all requested installments were found and lockable
    const missingIds = data.installmentIds.filter((id) => !lockedIds.includes(id))
    if (missingIds.length > 0) {
      throw new Error(
        `Parcelas não encontradas ou já pagas/canceladas: ${missingIds.join(', ')}`
      )
    }

    // Load grace period once before the loop
    const gracePeriodDays = await getGracePeriodDays(tx, tenantId)

    // Process each installment through recordPayment logic
    const results = []
    const purchases: PendingMetaEventRow[] = []
    for (const installmentId of data.installmentIds) {
      // Load the locked row
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

      const installmentAmount = Number(row.amount)
      const currentAmountPaid = Number(row.amountPaid ?? 0)
      const currentFineAmount = Number(row.fineAmount ?? 0)
      const paidAt = data.paidAt ? new Date(data.paidAt) : new Date()

      // Snapshot settings if not yet done
      let appliedFineType = row.appliedFineType
      let appliedFineValue = row.appliedFineValue != null ? Number(row.appliedFineValue) : null
      let appliedInterestRate = row.appliedInterestRate != null ? Number(row.appliedInterestRate) : null

      if (appliedFineValue === null) {
        const settings = await loadFinancialSettings(tx, tenantId)
        appliedFineType = settings.fineType
        appliedFineValue = Number(settings.fineValue)
        appliedInterestRate = Number(settings.monthlyInterestPercent)

        await tx
          .update(installments)
          .set({
            appliedFineType,
            appliedFineValue: String(appliedFineValue),
            appliedInterestRate: String(appliedInterestRate),
          })
          .where(eq(installments.id, installmentId))
      }

      // Calculate remaining amount including penalties
      const daysOverdue = getDaysOverdue(
        row.lastFineInterestCalcAt
          ? new Date(row.lastFineInterestCalcAt).toISOString()
          : row.dueDate,
        row.lastFineInterestCalcAt ? 0 : gracePeriodDays,
        paidAt
      )

      let fineAmount = currentFineAmount
      if (daysOverdue > 0 && currentAmountPaid === 0 && currentFineAmount === 0) {
        fineAmount = calculateFine(installmentAmount, appliedFineType!, appliedFineValue!)
      }

      const remainingPrincipal = installmentAmount - currentAmountPaid
      const interestAmount = calculateInterest(remainingPrincipal, daysOverdue, appliedInterestRate!)

      // Pay the full remaining amount (principal + fine + interest)
      const totalDue = remainingPrincipal + fineAmount + interestAmount

      const state: InstallmentState = {
        amount: installmentAmount,
        amountPaid: currentAmountPaid,
        fineAmount,
        interestAmount,
      }

      const allocation = allocatePayment(state, totalDue)

      const finalAmountPaid = currentAmountPaid + allocation.principalCovered

      // Create payment record
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
          recordedBy: userId,
        })
        .returning()

      // Get entry info for cash movement
      const [entryInfo] = await tx
        .select({
          patientId: financialEntries.patientId,
          description: financialEntries.description,
        })
        .from(financialEntries)
        .where(eq(financialEntries.id, row.financialEntryId))
        .limit(1)

      // Create cash movement
      await tx.insert(cashMovements).values({
        tenantId,
        type: 'inflow',
        amount: totalDue.toFixed(2),
        description: `Pagamento: ${entryInfo?.description ?? 'Cobranca'}`,
        paymentMethod: data.paymentMethod,
        movementDate: paidAt,
        paymentRecordId: paymentRecord.id,
        patientId: entryInfo?.patientId,
        recordedBy: userId,
      })

      // Update installment to paid
      await tx
        .update(installments)
        .set({
          amountPaid: finalAmountPaid.toFixed(2),
          fineAmount: '0',
          interestAmount: '0',
          lastFineInterestCalcAt: paidAt,
          status: 'paid',
          paidAt,
          paymentMethod: data.paymentMethod,
          updatedAt: new Date(),
        })
        .where(eq(installments.id, installmentId))

      // Update parent entry status
      await updateEntryStatus(tx, tenantId, row.financialEntryId)

      const purchase = await emitPurchaseEventForEntry(
        tx,
        tenantId,
        row.financialEntryId,
        paidAt,
        metaContexts.get(row.financialEntryId)
      )
      if (purchase) purchases.push(purchase)

      results.push({ installmentId, paymentRecord, allocation })
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
      throw new Error(`Cobranças não encontradas: ${missing.join(', ')}`)
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

        // Restore cancelled installments back to pending
        await tx
          .update(installments)
          .set({ status: 'pending', updatedAt: now })
          .where(
            and(
              eq(installments.financialEntryId, originalId),
              eq(installments.status, 'cancelled')
            )
          )

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
      .set({ status: 'cancelled', updatedAt: now })
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

  if (filters.isOverdue) {
    // Has at least one overdue installment
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM floraclin.installments i
        WHERE i.financial_entry_id = ${financialEntries.id}
        AND i.status = 'pending'
        AND i.due_date < CURRENT_DATE
      )`
    )
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
        isOverdue: sql<boolean>`EXISTS (
          SELECT 1 FROM floraclin.installments i
          WHERE i.financial_entry_id = ${financialEntries.id}
          AND i.status = 'pending'
          AND i.due_date < CURRENT_DATE
        )`,
        isPartial: sql<boolean>`(
          ${financialEntries.status} != 'paid'
          AND EXISTS (
            SELECT 1 FROM floraclin.installments i
            WHERE i.financial_entry_id = ${financialEntries.id}
            AND i.amount_paid::numeric > 0
          )
        )`,
        totalFineAmount: sql<number>`COALESCE((
          SELECT SUM(
            CASE
              WHEN i.status = 'pending' AND i.due_date < CURRENT_DATE
                AND i.fine_amount::numeric = 0
              THEN i.amount::numeric * COALESCE(i.applied_fine_value, fs.fine_value, 2)::numeric / 100
              ELSE i.fine_amount::numeric
            END
          )
          FROM floraclin.installments i
          LEFT JOIN floraclin.financial_settings fs ON fs.tenant_id = ${financialEntries.tenantId}
          WHERE i.financial_entry_id = ${financialEntries.id}
        ), 0)`,
        totalInterestAmount: sql<number>`COALESCE((
          SELECT SUM(
            CASE
              WHEN i.status = 'pending' AND i.due_date < CURRENT_DATE
              THEN (i.amount::numeric - i.amount_paid::numeric)
                * COALESCE(i.applied_interest_rate, fs.monthly_interest_percent, 1)::numeric / 100
                * GREATEST(0, (CURRENT_DATE - i.due_date::date))
                / 30
              ELSE i.interest_amount::numeric
            END
          )
          FROM floraclin.installments i
          LEFT JOIN floraclin.financial_settings fs ON fs.tenant_id = ${financialEntries.tenantId}
          WHERE i.financial_entry_id = ${financialEntries.id}
        ), 0)`,
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

  return {
    data: entries,
    total,
    page: filters.page ?? 1,
    limit,
    totalPages: Math.ceil(total / limit),
  }
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

  // Get payment records for each installment
  const installmentIds = entryInstallments.map((i) => i.id)
  const allPaymentRecords = installmentIds.length > 0
    ? await db
        .select()
        .from(paymentRecords)
        .where(
          and(
            inArray(paymentRecords.installmentId, installmentIds),
            isNull(paymentRecords.reversedAt)
          )
        )
        .orderBy(paymentRecords.paidAt)
    : []

  // Group payment records by installment
  const paymentsByInstallment = new Map<string, typeof allPaymentRecords>()
  for (const pr of allPaymentRecords) {
    const list = paymentsByInstallment.get(pr.installmentId) ?? []
    list.push(pr)
    paymentsByInstallment.set(pr.installmentId, list)
  }

  // Load settings for penalty calculations
  const [settings] = await db
    .select()
    .from(financialSettings)
    .where(eq(financialSettings.tenantId, tenantId))
    .limit(1)

  const gracePeriodDays = settings?.gracePeriodDays ?? 0

  // Compute current penalties for each installment
  const installmentsWithDetails = entryInstallments.map((inst) => {
    const payments = paymentsByInstallment.get(inst.id) ?? []
    const amount = Number(inst.amount)
    const amountPaid = Number(inst.amountPaid ?? 0)
    const storedFine = Number(inst.fineAmount ?? 0)

    // Calculate current interest and fine on the fly for pending installments
    // Use tenant settings as fallback when penalty rates haven't been snapshotted yet
    const effectiveInterestRate = Number(inst.appliedInterestRate ?? settings?.monthlyInterestPercent ?? 0)
    const effectiveFineValue = Number(inst.appliedFineValue ?? settings?.fineValue ?? 0)
    const effectiveFineType = inst.appliedFineType ?? settings?.fineType ?? 'percentage'

    let currentInterest = Number(inst.interestAmount ?? 0)
    let currentFine = storedFine
    if (inst.status === 'pending' && effectiveInterestRate > 0) {
      const daysOverdue = getDaysOverdue(
        inst.lastFineInterestCalcAt
          ? new Date(inst.lastFineInterestCalcAt).toISOString()
          : inst.dueDate,
        inst.lastFineInterestCalcAt ? 0 : gracePeriodDays,
      )
      if (daysOverdue > 0) {
        currentInterest = calculateInterest(
          amount - amountPaid,
          daysOverdue,
          effectiveInterestRate
        )
        // Compute fine for display if not yet stored (applied on first payment)
        if (storedFine === 0 && effectiveFineValue > 0) {
          currentFine = calculateFine(
            amount,
            effectiveFineType,
            effectiveFineValue
          )
        }
      }
    }

    return {
      ...inst,
      computedInterestAmount: currentInterest,
      computedFineAmount: currentFine,
      paymentRecords: payments,
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

  // Summary: total received, pending, overdue
  const summaryQuery = db
    .select({
      totalReceived: sql<number>`COALESCE(SUM(CASE WHEN ${installments.status} = 'paid' THEN ${installments.amount}::numeric ELSE 0 END), 0)`,
      totalPending: sql<number>`COALESCE(SUM(CASE WHEN ${installments.status} = 'pending' AND ${installments.dueDate} >= CURRENT_DATE THEN ${installments.amount}::numeric ELSE 0 END), 0)`,
      totalOverdue: sql<number>`COALESCE(SUM(CASE WHEN ${installments.status} = 'pending' AND ${installments.dueDate} < CURRENT_DATE THEN ${installments.amount}::numeric ELSE 0 END), 0)`,
    })
    .from(installments)
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .where(and(...entryConditions, ...installmentConditions))

  // Monthly revenue (paid installments grouped by month)
  const monthlyQuery = db
    .select({
      month: sql<string>`TO_CHAR(${installments.paidAt}, 'YYYY-MM')`,
      total: sql<number>`COALESCE(SUM(${installments.amount}::numeric), 0)`,
    })
    .from(installments)
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .where(
      and(
        ...installmentConditions,
        eq(installments.status, 'paid'),
        eq(financialEntries.tenantId, tenantId),
        isNull(financialEntries.deletedAt),
        gte(installments.paidAt, rangeStart),
        lte(installments.paidAt, rangeEnd)
      )
    )
    .groupBy(sql`TO_CHAR(${installments.paidAt}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${installments.paidAt}, 'YYYY-MM')`)

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

  // Revenue by payment method
  const byPaymentMethodQuery = db
    .select({
      paymentMethod: sql<string>`COALESCE(${installments.paymentMethod}, 'Não informado')`,
      total: sql<number>`COALESCE(SUM(${installments.amount}::numeric), 0)`,
    })
    .from(installments)
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .where(
      and(
        ...installmentConditions,
        eq(installments.status, 'paid'),
        eq(financialEntries.tenantId, tenantId),
        isNull(financialEntries.deletedAt),
        gte(installments.paidAt, rangeStart),
        lte(installments.paidAt, rangeEnd)
      )
    )
    .groupBy(installments.paymentMethod)

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

  const [summaryResult, monthlyResult, byProcedureTypeResult, byPaymentMethodResult, expenseTotalsResult] =
    await Promise.all([summaryQuery, monthlyQuery, byProcedureTypeQuery, byPaymentMethodQuery, expenseTotalsQuery])

  const totalReceived = Number(summaryResult[0]?.totalReceived ?? 0)
  const totalExpenses = Number(expenseTotalsResult[0]?.totalExpenses ?? 0)

  return {
    summary: {
      ...(summaryResult[0] ?? { totalReceived: 0, totalPending: 0, totalOverdue: 0 }),
      totalExpenses,
      totalPendingExpenses: Number(expenseTotalsResult[0]?.totalPendingExpenses ?? 0),
      netProfit: totalReceived - totalExpenses,
    },
    monthly: monthlyResult,
    byProcedureType: byProcedureTypeResult,
    byPaymentMethod: byPaymentMethodResult,
  }
}

// ─── KEEP LEGACY payInstallment (for backwards compat) ──────────────

export async function payInstallment(
  tenantId: string,
  installmentId: string,
  paymentMethod: PaymentMethod,
  txDb?: typeof db
) {
  const execute = async (tx: typeof db) => {
    const [updated] = await tx
      .update(installments)
      .set({
        status: 'paid',
        paidAt: new Date(),
        paymentMethod,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(installments.tenantId, tenantId),
          eq(installments.id, installmentId),
          inArray(installments.status, ['pending', 'overdue'])
        )
      )
      .returning()

    if (!updated) {
      throw new Error('Parcela não encontrada ou já paga')
    }

    // Check all installments for this entry to update parent status
    const allInstallments = await tx
      .select({ status: installments.status })
      .from(installments)
      .where(
        and(
          eq(installments.tenantId, tenantId),
          eq(installments.financialEntryId, updated.financialEntryId)
        )
      )

    const allPaid = allInstallments.every((i) => i.status === 'paid')
    const somePaid = allInstallments.some((i) => i.status === 'paid')

    let newStatus: FinancialStatus = 'pending'
    if (allPaid) {
      newStatus = 'paid'
    } else if (somePaid) {
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
          eq(financialEntries.id, updated.financialEntryId),
          isNull(financialEntries.deletedAt)
        )
      )

    return updated
  }

  if (txDb) {
    return execute(txDb)
  }
  return withTransaction(execute)
}

// ─── HELPERS ────────────────────────────────────────────────────────

async function loadFinancialSettings(tx: typeof db, tenantId: string) {
  const [settings] = await tx
    .select()
    .from(financialSettings)
    .where(eq(financialSettings.tenantId, tenantId))
    .limit(1)

  // Return defaults if no settings exist
  return {
    fineType: settings?.fineType ?? 'percentage',
    fineValue: settings?.fineValue ?? '2.00',
    monthlyInterestPercent: settings?.monthlyInterestPercent ?? '1.00',
    gracePeriodDays: settings?.gracePeriodDays ?? 0,
  }
}

async function getGracePeriodDays(tx: typeof db, tenantId: string): Promise<number> {
  const settings = await loadFinancialSettings(tx, tenantId)
  return settings.gracePeriodDays
}

async function updateEntryStatus(
  tx: typeof db,
  tenantId: string,
  financialEntryId: string
) {
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
    return
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
}
