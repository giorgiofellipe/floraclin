'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Phone, User, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

import type { Prospect } from './types'
import { INTENT_CONFIG } from './constants'
import { formatCurrency } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'

interface ProspectCardProps {
  prospect: Prospect
  onClick: (prospect: Prospect) => void
}

const CHANNEL_LABELS: Record<string, string> = {
  ctwa: 'Anúncio WhatsApp',
  booking_page: 'Página de agendamento',
  organic: 'Orgânico',
  manual: 'Manual',
}

export function ProspectCard({ prospect, onClick }: ProspectCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: prospect.id,
    data: { type: 'prospect', prospect },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const intentConfig = prospect.intent
    ? INTENT_CONFIG[prospect.intent]
    : undefined

  const displayName = prospect.name || formatBrPhone(prospect.phone)

  const attributionLabel = prospect.attribution
    ? prospect.attribution.adHeadline || CHANNEL_LABELS[prospect.attribution.channel] || prospect.attribution.channel
    : null

  const timeSince = prospect.createdAt
    ? formatDistanceToNow(new Date(prospect.createdAt), {
        locale: ptBR,
        addSuffix: false,
      })
    : null

  const assignedInitials = prospect.assignedUserName
    ? prospect.assignedUserName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      className={`group cursor-grab rounded-lg border border-gray-100 bg-white p-3 shadow-sm transition-all hover:shadow-md active:cursor-grabbing ${
        isDragging ? 'z-50 opacity-70 shadow-lg' : ''
      }`}
      onClick={(e) => {
        // Only open detail if not dragging
        if (!isDragging) {
          e.stopPropagation()
          onClick(prospect)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(prospect)
        }
      }}
    >
      {/* Name / Phone */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 truncate">
          {prospect.name ? (
            <User className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          ) : (
            <Phone className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          )}
          <span className="truncate text-sm font-medium text-[#2A2A2A]">
            {displayName}
          </span>
        </div>
        {assignedInitials && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E8ECEF] text-[10px] font-medium text-[#7A7A7A]">
            {assignedInitials}
          </span>
        )}
      </div>

      {/* Intent badge + procedure */}
      <div className="flex flex-wrap items-center gap-1.5">
        {intentConfig && (
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: intentConfig.bg,
              color: intentConfig.color,
            }}
          >
            {intentConfig.label}
          </span>
        )}
        {prospect.interestedProcedures?.length > 0 && (
          <span className="truncate text-[11px] text-[#7A7A7A]">
            {prospect.interestedProcedures.map((p) => p.name).join(', ')}
          </span>
        )}
      </div>

      {attributionLabel && (
        <div className="mt-1 truncate text-[10px] text-[#B0B0B0]">{attributionLabel}</div>
      )}

      {/* Footer: value + time since */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-[#B0B0B0]">
        {prospect.value ? (
          <span className="font-medium text-[#2E7D32]">
            {formatCurrency(parseFloat(prospect.value))}
          </span>
        ) : <span />}
        {timeSince && (
          <span className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {timeSince}
          </span>
        )}
      </div>
    </div>
  )
}
