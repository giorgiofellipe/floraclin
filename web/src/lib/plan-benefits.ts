/**
 * Short pt-BR benefit lines for a plan, built from its real limits and
 * features (the same fields Configurações › Assinatura lists), so the paywall
 * never promises something the plan does not include.
 */
export interface PlanForBenefits {
  slug: string
  priceCents: number
  limits: unknown
  features: unknown
}

const NUMBER = new Intl.NumberFormat('pt-BR')

export function planBenefits(plan: PlanForBenefits): string[] {
  const limits = (plan.limits ?? {}) as Record<string, number | undefined>
  const features = (plan.features ?? {}) as Record<string, boolean | undefined>
  const lines = ['Agenda, prontuário e diagrama facial']

  if (limits.users === -1) lines.push('Usuários ilimitados para a equipe')
  else if (limits.users) lines.push(`Até ${NUMBER.format(limits.users)} usuários`)

  if (limits.whatsapp_credits === -1) lines.push('Mensagens de WhatsApp ilimitadas')
  else if (limits.whatsapp_credits) lines.push(`${NUMBER.format(limits.whatsapp_credits)} mensagens de WhatsApp por mês`)

  if (features.own_whatsapp_number) lines.push('WhatsApp com o número da clínica')
  else if (limits.patients === -1) lines.push('Pacientes ilimitados')

  return lines.slice(0, 4)
}

/** One plan to highlight: `pro` when offered, else the most expensive. */
export function recommendedPlanSlug(plans: { slug: string; priceCents: number }[]): string | null {
  if (plans.length < 2) return null
  if (plans.some((p) => p.slug === 'pro')) return 'pro'
  return [...plans].sort((a, b) => b.priceCents - a.priceCents)[0].slug
}

/** Plans a clinic can buy: paid and wired to a Stripe price. The paywall and
 *  the win-back emails both use this, so they agree on what the offer covers. */
export function sellablePlans<P extends { priceCents: number; stripePriceId: string | null }>(plans: P[]): P[] {
  return plans.filter((p) => p.priceCents > 0 && !!p.stripePriceId)
}
