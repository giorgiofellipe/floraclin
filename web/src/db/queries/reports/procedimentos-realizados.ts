import { db } from '@/db/client'
import { productApplications, procedureRecords, patients, users } from '@/db/schema'
import { and, eq, isNull, desc, gte, lte, sql } from 'drizzle-orm'
import { startOfBrDay, endOfBrDay } from '@/lib/dates'
import { directionalCompare, type SortDirection } from '@/lib/reports/sort'

export interface ProcedureApplicationRow {
  id: string
  performedAt: Date
  patientName: string
  practitionerName: string
  productName: string
  activeIngredient: string | null
  totalQuantity: number
  quantityUnit: string
  batchNumber: string | null
  expirationDate: string | null
}

/** Server-recognized sort keys for this report. */
export type ProcedureApplicationSortKey = 'performedAt' | 'patientName' | 'practitionerName' | 'productName'

export interface ListProcedureApplicationsOptions {
  dateFrom: string
  dateTo: string
  practitionerId?: string
  sort?: { key: ProcedureApplicationSortKey; dir: SortDirection }
}

const SORT_ACCESSORS: Record<
  ProcedureApplicationSortKey,
  (row: ProcedureApplicationRow) => string | number | null
> = {
  performedAt: (row) => row.performedAt.getTime(),
  patientName: (row) => row.patientName,
  practitionerName: (row) => row.practitionerName,
  productName: (row) => row.productName,
}

// Applied after sorting, same precedent as the other reports.
const MAX_ROWS = 200

/**
 * Lot-level traceability log: one row per `product_applications` record,
 * the record a clinic hands over if an application is ever questioned.
 *
 * Scoped to procedures that were actually performed
 * (`procedure_records.performed_at IS NOT NULL`), not merely planned:
 * a product application only exists once execution happened (see
 * `web/src/lib/session-execute.ts`), so this also implicitly excludes
 * draft/planned/approved records that never reached execution.
 */
export async function listProcedureApplications(
  tenantId: string,
  { dateFrom, dateTo, practitionerId, sort }: ListProcedureApplicationsOptions,
): Promise<ProcedureApplicationRow[]> {
  const conditions = [
    eq(productApplications.tenantId, tenantId),
    eq(procedureRecords.tenantId, tenantId),
    isNull(procedureRecords.deletedAt),
    isNull(patients.deletedAt),
    isNull(users.deletedAt),
    sql`${procedureRecords.performedAt} IS NOT NULL`,
    gte(procedureRecords.performedAt, startOfBrDay(dateFrom)),
    lte(procedureRecords.performedAt, endOfBrDay(dateTo)),
  ]

  if (practitionerId) {
    conditions.push(eq(procedureRecords.practitionerId, practitionerId))
  }

  const rows = await db
    .select({
      id: productApplications.id,
      performedAt: procedureRecords.performedAt,
      patientName: patients.fullName,
      practitionerName: users.fullName,
      productName: productApplications.productName,
      activeIngredient: productApplications.activeIngredient,
      totalQuantity: productApplications.totalQuantity,
      quantityUnit: productApplications.quantityUnit,
      batchNumber: productApplications.batchNumber,
      expirationDate: productApplications.expirationDate,
    })
    .from(productApplications)
    .innerJoin(procedureRecords, eq(productApplications.procedureRecordId, procedureRecords.id))
    .innerJoin(patients, eq(procedureRecords.patientId, patients.id))
    .innerJoin(users, eq(procedureRecords.practitionerId, users.id))
    .where(and(...conditions))
    .orderBy(desc(procedureRecords.performedAt))

  const mapped: ProcedureApplicationRow[] = rows.map((row) => ({
    id: row.id,
    // performedAt IS NOT NULL is enforced by the WHERE clause above, but the
    // column itself is nullable so the select type carries `Date | null`.
    performedAt: row.performedAt as Date,
    patientName: row.patientName,
    practitionerName: row.practitionerName,
    productName: row.productName,
    activeIngredient: row.activeIngredient,
    totalQuantity: Number(row.totalQuantity),
    quantityUnit: row.quantityUnit,
    batchNumber: row.batchNumber,
    expirationDate: row.expirationDate,
  }))

  if (sort) {
    const accessor = SORT_ACCESSORS[sort.key]
    mapped.sort((a, b) => directionalCompare(accessor(a), accessor(b), sort.dir))
  }

  return mapped.slice(0, MAX_ROWS)
}
