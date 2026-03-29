import { db } from '@/db/client'
import { financialEntries, installments, patients, procedureRecords, procedureTypes, appointments } from '@/db/schema'
import { eq, and, isNull, sql, gte, lte, count, sum, desc } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import type { CreateFinancialEntryInput, FinancialFilterInput } from '@/validations/financial'
import type { PaymentMethod, FinancialStatus } from '@/types'
import { addDays } from 'date-fns'
import { verifyTenantOwnership } from './helpers'

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
      return {
        tenantId,
        financialEntryId: entry.id,
        installmentNumber: i + 1,
        amount: amount.toFixed(2),
        dueDate: addDays(today, i * 30).toISOString().split('T')[0],
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
    conditions.push(gte(financialEntries.createdAt, new Date(filters.dateFrom)))
  }

  if (filters.dateTo) {
    conditions.push(lte(financialEntries.createdAt, new Date(filters.dateTo)))
  }

  const offset = ((filters.page ?? 1) - 1) * (filters.limit ?? 20)

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
        createdAt: financialEntries.createdAt,
        paidInstallments: sql<number>`(
          SELECT COUNT(*)::int FROM floraclin.installments i
          WHERE i.financial_entry_id = ${financialEntries.id}
          AND i.status = 'paid'
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

  return { ...entry, installments: entryInstallments }
}

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
          eq(installments.status, 'pending')
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

export async function getRevenueOverview(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  // Base conditions for installments
  const installmentConditions = [
    eq(installments.tenantId, tenantId),
  ]

  // For filtering by practitioner, we need to join through financialEntries -> procedureRecords
  const entryConditions = [
    eq(financialEntries.tenantId, tenantId),
    isNull(financialEntries.deletedAt),
    gte(financialEntries.createdAt, new Date(dateFrom)),
    lte(financialEntries.createdAt, new Date(dateTo)),
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
        gte(installments.paidAt, new Date(dateFrom)),
        lte(installments.paidAt, new Date(dateTo))
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
        gte(installments.paidAt, new Date(dateFrom)),
        lte(installments.paidAt, new Date(dateTo))
      )
    )
    .groupBy(installments.paymentMethod)

  const [summaryResult, monthlyResult, byProcedureTypeResult, byPaymentMethodResult] =
    await Promise.all([summaryQuery, monthlyQuery, byProcedureTypeQuery, byPaymentMethodQuery])

  return {
    summary: summaryResult[0] ?? { totalReceived: 0, totalPending: 0, totalOverdue: 0 },
    monthly: monthlyResult,
    byProcedureType: byProcedureTypeResult,
    byPaymentMethod: byPaymentMethodResult,
  }
}
