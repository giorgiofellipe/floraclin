import { and, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { patients, prospects } from '@/db/schema'

/**
 * Checks both the prospect and the patient row because the opt-out flag can
 * be set on the patient long after the lead that carries the ad attribution:
 * a receptionist converts a prospect, then the patient opts out weeks later.
 * Either row being flagged is enough to suppress the event.
 */
export async function isMarketingOptedOut(
  tenantId: string,
  ref: { prospectId?: string | null; patientId?: string | null },
): Promise<boolean> {
  if (ref.prospectId) {
    const [prospect] = await db
      .select({ marketingOptOut: prospects.marketingOptOut })
      .from(prospects)
      .where(and(eq(prospects.tenantId, tenantId), eq(prospects.id, ref.prospectId)))
      .limit(1)
    if (prospect?.marketingOptOut) return true
  }

  if (ref.patientId) {
    const [patient] = await db
      .select({ marketingOptOut: patients.marketingOptOut })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.id, ref.patientId)))
      .limit(1)
    if (patient?.marketingOptOut) return true
  }

  return false
}
