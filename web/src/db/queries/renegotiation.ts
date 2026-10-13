import { db } from '@/db/client'
import {
  financialEntries,
  installments,
  paymentRecords,
  renegotiationLinks,
  patients,
} from '@/db/schema'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { BusinessError } from '@/lib/errors'
import { createAuditLog } from '@/lib/audit'
import { quoteInstallment } from '@/lib/financial/penalties'
import {
  loadInstallmentTerms,
  loadLivePaymentsByInstallment,
  toInstallmentBase,
  toPaymentInputs,
} from './financial'
import type { RenegotiateInput } from '@/validations/financial'
import { addDays } from 'date-fns'
import { toLocalYmd } from '@/lib/dates'

export async function renegotiateCharges(
  tenantId: string,
  userId: string,
  data: RenegotiateInput
) {
  return withTransaction(async (tx) => {
    // 1. Verify all entries belong to the tenant and the same patient
    const entries = await tx
      .select({
        id: financialEntries.id,
        patientId: financialEntries.patientId,
        description: financialEntries.description,
        totalAmount: financialEntries.totalAmount,
        status: financialEntries.status,
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
      throw new BusinessError('ENTRIES_NOT_FOUND', `Cobranças não encontradas: ${missing.join(', ')}`)
    }

    // All entries must belong to the same patient
    const patientIds = [...new Set(entries.map((e) => e.patientId))]
    if (patientIds.length > 1) {
      throw new BusinessError('MIXED_PATIENTS', 'Renegociação só pode consolidar cobranças do mesmo paciente')
    }

    const patientId = patientIds[0]

    // 2. Lock all installments of the selected entries. ORDER BY id so this
    // and bulk payment acquire overlapping rows in one order instead of
    // deadlocking on each other.
    const lockedInstallments = await tx
      .select()
      .from(installments)
      .where(and(inArray(installments.financialEntryId, data.entryIds), eq(installments.tenantId, tenantId)))
      .orderBy(installments.id)
      .for('update')

    // Eligibility is checked only now, on a read taken after the lock: a
    // payment committing between the first select and the lock can settle the
    // entry, and the pre-lock status would let it through.
    const lockedEntries = await tx
      .select({ id: financialEntries.id, status: financialEntries.status })
      .from(financialEntries)
      .where(and(eq(financialEntries.tenantId, tenantId), inArray(financialEntries.id, data.entryIds)))
    const statusById = new Map(lockedEntries.map((e) => [e.id, e.status]))

    const alreadyPaid = lockedEntries.filter((e) => e.status === 'paid')
    if (alreadyPaid.length > 0) {
      throw new BusinessError('ENTRY_ALREADY_PAID', 'Cobrança já quitada, não há o que renegociar.')
    }
    const ineligible = lockedEntries.filter((e) => e.status === 'renegotiated' || e.status === 'cancelled')
    if (ineligible.length > 0) {
      throw new BusinessError('ENTRY_NOT_ELIGIBLE', 'Uma das cobranças já foi renegociada ou cancelada.')
    }

    // 3. Live payment records for every locked installment, so pricing here
    // matches what the payment dialog quotes, and the terms the replacement's
    // installments are created with.
    const paymentsByInstallment = await loadLivePaymentsByInstallment(
      tx,
      lockedInstallments.map((i) => i.id),
    )

    const terms = await loadInstallmentTerms(tx, tenantId)
    const now = new Date()

    // 4. Calculate remaining per entry
    let totalRemainingPrincipal = 0
    let totalPenalties = 0
    const breakdownPerEntry: Array<{
      entryId: string
      remainingPrincipal: number
      penalties: number
    }> = []

    for (const entry of entries) {
      const entryInstallments = lockedInstallments.filter((i) => i.financialEntryId === entry.id)

      let entryRemainingPrincipal = 0
      let entryPenalties = 0

      for (const inst of entryInstallments) {
        if (inst.status === 'paid' || inst.status === 'cancelled') continue

        const base = toInstallmentBase(inst)
        const prior = toPaymentInputs(paymentsByInstallment.get(inst.id) ?? [])
        const quote = quoteInstallment(base, prior, now)

        entryRemainingPrincipal += quote.remainingPrincipal
        entryPenalties += quote.fineAmount + quote.interestAmount
      }

      totalRemainingPrincipal += entryRemainingPrincipal
      totalPenalties += entryPenalties

      breakdownPerEntry.push({
        entryId: entry.id,
        remainingPrincipal: entryRemainingPrincipal,
        penalties: entryPenalties,
      })
    }

    // 5. Apply waiver
    let penaltiesIncluded = totalPenalties
    let penaltiesWaived = 0

    if (data.waivePenalties) {
      penaltiesWaived = totalPenalties
      penaltiesIncluded = 0
    } else if (data.waiveAmount && data.waiveAmount > 0) {
      penaltiesWaived = Math.min(data.waiveAmount, totalPenalties)
      penaltiesIncluded = totalPenalties - penaltiesWaived
    }

    const calculatedTotal = totalRemainingPrincipal + penaltiesIncluded

    // A row already cancelled keeps its cancelled_at, which its penalty pause
    // starts from.
    const pendingInstallmentIds = lockedInstallments
      .filter((i) => i.status === 'pending')
      .map((i) => i.id)

    if (pendingInstallmentIds.length === 0 || calculatedTotal <= 0) {
      throw new BusinessError('NOTHING_TO_RENEGOTIATE', 'Não há saldo pendente para renegociar.')
    }

    const newTotalAmount = data.newTotalAmount ?? calculatedTotal

    // 6. Cancel the pending installments
    await tx
      .update(installments)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(inArray(installments.id, pendingInstallmentIds))

    // 7. Mark original entries as 'renegotiated'
    await tx
      .update(financialEntries)
      .set({
        status: 'renegotiated',
        renegotiatedAt: now,
        updatedAt: now,
      })
      .where(inArray(financialEntries.id, data.entryIds))

    // 8. Create new entry with consolidated total
    const [newEntry] = await tx
      .insert(financialEntries)
      .values({
        tenantId,
        patientId,
        description: data.description,
        totalAmount: newTotalAmount.toFixed(2),
        installmentCount: data.newInstallmentCount,
        status: 'pending',
        createdFromRenegotiation: true,
        createdBy: userId,
      })
      .returning()

    // 9. Create renegotiation_links (one per original entry)
    for (const breakdown of breakdownPerEntry) {
      const entryPenaltyRatio = totalPenalties > 0
        ? breakdown.penalties / totalPenalties
        : 0

      await tx.insert(renegotiationLinks).values({
        originalEntryId: breakdown.entryId,
        newEntryId: newEntry.id,
        originalRemainingPrincipal: breakdown.remainingPrincipal.toFixed(2),
        penaltiesIncluded: (penaltiesIncluded * entryPenaltyRatio).toFixed(2),
        penaltiesWaived: (penaltiesWaived * entryPenaltyRatio).toFixed(2),
      })
    }

    // 10. Auto-generate new installments
    const installmentAmount = Math.floor((newTotalAmount * 100) / data.newInstallmentCount) / 100
    const remainder = Math.round((newTotalAmount - installmentAmount * data.newInstallmentCount) * 100) / 100

    const installmentRows = Array.from({ length: data.newInstallmentCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      const dueDate = data.customDueDates?.[i]
        ?? toLocalYmd(addDays(now, i * 30))
      return {
        tenantId,
        financialEntryId: newEntry.id,
        installmentNumber: i + 1,
        amount: amount.toFixed(2),
        dueDate,
        status: 'pending' as const,
        ...terms,
      }
    })

    await tx.insert(installments).values(installmentRows)

    // 11. Create audit logs
    for (const entryId of data.entryIds) {
      await createAuditLog(
        {
          tenantId,
          userId,
          action: 'update',
          entityType: 'financial_entry',
          entityId: entryId,
          changes: {
            status: {
              old: statusById.get(entryId) ?? 'pending',
              new: 'renegotiated',
            },
            renegotiatedTo: { old: null, new: newEntry.id },
          },
        },
        tx
      )
    }

    await createAuditLog(
      {
        tenantId,
        userId,
        action: 'create',
        entityType: 'financial_entry',
        entityId: newEntry.id,
        changes: {
          type: { old: null, new: 'renegotiation' },
          originalEntryIds: { old: null, new: data.entryIds },
          totalRemainingPrincipal: { old: null, new: totalRemainingPrincipal },
          penaltiesIncluded: { old: null, new: penaltiesIncluded },
          penaltiesWaived: { old: null, new: penaltiesWaived },
        },
      },
      tx
    )

    return {
      newEntry,
      breakdown: breakdownPerEntry,
      totalRemainingPrincipal,
      penaltiesIncluded,
      penaltiesWaived,
    }
  })
}

export async function getRenegotiationInfo(tenantId: string, entryId: string) {
  // Verify entry belongs to tenant
  const [entry] = await db
    .select({ id: financialEntries.id })
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.tenantId, tenantId),
        eq(financialEntries.id, entryId),
        isNull(financialEntries.deletedAt)
      )
    )
    .limit(1)

  if (!entry) return null

  // Get links where this entry was renegotiated TO a new entry
  const renegotiatedTo = await db
    .select({
      id: renegotiationLinks.id,
      newEntryId: renegotiationLinks.newEntryId,
      originalRemainingPrincipal: renegotiationLinks.originalRemainingPrincipal,
      penaltiesIncluded: renegotiationLinks.penaltiesIncluded,
      penaltiesWaived: renegotiationLinks.penaltiesWaived,
      createdAt: renegotiationLinks.createdAt,
      newEntryDescription: financialEntries.description,
      newEntryTotalAmount: financialEntries.totalAmount,
    })
    .from(renegotiationLinks)
    .innerJoin(financialEntries, eq(financialEntries.id, renegotiationLinks.newEntryId))
    .where(eq(renegotiationLinks.originalEntryId, entryId))

  // Get links where this entry was created FROM renegotiation
  const renegotiatedFrom = await db
    .select({
      id: renegotiationLinks.id,
      originalEntryId: renegotiationLinks.originalEntryId,
      originalRemainingPrincipal: renegotiationLinks.originalRemainingPrincipal,
      penaltiesIncluded: renegotiationLinks.penaltiesIncluded,
      penaltiesWaived: renegotiationLinks.penaltiesWaived,
      createdAt: renegotiationLinks.createdAt,
      originalEntryDescription: financialEntries.description,
      originalEntryTotalAmount: financialEntries.totalAmount,
    })
    .from(renegotiationLinks)
    .innerJoin(financialEntries, eq(financialEntries.id, renegotiationLinks.originalEntryId))
    .where(eq(renegotiationLinks.newEntryId, entryId))

  return {
    renegotiatedTo: renegotiatedTo.length > 0 ? renegotiatedTo : null,
    renegotiatedFrom: renegotiatedFrom.length > 0 ? renegotiatedFrom : null,
  }
}
