import { db } from '@/db/client'
import { cashMovements, patients, expenseCategories } from '@/db/schema'
import { and, eq, desc, gte, lte } from 'drizzle-orm'
import { startOfBrDay, endOfBrDay } from '@/lib/dates'
import { directionalCompare, type SortDirection } from '@/lib/reports/sort'

export interface LedgerReportRow {
  type: 'inflow' | 'outflow'
  amount: number
  description: string
  paymentMethod: string | null
  movementDate: Date
  patientName: string | null
  categoryName: string | null
}

/** Server-recognized sort keys for this report. */
export type LedgerReportSortKey = 'movementDate' | 'type' | 'amount'

export interface ListLedgerReportOptions {
  dateFrom: string
  dateTo: string
  sort?: { key: LedgerReportSortKey; dir: SortDirection }
}

const SORT_ACCESSORS: Record<LedgerReportSortKey, (row: LedgerReportRow) => string | number | null> = {
  movementDate: (row) => row.movementDate.getTime(),
  type: (row) => row.type,
  amount: (row) => row.amount,
}

// Applied after sorting, same precedent as the other reports (see
// listInactivePatients). This only bounds the on-screen table and the PDF:
// the CSV branch of this report's route calls `exportLedgerCSV` directly
// (see web/src/db/queries/cash-movements.ts) and does not go through this
// cap, because the spec requires that CSV to stay byte-compatible with the
// pre-existing, uncapped `/api/financial/ledger/export` output.
const MAX_ROWS = 200

/**
 * Cash-ledger rows for the "Extrato por período" report's on-screen table
 * and PDF export. Selects from `cash_movements` with the exact same
 * tenant/date-range condition `exportLedgerCSV` uses (cf.
 * `web/src/db/queries/cash-movements.ts`), so the numbers on screen, in the
 * PDF and in the CSV always agree even though the CSV branch is produced by
 * a different function (see `MAX_ROWS` above for why).
 *
 * `cash_movements` has no `deleted_at` column: corrections happen via a
 * reversing entry (`reversed_by_movement_id`), not a soft delete, matching
 * every other reader of this table.
 */
export async function listLedgerReportRows(
  tenantId: string,
  { dateFrom, dateTo, sort }: ListLedgerReportOptions,
): Promise<LedgerReportRow[]> {
  const rows = await db
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
    .where(
      and(
        eq(cashMovements.tenantId, tenantId),
        gte(cashMovements.movementDate, startOfBrDay(dateFrom)),
        lte(cashMovements.movementDate, endOfBrDay(dateTo)),
      ),
    )
    .orderBy(desc(cashMovements.movementDate))

  const mapped: LedgerReportRow[] = rows.map((row) => ({
    type: row.type as 'inflow' | 'outflow',
    amount: Number(row.amount),
    description: row.description,
    paymentMethod: row.paymentMethod,
    movementDate: row.movementDate,
    patientName: row.patientName,
    categoryName: row.categoryName,
  }))

  if (sort) {
    const accessor = SORT_ACCESSORS[sort.key]
    mapped.sort((a, b) => directionalCompare(accessor(a), accessor(b), sort.dir))
  }

  return mapped.slice(0, MAX_ROWS)
}
