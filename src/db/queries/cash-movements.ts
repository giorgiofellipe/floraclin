import { db } from '@/db/client'
import {
  cashMovements,
  patients,
  expenseCategories,
  installments,
  financialEntries,
  procedureRecords,
  procedureTypes,
  paymentRecords,
  users,
  tenantUsers,
} from '@/db/schema'
import { eq, and, sql, gte, lte, count, sum, desc, asc } from 'drizzle-orm'
import type { LedgerFilterInput } from '@/validations/financial'

export async function listCashMovements(
  tenantId: string,
  filters: LedgerFilterInput
) {
  const conditions = [
    eq(cashMovements.tenantId, tenantId),
    gte(cashMovements.movementDate, new Date(filters.dateFrom)),
    lte(cashMovements.movementDate, new Date(filters.dateTo)),
  ]

  if (filters.type && filters.type !== 'all') {
    conditions.push(eq(cashMovements.type, filters.type))
  }

  if (filters.paymentMethod) {
    conditions.push(eq(cashMovements.paymentMethod, filters.paymentMethod))
  }

  if (filters.patientId) {
    conditions.push(eq(cashMovements.patientId, filters.patientId))
  }

  if (filters.categoryId) {
    conditions.push(eq(cashMovements.expenseCategoryId, filters.categoryId))
  }

  const whereClause = and(...conditions)
  const limit = filters.limit ?? 50
  const offset = ((filters.page ?? 1) - 1) * limit

  const [totalResult, movements] = await Promise.all([
    db
      .select({ count: count() })
      .from(cashMovements)
      .where(whereClause),
    db
      .select({
        id: cashMovements.id,
        type: cashMovements.type,
        amount: cashMovements.amount,
        description: cashMovements.description,
        paymentMethod: cashMovements.paymentMethod,
        movementDate: cashMovements.movementDate,
        patientName: patients.fullName,
        categoryName: expenseCategories.name,
        runningBalance: sql<number>`SUM(
          CASE WHEN ${cashMovements.type} = 'inflow'
            THEN ${cashMovements.amount}::numeric
            ELSE -${cashMovements.amount}::numeric
          END
        ) OVER (
          ORDER BY ${cashMovements.movementDate} ASC, ${cashMovements.recordedAt} ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )`,
      })
      .from(cashMovements)
      .leftJoin(patients, eq(patients.id, cashMovements.patientId))
      .leftJoin(expenseCategories, eq(expenseCategories.id, cashMovements.expenseCategoryId))
      .where(whereClause)
      .orderBy(desc(cashMovements.movementDate), desc(cashMovements.recordedAt))
      .limit(limit)
      .offset(offset),
  ])

  const total = totalResult[0]?.count ?? 0

  return {
    data: movements,
    total,
    page: filters.page ?? 1,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export async function getLedgerSummary(
  tenantId: string,
  dateFrom: string,
  dateTo: string
) {
  const conditions = [
    eq(cashMovements.tenantId, tenantId),
    gte(cashMovements.movementDate, new Date(dateFrom)),
    lte(cashMovements.movementDate, new Date(dateTo)),
  ]

  const [summaryResult, overdueResult] = await Promise.all([
    db
      .select({
        totalInflows: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.type} = 'inflow' THEN ${cashMovements.amount}::numeric ELSE 0 END), 0)`,
        totalOutflows: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.type} = 'outflow' THEN ${cashMovements.amount}::numeric ELSE 0 END), 0)`,
        netResult: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.type} = 'inflow' THEN ${cashMovements.amount}::numeric ELSE -${cashMovements.amount}::numeric END), 0)`,
      })
      .from(cashMovements)
      .where(and(...conditions)),
    db
      .select({
        overdueReceivables: sql<number>`COALESCE(SUM((${installments.amount}::numeric + ${installments.fineAmount}::numeric + ${installments.interestAmount}::numeric) - ${installments.amountPaid}::numeric), 0)`,
      })
      .from(installments)
      .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
      .where(
        and(
          eq(installments.tenantId, tenantId),
          sql`${installments.dueDate} < CURRENT_DATE`,
          eq(installments.status, 'pending')
        )
      ),
  ])

  const summary = summaryResult[0] ?? { totalInflows: 0, totalOutflows: 0, netResult: 0 }
  const overdue = overdueResult[0] ?? { overdueReceivables: 0 }

  return {
    totalInflows: summary.totalInflows,
    totalOutflows: summary.totalOutflows,
    netResult: summary.netResult,
    overdueReceivables: overdue.overdueReceivables,
  }
}

export async function getPractitionerPL(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  const dateFromTs = new Date(dateFrom)
  const dateToTs = new Date(dateTo)

  // Base practitioner condition
  const practitionerCondition = practitionerId
    ? sql`AND pr.practitioner_id = ${practitionerId}`
    : sql``

  // a. Revenue Generated (accrual): sum of financial_entries.totalAmount by procedure creation date
  const revenueGeneratedQuery = db.execute<{
    practitioner_id: string
    practitioner_name: string
    revenue_generated: number
    procedure_count: number
  }>(sql`
    SELECT
      pr.practitioner_id,
      u.full_name AS practitioner_name,
      COALESCE(SUM(fe.total_amount::numeric), 0) AS revenue_generated,
      COUNT(pr.id)::int AS procedure_count
    FROM floraclin.procedure_records pr
    INNER JOIN floraclin.financial_entries fe ON fe.procedure_record_id = pr.id
      AND fe.deleted_at IS NULL
    INNER JOIN floraclin.users u ON u.id = pr.practitioner_id
    INNER JOIN floraclin.tenant_users tu ON tu.user_id = pr.practitioner_id
      AND tu.tenant_id = ${tenantId}
      AND tu.is_active = true
    WHERE pr.tenant_id = ${tenantId}
      AND pr.deleted_at IS NULL
      AND pr.created_at >= ${dateFromTs}
      AND pr.created_at <= ${dateToTs}
      ${practitionerCondition}
    GROUP BY pr.practitioner_id, u.full_name
  `)

  // b. Revenue Collected (cash): sum of payment_records.principalCovered by payment date
  const revenueCollectedQuery = db.execute<{
    practitioner_id: string
    revenue_collected: number
  }>(sql`
    SELECT
      pr.practitioner_id,
      COALESCE(SUM(payrec.principal_covered::numeric), 0) AS revenue_collected
    FROM floraclin.payment_records payrec
    INNER JOIN floraclin.installments i ON i.id = payrec.installment_id
    INNER JOIN floraclin.financial_entries fe ON fe.id = i.financial_entry_id
      AND fe.deleted_at IS NULL
    INNER JOIN floraclin.procedure_records pr ON pr.id = fe.procedure_record_id
      AND pr.deleted_at IS NULL
    WHERE i.tenant_id = ${tenantId}
      AND payrec.paid_at >= ${dateFromTs}
      AND payrec.paid_at <= ${dateToTs}
      ${practitionerCondition}
    GROUP BY pr.practitioner_id
  `)

  // e. By procedure type: GROUP BY procedureType name
  const byProcedureTypeQuery = db.execute<{
    practitioner_id: string
    procedure_type_name: string
    type_revenue: number
    type_count: number
  }>(sql`
    SELECT
      pr.practitioner_id,
      COALESCE(pt.name, 'Outros') AS procedure_type_name,
      COALESCE(SUM(fe.total_amount::numeric), 0) AS type_revenue,
      COUNT(pr.id)::int AS type_count
    FROM floraclin.procedure_records pr
    INNER JOIN floraclin.financial_entries fe ON fe.procedure_record_id = pr.id
      AND fe.deleted_at IS NULL
    LEFT JOIN floraclin.procedure_types pt ON pt.id = pr.procedure_type_id
    WHERE pr.tenant_id = ${tenantId}
      AND pr.deleted_at IS NULL
      AND pr.created_at >= ${dateFromTs}
      AND pr.created_at <= ${dateToTs}
      ${practitionerCondition}
    GROUP BY pr.practitioner_id, pt.name
  `)

  const [revenueGenerated, revenueCollected, byProcedureType] = await Promise.all([
    revenueGeneratedQuery,
    revenueCollectedQuery,
    byProcedureTypeQuery,
  ])

  // Build lookup maps
  const collectedMap = new Map<string, number>()
  for (const row of revenueCollected) {
    collectedMap.set(row.practitioner_id, Number(row.revenue_collected))
  }

  const procedureTypeMap = new Map<string, Array<{ name: string; revenue: number; count: number }>>()
  for (const row of byProcedureType) {
    const existing = procedureTypeMap.get(row.practitioner_id) ?? []
    existing.push({
      name: row.procedure_type_name,
      revenue: Number(row.type_revenue),
      count: Number(row.type_count),
    })
    procedureTypeMap.set(row.practitioner_id, existing)
  }

  // Assemble practitioner objects
  const practitioners = revenueGenerated.map((row) => {
    const revenueGen = Number(row.revenue_generated)
    const procedureCount = Number(row.procedure_count)
    const revenueCol = collectedMap.get(row.practitioner_id) ?? 0
    const avgTicket = procedureCount > 0 ? revenueGen / procedureCount : 0

    return {
      practitionerId: row.practitioner_id,
      practitionerName: row.practitioner_name,
      revenueGenerated: revenueGen,
      revenueCollected: revenueCol,
      procedureCount,
      averageTicket: Math.round(avgTicket * 100) / 100,
      byProcedureType: procedureTypeMap.get(row.practitioner_id) ?? [],
    }
  })

  return practitioners
}

export async function exportLedgerCSV(
  tenantId: string,
  filters: Omit<LedgerFilterInput, 'page' | 'limit'>
) {
  const conditions = [
    eq(cashMovements.tenantId, tenantId),
    gte(cashMovements.movementDate, new Date(filters.dateFrom)),
    lte(cashMovements.movementDate, new Date(filters.dateTo)),
  ]

  if (filters.type && filters.type !== 'all') {
    conditions.push(eq(cashMovements.type, filters.type))
  }

  if (filters.paymentMethod) {
    conditions.push(eq(cashMovements.paymentMethod, filters.paymentMethod))
  }

  if (filters.patientId) {
    conditions.push(eq(cashMovements.patientId, filters.patientId))
  }

  if (filters.categoryId) {
    conditions.push(eq(cashMovements.expenseCategoryId, filters.categoryId))
  }

  const movements = await db
    .select({
      type: cashMovements.type,
      amount: cashMovements.amount,
      description: cashMovements.description,
      paymentMethod: cashMovements.paymentMethod,
      movementDate: cashMovements.movementDate,
      patientName: patients.fullName,
      categoryName: expenseCategories.name,
    })
    .from(cashMovements)
    .leftJoin(patients, eq(patients.id, cashMovements.patientId))
    .leftJoin(expenseCategories, eq(expenseCategories.id, cashMovements.expenseCategoryId))
    .where(and(...conditions))
    .orderBy(asc(cashMovements.movementDate), asc(cashMovements.recordedAt))

  const paymentMethodLabels: Record<string, string> = {
    pix: 'PIX',
    credit_card: 'Cartao de Credito',
    debit_card: 'Cartao de Debito',
    cash: 'Dinheiro',
    transfer: 'Transferencia',
  }

  const header = 'Data,Tipo,Descricao,Paciente/Categoria,Metodo,Valor'
  const rows = movements.map((m) => {
    const date = m.movementDate
      ? new Date(m.movementDate).toLocaleDateString('pt-BR')
      : ''
    const tipo = m.type === 'inflow' ? 'Entrada' : 'Saida'
    const desc = `"${(m.description ?? '').replace(/"/g, '""')}"`
    const ref = m.patientName
      ? `"${m.patientName.replace(/"/g, '""')}"`
      : m.categoryName
        ? `"${m.categoryName.replace(/"/g, '""')}"`
        : ''
    const method = paymentMethodLabels[m.paymentMethod ?? ''] ?? m.paymentMethod ?? ''
    const sign = m.type === 'outflow' ? '-' : ''
    const valor = `${sign}${m.amount}`

    return `${date},${tipo},${desc},${ref},${method},${valor}`
  })

  return `${header}\n${rows.join('\n')}`
}
