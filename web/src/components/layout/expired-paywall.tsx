'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { Loader2, LockIcon } from 'lucide-react'
import { LogoSymbol } from '@/components/brand/logo-symbol'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { brToday } from '@/lib/dates'
import { ExportDataLink } from '@/components/layout/export-data-dialog'
import {
  PlanCards,
  QUIET_ACTION_CLASS,
  TrialRecapTiles,
  OfferBadge,
  TrustRow,
  entryPriceLine,
  hasRecap,
  usePlanCheckout,
} from '@/components/layout/plan-checkout'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'

/** Pages that are the way out (billing) or account hygiene (profile): the
 *  paywall never opens on its own there. */
const PAYWALL_EXEMPT_PREFIXES = ['/configuracoes']

export function paywallStorageKey(tenantId: string): string {
  return `floraclin:paywall-dismissed:${tenantId}`
}

/** Shown at most once per BR calendar day per clinic, on this device. */
export function shouldAutoOpenPaywall(
  pathname: string,
  storedDay: string | null,
  today: string,
): boolean {
  if (PAYWALL_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false
  }
  return storedDay !== today
}

/** Value-led copy: what the clinic keeps by continuing, not what went wrong. */
function paywallCopy({ paymentUpdate, trial, built }: { paymentUpdate: boolean; trial: boolean; built: boolean }) {
  if (paymentUpdate) {
    return {
      eyebrow: 'Pagamento pendente',
      headline: 'Atualize o cartão e continue de onde parou',
      description:
        'Não conseguimos cobrar a sua assinatura. Seus dados estão salvos; atualize a forma de pagamento para voltar a cadastrar, agendar e enviar WhatsApp.',
    }
  }
  return {
    eyebrow: trial ? 'Seu teste gratuito terminou' : 'Sua assinatura terminou',
    headline: built ? 'Sua clínica já está montada. Continue de onde parou.' : 'Mantenha sua clínica funcionando na FloraClin',
    description:
      'Tudo o que você cadastrou continua salvo. Escolha um plano para voltar a cadastrar, agendar, registrar atendimentos e enviar WhatsApp.',
  }
}

export function ExpiredPaywall() {
  const {
    readOnly,
    reason,
    tenantId,
    canSubscribe,
    plans,
    feedback,
    winback,
    referral,
    recap,
    recovery,
    paywallOpen,
    openPaywall,
    closePaywall,
  } = useSubscriptionAccess()
  const pathname = usePathname()
  const { pending, subscribe, updatePayment } = usePlanCheckout()

  // Re-checked on every navigation, so a session that starts on an exempt
  // page (billing) still gets it on the next page, and a tab left open past
  // midnight gets the next day's showing. The stored day and the ref keep it
  // to once per day and once per session.
  const autoOpenedRef = useRef(false)
  const popupRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!readOnly || !tenantId || autoOpenedRef.current) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(paywallStorageKey(tenantId))
    } catch {
      // Private mode / storage disabled: fall through and show it.
    }
    if (shouldAutoOpenPaywall(pathname, stored, brToday())) {
      autoOpenedRef.current = true
      openPaywall()
    }
  }, [readOnly, tenantId, pathname, openPaywall])

  if (!readOnly) return null

  function dismiss() {
    try {
      window.localStorage.setItem(paywallStorageKey(tenantId), brToday())
    } catch {
      // Ignore: worst case it shows again on the next load.
    }
    closePaywall()
  }

  // One offer at most, in checkout's order: feedback, win-back, referral.
  const offer = feedback ?? winback ?? referral
  const paymentUpdate = recovery === 'payment_update'
  const built = hasRecap(recap)
  const entryPrice = paymentUpdate ? null : entryPriceLine(plans, offer)
  const copy = paywallCopy({ paymentUpdate, trial: reason === 'trial', built })

  return (
    // Esc and a backdrop click count as "Continuar em modo leitura".
    <Dialog open={paywallOpen} onOpenChange={(open) => (open ? openPaywall() : dismiss())}>
      <DialogContent
        showCloseButton={false}
        data-testid="expired-paywall"
        // Focus the dialog itself, not the first plan button: on a phone that
        // would scroll past the headline and the clinic's numbers.
        initialFocus={popupRef}
        ref={popupRef}
        // Full screen on every size, scrolling on short screens: it replaces
        // the page until the clinic subscribes or chooses read-only mode.
        className="inset-0 top-0 left-0 block h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none bg-cream p-0 ring-0 sm:max-w-none"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-6 px-5 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-12">
          <header className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-white shadow-[0_2px_10px_rgba(28,43,30,0.08)] ring-1 ring-topbar-border" aria-hidden>
              <LogoSymbol className="size-7 text-sage" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sage" data-testid="paywall-eyebrow">
              {copy.eyebrow}
            </p>
            <DialogTitle className="max-w-xl font-display text-[26px] leading-tight font-semibold text-forest sm:text-[32px]">
              {copy.headline}
            </DialogTitle>
            <DialogDescription className="max-w-lg text-[15px] leading-relaxed text-charcoal/80">
              {copy.description}
            </DialogDescription>
            {entryPrice && (
              <p className="text-sm font-semibold text-forest" data-testid="paywall-entry-price">
                {entryPrice}
              </p>
            )}
          </header>

          {!paymentUpdate && <TrialRecapTiles recap={recap} title="O que sua clínica já tem aqui" />}

          {!paymentUpdate && <OfferBadge feedback={feedback} winback={winback} referral={referral} />}

          {paymentUpdate && canSubscribe && (
              <Button
                size="lg"
                className="h-12 w-full max-w-sm bg-forest text-sm font-semibold text-cream hover:bg-sage"
                disabled={pending !== null}
                onClick={updatePayment}
                data-testid="paywall-update-payment"
              >
                {pending === 'payment_update' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Atualizar forma de pagamento
              </Button>
          )}
          {!paymentUpdate && (
            <div className="w-full">
              <PlanCards
                plans={plans}
                offer={offer}
                canSubscribe={canSubscribe}
                pending={pending}
                onSubscribe={subscribe}
              />
            </div>
          )}

          {!canSubscribe && (
            <p className="max-w-md rounded-xl bg-white px-4 py-3 text-center text-sm text-charcoal ring-1 ring-topbar-border">
              {paymentUpdate
                ? 'Só a pessoa responsável pela clínica pode atualizar o pagamento. Peça a ela para acessar Configurações › Assinatura.'
                : 'Só a pessoa responsável pela clínica pode assinar. Peça a ela para escolher um plano em Configurações › Assinatura.'}
            </p>
          )}

          <TrustRow />

          <footer className="flex flex-col items-center gap-1.5 text-center">
            <button
              type="button"
              onClick={dismiss}
              data-testid="paywall-read-only"
              className={QUIET_ACTION_CLASS}
            >
              Continuar em modo leitura
            </button>
            <p className="text-xs text-charcoal/70">
              No modo leitura você consulta e exporta seus dados, mas não cria nem edita.{' '}
              <ExportDataLink className="font-medium text-forest underline underline-offset-2" onNavigate={dismiss} />
            </p>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ReadOnlyBadge() {
  const { readOnly, openPaywall } = useSubscriptionAccess()
  if (!readOnly) return null
  return (
    <button
      type="button"
      onClick={openPaywall}
      data-testid="read-only-badge"
      className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
    >
      <LockIcon className="size-3" />
      Modo leitura
    </button>
  )
}
