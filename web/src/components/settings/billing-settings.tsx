'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Loader2Icon,
  CheckIcon,
  UsersIcon,
  UserIcon,
  MessageCircleIcon,
  CreditCardIcon,
  AlertTriangleIcon,
} from 'lucide-react'
import { differenceInDays } from 'date-fns'

type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

interface UsageBucket {
  used: number
  limit: number
}

interface BillingUsageResponse {
  subscription: {
    status: SubscriptionStatus
    currentPeriodEnd: string
    stripeSubscriptionId: string | null
    hasStripeCustomer: boolean
    source: string
  }
  plan: {
    name: string
    slug: string
    priceCents: number
    features: Record<string, boolean>
  }
  usage: {
    users: UsageBucket
    patients: UsageBucket
    whatsapp: UsageBucket
  }
}

interface PlanItem {
  id: string
  slug: string
  name: string
  priceCents: number
  billingInterval: string
  limits: Record<string, number>
  features: Record<string, boolean>
  displayOrder: number
}

interface PlansResponse {
  data: PlanItem[]
}

const STATUS_CONFIG: Record<SubscriptionStatus, { label: string; className: string }> = {
  trialing: {
    label: 'Teste gratuito',
    className: 'bg-blue-100 text-blue-700',
  },
  active: {
    label: 'Ativo',
    className: 'bg-emerald-100 text-emerald-700',
  },
  past_due: {
    label: 'Pagamento pendente',
    className: 'bg-amber-100 text-amber-700',
  },
  expired: {
    label: 'Expirado',
    className: 'bg-red-100 text-red-700',
  },
  canceled: {
    label: 'Cancelado',
    className: 'bg-gray-100 text-gray-500',
  },
}

const CORE_FEATURES = [
  'WhatsApp integrado',
  'Agendamento online',
  'Gestão financeira',
  'Documentos personalizados',
  'Termos de consentimento',
  'Fichas de avaliação',
  'Pacotes de procedimentos',
  'Log de auditoria',
  'Google Calendar',
]

const GATED_FEATURE_LABELS: Record<string, string> = {
  own_whatsapp_number: 'Número próprio de WhatsApp',
}

function UsageBar({ label, icon: Icon, used, limit }: {
  label: string
  icon: typeof UsersIcon
  used: number
  limit: number
}) {
  const isUnlimited = limit === -1
  const percentage = isUnlimited ? 0 : limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const isNearLimit = !isUnlimited && limit > 0 && percentage >= 80
  const isAtLimit = !isUnlimited && limit > 0 && used >= limit

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-charcoal font-medium">
          <Icon className="h-4 w-4 text-mid" />
          {label}
        </div>
        <span className="text-mid text-xs">
          {used} / {isUnlimited ? 'Ilimitado' : limit}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-2 rounded-full bg-[#E8ECEF] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isAtLimit ? 'bg-red-400' : isNearLimit ? 'bg-amber-400' : 'bg-sage'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  )
}

function PlanCard({
  plan,
  isCurrent,
  isSwitch,
  isCheckingOut,
  onSubscribe,
}: {
  plan: PlanItem
  isCurrent: boolean
  isSwitch: boolean
  isCheckingOut: boolean
  onSubscribe: (slug: string) => void
}) {
  const isFree = plan.priceCents === 0
  const price = isFree
    ? 'Gratuito'
    : `R$ ${(plan.priceCents / 100).toFixed(2).replace('.', ',')}/mês`

  const features = plan.features as Record<string, boolean>
  const limits = plan.limits as Record<string, number>

  return (
    <div
      className={`flex flex-col rounded-[3px] border p-5 transition-shadow ${
        isCurrent
          ? 'border-sage bg-sage/5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
          : 'border-[#E8ECEF] bg-white hover:shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-medium text-charcoal">{plan.name}</h3>
          <p className="text-lg font-semibold text-forest mt-0.5">{price}</p>
        </div>
        {isCurrent && (
          <Badge className="bg-sage/20 text-sage border-sage/30 text-[11px]">Atual</Badge>
        )}
      </div>

      <div className="space-y-2 mb-4 flex-1">
        <p className="text-xs font-medium text-mid uppercase tracking-wider">Limites</p>
        <ul className="space-y-1 text-sm text-charcoal">
          <li className="flex items-center gap-2">
            <UsersIcon className="h-3.5 w-3.5 text-mid" />
            {limits.users === -1 ? 'Usuários ilimitados' : `${limits.users ?? 0} usuários`}
          </li>
          <li className="flex items-center gap-2">
            <UserIcon className="h-3.5 w-3.5 text-mid" />
            {limits.patients === -1 ? 'Pacientes ilimitados' : `${limits.patients ?? 0} pacientes`}
          </li>
          <li className="flex items-center gap-2">
            <MessageCircleIcon className="h-3.5 w-3.5 text-mid" />
            {(limits.whatsapp_conversations ?? 0) === -1
              ? 'Conversas ilimitadas'
              : `${limits.whatsapp_conversations ?? 0} créditos de WhatsApp/mês`}
          </li>
        </ul>

        <p className="text-xs font-medium text-mid uppercase tracking-wider pt-2">Recursos</p>
        <ul className="space-y-1 text-sm">
          {CORE_FEATURES.map((label) => (
            <li key={label} className="flex items-center gap-2 text-charcoal">
              <CheckIcon className="h-3.5 w-3.5 text-sage" />
              {label}
            </li>
          ))}
          {Object.entries(GATED_FEATURE_LABELS).map(([key, label]) => {
            const enabled = features[key] === true
            return (
              <li
                key={key}
                className={`flex items-center gap-2 ${enabled ? 'text-charcoal' : 'text-mid/50 line-through'}`}
              >
                <CheckIcon className={`h-3.5 w-3.5 ${enabled ? 'text-sage' : 'text-mid/30'}`} />
                {label}
              </li>
            )
          })}
        </ul>
      </div>

      {!isCurrent && !isFree && (
        <Button
          className="w-full bg-forest text-white hover:bg-forest/90"
          disabled={isCheckingOut}
          onClick={() => onSubscribe(plan.slug)}
        >
          {isCheckingOut ? (
            <>
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Aguarde...
            </>
          ) : (
            <>
              <CreditCardIcon className="h-4 w-4" />
              {isSwitch ? 'Mudar para este plano' : 'Assinar'}
            </>
          )}
        </Button>
      )}
    </div>
  )
}

/**
 * The message to show for a failed billing request.
 *
 * A 4xx body carries something written for this user ("Este já é o seu plano
 * atual"). A 5xx carries whatever handleApiError produced, which is the
 * English string "Internal Server Error", and putting that in a toast in
 * front of a clinic owner helps nobody.
 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status >= 500) return fallback
  const body = await res.json().catch(() => ({}))
  return typeof body.error === 'string' && body.error ? body.error : fallback
}

export function BillingSettings() {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [checkingOutSlug, setCheckingOutSlug] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { update } = useSession()

  // Stripe redirects to success_url as soon as the card clears, before the
  // webhook arrives. Without this, the customer lands back here and sees a
  // read-only banner telling them to subscribe to what they just paid for.
  const sessionId = searchParams.get('session_id')
  const confirmedRef = useRef(false)
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(() => Boolean(sessionId))

  const confirmMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/billing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      })
      if (!res.ok) {
        throw new Error('Erro ao confirmar pagamento')
      }
      return res.json()
    },
    onSuccess: async () => {
      // Refresh the JWT so it picks up the new subscription status, then
      // refetch whatever drives this page.
      await update()
      queryClient.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (err) => {
      // The webhook is still the source of truth and will very likely
      // activate the subscription within seconds. A customer who just paid
      // should never see a scary error for something that isn't broken.
      console.error('Falha ao confirmar pagamento pelo retorno do Stripe', err)
    },
    onSettled: () => {
      // Clear session_id regardless of outcome so a refresh does not
      // re-post the same id.
      const params = new URLSearchParams(searchParams.toString())
      params.delete('session_id')
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
      setIsConfirmingPayment(false)
    },
  })

  useEffect(() => {
    if (sessionId && !confirmedRef.current) {
      confirmedRef.current = true
      confirmMutation.mutate(sessionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- confirmedRef guards against re-running; only sessionId should retrigger
  }, [sessionId])

  const {
    data: usageData,
    isLoading: usageLoading,
    isError: usageFailed,
    refetch: refetchUsage,
  } = useQuery<BillingUsageResponse>({
    queryKey: ['billing', 'usage'],
    queryFn: async () => {
      const res = await fetch('/api/billing/usage')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar uso')
      }
      return res.json()
    },
  })

  const {
    data: plansData,
    isLoading: plansLoading,
    isError: plansFailed,
    refetch: refetchPlans,
  } = useQuery<PlansResponse>({
    queryKey: ['billing', 'plans'],
    queryFn: async () => {
      const res = await fetch('/api/billing/plans')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar planos')
      }
      return res.json()
    },
  })

  const checkoutMutation = useMutation({
    mutationFn: async (planSlug: string) => {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug }),
      })
      if (!res.ok) {
        throw new Error(await errorMessage(res, 'Erro ao criar sessão de pagamento'))
      }
      return res.json() as Promise<{ url: string | null; updated?: boolean }>
    },
    onSuccess: async ({ url, updated }) => {
      // A plan switch has no checkout to send them to: the subscription is
      // already updated at Stripe and here, so stay on the page and reload
      // what it shows.
      if (updated || !url) {
        setCheckingOutSlug(null)
        // Not "cobrada": create_prorations credits on a downgrade, and this
        // fires in both directions.
        toast.success('Plano alterado. A diferença é ajustada proporcionalmente.')
        await update()
        queryClient.invalidateQueries({ queryKey: ['billing'] })
        return
      }
      window.location.href = url
    },
    onError: (err: Error) => {
      setCheckingOutSlug(null)
      toast.error(err.message)
    },
  })

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      if (!res.ok) {
        throw new Error(await errorMessage(res, 'Erro ao abrir o portal de pagamento'))
      }
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/reactivate', { method: 'POST' })
      if (!res.ok) {
        throw new Error(await errorMessage(res, 'Erro ao reativar assinatura'))
      }
      return res.json()
    },
    onSuccess: async () => {
      toast.success('Assinatura reativada.')
      await update()
      queryClient.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/cancel', { method: 'POST' })
      if (!res.ok) {
        throw new Error(await errorMessage(res, 'Erro ao cancelar assinatura'))
      }
      return res.json()
    },
    onSuccess: () => {
      setCancelDialogOpen(false)
      toast.success('Assinatura cancelada com sucesso.')
      queryClient.invalidateQueries({ queryKey: ['billing'] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  function handleSubscribe(planSlug: string) {
    setCheckingOutSlug(planSlug)
    checkoutMutation.mutate(planSlug)
  }

  if (usageLoading || plansLoading || isConfirmingPayment) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  // Every lapsed banner points here, so a blank panel is the worst possible
  // answer: the owner is told their account is blocked and then shown nothing
  // to act on.
  if (usageFailed || !usageData) {
    return (
      <div className="rounded-[3px] border border-red-200 bg-red-50 p-5">
        <p className="text-sm text-red-700">Não foi possível carregar sua assinatura.</p>
        <Button variant="outline" className="mt-3" onClick={() => refetchUsage()}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const { subscription, plan, usage } = usageData
  const statusConfig = STATUS_CONFIG[subscription.status]
  const plans = plansData?.data ?? []
  const canCancel =
    subscription.stripeSubscriptionId &&
    subscription.status !== 'canceled' &&
    subscription.status !== 'expired'


  const periodOpen = new Date(subscription.currentPeriodEnd) > new Date()

  // Cancelled but still inside the paid period: Stripe has not ended it yet,
  // so it can be resumed and it still absorbs a plan change.
  const cancelPending = subscription.status === 'canceled' && periodOpen

  // Paying already, so picking another plan moves the existing Stripe
  // subscription rather than opening a checkout. past_due counts: the charge
  // failed but the subscription is alive and being retried, so buying again
  // would run a second one alongside it.
  const isSwitching =
    Boolean(subscription.stripeSubscriptionId) &&
    (subscription.status === 'active' ||
      subscription.status === 'trialing' ||
      subscription.status === 'past_due' ||
      cancelPending)

  // Nothing live to keep. Every plan has to be buyable, including the one
  // they were on: leaving it inert as "current" left a lapsed customer able
  // to buy any plan except the one they actually wanted back.
  const isLapsed = !isSwitching && subscription.status !== 'active' && subscription.status !== 'trialing'

  const canReactivate = Boolean(subscription.stripeSubscriptionId) && cancelPending

  // Anyone Stripe has a customer record for, including a lapsed one: their
  // invoices live there too, not just the card.
  const canManagePayment = subscription.hasStripeCustomer

  let statusLabel = statusConfig.label
  if (subscription.status === 'trialing') {
    const daysLeft = differenceInDays(new Date(subscription.currentPeriodEnd), new Date())
    statusLabel = `Teste gratuito · ${Math.max(daysLeft, 0)} dias restantes`
  }

  return (
    <div className="space-y-8">
      {/* Current plan + status */}
      <div className="rounded-[3px] border border-[#E8ECEF] p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-mid uppercase tracking-wider mb-1">Plano atual</p>
            <h3 className="text-lg font-semibold text-charcoal">{plan.name}</h3>
          </div>
          <Badge className={`${statusConfig.className} border-transparent text-xs`}>
            {statusLabel}
          </Badge>
        </div>
      </div>

      {/* Usage summary */}
      <div>
        <p className="text-sm font-medium text-charcoal mb-4">Uso atual</p>
        <div className="space-y-4">
          <UsageBar label="Usuários" icon={UsersIcon} used={usage.users.used} limit={usage.users.limit} />
          <UsageBar label="Pacientes" icon={UserIcon} used={usage.patients.used} limit={usage.patients.limit} />
          <UsageBar label="Créditos WhatsApp" icon={MessageCircleIcon} used={usage.whatsapp.used} limit={usage.whatsapp.limit} />
        </div>
      </div>

      {/* Plan comparison */}
      {plansFailed && (
        <div className="rounded-[3px] border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-700">Não foi possível carregar os planos.</p>
          <Button variant="outline" className="mt-3" onClick={() => refetchPlans()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {!plansFailed && plans.length > 0 && (
        <div>
          <p className="text-sm font-medium text-charcoal mb-4">Planos disponíveis</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.filter((p) => !(p.priceCents === 0 && plan.priceCents > 0)).map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                isCurrent={p.slug === plan.slug && !isLapsed}
                isSwitch={isSwitching}
                isCheckingOut={checkingOutSlug === p.slug}
                onSubscribe={handleSubscribe}
              />
            ))}
          </div>
        </div>
      )}

      {canManagePayment && (
        <div className="pt-4 border-t border-[#E8ECEF]">
          <button
            type="button"
            disabled={portalMutation.isPending}
            onClick={() => portalMutation.mutate()}
            className="text-sm text-forest hover:opacity-80 transition-opacity underline underline-offset-2 disabled:opacity-50"
          >
            {portalMutation.isPending ? 'Abrindo...' : 'Gerenciar pagamento e faturas'}
          </button>
          <p className="mt-1 text-xs text-mid">
            Atualize o cartão e veja suas faturas no portal seguro do Stripe.
          </p>
        </div>
      )}

      {/* Cancel or undo the cancellation. Never both: canCancel excludes the
          canceled status that canReactivate requires. */}
      {(canCancel || canReactivate) && (
        <div className="pt-4 border-t border-[#E8ECEF]">
          {canReactivate ? (
            <button
              type="button"
              disabled={reactivateMutation.isPending}
              onClick={() => reactivateMutation.mutate()}
              className="text-sm text-forest hover:opacity-80 transition-opacity underline underline-offset-2 disabled:opacity-50"
            >
              {reactivateMutation.isPending ? 'Reativando...' : 'Reativar assinatura'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCancelDialogOpen(true)}
              className="text-sm text-mid hover:text-red-500 transition-colors underline underline-offset-2"
            >
              Cancelar assinatura
            </button>
          )}
        </div>
      )}

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar assinatura</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja cancelar sua assinatura? Você continua com acesso normal
              até o fim do período já pago.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-[3px] bg-amber-50 p-3">
            <AlertTriangleIcon className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              Quando o período terminar, o acesso para criar agendamentos, pacientes,
              lançamentos e mensagens é bloqueado até você assinar de novo. Seus dados
              continuam aqui. Você pode reativar a qualquer momento antes disso.
            </p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Manter assinatura
            </DialogClose>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Cancelando...
                </>
              ) : (
                'Confirmar cancelamento'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
