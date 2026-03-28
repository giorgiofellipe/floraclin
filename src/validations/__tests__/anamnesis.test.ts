import { describe, it, expect } from 'vitest'
import { anamnesisSchema, allergySchema, medicationSchema } from '../anamnesis'

describe('anamnesisSchema', () => {
  it('passes with empty/default data', () => {
    const result = anamnesisSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('passes with full valid data', () => {
    const result = anamnesisSchema.safeParse({
      mainComplaint: 'Rugas na testa',
      patientGoals: 'Rejuvenescer',
      skinType: 'III',
      isPregnant: false,
      isBreastfeeding: false,
      medications: [{ name: 'Aspirina', dosage: '100mg', frequency: 'Diario', reason: 'Cardio' }],
      allergies: [{ substance: 'Latex', reaction: 'Urticaria', severity: 'moderada' }],
    })
    expect(result.success).toBe(true)
  })

  it('fails with invalid Fitzpatrick skin type', () => {
    const result = anamnesisSchema.safeParse({ skinType: 'VII' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid Fitzpatrick types', () => {
    for (const type of ['I', 'II', 'III', 'IV', 'V', 'VI']) {
      const result = anamnesisSchema.safeParse({ skinType: type })
      expect(result.success).toBe(true)
    }
  })

  it('allows omitting skinType', () => {
    const result = anamnesisSchema.safeParse({ mainComplaint: 'Test' })
    expect(result.success).toBe(true)
  })
})

describe('medicationSchema', () => {
  it('passes with valid medication', () => {
    const result = medicationSchema.safeParse({ name: 'Aspirina' })
    expect(result.success).toBe(true)
  })

  it('fails when name is missing', () => {
    const result = medicationSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('fails when name is empty', () => {
    const result = medicationSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('defaults optional fields to empty strings', () => {
    const result = medicationSchema.safeParse({ name: 'Test' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.dosage).toBe('')
      expect(result.data.frequency).toBe('')
      expect(result.data.reason).toBe('')
    }
  })
})

describe('allergySchema', () => {
  it('passes with valid allergy', () => {
    const result = allergySchema.safeParse({ substance: 'Penicilina' })
    expect(result.success).toBe(true)
  })

  it('fails when substance is missing', () => {
    const result = allergySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('fails when substance is empty', () => {
    const result = allergySchema.safeParse({ substance: '' })
    expect(result.success).toBe(false)
  })

  it('validates severity enum values', () => {
    for (const severity of ['leve', 'moderada', 'grave']) {
      const result = allergySchema.safeParse({ substance: 'Test', severity })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid severity value', () => {
    const result = allergySchema.safeParse({ substance: 'Test', severity: 'extrema' })
    expect(result.success).toBe(false)
  })

  it('allows omitting severity', () => {
    const result = allergySchema.safeParse({ substance: 'Test' })
    expect(result.success).toBe(true)
  })
})
