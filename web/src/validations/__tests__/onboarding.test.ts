import { describe, it, expect } from 'vitest'
import { productSelectionSchema, onboardingCompleteSchema } from '../onboarding'

describe('productSelectionSchema', () => {
  it('accepts a minimal valid product', () => {
    const result = productSelectionSchema.safeParse({
      name: 'Botulift 100U',
      category: 'botox',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.defaultUnit).toBe('U')
      expect(result.data.activeIngredient).toBe('')
    }
  })

  it('rejects empty name', () => {
    const result = productSelectionSchema.safeParse({ name: '', category: 'botox' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid category', () => {
    const result = productSelectionSchema.safeParse({ name: 'Foo', category: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid categories', () => {
    for (const cat of ['botox', 'filler', 'biostimulator', 'skinbooster', 'peel', 'other']) {
      const result = productSelectionSchema.safeParse({ name: 'X', category: cat })
      expect(result.success).toBe(true)
    }
  })

  it('accepts both U and mL units', () => {
    for (const unit of ['U', 'mL']) {
      const result = productSelectionSchema.safeParse({
        name: 'X',
        category: 'botox',
        defaultUnit: unit,
      })
      expect(result.success).toBe(true)
    }
  })
})

describe('onboardingCompleteSchema', () => {
  it('defaults selectedProducts to empty when omitted', () => {
    const validClinic = {
      name: 'Clínica X',
      workingHours: {
        mon: { start: '08:00', end: '18:00', enabled: true },
        tue: { start: '08:00', end: '18:00', enabled: true },
        wed: { start: '08:00', end: '18:00', enabled: true },
        thu: { start: '08:00', end: '18:00', enabled: true },
        fri: { start: '08:00', end: '18:00', enabled: true },
        sat: { start: '08:00', end: '12:00', enabled: false },
        sun: { start: '08:00', end: '12:00', enabled: false },
      },
    }
    const result = onboardingCompleteSchema.safeParse({
      clinic: validClinic,
      procedureTypes: [],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.selectedProducts).toEqual([])
  })

  it('accepts valid selectedProducts', () => {
    const validClinic = {
      name: 'Clínica X',
      workingHours: {
        mon: { start: '08:00', end: '18:00', enabled: true },
        tue: { start: '08:00', end: '18:00', enabled: true },
        wed: { start: '08:00', end: '18:00', enabled: true },
        thu: { start: '08:00', end: '18:00', enabled: true },
        fri: { start: '08:00', end: '18:00', enabled: true },
        sat: { start: '08:00', end: '12:00', enabled: false },
        sun: { start: '08:00', end: '12:00', enabled: false },
      },
    }
    const result = onboardingCompleteSchema.safeParse({
      clinic: validClinic,
      procedureTypes: [],
      selectedProducts: [
        { name: 'Botulift 100U', category: 'botox', activeIngredient: 'Toxina', defaultUnit: 'U' },
      ],
    })
    expect(result.success).toBe(true)
  })
})
