import { describe, it, expect } from 'vitest'
import { createPatientSchema, updatePatientSchema } from '../patient'

describe('createPatientSchema', () => {
  const validData = {
    fullName: 'Maria Silva',
    phone: '(11) 99999-8888',
  }

  it('passes with valid required fields', () => {
    const result = createPatientSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with all optional fields', () => {
    const result = createPatientSchema.safeParse({
      ...validData,
      cpf: '12345678901',
      birthDate: '1990-01-15',
      gender: 'female',
      email: 'maria@example.com',
      phoneSecondary: '(11) 88888-7777',
      address: {
        street: 'Rua das Flores',
        number: '123',
        complement: 'Apt 4',
        neighborhood: 'Centro',
        city: 'Sao Paulo',
        state: 'SP',
        zip: '01234-567',
      },
      occupation: 'Engenheira',
      referralSource: 'Instagram',
      notes: 'Paciente VIP',
    })
    expect(result.success).toBe(true)
  })

  it('fails when fullName is missing', () => {
    const result = createPatientSchema.safeParse({ phone: '11999998888' })
    expect(result.success).toBe(false)
  })

  it('fails when fullName is empty', () => {
    const result = createPatientSchema.safeParse({ fullName: '', phone: '11999998888' })
    expect(result.success).toBe(false)
  })

  it('fails when phone is missing', () => {
    const result = createPatientSchema.safeParse({ fullName: 'Maria Silva' })
    expect(result.success).toBe(false)
  })

  it('fails when phone is empty', () => {
    const result = createPatientSchema.safeParse({ fullName: 'Maria', phone: '' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid email format', () => {
    const result = createPatientSchema.safeParse({
      ...validData,
      email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('allows empty email string', () => {
    const result = createPatientSchema.safeParse({
      ...validData,
      email: '',
    })
    expect(result.success).toBe(true)
  })

  it('allows omitting all optional fields', () => {
    const result = createPatientSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })
})

describe('updatePatientSchema', () => {
  it('requires a valid UUID id', () => {
    const result = updatePatientSchema.safeParse({ id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('passes with valid id and optional updates', () => {
    const result = updatePatientSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      fullName: 'Maria Updated',
    })
    expect(result.success).toBe(true)
  })
})
