'use client'

import * as React from 'react'
import { useMemo } from 'react'
import { Controller, type UseFormReturn } from 'react-hook-form'
import { ChevronDown, Eye, ArrowRightLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type {
  DiagramPointData,
  CatalogProduct,
} from '@/components/face-diagram/types'
import { FormFieldError } from '@/components/forms/form-field-error'
import type {
  ProcedureExecutionFormData,
  ProductApplicationItem,
} from '@/validations/procedure'
import type { QuantityUnit } from '@/types'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'

// ─── Shared planned-snapshot types ──────────────────────────────────

export interface PlannedSnapshotPoint {
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

export interface PlannedSnapshotDiagram {
  id: string
  viewType: string
  points: PlannedSnapshotPoint[]
}

// ─── Collapsible Section (generic) ─────────────────────────────────

export function Section({
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
                open && 'rotate-180',
              )}
            />
          </div>
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  )
}

// ─── Plan Comparison ────────────────────────────────────────────────

export function PlanComparison({
  plannedSnapshot,
  currentPoints,
}: {
  plannedSnapshot: PlannedSnapshotDiagram[]
  currentPoints: DiagramPointData[]
}) {
  const plannedTotals = useMemo(() => {
    const totals = new Map<string, { quantity: number; unit: string }>()
    for (const diagram of plannedSnapshot) {
      for (const point of diagram.points) {
        const key = `${point.productName}|${point.quantityUnit}`
        const existing = totals.get(key)
        const qty =
          typeof point.quantity === 'string'
            ? parseFloat(point.quantity)
            : point.quantity
        if (existing) {
          existing.quantity += qty
        } else {
          totals.set(key, { quantity: qty, unit: String(point.quantityUnit) })
        }
      }
    }
    return totals
  }, [plannedSnapshot])

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
              : 'border-[#E8ECEF] bg-white',
          )}
        >
          <span className="text-sm font-medium text-charcoal">
            {d.productName}
          </span>
          <div className="flex items-center gap-2 text-sm">
            {d.changed ? (
              <>
                <span className="text-mid line-through">
                  {d.plannedQty}
                  {d.unit}
                </span>
                <ArrowRightLeft className="size-3.5 text-amber" />
                <span className="font-medium text-charcoal">
                  {d.currentQty}
                  {d.unit}
                </span>
              </>
            ) : (
              <span className="text-mid">
                {d.currentQty}
                {d.unit}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Initial-value builders ─────────────────────────────────────────

export function buildInitialDiagramPoints(
  diagrams: DiagramWithPoints[] | undefined,
): DiagramPointData[] {
  if (!diagrams || diagrams.length === 0) return []
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

export function buildInitialProductApps(
  existing: ProductApplicationRecord[] | undefined,
): ProductApplicationItem[] {
  if (!existing || existing.length === 0) return []
  return existing.map((a) => ({
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

// ─── Diagram Section (Controller + overlay + comparison) ──────────

interface DiagramSectionProps {
  form: UseFormReturn<ProcedureExecutionFormData>
  plannedPoints: DiagramPointData[]
  plannedSnapshot: PlannedSnapshotDiagram[] | null
  showPlannedOverlay: boolean
  onToggleOverlay: (checked: boolean) => void
  catalogProducts: CatalogProduct[]
  patientGender?: string | null
  isReadOnly: boolean
  currentPoints: DiagramPointData[]
}

export function DiagramSection({
  form,
  plannedPoints,
  plannedSnapshot,
  showPlannedOverlay,
  onToggleOverlay,
  catalogProducts,
  patientGender,
  isReadOnly,
  currentPoints,
}: DiagramSectionProps) {
  return (
    <div className="space-y-3">
      {plannedPoints.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8]/50 px-4 py-2.5">
            <Switch
              checked={showPlannedOverlay}
              onCheckedChange={onToggleOverlay}
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
          {showPlannedOverlay &&
            plannedSnapshot &&
            Array.isArray(plannedSnapshot) && (
              <PlanComparison
                plannedSnapshot={plannedSnapshot}
                currentPoints={currentPoints}
              />
            )}
        </div>
      )}

      <Controller
        control={form.control}
        name="diagramPoints"
        render={({ field }) => (
          <FaceDiagramEditor
            points={(field.value ?? []) as DiagramPointData[]}
            onChange={(pts) => field.onChange(pts as never)}
            previousPoints={showPlannedOverlay ? plannedPoints : undefined}
            readOnly={isReadOnly}
            gender={patientGender}
            products={catalogProducts}
          />
        )}
      />
      <FormFieldError form={form} name="diagramPoints" />
    </div>
  )
}

// ─── Clinical Notes Group ───────────────────────────────────────────

interface NotesProps {
  form: UseFormReturn<ProcedureExecutionFormData>
  disabled?: boolean
}

export function ExecutionClinicalNotesGroup({ form, disabled }: NotesProps) {
  return (
    <div className="space-y-5">
      <div>
        <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
          Técnica utilizada
        </Label>
        <Textarea
          {...form.register('technique')}
          placeholder="Descreva a técnica utilizada..."
          disabled={disabled}
          className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
          rows={3}
        />
        <FormFieldError form={form} name="technique" />
      </div>

      <div className="border-t border-petal pt-5">
        <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
          Resposta clínica
        </Label>
        <Textarea
          {...form.register('clinicalResponse')}
          placeholder="Descreva a resposta clínica observada..."
          disabled={disabled}
          className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
          rows={3}
        />
        <FormFieldError form={form} name="clinicalResponse" />
      </div>

      <div className="border-t border-petal pt-5">
        <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
          Efeitos adversos
        </Label>
        <Textarea
          {...form.register('adverseEffects')}
          placeholder="Registre quaisquer efeitos adversos observados..."
          disabled={disabled}
          className="mt-1.5 min-h-[60px] resize-none border-sage/20 focus:border-sage/40"
          rows={2}
        />
        <FormFieldError form={form} name="adverseEffects" />
      </div>

      <div className="border-t border-petal pt-5">
        <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
          Observações gerais
        </Label>
        <Textarea
          {...form.register('notes')}
          placeholder="Observações adicionais sobre o procedimento..."
          disabled={disabled}
          className="mt-1.5 min-h-[60px] resize-none border-sage/20 focus:border-sage/40"
          rows={2}
        />
        <FormFieldError form={form} name="notes" />
      </div>
    </div>
  )
}

// ─── Follow-up Group ────────────────────────────────────────────────

export function ExecutionFollowUpGroup({ form, disabled }: NotesProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
          Data de retorno
        </Label>
        <Controller
          control={form.control}
          name="followUpDate"
          render={({ field }) => (
            <DatePicker
              value={field.value ?? ''}
              onChange={(v) => field.onChange(v)}
              disabled={disabled}
              className="mt-1 max-w-xs"
            />
          )}
        />
        <FormFieldError form={form} name="followUpDate" />
      </div>

      <div className="border-t border-petal pt-5">
        <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
          Objetivos para próxima sessão
        </Label>
        <Textarea
          {...form.register('nextSessionObjectives')}
          placeholder="Descreva os objetivos para a próxima sessão..."
          disabled={disabled}
          className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
          rows={3}
        />
        <FormFieldError form={form} name="nextSessionObjectives" />
      </div>
    </div>
  )
}

// ─── Read-only Follow-up Display ────────────────────────────────────

interface ReadOnlyFollowUpProps {
  followUpDate?: string | null
  nextSessionObjectives?: string | null
  formatDate: (iso: string) => string
}

export function ExecutionReadOnlyFollowUp({
  followUpDate,
  nextSessionObjectives,
  formatDate,
}: ReadOnlyFollowUpProps) {
  return (
    <div className="space-y-4">
      {followUpDate && (
        <div>
          <Label className="uppercase tracking-wider text-xs text-mid mb-1 block">
            Data de retorno
          </Label>
          <p className="text-sm text-charcoal">{formatDate(followUpDate)}</p>
        </div>
      )}
      {nextSessionObjectives && (
        <div className="border-t border-petal pt-4">
          <Label className="uppercase tracking-wider text-xs text-mid mb-1 block">
            Objetivos para próxima sessão
          </Label>
          <p className="text-sm text-charcoal whitespace-pre-wrap">
            {nextSessionObjectives}
          </p>
        </div>
      )}
    </div>
  )
}
