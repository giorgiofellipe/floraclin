'use client'

import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronRight, User } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ProcedureListItem } from '@/db/queries/procedures'

// ─── Status Config ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  completed: {
    label: 'Concluido',
    className: 'bg-petal text-mid border-0',
  },
  in_progress: {
    label: 'Em andamento',
    className: 'bg-amber-light text-amber-dark border-0',
  },
  cancelled: {
    label: 'Cancelado',
    className: 'bg-red-100 text-red-800 border-0',
  },
}

const CATEGORY_ICONS: Record<string, string> = {
  toxina_botulinica: 'TB',
  botox: 'TB',
  preenchimento: 'AH',
  filler: 'AH',
  bioestimulador: 'BE',
  biostimulator: 'BE',
}

// ─── Component ──────────────────────────────────────────────────────

interface ProcedureCardProps {
  procedure: ProcedureListItem
  onClick?: () => void
}

export function ProcedureCard({ procedure, onClick }: ProcedureCardProps) {
  const status = STATUS_CONFIG[procedure.status] ?? STATUS_CONFIG.completed
  const categoryCode =
    CATEGORY_ICONS[procedure.procedureTypeCategory.toLowerCase()] ?? 'PR'

  return (
    <Card
      className={cn(
        'cursor-pointer transition-shadow hover:shadow-md',
        'border-l-4 border-l-sage bg-white'
      )}
      onClick={onClick}
    >
      <CardContent className="flex items-center gap-4 p-4">
        {/* Mini diagram preview placeholder */}
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-cream">
          <span className="text-sm font-bold text-forest">{categoryCode}</span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-forest">
                {procedure.procedureTypeName}
              </h3>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-mid">
                <span>
                  {format(new Date(procedure.performedAt), "dd/MM/yyyy 'as' HH:mm", {
                    locale: ptBR,
                  })}
                </span>
                <span className="text-mid/40">|</span>
                <span className="flex items-center gap-1">
                  <User className="size-3" />
                  {procedure.practitionerName}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Badge className={status.className}>{status.label}</Badge>
              <ChevronRight className="size-4 text-mid" />
            </div>
          </div>

          {procedure.technique && (
            <p className="mt-1 truncate text-xs text-mid">
              {procedure.technique}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
