'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  isCheckingOut,
  onSubscribe,
}: {
  plan: PlanItem
  isCurrent: boolean
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
              Redirecionando...
            </>
          ) : (
            <>
              <CreditCardIcon className="h-4 w-4" />
              Assinar
            </>
          )}
        </Button>
      )}
    </div>
  )
}

export function BillingSettings() {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [checkingOutSlug, setCheckingOutSlug] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: usageData, isLoading: usageLoading } = useQuery<BillingUsageResponse>({
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

  const { data: plansData, isLoading: plansLoading } = useQuery<PlansResponse>({
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
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao criar sessão de pagamento')
      }
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (err: Error) => {
      setCheckingOutSlug(null)
      toast.error(err.message)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/cancel', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao cancelar assinatura')
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

  if (usageLoading || plansLoading) {
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

  if (!usageData) return null

  const { subscription, plan, usage } = usageData
  const statusConfig = STATUS_CONFIG[subscription.status]
  const plans = plansData?.data ?? []
  const canCancel =
    subscription.stripeSubscriptionId &&
    subscription.status !== 'canceled' &&
    subscription.status !== 'expired'

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
      {plans.length > 0 && (
        <div>
          <p className="text-sm font-medium text-charcoal mb-4">Planos disponíveis</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.filter((p) => !(p.priceCents === 0 && plan.priceCents > 0)).map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                isCurrent={p.slug === plan.slug}
                isCheckingOut={checkingOutSlug === p.slug}
                onSubscribe={handleSubscribe}
              />
            ))}
          </div>
        </div>
      )}

      {/* Cancel subscription */}
      {canCancel && (
        <div className="pt-4 border-t border-[#E8ECEF]">
          <button
            type="button"
            onClick={() => setCancelDialogOpen(true)}
            className="text-sm text-mid hover:text-red-500 transition-colors underline underline-offset-2"
          >
            Cancelar assinatura
          </button>
        </div>
      )}

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar assinatura</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja cancelar sua assinatura? Você perderá acesso aos recursos
              do plano atual ao final do período vigente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-[3px] bg-amber-50 p-3">
            <AlertTriangleIcon className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              Esta ação não pode ser desfeita. Após o cancelamento, seu plano será rebaixado
              ao final do período de cobrança atual.
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
