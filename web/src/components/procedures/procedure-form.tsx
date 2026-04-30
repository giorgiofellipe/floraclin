'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ChevronDown,
  DollarSign,
  Loader2,
  Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useCreateProcedure, useUpdateProcedure } from '@/hooks/mutations/use-procedure-mutations'
import { useSaveEvaluationResponse } from '@/hooks/mutations/use-evaluation-mutations'
import {
  procedurePlanningFormSchema,
  procedurePlanningFinalSchema,
  type ProcedurePlanningFormData,
} from '@/validations/procedure'
import { buildEvaluationResponseSchema } from '@/lib/validations/build-evaluation-schema'
import { FormServerErrorBanner } from '@/components/forms/form-server-error-banner'
import type { DiagramViewType, PaymentMethod, QuantityUnit } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { CatalogProduct, DiagramPointData } from '@/components/face-diagram/types'
import type { WizardOverrides } from '@/components/service-wizard/types'
import type { EvaluationSection, EvaluationResponses } from '@/types/evaluation'
import { FinancialPlanField } from './planning/financial-plan-field'
import {
  ProcedureTypesSection,
  type ProcedureType,
} from './planning/procedure-types-section'
import { EvaluationTemplatesSection } from './planning/evaluation-templates-section'
import { DiagramSection } from './planning/diagram-section'

// ─── Re-exported types (preserved API for other modules) ──────────

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

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planejado',
  approved: 'Aprovado',
  executed: 'Executado',
  cancelled: 'Cancelado',
  in_progress: 'Em andamento',
  completed: 'Concluído',
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
                open && 'rotate-180',
              )}
            />
          </div>
        </CardTitle>
      </CardHeader>
      <div
        className={cn(
          'grid transition-all duration-300 ease-in-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <CardContent className="pt-0 pb-5">{children}</CardContent>
        </div>
      </div>
    </Card>
  )
}

// ─── Helper: derive initial diagram points from existing diagrams ──

function diagramsToPoints(existing: DiagramWithPoints[] | undefined): DiagramPointData[] {
  if (!existing || existing.length === 0) return []
  const allPoints: DiagramPointData[] = []
  for (const d of existing) {
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

function evalResponsesToMap(
  existing: ExistingEvaluationResponse[] | undefined,
): Record<string, Record<string, unknown>> {
  if (!existing || existing.length === 0) return {}
  const map: Record<string, Record<string, unknown>> = {}
  for (const r of existing) {
    map[r.templateId] = r.responses as Record<string, unknown>
  }
  return map
}

function deriveInitialFinancialPlan(
  procedure: ProcedureWithDetails | null | undefined,
): ProcedurePlanningFormData['financialPlan'] {
  const fp = procedure?.financialPlan as
    | {
        totalAmount?: number
        installmentCount?: number
        paymentMethod?: PaymentMethod
        notes?: string
      }
    | null
    | undefined
  if (fp && typeof fp === 'object' && typeof fp.totalAmount === 'number' && fp.totalAmount > 0) {
    return {
      totalAmount: fp.totalAmount,
      installmentCount: fp.installmentCount ?? 1,
      paymentMethod: fp.paymentMethod,
      notes: fp.notes ?? '',
    }
  }
  return undefined
}

// ─── Component ──────────────────────────────────────────────────────

export function ProcedureForm({
  patientId,
  patientGender,
  procedure,
  diagrams: existingDiagrams,
  existingApplications: _existingApplications,
  initialTypeIds,
  mode = 'create',
  wizardOverrides,
  evaluationTemplates: evalTemplates,
  existingEvaluationResponses,
  loadingEvaluationTemplates = false,
}: ProcedureFormProps) {
  // _existingApplications is accepted for API back-compat (procedure-page-client passes it)
  void _existingApplications

  const router = useRouter()
  const createProcedureMutation = useCreateProcedure()
  const updateProcedureMutation = useUpdateProcedure()
  const saveEvalResponse = useSaveEvaluationResponse()
  const isReadOnly = mode === 'view'
  const isEdit = mode === 'edit'

  // This form is ONLY used for the planning step of the wizard. Every call
  // site passes planning-stage data — create, draft, planned, or view-only
  // (when the procedure was later approved/executed). There is no other
  // UI branch; the form always renders the evaluations + diagram + financial
  // plan sections. Interactive disable is handled by isReadOnly below.
  const isPlanningMode = true

  // ─── Form ─────────────────────────────────────────────────────────
  // We type useForm with the schema *output* type (defaults applied) so that
  // subcomponents and Controllers can treat fields as required. zodResolver's
  // input/output mismatch is bridged via an unknown-cast on the resolver.
  const form = useForm<ProcedurePlanningFormData>({
    resolver: zodResolver(procedurePlanningFormSchema) as unknown as Resolver<ProcedurePlanningFormData>,
    mode: 'onSubmit',
    defaultValues: {
      procedureTypeId:
        procedure?.procedureTypeId ??
        (initialTypeIds && initialTypeIds.length > 0 ? initialTypeIds[0] : ''),
      additionalTypeIds: (() => {
        const existing = (procedure as unknown as Record<string, unknown> | null | undefined)
          ?.additionalTypeIds
        if (Array.isArray(existing) && existing.length > 0) return existing as string[]
        if (initialTypeIds && initialTypeIds.length > 1) return initialTypeIds.slice(1)
        return []
      })(),
      technique: procedure?.technique ?? '',
      clinicalResponse: procedure?.clinicalResponse ?? '',
      adverseEffects: procedure?.adverseEffects ?? '',
      notes: procedure?.notes ?? '',
      followUpDate: procedure?.followUpDate ?? '',
      nextSessionObjectives: procedure?.nextSessionObjectives ?? '',
      financialPlan: deriveInitialFinancialPlan(procedure),
      diagramPoints: diagramsToPoints(existingDiagrams),
      evaluationResponses: evalResponsesToMap(existingEvaluationResponses),
    },
  })

  // ─── Sync type selection from wizard step 2 (initialTypeIds) ───
  // The wizard threads its own step-2 selection down as `initialTypeIds`.
  // When the user goes back to step 2 and modifies the selection, this
  // effect pushes the new ids into form state so the form reflects reality
  // and the auto-sum watcher sees a key change. Applies even when editing
  // an existing procedure — JSON equality check prevents redundant writes.
  const initialTypeIdsRef = useRef(initialTypeIds)
  useEffect(() => {
    if (
      initialTypeIds &&
      initialTypeIds.length > 0 &&
      JSON.stringify(initialTypeIds) !== JSON.stringify(initialTypeIdsRef.current)
    ) {
      initialTypeIdsRef.current = initialTypeIds
      form.setValue('procedureTypeId', initialTypeIds[0], { shouldDirty: true })
      form.setValue('additionalTypeIds', initialTypeIds.slice(1), { shouldDirty: true })
    }
  }, [initialTypeIds, form])

  // ─── Sync existing diagram points after mount ──────────────────
  useEffect(() => {
    if (!existingDiagrams || existingDiagrams.length === 0) return
    const current = form.getValues('diagramPoints') ?? []
    if (current.length > 0) return
    form.setValue('diagramPoints', diagramsToPoints(existingDiagrams), { shouldDirty: false })
  }, [existingDiagrams, form])

  // ─── Sync existing eval responses after mount ──────────────────
  useEffect(() => {
    if (!existingEvaluationResponses || existingEvaluationResponses.length === 0) return
    const current = form.getValues('evaluationResponses') ?? {}
    if (Object.keys(current).length > 0) return
    form.setValue('evaluationResponses', evalResponsesToMap(existingEvaluationResponses), {
      shouldDirty: false,
    })
  }, [existingEvaluationResponses, form])

  // ─── Data loading state ─────────────────────────────────────────
  const [procedureTypes, setProcedureTypes] = useState<ProcedureType[]>([])
  const [loadingTypes, setLoadingTypes] = useState(true)
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([])
  const [previousPoints, setPreviousPoints] = useState<DiagramPointData[]>([])

  // ─── Section open state ────────────────────────────────────────
  const [openSections, setOpenSections] = useState({
    diagram: true,
    financialPlan: true,
  })
  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // ─── Load procedure types and products ─────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [typesRes, prodsRes] = await Promise.all([
          fetch('/api/procedure-types'),
          fetch('/api/products?filter=diagram'),
        ])
        if (typesRes.ok) setProcedureTypes((await typesRes.json()) as ProcedureType[])
        if (prodsRes.ok) setCatalogProducts((await prodsRes.json()) as CatalogProduct[])
      } finally {
        setLoadingTypes(false)
      }
    }
    load()
  }, [])

  // ─── Load previous diagram points (ghost overlay) ──────────────
  useEffect(() => {
    async function load() {
      const params = new URLSearchParams({ patientId })
      if (procedure?.id) params.set('excludeProcedureId', procedure.id)
      const res = await fetch(`/api/face-diagrams?${params}`)
      const data = res.ok ? await res.json() : []
      if (data && data.length > 0) {
        setPreviousPoints(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.map((p: any) => ({
            id: p.id,
            x: parseFloat(String(p.x)),
            y: parseFloat(String(p.y)),
            productName: p.productName,
            activeIngredient: p.activeIngredient ?? undefined,
            quantity: parseFloat(String(p.quantity)),
            quantityUnit: p.quantityUnit as QuantityUnit,
            technique: p.technique ?? undefined,
            depth: p.depth ?? undefined,
            notes: p.notes ?? undefined,
          })),
        )
      }
    }
    load()
  }, [patientId, procedure?.id])

  // ─── Auto-sum default prices into financial plan total ─────────
  // Rules:
  //   1. If the procedure already has a saved totalAmount > 0, NEVER touch it
  //      on mount — the user's persisted value wins.
  //   2. Recalculate ONLY when the user actively changes the selected types.
  //   3. If no total is set yet (new procedure), populate once as a convenience.
  const procedureTypeId = form.watch('procedureTypeId')
  const additionalTypeIds = form.watch('additionalTypeIds')

  // Seed the "previous types key" ref with the types that were already
  // associated with the procedure at load time. That way, the effect's
  // first run won't mistake the mount-time state for a change event.
  const initialTypeIdsKey = useMemo(() => {
    const ids = [
      procedure?.procedureTypeId,
      ...(((procedure as unknown as { additionalTypeIds?: string[] } | null)
        ?.additionalTypeIds as string[] | undefined) ?? []),
    ].filter(Boolean) as string[]
    return ids.length > 0 ? [...ids].sort().join(',') : ''
    // Computed once at mount — procedure identity is stable for the wizard lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const prevTypeIdsKeyRef = useRef<string>(initialTypeIdsKey)

  useEffect(() => {
    if (!isPlanningMode || isReadOnly) return
    if (procedureTypes.length === 0) return

    const fromState = [procedureTypeId, ...(additionalTypeIds ?? [])].filter(Boolean)
    const selectedIds = fromState.length > 0 ? fromState : (initialTypeIds ?? [])
    if (selectedIds.length === 0) return

    const typeIdsKey = [...selectedIds].sort().join(',')
    const typesChanged = typeIdsKey !== prevTypeIdsKeyRef.current

    // No types changed AND mount already covered — nothing to do.
    if (!typesChanged) return

    const sum = selectedIds.reduce((acc, id) => {
      const type = procedureTypes.find((t) => t.id === id)
      if (type?.defaultPrice) {
        return acc + parseFloat(type.defaultPrice)
      }
      return acc
    }, 0)

    // Record the new key regardless of whether we overwrite, so a no-op
    // type change (e.g. sum === 0) still counts as "seen."
    prevTypeIdsKeyRef.current = typeIdsKey

    if (sum <= 0) return

    const currentFp = form.getValues('financialPlan')
    form.setValue(
      'financialPlan',
      {
        totalAmount: sum,
        installmentCount: currentFp?.installmentCount ?? 1,
        paymentMethod: currentFp?.paymentMethod,
        notes: currentFp?.notes ?? '',
      },
      { shouldDirty: true },
    )
  }, [procedureTypeId, additionalTypeIds, procedureTypes, isPlanningMode, isReadOnly, initialTypeIds, form])

  // ─── Dirty state propagation ──────────────────────────────────
  const isDirty = form.formState.isDirty
  useEffect(() => {
    wizardOverrides?.onDirtyChange?.(isDirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty])

  // ─── Wizard overrides ref (keeps callback identity stable across renders) ──
  const wizardOverridesRef = useRef(wizardOverrides)
  wizardOverridesRef.current = wizardOverrides

  // ─── Pending final-mode re-validation ──
  // Flipped true when a final-mode submit fails. While true, every edit
  // re-runs the final schema; when it passes, we clear errors and notify
  // the wizard so the "Corrija os campos destacados" banner disappears.
  // Stale `evalTemplates` is captured via a ref so the watch effect doesn't
  // need to re-subscribe every time templates load.
  const pendingFinalValidationRef = useRef(false)
  const evalTemplatesRef = useRef(evalTemplates)
  evalTemplatesRef.current = evalTemplates

  useEffect(() => {
    const sub = form.watch(() => {
      if (!pendingFinalValidationRef.current) return
      const templates = evalTemplatesRef.current ?? []
      const needsDiagram = templates.some((t: { sections?: { questions?: { type: string; required: boolean }[] }[] }) =>
        t.sections?.some((s) => s.questions?.some((q) => q.type === 'face_diagram' && q.required))
      )
      const finalSchema = procedurePlanningFinalSchema(needsDiagram).and(
        z.object({
          evaluationResponses: buildEvaluationResponseSchema(
            templates as never,
          ),
        }),
      )
      const result = finalSchema.safeParse(form.getValues())
      if (result.success) {
        pendingFinalValidationRef.current = false
        form.clearErrors()
        wizardOverridesRef.current?.onUserEdit?.()
      }
    })
    return () => sub.unsubscribe()
  }, [form])

  // ─── First-error scroll ──────────────────────────────────────
  const errors = form.formState.errors
  useEffect(() => {
    const keys = Object.keys(errors)
    if (keys.length === 0) return
    // Scroll to first invalid field if available
    const first = document.querySelector('[aria-invalid="true"]') as HTMLElement | null
    if (first && typeof first.scrollIntoView === 'function') {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [errors])

  // Highlight required-but-empty evaluation questions when final-mode
  // validation has flagged them. Errors have a nested shape
  // (evaluationResponses.{templateId}.{questionId}) — any key under
  // evaluationResponses means at least one question failed validation.
  const evalErrorSubtree = (errors as { evaluationResponses?: Record<string, unknown> })
    .evaluationResponses
  const showEvalErrors = !!evalErrorSubtree && Object.keys(evalErrorSubtree).length > 0

  // ─── Submit handler ──────────────────────────────────────────
  const [submittingAction, setSubmittingAction] = useState(false)

  const onValid = useCallback(
    async (values: ProcedurePlanningFormData) => {
      console.log('[planning] onValid fired — draft schema passed', {
        validationMode: wizardOverrides?.validationMode ?? 'draft',
        values,
      })
      if (isReadOnly) {
        console.log('[planning] aborting — form is read-only')
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
        const validationMode = wizardOverrides?.validationMode ?? 'draft'
        if (validationMode === 'final') {
          if (loadingEvaluationTemplates) {
            console.log('[planning] aborting — evaluation templates still loading')
            form.setError('root.serverError' as never, {
              type: 'manual',
              message: 'Aguarde o carregamento dos templates de avaliação',
            })
            wizardOverrides?.onSaveComplete?.({
              success: false,
              error: 'Templates loading',
              errorType: 'precondition',
            })
            return
          }
          // Check if any loaded evaluation template has a required face_diagram question
          const requiresDiagram = (evalTemplates ?? []).some((t: { sections?: { questions?: { type: string; required: boolean }[] }[] }) =>
            t.sections?.some((s) =>
              s.questions?.some((q) => q.type === 'face_diagram' && q.required)
            )
          )

          const finalSchema = procedurePlanningFinalSchema(requiresDiagram).and(
            z.object({
              evaluationResponses: buildEvaluationResponseSchema(
                (evalTemplates ?? []) as never,
              ),
            }),
          )
          console.log('[planning] diagramPoints state at submit time', {
            viaValues: values.diagramPoints,
            viaGetValues: form.getValues('diagramPoints'),
            length: values.diagramPoints?.length,
          })
          const finalResult = finalSchema.safeParse(values)
          console.log('[planning] final-mode safeParse result', {
            success: finalResult.success,
            evalTemplateCount: (evalTemplates ?? []).length,
          })
          if (!finalResult.success) {
            const issueSummary = finalResult.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
              code: i.code,
            }))
            console.log('[planning] final schema ISSUES (readable)', issueSummary)
            for (const issue of finalResult.error.issues) {
              const key = issue.path.join('.')
              console.log('[planning] setting error at path', {
                key,
                message: issue.message,
              })
              form.setError(key as never, {
                type: 'manual',
                message: issue.message,
              })
            }
            console.log('[planning] formState.errors after setError', form.formState.errors)
            // Arm the re-validation watcher so the wizard banner clears
            // the moment the user finishes filling the remaining fields.
            pendingFinalValidationRef.current = true
            wizardOverrides?.onSaveComplete?.({
              success: false,
              error: 'Validation failed',
              errorType: 'validation',
            })
            return
          }
          // Final validation passed — clear any prior pending flag
          pendingFinalValidationRef.current = false
        }

        // Build wire-format diagrams payload.
        // NOTE: read the raw (unparsed) form state via getValues — the parsed
        // `values.diagramPoints` has `id`/`viewType` stripped by zod, which
        // would break point identity on subsequent renders after form.reset.
        const rawPoints = form.getValues('diagramPoints')
        const diagramsPayload =
          rawPoints.length > 0
            ? [
                {
                  viewType: 'front' as DiagramViewType,
                  points: rawPoints.map((p) => ({
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

        // Planning mode strips execution-phase fields from the payload
        // Planning form never writes execution-phase fields — those are owned
        // by procedure-execution.tsx. Leave them out of the payload entirely.
        const payload: Record<string, unknown> = {
          patientId,
          procedureTypeId: values.procedureTypeId,
          additionalTypeIds:
            values.additionalTypeIds.length > 0 ? values.additionalTypeIds : undefined,
          diagrams: diagramsPayload,
          financialPlan: values.financialPlan,
        }

        console.log('[planning] sending save payload', {
          mode: isEdit && procedure?.id ? 'update' : 'create',
          procedureId: procedure?.id,
          payload,
        })

        let result
        if (isEdit && procedure?.id) {
          result = await updateProcedureMutation.mutateAsync({ id: procedure.id, ...payload })
        } else {
          result = await createProcedureMutation.mutateAsync(payload)
        }

        const createdProc = result?.data as { id: string; status?: 'draft' | 'planned' | 'approved' | 'executed' | 'cancelled' } | undefined
        const createdId = createdProc?.id ?? procedure?.id
        const serverStatus = createdProc?.status

        console.log('[planning] server response', {
          createdId,
          serverStatus,
          rawResult: result,
        })

        // Save evaluation responses (preserved verbatim from prior implementation)
        if (createdId && evalTemplates && evalTemplates.length > 0) {
          const responsePromises = evalTemplates
            .filter((t) => {
              const resp = (values.evaluationResponses as Record<string, unknown>)[t.id]
              return resp && Object.keys(resp as object).length > 0
            })
            .map((t) =>
              saveEvalResponse.mutateAsync({
                procedureRecordId: createdId,
                templateId: t.id,
                responses: (values.evaluationResponses as Record<string, unknown>)[
                  t.id
                ] as EvaluationResponses,
              }),
            )
          if (responsePromises.length > 0) {
            const responseResults = await Promise.all(responsePromises)
            const failed = responseResults.find((r: Record<string, unknown>) => r?.error)
            if (failed) {
              const failedError =
                (failed as Record<string, string>).error ??
                'Erro ao salvar respostas da avaliação'
              form.setError('root.serverError' as never, {
                type: 'manual',
                message: failedError,
              })
              wizardOverrides?.onSaveComplete?.({
                success: false,
                error: failedError,
                errorType: 'server',
              })
              return
            }
          }
        }

        // Reset to mark form clean
        form.reset(values)

        // Navigation behavior — skip when inside the service wizard (it handles its own transitions)
        if (!wizardOverrides?.hideNavigation && !wizardOverrides?.onSaveComplete) {
          if (isPlanningMode) {
            if (isEdit) {
              router.refresh()
            } else if (createdId) {
              router.push(`/pacientes/${patientId}/procedimentos/${createdId}/editar`)
              router.refresh()
            } else {
              router.push(`/pacientes/${patientId}?tab=procedimentos`)
              router.refresh()
            }
          } else {
            router.push(`/pacientes/${patientId}?tab=procedimentos`)
            router.refresh()
          }
        }

        console.log('[planning] calling onSaveComplete with success', {
          procedureId: createdId,
          procedureStatus: serverStatus,
        })

        wizardOverrides?.onSaveComplete?.({
          success: true,
          procedureId: createdId,
          procedureStatus: serverStatus,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro ao salvar procedimento'
        console.error('[planning] save threw', err)
        form.setError('root.serverError' as never, { type: 'manual', message })
        wizardOverrides?.onSaveComplete?.({
          success: false,
          error: message,
          errorType: 'server',
        })
      } finally {
        setSubmittingAction(false)
      }
    },
    [
      isReadOnly,
      isEdit,
      isPlanningMode,
      loadingEvaluationTemplates,
      evalTemplates,
      patientId,
      procedure?.id,
      form,
      createProcedureMutation,
      updateProcedureMutation,
      saveEvalResponse,
      wizardOverrides,
      router,
    ],
  )

  const onInvalid = useCallback(
    (errors: Record<string, unknown>) => {
      console.log('[planning] onInvalid fired — draft schema FAILED', {
        errors,
        formValues: form.getValues(),
      })
      wizardOverrides?.onSaveComplete?.({
        success: false,
        error: 'Validation failed',
        errorType: 'validation',
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wizardOverrides],
  )

  // ─── Wizard triggerSave wiring ────────────────────────────────
  const prevTriggerSaveRef = useRef(wizardOverrides?.triggerSave ?? 0)
  useEffect(() => {
    const current = wizardOverrides?.triggerSave ?? 0
    if (current === 0) {
      prevTriggerSaveRef.current = 0
      return
    }
    if (current === prevTriggerSaveRef.current) return
    prevTriggerSaveRef.current = current
    console.log('[planning] triggerSave effect firing form.handleSubmit', {
      triggerSaveCount: current,
      validationMode: wizardOverrides?.validationMode,
    })
    void form.handleSubmit(onValid, onInvalid)()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOverrides?.triggerSave])

  // ─── Watched values for badges ────────────────────────────────
  const financialPlan = form.watch('financialPlan')
  const diagramPoints = form.watch('diagramPoints') ?? []

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24">
      {/* ── Header ───────────────────────────────────────────── */}
      {!wizardOverrides?.hideTitle && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#2A2A2A]">
              {isPlanningMode
                ? isEdit
                  ? 'Editar Planejamento'
                  : 'Novo Planejamento'
                : isEdit
                  ? 'Editar Procedimento'
                  : mode === 'view'
                    ? 'Procedimento'
                    : 'Novo Procedimento'}
            </h1>
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
                procedure.status === 'cancelled' &&
                  'border-red-300 bg-red-100 text-red-800',
              )}
            >
              {STATUS_LABELS[procedure.status] ?? procedure.status}
            </Badge>
          )}
        </div>
      )}

      {/* ── Server / validation error banners ──────────────── */}
      <FormServerErrorBanner
        form={form}
        onRetry={() => void form.handleSubmit(onValid, onInvalid)()}
      />

      {/* ── Procedure Type Multi-Select ──────────────────── */}
      {!wizardOverrides?.hideProcedureTypes && (
        <ProcedureTypesSection
          control={form.control}
          form={form}
          procedureTypes={procedureTypes}
          loading={loadingTypes}
          disabled={isReadOnly}
        />
      )}

      {/* ── Evaluation templates (planning mode) ────────── */}
      {isPlanningMode && (
        <EvaluationTemplatesSection
          control={form.control}
          form={form}
          templates={evalTemplates ?? []}
          isLoading={loadingEvaluationTemplates}
          readOnly={isReadOnly}
          patientGender={patientGender}
          catalogProducts={catalogProducts}
          showErrors={showEvalErrors}
        />
      )}

      {/* ── Standalone face diagram ──
           Shown whenever at least one evaluation template declares a
           face_diagram question, so the single editor lives in one
           predictable place (right before the financial plan) regardless
           of how many templates want it. */}
      {isPlanningMode &&
        !loadingEvaluationTemplates &&
        evalTemplates &&
        evalTemplates.some((t) =>
          t.sections.some((s) => s.questions.some((q) => q.type === 'face_diagram')),
        ) && (
        <Section
          title="Diagrama Facial"
          icon={
            <svg
              className="size-4 text-forest"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="10" r="7" />
              <path d="M12 17v4M8 21h8" />
            </svg>
          }
          open={openSections.diagram}
          onToggle={() => toggleSection('diagram')}
          badge={
            diagramPoints.length > 0 ? (
              <Badge
                variant="outline"
                className="text-xs border-sage/30 bg-sage/5 text-sage"
              >
                {diagramPoints.length} {diagramPoints.length === 1 ? 'ponto' : 'pontos'}
              </Badge>
            ) : undefined
          }
        >
          <DiagramSection
            control={form.control}
            form={form}
            previousPoints={previousPoints}
            gender={patientGender}
            products={catalogProducts}
            showComparison={!isPlanningMode}
            readOnly={isReadOnly}
          />
        </Section>
      )}

      {/* ── Financial plan (planning mode only) ──────────── */}
      {isPlanningMode && (
        <Section
          title="Orçamento"
          icon={<DollarSign className="size-4 text-forest" />}
          open={openSections.financialPlan}
          onToggle={() => toggleSection('financialPlan')}
          badge={
            financialPlan?.totalAmount ? (
              <Badge
                variant="outline"
                className="text-xs border-sage/30 bg-sage/5 text-sage"
              >
                R$ {financialPlan.totalAmount.toFixed(2)}
              </Badge>
            ) : undefined
          }
        >
          <FinancialPlanField
            control={form.control}
            form={form}
            disabled={isReadOnly}
          />
        </Section>
      )}

      {/* ── Submit ──────────────────────────────────────── */}
      {!isReadOnly && !wizardOverrides?.hideSaveButton && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-sage/10 bg-white/95 py-4 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.05)] md:sticky md:left-auto md:right-auto">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 md:px-0">
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/pacientes/${patientId}?tab=procedimentos`)
              }
              disabled={submittingAction}
              className="border-forest/30 text-forest hover:bg-petal hover:border-forest/50 transition-colors duration-150"
            >
              Cancelar
            </Button>

            <Button
              onClick={() => void form.handleSubmit(onValid, onInvalid)()}
              disabled={submittingAction || !procedureTypeId}
              className="bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200 px-6 py-2.5 text-sm font-medium"
              size="lg"
            >
              {submittingAction ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="mr-2 size-4" />
                  {isPlanningMode
                    ? isEdit
                      ? 'Salvar Planejamento'
                      : 'Criar Planejamento'
                    : isEdit
                      ? 'Salvar Alterações'
                      : 'Salvar Procedimento'}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

