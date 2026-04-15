'use client'

import * as React from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { DiagramViewType } from '@/types'
import { FaceTemplate, VIEW_LABELS } from './face-template'
import { DiagramPoint } from './diagram-point'
import { DiagramSummary } from './diagram-summary'
import { PointFormModal } from './point-form-modal'
import { ArmedProductStrip } from './armed-product-strip'
import type { DiagramPointData, FaceDiagramEditorProps } from './types'

const VIEW_TYPES: DiagramViewType[] = ['front', 'left_profile', 'right_profile']

const VIEW_SHORT: Record<DiagramViewType, string> = {
  front: 'Frontal',
  left_profile: 'Esquerdo',
  right_profile: 'Direito',
}

export function FaceDiagramEditor({
  points,
  onChange,
  previousPoints,
  showComparison,
  readOnly = false,
  gender,
  products,
}: FaceDiagramEditorProps) {
  const comparePoints = showComparison ?? !!previousPoints
  const [activeView, setActiveView] = React.useState<DiagramViewType>('front')
  const [showPrevious, setShowPrevious] = React.useState(false)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingPoint, setEditingPoint] = React.useState<
    (Partial<DiagramPointData> & { x: number; y: number }) | null
  >(null)
  const [armedProductId, setArmedProductId] = React.useState<string | null>(null)

  const armedProduct = React.useMemo(
    () => products?.find((p) => p.id === armedProductId && p.isActive) ?? null,
    [products, armedProductId],
  )

  function handleFaceClick(e: React.MouseEvent<HTMLDivElement>) {
    if (readOnly) return
    if (!products || products.length === 0) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    const clampedX = Math.max(0, Math.min(100, x))
    const clampedY = Math.max(0, Math.min(100, y))

    const basePoint: Partial<DiagramPointData> & { x: number; y: number } = {
      x: Math.round(clampedX * 100) / 100,
      y: Math.round(clampedY * 100) / 100,
      viewType: activeView,
    }

    // If a product is armed, pre-fill identity fields so the modal opens
    // straight to a focused quantity input.
    if (armedProduct) {
      basePoint.productName = armedProduct.name
      basePoint.activeIngredient = armedProduct.activeIngredient ?? undefined
      // Defensive: only pre-fill the unit if it's one of the valid enum values.
      // Catalog products may have other strings in defaultUnit that would
      // corrupt the pre-fill otherwise.
      if (armedProduct.defaultUnit === 'U' || armedProduct.defaultUnit === 'mL') {
        basePoint.quantityUnit = armedProduct.defaultUnit
      }
    }

    setEditingPoint(basePoint)
    setModalOpen(true)
  }

  function handlePointClick(point: DiagramPointData) {
    if (readOnly) return
    setEditingPoint(point)
    setModalOpen(true)
  }

  function handleSavePoint(savedPoint: DiagramPointData) {
    const existingIndex = points.findIndex((p) => p.id === savedPoint.id)
    if (existingIndex >= 0) {
      const updated = [...points]
      updated[existingIndex] = savedPoint
      onChange(updated)
    } else {
      onChange([...points, savedPoint])
    }
  }

  function handleDeletePoint() {
    if (!editingPoint?.id) return
    onChange(points.filter((p) => p.id !== editingPoint.id))
  }

  // Count points per view
  const pointCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const vt of VIEW_TYPES) {
      counts[vt] = points.filter((p) => (p.viewType || 'front') === vt).length
    }
    return counts
  }, [points])

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-0" data-testid="face-diagram-editor">
        {/* ─── View switcher + controls ──────────────────────── */}
        <div className="flex items-center justify-between mb-3">
          {/* Pill view tabs */}
          <div className="inline-flex rounded-lg bg-[#F4F6F8] p-0.5">
            {VIEW_TYPES.map((vt) => (
              <button
                key={vt}
                type="button"
                data-testid={`face-diagram-view-${vt}`}
                onClick={() => setActiveView(vt)}
                className={cn(
                  'relative px-3.5 py-1.5 text-[12px] font-medium rounded-md transition-all duration-200',
                  activeView === vt
                    ? 'bg-white text-charcoal shadow-sm'
                    : 'text-mid hover:text-charcoal'
                )}
              >
                {VIEW_SHORT[vt]}
                {pointCounts[vt] > 0 && (
                  <span className={cn(
                    'ml-1.5 inline-flex items-center justify-center size-4 rounded-full text-[9px] font-bold',
                    activeView === vt
                      ? 'bg-forest text-cream'
                      : 'bg-mid/15 text-mid'
                  )}>
                    {pointCounts[vt]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Previous toggle */}
          {previousPoints && previousPoints.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Switch
                checked={showPrevious}
                onCheckedChange={setShowPrevious}
                id="show-previous"
                size="sm"
              />
              <Label
                htmlFor="show-previous"
                className="cursor-pointer text-[11px] text-mid"
              >
                Anterior
              </Label>
            </div>
          )}
        </div>

        {/* ─── Canvas + summary ──────────────────────────────── */}
        <div className="flex flex-col gap-4 md:flex-row">
          {/* Face canvas */}
          <div className="flex-1">
            <div className="overflow-hidden rounded-lg border border-[#E8ECEF] bg-white">
              {/* ─── Armed product header ────────────────────────── */}
              {!readOnly && (
                <div className="border-b border-[#E8ECEF] px-2 py-1.5">
                  <ArmedProductStrip
                    products={products ?? []}
                    armedProductId={armedProductId}
                    onArmedProductIdChange={setArmedProductId}
                    className=""
                    hideHint
                  />
                </div>
              )}
              <div
                className={cn(
                  'relative aspect-[4/5] w-full',
                  readOnly ? 'cursor-default' : 'cursor-crosshair',
                )}
                onClick={handleFaceClick}
                data-testid="face-diagram-canvas"
              >
                <FaceTemplate viewType={activeView} gender={gender} />

                {/* Ghost points */}
              {showPrevious &&
                previousPoints
                  ?.filter((p) => (p.viewType || 'front') === activeView)
                  .map((point) => (
                    <DiagramPoint
                      key={`ghost-${point.id}`}
                      point={point}
                      ghost
                    />
                  ))}

              {/* Current points */}
              {points
                .filter((p) => (p.viewType || 'front') === activeView)
                .map((point) => (
                  <DiagramPoint
                    key={point.id}
                    point={point}
                    onClick={() => handlePointClick(point)}
                    readOnly={readOnly}
                    changed={
                      comparePoints &&
                      !!previousPoints?.find(
                        (pp) =>
                          Math.abs(pp.x - point.x) < 1 &&
                          Math.abs(pp.y - point.y) < 1 &&
                          pp.productName === point.productName &&
                          pp.quantity !== point.quantity
                      )
                    }
                  />
                ))}

                {/* Empty state helper */}
                {points.filter((p) => (p.viewType || 'front') === activeView).length === 0 && !readOnly && (
                  <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-5">
                    <span className="rounded-full bg-charcoal/70 px-3.5 py-1.5 text-[11px] text-white/90 backdrop-blur-sm shadow-lg">
                      {(!products || products.length === 0)
                        ? 'Configure produtos para usar o diagrama'
                        : armedProduct
                          ? 'Clique para adicionar ponto'
                          : 'Selecione um produto acima para marcar pontos'
                      }
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Summary panel */}
          {!readOnly && (
            <div className="w-full md:w-56 lg:w-64 shrink-0">
              <div className="rounded-lg border border-[#E8ECEF] bg-white p-3.5">
                <DiagramSummary points={points} previousPoints={comparePoints ? previousPoints : undefined} />
              </div>
            </div>
          )}
        </div>

        {/* Read-only summary below diagram */}
        {readOnly && points.length > 0 && (
          <div className="mt-3 rounded-lg border border-[#E8ECEF] bg-white p-3.5">
            <DiagramSummary points={points} previousPoints={comparePoints ? previousPoints : undefined} />
          </div>
        )}

        {/* Point form modal */}
        {editingPoint && (
          <PointFormModal
            open={modalOpen}
            onOpenChange={setModalOpen}
            point={editingPoint}
            onSave={handleSavePoint}
            onDelete={editingPoint.id ? handleDeletePoint : undefined}
            products={products}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

export type { DiagramPointData, FaceDiagramEditorProps }
