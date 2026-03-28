import { describe, it, expect } from 'vitest'
import { createProcedureSchema, diagramPointSchema, diagramSaveSchema } from '../procedure'

describe('createProcedureSchema', () => {
  const validData = {
    patientId: '550e8400-e29b-41d4-a716-446655440000',
    procedureTypeId: '550e8400-e29b-41d4-a716-446655440001',
  }

  it('passes with valid required fields', () => {
    const result = createProcedureSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with all optional fields', () => {
    const result = createProcedureSchema.safeParse({
      ...validData,
      appointmentId: '550e8400-e29b-41d4-a716-446655440002',
      technique: 'Micro-injecoes subdermicas',
      clinicalResponse: 'Boa resposta inicial',
      adverseEffects: 'Nenhum',
      notes: 'Procedimento sem intercorrencias',
      followUpDate: '2025-07-15',
      nextSessionObjectives: 'Reforcar area periorbital',
    })
    expect(result.success).toBe(true)
  })

  it('fails when patientId is missing', () => {
    const result = createProcedureSchema.safeParse({ procedureTypeId: validData.procedureTypeId })
    expect(result.success).toBe(false)
  })

  it('fails when patientId is not a UUID', () => {
    const result = createProcedureSchema.safeParse({ ...validData, patientId: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('fails when procedureTypeId is missing', () => {
    const result = createProcedureSchema.safeParse({ patientId: validData.patientId })
    expect(result.success).toBe(false)
  })

  it('fails when technique exceeds 5000 characters', () => {
    const result = createProcedureSchema.safeParse({ ...validData, technique: 'a'.repeat(5001) })
    expect(result.success).toBe(false)
  })

  it('allows technique up to 5000 characters', () => {
    const result = createProcedureSchema.safeParse({ ...validData, technique: 'a'.repeat(5000) })
    expect(result.success).toBe(true)
  })
})

describe('diagramPointSchema', () => {
  const validPoint = {
    x: 50,
    y: 50,
    productName: 'Botox',
    quantity: 5,
    quantityUnit: 'U' as const,
  }

  it('passes with valid point data', () => {
    const result = diagramPointSchema.safeParse(validPoint)
    expect(result.success).toBe(true)
  })

  it('passes with all optional fields', () => {
    const result = diagramPointSchema.safeParse({
      ...validPoint,
      activeIngredient: 'Toxina botulinica tipo A',
      technique: 'Bolus',
      depth: 'Intradermica',
      notes: 'Ponto de atencao',
    })
    expect(result.success).toBe(true)
  })

  it('fails when x is negative', () => {
    const result = diagramPointSchema.safeParse({ ...validPoint, x: -1 })
    expect(result.success).toBe(false)
  })

  it('fails when x exceeds 100', () => {
    const result = diagramPointSchema.safeParse({ ...validPoint, x: 101 })
    expect(result.success).toBe(false)
  })

  it('fails when y is negative', () => {
    const result = diagramPointSchema.safeParse({ ...validPoint, y: -1 })
    expect(result.success).toBe(false)
  })

  it('fails when y exceeds 100', () => {
    const result = diagramPointSchema.safeParse({ ...validPoint, y: 101 })
    expect(result.success).toBe(false)
  })

  it('allows x and y at boundary values 0 and 100', () => {
    expect(diagramPointSchema.safeParse({ ...validPoint, x: 0, y: 0 }).success).toBe(true)
    expect(diagramPointSchema.safeParse({ ...validPoint, x: 100, y: 100 }).success).toBe(true)
  })

  it('fails when productName is empty', () => {
    const result = diagramPointSchema.safeParse({ ...validPoint, productName: '' })
    expect(result.success).toBe(false)
  })

  it('fails when quantity is zero', () => {
    const result = diagramPointSchema.safeParse({ ...validPoint, quantity: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when quantity is negative', () => {
    const result = diagramPointSchema.safeParse({ ...validPoint, quantity: -1 })
    expect(result.success).toBe(false)
  })

  it('accepts both U and mL as quantityUnit', () => {
    expect(diagramPointSchema.safeParse({ ...validPoint, quantityUnit: 'U' }).success).toBe(true)
    expect(diagramPointSchema.safeParse({ ...validPoint, quantityUnit: 'mL' }).success).toBe(true)
  })

  it('fails with invalid quantityUnit', () => {
    const result = diagramPointSchema.safeParse({ ...validPoint, quantityUnit: 'mg' })
    expect(result.success).toBe(false)
  })
})

describe('diagramSaveSchema', () => {
  it('passes with valid data and empty points array', () => {
    const result = diagramSaveSchema.safeParse({
      procedureRecordId: '550e8400-e29b-41d4-a716-446655440000',
      viewType: 'front',
      points: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid viewType values', () => {
    for (const viewType of ['front', 'left_profile', 'right_profile']) {
      const result = diagramSaveSchema.safeParse({
        procedureRecordId: '550e8400-e29b-41d4-a716-446655440000',
        viewType,
        points: [],
      })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid viewType', () => {
    const result = diagramSaveSchema.safeParse({
      procedureRecordId: '550e8400-e29b-41d4-a716-446655440000',
      viewType: 'back',
      points: [],
    })
    expect(result.success).toBe(false)
  })

  it('validates nested diagram points', () => {
    const result = diagramSaveSchema.safeParse({
      procedureRecordId: '550e8400-e29b-41d4-a716-446655440000',
      viewType: 'front',
      points: [{ x: 50, y: 50, productName: '', quantity: 5, quantityUnit: 'U' }],
    })
    expect(result.success).toBe(false) // productName is empty
  })
})
