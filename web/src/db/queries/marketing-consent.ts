import { and, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { patients } from '@/db/schema'

/**
 * The flag lives on the patient, not the lead: a lead can opt out only once it
 * has a patient record, so an emission site with no patient link cannot be
 * suppressed. Callers therefore have to resolve `convertedPatientId` and pass
 * it, which is why every call site sends a patient id rather than a lead id.
 */
export async function isMarketingOptedOut(
  tenantId: string,
  ref: { patientId?: string | null },
): Promise<boolean> {
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
