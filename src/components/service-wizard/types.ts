// ─── Service Wizard shared types ───────────────────────────────────

export interface StepResult {
  success: boolean
  procedureId?: string
  error?: string
  errorType?: 'validation' | 'precondition' | 'server'
}

export interface WizardOverrides {
  hideSaveButton: boolean
  hideNavigation: boolean
  hideTitle: boolean
  hideProcedureTypes?: boolean
  onSaveComplete?: (result: StepResult) => void
  triggerSave?: number
}
