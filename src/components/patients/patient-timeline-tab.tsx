'use client'

import { useEffect, useState } from 'react'
import {
  Loader2,
  Clock,
  ClipboardList,
  FileCheck,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Receipt,
  CreditCard,
  Camera,
  UserPlus,
  ClipboardEdit,
  Calendar,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatDate } from '@/lib/utils'
import {
  getPatientTimelineAction,
  type PatientTimeline,
  type TimelineEntry,
  type TimelineGroup,
} from '@/actions/timeline'

// ─── Config ─────────────────────────────────────────────────────────

type TimelineEntryType = TimelineEntry['type']

const TYPE_CONFIG: Record<
  TimelineEntryType,
  { icon: typeof ClipboardList; color: string }
> = {
  plan_created: { icon: ClipboardList, color: 'bg-[#F0F7F1] text-sage' },
  consent_signed: { icon: FileCheck, color: 'bg-[#F0F7F1] text-sage' },
  contract_signed: { icon: FileCheck, color: 'bg-[#F0F7F1] text-sage' },
  plan_approved: { icon: CheckCircle, color: 'bg-[#F0F7F1] text-sage' },
  plan_executed: { icon: CheckCircle2, color: 'bg-forest/10 text-forest' },
  plan_cancelled: { icon: XCircle, color: 'bg-[#F4F6F8] text-mid' },
  financial_created: { icon: Receipt, color: 'bg-[#FFF4EF] text-amber' },
  payment_received: { icon: CreditCard, color: 'bg-[#F0F7F1] text-sage' },
  photo_uploaded: { icon: Camera, color: 'bg-mint/10 text-mint' },
  patient_created: { icon: UserPlus, color: 'bg-[#F4F6F8] text-charcoal' },
  anamnesis_updated: { icon: ClipboardEdit, color: 'bg-[#F4F6F8] text-charcoal' },
  appointment: { icon: Calendar, color: 'bg-[#F0F7F1] text-sage' },
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  planned: { label: 'Planejado', className: 'bg-amber-light text-amber-dark' },
  approved: { label: 'Aprovado', className: 'bg-sage/10 text-sage' },
  executed: { label: 'Executado', className: 'bg-forest/10 text-forest' },
  cancelled: { label: 'Cancelado', className: 'bg-[#F4F6F8] text-mid' },
}

// ─── Component ──────────────────────────────────────────────────────

interface PatientTimelineTabProps {
  patientId: string
}

export function PatientTimelineTab({ patientId }: PatientTimelineTabProps) {
  const [timeline, setTimeline] = useState<PatientTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    async function loadTimeline() {
      try {
        const data = await getPatientTimelineAction(patientId)
        if (!cancelled) {
          setTimeline(data)
          // Expand all groups by default
          setExpandedGroups(new Set(data.groups.map((g) => g.id)))
        }
      } catch {
        if (!cancelled) setTimeline({ groups: [], ungrouped: [] })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadTimeline()
    return () => {
      cancelled = true
    }
  }, [patientId])

  function toggleGroup(groupId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando timeline...</span>
      </div>
    )
  }

  if (
    !timeline ||
    (timeline.ungrouped.length === 0 && timeline.groups.length === 0)
  ) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-mid">
        <Clock className="mb-2 size-8" />
        <p className="text-sm">Nenhuma atividade registrada</p>
      </div>
    )
  }

  // Merge groups and ungrouped into a single chronological list
  // Each item gets a sortDate: for groups, use the earliest event date; for entries, use the entry date
  const chronologicalItems: Array<
    | { kind: 'group'; group: TimelineGroup; sortDate: number }
    | { kind: 'entry'; entry: TimelineEntry; sortDate: number }
  > = []

  for (const group of timeline.groups) {
    const dates = group.entries.map((e) => new Date(e.date).getTime())
    const earliest = dates.length > 0 ? Math.min(...dates) : 0
    chronologicalItems.push({ kind: 'group', group, sortDate: earliest })
  }

  for (const entry of timeline.ungrouped) {
    chronologicalItems.push({
      kind: 'entry',
      entry,
      sortDate: new Date(entry.date).getTime(),
    })
  }

  // Sort descending (newest first)
  chronologicalItems.sort((a, b) => b.sortDate - a.sortDate)

  return (
    <div className="space-y-3">
      {chronologicalItems.map((item) =>
        item.kind === 'group' ? (
          <ServiceGroup
            key={item.group.id}
            group={item.group}
            isExpanded={expandedGroups.has(item.group.id)}
            onToggle={() => toggleGroup(item.group.id)}
          />
        ) : (
          <UngroupedEntry key={item.entry.id} entry={item.entry} />
        )
      )}
    </div>
  )
}

// ─── Ungrouped Entry ────────────────────────────────────────────────

function UngroupedEntry({ entry }: { entry: TimelineEntry }) {
  const config = TYPE_CONFIG[entry.type]
  const Icon = config.icon

  return (
    <div className="flex items-start gap-3 py-2">
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${config.color}`}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-charcoal">{entry.title}</p>
        {entry.description && (
          <p className="text-sm text-mid">{entry.description}</p>
        )}
        <p className="text-xs text-mid">{formatDateTime(entry.date)}</p>
        {entry.meta && <p className="text-xs text-mid">{entry.meta}</p>}
      </div>
    </div>
  )
}

// ─── Service Group ──────────────────────────────────────────────────

function ServiceGroup({
  group,
  isExpanded,
  onToggle,
}: {
  group: TimelineGroup
  isExpanded: boolean
  onToggle: () => void
}) {
  const statusConfig = STATUS_BADGE[group.status] ?? {
    label: group.status,
    className: 'bg-[#F4F6F8] text-mid',
  }

  // Date range
  const dates = group.entries.map((e) => new Date(e.date).getTime())
  const firstDate = dates.length > 0 ? new Date(Math.min(...dates)) : null
  const lastDate = dates.length > 0 ? new Date(Math.max(...dates)) : null

  return (
    <div className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] overflow-hidden">
      {/* Group header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-cream/50 transition-colors"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sage/10 text-sage">
          {isExpanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-charcoal truncate">
              Atendimento: {group.title}
            </span>
            <Badge
              variant="outline"
              className={`text-[11px] border-0 ${statusConfig.className}`}
            >
              {statusConfig.label}
            </Badge>
          </div>
          {firstDate && lastDate && (
            <p className="text-xs text-mid mt-0.5">
              {formatDate(firstDate)}
              {firstDate.getTime() !== lastDate.getTime() &&
                ` — ${formatDate(lastDate)}`}
            </p>
          )}
        </div>
        <span className="text-xs text-mid shrink-0">
          {group.entries.length}{' '}
          {group.entries.length === 1 ? 'evento' : 'eventos'}
        </span>
      </button>

      {/* Group entries */}
      {isExpanded && (
        <div className="px-4 pb-3">
          {group.entries.length === 0 ? (
            <p className="text-xs text-mid py-2 pl-11">
              Nenhuma atividade neste atendimento
            </p>
          ) : (
            <div className="relative ml-4 border-l border-sage/20">
              {group.entries.map((entry, index) => (
                <GroupEntry
                  key={entry.id}
                  entry={entry}
                  isLast={index === group.entries.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Group Entry ────────────────────────────────────────────────────

function GroupEntry({
  entry,
  isLast,
}: {
  entry: TimelineEntry
  isLast: boolean
}) {
  const config = TYPE_CONFIG[entry.type]
  const Icon = config.icon

  return (
    <div className={`flex items-start gap-3 pl-4 ${isLast ? 'pb-1' : 'pb-3'}`}>
      <div
        className={`flex size-6 shrink-0 items-center justify-center rounded-full ${config.color} -ml-[calc(1rem+0.75rem/2+0.5px)]`}
      >
        <Icon className="size-3" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-sm text-charcoal">{entry.title}</p>
        {entry.description && (
          <p className="text-xs text-mid">{entry.description}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-mid">
            {formatDateTime(entry.date)}
          </span>
          {entry.meta && (
            <span className="text-xs text-mid">{entry.meta}</span>
          )}
        </div>
      </div>
    </div>
  )
}
