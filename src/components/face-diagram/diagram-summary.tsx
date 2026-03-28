'use client'

import { getPointColor } from './diagram-point'
import type { DiagramPointData } from './types'

interface DiagramSummaryProps {
  points: DiagramPointData[]
}

interface ProductTotal {
  productName: string
  totalQuantity: number
  unit: 'U' | 'mL'
  pointCount: number
  color: string
}

export function DiagramSummary({ points }: DiagramSummaryProps) {
  const totals = getTotals(points)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Totais</h3>
        <span className="text-xs text-muted-foreground">
          {points.length} {points.length === 1 ? 'ponto' : 'pontos'}
        </span>
      </div>

      {totals.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum ponto adicionado. Clique no rosto para adicionar.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {totals.map((total) => (
            <div
              key={`${total.productName}-${total.unit}`}
              className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: total.color }}
              />
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium leading-tight">
                  {total.productName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {total.pointCount}{' '}
                  {total.pointCount === 1 ? 'ponto' : 'pontos'}
                </span>
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {formatQuantity(total.totalQuantity)}
                {total.unit}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Points list */}
      {points.length > 0 && (
        <>
          <div className="border-t pt-2">
            <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
              Pontos
            </h4>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {points.map((point, index) => (
                <div
                  key={point.id}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: getPointColor(point.productName) }}
                  />
                  <span className="truncate">{point.productName}</span>
                  <span className="ml-auto shrink-0 tabular-nums font-medium">
                    {formatQuantity(point.quantity)}
                    {point.quantityUnit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
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
  // Show integer if whole number, otherwise up to 2 decimal places
  if (Number.isInteger(n)) return n.toString()
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
