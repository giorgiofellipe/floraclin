'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn, maskCPF } from '@/lib/utils'
import { useServiceWizard, type WizardStep } from '@/hooks/use-service-wizard'
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
import { SaveStatusIndicator } from './save-status-indicator'
import { AnamnesisForm } from '@/components/anamnesis/anamnesis-form'
import { ProcedureForm } from '@/components/procedures/procedure-form'
import { ProcedureApproval } from '@/components/procedures/procedure-approval'
import { ProcedureExecution } from '@/components/procedures/procedure-execution'
import type { StepResult, WizardOverrides } from './types'
import type { ProcedureStatus } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { AnamnesisFormData } from '@/validations/anamnesis'
import type { EvaluationTemplateForForm, ExistingEvaluationResponse } from '@/components/procedures/procedure-form'
import type { EvaluationSection, EvaluationResponses } from '@/types/evaluation'

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
  anamnesis?: (AnamnesisFormData & {
    id?: string
    updatedAt?: Date | string
    updatedBy?: string | null
  }) | null
  anamnesisUpdatedByName?: string
  stepTimestamps?: {
    anamnesis: Date | null
    procedureTypes: Date | null
    planning: Date | null
    approval: Date | null
    execution: Date | null
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function calculateAge(birthDate: string): number {
  const today = new Date()
  const birth = new Date(birthDate)
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
  anamnesisUpdatedByName,
  stepTimestamps,
}: ServiceWizardProps) {
  const router = useRouter()

  // Derive initial selected type IDs from existing procedure
  const initialSelectedTypeIds = (() => {
    if (!procedure) return []
    const ids: string[] = []
    if (procedure.procedureTypeId) ids.push(procedure.procedureTypeId)
    const additional = (procedure as unknown as Record<string, unknown>)?.additionalTypeIds
    if (Array.isArray(additional)) ids.push(...(additional as string[]))
    return ids
  })()

  const wizard = useServiceWizard({
    patientId: patient.id,
    initialStep,
    procedureId,
    procedureStatus,
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
    setSelectedTypeIds,
    clearError,
  } = wizard

  // ─── Lift procedure data into client state (CRITICAL 1 fix) ────
  const [localProcedure, setLocalProcedure] = useState<ProcedureWithDetails | null>(procedure ?? null)
  const [localDiagrams, setLocalDiagrams] = useState<DiagramWithPoints[] | null>(diagrams ?? null)
  const [localApplications, setLocalApplications] = useState<ProductApplicationRecord[] | null>(existingApplications ?? null)

  // Per-step dirty tracking + stable handlers
  const [stepDirty, setStepDirty] = useState<Record<number, boolean>>({})

  const dirtyHandlers = useMemo(
    () => ({
      1: (d: boolean) => setStepDirty((p) => (p[1] === d ? p : { ...p, 1: d })),
      2: (d: boolean) => setStepDirty((p) => (p[2] === d ? p : { ...p, 2: d })),
      3: (d: boolean) => setStepDirty((p) => (p[3] === d ? p : { ...p, 3: d })),
      4: (d: boolean) => setStepDirty((p) => (p[4] === d ? p : { ...p, 4: d })),
      5: (d: boolean) => setStepDirty((p) => (p[5] === d ? p : { ...p, 5: d })),
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
            sections: t.sections as EvaluationSection[],
            version: t.version,
          }))
          // Preserve the order from selectedTypeIds
          .sort((a: EvaluationTemplateForForm, b: EvaluationTemplateForForm) => typeIds.indexOf(a.procedureTypeId) - typeIds.indexOf(b.procedureTypeId))

        setEvalTemplates(formTemplates)
        setEvalTemplatesLoadedForIds(key)
      } catch {
        // Non-blocking — templates won't show
      } finally {
        setLoadingEvalTemplates(false)
      }
    }
    loadTemplates()
  }, [state.selectedTypeIds, evalTemplatesLoadedForIds])

  // Load existing evaluation responses when resuming a procedure
  // Re-run when navigating back to step 3 (responses may have been saved in a previous visit)
  useEffect(() => {
    if (!state.procedureId) return
    if (state.currentStep !== 3) return

    async function loadResponses() {
      try {
        const evalRes = await fetch(`/api/evaluation/responses/${state.procedureId}`)
        const responses = evalRes.ok ? await evalRes.json() : []
        if (responses && responses.length > 0) {
          setExistingEvalResponses(
            (responses as { templateId: string; responses: EvaluationResponses; templateSnapshot: unknown }[]).map((r) => ({
              templateId: r.templateId,
              responses: r.responses as EvaluationResponses,
              templateSnapshot: r.templateSnapshot as EvaluationSection[],
            }))
          )
        }
      } catch {
        // Non-blocking
      }
    }
    loadResponses()
  }, [state.procedureId, state.currentStep])

  // ─── beforeunload protection for steps 2-5 ─────────────────────

  useEffect(() => {
    if (state.currentStep === 1) return

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isExitingRef.current) return
      e.preventDefault()
    }

    function handlePopState() {
      if (isExitingRef.current) return // allow navigation when exiting
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

  // ─── Exit confirmation dialog ───────────────────────────────────

  const [showExitDialog, setShowExitDialog] = useState(false)

  const handleExit = useCallback(() => {
    if (state.currentStep > 1) {
      setShowExitDialog(true)
      return
    }
    router.push(`/pacientes/${patient.id}`)
  }, [state.currentStep, router, patient.id])

  const isExitingRef = useRef(false)
  // `pendingAction` is lifted to React state (not a ref) so `validationMode`
  // in getOverridesForStep can be derived safely during render. See the note
  // on getOverridesForStep for details.
  const [pendingAction, setPendingAction] = useState<'advance' | 'exit'>('advance')
  const confirmExit = useCallback(() => {
    isExitingRef.current = true
    setShowExitDialog(false)
    router.push(`/pacientes/${patient.id}`)
  }, [router, patient.id])

  // ─── Smart context message ─────────────────────────────────────

  function getContextMessage(): { text: string; dotColor: string } | null {
    const currentStatus = state.procedureStatus
    if (!currentStatus) {
      return { text: 'Novo atendimento', dotColor: 'bg-forest' }
    }
    if (currentStatus === 'planned') {
      const dateStr = state.stepTimestamps.planning
        ? format(new Date(state.stepTimestamps.planning), 'dd/MM/yyyy')
        : null
      return {
        text: dateStr
          ? `Continuando planejamento \u2014 criado em ${dateStr}`
          : 'Continuando planejamento',
        dotColor: 'bg-amber',
      }
    }
    if (currentStatus === 'approved') {
      return {
        text: 'Procedimento aprovado \u2014 pronto para execu\u00e7\u00e3o',
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
        // Update step timestamp on successful save
        const stepTimestampMap: Record<number, 'anamnesis' | 'procedureTypes' | 'planning' | 'approval' | 'execution'> = {
          1: 'anamnesis',
          2: 'procedureTypes',
          3: 'planning',
          4: 'approval',
          5: 'execution',
        }
        const timestampKey = stepTimestampMap[state.currentStep]
        if (timestampKey) {
          updateStepTimestamp(timestampKey, new Date())
        }

        // After step 3 creates/updates a procedure, fetch fresh data client-side
        if (state.currentStep === 3 && result.procedureId) {
          try {
            const fetchRes = await fetch(`/api/procedures/${result.procedureId}`)
            if (fetchRes.ok) {
              const procData = await fetchRes.json()
              setLocalProcedure(procData as ProcedureWithDetails)
              setLocalDiagrams((procData as { diagrams?: DiagramWithPoints[] }).diagrams ?? null)
              setLocalApplications((procData as { productApplications?: ProductApplicationRecord[] }).productApplications ?? null)
            }
          } catch {
            // Non-blocking — steps 4-5 will show placeholder if fetch fails
          }
        }

        // Update procedure status if the step changed it
        if (state.currentStep === 4) {
          updateProcedureStatus('approved')
        }

        // Exit path takes priority: if the user clicked "Salvar e sair" on
        // any step (including step 5), route out with the partial-save toast
        // — never show the terminal-finalize message.
        if (pending === 'exit') {
          isExitingRef.current = true
          toast.success('Atendimento salvo. Retome quando quiser.')
          router.push(`/pacientes/${patient.id}`)
          return
        }

        // Step 5 commit path: finalize + redirect
        if (state.currentStep === 5) {
          toast.success('Atendimento finalizado com sucesso')
          router.push(`/pacientes/${patient.id}`)
          return
        }

        // Don't auto-advance past step 3 if the server marked the procedure
        // as draft (missing financialPlan or diagram points). Stay on step 3
        // so the user can finish filling the required fields.
        if (state.currentStep === 3 && result.procedureStatus === 'draft') {
          console.log(
            '[wizard] staying on step 3 — server returned draft status (incomplete planning)',
          )
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
    [onSaveComplete, pendingAction, state.currentStep, nextStep, updateProcedureStatus, updateStepTimestamp, router, patient.id]
  )

  // ─── Skip/Adiar handler ────────────────────────────────────────

  const handleSkip = useCallback(() => {
    if (state.currentStep === 4) {
      // "Adiar Aprovação" — exits wizard
      toast.info('Atendimento salvo como planejado. Retorne para aprovar quando o paciente estiver pronto.')
      router.push(`/pacientes/${patient.id}`)
      return
    }
    // Regular skip — advance to next step
    nextStep()
  }, [state.currentStep, nextStep, router, patient.id])

  // ─── Next handler ──────────────────────────────────────────────
  //
  // On step 5 (Execução), "Próximo" becomes "Finalizar Atendimento" — a
  // terminal, irreversible action. Gate it behind a confirmation dialog so
  // the user doesn't accidentally lock the record.
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false)

  const handleNext = useCallback(() => {
    console.log('[wizard] handleNext clicked', {
      currentStep: state.currentStep,
      pendingAction,
      procedureStatus: state.procedureStatus,
      procedureId: state.procedureId,
    })
    if (state.currentStep === 5) {
      setShowFinalizeDialog(true)
      return
    }
    triggerSave()
  }, [state.currentStep, triggerSave, pendingAction, state.procedureStatus, state.procedureId])

  const confirmFinalize = useCallback(() => {
    setShowFinalizeDialog(false)
    triggerSave()
  }, [triggerSave])

  const handleSaveAndExit = useCallback(() => {
    setPendingAction('exit')
    triggerSave()
  }, [triggerSave])

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
  }

  // Each step gets triggerSave ONLY when it's the active step.
  // All steps are mounted simultaneously (display:none), so passing
  // triggerSave to all of them would cause all to fire at once.
  //
  // `validationMode` is derived from `pendingAction` STATE (not a ref) — reading
  // a mutable ref during render violates React concurrency guarantees. State
  // changes are committed before the form's triggerSave effect fires, so by
  // the time the form reads wizardOverrides.validationMode, the correct value
  // is visible.
  function getOverridesForStep(step: 1 | 2 | 3 | 4 | 5): WizardOverrides {
    const isFinalValidation = step === 3 && pendingAction === 'advance'
    // Step 5's Salvar e sair routes through the regular update endpoint to
    // avoid triggering the status transition from approved → executed.
    const saveMode: 'commit' | 'partial' =
      step === 5 && pendingAction === 'exit' ? 'partial' : 'commit'
    return {
      ...baseOverridesBase,
      triggerSave: state.currentStep === step ? state.triggerSave : 0,
      onDirtyChange: dirtyHandlers[step],
      onAutoSaved: step === 1 ? anamnesisOnAutoSaved : undefined,
      onUserEdit: handleUserEdit,
      validationMode: isFinalValidation ? 'final' : 'draft',
      saveMode,
    }
  }

  // ─── Derived state ─────────────────────────────────────────────

  const isReadOnlyAfterApproval =
    state.procedureStatus === 'approved' || state.procedureStatus === 'executed'

  // additionalTypeIds from procedure record
  const additionalTypeIds = (localProcedure?.additionalTypeIds as string[] | null) ?? []

  const showSaveAndExit =
    state.currentStep === 1 || state.currentStep === 3 || state.currentStep === 5

  // ─── Render ────────────────────────────────────────────────────

  const skipLabel = getSkipLabel(state.currentStep)
  const nextLabel = getNextLabel(state.currentStep)
  const showBack = state.currentStep > 1
  const showSkip = canSkip(state.currentStep)
  const age = patient.birthDate ? calculateAge(patient.birthDate) : null

  return (
    <div className="-m-6 flex min-h-screen flex-col bg-[#F4F6F8]">
      {/* ─── Unified header: patient + stepper ─────────────────────── */}
      <header className="sticky top-0 z-30 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-6 py-2.5">
          {/* Left: patient info */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex size-8 items-center justify-center rounded-full bg-sage/15 text-[12px] font-semibold text-sage">
              {patient.fullName.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="hidden sm:block">
              <p className="text-[13px] font-semibold text-charcoal leading-tight">{patient.fullName}</p>
              <p className="text-[11px] text-mid leading-tight">
                {age !== null && <>{age} anos</>}
                {age !== null && patient.phone && <> · </>}
                {patient.phone}
              </p>
            </div>
            {/* Mobile: just name */}
            <span className="sm:hidden text-[13px] font-semibold text-charcoal truncate max-w-[140px]">{patient.fullName}</span>
          </div>

          {/* Center: stepper (desktop only) */}
          <div className="hidden sm:block">
            <WizardStepper
              currentStep={state.currentStep}
              isStepAvailable={isStepAvailable}
              isStepCompleted={isStepCompleted}
              onStepClick={goToStep}
              disabled={state.isSaving}
            />
          </div>

          {/* Right: close */}
          <button
            type="button"
            onClick={handleExit}
            className="flex items-center justify-center size-8 rounded-lg text-mid transition-colors hover:bg-[#F4F6F8] hover:text-charcoal shrink-0"
            aria-label="Fechar atendimento"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Mobile: stepper on its own row */}
        <div className="sm:hidden border-t border-[#F4F6F8] px-4 py-2 flex justify-center">
          <WizardStepper
            currentStep={state.currentStep}
            isStepAvailable={isStepAvailable}
            isStepCompleted={isStepCompleted}
            onStepClick={goToStep}
            disabled={state.isSaving}
          />
        </div>

        {/* Context message — inside header as a subtle sub-bar */}
        {contextMessage && (
          <div className="border-t border-[#F4F6F8] px-6 py-1.5">
            <div className="flex items-center gap-2">
              <span className={cn('inline-block size-1.5 rounded-full', contextMessage.dotColor)} />
              <span className="text-[12px] text-mid">{contextMessage.text}</span>
            </div>
          </div>
        )}
      </header>

      {/* ─── Main content area ────────────────────────────────────── */}
      <main className="mx-auto flex w-full flex-1 flex-col gap-4 px-6 py-4 pb-52 md:pb-24">

        {/* Step content — all steps mounted, only active visible */}
        <div className="flex-1">
          {/* Step 1: Anamnese */}
          <div style={{ display: state.currentStep === 1 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Anamnese"
              timestamp={state.stepTimestamps.anamnesis}
            >
              {isReadOnlyAfterApproval && (
                <div className="mb-4 rounded-[3px] border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-800">
                    Anamnese não pode ser editada após aprovação do procedimento.
                  </p>
                </div>
              )}
              <div className={isReadOnlyAfterApproval ? 'pointer-events-none opacity-75' : undefined}>
                <AnamnesisForm
                  patientId={patient.id}
                  initialData={anamnesis ?? undefined}
                  updatedByName={anamnesisUpdatedByName}
                  wizardOverrides={getOverridesForStep(1)}
                />
              </div>
            </WizardStepWrapper>
          </div>

          {/* Step 2: Procedimentos (type selection) */}
          <div style={{ display: state.currentStep === 2 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Procedimentos"
              timestamp={state.stepTimestamps.procedureTypes}
            >
              {isReadOnlyAfterApproval && (
                <div className="mb-4 rounded-[3px] border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-800">
                    Tipos de procedimento não podem ser alterados após aprovação.
                  </p>
                </div>
              )}
              <div className={isReadOnlyAfterApproval ? 'pointer-events-none opacity-75' : undefined}>
                <ProcedureTypeStep
                  selectedTypeIds={state.selectedTypeIds}
                  onSelectedTypeIdsChange={setSelectedTypeIds}
                  wizardOverrides={getOverridesForStep(2)}
                  readOnly={isReadOnlyAfterApproval}
                />
              </div>
            </WizardStepWrapper>
          </div>

          {/* Step 3: Planejamento */}
          <div style={{ display: state.currentStep === 3 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Planejamento"
              timestamp={state.stepTimestamps.planning}
            >
              <ProcedureForm
                patientId={patient.id}
                patientGender={patient.gender}
                procedure={localProcedure ?? undefined}
                diagrams={localDiagrams ?? undefined}
                existingApplications={localApplications ?? undefined}
                initialTypeIds={state.selectedTypeIds}
                mode={
                  isReadOnlyAfterApproval
                    ? 'view'
                    : localProcedure
                      ? 'edit'
                      : 'create'
                }
                wizardOverrides={{ ...getOverridesForStep(3), hideProcedureTypes: true }}
                evaluationTemplates={evalTemplates.length > 0 ? evalTemplates : undefined}
                existingEvaluationResponses={existingEvalResponses.length > 0 ? existingEvalResponses : undefined}
                loadingEvaluationTemplates={loadingEvalTemplates}
              />
            </WizardStepWrapper>
          </div>

          {/* Step 4: Aprovação */}
          <div style={{ display: state.currentStep === 4 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Aprovação"
              timestamp={state.stepTimestamps.approval}
            >
              {state.procedureId && localProcedure ? (
                <ProcedureApproval
                  procedure={localProcedure}
                  diagrams={localDiagrams ?? []}
                  patient={{
                    id: patient.id,
                    fullName: patient.fullName,
                    cpf: patient.cpf,
                    gender: patient.gender,
                  }}
                  tenant={tenant}
                  additionalTypeIds={additionalTypeIds}
                  wizardOverrides={getOverridesForStep(4)}
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

          {/* Step 5: Execução */}
          <div style={{ display: state.currentStep === 5 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Execução"
              timestamp={state.stepTimestamps.execution}
            >
              {state.procedureId && state.procedureStatus === 'approved' && localProcedure ? (
                <ProcedureExecution
                  patientId={patient.id}
                  patientGender={patient.gender}
                  procedure={localProcedure}
                  diagrams={localDiagrams ?? undefined}
                  existingApplications={localApplications ?? undefined}
                  wizardOverrides={getOverridesForStep(5)}
                />
              ) : (
                <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                  <p className="text-mid">
                    Aprove o procedimento para acessar a execução.
                  </p>
                </div>
              )}
            </WizardStepWrapper>
          </div>
        </div>
      </main>

      {/* ─── Sticky bottom navigation bar ─────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 md:left-[200px] z-30 border-t border-gray-100 bg-white shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        {/* Error display above navigation controls */}
        {state.error && (
          <div className="border-b border-red-100 bg-red-50 px-6 py-2">
            <p className="mx-auto text-sm text-red-800">
              {state.errorType === 'validation' &&
                'Corrija os campos destacados antes de continuar.'}
              {state.errorType === 'precondition' && state.error}
              {state.errorType === 'server' && 'Erro ao salvar. Tente novamente.'}
              {!state.errorType && state.error}
            </p>
          </div>
        )}

        <div className="mx-auto flex flex-col gap-2 px-6 py-3 md:flex-row md:items-center md:justify-between">
          {/* Left: Voltar */}
          <div className="hidden md:block md:min-w-[100px]">
            {showBack && (
              <button
                type="button"
                onClick={prevStep}
                disabled={state.isSaving}
                className={cn(
                  'flex items-center gap-1.5 rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px]',
                  state.isSaving && 'opacity-50 cursor-not-allowed',
                )}
              >
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </button>
            )}
          </div>

          {/* Middle: save status indicator (desktop only) */}
          <SaveStatusIndicator
            isSaving={state.isSaving}
            isDirty={!!stepDirty[state.currentStep]}
            lastSavedAt={
              state.currentStep === 1 ? (state.stepTimestamps.anamnesis ?? null)
              : state.currentStep === 2 ? (state.stepTimestamps.procedureTypes ?? null)
              : state.currentStep === 3 ? (state.stepTimestamps.planning ?? null)
              : state.currentStep === 4 ? (state.stepTimestamps.approval ?? null)
              : (state.stepTimestamps.execution ?? null)
            }
            errorType={state.errorType}
            now={now}
          />

          {/* Mobile: full-width stacked buttons / Desktop: inline */}
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center md:gap-3">
            <button
              type="button"
              onClick={handleNext}
              disabled={state.isSaving}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-[3px] px-6 py-2.5 text-sm font-medium transition-colors min-h-[48px] md:w-auto md:order-3',
                'bg-forest text-cream hover:bg-sage',
                state.isSaving && 'opacity-50 cursor-not-allowed',
              )}
            >
              {state.isSaving ? 'Salvando...' : nextLabel}
              {state.currentStep < 5 && !state.isSaving && <ChevronRight className="h-4 w-4" />}
            </button>

            {showSaveAndExit && (
              <button
                type="button"
                onClick={handleSaveAndExit}
                disabled={state.isSaving}
                className={cn(
                  'w-full rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px] md:w-auto md:order-2',
                  state.isSaving && 'opacity-50 cursor-not-allowed',
                )}
              >
                Salvar e sair
              </button>
            )}

            {showSkip && skipLabel && (
              <button
                type="button"
                onClick={handleSkip}
                disabled={state.isSaving}
                className={cn(
                  'w-full rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px] md:w-auto md:order-1',
                  state.isSaving && 'opacity-50 cursor-not-allowed',
                )}
              >
                {skipLabel}
              </button>
            )}

            {showBack && (
              <button
                type="button"
                onClick={prevStep}
                disabled={state.isSaving}
                className={cn(
                  'flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px] md:hidden',
                  state.isSaving && 'opacity-50 cursor-not-allowed',
                )}
              >
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ─── Exit confirmation dialog ─────────────────────────────── */}
      <Dialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Fechar atendimento</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja sair? O progresso do passo atual será perdido.
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
              Sim, fechar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Finalize confirmation dialog (step 5 — irreversible) ──── */}
      <Dialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Finalizar atendimento</DialogTitle>
            <DialogDescription>
              Você está prestes a finalizar este atendimento. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-mid">
            Após confirmar, o registro fica bloqueado e nenhuma informação deste
            atendimento poderá mais ser alterada.
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setShowFinalizeDialog(false)}
              disabled={state.isSaving}
              className={cn(
                'rounded-[3px] border border-forest px-4 py-2 text-sm font-medium text-forest transition-colors hover:bg-petal',
                state.isSaving && 'opacity-50 cursor-not-allowed',
              )}
            >
              Voltar e revisar
            </button>
            <button
              type="button"
              onClick={confirmFinalize}
              disabled={state.isSaving}
              className={cn(
                'rounded-[3px] bg-forest px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-sage',
                state.isSaving && 'opacity-50 cursor-not-allowed',
              )}
            >
              {state.isSaving ? 'Finalizando...' : 'Sim, finalizar'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
