import { describe, expect, it } from 'vitest'
import { computeOverlapLayout } from '../grid'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

function appt(id: string, startTime: string, endTime: string): AppointmentWithDetails {
  return { id, startTime, endTime } as AppointmentWithDetails
}

function columns(rows: ReturnType<typeof computeOverlapLayout>) {
  return Object.fromEntries(rows.map((r) => [r.appointment.id, `col ${r.column} span ${r.span} of ${r.totalColumns}`]))
}

describe('computeOverlapLayout', () => {
  it('widens a card over the columns that are free at its time', () => {
    // Regression: every card in an overlap cluster got 1/N of the width, so D stayed a third wide
    // although nothing else happens at 10:00 except the long A in the first column.
    const rows = computeOverlapLayout(
      [appt('A', '09:00', '11:00'), appt('B', '09:00', '09:30'), appt('C', '09:00', '09:30'), appt('D', '10:00', '10:30')],
      48,
    )
    expect(columns(rows)).toEqual({
      A: 'col 0 span 1 of 3',
      B: 'col 1 span 1 of 3',
      C: 'col 2 span 1 of 3',
      D: 'col 1 span 2 of 3',
    })
  })

  it('keeps back-to-back appointments full width', () => {
    const rows = computeOverlapLayout([appt('A', '09:00', '09:45'), appt('B', '09:45', '10:30')], 48)
    expect(columns(rows)).toEqual({ A: 'col 0 span 1 of 1', B: 'col 0 span 1 of 1' })
  })
})
