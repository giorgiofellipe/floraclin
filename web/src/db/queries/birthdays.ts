import { db } from '@/db/client'
import { patients, patientGreetings, users } from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

export interface BirthdayRow {
  id: string
  fullName: string
  birthDate: string // YYYY-MM-DD
  phone: string
  ageTurning: number
  greetedAt: Date | null
  greetedByName: string | null
}

/**
 * Returns patients with birthdays in the BR-local month/day window described by
 * `monthDayPairs`. Handles year-wrap (e.g. Dec 28 → Jan 3) by passing two
 * separate ranges as a flat list of pairs.
 *
 * `birthDate` is a Postgres `DATE` returned as a `YYYY-MM-DD` string; slicing
 * the year is host-TZ-safe. Never `new Date(birthDate)` then `.getFullYear()`
 * — that's a UTC parse on a calendar day.
 */
export async function getBirthdaysInRange(args: {
  tenantId: string
  monthDayPairs: Array<{ month: number; day: number }>
  occasionYear: number
}): Promise<BirthdayRow[]> {
  if (args.monthDayPairs.length === 0) return []

  const conditions = args.monthDayPairs.map(({ month, day }) =>
    sql`(EXTRACT(MONTH FROM ${patients.birthDate}) = ${month} AND EXTRACT(DAY FROM ${patients.birthDate}) = ${day})`
  )

  const rows = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      birthDate: patients.birthDate,
      phone: patients.phone,
      greetedAt: patientGreetings.greetedAt,
      greetedByName: users.fullName,
    })
    .from(patients)
    .leftJoin(
      patientGreetings,
      and(
        eq(patientGreetings.patientId, patients.id),
        eq(patientGreetings.occasionYear, args.occasionYear)
      )
    )
    .leftJoin(users, eq(users.id, patientGreetings.greetedBy))
    .where(
      and(
        eq(patients.tenantId, args.tenantId),
        isNull(patients.deletedAt),
        sql`${patients.birthDate} IS NOT NULL`,
        sql`(${sql.join(conditions, sql` OR `)})`
      )
    )

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    birthDate: r.birthDate!,
    phone: r.phone,
    ageTurning: args.occasionYear - parseInt(r.birthDate!.slice(0, 4), 10),
    greetedAt: r.greetedAt,
    greetedByName: r.greetedByName,
  }))
}

/**
 * Verifies a patient belongs to the given tenant. Returns the patient id if so,
 * `null` otherwise. Used by greeting mutation routes for tenant isolation.
 */
export async function getPatientForTenant(args: {
  tenantId: string
  patientId: string
}): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        eq(patients.id, args.patientId),
        eq(patients.tenantId, args.tenantId),
        isNull(patients.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Inserts a greeting record for `(patientId, occasionYear)`. Uses the unique
 * `(patient_id, occasion_year)` index — duplicates are silently ignored.
 */
export async function recordGreeting(args: {
  tenantId: string
  patientId: string
  occasionYear: number
  greetedBy: string
}): Promise<void> {
  await db
    .insert(patientGreetings)
    .values({
      tenantId: args.tenantId,
      patientId: args.patientId,
      occasionYear: args.occasionYear,
      greetedBy: args.greetedBy,
    })
    .onConflictDoNothing()
}

/**
 * Deletes the greeting record for `(patientId, occasionYear)` if it exists.
 * Scoped to tenant for safety.
 */
export async function clearGreeting(args: {
  tenantId: string
  patientId: string
  occasionYear: number
}): Promise<void> {
  await db
    .delete(patientGreetings)
    .where(
      and(
        eq(patientGreetings.tenantId, args.tenantId),
        eq(patientGreetings.patientId, args.patientId),
        eq(patientGreetings.occasionYear, args.occasionYear)
      )
    )
}
