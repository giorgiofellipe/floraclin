import { and, eq, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { db } from '@/db/client'
import { patients } from '@/db/schema'

import { phoneTailVariants } from './patients'

/**
 * `patients.phone` and `patients.phoneSecondary` hold whatever the clinic
 * typed, so a canonical string compared with `eq` matches almost nothing. Same
 * tail match as `getPatientByPhone`, over one column.
 */
function columnMatchesPhone(
  column: AnyPgColumn,
  phone: string,
  variants: string[],
): SQL | undefined {
  const storedDigits = sql`regexp_replace(coalesce(${column}, ''), '\\D', '', 'g')`

  // Nothing placeable in the input (a foreign number, a half-typed entry).
  // Fall back to comparing the digits exactly rather than matching a tail,
  // which on a short string would match far too much.
  if (variants.length === 0) {
    const digits = phone.replace(/\D/g, '')
    // A null secondary number coalesces to '', which an input with no digits
    // at all would then match on every row.
    if (digits.length === 0) return sql`false`
    return sql`${storedDigits} = ${digits}`
  }

  return or(...variants.map((v) => sql`right(${storedDigits}, ${v.length}) = ${v}`))
}

/**
 * The flag lives on the patient, not the lead. A lead that has never been
 * converted therefore has no `convertedPatientId` to look up, which is how an
 * opted-out person who writes in from a brand new prospect used to slip
 * through: the phone is the only thing tying the two records together.
 *
 * Both phone columns are searched: an opted-out patient who books from the
 * number stored as `phoneSecondary` is the same person.
 *
 * Any patient matching either number is enough to suppress. Records sharing a
 * number are a family, and over-suppressing a relative is the cheap mistake.
 */
export async function isMarketingOptedOut(
  tenantId: string,
  ref: { patientId?: string | null; phone?: string | null },
): Promise<boolean> {
  if (ref.patientId) {
    const [patient] = await db
      .select({ marketingOptOut: patients.marketingOptOut })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.id, ref.patientId)))
      .limit(1)
    if (patient?.marketingOptOut) return true
  }

  if (ref.phone) {
    const variants = phoneTailVariants(ref.phone)
    const phoneMatches = or(
      columnMatchesPhone(patients.phone, ref.phone, variants),
      columnMatchesPhone(patients.phoneSecondary, ref.phone, variants),
    )

    const rows = await db
      .select({ marketingOptOut: patients.marketingOptOut })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), phoneMatches))

    if (rows.some((row) => row.marketingOptOut)) return true
  }

  return false
}
