import {
  claimPreInstructions,
  getAppointmentsDuePreInstructions,
  releasePreInstructions,
} from '@/db/queries/appointments'
import { getProcedureTypeCare, getSessionCareRecipient } from '@/db/queries/procedures'
import { brCalendarDaysBetween, brToday, shiftBrYmd } from '@/lib/dates'
import { firstName } from '@/lib/utils'
import { fitTemplateParam, flattenTemplateParam, joinPtList } from '@/lib/whatsapp-blueprints'
import { runEventAutomation } from '@/lib/whatsapp-automation-event'
import { MAX_EVENT_AGE_DAYS } from '@/lib/whatsapp-automation-config'
import type { DueMessage, LoadDueArgs } from '@/lib/whatsapp-automation-cron'

export async function loadDuePreInstructions({
  tenantId,
  config,
}: LoadDueArgs<'pre_procedure_instructions'>): Promise<DueMessage[]> {
  const today = brToday()
  // From tomorrow, not today + N only: an appointment booked inside the
  // window, or a missed run, still gets its instructions before the day.
  const appointments = await getAppointmentsDuePreInstructions(
    tenantId,
    shiftBrYmd(today, 1),
    shiftBrYmd(today, config.daysBeforeAppointment),
  )

  return appointments.map((appointment) => ({
    ref: `appointment ${appointment.id}`,
    patientId: appointment.patientId,
    patientName: appointment.patientName,
    phone: appointment.patientPhone,
    values: {
      patient_name: firstName(appointment.patientName),
      procedure_name: appointment.procedureTypeName,
      instructions: fitTemplateParam(flattenTemplateParam(appointment.instructions ?? '')),
    },
    claim: () => claimPreInstructions(tenantId, appointment.id),
    release: () => releasePreInstructions(tenantId, appointment.id),
  }))
}

export function sendPostProcedureCare(tenantId: string, sessionId: string) {
  return runEventAutomation('post_procedure_care', tenantId, async () => {
    const session = await getSessionCareRecipient(tenantId, sessionId)
    if (!session || brCalendarDaysBetween(session.performedAt, new Date()) > MAX_EVENT_AGE_DAYS) return []

    const typeIds = [session.procedureTypeId, ...((session.additionalTypeIds as string[] | null) ?? [])]
    const withCare = (await getProcedureTypeCare(tenantId, typeIds))
      .sort((a, b) => typeIds.indexOf(a.id) - typeIds.indexOf(b.id))
      .map((type) => ({ ...type, care: flattenTemplateParam(type.postProcedureCare ?? '') }))
      .filter((type) => type.care)
    if (withCare.length === 0) return []

    return [{
      ref: `session ${sessionId}`,
      patientId: session.patientId,
      patientName: session.patientName,
      phone: session.patientPhone,
      values: {
        patient_name: firstName(session.patientName),
        procedure_name: joinPtList(withCare.map((type) => type.name)),
        instructions: fitTemplateParam(
          withCare.map((type) => withCare.length > 1 ? `${type.name}: ${type.care}` : type.care).join(' '),
        ),
      },
    }]
  })
}
