import { db } from '@/db/client'
import {
  financialEntries,
  installments,
  paymentRecords,
  renegotiationLinks,
  financialSettings,
  patients,
} from '@/db/schema'
import { eq, and, isNull, sql, inArray } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import {
  calculateFine,
  calculateInterest,
  getDaysOverdue,
} from '@/lib/financial/penalties'
import type { RenegotiateInput } from '@/validations/financial'
import { addDays } from 'date-fns'

export async function renegotiateCharges(
  tenantId: string,
  userId: string,
  data: RenegotiateInput
) {
  return withTransaction(async (tx) => {
    // 1. Verify all entries belong to tenant and are eligible
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
      throw new Error(`Cobranças não encontradas: ${missing.join(', ')}`)
    }

    // All entries must belong to the same patient
    const patientIds = [...new Set(entries.map((e) => e.patientId))]
    if (patientIds.length > 1) {
      throw new Error('Renegociação só pode consolidar cobranças do mesmo paciente')
    }

    const patientId = patientIds[0]

    // Entries cannot already be renegotiated or cancelled
    const ineligible = entries.filter((e) => e.status === 'renegotiated' || e.status === 'cancelled')
    if (ineligible.length > 0) {
      throw new Error(
        `Cobranças já renegociadas ou canceladas: ${ineligible.map((e) => e.id).join(', ')}`
      )
    }

    // 2. Lock all installments of selected entries with FOR UPDATE
    const lockResult = await tx.execute(
      sql`SELECT * FROM floraclin.installments
          WHERE financial_entry_id = ANY(${data.entryIds}::uuid[])
          AND tenant_id = ${tenantId}
          FOR UPDATE`
    )

    const lockedInstallments = (Array.isArray(lockResult) ? lockResult : (lockResult as any).rows ?? lockResult) as Array<Record<string, unknown>>

    // 3. Load financial settings for penalty calculations
    const [settings] = await tx
      .select()
      .from(financialSettings)
      .where(eq(financialSettings.tenantId, tenantId))
      .limit(1)

    const gracePeriodDays = settings?.gracePeriodDays ?? 0

    // 4. Calculate remaining per entry
    let totalRemainingPrincipal = 0
    let totalPenalties = 0
    const breakdownPerEntry: Array<{
      entryId: string
      remainingPrincipal: number
      penalties: number
    }> = []

    for (const entry of entries) {
      const entryInstallments = lockedInstallments.filter(
        (i) => String(i.financial_entry_id) === entry.id
      )

      let entryRemainingPrincipal = 0
      let entryPenalties = 0

      for (const inst of entryInstallments) {
        const status = String(inst.status)
        if (status === 'paid' || status === 'cancelled') continue

        const amount = Number(inst.amount)
        const amountPaid = Number(inst.amount_paid ?? 0)
        const remainingPrincipal = amount - amountPaid

        entryRemainingPrincipal += remainingPrincipal

        // Calculate penalties as of now
        const appliedFineType = inst.applied_fine_type as string | null
        const appliedFineValue = inst.applied_fine_value != null ? Number(inst.applied_fine_value) : null
        const appliedInterestRate = inst.applied_interest_rate != null ? Number(inst.applied_interest_rate) : null

        const fineType = appliedFineType ?? settings?.fineType ?? 'percentage'
        const fineValue = appliedFineValue ?? Number(settings?.fineValue ?? 2)
        const interestRate = appliedInterestRate ?? Number(settings?.monthlyInterestPercent ?? 1)

        const dueDate = String(inst.due_date)
        const lastCalcAt = inst.last_fine_interest_calc_at
          ? new Date(inst.last_fine_interest_calc_at as string).toISOString()
          : null

        const daysOverdue = getDaysOverdue(
          lastCalcAt ?? dueDate,
          lastCalcAt ? 0 : gracePeriodDays,
        )

        // Fine (stored or calculated)
        let fineAmount = Number(inst.fine_amount ?? 0)
        if (daysOverdue > 0 && amountPaid === 0 && fineAmount === 0) {
          fineAmount = calculateFine(amount, fineType, fineValue)
        }

        // Interest (recalculated)
        const interestAmount = daysOverdue > 0
          ? calculateInterest(remainingPrincipal, daysOverdue, interestRate)
          : 0

        entryPenalties += fineAmount + interestAmount
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
    const newTotalAmount = data.newTotalAmount ?? calculatedTotal

    if (newTotalAmount <= 0) {
      throw new Error('Valor total da renegociação deve ser positivo')
    }

    // 6. Cancel all unpaid installments
    const unpaidInstallmentIds = lockedInstallments
      .filter((i) => String(i.status) !== 'paid')
      .map((i) => String(i.id))

    if (unpaidInstallmentIds.length > 0) {
      await tx
        .update(installments)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(inArray(installments.id, unpaidInstallmentIds))
    }

    // 7. Mark original entries as 'renegotiated'
    const now = new Date()
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
        ?? addDays(now, i * 30).toISOString().split('T')[0]
      return {
        tenantId,
        financialEntryId: newEntry.id,
        installmentNumber: i + 1,
        amount: amount.toFixed(2),
        dueDate,
        status: 'pending' as const,
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
              old: entries.find((e) => e.id === entryId)?.status ?? 'pending',
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
