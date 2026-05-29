'use client'

/**
 * Single-session execution form.
 *
 * Scoped to ONE `procedureRecordId` + one fresh `procedureSessions` row.
 * Submits to POST /api/procedures/[id]/sessions (createSessionWireSchema).
 *
 * The clinical UI (collapsible sections, diagram, products, photos) is reused
 * from procedure-execution.tsx's already-extracted subcomponents under
 * `./execution/*` — we lift them at the JSX level rather than copy/paste their
 * internals.
 */

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useForm, useFieldArray, Controller, type Resolver, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Save,
  Loader2,
  Package,
  FileText,
  Camera,
  Stethoscope,
  CalendarPlus,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type {
  DiagramPointData,
  CatalogProduct,
} from '@/components/face-diagram/types'
import type { DiagramViewType, QuantityUnit } from '@/types'
import {
  diagramPointSchema,
  productApplicationItemSchema,
  type ProcedureExecutionFormData,
  type ProductApplicationItem,
} from '@/validations/procedure'
import { FormServerErrorBanner } from '@/components/forms/form-server-error-banner'
import { FormFieldError } from '@/components/forms/form-field-error'
import { ProductApplicationsSection } from './execution/product-applications-section'
import {
  Section,
  DiagramSection,
  ExecutionClinicalNotesGroup,
  ExecutionFollowUpGroup,
} from './execution/execution-details-section'
import { ExecutionPhotoSection } from './execution/execution-photo-section'

// ─── Form schema ────────────────────────────────────────────────────
// Mirrors `procedureSessionFormSchema` from procedure-session.ts but adds the
// local-only fields (diagramPoints, productApplications) so we can drive the
// existing form subcomponents that expect a `UseFormReturn<ProcedureExecutionFormData>`.
//
// `procedureSessionFormSchema` itself stays the source of truth for the
// scalar fields; we redeclare them here so the resolver covers everything in
// one shape. The wire-side validation (`createSessionWireSchema`) runs on the
// server and is the real contract.

const sessionExecutionFormSchema = z.object({
  performedAt: z.string().min(1, 'Informe a data e hora.'),
  technique: z.string().max(5000).optional().default(''),
  clinicalResponse: z.string().max(5000).optional().default(''),
  adverseEffects: z.string().max(5000).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  followUpDate: z.string().optional().default(''),
  nextSessionObjectives: z.string().max(5000).optional().default(''),
  diagramPoints: z.array(diagramPointSchema).default([]),
  productApplications: z.array(productApplicationItemSchema).default([]),
})
type SessionExecutionFormData = z.infer<typeof sessionExecutionFormSchema>

// ─── Props ──────────────────────────────────────────────────────────

interface PrefillDiagram {
  viewType?: string | null
  points?: Array<{
    x: number | string
    y: number | string
    productName: string
    activeIngredient?: string | null
    quantity: number | string
    quantityUnit: string
    technique?: string | null
    depth?: string | null
    notes?: string | null
  }>
}

interface PrefillProductApplication {
  productName: string
  activeIngredient?: string | null
  totalQuantity: number | string
  quantityUnit: string
  batchNumber?: string | null
  expirationDate?: string | null
  applicationAreas?: string | null
  notes?: string | null
}

export interface SessionExecutionFormProps {
  procedureRecordId: string
  patientId: string
  patientGender?: string | null
  prefillFromPreviousSession?: {
    diagrams?: PrefillDiagram[]
    productApplications?: PrefillProductApplication[]
  } | null
  onSaved: (sessionId: string) => void
  onCancel: () => void
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Build an initial diagramPoints array from prefill data. */
function buildPrefillDiagramPoints(
  diagrams: PrefillDiagram[] | undefined,
): DiagramPointData[] {
  if (!diagrams || diagrams.length === 0) return []
  const all: DiagramPointData[] = []
  diagrams.forEach((d, di) => {
    const viewType = d.viewType ?? 'front'
    d.points?.forEach((p, pi) => {
      all.push({
        id: `prefill-${di}-${pi}`,
        viewType,
        x: typeof p.x === 'string' ? parseFloat(p.x) : p.x,
        y: typeof p.y === 'string' ? parseFloat(p.y) : p.y,
        productName: p.productName,
        activeIngredient: p.activeIngredient ?? undefined,
        quantity:
          typeof p.quantity === 'string' ? parseFloat(p.quantity) : p.quantity,
        quantityUnit: (p.quantityUnit as QuantityUnit) ?? 'U',
        technique: p.technique ?? undefined,
        depth: p.depth ?? undefined,
        notes: p.notes ?? undefined,
      })
    })
  })
  return all
}

/** Build initial product applications from prefill data. */
function buildPrefillProductApps(
  apps: PrefillProductApplication[] | undefined,
): ProductApplicationItem[] {
  if (!apps || apps.length === 0) return []
  return apps.map((a) => ({
    productName: a.productName,
    activeIngredient: a.activeIngredient ?? undefined,
    totalQuantity:
      typeof a.totalQuantity === 'string'
        ? parseFloat(a.totalQuantity)
        : a.totalQuantity,
    quantityUnit: (a.quantityUnit as QuantityUnit) ?? 'U',
    batchNumber: a.batchNumber ?? undefined,
    expirationDate: a.expirationDate ?? undefined,
    applicationAreas: a.applicationAreas ?? undefined,
    notes: a.notes ?? undefined,
  }))
}

/** Format a Date for a `datetime-local` <input>. */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

// ─── Main Component ─────────────────────────────────────────────────

export function SessionExecutionForm({
  procedureRecordId,
  patientId,
  patientGender,
  prefillFromPreviousSession,
  onSaved,
  onCancel,
}: SessionExecutionFormProps) {
  // ─── Form ─────────────────────────────────────────────────────────
  const form = useForm<SessionExecutionFormData>({
    resolver: zodResolver(
      sessionExecutionFormSchema,
    ) as unknown as Resolver<SessionExecutionFormData>,
    defaultValues: {
      performedAt: toDatetimeLocalValue(new Date()),
      technique: '',
      clinicalResponse: '',
      adverseEffects: '',
      notes: '',
      followUpDate: '',
      nextSessionObjectives: '',
      diagramPoints: buildPrefillDiagramPoints(
        prefillFromPreviousSession?.diagrams,
      ) as never,
      productApplications: buildPrefillProductApps(
        prefillFromPreviousSession?.productApplications,
      ),
    },
  })

  // The existing execution subcomponents expect `UseFormReturn<ProcedureExecutionFormData>`.
  // Our local schema is structurally compatible for the fields they touch
  // (technique, clinicalResponse, adverseEffects, notes, followUpDate,
  // nextSessionObjectives, diagramPoints, productApplications). Cast once
  // so the subcomponent JSX is reused 1:1 with the proven UI.
  const formAsExecution = form as unknown as UseFormReturn<ProcedureExecutionFormData>

  const productsFieldArray = useFieldArray({
    control: form.control,
    name: 'productApplications',
  })

  // Watched values for render-time derivations
  const watchedDiagramPoints = form.watch('diagramPoints') as DiagramPointData[]
  const watchedProductApps = form.watch(
    'productApplications',
  ) as ProductApplicationItem[]

  // ─── Catalog products ────────────────────────────────────────────
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([])
  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch('/api/products?filter=diagram')
      if (!res.ok) return
      const prods = (await res.json()) as CatalogProduct[]
      if (!cancelled) setCatalogProducts(prods)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ─── Photo state ──────────────────────────────────────────────────
  // The pre/post photo flow uploads photos via PhotoUploader, which associates
  // them with the procedureRecordId server-side. We collect each upload's
  // returned asset id via `onPhotoUploaded` so that the wire payload's
  // `photoAssetIds` array is populated — the server then reassigns those
  // assets to the newly created `procedure_session_id` for per-session
  // attribution. Without this, the server-side reassignment is a no-op and
  // every photo stays bound only to the procedure record.
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0)
  const [photoAssetIds, setPhotoAssetIds] = useState<string[]>([])
  const handlePhotoRefresh = () => setPhotoRefreshKey((k) => k + 1)
  const handlePhotoUploaded = useCallback((assetId: string) => {
    setPhotoAssetIds((prev) => (prev.includes(assetId) ? prev : [...prev, assetId]))
  }, [])

  // ─── Auto-populate product applications from diagram points ──────
  // Mirrors the behaviour in procedure-execution.tsx: any time the diagram
  // gains/loses a point, we keep the productApplications field array in
  // sync. We preserve user-entered identity (batch/notes) so focus isn't
  // lost mid-typing.
  useEffect(() => {
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
    const keyOf = (a: ProductApplicationItem) =>
      `${a.productName}|${a.quantityUnit}`
    const prevByKey = new Map(
      prevApps.map((a, i) => [keyOf(a), { app: a, index: i }]),
    )

    for (const [key, total] of totals) {
      const hit = prevByKey.get(key)
      if (!hit) continue
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

    const keysToRemove: number[] = []
    prevApps.forEach((app, i) => {
      const key = keyOf(app)
      if (totals.has(key)) return
      const userOwned = !!(app.batchNumber || app.notes || app.labelPhotoId)
      if (!userOwned) keysToRemove.push(i)
    })
    for (let i = keysToRemove.length - 1; i >= 0; i--) {
      productsFieldArray.remove(keysToRemove[i])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedDiagramPoints])

  // ─── Section open state ───────────────────────────────────────────
  const [openSections, setOpenSections] = useState({
    diagram: true,
    products: true,
    clinicalNotes: true,
    prePhotos: false,
    postPhotos: false,
    followUp: false,
  })
  const toggleSection = (section: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }))

  // ─── Submit ───────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)

  async function onValid(values: SessionExecutionFormData) {
    setSubmitting(true)
    form.clearErrors('root.serverError' as never)

    try {
      // Group diagram points by viewType so the wire schema's
      // `{ viewType, points: [...] }` shape is satisfied.
      const rawPoints = (form.getValues('diagramPoints') ??
        []) as DiagramPointData[]
      const byView = new Map<DiagramViewType, DiagramPointData[]>()
      for (const p of rawPoints) {
        const v = (p.viewType ?? 'front') as DiagramViewType
        const arr = byView.get(v) ?? []
        arr.push(p)
        byView.set(v, arr)
      }
      const diagramPoints = Array.from(byView.entries()).map(
        ([viewType, points]) => ({
          viewType,
          points: points.map((p, idx) => ({
            x: p.x,
            y: p.y,
            productName: p.productName,
            activeIngredient: p.activeIngredient,
            quantity: p.quantity,
            quantityUnit: p.quantityUnit,
            technique: p.technique,
            depth: p.depth,
            notes: p.notes,
            sortOrder: idx,
          })),
        }),
      )

      // performedAt comes from a datetime-local input → "YYYY-MM-DDTHH:mm"
      // (no timezone). Treat as local clock and convert to a real ISO string.
      const performedAtIso = new Date(values.performedAt).toISOString()

      const body = {
        procedureRecordId,
        performedAt: performedAtIso,
        technique: values.technique ?? '',
        clinicalResponse: values.clinicalResponse ?? '',
        adverseEffects: values.adverseEffects ?? '',
        notes: values.notes ?? '',
        followUpDate: values.followUpDate ? values.followUpDate : null,
        nextSessionObjectives: values.nextSessionObjectives ?? '',
        productApplications: values.productApplications.map((a) => ({
          productName: a.productName,
          activeIngredient: a.activeIngredient,
          totalQuantity: a.totalQuantity,
          quantityUnit: a.quantityUnit,
          batchNumber: a.batchNumber,
          expirationDate: a.expirationDate ?? null,
          applicationAreas: a.applicationAreas,
          notes: a.notes,
        })),
        diagramPoints,
        photoAssetIds,
      }

      const res = await fetch(
        `/api/procedures/${procedureRecordId}/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const json = (await res.json()) as
        | { success: true; data: { sessionId: string } }
        | { success: false; code?: string; error?: string }

      if (res.ok && json.success) {
        toast.success('Sessão registrada com sucesso.')
        onSaved(json.data.sessionId)
        return
      }

      // 409 conflicts — package_terminal / record_already_terminal /
      // all_sessions_executed / concurrent_session_insert / package_missing.
      // Show a friendly message and bubble up via onCancel so the parent
      // refetches picker state.
      if (res.status === 409 && !json.success) {
        const friendly = (() => {
          switch (json.code) {
            case 'package_terminal':
              return 'Este pacote já foi encerrado. A sessão não pode ser registrada.'
            case 'record_already_terminal':
              return 'Este procedimento já foi finalizado.'
            case 'all_sessions_executed':
              return 'Todas as sessões deste procedimento já foram executadas.'
            case 'package_missing':
              return 'Pacote vinculado não encontrado.'
            case 'concurrent_session_insert':
              return 'Outra sessão está sendo registrada simultaneamente. Recarregue e tente novamente.'
            default:
              return json.error ?? 'Não foi possível registrar a sessão.'
          }
        })()
        toast.error(friendly)
        // Caller refreshes the picker — that's our "refresh".
        onCancel()
        return
      }

      const message =
        ('error' in json && json.error) || 'Erro ao salvar sessão'
      form.setError('root.serverError' as never, {
        type: 'manual',
        message,
      })
      toast.error(message)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao salvar sessão'
      form.setError('root.serverError' as never, {
        type: 'manual',
        message,
      })
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────
  const diagramCount = watchedDiagramPoints?.length ?? 0
  const productCount = watchedProductApps?.length ?? 0

  return (
    <form
      onSubmit={form.handleSubmit(onValid)}
      className="mx-auto max-w-4xl space-y-6"
    >
      <FormServerErrorBanner
        form={form}
        onRetry={() => form.handleSubmit(onValid)()}
      />

      {/* ── Performed At (datetime) ────────────────────────────────── */}
      <div className="rounded-[3px] border border-[#E8ECEF] bg-white px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
            <Clock className="size-4 text-forest" />
          </div>
          <Label
            htmlFor="performedAt"
            className="uppercase tracking-wider text-xs text-mid"
          >
            Realizada em
          </Label>
        </div>
        <Controller
          control={form.control}
          name="performedAt"
          render={({ field }) => (
            <Input
              id="performedAt"
              type="datetime-local"
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value)}
              disabled={submitting}
              className="mt-2 max-w-xs"
            />
          )}
        />
        <FormFieldError form={form} name="performedAt" />
      </div>

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
        <p className="mb-3 text-[12px] leading-relaxed text-mid">
          Marque os pontos aplicados nesta sessão. Pontos pré-preenchidos da
          sessão anterior aparecem como referência — ajuste conforme o
          executado.
        </p>
        <DiagramSection
          form={formAsExecution}
          plannedPoints={[]}
          plannedSnapshot={null}
          showPlannedOverlay={false}
          onToggleOverlay={() => {}}
          catalogProducts={catalogProducts}
          patientGender={patientGender}
          isReadOnly={false}
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
            form={formAsExecution}
            fieldArray={
              productsFieldArray as unknown as Parameters<
                typeof ProductApplicationsSection
              >[0]['fieldArray']
            }
            disabled={false}
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
        <ExecutionClinicalNotesGroup form={formAsExecution} disabled={false} />
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
          procedureId={procedureRecordId}
          photoRefreshKey={photoRefreshKey}
          onRefresh={handlePhotoRefresh}
          onPhotoUploaded={handlePhotoUploaded}
          stage="pre"
          disabled={false}
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
          procedureId={procedureRecordId}
          photoRefreshKey={photoRefreshKey}
          onRefresh={handlePhotoRefresh}
          onPhotoUploaded={handlePhotoUploaded}
          stage="immediate_post"
          disabled={false}
        />
      </Section>

      {/* ── Follow-up (optional) ────────────────────────────────────── */}
      <Section
        title="Retorno e Próxima Sessão"
        icon={<CalendarPlus className="size-4 text-forest" />}
        open={openSections.followUp}
        onToggle={() => toggleSection('followUp')}
      >
        <ExecutionFollowUpGroup form={formAsExecution} disabled={false} />
      </Section>

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
          className="border-forest text-forest hover:bg-petal"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          className="bg-forest text-cream hover:bg-sage shadow-sm"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="size-4" />
              Salvar sessão
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
