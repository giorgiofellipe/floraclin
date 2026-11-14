import { describe, expect, it } from 'vitest'
import { agendaMenuActions } from '../appointment-actions'
import type { Role } from '@/types'

function actions(status: string, role: Role, patientId: string | null = 'p1') {
  return agendaMenuActions({ id: 'a1', status, patientId, bookingName: null, bookingPhone: null }, role)
}

describe('agendaMenuActions', () => {
  // Each row is what the agenda menu offers. A wrong row either shows a step the API answers with 403
  // (financial cannot write appointments, receptionists cannot start an atendimento) or a status that
  // makes no sense next (confirming a completed appointment).
  it.each<[string, Role, string | null, string[]]>([
    ['scheduled', 'owner', 'p1', ['confirm', 'start', 'no-show', 'patient', 'reschedule', 'edit', 'new-here', 'cancel']],
    ['confirmed', 'practitioner', 'p1', ['start', 'no-show', 'patient', 'reschedule', 'edit', 'new-here', 'cancel']],
    ['confirmed', 'receptionist', 'p1', ['no-show', 'patient', 'reschedule', 'edit', 'new-here', 'cancel']],
    ['in_progress', 'owner', 'p1', ['open-atendimento', 'complete', 'patient', 'edit', 'new-here', 'cancel']],
    ['completed', 'owner', 'p1', ['patient', 'edit', 'new-here']],
    // Financial only reads the agenda: it opens the patient and the appointment, and changes nothing.
    ['scheduled', 'financial', 'p1', ['patient', 'edit']],
    // Registering the booker is a POST /api/patients, which financial cannot do.
    ['scheduled', 'financial', null, ['edit']],
    // An online booking without a patient record cannot start an atendimento yet.
    ['confirmed', 'owner', null, ['no-show', 'patient', 'reschedule', 'edit', 'new-here', 'cancel']],
  ])('%s for %s (patient %s)', (status, role, patientId, expected) => {
    expect(actions(status, role, patientId)).toEqual(expected)
  })
})
