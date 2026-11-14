import { describe, expect, it } from 'vitest'
import { droppedSlot } from '../grid'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const appt = { id: 'a1', date: '2026-11-17', startTime: '09:00:00', endTime: '10:00:00' } as AppointmentWithDetails

describe('droppedSlot', () => {
  it('moves by whole days and half hours and keeps the duration', () => {
    expect(droppedSlot(appt, { dayOffset: 2, slotOffset: 3 }, WEEK)).toEqual({ date: '2026-11-19', startTime: '10:30', endTime: '11:30' })
  })

  it('keeps the appointment inside the week and the grid hours', () => {
    expect(droppedSlot(appt, { dayOffset: -5, slotOffset: -10 }, WEEK)).toEqual({ date: '2026-11-16', startTime: '07:00', endTime: '08:00' })
    expect(droppedSlot(appt, { dayOffset: 9, slotOffset: 40 }, WEEK)).toEqual({ date: '2026-11-22', startTime: '20:00', endTime: '21:00' })
  })

  it('returns nothing for a drop back on the same slot, so no save is sent', () => {
    expect(droppedSlot(appt, { dayOffset: 0, slotOffset: 0 }, WEEK)).toBeNull()
  })
})
