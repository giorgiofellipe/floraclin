import { db } from '@/db/client'
import { patients, procedureRecords, procedureTypes, financialEntries, installments } from '@/db/schema'
import { and, eq, isNull, sql, desc } from 'drizzle-orm'
import { subDays } from 'date-fns'
import { parseBrDate, toBrYmd, startOfBrDay } from '@/lib/dates'
import { directionalCompare, type SortDirection } from '@/lib/reports/sort'

export interface InactivePatientRow {
  patientId: string
  fullName: string
  phone: string
  lastProcedureAt: string | null
  daysSince: number
  lastProcedureType: string | null
  lifetimeValue: number
}

/** Server-recognized sort keys for this report. The route validates an
 *  incoming `sort` query param against this same list before it ever reaches
 *  this function. */
export type InactivePatientSortKey = 'fullName' | 'lastProcedureAt' | 'daysSince' | 'lifetimeValue'

export interface ListInactivePatientsOptions {
  thresholdDays: number
  today: Date
  /** Explicit sort requested by the caller. When absent, rows keep the
   *  default urgency order (lifetime value descending). */
  sort?: { key: InactivePatientSortKey; dir: SortDirection }
}

const SORT_ACCESSORS: Record<
  InactivePatientSortKey,
  (row: InactivePatientRow) => string | number | null
> = {
  fullName: (row) => row.fullName,
  lastProcedureAt: (row) => row.lastProcedureAt,
  daysSince: (row) => row.daysSince,
  lifetimeValue: (row) => row.lifetimeValue,
}

/**
 * Recall report: patients who have gone quiet.
 *
 * A patient is "inactive" when EITHER:
 *   (a) their most recent `procedure_records.performed_at` is older than
 *       `thresholdDays`, or
 *   (b) they have no procedure record at all and `patients.created_at` is
 *       older than `thresholdDays`.
 *
 * `thresholdDays` is a day count, but `performed_at`/`created_at` are
 * `timestamptz` instants, so the boundary is resolved in BR calendar days:
 * a record dated exactly `thresholdDays` ago is still within the grace
 * period (excluded), one day further back is not (included). `today` is
 * taken as a parameter rather than read from `Date.now()` so callers (and
 * tests) control the reference instant explicitly.
 *
 * Ordered by lifetime value (sum of paid installments) descending, so the
 * clinic calls the highest-value lapsed patient first, capped at `MAX_ROWS`
 * (applied after sorting, matching the precedent in
 * `web/src/db/queries/followups.ts`, so the cap keeps the highest-value
 * rows rather than an arbitrary DB-order slice).
 */
const MAX_ROWS = 200

export async function listInactivePatients(
  tenantId: string,
  { thresholdDays, today, sort }: ListInactivePatientsOptions,
): Promise<InactivePatientRow[]> {
  const todayYmd = toBrYmd(today)
  const todayInstant = parseBrDate(todayYmd)
  const cutoffYmd = toBrYmd(subDays(todayInstant, thresholdDays))
  const cutoffInstant = startOfBrDay(cutoffYmd)

  const [allPatients, lastProcedures, lifetimeValues] = await Promise.all([
    db
      .select({
        id: patients.id,
        fullName: patients.fullName,
        phone: patients.phone,
        createdAt: patients.createdAt,
      })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), isNull(patients.deletedAt))),
    db
      .selectDistinctOn([procedureRecords.patientId], {
        patientId: procedureRecords.patientId,
        performedAt: procedureRecords.performedAt,
        procedureTypeName: procedureTypes.name,
      })
      .from(procedureRecords)
      .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
      .where(
        and(
          eq(procedureRecords.tenantId, tenantId),
          isNull(procedureRecords.deletedAt),
          sql`${procedureRecords.performedAt} IS NOT NULL`,
        ),
      )
      .orderBy(procedureRecords.patientId, desc(procedureRecords.performedAt)),
    db
      .select({
        patientId: financialEntries.patientId,
        total: sql<number>`COALESCE(SUM(${installments.amount}::numeric), 0)`,
      })
      .from(installments)
      .innerJoin(financialEntries, eq(installments.financialEntryId, financialEntries.id))
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          isNull(financialEntries.deletedAt),
          eq(installments.status, 'paid'),
        ),
      )
      .groupBy(financialEntries.patientId),
  ])

  const lastProcedureMap = new Map(lastProcedures.map((row) => [row.patientId, row]))
  const lifetimeValueMap = new Map(lifetimeValues.map((row) => [row.patientId, Number(row.total)]))

  const rows: InactivePatientRow[] = []

  for (const patient of allPatients) {
    const lifetimeValue = lifetimeValueMap.get(patient.id) ?? 0
    const last = lastProcedureMap.get(patient.id)

    if (last?.performedAt) {
      if (last.performedAt >= cutoffInstant) continue

      const lastYmd = toBrYmd(last.performedAt)
      const daysSince = Math.round(
        (todayInstant.getTime() - parseBrDate(lastYmd).getTime()) / 86_400_000,
      )

      rows.push({
        patientId: patient.id,
        fullName: patient.fullName,
        phone: patient.phone,
        lastProcedureAt: lastYmd,
        daysSince,
        lastProcedureType: last.procedureTypeName,
        lifetimeValue,
      })
      continue
    }

    // Never treated: fall back to how long they have been a patient at all.
    if (patient.createdAt >= cutoffInstant) continue

    const createdYmd = toBrYmd(patient.createdAt)
    const daysSince = Math.round(
      (todayInstant.getTime() - parseBrDate(createdYmd).getTime()) / 86_400_000,
    )

    rows.push({
      patientId: patient.id,
      fullName: patient.fullName,
      phone: patient.phone,
      lastProcedureAt: null,
      daysSince,
      lastProcedureType: null,
      lifetimeValue,
    })
  }

  if (sort) {
    const accessor = SORT_ACCESSORS[sort.key]
    rows.sort((a, b) => directionalCompare(accessor(a), accessor(b), sort.dir))
  } else {
    // Default urgency order: highest lifetime value first, so the clinic
    // calls the most valuable lapsed patient before a lower-value one.
    rows.sort((a, b) => b.lifetimeValue - a.lifetimeValue)
  }

  // The cap MUST apply after sorting, not before: with an explicit sort the
  // "top 200" has to be the top 200 of the requested order, not an arbitrary
  // 200-row slice re-sorted afterward.
  return rows.slice(0, MAX_ROWS)
}
