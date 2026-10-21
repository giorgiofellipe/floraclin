import type { TrialRecap } from '@/db/queries/trial-recap'

export type { TrialRecap }

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * pt-BR lines for the non-zero recap counts, most meaningful first. Shared by
 * the modal, the paywall and the last-day email so they always say the same.
 */
export function trialRecapLines(recap: TrialRecap | null | undefined): string[] {
  if (!recap) return []
  const lines: string[] = []
  if (recap.patients > 0) lines.push(plural(recap.patients, 'paciente cadastrado', 'pacientes cadastrados'))
  if (recap.appointments > 0) lines.push(plural(recap.appointments, 'agendamento', 'agendamentos'))
  if (recap.procedureRecords > 0) lines.push(plural(recap.procedureRecords, 'atendimento registrado', 'atendimentos registrados'))
  if (recap.diagrams > 0) lines.push(plural(recap.diagrams, 'diagrama facial', 'diagramas faciais'))
  if (recap.photos > 0) lines.push(plural(recap.photos, 'foto', 'fotos'))
  return lines
}

/** A clinic "used" the trial when it registered a patient and booked them. */
export function usedTrial(state: { hasPatient: boolean; hasAppointment: boolean }): boolean {
  return state.hasPatient && state.hasAppointment
}
