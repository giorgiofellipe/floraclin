'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { DiagramPointData } from './types'

/**
 * Product-category color mapping.
 * Uses the brand palette: forest-adjacent tones for clinical categories.
 */
export function getPointColor(productName: string): string {
  const name = productName.toLowerCase()
  if (
    name.includes('botox') ||
    name.includes('toxina') ||
    name.includes('dysport') ||
    name.includes('xeomin') ||
    name.includes('botulínica') ||
    name.includes('botulinica')
  ) {
    return '#3b82f6' // blue — neurotoxins
  }
  if (
    name.includes('filler') ||
    name.includes('preenchedor') ||
    name.includes('hialurônico') ||
    name.includes('hialuronico') ||
    name.includes('juvederm') ||
    name.includes('restylane') ||
    name.includes('ácido hialurônico') ||
    name.includes('ah')
  ) {
    return '#ec4899' // pink — fillers
  }
  if (
    name.includes('bioestimulador') ||
    name.includes('biostimulator') ||
    name.includes('sculptra') ||
    name.includes('radiesse') ||
    name.includes('ellansé')
  ) {
    return '#22c55e' // green — biostimulators
  }
  return '#a855f7' // purple — other
}

interface DiagramPointProps {
  point: DiagramPointData
  onClick?: () => void
  ghost?: boolean
  readOnly?: boolean
  changed?: boolean
}

export function DiagramPoint({
  point,
  onClick,
  ghost = false,
  readOnly = false,
  changed = false,
}: DiagramPointProps) {
  const color = changed ? '#D4845A' : getPointColor(point.productName)
  const unitLabel = point.quantityUnit === 'U' ? 'U' : 'mL'
  const quantityLabel = `${point.quantity}${unitLabel}`

  const marker = (
    <button
      type="button"
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-200 focus-visible:outline-none',
        !ghost && !readOnly && 'hover:scale-110 cursor-pointer',
        ghost && 'pointer-events-none',
        readOnly && 'pointer-events-none cursor-default',
      )}
      style={{
        left: `${point.x}%`,
        top: `${point.y}%`,
        opacity: ghost ? 0.3 : 1,
        zIndex: ghost ? 5 : 10,
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      aria-label={`${point.productName} - ${quantityLabel}`}
      disabled={ghost || readOnly}
    >
      {/* Outer ring — visible on hover */}
      {!ghost && !readOnly && (
        <span
          className="absolute inset-[-4px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ border: `2px solid ${color}40` }}
        />
      )}
      {/* Point body */}
      <span
        className="relative flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[9px] font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
        style={{ backgroundColor: color }}
      >
        {quantityLabel}
      </span>
    </button>
  )

  if (ghost) {
    return marker
  }

  return (
    <Tooltip>
      <TooltipTrigger render={marker} />
      <TooltipContent side="top" sideOffset={10} className="p-0 border-0 shadow-lg">
        <div className="rounded-lg bg-[#1C2B1E] text-white px-3.5 py-2.5 min-w-[180px]">
          <p className="text-[13px] font-medium">{point.productName}</p>
          {point.activeIngredient && (
            <p className="text-[11px] text-white/50 mt-0.5">{point.activeIngredient}</p>
          )}
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/10">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40">Qtd</p>
              <p className="text-[13px] font-semibold tabular-nums">{quantityLabel}</p>
            </div>
            {point.technique && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40">Técnica</p>
                <p className="text-[12px]">{point.technique}</p>
              </div>
            )}
            {point.depth && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40">Prof.</p>
                <p className="text-[12px]">{point.depth}</p>
              </div>
            )}
          </div>
          {point.notes && (
            <p className="text-[11px] text-white/50 mt-1.5 italic">{point.notes}</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
