'use client'

import { useReducer, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { ProcedureStatus } from '@/types'
import type { StepResult } from '@/components/service-wizard/types'

// ─── Types ──────────────────────────────────────────────────────────

export type WizardStep = 1 | 2 | 3 | 4

export interface WizardState {
  currentStep: WizardStep
  procedureId: string | null
  procedureStatus: ProcedureStatus | null
  stepTimestamps: {
    anamnesis: Date | null
    planning: Date | null
    approval: Date | null
    execution: Date | null
  }
  error: string | null
  errorType: 'validation' | 'precondition' | 'server' | null
  isSaving: boolean
  triggerSave: number
}

type WizardAction =
  | { type: 'GO_TO_STEP'; step: WizardStep }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_PROCEDURE_ID'; procedureId: string; status: ProcedureStatus }
  | { type: 'SET_ERROR'; error: string; errorType: 'validation' | 'precondition' | 'server' }
  | { type: 'CLEAR_ERROR' }
  | { type: 'TRIGGER_SAVE' }
  | { type: 'SAVE_COMPLETE'; result: StepResult }
  | { type: 'SET_SAVING'; isSaving: boolean }
  | { type: 'UPDATE_PROCEDURE_STATUS'; status: ProcedureStatus }
  | { type: 'UPDATE_STEP_TIMESTAMP'; step: 'anamnesis' | 'planning' | 'approval' | 'execution'; timestamp: Date }

// ─── Step labels ────────────────────────────────────────────────────

export const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Anamnese',
  2: 'Planejamento',
  3: 'Aprovação',
  4: 'Execução',
}

export const STEP_SUBTITLES: Record<WizardStep, string> = {
  1: 'Histórico e avaliação do paciente',
  2: 'Diagrama facial e orçamento',
  3: 'Consentimento e contrato',
  4: 'Registro do procedimento',
}

// ─── Unavailable step reasons ───────────────────────────────────────

export const STEP_UNAVAILABLE_REASONS: Record<WizardStep, string> = {
  1: '',
  2: '',
  3: 'Complete o planejamento para acessar a aprovação',
  4: 'Aprove o procedimento para acessar a execução',
}

// ─── Reducer ────────────────────────────────────────────────────────

function getNextStep(current: WizardStep): WizardStep {
  return Math.min(current + 1, 4) as WizardStep
}

function getPrevStep(current: WizardStep): WizardStep {
  return Math.max(current - 1, 1) as WizardStep
}

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'GO_TO_STEP':
      return {
        ...state,
        currentStep: action.step,
        error: null,
        errorType: null,
      }

    case 'NEXT_STEP': {
      const nextStep = getNextStep(state.currentStep)
      if (nextStep === state.currentStep) return state
      // Check availability before advancing
      if (nextStep === 3 && !state.procedureId) return state
      if (nextStep === 4 && state.procedureStatus !== 'approved') return state
      return {
        ...state,
        currentStep: nextStep,
        error: null,
        errorType: null,
      }
    }

    case 'PREV_STEP':
      return {
        ...state,
        currentStep: getPrevStep(state.currentStep),
        error: null,
        errorType: null,
      }

    case 'SET_PROCEDURE_ID':
      return {
        ...state,
        procedureId: action.procedureId,
        procedureStatus: action.status,
      }

    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
        errorType: action.errorType,
        isSaving: false,
      }

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null,
        errorType: null,
      }

    case 'TRIGGER_SAVE':
      return {
        ...state,
        triggerSave: state.triggerSave + 1,
        isSaving: true,
        error: null,
        errorType: null,
      }

    case 'SAVE_COMPLETE': {
      const newState = { ...state, isSaving: false }
      if (action.result.success) {
        if (action.result.procedureId) {
          newState.procedureId = action.result.procedureId
        }
        newState.error = null
        newState.errorType = null
      } else {
        newState.error = action.result.error ?? 'Erro desconhecido'
        newState.errorType = action.result.errorType ?? 'server'
      }
      return newState
    }

    case 'SET_SAVING':
      return { ...state, isSaving: action.isSaving }

    case 'UPDATE_PROCEDURE_STATUS':
      return { ...state, procedureStatus: action.status }

    case 'UPDATE_STEP_TIMESTAMP':
      return {
        ...state,
        stepTimestamps: {
          ...state.stepTimestamps,
          [action.step]: action.timestamp,
        },
      }

    default:
      return state
  }
}

// ─── Determine initial step ─────────────────────────────────────────

function determineInitialStep(
  urlStep: number | null,
  procedureStatus: ProcedureStatus | null,
  procedureId: string | null,
): WizardStep {
  // Determine the "natural" step based on procedure status
  let naturalStep: WizardStep = 1
  if (procedureStatus === 'approved') {
    naturalStep = 4
  } else if (procedureStatus === 'planned' && procedureId) {
    naturalStep = 3
  }

  // If URL provides a step, validate it
  if (urlStep && urlStep >= 1 && urlStep <= 4) {
    const requestedStep = urlStep as WizardStep

    // Cannot go to step 3 without a procedure
    if (requestedStep === 3 && !procedureId) return naturalStep
    // Cannot go to step 4 without approved status
    if (requestedStep === 4 && procedureStatus !== 'approved') return naturalStep

    return requestedStep
  }

  return naturalStep
}

// ─── Hook ───────────────────────────────────────────────────────────

interface UseServiceWizardOptions {
  patientId: string
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

export function useServiceWizard({
  patientId,
  initialStep,
  procedureId: initialProcedureId,
  procedureStatus: initialProcedureStatus,
  stepTimestamps: initialTimestamps,
}: UseServiceWizardOptions) {
  const router = useRouter()

  const startStep = determineInitialStep(
    initialStep ?? null,
    initialProcedureStatus ?? null,
    initialProcedureId ?? null,
  )

  const [state, dispatch] = useReducer(wizardReducer, {
    currentStep: startStep,
    procedureId: initialProcedureId ?? null,
    procedureStatus: initialProcedureStatus ?? null,
    stepTimestamps: initialTimestamps ?? {
      anamnesis: null,
      planning: null,
      approval: null,
      execution: null,
    },
    error: null,
    errorType: null,
    isSaving: false,
    triggerSave: 0,
  })

  // ─── URL sync ───────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const currentParam = params.get('step')
    if (currentParam !== String(state.currentStep)) {
      params.set('step', String(state.currentStep))
      router.replace(`?${params.toString()}`, { scroll: false })
    }
  }, [state.currentStep, router])

  // ─── Step availability ──────────────────────────────────────────

  const isStepAvailable = useCallback(
    (step: WizardStep): boolean => {
      switch (step) {
        case 1:
        case 2:
          return true
        case 3:
          return !!state.procedureId
        case 4:
          return state.procedureStatus === 'approved'
        default:
          return false
      }
    },
    [state.procedureId, state.procedureStatus]
  )

  // ─── Step completion ────────────────────────────────────────────

  const isStepCompleted = useCallback(
    (step: WizardStep): boolean => {
      switch (step) {
        case 1:
          return !!state.stepTimestamps.anamnesis
        case 2:
          return !!state.procedureId
        case 3:
          return state.procedureStatus === 'approved'
        case 4:
          return state.procedureStatus === 'executed'
        default:
          return false
      }
    },
    [state.stepTimestamps.anamnesis, state.procedureId, state.procedureStatus]
  )

  // ─── Skip logic ─────────────────────────────────────────────────

  const canSkip = useCallback(
    (step: WizardStep): boolean => {
      switch (step) {
        case 1:
          return !!state.stepTimestamps.anamnesis
        case 2:
          return false // required
        case 3:
          return true // "Adiar Aprovacao"
        case 4:
          return false // final step
        default:
          return false
      }
    },
    [state.stepTimestamps.anamnesis]
  )

  // ─── Read-only check (after approval, steps 1-2 are read-only) ─

  const isStepReadOnly = useCallback(
    (step: WizardStep): boolean => {
      if (step === 1 || step === 2) {
        return state.procedureStatus === 'approved'
      }
      return false
    },
    [state.procedureStatus]
  )

  // ─── Skip button label ──────────────────────────────────────────

  const getSkipLabel = useCallback(
    (step: WizardStep): string | null => {
      if (!canSkip(step)) return null
      if (step === 3) return 'Adiar Aprovação'
      return 'Pular'
    },
    [canSkip]
  )

  // ─── Next button label ─────────────────────────────────────────

  const getNextLabel = useCallback(
    (step: WizardStep): string => {
      if (step === 4) return 'Finalizar Atendimento'
      return 'Próximo'
    },
    []
  )

  // ─── Navigation actions ─────────────────────────────────────────

  const goToStep = useCallback(
    (step: WizardStep) => {
      if (isStepAvailable(step)) {
        dispatch({ type: 'GO_TO_STEP', step })
      }
    },
    [isStepAvailable]
  )

  const nextStep = useCallback(() => {
    dispatch({ type: 'NEXT_STEP' })
  }, [])

  const prevStep = useCallback(() => {
    dispatch({ type: 'PREV_STEP' })
  }, [])

  const triggerSave = useCallback(() => {
    dispatch({ type: 'TRIGGER_SAVE' })
  }, [])

  const onSaveComplete = useCallback(
    (result: StepResult) => {
      dispatch({ type: 'SAVE_COMPLETE', result })

      if (result.success) {
        if (result.procedureId && !state.procedureId) {
          dispatch({
            type: 'SET_PROCEDURE_ID',
            procedureId: result.procedureId,
            status: 'planned',
          })
        }
      }
    },
    [state.procedureId]
  )

  const setError = useCallback(
    (error: string, errorType: 'validation' | 'precondition' | 'server') => {
      dispatch({ type: 'SET_ERROR', error, errorType })
    },
    []
  )

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' })
  }, [])

  const setProcedureId = useCallback(
    (procedureId: string, status: ProcedureStatus) => {
      dispatch({ type: 'SET_PROCEDURE_ID', procedureId, status })
    },
    []
  )

  const updateProcedureStatus = useCallback((status: ProcedureStatus) => {
    dispatch({ type: 'UPDATE_PROCEDURE_STATUS', status })
  }, [])

  const updateStepTimestamp = useCallback(
    (step: 'anamnesis' | 'planning' | 'approval' | 'execution', timestamp: Date) => {
      dispatch({ type: 'UPDATE_STEP_TIMESTAMP', step, timestamp })
    },
    []
  )

  return {
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
    setError,
    clearError,
    setProcedureId,
    updateProcedureStatus,
    updateStepTimestamp,
    patientId,
  }
}

export type UseServiceWizardReturn = ReturnType<typeof useServiceWizard>
