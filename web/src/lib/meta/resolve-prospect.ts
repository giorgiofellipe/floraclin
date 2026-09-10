import { getPatient } from '@/db/queries/patients'
import { getProspectByPatientId, getProspectByPhone } from '@/db/queries/prospects'

/**
 * Reproduces the three step chain in `web/src/app/api/appointments/route.ts`
 * (patient id, then the patient's own phone, then the supplied phone).
 * `getProspectByPatientId` only matches `prospects.convertedPatientId`,
 * written solely by the explicit convert flow, so a booking-page or CTWA
 * lead whose patient record was created by hand would otherwise never
 * resolve, and Purchase would never fire for the ad-attributed leads this
 * feature exists to measure.
 */
export async function resolveProspectForPatient(
  tenantId: string,
  ref: { patientId?: string | null; phone?: string | null },
): Promise<{ id: string } | null> {
  if (ref.patientId) {
    const byPatientId = await getProspectByPatientId(tenantId, ref.patientId)
    if (byPatientId) return { id: byPatientId.id }

    const patient = await getPatient(tenantId, ref.patientId)
    if (patient?.phone) {
      const byPatientPhone = await getProspectByPhone(tenantId, patient.phone)
      if (byPatientPhone) return { id: byPatientPhone.id }
    }
  }

  if (ref.phone) {
    const bySuppliedPhone = await getProspectByPhone(tenantId, ref.phone)
    if (bySuppliedPhone) return { id: bySuppliedPhone.id }
  }

  return null
}
