'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  X,
  MessageCircle,
  UserCheck,
  XCircle,
  Loader2,
  Save,
  Phone,
} from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/lib/utils'
import type { Prospect, ProspectStage, TeamMember } from './types'
import { STAGE_CONFIG, PROSPECT_STAGES, INTENT_CONFIG, SENTIMENT_CONFIG } from './constants'
import { ConvertProspectModal } from './convert-prospect-modal'

interface ProspectDetailPanelProps {
  prospect: Prospect | null
  teamMembers: TeamMember[]
  onClose: () => void
  onUpdate: (id: string, data: Partial<Prospect>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onConverted: () => void
}

export function ProspectDetailPanel({
  prospect,
  teamMembers,
  onClose,
  onUpdate,
  onDelete,
  onConverted,
}: ProspectDetailPanelProps) {
  const [notes, setNotes] = useState('')
  const [stage, setStage] = useState<ProspectStage>('novo')
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null)
  const [lostReason, setLostReason] = useState('')
  const [showLostInput, setShowLostInput] = useState(false)
  const [saving, setSaving] = useState(false)
  const [convertModalOpen, setConvertModalOpen] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (prospect) {
      setNotes(prospect.notes || '')
      setStage(prospect.stage)
      setAssignedUserId(prospect.assignedUserId)
      setLostReason(prospect.lostReason || '')
      setShowLostInput(false)
      setDirty(false)
    }
  }, [prospect])

  const handleSave = useCallback(async () => {
    if (!prospect || !dirty) return
    setSaving(true)
    try {
      await onUpdate(prospect.id, {
        notes,
        stage,
        assignedUserId,
      })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [prospect, dirty, notes, stage, assignedUserId, onUpdate])

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
            Detalhes do Prospect
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
              {prospect.phone}
            </div>
          </div>

          {/* Source */}
          {prospect.source && (
            <div>
              <Label className="text-xs text-[#7A7A7A]">Origem</Label>
              <p className="mt-0.5 text-sm text-[#2A2A2A]">
                {prospect.source}
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
                <Label className="text-xs text-[#7A7A7A]">Intencao</Label>
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

          {/* Interested procedure */}
          {prospect.interestedProcedure && (
            <div>
              <Label className="text-xs text-[#7A7A7A]">
                Procedimento de interesse
              </Label>
              <p className="mt-0.5 text-sm text-[#2A2A2A]">
                {prospect.interestedProcedure}
              </p>
            </div>
          )}

          {/* Assign dropdown */}
          <div>
            <Label className="text-xs text-[#7A7A7A]">Responsavel</Label>
            <select
              value={assignedUserId || ''}
              onChange={(e) => {
                setAssignedUserId(e.target.value || null)
                setDirty(true)
              }}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-forest focus:ring-1 focus:ring-forest"
            >
              <option value="">Nao atribuido</option>
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
              placeholder="Adicione observacoes..."
              className="mt-1"
              rows={4}
            />
          </div>

          {/* Date info */}
          <div className="text-xs text-[#B0B0B0]">
            <p>Criado em {formatDate(prospect.createdAt)}</p>
            {prospect.updatedAt !== prospect.createdAt && (
              <p>Atualizado em {formatDate(prospect.updatedAt)}</p>
            )}
          </div>

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
                  href={`/whatsapp?conversation=${prospect.whatsappConversationId}`}
                />
              }>
                <MessageCircle className="mr-1 h-3.5 w-3.5" />
                Ver conversa
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
