import { firstName, formatDate } from '@/lib/utils'

export const CONFIRMATION_VALUE_KEYS = ['patient_name', 'clinic_name', 'appointment_date', 'appointment_time'] as const

interface ConfirmationAppointment {
  date: string
  startTime: string
  patientName: string | null
  bookingName: string | null
}

export function buildConfirmationValues(
  appointment: ConfirmationAppointment,
  tenantName: string,
): Record<(typeof CONFIRMATION_VALUE_KEYS)[number], string> {
  return {
    patient_name: firstName(appointment.patientName ?? appointment.bookingName ?? ''),
    clinic_name: tenantName,
    appointment_date: formatDate(appointment.date),
    appointment_time: appointment.startTime.slice(0, 5),
  }
}
