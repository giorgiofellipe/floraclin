import { firstName } from '@/lib/whatsapp-blueprints'

interface ConfirmationAppointment {
  date: string
  startTime: string
  patientName: string | null
  bookingName: string | null
}

function formatDateBr(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

export function buildConfirmationValues(
  appointment: ConfirmationAppointment,
  tenantName: string,
): Record<string, string> {
  return {
    patient_name: firstName(appointment.patientName ?? appointment.bookingName ?? ''),
    clinic_name: tenantName,
    appointment_date: formatDateBr(appointment.date),
    appointment_time: appointment.startTime.slice(0, 5),
  }
}
