'use client'

import { getPointColor } from './diagram-point'
import { cn } from '@/lib/utils'
import type { DiagramPointData } from './types'

interface DiagramSummaryProps {
  points: DiagramPointData[]
  previousPoints?: DiagramPointData[]
}

interface ProductTotal {
  productName: string
  totalQuantity: number
  unit: 'U' | 'mL'
  pointCount: number
  color: string
}

export function DiagramSummary({ points, previousPoints }: DiagramSummaryProps) {
  const totals = getTotals(points)
  const plannedTotals = previousPoints ? getTotals(previousPoints) : null

  const plannedMap = new Map<string, ProductTotal>()
  if (plannedTotals) {
    for (const t of plannedTotals) {
      plannedMap.set(`${t.productName}|${t.unit}`, t)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-[0.15em] font-medium text-mid">
          Produtos
        </h3>
        <span className="text-[11px] text-mid/50 tabular-nums">
          {points.length} {points.length === 1 ? 'ponto' : 'pontos'}
        </span>
      </div>

      {totals.length === 0 ? (
        <p className="text-[12px] text-mid/60 py-2">
          Clique no rosto para adicionar pontos de aplicação.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {totals.map((total) => {
            const key = `${total.productName}|${total.unit}`
            const planned = plannedMap.get(key)
            const hasPlanned = !!planned
            const changed = hasPlanned && planned.totalQuantity !== total.totalQuantity

            return (
              <div
                key={key}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors',
                  changed
                    ? 'bg-[#FFF4EF] border border-amber/20'
                    : 'bg-[#FAFBFC] border border-transparent'
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: total.color }}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-charcoal truncate block">
                    {total.productName}
                  </span>
                  <span className="text-[11px] text-mid/50">
                    {total.pointCount} {total.pointCount === 1 ? 'ponto' : 'pontos'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {hasPlanned && changed && (
                    <>
                      <span className="text-[11px] text-mid line-through tabular-nums">
                        {formatQuantity(planned.totalQuantity)}{total.unit}
                      </span>
                      <span className="text-[10px] text-mid/40">→</span>
                    </>
                  )}
                  <span className={cn(
                    'text-[13px] font-semibold tabular-nums',
                    changed ? 'text-amber-dark' : 'text-charcoal'
                  )}>
                    {formatQuantity(total.totalQuantity)}
                    <span className="text-[11px] font-normal text-mid/60 ml-0.5">
                      {total.unit}
                    </span>
                  </span>
                  {hasPlanned && !changed && (
                    <span className="text-[11px] text-sage">✓</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Individual points list */}
      {points.length > 0 && (
        <div className="border-t border-[#F4F6F8] pt-2.5 mt-1">
          <h4 className="text-[10px] uppercase tracking-wider text-mid/40 font-medium mb-2">
            Detalhamento
          </h4>
          <div className="flex flex-col gap-0.5">
            {points.map((point) => {
              const plannedPoint = previousPoints?.find(
                (pp) =>
                  Math.abs(pp.x - point.x) < 1 &&
                  Math.abs(pp.y - point.y) < 1 &&
                  pp.productName === point.productName
              )
              const qtyChanged = plannedPoint && plannedPoint.quantity !== point.quantity

              return (
                <div
                  key={point.id}
                  className={cn(
                    'flex items-center gap-2 text-[12px] rounded-md px-2 py-1',
                    qtyChanged && 'bg-[#FFF4EF]'
                  )}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: getPointColor(point.productName) }}
                  />
                  <span className="truncate text-mid flex-1">{point.productName}</span>
                  <div className="ml-auto flex shrink-0 items-center gap-1 tabular-nums font-medium">
                    {qtyChanged && (
                      <>
                        <span className="text-mid/40 line-through text-[11px]">
                          {formatQuantity(plannedPoint.quantity)}{point.quantityUnit}
                        </span>
                        <span className="text-mid/30 text-[10px]">→</span>
                      </>
                    )}
                    <span className={cn('text-charcoal', qtyChanged && 'text-amber-dark')}>
                      {formatQuantity(point.quantity)}
                      <span className="text-mid/50 font-normal">{point.quantityUnit}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function getTotals(points: DiagramPointData[]): ProductTotal[] {
  const map = new Map<string, ProductTotal>()

  for (const point of points) {
    const key = `${point.productName}|${point.quantityUnit}`
    const existing = map.get(key)
    if (existing) {
      existing.totalQuantity += point.quantity
      existing.pointCount += 1
    } else {
      map.set(key, {
        productName: point.productName,
        totalQuantity: point.quantity,
        unit: point.quantityUnit,
        pointCount: 1,
        color: getPointColor(point.productName),
      })
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.productName.localeCompare(b.productName, 'pt-BR')
  )
}

function formatQuantity(n: number): string {
  if (Number.isInteger(n)) return n.toString()
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
