'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  X,
  MessageCircle,
  Camera,
  UserCheck,
  XCircle,
  Loader2,
  Save,
  Phone,
  Clock,
  ArrowRight,
  Bot,
  UserPlus,
  Trash2,
  StickyNote,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MaskedInput } from '@/components/ui/masked-input'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { formatCurrency } from '@/lib/utils'
import type { Prospect, ProspectStage, TeamMember, ProcedureTypeOption } from './types'
import { STAGE_CONFIG, PROSPECT_STAGES, INTENT_CONFIG, SENTIMENT_CONFIG } from './constants'
import { ConvertProspectModal } from './convert-prospect-modal'

interface Activity {
  id: string
  action: string
  details: Record<string, unknown> | null
  performedByName?: string | null
  createdAt: string
}

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  manual: 'Manual',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  outro: 'Outro',
}

interface ProspectDetailPanelProps {
  prospect: Prospect | null
  teamMembers: TeamMember[]
  procedureTypes: ProcedureTypeOption[]
  onClose: () => void
  onUpdate: (id: string, data: Partial<Prospect>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onConverted: () => void
}

export function ProspectDetailPanel({
  prospect,
  teamMembers,
  procedureTypes,
  onClose,
  onUpdate,
  onDelete,
  onConverted,
}: ProspectDetailPanelProps) {
  const [notes, setNotes] = useState('')
  const [stage, setStage] = useState<ProspectStage>('novo')
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [selectedProcedureIds, setSelectedProcedureIds] = useState<string[]>([])
  const [lostReason, setLostReason] = useState('')
  const [showLostInput, setShowLostInput] = useState(false)
  const [saving, setSaving] = useState(false)
  const [convertModalOpen, setConvertModalOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [activities, setActivities] = useState<Activity[]>([])

  useEffect(() => {
    if (prospect) {
      setNotes(prospect.notes || '')
      setStage(prospect.stage)
      setAssignedUserId(prospect.assignedUserId)
      setValue(prospect.value ? maskCurrency((parseFloat(prospect.value) * 100).toFixed(0)) : '')
      setSelectedProcedureIds(prospect.interestedProcedures?.map((p) => p.id) ?? [])
      setLostReason(prospect.lostReason || '')
      setShowLostInput(false)
      setDirty(false)

      fetch(`/api/crm/prospects/${prospect.id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.activities) setActivities(data.activities)
        })
        .catch(() => {})
    }
  }, [prospect])

  const handleSave = useCallback(async () => {
    if (!prospect || !dirty) return
    setSaving(true)
    try {
      const parsedValue = value ? parseCurrency(value).toFixed(2) : null
      await onUpdate(prospect.id, {
        notes,
        stage,
        assignedUserId,
        value: parsedValue,
        procedureTypeIds: selectedProcedureIds,
      } as Partial<Prospect> & { procedureTypeIds?: string[] })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [prospect, dirty, notes, stage, assignedUserId, value, selectedProcedureIds, onUpdate])

  const handleMarkLost = async () => {
    if (!prospect) return
    setSaving(true)
    try {
      await onUpdate(prospect.id, {
        stage: 'perdido',
        lostReason: lostReason || undefined,
      } as Partial<Prospect>)
      setShowLostInput(false)
    } finally {
      setSaving(false)
    }
  }

  if (!prospect) return null

  // Phone is nullable for Instagram-sourced prospects; fall back to @handle
  // or a generic placeholder so we never render `null` / empty string.
  const prospectWithIg = prospect as Prospect & { igHandle?: string | null }
  const contactDisplay: string =
    prospectWithIg.phone ??
    (prospectWithIg.igHandle ? `@${prospectWithIg.igHandle}` : 'Sem contato')

  const intentConfig = prospect.intent
    ? INTENT_CONFIG[prospect.intent]
    : undefined
  const sentimentConfig = prospect.sentiment
    ? SENTIMENT_CONFIG[prospect.sentiment]
    : undefined

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        role="button"
        tabIndex={-1}
        aria-label="Fechar painel"
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-medium text-[#2A2A2A]">
            Detalhes do Lead
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#7A7A7A] hover:bg-[#F4F6F8] hover:text-[#2A2A2A]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Name & Phone */}
          <div className="space-y-1">
            <h3 className="text-lg font-medium text-[#2A2A2A]">
              {prospect.name || 'Sem nome'}
            </h3>
            <div className="flex items-center gap-1.5 text-sm text-[#7A7A7A]">
              <Phone className="h-3.5 w-3.5" />
              {contactDisplay}
            </div>
            {prospect.whatsappConversationId && (
              <Link
                href={`/whatsapp?conversa=${prospect.whatsappConversationId}`}
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[#25D366] hover:underline"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Ver conversa no WhatsApp
              </Link>
            )}
            {prospect.instagramConversationId && (
              <Link
                href={`/instagram?conversa=${prospect.instagramConversationId}`}
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[#E1306C] hover:underline"
              >
                <Camera className="h-3.5 w-3.5" />
                Ver conversa no Instagram
              </Link>
            )}
          </div>

          {/* Source */}
          {prospect.source && (
            <div>
              <Label className="text-xs text-[#7A7A7A]">Origem</Label>
              <p className="mt-0.5 text-sm text-[#2A2A2A]">
                {SOURCE_LABELS[prospect.source] ?? prospect.source}
              </p>
            </div>
          )}

          {/* Stage select */}
          <div>
            <Label className="text-xs text-[#7A7A7A]">Etapa</Label>
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value as ProspectStage)
                setDirty(true)
              }}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-forest focus:ring-1 focus:ring-forest"
            >
              {PROSPECT_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_CONFIG[s].label}
                </option>
              ))}
            </select>
          </div>

          {/* Intent & Sentiment */}
          <div className="flex gap-4">
            {intentConfig && (
              <div>
                <Label className="text-xs text-[#7A7A7A]">Intenção</Label>
                <span
                  className="mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: intentConfig.bg,
                    color: intentConfig.color,
                  }}
                >
                  {intentConfig.label}
                </span>
              </div>
            )}
            {sentimentConfig && (
              <div>
                <Label className="text-xs text-[#7A7A7A]">Sentimento</Label>
                <span
                  className="mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ color: sentimentConfig.color }}
                >
                  {sentimentConfig.label}
                </span>
              </div>
            )}
          </div>

          {/* Interested procedures */}
          {procedureTypes.length > 0 && (
            <div>
              <Label className="text-xs text-[#7A7A7A]">
                Procedimentos de interesse
              </Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {procedureTypes.map((pt) => {
                  const selected = selectedProcedureIds.includes(pt.id)
                  return (
                    <button
                      key={pt.id}
                      type="button"
                      onClick={() => {
                        setSelectedProcedureIds((prev) =>
                          selected
                            ? prev.filter((id) => id !== pt.id)
                            : [...prev, pt.id],
                        )
                        setDirty(true)
                      }}
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        selected
                          ? 'border-forest bg-forest/10 text-forest'
                          : 'border-gray-200 text-[#7A7A7A] hover:border-gray-300'
                      }`}
                    >
                      {pt.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Value */}
          <div>
            <Label className="text-xs text-[#7A7A7A]">Valor estimado</Label>
            <div className="relative mt-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#7A7A7A]">R$</span>
              <MaskedInput
                mask={maskCurrency}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  setDirty(true)
                }}
                placeholder="0,00"
                className="pl-9"
              />
            </div>
          </div>

          {/* Assign dropdown */}
          <div>
            <Label className="text-xs text-[#7A7A7A]">Responsável</Label>
            <select
              value={assignedUserId || ''}
              onChange={(e) => {
                setAssignedUserId(e.target.value || null)
                setDirty(true)
              }}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-forest focus:ring-1 focus:ring-forest"
            >
              <option value="">Não atribuído</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs text-[#7A7A7A]">Notas</Label>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setDirty(true)
              }}
              placeholder="Adicione observações..."
              className="mt-1"
              rows={4}
            />
          </div>

          {/* Timeline */}
          {activities.length > 0 && (
            <div>
              <Label className="text-xs text-[#7A7A7A]">Histórico</Label>
              <div className="mt-2 space-y-0">
                {activities.map((activity, idx) => (
                  <ActivityItem key={activity.id} activity={activity} isLast={idx === activities.length - 1} />
                ))}
              </div>
            </div>
          )}

          {/* Lost reason input */}
          {showLostInput && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <Label className="text-xs text-red-700">
                Motivo da perda (opcional)
              </Label>
              <Input
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                placeholder="Ex: escolheu outra clinica"
                className="mt-1"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleMarkLost}
                  disabled={saving}
                >
                  {saving && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowLostInput(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t p-4">
          <div className="flex flex-wrap gap-2">
            {/* Save button */}
            {dirty && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1 h-3.5 w-3.5" />
                )}
                Salvar
              </Button>
            )}

            {/* View conversation */}
            {prospect.whatsappConversationId && (
              <Button variant="outline" size="sm" render={
                <Link
                  href={`/whatsapp?conversa=${prospect.whatsappConversationId}`}
                />
              }>
                <MessageCircle className="mr-1 h-3.5 w-3.5" />
                Ver conversa
              </Button>
            )}
            {prospect.instagramConversationId && (
              <Button variant="outline" size="sm" render={
                <Link
                  href={`/instagram?conversa=${prospect.instagramConversationId}`}
                />
              }>
                <Camera className="mr-1 h-3.5 w-3.5" />
                Ver no Instagram
              </Button>
            )}

            {/* Convert */}
            {prospect.stage !== 'convertido' &&
              prospect.stage !== 'perdido' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConvertModalOpen(true)}
                >
                  <UserCheck className="mr-1 h-3.5 w-3.5" />
                  Converter
                </Button>
              )}

            {/* Mark as lost */}
            {prospect.stage !== 'perdido' &&
              prospect.stage !== 'convertido' && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowLostInput(true)}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  Marcar como perdido
                </Button>
              )}
          </div>
        </div>
      </div>

      <ConvertProspectModal
        prospect={prospect}
        open={convertModalOpen}
        onOpenChange={setConvertModalOpen}
        onConverted={onConverted}
      />
    </>
  )
}

const ACTION_CONFIG: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  created: { label: 'Lead criado', icon: UserPlus, color: '#25D366' },
  stage_changed: { label: 'Etapa alterada', icon: ArrowRight, color: '#42A5F5' },
  assigned: { label: 'Responsável alterado', icon: User, color: '#AB47BC' },
  note_updated: { label: 'Notas atualizadas', icon: StickyNote, color: '#FFA726' },
  lost: { label: 'Marcado como perdido', icon: XCircle, color: '#EF5350' },
  converted: { label: 'Convertido em paciente', icon: UserCheck, color: '#66BB6A' },
  deleted: { label: 'Lead removido', icon: Trash2, color: '#EF5350' },
  ai_classified: { label: 'Classificado por IA', icon: Bot, color: '#7C4DFF' },
}

function ActivityItem({ activity, isLast }: { activity: Activity; isLast: boolean }) {
  const config = ACTION_CONFIG[activity.action] ?? {
    label: activity.action,
    icon: Clock,
    color: '#7A7A7A',
  }
  const Icon = config.icon
  const details = activity.details as Record<string, unknown> | null

  let description = ''
  if (activity.action === 'stage_changed' && details) {
    const from = details.from as string
    const to = details.to as string
    const fromLabel = STAGE_CONFIG[from as ProspectStage]?.label ?? from
    const toLabel = STAGE_CONFIG[to as ProspectStage]?.label ?? to
    description = `${fromLabel} → ${toLabel}`
  } else if (activity.action === 'lost' && details?.reason) {
    description = details.reason as string
  } else if (activity.action === 'ai_classified' && details) {
    const parts: string[] = []
    if (details.intent) {
      const intentCfg = INTENT_CONFIG[details.intent as keyof typeof INTENT_CONFIG]
      parts.push(intentCfg?.label ?? (details.intent as string))
    }
    const rawProcs = details.interestedProcedures ?? (details.interestedProcedure ? [details.interestedProcedure] : [])
    const procs = (Array.isArray(rawProcs) ? rawProcs : []) as string[]
    if (procs.length > 0) parts.push(procs.join(', '))
    description = parts.join(' · ')
  } else if (activity.action === 'created' && details?.source) {
    const source = details.source as string
    const sourceLabels: Record<string, string> = {
      whatsapp: 'WhatsApp',
      manual: 'Manual',
      instagram: 'Instagram',
      indicacao: 'Indicação',
    }
    description = `via ${sourceLabels[source] ?? source}`
  }

  const timeAgo = formatDistanceToNow(new Date(activity.createdAt), {
    locale: ptBR,
    addSuffix: true,
  })

  return (
    <div className="flex gap-3">
      {/* Vertical line + icon */}
      <div className="flex flex-col items-center">
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: config.color + '1A' }}
        >
          <Icon className="h-3 w-3" style={{ color: config.color }} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200" />}
      </div>

      {/* Content */}
      <div className="pb-4">
        <p className="text-sm font-medium text-[#2A2A2A]">{config.label}</p>
        {description && (
          <p className="text-xs text-[#7A7A7A]">{description}</p>
        )}
        <p className="mt-0.5 text-[10px] text-[#B0B0B0]">
          {timeAgo}
          {activity.performedByName && ` · ${activity.performedByName}`}
        </p>
      </div>
    </div>
  )
}
