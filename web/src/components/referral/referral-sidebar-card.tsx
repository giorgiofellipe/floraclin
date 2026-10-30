'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, MessageCircle, X } from 'lucide-react'
import { useReferralDashboard } from '@/hooks/queries/use-referral-dashboard'
import { REFERRAL_BONUS_CREDITS_PER_EXTRA, REFERRAL_MAX_COUNTING_FOR_DISCOUNT } from '@/lib/referral/rules'
import type { ReferralDashboardResponse } from '@/lib/referral/dashboard'
import { ReferralGift } from './referral-gift'

const COLLAPSED_KEY = 'floraclin_referral_card_collapsed'
const REFERRAL_TAB = '/configuracoes?tab=indique&from=sidebar_card'
const BILLING_TAB = '/configuracoes?tab=assinatura'
const COPIED_MS = 2000

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(COLLAPSED_KEY, '1')
    else localStorage.removeItem(COLLAPSED_KEY)
  } catch {
    // Blocked storage: the choice holds for this page view only.
  }
}

function cardCopy(data: ReferralDashboardResponse): { tag: string; title: string; line: string } {
  if (data.subscribeToUnlock) {
    return { tag: 'ATÉ 100% OFF', title: 'Ganhe até 100%', line: '20% por clínica indicada, para sempre*' }
  }
  const { counting } = data.progress
  if (counting >= REFERRAL_MAX_COUNTING_FOR_DISCOUNT) {
    return {
      tag: 'GRÁTIS',
      title: 'FloraClin grátis 🎉',
      line: `+${REFERRAL_BONUS_CREDITS_PER_EXTRA} créditos WhatsApp por nova clínica`,
    }
  }
  const left = REFERRAL_MAX_COUNTING_FOR_DISCOUNT - counting
  return {
    tag: data.discountPercent > 0 ? `${data.discountPercent}% OFF` : 'ATÉ 100% OFF',
    title: 'Indique e Ganhe',
    line: `${counting} de ${REFERRAL_MAX_COUNTING_FOR_DISCOUNT} · ${left === 1 ? 'falta 1' : `faltam ${left}`} para grátis`,
  }
}

/** Owners only: the caller decides who sees it. Hidden unless the clinic can share now or can unlock by subscribing. */
export function ReferralSidebarCard({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useReferralDashboard()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [copied, setCopied] = useState(false)

  if (!data) return null
  const sharing = data.enrollmentOpen && !!data.link
  if (!sharing && !data.subscribeToUnlock) return null

  const toggle = (next: boolean) => {
    setCollapsed(next)
    writeCollapsed(next)
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => toggle(false)}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-sage/30 px-2.5 py-2 text-left text-[11px] text-mid transition-colors hover:bg-sage/5 hover:text-charcoal"
      >
        <ReferralGift size="xs" locked={!sharing} />
        <span>
          Indique e Ganhe{sharing && data.discountPercent > 0 ? ` · ${data.discountPercent}%` : ''}
        </span>
      </button>
    )
  }

  const { tag, title, line } = cardCopy(data)
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(data.link!)
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // Clipboard blocked: the card still links to the tab, which shows the link to copy by hand.
    }
  }

  return (
    <div className="relative rounded-xl border border-mint/40 bg-gradient-to-br from-cream to-mint/15 p-3 shadow-sm">
      <button
        type="button"
        aria-label="Ocultar Indique e Ganhe"
        onClick={() => toggle(true)}
        className="absolute right-1.5 top-1.5 rounded p-1 text-mid/60 transition-colors hover:text-charcoal"
      >
        <X className="size-3.5" />
      </button>
      <Link href={REFERRAL_TAB} onClick={onNavigate} className="block pr-4">
        <span className="flex items-center gap-2">
          <ReferralGift locked={!sharing} />
          <span className="rounded-full bg-[#E07A5F] px-2 py-0.5 text-[9px] font-bold tracking-wider text-white">{tag}</span>
        </span>
        <span className="mt-2 block text-[13px] font-semibold leading-snug text-forest">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-mid">{line}</span>
      </Link>

      {sharing ? (
        <>
          <div
            role="progressbar"
            aria-label="Progresso de indicações"
            aria-valuemin={0}
            aria-valuemax={data.progress.target}
            aria-valuenow={Math.min(data.progress.counting, data.progress.target)}
            className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-topbar-border"
          >
            <div
              className="relative h-full overflow-hidden rounded-full bg-sage"
              style={{ width: `${Math.max(data.progress.percent, 4)}%` }}
            >
              <span className="absolute inset-0 animate-bar-shine bg-gradient-to-r from-transparent via-white/70 to-transparent" />
            </div>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={copyLink}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-forest py-1.5 text-[11px] font-semibold text-cream transition-colors hover:bg-sage"
            >
              {copied ? (
                <>
                  <Check className="size-3" /> Copiado
                </>
              ) : (
                'Copiar link'
              )}
            </button>
            <a
              href={data.whatsappShareUrl!}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Compartilhar no WhatsApp"
              className="grid w-8 place-items-center rounded-md bg-[#25D366] text-white transition-opacity hover:opacity-90"
            >
              <MessageCircle className="size-3.5" />
            </a>
          </div>
        </>
      ) : (
        <>
          <Link
            href={BILLING_TAB}
            onClick={onNavigate}
            className="mt-2.5 block rounded-md bg-forest py-1.5 text-center text-[11px] font-semibold text-cream transition-colors hover:bg-sage"
          >
            Assinar
          </Link>
          <p className="mt-1.5 text-[10px] text-mid/80">*enquanto ela pagar</p>
        </>
      )}
    </div>
  )
}
