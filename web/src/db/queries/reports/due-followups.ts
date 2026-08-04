import { db } from '@/db/client'
import { patients, procedureRecords, procedureTypes, appointments } from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { addDays, subDays } from 'date-fns'
import { parseBrDate, toBrYmd } from '@/lib/dates'
import { directionalCompare, type SortDirection } from '@/lib/reports/sort'

/** Appointment statuses that mean "the patient is already booked". */
const ACTIVE_APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'in_progress'] as const

/**
 * `procedure_records.status` values that do not represent a real, delivered
 * procedure and must never surface a follow-up: `draft` (data entry never
 * finished) and `cancelled` (the procedure never happened). Every other
 * status (`planned`, `approved`, `in_progress`, `completed`) is a live
 * record that can carry a meaningful follow-up date.
 */
const EXCLUDED_STATUSES = new Set(['draft', 'cancelled'])

/** Report results are capped at this many rows, matching the precedent in
 *  `web/src/db/queries/followups.ts`. Applied after sorting so the cap keeps
 *  the most overdue rows, not an arbitrary DB-order slice. */
const MAX_ROWS = 200

export interface DueFollowUpRow {
  patientId: string
  fullName: string
  phone: string
  followUpDate: string
  daysUntil: number
  isOverdue: boolean
  procedureTypeName: string
  lastProcedureAt: string | null
}

/** Server-recognized sort keys for this report. The route validates an
 *  incoming `sort` query param against this same list before it ever reaches
 *  this function. */
export type DueFollowUpSortKey = 'fullName' | 'followUpDate' | 'daysUntil'

export interface ListDueFollowUpsOptions {
  windowDays: number
  today: Date
  /** Explicit sort requested by the caller. When absent, rows keep the
   *  default order (`follow_up_date` ascending, most overdue first). */
  sort?: { key: DueFollowUpSortKey; dir: SortDirection }
}

const SORT_ACCESSORS: Record<DueFollowUpSortKey, (row: DueFollowUpRow) => string | number | null> = {
  fullName: (row) => row.fullName,
  followUpDate: (row) => row.followUpDate,
  daysUntil: (row) => row.daysUntil,
}

/**
 * Recall report: patients whose procedure follow-up is due soon or already
 * overdue, minus anyone already booked.
 *
 * Includes `procedure_records.follow_up_date` within
 * `[today - windowDays, today + windowDays]`, both upcoming (today or later)
 * and overdue (before today, flagged via `isOverdue`): the overdue side is
 * bounded by the same `windowDays` rather than reaching back indefinitely, so
 * the report stays a recall list rather than a full historical dump. Excludes
 * any patient who already has a future appointment (today or later) in
 * `scheduled`, `confirmed` or `in_progress`, since that is the point of the
 * report: chasing a patient who is already booked is noise.
 *
 * Also excludes records that do not represent a real, delivered procedure
 * (status `draft` or `cancelled`, or `cancelled_at` set, checked
 * independently of `status` as a safety net in case the two ever disagree)
 * and records currently snoozed: `followup_snoozed_until` set to a day after
 * today. A snooze that expired on or before today no longer suppresses the
 * row, matching `web/src/db/queries/followups.ts`'s
 * `listOpenPlanejamentos`. This filtering happens in JS rather than the SQL
 * WHERE clause, same as the window/booked-patient logic below, so it is one
 * thing to reason about and one thing tests exercise directly.
 *
 * `follow_up_date` is a `date` column holding a BR calendar day, stored and
 * compared as a `YYYY-MM-DD` string throughout. It is never passed through
 * `new Date()`. `today` is taken as a parameter rather than read from
 * `Date.now()` so callers (and tests) control the reference instant
 * explicitly.
 *
 * Ordered by `follow_up_date` ascending (most overdue first), capped at
 * `MAX_ROWS`.
 */
export async function listDueFollowUps(
  tenantId: string,
  { windowDays, today, sort }: ListDueFollowUpsOptions,
): Promise<DueFollowUpRow[]> {
  const todayYmd = toBrYmd(today)
  const windowStartYmd = toBrYmd(subDays(parseBrDate(todayYmd), windowDays))
  const windowEndYmd = toBrYmd(addDays(parseBrDate(todayYmd), windowDays))

  const [dueRecords, tenantAppointments] = await Promise.all([
    db
      .select({
        patientId: patients.id,
        fullName: patients.fullName,
        phone: patients.phone,
        followUpDate: procedureRecords.followUpDate,
        procedureTypeName: procedureTypes.name,
        performedAt: procedureRecords.performedAt,
        status: procedureRecords.status,
        cancelledAt: procedureRecords.cancelledAt,
        followupSnoozedUntil: procedureRecords.followupSnoozedUntil,
      })
      .from(procedureRecords)
      .innerJoin(patients, eq(procedureRecords.patientId, patients.id))
      .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
      .where(
        and(
          eq(procedureRecords.tenantId, tenantId),
          isNull(procedureRecords.deletedAt),
          isNull(patients.deletedAt),
          sql`${procedureRecords.followUpDate} IS NOT NULL`,
        ),
      ),
    db
      .select({
        patientId: appointments.patientId,
        status: appointments.status,
        date: appointments.date,
      })
      .from(appointments)
      .where(and(eq(appointments.tenantId, tenantId), isNull(appointments.deletedAt))),
  ])

  // "Already booked" means a future (today or later) appointment in one of
  // the active statuses. Resolved in JS rather than at the SQL layer so the
  // status/date logic is one thing, not duplicated between query and code.
  const bookedPatientIds = new Set(
    tenantAppointments
      .filter(
        (row) =>
          row.patientId &&
          (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(row.status) &&
          row.date >= todayYmd,
      )
      .map((row) => row.patientId as string),
  )

  const rows: DueFollowUpRow[] = []

  for (const record of dueRecords) {
    if (!record.followUpDate) continue
    // Not a real, delivered procedure: never entered beyond a draft, or
    // explicitly cancelled (status and cancelled_at checked independently).
    if (EXCLUDED_STATUSES.has(record.status)) continue
    if (record.cancelledAt) continue
    // Snoozed: follow-up is suppressed until `followupSnoozedUntil`. A
    // snooze that expired on or before today no longer applies, matching
    // `listOpenPlanejamentos` in followups.ts.
    if (record.followupSnoozedUntil && record.followupSnoozedUntil > todayYmd) continue
    // Bounded both directions: overdue follow-ups only reach back
    // `windowDays`, upcoming ones only reach forward `windowDays`.
    if (record.followUpDate < windowStartYmd) continue
    if (record.followUpDate > windowEndYmd) continue
    if (bookedPatientIds.has(record.patientId)) continue

    const isOverdue = record.followUpDate < todayYmd
    const daysUntil = Math.round(
      (parseBrDate(record.followUpDate).getTime() - parseBrDate(todayYmd).getTime()) / 86_400_000,
    )

    rows.push({
      patientId: record.patientId,
      fullName: record.fullName,
      phone: record.phone,
      followUpDate: record.followUpDate,
      daysUntil,
      isOverdue,
      procedureTypeName: record.procedureTypeName,
      lastProcedureAt: record.performedAt ? toBrYmd(record.performedAt) : null,
    })
  }

  if (sort) {
    const accessor = SORT_ACCESSORS[sort.key]
    rows.sort((a, b) => directionalCompare(accessor(a), accessor(b), sort.dir))
  } else {
    rows.sort((a, b) => a.followUpDate.localeCompare(b.followUpDate))
  }

  // The cap MUST apply after sorting, not before: with an explicit sort the
  // "top 200" has to be the top 200 of the requested order.
  return rows.slice(0, MAX_ROWS)
}
