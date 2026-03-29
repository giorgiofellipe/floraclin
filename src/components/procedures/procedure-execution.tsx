'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Save,
  Loader2,
  ChevronDown,
  Package,
  FileText,
  Camera,
  Stethoscope,
  CalendarPlus,
  PlusIcon,
  Trash2Icon,
  Eye,
  ArrowLeft,
  ArrowRightLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type { DiagramPointData, CatalogProduct } from '@/components/face-diagram/types'
import { PhotoUploader } from '@/components/photos/photo-uploader'
import { PhotoGrid } from '@/components/photos/photo-grid'
import {
  executeProcedureAction,
  getPreviousDiagramPointsAction,
} from '@/actions/procedures'
import { listDiagramProductsAction } from '@/actions/products-catalog'
import type { DiagramViewType, QuantityUnit } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { ProductApplicationItem } from '@/validations/procedure'

// ─── Types ──────────────────────────────────────────────────────────

interface PlannedSnapshotPoint {
  id: string
  x: string | number
  y: string | number
  productName: string
  activeIngredient?: string | null
  quantity: string | number
  quantityUnit: string
  technique?: string | null
  depth?: string | null
  notes?: string | null
}

interface PlannedSnapshotDiagram {
  id: string
  viewType: string
  points: PlannedSnapshotPoint[]
}

interface ProcedureExecutionProps {
  patientId: string
  patientGender?: string | null
  procedure: ProcedureWithDetails
  diagrams?: DiagramWithPoints[]
  existingApplications?: ProductApplicationRecord[]
}

// ─── Collapsible Section ───────────────────────────────────────────

function Section({
  title,
  icon,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string
  icon: React.ReactNode
  open: boolean
  onToggle: () => void
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="bg-white overflow-hidden border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
      <CardHeader
        className="cursor-pointer pb-3 hover:bg-[#F4F6F8] transition-colors duration-150"
        onClick={onToggle}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
              {icon}
            </div>
            <span className="uppercase tracking-wider text-sm text-charcoal font-medium">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {badge}
            <ChevronDown
              className={cn(
                'size-4 text-mid transition-transform duration-200',
                open && 'rotate-180'
              )}
            />
          </div>
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  )
}

// ─── Plan Comparison Component ──────────────────────────────────────

function PlanComparison({
  plannedSnapshot,
  currentPoints,
}: {
  plannedSnapshot: PlannedSnapshotDiagram[]
  currentPoints: DiagramPointData[]
}) {
  // Aggregate planned quantities by product
  const plannedTotals = useMemo(() => {
    const totals = new Map<string, { quantity: number; unit: string }>()
    for (const diagram of plannedSnapshot) {
      for (const point of diagram.points) {
        const key = `${point.productName}|${point.quantityUnit}`
        const existing = totals.get(key)
        const qty = typeof point.quantity === 'string' ? parseFloat(point.quantity) : point.quantity
        if (existing) {
          existing.quantity += qty
        } else {
          totals.set(key, { quantity: qty, unit: String(point.quantityUnit) })
        }
      }
    }
    return totals
  }, [plannedSnapshot])

  // Aggregate current quantities by product
  const currentTotals = useMemo(() => {
    const totals = new Map<string, { quantity: number; unit: string }>()
    for (const point of currentPoints) {
      const key = `${point.productName}|${point.quantityUnit}`
      const existing = totals.get(key)
      if (existing) {
        existing.quantity += point.quantity
      } else {
        totals.set(key, { quantity: point.quantity, unit: point.quantityUnit })
      }
    }
    return totals
  }, [currentPoints])

  // Collect all product keys
  const allKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const k of plannedTotals.keys()) keys.add(k)
    for (const k of currentTotals.keys()) keys.add(k)
    return Array.from(keys)
  }, [plannedTotals, currentTotals])

  const diffs = allKeys.map((key) => {
    const [productName] = key.split('|')
    const planned = plannedTotals.get(key)
    const current = currentTotals.get(key)
    const unit = planned?.unit ?? current?.unit ?? ''
    const plannedQty = planned?.quantity ?? 0
    const currentQty = current?.quantity ?? 0
    const changed = plannedQty !== currentQty

    return { productName, unit, plannedQty, currentQty, changed }
  })

  const hasAnyChange = diffs.some((d) => d.changed)

  if (!hasAnyChange) {
    return (
      <div className="rounded-[3px] border border-sage/20 bg-[#F0F7F1] px-4 py-3">
        <p className="text-sm text-sage">
          Quantidades executadas iguais ao planejado.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {diffs.map((d) => (
        <div
          key={`${d.productName}-${d.unit}`}
          className={cn(
            'flex items-center justify-between rounded-[3px] border px-4 py-2.5',
            d.changed
              ? 'border-amber/30 bg-[#FFF4EF]'
              : 'border-[#E8ECEF] bg-white'
          )}
        >
          <span className="text-sm font-medium text-charcoal">
            {d.productName}
          </span>
          <div className="flex items-center gap-2 text-sm">
            {d.changed ? (
              <>
                <span className="text-mid line-through">
                  {d.plannedQty}{d.unit}
                </span>
                <ArrowRightLeft className="size-3.5 text-amber" />
                <span className="font-medium text-charcoal">
                  {d.currentQty}{d.unit}
                </span>
              </>
            ) : (
              <span className="text-mid">
                {d.currentQty}{d.unit}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────

export function ProcedureExecution({
  patientId,
  patientGender,
  procedure,
  diagrams,
  existingApplications,
}: ProcedureExecutionProps) {
  const router = useRouter()
  const isExecuted = procedure.status === 'executed'
  const isReadOnly = isExecuted

  // ─── Diagram state ────────────────────────────────────────────────
  const [diagramPoints, setDiagramPoints] = useState<DiagramPointData[]>(() => {
    if (diagrams && diagrams.length > 0) {
      const allPoints: DiagramPointData[] = []
      for (const diagram of diagrams) {
        for (const p of diagram.points) {
          allPoints.push({
            id: p.id,
            x: parseFloat(p.x),
            y: parseFloat(p.y),
            viewType: diagram.viewType || 'front',
            productName: p.productName,
            activeIngredient: p.activeIngredient ?? undefined,
            quantity: parseFloat(p.quantity),
            quantityUnit: p.quantityUnit as QuantityUnit,
            technique: p.technique ?? undefined,
            depth: p.depth ?? undefined,
            notes: p.notes ?? undefined,
          })
        }
      }
      return allPoints
    }
    return []
  })

  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([])
  const [showPlannedOverlay, setShowPlannedOverlay] = useState(false)

  // ─── Planned snapshot for ghost overlay ────────────────────────────
  const plannedSnapshot = procedure.plannedSnapshot as PlannedSnapshotDiagram[] | null

  const plannedPoints = useMemo<DiagramPointData[]>(() => {
    if (!plannedSnapshot || !Array.isArray(plannedSnapshot)) return []
    const points: DiagramPointData[] = []
    for (const diagram of plannedSnapshot) {
      if (diagram.points) {
        for (const p of diagram.points) {
          points.push({
            id: typeof p.id === 'string' ? p.id : `planned-${points.length}`,
            x: typeof p.x === 'string' ? parseFloat(p.x) : p.x,
            y: typeof p.y === 'string' ? parseFloat(p.y) : p.y,
            productName: p.productName,
            activeIngredient: p.activeIngredient ?? undefined,
            quantity: typeof p.quantity === 'string' ? parseFloat(p.quantity) : p.quantity,
            quantityUnit: (p.quantityUnit ?? 'U') as QuantityUnit,
            technique: p.technique ?? undefined,
            depth: p.depth ?? undefined,
            notes: p.notes ?? undefined,
          })
        }
      }
    }
    return points
  }, [plannedSnapshot])

  // ─── Product applications state ──────────────────────────────────
  const [productApps, setProductApps] = useState<ProductApplicationItem[]>(
    () => {
      if (existingApplications && existingApplications.length > 0) {
        return existingApplications.map((a) => ({
          productName: a.productName,
          activeIngredient: a.activeIngredient ?? undefined,
          totalQuantity: parseFloat(a.totalQuantity),
          quantityUnit: a.quantityUnit as QuantityUnit,
          batchNumber: a.batchNumber ?? undefined,
          expirationDate: a.expirationDate ?? undefined,
          labelPhotoId: a.labelPhotoId ?? undefined,
          applicationAreas: a.applicationAreas ?? undefined,
          notes: a.notes ?? undefined,
        }))
      }
      return []
    }
  )

  // ─── Clinical notes state ──────────────────────────────────────────
  const [technique, setTechnique] = useState(procedure.technique ?? '')
  const [clinicalResponse, setClinicalResponse] = useState(procedure.clinicalResponse ?? '')
  const [adverseEffects, setAdverseEffects] = useState(procedure.adverseEffects ?? '')
  const [notes, setNotes] = useState(procedure.notes ?? '')

  // ─── Follow-up state ───────────────────────────────────────────────
  const [followUpDate, setFollowUpDate] = useState(procedure.followUpDate ?? '')
  const [nextSessionObjectives, setNextSessionObjectives] = useState(
    procedure.nextSessionObjectives ?? ''
  )

  // ─── Photo state ──────────────────────────────────────────────────
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0)

  // ─── Submit state ──────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ─── Section open state ────────────────────────────────────────────
  const [openSections, setOpenSections] = useState({
    diagram: true,
    products: true,
    clinicalNotes: true,
    prePhotos: true,
    postPhotos: true,
    followUp: false,
    comparison: true,
  })

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // ─── Load catalog products ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const prods = await listDiagramProductsAction()
      setCatalogProducts(prods as CatalogProduct[])
    }
    load()
  }, [])

  // ─── Auto-populate product applications from diagram points ────────
  useEffect(() => {
    if (isReadOnly) return

    const totals = new Map<
      string,
      { totalQuantity: number; activeIngredient?: string; unit: QuantityUnit }
    >()

    for (const point of diagramPoints) {
      const key = `${point.productName}|${point.quantityUnit}`
      const existing = totals.get(key)
      if (existing) {
        existing.totalQuantity += point.quantity
      } else {
        totals.set(key, {
          totalQuantity: point.quantity,
          activeIngredient: point.activeIngredient,
          unit: point.quantityUnit,
        })
      }
    }

    setProductApps((prevApps) => {
      const newApps: ProductApplicationItem[] = []

      for (const [key, total] of totals) {
        const [productName] = key.split('|')
        // Preserve existing batch/lot entries for this product
        const existingEntries = prevApps.filter(
          (a) => a.productName === productName && a.quantityUnit === total.unit
        )

        if (existingEntries.length > 0) {
          // Update the first entry's total quantity, keep all batches
          newApps.push({
            ...existingEntries[0],
            totalQuantity: total.totalQuantity,
            activeIngredient: total.activeIngredient,
          })
          for (let i = 1; i < existingEntries.length; i++) {
            newApps.push(existingEntries[i])
          }
        } else {
          newApps.push({
            productName,
            activeIngredient: total.activeIngredient,
            totalQuantity: total.totalQuantity,
            quantityUnit: total.unit,
          })
        }
      }

      return newApps
    })
  }, [diagramPoints, isReadOnly])

  // ─── Handlers ────────────────────────────────────────────────────

  const handleProductAppChange = useCallback(
    (index: number, field: keyof ProductApplicationItem, value: string) => {
      setProductApps((prev) => {
        const updated = [...prev]
        updated[index] = { ...updated[index], [field]: value }
        return updated
      })
    },
    []
  )

  const handleAddBatch = useCallback(
    (sourceIndex: number) => {
      setProductApps((prev) => {
        const source = prev[sourceIndex]
        const newEntry: ProductApplicationItem = {
          productName: source.productName,
          activeIngredient: source.activeIngredient,
          totalQuantity: 0,
          quantityUnit: source.quantityUnit,
        }
        const updated = [...prev]
        updated.splice(sourceIndex + 1, 0, newEntry)
        return updated
      })
    },
    []
  )

  const handleRemoveBatch = useCallback(
    (index: number) => {
      setProductApps((prev) => prev.filter((_, i) => i !== index))
    },
    []
  )

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || isReadOnly) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const diagramsPayload =
        diagramPoints.length > 0
          ? [
              {
                viewType: 'front' as DiagramViewType,
                points: diagramPoints.map((p) => ({
                  x: p.x,
                  y: p.y,
                  productName: p.productName,
                  activeIngredient: p.activeIngredient,
                  quantity: p.quantity,
                  quantityUnit: p.quantityUnit,
                  technique: p.technique,
                  depth: p.depth,
                  notes: p.notes,
                })),
              },
            ]
          : undefined

      const result = await executeProcedureAction(procedure.id, {
        technique: technique || undefined,
        clinicalResponse: clinicalResponse || undefined,
        adverseEffects: adverseEffects || undefined,
        notes: notes || undefined,
        followUpDate: followUpDate || undefined,
        nextSessionObjectives: nextSessionObjectives || undefined,
        diagrams: diagramsPayload,
        productApplications:
          productApps.length > 0 ? productApps : undefined,
      })

      if (!result.success) {
        setSubmitError(result.error ?? 'Erro ao registrar execucao')
        return
      }

      // Redirect to patient's procedures tab
      router.push(`/pacientes/${patientId}?tab=procedimentos`)
    } catch {
      setSubmitError('Erro inesperado ao registrar execucao')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    isSubmitting,
    isReadOnly,
    diagramPoints,
    technique,
    clinicalResponse,
    adverseEffects,
    notes,
    followUpDate,
    nextSessionObjectives,
    productApps,
    procedure.id,
    patientId,
    router,
  ])

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push(`/pacientes/${patientId}?tab=procedimentos`)}
            className="text-mid hover:text-charcoal"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="font-display text-xl text-forest">
              {isExecuted ? 'Detalhes da Execucao' : 'Registrar Execucao'}
            </h1>
            <p className="mt-0.5 text-sm text-mid">
              {procedure.procedureTypeName}
              {procedure.approvedAt && (
                <> &mdash; Aprovado em{' '}
                  {format(new Date(procedure.approvedAt), "dd 'de' MMMM 'de' yyyy", {
                    locale: ptBR,
                  })}
                </>
              )}
            </p>
          </div>
        </div>
        <Badge
          className={cn(
            'px-3 py-1 text-xs font-medium border-0',
            isExecuted
              ? 'bg-[#F0F7F1] text-[#2A2A2A]'
              : 'bg-[#F0F7F1] text-sage'
          )}
        >
          {isExecuted ? 'Executado' : 'Aprovado'}
        </Badge>
      </div>

      {/* ── Diagram Editor ──────────────────────────────────────────── */}
      <Section
        title="Diagrama Facial"
        icon={<Stethoscope className="size-4 text-forest" />}
        open={openSections.diagram}
        onToggle={() => toggleSection('diagram')}
        badge={
          diagramPoints.length > 0 ? (
            <Badge variant="outline" className="text-xs border-sage/30 bg-sage/5 text-sage px-2.5 py-0.5">
              {diagramPoints.length}{' '}
              {diagramPoints.length === 1 ? 'ponto' : 'pontos'}
            </Badge>
          ) : undefined
        }
      >
        <div className="space-y-3">
          {/* Planned overlay toggle + inline comparison */}
          {plannedPoints.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8]/50 px-4 py-2.5">
                <Switch
                  checked={showPlannedOverlay}
                  onCheckedChange={setShowPlannedOverlay}
                  id="show-planned"
                  size="sm"
                />
                <Label
                  htmlFor="show-planned"
                  className="cursor-pointer text-sm text-mid"
                >
                  <Eye className="mr-1.5 inline-block size-3.5" />
                  Ver planejamento original
                </Label>
              </div>
              {showPlannedOverlay && plannedSnapshot && Array.isArray(plannedSnapshot) && (
                <PlanComparison
                  plannedSnapshot={plannedSnapshot}
                  currentPoints={diagramPoints}
                />
              )}
            </div>
          )}

          <FaceDiagramEditor
            points={diagramPoints}
            onChange={setDiagramPoints}
            previousPoints={showPlannedOverlay ? plannedPoints : undefined}
            readOnly={isReadOnly}
            gender={patientGender}
            products={catalogProducts}
          />
        </div>
      </Section>

      {/* ── Product Details (Batch/Lot Numbers) ─────────────────────── */}
      {productApps.length > 0 && (
        <Section
          title="Detalhes dos Produtos"
          icon={<Package className="size-4 text-forest" />}
          open={openSections.products}
          onToggle={() => toggleSection('products')}
          badge={
            <Badge variant="outline" className="text-xs">
              {productApps.length}{' '}
              {productApps.length === 1 ? 'item' : 'itens'}
            </Badge>
          }
        >
          <div className="space-y-4">
            {productApps.map((app, index) => {
              const isFirstForProduct =
                index === 0 ||
                productApps[index - 1].productName !== app.productName
              const isLastForProduct =
                index === productApps.length - 1 ||
                productApps[index + 1]?.productName !== app.productName
              const entriesForProduct = productApps.filter(
                (a) => a.productName === app.productName
              ).length
              const canRemove = entriesForProduct > 1

              return (
                <div key={`${app.productName}-${app.quantityUnit}-${index}`}>
                  {isFirstForProduct && (
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="font-medium text-charcoal">
                        {app.productName}
                      </h4>
                      <Badge
                        variant="outline"
                        className="text-xs border-sage/30 bg-sage/5 text-sage px-2.5 py-0.5"
                      >
                        {app.totalQuantity}
                        {app.quantityUnit}
                      </Badge>
                    </div>
                  )}

                  <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-5">
                    {entriesForProduct > 1 && (
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs text-mid uppercase tracking-wider">
                          Lote{' '}
                          {
                            productApps
                              .slice(0, index + 1)
                              .filter((a) => a.productName === app.productName)
                              .length
                          }
                        </span>
                        {canRemove && !isReadOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemoveBatch(index)}
                          >
                            <Trash2Icon className="size-3.5 text-mid" />
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="uppercase tracking-wider text-xs text-mid">
                          Lote / Batch
                        </Label>
                        <Input
                          value={app.batchNumber ?? ''}
                          onChange={(e) =>
                            handleProductAppChange(
                              index,
                              'batchNumber',
                              e.target.value
                            )
                          }
                          placeholder="Ex: ABC12345"
                          disabled={isReadOnly}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="uppercase tracking-wider text-xs text-mid">
                          Validade
                        </Label>
                        <Input
                          type="date"
                          value={app.expirationDate ?? ''}
                          onChange={(e) =>
                            handleProductAppChange(
                              index,
                              'expirationDate',
                              e.target.value
                            )
                          }
                          disabled={isReadOnly}
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <Label className="uppercase tracking-wider text-xs text-mid">
                        Areas de aplicacao
                      </Label>
                      <Input
                        value={app.applicationAreas ?? ''}
                        onChange={(e) =>
                          handleProductAppChange(
                            index,
                            'applicationAreas',
                            e.target.value
                          )
                        }
                        placeholder="Ex: Frontal, Glabela, Periorbital"
                        disabled={isReadOnly}
                        className="mt-1"
                      />
                    </div>
                  </div>

                  {isLastForProduct && !isReadOnly && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAddBatch(index)}
                        className="text-xs border-sage/30 text-sage hover:bg-sage/5"
                      >
                        <PlusIcon className="size-3.5 mr-1" />
                        Adicionar lote
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* ── Clinical Notes ───────────────────────────────────────────── */}
      <Section
        title="Notas Clinicas"
        icon={<FileText className="size-4 text-forest" />}
        open={openSections.clinicalNotes}
        onToggle={() => toggleSection('clinicalNotes')}
      >
        <div className="space-y-5">
          <div>
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Tecnica utilizada
            </Label>
            <Textarea
              value={technique}
              onChange={(e) => setTechnique(e.target.value)}
              placeholder="Descreva a tecnica utilizada..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
              rows={3}
            />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Resposta clinica
            </Label>
            <Textarea
              value={clinicalResponse}
              onChange={(e) => setClinicalResponse(e.target.value)}
              placeholder="Descreva a resposta clinica observada..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
              rows={3}
            />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Efeitos adversos
            </Label>
            <Textarea
              value={adverseEffects}
              onChange={(e) => setAdverseEffects(e.target.value)}
              placeholder="Registre quaisquer efeitos adversos observados..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[60px] resize-none border-sage/20 focus:border-sage/40"
              rows={2}
            />
          </div>

          <div className="border-t border-petal pt-5">
            <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
              Observacoes gerais
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observacoes adicionais sobre o procedimento..."
              disabled={isReadOnly}
              className="mt-1.5 min-h-[60px] resize-none border-sage/20 focus:border-sage/40"
              rows={2}
            />
          </div>
        </div>
      </Section>

      {/* ── Pre-Procedure Photos ────────────────────────────────────── */}
      <Section
        title="Fotos Pre-Procedimento"
        icon={<Camera className="size-4 text-forest" />}
        open={openSections.prePhotos}
        onToggle={() => toggleSection('prePhotos')}
      >
        <div className="space-y-4">
          {!isReadOnly && (
            <PhotoUploader
              patientId={patientId}
              procedureRecordId={procedure.id}
              defaultStage="pre"
              onUploadComplete={() =>
                setPhotoRefreshKey((k) => k + 1)
              }
            />
          )}
          <PhotoGrid
            patientId={patientId}
            procedureRecordId={procedure.id}
            refreshKey={photoRefreshKey}
            timelineStage="pre"
          />
        </div>
      </Section>

      {/* ── Post-Procedure Photos ───────────────────────────────────── */}
      <Section
        title="Fotos Pos-Procedimento"
        icon={<Camera className="size-4 text-forest" />}
        open={openSections.postPhotos}
        onToggle={() => toggleSection('postPhotos')}
      >
        <div className="space-y-4">
          {!isReadOnly && (
            <PhotoUploader
              patientId={patientId}
              procedureRecordId={procedure.id}
              defaultStage="immediate_post"
              onUploadComplete={() =>
                setPhotoRefreshKey((k) => k + 1)
              }
            />
          )}
          <PhotoGrid
            patientId={patientId}
            procedureRecordId={procedure.id}
            refreshKey={photoRefreshKey}
            timelineStage="immediate_post"
          />
        </div>
      </Section>

      {/* ── Follow-up (optional) ──────────────────────────────────────── */}
      {!isReadOnly && (
        <Section
          title="Retorno e Proxima Sessao"
          icon={<CalendarPlus className="size-4 text-forest" />}
          open={openSections.followUp}
          onToggle={() => toggleSection('followUp')}
        >
          <div className="space-y-4">
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Data de retorno
              </Label>
              <Input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="mt-1 max-w-xs"
              />
            </div>

            <div className="border-t border-petal pt-5">
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Objetivos para proxima sessao
              </Label>
              <Textarea
                value={nextSessionObjectives}
                onChange={(e) => setNextSessionObjectives(e.target.value)}
                placeholder="Descreva os objetivos para a proxima sessao..."
                className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
                rows={3}
              />
            </div>
          </div>
        </Section>
      )}

      {/* ── Read-only follow-up info ──────────────────────────────────── */}
      {isReadOnly && (procedure.followUpDate || procedure.nextSessionObjectives) && (
        <Section
          title="Retorno e Proxima Sessao"
          icon={<CalendarPlus className="size-4 text-forest" />}
          open={openSections.followUp}
          onToggle={() => toggleSection('followUp')}
        >
          <div className="space-y-4">
            {procedure.followUpDate && (
              <div>
                <Label className="uppercase tracking-wider text-xs text-mid mb-1 block">
                  Data de retorno
                </Label>
                <p className="text-sm text-charcoal">
                  {format(new Date(procedure.followUpDate), "dd 'de' MMMM 'de' yyyy", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            )}
            {procedure.nextSessionObjectives && (
              <div className="border-t border-petal pt-4">
                <Label className="uppercase tracking-wider text-xs text-mid mb-1 block">
                  Objetivos para proxima sessao
                </Label>
                <p className="text-sm text-charcoal whitespace-pre-wrap">
                  {procedure.nextSessionObjectives}
                </p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Submit ──────────────────────────────────────────────────── */}
      {!isReadOnly && (
        <div className="flex flex-col gap-3">
          {submitError && (
            <div className="rounded-[3px] border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{submitError}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/pacientes/${patientId}?tab=procedimentos`)
              }
              disabled={isSubmitting}
              className="border-forest text-forest hover:bg-petal"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="bg-forest text-cream hover:bg-sage shadow-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  Salvar como Executado
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
