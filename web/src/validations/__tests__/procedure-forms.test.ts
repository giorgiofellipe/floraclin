import { describe, it, expect } from 'vitest'
import {
  procedurePlanningFormSchema,
  procedurePlanningFinalSchema,
  procedureExecutionFormSchema,
} from '../procedure'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('procedurePlanningFormSchema (draft)', () => {
  it('accepts a minimal draft with just a valid procedureTypeId', () => {
    expect(procedurePlanningFormSchema.safeParse({ procedureTypeId: VALID_UUID }).success).toBe(true)
  })

  it('rejects a missing procedureTypeId', () => {
    expect(procedurePlanningFormSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a technique longer than 5000 chars', () => {
    const r = procedurePlanningFormSchema.safeParse({ procedureTypeId: VALID_UUID, technique: 'x'.repeat(5001) })
    expect(r.success).toBe(false)
  })
})

describe('procedurePlanningFinalSchema (strict)', () => {
  it('rejects when financialPlan is missing', () => {
    expect(procedurePlanningFinalSchema.safeParse({ procedureTypeId: VALID_UUID }).success).toBe(false)
  })

  it('rejects when diagramPoints is empty', () => {
    expect(
      procedurePlanningFinalSchema.safeParse({
        procedureTypeId: VALID_UUID,
        financialPlan: { totalAmount: 100, installmentCount: 1 },
        diagramPoints: [],
      }).success,
    ).toBe(false)
  })

  it('accepts a complete final payload', () => {
    expect(
      procedurePlanningFinalSchema.safeParse({
        procedureTypeId: VALID_UUID,
        financialPlan: { totalAmount: 100, installmentCount: 1 },
        diagramPoints: [{ x: 50, y: 50, productName: 'Botox', quantity: 10, quantityUnit: 'U' }],
      }).success,
    ).toBe(true)
  })
})

describe('procedureExecutionFormSchema', () => {
  it('accepts an empty draft (all fields optional)', () => {
    expect(procedureExecutionFormSchema.safeParse({}).success).toBe(true)
  })

  it('rejects a product application with an empty productName', () => {
    expect(
      procedureExecutionFormSchema.safeParse({
        productApplications: [{ productName: '', totalQuantity: 10, quantityUnit: 'U' }],
      }).success,
    ).toBe(false)
  })
})
