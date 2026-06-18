'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Package } from 'lucide-react'

interface Plan {
  id: string
  slug: string
  name: string
  priceCents: number
  billingInterval: string
  trialDays: number | null
  stripePriceId: string | null
  limits: Record<string, number>
  features: Record<string, boolean>
  displayOrder: number
  active: boolean
}

type PlanFormData = {
  slug: string
  name: string
  priceCents: number
  trialDays: number | null
  stripePriceId: string
  limits: {
    whatsapp_conversations: number
    users: number
    patients: number
  }
  features: {
    own_whatsapp_number: boolean
  }
  displayOrder: number
  active: boolean
}

const EMPTY_FORM: PlanFormData = {
  slug: '',
  name: '',
  priceCents: 0,
  trialDays: null,
  stripePriceId: '',
  limits: { whatsapp_conversations: 50, users: 2, patients: 100 },
  features: { own_whatsapp_number: false },
  displayOrder: 0,
  active: true,
}

function planToForm(plan: Plan): PlanFormData {
  return {
    slug: plan.slug,
    name: plan.name,
    priceCents: plan.priceCents,
    trialDays: plan.trialDays,
    stripePriceId: plan.stripePriceId ?? '',
    limits: {
      whatsapp_conversations: (plan.limits as Record<string, number>).whatsapp_conversations ?? 0,
      users: (plan.limits as Record<string, number>).users ?? 0,
      patients: (plan.limits as Record<string, number>).patients ?? 0,
    },
    features: {
      own_whatsapp_number: (plan.features as Record<string, boolean>).own_whatsapp_number ?? false,
    },
    displayOrder: plan.displayOrder,
    active: plan.active,
  }
}

function formatPrice(cents: number): string {
  if (cents === 0) return 'Gratuito'
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

function formatLimit(value: number): string {
  return value === -1 ? 'Ilimitado' : String(value)
}

export function PlanManager() {
  const queryClient = useQueryClient()
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<PlanFormData>(EMPTY_FORM)

  const { data: plans, isLoading } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => {
      const res = await fetch('/api/admin/plans')
      if (!res.ok) throw new Error('Falha ao carregar planos')
      return res.json()
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (data: { id?: string; form: PlanFormData }) => {
      const body = {
        ...data.form,
        stripePriceId: data.form.stripePriceId || null,
      }

      if (data.id) {
        const res = await fetch(`/api/admin/plans/${data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao salvar')
        return res.json()
      }

      const res = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao criar')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-plans'] })
      toast.success(editingPlan ? 'Plano atualizado' : 'Plano criado')
      closeDialog()
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  function openCreate() {
    setEditingPlan(null)
    setForm(EMPTY_FORM)
    setCreating(true)
  }

  function openEdit(plan: Plan) {
    setEditingPlan(plan)
    setForm(planToForm(plan))
    setCreating(true)
  }

  function closeDialog() {
    setCreating(false)
    setEditingPlan(null)
    setForm(EMPTY_FORM)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    saveMutation.mutate({ id: editingPlan?.id, form })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-mid" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-charcoal">Planos</h1>
          <p className="text-sm text-mid mt-0.5">Gerencie os planos de assinatura da plataforma</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4 mr-1" />
          Novo plano
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(plans ?? []).map((plan) => (
          <div
            key={plan.id}
            className={`rounded-[3px] border p-5 transition-colors ${
              plan.active ? 'border-[#E8ECEF] bg-white' : 'border-dashed border-mid/30 bg-[#F4F6F8]/50 opacity-60'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Package className="size-4 text-sage" />
                <h3 className="font-semibold text-charcoal">{plan.name}</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {!plan.active && (
                  <Badge variant="outline" className="text-[10px] border-mid/30 text-mid">Inativo</Badge>
                )}
                <button
                  type="button"
                  onClick={() => openEdit(plan)}
                  className="p-1 rounded text-mid hover:text-charcoal hover:bg-[#F4F6F8] transition-colors"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            </div>

            <p className="text-lg font-semibold text-forest mb-3">
              {formatPrice(plan.priceCents)}
              {plan.priceCents > 0 && <span className="text-xs text-mid font-normal">/mês</span>}
            </p>

            <div className="space-y-1.5 text-xs text-mid">
              <div className="flex justify-between">
                <span>Créditos WhatsApp</span>
                <span className="font-medium text-charcoal">{formatLimit(plan.limits.whatsapp_conversations ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Usuários</span>
                <span className="font-medium text-charcoal">{formatLimit(plan.limits.users ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Pacientes</span>
                <span className="font-medium text-charcoal">{formatLimit(plan.limits.patients ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Número próprio</span>
                <span className="font-medium text-charcoal">{plan.features.own_whatsapp_number ? 'Sim' : 'Não'}</span>
              </div>
              {plan.trialDays && (
                <div className="flex justify-between">
                  <span>Teste gratuito</span>
                  <span className="font-medium text-charcoal">{plan.trialDays} dias</span>
                </div>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-[#E8ECEF] flex items-center justify-between text-[10px] text-mid uppercase tracking-wider">
              <span>slug: {plan.slug}</span>
              <span>ordem: {plan.displayOrder}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={creating} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPlan ? 'Editar plano' : 'Novo plano'}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Starter"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="Ex: starter"
                  disabled={!!editingPlan}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Preço (centavos)</Label>
                <Input
                  type="number"
                  value={form.priceCents}
                  onChange={(e) => setForm({ ...form, priceCents: parseInt(e.target.value) || 0 })}
                  min={0}
                />
                <p className="text-[10px] text-mid">{formatPrice(form.priceCents)}</p>
              </div>
              <div className="space-y-1.5">
                <Label>Dias de teste</Label>
                <Input
                  type="number"
                  value={form.trialDays ?? ''}
                  onChange={(e) => setForm({ ...form, trialDays: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder="Vazio = sem teste"
                  min={0}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Stripe Price ID</Label>
              <Input
                value={form.stripePriceId}
                onChange={(e) => setForm({ ...form, stripePriceId: e.target.value })}
                placeholder="price_xxx (opcional)"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-mid">Limites</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Créditos WA</Label>
                  <Input
                    type="number"
                    value={form.limits.whatsapp_conversations}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, whatsapp_conversations: parseInt(e.target.value) || 0 } })}
                  />
                  <p className="text-[10px] text-mid">-1 = ilimitado</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Usuários</Label>
                  <Input
                    type="number"
                    value={form.limits.users}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, users: parseInt(e.target.value) || 0 } })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Pacientes</Label>
                  <Input
                    type="number"
                    value={form.limits.patients}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, patients: parseInt(e.target.value) || 0 } })}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.features.own_whatsapp_number}
                  onCheckedChange={(checked) => setForm({ ...form, features: { ...form.features, own_whatsapp_number: checked } })}
                />
                <Label className="text-sm">Número próprio</Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={form.active}
                  onCheckedChange={(checked) => setForm({ ...form, active: checked })}
                />
                <Label className="text-sm">Ativo</Label>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Ordem de exibição</Label>
              <Input
                type="number"
                value={form.displayOrder}
                onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })}
                min={0}
                className="w-24"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
                {editingPlan ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
