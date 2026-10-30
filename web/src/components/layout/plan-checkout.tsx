'use client'

import { useId, useState } from 'react'
import { CheckIcon, Loader2, LockKeyholeIcon, RefreshCwIcon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatBrDayMonth } from '@/lib/dates'
import type { TrialRecap } from '@/lib/trial-recap'
import { durationPhrase, winbackPriceCents, type PublicWinbackOffer } from '@/lib/winback'
import { referralOfferHeadline, type PublicReferralOffer } from '@/lib/referral/offer-copy'
import { feedbackOfferHeadline, type PublicFeedbackOffer } from '@/lib/feedback-offer-copy'
import type { PaywallPlan } from '@/components/layout/subscription-access'

/** What the plan cards and the entry price read: the feedback, win-back or referral offer. */
export type EntryOffer = PublicFeedbackOffer | PublicWinbackOffer | PublicReferralOffer

/** The badge on the highlighted plan. A recommendation, not a popularity
 *  claim: we only say "most chosen" once the numbers say so. */
export const RECOMMENDED_BADGE = 'Recomendado'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatCents(cents: number): string {
  return BRL.format(cents / 100)
}

function perInterval(plan: Pick<PaywallPlan, 'billingInterval'>): string {
  return plan.billingInterval === 'year' ? '/ano' : '/mês'
}

/** Whole reais without cents ("R$ 99"), cents only when there are some. */
function formatEntryPrice(cents: number): string {
  return cents % 100 === 0
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100)
    : formatCents(cents)
}

/**
 * "Planos a partir de R$ 99/mês": the entry price, so a phone user sees it
 * without scrolling to the cards. Under the win-back offer it is the lowest
 * discounted price, and says so.
 */
export function entryPriceLine(plans: PaywallPlan[], offer: EntryOffer | null): string | null {
  if (plans.length === 0) return null
  const priced = plans.map((plan) => {
    const discounted = winbackPriceCents(plan, offer)
    return { plan, cents: discounted ?? plan.priceCents, discounted: discounted != null }
  })
  const cheapest = priced.reduce((a, b) => (b.cents < a.cents ? b : a))
  const price = `${formatEntryPrice(cheapest.cents)}${perInterval(cheapest.plan)}`
  return cheapest.discounted ? `Planos a partir de ${price} com a oferta` : `Planos a partir de ${price}`
}

/** The fine print under a discounted price: how long, and the price after. */
function offerTermsLine(plan: PaywallPlan, offer: EntryOffer): string {
  if (offer.duration === 'forever') return 'Desconto em todas as mensalidades.'
  // Same words as the offer label ("nos 3 primeiros meses"), capitalised.
  const when = durationPhrase(offer).trim()
  const after = `depois ${formatCents(plan.priceCents)}${perInterval(plan)}.`
  return when ? `${when[0].toUpperCase()}${when.slice(1)}, ${after}` : `${after[0].toUpperCase()}${after.slice(1)}`
}

/** Checkout and billing-portal redirects shared by the paywall and the
 *  trial-ending modal. Errors land in a toast; the button re-enables. */
export function usePlanCheckout() {
  const [pending, setPending] = useState<string | null>(null)

  async function go(key: string, url: string, body: unknown, fallbackError: string) {
    setPending(key)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || fallbackError)
      if (data.url) {
        window.location.href = data.url
        return
      }
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fallbackError)
      setPending(null)
    }
  }

  return {
    pending,
    subscribe: (planSlug: string) =>
      go(planSlug, '/api/billing/checkout', { planSlug }, 'Não foi possível abrir o pagamento.'),
    updatePayment: () =>
      go(
        'payment_update',
        '/api/billing/portal',
        { flow: 'payment_method_update' },
        'Não foi possível abrir a atualização do cartão.',
      ),
  }
}

export function PlanCard({
  plan,
  offer,
  canSubscribe,
  pending,
  onSubscribe,
}: {
  plan: PaywallPlan
  offer: EntryOffer | null
  canSubscribe: boolean
  pending: string | null
  onSubscribe: (slug: string) => void
}) {
  const discounted = winbackPriceCents(plan, offer)
  const titleId = `plan-${plan.slug}-title`
  return (
    <section
      aria-labelledby={titleId}
      data-testid={`paywall-plan-${plan.slug}`}
      className={cn(
        'relative flex flex-col rounded-2xl bg-white p-5 text-left',
        plan.recommended
          ? 'border-2 border-forest shadow-[0_8px_24px_-12px_rgba(28,43,30,0.35)]'
          : 'border border-topbar-border',
      )}
    >
      {plan.recommended && (
        <span className="absolute -top-3 left-5 rounded-full bg-forest px-3 py-1 text-[11px] font-semibold tracking-wide text-cream">
          {RECOMMENDED_BADGE}
        </span>
      )}
      <h3 id={titleId} className="text-base font-semibold text-charcoal">
        {plan.name}
      </h3>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="text-3xl font-semibold tracking-tight text-forest">
          {formatCents(discounted ?? plan.priceCents)}
        </span>
        <span className="text-sm text-charcoal/70">{perInterval(plan)}</span>
        {discounted != null && (
          // aria-label is unreliable on <s>; the context is spoken text.
          <s className="text-sm text-charcoal/60">
            <span className="sr-only">Preço normal: </span>
            {formatCents(plan.priceCents)}
          </s>
        )}
      </div>
      {discounted != null && offer && (
        // The full price after the discount, said plainly.
        <p className="mt-1 text-xs text-charcoal/70" data-testid={`paywall-plan-${plan.slug}-terms`}>
          {offerTermsLine(plan, offer)}
        </p>
      )}

      <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-charcoal">
        {plan.benefits.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden />
            {line}
          </li>
        ))}
      </ul>

      {canSubscribe && (
        <Button
          size="lg"
          className={cn(
            'mt-5 h-11 w-full text-sm font-semibold',
            plan.recommended
              ? 'bg-forest text-cream hover:bg-sage'
              : 'border border-forest bg-white text-forest hover:bg-forest/5',
          )}
          disabled={pending !== null}
          onClick={() => onSubscribe(plan.slug)}
          data-testid={`paywall-subscribe-${plan.slug}`}
        >
          {pending === plan.slug && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Continuar com o {plan.name}
        </Button>
      )}
    </section>
  )
}

export function PlanCards({
  plans,
  ...card
}: {
  plans: PaywallPlan[]
  offer: EntryOffer | null
  canSubscribe: boolean
  pending: string | null
  onSubscribe: (slug: string) => void
}) {
  if (plans.length === 0) return null
  // Cheapest first (Starter, then the highlighted Pro), stacked on a phone
  // and left to right side by side: the entry price is the first one seen,
  // and visual, reading and tab order agree.
  const ordered = [...plans].sort((a, b) => a.priceCents - b.priceCents)
  return (
    <div className={cn('grid gap-5 pt-3', plans.length > 1 && 'sm:grid-cols-2')}>
      {ordered.map((plan) => (
        <PlanCard key={plan.slug} plan={plan} {...card} />
      ))}
    </div>
  )
}

const RECAP_TILES: { key: keyof TrialRecap; one: string; many: string }[] = [
  { key: 'patients', one: 'paciente', many: 'pacientes' },
  { key: 'appointments', one: 'agendamento', many: 'agendamentos' },
  { key: 'procedureRecords', one: 'atendimento', many: 'atendimentos' },
  { key: 'diagrams', one: 'diagrama facial', many: 'diagramas faciais' },
  { key: 'photos', one: 'foto', many: 'fotos' },
]

/** Columns by tile count: four go 2×2 on a phone, one row on wider screens. */
const RECAP_GRID: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
}

/** The quiet, underlined secondary action ("Continuar em modo leitura",
 *  "Agora não"): always reachable, never competing with the plan CTAs. */
export const QUIET_ACTION_CLASS =
  'rounded-md px-2 py-1 text-sm text-charcoal/75 underline underline-offset-4 transition-colors hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage'

export function hasRecap(recap: TrialRecap | null | undefined): recap is TrialRecap {
  return !!recap && RECAP_TILES.some((t) => recap[t.key] > 0)
}

/** The clinic's own numbers: what it keeps by continuing. Zero counts are
 *  left out, and at most four tiles show. */
export function TrialRecapTiles({ recap, title }: { recap: TrialRecap | null; title: string }) {
  const titleId = useId()
  if (!hasRecap(recap)) return null
  const tiles = RECAP_TILES.filter((t) => recap[t.key] > 0).slice(0, 4)
  return (
    <section aria-labelledby={titleId} data-testid="trial-recap" className="w-full">
      <p id={titleId} className="mb-2 text-center text-xs font-medium uppercase tracking-[0.12em] text-sage">{title}</p>
      <ul className={cn('grid gap-2', RECAP_GRID[tiles.length] ?? RECAP_GRID[2])}>
        {tiles.map((t) => (
          <li key={t.key} className="rounded-xl border border-topbar-border bg-white px-3 py-2.5 text-center">
            <span className="block text-xl font-semibold text-forest">{recap[t.key]}</span>{' '}
            <span className="block text-xs text-charcoal/75">{recap[t.key] === 1 ? t.one : t.many}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function WinbackBadge({ offer }: { offer: PublicWinbackOffer | null }) {
  if (!offer) return null
  return (
    <p
      data-testid="winback-offer"
      className="mx-auto inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 rounded-full border border-amber-mid bg-amber-light px-4 py-1.5 text-center text-sm text-amber-dark"
    >
      <span className="font-semibold">Oferta para voltar: {offer.label}.</span>{' '}
      <span>Aplicada automaticamente no pagamento até {formatBrDayMonth(offer.endsAt)}.</span>
    </p>
  )
}

export function ReferralBadge({ offer }: { offer: PublicReferralOffer | null }) {
  if (!offer) return null
  return (
    <p
      data-testid="referral-offer"
      className="mx-auto inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 rounded-full border border-sage/40 bg-white px-4 py-1.5 text-center text-sm text-forest"
    >
      <span className="font-semibold">{referralOfferHeadline(offer)}</span>{' '}
      <span>Aplicado automaticamente no pagamento.</span>
    </p>
  )
}

export function FeedbackBadge({ offer }: { offer: PublicFeedbackOffer | null }) {
  if (!offer) return null
  return (
    <p
      data-testid="feedback-offer"
      className="mx-auto inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 rounded-full border border-sage/40 bg-white px-4 py-1.5 text-center text-sm text-forest"
    >
      <span className="font-semibold">{feedbackOfferHeadline(offer)}</span>{' '}
      <span>Aplicado automaticamente no pagamento.</span>
    </p>
  )
}

/** The one badge for whichever offer applies; the caller passes at most one. */
export function OfferBadge({
  feedback,
  winback,
  referral,
}: {
  feedback: PublicFeedbackOffer | null
  winback: PublicWinbackOffer | null
  referral: PublicReferralOffer | null
}) {
  if (feedback) return <FeedbackBadge offer={feedback} />
  if (winback) return <WinbackBadge offer={winback} />
  return <ReferralBadge offer={referral} />
}

/** Risk reducers. Each is true today: cancellation is self-serve in
 *  Configurações › Assinatura, card data never touches our servers, and the
 *  clinic's data stays readable and exportable without a plan. */
export function TrustRow() {
  const items = [
    { icon: RefreshCwIcon, text: 'Cancele quando quiser' },
    { icon: LockKeyholeIcon, text: 'Pagamento seguro via Stripe' },
    { icon: ShieldCheckIcon, text: 'Seus dados continuam salvos' },
  ]
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-charcoal/75" data-testid="paywall-trust">
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5 text-sage" aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  )
}
