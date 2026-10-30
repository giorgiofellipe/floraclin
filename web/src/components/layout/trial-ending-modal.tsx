'use client'

import { useRef, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { CalendarClockIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { brEndPhrase } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { OfferBadge, PlanCards, QUIET_ACTION_CLASS, TrialRecapTiles, TrustRow, usePlanCheckout } from '@/components/layout/plan-checkout'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'

/** Per trial end, not per clinic: an admin extension moves the end, so the
 *  heads-up shows again before the new one. */
export function trialEndingModalKey(tenantId: string, trialEndsAt: string): string {
  return `floraclin:trial-ending-modal:${tenantId}:${new Date(trialEndsAt).getTime()}`
}

/** "amanhã às 18:30" / "hoje às 18:30", the banner's and the email's words. */
export function trialEndingTitle(endsAt: Date, now: Date): string {
  return `Seu teste termina ${brEndPhrase(endsAt, now)}`
}

/**
 * One-time heads-up when a free trial has a day (or less) left: what the
 * clinic set up so far and the plans, before the paywall would ever show.
 * Shown once per trial end on this device; dismissal lives in localStorage so
 * no schema change is needed. Never on Configurações, where the plans are
 * already on screen.
 */
const seenListeners = new Set<() => void>()
// Storage unavailable counts as "seen" in memory for this load only.
const seenInMemory = new Set<string>()

function subscribeSeen(listener: () => void) {
  seenListeners.add(listener)
  return () => seenListeners.delete(listener)
}

function readSeen(tenantId: string, trialEndsAt: string | null): boolean {
  if (!tenantId || !trialEndsAt) return true
  const key = trialEndingModalKey(tenantId, trialEndsAt)
  if (seenInMemory.has(key)) return true
  try {
    return window.localStorage.getItem(key) !== null
  } catch {
    return false // Storage blocked: show it; markSeen keeps it closed for this load.
  }
}

function markSeen(tenantId: string, trialEndsAt: string) {
  const key = trialEndingModalKey(tenantId, trialEndsAt)
  try {
    window.localStorage.setItem(key, new Date().toISOString())
  } catch {
    seenInMemory.add(key)
  }
  seenListeners.forEach((l) => l())
}

export function TrialEndingModal() {
  const { tenantId, trialEndsAt, recap, plans, canSubscribe, readOnly, feedback, referral } = useSubscriptionAccess()
  const pathname = usePathname()
  const popupRef = useRef<HTMLDivElement>(null)
  const { pending, subscribe } = usePlanCheckout()
  // Read from localStorage through an external store: the server snapshot
  // says "seen" so nothing flashes before hydration.
  const seen = useSyncExternalStore(
    subscribeSeen,
    () => readSeen(tenantId, trialEndsAt),
    () => true,
  )
  const onBilling = pathname === '/configuracoes' || pathname.startsWith('/configuracoes/')
  const open = !readOnly && !!trialEndsAt && !!tenantId && !onBilling && !seen

  if (readOnly || !trialEndsAt) return null

  const endsAt = trialEndsAt
  const dismiss = () => markSeen(tenantId, endsAt)

  const title = trialEndingTitle(new Date(trialEndsAt), new Date())

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss() }}>
      <DialogContent
        data-testid="trial-ending-modal"
        // Focus the dialog itself, not the first plan button: on a phone that
        // would scroll past the headline and the clinic's numbers.
        initialFocus={popupRef}
        ref={popupRef}
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto bg-cream p-5 sm:max-w-2xl sm:p-7"
      >
        <header className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-white ring-1 ring-topbar-border" aria-hidden>
            <CalendarClockIcon className="size-5 text-sage" />
          </div>
          <DialogTitle className="font-display text-2xl leading-tight font-semibold text-forest">{title}</DialogTitle>
          <DialogDescription className="max-w-md text-sm leading-relaxed text-charcoal/80">
            Depois disso a conta fica em modo leitura: você consulta e exporta tudo, mas não cadastra, não agenda e
            não envia WhatsApp. Assinando agora, nada para.
          </DialogDescription>
        </header>

        <TrialRecapTiles recap={recap} title="O que você já montou no teste" />

        <OfferBadge feedback={feedback} winback={null} referral={referral} />

        <PlanCards plans={plans} offer={feedback ?? referral} canSubscribe={canSubscribe} pending={pending} onSubscribe={subscribe} />

        {!canSubscribe && (
          <p className="text-center text-sm text-charcoal">
            Só a pessoa responsável pela clínica pode assinar. Avise a ela para escolher um plano em Configurações ›
            Assinatura.
          </p>
        )}

        <TrustRow />

        <button
          type="button"
          onClick={dismiss}
          data-testid="trial-ending-later"
          className={cn('mx-auto', QUIET_ACTION_CLASS)}
        >
          Agora não
        </button>
      </DialogContent>
    </Dialog>
  )
}
