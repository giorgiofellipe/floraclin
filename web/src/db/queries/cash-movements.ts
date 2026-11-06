import { db } from '@/db/client'
import {
  cashMovements,
  financialAccounts,
  patients,
  expenseCategories,
  procedureRecords,
  procedureTypes,
  paymentRecords,
  users,
  tenantUsers,
} from '@/db/schema'
import { eq, and, sql, count, sum, desc, asc, gte, lte } from 'drizzle-orm'
import type { LedgerFilterInput } from '@/validations/financial'
import { startOfBrDay, endOfBrDay } from '@/lib/dates'
import { quoteInstallment, round2 } from '@/lib/financial/penalties'
import {
  loadLivePaymentsByInstallment,
  loadOverdueInstallments,
  toInstallmentBase,
  toPaymentInputs,
} from './financial'

/** The one filter every ledger read applies, so list, summary and export agree. */
function ledgerConditions(tenantId: string, filters: Omit<LedgerFilterInput, 'page' | 'limit'>) {
  const conditions = [
    eq(cashMovements.tenantId, tenantId),
    gte(cashMovements.movementDate, startOfBrDay(filters.dateFrom)),
    lte(cashMovements.movementDate, endOfBrDay(filters.dateTo)),
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

  if (filters.accountId) {
    conditions.push(eq(cashMovements.accountId, filters.accountId))
  }

  return conditions
}

// Both columns carry the tenant, so a movement only ever shows its own clinic's account.
const accountJoin = and(
  eq(financialAccounts.id, cashMovements.accountId),
  eq(financialAccounts.tenantId, cashMovements.tenantId),
)

export async function listCashMovements(
  tenantId: string,
  filters: LedgerFilterInput,
  opts: { accountBalance?: boolean } = {},
) {
  const whereClause = and(...ledgerConditions(tenantId, filters))
  const limit = filters.limit ?? 50
  const offset = ((filters.page ?? 1) - 1) * limit

  // By default: the running sum of the rows the filters show, as before.
  // With accountBalance and an account filter: that account's balance after
  // each movement, counted the way listFinancialAccounts counts it (opening
  // balance from the start of its BR day, every movement of the account since,
  // whatever the other filters hide), so the newest row matches the account's
  // balance. Only roles that may see account balances ask for it.
  const runningBalance = filters.accountId && opts.accountBalance
    ? sql<number>`(
        SELECT COALESCE(SUM(CASE WHEN m2.type = 'inflow' THEN m2.amount::numeric ELSE -m2.amount::numeric END), 0)
          + CASE WHEN fa.opening_balance_date IS NULL
                   OR ${cashMovements.movementDate} >= (fa.opening_balance_date::timestamp AT TIME ZONE 'America/Sao_Paulo')
                 THEN fa.opening_balance ELSE 0 END
        FROM floraclin.financial_accounts fa
        LEFT JOIN floraclin.cash_movements m2
          ON m2.tenant_id = fa.tenant_id
         AND m2.account_id = fa.id
         AND (fa.opening_balance_date IS NULL
              OR m2.movement_date >= (fa.opening_balance_date::timestamp AT TIME ZONE 'America/Sao_Paulo'))
         AND (m2.movement_date, m2.recorded_at, m2.id)
             <= (${cashMovements.movementDate}, ${cashMovements.recordedAt}, ${cashMovements.id})
        WHERE fa.tenant_id = ${cashMovements.tenantId} AND fa.id = ${cashMovements.accountId}
        GROUP BY fa.id
      )`
    : sql<number>`SUM(
        CASE WHEN ${cashMovements.type} = 'inflow'
          THEN ${cashMovements.amount}::numeric
          ELSE -${cashMovements.amount}::numeric
        END
      ) OVER (
        ORDER BY ${cashMovements.movementDate} ASC, ${cashMovements.recordedAt} ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )`

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
        accountId: cashMovements.accountId,
        accountName: financialAccounts.name,
        isTransfer: sql<boolean>`${cashMovements.transferGroupId} IS NOT NULL`,
        // Matched to a bank statement line: it can't change account until undone.
        isReconciled: sql<boolean>`EXISTS (
          SELECT 1 FROM floraclin.bank_reconciliation_allocations bra
          WHERE bra.tenant_id = ${cashMovements.tenantId}
            AND bra.movement_id = ${cashMovements.id}
            AND bra.undone_at IS NULL
        )`,
        runningBalance,
      })
      .from(cashMovements)
      .leftJoin(patients, eq(patients.id, cashMovements.patientId))
      .leftJoin(expenseCategories, eq(expenseCategories.id, cashMovements.expenseCategoryId))
      .leftJoin(financialAccounts, accountJoin)
      .where(whereClause)
      // id last: movements written in one transaction share recorded_at.
      .orderBy(desc(cashMovements.movementDate), desc(cashMovements.recordedAt), desc(cashMovements.id))
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
  filters: LedgerFilterInput
) {
  const conditions = ledgerConditions(tenantId, filters)
  // Transfers move money between the clinic's own accounts: they are not
  // revenue or expense, so they stay out of the three totals and are summed
  // apart, which is what an account-filtered view needs to reach its balance.
  const notTransfer = sql`${cashMovements.transferGroupId} IS NULL`
  const isTransfer = sql`${cashMovements.transferGroupId} IS NOT NULL`

  const now = new Date()
  const [summaryResult, overdueInstallments] = await Promise.all([
    db
      .select({
        totalInflows: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.type} = 'inflow' AND ${notTransfer} THEN ${cashMovements.amount}::numeric ELSE 0 END), 0)`,
        totalOutflows: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.type} = 'outflow' AND ${notTransfer} THEN ${cashMovements.amount}::numeric ELSE 0 END), 0)`,
        netResult: sql<number>`COALESCE(SUM(CASE WHEN ${notTransfer} THEN (CASE WHEN ${cashMovements.type} = 'inflow' THEN ${cashMovements.amount}::numeric ELSE -${cashMovements.amount}::numeric END) ELSE 0 END), 0)`,
        transfersIn: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.type} = 'inflow' AND ${isTransfer} THEN ${cashMovements.amount}::numeric ELSE 0 END), 0)`,
        transfersOut: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.type} = 'outflow' AND ${isTransfer} THEN ${cashMovements.amount}::numeric ELSE 0 END), 0)`,
      })
      .from(cashMovements)
      .where(and(...conditions)),
    loadOverdueInstallments(tenantId, now),
  ])

  const paymentsByInstallment = await loadLivePaymentsByInstallment(
    db,
    overdueInstallments.map((i) => i.id),
  )
  let overdueReceivables = 0
  for (const inst of overdueInstallments) {
    const quote = quoteInstallment(
      toInstallmentBase(inst),
      toPaymentInputs(paymentsByInstallment.get(inst.id) ?? []),
      now,
    )
    overdueReceivables = round2(overdueReceivables + quote.totalDue)
  }

  const summary = summaryResult[0] ?? {
    totalInflows: 0,
    totalOutflows: 0,
    netResult: 0,
    transfersIn: 0,
    transfersOut: 0,
  }

  return {
    totalInflows: summary.totalInflows,
    totalOutflows: summary.totalOutflows,
    netResult: summary.netResult,
    transfersIn: summary.transfersIn ?? 0,
    transfersOut: summary.transfersOut ?? 0,
    overdueReceivables,
  }
}

export interface PractitionerPLRow {
  practitionerId: string
  practitionerName: string
  revenueGenerated: number
  revenueCollected: number
  procedureCount: number
  averageTicket: number
  byProcedureType: { name: string; revenue: number; count: number }[]
}

export async function getPractitionerPL(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
): Promise<PractitionerPLRow[]> {
  // BR-local day boundaries as unambiguous ISO UTC strings. Postgres parses
  // `timestamptz` comparisons against these correctly regardless of session TZ.
  const dateFromTs = startOfBrDay(dateFrom).toISOString()
  const dateToTs = endOfBrDay(dateTo).toISOString()

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
  const conditions = ledgerConditions(tenantId, filters)

  const movements = await db
    .select({
      type: cashMovements.type,
      amount: cashMovements.amount,
      description: cashMovements.description,
      paymentMethod: cashMovements.paymentMethod,
      movementDate: cashMovements.movementDate,
      patientName: patients.fullName,
      categoryName: expenseCategories.name,
      accountName: financialAccounts.name,
    })
    .from(cashMovements)
    .leftJoin(patients, eq(patients.id, cashMovements.patientId))
    .leftJoin(expenseCategories, eq(expenseCategories.id, cashMovements.expenseCategoryId))
    .leftJoin(financialAccounts, accountJoin)
    .where(and(...conditions))
    .orderBy(asc(cashMovements.movementDate), asc(cashMovements.recordedAt))

  const paymentMethodLabels: Record<string, string> = {
    pix: 'PIX',
    credit_card: 'Cartao de Credito',
    debit_card: 'Cartao de Debito',
    cash: 'Dinheiro',
    transfer: 'Transferencia',
  }

  // Conta goes last so spreadsheets built on the earlier columns keep working.
  const header = 'Data,Tipo,Descricao,Paciente/Categoria,Metodo,Valor,Conta'
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
    const conta = m.accountName ? `"${m.accountName.replace(/"/g, '""')}"` : ''

    return `${date},${tipo},${desc},${ref},${method},${valor},${conta}`
  })

  return `${header}\n${rows.join('\n')}`
}
