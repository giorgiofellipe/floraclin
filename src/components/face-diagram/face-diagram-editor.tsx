'use client'

import * as React from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { DiagramViewType } from '@/types'
import { FaceTemplate, VIEW_LABELS } from './face-template'
import { DiagramPoint } from './diagram-point'
import { DiagramSummary } from './diagram-summary'
import { PointFormModal } from './point-form-modal'
import type { DiagramPointData, FaceDiagramEditorProps } from './types'

const VIEW_TYPES: DiagramViewType[] = ['front', 'left_profile', 'right_profile']

export function FaceDiagramEditor({
  points,
  onChange,
  previousPoints,
  readOnly = false,
  gender,
  products,
}: FaceDiagramEditorProps) {
  const [activeView, setActiveView] = React.useState<DiagramViewType>('front')
  const [showPrevious, setShowPrevious] = React.useState(false)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingPoint, setEditingPoint] = React.useState<
    (Partial<DiagramPointData> & { x: number; y: number }) | null
  >(null)

  // Derive existing product names for autocomplete
  // Point count for display
  const _pointCount = React.useMemo(() => {
    return points.length
  }, [points, previousPoints])

  function handleFaceClick(e: React.MouseEvent<HTMLDivElement>) {
    if (readOnly) return
    if (!products || products.length === 0) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    // Clamp to 0-100
    const clampedX = Math.max(0, Math.min(100, x))
    const clampedY = Math.max(0, Math.min(100, y))

    setEditingPoint({
      x: Math.round(clampedX * 100) / 100,
      y: Math.round(clampedY * 100) / 100,
      viewType: activeView,
    })
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
      // Edit existing
      const updated = [...points]
      updated[existingIndex] = savedPoint
      onChange(updated)
    } else {
      // Add new
      onChange([...points, savedPoint])
    }
  }

  function handleDeletePoint() {
    if (!editingPoint?.id) return
    onChange(points.filter((p) => p.id !== editingPoint.id))
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3" data-testid="face-diagram-editor">
        <Tabs
          value={activeView}
          onValueChange={(v) => setActiveView(v as DiagramViewType)}
        >
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              {VIEW_TYPES.map((vt) => (
                <TabsTrigger key={vt} value={vt} data-testid={`face-diagram-view-${vt}`}>
                  {VIEW_LABELS[vt]}
                </TabsTrigger>
              ))}
            </TabsList>

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
                  className="cursor-pointer text-xs text-muted-foreground"
                >
                  Mostrar anterior
                </Label>
              </div>
            )}
          </div>

          {VIEW_TYPES.map((vt) => (
            <TabsContent key={vt} value={vt}>
              <div className="flex flex-col gap-3 md:flex-row">
                {/* Face diagram area */}
                <div className="flex-1">
                  <div
                    className={`relative aspect-[4/5] w-full overflow-hidden rounded-lg border bg-white ${
                      readOnly
                        ? 'cursor-default'
                        : 'cursor-crosshair'
                    }`}
                    onClick={handleFaceClick}
                    data-testid="face-diagram-canvas"
                  >
                    <FaceTemplate viewType={vt} gender={gender} />

                    {/* Ghost overlay from previous session — filtered by view */}
                    {showPrevious &&
                      previousPoints
                        ?.filter((p) => (p.viewType || 'front') === vt)
                        .map((point) => (
                          <DiagramPoint
                            key={`ghost-${point.id}`}
                            point={point}
                            ghost
                          />
                        ))}

                    {/* Current points — filtered by view */}
                    {points
                      .filter((p) => (p.viewType || 'front') === vt)
                      .map((point) => (
                      <DiagramPoint
                        key={point.id}
                        point={point}
                        onClick={() => handlePointClick(point)}
                        readOnly={readOnly}
                        changed={
                          !!previousPoints &&
                          !!previousPoints.find(
                            (pp) =>
                              Math.abs(pp.x - point.x) < 1 &&
                              Math.abs(pp.y - point.y) < 1 &&
                              pp.productName === point.productName &&
                              pp.quantity !== point.quantity
                          )
                        }
                      />
                    ))}

                    {/* Helper text when empty */}
                    {points.length === 0 && !readOnly && (
                      <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-4">
                        <span className="rounded-md bg-muted/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
                          {(!products || products.length === 0)
                            ? 'Configure produtos em Configurações → Produtos para usar o diagrama'
                            : 'Clique no rosto para adicionar um ponto'
                          }
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary panel */}
                <div className="w-full md:w-56 lg:w-64">
                  <div className="rounded-lg border p-3">
                    <DiagramSummary points={points} previousPoints={previousPoints} />
                  </div>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>

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
