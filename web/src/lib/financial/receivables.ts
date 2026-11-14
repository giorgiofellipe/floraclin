import { toBrYmd, ymdDayIndex } from '@/lib/dates'

export type DueBucket = 'overdue' | 'today' | 'upcoming'

export const DUE_SOON_DAYS = 7

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Vencidas',
  today: 'Hoje',
  upcoming: 'Próximas',
}

export const DUE_BUCKET_TEXT: Record<DueBucket, string> = {
  overdue: 'text-red-700',
  today: 'text-amber-dark',
  upcoming: 'text-mid',
}

interface DueInfo {
  isOverdue?: boolean
  nextDueDate?: string | null
}

/**
 * Overdue is the pricing engine's call (it knows the grace period). A charge
 * past its due date but still in grace is grouped with today's.
 */
export function dueBucket(entry: DueInfo, todayYmd: string): DueBucket {
  if (entry.isOverdue) return 'overdue'
  if (entry.nextDueDate && entry.nextDueDate <= todayYmd) return 'today'
  return 'upcoming'
}

function dayMonth(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
}

/** "Vencida há 3 dias", "Vence hoje", "Vence amanhã", "Vence 15/11". */
export function dueLabel(dueYmd: string, todayYmd: string): string {
  const days = ymdDayIndex(dueYmd) - ymdDayIndex(todayYmd)
  if (days < -1) return `Vencida há ${-days} dias`
  if (days === -1) return 'Vencida ontem'
  if (days === 0) return 'Vence hoje'
  if (days === 1) return 'Vence amanhã'
  return `Vence ${dayMonth(dueYmd)}`
}

export function receivedLabel(paidAt: string | Date): string {
  return `Recebida ${dayMonth(toBrYmd(new Date(paidAt)))}`
}
