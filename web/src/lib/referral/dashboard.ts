import { formatBrDate, formatBrDayMonth } from '@/lib/dates'
import { referralStatusLabel } from './status'
import {
  REFERRAL_BONUS_CREDITS_PER_EXTRA,
  REFERRAL_MAX_COUNTING_FOR_DISCOUNT,
  REFERRAL_PERCENT_PER_REFERRAL,
  referralDiscountPercent,
  referralLink,
} from './rules'
import type { IneligibleReason, PausedReason, ReferralStatus } from './types'

const INACTIVE_MESSAGE = 'Seu link de indicação fica ativo quando sua clínica tem uma assinatura paga.'
const RULES_URL = 'https://floraclin.com.br/indique'
const FREE_LABEL = `${REFERRAL_MAX_COUNTING_FOR_DISCOUNT} de ${REFERRAL_MAX_COUNTING_FOR_DISCOUNT}: seu FloraClin está grátis 🎉`

export interface DashboardInput {
  canRefer: boolean
  code: string | null
  rewardsActive: boolean
  counting: number
  /** Referrer's plan price (null when no paid plan). */
  planPriceCents: number | null
  /** isReferralEligiblePlan(plan): yearly referrers see 0%. */
  planEligible: boolean
  /** currentPeriodEnd when canRefer (display only; may lag a renewal by hours). */
  nextInvoiceAt: Date | null
  referrals: Array<{
    id: string
    referredName: string
    capturedAt: Date
    status: ReferralStatus
    pausedReason: PausedReason | null
    ineligibleReason: IneligibleReason | null
  }>
  events: Array<{ createdAt: Date; counting: number; discountPercent: number; bonusCredits: number }>
}

export interface ReferralDashboardResponse {
  canRefer: boolean
  inactiveMessage: string | null
  link: string | null
  shareText: string | null
  whatsappShareUrl: string | null
  /** `percent` is 0–100 (width of the bar). */
  progress: { counting: number; target: 5; percent: number; label: string; bonusLabel: string | null }
  discountLine: string
  referrals: Array<{ id: string; name: string; signupDate: string; label: string; sublabel: string | null }>
  history: Array<{ date: string; text: string }>
  rulesUrl: 'https://floraclin.com.br/indique'
}

function brl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

function clinicsPaying(n: number): string {
  return `${n} ${n === 1 ? 'clínica pagante' : 'clínicas pagantes'}`
}

export function referralShareText(link: string): string {
  return [
    `Uso o FloraClin na minha clínica para agenda, prontuário e lembretes por WhatsApp. Se você também é profissional da saúde estética e quer testar, pelo meu link você ganha 14 dias grátis e 20% de desconto nos 2 primeiros meses: ${link}`,
    'Ganho desconto na minha assinatura se você assinar. #publi #linkafiliado',
  ].join('\n')
}

function progressLabels(counting: number): { label: string; bonusLabel: string | null } {
  const target = REFERRAL_MAX_COUNTING_FOR_DISCOUNT
  if (counting < target) {
    const missing = target - counting
    return {
      label: `${counting} de ${target} clínicas pagantes, ${missing === 1 ? 'falta 1' : `faltam ${missing}`} para FloraClin grátis`,
      bonusLabel: null,
    }
  }
  if (counting === target) return { label: FREE_LABEL, bonusLabel: null }
  const credits = REFERRAL_BONUS_CREDITS_PER_EXTRA * (counting - target)
  return {
    label: FREE_LABEL,
    bonusLabel: `+${credits} créditos de WhatsApp por mês com ${counting} clínicas pagantes`,
  }
}

function discountLine(percent: number, priceCents: number | null, nextInvoiceAt: Date | null): string {
  if (percent <= 0) {
    return `Cada clínica indicada que está pagando vale ${REFERRAL_PERCENT_PER_REFERRAL}% de desconto na sua assinatura. Com ${REFERRAL_MAX_COUNTING_FOR_DISCOUNT}, o FloraClin sai de graça.`
  }
  if (priceCents == null || !nextInvoiceAt) return `Seu desconto atual: ${percent}% a partir da próxima fatura.`
  const saved = Math.round((priceCents * percent) / 100)
  return `Seu desconto atual: ${percent}% (${brl(saved)} de ${brl(priceCents)}) a partir da próxima fatura, em ${formatBrDayMonth(nextInvoiceAt)}.`
}

export function buildReferralDashboard(input: DashboardInput): ReferralDashboardResponse {
  const link = input.canRefer && input.code ? referralLink(input.code) : null
  const shareText = link ? referralShareText(link) : null
  const counting = Math.max(0, Math.floor(input.counting))
  const percent = input.rewardsActive && input.canRefer && input.planEligible ? referralDiscountPercent(counting) : 0

  return {
    canRefer: input.canRefer,
    inactiveMessage: input.canRefer ? null : INACTIVE_MESSAGE,
    link,
    shareText,
    whatsappShareUrl: shareText ? `https://wa.me/?text=${encodeURIComponent(shareText)}` : null,
    progress: {
      counting,
      target: REFERRAL_MAX_COUNTING_FOR_DISCOUNT,
      percent: (Math.min(counting, REFERRAL_MAX_COUNTING_FOR_DISCOUNT) / REFERRAL_MAX_COUNTING_FOR_DISCOUNT) * 100,
      ...progressLabels(counting),
    },
    discountLine: discountLine(percent, input.planPriceCents, input.nextInvoiceAt),
    referrals: input.referrals.map((r) => ({
      id: r.id,
      name: r.referredName,
      signupDate: formatBrDate(r.capturedAt),
      ...referralStatusLabel(r),
    })),
    history: input.events.map((e) => ({
      date: formatBrDate(e.createdAt),
      text:
        `desconto de ${e.discountPercent}% com ${clinicsPaying(e.counting)}` +
        (e.bonusCredits > 0 ? ` · +${e.bonusCredits} créditos de WhatsApp/mês` : ''),
    })),
    rulesUrl: RULES_URL,
  }
}
