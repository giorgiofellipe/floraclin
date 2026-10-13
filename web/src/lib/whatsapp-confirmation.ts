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

export function buildConfirmationParams(
  appointment: ConfirmationAppointment,
  tenantName: string,
): Record<string, string> {
  const name = appointment.patientName ?? appointment.bookingName ?? ''
  return {
    '1': name.split(' ')[0] || name,
    '2': tenantName,
    '3': formatDateBr(appointment.date),
    '4': appointment.startTime.slice(0, 5),
  }
}
