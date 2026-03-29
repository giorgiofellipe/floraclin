'use client'

import { useEffect, useState } from 'react'
import {
  Loader2,
  Syringe,
  Camera,
  FileCheck,
  Calendar,
  CreditCard,
  Clock,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import { getPatientTimelineAction, type TimelineEntry } from '@/actions/timeline'

// ─── Types ──────────────────────────────────────────────────────────

type TimelineEntryType = TimelineEntry['type']

const TYPE_CONFIG: Record<TimelineEntryType, {
  icon: typeof Syringe
  label: string
  color: string
}> = {
  procedure: { icon: Syringe, label: 'Procedimento', color: 'bg-sage/20 text-sage' },
  photo: { icon: Camera, label: 'Foto', color: 'bg-mint/20 text-forest' },
  consent: { icon: FileCheck, label: 'Termo', color: 'bg-amber-light text-amber-dark' },
  appointment: { icon: Calendar, label: 'Agendamento', color: 'bg-[#F0F7F1] text-sage' },
  payment: { icon: CreditCard, label: 'Pagamento', color: 'bg-[#FFF4EF] text-amber' },
}

// ─── Component ──────────────────────────────────────────────────────

interface PatientTimelineTabProps {
  patientId: string
}

export function PatientTimelineTab({ patientId }: PatientTimelineTabProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadTimeline() {
      try {
        const data = await getPatientTimelineAction(patientId)
        if (!cancelled) setEntries(data)
      } catch {
        if (!cancelled) setEntries([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadTimeline()
    return () => {
      cancelled = true
    }
  }, [patientId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando timeline...</span>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-mid">
        <Clock className="mb-2 size-8" />
        <p className="text-sm">Nenhuma atividade registrada</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {entries.map((entry, index) => {
        const config = TYPE_CONFIG[entry.type]
        const Icon = config.icon

        return (
          <div key={entry.id} className="flex gap-3">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${config.color}`}>
                <Icon className="size-4" />
              </div>
              {index < entries.length - 1 && (
                <div className="w-px flex-1 bg-border" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-6">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {config.label}
                </Badge>
                <span className="text-xs text-mid">
                  {formatDateTime(entry.date)}
                </span>
              </div>
              <h4 className="mt-1 text-sm font-medium text-charcoal">
                {entry.title}
              </h4>
              {entry.description && (
                <p className="text-sm text-mid">{entry.description}</p>
              )}
              {entry.meta && (
                <p className="text-xs text-mid">{entry.meta}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
