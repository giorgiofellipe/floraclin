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
    label: 'Concluído',
    className: 'bg-[#F0F7F1] text-sage border-0',
  },
  in_progress: {
    label: 'Em andamento',
    className: 'bg-[#FFF4EF] text-amber border-0',
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
        'cursor-pointer transition-colors duration-200',
        'border-l-[3px] border-l-sage bg-white border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]'
      )}
      onClick={onClick}
    >
      <CardContent className="flex items-center gap-4 p-4">
        {/* Mini diagram preview placeholder */}
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[3px] bg-sage/10">
          <span className="text-xs font-bold text-forest tracking-wide">{categoryCode}</span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-medium text-[#2A2A2A]">
                {procedure.procedureTypeName}
              </h3>
              <div className="mt-1 flex items-center gap-2 text-xs text-mid">
                <span>
                  {format(new Date(procedure.performedAt), "dd/MM/yyyy 'as' HH:mm", {
                    locale: ptBR,
                  })}
                </span>
                <span className="text-sage/30">|</span>
                <span className="flex items-center gap-1">
                  <User className="size-3 text-sage" />
                  {procedure.practitionerName}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              <Badge className={cn(status.className, 'px-2.5 py-0.5 text-[11px] font-medium')}>{status.label}</Badge>
              <ChevronRight className="size-4 text-mid/50 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>

          {procedure.technique && (
            <p className="mt-1.5 truncate text-xs text-mid/80 italic">
              {procedure.technique}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
