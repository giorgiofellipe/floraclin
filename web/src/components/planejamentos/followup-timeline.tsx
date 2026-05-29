'use client'

import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  CheckCircle2,
  Clock,
  MessageCircle,
  Phone,
  Users,
  XCircle,
  HelpCircle,
  Pause,
} from 'lucide-react'

import type {
  FollowupChannel,
  FollowupOutcome,
} from '@/validations/followup'

export interface FollowupEntry {
  id: string
  contactedAt: string | Date
  contactedByName?: string | null
  channel: FollowupChannel
  outcome: FollowupOutcome
  notes?: string | null
}

export interface FollowupTimelineProps {
  followups: FollowupEntry[]
  loading?: boolean
  emptyState?: React.ReactNode
  className?: string
}

const CHANNEL_LABELS: Record<FollowupChannel, string> = {
  whatsapp: 'WhatsApp',
  call: 'Ligação',
  in_person: 'Pessoalmente',
  other: 'Outro canal',
}

const CHANNEL_ICONS: Record<FollowupChannel, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  call: Phone,
  in_person: Users,
  other: HelpCircle,
}

const OUTCOME_LABELS: Record<FollowupOutcome, string> = {
  agendou: 'Agendou',
  pediu_para_aguardar: 'Pediu para aguardar',
  sem_resposta: 'Sem resposta',
  desistiu: 'Desistiu',
  outro: 'Outro',
}

const OUTCOME_ICONS: Record<FollowupOutcome, typeof CheckCircle2> = {
  agendou: CheckCircle2,
  pediu_para_aguardar: Pause,
  sem_resposta: Clock,
  desistiu: XCircle,
  outro: HelpCircle,
}

const OUTCOME_STYLES: Record<FollowupOutcome, string> = {
  agendou: 'bg-sage/10 text-sage',
  pediu_para_aguardar: 'bg-amber-light text-amber-dark',
  sem_resposta: 'bg-muted text-mid',
  desistiu: 'bg-destructive/10 text-destructive',
  outro: 'bg-muted text-mid',
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function formatContactedAt(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true, locale: ptBR })
}

export function FollowupTimeline({
  followups,
  loading,
  emptyState,
  className,
}: FollowupTimelineProps) {
  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-mid ${className ?? ''}`}>
        <Clock className="h-3.5 w-3.5 animate-spin" />
        Carregando contatos...
      </div>
    )
  }

  if (followups.length === 0) {
    return (
      <div className={`rounded-lg border border-dashed border-input p-4 text-center text-sm text-mid ${className ?? ''}`}>
        {emptyState ?? 'Nenhum contato registrado ainda.'}
      </div>
    )
  }

  return (
    <ol className={`space-y-3 ${className ?? ''}`}>
      {followups.map((entry) => {
        const ChannelIcon = CHANNEL_ICONS[entry.channel] ?? HelpCircle
        const OutcomeIcon = OUTCOME_ICONS[entry.outcome] ?? HelpCircle
        const outcomeStyle = OUTCOME_STYLES[entry.outcome] ?? 'bg-muted text-mid'
        const contactedAt =
          entry.contactedAt instanceof Date
            ? entry.contactedAt
            : new Date(entry.contactedAt)
        const channelLabel = CHANNEL_LABELS[entry.channel] ?? entry.channel
        const outcomeLabel = OUTCOME_LABELS[entry.outcome] ?? entry.outcome

        return (
          <li
            key={entry.id}
            className="flex items-start gap-3 rounded-lg border border-input bg-card p-3"
          >
            <div
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-petal text-xs font-medium text-forest"
            >
              {getInitials(entry.contactedByName)}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-charcoal">
                  {entry.contactedByName ?? 'Equipe'}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-mid">
                  <ChannelIcon className="h-3 w-3" />
                  {channelLabel}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${outcomeStyle}`}
                >
                  <OutcomeIcon className="h-3 w-3" />
                  {outcomeLabel}
                </span>
                <span className="ml-auto text-xs text-mid">
                  {formatContactedAt(contactedAt)}
                </span>
              </div>
              {entry.notes && (
                <p className="text-sm text-charcoal whitespace-pre-wrap">
                  {entry.notes}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
