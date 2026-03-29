'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { DiagramPointData } from './types'

/**
 * Returns a color based on the product name.
 * botox/toxina = blue, filler/preenchedor/AH = pink,
 * bioestimulador/biostimulator = green, others = purple.
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
    return '#3b82f6' // blue
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
    return '#ec4899' // pink
  }
  if (
    name.includes('bioestimulador') ||
    name.includes('biostimulator') ||
    name.includes('sculptra') ||
    name.includes('radiesse') ||
    name.includes('ellansé')
  ) {
    return '#22c55e' // green
  }
  return '#a855f7' // purple
}

interface DiagramPointProps {
  point: DiagramPointData
  onClick?: () => void
  ghost?: boolean
  readOnly?: boolean
  changed?: boolean // quantity differs from planned
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
      className="absolute flex items-center justify-center -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        left: `${point.x}%`,
        top: `${point.y}%`,
        opacity: ghost ? 0.35 : 1,
        pointerEvents: ghost || readOnly ? 'none' : 'auto',
        cursor: ghost || readOnly ? 'default' : 'pointer',
        zIndex: ghost ? 5 : 10,
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      aria-label={`${point.productName} - ${quantityLabel}`}
      disabled={ghost || readOnly}
    >
      <span
        className="flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white shadow-sm"
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
      <TooltipContent side="top" sideOffset={8}>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{point.productName}</span>
          {point.activeIngredient && (
            <span className="text-muted-foreground">
              {point.activeIngredient}
            </span>
          )}
          <span>
            {quantityLabel}
            {point.technique ? ` - ${point.technique}` : ''}
          </span>
          {point.depth && <span>Prof.: {point.depth}</span>}
          {point.notes && (
            <span className="text-muted-foreground">{point.notes}</span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
