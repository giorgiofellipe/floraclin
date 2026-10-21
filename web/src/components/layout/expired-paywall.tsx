'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Loader2, LockIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { brToday, formatBrDayMonth } from '@/lib/dates'
import { ExportDataLink } from '@/components/layout/export-data-dialog'
import { useSubscriptionAccess, type PaywallPlan } from '@/components/layout/subscription-access'

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

function formatPrice(plan: PaywallPlan): string {
  const value = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(plan.priceCents / 100)
  return plan.billingInterval === 'year' ? `${value}/ano` : `${value}/mês`
}

export function ExpiredPaywall() {
  const { readOnly, reason, tenantId, canSubscribe, plans, winback, paywallOpen, openPaywall, closePaywall } =
    useSubscriptionAccess()
  const pathname = usePathname()
  const [checkingOut, setCheckingOut] = useState<string | null>(null)

  // Re-checked on every navigation, so a session that starts on an exempt
  // page (billing) still gets it on the next page, and a tab left open past
  // midnight gets the next day's showing. The stored day and the ref keep it
  // to once per day and once per session.
  const autoOpenedRef = useRef(false)
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

  async function subscribe(planSlug: string) {
    setCheckingOut(planSlug)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Não foi possível abrir o pagamento.')
      if (body.url) {
        window.location.href = body.url
        return
      }
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível abrir o pagamento.')
      setCheckingOut(null)
    }
  }

  const title = reason === 'trial' ? 'Seu período de teste terminou' : 'Sua assinatura terminou'

  return (
    // Esc and a backdrop click count as "Continuar em modo leitura".
    <Dialog open={paywallOpen} onOpenChange={(open) => (open ? openPaywall() : dismiss())}>
      <DialogContent
        showCloseButton={false}
        data-testid="expired-paywall"
        // Full screen on every size: it replaces the page until the clinic
        // subscribes or chooses read-only mode.
        className="inset-0 top-0 left-0 h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 place-items-center rounded-none bg-cream p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] ring-0 sm:max-w-none sm:p-10"
      >
        <div className="flex w-full max-w-2xl flex-col gap-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-petal">
              <LockIcon className="size-5 text-forest" />
            </div>
            <DialogTitle className="text-xl text-charcoal">{title}</DialogTitle>
            <DialogDescription className="max-w-md text-sm text-mid">
              Seus pacientes, prontuários, agenda e histórico financeiro continuam salvos. Assine um plano
              para voltar a cadastrar, agendar, registrar atendimentos e enviar mensagens pelo WhatsApp.
            </DialogDescription>
          </div>

          {winback && (
            <div
              data-testid="winback-offer"
              className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <SparklesIcon className="mt-0.5 size-4 shrink-0" />
              <p>
                <span className="font-semibold">Oferta para voltar: {winback.label}.</span> Aplicada
                automaticamente no pagamento até {formatBrDayMonth(winback.endsAt)}.
              </p>
            </div>
          )}

          {plans.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {plans.map((plan) => (
                <div key={plan.slug} className="flex flex-col gap-3 rounded-xl border border-topbar-border bg-white p-4">
                  <div>
                    <p className="text-sm font-semibold text-charcoal">{plan.name}</p>
                    <p className="text-lg font-semibold text-forest">{formatPrice(plan)}</p>
                  </div>
                  {canSubscribe && (
                    <Button
                      className="bg-forest text-cream hover:bg-sage"
                      disabled={checkingOut !== null}
                      onClick={() => subscribe(plan.slug)}
                      data-testid={`paywall-subscribe-${plan.slug}`}
                    >
                      {checkingOut === plan.slug && <Loader2 className="size-4 animate-spin" />}
                      Assinar {plan.name}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!canSubscribe && (
            <p className="text-center text-sm text-mid">
              Só a pessoa responsável pela clínica pode assinar. Peça a ela para escolher um plano em
              Configurações › Assinatura.
            </p>
          )}

          <div className="flex flex-col items-center gap-2 border-t border-topbar-border pt-4 text-sm">
            <Button variant="ghost" onClick={dismiss} data-testid="paywall-read-only">
              Continuar em modo leitura
            </Button>
            <p className="text-center text-xs text-mid">
              No modo leitura você consulta tudo e exporta seus dados, mas não cria nem edita.{' '}
              <ExportDataLink className="font-medium text-forest underline underline-offset-2" onNavigate={dismiss} />
            </p>
          </div>
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
