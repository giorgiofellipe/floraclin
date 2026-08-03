import { db } from '@/db/client'
import { patients, procedureRecords, procedureTypes, appointments } from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { addDays } from 'date-fns'
import { parseBrDate, toBrYmd } from '@/lib/dates'

/** Appointment statuses that mean "the patient is already booked". */
const ACTIVE_APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'in_progress'] as const

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

export interface ListDueFollowUpsOptions {
  windowDays: number
  today: Date
}

/**
 * Recall report: patients whose procedure follow-up is due soon or already
 * overdue, minus anyone already booked.
 *
 * Includes every `procedure_records.follow_up_date` at or before
 * `today + windowDays`, both upcoming (today or later) and overdue (before
 * today, flagged via `isOverdue`). Excludes any patient who already has a
 * future appointment (today or later) in `scheduled`, `confirmed` or
 * `in_progress` — that exclusion is the point of the report, since chasing a
 * patient who is already booked is noise.
 *
 * `follow_up_date` is a `date` column holding a BR calendar day, stored and
 * compared as a `YYYY-MM-DD` string throughout. It is never passed through
 * `new Date()`. `today` is taken as a parameter rather than read from
 * `Date.now()` so callers (and tests) control the reference instant
 * explicitly.
 */
export async function listDueFollowUps(
  tenantId: string,
  { windowDays, today }: ListDueFollowUpsOptions,
): Promise<DueFollowUpRow[]> {
  const todayYmd = toBrYmd(today)
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
    // Upper bound only: overdue follow-ups (before today) are always
    // included and flagged, regardless of how far in the past they are.
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

  rows.sort((a, b) => a.followUpDate.localeCompare(b.followUpDate))

  return rows
}
