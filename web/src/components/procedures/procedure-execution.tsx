'use client'

import * as React from 'react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Save,
  Loader2,
  Package,
  FileText,
  Camera,
  Stethoscope,
  CalendarPlus,
  ArrowLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  DiagramPointData,
  CatalogProduct,
} from '@/components/face-diagram/types'
import { useExecuteProcedure } from '@/hooks/mutations/use-procedure-mutations'
import type { DiagramViewType, QuantityUnit } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import {
  procedureExecutionFormSchema,
  type ProcedureExecutionFormData,
  type ProductApplicationItem,
} from '@/validations/procedure'
import type { WizardOverrides } from '@/components/service-wizard/types'
import { FormServerErrorBanner } from '@/components/forms/form-server-error-banner'
import { ProductApplicationsSection } from './execution/product-applications-section'
import {
  Section,
  DiagramSection,
  ExecutionClinicalNotesGroup,
  ExecutionFollowUpGroup,
  ExecutionReadOnlyFollowUp,
  buildInitialDiagramPoints,
  buildInitialProductApps,
  type PlannedSnapshotDiagram,
} from './execution/execution-details-section'
import { ExecutionPhotoSection } from './execution/execution-photo-section'

// ─── Types ──────────────────────────────────────────────────────────

interface ProcedureExecutionProps {
  patientId: string
  patientGender?: string | null
  procedure: ProcedureWithDetails
  diagrams?: DiagramWithPoints[]
  existingApplications?: ProductApplicationRecord[]
  wizardOverrides?: WizardOverrides
}

// ─── Main Component ─────────────────────────────────────────────────

export function ProcedureExecution({
  patientId,
  patientGender,
  procedure,
  diagrams,
  existingApplications,
  wizardOverrides,
}: ProcedureExecutionProps) {
  const router = useRouter()
  const executeProcedure = useExecuteProcedure()
  const isExecuted = procedure.status === 'executed'
  const isReadOnly = isExecuted

  // ─── Form ─────────────────────────────────────────────────────────
  const form = useForm<ProcedureExecutionFormData>({
    resolver: zodResolver(
      procedureExecutionFormSchema,
    ) as unknown as Resolver<ProcedureExecutionFormData>,
    defaultValues: {
      technique: procedure.technique ?? '',
      clinicalResponse: procedure.clinicalResponse ?? '',
      adverseEffects: procedure.adverseEffects ?? '',
      notes: procedure.notes ?? '',
      followUpDate: procedure.followUpDate ?? '',
      nextSessionObjectives: procedure.nextSessionObjectives ?? '',
      diagramPoints: buildInitialDiagramPoints(diagrams) as never,
      productApplications: buildInitialProductApps(existingApplications),
    },
  })

  const productsFieldArray = useFieldArray({
    control: form.control,
    name: 'productApplications',
  })

  // Watched values for render-time derivations
  const watchedDiagramPoints = form.watch('diagramPoints') as DiagramPointData[]
  const watchedProductApps = form.watch(
    'productApplications'
  ) as ProductApplicationItem[]

  // ─── Catalog products + overlay ──────────────────────────────────
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([])
  const [showPlannedOverlay, setShowPlannedOverlay] = useState(false)

  // ─── Planned snapshot for ghost overlay ──────────────────────────
  const plannedSnapshot =
    procedure.plannedSnapshot as PlannedSnapshotDiagram[] | null

  const plannedPoints = useMemo<DiagramPointData[]>(() => {
    if (!plannedSnapshot || !Array.isArray(plannedSnapshot)) return []
    const points: DiagramPointData[] = []
    for (const diagram of plannedSnapshot) {
      if (!diagram.points) continue
      for (const p of diagram.points) {
        points.push({
          id: typeof p.id === 'string' ? p.id : `planned-${points.length}`,
          x: typeof p.x === 'string' ? parseFloat(p.x) : p.x,
          y: typeof p.y === 'string' ? parseFloat(p.y) : p.y,
          productName: p.productName,
          activeIngredient: p.activeIngredient ?? undefined,
          quantity:
            typeof p.quantity === 'string'
              ? parseFloat(p.quantity)
              : p.quantity,
          quantityUnit: (p.quantityUnit ?? 'U') as QuantityUnit,
          technique: p.technique ?? undefined,
          depth: p.depth ?? undefined,
          notes: p.notes ?? undefined,
        })
      }
    }
    return points
  }, [plannedSnapshot])

  // ─── Photo state (not RHF) ────────────────────────────────────────
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0)
  const handlePhotoRefresh = () => setPhotoRefreshKey((k) => k + 1)

  // ─── Submit state ──────────────────────────────────────────────────
  const [submittingAction, setSubmittingAction] = useState(false)

  // ─── Section open state ────────────────────────────────────────────
  const [openSections, setOpenSections] = useState({
    diagram: true,
    products: true,
    clinicalNotes: true,
    prePhotos: true,
    postPhotos: true,
    followUp: false,
  })
  const toggleSection = (section: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }))

  // ─── Load catalog products ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const res = await fetch('/api/products?filter=diagram')
      if (res.ok) {
        const prods = await res.json()
        setCatalogProducts(prods as CatalogProduct[])
      }
    }
    load()
  }, [])

  // ─── Auto-populate product applications from diagram points ──────
  // IMPORTANT: uses targeted update/append/remove instead of full replace so
  // the user's in-progress edits (batch number, notes) aren't wiped and
  // focus isn't lost when they add a diagram point mid-typing.
  useEffect(() => {
    if (isReadOnly) return

    const totals = new Map<
      string,
      { totalQuantity: number; activeIngredient?: string; unit: QuantityUnit }
    >()

    for (const point of watchedDiagramPoints ?? []) {
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

    const prevApps = form.getValues('productApplications') ?? []
    const keyOf = (a: ProductApplicationItem) => `${a.productName}|${a.quantityUnit}`
    const prevByKey = new Map(prevApps.map((a, i) => [keyOf(a), { app: a, index: i }]))

    // Update totals in-place for existing rows that still have matching points
    for (const [key, total] of totals) {
      const hit = prevByKey.get(key)
      if (!hit) continue
      // Only update if totalQuantity/activeIngredient actually drifted to avoid
      // triggering RHF re-renders for unchanged rows
      if (
        hit.app.totalQuantity !== total.totalQuantity ||
        hit.app.activeIngredient !== total.activeIngredient
      ) {
        productsFieldArray.update(hit.index, {
          ...hit.app,
          totalQuantity: total.totalQuantity,
          activeIngredient: total.activeIngredient,
        })
      }
    }

    // Append rows for new product+unit combinations
    for (const [key, total] of totals) {
      if (prevByKey.has(key)) continue
      const [productName] = key.split('|')
      productsFieldArray.append({
        productName,
        activeIngredient: total.activeIngredient,
        totalQuantity: total.totalQuantity,
        quantityUnit: total.unit,
      })
    }

    // Remove rows whose product+unit no longer appears in any diagram point,
    // EXCEPT rows that have user-entered identity fields (batchNumber / notes)
    // which we treat as user-owned and preserve.
    const keysToRemove: number[] = []
    prevApps.forEach((app, i) => {
      const key = keyOf(app)
      if (totals.has(key)) return
      const userOwned = !!(app.batchNumber || app.notes || app.labelPhotoId)
      if (!userOwned) keysToRemove.push(i)
    })
    // Remove in reverse order so indices stay valid
    for (let i = keysToRemove.length - 1; i >= 0; i--) {
      productsFieldArray.remove(keysToRemove[i])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedDiagramPoints, isReadOnly])

  // ─── Submit handler ───────────────────────────────────────────────
  async function onValid(values: ProcedureExecutionFormData) {
    if (isReadOnly) {
      wizardOverrides?.onSaveComplete?.({
        success: false,
        error: 'Formulário indisponível',
        errorType: 'precondition',
      })
      return
    }
    setSubmittingAction(true)
    // Clear any stale server error from a prior failed save attempt
    form.clearErrors('root.serverError' as never)
    try {
      // Use RAW form state for diagram points so id/viewType survive.
      const rawDiagramPoints = (form.getValues('diagramPoints') ??
        []) as DiagramPointData[]
      const diagramsPayload =
        rawDiagramPoints.length > 0
          ? [
              {
                viewType: 'front' as DiagramViewType,
                points: rawDiagramPoints.map((p) => ({
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

      await executeProcedure.mutateAsync({
        id: procedure.id,
        technique: values.technique || undefined,
        clinicalResponse: values.clinicalResponse || undefined,
        adverseEffects: values.adverseEffects || undefined,
        notes: values.notes || undefined,
        followUpDate: values.followUpDate || undefined,
        nextSessionObjectives: values.nextSessionObjectives || undefined,
        diagrams: diagramsPayload,
        productApplications:
          values.productApplications.length > 0
            ? values.productApplications
            : undefined,
      })

      form.reset(form.getValues())
      wizardOverrides?.onSaveComplete?.({
        success: true,
        procedureId: procedure.id,
      })

      if (!wizardOverrides?.hideNavigation) {
        router.push(`/pacientes/${patientId}?tab=procedimentos`)
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao registrar execução'
      form.setError('root.serverError' as never, { type: 'manual', message })
      wizardOverrides?.onSaveComplete?.({
        success: false,
        error: message,
        errorType: 'server',
      })
    } finally {
      setSubmittingAction(false)
    }
  }

  const pendingValidationRef = useRef(false)

  function onInvalid() {
    pendingValidationRef.current = true
    wizardOverrides?.onSaveComplete?.({
      success: false,
      error: 'Validation failed',
      errorType: 'validation',
    })
  }

  // ─── Wizard triggerSave wire-up ───────────────────────────────────
  const prevTriggerSaveRef = useRef(wizardOverrides?.triggerSave ?? 0)
  useEffect(() => {
    const current = wizardOverrides?.triggerSave ?? 0
    // Reset on 0 so the next non-zero value re-fires (the wizard resets
    // triggerSave after every SAVE_COMPLETE, so "1" comes around again).
    if (current === 0) {
      prevTriggerSaveRef.current = 0
      return
    }
    if (current === prevTriggerSaveRef.current) return
    prevTriggerSaveRef.current = current
    form.handleSubmit(onValid, onInvalid)()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOverrides?.triggerSave])

  // ─── Dirty-state propagation ─────────────────────────────────────
  useEffect(() => {
    wizardOverrides?.onDirtyChange?.(form.formState.isDirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.formState.isDirty])

  // ─── Pending validation re-check ──
  // When a submit fails, watch subsequent edits and re-run the resolver.
  // Only when the form becomes fully valid does the wizard banner clear.
  const wizardOverridesRef = useRef(wizardOverrides)
  wizardOverridesRef.current = wizardOverrides
  useEffect(() => {
    const sub = form.watch(() => {
      if (!pendingValidationRef.current) return
      void form.trigger().then((isValid) => {
        if (isValid) {
          pendingValidationRef.current = false
          wizardOverridesRef.current?.onUserEdit?.()
        }
      })
    })
    return () => sub.unsubscribe()
  }, [form])

  // ─── Render ──────────────────────────────────────────────────────
  const diagramCount = watchedDiagramPoints?.length ?? 0
  const productCount = watchedProductApps?.length ?? 0

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      {!wizardOverrides?.hideTitle && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                router.push(`/pacientes/${patientId}?tab=procedimentos`)
              }
              className="text-mid hover:text-charcoal"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <h1 className="font-display text-xl text-forest">
                {isExecuted ? 'Detalhes da Execução' : 'Registrar Execução'}
              </h1>
              <p className="mt-0.5 text-sm text-mid">
                {procedure.procedureTypeName}
                {procedure.approvedAt && (
                  <>
                    {' '}&mdash; Aprovado em{' '}
                    {format(
                      new Date(procedure.approvedAt),
                      "dd 'de' MMMM 'de' yyyy",
                      { locale: ptBR },
                    )}
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
                : 'bg-[#F0F7F1] text-sage',
            )}
          >
            {isExecuted ? 'Executado' : 'Aprovado'}
          </Badge>
        </div>
      )}

      <FormServerErrorBanner
        form={form}
        onRetry={() => form.handleSubmit(onValid, onInvalid)()}
      />

      {/* ── Diagram Editor ──────────────────────────────────────────── */}
      <Section
        title="Diagrama Facial"
        icon={<Stethoscope className="size-4 text-forest" />}
        open={openSections.diagram}
        onToggle={() => toggleSection('diagram')}
        badge={
          diagramCount > 0 ? (
            <Badge
              variant="outline"
              className="text-xs border-sage/30 bg-sage/5 text-sage px-2.5 py-0.5"
            >
              {diagramCount} {diagramCount === 1 ? 'ponto' : 'pontos'}
            </Badge>
          ) : undefined
        }
      >
        <DiagramSection
          form={form}
          plannedPoints={plannedPoints}
          plannedSnapshot={plannedSnapshot}
          showPlannedOverlay={showPlannedOverlay}
          onToggleOverlay={setShowPlannedOverlay}
          catalogProducts={catalogProducts}
          patientGender={patientGender}
          isReadOnly={isReadOnly}
          currentPoints={watchedDiagramPoints ?? []}
        />
      </Section>

      {/* ── Product Details (Batch/Lot Numbers) ─────────────────────── */}
      {productCount > 0 && (
        <Section
          title="Detalhes dos Produtos"
          icon={<Package className="size-4 text-forest" />}
          open={openSections.products}
          onToggle={() => toggleSection('products')}
          badge={
            <Badge variant="outline" className="text-xs">
              {productCount} {productCount === 1 ? 'item' : 'itens'}
            </Badge>
          }
        >
          <ProductApplicationsSection
            form={form}
            fieldArray={productsFieldArray}
            disabled={isReadOnly}
          />
        </Section>
      )}

      {/* ── Clinical Notes ───────────────────────────────────────────── */}
      <Section
        title="Notas Clínicas"
        icon={<FileText className="size-4 text-forest" />}
        open={openSections.clinicalNotes}
        onToggle={() => toggleSection('clinicalNotes')}
      >
        <ExecutionClinicalNotesGroup form={form} disabled={isReadOnly} />
      </Section>

      {/* ── Pre-Procedure Photos ────────────────────────────────────── */}
      <Section
        title="Fotos Pré-Procedimento"
        icon={<Camera className="size-4 text-forest" />}
        open={openSections.prePhotos}
        onToggle={() => toggleSection('prePhotos')}
      >
        <ExecutionPhotoSection
          patientId={patientId}
          procedureId={procedure.id}
          photoRefreshKey={photoRefreshKey}
          onRefresh={handlePhotoRefresh}
          stage="pre"
          disabled={isReadOnly}
        />
      </Section>

      {/* ── Post-Procedure Photos ───────────────────────────────────── */}
      <Section
        title="Fotos Pós-Procedimento"
        icon={<Camera className="size-4 text-forest" />}
        open={openSections.postPhotos}
        onToggle={() => toggleSection('postPhotos')}
      >
        <ExecutionPhotoSection
          patientId={patientId}
          procedureId={procedure.id}
          photoRefreshKey={photoRefreshKey}
          onRefresh={handlePhotoRefresh}
          stage="immediate_post"
          disabled={isReadOnly}
        />
      </Section>

      {/* ── Follow-up (optional) ──────────────────────────────────────── */}
      {!isReadOnly && (
        <Section
          title="Retorno e Próxima Sessão"
          icon={<CalendarPlus className="size-4 text-forest" />}
          open={openSections.followUp}
          onToggle={() => toggleSection('followUp')}
        >
          <ExecutionFollowUpGroup form={form} disabled={isReadOnly} />
        </Section>
      )}

      {/* ── Read-only follow-up info ──────────────────────────────────── */}
      {isReadOnly &&
        (procedure.followUpDate || procedure.nextSessionObjectives) && (
          <Section
            title="Retorno e Próxima Sessão"
            icon={<CalendarPlus className="size-4 text-forest" />}
            open={openSections.followUp}
            onToggle={() => toggleSection('followUp')}
          >
            <ExecutionReadOnlyFollowUp
              followUpDate={procedure.followUpDate}
              nextSessionObjectives={procedure.nextSessionObjectives}
              formatDate={(iso) =>
                format(new Date(iso), "dd 'de' MMMM 'de' yyyy", {
                  locale: ptBR,
                })
              }
            />
          </Section>
        )}

      {/* ── Submit ──────────────────────────────────────────────────── */}
      {!isReadOnly && !wizardOverrides?.hideSaveButton && (
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/pacientes/${patientId}?tab=procedimentos`)
            }
            disabled={submittingAction}
            className="border-forest text-forest hover:bg-petal"
          >
            Cancelar
          </Button>
          <Button
            onClick={() => form.handleSubmit(onValid, onInvalid)()}
            disabled={submittingAction}
            className="bg-forest text-cream hover:bg-sage shadow-sm"
          >
            {submittingAction ? (
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
      )}
    </div>
  )
}
