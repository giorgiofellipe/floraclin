'use client'

import { useCallback, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, formatDate } from '@/lib/utils'
import { useAdminSubscriptions, useAdminPlans } from '@/hooks/queries/use-admin-subscriptions'
import { SubscriptionDetailDialog } from './subscription-detail-dialog'
import { CreditCardIcon } from 'lucide-react'
import { differenceInDays } from 'date-fns'

interface SubscriptionListItem {
  id: string
  tenantId: string
  planId: string
  status: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodStart: string
  currentPeriodEnd: string
  canceledAt: string | null
  source: string
  giftedBy: string | null
  giftedMonths: number | null
  notes: string | null
  tenantName: string
  tenantSlug: string
  planSlug: string
  planName: string
}

interface Plan {
  id: string
  slug: string
  name: string
}

const STATUS_ITEMS: Record<string, string> = {
  '': 'Todos',
  trialing: 'Teste',
  active: 'Ativo',
  past_due: 'Inadimplente',
  canceled: 'Cancelado',
  expired: 'Expirado',
}

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Teste',
  active: 'Ativo',
  past_due: 'Inadimplente',
  canceled: 'Cancelado',
  expired: 'Expirado',
}

function daysRemaining(periodEnd: string): number {
  return differenceInDays(new Date(periodEnd), new Date())
}

export function SubscriptionList() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [selectedSub, setSelectedSub] = useState<SubscriptionListItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: result, isPending, isFetching } = useAdminSubscriptions(
    statusFilter || undefined,
    planFilter || undefined,
    search || undefined,
  )
  const { data: plansResult } = useAdminPlans()

  const subscriptions: SubscriptionListItem[] = result?.data ?? []

  const planItems = useMemo(() => {
    const items: Record<string, string> = { '': 'Todos' }
    const plans: Plan[] = plansResult?.data ?? []
    for (const p of plans) {
      items[p.slug] = p.name
    }
    return items
  }, [plansResult])

  const handleRowClick = useCallback((sub: SubscriptionListItem) => {
    setSelectedSub(sub)
    setDialogOpen(true)
  }, [])

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-end gap-3 flex-wrap">
        <Input
          placeholder="Buscar clínicas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs border-sage/20"
        />
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-mid">Status</Label>
          <Select
            items={STATUS_ITEMS}
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? '')}
          >
            <SelectTrigger className="w-36 border-sage/20 h-8 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-mid">Plano</Label>
          <Select
            items={planItems}
            value={planFilter}
            onValueChange={(v) => setPlanFilter(v ?? '')}
          >
            <SelectTrigger className="w-36 border-sage/20 h-8 text-sm">
              <SelectValue placeholder="Plano" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <span className="text-xs text-mid tabular-nums shrink-0">
          {subscriptions.length} {subscriptions.length === 1 ? 'assinatura' : 'assinaturas'}
        </span>
      </div>

      {/* List */}
      <div className={cn('space-y-2 transition-opacity duration-200', isFetching && !isPending && 'opacity-60')}>
        {isPending && subscriptions.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <span className="flex items-center gap-2 text-sm text-mid">
              <span className="size-2 animate-pulse rounded-full bg-sage" />
              Carregando assinaturas...
            </span>
          </div>
        )}

        {!isPending && subscriptions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-sage/10 p-4 mb-4">
              <CreditCardIcon className="h-6 w-6 text-sage" />
            </div>
            <p className="text-sm font-medium text-charcoal">Nenhuma assinatura encontrada</p>
            <p className="text-xs text-mid mt-1">Ajuste os filtros para buscar assinaturas</p>
          </div>
        )}

        {subscriptions.map((sub) => {
          const days = daysRemaining(sub.currentPeriodEnd)

          return (
            <div
              key={sub.id}
              className="group rounded-lg border border-[#E8ECEF] bg-white hover:border-sage/25 hover:shadow-sm transition-all duration-200 cursor-pointer"
              onClick={() => handleRowClick(sub)}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Icon */}
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sage/10 shrink-0">
                  <CreditCardIcon className="h-3.5 w-3.5 text-sage" />
                </div>

                {/* Clinic name */}
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm text-charcoal truncate block">
                    {sub.tenantName}
                  </span>
                  <span className="text-xs text-mid truncate block">{sub.tenantSlug}</span>
                </div>

                {/* Plan badge */}
                <span className="inline-flex items-center rounded-full bg-sage/10 px-2 py-0.5 text-[10px] font-medium text-sage shrink-0">
                  {sub.planName}
                </span>

                {/* Status badge */}
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0',
                    sub.status === 'trialing' && 'bg-blue-50 text-blue-700',
                    sub.status === 'active' && 'bg-emerald-50 text-emerald-700',
                    sub.status === 'past_due' && 'bg-amber-50 text-amber-700',
                    sub.status === 'expired' && 'bg-red-50 text-red-700',
                    sub.status === 'canceled' && 'bg-neutral-100 text-neutral-500',
                  )}
                >
                  {STATUS_LABELS[sub.status] ?? sub.status}
                </span>

                {/* Period */}
                <span className="text-xs text-mid tabular-nums shrink-0 hidden sm:inline">
                  {formatDate(sub.currentPeriodStart)} — {formatDate(sub.currentPeriodEnd)}
                </span>

                {/* Days remaining */}
                <span
                  className={cn(
                    'text-xs tabular-nums font-medium shrink-0 min-w-[4rem] text-right',
                    days <= 0 ? 'text-red-600' : days <= 7 ? 'text-amber-600' : 'text-mid',
                  )}
                >
                  {days <= 0 ? 'Expirado' : `${days}d restantes`}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Detail dialog */}
      <SubscriptionDetailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        subscription={selectedSub}
      />
    </div>
  )
}
