import { describe, it, expect } from 'vitest'
import { createAppointmentSchema, updateStatusSchema } from '../appointment'

describe('createAppointmentSchema', () => {
  const validData = {
    practitionerId: '550e8400-e29b-41d4-a716-446655440000',
    date: '2025-06-15',
    startTime: '09:00',
    endTime: '10:00',
  }

  it('passes with valid required data', () => {
    const result = createAppointmentSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with all fields populated', () => {
    const result = createAppointmentSchema.safeParse({
      ...validData,
      patientId: '550e8400-e29b-41d4-a716-446655440001',
      procedureTypeId: '550e8400-e29b-41d4-a716-446655440002',
      notes: 'Primeira consulta',
      source: 'online_booking',
      bookingName: 'Maria',
      bookingPhone: '11999998888',
      bookingEmail: 'maria@test.com',
    })
    expect(result.success).toBe(true)
  })

  it('fails when practitionerId is missing', () => {
    const { practitionerId, ...rest } = validData
    const result = createAppointmentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when practitionerId is not a UUID', () => {
    const result = createAppointmentSchema.safeParse({ ...validData, practitionerId: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid date format', () => {
    const result = createAppointmentSchema.safeParse({ ...validData, date: '15/06/2025' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid startTime format', () => {
    const result = createAppointmentSchema.safeParse({ ...validData, startTime: '9:00' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid endTime format', () => {
    const result = createAppointmentSchema.safeParse({ ...validData, endTime: '1000' })
    expect(result.success).toBe(false)
  })

  it('fails when startTime is after endTime', () => {
    const result = createAppointmentSchema.safeParse({
      ...validData,
      startTime: '14:00',
      endTime: '10:00',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const endTimeError = result.error.issues.find(i => i.path.includes('endTime'))
      expect(endTimeError).toBeDefined()
    }
  })

  it('fails when startTime equals endTime', () => {
    const result = createAppointmentSchema.safeParse({
      ...validData,
      startTime: '10:00',
      endTime: '10:00',
    })
    expect(result.success).toBe(false)
  })

  it('fails with notes exceeding 2000 characters', () => {
    const result = createAppointmentSchema.safeParse({
      ...validData,
      notes: 'a'.repeat(2001),
    })
    expect(result.success).toBe(false)
  })

  it('fails with invalid bookingEmail', () => {
    const result = createAppointmentSchema.safeParse({
      ...validData,
      bookingEmail: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })
})

describe('updateStatusSchema', () => {
  it('passes with valid status', () => {
    const result = updateStatusSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'confirmed',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid status values', () => {
    const statuses = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']
    for (const status of statuses) {
      const result = updateStatusSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        status,
      })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid status enum', () => {
    const result = updateStatusSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'unknown',
    })
    expect(result.success).toBe(false)
  })

  it('fails with invalid id', () => {
    const result = updateStatusSchema.safeParse({
      id: 'bad-id',
      status: 'confirmed',
    })
    expect(result.success).toBe(false)
  })
})
