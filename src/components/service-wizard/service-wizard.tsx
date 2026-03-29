'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { AnamnesisForm } from '@/components/anamnesis/anamnesis-form'
import { ProcedureForm } from '@/components/procedures/procedure-form'
import { ProcedureApproval } from '@/components/procedures/procedure-approval'
import { ProcedureExecution } from '@/components/procedures/procedure-execution'
import type { StepResult } from './types'
import type { ProcedureStatus } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { AnamnesisFormData } from '@/validations/anamnesis'
import { getProcedureAction } from '@/actions/procedures'
import { getTemplatesForProcedureTypesAction } from '@/actions/evaluation-templates'
import { getEvaluationResponsesForProcedureAction } from '@/actions/evaluation-responses'
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
  } = wizard

  // ─── Lift procedure data into client state (CRITICAL 1 fix) ────
  const [localProcedure, setLocalProcedure] = useState<ProcedureWithDetails | null>(procedure ?? null)
  const [localDiagrams, setLocalDiagrams] = useState<DiagramWithPoints[] | null>(diagrams ?? null)
  const [localApplications, setLocalApplications] = useState<ProductApplicationRecord[] | null>(existingApplications ?? null)

  // ─── Evaluation templates + responses ─────────────────────────
  const [evalTemplates, setEvalTemplates] = useState<EvaluationTemplateForForm[]>([])
  const [existingEvalResponses, setExistingEvalResponses] = useState<ExistingEvaluationResponse[]>([])
  const [evalTemplatesLoadedForIds, setEvalTemplatesLoadedForIds] = useState<string>('')

  // Load evaluation templates when selectedTypeIds change
  useEffect(() => {
    const typeIds = state.selectedTypeIds
    const key = typeIds.slice().sort().join(',')
    if (!key || key === evalTemplatesLoadedForIds) return

    async function loadTemplates() {
      try {
        const templates = await getTemplatesForProcedureTypesAction(typeIds)
        // We need procedure type names — load them from the procedure type step data
        // Templates are returned with procedureTypeId, we need names
        // Fetch procedure types for names (re-use the action from procedures)
        const { listProcedureTypesAction } = await import('@/actions/procedures')
        const allTypes = await listProcedureTypesAction()

        const typeNameMap = new Map<string, string>()
        for (const t of allTypes as { id: string; name: string }[]) {
          typeNameMap.set(t.id, t.name)
        }

        const formTemplates: EvaluationTemplateForForm[] = templates
          .filter((t) => typeIds.includes(t.procedureTypeId))
          .map((t) => ({
            id: t.id,
            procedureTypeId: t.procedureTypeId,
            procedureTypeName: typeNameMap.get(t.procedureTypeId) ?? 'Procedimento',
            sections: t.sections as EvaluationSection[],
            version: t.version,
          }))
          // Preserve the order from selectedTypeIds
          .sort((a, b) => typeIds.indexOf(a.procedureTypeId) - typeIds.indexOf(b.procedureTypeId))

        setEvalTemplates(formTemplates)
        setEvalTemplatesLoadedForIds(key)
      } catch {
        // Non-blocking — templates won't show
      }
    }
    loadTemplates()
  }, [state.selectedTypeIds, evalTemplatesLoadedForIds])

  // Load existing evaluation responses when resuming a procedure
  useEffect(() => {
    if (!state.procedureId) return

    async function loadResponses() {
      try {
        const responses = await getEvaluationResponsesForProcedureAction(state.procedureId!)
        if (responses && responses.length > 0) {
          setExistingEvalResponses(
            responses.map((r) => ({
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
  }, [state.procedureId])

  // ─── beforeunload protection for steps 2-5 ─────────────────────

  useEffect(() => {
    if (state.currentStep === 1) return

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }

    function handlePopState() {
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

  const confirmExit = useCallback(() => {
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
            const res = await getProcedureAction(result.procedureId)
            if (res.success && res.data) {
              setLocalProcedure(res.data as ProcedureWithDetails)
              setLocalDiagrams((res.data as { diagrams?: DiagramWithPoints[] }).diagrams ?? null)
              setLocalApplications((res.data as { productApplications?: ProductApplicationRecord[] }).productApplications ?? null)
            }
          } catch {
            // Non-blocking — steps 4-5 will show placeholder if fetch fails
          }
        }

        // Update procedure status if the step changed it
        if (state.currentStep === 4) {
          updateProcedureStatus('approved')
        }
        if (state.currentStep === 5) {
          // Execution complete — redirect to patient detail
          toast.success('Atendimento finalizado com sucesso')
          router.push(`/pacientes/${patient.id}`)
          return
        }
        // Auto-advance to next step after successful save
        nextStep()
      }
    },
    [onSaveComplete, state.currentStep, nextStep, updateProcedureStatus, updateStepTimestamp, router, patient.id]
  )

  // ─── Skip/Adiar handler ────────────────────────────────────────

  const handleSkip = useCallback(() => {
    if (state.currentStep === 4) {
      // "Adiar Aprovacao" — exits wizard
      toast.info('Atendimento salvo como planejado. Retorne para aprovar quando o paciente estiver pronto.')
      router.push(`/pacientes/${patient.id}`)
      return
    }
    // Regular skip — advance to next step
    nextStep()
  }, [state.currentStep, nextStep, router, patient.id])

  // ─── Next handler ──────────────────────────────────────────────

  const handleNext = useCallback(() => {
    // All steps trigger save via triggerSave.
    // Step 1: flushes debounce and advances on success
    // Step 2: validates type selection (no server save) and advances
    // Step 3: creates/updates procedure and advances on success
    // Step 4: calls approveProcedureAction and advances on success
    // Step 5: calls executeProcedureAction and redirects on success
    triggerSave()
  }, [triggerSave])

  // ─── Wizard overrides for each step ────────────────────────────

  const baseOverrides = {
    hideSaveButton: true,
    hideNavigation: true,
    hideTitle: true,
    onSaveComplete: handleStepComplete,
    triggerSave: state.triggerSave,
  }

  // ─── Derived state ─────────────────────────────────────────────

  const isReadOnlyAfterApproval =
    state.procedureStatus === 'approved' || state.procedureStatus === 'executed'

  // additionalTypeIds from procedure record
  const additionalTypeIds = (localProcedure?.additionalTypeIds as string[] | null) ?? []

  // ─── Render ────────────────────────────────────────────────────

  const skipLabel = getSkipLabel(state.currentStep)
  const nextLabel = getNextLabel(state.currentStep)
  const showBack = state.currentStep > 1
  const showSkip = canSkip(state.currentStep)
  const age = patient.birthDate ? calculateAge(patient.birthDate) : null

  return (
    <div className="flex min-h-screen flex-col bg-[#F4F6F8]">
      {/* ─── Patient compact bar ──────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold text-charcoal">{patient.fullName}</span>
            {age !== null && (
              <span className="text-mid">{age} anos</span>
            )}
            <span className="text-mid">{patient.phone}</span>
            {patient.cpf && (
              <span className="text-mid">{maskCPF(patient.cpf)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleExit}
            className="flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-sm font-medium text-mid transition-colors hover:bg-petal hover:text-charcoal"
          >
            <X className="h-4 w-4" />
            Fechar
          </button>
        </div>
      </header>

      {/* ─── Smart context message ─────────────────────────────────── */}
      {contextMessage && (
        <div className="mx-auto w-full px-4 pt-3">
          <div className="flex items-center gap-2">
            <span className={cn('inline-block h-2 w-2 rounded-full', contextMessage.dotColor)} />
            <span className="text-sm text-mid">{contextMessage.text}</span>
          </div>
        </div>
      )}

      {/* ─── Main content area ────────────────────────────────────── */}
      <main className="mx-auto flex w-full flex-1 flex-col gap-4 px-4 py-4 pb-24">
        {/* Stepper */}
        <WizardStepper
          currentStep={state.currentStep}
          isStepAvailable={isStepAvailable}
          isStepCompleted={isStepCompleted}
          onStepClick={goToStep}
          disabled={state.isSaving}
        />

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
                  wizardOverrides={baseOverrides}
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
                  wizardOverrides={baseOverrides}
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
                wizardOverrides={{ ...baseOverrides, hideProcedureTypes: true }}
                evaluationTemplates={evalTemplates.length > 0 ? evalTemplates : undefined}
                existingEvaluationResponses={existingEvalResponses.length > 0 ? existingEvalResponses : undefined}
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
                  wizardOverrides={baseOverrides}
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
                  wizardOverrides={baseOverrides}
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
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-100 bg-white shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        {/* Error display above navigation controls */}
        {state.error && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2">
            <p className="mx-auto text-sm text-red-800">
              {state.errorType === 'validation' &&
                'Corrija os campos destacados antes de continuar.'}
              {state.errorType === 'precondition' && state.error}
              {state.errorType === 'server' && 'Erro ao salvar. Tente novamente.'}
              {!state.errorType && state.error}
            </p>
          </div>
        )}

        <div className="mx-auto flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
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

          {/* Mobile: full-width stacked buttons / Desktop: inline */}
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center md:gap-3">
            <button
              type="button"
              onClick={handleNext}
              disabled={state.isSaving}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-[3px] px-6 py-2.5 text-sm font-medium transition-colors min-h-[48px] md:w-auto md:order-2',
                'bg-forest text-cream hover:bg-sage',
                state.isSaving && 'opacity-50 cursor-not-allowed',
              )}
            >
              {state.isSaving ? 'Salvando...' : nextLabel}
              {state.currentStep < 5 && !state.isSaving && <ChevronRight className="h-4 w-4" />}
            </button>

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
    </div>
  )
}
