'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, CalendarCheck, CheckCircle2, ChevronDown, ClipboardList, Clock, CreditCard, HeartHandshake, HeartPulse, Loader2, Plus, ReceiptText, Save } from 'lucide-react'
import { toast } from 'sonner'
import { WhatsAppTemplatePreview, WhatsAppTemplatePreviewNote } from './whatsapp-template-preview'
import {
  ANAMNESIS_STALE_DAYS_MAX,
  AUTOMATION_DAYS_MAX,
  MAX_EVENT_AGE_DAYS,
  automationConfigDefaults,
} from '@/lib/whatsapp-automation-config'

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
  components: unknown
}

type LocalState = Record<string, {
  enabled: boolean
  templateId: string | null
  config: Record<string, unknown>
}>

const CONFIRMATION_DEFAULTS = automationConfigDefaults('appointment_confirmation')

const TRIGGERS = [
  {
    key: 'appointment_confirmation',
    label: 'Confirmação de consulta',
    description: 'Envia confirmação automática diariamente às 6h30 para consultas do dia seguinte. Consultas do próprio dia recebem apenas o link de anamnese, quando essa opção estiver ativada.',
    icon: CalendarCheck,
    purposeKey: 'appointment_confirmation',
    configFields: [
      { key: 'autoAnamnesisEnabled', label: 'Enviar anamnese automaticamente após confirmação', type: 'toggle' as const, default: CONFIRMATION_DEFAULTS.autoAnamnesisEnabled },
      { key: 'anamnesisStaleDays', label: 'Dias para considerar anamnese desatualizada', type: 'number' as const, default: CONFIRMATION_DEFAULTS.anamnesisStaleDays, max: ANAMNESIS_STALE_DAYS_MAX, dependsOn: 'autoAnamnesisEnabled' },
    ],
  },
  {
    key: 'payment_reminder',
    label: 'Lembrete de pagamento',
    description: 'Envia diariamente às 9h um lembrete para parcelas que vencem nos próximos dias.',
    icon: CreditCard,
    purposeKey: 'payment_reminder',
    configFields: [
      { key: 'daysBeforeDue', label: 'Dias antes do vencimento', type: 'number' as const, default: automationConfigDefaults('payment_reminder').daysBeforeDue, max: AUTOMATION_DAYS_MAX },
    ],
  },
  {
    key: 'follow_up',
    label: 'Acompanhamento pós-procedimento',
    description: 'Envia diariamente às 9h30 uma mensagem de acompanhamento aos pacientes que realizaram um procedimento.',
    icon: HeartPulse,
    purposeKey: 'follow_up',
    configFields: [
      { key: 'daysAfterProcedure', label: 'Dias após o procedimento', type: 'number' as const, default: automationConfigDefaults('follow_up').daysAfterProcedure, max: AUTOMATION_DAYS_MAX },
    ],
  },
  {
    key: 'payment_confirmation',
    label: 'Confirmação de pagamento',
    description: `Envia uma confirmação ao paciente quando um pagamento é registrado. Pagamentos com data de mais de ${MAX_EVENT_AGE_DAYS} dias atrás não geram mensagem.`,
    icon: ReceiptText,
    purposeKey: 'payment_confirmation',
    configFields: [],
  },
  {
    key: 'pre_procedure_instructions',
    label: 'Orientações pré-procedimento',
    description: 'Envia diariamente às 10h30 as orientações de preparo para consultas dos próximos dias. Só para procedimentos com orientações cadastradas.',
    icon: ClipboardList,
    purposeKey: 'pre_procedure_instructions',
    configFields: [
      { key: 'daysBeforeAppointment', label: 'Dias antes da consulta', type: 'number' as const, default: automationConfigDefaults('pre_procedure_instructions').daysBeforeAppointment, max: AUTOMATION_DAYS_MAX },
    ],
  },
  {
    key: 'post_procedure_care',
    label: 'Cuidados pós-procedimento',
    description: `Envia os cuidados ao paciente quando uma sessão é registrada. Só para procedimentos com cuidados cadastrados. Sessões com data de mais de ${MAX_EVENT_AGE_DAYS} dias atrás não geram mensagem.`,
    icon: HeartHandshake,
    purposeKey: 'post_procedure_care',
    configFields: [],
  },
]

/**
 * What the panel can tell the clinic about the template behind a trigger.
 * On the shared number the clinic can neither create a template nor chase its
 * approval, so the only thing worth saying is that it is missing and this
 * automation will not send.
 */
type TemplateState =
  | 'approved'
  | 'unavailable'
  | 'pending'
  | 'provision'

function resolveTemplateState(
  template: Template | undefined,
  mode: 'floraclin' | 'own',
): TemplateState | null {
  const usable = template?.status === 'APPROVED'
  if (mode === 'floraclin') return usable ? null : 'unavailable'
  if (!template) return 'provision'
  return usable ? 'approved' : 'pending'
}

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

interface WhatsAppAutomationsProps {
  mode: 'floraclin' | 'own'
}

export function WhatsAppAutomations({ mode }: WhatsAppAutomationsProps) {
  const [serverAutomations, setServerAutomations] = useState<Automation[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [clinicName, setClinicName] = useState('')
  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [localState, setLocalState] = useState<LocalState>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [pendingChecks, setPendingChecks] = useState(0)

  // On the shared FloraClin number the clinic has no templates of its own —
  // sends resolve the platform-managed ones, so the panel reads those too.
  const templatesUrl =
    mode === 'floraclin'
      ? '/api/whatsapp/templates/system'
      : '/api/whatsapp/templates'

  const fetchTemplates = useCallback(async () => {
    const res = await fetch(templatesUrl)
    if (!res.ok) return
    const data = await res.json()
    setTemplates((data.data ?? []) as Template[])
    setClinicName(data.clinicName ?? '')
  }, [templatesUrl])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [autoRes] = await Promise.all([
        fetch('/api/whatsapp/automations'),
        fetchTemplates(),
      ])
      if (autoRes.ok) {
        const autoData = await autoRes.json()
        const automations = autoData.data ?? []
        setServerAutomations(automations)
        setLocalState(buildLocalState(automations))
      }
      setDirty(new Set())
      // A full reload is a fresh start for the poll budget too: provisioning
      // calls this after creating templates, and those arrive PENDING.
      setPendingChecks(0)
    } catch {
      toast.error('Erro ao carregar automações')
    } finally {
      setLoading(false)
    }
  }, [fetchTemplates])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Meta approves a new template within seconds, so a PENDING status is almost
  // always about to change. Re-read it a few times to let the label settle on
  // its own instead of leaving the clinic to reload the page.
  useEffect(() => {
    if (loading || pendingChecks >= 3) return
    if (!templates.some((t) => t.status === 'PENDING')) return
    const timer = setTimeout(() => {
      setPendingChecks((n) => n + 1)
      // Templates only — a reload of the automations would discard edits in
      // progress.
      fetchTemplates().catch(() => {})
    }, 15_000)
    return () => clearTimeout(timer)
  }, [templates, loading, pendingChecks, fetchTemplates])

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
      const trigger = TRIGGERS.find((t) => t.key === triggerKey)
      const matched = trigger ? getMatchingTemplate(trigger.purposeKey) : undefined
      try {
        const res = await fetch(`/api/whatsapp/automations/${triggerKey}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: state.enabled,
            templateId: mode === 'floraclin' ? null : (matched?.id ?? state.templateId),
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

  function getMatchingTemplate(purposeKey: string): Template | undefined {
    return templates.find((t) => t.purposeKey === purposeKey)
  }

  async function handleProvision() {
    setProvisioning(true)
    try {
      const res = await fetch('/api/whatsapp/templates/provision', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Erro ao provisionar templates')
      }
      toast.success('Templates provisionados com sucesso')
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao provisionar templates')
    } finally {
      setProvisioning(false)
    }
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
          const matchingTemplate = getMatchingTemplate(trigger.purposeKey)
          const templateState = resolveTemplateState(matchingTemplate, mode)
          const Icon = trigger.icon

          return (
            <div
              key={trigger.key}
              className="rounded-[3px] border border-topbar-border bg-white p-4 space-y-3"
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

              {matchingTemplate && (
                <div className="pl-7">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-sage hover:underline"
                    aria-expanded={previewOpen.has(trigger.key)}
                    onClick={() =>
                      setPreviewOpen((prev) => {
                        const next = new Set(prev)
                        if (!next.delete(trigger.key)) next.add(trigger.key)
                        return next
                      })
                    }
                  >
                    Ver mensagem enviada
                    <ChevronDown
                      className={`size-3.5 transition-transform ${previewOpen.has(trigger.key) ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {previewOpen.has(trigger.key) && (
                    <div className="mt-2">
                      <WhatsAppTemplatePreview template={matchingTemplate} clinicName={clinicName} />
                      {mode === 'own' && (
                        <p className="mt-2 text-xs text-mid">
                          Template <span className="font-mono">{matchingTemplate.name}</span>
                        </p>
                      )}
                      <WhatsAppTemplatePreviewNote className="mt-2" />
                    </div>
                  )}
                </div>
              )}

              {state.enabled && (
                <div className="pl-7 space-y-3">
                  {templateState && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-mid">Template</Label>
                      {templateState === 'approved' && (
                        <div className="flex items-center gap-2 text-xs text-green-700">
                          <CheckCircle2 className="size-3.5" />
                          <span>Template aprovado</span>
                        </div>
                      )}
                      {templateState === 'pending' && (
                        <div className="flex items-center gap-2 text-xs text-amber-700">
                          <Clock className="size-3.5" />
                          <span>Template em revisão pela Meta</span>
                        </div>
                      )}
                      {templateState === 'unavailable' && (
                        <div className="flex items-center gap-2 text-xs text-amber-700">
                          <AlertTriangle className="size-3.5" />
                          <span>
                            Mensagem indisponível no momento. Fale com o suporte.
                          </span>
                        </div>
                      )}
                      {templateState === 'provision' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          disabled={provisioning}
                          onClick={handleProvision}
                        >
                          {provisioning ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Plus className="size-3.5" />
                          )}
                          Criar template padrão
                        </Button>
                      )}
                    </div>
                  )}

                  {trigger.configFields.map((field) => {
                    if ('dependsOn' in field && field.dependsOn && !state.config[field.dependsOn]) {
                      return null
                    }

                    if (field.type === 'toggle') {
                      return (
                        <div key={field.key} className="flex items-center justify-between">
                          <Label className="text-xs text-mid">{field.label}</Label>
                          <Switch
                            checked={Boolean(state.config[field.key] ?? field.default)}
                            onCheckedChange={(checked) =>
                              updateLocal(trigger.key, {
                                config: { ...state.config, [field.key]: checked },
                              })
                            }
                          />
                        </div>
                      )
                    }

                    return (
                      <div key={field.key} className="space-y-1.5">
                        <Label className="text-xs text-mid">{field.label}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={field.max}
                          className="w-32"
                          value={(state.config[field.key] as number) ?? field.default}
                          onChange={(e) =>
                            updateLocal(trigger.key, {
                              config: {
                                ...state.config,
                                [field.key]: Math.min(field.max, Math.max(1, parseInt(e.target.value) || field.default)),
                              },
                            })
                          }
                        />
                      </div>
                    )
                  })}
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
