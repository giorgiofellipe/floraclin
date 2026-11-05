/**
 * Query parameter onboarding adds to the dashboard URL so its "Novo Paciente"
 * action is highlighted once, right after the clinic is set up. The dashboard
 * drops it from the URL as soon as it has read it, so a reload or Back does
 * not highlight again.
 */
export const FIRST_PATIENT_HIGHLIGHT_PARAM = 'primeiro_paciente'

export function wantsFirstPatientHighlight(value: string | string[] | undefined): boolean {
  return value === '1'
}
