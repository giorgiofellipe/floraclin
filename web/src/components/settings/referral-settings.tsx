'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { brl } from '@/lib/billing-discount-copy'
import { useReferralDashboard } from '@/hooks/queries/use-referral-dashboard'
import { track } from '@/lib/analytics/client'
import type { ReferralPageSource, ReferralPageState } from '@/lib/analytics/events'
import {
  REFERRAL_MAX_COUNTING_FOR_DISCOUNT,
  REFERRAL_PERCENT_PER_REFERRAL,
  REFERRAL_TRIAL_DAYS,
  REFERRAL_WELCOME_MONTHS,
  REFERRAL_WELCOME_PERCENT,
} from '@/lib/referral/rules'
import type { ReferralDashboardResponse } from '@/lib/referral/dashboard'
import type { ReferralStatus } from '@/lib/referral/types'
import { ReferralGift } from '@/components/referral/referral-gift'
import { ReferralSteps } from '@/components/referral/referral-steps'
import { ReferralCodeEditor } from './referral-code-editor'

const BOX = 'rounded-xl border border-topbar-border bg-white p-4 sm:p-5'
const FOOTNOTE = '*Enquanto a clínica indicada seguir pagando.'

const CHIP: Record<ReferralStatus, string> = {
  counting: 'bg-sage/15 text-sage',
  first_paid: 'bg-content-bg text-mid',
  trial: 'bg-amber-50 text-amber-700',
  trial_ended: 'bg-content-bg text-mid',
  paused: 'bg-amber-50 text-amber-700',
  canceled: 'bg-content-bg text-mid',
  ineligible: 'bg-red-50 text-red-700',
}

const SOURCES: readonly ReferralPageSource[] = ['sidebar_card', 'launch_email', 'status_email']

function pageSource(): ReferralPageSource {
  const from = new URLSearchParams(window.location.search).get('from')
  return SOURCES.find((s) => s === from) ?? 'direct'
}

function pageState(data: ReferralDashboardResponse): ReferralPageState {
  if (data.subscribeToUnlock) return 'subscribe_to_unlock'
  return data.link ? 'sharing' : 'inactive'
}

function useTrackPageView(data: ReferralDashboardResponse | null | undefined) {
  const tracked = useRef(false)
  useEffect(() => {
    if (!data || tracked.current) return
    tracked.current = true
    track('referral_page_viewed', { source: pageSource(), state: pageState(data), counting: data.progress.counting })
  }, [data])
}

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.error('Não foi possível copiar')
  }
}

function Hero({ data }: { data: ReferralDashboardResponse }) {
  const { counting } = data.progress
  const left = REFERRAL_MAX_COUNTING_FOR_DISCOUNT - counting

  if (data.subscribeToUnlock) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-blush bg-gradient-to-br from-cream to-blush/30 p-4 sm:p-5">
        <ReferralGift size="lg" locked />
        <div>
          <h3 className="font-display text-2xl font-semibold leading-tight text-forest">Ganhe até 100% de desconto</h3>
          <p className="mt-1 text-sm text-mid">
            Assine e indique colegas: {REFERRAL_PERCENT_PER_REFERRAL}% por clínica pagando, para sempre*. Com{' '}
            {REFERRAL_MAX_COUNTING_FOR_DISCOUNT}, seu FloraClin sai de graça.
          </p>
        </div>
      </div>
    )
  }

  let title = 'Indique e Ganhe'
  if (data.link && counting >= REFERRAL_MAX_COUNTING_FOR_DISCOUNT) title = 'Seu FloraClin está grátis 🎉'
  else if (data.link) title = `${left === 1 ? 'Falta 1 clínica' : `Faltam ${left} clínicas`} para o FloraClin grátis`

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-mint/40 bg-gradient-to-br from-cream to-mint/20 p-4 sm:p-5">
      <ReferralGift size="lg" />
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-2xl font-semibold leading-tight text-forest">{title}</h3>
        <p className="mt-1 text-sm text-mid">
          {data.inactiveMessage ??
            `Cada clínica indicada pagando vale ${REFERRAL_PERCENT_PER_REFERRAL}% de desconto, para sempre*.`}
        </p>
      </div>
      {data.discountPercent > 0 && (
        <div className="text-right">
          <p className="font-display text-5xl font-bold leading-none text-sage">{data.discountPercent}%</p>
          {data.monthlySavingsCents != null && (
            <p className="mt-1 text-xs text-mid">{brl(data.monthlySavingsCents)}/mês a menos</p>
          )}
        </div>
      )}
    </div>
  )
}

function Share({ data }: { data: ReferralDashboardResponse }) {
  if (data.subscribeToUnlock) {
    return (
      <Link href="/configuracoes?tab=assinatura" className={cn(buttonVariants(), 'w-fit')}>
        Assinar e desbloquear meu link
      </Link>
    )
  }
  if (!data.link || !data.shareText || !data.whatsappShareUrl) return null
  const { link, shareText, whatsappShareUrl } = data
  return (
    <section className={BOX}>
      <h3 className="text-sm font-medium text-charcoal">Seu link de indicação</h3>
      <p className="mt-3 break-all rounded-lg bg-content-bg px-3 py-2 text-sm text-charcoal">{link}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={() => copy(link, 'Link copiado')}>
          Copiar link
        </Button>
        <a
          href={whatsappShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants(), 'bg-[#25D366] text-white hover:bg-[#25D366]/90')}
        >
          Compartilhar no WhatsApp
        </a>
        <Button type="button" variant="outline" onClick={() => copy(shareText, 'Texto copiado')}>
          Copiar texto para Instagram
        </Button>
      </div>
      {data.code && (
        <div className="mt-3">
          <ReferralCodeEditor currentCode={data.code} previousCodes={data.previousCodes} />
        </div>
      )}
    </section>
  )
}

const HOW_IT_WORKS = [
  { title: '1. Envie seu link', text: 'Para colegas de HOF e estética.' },
  {
    title: '2. Seu colega ganha',
    text: `${REFERRAL_TRIAL_DAYS} dias grátis + ${REFERRAL_WELCOME_PERCENT}% nos ${REFERRAL_WELCOME_MONTHS} primeiros meses.`,
  },
  {
    title: '3. Você ganha',
    text: `${REFERRAL_PERCENT_PER_REFERRAL}% por clínica pagando, a partir da 2ª mensalidade dela.`,
  },
]

export function ReferralSettings() {
  const { data, isLoading, isError } = useReferralDashboard()
  useTrackPageView(data)

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (isError || !data) {
    return <p className="py-12 text-center text-sm text-mid">Erro ao carregar indicações.</p>
  }

  const showSteps = data.subscribeToUnlock || !!data.link

  return (
    <div className="space-y-4">
      <Hero data={data} />

      {showSteps && (
        <div className="space-y-2">
          <ReferralSteps counting={data.subscribeToUnlock ? 0 : data.progress.counting} />
          {!data.subscribeToUnlock && <p className="text-xs text-mid">{data.discountLine}</p>}
          {data.progress.bonusLabel && <p className="text-xs text-mid">{data.progress.bonusLabel}</p>}
        </div>
      )}

      <Share data={data} />

      <div className="grid gap-2 sm:grid-cols-3">
        {HOW_IT_WORKS.map((step) => (
          <div key={step.title} className="rounded-xl bg-cream p-3 text-sm text-mid">
            <p className="font-medium text-forest">{step.title}</p>
            <p className="mt-0.5">{step.text}</p>
          </div>
        ))}
      </div>

      {!data.subscribeToUnlock && (
        <section className={BOX}>
          <h3 className="text-sm font-medium text-charcoal">Clínicas indicadas</h3>
          {data.referrals.length === 0 ? (
            <p className="mt-2 text-sm text-mid">Nenhuma clínica indicada ainda.</p>
          ) : (
            <ul className="mt-3 divide-y divide-topbar-border">
              {data.referrals.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-charcoal">{r.name}</p>
                    <p className="text-xs text-mid">{r.signupDate}</p>
                  </div>
                  <div className="text-right">
                    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', CHIP[r.status])}>
                      {r.label}
                    </span>
                    {r.sublabel && <p className="mt-0.5 text-xs text-mid">{r.sublabel}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.history.length > 0 && (
        <details className={cn(BOX, 'group')}>
          <summary className="cursor-pointer text-sm font-medium text-charcoal">Histórico</summary>
          <ul className="mt-3 space-y-1">
            {data.history.map((h, i) => (
              <li key={`${h.date}-${i}`} className="text-sm text-mid">
                {h.date}: {h.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mid">
        <span>{FOOTNOTE}</span>
        <a href={data.rulesUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-sage underline">
          Ver regras do programa
        </a>
      </div>
    </div>
  )
}
