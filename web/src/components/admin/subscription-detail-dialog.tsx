'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { useAdminSubscriptionDetail, useAdminPlans } from '@/hooks/queries/use-admin-subscriptions'
import {
  useUpdateSubscription,
  useGiftSubscription,
  useExtendTrial,
} from '@/hooks/mutations/use-admin-subscription-mutations'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'
import { Loader2Icon } from 'lucide-react'

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

type ActionMode = 'none' | 'change-plan' | 'gift' | 'extend-trial' | 'cancel' | 'reactivate'

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Teste',
  active: 'Ativo',
  past_due: 'Inadimplente',
  canceled: 'Cancelado',
  expired: 'Expirado',
}

const SOURCE_LABELS: Record<string, string> = {
  trial: 'Teste',
  stripe: 'Stripe',
  gift: 'Presente',
  admin: 'Admin',
}

interface SubscriptionDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription: SubscriptionListItem | null
}

export function SubscriptionDetailDialog({
  open,
  onOpenChange,
  subscription,
}: SubscriptionDetailDialogProps) {
  const [actionMode, setActionMode] = useState<ActionMode>('none')
  const [selectedPlanSlug, setSelectedPlanSlug] = useState('')
  const [giftMonths, setGiftMonths] = useState('3')
  const [giftNotes, setGiftNotes] = useState('')
  const [extendDays, setExtendDays] = useState('7')

  const { data: detailResult } = useAdminSubscriptionDetail(subscription?.tenantId ?? '')
  const { data: plansResult } = useAdminPlans()

  const updateSubscription = useUpdateSubscription()
  const giftSubscription = useGiftSubscription()
  const extendTrial = useExtendTrial()

  const detail = detailResult?.data
  const allPlans: Plan[] = plansResult?.data ?? []
  const planItems: Record<string, string> = {}
  for (const p of allPlans) {
    planItems[p.slug] = p.name
  }

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dialog-open reset pattern; state is intentionally synced to props here
      setActionMode('none')
      setSelectedPlanSlug(subscription?.planSlug ?? '')
      setGiftMonths('3')
      setGiftNotes('')
      setExtendDays('7')
    }
  }, [open, subscription])

  const isPending =
    updateSubscription.isPending || giftSubscription.isPending || extendTrial.isPending

  const handleChangePlan = useCallback(async () => {
    if (!subscription || !selectedPlanSlug) return
    try {
      await updateSubscription.mutateAsync({
        tenantId: subscription.tenantId,
        planSlug: selectedPlanSlug,
      })
      toast.success('Plano alterado')
      setActionMode('none')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar plano')
    }
  }, [subscription, selectedPlanSlug, updateSubscription])

  const handleGift = useCallback(async () => {
    if (!subscription || !selectedPlanSlug) return
    const months = parseInt(giftMonths, 10)
    if (!months || months < 1) {
      toast.error('Informe pelo menos 1 mês')
      return
    }
    try {
      await giftSubscription.mutateAsync({
        tenantId: subscription.tenantId,
        planSlug: selectedPlanSlug,
        months,
        notes: giftNotes || undefined,
      })
      toast.success('Presente aplicado')
      setActionMode('none')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao presentear')
    }
  }, [subscription, selectedPlanSlug, giftMonths, giftNotes, giftSubscription])

  const handleExtendTrial = useCallback(async () => {
    if (!subscription) return
    const days = parseInt(extendDays, 10)
    if (!days || days < 1) {
      toast.error('Informe pelo menos 1 dia')
      return
    }
    try {
      await extendTrial.mutateAsync({
        tenantId: subscription.tenantId,
        days,
      })
      toast.success('Teste estendido')
      setActionMode('none')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao estender teste')
    }
  }, [subscription, extendDays, extendTrial])

  const handleCancel = useCallback(async () => {
    if (!subscription) return
    try {
      await updateSubscription.mutateAsync({
        tenantId: subscription.tenantId,
        status: 'canceled',
      })
      toast.success('Assinatura cancelada')
      setActionMode('none')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cancelar')
    }
  }, [subscription, updateSubscription])

  const handleReactivate = useCallback(async () => {
    if (!subscription) return
    try {
      await updateSubscription.mutateAsync({
        tenantId: subscription.tenantId,
        status: 'active',
      })
      toast.success('Assinatura reativada')
      setActionMode('none')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao reativar')
    }
  }, [subscription, updateSubscription])

  if (!subscription) return null

  const isCanceledOrExpired = subscription.status === 'canceled' || subscription.status === 'expired'
  const isTrialing = subscription.status === 'trialing'
  const canCancel = !isCanceledOrExpired

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{subscription.tenantName}</DialogTitle>
          <DialogDescription>{subscription.tenantSlug}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Subscription info */}
          <div className="grid grid-cols-2 gap-3">
            <InfoField label="Plano" value={subscription.planName} />
            <InfoField
              label="Status"
              value={
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                    subscription.status === 'trialing' && 'bg-blue-50 text-blue-700',
                    subscription.status === 'active' && 'bg-emerald-50 text-emerald-700',
                    subscription.status === 'past_due' && 'bg-amber-50 text-amber-700',
                    subscription.status === 'expired' && 'bg-red-50 text-red-700',
                    subscription.status === 'canceled' && 'bg-neutral-100 text-neutral-500',
                  )}
                >
                  {STATUS_LABELS[subscription.status] ?? subscription.status}
                </span>
              }
            />
            <InfoField label="Início" value={formatDate(subscription.currentPeriodStart)} />
            <InfoField label="Fim" value={formatDate(subscription.currentPeriodEnd)} />
            <InfoField label="Origem" value={SOURCE_LABELS[subscription.source] ?? subscription.source} />
            {detail?.creditUsage != null && (
              <InfoField label="Créditos WA" value={`${detail.creditUsage.used ?? 0} / ${detail.creditUsage.total ?? 0}`} />
            )}
          </div>

          {/* Stripe info */}
          {(subscription.stripeCustomerId || subscription.stripeSubscriptionId) && (
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">
                Stripe
              </span>
              <div className="space-y-1 text-xs text-mid">
                {subscription.stripeCustomerId && (
                  <p className="truncate">Customer: {subscription.stripeCustomerId}</p>
                )}
                {subscription.stripeSubscriptionId && (
                  <p className="truncate">Subscription: {subscription.stripeSubscriptionId}</p>
                )}
              </div>
            </div>
          )}

          {/* Gift info */}
          {subscription.giftedBy && (
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">
                Presente
              </span>
              <div className="space-y-1 text-xs text-mid">
                <p>{subscription.giftedMonths} {subscription.giftedMonths === 1 ? 'mês' : 'meses'}</p>
                {subscription.notes && <p>{subscription.notes}</p>}
              </div>
            </div>
          )}

          {/* Action forms */}
          {actionMode === 'change-plan' && (
            <ActionPanel title="Alterar plano">
              <div className="space-y-2">
                <Label>Novo plano</Label>
                <Select items={planItems} value={selectedPlanSlug} onValueChange={(v) => setSelectedPlanSlug(v ?? '')}>
                  <SelectTrigger className="w-full border-sage/20 h-8 text-sm">
                    <SelectValue placeholder="Selecione o plano" />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>
              <ActionButtons
                onConfirm={handleChangePlan}
                onCancel={() => setActionMode('none')}
                isPending={isPending}
                confirmLabel="Alterar"
                disabled={!selectedPlanSlug || selectedPlanSlug === subscription.planSlug}
              />
            </ActionPanel>
          )}

          {actionMode === 'gift' && (
            <ActionPanel title="Presentear">
              <div className="space-y-2">
                <Label>Plano</Label>
                <Select items={planItems} value={selectedPlanSlug} onValueChange={(v) => setSelectedPlanSlug(v ?? '')}>
                  <SelectTrigger className="w-full border-sage/20 h-8 text-sm">
                    <SelectValue placeholder="Selecione o plano" />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Meses</Label>
                <Input
                  type="number"
                  min={1}
                  value={giftMonths}
                  onChange={(e) => setGiftMonths(e.target.value)}
                  className="border-sage/20"
                />
              </div>
              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea
                  value={giftNotes}
                  onChange={(e) => setGiftNotes(e.target.value)}
                  placeholder="Motivo do presente..."
                  className="border-sage/20 min-h-12"
                />
              </div>
              <ActionButtons
                onConfirm={handleGift}
                onCancel={() => setActionMode('none')}
                isPending={isPending}
                confirmLabel="Presentear"
                disabled={!selectedPlanSlug}
              />
            </ActionPanel>
          )}

          {actionMode === 'extend-trial' && (
            <ActionPanel title="Estender teste">
              <div className="space-y-2">
                <Label>Dias adicionais</Label>
                <Input
                  type="number"
                  min={1}
                  value={extendDays}
                  onChange={(e) => setExtendDays(e.target.value)}
                  className="border-sage/20"
                />
              </div>
              <ActionButtons
                onConfirm={handleExtendTrial}
                onCancel={() => setActionMode('none')}
                isPending={isPending}
                confirmLabel="Estender"
              />
            </ActionPanel>
          )}

          {actionMode === 'cancel' && (
            <ActionPanel title="Cancelar assinatura">
              <p className="text-sm text-mid">
                Tem certeza que deseja cancelar a assinatura de{' '}
                <strong className="text-charcoal">{subscription.tenantName}</strong>?
              </p>
              <ActionButtons
                onConfirm={handleCancel}
                onCancel={() => setActionMode('none')}
                isPending={isPending}
                confirmLabel="Cancelar assinatura"
                variant="destructive"
              />
            </ActionPanel>
          )}

          {actionMode === 'reactivate' && (
            <ActionPanel title="Reativar assinatura">
              <p className="text-sm text-mid">
                Reativar a assinatura de{' '}
                <strong className="text-charcoal">{subscription.tenantName}</strong>?
              </p>
              <ActionButtons
                onConfirm={handleReactivate}
                onCancel={() => setActionMode('none')}
                isPending={isPending}
                confirmLabel="Reativar"
              />
            </ActionPanel>
          )}
        </div>

        {actionMode === 'none' && (
          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionMode('change-plan')}
            >
              Alterar plano
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionMode('gift')}
            >
              Presentear
            </Button>
            {isTrialing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActionMode('extend-trial')}
              >
                Estender teste
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => setActionMode('cancel')}
              >
                Cancelar
              </Button>
            )}
            {isCanceledOrExpired && (
              <Button
                variant="outline"
                size="sm"
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                onClick={() => setActionMode('reactivate')}
              >
                Reativar
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Sub-components ---------- */

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium block mb-0.5">
        {label}
      </span>
      <span className="text-sm text-charcoal">{value}</span>
    </div>
  )
}

function ActionPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-sage/20 bg-[#FAFBFA] p-3">
      <span className="text-xs font-medium text-charcoal">{title}</span>
      {children}
    </div>
  )
}

function ActionButtons({
  onConfirm,
  onCancel,
  isPending,
  confirmLabel,
  variant = 'default',
  disabled = false,
}: {
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
  confirmLabel: string
  variant?: 'default' | 'destructive'
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
        Voltar
      </Button>
      <Button
        size="sm"
        variant={variant}
        className={variant === 'default' ? 'bg-forest text-cream hover:bg-sage transition-colors' : undefined}
        onClick={onConfirm}
        disabled={isPending || disabled}
      >
        {isPending && <Loader2Icon className="h-3.5 w-3.5 animate-spin" />}
        {confirmLabel}
      </Button>
    </div>
  )
}
