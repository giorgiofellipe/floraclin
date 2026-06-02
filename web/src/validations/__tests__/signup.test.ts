import { describe, it, expect } from 'vitest'
import { signUpSchema, clinicDetailsSchema } from '../signup'

describe('signUpSchema', () => {
  const valid = {
    fullName: 'Maria Silva',
    email: 'maria@example.com',
    password: 'secure123',
    clinicName: 'Clínica Bela',
    phone: '11999998888',
  }

  it('accepts valid input', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects missing fullName', () => {
    const result = signUpSchema.safeParse({ ...valid, fullName: '' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = signUpSchema.safeParse({ ...valid, email: 'not-email' })
    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = signUpSchema.safeParse({ ...valid, password: '1234567' })
    expect(result.success).toBe(false)
  })

  it('rejects missing clinicName', () => {
    const result = signUpSchema.safeParse({ ...valid, clinicName: '' })
    expect(result.success).toBe(false)
  })

  it('rejects missing phone', () => {
    const result = signUpSchema.safeParse({ ...valid, phone: '' })
    expect(result.success).toBe(false)
  })

  it('trims whitespace from fields', () => {
    const result = signUpSchema.safeParse({ ...valid, fullName: '  Maria Silva  ', clinicName: '  Clínica  ' })
    expect(result.success).toBe(true)
    expect(result.data!.fullName).toBe('Maria Silva')
    expect(result.data!.clinicName).toBe('Clínica')
  })
})

describe('clinicDetailsSchema', () => {
  it('accepts valid input', () => {
    const result = clinicDetailsSchema.safeParse({ clinicName: 'Clínica Bela', phone: '11999998888' })
    expect(result.success).toBe(true)
  })

  it('rejects empty clinicName', () => {
    const result = clinicDetailsSchema.safeParse({ clinicName: '', phone: '11999998888' })
    expect(result.success).toBe(false)
  })
})
