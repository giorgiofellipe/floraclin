'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  STEP_TIMESTAMP_KEYS,
  useServiceWizard,
  type StepTimestamps,
  type WizardStep,
} from '@/hooks/use-service-wizard'
import { useUpdateAppointmentStatus } from '@/hooks/mutations/use-appointment-mutations'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { computeCartTotal, type EncounterCart } from '@/validations/encounter-cart'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WizardStepper } from './wizard-stepper'
import { WizardStep as WizardStepWrapper } from './wizard-step'
import { ProcedureTypeStep } from './procedure-type-step'
import { usePatientDiagramGroups } from '@/hooks/queries/use-face-diagram-groups'
import { queryKeys } from '@/hooks/queries/query-keys'
import { SaveStatusIndicator } from './save-status-indicator'
import { AnamnesisStep } from './anamnesis-step'
import { ProcedureForm } from '@/components/procedures/procedure-form'
import { ProcedureApproval } from '@/components/procedures/procedure-approval'
import { ProcedureExecution } from '@/components/procedures/procedure-execution'
import type { CardPaymentChoice, StepResult, WizardOverrides } from './types'
import { buildFinalizeBody } from './build-finalize-body'
import type { ProcedureStatus } from '@/types'
import { useNfsePrompt } from '@/components/nfse/nfse-prompt-provider'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { AnamnesisRecord, AnamnesisTemplate } from '@/lib/anamnesis/types'
import type { EvaluationTemplateForForm, ExistingEvaluationResponse } from '@/components/procedures/procedure-form'
import type { FormSection, FormResponses } from '@/lib/forms/types'
import { formatBrPhone } from '@/lib/phone'
import { formatBrDate, parseLocalDate } from '@/lib/dates'
import { isOpenDiagram } from '@/lib/face-diagram-status'
import {
  countPendingSessions,
  encounterViewQueryOptions,
  EncounterViewNotFoundError,
} from '@/components/procedures/encounter-view'

const PENDING_CHECK_FAILED_MESSAGE =
  'Não foi possível verificar as sessões pendentes. Recarregue a página para tentar novamente.'

// ─── Types ──────────────────────────────────────────────────────────

interface PatientInfo {
  id: string
  fullName: string
  birthDate: string | null
  phone: string
  cpf: string | null
  gender?: string | null
}

interface TenantInfo {
  id: string
  name: string
  whatsappApiEnabled?: boolean
}

interface ServiceWizardProps {
  patient: PatientInfo
  tenant: TenantInfo
  initialStep?: number
  procedureId?: string | null
  procedureStatus?: ProcedureStatus | null
  procedure?: ProcedureWithDetails | null
  diagrams?: DiagramWithPoints[] | null
  existingApplications?: ProductApplicationRecord[] | null
  anamnesis?: AnamnesisRecord | null
  anamnesisTemplate: AnamnesisTemplate
  anamnesisUpdatedByName?: string
  stepTimestamps?: StepTimestamps
  /**
   * Deep-link from "Executar próxima sessão" on the package card: when set,
   * `<ProcedureExecution>` mounts directly in execute mode for this record so
   * the user lands on the session form, not the picker.
   */
  deepLinkProcedureId?: string | null
  autoStartNext?: boolean
  /** The appointment this atendimento serves: prefills its procedure type and is completed on finalize. */
  appointment?: { id: string; status: string; procedureTypeId: string | null } | null
  /** Quotation group from `?diagram=`; its cart is applied automatically at step 2. */
  initialDiagramGroupId?: string | null
}

// ─── Helpers ────────────────────────────────────────────────────────

function calculateAge(birthDate: string): number {
  const today = new Date()
  const birth = parseLocalDate(birthDate)
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

// ─── Component ──────────────────────────────────────────────────────

export function ServiceWizard({
  patient,
  tenant,
  initialStep,
  procedureId,
  procedureStatus,
  procedure,
  diagrams,
  existingApplications,
  anamnesis,
  anamnesisTemplate,
  anamnesisUpdatedByName,
  stepTimestamps,
  deepLinkProcedureId,
  autoStartNext,
  initialDiagramGroupId,
  appointment,
}: ServiceWizardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { promptAfterPayment } = useNfsePrompt()
  const [sourceDiagramGroupId, setSourceDiagramGroupId] = useState<string | null>(
    initialDiagramGroupId ?? null,
  )
  const { data: diagramGroups } = usePatientDiagramGroups(patient.id)
  const sourceDiagramGroup = sourceDiagramGroupId
    ? diagramGroups?.find((g) => g.id === sourceDiagramGroupId && isOpenDiagram(g.status))
    : undefined

  // Derive initial selected type IDs from existing procedure
  const initialSelectedTypeIds = (() => {
    if (!procedure) return []
    const ids: string[] = []
    if (procedure.procedureTypeId) ids.push(procedure.procedureTypeId)
    const additional = (procedure as unknown as Record<string, unknown>)?.additionalTypeIds
    if (Array.isArray(additional)) ids.push(...(additional as string[]))
    return ids
  })()

  // Derive initial encounterId from the loaded procedure (resume path). For a
  // fresh start the step 2 → 3 advance mints one. Without this, resuming a
  // mid-flow atendimento would leave state.encounterId null and step 4's
  // finalize would error with "Atendimento sem identificador".
  const initialEncounterId = (procedure as unknown as { encounterId?: string | null } | null | undefined)?.encounterId ?? null

  const wizard = useServiceWizard({
    patientId: patient.id,
    initialStep,
    procedureId,
    procedureStatus,
    encounterId: initialEncounterId,
    selectedTypeIds: initialSelectedTypeIds,
    stepTimestamps,
  })

  const {
    state,
    goToStep,
    nextStep,
    prevStep,
    triggerSave,
    onSaveComplete,
    canSkip,
    isStepAvailable,
    isStepCompleted,
    isStepReadOnly,
    getSkipLabel,
    getNextLabel,
    updateProcedureStatus,
    updateStepTimestamp,
    setCart,
    setEncounterId,
    setProcedureRecordIds,
    setError,
    clearError,
  } = wizard

  // ─── Lift procedure data into client state (CRITICAL 1 fix) ────
  const [localProcedure, setLocalProcedure] = useState<ProcedureWithDetails | null>(procedure ?? null)
  const [localDiagrams, setLocalDiagrams] = useState<DiagramWithPoints[] | null>(diagrams ?? null)
  const [pendingSignatureLabels, setPendingSignatureLabels] = useState<string[]>([])
  const [localApplications, setLocalApplications] = useState<ProductApplicationRecord[] | null>(existingApplications ?? null)

  // Per-step dirty tracking + stable handlers
  const [stepDirty, setStepDirty] = useState<Record<number, boolean>>({})

  const dirtyHandlers = useMemo(
    () => ({
      1: (d: boolean) => setStepDirty((p) => (p[1] === d ? p : { ...p, 1: d })),
      2: (d: boolean) => setStepDirty((p) => (p[2] === d ? p : { ...p, 2: d })),
      3: (d: boolean) => setStepDirty((p) => (p[3] === d ? p : { ...p, 3: d })),
      4: (d: boolean) => setStepDirty((p) => (p[4] === d ? p : { ...p, 4: d })),
    }),
    [],
  )

  // Tick every 30s so "Salvo há Xmin" stays fresh
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // ─── Evaluation templates + responses ─────────────────────────
  const [evalTemplates, setEvalTemplates] = useState<EvaluationTemplateForForm[]>([])
  const [existingEvalResponses, setExistingEvalResponses] = useState<ExistingEvaluationResponse[]>([])
  const [evalTemplatesLoadedForIds, setEvalTemplatesLoadedForIds] = useState<string>('')
  const [loadingEvalTemplates, setLoadingEvalTemplates] = useState(false)

  // Load evaluation templates when selectedTypeIds change
  useEffect(() => {
    const typeIds = state.selectedTypeIds
    const key = typeIds.slice().sort().join(',')
    if (!key || key === evalTemplatesLoadedForIds) return

    async function loadTemplates() {
      setLoadingEvalTemplates(true)
      try {
        const params = new URLSearchParams()
        typeIds.forEach((id) => params.append('typeId', id))
        const templatesRes = await fetch(`/api/evaluation/templates?${params}`)
        const templates = templatesRes.ok ? await templatesRes.json() : []
        // Load procedure types for names
        const typesRes = await fetch('/api/procedure-types')
        const allTypes = typesRes.ok ? await typesRes.json() : []

        const typeNameMap = new Map<string, string>()
        for (const t of allTypes as { id: string; name: string }[]) {
          typeNameMap.set(t.id, t.name)
        }

        const formTemplates: EvaluationTemplateForForm[] = (templates as { id: string; procedureTypeId: string; sections: unknown; version: number }[])
          .filter((t) => typeIds.includes(t.procedureTypeId))
          .map((t) => ({
            id: t.id,
            procedureTypeId: t.procedureTypeId,
            procedureTypeName: typeNameMap.get(t.procedureTypeId) ?? 'Procedimento',
            sections: t.sections as FormSection[],
            version: t.version,
          }))
          // Preserve the order from selectedTypeIds
          .sort((a: EvaluationTemplateForForm, b: EvaluationTemplateForForm) => typeIds.indexOf(a.procedureTypeId) - typeIds.indexOf(b.procedureTypeId))

        setEvalTemplates(formTemplates)
        setEvalTemplatesLoadedForIds(key)
      } catch {
        // Non-blocking: templates won't show
      } finally {
        setLoadingEvalTemplates(false)
      }
    }
    loadTemplates()
  }, [state.selectedTypeIds, evalTemplatesLoadedForIds])

  // Load existing evaluation responses when resuming a procedure
  // Re-run when navigating back to planning (responses may have been saved in a previous visit)
  useEffect(() => {
    if (!state.procedureId) return
    if (state.currentStep !== 2) return

    async function loadResponses() {
      try {
        const evalRes = await fetch(`/api/evaluation/responses/${state.procedureId}`)
        const responses = evalRes.ok ? await evalRes.json() : []
        if (responses && responses.length > 0) {
          setExistingEvalResponses(
            (responses as { templateId: string; responses: FormResponses; templateSnapshot: unknown }[]).map((r) => ({
              templateId: r.templateId,
              responses: r.responses as FormResponses,
              templateSnapshot: r.templateSnapshot as FormSection[],
            }))
          )
        }
      } catch {
        // Non-blocking
      }
    }
    loadResponses()
  }, [state.procedureId, state.currentStep])

  // ─── Leave protection: only unsaved edits on the current step can be lost ───

  // All steps stay mounted, so edits left on another step are lost on exit too.
  const hasUnsavedChanges = Object.values(stepDirty).some(Boolean)
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges)
  hasUnsavedChangesRef.current = hasUnsavedChanges
  const [showExitDialog, setShowExitDialog] = useState(false)
  const isExitingRef = useRef(false)

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isExitingRef.current || !hasUnsavedChangesRef.current) return
      e.preventDefault()
    }

    function handlePopState() {
      if (isExitingRef.current || !hasUnsavedChangesRef.current) return
      // Push state back so the user stays on the page
      window.history.pushState(null, '', window.location.href)
      setShowExitDialog(true)
    }

    // Replace current history entry so we can intercept back without accumulating entries
    window.history.replaceState(null, '', window.location.href)

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [state.currentStep])

  const handleExit = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true)
      return
    }
    isExitingRef.current = true
    router.push(`/pacientes/${patient.id}`)
  }, [hasUnsavedChanges, router, patient.id])

  // `pendingAction` is lifted to React state (not a ref) so `validationMode`
  // in getOverridesForStep can be derived safely during render. See the note
  // on getOverridesForStep for details.
  const [pendingAction, setPendingAction] = useState<'advance' | 'exit'>('advance')
  const confirmExit = useCallback(() => {
    isExitingRef.current = true
    setShowExitDialog(false)
    router.push(`/pacientes/${patient.id}`)
  }, [router, patient.id])

  // Step 1 shows a status card; the full anamnesis form mounts only on demand.
  const [anamnesisFormOpen, setAnamnesisFormOpen] = useState(false)
  // A step without an editable form never answers triggerSave (isSaving would stay stuck).
  let currentStepSaves = false
  if (state.currentStep === 1) currentStepSaves = anamnesisFormOpen
  else if (state.currentStep === 2) currentStepSaves = state.cart.lines.length > 0 && !isStepReadOnly(2)

  // ─── Smart context message ─────────────────────────────────────

  function getContextMessage(): { text: string; dotColor: string } | null {
    const currentStatus = state.procedureStatus
    if (!currentStatus) {
      return { text: 'Novo atendimento', dotColor: 'bg-forest' }
    }
    if (currentStatus === 'planned') {
      const dateStr = state.stepTimestamps.planning ? formatBrDate(state.stepTimestamps.planning) : null
      return {
        text: dateStr ? `Continuando planejamento de ${dateStr}` : 'Continuando planejamento',
        dotColor: 'bg-amber',
      }
    }
    if (currentStatus === 'approved') {
      return {
        text: 'Procedimento aprovado, pronto para execução',
        dotColor: 'bg-sage',
      }
    }
    return null
  }

  const contextMessage = getContextMessage()

  // ─── Step completion handler ───────────────────────────────────

  const handleStepComplete = useCallback(
    async (result: StepResult) => {
      console.log('[wizard] handleStepComplete received', {
        currentStep: state.currentStep,
        pendingAction,
        result,
      })
      // Snapshot pending action and reset to default for the next save
      const pending = pendingAction
      setPendingAction('advance')
      onSaveComplete(result)

      if (result.success) {
        updateStepTimestamp(STEP_TIMESTAMP_KEYS[state.currentStep], new Date())

        // The first planning save mints the encounter id that keys the
        // finalize POST at approval and the execution sessions.
        if (state.currentStep === 2 && !state.encounterId) {
          setEncounterId(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36))
        }

        // After planning creates/updates a procedure, fetch fresh data client-side
        if (state.currentStep === 2 && result.procedureId) {
          try {
            const fetchRes = await fetch(`/api/procedures/${result.procedureId}`)
            if (fetchRes.ok) {
              const procData = await fetchRes.json()
              setLocalProcedure(procData as ProcedureWithDetails)
              setLocalDiagrams((procData as { diagrams?: DiagramWithPoints[] }).diagrams ?? null)
              setLocalApplications((procData as { productApplications?: ProductApplicationRecord[] }).productApplications ?? null)
            }
          } catch {
            // Non-blocking: approval and execution show a placeholder if the fetch fails
          }
        }

        if (pending === 'exit') {
          isExitingRef.current = true
          toast.success('Atendimento salvo. Retome quando quiser.')
          router.push(`/pacientes/${patient.id}`)
          return
        }

        // Stay on planning while the server keeps the procedure as a draft
        // (missing financial plan or diagram points).
        if (state.currentStep === 2 && result.procedureStatus === 'draft') {
          console.log('[wizard] staying on planning: server returned draft status')
          toast.info('Preencha o plano financeiro para avançar à aprovação.')
          return
        }

        console.log('[wizard] auto-advancing to next step', {
          from: state.currentStep,
        })
        // Auto-advance to next step after successful save
        nextStep()
      }
    },
    [
      onSaveComplete,
      pendingAction,
      state.currentStep,
      state.encounterId,
      nextStep,
      updateStepTimestamp,
      setEncounterId,
      router,
      patient.id,
    ]
  )

  // ─── Skip/Adiar handler ────────────────────────────────────────

  const handleSkip = useCallback(() => {
    if (state.currentStep === 3) {
      // "Adiar aprovação" exits the wizard
      isExitingRef.current = true
      toast.info('Atendimento salvo como planejado. Retorne para aprovar quando o paciente estiver pronto.')
      router.push(`/pacientes/${patient.id}`)
      return
    }
    // Regular skip: advance to next step
    nextStep()
  }, [state.currentStep, nextStep, router, patient.id])

  // ─── Approval → finalize encounter ───────────────────────────────
  //
  // POST /api/encounters/{encounterId}/finalize approves the drafts, records
  // the charge and returns the approved record ids used by execution.
  const [isFinalizing, setIsFinalizing] = useState(false)
  const cardPaymentRef = useRef<CardPaymentChoice>({ cardNow: false, terminalId: null, expectedRate: null })
  const handleCardPaymentChange = useCallback((value: CardPaymentChoice) => {
    cardPaymentRef.current = value
  }, [])

  const handleApprove = useCallback(async () => {
    if (isFinalizing) return
    let encId = state.encounterId
    if (!encId) {
      encId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
      setEncounterId(encId)
    }
    if (!localProcedure) {
      toast.error('Carregando dados do procedimento, aguarde um instante.')
      return
    }

    const draftRecordIds = (
      state.procedureRecordIds.length > 0
        ? state.procedureRecordIds
        : [state.procedureId]
    ).filter((id): id is string => !!id)

    if (draftRecordIds.length === 0) {
      toast.error('Nenhum procedimento de rascunho encontrado para finalizar.')
      return
    }

    const financialPlanRaw = (localProcedure as unknown as {
      financialPlan?: {
        totalAmount?: number | string
        installmentCount?: number
        paymentMethod?: string
        notes?: string
      } | null
    }).financialPlan

    if (!financialPlanRaw) {
      toast.error('Plano financeiro ausente. Volte ao planejamento.')
      return
    }

    const practitionerId =
      (localProcedure as unknown as { practitionerId?: string }).practitionerId
    if (!practitionerId) {
      toast.error('Profissional do procedimento não identificado.')
      return
    }

    const card = cardPaymentRef.current
    if (card.cardNow && (!card.terminalId || card.expectedRate === null)) {
      toast.error('Selecione a maquininha')
      return
    }

    setIsFinalizing(true)
    try {
      const res = await fetch(
        `/api/encounters/${encId}/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            buildFinalizeBody({
              cart: state.cart,
              draftRecordIds,
              patientId: patient.id,
              practitionerId,
              financialPlan: financialPlanRaw,
              card,
            }),
          ),
        },
      )

      if (!res.ok) {
        if (res.status === 409) {
          updateProcedureStatus('approved')
          updateStepTimestamp('approval', new Date())
          nextStep()
          return
        }
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Erro ao finalizar (HTTP ${res.status})`)
      }
      const payload = await res.json()
      queryClient.invalidateQueries({ queryKey: queryKeys.diagramGroups.all })
      const recordIds: string[] = Array.isArray(payload?.data?.procedureRecordIds)
        ? payload.data.procedureRecordIds
        : Array.isArray(payload?.procedureRecordIds)
          ? payload.procedureRecordIds
          : []

      if (recordIds.length > 0) {
        setProcedureRecordIds(recordIds)
      }
      if (typeof payload?.paymentError === 'string') {
        toast.error(payload.paymentError, {
          description: 'A cobrança ficou pendente no Financeiro.',
        })
      }
      promptAfterPayment(payload?.nfse)
      updateProcedureStatus('approved')
      updateStepTimestamp('approval', new Date())
      toast.success('Procedimento aprovado.')
      nextStep()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao aprovar procedimento'
      toast.error(msg)
    } finally {
      setIsFinalizing(false)
    }
  }, [
    isFinalizing,
    state.encounterId,
    state.cart,
    state.procedureId,
    state.procedureRecordIds,
    localProcedure,
    patient.id,
    setEncounterId,
    setProcedureRecordIds,
    updateProcedureStatus,
    updateStepTimestamp,
    nextStep,
    queryClient,
    promptAfterPayment,
  ])

  // ─── Execution → finish ──────────────────────────────────────────
  // Finishing is blocked while any executable session is still pending.

  // Subscribe to the encounter view (shared cache with SessionPicker, no
  // extra fetch) so we can tell whether any session is still pending.
  const { data: encounterView, error: encounterViewError, isLoading: encounterViewLoading } = useQuery({
    ...encounterViewQueryOptions(state.encounterId ?? ''),
    enabled: !!state.encounterId && state.currentStep === 4,
  })

  const pendingSessionsRemaining = encounterView ? countPendingSessions(encounterView) : 0
  const pendingCheckFailed =
    !!encounterViewError && !(encounterViewError instanceof EncounterViewNotFoundError)
  // Until the pending-session check answers, finishing could skip unexecuted sessions.
  const isFinalizeBlocked =
    state.currentStep === 4 && (encounterViewLoading || pendingCheckFailed || pendingSessionsRemaining > 0)

  let finalizeBlockedText = PENDING_CHECK_FAILED_MESSAGE
  if (encounterViewLoading) {
    finalizeBlockedText = 'Verificando sessões pendentes...'
  } else if (!pendingCheckFailed) {
    finalizeBlockedText =
      pendingSessionsRemaining === 1
        ? '1 sessão pendente. Execute ou encerre o pacote antes de finalizar.'
        : `${pendingSessionsRemaining} sessões pendentes. Execute todas ou encerre o pacote antes de finalizar.`
  }

  const updateAppointmentStatus = useUpdateAppointmentStatus()
  const [isFinishing, setIsFinishing] = useState(false)

  const finishAtendimento = useCallback(async () => {
    setIsFinishing(true)
    try {
      if (appointment && appointment.status !== 'completed') {
        try {
          await updateAppointmentStatus.mutateAsync({ id: appointment.id, status: 'completed' })
        } catch {
          toast.error('Não foi possível marcar o agendamento como concluído. Atualize o status na Agenda.')
        }
      }
      isExitingRef.current = true
      toast.success('Atendimento finalizado')
      router.push(`/pacientes/${patient.id}`)
    } finally {
      setIsFinishing(false)
    }
  }, [appointment, updateAppointmentStatus, router, patient.id])

  // ─── Next handler ──────────────────────────────────────────────

  const handleNext = useCallback(() => {
    if (state.currentStep === 4) {
      void finishAtendimento()
      return
    }
    if (state.currentStep === 3) {
      void handleApprove()
      return
    }
    if (state.currentStep === 2 && state.cart.lines.length === 0) {
      setError('Selecione ao menos um tipo de procedimento.', 'precondition')
      return
    }
    if (!currentStepSaves) {
      nextStep()
      return
    }
    triggerSave()
  }, [
    state.currentStep,
    state.cart.lines.length,
    currentStepSaves,
    triggerSave,
    nextStep,
    setError,
    handleApprove,
    finishAtendimento,
  ])

  const handleSaveAndExit = useCallback(() => {
    if (!currentStepSaves) {
      isExitingRef.current = true
      toast.success('Atendimento salvo. Retome quando quiser.')
      router.push(`/pacientes/${patient.id}`)
      return
    }
    setPendingAction('exit')
    triggerSave()
  }, [currentStepSaves, triggerSave, router, patient.id])

  const handleCartChange = useCallback(
    (cart: EncounterCart) => {
      setCart(cart)
      if (cart.lines.length > 0) clearError()
    },
    [setCart, clearError],
  )

  // ─── Wizard overrides for each step ────────────────────────────

  const anamnesisOnAutoSaved = useCallback(
    (timestamp: Date) => updateStepTimestamp('anamnesis', timestamp),
    [updateStepTimestamp],
  )

  // Read state.error via ref inside the user-edit handler so the callback
  // identity stays stable (avoids re-running forms' watch subscriptions).
  const validationErrorRef = useRef(state.error && state.errorType === 'validation')
  validationErrorRef.current = !!state.error && state.errorType === 'validation'

  const handleUserEdit = useCallback(() => {
    if (validationErrorRef.current) {
      clearError()
    }
  }, [clearError])

  const baseOverridesBase = {
    hideSaveButton: true,
    hideNavigation: true,
    hideTitle: true,
    onSaveComplete: handleStepComplete,
    onCardPaymentChange: handleCardPaymentChange,
  }

  // Each step gets triggerSave ONLY when it's the active step.
  // All steps are mounted simultaneously (display:none), so passing
  // triggerSave to all of them would cause all to fire at once.
  //
  // `validationMode` is derived from `pendingAction` STATE (not a ref); reading
  // a mutable ref during render violates React concurrency guarantees. State
  // changes are committed before the form's triggerSave effect fires, so by
  // the time the form reads wizardOverrides.validationMode, the correct value
  // is visible.
  function getOverridesForStep(step: WizardStep): WizardOverrides {
    const isFinalValidation = step === 2 && pendingAction === 'advance'
    return {
      ...baseOverridesBase,
      triggerSave: state.currentStep === step ? state.triggerSave : 0,
      onDirtyChange: dirtyHandlers[step],
      onAutoSaved: step === 1 ? anamnesisOnAutoSaved : undefined,
      onUserEdit: handleUserEdit,
      validationMode: isFinalValidation ? 'final' : 'draft',
    }
  }

  // ─── Derived state ─────────────────────────────────────────────

  const isReadOnlyAfterApproval = isStepReadOnly(1)

  // additionalTypeIds: prefer wizard state (includes unsaved additions) over DB record
  const additionalTypeIds = state.selectedTypeIds.length > 1
    ? state.selectedTypeIds.slice(1)
    : (localProcedure?.additionalTypeIds as string[] | null) ?? []

  const showSaveAndExit = state.currentStep !== 3

  // ─── Render ────────────────────────────────────────────────────

  const skipLabel = getSkipLabel(state.currentStep)
  function primaryLabel(): string {
    if (isFinalizing) return 'Aprovando...'
    if (isFinishing) return 'Finalizando...'
    if (state.isSaving) return 'Salvando...'
    if (state.currentStep !== 3) return getNextLabel(state.currentStep)
    if (pendingSignatureLabels.length > 0) return 'Aprovar e assinar depois'
    return computeCartTotal(state.cart) > 0 ? 'Aprovar e cobrar' : 'Aprovar'
  }

  const showBack = state.currentStep > 1
  // On the anamnesis status card the card offers its own "Pular".
  const showSkip = canSkip(state.currentStep) && !(state.currentStep === 1 && !anamnesisFormOpen) && !!skipLabel
  const age = patient.birthDate ? calculateAge(patient.birthDate) : null
  const busy = state.isSaving || isFinalizing || isFinishing
  const nextDisabled = busy || isFinalizeBlocked
  const nextText = primaryLabel()
  const appointmentTypeId =
    !procedure && !initialDiagramGroupId ? (appointment?.procedureTypeId ?? null) : null

  const secondaryButton =
    'rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-12 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="-m-4 md:-m-6 flex min-h-screen flex-col bg-content-bg">
      {/* env() padding keeps it clear of the notch / home-indicator insets (viewport-fit=cover). */}
      <header className="sticky top-0 z-30 bg-white pt-[env(safe-area-inset-top)] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-4 py-1.5 sm:px-6 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sage/15 text-[12px] font-semibold text-sage">
              {patient.fullName.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="hidden sm:block">
              <p className="text-[13px] font-semibold text-charcoal leading-tight">{patient.fullName}</p>
              <p className="text-[11px] text-mid leading-tight">
                {age !== null && <>{age} anos</>}
                {age !== null && patient.phone && <> · </>}
                {patient.phone && formatBrPhone(patient.phone)}
              </p>
            </div>
            <span className="sm:hidden min-w-0 truncate text-[13px] font-semibold text-charcoal">{patient.fullName}</span>
          </div>

          <div className="hidden sm:block">
            <WizardStepper
              currentStep={state.currentStep}
              isStepAvailable={isStepAvailable}
              isStepCompleted={isStepCompleted}
              onStepClick={goToStep}
              disabled={busy}
            />
          </div>

          <button
            type="button"
            onClick={handleExit}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-mid transition-colors hover:bg-content-bg hover:text-charcoal sm:size-8"
            aria-label="Fechar atendimento"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="sm:hidden border-t border-content-bg px-4 pb-1.5">
          <WizardStepper
            compact
            currentStep={state.currentStep}
            isStepAvailable={isStepAvailable}
            isStepCompleted={isStepCompleted}
            onStepClick={goToStep}
            disabled={busy}
          />
        </div>

        {contextMessage && (
          <div className="border-t border-content-bg px-4 py-1.5 sm:px-6">
            <div className="flex items-center gap-2">
              <span className={cn('inline-block size-1.5 rounded-full', contextMessage.dotColor)} />
              <span className="text-[12px] text-mid">{contextMessage.text}</span>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto flex w-full flex-1 flex-col gap-4 px-4 py-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-24">
        {/* All steps stay mounted so their form state survives navigation; only the active one is visible. */}
        <div className="flex-1">
          <div style={{ display: state.currentStep === 1 ? 'block' : 'none' }}>
            <WizardStepWrapper title="Anamnese" timestamp={state.stepTimestamps.anamnesis}>
              {isReadOnlyAfterApproval && (
                <div className="mb-4 rounded-[3px] border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-800">
                    Anamnese não pode ser editada após aprovação do procedimento.
                  </p>
                </div>
              )}
              <AnamnesisStep
                patient={{ id: patient.id, fullName: patient.fullName, phone: patient.phone }}
                whatsappApiEnabled={tenant.whatsappApiEnabled}
                record={anamnesis ?? null}
                template={anamnesisTemplate}
                updatedByName={anamnesisUpdatedByName}
                wizardOverrides={getOverridesForStep(1)}
                readOnly={isReadOnlyAfterApproval}
                formOpen={anamnesisFormOpen}
                onOpenForm={() => setAnamnesisFormOpen(true)}
                onSkip={handleSkip}
              />
            </WizardStepWrapper>
          </div>

          <div style={{ display: state.currentStep === 2 ? 'block' : 'none' }}>
            <WizardStepWrapper title="Planejamento" timestamp={state.stepTimestamps.planning}>
              {isReadOnlyAfterApproval && (
                <div className="mb-4 rounded-[3px] border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-800">
                    Procedimentos não podem ser alterados após aprovação.
                  </p>
                </div>
              )}
              <div className="space-y-5">
                <div className={isReadOnlyAfterApproval ? 'pointer-events-none opacity-75' : undefined}>
                  <ProcedureTypeStep
                    patientId={patient.id}
                    quoteSelection={{
                      selectedGroupId: sourceDiagramGroupId,
                      onSelect: setSourceDiagramGroupId,
                    }}
                    cart={state.cart}
                    onCartChange={handleCartChange}
                    selectedTypeIds={state.selectedTypeIds}
                    appointmentTypeId={appointmentTypeId}
                    readOnly={isReadOnlyAfterApproval}
                  />
                </div>
                <div hidden={state.cart.lines.length === 0}>
                  <ProcedureForm
                    patientId={patient.id}
                    appointmentId={appointment?.id}
                    patientGender={patient.gender}
                    procedure={localProcedure ?? undefined}
                    diagrams={localDiagrams ?? undefined}
                    sourceDiagram={
                      sourceDiagramGroup
                        ? { groupId: sourceDiagramGroup.id, views: sourceDiagramGroup.views }
                        : null
                    }
                    existingApplications={localApplications ?? undefined}
                    initialTypeIds={state.selectedTypeIds}
                    cart={state.cart.lines.length > 0 ? state.cart : undefined}
                    draftRecordIds={
                      state.procedureRecordIds.length > 0
                        ? state.procedureRecordIds
                        : state.procedureId
                          ? [state.procedureId]
                          : undefined
                    }
                    onCartChange={handleCartChange}
                    mode={
                      isReadOnlyAfterApproval
                        ? 'view'
                        : localProcedure
                          ? 'edit'
                          : 'create'
                    }
                    wizardOverrides={{ ...getOverridesForStep(2), hideProcedureTypes: true }}
                    evaluationTemplates={evalTemplates.length > 0 ? evalTemplates : undefined}
                    existingEvaluationResponses={existingEvalResponses.length > 0 ? existingEvalResponses : undefined}
                    loadingEvaluationTemplates={loadingEvalTemplates}
                  />
                </div>
              </div>
            </WizardStepWrapper>
          </div>

          <div style={{ display: state.currentStep === 3 ? 'block' : 'none' }}>
            <WizardStepWrapper title="Aprovação" timestamp={state.stepTimestamps.approval}>
              {state.procedureId && localProcedure ? (
                <ProcedureApproval
                  procedure={localProcedure}
                  diagrams={localDiagrams ?? []}
                  patient={{
                    id: patient.id,
                    fullName: patient.fullName,
                    cpf: patient.cpf,
                    gender: patient.gender,
                    phone: patient.phone,
                  }}
                  tenant={tenant}
                  additionalTypeIds={additionalTypeIds}
                  cart={state.cart.lines.length > 0 ? state.cart : undefined}
                  draftRecordIds={
                    state.procedureRecordIds.length > 0
                      ? state.procedureRecordIds
                      : state.procedureId
                        ? [state.procedureId]
                        : undefined
                  }
                  encounterId={state.encounterId}
                  wizardOverrides={getOverridesForStep(3)}
                  onPendingSignaturesChange={setPendingSignatureLabels}
                />
              ) : (
                <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                  <p className="text-mid">
                    Complete o planejamento para acessar a aprovação.
                  </p>
                </div>
              )}
            </WizardStepWrapper>
          </div>

          <div style={{ display: state.currentStep === 4 ? 'block' : 'none' }}>
            <WizardStepWrapper title="Execução" timestamp={state.stepTimestamps.execution}>
              {state.currentStep === 4 && state.encounterId && (
                state.procedureId &&
                (state.procedureStatus === 'approved' ||
                  state.procedureStatus === 'in_progress' ||
                  state.procedureStatus === 'completed') &&
                localProcedure ? (
                  <div className="rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] sm:p-6">
                    <ProcedureExecution
                      encounterId={state.encounterId}
                      procedureRecordIds={
                        state.procedureRecordIds.length > 0
                          ? state.procedureRecordIds
                          : state.procedureId
                            ? [state.procedureId]
                            : []
                      }
                      packageId={null}
                      patientId={patient.id}
                      patientGender={patient.gender}
                      procedure={localProcedure}
                      diagrams={localDiagrams ?? undefined}
                      existingApplications={localApplications ?? undefined}
                      deepLinkProcedureId={deepLinkProcedureId ?? null}
                      autoStartNext={autoStartNext ?? false}
                      wizardOverrides={getOverridesForStep(4)}
                    />
                  </div>
                ) : (
                  <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                    <p className="text-mid">
                      Aprove o procedimento para acessar a execução.
                    </p>
                  </div>
                )
              )}
            </WizardStepWrapper>
          </div>
        </div>
      </main>

      {/* env() padding keeps it clear of the notch / home-indicator insets (viewport-fit=cover). */}
      <nav className="fixed bottom-0 left-[env(safe-area-inset-left)] right-[env(safe-area-inset-right)] md:left-[calc(200px+env(safe-area-inset-left))] z-30 border-t border-gray-100 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        {state.error && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 sm:px-6">
            <p role="alert" className="mx-auto text-sm text-red-800">
              {state.errorType === 'validation' &&
                'Corrija os campos destacados antes de continuar.'}
              {state.errorType === 'precondition' && state.error}
              {state.errorType === 'server' && (state.error || 'Erro ao salvar. Tente novamente.')}
              {!state.errorType && state.error}
            </p>
          </div>
        )}
        {isFinalizeBlocked && (
          <p className="border-b border-gray-100 px-4 py-1.5 text-[11px] text-mid md:hidden">{finalizeBlockedText}</p>
        )}

        {/* Phone: back icon, full-width primary, overflow for the secondary actions */}
        <div className="flex items-center gap-2 px-4 py-2.5 md:hidden">
          {showBack && (
            <button
              type="button"
              onClick={prevStep}
              disabled={busy}
              aria-label="Voltar"
              className="flex size-11 shrink-0 items-center justify-center rounded-[3px] border border-forest text-forest transition-colors hover:bg-petal disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={nextDisabled}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[3px] bg-forest px-4 text-sm font-medium text-cream transition-colors hover:bg-sage disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-forest"
          >
            {nextText}
            {state.currentStep < 4 && !busy && <ChevronRight className="size-4" />}
          </button>
          {(showSaveAndExit || showSkip) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="Mais ações"
                    className="flex size-11 shrink-0 items-center justify-center rounded-[3px] border border-forest text-forest transition-colors hover:bg-petal disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <MoreHorizontal className="size-5" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" side="top">
                {showSaveAndExit && (
                  <DropdownMenuItem onClick={handleSaveAndExit}>Salvar e sair</DropdownMenuItem>
                )}
                {showSkip && <DropdownMenuItem onClick={handleSkip}>{skipLabel}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Desktop */}
        <div className="mx-auto hidden items-center justify-between gap-3 px-6 py-3 md:flex">
          <div className="min-w-[100px]">
            {showBack && (
              <button
                type="button"
                onClick={prevStep}
                disabled={busy}
                className={cn(secondaryButton, 'flex items-center gap-1.5')}
              >
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </button>
            )}
          </div>

          <SaveStatusIndicator
            isSaving={state.isSaving}
            isDirty={!!stepDirty[state.currentStep]}
            lastSavedAt={state.stepTimestamps[STEP_TIMESTAMP_KEYS[state.currentStep]] ?? null}
            errorType={state.errorType}
            now={now}
          />

          <div className="flex items-center gap-3">
            {isFinalizeBlocked && (
              <p className="max-w-[260px] text-right text-[11px] text-mid">{finalizeBlockedText}</p>
            )}
            {showSkip && (
              <button type="button" onClick={handleSkip} disabled={busy} className={secondaryButton}>
                {skipLabel}
              </button>
            )}
            {showSaveAndExit && (
              <button type="button" onClick={handleSaveAndExit} disabled={busy} className={secondaryButton}>
                Salvar e sair
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              disabled={nextDisabled}
              className="flex min-h-12 items-center justify-center gap-1.5 rounded-[3px] bg-forest px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-sage disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-forest"
            >
              {nextText}
              {state.currentStep < 4 && !busy && <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </nav>

      <Dialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Sair do atendimento?</DialogTitle>
            <DialogDescription>
              As alterações ainda não salvas serão perdidas. A anamnese já salva
              automaticamente e os passos concluídos continuam guardados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setShowExitDialog(false)}
              className="rounded-[3px] border border-forest px-4 py-2 text-sm font-medium text-forest transition-colors hover:bg-petal"
            >
              Continuar atendimento
            </button>
            <button
              type="button"
              onClick={confirmExit}
              className="rounded-[3px] bg-forest px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-sage"
            >
              Sair sem salvar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
