'use client'

import { useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, maskCPF } from '@/lib/utils'
import { useServiceWizard, type WizardStep } from '@/hooks/use-service-wizard'
import { WizardStepper } from './wizard-stepper'
import { WizardStep as WizardStepWrapper } from './wizard-step'
import type { ProcedureStatus } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

interface PatientInfo {
  id: string
  fullName: string
  birthDate: string | null
  phone: string
  cpf: string | null
}

interface ServiceWizardProps {
  patient: PatientInfo
  initialStep?: number
  procedureId?: string | null
  procedureStatus?: ProcedureStatus | null
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
  initialStep,
  procedureId,
  procedureStatus,
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
    canSkip,
    isStepAvailable,
    isStepCompleted,
    getSkipLabel,
    getNextLabel,
  } = wizard

  // ─── beforeunload protection for steps 2-4 ─────────────────────

  useEffect(() => {
    if (state.currentStep === 1) return

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [state.currentStep])

  // ─── Exit handler ──────────────────────────────────────────────

  const handleExit = useCallback(() => {
    if (state.currentStep > 1) {
      const confirmed = window.confirm(
        'Tem certeza que deseja sair? Dados nao salvos serao perdidos.'
      )
      if (!confirmed) return
    }
    router.push(`/pacientes/${patient.id}`)
  }, [state.currentStep, router, patient.id])

  // ─── Skip/Adiar handler ────────────────────────────────────────

  const handleSkip = useCallback(() => {
    if (state.currentStep === 3) {
      // "Adiar Aprovacao" — exits wizard
      router.push(`/pacientes/${patient.id}`)
      return
    }
    // Regular skip — advance to next step
    nextStep()
  }, [state.currentStep, nextStep, router, patient.id])

  // ─── Next handler ──────────────────────────────────────────────

  const handleNext = useCallback(() => {
    // In future tasks, step 2+ will trigger save via triggerSave.
    // For now (shell), just advance.
    if (state.currentStep === 4) {
      // Finalizar — would trigger save + redirect
      router.push(`/pacientes/${patient.id}`)
      return
    }
    nextStep()
  }, [state.currentStep, nextStep, router, patient.id])

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
          <div style={{ display: state.currentStep === 1 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Anamnese"
              timestamp={stepTimestamps?.anamnesis}
            >
              <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <p className="text-mid">Conteudo da Anamnese</p>
              </div>
            </WizardStepWrapper>
          </div>

          <div style={{ display: state.currentStep === 2 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Planejamento"
              timestamp={stepTimestamps?.planning}
            >
              <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <p className="text-mid">Conteudo do Planejamento</p>
              </div>
            </WizardStepWrapper>
          </div>

          <div style={{ display: state.currentStep === 3 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Aprovacao"
              timestamp={stepTimestamps?.approval}
            >
              <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <p className="text-mid">Conteudo da Aprovacao</p>
              </div>
            </WizardStepWrapper>
          </div>

          <div style={{ display: state.currentStep === 4 ? 'block' : 'none' }}>
            <WizardStepWrapper
              title="Execucao"
              timestamp={stepTimestamps?.execution}
            >
              <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <p className="text-mid">Conteudo da Execucao</p>
              </div>
            </WizardStepWrapper>
          </div>
        </div>
      </main>

      {/* ─── Sticky bottom navigation bar ─────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-100 bg-white shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          {/* Left: Voltar */}
          <div className="min-w-[100px]">
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

          {/* Center + Right: Skip + Next */}
          <div className="flex items-center gap-3">
            {showSkip && skipLabel && (
              <button
                type="button"
                onClick={handleSkip}
                className="rounded-[3px] border border-forest px-4 py-2.5 text-sm font-medium text-forest transition-colors hover:bg-petal min-h-[48px]"
              >
                {skipLabel}
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              disabled={state.isSaving}
              className={cn(
                'flex items-center gap-1.5 rounded-[3px] px-6 py-2.5 text-sm font-medium transition-colors min-h-[48px]',
                'bg-forest text-cream hover:bg-sage',
                state.isSaving && 'opacity-50 cursor-not-allowed',
              )}
            >
              {nextLabel}
              {state.currentStep < 4 && <ChevronRight className="h-4 w-4" />}
            </button>
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
    </div>
  )
}
