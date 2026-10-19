import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { buildTemplateParams } from '@/lib/whatsapp-blueprints'
import { buildConfirmationValues } from '@/lib/whatsapp-confirmation'
import { CreditExhaustedError } from '@/lib/whatsapp-credits'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { InvalidWhatsAppPhoneError, normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { reportSideEffectFailure } from '@/lib/observability'
import { SubscriptionExpiredError } from '@/lib/plans'

export type RescheduleNotification = 'sent' | 'unavailable' | 'no_phone' | 'no_credits' | 'failed'

interface RescheduledAppointment {
  id: string
  patientId: string | null
  patientName: string | null
  bookingName: string | null
  bookingPhone: string | null
  date: string
  startTime: string
}

/**
 * Tells the patient their appointment moved. Runs after the move is saved, so
 * it reports what happened instead of throwing: a failed message must not
 * undo or fail the reschedule.
 */
export async function sendRescheduleNotification(
  tenantId: string,
  userId: string,
  appointment: RescheduledAppointment,
): Promise<RescheduleNotification> {
  try {
    const tenant = await getTenant(tenantId)
    if (!tenant || !isWhatsAppEnabled(tenant.settings as Record<string, unknown> | null)) {
      return 'unavailable'
    }

    const template = await getTemplateForTenant(tenantId, 'reschedule_notification')
    if (template?.status !== 'APPROVED') return 'unavailable'

    const patient = appointment.patientId ? await getPatient(tenantId, appointment.patientId) : null
    const rawPhone = patient?.phone || appointment.bookingPhone
    if (!rawPhone) return 'no_phone'

    let phone: string
    try {
      phone = normalizeBrPhoneForWhatsApp(rawPhone)
    } catch (err) {
      if (err instanceof InvalidWhatsAppPhoneError) return 'no_phone'
      throw err
    }

    const name = patient?.fullName ?? appointment.patientName ?? appointment.bookingName
    await sendAndRecordTemplate({
      tenantId,
      phone,
      recipient: { patientId: appointment.patientId, name },
      template,
      params: buildTemplateParams(template, buildConfirmationValues({ ...appointment, patientName: name }, tenant.name)),
      actor: { type: 'user', userId },
    })
    return 'sent'
  } catch (err) {
    if (err instanceof CreditExhaustedError) return 'no_credits'
    if (err instanceof SubscriptionExpiredError) return 'unavailable'
    reportSideEffectFailure(err, {
      area: 'whatsapp',
      step: 'reschedule_notification',
      extra: { tenantId, appointmentId: appointment.id },
    })
    return 'failed'
  }
}
