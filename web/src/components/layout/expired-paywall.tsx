'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Loader2, LockIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { brToday } from '@/lib/dates'
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
  if (PAYWALL_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`))) {
    return false
  }
  return storedDay !== today
}

function formatPrice(plan: PaywallPlan): string {
  const value = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(plan.priceCents / 100)
  return plan.billingInterval === 'year' ? `${value}/ano` : `${value}/mês`
}

function formatBrDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(
    new Date(iso),
  )
}

export function ExpiredPaywall() {
  const { readOnly, reason, tenantId, canSubscribe, plans, winback, paywallOpen, openPaywall, closePaywall } =
    useSubscriptionAccess()
  const pathname = usePathname()
  const [checkingOut, setCheckingOut] = useState<string | null>(null)

  useEffect(() => {
    if (!readOnly || !tenantId) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(paywallStorageKey(tenantId))
    } catch {
      // Private mode / storage disabled: fall through and show it.
    }
    if (shouldAutoOpenPaywall(pathname, stored, brToday())) openPaywall()
    // Only on first load of a page in the session, not on every navigation
    // inside the same day: the stored day is written when it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, tenantId])

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
    <Dialog open={paywallOpen} onOpenChange={(open) => (open ? openPaywall() : dismiss())}>
      <DialogContent
        showCloseButton={false}
        data-testid="expired-paywall"
        className="max-h-[100dvh] w-full max-w-full overflow-y-auto rounded-none p-6 sm:max-w-2xl sm:rounded-xl sm:p-8"
      >
        <div className="flex flex-col gap-5">
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
                automaticamente no pagamento até {formatBrDate(winback.endsAt)}.
              </p>
            </div>
          )}

          {plans.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {plans.map((plan) => (
                <div key={plan.slug} className="flex flex-col gap-3 rounded-xl border border-[#E8ECEF] p-4">
                  <div>
                    <p className="text-sm font-semibold text-charcoal">{plan.name}</p>
                    <p className="text-lg font-semibold text-forest">{formatPrice(plan)}</p>
                  </div>
                  {canSubscribe ? (
                    <Button
                      className="bg-forest text-cream hover:bg-sage"
                      disabled={checkingOut !== null}
                      onClick={() => subscribe(plan.slug)}
                      data-testid={`paywall-subscribe-${plan.slug}`}
                    >
                      {checkingOut === plan.slug && <Loader2 className="size-4 animate-spin" />}
                      Assinar {plan.name}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {!canSubscribe && (
            <p className="text-center text-sm text-mid">
              Só o responsável pela clínica pode assinar. Peça para ele escolher um plano em
              Configurações › Assinatura.
            </p>
          )}

          <div className="flex flex-col items-center gap-2 border-t border-[#E8ECEF] pt-4 text-sm">
            <Button variant="ghost" onClick={dismiss} data-testid="paywall-read-only">
              Continuar em modo leitura
            </Button>
            <p className="text-center text-xs text-mid">
              No modo leitura você consulta tudo e exporta seus dados, mas não cria nem edita.{' '}
              <ExportDataLink className="font-medium text-forest underline underline-offset-2" />
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
