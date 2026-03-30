'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  CheckCircle2,
  AlertTriangle,
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
  DollarSign,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { MaskedInput } from '@/components/ui/masked-input'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { cn } from '@/lib/utils'
import { AppointmentForm } from '@/components/scheduling/appointment-form'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type { DiagramPointData, CatalogProduct } from '@/components/face-diagram/types'
import { PhotoUploader } from '@/components/photos/photo-uploader'
import { PhotoGrid } from '@/components/photos/photo-grid'
import { ConsentViewer } from '@/components/consent/consent-viewer'
import {
  createProcedureAction,
  updateProcedureAction,
  listProcedureTypesAction,
  checkConsentStatusAction,
  getPreviousDiagramPointsAction,
} from '@/actions/procedures'
import { listDiagramProductsAction } from '@/actions/products-catalog'
import { getActiveConsentForTypeAction } from '@/actions/consent'
import {
  listPractitionersAction,
  listProcedureTypesForSelectAction,
} from '@/actions/appointments'
import { useInvalidation } from '@/hooks/queries/use-invalidation'
import type { DiagramViewType, QuantityUnit, PaymentMethod } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { ProductApplicationItem } from '@/validations/procedure'
import type { WizardOverrides } from '@/components/service-wizard/types'
import type { EvaluationSection, EvaluationResponses } from '@/types/evaluation'
import { TemplateRenderer } from '@/components/evaluation/template-renderer'
import { saveEvaluationResponseAction } from '@/actions/evaluation-responses'
import { validateEvaluationResponses } from '@/lib/evaluation-utils'

// ─── Evaluation template type for the form ────────────────────────

export interface EvaluationTemplateForForm {
  id: string
  procedureTypeId: string
  procedureTypeName: string
  sections: EvaluationSection[]
  version: number
}

export interface ExistingEvaluationResponse {
  templateId: string
  responses: EvaluationResponses
  templateSnapshot: EvaluationSection[]
}

// ─── Consent type mapping from procedure category ──────────────────

const CATEGORY_TO_CONSENT: Record<string, string> = {
  toxina_botulinica: 'botox',
  botox: 'botox',
  preenchimento: 'filler',
  filler: 'filler',
  bioestimulador: 'biostimulator',
  biostimulator: 'biostimulator',
}

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planejado',
  approved: 'Aprovado',
  executed: 'Executado',
  cancelled: 'Cancelado',
  // Legacy
  in_progress: 'Em andamento',
  completed: 'Concluído',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

// ─── Types ──────────────────────────────────────────────────────────

interface ProcedureType {
  id: string
  name: string
  category: string
  defaultPrice: string | null
  estimatedDurationMin: number | null
}

interface ConsentInfo {
  id: string
  acceptedAt: Date
  templateTitle: string
  templateType: string
}

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface FinancialPlanState {
  totalAmount: string // masked currency string
  installmentCount: number
  paymentMethod: PaymentMethod | ''
  notes: string
}

interface ProcedureFormProps {
  patientId: string
  patientGender?: string | null
  procedure?: ProcedureWithDetails | null
  diagrams?: DiagramWithPoints[]
  existingApplications?: ProductApplicationRecord[]
  initialTypeIds?: string[]
  mode?: 'create' | 'edit' | 'view'
  wizardOverrides?: WizardOverrides
  evaluationTemplates?: EvaluationTemplateForForm[]
  existingEvaluationResponses?: ExistingEvaluationResponse[]
  loadingEvaluationTemplates?: boolean
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
      <div
        className={cn(
          'grid transition-all duration-300 ease-in-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <CardContent className="pt-0 pb-5">{children}</CardContent>
        </div>
      </div>
    </Card>
  )
}

// ─── Component ──────────────────────────────────────────────────────

export function ProcedureForm({
  patientId,
  patientGender,
  procedure,
  diagrams: existingDiagrams,
  existingApplications,
  initialTypeIds,
  mode = 'create',
  wizardOverrides,
  evaluationTemplates: evalTemplates,
  existingEvaluationResponses,
  loadingEvaluationTemplates = false,
}: ProcedureFormProps) {
  const router = useRouter()
  const { invalidateProcedures, invalidatePatient } = useInvalidation()
  const isReadOnly = mode === 'view'
  const isEdit = mode === 'edit'

  // Determine if we are in planning mode:
  // Planning mode = creating new procedure OR editing a 'planned' procedure
  const isPlanningMode = mode === 'create' || procedure?.status === 'planned'

  // ─── Form state ──────────────────────────────────────────────────
  const [procedureTypeId, setProcedureTypeId] = useState(
    procedure?.procedureTypeId ?? (initialTypeIds && initialTypeIds.length > 0 ? initialTypeIds[0] : '')
  )
  const [technique, setTechnique] = useState(procedure?.technique ?? '')
  const [clinicalResponse, setClinicalResponse] = useState(
    procedure?.clinicalResponse ?? ''
  )
  const [adverseEffects, setAdverseEffects] = useState(
    procedure?.adverseEffects ?? ''
  )
  const [notes, setNotes] = useState(procedure?.notes ?? '')
  const [followUpDate, setFollowUpDate] = useState(
    procedure?.followUpDate ?? ''
  )
  const [nextSessionObjectives, setNextSessionObjectives] = useState(
    procedure?.nextSessionObjectives ?? ''
  )
  const [additionalTypeIds, setAdditionalTypeIds] = useState<string[]>(() => {
    const existing = (procedure as unknown as Record<string, unknown> | null | undefined)?.additionalTypeIds
    if (Array.isArray(existing) && existing.length > 0) return existing as string[]
    if (initialTypeIds && initialTypeIds.length > 1) return initialTypeIds.slice(1)
    return []
  })

  // ─── Sync type selection from wizard step 2 (initialTypeIds) ────
  const initialTypeIdsRef = useRef(initialTypeIds)
  useEffect(() => {
    if (
      initialTypeIds &&
      initialTypeIds.length > 0 &&
      JSON.stringify(initialTypeIds) !== JSON.stringify(initialTypeIdsRef.current)
    ) {
      initialTypeIdsRef.current = initialTypeIds
      // Only apply if no procedure exists yet (create mode)
      if (!procedure) {
        setProcedureTypeId(initialTypeIds[0])
        setAdditionalTypeIds(initialTypeIds.slice(1))
      }
    }
  }, [initialTypeIds, procedure])

  // ─── Financial plan state ───────────────────────────────────────
  const [financialPlan, setFinancialPlan] = useState<FinancialPlanState>(() => {
    const fp = procedure?.financialPlan as {
      totalAmount?: number
      installmentCount?: number
      paymentMethod?: PaymentMethod
      notes?: string
    } | null
    if (fp && typeof fp === 'object') {
      return {
        totalAmount: fp.totalAmount ? maskCurrency(String(Math.round(fp.totalAmount * 100))) : '',
        installmentCount: fp.installmentCount ?? 1,
        paymentMethod: fp.paymentMethod ?? '',
        notes: fp.notes ?? '',
      }
    }
    return { totalAmount: '', installmentCount: 1, paymentMethod: '', notes: '' }
  })

  // ─── Data loading state ──────────────────────────────────────────
  const [procedureTypes, setProcedureTypes] = useState<ProcedureType[]>([])
  const [loadingTypes, setLoadingTypes] = useState(true)
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([])

  // ─── Consent state ───────────────────────────────────────────────
  const [consentStatus, setConsentStatus] = useState<ConsentInfo | null>(null)
  const [consentTemplate, setConsentTemplate] = useState<ConsentTemplate | null>(
    null
  )
  const [consentChecking, setConsentChecking] = useState(false)
  const [consentAccepted, setConsentAccepted] = useState(false)

  // ─── Face diagram state ──────────────────────────────────────────
  const [diagramPoints, setDiagramPoints] = useState<DiagramPointData[]>(() => {
    if (existingDiagrams && existingDiagrams.length > 0) {
      const allPoints: DiagramPointData[] = []
      for (const d of existingDiagrams) {
        for (const p of d.points) {
          allPoints.push({
            id: p.id,
            x: parseFloat(p.x),
            y: parseFloat(p.y),
            viewType: d.viewType || 'front',
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
  const [previousPoints, setPreviousPoints] = useState<DiagramPointData[]>([])

  // ─── Product applications state ──────────────────────────────────
  const [productApps, setProductApps] = useState<ProductApplicationItem[]>(
    () => {
      if (existingApplications) {
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

  // ─── Evaluation responses state ──────────────────────────────────
  const [evaluationResponses, setEvaluationResponses] = useState<
    Record<string, Record<string, unknown>>
  >(() => {
    if (existingEvaluationResponses && existingEvaluationResponses.length > 0) {
      const map: Record<string, Record<string, unknown>> = {}
      for (const r of existingEvaluationResponses) {
        map[r.templateId] = r.responses as Record<string, unknown>
      }
      return map
    }
    return {}
  })

  const handleEvaluationResponseChange = useCallback(
    (templateId: string, responses: Record<string, unknown>) => {
      setEvaluationResponses((prev) => ({ ...prev, [templateId]: responses }))
    },
    []
  )

  // ─── Evaluation validation state ─────────────────────────────────
  const [showEvalErrors, setShowEvalErrors] = useState(false)

  // ─── Photo state ─────────────────────────────────────────────────
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0)

  // ─── Submit state ────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ─── Follow-up scheduling state ──────────────────────────────────
  const [showFollowUpPrompt, setShowFollowUpPrompt] = useState(false)
  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [appointmentPractitioners, setAppointmentPractitioners] = useState<
    { id: string; fullName: string }[]
  >([])
  const [appointmentProcedureTypes, setAppointmentProcedureTypes] = useState<
    { id: string; name: string; estimatedDurationMin: number | null }[]
  >([])

  // ─── Section open state ──────────────────────────────────────────
  const [openSections, setOpenSections] = useState({
    consent: true,
    prePhotos: true,
    diagram: true,
    products: true,
    clinicalNotes: true,
    followUp: true,
    postPhotos: true,
    financialPlan: true,
  })

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // ─── Load procedure types and products ────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [types, prods] = await Promise.all([
          listProcedureTypesAction(),
          listDiagramProductsAction(),
        ])
        setProcedureTypes(types as ProcedureType[])
        setCatalogProducts(prods as CatalogProduct[])
      } finally {
        setLoadingTypes(false)
      }
    }
    load()
  }, [])

  // ─── Load previous diagram points (ghost overlay) ────────────────
  useEffect(() => {
    async function load() {
      const result = await getPreviousDiagramPointsAction(
        patientId,
        procedure?.id
      )
      if (result.success && result.data && result.data.length > 0) {
        setPreviousPoints(
          result.data.map((p) => ({
            id: p.id,
            x: parseFloat(p.x),
            y: parseFloat(p.y),
            productName: p.productName,
            activeIngredient: p.activeIngredient ?? undefined,
            quantity: parseFloat(p.quantity),
            quantityUnit: p.quantityUnit as QuantityUnit,
            technique: p.technique ?? undefined,
            depth: p.depth ?? undefined,
            notes: p.notes ?? undefined,
          }))
        )
      }
    }
    load()
  }, [patientId, procedure?.id])

  // ─── Auto-sum default prices for financial plan total ──────────────
  // Simplified: compute sum from the best available type IDs + loaded procedure types.
  // Only auto-fill when totalAmount is empty (never override manual edits).
  const lastAutoSumRef = useRef<string>('')
  const prevTypeIdsKeyRef = useRef<string>('')

  useEffect(() => {
    if (!isPlanningMode || isReadOnly) return
    if (procedureTypes.length === 0) return

    // Best source of selected type IDs: initialTypeIds (from wizard step 2) or local state
    const fromState = [procedureTypeId, ...additionalTypeIds].filter(Boolean)
    const selectedIds = fromState.length > 0 ? fromState : (initialTypeIds ?? [])
    if (selectedIds.length === 0) return

    const typeIdsKey = selectedIds.sort().join(',')

    const sum = selectedIds.reduce((acc, id) => {
      const type = procedureTypes.find((t) => t.id === id)
      if (type?.defaultPrice) {
        return acc + parseFloat(type.defaultPrice)
      }
      return acc
    }, 0)

    if (sum <= 0) return

    const centsStr = String(Math.round(sum * 100))
    const masked = maskCurrency(centsStr)

    // If the type selection changed, always recalculate (clear protection)
    if (typeIdsKey !== prevTypeIdsKeyRef.current) {
      prevTypeIdsKeyRef.current = typeIdsKey
      lastAutoSumRef.current = masked
      setFinancialPlan((prev) => ({ ...prev, totalAmount: masked }))
      return
    }

    // Otherwise only fill if empty or matches last auto-calculated value
    setFinancialPlan((prev) => {
      if (prev.totalAmount === '' || prev.totalAmount === lastAutoSumRef.current) {
        lastAutoSumRef.current = masked
        return { ...prev, totalAmount: masked }
      }
      return prev
    })
  }, [procedureTypeId, additionalTypeIds, procedureTypes, isPlanningMode, isReadOnly, initialTypeIds])

  // ─── Check consent when procedure type changes (skip in planning mode) ──
  const selectedType = useMemo(
    () => procedureTypes.find((t) => t.id === procedureTypeId),
    [procedureTypes, procedureTypeId]
  )

  useEffect(() => {
    // In planning mode, consent is handled at approval — skip
    if (isPlanningMode) return

    if (!selectedType) {
      setConsentStatus(null)
      setConsentTemplate(null)
      return
    }

    const consentType =
      CATEGORY_TO_CONSENT[selectedType.category.toLowerCase()] ?? 'general'

    async function checkConsent() {
      setConsentChecking(true)
      try {
        const result = await checkConsentStatusAction(patientId, consentType)
        if (result.success && result.data) {
          setConsentStatus(result.data)
          setConsentTemplate(null)
        } else {
          setConsentStatus(null)
          // Try to load template — also try 'general' as fallback
          let template = await getActiveConsentForTypeAction(consentType).catch(() => null)
          if (!template && consentType !== 'general') {
            template = await getActiveConsentForTypeAction('general').catch(() => null)
          }
          setConsentTemplate(template ?? null)
        }
      } catch {
        setConsentStatus(null)
        setConsentTemplate(null)
      } finally {
        setConsentChecking(false)
      }
    }

    checkConsent()
  }, [selectedType, patientId, isPlanningMode])

  // ─── Auto-populate product applications from diagram points ──────
  useEffect(() => {
    if (isReadOnly) return
    // In planning mode, skip product application auto-population (batch/lot is for execution)
    if (isPlanningMode) return

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
        const existing = prevApps.find(
          (a) => a.productName === productName && a.quantityUnit === total.unit
        )

        newApps.push({
          productName,
          activeIngredient: total.activeIngredient,
          totalQuantity: total.totalQuantity,
          quantityUnit: total.unit,
          batchNumber: existing?.batchNumber,
          expirationDate: existing?.expirationDate,
          labelPhotoId: existing?.labelPhotoId,
          applicationAreas: existing?.applicationAreas,
          notes: existing?.notes,
        })
      }

      return newApps
    })
  }, [diagramPoints, isReadOnly, isPlanningMode])

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
        // Insert after the source entry
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

  // ─── Evaluation validation helper ──────────────────────────────────
  const runEvaluationValidation = useCallback((): string | null => {
    if (!evalTemplates || evalTemplates.length === 0) return null

    const allMissing: { templateName: string; sectionTitle: string; questionLabel: string }[] = []

    for (const template of evalTemplates) {
      const responses = (evaluationResponses[template.id] ?? {}) as Record<string, unknown>
      const result = validateEvaluationResponses(template.sections, responses)
      if (!result.valid) {
        for (const m of result.missingQuestions) {
          allMissing.push({
            templateName: template.procedureTypeName,
            sectionTitle: m.sectionTitle,
            questionLabel: m.questionLabel,
          })
        }
      }
    }

    if (allMissing.length === 0) return null

    const lines = allMissing.map(
      (m) => `• ${m.sectionTitle} — ${m.questionLabel}`
    )
    return `Preencha os campos obrigatórios:\n${lines.join('\n')}`
  }, [evalTemplates, evaluationResponses])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || isReadOnly) return

    // Validate evaluation template required questions
    const evalError = runEvaluationValidation()
    if (evalError) {
      setShowEvalErrors(true)
      setSubmitError(evalError)
      return
    }
    setShowEvalErrors(false)

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

      // Build financial plan payload (planning mode only)
      const financialPlanPayload = isPlanningMode && financialPlan.totalAmount
        ? {
            totalAmount: parseCurrency(financialPlan.totalAmount),
            installmentCount: financialPlan.installmentCount,
            paymentMethod: financialPlan.paymentMethod || undefined,
            notes: financialPlan.notes || undefined,
          }
        : undefined

      const payload = {
        patientId,
        procedureTypeId,
        additionalTypeIds: additionalTypeIds.length > 0 ? additionalTypeIds : undefined,
        // In planning mode, don't send execution-phase fields
        technique: isPlanningMode ? undefined : (technique || undefined),
        clinicalResponse: isPlanningMode ? undefined : (clinicalResponse || undefined),
        adverseEffects: isPlanningMode ? undefined : (adverseEffects || undefined),
        notes: isPlanningMode ? undefined : (notes || undefined),
        followUpDate: isPlanningMode ? undefined : (followUpDate || undefined),
        nextSessionObjectives: isPlanningMode ? undefined : (nextSessionObjectives || undefined),
        diagrams: diagramsPayload,
        productApplications: isPlanningMode ? undefined : (productApps.length > 0 ? productApps : undefined),
        financialPlan: financialPlanPayload,
      }

      let result
      if (isEdit && procedure?.id) {
        result = await updateProcedureAction(procedure.id, payload)
      } else {
        result = await createProcedureAction(payload)
      }

      if (result.success) {
        // Save evaluation responses (standalone form)
        const savedProcedureId = (result.data as { id: string } | undefined)?.id ?? procedure?.id
        if (savedProcedureId && evalTemplates && evalTemplates.length > 0) {
          const responsePromises = evalTemplates
            .filter((t) => {
              const resp = evaluationResponses[t.id]
              return resp && Object.keys(resp).length > 0
            })
            .map((t) =>
              saveEvaluationResponseAction({
                procedureRecordId: savedProcedureId,
                templateId: t.id,
                responses: evaluationResponses[t.id] as EvaluationResponses,
              })
            )

          if (responsePromises.length > 0) {
            const responseResults = await Promise.all(responsePromises)
            const failed = responseResults.find((r) => r?.error)
            if (failed) {
              setSubmitError(failed.error ?? 'Erro ao salvar respostas da avaliação')
              return
            }
          }
        }

        invalidateProcedures(patientId)
        invalidatePatient(patientId)

        if (wizardOverrides?.hideNavigation) {
          // In wizard mode, suppress all navigation — wizard controls flow
        } else if (isPlanningMode) {
          if (isEdit) {
            // Editing existing planned procedure — stay on page, just show success
            router.refresh()
          } else {
            // Creating new planned procedure — redirect to its edit page
            const createdId = (result.data as { id: string } | undefined)?.id
            if (createdId) {
              router.push(`/pacientes/${patientId}/procedimentos/${createdId}/editar`)
              router.refresh()
            } else {
              router.push(`/pacientes/${patientId}?tab=procedimentos`)
              router.refresh()
            }
          }
        } else if (followUpDate) {
          setShowFollowUpPrompt(true)
        } else {
          router.push(`/pacientes/${patientId}?tab=procedimentos`)
          router.refresh()
        }
      } else {
        setSubmitError(result.error ?? 'Erro ao salvar procedimento')
      }
    } catch {
      setSubmitError('Erro inesperado ao salvar procedimento')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    isSubmitting,
    isReadOnly,
    isEdit,
    isPlanningMode,
    procedure?.id,
    patientId,
    procedureTypeId,
    additionalTypeIds,
    technique,
    clinicalResponse,
    adverseEffects,
    notes,
    followUpDate,
    nextSessionObjectives,
    diagramPoints,
    productApps,
    financialPlan,
    evalTemplates,
    evaluationResponses,
    runEvaluationValidation,
    router,
  ])

  // ─── Refs for latest values (avoids stale closures in triggerSave useEffect) ──
  const runEvaluationValidationRef = useRef(runEvaluationValidation)
  runEvaluationValidationRef.current = runEvaluationValidation
  const evaluationResponsesRef = useRef(evaluationResponses)
  evaluationResponsesRef.current = evaluationResponses
  const diagramPointsRef = useRef(diagramPoints)
  diagramPointsRef.current = diagramPoints
  const financialPlanRef = useRef(financialPlan)
  financialPlanRef.current = financialPlan
  const procedureTypeIdRef = useRef(procedureTypeId)
  procedureTypeIdRef.current = procedureTypeId
  const additionalTypeIdsRef = useRef(additionalTypeIds)
  additionalTypeIdsRef.current = additionalTypeIds

  // ─── Wizard triggerSave: run save logic and call onSaveComplete ──
  const mountedRef = useRef(false)

  useEffect(() => {
    const current = wizardOverrides?.triggerSave ?? 0
    if (current === 0) return
    // Skip the very first run (mount) — don't fire save on mount
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    async function doSave() {
      if (isSubmitting || isReadOnly) {
        wizardOverrides?.onSaveComplete?.({
          success: false,
          error: 'Formulário indisponível',
          errorType: 'precondition',
        })
        return
      }

      if (!procedureTypeId) {
        wizardOverrides?.onSaveComplete?.({
          success: false,
          error: 'Selecione pelo menos um tipo de procedimento',
          errorType: 'validation',
        })
        return
      }

      // Validate evaluation template required questions (use ref for latest state)
      const evalError = runEvaluationValidationRef.current()
      if (evalError) {
        setShowEvalErrors(true)
        wizardOverrides?.onSaveComplete?.({
          success: false,
          error: evalError,
          errorType: 'validation',
        })
        return
      }
      setShowEvalErrors(false)

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

        const financialPlanPayload = isPlanningMode && financialPlan.totalAmount
          ? {
              totalAmount: parseCurrency(financialPlan.totalAmount),
              installmentCount: financialPlan.installmentCount,
              paymentMethod: financialPlan.paymentMethod || undefined,
              notes: financialPlan.notes || undefined,
            }
          : undefined

        const payload = {
          patientId,
          procedureTypeId,
          additionalTypeIds: additionalTypeIds.length > 0 ? additionalTypeIds : undefined,
          technique: isPlanningMode ? undefined : (technique || undefined),
          clinicalResponse: isPlanningMode ? undefined : (clinicalResponse || undefined),
          adverseEffects: isPlanningMode ? undefined : (adverseEffects || undefined),
          notes: isPlanningMode ? undefined : (notes || undefined),
          followUpDate: isPlanningMode ? undefined : (followUpDate || undefined),
          nextSessionObjectives: isPlanningMode ? undefined : (nextSessionObjectives || undefined),
          diagrams: diagramsPayload,
          productApplications: isPlanningMode ? undefined : (productApps.length > 0 ? productApps : undefined),
          financialPlan: financialPlanPayload,
        }

        let result
        if (isEdit && procedure?.id) {
          result = await updateProcedureAction(procedure.id, payload)
        } else {
          result = await createProcedureAction(payload)
        }

        if (result.success) {
          const createdId = (result.data as { id: string } | undefined)?.id ?? procedure?.id

          // Save evaluation responses if we have templates with answers
          if (createdId && evalTemplates && evalTemplates.length > 0) {
            const responsePromises = evalTemplates
              .filter((t) => {
                const resp = evaluationResponses[t.id]
                return resp && Object.keys(resp).length > 0
              })
              .map((t) =>
                saveEvaluationResponseAction({
                  procedureRecordId: createdId,
                  templateId: t.id,
                  responses: evaluationResponses[t.id] as EvaluationResponses,
                })
              )

            if (responsePromises.length > 0) {
              const responseResults = await Promise.all(responsePromises)
              const failed = responseResults.find((r) => r?.error)
              if (failed) {
                setSubmitError(failed.error ?? 'Erro ao salvar respostas da avaliação')
                wizardOverrides?.onSaveComplete?.({
                  success: false,
                  error: failed.error ?? 'Erro ao salvar respostas da avaliação',
                  errorType: 'server',
                })
                return
              }
            }
          }

          wizardOverrides?.onSaveComplete?.({
            success: true,
            procedureId: createdId,
          })
        } else {
          setSubmitError(result.error ?? 'Erro ao salvar procedimento')
          wizardOverrides?.onSaveComplete?.({
            success: false,
            error: result.error ?? 'Erro ao salvar procedimento',
            errorType: result.error?.includes('campo') ? 'validation' : 'server',
          })
        }
      } catch {
        setSubmitError('Erro inesperado ao salvar procedimento')
        wizardOverrides?.onSaveComplete?.({
          success: false,
          error: 'Erro inesperado ao salvar procedimento',
          errorType: 'server',
        })
      } finally {
        setIsSubmitting(false)
      }
    }
    doSave()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOverrides?.triggerSave])

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24">
      {/* ── Header ──────────────────────────────────────────────────── */}
      {!wizardOverrides?.hideTitle && (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#2A2A2A]">
            {isPlanningMode
              ? (isEdit ? 'Editar Planejamento' : 'Novo Planejamento')
              : (isEdit
                  ? 'Editar Procedimento'
                  : mode === 'view'
                    ? 'Procedimento'
                    : 'Novo Procedimento')}
          </h1>
          {procedure && !isPlanningMode && (
            <p className="mt-1.5 text-sm text-mid">
              Realizado em{' '}
              {format(
                new Date(procedure.performedAt),
                "dd/MM/yyyy 'as' HH:mm",
                { locale: ptBR }
              )}
            </p>
          )}
          {isPlanningMode && (
            <p className="mt-1.5 text-sm text-mid">
              Defina os procedimentos, pontos de aplicação e plano financeiro.
            </p>
          )}
        </div>

        {procedure && (
          <Badge
            variant="outline"
            className={cn(
              'px-3 py-1',
              procedure.status === 'planned' &&
                'border-amber bg-[#FFF4EF] text-amber-dark',
              procedure.status === 'approved' &&
                'border-sage bg-[#F0F7F1] text-sage',
              procedure.status === 'executed' &&
                'border-sage bg-[#F0F7F1] text-[#2A2A2A]',
              procedure.status === 'cancelled' &&
                'border-red-300 bg-red-100 text-red-800',
              // Legacy
              procedure.status === 'completed' &&
                'border-sage bg-sage/10 text-sage',
              procedure.status === 'in_progress' &&
                'border-amber bg-amber-light text-amber-dark',
            )}
          >
            {STATUS_LABELS[procedure.status] ?? procedure.status}
          </Badge>
        )}
      </div>
      )}

      {/* ── Procedure Type Multi-Select (hidden in wizard — handled by step 2) ── */}
      {!wizardOverrides?.hideProcedureTypes && (
      <Card className="bg-white border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
              <Stethoscope className="size-4 text-forest" />
            </div>
            <span className="uppercase tracking-wider text-sm text-[#2A2A2A] font-medium">
              Tipo de Procedimento
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTypes ? (
            <div className="flex items-center gap-2 text-sm text-mid">
              <Loader2 className="size-4 animate-spin" />
              Carregando tipos...
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-mid">Selecione um ou mais tipos (o primeiro será o principal).</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {procedureTypes.map((type) => {
                  const allSelected = [procedureTypeId, ...additionalTypeIds]
                  const isSelected = allSelected.includes(type.id)

                  function handleToggle() {
                    if (isReadOnly) return
                    if (isSelected) {
                      // Remove
                      if (type.id === procedureTypeId) {
                        // Removing primary: promote first additional or clear
                        if (additionalTypeIds.length > 0) {
                          setProcedureTypeId(additionalTypeIds[0])
                          setAdditionalTypeIds(additionalTypeIds.slice(1))
                        } else {
                          setProcedureTypeId('')
                        }
                      } else {
                        setAdditionalTypeIds(additionalTypeIds.filter((id) => id !== type.id))
                      }
                    } else {
                      // Add
                      if (!procedureTypeId) {
                        setProcedureTypeId(type.id)
                      } else {
                        setAdditionalTypeIds([...additionalTypeIds, type.id])
                      }
                    }
                  }

                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={handleToggle}
                      disabled={isReadOnly}
                      className={cn(
                        'flex items-center gap-3 rounded-[3px] border p-3 text-left text-sm transition-colors',
                        isSelected
                          ? 'border-sage bg-sage/5 text-charcoal'
                          : 'border-[#E8ECEF] bg-white text-mid hover:border-sage/50 hover:bg-[#F4F6F8]',
                        isReadOnly && 'cursor-default opacity-70'
                      )}
                    >
                      <div
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-[3px] border-2 transition-colors',
                          isSelected
                            ? 'border-sage bg-sage'
                            : 'border-[#E8ECEF]'
                        )}
                      >
                        {isSelected && (
                          <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-charcoal">{type.name}</span>
                        {type.defaultPrice && (
                          <span className="ml-2 text-xs text-mid">
                            R$ {parseFloat(type.defaultPrice).toFixed(2)}
                          </span>
                        )}
                        {type.id === procedureTypeId && (
                          <span className="ml-2 text-xs text-sage font-medium">(principal)</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* ── Consent Section (HIDDEN in planning mode) ──────────────── */}
      {!isPlanningMode && procedureTypeId && (
        <Section
          title="Consentimento"
          icon={<FileText className="size-4 text-forest" />}
          open={openSections.consent}
          onToggle={() => toggleSection('consent')}
          badge={
            <>
              {consentStatus && (
                <Badge className="bg-sage/10 text-sage border-sage">
                  <CheckCircle2 className="mr-1 size-3" />
                  Assinado
                </Badge>
              )}
              {!consentStatus &&
                consentTemplate &&
                !consentAccepted && (
                  <Badge className="bg-amber-light text-amber-dark border-amber">
                    <AlertTriangle className="mr-1 size-3" />
                    Pendente
                  </Badge>
                )}
              {consentAccepted && (
                <Badge className="bg-sage/10 text-sage border-sage">
                  <CheckCircle2 className="mr-1 size-3" />
                  Aceito agora
                </Badge>
              )}
            </>
          }
        >
          {consentChecking ? (
            <div className="flex items-center gap-2 py-4 text-sm text-mid">
              <Loader2 className="size-4 animate-spin" />
              Verificando consentimento...
            </div>
          ) : consentStatus ? (
            <div className="flex items-center gap-3 rounded-lg bg-sage/5 p-4">
              <CheckCircle2 className="size-5 text-sage" />
              <div>
                <p className="text-sm font-medium text-charcoal">
                  Termo assinado em{' '}
                  {format(
                    new Date(consentStatus.acceptedAt),
                    "dd/MM/yyyy 'as' HH:mm",
                    { locale: ptBR }
                  )}
                </p>
                <p className="text-xs text-mid">
                  {consentStatus.templateTitle}
                </p>
              </div>
            </div>
          ) : consentTemplate && !consentAccepted ? (
            <ConsentViewer
              template={consentTemplate}
              patientId={patientId}
              procedureRecordId={procedure?.id}
              onAccepted={() => setConsentAccepted(true)}
            />
          ) : consentAccepted ? (
            <div className="flex items-center gap-3 rounded-lg bg-sage/5 p-4">
              <CheckCircle2 className="size-5 text-sage" />
              <p className="text-sm font-medium text-charcoal">
                Termo aceito com sucesso
              </p>
            </div>
          ) : (
            <p className="py-4 text-sm text-mid">
              Nenhum termo de consentimento encontrado para este tipo de
              procedimento.
            </p>
          )}
        </Section>
      )}

      {/* ── Pre-Procedure Photos (HIDDEN in planning mode) ─────────── */}
      {!isPlanningMode && (
        <Section
          title="Fotos Pré-Procedimento"
          icon={<Camera className="size-4 text-forest" />}
          open={openSections.prePhotos}
          onToggle={() => toggleSection('prePhotos')}
        >
          {!isReadOnly && (
            <PhotoUploader
              patientId={patientId}
              procedureRecordId={procedure?.id}
              onUploadComplete={() => setPhotoRefreshKey((k) => k + 1)}
              defaultStage="pre"
            />
          )}
          {procedure?.id && (
            <div className="mt-4">
              <PhotoGrid
                patientId={patientId}
                procedureRecordId={procedure.id}
                refreshKey={photoRefreshKey}
              />
            </div>
          )}
        </Section>
      )}

      {/* ── Loading state for evaluation templates ────── */}
      {isPlanningMode && loadingEvaluationTemplates && (
        <div className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-8">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="size-5 animate-spin text-sage" />
            <span className="text-sm text-mid">Carregando fichas de avaliação...</span>
          </div>
        </div>
      )}

      {/* ── Evaluation Templates (planning mode with templates) ────── */}
      {isPlanningMode && !loadingEvaluationTemplates && evalTemplates && evalTemplates.length > 0 && (() => {
        // Count how many templates have face_diagram questions
        const templatesWithDiagram = evalTemplates.filter((t) =>
          t.sections.some((s) => s.questions.some((q) => q.type === 'face_diagram'))
        )
        // If 2+ templates have diagram → show standalone diagram above orçamento, hide from all templates
        const showStandaloneDiagram = templatesWithDiagram.length >= 2
        let diagramAlreadyRendered = false

        return (
          <>
            {evalTemplates.map((template) => {
              const passDiagramRendered = showStandaloneDiagram ? true : diagramAlreadyRendered
              const hasDiagram = template.sections.some((s) =>
                s.questions.some((q) => q.type === 'face_diagram')
              )
              if (hasDiagram && !showStandaloneDiagram && !diagramAlreadyRendered) {
                diagramAlreadyRendered = true
              }

              return (
                <div key={template.id} className="space-y-0">
                  {/* Template header */}
                  <div className="flex items-center gap-2.5 rounded-t-[3px] bg-forest/5 px-5 py-3 border border-b-0 border-[#E8ECEF]">
                    <div className="flex size-6 items-center justify-center rounded-full bg-forest/10">
                      <Stethoscope className="size-3.5 text-forest" />
                    </div>
                    <span className="text-sm font-semibold text-charcoal">
                      {template.procedureTypeName} — Ficha de Avaliação
                    </span>
                  </div>
                  <div className="rounded-b-[3px] border border-t-0 border-[#E8ECEF] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-5">
                    <TemplateRenderer
                      sections={template.sections}
                      responses={(evaluationResponses[template.id] ?? {}) as Record<string, unknown>}
                      onChange={(r) => handleEvaluationResponseChange(template.id, r)}
                      readOnly={isReadOnly}
                      patientGender={patientGender}
                      diagramPoints={diagramPoints}
                      onDiagramChange={setDiagramPoints}
                      diagramRendered={passDiagramRendered}
                      products={catalogProducts}
                      showErrors={showEvalErrors}
                    />
                  </div>
                </div>
              )
            })}

            {/* Standalone face diagram when 2+ templates have diagram questions */}
            {showStandaloneDiagram && (
              <Section
                title="Diagrama Facial"
                icon={
                  <svg className="size-4 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="10" r="7" />
                    <path d="M12 17v4M8 21h8" />
                  </svg>
                }
                open={openSections.diagram}
                onToggle={() => toggleSection('diagram')}
                badge={
                  diagramPoints.length > 0 ? (
                    <Badge variant="outline" className="text-xs border-sage/30 bg-sage/5 text-sage">
                      {diagramPoints.length} {diagramPoints.length === 1 ? 'ponto' : 'pontos'}
                    </Badge>
                  ) : undefined
                }
              >
                <FaceDiagramEditor
                  points={diagramPoints}
                  onChange={setDiagramPoints}
                  previousPoints={previousPoints}
                  readOnly={isReadOnly}
                  gender={patientGender}
                  products={catalogProducts}
                />
              </Section>
            )}
          </>
        )
      })()}

      {/* Face diagram only shows via templates — no fallback in planning mode */}

      {/* ── Financial Plan (ONLY in planning mode) ──────────────────── */}
      {isPlanningMode && (
        <Section
          title="Orçamento"
          icon={<DollarSign className="size-4 text-forest" />}
          open={openSections.financialPlan}
          onToggle={() => toggleSection('financialPlan')}
          badge={
            financialPlan.totalAmount ? (
              <Badge variant="outline" className="text-xs border-sage/30 bg-sage/5 text-sage">
                R$ {financialPlan.totalAmount}
              </Badge>
            ) : undefined
          }
        >
          <div className="space-y-5">
            <p className="text-xs text-mid">
              Defina o valor e condições de pagamento. A entrada financeira será criada somente após a aprovação.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Total Amount */}
              <div>
                <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                  Valor total
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mid">
                    R$
                  </span>
                  <MaskedInput
                    mask={maskCurrency}
                    value={financialPlan.totalAmount}
                    onChange={(e) =>
                      setFinancialPlan((prev) => ({
                        ...prev,
                        totalAmount: e.target.value,
                      }))
                    }
                    placeholder="0,00"
                    disabled={isReadOnly}
                    className="pl-10 border-sage/20 focus:border-sage/40"
                  />
                </div>
              </div>

              {/* Installment Count */}
              <div>
                <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                  Parcelas
                </Label>
                <Select
                  value={String(financialPlan.installmentCount)}
                  onValueChange={(value) =>
                    setFinancialPlan((prev) => ({
                      ...prev,
                      installmentCount: parseInt(String(value ?? '1'), 10),
                    }))
                  }
                  disabled={isReadOnly}
                >
                  <SelectTrigger className="border-sage/20 focus:border-sage/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}x {n === 1 ? '(à vista)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Forma de pagamento
              </Label>
              <Select
                value={financialPlan.paymentMethod}
                onValueChange={(value) =>
                  setFinancialPlan((prev) => ({
                    ...prev,
                    paymentMethod: value as PaymentMethod,
                  }))
                }
                disabled={isReadOnly}
              >
                <SelectTrigger className="max-w-sm border-sage/20 focus:border-sage/40">
                  <SelectValue placeholder="Selecione...">
                    {(value: string) => PAYMENT_METHOD_LABELS[value] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Observações
              </Label>
              <Textarea
                value={financialPlan.notes}
                onChange={(e) =>
                  setFinancialPlan((prev) => ({
                    ...prev,
                    notes: e.target.value,
                  }))
                }
                placeholder="Condições especiais, descontos, etc."
                disabled={isReadOnly}
                className="min-h-[60px] resize-none border-sage/20 focus:border-sage/40"
                rows={2}
              />
            </div>

            {/* Installment preview */}
            {financialPlan.totalAmount && financialPlan.installmentCount > 1 && (
              <div className="rounded-[3px] bg-[#F4F6F8] p-3">
                <p className="text-xs text-mid">
                  {financialPlan.installmentCount}x de{' '}
                  <span className="font-medium text-charcoal">
                    R${' '}
                    {(
                      parseCurrency(financialPlan.totalAmount) /
                      financialPlan.installmentCount
                    ).toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Product Details (HIDDEN in planning mode) ──────────────── */}
      {!isPlanningMode && productApps.length > 0 && (
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
              // Check if this is the first entry for this product (show header)
              const isFirstForProduct = index === 0 || productApps[index - 1].productName !== app.productName
              // Check if the next entry is for a different product (show "add batch" button)
              const isLastForProduct = index === productApps.length - 1 || productApps[index + 1]?.productName !== app.productName
              // Count entries for this product
              const entriesForProduct = productApps.filter((a) => a.productName === app.productName).length
              const canRemove = entriesForProduct > 1

              return (
                <div key={`${app.productName}-${app.quantityUnit}-${index}`}>
                  {isFirstForProduct && (
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="font-medium text-charcoal">
                        {app.productName}
                      </h4>
                      <Badge variant="outline" className="text-xs border-sage/30 bg-sage/5 text-sage px-2.5 py-0.5">
                        {app.totalQuantity}
                        {app.quantityUnit}
                      </Badge>
                    </div>
                  )}

                  <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-5">
                    {entriesForProduct > 1 && (
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs text-mid uppercase tracking-wider">
                          Lote {productApps.slice(0, index + 1).filter((a) => a.productName === app.productName).length}
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
                        Áreas de aplicação
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

      {/* ── Clinical Notes (HIDDEN in planning mode) ───────────────── */}
      {!isPlanningMode && (
        <Section
          title="Notas Clínicas"
          icon={<FileText className="size-4 text-forest" />}
          open={openSections.clinicalNotes}
          onToggle={() => toggleSection('clinicalNotes')}
        >
          <div className="space-y-5">
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Técnica utilizada
              </Label>
              <Textarea
                value={technique}
                onChange={(e) => setTechnique(e.target.value)}
                placeholder="Descreva a técnica utilizada..."
                disabled={isReadOnly}
                className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
                rows={3}
              />
            </div>

            <div className="border-t border-petal pt-5">
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Resposta clínica
              </Label>
              <Textarea
                value={clinicalResponse}
                onChange={(e) => setClinicalResponse(e.target.value)}
                placeholder="Descreva a resposta clínica observada..."
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
                Observações gerais
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações adicionais..."
                disabled={isReadOnly}
                className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
                rows={3}
              />
            </div>
          </div>
        </Section>
      )}

      {/* ── Follow-up (HIDDEN in planning mode) ────────────────────── */}
      {!isPlanningMode && (
        <Section
          title="Retorno / Follow-up"
          icon={<CalendarPlus className="size-4 text-forest" />}
          open={openSections.followUp}
          onToggle={() => toggleSection('followUp')}
          badge={
            followUpDate ? (
              <Badge variant="outline" className="text-xs">
                {format(new Date(followUpDate + 'T12:00:00'), 'dd/MM/yyyy', {
                  locale: ptBR,
                })}
              </Badge>
            ) : undefined
          }
        >
          <div className="space-y-5">
            <div>
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Data do retorno
              </Label>
              <Input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                disabled={isReadOnly}
                className="mt-1.5 max-w-xs border-sage/20 focus:border-sage/40"
                min={format(new Date(), 'yyyy-MM-dd')}
              />
            </div>

            <div className="border-t border-petal pt-5">
              <Label className="uppercase tracking-wider text-xs text-mid mb-2 block">
                Objetivos da próxima sessão
              </Label>
              <Textarea
                value={nextSessionObjectives}
                onChange={(e) => setNextSessionObjectives(e.target.value)}
                placeholder="Descreva os objetivos para a próxima sessão..."
                disabled={isReadOnly}
                className="mt-1.5 min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
                rows={3}
              />
            </div>
          </div>
        </Section>
      )}

      {/* ── Post-Procedure Photos (HIDDEN in planning mode) ────────── */}
      {!isPlanningMode && (
        <Section
          title="Fotos Pós-Procedimento"
          icon={<Camera className="size-4 text-forest" />}
          open={openSections.postPhotos}
          onToggle={() => toggleSection('postPhotos')}
        >
          {!isReadOnly && (
            <PhotoUploader
              patientId={patientId}
              procedureRecordId={procedure?.id}
              onUploadComplete={() => setPhotoRefreshKey((k) => k + 1)}
              defaultStage="immediate_post"
            />
          )}
        </Section>
      )}

      {/* ── Submit ──────────────────────────────────────────────────── */}
      {!isReadOnly && !wizardOverrides?.hideSaveButton && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-sage/10 bg-white/95 py-4 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.05)] md:sticky md:left-auto md:right-auto">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 md:px-0">
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/pacientes/${patientId}?tab=procedimentos`)
              }
              disabled={isSubmitting}
              className="border-forest/30 text-forest hover:bg-petal hover:border-forest/50 transition-colors duration-150"
            >
              Cancelar
            </Button>

            {submitError && (
              <p className="flex-1 text-center text-sm text-red-600">
                {submitError}
              </p>
            )}

            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !procedureTypeId}
              className="bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200 px-6 py-2.5 text-sm font-medium"
              size="lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="mr-2 size-4" />
                  {isPlanningMode
                    ? (isEdit ? 'Salvar Planejamento' : 'Criar Planejamento')
                    : (isEdit ? 'Salvar Alterações' : 'Salvar Procedimento')}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── Follow-up scheduling prompt ────────────────────────────── */}
      <Dialog
        open={showFollowUpPrompt}
        onOpenChange={(open) => {
          if (!open) {
            setShowFollowUpPrompt(false)
            router.push(`/pacientes/${patientId}?tab=procedimentos`)
            router.refresh()
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-charcoal">
              Agendar retorno?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-mid">
            Deseja agendar o retorno para{' '}
            <span className="font-medium text-charcoal">
              {followUpDate
                ? format(new Date(followUpDate + 'T12:00:00'), "dd/MM/yyyy", {
                    locale: ptBR,
                  })
                : ''}
            </span>
            ?
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="border-forest text-forest hover:bg-petal"
              onClick={() => {
                setShowFollowUpPrompt(false)
                router.push(`/pacientes/${patientId}?tab=procedimentos`)
                router.refresh()
              }}
            >
              Pular
            </Button>
            <Button
              className="bg-forest text-cream hover:bg-sage"
              onClick={async () => {
                setShowFollowUpPrompt(false)
                // Load practitioners and procedure types for appointment form
                const [practitioners, procTypes] = await Promise.all([
                  listPractitionersAction(),
                  listProcedureTypesForSelectAction(),
                ])
                setAppointmentPractitioners(practitioners)
                setAppointmentProcedureTypes(procTypes)
                setShowAppointmentForm(true)
              }}
            >
              <CalendarPlus className="mr-2 size-4" />
              Agendar retorno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Appointment form for follow-up scheduling ──────────────── */}
      <AppointmentForm
        open={showAppointmentForm}
        onOpenChange={(open) => {
          setShowAppointmentForm(open)
          if (!open) {
            router.push(`/pacientes/${patientId}?tab=procedimentos`)
            router.refresh()
          }
        }}
        practitioners={appointmentPractitioners}
        procedureTypes={appointmentProcedureTypes}
        defaultDate={followUpDate}
      />
    </div>
  )
}
