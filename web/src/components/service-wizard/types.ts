// ─── Service Wizard shared types ───────────────────────────────────

export interface StepResult {
  success: boolean
  procedureId?: string
  /** Server-assigned status after save — lets the wizard advance correctly for draft vs planned. */
  procedureStatus?: 'draft' | 'planned' | 'approved' | 'executed' | 'cancelled'
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
  /** Flipped by the form whenever its unsaved-changes state changes. */
  onDirtyChange?: (isDirty: boolean) => void
  /**
   * Fired by the form on any user edit (keystroke, checkbox toggle,
   * field change). Lets the wizard proactively clear a stale
   * validation banner the moment the user starts fixing things.
   */
  onUserEdit?: () => void
  /** Called after a non-triggerSave save (e.g., anamnesis auto-save) so the wizard can refresh its stepTimestamps. */
  onAutoSaved?: (timestamp: Date) => void
  /** 'final' runs strict validation (e.g., step 3 → step 4). Default 'draft'. */
  validationMode?: 'draft' | 'final'
}
