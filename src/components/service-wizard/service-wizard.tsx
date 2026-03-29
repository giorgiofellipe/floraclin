'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { LogOut, ChevronLeft, ChevronRight } from 'lucide-react'
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

  const wizard = useServiceWizard({
    patientId: patient.id,
    initialStep,
    procedureId,
    procedureStatus,
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
  } = wizard

  // ─── beforeunload protection for steps 2-4 ─────────────────────

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

    // Push an extra history entry so we can intercept back
    window.history.pushState(null, '', window.location.href)

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
    if (!procedureStatus) {
      return { text: 'Novo atendimento', dotColor: 'bg-forest' }
    }
    if (procedureStatus === 'planned') {
      const dateStr = stepTimestamps?.planning
        ? format(new Date(stepTimestamps.planning), 'dd/MM/yyyy')
        : null
      return {
        text: dateStr
          ? `Continuando planejamento \u2014 criado em ${dateStr}`
          : 'Continuando planejamento',
        dotColor: 'bg-amber',
      }
    }
    if (procedureStatus === 'approved') {
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
    (result: StepResult) => {
      onSaveComplete(result)

      if (result.success) {
        // Update procedure status if the step changed it
        if (state.currentStep === 3) {
          updateProcedureStatus('approved')
        }
        if (state.currentStep === 4) {
          // Execution complete — redirect to patient detail
          toast.success('Atendimento finalizado com sucesso')
          router.push(`/pacientes/${patient.id}`)
          return
        }
        // Auto-advance to next step after successful save
        nextStep()
      }
    },
    [onSaveComplete, state.currentStep, nextStep, updateProcedureStatus, router, patient.id]
  )

  // ─── Skip/Adiar handler ────────────────────────────────────────

  const handleSkip = useCallback(() => {
    if (state.currentStep === 3) {
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
    // Step 2: creates/updates procedure and advances on success
    // Step 3: calls approveProcedureAction and advances on success
    // Step 4: calls executeProcedureAction and redirects on success
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
  const additionalTypeIds = (procedure?.additionalTypeIds as string[] | null) ?? []

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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
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
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </header>

      {/* ─── Smart context message ─────────────────────────────────── */}
      {contextMessage && (
        <div className="mx-auto w-full max-w-5xl px-4 pt-3">
          <div className="flex items-center gap-2">
            <span className={cn('inline-block h-2 w-2 rounded-full', contextMessage.dotColor)} />
            <span className="text-sm text-mid">{contextMessage.text}</span>
          </div>
        </div>
      )}

      {/* ─── Main content area ────────────────────────────────────── */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-4 pb-24">
        {/* Stepper */}
        <WizardStepper
          currentStep={state.currentStep}
          isStepAvailable={isStepAvailable}
          isStepCompleted={isStepCompleted}
          onStepClick={goToStep}
        />

        {/* Step content — all steps mounted, only active visible */}
        <div className="flex-1">
          {/* Step 1: Anamnese */}
          <div style={{ display: state.currentStep === 1 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Anamnese"
              timestamp={stepTimestamps?.anamnesis}
            >
              <AnamnesisForm
                patientId={patient.id}
                initialData={anamnesis ?? undefined}
                updatedByName={anamnesisUpdatedByName}
                wizardOverrides={baseOverrides}
              />
            </WizardStepWrapper>
          </div>

          {/* Step 2: Planejamento */}
          <div style={{ display: state.currentStep === 2 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Planejamento"
              timestamp={stepTimestamps?.planning}
            >
              <ProcedureForm
                patientId={patient.id}
                patientGender={patient.gender}
                procedure={procedure ?? undefined}
                diagrams={diagrams ?? undefined}
                existingApplications={existingApplications ?? undefined}
                mode={
                  isReadOnlyAfterApproval
                    ? 'view'
                    : procedure
                      ? 'edit'
                      : 'create'
                }
                wizardOverrides={baseOverrides}
              />
            </WizardStepWrapper>
          </div>

          {/* Step 3: Aprovacao */}
          <div style={{ display: state.currentStep === 3 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Aprovacao"
              timestamp={stepTimestamps?.approval}
            >
              {state.procedureId && procedure ? (
                <ProcedureApproval
                  procedure={procedure}
                  diagrams={diagrams ?? []}
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
                    Complete o planejamento para acessar a aprovacao.
                  </p>
                </div>
              )}
            </WizardStepWrapper>
          </div>

          {/* Step 4: Execucao */}
          <div style={{ display: state.currentStep === 4 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Execucao"
              timestamp={stepTimestamps?.execution}
            >
              {state.procedureId && state.procedureStatus === 'approved' && procedure ? (
                <ProcedureExecution
                  patientId={patient.id}
                  patientGender={patient.gender}
                  procedure={procedure}
                  diagrams={diagrams ?? undefined}
                  existingApplications={existingApplications ?? undefined}
                  wizardOverrides={baseOverrides}
                />
              ) : (
                <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                  <p className="text-mid">
                    Aprove o procedimento para acessar a execucao.
                  </p>
                </div>
              )}
            </WizardStepWrapper>
          </div>
        </div>
      </main>

      {/* ─── Sticky bottom navigation bar ─────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-100 bg-white shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
          {/* Left: Voltar */}
          <div className="hidden md:block md:min-w-[100px]">
            {showBack && (
              <button
                type="button"
                onClick={prevStep}
                className="flex items-center gap-1.5 rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px]"
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
              {state.currentStep < 4 && !state.isSaving && <ChevronRight className="h-4 w-4" />}
            </button>

            {showSkip && skipLabel && (
              <button
                type="button"
                onClick={handleSkip}
                className="w-full rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px] md:w-auto md:order-1"
              >
                {skipLabel}
              </button>
            )}

            {showBack && (
              <button
                type="button"
                onClick={prevStep}
                className="flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px] md:hidden"
              >
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </button>
            )}
          </div>
        </div>

        {/* Error display inline below nav bar */}
        {state.error && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-2">
            <p className="mx-auto max-w-5xl text-sm text-red-800">
              {state.errorType === 'validation' &&
                'Corrija os campos destacados antes de continuar.'}
              {state.errorType === 'precondition' && state.error}
              {state.errorType === 'server' && 'Erro ao salvar. Tente novamente.'}
              {!state.errorType && state.error}
            </p>
          </div>
        )}
      </nav>

      {/* ─── Exit confirmation dialog ─────────────────────────────── */}
      <Dialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Sair do atendimento</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja sair? O progresso do passo atual sera perdido.
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
              Sair
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
