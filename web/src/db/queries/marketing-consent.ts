import { and, eq, or, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { patients } from '@/db/schema'

import { phoneTailVariants } from './patients'

/**
 * The flag lives on the patient, not the lead. A lead that has never been
 * converted therefore has no `convertedPatientId` to look up, which is how an
 * opted-out person who writes in from a brand new prospect used to slip
 * through: the phone is the only thing tying the two records together.
 *
 * Any patient matching the phone is enough to suppress. Two records sharing a
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
    // `patients.phone` holds whatever the clinic typed, so a canonical string
    // compared with `eq` matches almost nothing. Same tail match as
    // `getPatientByPhone`.
    const variants = phoneTailVariants(ref.phone)
    const storedDigits = sql`regexp_replace(${patients.phone}, '\\D', '', 'g')`
    const phoneMatches =
      variants.length > 0
        ? or(...variants.map((v) => sql`right(${storedDigits}, ${v.length}) = ${v}`))
        : sql`${storedDigits} = ${ref.phone.replace(/\D/g, '')}`

    const rows = await db
      .select({ marketingOptOut: patients.marketingOptOut })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), phoneMatches))

    if (rows.some((row) => row.marketingOptOut)) return true
  }

  return false
}
