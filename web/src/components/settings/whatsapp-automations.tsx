'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select'
import { Bell, CreditCard, HeartPulse, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

interface Automation {
  id: string
  trigger: string
  enabled: boolean
  templateId: string | null
  config: Record<string, unknown> | null
}

interface Template {
  id: string
  name: string
  status: string
  purposeKey: string | null
}

type LocalState = Record<string, {
  enabled: boolean
  templateId: string | null
  config: Record<string, unknown>
}>

const TRIGGERS = [
  {
    key: 'appointment_reminder',
    label: 'Lembrete de consulta',
    description: 'Envia um lembrete automático antes da consulta agendada.',
    icon: Bell,
    purposeKey: 'appointment_reminder',
    configFields: [
      { key: 'hoursBeforeAppointment', label: 'Horas antes da consulta', type: 'number' as const, default: 24 },
    ],
  },
  {
    key: 'payment_reminder',
    label: 'Lembrete de pagamento',
    description: 'Envia um lembrete antes do vencimento de parcelas.',
    icon: CreditCard,
    purposeKey: 'payment_reminder',
    configFields: [
      { key: 'daysBeforeDue', label: 'Dias antes do vencimento', type: 'number' as const, default: 3 },
    ],
  },
  {
    key: 'follow_up',
    label: 'Acompanhamento pós-procedimento',
    description: 'Envia mensagem de acompanhamento após a realização de um procedimento.',
    icon: HeartPulse,
    purposeKey: 'follow_up',
    configFields: [
      { key: 'daysAfterProcedure', label: 'Dias após o procedimento', type: 'number' as const, default: 7 },
    ],
  },
]

function buildLocalState(automations: Automation[]): LocalState {
  const state: LocalState = {}
  for (const trigger of TRIGGERS) {
    const existing = automations.find((a) => a.trigger === trigger.key)
    const defaults: Record<string, unknown> = {}
    for (const field of trigger.configFields) {
      defaults[field.key] = field.default
    }
    state[trigger.key] = {
      enabled: existing?.enabled ?? false,
      templateId: existing?.templateId ?? null,
      config: { ...defaults, ...(existing?.config as Record<string, unknown> ?? {}) },
    }
  }
  return state
}

export function WhatsAppAutomations() {
  const [serverAutomations, setServerAutomations] = useState<Automation[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [localState, setLocalState] = useState<LocalState>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [autoRes, tplRes] = await Promise.all([
        fetch('/api/whatsapp/automations'),
        fetch('/api/whatsapp/templates'),
      ])
      if (autoRes.ok) {
        const autoData = await autoRes.json()
        const automations = autoData.data ?? []
        setServerAutomations(automations)
        setLocalState(buildLocalState(automations))
      }
      if (tplRes.ok) {
        const tplData = await tplRes.json()
        setTemplates(
          ((tplData.data ?? []) as Template[]).filter((t) => t.status === 'APPROVED')
        )
      }
      setDirty(new Set())
    } catch {
      toast.error('Erro ao carregar automações')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  function updateLocal(triggerKey: string, patch: Partial<LocalState[string]>) {
    setLocalState((prev) => ({
      ...prev,
      [triggerKey]: { ...prev[triggerKey], ...patch },
    }))
    setDirty((prev) => new Set(prev).add(triggerKey))
  }

  async function handleSave() {
    if (dirty.size === 0) return
    setSaving(true)
    const errors: string[] = []

    for (const triggerKey of dirty) {
      const state = localState[triggerKey]
      if (!state) continue
      try {
        const res = await fetch(`/api/whatsapp/automations/${triggerKey}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: state.enabled,
            templateId: state.templateId,
            config: state.config,
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Erro ao salvar')
        }
        const result = await res.json()
        setServerAutomations((prev) => {
          const exists = prev.find((a) => a.trigger === triggerKey)
          if (exists) return prev.map((a) => (a.trigger === triggerKey ? result.data : a))
          return [...prev, result.data]
        })
      } catch (err) {
        errors.push(err instanceof Error ? err.message : triggerKey)
      }
    }

    setSaving(false)
    if (errors.length > 0) {
      toast.error(`Erro ao salvar: ${errors.join(', ')}`)
    } else {
      toast.success('Automações salvas com sucesso')
      setDirty(new Set())
    }
  }

  function getApprovedTemplates(purposeKey: string): Template[] {
    return templates.filter((t) => !t.purposeKey || t.purposeKey === purposeKey)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Mensagens Automáticas
          </h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
          Mensagens Automáticas
        </h3>
        <div className="flex-1 h-px bg-blush/60" />
      </div>

      <p className="text-xs text-mid">
        Configure o envio automático de mensagens via WhatsApp para seus pacientes.
      </p>

      <div className="space-y-3">
        {TRIGGERS.map((trigger) => {
          const state = localState[trigger.key]
          if (!state) return null
          const availableTemplates = getApprovedTemplates(trigger.purposeKey)
          const Icon = trigger.icon

          return (
            <div
              key={trigger.key}
              className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-mid" />
                  <div>
                    <Label className="text-sm font-medium text-charcoal">
                      {trigger.label}
                    </Label>
                    <p className="text-xs text-mid">{trigger.description}</p>
                  </div>
                </div>
                <Switch
                  checked={state.enabled}
                  onCheckedChange={(checked) =>
                    updateLocal(trigger.key, { enabled: checked })
                  }
                />
              </div>

              {state.enabled && (
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-mid">Template</Label>
                    <Select
                      value={state.templateId ?? ''}
                      onValueChange={(value) =>
                        updateLocal(trigger.key, { templateId: value || null })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione um template aprovado" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTemplates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </SelectItem>
                        ))}
                        {availableTemplates.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-mid">
                            Nenhum template aprovado disponível
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {trigger.configFields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <Label className="text-xs text-mid">{field.label}</Label>
                      <Input
                        type="number"
                        min={1}
                        className="w-32"
                        value={(state.config[field.key] as number) ?? field.default}
                        onChange={(e) =>
                          updateLocal(trigger.key, {
                            config: { ...state.config, [field.key]: parseInt(e.target.value) || field.default },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving || dirty.size === 0}
          className="bg-forest text-cream hover:bg-sage"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Salvar Automações
        </Button>
      </div>
    </div>
  )
}
