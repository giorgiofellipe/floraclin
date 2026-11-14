'use client'

import { useReducer, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { ProcedureStatus } from '@/types'
import type { StepResult } from '@/components/service-wizard/types'
import type { EncounterCart } from '@/validations/encounter-cart'

// ─── Types ──────────────────────────────────────────────────────────

export type WizardStep = 1 | 2 | 3 | 4

export const WIZARD_STEPS: WizardStep[] = [1, 2, 3, 4]

const EMPTY_CART: EncounterCart = {
  templateId: null,
  templateName: null,
  templateDefaultPrice: null,
  templateValidityMonths: null,
  lines: [],
  totalOverride: null,
}

export type StepTimestampKey = 'anamnesis' | 'planning' | 'approval' | 'execution'
export type StepTimestamps = Record<StepTimestampKey, Date | null>

export const STEP_TIMESTAMP_KEYS: Record<WizardStep, StepTimestampKey> = {
  1: 'anamnesis',
  2: 'planning',
  3: 'approval',
  4: 'execution',
}

export interface WizardState {
  currentStep: WizardStep
  // Legacy single-procedure id — kept during transition (first draft record id)
  procedureId: string | null
  // After finalization, the full set of record ids returned by the API
  procedureRecordIds: string[]
  encounterId: string | null
  procedureStatus: ProcedureStatus | null
  // Mirror of cart.lines.map(l => l.procedureTypeId) for legacy callsites
  selectedTypeIds: string[]
  cart: EncounterCart
  stepTimestamps: StepTimestamps
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
  | { type: 'SET_SELECTED_TYPES'; typeIds: string[] }
  | { type: 'SET_CART'; cart: EncounterCart }
  | { type: 'SET_ENCOUNTER_ID'; encounterId: string }
  | { type: 'SET_PROCEDURE_RECORD_IDS'; procedureRecordIds: string[] }
  | { type: 'SET_ERROR'; error: string; errorType: 'validation' | 'precondition' | 'server' }
  | { type: 'CLEAR_ERROR' }
  | { type: 'TRIGGER_SAVE' }
  | { type: 'SAVE_COMPLETE'; result: StepResult }
  | { type: 'SET_SAVING'; isSaving: boolean }
  | { type: 'UPDATE_PROCEDURE_STATUS'; status: ProcedureStatus }
  | { type: 'UPDATE_STEP_TIMESTAMP'; step: StepTimestampKey; timestamp: Date }

// ─── Step labels ────────────────────────────────────────────────────

export const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Anamnese',
  2: 'Planejamento',
  3: 'Aprovação',
  4: 'Execução',
}

// ─── Unavailable step reasons ───────────────────────────────────────

export const STEP_UNAVAILABLE_REASONS: Record<WizardStep, string> = {
  1: '',
  2: '',
  3: 'Complete o planejamento para acessar a aprovação',
  4: 'Aprove o procedimento para acessar a execução',
}

const PLANNED_OR_LATER: (ProcedureStatus | null)[] = ['planned', 'approved', 'in_progress', 'completed']
const APPROVED_OR_LATER: (ProcedureStatus | null)[] = ['approved', 'in_progress', 'completed']

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
      if (nextStep === state.currentStep) {
        console.log('[wizard/reducer] NEXT_STEP ignored — already at last step')
        return state
      }
      // Approval needs a fully planned procedure (drafts stay in planning)
      if (nextStep === 3 && !PLANNED_OR_LATER.includes(state.procedureStatus)) {
        console.log('[wizard/reducer] NEXT_STEP to 3 blocked', { procedureStatus: state.procedureStatus })
        return state
      }
      if (nextStep === 4 && !APPROVED_OR_LATER.includes(state.procedureStatus)) {
        console.log('[wizard/reducer] NEXT_STEP to 4 blocked', { procedureStatus: state.procedureStatus })
        return state
      }
      console.log('[wizard/reducer] NEXT_STEP advancing', {
        from: state.currentStep,
        to: nextStep,
      })
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

    case 'SET_SELECTED_TYPES':
      return {
        ...state,
        selectedTypeIds: action.typeIds,
      }

    case 'SET_CART':
      return {
        ...state,
        cart: action.cart,
        selectedTypeIds: action.cart.lines.map((l) => l.procedureTypeId),
      }

    case 'SET_ENCOUNTER_ID':
      return {
        ...state,
        encounterId: action.encounterId,
      }

    case 'SET_PROCEDURE_RECORD_IDS':
      return {
        ...state,
        procedureRecordIds: action.procedureRecordIds,
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
      const newState = {
        ...state,
        isSaving: false,
        // Reset triggerSave so the next step doesn't inherit a stale non-zero value
        triggerSave: 0,
      }
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
  let naturalStep: WizardStep = 1
  if (APPROVED_OR_LATER.includes(procedureStatus)) {
    naturalStep = 4
  } else if (procedureStatus === 'planned' && procedureId) {
    naturalStep = 3
  } else if (procedureStatus === 'draft' && procedureId) {
    naturalStep = 2
  }

  if (urlStep && urlStep >= 1 && urlStep <= 4) {
    const requestedStep = urlStep as WizardStep
    if (requestedStep === 3 && !PLANNED_OR_LATER.includes(procedureStatus)) return naturalStep
    if (requestedStep === 4 && !APPROVED_OR_LATER.includes(procedureStatus)) return naturalStep
    return requestedStep
  }

  return naturalStep
}

// ─── Hook ───────────────────────────────────────────────────────────

interface UseServiceWizardOptions {
  patientId: string
  initialStep?: number
  procedureId?: string | null
  procedureRecordIds?: string[]
  encounterId?: string | null
  procedureStatus?: ProcedureStatus | null
  selectedTypeIds?: string[]
  cart?: EncounterCart
  stepTimestamps?: StepTimestamps
}

export function useServiceWizard({
  patientId,
  initialStep,
  procedureId: initialProcedureId,
  procedureRecordIds: initialProcedureRecordIds,
  encounterId: initialEncounterId,
  procedureStatus: initialProcedureStatus,
  selectedTypeIds: initialSelectedTypeIds,
  cart: initialCart,
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
    procedureRecordIds: initialProcedureRecordIds ?? [],
    encounterId: initialEncounterId ?? null,
    procedureStatus: initialProcedureStatus ?? null,
    selectedTypeIds:
      initialSelectedTypeIds ??
      (initialCart ? initialCart.lines.map((l) => l.procedureTypeId) : []),
    cart: initialCart ?? EMPTY_CART,
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
      if (step === 3) return PLANNED_OR_LATER.includes(state.procedureStatus)
      if (step === 4) return APPROVED_OR_LATER.includes(state.procedureStatus)
      return true
    },
    [state.procedureStatus]
  )

  // ─── Step completion ────────────────────────────────────────────

  const isStepCompleted = useCallback(
    (step: WizardStep): boolean => {
      switch (step) {
        case 1:
          return !!state.stepTimestamps.anamnesis
        case 2:
          return PLANNED_OR_LATER.includes(state.procedureStatus)
        case 3:
          return APPROVED_OR_LATER.includes(state.procedureStatus)
        case 4:
          return state.procedureStatus === 'completed'
      }
    },
    [state.stepTimestamps.anamnesis, state.procedureStatus]
  )

  // ─── Skip logic ─────────────────────────────────────────────────
  // Anamnesis can always be skipped (a first visit can send the link and fill it later);
  // approval can be postponed. Planning and execution cannot be skipped.

  const canSkip = useCallback((step: WizardStep): boolean => step === 1 || step === 3, [])

  // ─── Read-only check (after approval, steps 1-2 are read-only) ─

  const isStepReadOnly = useCallback(
    (step: WizardStep): boolean => step <= 2 && APPROVED_OR_LATER.includes(state.procedureStatus),
    [state.procedureStatus]
  )

  // ─── Skip button label ──────────────────────────────────────────

  const getSkipLabel = useCallback(
    (step: WizardStep): string | null => {
      if (!canSkip(step)) return null
      if (step === 3) return 'Adiar aprovação'
      return 'Pular'
    },
    [canSkip]
  )

  // ─── Next button label ─────────────────────────────────────────

  const getNextLabel = useCallback(
    (step: WizardStep): string => {
      if (step === 4) return 'Finalizar atendimento'
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

      if (result.success && result.procedureId) {
        // Use the server-assigned status. If the server didn't echo one
        // (older code paths), default conservatively to 'draft' so the wizard
        // doesn't auto-advance past step 3.
        const serverStatus = (result.procedureStatus ?? 'draft') as ProcedureStatus
        if (!state.procedureId) {
          dispatch({
            type: 'SET_PROCEDURE_ID',
            procedureId: result.procedureId,
            status: serverStatus,
          })
        } else if (serverStatus !== state.procedureStatus) {
          // Procedure already existed — just update its status
          dispatch({ type: 'UPDATE_PROCEDURE_STATUS', status: serverStatus })
        }
      }
    },
    [state.procedureId, state.procedureStatus]
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
    (step: StepTimestampKey, timestamp: Date) => {
      dispatch({ type: 'UPDATE_STEP_TIMESTAMP', step, timestamp })
    },
    []
  )

  const setSelectedTypeIds = useCallback((typeIds: string[]) => {
    dispatch({ type: 'SET_SELECTED_TYPES', typeIds })
  }, [])

  const setCart = useCallback((cart: EncounterCart) => {
    dispatch({ type: 'SET_CART', cart })
  }, [])

  const setEncounterId = useCallback((encounterId: string) => {
    dispatch({ type: 'SET_ENCOUNTER_ID', encounterId })
  }, [])

  const setProcedureRecordIds = useCallback((procedureRecordIds: string[]) => {
    dispatch({ type: 'SET_PROCEDURE_RECORD_IDS', procedureRecordIds })
  }, [])

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
    setSelectedTypeIds,
    setCart,
    setEncounterId,
    setProcedureRecordIds,
    patientId,
  }
}

export type UseServiceWizardReturn = ReturnType<typeof useServiceWizard>
