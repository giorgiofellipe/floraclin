'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { type LucideIcon, AlertTriangle, CalendarCheck, CalendarClock, CheckCircle2, ChevronDown, ClipboardList, Clock, CreditCard, HeartHandshake, HeartPulse, Loader2, Plus, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import { SettingsSectionHeader } from './settings-section-header'
import { WhatsAppTemplatePreview, WhatsAppTemplatePreviewNote } from './whatsapp-template-preview'
import {
  ANAMNESIS_STALE_DAYS_MAX,
  AUTOMATION_DAYS_MAX,
  MAX_EVENT_AGE_DAYS,
  automationConfigDefaults,
  formatRunTime,
  nextAutomationRun,
  AUTOMATION_RUN_TIME_BR,
  type ScheduledAutomationTrigger,
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

type TriggerState = {
  enabled: boolean
  templateId: string | null
  config: Record<string, unknown>
}

type LocalState = Record<string, TriggerState>

interface ProcedureTypeTexts {
  preProcedureInstructions: string | null
  postProcedureCare: string | null
}

const PROCEDURES_HREF = '/configuracoes?tab=procedimentos'

const CONFIRMATION_DEFAULTS = automationConfigDefaults('appointment_confirmation')

type Trigger = {
  key: string
  label: string
  description: string
  icon: LucideIcon
  purposeKey: string
  procedureText?: { field: keyof ProcedureTypeTexts; missing: string }
  configFields: Array<
    | { key: string; label: string; type: 'toggle'; default: boolean }
    | { key: string; label: string; type: 'number'; default: number; max: number; dependsOn?: string }
  >
}

const TRIGGERS: Trigger[] = [
  {
    key: 'appointment_confirmation',
    label: 'Confirmação de consulta',
    description: `Envia confirmação automática diariamente às ${formatRunTime('appointment_confirmation')} para consultas do dia seguinte. Consultas do próprio dia recebem apenas o link de anamnese, quando essa opção estiver ativada.`,
    icon: CalendarCheck,
    purposeKey: 'appointment_confirmation',
    configFields: [
      { key: 'autoAnamnesisEnabled', label: 'Enviar anamnese automaticamente após confirmação', type: 'toggle', default: CONFIRMATION_DEFAULTS.autoAnamnesisEnabled },
      { key: 'anamnesisStaleDays', label: 'Dias para considerar anamnese desatualizada', type: 'number', default: CONFIRMATION_DEFAULTS.anamnesisStaleDays, max: ANAMNESIS_STALE_DAYS_MAX, dependsOn: 'autoAnamnesisEnabled' },
    ],
  },
  {
    key: 'payment_reminder',
    label: 'Lembrete de pagamento',
    description: `Envia diariamente às ${formatRunTime('payment_reminder')} um lembrete para parcelas que vencem nos próximos dias.`,
    icon: CreditCard,
    purposeKey: 'payment_reminder',
    configFields: [
      { key: 'daysBeforeDue', label: 'Dias antes do vencimento', type: 'number', default: automationConfigDefaults('payment_reminder').daysBeforeDue, max: AUTOMATION_DAYS_MAX },
    ],
  },
  {
    key: 'follow_up',
    label: 'Acompanhamento pós-procedimento',
    description: `Envia diariamente às ${formatRunTime('follow_up')} uma mensagem de acompanhamento aos pacientes que realizaram um procedimento.`,
    icon: HeartPulse,
    purposeKey: 'follow_up',
    configFields: [
      { key: 'daysAfterProcedure', label: 'Dias após o procedimento', type: 'number', default: automationConfigDefaults('follow_up').daysAfterProcedure, max: AUTOMATION_DAYS_MAX },
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
    description: `Envia diariamente às ${formatRunTime('pre_procedure_instructions')} as orientações de preparo para consultas dos próximos dias. Só para procedimentos com orientações cadastradas.`,
    icon: ClipboardList,
    purposeKey: 'pre_procedure_instructions',
    procedureText: { field: 'preProcedureInstructions', missing: 'Nenhum procedimento tem orientações pré-procedimento cadastradas, então nada é enviado ainda.' },
    configFields: [
      { key: 'daysBeforeAppointment', label: 'Dias antes da consulta', type: 'number', default: automationConfigDefaults('pre_procedure_instructions').daysBeforeAppointment, max: AUTOMATION_DAYS_MAX },
    ],
  },
  {
    key: 'post_procedure_care',
    label: 'Cuidados pós-procedimento',
    description: `Envia os cuidados ao paciente quando uma sessão é registrada. Só para procedimentos com cuidados cadastrados. Sessões com data de mais de ${MAX_EVENT_AGE_DAYS} dias atrás não geram mensagem.`,
    icon: HeartHandshake,
    purposeKey: 'post_procedure_care',
    procedureText: { field: 'postProcedureCare', missing: 'Nenhum procedimento tem cuidados pós-procedimento cadastrados, então nada é enviado ainda.' },
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

function isScheduled(key: string): key is ScheduledAutomationTrigger {
  return Object.hasOwn(AUTOMATION_RUN_TIME_BR, key)
}

interface WhatsAppAutomationsProps {
  mode: 'floraclin' | 'own'
  /** No credits left, so nothing goes out until the clinic gets more. */
  sendsPaused?: boolean
}

type LoadError = 'own_not_connected' | 'failed'

export function WhatsAppAutomations({ mode, sendsPaused = false }: WhatsAppAutomationsProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [clinicName, setClinicName] = useState('')
  const procedureTypesQuery = useProcedureTypes()
  const procedureTypes = Array.isArray(procedureTypesQuery.data) ? (procedureTypesQuery.data as ProcedureTypeTexts[]) : null
  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<LoadError | null>(null)
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set())
  const [provisioning, setProvisioning] = useState(false)
  const [localState, setLocalState] = useState<LocalState>({})
  // Last state the server confirmed, read at rollback time rather than from a render closure.
  const savedRef = useRef<LocalState>({})
  const [pendingChecks, setPendingChecks] = useState(0)

  // On the shared FloraClin number the clinic has no templates of its own:
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
        const state = buildLocalState(autoData.data ?? [])
        setLocalState(state)
        savedRef.current = state
        setLoadError(null)
      } else {
        setLoadError(mode === 'own' && autoRes.status === 400 ? 'own_not_connected' : 'failed')
      }
      // A full reload is a fresh start for the poll budget too: provisioning
      // calls this after creating templates, and those arrive PENDING.
      setPendingChecks(0)
    } catch {
      toast.error('Erro ao carregar automações')
    } finally {
      setLoading(false)
    }
  }, [fetchTemplates, mode])

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
      // Templates only: a reload of the automations would discard edits in
      // progress.
      fetchTemplates().catch(() => {})
    }, 15_000)
    return () => clearTimeout(timer)
  }, [templates, loading, pendingChecks, fetchTemplates])

  function getMatchingTemplate(purposeKey: string): Template | undefined {
    return templates.find((t) => t.purposeKey === purposeKey)
  }

  function editLocal(triggerKey: string, patch: Partial<TriggerState>) {
    setLocalState((prev) => ({ ...prev, [triggerKey]: { ...prev[triggerKey], ...patch } }))
  }

  function setSaving(key: string, saving: boolean) {
    setSavingKeys((prev) => {
      const next = new Set(prev)
      if (saving) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function save(trigger: Trigger, next: TriggerState, successMessage: string) {
    setLocalState((prev) => ({ ...prev, [trigger.key]: next }))
    setSaving(trigger.key, true)
    const matched = getMatchingTemplate(trigger.purposeKey)
    try {
      const res = await fetch(`/api/whatsapp/automations/${trigger.key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: next.enabled,
          templateId: mode === 'floraclin' ? null : (matched?.id ?? next.templateId),
          config: next.config,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao salvar')
      }
      savedRef.current = { ...savedRef.current, [trigger.key]: next }
      toast.success(successMessage)
    } catch (err) {
      setLocalState((prev) => ({ ...prev, [trigger.key]: savedRef.current[trigger.key] }))
      toast.error(`Não foi possível salvar "${trigger.label}": ${err instanceof Error ? err.message : 'erro desconhecido'}`)
    } finally {
      setSaving(trigger.key, false)
    }
  }

  function saveConfigIfChanged(trigger: Trigger) {
    const state = localState[trigger.key]
    if (!state || savingKeys.has(trigger.key)) return
    if (JSON.stringify(state.config) === JSON.stringify(savedRef.current[trigger.key]?.config)) return
    save(trigger, state, 'Configuração salva')
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
        <SettingsSectionHeader>Mensagens automáticas</SettingsSectionHeader>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <SettingsSectionHeader>Mensagens automáticas</SettingsSectionHeader>
        <p className="rounded-[3px] border border-dashed border-topbar-border px-4 py-3 text-xs text-mid">
          {loadError === 'own_not_connected'
            ? 'Conecte o número próprio para ativar as mensagens automáticas.'
            : 'Não foi possível carregar as mensagens automáticas. Recarregue a página para tentar de novo.'}
        </p>
      </div>
    )
  }

  const needsTemplates = mode === 'own' && templates.length === 0
  const anyEnabled = Object.values(localState).some((state) => state.enabled)
  const templatesGuidance = needsTemplates && (
    <p className="rounded-[3px] border border-dashed border-topbar-border px-4 py-3 text-xs text-mid">
      Crie os templates padrão em &quot;Templates de mensagem&quot; para ativar as mensagens automáticas.
    </p>
  )

  // With no templates the toggles do nothing, except to let the clinic turn off one already on.
  if (needsTemplates && !anyEnabled) {
    return (
      <div className="space-y-4">
        <SettingsSectionHeader>Mensagens automáticas</SettingsSectionHeader>
        {templatesGuidance}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SettingsSectionHeader>Mensagens automáticas</SettingsSectionHeader>

      <p className="text-xs text-mid">
        Mensagens que o FloraClin envia sozinho aos seus pacientes. Cada mudança é salva na hora.
      </p>

      {templatesGuidance}

      <div className="space-y-3">
        {TRIGGERS.map((trigger) => {
          const state = localState[trigger.key]
          if (!state) return null
          const matchingTemplate = getMatchingTemplate(trigger.purposeKey)
          const templateState = resolveTemplateState(matchingTemplate, mode)
          const canSend = matchingTemplate?.status === 'APPROVED'
          const Icon = trigger.icon
          const saving = savingKeys.has(trigger.key)
          const procedureText = trigger.procedureText
          const missingProcedureText =
            procedureText && procedureTypes !== null &&
            !procedureTypes.some((type) => type[procedureText.field]?.trim())

          return (
            <div
              key={trigger.key}
              className="rounded-[3px] border border-topbar-border bg-white p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0 text-mid" />
                  <div>
                    <Label htmlFor={`automation-${trigger.key}`} className="text-sm font-medium text-charcoal">
                      {trigger.label}
                    </Label>
                    <p className="text-xs text-mid">{trigger.description}</p>
                  </div>
                </div>
                <Switch
                  id={`automation-${trigger.key}`}
                  checked={state.enabled}
                  disabled={saving}
                  onCheckedChange={(checked) =>
                    save(
                      trigger,
                      { ...state, enabled: checked },
                      `Automação ${checked ? 'ativada' : 'desativada'}: ${trigger.label}`,
                    )
                  }
                />
              </div>

              {state.enabled && canSend && !sendsPaused && isScheduled(trigger.key) && (
                <p className="pl-7 flex items-center gap-1.5 text-xs text-forest">
                  <CalendarClock className="size-3.5" />
                  Próximo envio: {nextAutomationRun(trigger.key)}
                </p>
              )}

              {state.enabled && missingProcedureText && (
                <p className="pl-7 flex items-start gap-1.5 text-xs text-amber-dark">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {procedureText.missing}{' '}
                    <Link href={PROCEDURES_HREF} className="font-medium underline underline-offset-2 hover:text-forest">
                      Cadastrar em Procedimentos
                    </Link>
                  </span>
                </p>
              )}

              {matchingTemplate && (
                <div className="pl-7">
                  <button
                    type="button"
                    className="flex min-h-11 items-center gap-1 text-xs text-sage hover:underline sm:min-h-0"
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
                    if (field.type === 'number' && field.dependsOn && !state.config[field.dependsOn]) {
                      return null
                    }

                    if (field.type === 'toggle') {
                      return (
                        <div key={field.key} className="flex items-center justify-between gap-3">
                          <Label htmlFor={`${trigger.key}-${field.key}`} className="text-xs text-mid">{field.label}</Label>
                          <Switch
                            id={`${trigger.key}-${field.key}`}
                            checked={Boolean(state.config[field.key] ?? field.default)}
                            disabled={saving}
                            onCheckedChange={(checked) =>
                              save(
                                trigger,
                                { ...state, config: { ...state.config, [field.key]: checked } },
                                'Configuração salva',
                              )
                            }
                          />
                        </div>
                      )
                    }

                    return (
                      <div key={field.key} className="space-y-1.5">
                        <Label htmlFor={`${trigger.key}-${field.key}`} className="text-xs text-mid">{field.label}</Label>
                        <Input
                          id={`${trigger.key}-${field.key}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={field.max}
                          className="w-32"
                          disabled={saving}
                          value={(state.config[field.key] as number) ?? field.default}
                          onChange={(e) =>
                            editLocal(trigger.key, {
                              config: {
                                ...state.config,
                                [field.key]: Math.min(field.max, Math.max(1, parseInt(e.target.value) || field.default)),
                              },
                            })
                          }
                          onBlur={() => saveConfigIfChanged(trigger)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveConfigIfChanged(trigger)
                            }
                          }}
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
    </div>
  )
}
