import { shiftBrYmd } from '@/lib/dates'

function dayMonth(ymd: string, today: string): string {
  const [y, m, d] = ymd.split('-')
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`
}

/** `at` is the BR wall clock `YYYY-MM-DDTHH:MM` the list query returns. */
export function formatNextAppointment(at: string, today: string): string {
  const [ymd, time] = at.split('T')
  if (ymd === today) return `Hoje, ${time}`
  if (ymd === shiftBrYmd(today, 1)) return `Amanhã, ${time}`
  return `${dayMonth(ymd, today)}, ${time}`
}

export function formatLastVisit(ymd: string, today: string): string {
  if (ymd === today) return 'Hoje'
  if (ymd === shiftBrYmd(today, -1)) return 'Ontem'
  return dayMonth(ymd, today)
}
