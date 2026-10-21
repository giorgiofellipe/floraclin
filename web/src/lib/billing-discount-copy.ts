import { formatBrDate, formatBrDayMonth } from '@/lib/dates'

// Client-safe: imported by the billing page. Structural type, no server imports.
export interface SubscriptionDiscountLike {
  discountedCents: number
  fullCents: number
  endsAt: string | null
  afterEndsCents?: number | null
  referralPercent?: number | null
}

export function brl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

/** The reward ladder is 20% per paying referral. */
export function referralCountFromPercent(percent: number): number {
  return percent / 20
}

function untilPhrase(endsAt: string, now: Date): string {
  const sameYear = formatBrDate(endsAt).slice(6) === formatBrDate(now).slice(6)
  return sameYear ? formatBrDayMonth(endsAt) : formatBrDate(endsAt)
}

/**
 * Referral only: "R$ 99,00 → R$ 59,40/mês · 40% de desconto por 2 indicações pagantes".
 * Referral plus an entry coupon: "R$ 99,00 → R$ 47,52/mês até 21/12, depois R$ 59,40 · 40% de desconto por 2 indicações pagantes".
 * No referral part (win-back only): "R$ 69,30/mês até 21/01, depois R$ 99,00".
 * With a cancellation pending there is no "depois".
 */
export function discountSummaryLine(
  d: SubscriptionDiscountLike,
  opts: { cancelPending: boolean; now?: Date },
): string {
  const now = opts.now ?? new Date()
  const percent = d.referralPercent ?? 0
  const current = `${brl(d.discountedCents)}/mês`

  if (percent <= 0) {
    if (opts.cancelPending) return `${current} com desconto`
    if (d.endsAt) return `${current} até ${untilPhrase(d.endsAt, now)}, depois ${brl(d.fullCents)}`
    return `${current} com desconto (sem desconto: ${brl(d.fullCents)})`
  }

  const n = referralCountFromPercent(percent)
  const tail = `${percent}% de desconto por ${n} ${n === 1 ? 'indicação pagante' : 'indicações pagantes'}`
  if (d.endsAt && !opts.cancelPending) {
    const after = d.afterEndsCents ?? d.fullCents - Math.round((d.fullCents * percent) / 100)
    return `${brl(d.fullCents)} → ${current} até ${untilPhrase(d.endsAt, now)}, depois ${brl(after)} · ${tail}`
  }
  return `${brl(d.fullCents)} → ${current} · ${tail}`
}
