import { toBrYmd } from '@/lib/dates'

export function defaultCompetenceDate(input: {
  performedAt: Date | null
  appointmentDate: string | null
  paidAt: Date
  today: string
}): string {
  const serviceDay =
    (input.performedAt ? toBrYmd(input.performedAt) : null) ??
    input.appointmentDate ??
    toBrYmd(input.paidAt)
  return serviceDay > input.today ? input.today : serviceDay
}

export function competenceIsPastMonth(competence: string, today: string): boolean {
  return competence.slice(0, 7) < today.slice(0, 7)
}
